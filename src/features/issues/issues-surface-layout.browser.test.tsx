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

interface ListSpacingMeasurement {
  topGap: number;
  bottomGap: number;
}

interface BoardSpacingMeasurement {
  topGap: number;
  bottomGap: number;
}

interface AvatarMeasurement {
  glyphInsideCircularContent: boolean;
  glyphVisibleBoundsSvg: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  photoObjectFit: string;
}

interface ButtonStateMeasurement {
  background: string;
  border: string;
  color: string;
  contrastRatio: number;
  shadow: string;
}

interface CreateButtonMeasurement {
  accentColor: string;
  accentMutedColor: string;
  appColor: string;
  surfaceColor: string;
  textColor: string;
  base: ButtonStateMeasurement;
  hover: ButtonStateMeasurement;
  focusVisible: boolean;
  focus: ButtonStateMeasurement;
}

interface StatusRowMeasurement {
  withoutError: {
    rowCount: number;
    hasStatusArea: boolean;
  };
  withError: {
    rowCount: number;
    hasStatusArea: boolean;
    statusHeight: number;
    contentBelowStatus: boolean;
  };
}

interface ChangeRequestDetailSurfaceMeasurement {
  parentRowCount: number;
  issueHeaderHeight: number;
  prHeaderHeight: number;
  issueHeaderTop: number;
  prHeaderTop: number;
  issueBodyTopGap: number;
  prBodyTopGap: number;
  prFirstContentGap: number;
  prHeaderBackground: string;
  prPageBackground: string;
  prHeaderBorderBottomWidth: number;
  appColor: string;
  surfaceColor: string;
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
      "Chrome not found. Set CHROME_PATH to measure Issues layout.",
    );
  }
  return found;
}

function stylesheet(): string {
  return [
    "src/app/app.css",
    "src/shared/styles/tokens.css",
    "src/shared/styles/workbench-shell.css",
    "src/shared/styles/issues-board.css",
    "src/shared/styles/issue-detail.css",
    "src/shared/styles/change-request-detail.css",
  ]
    .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
    .join("\n");
}

function measurementHoverStylesheet(): string {
  return stylesheet().replace(
    /\.issue-board-mode__create:hover/g,
    ".issue-board-mode__create[data-measure-hover]",
  );
}

function measureListSpacing(): ListSpacingMeasurement {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${stylesheet()}
html, body { width: 1200px; height: 800px; margin: 0; }
</style>
</head>
<body>
<main class="activity-surface activity-surface--issues">
  <header id="tabs" class="issue-surface-header issue-surface-header--activity">
    <div class="issue-board-tabs" role="tablist" aria-label="board tabs">
      <button class="issue-board-tab" role="tab" aria-selected="true" type="button">Issues</button>
    </div>
  </header>
  <div class="issue-board-mode">
    <div class="issue-board-mode__filters" role="group" aria-label="filters">
      <button class="issue-board-mode__filter" type="button">Open</button>
      <button class="issue-board-mode__filter" type="button">Closed</button>
    </div>
    <div class="issue-board-mode__tools">
      <input class="issue-board-mode__search" aria-label="search" />
      <button class="issue-board-mode__view" type="button">board</button>
      <button class="issue-board-mode__view" type="button">list</button>
      <button id="create" class="issue-board-mode__create" type="button">New Issue</button>
    </div>
  </div>
  <section class="issue-board-list" aria-label="issue list">
    <article class="issue-list-row">
      <button class="issue-list-row__hit" type="button"></button>
      <div class="issue-list-row__top"><span class="issue-list-row__name">Issue one</span></div>
    </article>
  </section>
</main>
<pre id="out"></pre>
<script>
const tabs = document.getElementById("tabs").getBoundingClientRect();
const create = document.getElementById("create").getBoundingClientRect();
const firstRow = document.querySelector(".issue-list-row").getBoundingClientRect();
const round = (value) => Math.round(value * 10) / 10;
document.getElementById("out").textContent = JSON.stringify({
  topGap: round(create.top - tabs.bottom),
  bottomGap: round(firstRow.top - create.bottom),
});
</script>
</body>
</html>`;

  return runChromeMeasurement<ListSpacingMeasurement>(html, "list spacing");
}

function measureBoardSpacing(): BoardSpacingMeasurement {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${stylesheet()}
html, body { width: 1200px; height: 800px; margin: 0; }
</style>
</head>
<body>
<main class="activity-surface activity-surface--issues">
  <header id="tabs" class="issue-surface-header issue-surface-header--activity">
    <div class="issue-board-tabs" role="tablist" aria-label="board tabs">
      <button class="issue-board-tab" role="tab" aria-selected="true" type="button">Issues</button>
    </div>
  </header>
  <div class="issue-board-mode">
    <div></div>
    <div class="issue-board-mode__tools">
      <input class="issue-board-mode__search" aria-label="search" />
      <button class="issue-board-mode__view" type="button">board</button>
      <button class="issue-board-mode__view" type="button">list</button>
      <button id="create" class="issue-board-mode__create" type="button">New Issue</button>
    </div>
  </div>
  <section class="issues-kanban" aria-label="Issues kanban">
    <section class="issue-lane issue-lane--backlog" aria-label="Backlog">
      <div class="issue-lane__header">Backlog</div>
    </section>
  </section>
</main>
<pre id="out"></pre>
<script>
const tabs = document.getElementById("tabs").getBoundingClientRect();
const create = document.getElementById("create").getBoundingClientRect();
const firstLane = document.querySelector(".issue-lane").getBoundingClientRect();
const round = (value) => Math.round(value * 10) / 10;
document.getElementById("out").textContent = JSON.stringify({
  topGap: round(create.top - tabs.bottom),
  bottomGap: round(firstLane.top - create.bottom),
});
</script>
</body>
</html>`;

  return runChromeMeasurement<BoardSpacingMeasurement>(html, "board spacing");
}

