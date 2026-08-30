// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MessageResponse } from "./message";

afterEach(cleanup);

describe("MessageResponse", () => {
  it("animates newly streamed words", () => {
    const { container } = render(
      <MessageResponse isAnimating>One smooth response</MessageResponse>,
    );

    expect(container.querySelectorAll("[data-sd-animate]").length).toBeGreaterThan(0);
  });
});
