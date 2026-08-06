import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 로컬 조사 에이전트 자격 증명의 봉쇄 가드.
 *
 * RESEARCH_AGENT_SECRET은 research broker 하나만 열 수 있다. 기존 관리자·발행
 * 경계가 이 비밀을 인정하기 시작하면 "발행은 사람만"이라는 불변식이 조용히
 * 무너지므로, 제거가 아니라 여기서 고정한다.
 */
const ROOT = join(import.meta.dirname, "..", "..");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

function productionSources(): string[] {
  const sources = filesUnder(join(ROOT, "src"));
  // 스캔이 비면 "위반 없음"이 공허해진다.
  expect(sources.length).toBeGreaterThan(0);
  return sources;
}

function relative(path: string): string {
  return path.slice(ROOT.length + 1);
}

describe("research agent 자격 증명 경계", () => {
  it("RESEARCH_AGENT_SECRET은 research-auth 모듈에서만 읽는다", () => {
    const readers = productionSources()
      .filter((path) =>
        readFileSync(path, "utf8").includes("RESEARCH_AGENT_SECRET"),
      )
      .map(relative);

    expect(readers).toEqual(["src/lib/research-auth.ts"]);
  });

  it("관리자·발행 경계는 조사 에이전트 인증을 가져오지 않는다", () => {
    const offenders = productionSources()
      .filter((path) => relative(path).startsWith("src/app/api/foods/"))
      .filter((path) => readFileSync(path, "utf8").includes("research-auth"))
      .map(relative);

    expect(offenders).toEqual([]);
  });

  it("research broker는 관리자 자격 증명을 인정하지 않는다", () => {
    const brokerRoutes = productionSources().filter((path) =>
      relative(path).startsWith("src/app/api/research/"),
    );
    expect(brokerRoutes.length).toBeGreaterThan(0);

    const offenders = brokerRoutes
      .filter((path) =>
        /authorizeCurator|ADMIN_WRITE_SECRET/.test(readFileSync(path, "utf8")),
      )
      .map(relative);

    expect(offenders).toEqual([]);
  });
});
