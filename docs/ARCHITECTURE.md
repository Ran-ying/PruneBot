# 代码架构与限制

[返回 README](../README.md)

## 入口与数据流

```text
main.js
 ├─ src/WebSocketBot.js / src/WebhookBot.js  → 接入 QQ 事件
 ├─ src/ChatDatabase.js                     → SQLite 消息与会话状态
 ├─ src/MessageBatcher.js                   → 连续输入聚合
 ├─ src/GroupReplyPolicy.js                 → 群聊响应判定
 ├─ src/AIInputService.js                   → 图片与语音解析
 ├─ src/AIConversationService.js            → 上下文与回复生成/质检
 │   └─ src/QwenService.js                  → 千问 HTTP API
 ├─ src/ReplyDeliveryPolicy.js              → 气泡规划
 ├─ src/QwenTTSService.js                   → 语音合成与 SILK 编码
 └─ src/MessageService.js                   → QQ 消息上传和投递

src/ChatHistoryServer.js + public/         → 本地管理页面
src/WebDemoServer.js + public/              → 独立浏览器 Demo
src/RuntimePaths.js                        → 数据目录与文件权限
```

`main.js` 的原有启动路径继续保留；业务模块迁入 `src/`，不会改变默认数据目录 `data/` 和用户已有的 JSON 配置结构。

## 测试范围

测试覆盖对话上下文与摘要、连续输入、气泡整形、角色回复质量、多模态输入、SQLite、鉴权、消息去重、群聊策略、图片归档、WebSocket Resume、回复序号和 API 页面。

联网调用没有包含在常规测试中；测试使用模拟的千问客户端和 WebSocket。



## 目录说明

| 路径 | 职责 |
| --- | --- |
| `main.js` | 应用编排、接收、回复和发送入口 |
| `src/AIConversationService.js` | 上下文、提示词、质量检查、重写与修复 |
| `src/AIInputService.js` | 图片理解和语音转写 |
| `src/QwenTTSService.js` | 百炼语音合成、情绪标签和 PCM → SILK 编码 |
| `src/ReplyDeliveryPolicy.js` | 回复长度、自然拆分和轻松表达控制 |
| `src/ChatDatabase.js` | SQLite 数据访问和消息处理状态 |
| `src/WebSocketBot.js` / `src/WebhookBot.js` | QQ WebSocket 网关与签名回调接收 |
| `src/ChatHistoryServer.js` / `public/` | 本地管理页面和 API |
| `data/Config.example.json` | 可提交的配置模板 |



## 已知限制

- Webhook 服务本身使用 HTTP，生产部署仍需由反向代理提供公网 HTTPS 和证书。
- 聊天记录页面面向单实例本地管理，不是多管理员权限系统。
- SQLite 使用同步接口，适合当前单进程规模；高并发或多实例部署需要迁移数据库和任务队列。
- 模型能否完整覆盖复杂连续输入仍依赖生成质量，修改提示词后应运行测试并用真实对话样本回归。

QQ WebSocket 与 Webhook 协议依据[QQ 机器人官方事件订阅与通知文档](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)和[安全与签名文档](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html)实现。
