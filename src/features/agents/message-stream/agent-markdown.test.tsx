import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentMarkdown } from "./agent-markdown";

describe("AgentMarkdown", () => {
  it("为有序确认菜单保留可恢复数字编号的列表结构", () => {
    const { container } = render(
      <AgentMarkdown>{`请回复编号。

1. 批准当前 proposal / design / spec，并按推荐组合继续实现
2. 批准当前 proposal / design / spec，但我要改实现路径
3. 先修改 proposal / design / tasks / spec
4. 先停在设计阶段`}</AgentMarkdown>,
    );

    const orderedList = container.querySelector("ol");

    expect(orderedList).toHaveClass("agents-message__ordered-list");
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
