import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";
import { Agent, type Dispatcher } from "undici";
import { hashSourceText, isPublicHttpUrl } from "./source-collection";
import type { SourceKind } from "./source-collection";

const MAX_REDIRECTS = 3;
/**
 * 상한은 **원시 응답**에 걸리지만 보관하는 것은 `extractVisibleText`의 결과다.
 * 제조사 페이지는 이 둘의 차가 크다 — ACANA 제품 페이지 실측 267,880 bytes 중
 * 가시 텍스트는 9,546자(3.6%)였고, 옛 256KB 상한은 이 페이지를 2% 차이로 거절해
 * 성분표가 본문에 그대로 있는데도 캡처가 실패했다.
 * 신뢰할 수 없는 URL을 막는 경계는 유지하되, 상한은 실제 페이지 크기에 맞춘다.
 */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

type CaptureFailureCode =
  | "empty_content"
  | "http_error"
  | "invalid_response"
  | "network_error"
  | "redirect_limit"
  | "response_too_large"
  | "unsafe_destination"
  | "unsupported_content_type";

type CaptureInput = {
  readonly kind: SourceKind;
  readonly url: string;
};

type CaptureSuccess = {
  readonly kind: "success";
  readonly capturedText: string;
  readonly contentHash: string;
  readonly contentType: "text/html" | "text/plain";
  readonly url: string;
};

type CaptureFailure = {
  readonly kind: "failure";
  readonly code: CaptureFailureCode;
};

export type CaptureResult = CaptureSuccess | CaptureFailure;

type FetchDependencies = {
  readonly createDispatcher?: (
    hostname: string,
    addresses: readonly string[],
  ) => Dispatcher;
  readonly fetch?: typeof globalThis.fetch;
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
};

export async function captureSource(
  input: CaptureInput,
  dependencies: FetchDependencies = {},
): Promise<CaptureResult> {
  if (!isPublicHttpUrl(input.url)) {
    return { kind: "failure", code: "unsafe_destination" };
  }

  const fetchSource = dependencies.fetch ?? globalThis.fetch;
  const createDispatcher =
    dependencies.createDispatcher ?? createPinnedDispatcher;
  const resolveHostname = dependencies.resolveHostname ?? resolvePublicHostname;
  let currentUrl = input.url;

  for (
    let redirectCount = 0;
    redirectCount <= MAX_REDIRECTS;
    redirectCount += 1
  ) {
    const destination = new URL(currentUrl);
    const addresses = await resolveAddresses(
      destination.hostname,
      resolveHostname,
    );
    if (addresses === null || addresses.some(isUnsafeAddress)) {
      return { kind: "failure", code: "unsafe_destination" };
    }

    const dispatcher = createDispatcher(destination.hostname, addresses);
    try {
      const response = await fetchWithRetry(
        fetchSource,
        currentUrl,
        dispatcher,
      );
      if (response === null) {
        return { kind: "failure", code: "network_error" };
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        await cancelResponseBody(response);
        if (!location) return { kind: "failure", code: "invalid_response" };
        if (redirectCount === MAX_REDIRECTS) {
          return { kind: "failure", code: "redirect_limit" };
        }

        const redirectedUrl = new URL(location, currentUrl).toString();
        if (!isPublicHttpUrl(redirectedUrl)) {
          return { kind: "failure", code: "unsafe_destination" };
        }
        currentUrl = redirectedUrl;
        continue;
      }

      if (!response.ok) {
        await cancelResponseBody(response);
        return { kind: "failure", code: "http_error" };
      }

      const contentType = parseContentType(
        response.headers.get("content-type"),
      );
      if (contentType === null) {
        await cancelResponseBody(response);
        return { kind: "failure", code: "unsupported_content_type" };
      }

      const body = await readResponseBody(response);
      if (body === null) return { kind: "failure", code: "response_too_large" };

      const capturedText = extractVisibleText(
        decodeBody(body, contentType.charset),
        contentType.type,
      );
      if (!capturedText) return { kind: "failure", code: "empty_content" };

      return {
        kind: "success",
        capturedText,
        contentHash: hashSourceText(capturedText),
        contentType: contentType.type,
        url: currentUrl,
      };
    } finally {
      await dispatcher.close();
    }
  }

  return { kind: "failure", code: "redirect_limit" };
}

