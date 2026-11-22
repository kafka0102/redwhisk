import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../shared/i18n/i18n";
import { IssueDetailSideCards } from "./issue-detail-side-cards";
import type { LinkedChangeRequestSummary } from "./issue-detail-commands";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const CHROME_MEASUREMENT_TIMEOUT_MS = 20_000;
const SIDEBAR_WIDTH = 400;
const LONG_TITLE =
  "Fix-authentication-and-permission-handoff-across-repository-boundaries";

interface CardLayoutMeasurement {
  failures: string[];
}

interface CardCase {
  name: string;
  issueStatus: string;
  state: string;
  expectedActions: string[];
}

const CARD_CASES: CardCase[] = [
  {
    name: "open",
    issueStatus: "review",
    state: "open",
    expectedActions: ["在应用内查看", "打开 GitHub"],
  },
  {
    name: "closed-unmerged",
    issueStatus: "completed",
    state: "closed",
    expectedActions: ["在应用内查看", "重新打开 Issue", "打开 GitHub"],
  },
];

function chromeBinary(): string {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv !== undefined && fromEnv !== "" && existsSync(fromEnv)) {
    return fromEnv;
  }
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      "Chrome not found. Set CHROME_PATH to measure linked change request cards.",
    );
  }
  return found;
}

function linkedRequest(state: string): LinkedChangeRequestSummary {
  return {
    provider: "github",
    url: "https://github.com/acme/redwhisk/pull/12",
    number: 12,
    state,
    checksOk: 2,
    checksFailed: 1,
    checksPending: 0,
    title: LONG_TITLE,
    sourceBranch: "feat/auth-handoff",
    targetBranch: "main",
  };
}

function cardMarkup(testCase: CardCase): string {
  return renderToStaticMarkup(
    <I18nProvider fixedLocale="zh">
      <IssueDetailSideCards
        canOpenSession={false}
        issueStatus={testCase.issueStatus}
        linkedChangeRequests={[linkedRequest(testCase.state)]}
        linkedSessionId={null}
        projectId={1}
        projection={null}
        writebackError={null}
        writebackPending={false}
        onOpenChangeRequest={() => undefined}
        onOpenSession={() => undefined}
        onReopenIssue={() => undefined}
        onRetryWriteback={() => undefined}
      />
    </I18nProvider>,
  );
}

function stylesheet(): string {
  return [
    "src/shared/styles/tokens.css",
    "src/shared/styles/issue-detail.css",
    "src/shared/styles/session-side-panel.css",
  ]
    .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
    .join("\n");
}

