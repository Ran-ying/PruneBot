# 开发与验证

[返回 README](../README.md)

## 本地开发

使用 Node.js 22.5.0+，执行：

```bash
npm ci
cp data/Config.example.json data/Config.json
npm run check
npm test
```

`npm run check` 对 `main.js`、`src/`、`tests/`、`scripts/` 与 `public/` 下所有 JavaScript 运行语法检查；`npm test` 运行 `tests/*.test.js`，不需要有效的 QQ/百炼凭据，也不应发出真实消息。CI 在 Node.js 22 与 24 环境执行相同检查。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm start` | 启动 QQ 机器人 |
| `npm run start:demo` | 单独启动 Web Demo |
| `npm run check` | 检查 JavaScript 语法 |
| `npm test` | 运行本地自动化测试 |
| `npm run eval:live` | 真实千问四组对话回归，**产生 API 费用** |
| `npm run eval:deep -- --trials=2` | 深度多模型评测，**可能产生较高 API 费用** |
| `npm run eval:voice` | 使用真实模型验证语音回复规划 |
| `npm run test:tts` | 测试真实 TTS → SILK 管线 |
| `npm run check:token` | 使用真实凭据检查 QQ Access Token 获取 |
| `node scripts/compare-tts-emotion.js` | 比较 TTS 情绪样例，调用真实 API |
| `python scripts/generate_brune_backgrounds.py` | 使用 Pillow 和 `Resources/brune.png` 生成日夜背景素材 |

## 修改约定

- 保持 `main.js`、`npm start`、`npm run start:demo`、`data/Config.json`、默认 SQLite 路径兼容。
- 本地单元测试放在 `tests/`；模块依赖引用 `../src/...` 或 `../main`。
- 可复用服务放在 `src/`，评测和素材脚本放在 `scripts/`，网页资源放在 `public/`。
- 使用模拟客户端验证业务逻辑。涉及真实 QQ 和百炼 API 的脚本必须明确标明费用、权限与可能的数据发送，不纳入 CI。
- 不要提交真实凭据、Token、个人聊天记录、数据库或从用户消息归档的媒体。修改 `.gitignore` 不会移除 Git 历史中的已追踪数据。
