import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCurator } from "@/lib/admin-auth";
import {
  COOKING_METHOD_VALUES,
  NUTRIENT_FIELDS,
  detectSourceConflicts,
  parseManufacturerEnergy,
} from "@/lib/domain";
import { consumeRateLimit } from "@/lib/request-rate-limit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 30_000;
const labelSourceSchema = z.enum(["manufacturer", "kr_label"]);
const extractionCellSchema = z.object({
  value: z.number().finite().nullable(),
  evidence: z.string().nullable(),
  source: labelSourceSchema.nullable(),
});
const extractionRequestSchema = z
  .object({
    manufacturerText: z.string().max(MAX_TEXT_LENGTH).default(""),
    krLabelText: z.string().max(MAX_TEXT_LENGTH).default(""),
  })
  .strict();
const modelOutputSchema = z.object({
  product_name: z.string().nullable().default(null),
  brand: z.string().nullable().default(null),
  manufacturer: z.string().nullable().default(null),
  cooking_method: z.enum(COOKING_METHOD_VALUES).nullable().default(null),
  nutrients: z.record(z.string(), extractionCellSchema).default({}),
  flags: z
    .object({
      grain_free: z.boolean().optional(),
      meal_free: z.boolean().optional(),
      has_probiotics: z.boolean().optional(),
      has_cranberry: z.boolean().optional(),
      has_yucca: z.boolean().optional(),
    })
    .default({}),
  ingredients: z
    .array(
      z.object({
        name: z.string(),
        pct: z.number().finite().nullable(),
        type: z.enum(["meat", "fish", "plant", "other"]),
      }),
    )
    .default([]),
});
const anthropicResponseSchema = z.object({
  content: z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    }),
  ),
});

type ModelOutput = z.infer<typeof modelOutputSchema>;
type ExtractionCell = z.infer<typeof extractionCellSchema>;

const SCHEMA = `{
  "product_name": string | null,
  "brand": string | null,
  "manufacturer": string | null,
  "cooking_method": "extrusion" | "baked" | "freeze_dried" | "dried" | null,
  "nutrients": {
    "protein_pct":    {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null},
    "fat_pct":        {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null},
    "fiber_pct":      {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null},
    "ash_pct":        {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null},
    "moisture_pct":   {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null},
    "calcium_pct":    {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null},
    "phosphorus_pct": {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null},
    "kcal_per_kg":    {"value": number|null, "evidence": string|null, "source": "manufacturer"|"kr_label"|null}
  },
  "flags": { "grain_free": boolean, "meal_free": boolean, "has_probiotics": boolean, "has_cranberry": boolean, "has_yucca": boolean },
  "ingredients": [{"name": string, "pct": number|null, "type": "meat"|"fish"|"plant"|"other"}]
}`;

function buildPrompt(mfgText: string, krText: string) {
  return `You are a pet food label data extractor. Extract guaranteed-analysis values into the exact JSON schema.

CRITICAL RULES:
- For every nutrient value you MUST include the exact source phrase in "evidence". If a value is not literally present, set value, evidence, AND source to null. NEVER guess or infer a number not present in the text.
- Percentages: strip the % sign, number only ("Crude Protein (min) 36.0%" -> value 36.0).
- Two input blocks are provided: MANUFACTURER text and KR_LABEL (Korean importer) text. Tag each value's "source" by which block it came from. Manufacturer text often omits ash (조회분) and energy; the KR label usually has them.
- Prefer manufacturer values for core nutrients (protein/fat/fiber/moisture/calcium/phosphorus). Use kr_label only to fill what's missing (typically ash, energy).
- Do NOT compute carbohydrate/NFE, energy ratios, or Ca:P. Only extract values literally on the labels.
- ingredients: leading ingredients in order with % if stated. type: meat / fish / plant / other.
- flags: true only if explicitly indicated.
- cooking_method: infer only if clearly stated (e.g. "oven-baked", "freeze-dried"); otherwise null.

Return ONLY the JSON object, no markdown, no preamble.

Schema:
${SCHEMA}

MANUFACTURER text:
"""
${mfgText || "(none)"}
"""

KR_LABEL text:
"""
${krText || "(none)"}
"""`;
}

