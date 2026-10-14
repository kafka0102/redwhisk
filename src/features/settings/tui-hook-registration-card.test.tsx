import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import type { TuiHookRegistrationStatus } from "./settings-commands";
import { TuiHookRegistrationCard } from "./tui-hook-registration-card";

const detectMock = vi.fn();
const installMock = vi.fn();
const uninstallMock = vi.fn();
const enableMock = vi.fn();

vi.mock("./settings-commands", () => ({
  detectTuiHookRegistration: () => detectMock(),
  installTuiHook: (input: { agent: "codex" | "grok" }) => installMock(input),
  uninstallTuiHook: (input: { agent: "codex" | "grok" }) =>
    uninstallMock(input),
  enableCodexHooksFeature: () => enableMock(),
}));

function status(
  overrides: Partial<TuiHookRegistrationStatus> = {},
): TuiHookRegistrationStatus {
  return {
    codexRegistered: true,
    grokRegistered: false,
    codexHooksFeatureEnabled: true,
    channelAvailable: true,
    registrationAllowed: true,
    ...overrides,
  };
}

function renderCard(locale: "zh" | "en" = "zh") {
  return render(
    <I18nProvider fixedLocale={locale}>
      <TuiHookRegistrationCard />
    </I18nProvider>,
  );
}

describe("TuiHookRegistrationCard", () => {
  beforeEach(() => {
    detectMock.mockReset();
    installMock.mockReset();
    uninstallMock.mockReset();
    enableMock.mockReset();
    detectMock.mockResolvedValue(status());
    installMock.mockResolvedValue(status());
    uninstallMock.mockResolvedValue(status({ codexRegistered: false }));
    enableMock.mockResolvedValue(status({ codexHooksFeatureEnabled: true }));
  });

  it("shows registered as not trusted and not in effect", async () => {
    renderCard();

    expect(await screen.findByText("已注册")).toBeInTheDocument();
    expect(screen.getByText("注册后 CLI 仍可能要求信任")).toBeInTheDocument();
    expect(screen.getByText("未注册")).toBeInTheDocument();
    expect(screen.queryByText("已信任")).not.toBeInTheDocument();
    expect(screen.queryByText("已生效")).not.toBeInTheDocument();
    expect(
      screen.getByText(/只影响本机 RedWhisk 拉起的 Codex \/ Grok TUI/),
    ).toBeInTheDocument();
    expect(screen.getByText(/\/hooks/)).toBeInTheDocument();
    expect(screen.getByText(/不会删除其它产品/)).toBeInTheDocument();
  });

  it("disables install and shows channel unavailable without calling it active", async () => {
    detectMock.mockResolvedValue(status({ channelAvailable: false }));
    renderCard();

    expect(await screen.findByText("本机状态通道不可用")).toBeInTheDocument();
    expect(screen.queryByText("已生效")).not.toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "安装" })) {
      expect(button).toBeDisabled();
    }
  });

  it("keeps enable-hooks separate from install", async () => {
    const user = userEvent.setup();
    const featureOff = status({
      codexRegistered: false,
      codexHooksFeatureEnabled: false,
      registrationAllowed: false,
    });
    detectMock.mockResolvedValue(featureOff);
    installMock.mockResolvedValue(featureOff);
    renderCard();

    const enable = await screen.findByRole("button", {
      name: "允许写入 [features] hooks = true",
    });
    await user.click(screen.getAllByRole("button", { name: "安装" })[0]);
    expect(installMock).toHaveBeenCalledWith({ agent: "codex" });
    expect(enableMock).not.toHaveBeenCalled();

    await user.click(enable);
    expect(enableMock).toHaveBeenCalledTimes(1);
    expect(installMock).toHaveBeenCalledTimes(1);
  });

  it("recheck only calls detect", async () => {
    const user = userEvent.setup();
    renderCard();
    await screen.findByText("已注册");

    await user.click(screen.getAllByRole("button", { name: "重新检测" })[0]);
    expect(detectMock).toHaveBeenCalledTimes(2);
    expect(installMock).not.toHaveBeenCalled();
  });
});
