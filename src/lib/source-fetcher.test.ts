import { describe, expect, it } from "vitest";
import { captureSource } from "./source-fetcher";

const publicResolver = async (): Promise<readonly string[]> => [
  "93.184.216.34",
];

describe("captureSource", () => {
  it("returns an unsafe destination failure when DNS resolves to a private address", async () => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      { resolveHostname: async () => ["127.0.0.1"] },
    );

    expect(result).toEqual({ kind: "failure", code: "unsafe_destination" });
  });

  it("returns an unsafe destination failure for an IPv4-mapped loopback address", async () => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      { resolveHostname: async () => ["::ffff:127.0.0.1"] },
    );

    expect(result).toEqual({ kind: "failure", code: "unsafe_destination" });
  });

  it("returns a response size failure when the response exceeds the byte limit", async () => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        resolveHostname: publicResolver,
        fetch: async () =>
          new Response("x", {
            headers: { "content-length": String(256 * 1024 + 1) },
          }),
      },
    );

    expect(result).toEqual({ kind: "failure", code: "response_too_large" });
  });

  it("returns visible HTML text and its SHA-256 hash", async () => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        resolveHostname: publicResolver,
        fetch: async () =>
          new Response(
            "<script>hidden()</script><p>Crude protein 37%</p><span hidden>nope</span>",
            { headers: { "content-type": "text/html" } },
          ),
      },
    );

    expect(result).toMatchObject({
      kind: "success",
      capturedText: "Crude protein 37%",
    });
    if (result.kind === "success") {
      expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
