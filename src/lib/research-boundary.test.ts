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

  // 큐레이터 경로(출처 등록·추출·적용)는 운영자 자동화에 열려 있지만 발행은 아니다.
  // 턴어라운드 문서의 사람 게이트는 "발행" 한 곳뿐이고, 나머지를 열어 손작업을 없앤
  // 변경이 이 마지막 한 곳까지 같이 열어버리는 것이 가장 조용한 실패다.
  it("발행 경로는 자동화 자격 증명을 계속 거부한다", () => {
    const publishRoute = readFileSync(
      join(ROOT, "src/app/api/foods/[id]/publish/route.ts"),
      "utf8",
    );

    expect(publishRoute).toContain('authorization.origin === "automation"');
    expect(publishRoute).toContain("발행할 수 없습니다");
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

/**
 * 조사 러너가 띄우는 codex 자식은 read-only 샌드박스에서 돌지만, read-only는 쓰기만
 * 막고 읽기는 파일시스템 전역에 열려 있다. 프롬프트 인젝션을 따르는 에이전트가
 * 가장 먼저 뒤지는 곳이 저장소 루트의 dotenv 파일이므로, 비밀 자체를 저장소 밖에
 * 둔다. 경계가 아니라 노출면 축소다 — 진짜 경계는 별도 OS 계정이나 컨테이너다.
 */
describe("저장소 밖 비밀 파일 경계", () => {
  /** 저장소 루트 기준 dotenv 경로. `.env.example`은 값이 없는 템플릿이라 제외한다. */
  const IN_REPO_DOTENV =
    /(^|[\s"'=/])\.?\/?\.env(\.local|\.production|\b)(?!\.example|\.sample)/;

  it("어떤 pnpm 스크립트도 저장소 안 dotenv 파일을 읽지 않는다", () => {
    const scripts: Record<string, string> = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ).scripts;

    expect(Object.keys(scripts).length).toBeGreaterThan(0);
    expect(
      Object.entries(scripts)
        .filter(([, command]) => IN_REPO_DOTENV.test(command))
        .map(([name]) => name),
    ).toEqual([]);
  });

  it("스크립트 파일도 저장소 안 dotenv를 읽지 않는다", () => {
    const scriptFiles = readdirSync(join(ROOT, "scripts")).filter((name) =>
      name.endsWith(".mjs"),
    );

    expect(scriptFiles.length).toBeGreaterThan(0);
    expect(
      scriptFiles.filter((name) =>
        IN_REPO_DOTENV.test(readFileSync(join(ROOT, "scripts", name), "utf8")),
      ),
    ).toEqual([]);
  });

  it("비밀 파일 경로는 홈 디렉터리 아래에 있다", () => {
    const wrapper = readFileSync(
      join(ROOT, "scripts", "with-secrets.mjs"),
      "utf8",
    );

    expect(wrapper).toContain("homedir()");
    expect(wrapper).toContain('".config", "catfood-feeder", "env"');
  });
});
