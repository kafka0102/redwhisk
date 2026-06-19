import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import { Input } from "./input";

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
  });
});
