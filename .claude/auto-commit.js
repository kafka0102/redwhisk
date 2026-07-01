#!/usr/bin/env node
// auto-commit-hook-version: 4.0.0
// Claude Code Hook：PostToolUse 记录写入文件，允许 Agent 设置 commit message，Stop 在主任务完成后提交改动。
// 关键改进：
// 1. 支持 Agent 显式设置 commit message（优先级最高）
// 2. 跟踪文件变更时间而不是简单清空 state，避免遗漏重复修改的文件
// 3. 结合 git 实际状态而不是只依赖记录的文件列表

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const STATE_FILE = path.join(
  os.tmpdir(),
  "redwhisk-claude-auto-commit-state-v4.json",
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
    handlePostToolUse(data, cwd, repoRoot, state);
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
    // files: Map<path, { lastModifiedAt, committedAt? }>
    files: {},
    // Agent 显式设置的 commit message（优先级最高）
    commitMessage: null,
    lastWriteAt: null,
  };
}

function handlePostToolUse(data, cwd, repoRoot, state) {
  // 1. 检查是否有 Agent 写入了 commit message 文件
  checkForCommitMessageFile(data, cwd, repoRoot, state);

  // 2. 记录写入的文件
  if (WRITE_TOOLS.has(data.tool_name)) {
    recordWriteFiles(data, cwd, repoRoot, state);
  }
}

function checkForCommitMessageFile(data, cwd, repoRoot, state) {
  // 检查是否写入了约定的 commit message 文件
  const toolInput = data.tool_input || {};
  const writtenFile = toolInput.file_path;

  if (writtenFile) {
    const repoRelativePath = toRepoRelativePath(writtenFile, cwd, repoRoot);
    // 检查是否是约定的 commit message 文件
    if (repoRelativePath === ".claude/.commit-message.tmp") {
      try {
        // 读取这个文件的内容作为 commit message
        const content = fs.readFileSync(writtenFile, "utf8").trim();
        if (content) {
          state.commitMessage = content;
        }
        // 删除这个临时文件
        fs.unlinkSync(writtenFile);
      } catch {
        // 读取失败时忽略
      }
    }
  }
}

