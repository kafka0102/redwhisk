#!/usr/bin/env node
// auto-commit-hook-version: 5.0.0
// Claude Code Hook：
// - PostToolUse：记录 Agent 写入的文件（用于区分"本任务文件"与仓库中无关的 dirty 文件）。
// - Stop：若检测到本任务产生的未提交改动，向 Claude Code 反馈一条提示词
//        （Stop hook 的 decision:block + reason），由 Claude Code 自行按项目
//        提交规范（docs/standards/git-workflow.md）生成 commit message 并执行提交。
//        本脚本自身不生成 message、不执行 git commit，彻底避免规则匹配产出的占位 message。
// 循环防护：用 askedCount 限制连续 block 次数；一旦没有未提交改动即复位计数。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STATE_FILE = path.join(
  os.tmpdir(),
  "redwhisk-claude-auto-commit-state-v5.json",
);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// 连续 block 上限：达到后不再拦截 Stop，避免 Claude 因故未提交时无限循环。
const MAX_BLOCK_COUNT = 2;

const DEFAULT_CONFIG = {
  enabled: true,
  maxFiles: 80,
  commitDirtyFallback: true,
  excludePatterns: [
    "node_modules/",
    "dist/",
    "build/",
    ".git/",
    ".DS_Store",
    "*.log",
    "tmp/",
    "temp/",
  ],
};

main().catch(() => process.exit(0));

async function main() {
  const input = await readStdin();
  if (!input.trim()) {
    return;
  }

  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return;
  }

  const cwd = data.cwd || process.cwd();
  const repoRoot = getRepoRoot(cwd);
  if (!repoRoot) {
    return;
  }

  const stateKey = `${repoRoot}:${data.session_id || "unknown-session"}`;
  const state = loadState(stateKey);

  if (data.hook_event_name === "PostToolUse") {
    handlePostToolUse(data, cwd, repoRoot, state);
    saveState(stateKey, state);
    return;
  }

  if (data.hook_event_name === "Stop") {
    await handleStop(repoRoot, stateKey, state);
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    const timer = setTimeout(() => resolve(input), 5000);

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(input);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(input);
    });
  });
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }

  return result;
}

function getRepoRoot(cwd) {
  try {
    const result = runGit(cwd, ["rev-parse", "--show-toplevel"]);
    return result.stdout.trim();
  } catch {
    return null;
  }
}

function loadState(stateKey) {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return createEmptyState();
    }

    const allStates = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return allStates[stateKey] || createEmptyState();
  } catch {
    return createEmptyState();
  }
}

function saveState(stateKey, state) {
  try {
    let allStates = {};
    if (fs.existsSync(STATE_FILE)) {
      allStates = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }

    allStates[stateKey] = state;
    fs.writeFileSync(STATE_FILE, JSON.stringify(allStates, null, 2));
  } catch {
    // Hook 不能因为状态文件失败影响 Claude Code 主流程。
  }
}

function createEmptyState() {
  return {
    // files: Map<path, { lastModifiedAt, committedAt? }>
    files: {},
    lastWriteAt: null,
    // 连续向 Claude Code 反馈提交提示词的次数；无改动时复位为 0。
    askedCount: 0,
  };
}

function handlePostToolUse(data, cwd, repoRoot, state) {
  if (WRITE_TOOLS.has(data.tool_name)) {
    recordWriteFiles(data, cwd, repoRoot, state);
  }
}

function recordWriteFiles(data, cwd, repoRoot, state) {
  const files = extractToolFiles(data.tool_name, data.tool_input || {});
  const now = new Date().toISOString();

  for (const file of files) {
    const repoRelativePath = toRepoRelativePath(file, cwd, repoRoot);
    if (repoRelativePath) {
      // 记录文件的最后修改时间，但不清空已提交的标记，
      // 这样如果一个文件被提交后又修改，我们还能再次捕获到。
      state.files[repoRelativePath] = {
        lastModifiedAt: now,
        ...(state.files[repoRelativePath] || {}),
      };
    }
  }

  state.lastWriteAt = now;
}

function extractToolFiles(toolName, toolInput) {
  if (toolName === "NotebookEdit") {
    return [toolInput.notebook_path].filter(Boolean);
  }

  if (toolName === "MultiEdit") {
    if (toolInput.edits && Array.isArray(toolInput.edits)) {
      return toolInput.edits.map((e) => e.file_path).filter(Boolean);
    }
  }

  return [toolInput.file_path].filter(Boolean);
}

function toRepoRelativePath(filePath, cwd, repoRoot) {
  const absolutePath = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(cwd, filePath);
  const relativePath = path.relative(repoRoot, absolutePath);

  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return normalizeGitPath(relativePath);
}

