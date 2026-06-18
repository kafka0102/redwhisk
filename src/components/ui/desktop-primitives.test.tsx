import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";

describe("desktop ui primitives", () => {
  it("uses desktop token classes for buttons", () => {
    render(<Button>Run</Button>);

    const button = screen.getByRole("button", { name: "Run" });

    expect(button.className).toContain("rounded-[var(--radius-control)]");
    expect(button.className).toContain("text-[13px]");
    expect(button.className).toContain(
      "focus-visible:shadow-[var(--shadow-focus)]",
    );
  });

  it("uses desktop token classes for inputs", () => {
    render(<Input aria-label="Command" />);

    const input = screen.getByRole("textbox", { name: "Command" });

    expect(input.className).toContain("rounded-[var(--radius-control)]");
    expect(input.className).toContain("text-[13px]");
    expect(input.className).toContain(
      "focus-visible:shadow-[var(--shadow-focus)]",
    );
  });

  it("uses desktop token classes for textareas", () => {
    render(<Textarea aria-label="Prompt" />);

    const textarea = screen.getByRole("textbox", { name: "Prompt" });

    expect(textarea.className).toContain("rounded-[var(--radius-control)]");
    expect(textarea.className).toContain("text-[13px]");
    expect(textarea.className).toContain(
      "focus-visible:shadow-[var(--shadow-focus)]",
    );
  });
});
