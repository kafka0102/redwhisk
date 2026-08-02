# 0031. 变更推送采用 fetch + 可快进 pull 再 push

## Status

Accepted

## Context

变更 Activity 的推送在远端已有本地未见提交时，原先直接 `git push` 并以非快进错误结束。用户期望对齐 VS Code 的安全同步：尽量自动合入远端快进提交，但在分叉场景不自动 merge/rebase，以免工作区被冲突污染。

## Decision

主 checkout 的共享 push 路径（「更多 → 推送」与「同步更改」）在已有 upstream 时：

1. 先 `fetch` 更新远程跟踪引用；
2. 若相对 upstream 可快进落后，静默 `pull --ff-only` 再 `push`；
3. 若仅 ahead，直接 `push`；
4. 若分叉或无法快进，返回错误并提示用户手动处理，不创建 merge/rebase 状态。

无 upstream 时保持 `git push -u origin HEAD`。普通「拉取」菜单仍为 `git pull`，本决策不覆盖。

## Consequences

- 快进场景推送成功率提高，无需用户先手动拉取。
- 分叉场景不会静默产生 merge commit 或冲突文件；用户须自行解决后再推。
- push 延迟略增（多一次 fetch，有时多一次 pull）。
