import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const SOURCE_KIND_VALUES = ["manufacturer", "kr_label"] as const;
export type SourceKind = (typeof SOURCE_KIND_VALUES)[number];

export const SOURCE_CAPTURE_METHOD_VALUES = ["fetch", "manual"] as const;
export type SourceCaptureMethod = (typeof SOURCE_CAPTURE_METHOD_VALUES)[number];

export type SourceFetchStatus = "fetched" | "failed";

export function normalizeSourceText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

export function hashSourceText(value: string): string {
  return createHash("sha256").update(normalizeSourceText(value)).digest("hex");
}

export function isEvidenceExcerpt(
  sourceText: string,
  excerpt: string,
): boolean {
  const normalizedExcerpt = normalizeSourceText(excerpt);
  return (
    normalizedExcerpt.length > 0 &&
    normalizeSourceText(sourceText).includes(normalizedExcerpt)
  );
}

type ResolveHostname = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const resolveHostname: ResolveHostname = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function isPublicHttpUrl(
  value: string,
  resolve: ResolveHostname = resolveHostname,
): Promise<boolean> {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");

    if (url.protocol !== "https:" || !isPublicIpLiteral(hostname)) return false;
    if (isIP(hostname) !== 0) return true;

    const addresses = await resolve(hostname);
    return (
      addresses.length > 0 &&
      addresses.every(({ address }) => isPublicIpLiteral(address))
    );
  } catch {
    return false;
  }
}

function isPublicIpLiteral(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;

  const version = isIP(hostname);
  if (version === 0) return true;

  if (version === 4) {
    const [a, b] = hostname.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }

  const normalized = hostname.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mappedAddress = normalized.slice(7);
    const ipv4Address = mappedAddress.includes(".")
      ? mappedAddress
      : mappedAddress
          .split(":")
          .flatMap((part) => {
            const value = Number.parseInt(part, 16);
            return [value >> 8, value & 0xff];
          })
          .join(".");
    return isPublicIpLiteral(ipv4Address);
  }

  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}