export async function POST(req: NextRequest) {
  const authorization = await authorizeCurator(req);
  if (authorization.kind === "denied") {
    return NextResponse.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  if (authorization.origin === "automation") {
    return NextResponse.json(
      { error: "자동화 자격 증명으로는 원문 추출을 실행할 수 없습니다." },
      { status: 403 },
    );
  }

  const rateLimit = await consumeRateLimit(
    `extract:${authorization.rateLimitKey}`,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "추출 요청 한도를 초과했습니다." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  try {
    const request = extractionRequestSchema.safeParse(await readJsonBody(req));
    if (!request.success) {
      return NextResponse.json(
        { error: "요청 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }

    const { manufacturerText, krLabelText } = request.data;
    if (!manufacturerText && !krLabelText) {
      return NextResponse.json(
        { error: "원문이 비어 있습니다." },
        { status: 400 },
      );
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY 미설정" },
        { status: 500 },
      );
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [
          { role: "user", content: buildPrompt(manufacturerText, krLabelText) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: `Claude API ${res.status}: ${t.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const anthropicResponse = anthropicResponseSchema.safeParse(
      await res.json(),
    );
    if (!anthropicResponse.success) {
      return NextResponse.json(
        { error: "Claude API 응답 형식 오류" },
        { status: 502 },
      );
    }

    const text = anthropicResponse.data.content
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text)
      .join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const modelOutput = parseModelOutput(clean);
    if (!modelOutput) {
      return NextResponse.json(
        { error: "Claude JSON 응답 형식 오류", raw: clean.slice(0, 500) },
        { status: 502 },
      );
    }

    const parsed = sanitizeModelOutput(
      modelOutput,
      manufacturerText,
      krLabelText,
    );
    const mfgEnergy = parseManufacturerEnergy(manufacturerText);
    const conflicts = detectSourceConflicts(manufacturerText, krLabelText);

    return NextResponse.json({ parsed, mfgEnergy, conflicts });
  } catch (error: unknown) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "원문은 64KB 이하로 입력해 주세요." },
        { status: 413 },
      );
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "요청 JSON 형식이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Claude API 요청 시간이 초과되었습니다." },
        { status: 504 },
      );
    }
    const message =
      error instanceof Error ? error.message : "추출 요청 처리 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function parseModelOutput(text: string): ModelOutput | null {
  try {
    const parsed = modelOutputSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function sanitizeModelOutput(
  output: ModelOutput,
  manufacturerText: string,
  krLabelText: string,
) {
  const nutrients: Record<string, ExtractionCell> = {};
  for (const [key] of NUTRIENT_FIELDS) {
    const cell = output.nutrients[key];
    nutrients[key] = isEvidenceBacked(cell, manufacturerText, krLabelText)
      ? cell
      : { value: null, evidence: null, source: null };
  }

  return { ...output, nutrients };
}

function isEvidenceBacked(
  cell: ExtractionCell | undefined,
  manufacturerText: string,
  krLabelText: string,
): cell is ExtractionCell & {
  readonly value: number;
  readonly evidence: string;
} {
  if (!cell || cell.value === null || !cell.evidence || !cell.source)
    return false;
  const sourceText =
    cell.source === "manufacturer" ? manufacturerText : krLabelText;
  return normalizeEvidence(sourceText).includes(
    normalizeEvidence(cell.evidence),
  );
}

function normalizeEvidence(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

class RequestBodyTooLargeError extends Error {
  readonly name = "RequestBodyTooLargeError";
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) throw new SyntaxError("Request body is missing.");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }

  return JSON.parse(text + decoder.decode());
}
