import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { load } from "cheerio";
import { hashSourceText, isPublicHttpUrl } from "./source-collection";
import type { SourceKind } from "./source-collection";

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 256 * 1024;
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

    // ponytail: 검증과 실제 연결이 각각 DNS를 조회하므로 rebinding(TOCTOU) 창이 남는다.
    // 짧은 TTL로 검증 때는 공인 IP를, 연결 때는 169.254.169.254를 주는 도메인은 통과한다.
    // 닫으려면 검증된 주소를 고정한 lookup을 undici Agent에 주입해야 한다(새 의존성).
    // 호출부가 큐레이터 세션으로 제한돼 있어 현재는 내부자 위협 범위로 남겨둔다.
    const response = await fetchWithRetry(fetchSource, currentUrl);
    if (response === null) {
      return { kind: "failure", code: "network_error" };
    }

    if (isRedirect(response.status)) {
      const location = response.headers.get("location");
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

    if (!response.ok) return { kind: "failure", code: "http_error" };

    const contentType = parseContentType(response.headers.get("content-type"));
    if (contentType === null) {
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
  }

  return { kind: "failure", code: "redirect_limit" };
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
  const [first, second] = octets;
  if (first === undefined || second === undefined) return true;

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isUnsafeIpv6(address: string): boolean {
  const bytes = ipv6ToBytes(address);
  // 파싱 실패는 거부한다 — 해석할 수 없는 주소를 허용하는 것보다 안전하다.
  if (bytes === null) return true;

  const startsWith = (...prefix: number[]) =>
    prefix.every((byte, index) => bytes[index] === byte);
  const embeddedIpv4 = (offset: number) =>
    bytes.slice(offset, offset + 4).join(".");

  // IPv4를 품는 형식은 전부 IPv4 규칙으로 되돌려 검사한다. 이 환원을 빠뜨리면
  // 2002:7f00:0001::(6to4 → 127.0.0.1) 같은 주소가 공인 IP로 통과한다.
  if (startsWith(0x20, 0x02)) return isUnsafeIpv4(embeddedIpv4(2)); // 6to4 2002::/16
  if (startsWith(0x00, 0x64, 0xff, 0x9b)) return true; // NAT64 64:ff9b::/96
  if (startsWith(0x20, 0x01, 0x00, 0x00)) return true; // Teredo 2001::/32
  // ::ffff:a.b.c.d (IPv4-mapped) 및 ::a.b.c.d (IPv4-compatible)
  if (bytes.slice(0, 10).every((byte) => byte === 0)) {
    if (bytes[10] === 0xff && bytes[11] === 0xff)
      return isUnsafeIpv4(embeddedIpv4(12));
    if (bytes[10] === 0 && bytes[11] === 0)
      return bytes.slice(12).some((byte) => byte !== 0)
        ? isUnsafeIpv4(embeddedIpv4(12))
        : true; // :: 자체(미지정 주소)
  }

  if (bytes.every((byte) => byte === 0)) return true; // ::
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1)
    return true; // ::1
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  return false;
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
): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchSource(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status < 500 || attempt === 1) return response;
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
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) return null;
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

function extractVisibleText(
  body: string,
  contentType: "text/html" | "text/plain",
): string {
  if (contentType === "text/plain") return collapseWhitespace(body);

  const $ = load(body);
  $(
    "script, style, noscript, template, [hidden], [aria-hidden='true']",
  ).remove();
  $("[style*='display: none'], [style*='visibility: hidden']").remove();
  return collapseWhitespace($("body").text() || $.root().text());
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
