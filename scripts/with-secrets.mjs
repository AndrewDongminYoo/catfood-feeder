#!/usr/bin/env node
// 저장소 밖 비밀 파일을 읽어 환경에 얹고 나머지 인자를 그대로 실행한다.
//
// `node --env-file=...`을 직접 쓸 수 없다: Next는 빌드/개발 중 Worker를 띄우면서
// 부모의 execArgv를 NODE_OPTIONS로 전파하는데, `--env-file*`은 NODE_OPTIONS에서
// 금지돼 ERR_WORKER_INVALID_EXEC_ARGV로 죽는다. process.loadEnvFile은 플래그가
// 아니라 런타임 호출이라 execArgv를 건드리지 않는다.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 비밀은 저장소 안에 두지 않는다 — scripts/README.md의 "Where credentials live" 참고. */
export const SECRETS_FILE = join(homedir(), ".config", "catfood-feeder", "env");

/** 자식이 종료 신호를 무시할 때 SIGKILL로 올리기까지의 유예. 테스트가 낮춘다. */
const KILL_GRACE_MS = Number(process.env.CATFOOD_KILL_GRACE_MS ?? 5000);

/** Vercel처럼 플랫폼이 환경변수를 직접 주는 곳에는 이 파일이 없다. 없으면 그냥 넘어간다. */
export function loadSecrets() {
  if (!existsSync(SECRETS_FILE)) return false;
  process.loadEnvFile(SECRETS_FILE);
  return true;
}

// 직접 실행됐을 때만 자식을 띄운다 — research-run.mjs는 loadSecrets만 가져다 쓴다.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error("usage: node scripts/with-secrets.mjs <command> [args...]");
    process.exit(1);
  }
  loadSecrets();
  const child = spawn(command, args, { env: process.env, stdio: "inherit" });
  child.on("error", (error) => {
    console.error(`with-secrets: cannot run ${command}: ${error.message}`);
    process.exit(1);
  });

  // 종료 신호를 자식에게 넘긴다. 넘기지 않으면 프로세스 매니저가 이 래퍼 PID에
  // SIGTERM을 보냈을 때 래퍼만 죽고 next는 살아남아 포트를 쥔 채 고아가 된다.
  // (Ctrl-C는 포그라운드 프로세스 그룹 전체에 가므로 그 경로에서는 안 드러난다.)
  //
  // 핸들러를 등록하는 순간 Node의 기본 종료 처리가 사라지므로, 자식이 신호를
  // 무시하면 둘 다 안 죽는다 — 고아가 hang으로 바뀔 뿐이다. 유예 시간 뒤에
  // SIGKILL로 올려서 래퍼가 반드시 끝나게 한다.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      child.kill(signal);
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    });
  }

  child.on("exit", (code, signal) => {
    if (signal === null) process.exit(code ?? 1);
    // 신호로 죽었으면 같은 신호를 스스로에게 다시 보낸다. exit(1)로 뭉개면
    // 정상 종료(143)가 슈퍼바이저에게 크래시로 읽혀 재시작 루프를 부른다.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
  });
}
