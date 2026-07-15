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

    const capturedText = extractVisibleText(body, contentType);
    if (!capturedText) return { kind: "failure", code: "empty_content" };

    return {
      kind: "success",
      capturedText,
      contentHash: hashSourceText(capturedText),
      contentType,
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
  const normalized = address.toLowerCase();
  const mappedIpv4 = normalized.match(
    /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/,
  )?.[1];
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4);

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("::") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
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
): "text/html" | "text/plain" | null {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return contentType === "text/html" || contentType === "text/plain"
    ? contentType
    : null;
}

async function readResponseBody(response: Response): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) return null;
  if (!response.body) return "";

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

  return Buffer.concat(chunks).toString("utf8");
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
