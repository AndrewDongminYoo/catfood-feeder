// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublicNavigation } from "./public-navigation";

afterEach(cleanup);

describe("PublicNavigation", () => {
  it("카탈로그와 advisor·리콜·급여 화면으로 이동할 수 있다", () => {
    render(<PublicNavigation />);

    expect(screen.getByRole("navigation", { name: "주요 메뉴" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "카탈로그" }).getAttribute("href"),
    ).toBe("/foods");
    expect(
      screen.getByRole("link", { name: "다음 사료 찾기" }).getAttribute("href"),
    ).toBe("/advisor");
    expect(
      screen.getByRole("link", { name: "리콜 이력" }).getAttribute("href"),
    ).toBe("/recalls");
    expect(
      screen.getByRole("link", { name: "급여 내역" }).getAttribute("href"),
    ).toBe("/feeding");
  });
});
