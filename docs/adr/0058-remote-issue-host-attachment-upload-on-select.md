# 0058. 新建远程 Issue 的宿主附件在选中后上传

## 状态

采纳（待执行）。

## 背景

新建远程 Issue 时，正文原样交给宿主，图片和文件仍是本地附件标记，宿主页面看不到文件。提交时再上传会堵住创建。GitHub 用现有 `gh` 登录只能上传 9 种图片和视频；其它文件的网页上传依赖浏览器会话，应用不保存这种会话，也不保存 token。GitLab 的项目上传接口在 Issue 创建前就能接收附件。应用只把 github.com 认作 GitHub，GitLab 含自建实例。同步会用宿主正文覆盖本地正文。Agent 读取的是本地附件表里的文件。

## 决定

1. 只在新建远程 Issue、且当前新建来源是远程时上传。编辑已有 Issue、评论和完成写回都不上传。
2. 用户选中宿主接受的文件后立即上传。GitHub 只接受 png、jpg、jpeg、gif、webp、svg、mp4、mov、webm。GitLab 接受所有附件。
3. 提交时不再上传已完成的文件，只等仍在上传的那些。有一个已接受文件上传失败，就不创建远端 Issue。失败项留在表单里，下次提交只重试失败项。
4. 宿主不接受的文件不上传、不阻挡提交，标记不写入宿主正文，文件仍作为本地附件保存。
5. 发给宿主的正文使用宿主链接。图片留在用户原来的位置；没有插进正文的文件，把宿主 Markdown 加在正文末尾。本地保存的正文与这份宿主正文一致。本地附件文件仍按现有附件保存，供预览和 Agent 使用。
6. 混合模式切回本地后，不再把宿主链接写进正文，提交走本地附件。删掉文件或取消新建时不调用宿主删除。没写进最终正文的链接丢弃，宿主上的文件可以留下。
7. 不把 token 写入 SQLite，沿用 `gh` / `glab` 已有登录。

## 后果

- 选中后取消，GitHub 和 GitLab 上都可能留下无人引用的文件。
- GitHub 上的 bmp、pdf、zip 等不会出现在宿主正文里。
- 自建 GitLab 可以上传。GitHub Enterprise Server 本来就不是受支持的 GitHub 宿主。
- 下次同步用宿主正文覆盖本地正文后，本地正文里不再有附件标记；本地附件行还在。

## 考虑过的替代方案

| 方案 | 未采纳原因 |
| --- | --- |
| 提交时用 `gh issue create --attach` 一次上传 | 上传会堵住提交，而且不能在选中后就把链接准备好 |
| 用浏览器会话上传 GitHub 不接受的普通文件 | 应用不保存浏览器会话，只使用 `gh` / `glab` 登录 |
| 删掉文件时同时删除宿主文件 | GitHub 没有删除接口；GitLab 删除还要维护者权限 |
| 上传失败仍创建 Issue，或把本地标记写进宿主正文 | 宿主正文会出现缺图或内部标记 |
| 编辑远程 Issue 或评论时也上传 | 远程正文 v1 只读，评论写回只有完成写回 |

## 代码事实来源

- `src-tauri/src/features/issue/remote_create.rs`：创建时把本地描述原样作为宿主正文
- `src-tauri/src/features/issue/github_issue_mirror/sync.rs`：同步用宿主正文覆盖本地正文
- `src-tauri/src/features/agent_session/launch.rs`：Agent 按附件表读取本地文件
- `src-tauri/src/git/forge.rs`：GitHub 只识别 github.com，GitLab 含自建实例
- `docs/superpowers/specs/2026-10-31-remote-issue-and-pr-workbench-design.md`：远程正文 v1 只读，写回不做正文双向合并
- GitHub CLI `internal/attachments/userasset.go`：9 种扩展名，图片 10MB，视频 100MB
- GitLab Project Markdown Uploads API：`POST /projects/:id/uploads`
