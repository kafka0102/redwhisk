## 1. 终端配置持久化模型

- [x] 1.1 新增项目终端配置 migration、Rust 类型与 repository 读写能力。
- [x] 1.2 扩展项目终端 service，让新建/更新/删除终端同时维护配置与运行时 session 映射。

## 2. 项目打开自动启动

- [x] 2.1 在项目打开流程中加载当前项目的已保存终端配置。
- [x] 2.2 为每条配置自动启动本地终端 session，并让终端页可读取这些已启动条目。

## 3. Terminals 页面交互调整

- [x] 3.1 收紧终端 section 高度，并把条目之间的上下间距调整为 4px。
- [x] 3.2 去掉随机颜色逻辑，改为统一底色 + 选中态加深。
- [x] 3.3 增加 hover 编辑按钮与编辑弹窗，支持修改名称、路径、启动命令。

## 4. 验证

- [x] 4.1 补充前端测试，覆盖列表样式状态、编辑入口和配置保存后的展示。
- [x] 4.2 补充 Rust 测试，覆盖配置持久化、项目打开自动启动和删除关闭行为。
- [x] 4.3 运行 `pnpm lint`。
- [x] 4.4 运行 `pnpm typecheck`。
- [x] 4.5 运行 `pnpm test`。
- [x] 4.6 运行 `cargo test --manifest-path src-tauri/Cargo.toml project_terminal`。
- [x] 4.7 运行 `cargo test --manifest-path src-tauri/Cargo.toml project`。
