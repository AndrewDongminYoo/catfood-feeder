import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getResearchConfig } from "../../scripts/research-run.mjs";

function runUntilBroker(settings: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "research-config-test-"));
  const preload = `globalThis.fetch = (url) => {
    console.log("BROKER_REQUEST " + url);
    process.exit(42);
  };`;
  try {
    return spawnSync(
      process.execPath,
      [
        "--import",
        `data:text/javascript,${encodeURIComponent(preload)}`,
        resolve("scripts/research-run.mjs"),
        "--food",
        "123",
      ],
      {
        encoding: "utf8",
        env: {
          HOME: home,
          NODE_ENV: "test",
          PATH: "",
          RESEARCH_AGENT_SECRET: "synthetic-test-secret",
          ...settings,
        },
        timeout: 5000,
      },
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("research runner configuration boundary", () => {
  it.each(["", " \t "])(
    "uses the default broker for blank value %j",
    (value) => {
      const result = runUntilBroker({ RESEARCH_BROKER_URL: value });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(42);
      expect(result.stdout).toContain(
        "BROKER_REQUEST http://localhost:3000/api/research/foods/123",
      );
    },
  );

  it("rejects an invalid model before any broker request", () => {
    const result = runUntilBroker({ RESEARCH_AGENT_MODEL: "invalid model" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RESEARCH_AGENT_MODEL");
    expect(result.stderr).not.toContain("invalid model");
    expect(result.stdout).not.toContain("BROKER_REQUEST");
  });

  it("rejects an invalid broker before any request without exposing credentials", () => {
    const result = runUntilBroker({
      RESEARCH_BROKER_URL: "https://user:private-value@broker.example.test",
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("RESEARCH_BROKER_URL");
    expect(result.stderr).not.toContain("private-value");
    expect(result.stdout).not.toContain("BROKER_REQUEST");
  });
});

describe("research runner settings parser", () => {
  it.each([undefined, "", " \t\n "])(
    "uses defaults for missing or blank settings %j",
    (value) => {
      expect(
        getResearchConfig({
          RESEARCH_BROKER_URL: value,
          RESEARCH_AGENT_MODEL: value,
        }),
      ).toEqual({
        brokerUrl: "http://localhost:3000",
        model: "gpt-5.6-terra",
      });
    },
  );

  it("trims explicit settings and normalizes the broker origin", () => {
    expect(
      getResearchConfig({
        RESEARCH_BROKER_URL: " https://broker.example.test/ ",
        RESEARCH_AGENT_MODEL: " provider/model-alias:1.0 ",
      }),
    ).toEqual({
      brokerUrl: "https://broker.example.test",
      model: "provider/model-alias:1.0",
    });
  });

  it.each([
    "not-a-url",
    "file:///tmp/broker",
    "https://broker.example.test/prefix",
    "https://broker.example.test/?key=private-value",
    "https://broker.example.test/#private-value",
    "https://user:private-value@broker.example.test",
  ])("rejects a malformed broker without echoing it: %j", (value) => {
    expect(() => getResearchConfig({ RESEARCH_BROKER_URL: value })).toThrow(
      /^RESEARCH_BROKER_URL must be an HTTP\(S\) origin\.$/,
    );
  });

  it.each(["invalid model", "-flag", "model\nother", '{"model":"x"}'])(
    "rejects a malformed model without echoing it: %j",
    (value) => {
      expect(() => getResearchConfig({ RESEARCH_AGENT_MODEL: value })).toThrow(
        /^RESEARCH_AGENT_MODEL must be a model identifier\.$/,
      );
    },
  );
});
