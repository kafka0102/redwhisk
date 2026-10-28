import { execFileSync } from "node:child_process";
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
import { describe, expect, it } from "vitest";

import { AgentMarkdown } from "./agent-markdown";

const SHORT_TABLE = `| 环节 | 结果 |
| --- | --- |
| 索引 | 短 |`;

const LONG_TOKEN = "a".repeat(80);

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
      "Chrome not found. Set CHROME_PATH so table layout can be measured.",
    );
  }
  return found;
}

function measureTables(): {
  short: { lines: number; contentCh: number }[];
  long: { lines: number; contentCh: number };
} {
  const css = readFileSync(
    resolve(process.cwd(), "src/shared/styles/message-stream.css"),
    "utf8",
  );
  const shortHtml = renderToStaticMarkup(
    <AgentMarkdown>{SHORT_TABLE}</AgentMarkdown>,
  );
  const longHtml = renderToStaticMarkup(
    <AgentMarkdown>{`| x |\n| --- |\n| ${LONG_TOKEN} |`}</AgentMarkdown>,
  );
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${css}
body { margin: 0; }
.measure-root { width: 900px; word-break: break-word; font: 16px/1.5 sans-serif; }
</style>
</head>
<body>
<div class="measure-root">
  <div id="short">${shortHtml}</div>
  <div id="long">${longHtml}</div>
</div>
<pre id="out"></pre>
<script>
function measure(el) {
  const style = getComputedStyle(el);
  const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0);
  const probe = document.createElement("span");
  probe.textContent = "0";
  el.appendChild(probe);
  const ch = probe.getBoundingClientRect().width || 1;
  probe.remove();
  return {
    lines: rects.length,
    contentCh: (el.clientWidth - pad) / ch,
  };
}
const short = [...document.querySelectorAll("#short th, #short td")].map(measure);
const longCell = document.querySelector("#long td");
document.getElementById("out").textContent = JSON.stringify({
  short,
  long: measure(longCell),
});
</script>
</body>
</html>`;

  const directory = mkdtempSync(join(tmpdir(), "redwhisk-table-"));
  const filePath = join(directory, "table.html");
  try {
    writeFileSync(filePath, html);
    const stdout = execFileSync(
      chromeBinary(),
      [
        "--headless",
        "--disable-gpu",
        "--virtual-time-budget=3000",
        "--dump-dom",
        filePath,
      ],
      { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const match = stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/);
    if (match?.[1] === undefined) {
      throw new Error("Chrome did not return table measurements");
    }
    return JSON.parse(match[1]) as {
      short: { lines: number; contentCh: number }[];
      long: { lines: number; contentCh: number };
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("助手消息表格的真实列宽", () => {
  it("短列保持一行，超长标识符在封顶宽度内换行", () => {
    const measured = measureTables();

    expect(measured.short).toHaveLength(4);
    for (const cell of measured.short) {
      expect(cell.lines).toBe(1);
      expect(cell.contentCh).toBeGreaterThan(3);
      expect(cell.contentCh).toBeLessThan(8);
    }
    expect(measured.long.lines).toBeGreaterThan(1);
    expect(measured.long.contentCh).toBeGreaterThan(68);
    expect(measured.long.contentCh).toBeLessThan(76);
  });
});
