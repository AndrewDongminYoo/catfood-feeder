import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig의 @/* → src/* 를 그대로 반영한다. 없으면 @/ 를 쓰는 모듈이
  // 테스트에서만 해석에 실패한다.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // 프로젝트 테스트만 수집한다. 기본값은 .trunk 아래 벤더 플러그인 테스트까지 쓸어담아 실패한다.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
