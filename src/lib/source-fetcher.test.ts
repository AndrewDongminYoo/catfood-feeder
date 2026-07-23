import { describe, expect, it, vi } from "vitest";
import { MockAgent } from "undici";
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

  it("pins the validated DNS address to the outbound request", async () => {
    const dispatcher = new MockAgent();
    const createDispatcher = vi.fn(() => dispatcher);
    const fetchSource = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init).toMatchObject({ dispatcher });
        return new Response("Crude protein 37%", {
          headers: { "content-type": "text/plain" },
        });
      },
    );

    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        createDispatcher,
        fetch: fetchSource as typeof globalThis.fetch,
        resolveHostname: publicResolver,
      },
    );

    expect(result).toMatchObject({ kind: "success" });
    expect(createDispatcher).toHaveBeenCalledWith("example.test", [
      "93.184.216.34",
    ]);
  });

  it("cancels a redirect body before closing its dispatcher", async () => {
    let bodyCanceled = false;
    const firstDispatcher = new MockAgent();
    const secondDispatcher = new MockAgent();
    const closeFirstDispatcher = vi
      .spyOn(firstDispatcher, "close")
      .mockImplementation(async () => {
        expect(bodyCanceled).toBe(true);
      });
    const closeSecondDispatcher = vi.spyOn(secondDispatcher, "close");
    const createDispatcher = vi
      .fn()
      .mockReturnValueOnce(firstDispatcher)
      .mockReturnValueOnce(secondDispatcher);
    const fetchSource = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            cancel() {
              bodyCanceled = true;
            },
          }),
          {
            headers: { location: "https://next.example.test" },
            status: 302,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response("Crude protein 37%", {
          headers: { "content-type": "text/plain" },
        }),
      );

    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        createDispatcher,
        fetch: fetchSource as typeof globalThis.fetch,
        resolveHostname: publicResolver,
      },
    );

    expect(result).toMatchObject({ kind: "success" });
    expect(closeFirstDispatcher).toHaveBeenCalledOnce();
    expect(closeSecondDispatcher).toHaveBeenCalledOnce();
  });

  it("cancels a retryable response body before retrying", async () => {
    let bodyCanceled = false;
    const fetchSource = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            cancel() {
              bodyCanceled = true;
            },
          }),
          { status: 500 },
        ),
      )
      .mockImplementationOnce(async () => {
        expect(bodyCanceled).toBe(true);
        return new Response("Crude protein 37%", {
          headers: { "content-type": "text/plain" },
        });
      });

    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        createDispatcher: () => new MockAgent(),
        fetch: fetchSource as typeof globalThis.fetch,
        resolveHostname: publicResolver,
      },
    );

    expect(result).toMatchObject({ kind: "success" });
  });

  it("cancels an oversized response body before closing its dispatcher", async () => {
    let bodyCanceled = false;
    const dispatcher = new MockAgent();
    const closeDispatcher = vi
      .spyOn(dispatcher, "close")
      .mockImplementation(async () => {
        expect(bodyCanceled).toBe(true);
      });

    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        createDispatcher: () => dispatcher,
        fetch: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                bodyCanceled = true;
              },
            }),
            {
              headers: {
                "content-length": String(256 * 1024 + 1),
                "content-type": "text/plain",
              },
            },
          ),
        resolveHostname: publicResolver,
      },
    );

    expect(result).toEqual({ kind: "failure", code: "response_too_large" });
    expect(closeDispatcher).toHaveBeenCalledOnce();
  });

  it("returns an unsafe destination failure for an IPv4-mapped loopback address", async () => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      { resolveHostname: async () => ["::ffff:127.0.0.1"] },
    );

    expect(result).toEqual({ kind: "failure", code: "unsafe_destination" });
  });

  // IPv4를 품는 IPv6 형식들. 환원 검사를 빠뜨리면 전부 공인 주소로 통과한다.
  it.each([
    ["6to4", "2002:7f00:0001::"],
    ["6to4 사설 대역", "2002:c0a8:0001::"],
    ["NAT64", "64:ff9b::7f00:1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["IPv4-compatible", "::127.0.0.1"],
    ["IPv4-translatable", "::ffff:0:127.0.0.1"],
    ["link-local", "fe80::1"],
    ["unique-local", "fd00::1"],
    ["loopback", "::1"],
  ])("%s 주소를 unsafe로 거부한다: %s", async (_label, address) => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        fetch: async () =>
          new Response("Crude protein 37%", {
            headers: { "content-type": "text/plain" },
          }),
        resolveHostname: async () => [address],
      },
    );

    expect(result).toEqual({ kind: "failure", code: "unsafe_destination" });
  });

  it.each([
    ["IPv4 benchmark", "198.18.0.1"],
    ["IPv4 documentation", "192.0.2.1"],
    ["IPv4 documentation", "198.51.100.1"],
    ["IPv4 documentation", "203.0.113.1"],
    ["IPv6 site-local", "fec0::1"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv6 dummy", "100:0:0:1::1"],
    ["IPv6 segment-routing SID", "5f00::1"],
  ])("%s 주소를 unsafe로 거부한다: %s", async (_label, address) => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        fetch: async () =>
          new Response("Crude protein 37%", {
            headers: { "content-type": "text/plain" },
          }),
        resolveHostname: async () => [address],
      },
    );

    expect(result).toEqual({ kind: "failure", code: "unsafe_destination" });
  });

  it("공인 IPv6 주소는 통과시킨다", async () => {
    const result = await captureSource(
      { url: "https://example.test", kind: "manufacturer" },
      {
        resolveHostname: async () => ["2606:2800:220:1:248:1893:25c8:1946"],
        fetch: async () =>
          new Response("Crude protein 37%", {
            headers: { "content-type": "text/plain" },
          }),
      },
    );

    expect(result).toMatchObject({ kind: "success" });
  });

  it.each(["192.0.1.1", "2001:3::1"])(
    "공인 주소는 통과시킨다: %s",
    async (address) => {
      const result = await captureSource(
        { url: "https://example.test", kind: "manufacturer" },
        {
          resolveHostname: async () => [address],
          fetch: async () =>
            new Response("Crude protein 37%", {
              headers: { "content-type": "text/plain" },
            }),
        },
      );

      expect(result).toMatchObject({ kind: "success" });
    },
  );

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

  it.each(["euc-kr", "cp949", "windows-949"])(
    "선언된 %s charset으로 디코딩한다",
    async (charset) => {
      // "조단백질 30%"를 euc-kr로 인코딩한 바이트. utf-8로 읽으면 깨진 문자가 나온다.
      const eucKr = new Uint8Array(
        Buffer.from("c1b6b4dcb9e9c1fa20333025", "hex"),
      );
      const result = await captureSource(
        { url: "https://example.test", kind: "kr_label" },
        {
          resolveHostname: publicResolver,
          fetch: async () =>
            new Response(eucKr, {
              headers: { "content-type": `text/plain; charset=${charset}` },
            }),
        },
      );

      expect(result).toMatchObject({
        kind: "success",
        capturedText: "조단백질 30%",
      });
    },
  );

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
