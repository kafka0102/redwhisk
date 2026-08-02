---
name: release-tag
description: 升级 RedWhisk 版本号、提交版本改动、创建 v* tag 并 push 触发 GitHub Actions；跳过本地 format/lint/typecheck/test/build。Use when the user asks to 发版、升版本、打 tag、push tag、轻量发版、release without build/test, or tag-only release.
---

# Release Tag（轻量发版）

只做：`bump-version` → 提交版本文件 → `v<version>` tag → push 分支与 tag。  
**不**跑本地 format / lint / typecheck / test / build / `build:macos`。构建与 draft Release 交给 CI。

完整本地构建发版走 `pnpm release:version`（`scripts/release-version.sh`），不在本 skill 范围。

## 前置（缺一不可）

1. 用户已给出目标版本（`x.y.z` 或 `x.y.z-后缀`），或明确授权推导下一版本。
2. 用户已明确要求 push tag（对外可见；不得静默 push）。
3. 工作区干净（`git status --porcelain` 为空）。
4. 当前不在 detached HEAD；`origin` 已配置。
5. 本地与远端均不存在 `v<version>` tag。

版本未定时：读取 `package.json` 的 `version`，向用户确认下一版本后再继续。

## 执行

### 推荐：脚本

```bash
pnpm release:tag <version>
# 等价
bash scripts/release-tag.sh <version>
```

脚本已封装门禁与推送顺序；优先用它，避免手误漏推分支或漏同步 `Cargo.lock`。

### 手工分步（脚本不可用时）

严格按序，**不得**插入验证或构建命令：

1. `pnpm bump-version <version>`
2. 校验三处源版本一致（`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`）
3. `git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock`
4. `git commit -m "chore: 升级版本号至 <version>"`（无 diff 则跳过提交，仍可对当前 HEAD 打 tag）
5. `git tag v<version>`
6. `git push origin <current-branch>`
7. `git push origin v<version>`

## 完成判定

- 远端存在 tag `v<version>`，且与提交中版本文件一致
- 已向用户汇报：分支、tag、推送结果
- 已给出验证命令（任选）：
  - `gh run list --workflow release.yml --limit 5`
  - `gh release view v<version> --json tagName,isDraft,assets,url`
- 已说明：CI 产出 draft Release，须人工 Publish 后应用内才提示更新

## 禁止

- 本路径下运行 `pnpm format` / `lint` / `typecheck` / `test` / `build` / `build:macos`
- 手改单点版本号（必须 `pnpm bump-version`）
- tag 与 `package.json` 版本不一致，或复用已有 tag
- 未经用户明确要求 push tag / 发布 Release
- 误用 `pnpm release:version`（完整本地构建路径）

## 对照

| 路径 | 命令 | 本地验证与 Mac 构建 |
| --- | --- | --- |
| 轻量（本 skill） | `pnpm release:tag <v>` | 否 → CI |
| 完整 | `pnpm release:version <v>` | 是 |

流程细节与 CI 行为见 `docs/standards/release-workflow.md`。
