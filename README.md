# QQPruneBot

一个使用 QQ 官方机器人 WebSocket 网关和通义千问的 Node.js 聊天机器人。当前角色为《原神》中的布伦妮（Brune），支持连续消息聚合、多轮上下文、图片理解、语音转写、群聊回复策略，以及带密码保护的本地聊天记录页面。

## 主要能力

- QQ 单聊、群聊、频道消息和频道私信接收与回复
- 连续消息聚合：在安静窗口内收到的多条输入作为同一回合理解
- 自然聊天气泡：单条输入通常回复一条，确有自然反应和后续正文时回复两条
- 布伦妮角色语气：保留认真、好奇、略微逞强和理性关心，但避免刻意堆设定或口头禅
- 通义千问文本生成、图片理解、语音转写和声音复刻语音回复
- SQLite 持久化上下文、长期摘要、Token 用量和消息处理状态
- 群聊 `at_only` / `smart` 回复策略
- 本地聊天记录、服务暂停、会话封禁和媒体归档
- WebSocket 心跳 ACK 检查、Resume 补发和指数退避重连
- 独立 Web Demo：不依赖 QQ 平台，可直接用浏览器体验同一套角色回复和上下文

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
| `AITTSEnabled` | `false` | 是否把 AI 文字回复合成为 QQ 语音；本项目实际配置已启用 |
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

## 对话处理逻辑

```text
QQ 事件
  -> 持久化消息去重状态
  -> 立即记录原始消息（图片另行后台归档）
  -> 暂停 / 封禁 / 群聊回复策略
  -> 按会话和发送者聚合连续消息
  -> 逐条提取文本、图片描述和语音转写
  -> 加载当前会话历史与长期摘要
  -> 千问生成结构化 messages
  -> 质量检查、必要时重写或修复
  -> 高风险边界仍不合格时使用确定性安全兜底
  -> 整形成自然聊天气泡
  -> Qwen-Audio TTS 生成 24 kHz PCM
  -> 根据文字自动添加克制的情绪标签
  -> PCM 编码为 QQ 原生 SILK 并发送语音
  -> 任一步失败或文本过长时自动发送完整文字
  -> 成功后提交上下文和完成状态
```

连续输入会以 `[连续消息 1]`、`[连续消息 2]` 等结构交给模型，并明确要求覆盖每条消息中需要回应的事实、情绪、问题和请求。相关内容可以合并，回复不应机械地逐条复述。

单条输入最终最多发送两个气泡。短确认通常只有一个；只有“即时反应 + 完整正文”确实自然时才拆成两个。颜文字不会按轮次强制出现。

发送前检查会特别防止：漏答身份或人物关系、亲近表达被冷处理、把当前实时问题说成未来、胸痛和呼吸困难缺少急救建议、在纯文字里虚构语速/打字速度/表情，以及凭空声称记得用户过去的衣着。普通的轻微风格偏差只触发一次重写，不会再因为人设措辞不够完美而要求用户重复问题。

### 布伦妮语言风格

