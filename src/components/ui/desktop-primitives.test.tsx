import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Input } from "./input";
import { Textarea } from "./textarea";

describe("desktop ui primitives", () => {
  it("renders the shadcn button primitive", () => {
    render(<Button>Run</Button>);

    const button = screen.getByRole("button", { name: "Run" });

    expect(button).toHaveAttribute("data-slot", "button");
    expect(button.className).toContain("bg-primary");
  });

  it("renders the shadcn input primitive", () => {
    render(<Input aria-label="Command" />);

    const input = screen.getByRole("textbox", { name: "Command" });

    expect(input).toHaveAttribute("data-slot", "input");
    expect(input.className).toContain("border-input");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("renders the shadcn textarea primitive without automatic capitalization", () => {
    render(<Textarea aria-label="Prompt" />);

    const textarea = screen.getByRole("textbox", { name: "Prompt" });

    expect(textarea).toHaveAttribute("data-slot", "textarea");
    expect(textarea).toHaveAttribute("autocapitalize", "none");
    expect(textarea).toHaveAttribute("spellcheck", "false");
  });
});
