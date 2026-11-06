# Changelog

## 1.0.1

- 修复：投递的消息补全 `id` 与 `role`。首版只写 `{ content, source }`，生成的 `user/message` 事件通不过 session 的 replay 校验（`lacks an identified message`），导致目标会话在冷读或重启后无法重放（`SessionPersistenceCorruptionError`）。会话内当轮不受影响，所以问题只在重启后暴露。
- 补充跨会话投递的限制说明与用法示例。
- 打包为可发布形态：MIT 许可、仓库地址、`engines.dsh`、关键词。

## 1.0.0

- 首个版本：`session_list` / `session_read` / `session_send` 三个工具，注册在全局工具层。
- 支持按会话 id、完整标题或唯一标题片段定位目标。
- 冷会话通过 `sessionController.resolveAgent()` 唤醒；投递支持 `queue` 与 `steer` 两种模式。
