import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

import openHtmlInBrowserResult from "./eslint-rules/open-html-in-browser-result.js";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "src-tauri/target"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      local: {
        rules: {
          "open-html-in-browser-result": openHtmlInBrowserResult,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "error",
      "local/open-html-in-browser-result": "error",
      // 未使用变量交由 @typescript-eslint 版本统一处理，避免与基础规则重复报错
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "local/open-html-in-browser-result": "off",
    },
  },
  {
    files: ["eslint-rules/**/*.test.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        expect: "readonly",
        it: "readonly",
      },
    },
  },
  {
    files: ["vite.config.ts", "vitest.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
