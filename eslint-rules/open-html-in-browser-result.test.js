import { Linter } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "./open-html-in-browser-result.js";

const linter = new Linter({ configType: "flat" });

const config = [
  {
    plugins: {
      local: {
        rules: {
          "open-html-in-browser-result": rule,
        },
      },
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "local/open-html-in-browser-result": "error",
    },
  },
];

function messagesFor(code) {
  return linter.verify(code, config);
}

describe("openHtmlInBrowser result rule", () => {
  it("allows a then callback that shows the failure message", () => {
    expect(
      messagesFor(`
        void openHtmlInBrowser(root, path).then((opened) => {
          if (!opened) {
            showAlert({ message: t("agentsFeature.openHtmlInBrowserFailed") });
          }
        });
      `),
    ).toEqual([]);
  });

  it("allows an awaited boolean checked in the false branch", () => {
    expect(
      messagesFor(`
        async function open() {
          const opened = await openHtmlInBrowser(root, path);
          if (opened === false) {
            showAlert({ message: t("agentsFeature.openHtmlInBrowserFailed") });
          }
        }
      `),
    ).toEqual([]);
  });

  it("flags a discarded call", () => {
    const messages = messagesFor(`void openHtmlInBrowser(root, path);`);
    expect(messages.map((message) => message.message)).toEqual([
      "Read openHtmlInBrowser's boolean and show openHtmlInBrowserFailed when it is false.",
    ]);
  });

  it("flags a then callback that ignores the boolean", () => {
    const messages = messagesFor(`
      void openHtmlInBrowser(root, path).then((opened) => {
        console.log(opened);
      });
    `);
    expect(messages).toHaveLength(1);
  });
});
