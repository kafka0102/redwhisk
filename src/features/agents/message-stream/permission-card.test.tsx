import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PermissionCard } from "./permission-card";
import type { AgentPermissionRequest } from "../agent-stream-types";

vi.mock("../agent-session-commands", () => ({
  respondAgentPermission: vi.fn(),
}));

const { respondAgentPermission } = await import("../agent-session-commands");
const respondAgentPermissionMock = vi.mocked(respondAgentPermission);

function buildRequest(
  overrides: Partial<AgentPermissionRequest> = {},
): AgentPermissionRequest {
  return {
    id: "permission-item-1",
    kind: "tool",
    title: "Run command: ls -la",
    description: "执行 shell 命令",
    actions: [
      { id: "accept", label: "允许", behavior: "allow" },
      { id: "decline", label: "拒绝", behavior: "deny" },
    ],
    ...overrides,
  };
}

describe("PermissionCard", () => {
  it("渲染 title / description / kind 标签与 action 按钮", () => {
    render(
      <PermissionCard request={buildRequest()} projectId={1} sessionId={10} />,
    );

    expect(
      screen.getByLabelText("Agent permission approval card"),
    ).toBeInTheDocument();
    expect(screen.getByText("Run command: ls -la")).toBeInTheDocument();
    expect(screen.getByText("执行 shell 命令")).toBeInTheDocument();
    expect(screen.getByText("Tool call")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "允许" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
  });

  it("点击允许调用 respondAgentPermission 传 accept", async () => {
    respondAgentPermissionMock.mockReset();
    respondAgentPermissionMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <PermissionCard request={buildRequest()} projectId={1} sessionId={10} />,
    );

    await user.click(screen.getByRole("button", { name: "允许" }));

    expect(respondAgentPermissionMock).toHaveBeenCalledWith({
      projectId: 1,
      sessionId: 10,
      requestId: "permission-item-1",
      decision: "accept",
    });
  });

  it("点击拒绝调用 respondAgentPermission 传 decline", async () => {
    respondAgentPermissionMock.mockReset();
    respondAgentPermissionMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(
      <PermissionCard request={buildRequest()} projectId={2} sessionId={20} />,
    );

    await user.click(screen.getByRole("button", { name: "拒绝" }));

    expect(respondAgentPermissionMock).toHaveBeenCalledWith({
      projectId: 2,
      sessionId: 20,
      requestId: "permission-item-1",
      decision: "decline",
    });
  });

  it("点击后进入 loading 态并禁用其它按钮", async () => {
    let resolvePermission: () => void = () => {};
    respondAgentPermissionMock.mockReset();
    respondAgentPermissionMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePermission = resolve;
      }),
    );
    const user = userEvent.setup();

    render(
      <PermissionCard request={buildRequest()} projectId={1} sessionId={10} />,
    );

    await user.click(screen.getByRole("button", { name: "允许" }));

    // 正在请求中：两个按钮都应被禁用。
    expect(screen.getByRole("button", { name: "允许" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeDisabled();

    resolvePermission();
  });

  it("respondAgentPermission 失败时展示错误并恢复按钮", async () => {
    respondAgentPermissionMock.mockReset();
    respondAgentPermissionMock.mockRejectedValue(new Error("网络错误"));
    const user = userEvent.setup();

    render(
      <PermissionCard request={buildRequest()} projectId={1} sessionId={10} />,
    );

    await user.click(screen.getByRole("button", { name: "允许" }));

    expect(await screen.findByText("网络错误")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "允许" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "拒绝" })).not.toBeDisabled();
  });

  it("question kind 渲染用户输入标签", () => {
    render(
      <PermissionCard
        request={buildRequest({ kind: "question", title: "请确认分支" })}
        projectId={1}
        sessionId={10}
      />,
    );

    expect(screen.getByText("User input")).toBeInTheDocument();
    expect(screen.getByText("请确认分支")).toBeInTheDocument();
  });

  it("无 title / description 时不渲染对应段落", () => {
    render(
      <PermissionCard
        request={buildRequest({ title: undefined, description: undefined })}
        projectId={1}
        sessionId={10}
      />,
    );

    expect(
      screen.getByLabelText("Agent permission approval card"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Run command: ls -la")).not.toBeInTheDocument();
    expect(screen.queryByText("执行 shell 命令")).not.toBeInTheDocument();
  });
});
