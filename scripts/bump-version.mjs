#!/usr/bin/env node
// 统一同步 RedWhisk 三处版本号：
//   - package.json
//   - src-tauri/tauri.conf.json
//   - src-tauri/Cargo.toml
// Cargo.lock 在 cargo update 时由 cargo 自动改写。
//
// 用法：
//   pnpm bump-version 0.2.0
//   node scripts/bump-version.mjs 0.2.0

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

const files = {
  packageJson: join(repoRoot, 'package.json'),
  tauriConf: join(repoRoot, 'src-tauri', 'tauri.conf.json'),
  cargoToml: join(repoRoot, 'src-tauri', 'Cargo.toml'),
};

// 仅校验语义化版本主版本.次版本.修订号，允许带预发布后缀（如 -rc.1）
const versionPattern = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

const newVersion = process.argv[2];
if (!newVersion) {
  fail('缺少版本号参数。用法：pnpm bump-version <version>，例如 pnpm bump-version 0.2.0');
}
if (!versionPattern.test(newVersion)) {
  fail(`版本号格式不合法：${newVersion}，应为 x.y.z 或 x.y.z-后缀`);
}

// 前置检查：所有目标文件必须存在
for (const [name, path] of Object.entries(files)) {
  if (!existsSync(path)) {
    fail(`找不到 ${name}：${path}`);
  }
}

// 1. package.json
const pkg = JSON.parse(readFileSync(files.packageJson, 'utf8'));
const oldVersion = pkg.version;
pkg.version = newVersion;
writeFileSync(files.packageJson, `${JSON.stringify(pkg, null, 2)}\n`);

// 2. src-tauri/tauri.conf.json（保持 2 空格缩进 + 末尾换行）
const tauriConf = JSON.parse(readFileSync(files.tauriConf, 'utf8'));
tauriConf.version = newVersion;
writeFileSync(files.tauriConf, `${JSON.stringify(tauriConf, null, 2)}\n`);

// 3. src-tauri/Cargo.toml（只替换 [package] 节内的 version 行）
const cargoContent = readFileSync(files.cargoToml, 'utf8');
const cargoPattern = /(\[package\][\s\S]*?version\s*=\s*)"([^"]+)"/;
if (!cargoPattern.test(cargoContent)) {
  fail(`无法在 ${files.cargoToml} 中定位 [package] 下的 version 字段`);
}
const cargoNext = cargoContent.replace(
  cargoPattern,
  (_, prefix) => `${prefix}"${newVersion}"`,
);
writeFileSync(files.cargoToml, cargoNext);

// 4. 同步 Cargo.lock 中的 redwhisk 条目
const result = spawnSync(
  'cargo',
  ['update', '-p', 'redwhisk', '--precise', newVersion],
  { cwd: join(repoRoot, 'src-tauri'), stdio: 'inherit' },
);
if (result.status !== 0) {
  fail(
    'cargo update 失败，Cargo.lock 未能自动同步；请手动执行 `cd src-tauri && cargo update -p redwhisk --precide ' +
      `${newVersion}` +
      '`',
  );
}

console.log(`✅ 版本号已同步：${oldVersion} → ${newVersion}`);
console.log('  - package.json');
console.log('  - src-tauri/tauri.conf.json');
console.log('  - src-tauri/Cargo.toml');
console.log('  - src-tauri/Cargo.lock（由 cargo update 自动改写）');
