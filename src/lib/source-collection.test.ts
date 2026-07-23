import { describe, expect, it } from "vitest";
import {
  hashSourceText,
  isEvidenceExcerpt,
  isPublicHttpUrl,
  normalizeSourceText,
} from "./source-collection";

describe("source collection text", () => {
  it("matches an evidence excerpt across case and whitespace differences", () => {
    const source = "Crude Protein\n(min.)  37 %";
    const excerpt = "crude protein (min.) 37 %";

    expect(isEvidenceExcerpt(source, excerpt)).toBe(true);
  });

  it("rejects an excerpt absent from the captured text", () => {
    expect(isEvidenceExcerpt("Crude fat 18%", "Crude protein 37%")).toBe(false);
  });

  it("hashes equivalent normalized text identically", () => {
    expect(hashSourceText("Protein  37%\n")).toBe(
      hashSourceText("protein 37%"),
    );
  });

  it("normalizes Unicode and collapses whitespace", () => {
    expect(normalizeSourceText("Ｐｒｏｔｅｉｎ\t37%\n")).toBe("protein 37%");
  });
});

describe("public source URLs", () => {
  it.each([
    "https://127.0.0.1/",
    "https://10.0.0.1/",
    "https://172.16.0.1/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
  ])("rejects non-public IP address %s", async (url) => {
    await expect(isPublicHttpUrl(url)).resolves.toBe(false);
  });

  it("rejects localhost by name", async () => {
    await expect(isPublicHttpUrl("https://localhost/admin")).resolves.toBe(
      false,
    );
  });

  it("rejects a hostname when DNS resolves it to a private address", async () => {
    const resolvePrivateHost = async () => [{ address: "10.0.0.8", family: 4 }];

    await expect(
      isPublicHttpUrl("https://internal.example/", resolvePrivateHost),
    ).resolves.toBe(false);
  });

  it("accepts HTTPS when every resolved address is public", async () => {
    const resolvePublicHost = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];

    await expect(
      isPublicHttpUrl("https://example.com/nutrition", resolvePublicHost),
    ).resolves.toBe(true);
  });
});
