import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  curateSource,
  getBrokerBaseUrl,
} from "../../scripts/curate-source.mjs";
import { loadSecrets } from "../../scripts/with-secrets.mjs";

const initialization = vi.hoisted(() => ({ stopAfterResolution: false }));
const fixtures = vi.hoisted(() => ({ messages: [] as unknown[] }));
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async () => "/fixture-workdir"),
  readFile: vi.fn(async () => JSON.stringify(fixtures.messages.shift())),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}));
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stdin: { end: vi.fn() },
      });
      queueMicrotask(() => {
        child.stdout.emit("data", "pixelHeight: 600\npixelWidth: 600");
        child.emit("close", 0);
      });
      return child;
    }),
  };
});
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      const food = {
        id: 95,
        product_name: "Fixture",
        carb_pct: null,
        moisture_pct: null,
        fat_pct: 10,
        fiber_pct: 3,
        ash_pct: 7,
      };
      const query = {
        select: () => query,
        eq: () => query,
        is: () => query,
        not: () => query,
        in: () => query,
        order: () => query,
        range: () => query,
        maybeSingle: async () => ({ data: food }),
        then: (done: (value: unknown) => unknown) =>
          Promise.resolve({
            data: table === "foods" ? [food] : [],
            error: null,
          }).then(done),
      };
      return query;
    },
  })),
}));
vi.mock("./image-fetcher.ts", () => ({
  captureImage: vi.fn(async () => ({
    kind: "success",
    contentType: "image/jpeg",
    bytes: Buffer.from("fixture"),
    contentHash: "fixture-hash",
  })),
}));
vi.mock("../../scripts/research-run.mjs", () => ({
  PROMPT_VERSION: "1",
  SCHEMA_VERSION: "1",
  buildAgentEnv: vi.fn(() => ({})),
  buildCodexArgs: vi.fn(() => []),
  buildVisionCodexArgs: vi.fn(() => []),
  createResearchWorkdir: vi.fn(async () => "/fixture-workdir"),
  persistRefreshedCodexAuth: vi.fn(async () => undefined),
  stageCodexExecutable: vi.fn(async () => undefined),
  stageCodexHome: vi.fn(async () => ({})),
}));
vi.mock("../../scripts/with-secrets.mjs", () => ({
  SECRETS_FILE: "fixture-only",
  loadSecrets: vi.fn(),
}));
vi.mock("../../scripts/curate-source.mjs", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../scripts/curate-source.mjs")>();
  return {
    ...original,
    getBrokerBaseUrl: vi.fn(() => {
      const destination = original.getBrokerBaseUrl();
      if (initialization.stopAfterResolution)
        throw new Error(`resolved:${destination}`);
      return destination;
    }),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  initialization.stopAfterResolution = false;
  fixtures.messages = [];
});

it.each([undefined, "", "   "])(
  "defaults missing or blank configuration (%s)",
  (value) => {
    vi.stubEnv("RESEARCH_BROKER_URL", value);
    expect(getBrokerBaseUrl()).toBe("http://localhost:3000");
  },
);