角色表达规则参考了[布伦妮中文角色语音](https://wiki.biligame.com/ys/%E5%B8%83%E4%BC%A6%E5%A6%AE%E8%AF%AD%E9%9F%B3)，而不是依赖通用“傲娇”标签，也没有把原台词整段塞给模型。程序使用的是从不同情境台词中提炼出的语言规律：

- 常态清楚、认真、略带自信，词汇有时比同龄人书面和精确，但句子仍是口语。
- 解释观点时通常只选一种节奏：把普通感受概括成像模像样的原则后落到日常结论；从观察和疑问出发，列一两个依据再推断；或先承认事实，再用“但”“所以”“总之”坚持立场。
- 会偶尔纠正自己的措辞、反问验证或在可靠结论后小小得意。分享冷知识可以邀请对方验证，但不能固定复刻同一套句式。
- 自尊心被碰到时，往往先认真讲理由、补限定或找例外，最后才泄露一点赌气；真正亲近时则能直接承认感受，不需要永远口是心非。
- 天气、旅途、失落等话题偶尔可以出现一句略显成熟的比喻，普通问候和安慰仍保持朴素，不把每句话写成格言。

省略停顿、重复词、轻微结巴以及“哼”“哼哼”“咳”“嘁”等反应只在害羞、心虚、怕被当成小孩、逞强被看穿或真的激动时偶尔使用。宣战和战斗式高能语气也只属于相应剧情或情绪场景。安慰疲惫、难过或寂寞的用户时优先自然接住感受，禁止为了显得理性而硬搬“根据观察”“根据常识”；冷知识则避免无根据的绝对化表述。

这些规则同时写入固定的角色语气约束和可配置的 `AIResponseStylePrompt`；`AIContextVersion` 已同步升级，避免旧上下文继续影响新风格。`LiveConversationEval.js` 还包含冷知识、理性关心、意见分歧和低落天气四类专门场景，便于用真实模型回归，而不是只检查提示词文本。

### 云端语音输出

AI 回复已接入 `qwen-audio-3.0-tts-flash` 声音复刻。每个自然聊天气泡分别合成，百炼输出 24 kHz 单声道 PCM，再由 `silk-wasm` 编码为 QQ 原生 SILK，通过单聊或群聊富媒体接口上传并发送：

```text
AI 生成文字气泡
  -> 同一次文字模型调用返回干净正文和配音标记
  -> 校验标签白名单及正文一致性
  -> Qwen-Audio 3.0 TTS Flash
  -> 24 kHz PCM
  -> SILK 编码
  -> QQ 富媒体上传（Base64）
  -> 发送语音消息
```

收到语音输入时，文字模型为每个气泡同时返回 `text` 和 `speech`：`text` 是干净正文，`speech` 保持相同的核心语义和事实，但可以为自然口语加入少量语气词、停顿、轻微结巴或重复，并在需要的位置插入语音标签。文字输入不需要 TTS，因此仍使用较短的普通消息格式，避免无意义地重复输出正文、增加文本模型 Token。

支持 Qwen-Audio 3.0 当前全部 23 个控制标签：

```text
[sad] [amazed] [deep and loud shouting] [trembling] [angry]
[excited] [sarcastic] [curious] [like dracula] [bored] [tired]
[scornful] [shouting] [asmr] [panicked] [mischievously]
[empathetic] [whispers] [reluctantly] [crying] [serious]
[very slowly] [very fast]
```

以及全部 7 个拟声标签：

```text
[gasp] [sighing] [clears throat] [giggles] [laughing] [cough] [snorts]
```

模型可以在一句话中切换情绪并把拟声效果插在合适位置，但提示词明确要求克制使用。程序会再次进行白名单和核心正文相似度校验：允许口语化停顿、语气词、轻微重复和少量措辞调整，但不允许大幅增删内容或改变关键事实。未知标签或核心意思偏离的配音文本会被丢弃。

如果文字模型没有返回控制标签，程序不再交给 TTS“自动表达”，而是先按明显语义选择标签；仍无匹配时统一补上可配置的 `AITTSDefaultTag`，当前为较柔和、接近日常对话的 `[empathetic]`。

`AITTSReplyMode` 默认设为 `voice_on_voice`：文字输入得到文字回复，本回合的单条或连续消息中只要包含一条语音，机器人就用语音回答。设为 `voice` 时始终只发语音；设为 `voice_and_text` 时始终在语音后补发原文。百炼调用、临时音频下载、SILK 编码或 QQ 上传中的任何一步失败，都会记录错误并自动退回原始文字，不会丢失回复。QQ 频道和频道私信暂不走当前富媒体上传接口，也会直接发送文字。

无论最终发送文字还是 SILK 语音，模型都会先生成完整的文字回复。上下文与长期记录保存的始终是 `text`，`speech`、情绪标签和音频数据只用于 TTS 与 QQ 投递，不会污染下一轮对话记忆。

聊天记录详情中的“AI 生成与配音”会保存本回合文字模型的原始返回（包括重写/修复结果）、最终 `text`、最终 `speech`、规划标签、实际应用标签、TTS 请求 ID、字符数、时长以及失败原因，方便定位是文字规划、标签校验、TTS 还是 QQ 投递环节的问题。

音色复刻只解决主要音色，日常、兴奋、害羞、逞强等表现仍由文本、标点和 TTS 情绪/风格指令控制。不要假设云平台内置了“布伦妮”官方音色；上传第三方角色或配音演员样本前，需要确认相应音频、角色和声音的合法使用权。若没有授权，应改用声音设计创建“气质相近但不冒充原角色”的原创音色。

## 数据与安全

运行数据位于 `data/`：

- `Config.json`：应用凭据、AI Key、角色提示词和运行参数
- `Storage.json`：QQ access token 缓存
- `ChatHistory.sqlite*`：聊天记录、AI 上下文、处理状态和用量
- `ChatMedia/`：归档图片

这些路径已从 Git 排除。程序会尽量把数据目录设为 `0700`、敏感文件设为 `0600`。不要提交 `Secret`、真实 `Config.json`、数据库或终端中的访问凭据；`test.js` 只验证 Token 获取成功，不再打印 Token 内容。

消息处理状态分为：

- `processing`：已接收，正在聚合或生成回复
- `completed`：处理和发送成功
- `ignored`：因暂停、封禁或群聊策略而只记录不回复
- `failed`：处理失败，平台重投时允许再次尝试

## 测试范围

测试覆盖对话上下文与摘要、连续输入、气泡整形、角色回复质量、多模态输入、SQLite、鉴权、消息去重、群聊策略、图片归档、WebSocket Resume、回复序号和 API 页面。

联网调用没有包含在常规测试中；测试使用模拟的千问客户端和 WebSocket。

## 目录说明

| 路径 | 职责 |
| --- | --- |
| `main.js` | 应用编排、接收、回复和发送入口 |
| `AIConversationService.js` | 上下文、提示词、质量检查、重写与修复 |
| `AIInputService.js` | 图片理解和语音转写 |
| `QwenTTSService.js` | 百炼语音合成、情绪标签和 PCM → SILK 编码 |
| `ReplyDeliveryPolicy.js` | 回复长度、自然拆分和轻松表达控制 |
| `ChatDatabase.js` | SQLite 数据访问和消息处理状态 |
| `WebSocketBot.js` / `WebhookBot.js` | QQ WebSocket 网关与签名回调接收 |
| `ChatHistoryServer.js` / `public/` | 本地管理页面和 API |
| `data/Config.example.json` | 可提交的配置模板 |

## 已知限制

- Webhook 服务本身使用 HTTP，生产部署仍需由反向代理提供公网 HTTPS 和证书。
- 聊天记录页面面向单实例本地管理，不是多管理员权限系统。
- SQLite 使用同步接口，适合当前单进程规模；高并发或多实例部署需要迁移数据库和任务队列。
- 模型能否完整覆盖复杂连续输入仍依赖生成质量，修改提示词后应运行测试并用真实对话样本回归。

QQ WebSocket 与 Webhook 协议依据[QQ 机器人官方事件订阅与通知文档](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html)和[安全与签名文档](https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/sign.html)实现。
