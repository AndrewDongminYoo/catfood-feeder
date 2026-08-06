import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/plans/2026-07-16-source-first-catalog-collection.md Task 6이 요구한 회귀 가드.
 * docs/notes/2026-08-05-ai-native-catalog-turnaround.md의 전환에 맞춰 재조정됐다.
 *
 * 원래 이 가드는 "URL은 사람만 제안한다"를 지켰다. 전환 이후 URL 제안은 로컬 조사
 * 에이전트도 할 수 있다 — 단 broker를 통해서만이고, 서버가 그 URL을 직접 재수집해
 * 근거를 다시 검증한다. 그래서 지금 지켜야 할 불변식은 둘로 좁혀진다.
 *
 * 1. 앱 서버는 스스로 웹을 뒤지지 않는다. 조사는 서버 바깥의 로컬 에이전트 몫이고,
 *    서버는 명시된 URL을 수집·검증하는 쪽에 남는다.
 * 2. 조사 러너는 데이터베이스에 직접 닿지 않는다. broker의 좁은 HTTP 경계만 쓴다.
 */
const ROOT = join(import.meta.dirname, "..", "..");

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extensions);
    return extensions.some((ext) => entry.name.endsWith(ext)) ? [path] : [];
  });
}

/** 테스트 자신을 스캔 대상에서 뺀다 — 가드 문구가 위반으로 잡히면 안 된다. */
function productionSources(): string[] {
  const sources = filesUnder(join(ROOT, "src"), [".ts", ".tsx"]).filter(
    (path) => !/\.test\.tsx?$/.test(path),
  );
  // 스캔이 비면 "위반 없음"이 공허해진다.
  expect(sources.length).toBeGreaterThan(0);
  return sources;
}

describe("source-first 경계", () => {
  it("조사 러너가 데이터베이스에 직접 닿지 않는다", () => {
    const runner = readFileSync(
      join(ROOT, "scripts", "research-run.mjs"),
      "utf8",
    );

    // 산문이 아니라 실제 접근 수단만 본다 — import, 클라이언트 팩토리, 키 이름.
    expect(runner).not.toMatch(
      /@supabase\/|createAdminClient|SUPABASE_[A-Z_]+|SERVICE_ROLE/,
    );
    expect(runner).toContain("/api/research/proposals");
  });

  it("수집·추출 모듈이 web_search 도구를 쓰지 않는다", () => {
    const offenders = productionSources().filter((path) =>
      /web_search|"tools"\s*:/.test(readFileSync(path, "utf8")),
    );

    expect(offenders).toEqual([]);
  });

  it("Anthropic 요청은 source-extraction 한 곳에서만 나간다", () => {
    const callers = productionSources()
      .filter((path) =>
        readFileSync(path, "utf8").includes("api.anthropic.com"),
      )
      .map((path) => path.slice(ROOT.length + 1));

    expect(callers).toEqual(["src/lib/source-extraction.ts"]);
  });
});
