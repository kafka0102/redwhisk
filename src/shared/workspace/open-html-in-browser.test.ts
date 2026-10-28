import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const openPath = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath,
}));

import {
  joinWorkspaceFilePath,
  openHtmlInBrowser,
} from "./open-html-in-browser";

describe("joinWorkspaceFilePath", () => {
  it("joins a workspace root and a relative file path", () => {
    expect(joinWorkspaceFilePath("/tmp/repo", "docs/index.html")).toBe(
      "/tmp/repo/docs/index.html",
    );
  });

  it("drops extra separators on either side", () => {
    expect(joinWorkspaceFilePath("/tmp/repo/", "/index.html")).toBe(
      "/tmp/repo/index.html",
    );
  });
});

describe("openHtmlInBrowser", () => {
  beforeEach(() => {
    openPath.mockReset();
  });

  it("opens the absolute file path with the system default app", async () => {
    openPath.mockResolvedValue(undefined);

    await expect(openHtmlInBrowser("/tmp/repo", "index.html")).resolves.toBe(
      true,
    );
    expect(openPath).toHaveBeenCalledWith("/tmp/repo/index.html");
  });

  it("returns false when the opener rejects", async () => {
    openPath.mockRejectedValue(new Error("blocked"));

    await expect(openHtmlInBrowser("/tmp/repo", "index.html")).resolves.toBe(
      false,
    );
  });

  it("returns false without calling the opener when a path is missing", async () => {
    await expect(openHtmlInBrowser("", "index.html")).resolves.toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });
});

const BRIEFING_HTML_PATH =
  "/Users/yujianjia/workspace/lixiang/show-case.worktrees/issue-8-show-case/.scratch/cloud-service-ontology-briefing/architecture-permission-options.html";

describe("opener capability", () => {
  it("allows open_path to launch an html file inside a dot directory", () => {
    const capability = readOpenerCapability(
      readFileSync(
        resolve(process.cwd(), "src-tauri/capabilities/default.json"),
        "utf8",
      ),
    );
    const tauriConfig = readTauriConfig(
      readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
    );

    expect(readOpenerRequireLiteralLeadingDot(tauriConfig)).toBe(false);
    expect(
      openerScopeAllowsPath(openerAllowPaths(capability), BRIEFING_HTML_PATH),
    ).toBe(true);
    expect(
      openerScopeAllowsPath(
        openerAllowPaths(capability),
        "/tmp/outside-home/index.html",
      ),
    ).toBe(true);
  });
});

interface OpenerCapability {
  permissions?: unknown[];
}

interface TauriConfig {
  plugins?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOpenerCapability(source: string): OpenerCapability {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed) || !Array.isArray(parsed.permissions)) {
    return { permissions: [] };
  }
  return { permissions: parsed.permissions };
}

function readTauriConfig(source: string): TauriConfig {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) {
    return {};
  }
  return { plugins: parsed.plugins };
}

function readOpenerRequireLiteralLeadingDot(
  config: TauriConfig,
): boolean | null {
  if (!isRecord(config.plugins) || !isRecord(config.plugins.opener)) {
    return null;
  }
  const value = config.plugins.opener.requireLiteralLeadingDot;
  return typeof value === "boolean" ? value : null;
}

function openerAllowPaths(capability: OpenerCapability): string[] {
  const paths: string[] = [];
  for (const permission of capability.permissions ?? []) {
    if (!isRecord(permission)) {
      continue;
    }
    if (permission.identifier !== "opener:allow-open-path") {
      continue;
    }
    if (!Array.isArray(permission.allow)) {
      continue;
    }
    for (const entry of permission.allow) {
      if (!isRecord(entry) || typeof entry.path !== "string") {
        continue;
      }
      paths.push(entry.path);
    }
  }
  return paths;
}

function openerScopeAllowsPath(
  patterns: string[],
  targetPath: string,
): boolean {
  const home = homedir();
  return patterns.some((pattern) =>
    openerPatternMatches(resolveOpenerPattern(pattern, home), targetPath),
  );
}

function resolveOpenerPattern(pattern: string, home: string): string {
  if (pattern === "$HOME") {
    return home;
  }
  if (pattern.startsWith("$HOME/") || pattern.startsWith("$HOME\\")) {
    return `${home}${pattern.slice("$HOME".length)}`;
  }
  return pattern;
}

/** 只覆盖已用 tauri glob 规则核对过的 scope 写法。空 scope 必须拒绝。 */
function openerPatternMatches(pattern: string, targetPath: string): boolean {
  if (pattern === "**" || pattern === "/**" || pattern === "**/*") {
    return targetPath.length > 0;
  }
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return targetPath === prefix || targetPath.startsWith(`${prefix}/`);
  }
  return pattern === targetPath;
}
