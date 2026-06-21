# 任务清单

## 1. Project Home 结构重构

- [x] 1.1 移除 Project Home 顶部 `RedWhisk`、`Projects` 和说明文案。
- [x] 1.2 将 Card 网格替换为 List 布局，每行一个项目。
- [x] 1.3 将新建入口从 Card 改为顶部工具栏右侧 `New Project` 按钮。
- [x] 1.4 在工具栏与列表之间增加分割线。

## 2. 项目行展示

- [x] 2.1 为项目行左侧增加首字母图标，文字为白色。
- [x] 2.2 基于项目数据稳定生成图标背景色，避免每次渲染随机变化。
- [x] 2.3 项目名称加粗展示，项目路径位于名称下方。
- [x] 2.4 对以用户 Home 目录开头的路径展示为 `~/...`。
- [x] 2.5 保持项目行点击打开项目，并补齐可访问名称。

## 3. 本地搜索

- [x] 3.1 在 `New Project` 左侧增加无边框搜索框。
- [x] 3.2 设置 placeholder 为 `searching projects`。
- [x] 3.3 按项目名称进行本地实时过滤，空搜索展示全部项目。
- [x] 3.4 搜索非空时只渲染匹配项目，隐藏不匹配项目。
- [x] 3.5 搜索非空时显示清除按钮；点击后清空搜索并展示全部项目。

## 4. 窗口 Header 交互

- [x] 4.1 为未选择 Project 的小窗口 Header 区域增加 Tauri 拖拽区域。
- [x] 4.2 双击 Header 空白区域时调用窗口最大化/恢复能力。
- [x] 4.3 确保 Header 内按钮、输入框和可点击控件不触发拖拽或最大化。

## 5. 测试与验证

- [x] 5.1 更新或新增 Project Home 测试，覆盖列表渲染、搜索过滤、清除搜索、Home 路径缩短和项目打开。
- [x] 5.2 更新或新增窗口 Header 测试，覆盖拖拽区域和双击最大化/恢复。
- [x] 5.3 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm format`。
- [x] 5.4 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm lint`。
- [x] 5.5 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm typecheck`。
- [x] 5.6 运行 `export PATH="$HOME/.nvm/versions/node/v24.4.1/bin:$PATH"; pnpm test`。