it("preserves an explicit environment value over the environment file", () => {
  vi.stubEnv("RESEARCH_BROKER_URL", "https://environment.example.test/");
  const directory = mkdtempSync(join(tmpdir(), "broker-config-"));
  try {
    const fixture = join(directory, "env");
    writeFileSync(fixture, "RESEARCH_BROKER_URL=https://file.example.test\n");
    process.loadEnvFile(fixture);
    expect(getBrokerBaseUrl()).toBe("https://environment.example.test");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each([
  "not-a-url",
  "https:broker.example.test",
  "https://broker.example.test\\other",
  "ftp://broker.example.test",
  "https://user:password@broker.example.test",
  "https://broker.example.test/prefix",
  "https://broker.example.test?token=secret",
  "https://broker.example.test#fragment",
  "https://broker.example.test?",
  "https://broker.example.test#",
  "https://broker.example.test/prefix/..",
])(
  "rejects invalid explicit configuration before curation fetch (%s)",
  async (value) => {
    vi.stubEnv("RESEARCH_BROKER_URL", value);
    const fetchStub = vi.fn();
    vi.stubGlobal("fetch", fetchStub);
    await expect(
      curateSource({
        foodId: 95,
        url: "https://manufacturer.example.test",
        secret: "fixture-secret",
      }),
    ).rejects.toEqual(
      new Error("RESEARCH_BROKER_URL must be an HTTP(S) origin."),
    );
    expect(fetchStub).not.toHaveBeenCalled();
  },
);

for (const entrypoint of [
  "curate-brand",
  "research-brand",
  "transcribe-brand",
  "research-missing",
]) {
  it.each([
    ["https://loaded.example.test/", "resolved:https://loaded.example.test"],
    [undefined, "resolved:http://localhost:3000"],
    ["", "resolved:http://localhost:3000"],
    ["invalid", "RESEARCH_BROKER_URL must be an HTTP(S) origin."],
  ])(
    `${entrypoint} resolves loaded configuration before other work (%s)`,
    async (value, expected) => {
      vi.resetModules();
      vi.stubEnv("RESEARCH_BROKER_URL", "https://before-load.example.test");
      vi.mocked(loadSecrets).mockImplementation(() => {
        vi.stubEnv("RESEARCH_BROKER_URL", value);
        return true;
      });
      initialization.stopAfterResolution = true;
      const fetchStub = vi.fn();
      vi.stubGlobal("fetch", fetchStub);
      await expect(import(`../../scripts/${entrypoint}.mjs`)).rejects.toThrow(
        expected,
      );
      expect(loadSecrets).toHaveBeenCalledOnce();
      expect(getBrokerBaseUrl).toHaveBeenCalledOnce();
      expect(vi.mocked(loadSecrets).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(getBrokerBaseUrl).mock.invocationCallOrder[0],
      );
      expect(fetchStub).not.toHaveBeenCalled();
    },
  );
}

it.each(["curate-brand", "research-brand"])(
  "%s sends its first authenticated request to the loaded broker",
  async (entrypoint) => {
    vi.resetModules();
    vi.mocked(loadSecrets).mockImplementation(() => {
      vi.stubEnv("RESEARCH_BROKER_URL", "https://loaded.example.test/");
      return true;
    });
    vi.stubEnv("ADMIN_WRITE_SECRET", "fixture-admin");
    vi.stubEnv("RESEARCH_AGENT_SECRET", "fixture-agent");
    const originalArgs = process.argv;
    process.argv = [process.execPath, "fixture.mjs", "--brand", "fixture"];
    const fetchStub = vi
      .fn()
      .mockRejectedValue(new Error("fixture request reached"));
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(import(`../../scripts/${entrypoint}.mjs`)).rejects.toThrow(
        "fixture request reached",
      );
      expect(fetchStub).toHaveBeenCalledOnce();
      expect(fetchStub.mock.calls[0][0]).toBe(
        "https://loaded.example.test/api/foods/drafts",
      );
      expect(fetchStub.mock.calls[0][1].headers["x-admin-secret"]).toBe(
        "fixture-admin",
      );
    } finally {
      process.argv = originalArgs;
    }
  },
);

it.each(["transcribe-brand", "research-missing"])(
  "%s reaches its authenticated submission with fixture dependencies",
  async (entrypoint) => {
    vi.resetModules();
    vi.mocked(loadSecrets).mockImplementation(() => {
      vi.stubEnv("RESEARCH_BROKER_URL", "https://loaded.example.test/");
      return true;
    });
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://database.example.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "fixture-database");
    vi.stubEnv("ADMIN_WRITE_SECRET", "fixture-admin");
    vi.stubEnv("RESEARCH_AGENT_SECRET", "fixture-agent");
    const evidence = {
      excerpt: "moisture 8%",
      nutrientKey: "moisture_pct",
      value: 8,
    };
    fixtures.messages =
      entrypoint === "transcribe-brand"
        ? [
            {
              slices: [
                { slice: "95-0-t01-small.jpg", holds: ["guaranteed_analysis"] },
              ],
            },
            { transcript: "moisture 8%", values: [evidence], ingredients: [] },
          ]
        : [
            {
              products: [
                {
                  foodId: 95,
                  url: "https://manufacturer.example.test",
                  kind: "manufacturer",
                  evidence: [evidence],
                },
              ],
            },
          ];
    const originalArgs = process.argv;
    process.argv = [
      process.execPath,
      "fixture.mjs",
      "--food",
      "95",
      "--image",
      "https://image.example.test/label.jpg",
    ];
    const fetchStub = vi
      .fn()
      .mockImplementation(async (destination: string) => ({
        ok: true,
        json: async () =>
          destination.endsWith("/sources")
            ? { source: { id: 7 } }
            : { results: [{ status: "applied" }] },
      }));
    vi.stubGlobal("fetch", fetchStub);
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await import(`../../scripts/${entrypoint}.mjs`);
      expect(fixtures.messages).toEqual([]);
      expect(fetchStub).toHaveBeenCalledTimes(
        entrypoint === "transcribe-brand" ? 1 : 2,
      );
      for (const [destination, options] of fetchStub.mock.calls) {
        expect(new URL(destination).origin).toBe("https://loaded.example.test");
        expect(
          options.headers[
            entrypoint === "transcribe-brand"
              ? "x-research-agent-secret"
              : "x-admin-secret"
          ],
        ).toBe(
          entrypoint === "transcribe-brand" ? "fixture-agent" : "fixture-admin",
        );
      }
      expect(fetchStub.mock.calls.at(-1)?.[0]).toBe(
        `https://loaded.example.test${entrypoint === "transcribe-brand" ? "/api/research/transcripts" : "/api/foods/95/sources/apply"}`,
      );
    } finally {
      process.argv = originalArgs;
      output.mockRestore();
    }
  },
);

it("loads configuration through the curate-source CLI before sending credentials", async () => {
  vi.resetModules();
  vi.stubEnv("RESEARCH_BROKER_URL", "https://before-load.example.test");
  vi.mocked(loadSecrets).mockImplementation(() => {
    vi.stubEnv("RESEARCH_BROKER_URL", "https://cli-loaded.example.test/");
    return true;
  });
  vi.stubEnv("ADMIN_WRITE_SECRET", "fixture-admin");
  const originalArgs = process.argv;
  process.argv = [
    process.execPath,
    resolve("scripts/curate-source.mjs"),
    "--food",
    "95",
    "--url",
    "https://manufacturer.example.test",
  ];
  const payloads = [
    { source: { id: 7 } },
    {
      candidates: [
        {
          excerpt: "moisture 8%",
          nutrientKey: "moisture_pct",
          value: 8,
          sourceId: 7,
        },
      ],
    },
    { results: [{ status: "applied" }] },
  ];
  const fetchStub = vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => payloads.shift(),
  }));
  vi.stubGlobal("fetch", fetchStub);
  const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    await vi.importActual("../../scripts/curate-source.mjs");
    expect(loadSecrets).toHaveBeenCalledOnce();
    expect(fetchStub).toHaveBeenCalledTimes(3);
    for (const [destination, options] of fetchStub.mock.calls) {
      expect(new URL(destination).origin).toBe(
        "https://cli-loaded.example.test",
      );
      expect(options.headers["x-admin-secret"]).toBe("fixture-admin");
    }
  } finally {
    process.argv = originalArgs;
    output.mockRestore();
  }
});

