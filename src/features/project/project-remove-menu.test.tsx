import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../shared/i18n/i18n";
import { ProjectRemoveMenu } from "./project-remove-menu";
import { deleteProject, removeProjectFromList } from "./project-commands";

vi.mock("./project-commands", () => ({
  removeProjectFromList: vi.fn(),
  deleteProject: vi.fn(),
}));

const removeProjectFromListMock = vi.mocked(removeProjectFromList);
const deleteProjectMock = vi.mocked(deleteProject);

function renderMenu(onRemoved = vi.fn().mockResolvedValue(undefined)) {
  return {
    onRemoved,
    ...render(
      <I18nProvider initialLocale="zh">
        <ProjectRemoveMenu
          messagesSource="projectHome"
          projectId={7}
          onRemoved={onRemoved}
        />
      </I18nProvider>,
    ),
  };
}

describe("ProjectRemoveMenu", () => {
  beforeEach(() => {
    removeProjectFromListMock.mockReset();
    removeProjectFromListMock.mockResolvedValue(undefined);
    deleteProjectMock.mockReset();
    deleteProjectMock.mockResolvedValue(undefined);
  });

  it("does not call remove when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const { onRemoved } = renderMenu();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByText("从列表中移除"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(removeProjectFromListMock).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("calls remove and refreshes after confirmation", async () => {
    const user = userEvent.setup();
    const { onRemoved } = renderMenu();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByText("从列表中移除"));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "从列表中移除" }),
    );

    await waitFor(() => {
      expect(removeProjectFromListMock).toHaveBeenCalledWith({ projectId: 7 });
    });
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalledTimes(1);
    });
  });

  it("does not call delete when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const { onRemoved } = renderMenu();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByText("删除项目"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "删除项目将移除该项目的所有数据，确定要删除项目吗？",
    );
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    expect(deleteProjectMock).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it("calls delete and refreshes after confirmation", async () => {
    const user = userEvent.setup();
    const { onRemoved } = renderMenu();

    await user.click(screen.getByRole("button", { name: "更多操作" }));
    await user.click(await screen.findByText("删除项目"));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "删除项目" }));

    await waitFor(() => {
      expect(deleteProjectMock).toHaveBeenCalledWith({ projectId: 7 });
    });
    await waitFor(() => {
      expect(onRemoved).toHaveBeenCalledTimes(1);
    });
    expect(removeProjectFromListMock).not.toHaveBeenCalled();
  });
});
