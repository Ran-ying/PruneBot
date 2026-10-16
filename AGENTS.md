# AGENTS.md

## Project

QQPruneBot: Node.js (CommonJS) official QQ bot with Qwen AI and SQLite. Keep the bot's runtime behavior and existing configuration compatible when working on repository hygiene.

## Layout

- `main.js`: compatibility entry point for `npm start`
- `src/`: backend services, HTTP servers, gateways and persistence
- `tests/`: test files; local modules use `../src/`
- `scripts/`: syntax checker, evaluation and maintenance tools
- `public/`: static frontends
- `Resources/`: reference/character media; third-party rights may apply
- `data/Config.example.json`: safe template; never overwrite `data/Config.json`

## Verify

Run `npm ci`, `npm run check`, and `npm test` with Node.js 22.5.0+; for fresh test environments, copy the example config to `data/Config.json`. CI must not call live QQ or cloud AI endpoints.

## Boundaries

Never commit API keys, QQ AppSecret, access tokens, personal chat SQLite files, or archived user media. Preserve default data paths, startup commands, WebSocket/Webhook behavior, and HTTP routes; require tests for functional changes. Do not invoke live evaluation or TTS scripts unless intentionally approved due to external charges.
