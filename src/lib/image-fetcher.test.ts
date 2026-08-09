import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, captureImage } from "./image-fetcher";

function respond(body: Uint8Array, contentType: string, status = 200) {
  return new Response(body as unknown as BodyInit, {
    headers: { "content-type": contentType },
    status,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureImage", () => {
  it("이미지가 아니면 거절한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      respond(new Uint8Array([1, 2, 3]), "text/html"),
    );

    const result = await captureImage("https://example.test/a.jpg");

    expect(result).toEqual({
      kind: "failure",
      code: "unsupported_content_type",
    });
  });

  it("상한을 넘으면 거절한다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      respond(new Uint8Array(MAX_IMAGE_BYTES + 1), "image/jpeg"),
    );

    const result = await captureImage("https://example.test/a.jpg");

    expect(result).toEqual({ kind: "failure", code: "response_too_large" });
  });

  it("HTTPS 가 아니면 받으러 가지도 않는다", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await captureImage("http://example.test/a.jpg");

    expect(result).toEqual({ kind: "failure", code: "invalid_url" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("같은 바이트는 같은 해시를 낸다", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      respond(bytes, "image/png"),
    );

    const first = await captureImage("https://example.test/a.png");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      respond(bytes, "image/png"),
    );
    const second = await captureImage("https://example.test/b.png");

    expect(first.kind).toBe("success");
    expect(second.kind).toBe("success");
    if (first.kind !== "success" || second.kind !== "success") return;
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toHaveLength(64);
  });
});