function recordWriteFiles(data, cwd, repoRoot, state) {
  const files = extractToolFiles(data.tool_name, data.tool_input || {});
  const now = new Date().toISOString();

  for (const file of files) {
    const repoRelativePath = toRepoRelativePath(file, cwd, repoRoot);
    if (repoRelativePath) {
      // 记录文件的最后修改时间，但不清空已提交的标记
      // 这样如果一个文件被提交后又修改，我们可以再次捕获到
      state.files[repoRelativePath] = {
        lastModifiedAt: now,
        // 保留之前的 committedAt（如果有）
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
    // MultiEdit 可能有多个 edits
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

async function commitOnStop(repoRoot, stateKey, state) {
  const config = loadProjectConfig(repoRoot);
  if (!config.enabled) {
    return;
  }

  const statusEntries = getGitStatus(repoRoot);
  if (statusEntries.length === 0) {
    // 没有任何改动，只清理状态中的 committedAt 标记（保留文件记录以防后续修改）
    resetCommittedMarkers(state);
    saveState(stateKey, state);
    return;
  }

  const dirtyFiles = new Set(statusEntries.map((entry) => entry.path));

  // 1. 找出候选文件：
  //    a) 我们记录过的文件中，当前是 dirty 的
  //    b) 或者启用了 commitDirtyFallback 时，所有 dirty 文件
  const recordedDirtyFiles = Object.keys(state.files).filter((file) =>
    dirtyFiles.has(file)
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
    // 没有实际变更（可能是权限变化等）
    return;
  }

  // 优先使用 Agent 设置的 commit message，否则回退到自动生成
  const commitMessage =
    state.commitMessage || generateCommitMessage(filesToCommit, config);

  runGit(repoRoot, ["commit", "-m", commitMessage, "--", ...filesToCommit], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const commitHash = runGit(repoRoot, [
    "rev-parse",
    "--short",
    "HEAD",
  ]).stdout.trim();

  writeHookLog(repoRoot, `Auto commit ${commitHash}: ${commitMessage}`);

  // 标记这些文件已提交，但不删除记录
  // 这样如果文件再次修改，我们还能捕获到
  const now = new Date().toISOString();
  for (const file of filesToCommit) {
    if (state.files[file]) {
      state.files[file].committedAt = now;
    }
  }

  // 清空已使用的 commit message，避免下次重复使用
  state.commitMessage = null;

  saveState(stateKey, state);
}

function resetCommittedMarkers(state) {
  // 重置 committedAt 标记，但保留文件记录
  for (const file of Object.keys(state.files)) {
    delete state.files[file].committedAt;
  }
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

  // 1. 分析文件类型
  const allDocs = files.every((file) => file.endsWith(".md"));
  const allClaudeConfig = files.every(
    (file) => file.startsWith(".claude/") || file === "CLAUDE.md"
  );
  const hasCodeFiles = files.some(
    (file) =>
      file.endsWith(".ts") ||
      file.endsWith(".tsx") ||
      file.endsWith(".js") ||
      file.endsWith(".jsx")
  );
  const hasTestFiles = files.some(
    (file) =>
      file.includes("test") ||
      file.includes("spec") ||
      file.endsWith(".test.ts") ||
      file.endsWith(".test.tsx")
  );

  // 2. 分析文件路径中的特征关键词
  const paths = files.join(" ");
  const isFix = paths.includes("fix") || paths.includes("bug");
  const isPerf = paths.includes("perf") || paths.includes("performance") || paths.includes("优化");
  const isRefactor = paths.includes("refactor") || paths.includes("重构");
  const isFeat = paths.includes("feat") || paths.includes("feature") || paths.includes("新功能");
  const isStyle = paths.includes("style") || paths.includes("样式");
  const isBuild = paths.includes("build") || paths.includes("构建") || paths.includes("package.json") || paths.includes("tsconfig");
  const isCi = paths.includes("ci") || paths.includes(".github/workflows");

  // 3. 尝试从文件路径中提取更具体的描述
  let description = "";

  // 检查 OpenSpec 变更
  if (paths.includes("openspec/changes/")) {
    const match = paths.match(/openspec\/changes\/([^/]+)/);
    if (match && match[1]) {
      const changeName = match[1].replace(/-/g, " ");
      description = `更新 OpenSpec 变更: ${changeName}`;
      return `docs: ${description}`;
    }
  }

  // 检查常见的目录结构
  if (paths.includes("components/")) {
    description = "更新组件";
  } else if (paths.includes("hooks/")) {
    description = "更新 Hooks";
  } else if (paths.includes("utils/") || paths.includes("lib/")) {
    description = "更新工具函数";
  } else if (paths.includes("docs/")) {
    description = "更新文档";
  } else if (paths.includes("src/")) {
    description = "更新源码";
  }

  // 4. 根据文件特征确定 type
  let type = "chore";
  if (allClaudeConfig) {
    type = "chore";
    description = description || "调整 Claude 配置";
  } else if (allDocs) {
    type = "docs";
    description = description || "更新文档";
  } else if (isFeat) {
    type = "feat";
    description = description || "实现新功能";
  } else if (isFix) {
    type = "fix";
    description = description || "修复问题";
  } else if (isPerf) {
    type = "perf";
    description = description || "优化性能";
  } else if (isRefactor) {
    type = "refactor";
    description = description || "重构代码";
  } else if (isStyle) {
    type = "style";
    description = description || "调整样式";
  } else if (isBuild) {
    type = "build";
    description = description || "更新构建配置";
  } else if (isCi) {
    type = "ci";
    description = description || "更新 CI 配置";
  } else if (hasTestFiles) {
    type = "test";
    description = description || "更新测试";
  } else if (hasCodeFiles) {
    type = "refactor";
    description = description || "更新代码";
  } else {
    description = description || "自动提交任务改动";
  }

  return `${type}: ${description}`;
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
