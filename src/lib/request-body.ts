export class RequestBodyTooLargeError extends Error {
  readonly name = "RequestBodyTooLargeError";
}

/** 본문이 작은 라우트(식별자/짧은 필드)의 기본 상한. */
export const SMALL_JSON_BODY_BYTES = 16 * 1024;
/** 라벨 전사본이나 근거 배열처럼 원문을 싣는 라우트의 상한. */
export const TRANSCRIPT_JSON_BODY_BYTES = 256 * 1024;

/**
 * 스트리밍으로 JSON 본문을 읽고 `maxBytes`를 넘으면 즉시 중단한다.
 * `req.json()`은 상한 검사 전에 본문 전체를 메모리에 올리므로 대신 이 함수를 쓴다.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes)
    throw new RequestBodyTooLargeError();
  if (!request.body) throw new SyntaxError("Request body is missing.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}
