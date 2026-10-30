import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 보안 권고 하한 가드.
 *
 * fast-uri는 package.json에 직접 선언하지 않는 전이 의존성이다.
 * 전이 의존성 범위가 바뀌거나 lockfile이 재생성되면서 해상도가 하한 아래로
 * 내려가도 설치는 성공하므로,
 * "무엇이 실제로 잠겼는지"를 lockfile에서 직접 읽어 여기서 고정한다.
 *
 * major 단위로 범위를 잡는다. 하나의 권고가 여러
 * major를 덮더라도 패치 버전은 major마다 다르기 때문이다.
 */
const LOCKFILE = join(import.meta.dirname, "..", "..", "pnpm-lock.yaml");

interface SecurityFloor {
  /** lockfile에 기록되는 패키지 이름. */
  name: string;
  /** 이 하한이 적용되는 major. 다른 major는 자기 권고를 따른다. */
  major: number;
  /** 권고가 명시한 최초 패치 버전. */
  floor: string;
  /**
   * 이 하한을 요구하는 권고들. 하한이 깨졌을 때 실패 메시지에 실린다.
   *
   * 같은 버전 하한이 더 낮은 하한을 요구하는 다른 권고도 함께 막을 수 있으므로,
   * 제거 판단은 실제 의존성 그래프와 해당 major의 권고 전체를 보고 한다.
   */
  advisories: string[];
}

const SECURITY_FLOORS: SecurityFloor[] = [
  {
    name: "fast-uri",
    major: 3,
    floor: "3.1.6",
    advisories: [
      "GHSA-5jgf-p345-68v8",
      "GHSA-f65p-4m7j-42xc",
      "GHSA-fph4-wmhf-6fwf",
      "GHSA-jqff-g426-hqxp",
    ],
  },
];

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`버전 파싱 실패: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isBelow(version: string, floor: string): boolean {
  const left = parseVersion(version);
  const right = parseVersion(floor);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index];
  }
  return false;
}

/**
 * lockfile이 잠근 버전들을 읽는다.
 *
 * 상단 `overrides:` 블록에도 같은 이름이 나오므로 `packages:` 이후만 훑는다.
 * 그 블록을 함께 읽으면 override에 적어둔 하한을 설치 결과로 오인해
 * 조용히 초록이 되는 검사가 된다.
 */
function lockedVersions(name: string): string[] {
  const lockfile = readFileSync(LOCKFILE, "utf8");
  const packagesAt = lockfile.indexOf("\npackages:\n");
  expect(packagesAt, "pnpm-lock.yaml에 packages 섹션이 없다").toBeGreaterThan(
    -1,
  );

  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const entry = new RegExp(
    String.raw`^ {2}${escaped}@(\d+\.\d+\.\d+[^:(\s]*)[(:]`,
    "gm",
  );
  return [...lockfile.slice(packagesAt).matchAll(entry)].map(
    (match) => match[1],
  );
}

describe("전이 의존성 보안 하한", () => {
  for (const { name, major, floor, advisories } of SECURITY_FLOORS) {
    it(`${name}@${major}는 ${floor} 이상으로 잠긴다`, () => {
      const versions = lockedVersions(name).filter(
        (version) => parseVersion(version)[0] === major,
      );

      // 매치가 0건이면 아래 검사가 공허하게 통과한다.
      expect(
        versions,
        `pnpm-lock.yaml에 ${name}@${major}이 없다 — 정규식이나 override가 바뀌었다`,
      ).not.toHaveLength(0);

      const vulnerable = versions.filter((version) => isBelow(version, floor));
      expect(
        vulnerable,
        `${name}@${major}이 ${floor} 미만으로 잠겼다 (${advisories.join(", ")})`,
      ).toEqual([]);
    });
  }
});
