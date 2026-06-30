#!/usr/bin/env node
// auto-commit-hook-version: 2.0.0
// 智能自动提交 Hook - 遵循项目 Git 工作流规范
//
// 工作原理:
// 1. 跟踪 Agent 的工具使用模式
// 2. 检测任务完成信号（连续非写操作 + 时间间隔）
// 3. 遵循项目 CLAUDE.md 中的 Git Commit Rule
// 4. 只提交与当前任务直接相关的文件
// 5. 自动生成符合规范的 commit message

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// 配置参数
const TASK_COMPLETE_SILENCE_MS = 8000; // 8秒无操作视为任务完成
const STATE_FILE = path.join(os.tmpdir(), 'claude-auto-commit-state-v2.json');
const MAX_FILES_PER_COMMIT = 30;

// 工具分类
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'DeleteFile']);
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const TASK_END_TOOLS = new Set(['SendMessage', 'TaskUpdate']); // 任务结束信号

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 10000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    handleHook(data);
  } catch (e) {
    process.exit(0);
  }
});

function handleHook(data) {
  const sessionId = data.session_id;
  const toolName = data.tool_name;
  const cwd = data.cwd || process.cwd();
  const hookEventName = data.hook_event_name;

  // 只在 PostToolUse 事件处理
  if (hookEventName !== 'PostToolUse') {
    return;
  }

  // 检查是否是 git 仓库
  if (!isGitRepo(cwd)) {
    return;
  }

  // 加载或初始化状态
  const state = loadState(sessionId);

  // 更新工具使用记录
  state.toolHistory = state.toolHistory || [];
  state.toolHistory.push({
    tool: toolName,
    timestamp: Date.now()
  });

  // 只保留最近的工具记录
  if (state.toolHistory.length > 20) {
    state.toolHistory = state.toolHistory.slice(-20);
  }

  // 如果是写操作，标记有未提交改动
  if (WRITE_TOOLS.has(toolName)) {
    state.hasUncommittedChanges = true;
    state.lastWriteTime = Date.now();
  }

  // 检查是否满足自动提交条件
  if (shouldAutoCommit(state, toolName)) {
    performAutoCommit(cwd, state, data);
  }

  // 保存状态
  saveState(sessionId, state);
}

function isGitRepo(cwd) {
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

function loadState(sessionId) {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const allStates = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return allStates[sessionId] || {
        toolHistory: [],
        hasUncommittedChanges: false,
        lastWriteTime: 0,
        lastCommitHash: null
      };
    }
  } catch (e) {
    // 忽略错误
  }
  return {
    toolHistory: [],
    hasUncommittedChanges: false,
    lastWriteTime: 0,
    lastCommitHash: null
  };
}

function saveState(sessionId, state) {
  try {
    let allStates = {};
    if (fs.existsSync(STATE_FILE)) {
      allStates = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    allStates[sessionId] = state;
    fs.writeFileSync(STATE_FILE, JSON.stringify(allStates, null, 2));
  } catch (e) {
    // 忽略错误
  }
}

function shouldAutoCommit(state, currentTool) {
  // 如果没有未提交的改动，不提交
  if (!state.hasUncommittedChanges) {
    return false;
  }

  const now = Date.now();
  const timeSinceLastWrite = now - state.lastWriteTime;

  // 条件1: 距离上次写操作足够长时间
  const hasEnoughSilence = timeSinceLastWrite >= TASK_COMPLETE_SILENCE_MS;

  // 条件2: 最近的工具是非写操作（表示 Agent 在总结/完成任务）
  const recentTools = state.toolHistory.slice(-3).map(t => t.tool);
  const isInReadPhase = recentTools.every(t => !WRITE_TOOLS.has(t));

  // 条件3: 有任务结束信号工具
  const hasTaskEndSignal = recentTools.some(t => TASK_END_TOOLS.has(t));

  return hasEnoughSilence && isInReadPhase;
}

function getGitStatus(cwd) {
  try {
    const output = execSync('git status --porcelain', { cwd, encoding: 'utf8' });
    const lines = output.trim().split('\n').filter(Boolean);

    const result = {
      modified: [],      // 已修改但未暂存
      untracked: [],     // 未跟踪
      staged: [],        // 已暂存
      deleted: []        // 已删除
    };

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);

      if (status === '??') {
        result.untracked.push(file);
      } else if (status === ' D' || status === 'D ') {
        result.deleted.push(file);
      } else if (status[0] !== ' ') {
        result.staged.push(file);
      } else {
        result.modified.push(file);
      }
    }

    return result;
  } catch (e) {
    return { modified: [], untracked: [], staged: [], deleted: [] };
  }
}