async function handleStop(repoRoot, stateKey, state) {
  const config = loadProjectConfig(repoRoot);
  if (!config.enabled) {
    return;
  }

  const statusEntries = getGitStatus(repoRoot);
  if (statusEntries.length === 0) {
    // 没有任何改动：说明上一轮 Claude 已完成提交，复位计数并放行 Stop。
    state.askedCount = 0;
    saveState(stateKey, state);
    return;
  }

  const dirtyFiles = new Set(statusEntries.map((entry) => entry.path));

  // 候选文件：
  //   a) 我们记录过的、当前 dirty 的文件（本任务直接相关）
  //   b) 启用 commitDirtyFallback 时，回退为所有 dirty 文件
  const recordedDirtyFiles = Object.keys(state.files).filter((file) =>
    dirtyFiles.has(file),
  );

  const candidateFiles =
    recordedDirtyFiles.length > 0 || !config.commitDirtyFallback
      ? recordedDirtyFiles
      : Array.from(dirtyFiles);

  const filesToCommit = filterFiles(candidateFiles, config);
  if (filesToCommit.length === 0) {
    return;
  }

  if (config.maxFiles > 0 && filesToCommit.length > config.maxFiles) {
    writeHookLog(
      repoRoot,
      `Skip commit prompt: ${filesToCommit.length} files exceed maxFiles=${config.maxFiles}.`,
    );
    return;
  }

  // 循环防护：连续反馈次数达到上限后不再拦截 Stop，避免无限 block。
  if (state.askedCount >= MAX_BLOCK_COUNT) {
    writeHookLog(
      repoRoot,
      `Skip commit prompt: askedCount=${state.askedCount} reached limit, letting Claude stop.`,
    );
    return;
  }

  state.askedCount += 1;
  saveState(stateKey, state);

  const fileList = filesToCommit.map((f) => `- ${f}`).join("\n");
  const reason = [
    "检测到本次任务存在未提交改动：",
    fileList,
    "",
    "请由你自行完成提交（不要依赖外部脚本生成 message）：",
    "1. 仅 `git add` 上面列出的、与本次任务直接相关的文件，不要混入无关改动；",
    "2. commit message 必须遵循 docs/standards/git-workflow.md 的 Conventional Commits 规范，并准确描述本次任务的真实意图（禁止使用「更新源码」「更新文档」这类泛化措辞）；",
    "3. 提交完成后即可结束本轮回复，无需等待额外确认。",
  ].join("\n");

  writeHookLog(
    repoRoot,
    `Blocking Stop to request commit (${state.askedCount}/${MAX_BLOCK_COUNT}): ${filesToCommit.length} files.`,
  );

  // 通过 Stop hook 的 decision:block + reason 把提示词喂回 Claude Code。
  console.log(JSON.stringify({ decision: "block", reason }));
}

function loadProjectConfig(repoRoot) {
  const configPaths = [
    path.join(repoRoot, ".claude", "auto-commit.json"),
    path.join(repoRoot, ".auto-commit.json"),
  ];

  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        return {
          ...DEFAULT_CONFIG,
          ...JSON.parse(fs.readFileSync(configPath, "utf8")),
        };
      }
    } catch {
      // 配置损坏时回退默认值，避免 Hook 直接失效。
    }
  }

  return DEFAULT_CONFIG;
}

function getGitStatus(repoRoot) {
  const output = runGit(repoRoot, ["status", "--porcelain=v1", "-z"]).stdout;
  if (!output) {
    return [];
  }

  const parts = output.split("\0").filter(Boolean);
  const entries = [];

  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index];
    const status = item.slice(0, 2);
    const filePath = normalizeGitPath(item.slice(3));

    if (status[0] === "R" || status[0] === "C") {
      entries.push({ status, path: filePath });
      index += 1;
    } else {
      entries.push({ status, path: filePath });
    }
  }

  return entries;
}

function filterFiles(files, config) {
  const seen = new Set();
  const result = [];

  for (const file of files) {
    const normalizedFile = normalizeGitPath(file);
    if (
      seen.has(normalizedFile) ||
      isExcluded(normalizedFile, config.excludePatterns || [])
    ) {
      continue;
    }

    seen.add(normalizedFile);
    result.push(normalizedFile);
  }

  return result.sort();
}

function isExcluded(file, excludePatterns) {
  return excludePatterns.some((pattern) => matchesPattern(file, pattern));
}

function matchesPattern(file, pattern) {
  const normalizedPattern = normalizeGitPath(pattern);

  if (normalizedPattern.endsWith("/")) {
    return file.startsWith(normalizedPattern);
  }

  if (normalizedPattern.startsWith("*.")) {
    return file.endsWith(normalizedPattern.slice(1));
  }

  return file === normalizedPattern || file.startsWith(`${normalizedPattern}/`);
}

function writeHookLog(repoRoot, message) {
  try {
    const logPath = path.join(os.tmpdir(), "redwhisk-claude-auto-commit.log");
    const line = `${new Date().toISOString()} [${repoRoot}] ${message}\n`;
    fs.appendFileSync(logPath, line);
  } catch {
    // 日志失败不影响主流程。
  }
}

function normalizeGitPath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}
