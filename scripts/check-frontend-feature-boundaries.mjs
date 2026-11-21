#!/usr/bin/env node
// 跨 feature import 存量棘轮。
//
// 规则：src/features/<A> 不得直接导入 src/features/<B> 的内部模块。
// 当前存量依赖允许保留在 allowlist；新增依赖或已消失的 allowlist 条目都会失败。
// 修复依赖后运行 `node scripts/check-frontend-feature-boundaries.mjs --update` 收紧白名单。

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), "..");
const repoRoot = resolve(process.env.FEATURE_BOUNDARY_ROOT ?? defaultRepoRoot);
const allowlistPath = resolve(
  process.env.FEATURE_BOUNDARY_ALLOWLIST ??
    join(repoRoot, "scripts", "frontend-feature-boundary-allowlist.txt"),
);
const featuresRoot = join(repoRoot, "src", "features");
const shouldUpdate = process.argv.includes("--update");

if (!existsSync(featuresRoot)) {
  console.error(`找不到前端 features 目录：${featuresRoot}`);
  process.exit(1);
}

const violations = collectViolations(featuresRoot).sort((left, right) =>
  left.key.localeCompare(right.key),
);

if (shouldUpdate) {
  writeFileSync(allowlistPath, formatAllowlist(violations));
  console.log(
    `已更新跨 feature import allowlist：${violations.length} 条存量依赖`,
  );
  process.exit(0);
}

const allowed = readAllowlist(allowlistPath);
const currentKeys = new Set(violations.map(({ key }) => key));
const added = violations.filter(({ key }) => !allowed.has(key));
const stale = [...allowed].filter((key) => !currentKeys.has(key)).sort();

if (added.length === 0 && stale.length === 0) {
  console.log(
    `跨 feature import 检查通过：${violations.length} 条存量依赖，0 条新增`,
  );
  process.exit(0);
}

console.error("跨 feature import 检查失败。");

if (added.length > 0) {
  console.error(
    "\n新增依赖：请把共享能力下沉到 src/shared 或复用既有公共边界。",
  );
  for (const { source, specifier } of added) {
    console.error(`  - ${source} -> ${specifier}`);
  }
}

if (stale.length > 0) {
  console.error(
    "\nallowlist 中存在已消失的依赖：运行 `node scripts/check-frontend-feature-boundaries.mjs --update` 收紧白名单。",
  );
  for (const key of stale) {
    console.error(`  - ${key}`);
  }
}

process.exit(1);

/**
 * @param {string} root
 * @returns {{ key: string, source: string, specifier: string }[]}
 */
function collectViolations(root) {
  const violationsByKey = new Map();
  for (const filePath of walkTypeScriptFiles(root)) {
    const source = readFileSync(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    visitImports(sourceFile, (specifier) => {
      if (!crossesFeatureBoundary(filePath, specifier)) {
        return;
      }
      const sourcePath = relative(repoRoot, filePath).split(sep).join("/");
      const violation = {
        key: `${sourcePath} -> ${specifier}`,
        source: sourcePath,
        specifier,
      };
      violationsByKey.set(violation.key, violation);
    });
  }
  return [...violationsByKey.values()];
}

/**
 * @param {ts.SourceFile} sourceFile
 * @param {(specifier: string) => void} onSpecifier
 */
function visitImports(sourceFile, onSpecifier) {
  /** @param {ts.Node} node */
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      onSpecifier(node.moduleSpecifier.text);
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      onSpecifier(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

/**
 * @param {string} sourceFile
 * @param {string} specifier
 */
function crossesFeatureBoundary(sourceFile, specifier) {
  const sourceFeature = featureNameForPath(sourceFile);
  const targetPath = resolveImportPath(sourceFile, specifier);
  if (!sourceFeature || !targetPath) {
    return false;
  }
  const targetFeature = featureNameForPath(targetPath);
  return targetFeature !== null && targetFeature !== sourceFeature;
}

/**
 * @param {string} filePath
 * @returns {string | null}
 */
function featureNameForPath(filePath) {
  const relativePath = relative(featuresRoot, filePath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.split(sep)[0] || null;
}

/**
 * @param {string} sourceFile
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveImportPath(sourceFile, specifier) {
  if (specifier.startsWith("@/")) {
    return join(repoRoot, "src", specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return resolve(dirname(sourceFile), specifier);
  }
  return null;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function walkTypeScriptFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...walkTypeScriptFiles(path));
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      files.push(path);
    }
  }
  return files;
}

/**
 * @param {string} path
 * @returns {Set<string>}
 */
function readAllowlist(path) {
  if (!existsSync(path)) {
    console.error(
      `找不到跨 feature import allowlist：${path}\n先生成存量基线：node scripts/check-frontend-feature-boundaries.mjs --update`,
    );
    process.exit(1);
  }
  return new Set(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  );
}

/**
 * @param {{ key: string }[]} violations
 */
function formatAllowlist(violations) {
  return [
    "# 跨 feature import 存量棘轮：只允许删除条目，新增依赖必须下沉到 src/shared。",
    "# 格式：source path -> import specifier",
    ...violations.map(({ key }) => key),
    "",
  ].join("\n");
}
