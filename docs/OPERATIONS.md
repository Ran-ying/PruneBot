# 运行、配置与部署

[返回 README](../README.md)

## 运行要求

- Node.js `>= 22.5.0`。项目使用内置的 `node:sqlite`；部分 Node 版本仍会显示实验性 API 警告。
- 可用的 QQ 开放平台机器人 AppID 和 AppSecret
- 阿里云百炼 API Key

安装依赖：

```bash
npm ci
```


## 配置

复制配置模板：

```bash
cp data/Config.example.json data/Config.json
```

至少填写以下项目：

| 配置 | 说明 |
| --- | --- |
| `AppID` / `AppSecret` | QQ 机器人应用凭据 |
| `AIKey` | 阿里云百炼 API Key；也可使用 `DASHSCOPE_API_KEY` 环境变量 |
| `CharacterPrompt` | 布伦妮完整角色设定和安全边界 |
| `ChatHistoryPassword` | 本地管理页面独立密码，不应与 AppSecret 或 AIKey 相同 |
| `AIModel` | 文本回复模型 |
| `AIContextVersion` | 修改角色提示词后可变更此值，以隔离旧上下文 |

常用行为配置：

| 配置 | 默认建议 | 作用 |
| --- | --- | --- |
| `AIMessageBatchWaitMs` | `3500` | 收到最后一条消息后等待多久再综合回复 |
| `AIMessageBatchMaxWaitMs` | `8000` | 连续输入最长聚合时间 |
| `AIMessageBatchMaxMessages` | `6` | 单个回合最多聚合消息数 |
| `AIModel` | `qwen3.5-plus` | 角色聊天的默认性价比模型；需要最高稳定性时可改为 `qwen3.7-max` |
| `AIGroupReplyMode` | `smart` | `at_only` 只回复明确 @；`smart` 也允许点名、引用和短时间连续交谈 |
| `AIReplyMaxBubbles` | `3` | 全局硬上限；单条输入仍会被限制为最多两个气泡 |
| `AIReplyCasualExpressionChance` | `0.1` | 轻松话题偶尔添加表情的概率；设为 `0` 可完全关闭 |
| `AITTSEnabled` | `true` | 示例配置已启用语音回复；如果没有可用的声音复刻 ID，请设为 `false` |
| `AITTSReplyMode` | `voice_on_voice` | 默认文字回复，仅当本回合收到语音时回语音；`voice` 始终发语音，`voice_and_text` 始终发语音并附原文 |
| `AITTSModel` | `qwen-audio-3.0-tts-flash` | 百炼语音合成模型 |
| `AITTSVoice` | 无 | 百炼声音复刻返回的 voice ID |
| `AITTSMaxCharacters` | `400` | 单个气泡超过此长度时不合成，直接发送完整文字 |
| `AITTSDefaultTag` | `[empathetic]` | 文字模型没有给出控制标签、且关键词也无法判断时使用的默认语气 |
| `ChatHistorySessionHours` | `24` | 管理页面登录会话有效期 |
| `WebDemoRateLimit` | `20` | Web Demo 单个浏览器会话每小时最多的文字请求数；公共部署建议保留或下调 |

`AIReplyExpressionMaxGap` 仅为旧配置兼容保留，当前不会再强制机器人定期插入颜文字。

支持的环境变量：

- `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL`、`DASHSCOPE_MODEL`
- `QQBOT_DATA_DIRECTORY`：覆盖数据目录
- `QQBOT_HISTORY_DATABASE`：覆盖 SQLite 文件位置
- `QQBOT_HISTORY_HOST`、`QQBOT_HISTORY_PORT`、`QQBOT_HISTORY_PASSWORD`
- `QQBOT_RECEIVE_MODE`：默认 `websocket`，也可设为 `webhook`
- `QQBOT_WEBHOOK_HOST`、`QQBOT_WEBHOOK_PORT`、`QQBOT_WEBHOOK_PATH`
- `QQBOT_DEMO_HOST`、`QQBOT_DEMO_PORT`、`QQBOT_DEMO_MAX_REQUESTS`、`QQBOT_DEMO_RATE_WINDOW_MS`


## 启动与检查

```bash
npm run check
npm test
npm start
```

### 独立 Web Demo

QQ 机器人不便公开时，可只启动浏览器 Demo，不会连接 QQ 网关或启动 Webhook：

```bash
npm run start:demo
```

