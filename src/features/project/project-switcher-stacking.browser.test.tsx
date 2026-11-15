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
import { describe, expect, it } from "vitest";

const CHROME_MEASUREMENT_TIMEOUT_MS = 20_000;

interface StackingProbe {
  label: string;
  overlapped: boolean;
  triggerInside: boolean;
  popoverInside: boolean;
  overlayInside: boolean;
  popoverTop: string;
}

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
      "Chrome not found. Set CHROME_PATH so project switcher stacking can be measured.",
    );
  }
  return found;
}

function stylesheet(): string {
  return [
    "src/shared/styles/tokens.css",
    "src/shared/styles/workbench-shell.css",
    "src/shared/styles/project-switcher.css",
    "src/shared/styles/issues-board.css",
    "src/shared/styles/issue-detail.css",
  ]
    .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
    .join("\n");
}

function probeSwitcherStacking(): StackingProbe[] {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${stylesheet()}
html, body { margin: 0; height: 100%; }
</style>
</head>
<body>
<div id="root"></div>
<pre id="out"></pre>
<script>
function shell(contentClass, contentHtml, withOverlay) {
  return '<div class="app-shell">' +
    '<nav class="activity-bar"></nav>' +
    '<section class="workbench">' +
      '<header class="workbench__header" data-tauri-drag-region>' +
        '<div class="project-switcher">' +
          '<button class="project-switcher__trigger" type="button">rumengling</button>' +
          '<div class="project-switcher__popover" role="menu">' +
            '<div class="project-switcher__list">' +
              '<button class="project-switcher__item" type="button">Other project</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</header>' +
      '<div class="workbench__content">' +
        '<main class="' + contentClass + '">' + contentHtml + '</main>' +
      '</div>' +
    '</section>' +
  '</div>' +
  (withOverlay ? '<div class="issue-dialog-overlay" id="overlay"></div>' : '');
}
function probe(label, contentClass, contentHtml, withOverlay) {
  const root = document.getElementById("root");
  root.innerHTML = shell(contentClass, contentHtml, withOverlay);
  const popover = root.querySelector(".project-switcher__popover");
  const trigger = root.querySelector(".project-switcher__trigger");
  const issue = root.querySelector(".issue-page");
  const rect = popover.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const x = Math.round(rect.left + 30);
  const y = Math.round(rect.top + Math.min(30, rect.height / 2));
  const popoverTop = document.elementFromPoint(x, y);
  const triggerTop = document.elementFromPoint(
    Math.round(triggerRect.left + 8),
    Math.round(triggerRect.top + triggerRect.height / 2),
  );
  const issueRect = issue ? issue.getBoundingClientRect() : null;
  const overlay = document.getElementById("overlay");
  return {
    label: label,
    overlapped: !!(
      issueRect &&
      x >= issueRect.left &&
      x <= issueRect.right &&
      y >= issueRect.top &&
      y <= issueRect.bottom
    ),
    triggerInside: !!(triggerTop && trigger.contains(triggerTop)),
    popoverInside: !!(popoverTop && popover.contains(popoverTop)),
    overlayInside: !!(overlay && popoverTop && overlay.contains(popoverTop)),
    popoverTop: popoverTop
      ? (popoverTop.id || String(popoverTop.className) || popoverTop.tagName)
      : "none",
  };
}
const edit = '<form class="issue-page issue-page--editable issue-page--fullscreen">edit</form>';
const readonly = '<form class="issue-page issue-page--readonly issue-page--fullscreen">detail</form>';
const surface = "activity-surface activity-surface--issues";
const results = [
  probe("edit", surface + " activity-surface--issues-form", edit, false),
  probe("readonly", surface, readonly, false),
  probe("board", surface, '<div class="issues-kanban">board</div>', false),
  probe("overlay", surface + " activity-surface--issues-form", edit, true),
];
document.getElementById("out").textContent = JSON.stringify(results);
</script>
</body>
</html>`;

  const directory = mkdtempSync(join(tmpdir(), "redwhisk-switcher-"));
  const filePath = join(directory, "stacking.html");
  try {
    writeFileSync(filePath, html);
    const result = spawnSync(
      chromeBinary(),
      [
        "--headless",
        "--disable-gpu",
        "--window-size=1200,800",
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
        `Chrome measurement failed: ${result.error.message}`,
        stderr,
      );
    }
    if (result.status !== 0) {
      throw chromeMeasurementError(`Chrome exited ${result.status}`, stderr);
    }
    const match = (result.stdout ?? "").match(
      /<pre id="out">([\s\S]*?)<\/pre>/,
    );
    if (match?.[1] === undefined || match[1] === "") {
      throw chromeMeasurementError(
        "Chrome did not return switcher stacking measurements",
        stderr,
      );
    }
    return JSON.parse(match[1]) as StackingProbe[];
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function chromeMeasurementError(message: string, stderr: string): Error {
  const detail = stderr.trim();
  return new Error(detail === "" ? message : `${message}\n${detail}`);
}

function probeNamed(probes: StackingProbe[], label: string): StackingProbe {
  const probe = probes.find((item) => item.label === label);
  if (probe === undefined) {
    throw new Error(`missing stacking probe: ${label}`);
  }
  return probe;
}

describe("项目切换器在 Issue 页上的层叠", { retry: 1 }, () => {
  it(
    "详情和编辑页打开时，下拉列表仍在页面之上，模态层仍盖住下拉",
    () => {
      const probes = probeSwitcherStacking();
      for (const label of ["edit", "readonly"]) {
        const probe = probeNamed(probes, label);
        expect(probe.overlapped, probe.popoverTop).toBe(true);
        expect(probe.triggerInside, probe.popoverTop).toBe(true);
        expect(probe.popoverInside, probe.popoverTop).toBe(true);
      }

      const board = probeNamed(probes, "board");
      expect(board.popoverInside, board.popoverTop).toBe(true);

      const overlay = probeNamed(probes, "overlay");
      expect(overlay.overlayInside, overlay.popoverTop).toBe(true);
      expect(overlay.popoverInside, overlay.popoverTop).toBe(false);
    },
    CHROME_MEASUREMENT_TIMEOUT_MS,
  );
});
