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
    codexHooksOutdated: false,
    grokHooksOutdated: false,
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

  it("shows one compact row per agent without a TUI hook subtitle", async () => {
    renderCard();

    expect(await screen.findByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("Grok")).toBeInTheDocument();
    expect(screen.queryByText(/TUI hook/i)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Codex" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Grok" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "卸载" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "安装" })).toHaveLength(1);
  });

  it("keeps long notices in the help tooltip instead of the card body", async () => {
    const user = userEvent.setup();
    renderCard();

    const registered = await screen.findByText("已注册");
    expect(screen.getByText("未注册")).toBeInTheDocument();
    expect(screen.queryByText("已信任")).not.toBeInTheDocument();
    expect(screen.queryByText("已生效")).not.toBeInTheDocument();
    expect(screen.queryByText(/仍可能要求信任/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/只影响本机 RedWhisk 拉起的 Codex \/ Grok TUI/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/不会删除其它产品/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\/hooks/)).not.toBeInTheDocument();

    await user.hover(registered);
    expect(await screen.findByText(/仍可能要求信任/)).toBeInTheDocument();

    const help = screen.getByRole("button", { name: "说明" });
    help.focus();
    const helpTip = await screen.findByText(
      /只影响本机 RedWhisk 拉起的 Codex \/ Grok TUI/,
    );
    expect(helpTip).toHaveTextContent(/\/hooks/);
    expect(helpTip).toHaveTextContent(/不会删除其它产品/);
  });

  it("disables install and shows a short channel banner without calling it active", async () => {
    detectMock.mockResolvedValue(status({ channelAvailable: false }));
    renderCard();

    expect(await screen.findByText("通道不可用")).toBeInTheDocument();
    expect(screen.getAllByText("通道不可用")).toHaveLength(1);
    expect(screen.getByText("已注册")).toBeInTheDocument();
    expect(screen.getByText("未注册")).toBeInTheDocument();
    expect(screen.queryByText("已生效")).not.toBeInTheDocument();
    expect(screen.queryByText(/安装暂时无法完成/)).not.toBeInTheDocument();
    const installButtons = screen.getAllByRole("button", { name: "安装" });
    expect(installButtons).toHaveLength(1);
    expect(installButtons[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "卸载" })).toHaveLength(1);

    screen.getByRole("button", { name: "说明" }).focus();
    expect(await screen.findByText(/安装暂时无法完成/)).toBeInTheDocument();
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

    expect(screen.queryByText(/左侧 running 不会出现/)).not.toBeInTheDocument();
    const enable = await screen.findByRole("button", {
      name: "开启 hooks",
    });
    await user.hover(screen.getByText("hooks 未开启"));
    expect(
      await screen.findByText(/左侧 running 不会出现/),
    ).toBeInTheDocument();
    await user.hover(enable);
    expect(
      await screen.findByText("允许写入 [features] hooks = true"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "卸载" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "安装" })[0]);
    expect(installMock).toHaveBeenCalledWith({ agent: "codex" });
    expect(enableMock).not.toHaveBeenCalled();

    await user.click(enable);
    expect(enableMock).toHaveBeenCalledTimes(1);
    expect(installMock).toHaveBeenCalledTimes(1);
  });

  it("shows an alert when uninstall fails", async () => {
    const user = userEvent.setup();
    uninstallMock.mockRejectedValue({
      code: "SETTINGS_PERSISTENCE_FAILED",
      message: "Failed to update the TUI hook registration.",
      reason: "channelUnavailable",
    });
    renderCard();
    await screen.findByText("已注册");

    await user.click(screen.getByRole("button", { name: "卸载" }));

    expect(await screen.findByText("本机状态通道不可用")).toBeInTheDocument();
  });

  it("shows the same short labels and help tooltip in English", async () => {
    detectMock.mockResolvedValue(
      status({
        channelAvailable: false,
        codexHooksFeatureEnabled: false,
        registrationAllowed: false,
      }),
    );
    renderCard("en");

    expect(await screen.findByText("Channel unavailable")).toBeInTheDocument();
    expect(screen.getByText("Hooks off")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Enable hooks" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/running indicator will not appear/),
    ).not.toBeInTheDocument();

    screen.getByRole("button", { name: "About" }).focus();
    expect(
      await screen.findByText(
        /Codex \/ Grok TUI sessions launched by RedWhisk/,
      ),
    ).toBeInTheDocument();
  });

  it("offers update when the installed hook list is outdated", async () => {
    const user = userEvent.setup();
    detectMock.mockResolvedValue(
      status({
        codexRegistered: false,
        codexHooksOutdated: true,
      }),
    );
    renderCard();

    expect(await screen.findByText("需更新")).toBeInTheDocument();
    await user.hover(screen.getByText("需更新"));
    expect(await screen.findByText(/执行 \/hooks/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "更新" }));
    expect(installMock).toHaveBeenCalledWith({ agent: "codex" });
    expect(screen.getByRole("button", { name: "卸载" })).toBeInTheDocument();
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
