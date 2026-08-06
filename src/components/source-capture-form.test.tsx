// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourceCaptureForm } from "./source-capture-form";

/**
 * `loadDrafts`는 목록에 없는 현재 선택을 보존한다(다른 큐레이터가 발행하면 그 사료는
 * draft 집합을 벗어난다). 그때 select는 비는데 버튼만 살아 있으면 클릭이 조용히
 * 무시된다 — 부모의 핸들러가 `!selected`로 되돌아가기 때문이다.
 */
describe("SourceCaptureForm capture button", () => {
  afterEach(cleanup);

  const props = {
    busy: false,
    captureStatus: null,
    fetchedSourceCount: 0,
    foods: [{ brands: null, id: 7, product_name: "Grasslands" }],
    kind: "manufacturer" as const,
    manualText: "",
    onFoodIdChange: () => {},
    onKindChange: () => {},
    onManualTextChange: () => {},
    onRegisterSource: () => {},
    onUrlChange: () => {},
    url: "https://example.com/label",
  };

  it("enables capture when the selected food is in the draft list", () => {
    render(<SourceCaptureForm {...props} foodId="7" />);

    expect(captureButton().disabled).toBe(false);
  });

  it("disables capture when the retained food id is no longer a draft", () => {
    render(<SourceCaptureForm {...props} foodId="99" />);

    expect(captureButton().disabled).toBe(true);
  });
});

function captureButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "출처 수집" }) as HTMLButtonElement;
}