function measureAvatar(): AvatarMeasurement {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${stylesheet()}
html, body { margin: 0; }
body { padding: 20px; }
</style>
</head>
<body>
<span class="issue-assignee">
  <span id="avatar" class="issue-assignee__avatar" role="img">
    <svg id="glyph" class="issue-assignee__glyph" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="6.2" fill="currentColor" r="2.1"></circle>
      <path d="M5.2 11.2c.45-1.7 1.4-2.5 2.8-2.5s2.35.8 2.8 2.5c.08.3-.14.55-.42.55H5.62c-.28 0-.5-.25-.42-.55z" fill="currentColor"></path>
    </svg>
  </span>
</span>
<span class="issue-assignee">
  <span class="issue-assignee__avatar" role="img">
    <img id="photo" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" />
  </span>
</span>
<pre id="out"></pre>
<script>
const avatar = document.getElementById("avatar");
const glyph = document.getElementById("glyph");
const avatarRect = avatar.getBoundingClientRect();
const style = getComputedStyle(avatar);
const contentLeft = avatarRect.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
const contentRight = avatarRect.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
const contentTop = avatarRect.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
const contentBottom = avatarRect.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom);
const toScreen = (x, y) => {
  const point = glyph.createSVGPoint();
  point.x = x;
  point.y = y;
  return point.matrixTransform(glyph.getScreenCTM());
};
const circleBox = glyph.querySelector("circle").getBBox();
const pathBox = glyph.querySelector("path").getBBox();
const glyphVisibleBoundsSvg = {
  left: Math.min(circleBox.x, pathBox.x),
  right: Math.max(circleBox.x + circleBox.width, pathBox.x + pathBox.width),
  top: Math.min(circleBox.y, pathBox.y),
  bottom: Math.max(circleBox.y + circleBox.height, pathBox.y + pathBox.height),
};
const contentCenterX = (contentLeft + contentRight) / 2;
const contentCenterY = (contentTop + contentBottom) / 2;
const contentRadius = Math.min(contentRight - contentLeft, contentBottom - contentTop) / 2;
const corners = [
  toScreen(glyphVisibleBoundsSvg.left, glyphVisibleBoundsSvg.top),
  toScreen(glyphVisibleBoundsSvg.right, glyphVisibleBoundsSvg.top),
  toScreen(glyphVisibleBoundsSvg.left, glyphVisibleBoundsSvg.bottom),
  toScreen(glyphVisibleBoundsSvg.right, glyphVisibleBoundsSvg.bottom),
];
document.getElementById("out").textContent = JSON.stringify({
  glyphInsideCircularContent: corners.every((corner) =>
    Math.hypot(corner.x - contentCenterX, corner.y - contentCenterY) <= contentRadius + 0.05,
  ),
  glyphVisibleBoundsSvg,
  photoObjectFit: getComputedStyle(document.getElementById("photo")).objectFit,
});
</script>
</body>
</html>`;

  return runChromeMeasurement<AvatarMeasurement>(html, "avatar");
}

function measureCreateButton(): CreateButtonMeasurement {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${measurementHoverStylesheet()}
html, body { margin: 0; }
body { padding: 20px; }
</style>
</head>
<body>
<div class="issue-board-mode">
  <div></div>
  <div class="issue-board-mode__tools">
    <button id="base" class="issue-board-mode__create" type="button">Base</button>
    <button id="hover" class="issue-board-mode__create" data-measure-hover type="button">Hover</button>
    <button id="focus" class="issue-board-mode__create" type="button">Focus</button>
  </div>
</div>
<pre id="out"></pre>
<script>
const probe = document.createElement("span");
document.body.append(probe);
const tokenColor = (name) => {
  probe.style.color = "var(" + name + ")";
  return getComputedStyle(probe).color;
};
const accentColor = tokenColor("--color-accent");
const accentMutedColor = tokenColor("--color-accent-muted");
const appColor = tokenColor("--color-app");
const surfaceColor = tokenColor("--color-surface");
const textColor = tokenColor("--color-text");
const channels = (color) => color.match(/[\\d.]+/g).slice(0, 3).map(Number);
const luminance = (color) => {
  const [red, green, blue] = channels(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrastRatio = (foreground, background) => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
};
const measureState = (button) => {
  const style = getComputedStyle(button);
  const background = style.backgroundColor;
  const color = style.color;
  return {
    background,
    border: style.borderTopColor,
    color,
    contrastRatio: contrastRatio(color, background),
    shadow: style.boxShadow,
  };
};
const baseButton = document.getElementById("base");
const hoverButton = document.getElementById("hover");
const focusButton = document.getElementById("focus");
const base = measureState(baseButton);
const hover = measureState(hoverButton);
focusButton.focus();
const focus = measureState(focusButton);
document.getElementById("out").textContent = JSON.stringify({
  accentColor,
  accentMutedColor,
  appColor,
  surfaceColor,
  textColor,
  base,
  hover,
  focusVisible: focusButton.matches(":focus-visible"),
  focus,
});
</script>
</body>
</html>`;

  return runChromeMeasurement<CreateButtonMeasurement>(html, "create button");
}

