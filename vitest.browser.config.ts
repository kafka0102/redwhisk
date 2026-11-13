import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";

import baseConfig from "./vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ["src/**/*.browser.test.tsx"],
    },
  }),
);