function createPinnedDispatcher(
  _hostname: string,
  addresses: readonly string[],
): Dispatcher {
  return new Agent({
    connect: {
      lookup: (_lookupHostname, options, callback) => {
        const records = addresses.map((address) => ({
          address,
          family: isIP(address) as 4 | 6,
        }));
        const matchingRecords = options.family
          ? records.filter((record) => record.family === options.family)
          : records;

        if (options.all) callback(null, matchingRecords);
        else
          callback(
            null,
            matchingRecords[0]?.address ?? addresses[0],
            matchingRecords[0]?.family ?? 4,
          );
      },
    },
  });
}

async function resolvePublicHostname(
  hostname: string,
): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

async function resolveAddresses(
  hostname: string,
  resolveHostname: (hostname: string) => Promise<readonly string[]>,
): Promise<readonly string[] | null> {
  try {
    const addresses = await resolveHostname(hostname);
    return addresses.length > 0 ? addresses : null;
  } catch {
    return null;
  }
}

function isUnsafeAddress(address: string): boolean {
  if (isIP(address) === 4) return isUnsafeIpv4(address);
  if (isIP(address) === 6) return isUnsafeIpv6(address);
  return true;
}

function isUnsafeIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second, third, fourth] = octets;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  )
    return true;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 &&
      second === 0 &&
      ((third === 0 && fourth !== 9 && fourth !== 10) || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isUnsafeIpv6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  // 파싱 실패는 거부한다 — 해석할 수 없는 주소를 허용하는 것보다 안전하다.
  if (bytes === null) return true;

  const startsWith = (...prefix: number[]) =>
    prefix.every((byte, index) => bytes[index] === byte);

  if (
    startsWith(0x00, 0x64, 0xff, 0x9b) &&
    bytes.slice(4, 12).every((byte) => byte === 0)
  )
    return isUnsafeIpv4(bytes.slice(12).join("."));

  // 현재 전역 유니캐스트 할당인 2000::/3 밖의 주소는 전부 내부·특수 용도로 거부한다.
  if ((bytes[0] & 0xe0) !== 0x20) return true;
  if (startsWith(0x20, 0x02)) return isUnsafeIpv4(bytes.slice(2, 6).join(".")); // 6to4 2002::/16

  // 2001::/23은 기본적으로 비전역이며 IANA가 따로 지정한 전역 예외만 허용한다.
  if (
    startsWith(0x20, 0x01) &&
    bytes[2] <= 0x01 &&
    !isGloballyReachableIetfAssignment(bytes)
  )
    return true;
  if (startsWith(0x20, 0x01, 0x0d, 0xb8)) return true; // documentation 2001:db8::/32
  if (startsWith(0x3f, 0xff) && (bytes[2] & 0xf0) === 0) return true; // documentation 3fff::/20
  return false;
}

function isGloballyReachableIetfAssignment(bytes: readonly number[]): boolean {
  const startsWith = (...prefix: number[]) =>
    prefix.every((byte, index) => bytes[index] === byte);
  const isProtocolAnycast =
    startsWith(0x20, 0x01, 0x00, 0x01) &&
    bytes.slice(4, 15).every((byte) => byte === 0) &&
    (bytes[15] === 1 || bytes[15] === 2 || bytes[15] === 3);

  return (
    isProtocolAnycast ||
    startsWith(0x20, 0x01, 0x00, 0x03) ||
    startsWith(0x20, 0x01, 0x00, 0x04, 0x01, 0x12) ||
    (startsWith(0x20, 0x01, 0x00) &&
      ((bytes[3] & 0xf0) === 0x20 || (bytes[3] & 0xf0) === 0x30))
  );
}

