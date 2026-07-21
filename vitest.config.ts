import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 프로젝트 테스트만 수집한다. 기본값은 .trunk 아래 벤더 플러그인 테스트까지 쓸어담아 실패한다.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
