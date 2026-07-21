import { describe, expect, it } from "vitest";
import { TRANSCRIPT_JSON_BODY_BYTES, readJsonBody } from "./request-body";

describe("readJsonBody", () => {
  it("accepts a 256 KiB transcript inside its JSON envelope", async () => {
    const capturedText = '"'.repeat(256 * 1024);
    const request = new Request("https://example.com/api/foods/1/sources", {
      body: JSON.stringify({
        captureMethod: "manual",
        capturedText,
        kind: "kr_label",
        url: "https://example.com/product/1",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    await expect(
      readJsonBody(request, TRANSCRIPT_JSON_BODY_BYTES),
    ).resolves.toMatchObject({ capturedText });
  });
});
