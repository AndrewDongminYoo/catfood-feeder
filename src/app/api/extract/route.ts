import { NextRequest, NextResponse } from "next/server";
import {
  detectSourceConflicts,
  parseManufacturerEnergy,
  parseKcal,
} from "@/lib/domain";

// 서버에서만 Claude 호출 — API 키 비노출.
// 환경변수: ANTHROPIC_API_KEY
export const runtime = "nodejs";

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
  try {
    const { manufacturerText = "", krLabelText = "" } = await req.json();
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
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [
          { role: "user", content: buildPrompt(manufacturerText, krLabelText) },
        ],
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: `Claude API ${res.status}: ${t.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const text = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");
    const clean = text.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return NextResponse.json(
        { error: "JSON 파싱 실패", raw: clean.slice(0, 500) },
        { status: 502 },
      );
    }

    // 제조사 원문에서 P/F/C 열량비·kcal 직접 추출 (정규식, LLM 비의존)
    const mfgEnergy = parseManufacturerEnergy(manufacturerText);
    const mfgKcal = parseKcal(manufacturerText);
    const conflicts = detectSourceConflicts(manufacturerText, krLabelText);

    return NextResponse.json({ parsed, mfgEnergy, mfgKcal, conflicts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
