import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * docs/plans/2026-07-16-source-first-catalog-collection.md Task 6이 요구한 회귀 가드.
 *
 * 자율 웹 수집 경로는 6a155fb에서 제거됐다. 수집은 큐레이터가 승인한 URL에서만
 * 출발해야 하며, 모델이 스스로 출처를 찾아 나서면 근거 추적성이 무너진다.
 * 제거만으로는 되살아나는 것을 막지 못하므로 여기서 고정한다.
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
  it("자율 수집 스크립트가 다시 존재하지 않는다", () => {
    const scripts = (() => {
      try {
        return readdirSync(join(ROOT, "scripts"));
      } catch {
        return [];
      }
    })();

    expect(scripts).not.toContain("research-enrich.mjs");
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