/** IPv6 문자열을 16바이트로 편다. `::` 압축과 끝자리 dotted-quad를 처리한다. */
function ipv6ToBytes(address: string): number[] | null {
  let text = address.toLowerCase().split("%", 1)[0] ?? "";
  const dotted = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (dotted) {
    const octets = dotted.split(".").map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet > 255))
      return null;
    const hex = [
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    ];
    text = text.slice(0, -dotted.length) + hex.join(":");
  }

  const [head, tail, ...rest] = text.split("::");
  if (rest.length > 0) return null;
  const parse = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((group) => Number.parseInt(group, 16));
  const headGroups = parse(head ?? "");
  const tailGroups = tail === undefined ? [] : parse(tail);
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<number>(8 - headGroups.length - tailGroups.length).fill(0),
          ...tailGroups,
        ];
  if (groups.length !== 8) return null;
  if (
    groups.some(
      (group) => !Number.isInteger(group) || group < 0 || group > 0xffff,
    )
  )
    return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

async function fetchWithRetry(
  fetchSource: typeof globalThis.fetch,
  url: string,
  dispatcher: Dispatcher,
): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchSource(url, {
        // Node의 fetch가 사용하는 undici 전용 옵션이다.
        dispatcher,
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      } as RequestInit & { dispatcher: Dispatcher });
      if (response.status < 500 || attempt === 1) return response;
      await cancelResponseBody(response);
    } catch {
      if (attempt === 1) return null;
    }
  }

  return null;
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function parseContentType(
  value: string | null,
): { type: "text/html" | "text/plain"; charset: string } | null {
  const type = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "text/html" && type !== "text/plain") return null;
  const charset = value?.match(/charset\s*=\s*"?([\w-]+)"?/i)?.[1];
  return { type, charset: charset?.toLowerCase() ?? "utf-8" };
}

/**
 * 선언된 charset으로 디코딩한다. 국내 수입사 페이지가 euc-kr/cp949로 제공되는 경우가 있어
 * utf-8 고정 디코딩은 조용히 깨진 텍스트를 수집한다.
 * ponytail: TextDecoder의 레거시 인코딩 지원은 Node의 full-ICU 빌드에 달려 있다.
 * 알 수 없는 라벨은 utf-8로 되돌린다.
 */
function decodeBody(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.replace(/^cp949$/, "euc-kr")).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readResponseBody(
  response: Response,
): Promise<Uint8Array | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    return null;
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel();
}

function extractVisibleText(
  body: string,
  contentType: "text/html" | "text/plain",
): string {
  if (contentType === "text/plain") return collapseWhitespace(body);

  const $ = load(body);
  $("script, style, noscript, template").remove();
  // `[hidden]` / `[aria-hidden]`은 **지금 표시되지 않는다**는 뜻이지 본문이 아니라는
  // 뜻이 아니다. 제조사 제품 페이지는 성분표를 탭 패널에 넣고 비활성 탭에 `hidden`을
  // 붙이므로, 이걸 지우면 정작 필요한 보증성분표만 사라진다 — ACANA Highest Protein
  // Kitten(en-CA) 실측: 제거 시 4,233자에 성분값 0개, 유지 시 9,112자에 성분표 전체.
  // 캡처는 성공하는데 데이터만 빠지는 조용한 실패라 더 위험하다.
  // 남은 위험: 인라인 `display: none`으로 같은 탭을 구현한 사이트는 아래에서 여전히
  // 잘려나간다. 은닉 텍스트 유입 자체는 근거가 문자 그대로 일치해야 하고 큐레이터가
  // 수집 원문을 검토한다는 두 겹으로 막힌다.
  $("[style*='display: none'], [style*='visibility: hidden']").remove();
  return collapseWhitespace($("body").text() || $.root().text());
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
