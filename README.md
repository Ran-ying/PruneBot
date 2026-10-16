# QQPruneBot

基于 QQ 官方机器人 WebSocket/Webhook 接入与通义千问的 Node.js 聊天机器人。当前使用《原神》布伦妮（Brune）角色设定，支持多轮记忆、多模态输入、语音回复和本地 Web 管理页面。

## 功能概览

- QQ 单聊、群聊、频道与私信；连续消息合并、去重和群聊回复策略。
- 通义千问文本对话、图片理解、语音转写，以及 PCM → SILK 语音输出。
- SQLite 会话历史、长期摘要和消息状态；受密码保护的聊天管理页面。
- 可独立运行的浏览器 Demo；支持 WebSocket 断线恢复与 Webhook 签名验证。

## 快速开始

要求 Node.js **22.5.0 或更新版本**、QQ 官方机器人 AppID/AppSecret，以及阿里云百炼 API Key。

```bash
npm ci
cp data/Config.example.json data/Config.json
# 编辑 data/Config.json，设置 AppID、AppSecret、AIKey、ChatHistoryPassword
npm run check
npm test
npm start
```

运行浏览器体验版：`npm run start:demo`（默认仅监听 `127.0.0.1:3001`）。QQ 机器人默认使用 WebSocket；Webhook 的 HTTPS 反向代理及环境变量设置见运维文档。

> `data/Config.json` 包含密钥，不能提交到 Git。聊天记录、缓存令牌和归档媒体也必须保留在私有运行数据目录。不要直接在公网暴露无 TLS 的管理或 Demo 端口。

## 项目结构

```text
main.js               # 保持兼容的 QQ 机器人启动入口
src/                  # QQ 网关、对话、AI、TTS、数据与 HTTP 服务
tests/                # Node.js 内置测试框架的单元/集成测试
scripts/              # 静态检查、联网评测、Token/声音及素材工具
public/               # 管理页面和 Demo 前端
Resources/            # 角色素材、语音样本及参考文件
data/Config.example.json  # 不含真实应用密钥的配置模板
docs/                 # 操作、设计和开发文档
```

## 文档

- [运行、配置与部署](docs/OPERATIONS.md)：配置项、环境变量、启动方式、Web Demo、Webhook 和数据保护。
- [对话行为与声音设计](docs/BEHAVIOR.md)：消息处理、角色语气、质量检查、语音合成与安全边界。
- [代码架构与限制](docs/ARCHITECTURE.md)：模块分工、消息管线、运行数据及现阶段限制。
- [开发与验证](docs/DEVELOPMENT.md)：本地测试、自动检查、真实模型评测和维护约定。

## 许可

项目采用 [LICENSE](LICENSE) 中的许可。代码许可不自动授予《原神》角色形象、样本音频或其他第三方素材的使用权。