默认地址为 `http://127.0.0.1:3001`，端口已被占用时会顺延查找 10 个端口。Demo 与 QQ 机器人复用 `Config.json` 中的千问模型、布伦妮提示词和 SQLite 上下文，但使用浏览器的随机、`HttpOnly` 会话 Cookie 隔离不同访客；API Key 始终只在服务端使用。

若要给外部用户访问，应使用反向代理提供 HTTPS，并设置 `QQBOT_DEMO_HOST=0.0.0.0`；不要直接把开发用的裸 HTTP 端口暴露到公网。Demo 默认每个 IP + 会话每小时最多 20 次请求，并限制单条消息 2000 字，以避免额度被滥用。公开环境仍建议在反向代理或访问控制层增加更可靠的全局限流和监控。

使用真实千问配置运行四组小规模对话回归（会消耗额度，但不会向 QQ 发消息）：

```bash
npm run eval:live
```

进行多场景、多次采样、带独立模型评分的深度 A/B 评测（会大量消耗额度）：

```bash
npm run eval:deep -- --trials=2 --models=qwen3.5-flash,qwen3.5-plus,qwen3.7-max --judge=qwen3.7-max
```

可用 `--scenarios` 只复测指定场景，名称之间用英文逗号分隔：

```bash
npm run eval:deep -- --trials=3 --models=qwen3.7-max --scenarios=角色身份问题,身体不适安全建议
```

2026-07-22 的三模型真实基线（16 个场景、每场景两次，使用 `qwen3.7-max` 独立评分）为：Max `87.84`、Plus `81.66`、Flash `80.78`。完成质检链路修复后，Max 全量终验提升至 `93.38`，32 个样本无硬失败。项目以轻量角色聊天为主，默认选择价格明显更低且表达稳定性优于 Flash 的 `qwen3.5-plus`；追求最高稳定性时再切换 Max。评测分数受模型版本和采样波动影响，应以重新运行结果为准。

聊天记录页面默认监听 `http://127.0.0.1:3000`。若端口被占用，会依次尝试后续端口。默认仅本机可访问；需要远程管理时，建议通过 HTTPS 反向代理暴露，并保持密码保护。

### Webhook 模式

```bash
QQBOT_RECEIVE_MODE=webhook \
QQBOT_WEBHOOK_HOST=127.0.0.1 \
QQBOT_WEBHOOK_PORT=8080 \
npm start
```

默认回调路径为 `/qqbot/events`。实现包含 `X-Bot-Appid` 校验、Ed25519 请求签名验证、时间戳防重放、回调地址验证（OpCode 13）和 HTTP Callback ACK（OpCode 12）。QQ 平台要求配置公网 HTTPS 地址，因此生产环境应在这个本地 HTTP 服务前放置 HTTPS 反向代理，再把完整公网地址填入 QQ 开放平台。


## 数据与安全

运行数据位于 `data/`：

- `Config.json`：应用凭据、AI Key、角色提示词和运行参数
- `Storage.json`：QQ access token 缓存
- `ChatHistory.sqlite*`：聊天记录、AI 上下文、处理状态和用量
- `ChatMedia/`：归档图片

这些路径已从 Git 排除。程序会尽量把数据目录设为 `0700`、敏感文件设为 `0600`。不要提交 `Secret`、真实 `Config.json`、数据库或终端中的访问凭据；`npm run check:token` 只验证 Token 获取成功，不再打印 Token 内容。

消息处理状态分为：

- `processing`：已接收，正在聚合或生成回复
- `completed`：处理和发送成功
- `ignored`：因暂停、封禁或群聊策略而只记录不回复
- `failed`：处理失败，平台重投时允许再次尝试


## 手动音频工具

语音测试及比较脚本需要真实百炼 API Key，会产生 API 费用，**不会自动在 CI 中运行**。默认输出路径在 `data/TestOutputs/` 下，不会覆盖 `Resources/` 中的参考文件；如果设置 `QQBOT_DATA_DIRECTORY`，这些脚本会使用该目录下的 `Config.json`。

`npm run test:tts` 将 SILK 音频写入 `data/TestOutputs/voice-pipeline-test.silk`。 `node scripts/compare-tts-emotion.js` 默认将 MP3 写入 `data/TestOutputs/tts-emotion/`，可通过 `QQBOT_TTS_OUTPUT_DIRECTORY` 指定输出目录。音色复刻 ID `AITTSVoice` 应在私有 `Config.json` 中配置，公开的示例模板不包含真实音色 ID。
