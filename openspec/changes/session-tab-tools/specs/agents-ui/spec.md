# agents-ui 规格增量

## ADDED Requirements

### Requirement: Session 主窗口提供工具 Tab 入口

Agents Activity 的 Session 主窗口 SHALL 将 Session 内容作为首个 Tab，并 SHALL 在该 Tab 后提供一个 `+` 菜单入口用于新增工具 Tab。

#### Scenario: 展示工具新增菜单

- **GIVEN** 用户正在查看一个 Agent Session
- **WHEN** 用户点击 Session 主窗口 Tab 栏中的 `+`
- **THEN** 系统展示包含“终端”和“浏览器”的菜单
- **AND** 每个菜单项都带有默认图标

### Requirement: 终端作为 Session 工具 Tab 管理

系统 SHALL 允许用户从 `+` 菜单新增终端 Tab，并 SHALL 在 Session Tab 内容区内渲染终端，而不是在页面底部渲染终端面板。

#### Scenario: 新增终端 Tab

- **GIVEN** 用户正在查看一个 Agent Session
- **WHEN** 用户从 `+` 菜单选择“终端”
- **THEN** 系统新增一个可切换的终端 Tab
- **AND** 终端内容显示在当前 Session 主窗口的 Tab 内容区内

#### Scenario: 关闭终端 Tab

- **GIVEN** 用户已打开一个或多个终端 Tab
- **WHEN** 用户点击某个终端 Tab 的关闭按钮
- **THEN** 系统关闭该终端 Tab
- **AND** 其他 Session 内容或工具 Tab 保持可用

#### Scenario: 限制终端 Tab 数量

- **GIVEN** 用户已经打开 10 个终端 Tab
- **WHEN** 用户再次从 `+` 菜单选择“终端”
- **THEN** 系统不新增终端 Tab
- **AND** 系统显示不支持继续添加终端的提示

### Requirement: 浏览器作为 Session 工具 Tab 管理

系统 SHALL 允许用户从 `+` 菜单新增浏览器 Tab，并 SHALL 在浏览器 Tab 内显示地址输入框和嵌入式浏览区域。

#### Scenario: 新增浏览器 Tab

- **GIVEN** 用户正在查看一个 Agent Session
- **WHEN** 用户从 `+` 菜单选择“浏览器”
- **THEN** 系统新增一个浏览器 Tab
- **AND** 浏览器 Tab 显示地址输入框和嵌入式浏览区域

#### Scenario: 地址栏访问或刷新页面

- **GIVEN** 用户已打开浏览器 Tab
- **WHEN** 用户在地址栏输入地址并按 Enter
- **THEN** 嵌入式浏览区域访问该地址
- **AND** 如果地址与当前地址相同，系统重新加载当前页面
