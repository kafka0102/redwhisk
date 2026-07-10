# project-terminals Specification Delta

## ADDED Requirements

### Requirement: Closing a project terminal deletes its log file

关闭 Project Terminal session 时，系统 SHALL 删除该 session 对应的磁盘日志文件。日志文件不存在或删除失败时，系统 SHALL 不阻塞关闭流程。

#### Scenario: Closing an active terminal removes its log

- **WHEN** 用户关闭一个已创建的 Project Terminal session
- **AND** 该 session 有对应的 log 文件
- **THEN** 后端释放 PTY 并从内存 registry 移除该 session
- **AND** 后端删除该 session 的 log 文件

#### Scenario: Closing a terminal with missing log still succeeds

- **WHEN** 用户关闭 Project Terminal session
- **AND** log 文件已不存在
- **THEN** 关闭仍然成功
- **AND** 后端不返回错误

### Requirement: Deleting a project terminal config removes session logs

删除已保存的 Project Terminal 配置时，系统 SHALL 在关闭/清理其活跃 session 的同时删除对应 log 文件。

#### Scenario: Deleting a terminal card removes log files

- **WHEN** 用户删除一个 Project Terminal 配置卡片
- **AND** 该配置存在关联的本地 terminal session 与 log 文件
- **THEN** 后端关闭并移除这些 session
- **AND** 后端删除对应 log 文件
- **AND** 后端删除该配置记录