function measureStatusRows(): StatusRowMeasurement {
  const shell = (id: string, withError: boolean) => `
    <main id="${id}" class="activity-surface activity-surface--issues">
      <header class="issue-surface-header issue-surface-header--activity">
        <div class="issue-board-tabs" role="tablist" aria-label="board tabs">
          <button class="issue-board-tab" role="tab" aria-selected="true" type="button">Issues</button>
        </div>
      </header>
      <div class="issue-board-mode">
        <div></div>
        <div class="issue-board-mode__tools">
          <button class="issue-board-mode__create" type="button">New Issue</button>
        </div>
      </div>
      ${withError ? '<p class="issues-status" role="status">Sync failed</p>' : ""}
      <section class="issues-kanban" aria-label="Issues kanban">
        <section class="issue-lane"><div class="issue-lane__header">Backlog</div></section>
      </section>
    </main>
  `;
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${stylesheet()}
html, body { width: 1200px; height: 800px; margin: 0; }
#without-error, #with-error { height: 390px; }
</style>
</head>
<body>
${shell("without-error", false)}
${shell("with-error", true)}
<pre id="out"></pre>
<script>
const inspect = (id) => {
  const surface = document.getElementById(id);
  const areas = getComputedStyle(surface).gridTemplateAreas;
  const rows = getComputedStyle(surface).gridTemplateRows.trim().split(/\\s+/);
  const status = surface.querySelector(".issues-status");
  const kanban = surface.querySelector(".issues-kanban");
  const statusRect = status ? status.getBoundingClientRect() : null;
  const kanbanRect = kanban.getBoundingClientRect();
  return {
    rowCount: rows.length,
    hasStatusArea: areas.includes("status"),
    statusHeight: statusRect ? statusRect.height : 0,
    contentBelowStatus: statusRect ? kanbanRect.top >= statusRect.bottom : true,
  };
};
document.getElementById("out").textContent = JSON.stringify({
  withoutError: inspect("without-error"),
  withError: inspect("with-error"),
});
</script>
</body>
</html>`;

  return runChromeMeasurement<StatusRowMeasurement>(html, "status rows");
}

function measureChangeRequestDetailSurface(): ChangeRequestDetailSurfaceMeasurement {
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${stylesheet()}
html, body { width: 1200px; height: 800px; margin: 0; }
body { padding: 0; }
#surface { height: 390px; }
</style>
</head>
<body>
<main id="surface" class="activity-surface activity-surface--issues">
  <section id="issue" class="issue-page issue-page--readonly issue-page--fullscreen">
    <header id="issue-header" class="issue-surface-header issue-surface-header--fullscreen">
      <div class="issue-detail-heading">
        <button class="issues-button" type="button">Back</button>
        <h2 class="issue-surface-header__title">Issue title</h2>
      </div>
    </header>
    <div id="issue-body" class="issue-page__body issue-page__body--readonly-fullscreen">
      <div class="issue-page__content-shell issue-page__content-shell--readonly">
        <div>Issue content</div>
      </div>
    </div>
  </section>
  <section id="pr" class="issue-page issue-page--fullscreen change-request-detail">
    <header id="pr-header" class="issue-surface-header issue-surface-header--fullscreen">
      <div class="issue-detail-heading change-request-detail__heading">
        <button class="issues-button" type="button">Back</button>
        <h2 class="issue-surface-header__title">PR title</h2>
      </div>
    </header>
    <div id="pr-body" class="issue-page__body issue-page__body--fullscreen">
      <div class="issue-page__content-shell change-request-detail__content">
        <div id="pr-first">PR content</div>
      </div>
    </div>
  </section>
</main>
<pre id="out"></pre>
<script>
const surface = document.getElementById("surface");
const issueHeader = document.getElementById("issue-header");
const prHeader = document.getElementById("pr-header");
const issueBody = document.getElementById("issue-body");
const prBody = document.getElementById("pr-body");
const prFirst = document.getElementById("pr-first");
const round = (value) => Math.round(value * 10) / 10;
const probe = document.createElement("span");
document.body.append(probe);
const tokenColor = (name) => {
  probe.style.color = "var(" + name + ")";
  return getComputedStyle(probe).color;
};
const surfaceRect = surface.getBoundingClientRect();
const issueHeaderRect = issueHeader.getBoundingClientRect();
const prHeaderRect = prHeader.getBoundingClientRect();
const issueBodyRect = issueBody.getBoundingClientRect();
const prBodyRect = prBody.getBoundingClientRect();
document.getElementById("out").textContent = JSON.stringify({
  parentRowCount: getComputedStyle(surface).gridTemplateRows.trim().split(/\\s+/).length,
  issueHeaderHeight: round(issueHeaderRect.height),
  prHeaderHeight: round(prHeaderRect.height),
  issueHeaderTop: round(issueHeaderRect.top - surfaceRect.top),
  prHeaderTop: round(prHeaderRect.top - surfaceRect.top),
  issueBodyTopGap: round(issueBodyRect.top - issueHeaderRect.bottom),
  prBodyTopGap: round(prBodyRect.top - prHeaderRect.bottom),
  prFirstContentGap: round(prFirst.getBoundingClientRect().top - prHeaderRect.bottom),
  prHeaderBackground: getComputedStyle(prHeader).backgroundColor,
  prPageBackground: getComputedStyle(document.getElementById("pr")).backgroundColor,
  prHeaderBorderBottomWidth: parseFloat(getComputedStyle(prHeader).borderBottomWidth),
  appColor: tokenColor("--color-app"),
  surfaceColor: tokenColor("--color-surface"),
});
</script>
</body>
</html>`;

  return runChromeMeasurement<ChangeRequestDetailSurfaceMeasurement>(
    html,
    "change request detail surface",
  );
}