it("uses a broker loaded from a file after module import for every curation request", async () => {
  vi.stubEnv("RESEARCH_BROKER_URL", undefined);
  const directory = mkdtempSync(join(tmpdir(), "broker-config-"));
  try {
    const fixture = join(directory, "env");
    writeFileSync(
      fixture,
      "RESEARCH_BROKER_URL=https://file-broker.example.test\n",
    );
    process.loadEnvFile(fixture);
    const payloads = [
      { source: { id: 7 } },
      {
        candidates: [
          {
            excerpt: "protein 30%",
            nutrientKey: "protein_pct",
            sourceId: 7,
            value: 30,
          },
        ],
      },
      { results: [{ status: "applied" }] },
    ];
    const fetchStub = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => payloads.shift(),
    }));
    vi.stubGlobal("fetch", fetchStub);
    await expect(
      curateSource({
        foodId: 95,
        url: "https://manufacturer.example.test",
        secret: "fixture-secret",
      }),
    ).resolves.toMatchObject({ applied: 1 });
    expect(fetchStub).toHaveBeenCalledTimes(3);
    for (const [destination, options] of fetchStub.mock.calls) {
      expect(new URL(destination).origin).toBe(
        "https://file-broker.example.test",
      );
      expect(options.headers["x-admin-secret"]).toBe("fixture-secret");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
