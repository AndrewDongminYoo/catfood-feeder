import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, captureImage } from "./image-fetcher";

// example.test는 RFC 2606 예약 도메인이라 실제 DNS로는 해석되지 않는다.
// captureImage가 이제 발신 전에 호스트를 해석하므로, 모든 테스트가 이 모킹에 기대야
// 기존 4개도(주소를 신경 쓰지 않는) 계속 통과한다 — source-fetcher.test.ts가
// resolveHostname을 주입하는 것과 같은 이유, 다만 여기 captureImage는 시그니처를
// 그대로 유지하므로 DNS 모듈 자체를 모킹한다.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));

// dns.promises.lookup의 오버로드는 `all`이 리터럴 `true`일 때만 배열을 반환한다.
// vi.mocked()는 그 오버로드를 선택해주지 않으므로, 실제로 쓰는 모양(주소 배열)에
// 맞춰 직접 타입을 준다.
const lookupMock = lookup as unknown as {
  mockResolvedValue: (
    value: readonly { address: string; family: number }[],
  ) => void;
  mockResolvedValueOnce: (
    value: readonly { address: string; family: number }[],
  ) => typeof lookupMock;
};

function respond(body: Uint8Array, contentType: string, status = 200) {
  return new Response(body as unknown as BodyInit, {
    headers: { "content-type": contentType },
    status,
  });
}

beforeEach(() => {
  lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

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

  it("사설/루프백 주소로 풀리는 호스트는 거절하고 fetch를 부르지 않는다", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await captureImage("https://example.test/a.jpg");

    expect(result).toEqual({ kind: "failure", code: "unsafe_destination" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("안전하지 않은 호스트로의 리다이렉트를 거절한다", async () => {
    lookupMock
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        headers: { location: "https://internal.example.test/a.jpg" },
        status: 302,
      }),
    );

    const result = await captureImage("https://example.test/a.jpg");

    expect(result).toEqual({ kind: "failure", code: "unsafe_destination" });
    // 리다이렉트 대상은 재검증에서 걸려야 한다 — 그 호스트로는 fetch가 나가면 안 된다.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Content-Length가 상한을 넘으면 본문을 읽지 않고 거절한다", async () => {
    let bodyCanceled = false;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel() {
            bodyCanceled = true;
          },
        }),
        {
          headers: {
            "content-length": String(MAX_IMAGE_BYTES + 1),
            "content-type": "image/jpeg",
          },
        },
      ),
    );

    const result = await captureImage("https://example.test/a.jpg");

    expect(result).toEqual({ kind: "failure", code: "response_too_large" });
    expect(bodyCanceled).toBe(true);
  });

  it("요청에 20초 타임아웃을 건다", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      respond(new Uint8Array([1, 2, 3]), "image/jpeg"),
    );

    await captureImage("https://example.test/a.jpg");

    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
  });
});