function measureCard(testCase: CardCase): CardLayoutMeasurement {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${stylesheet()}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { padding: 20px; }
.measure-sidebar {
  width: ${SIDEBAR_WIDTH}px;
}
[data-slot="button"] {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: var(--secondary);
  color: var(--secondary-foreground);
  font: 500 12.8px/1 var(--font-sans);
  white-space: nowrap;
}
</style>
</head>
<body>
<div id="sidebar" class="measure-sidebar issue-page__side issue-page__side--readonly">
${cardMarkup(testCase)}
</div>
<pre id="out"></pre>
<script>
const sidebar = document.getElementById("sidebar");
const card = sidebar.querySelector(".issue-detail-side-card");
const header = card.querySelector(".session-issue-panel__header");
const identity = card.querySelector(".issue-detail-side-card__identity");
const title = card.querySelector(".session-issue-panel__issue-title");
const state = card.querySelector(".issue-detail-side-card__state");
const checks = card.querySelector(".issue-detail-side-card__checks");
const actions = card.querySelector(".session-issue-panel__actions");
const buttons = [...actions.querySelectorAll("[data-slot='button']")];
const failures = [];
const epsilon = 0.5;

if (!card || !header || !identity || !title || !state || !checks || !actions) {
  document.getElementById("out").textContent = JSON.stringify({
    failures: ["linked change request card structure missing"],
  });
} else {
  const contentRect = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      left: rect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      right: rect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
      top: rect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      bottom: rect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
    };
  };
  const rect = (element) => {
    const value = element.getBoundingClientRect();
    return {
      left: value.left,
      right: value.right,
      top: value.top,
      bottom: value.bottom,
    };
  };
  const overlaps = (first, second) =>
    first.left < second.right - epsilon &&
    first.right > second.left + epsilon &&
    first.top < second.bottom - epsilon &&
    first.bottom > second.top + epsilon;
  const outside = (child, parent) =>
    child.left < parent.left - epsilon ||
    child.right > parent.right + epsilon ||
    child.top < parent.top - epsilon ||
    child.bottom > parent.bottom + epsilon;
  const noHorizontalOverflow = (element, label) => {
    if (element.scrollWidth > element.clientWidth + 1) {
      failures.push(
        label + " horizontal overflow: " + element.scrollWidth + " > " + element.clientWidth,
      );
    }
  };

  noHorizontalOverflow(sidebar, "sidebar");
  noHorizontalOverflow(card, "card");
  noHorizontalOverflow(header, "header");
  noHorizontalOverflow(identity, "identity");
  noHorizontalOverflow(title, "title");
  noHorizontalOverflow(checks, "checks");
  noHorizontalOverflow(actions, "actions");

  if (overlaps(rect(identity), rect(state))) {
    failures.push("title and state overlap");
  }

  const cardContent = contentRect(card);
  for (const [label, element] of [
    ["header", header],
    ["identity", identity],
    ["state", state],
    ["checks", checks],
    ["actions", actions],
  ]) {
    if (outside(rect(element), cardContent)) {
      failures.push(label + " exceeds card content box");
    }
  }

  const children = [...card.children]
    .filter((element) => getComputedStyle(element).display !== "none")
    .map(rect);
  for (let index = 1; index < children.length; index += 1) {
    if (children[index - 1].bottom > children[index].top + epsilon) {
      failures.push("card sections " + (index - 1) + " and " + index + " overlap vertically");
    }
  }

  const actionRects = buttons.map(rect);
  for (let firstIndex = 0; firstIndex < buttons.length; firstIndex += 1) {
    noHorizontalOverflow(buttons[firstIndex], "action " + (firstIndex + 1));
    if (outside(actionRects[firstIndex], contentRect(actions))) {
      failures.push("action " + (firstIndex + 1) + " exceeds actions box");
    }
    for (let secondIndex = firstIndex + 1; secondIndex < buttons.length; secondIndex += 1) {
      if (overlaps(actionRects[firstIndex], actionRects[secondIndex])) {
        failures.push("actions " + (firstIndex + 1) + " and " + (secondIndex + 1) + " overlap");
      }
    }
  }

  document.getElementById("out").textContent = JSON.stringify({
    failures,
    sidebarWidth: sidebar.getBoundingClientRect().width,
    actionLabels: buttons.map((button) => button.textContent.trim()),
  });
}
</script>
</body>
</html>`;

  const directory = mkdtempSync(join(tmpdir(), "redwhisk-linked-pr-card-"));
  const filePath = join(directory, "layout.html");
  try {
    writeFileSync(filePath, html);
    const result = spawnSync(
      chromeBinary(),
      [
        "--headless",
        "--disable-gpu",
        "--force-device-scale-factor=1",
        "--window-size=800,900",
        "--virtual-time-budget=3000",
        "--dump-dom",
        filePath,
      ],
      {
        encoding: "utf8",
        timeout: CHROME_MEASUREMENT_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stderr = result.stderr ?? "";
    if (result.error) {
      throw chromeMeasurementError(
        `Chrome ${testCase.name} card measurement failed: ${result.error.message}`,
        stderr,
      );
    }
    if (result.status !== 0) {
      throw chromeMeasurementError(
        `Chrome ${testCase.name} card measurement exited ${result.status}`,
        stderr,
      );
    }
    const match = (result.stdout ?? "").match(
      /<pre id="out">([\s\S]*?)<\/pre>/,
    );
    if (match?.[1] === undefined || match[1] === "") {
      throw chromeMeasurementError(
        `Chrome did not return ${testCase.name} card measurements`,
        stderr,
      );
    }
    const parsed = JSON.parse(match[1]) as CardLayoutMeasurement & {
      sidebarWidth: number;
      actionLabels: string[];
    };
    const metaFailures: string[] = [];
    if (parsed.sidebarWidth !== SIDEBAR_WIDTH) {
      metaFailures.push(
        `sidebar width ${parsed.sidebarWidth}px is not ${SIDEBAR_WIDTH}px`,
      );
    }
    if (
      JSON.stringify(parsed.actionLabels) !==
      JSON.stringify(testCase.expectedActions)
    ) {
      metaFailures.push(
        `actions ${JSON.stringify(parsed.actionLabels)} are not ${JSON.stringify(testCase.expectedActions)}`,
      );
    }
    return {
      failures: [...parsed.failures, ...metaFailures],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function chromeMeasurementError(message: string, stderr: string): Error {
  const detail = stderr.trim();
  return new Error(detail === "" ? message : `${message}\n${detail}`);
}

describe("关联 PR 卡片真实布局", { retry: 1 }, () => {
  for (const testCase of CARD_CASES) {
    it(
      `${testCase.name} 状态在 400px 侧栏内无重叠和无横向溢出`,
      () => {
        expect(measureCard(testCase).failures).toEqual([]);
      },
      CHROME_MEASUREMENT_TIMEOUT_MS,
    );
  }
});
