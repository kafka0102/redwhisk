#!/usr/bin/env node
// auto-commit-hook-version: 3.0.0
// Claude Code Hook：PostToolUse 记录写入文件，Stop 在主任务完成后提交改动。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STATE_FILE = path.join(
  os.tmpdir(),
  "redwhisk-claude-auto-commit-state-v3.json",
);
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const DEFAULT_CONFIG = {
  enabled: true,
  maxFiles: 80,
  commitDirtyFallback: true,
  useChineseDescription: true,
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
    recordWriteFiles(data, cwd, repoRoot, state);
    saveState(stateKey, state);
    return;
  }

  if (data.hook_event_name === "Stop") {
    await commitOnStop(repoRoot, stateKey, state);
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

function clearState(stateKey) {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return;
    }

    const allStates = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    delete allStates[stateKey];
    fs.writeFileSync(STATE_FILE, JSON.stringify(allStates, null, 2));
  } catch {
    // 忽略清理失败。
  }
}

function createEmptyState() {
  return {
    files: [],
    lastWriteAt: null,
  };
}

function recordWriteFiles(data, cwd, repoRoot, state) {
  if (!WRITE_TOOLS.has(data.tool_name)) {
    return;
  }

  const files = extractToolFiles(data.tool_name, data.tool_input || {});
  const currentFiles = new Set(state.files || []);

  for (const file of files) {
    const repoRelativePath = toRepoRelativePath(file, cwd, repoRoot);
    if (repoRelativePath) {
      currentFiles.add(repoRelativePath);
    }
  }

  state.files = Array.from(currentFiles).sort();
  state.lastWriteAt = new Date().toISOString();
}

function extractToolFiles(toolName, toolInput) {
  if (toolName === "NotebookEdit") {
    return [toolInput.notebook_path].filter(Boolean);
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

async function commitOnStop(repoRoot, stateKey, state) {
  const config = loadProjectConfig(repoRoot);
  if (!config.enabled) {
    return;
  }

  const statusEntries = getGitStatus(repoRoot);
  if (statusEntries.length === 0) {
    clearState(stateKey);
    return;
  }

  const dirtyFiles = new Set(statusEntries.map((entry) => entry.path));
  const recordedDirtyFiles = (state.files || []).filter((file) =>
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
      `Skip auto commit: ${filesToCommit.length} files exceed maxFiles=${config.maxFiles}.`,
    );
    return;
  }

  runGit(repoRoot, ["add", "--", ...filesToCommit]);

  const diffResult = runGit(
    repoRoot,
    ["diff", "--cached", "--quiet", "--", ...filesToCommit],
    {
      allowFailure: true,
    },
  );
  if (diffResult.status === 0) {
    return;
  }

  const commitMessage = generateCommitMessage(filesToCommit, config);
  runGit(repoRoot, ["commit", "-m", commitMessage, "--", ...filesToCommit], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const commitHash = runGit(repoRoot, [
    "rev-parse",
    "--short",
    "HEAD",
  ]).stdout.trim();
  writeHookLog(`Auto commit ${commitHash}: ${commitMessage}`);
  clearState(stateKey);
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

function generateCommitMessage(files, config) {
  if (config.commitMessage) {
    return config.commitMessage;
  }

  if (!config.useChineseDescription) {
    return "chore: auto commit Claude task changes";
  }

  if (
    files.every((file) => file.startsWith(".claude/") || file === "CLAUDE.md")
  ) {
    return "chore: 调整 Claude 自动提交配置";
  }

  if (files.every((file) => file.endsWith(".md"))) {
    return "docs: 自动提交任务文档改动";
  }

  return "chore: 自动提交 Claude 任务改动";
}

function writeHookLog(message) {
  try {
    const logPath = path.join(os.tmpdir(), "redwhisk-claude-auto-commit.log");
    const line = `${new Date().toISOString()} ${message}\n`;
    fs.appendFileSync(logPath, line);
  } catch {
    // 日志失败不影响主流程。
  }
}

function normalizeGitPath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}
