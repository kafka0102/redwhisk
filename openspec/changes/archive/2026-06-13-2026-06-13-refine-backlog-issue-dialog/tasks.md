## 1. backlog issue 弹窗分流

- [x] 1.1 在 `IssuesActivity` 中区分 backlog 与非 backlog 弹窗分支。
- [x] 1.2 backlog 的 `New Issue` / `Issue Detail` 去掉 `Session` / `Actions` 侧栏，并改为无右侧内容的单栏编辑布局。
- [x] 1.3 保持 `running`、`review`、`completed` 详情弹窗结构与交互不变。

## 2. issue 附件数据模型与命令

- [x] 2.1 为 issue 附件新增 migration、类型、repository 与 service 支持。
- [x] 2.2 新增 create / update issue 所需的附件提交字段和后端处理逻辑。
- [x] 2.3 新增附件预览、下载 / 导出、删除相关 command / service 能力。
- [x] 2.4 将附件实际文件复制到 repo 内 `.redwhisk/issues/<issue-id>/attachments/`。

## 3. 描述编辑器附件块

- [x] 3.1 为 `IssueDescriptionEditor` 增加附件卡片渲染与 token 序列化所需接口。
- [x] 3.2 在 create / edit issue footer 左侧增加文件 icon 入口，并接入系统文件选择器。
- [x] 3.3 选中文件后在编辑器内插入附件卡片块，按类型展示 PDF / Word / 图片 / 通用文件 icon。
- [x] 3.4 为预览型附件显示 `查看` 按钮；二进制附件不显示该按钮。
- [x] 3.5 实现附件预览 dialog，支持图片和文本类非二进制文件。
- [x] 3.6 实现附件下载与删除交互。

## 4. Run Dialog 宽度调整

- [x] 4.1 为 backlog issue 打开的 `Run Dialog` 增加紧凑宽度样式分支。
- [x] 4.2 确保非 backlog 相关弹窗仍使用现有宽度和样式。

## 5. Prompt 附件路径注入

- [x] 5.1 在 `run-prompt-builder` 中加入附件路径 source 和最终 prompt 文案。
- [x] 5.2 确保已保存 issue 启动 Run Dialog 时，prompt 预览可以看到附件路径。

## 6. 验证

- [x] 6.1 更新 `src/features/issues/issues-activity.test.tsx`，覆盖 backlog / 非 backlog 弹窗差异、附件插入 / 删除 / 预览按钮显隐、下载交互与 Run Dialog 宽度分支。
- [x] 6.2 更新 `src/features/issues/run-prompt-builder.test.ts`，覆盖附件路径 prompt source。
- [x] 6.3 更新 `src-tauri/tests/issue.rs`，覆盖附件持久化、预览能力判定和附件 token 保存。
- [x] 6.4 运行 `pnpm lint`。
- [x] 6.5 运行 `pnpm typecheck`。
- [x] 6.6 运行 `pnpm test -- src/features/issues/issues-activity.test.tsx src/features/issues/run-prompt-builder.test.ts src/app/app.test.tsx`。
- [x] 6.7 运行 `cargo test --manifest-path src-tauri/Cargo.toml --no-run`。
- [x] 6.8 运行 `cargo test --manifest-path src-tauri/Cargo.toml --test issue`。