function runChromeMeasurement<T>(html: string, label: string): T {
  const directory = mkdtempSync(join(tmpdir(), "redwhisk-issues-layout-"));
  const filePath = join(directory, "layout.html");
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
        `Chrome ${label} measurement failed: ${result.error.message}`,
        stderr,
      );
    }
    if (result.status !== 0) {
      throw chromeMeasurementError(
        `Chrome ${label} measurement exited ${result.status}`,
        stderr,
      );
    }
    const match = (result.stdout ?? "").match(
      /<pre id="out">([\s\S]*?)<\/pre>/,
    );
    if (match?.[1] === undefined || match[1] === "") {
      throw chromeMeasurementError(
        `Chrome did not return ${label} measurements`,
        stderr,
      );
    }
    return JSON.parse(match[1]) as T;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function chromeMeasurementError(message: string, stderr: string): Error {
  const detail = stderr.trim();
  return new Error(detail === "" ? message : `${message}\n${detail}`);
}

describe("Issues surface layout", { retry: 1 }, () => {
  it(
    "keeps compact vertical spacing around the create action in list mode",
    () => {
      const spacing = measureListSpacing();

      expect(spacing.topGap, "create button top gap").toBeGreaterThanOrEqual(9);
      expect(spacing.topGap, "create button top gap").toBeLessThanOrEqual(11);
      expect(
        spacing.bottomGap,
        "create button bottom gap",
      ).toBeGreaterThanOrEqual(15);
      expect(spacing.bottomGap, "create button bottom gap").toBeLessThanOrEqual(
        17,
      );
    },
    CHROME_MEASUREMENT_TIMEOUT_MS,
  );

  it(
    "keeps compact vertical spacing around the create action in board mode",
    () => {
      const spacing = measureBoardSpacing();

      expect(spacing.topGap, "create button top gap").toBeGreaterThanOrEqual(6);
      expect(spacing.topGap, "create button top gap").toBeLessThanOrEqual(8);
      expect(
        spacing.bottomGap,
        "create button bottom gap",
      ).toBeGreaterThanOrEqual(9);
      expect(spacing.bottomGap, "create button bottom gap").toBeLessThanOrEqual(
        11,
      );
    },
    CHROME_MEASUREMENT_TIMEOUT_MS,
  );

  it(
    "keeps the default avatar visible geometry centered inside the circular content area",
    () => {
      const avatar = measureAvatar();

      const { left, right, top, bottom } = avatar.glyphVisibleBoundsSvg;
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;

      expect(avatar.glyphInsideCircularContent).toBe(true);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(16);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(16);
      expect(Math.hypot(centerX - 8, centerY - 8)).toBeLessThanOrEqual(0.5);
      expect(avatar.photoObjectFit).toBe("cover");
    },
    CHROME_MEASUREMENT_TIMEOUT_MS,
  );

  it(
    "keeps accent tokens and WCAG contrast across create button states",
    () => {
      const button = measureCreateButton();

      expect(button.base.background).toBe(button.accentColor);
      expect(button.base.border).toBe(button.accentColor);
      expect(button.base.color).toBe(button.appColor);
      expect(button.base.contrastRatio).toBeGreaterThanOrEqual(4.5);
      expect(button.hover.background).not.toBe(button.base.background);
      expect(button.hover.background).toBe(button.accentMutedColor);
      expect(button.hover.border).toBe(button.accentColor);
      expect(button.hover.color).toBe(button.textColor);
      expect(button.hover.background).not.toBe(button.surfaceColor);
      expect(button.hover.contrastRatio).toBeGreaterThanOrEqual(4.5);
      expect(button.focusVisible).toBe(true);
      expect(button.focus.background).toBe(button.accentColor);
      expect(button.focus.border).toBe(button.accentColor);
      expect(button.focus.color).toBe(button.appColor);
      expect(button.focus.contrastRatio).toBeGreaterThanOrEqual(4.5);
      expect(button.focus.shadow).not.toBe("none");
    },
    CHROME_MEASUREMENT_TIMEOUT_MS,
  );

  it(
    "reserves the status row only when a page error is visible",
    () => {
      const status = measureStatusRows();

      expect(status.withoutError.rowCount).toBe(3);
      expect(status.withoutError.hasStatusArea).toBe(false);
      expect(status.withError.rowCount).toBe(4);
      expect(status.withError.hasStatusArea).toBe(true);
      expect(status.withError.statusHeight).toBeGreaterThan(0);
      expect(status.withError.contentBelowStatus).toBe(true);
    },
    CHROME_MEASUREMENT_TIMEOUT_MS,
  );

  it(
    "aligns the change request detail surface with the issue detail surface",
    () => {
      const surface = measureChangeRequestDetailSurface();

      expect(surface.parentRowCount).toBe(1);
      expect(surface.prHeaderHeight).toBe(surface.issueHeaderHeight);
      expect(surface.prHeaderTop).toBe(surface.issueHeaderTop);
      expect(surface.prHeaderTop).toBe(0);
      expect(surface.prBodyTopGap).toBe(0);
      expect(surface.issueBodyTopGap).toBe(0);
      expect(surface.prFirstContentGap).toBeGreaterThan(0);
      expect(surface.prFirstContentGap).toBeLessThanOrEqual(22);
      expect(surface.prHeaderBackground).toBe(surface.surfaceColor);
      expect(surface.prPageBackground).toBe(surface.appColor);
      expect(surface.prHeaderBorderBottomWidth).toBe(1);
    },
    CHROME_MEASUREMENT_TIMEOUT_MS,
  );
});
