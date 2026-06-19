import type { userEvent } from "@testing-library/user-event";
import { screen, within } from "@testing-library/react";

/**
 * base-ui SelectTrigger 渲染为 `<button role="combobox">`。点击后会通过 portal
 * 弹出 listbox（role="listbox"），其中的 option 默认出现在 document.body 而非
 * trigger 所在的容器内，因此选项查询始终使用全局 `screen`。
 */

function getTrigger(
  bound: ReturnType<typeof within> | typeof screen,
  triggerLabel: string,
) {
  if (triggerLabel === "") {
    return bound.getAllByRole("combobox")[0];
  }
  return bound.getByRole("combobox", { name: triggerLabel });
}

/**
 * 打开 shadcn Select 的弹层但不选择任何选项，便于调用方用
 * `screen.findByRole("option", ...)` 校验选项内容。
 */
export async function openShadcnSelect(
  user: ReturnType<typeof userEvent.setup>,
  bound: ReturnType<typeof within> | typeof screen,
  triggerLabel: string,
): Promise<void> {
  await user.click(getTrigger(bound, triggerLabel));
}

/**
 * 打开 shadcn Select 并点击匹配 optionText 的选项。
 */
export async function selectShadcnOption(
  user: ReturnType<typeof userEvent.setup>,
  bound: ReturnType<typeof within> | typeof screen,
  triggerLabel: string,
  optionText: string,
): Promise<void> {
  await openShadcnSelect(user, bound, triggerLabel);
  const option = await screen.findByRole("option", { name: optionText });
  await user.click(option);
}