function performAutoCommit(cwd, state, data) {
  try {
    // 获取 git 状态
    const gitStatus = getGitStatus(cwd);

    // 收集所有待提交的文件
    const allChangedFiles = [
      ...gitStatus.modified,
      ...gitStatus.untracked,
      ...gitStatus.deleted
    ];

    if (allChangedFiles.length === 0) {
      state.hasUncommittedChanges = false;
      return;
    }

    // 加载项目配置
    const projectConfig = loadProjectConfig(cwd);

    // 过滤文件（排除不需要提交的）
    const filesToCommit = filterFiles(allChangedFiles, projectConfig);

    if (filesToCommit.length === 0) {
      state.hasUncommittedChanges = false;
      return;
    }

    // 生成 commit message
    const commitMessage = generateCommitMessage(filesToCommit, projectConfig);

    // 执行 git add
    for (const file of filesToCommit) {
      try {
        execSync(`git add "${file}"`, { cwd, stdio: 'ignore' });
      } catch (e) {
        // 单个文件失败不影响其他文件
      }
    }

    // 执行 git commit
    execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd, stdio: 'ignore' });

    // 获取新的 commit hash
    const commitHash = execSync('git rev-parse HEAD', { cwd, encoding: 'utf8' }).trim();

    // 更新状态
    state.hasUncommittedChanges = false;
    state.lastCommitHash = commitHash;
    state.lastCommitTime = Date.now();

    // 返回成功信息给 Agent
    const output = {
      hookSpecificOutput: {
        additionalContext: `✅ 自动提交成功！\n\nCommit: ${commitHash}\nMessage: ${commitMessage}\n\n已提交 ${filesToCommit.length} 个文件：\n${filesToCommit.slice(0, 10).map(f => '  - ' + f).join('\n')}${filesToCommit.length > 10 ? `\n  ... 还有 ${filesToCommit.length - 10} 个文件` : ''}`
      }
    };
    process.stdout.write(JSON.stringify(output));
  } catch (e) {
    // 提交失败，重置状态避免重复尝试
    state.hasUncommittedChanges = false;
  }
}

function loadProjectConfig(cwd) {
  // 尝试读取项目配置文件
  const configPaths = [
    path.join(cwd, '.claude', 'auto-commit.json'),
    path.join(cwd, '.auto-commit.json')
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (e) {
        continue;
      }
    }
  }

  // 默认配置（遵循 RedWhisk 项目规范）
  return {
    maxFiles: MAX_FILES_PER_COMMIT,
    excludePatterns: [
      'node_modules/',
      'dist/',
      'build/',
      '.git/',
      '.DS_Store',
      '*.log',
      'tmp/',
      'temp/'
    ],
    // 按照 Git 工作流规范，使用中文描述
    useChineseDescription: true
  };
}

function filterFiles(files, config) {
  const excludePatterns = config.excludePatterns || [];
  const maxFiles = config.maxFiles || MAX_FILES_PER_COMMIT;

  return files.filter(file => {
    for (const pattern of excludePatterns) {
      if (file.includes(pattern)) {
        return false;
      }
    }
    return true;
  }).slice(0, maxFiles);
}

function generateCommitMessage(files, config) {
  // 分析文件类型
  const stats = {
    hasTs: false,
    hasTsx: false,
    hasJs: false,
    hasJsx: false,
    hasDocs: false,
    hasTests: false,
    hasConfig: false,
    hasStyles: false
  };

  for (const file of files) {
    if (file.endsWith('.ts')) stats.hasTs = true;
    else if (file.endsWith('.tsx')) stats.hasTsx = true;
    else if (file.endsWith('.js')) stats.hasJs = true;
    else if (file.endsWith('.jsx')) stats.hasJsx = true;
    else if (file.endsWith('.md') || file.includes('docs/')) stats.hasDocs = true;
    else if (file.includes('test') || file.includes('spec')) stats.hasTests = true;
    else if (file.endsWith('.json') || file.endsWith('.config.')) stats.hasConfig = true;
    else if (file.endsWith('.css') || file.endsWith('.scss') || file.endsWith('.less')) stats.hasStyles = true;
  }

  // 确定 commit type
  let type = 'chore';
  let description = '自动提交代码改动';

  if (stats.hasTests) {
    type = 'test';
    description = '更新测试文件';
  } else if (stats.hasDocs) {
    type = 'docs';
    description = '更新文档';
  } else if (stats.hasTs || stats.hasTsx || stats.hasJs || stats.hasJsx) {
    // 进一步区分是 fix、feat 还是 refactor
    const hasFeatureFiles = files.some(f =>
      f.includes('feature') || f.includes('component') || f.includes('page')
    );
    if (hasFeatureFiles) {
      type = 'feat';
      description = '实现新功能或更新组件';
    } else {
      type = 'fix';
      description = '修复问题或优化代码';
    }
  } else if (stats.hasStyles) {
    type = 'style';
    description = '更新样式文件';
  } else if (stats.hasConfig) {
    type = 'chore';
    description = '更新配置文件';
  }

  // 如果文件数量少，可以更具体
  if (files.length === 1) {
    const fileName = path.basename(files[0]);
    description = `更新 ${fileName}`;
  } else if (files.length <= 3) {
    const names = files.slice(0, 2).map(f => path.basename(f));
    description = `更新 ${names.join('、')} 等 ${files.length} 个文件`;
  }

  return `${type}: ${description}`;
}
