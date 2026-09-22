import { describe, expect, it } from "vitest";

import { installBlockEscapeDefaultAction } from "./block-escape-default-action";

function pressEscape(
  target: EventTarget,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    code: "Escape",
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("installBlockEscapeDefaultAction", () => {
  it("prevents the window-level default action of ESC", () => {
    const target = new EventTarget();
    const uninstall = installBlockEscapeDefaultAction({ target });

    expect(pressEscape(target).defaultPrevented).toBe(true);

    uninstall();
  });

  it("keeps delivering ESC to in-app handlers", () => {
    const target = new EventTarget();
    const handled: string[] = [];
    target.addEventListener("keydown", () => handled.push("app"));
    const uninstall = installBlockEscapeDefaultAction({ target });

    pressEscape(target);

    expect(handled).toEqual(["app"]);
    uninstall();
  });

  it("ignores other keys and non-keydown events", () => {
    const target = new EventTarget();
    const uninstall = installBlockEscapeDefaultAction({ target });

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      cancelable: true,
    });
    target.dispatchEvent(enter);
    const escapeKeyUp = new KeyboardEvent("keyup", {
      key: "Escape",
      cancelable: true,
    });
    target.dispatchEvent(escapeKeyUp);

    expect(enter.defaultPrevented).toBe(false);
    expect(escapeKeyUp.defaultPrevented).toBe(false);
    uninstall();
  });

  it("leaves ESC during IME composition to the input method", () => {
    const target = new EventTarget();
    const uninstall = installBlockEscapeDefaultAction({ target });

    const event = pressEscape(target, { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    uninstall();
  });

  it("stops guarding after uninstall", () => {
    const target = new EventTarget();
    const uninstall = installBlockEscapeDefaultAction({ target });

    uninstall();

    expect(pressEscape(target).defaultPrevented).toBe(false);
  });
});
