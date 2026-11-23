import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import en from "../../shared/i18n/locales/en.json";
import zh from "../../shared/i18n/locales/zh.json";

const forgeReasons = [
  "syncDeleteHostNotFound",
  "syncDeleteHostGone",
  "syncDeleteHostUnauthenticated",
  "syncDeleteHostForbidden",
  "syncDeleteHostOffline",
  "syncDeleteHostUnavailable",
] as const;

const validationReasons = [
  "syncDeleteHostNotRemote",
  "syncDeleteHostIdentityMissing",
] as const;

describe("sync delete host contract", () => {
  it("keeps host deletion on the existing delete_issue command", () => {
    const commands = readFileSync(
      "src/features/issues/issue-commands.ts",
      "utf8",
    );
    const registration = readFileSync("src-tauri/src/lib.rs", "utf8");
    expect(commands).toContain(
      'invokeCommand<DeleteIssueResult>("delete_issue"',
    );
    expect(commands).not.toContain("delete_host_issue");
    expect(registration).toContain("features::issue::commands::delete_issue");
    expect(registration).not.toContain("delete_host_issue");
  });

  it("records the new reasons in the Tauri contract and both locales", () => {
    const contract = readFileSync(
      "docs/architecture-design/tauri-contract.md",
      "utf8",
    );
    expect(contract).toContain("syncDeleteHost");
    expect(contract).toContain("`delete_issue` 仍是既有命令");
    for (const reason of forgeReasons) {
      expect(contract).toContain(reason);
      expect(en.errors.FORGE_UNAVAILABLE[reason].length).toBeGreaterThan(0);
      expect(zh.errors.FORGE_UNAVAILABLE[reason].length).toBeGreaterThan(0);
    }
    for (const reason of validationReasons) {
      expect(contract).toContain(reason);
      expect(en.errors.ISSUE_VALIDATION_FAILED[reason].length).toBeGreaterThan(
        0,
      );
      expect(zh.errors.ISSUE_VALIDATION_FAILED[reason].length).toBeGreaterThan(
        0,
      );
    }
  });

  it("marks ADR 0061 as executed", () => {
    const adr = readFileSync(
      "docs/adr/0061-sync-delete-host-issue-on-confirm.md",
      "utf8",
    );
    expect(adr).toContain("采纳（已执行）");
    expect(adr).not.toContain("采纳（待执行）");
  });
});
