const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const { readFile } = require("node:fs/promises");
const { AIConversationService } = require("./AIConversationService");
const { AIInputService } = require("./AIInputService");
const { ChatDatabase, DEFAULT_DATABASE_PATH } = require("./ChatDatabase");
const { createQwenClient } = require("./QwenService");
const { CONFIG_PATH, hardenDataPermissions } = require("./RuntimePaths");

const PUBLIC_DIRECTORY = path.join(__dirname, "public");
const STATIC_FILES = new Map([
  ["/", { file: "demo.html", type: "text/html; charset=utf-8" }],
  ["/demo.css", { file: "demo.css", type: "text/css; charset=utf-8" }],
  ["/demo.js", { file: "demo.js", type: "text/javascript; charset=utf-8" }],
  ["/brune.png", { file: path.join("..", "Resources", "brune.png"), type: "image/png" }],
]);
const SESSION_COOKIE = "brune_demo_session";
const MAX_MESSAGE_LENGTH = 2_000;

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || "")
    .split(";")
    .map((part) => part.trim().split(/=(.*)/s, 2))
    .filter(([key, value]) => key && value !== undefined)
    .map(([key, value]) => [key, decodeURIComponent(value)]));
}

function createSessionId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function getSession(request) {
  const candidate = parseCookies(request)[SESSION_COOKIE];
  return /^[a-f0-9]{32}$/u.test(candidate || "") ? candidate : null;
}

function sessionCookie(sessionId) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

async function readJsonBody(request, maxBytes = 12 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("请求内容过大");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    const error = new Error("请求内容不是有效 JSON");
    error.statusCode = 400;
    throw error;
  }
}

async function sendStaticFile(response, staticFile) {
  try {
    const content = await readFile(path.join(PUBLIC_DIRECTORY, staticFile.file));
    response.writeHead(200, {
      "Content-Type": staticFile.type,
      "Cache-Control": "no-cache",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    response.end(content);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

function getClientAddress(request) {
  return String(request.socket.remoteAddress || "unknown").replace(/^::ffff:/u, "");
}

function createRateLimiter({ maxRequests = 20, windowMs = 60 * 60 * 1000 } = {}) {
  const buckets = new Map();
  return {
    check(key) {
      const now = Date.now();
      const entries = (buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
      if (entries.length >= maxRequests) {
        buckets.set(key, entries);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entries[0] + windowMs - now) / 1000)) };
      }
      entries.push(now);
      buckets.set(key, entries);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function createDemoContext(sessionId, content) {
  const id = `web-demo-${crypto.randomUUID()}`;
  const message = {
    id,
    content,
    author: { user_openid: `web-demo-${sessionId}` },
  };
  return {
    scene: "c2c",
    eventType: "WEB_DEMO_MESSAGE",
    payload: { op: 0, t: "WEB_DEMO_MESSAGE", d: message },
    message,
  };
}

function createRequestHandler({ aiConversationService, rateLimiter, activeSessions }) {
  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    try {
      const staticFile = STATIC_FILES.get(url.pathname);
      if (request.method === "GET" && staticFile) {
        await sendStaticFile(response, staticFile);
        return;
      }
      if (request.method !== "POST" || url.pathname !== "/api/chat") {
        sendJson(response, 404, { error: "Not Found" });
        return;
      }
      // Demo may be embedded behind a reverse proxy or called by a separately hosted frontend.
      // Do not reject requests based on Origin here; public deployments must still use HTTPS,
      // rate limiting, and any required access control at the proxy/application boundary.

      const body = await readJsonBody(request);
      const content = String(body.message || "").trim();
      if (!content) {
        sendJson(response, 400, { error: "请输入消息" });
        return;
      }
      if (content.length > MAX_MESSAGE_LENGTH) {
        sendJson(response, 413, { error: `单条消息不能超过 ${MAX_MESSAGE_LENGTH} 个字符` });
        return;
      }

      const existingSession = getSession(request);
      const sessionId = existingSession || createSessionId();
      const rate = rateLimiter.check(`${getClientAddress(request)}:${sessionId}`);
      const responseHeaders = existingSession ? {} : { "Set-Cookie": sessionCookie(sessionId) };
      if (!rate.allowed) {
        sendJson(response, 429, { error: `请求过于频繁，请在 ${rate.retryAfterSeconds} 秒后再试` }, {
          ...responseHeaders,
          "Retry-After": String(rate.retryAfterSeconds),
        });
        return;
      }
      if (activeSessions.has(sessionId)) {
        sendJson(response, 409, { error: "这段对话正在回复中，请稍候" }, responseHeaders);
        return;
      }

      activeSessions.add(sessionId);
      try {
        const result = await aiConversationService.generateReply(createDemoContext(sessionId, content));
        if (!result?.generated) throw new Error("暂时无法生成回复，请稍后再试");
        aiConversationService.commitExchange(result);
        sendJson(response, 200, { messages: result.replies }, responseHeaders);
      } finally {
        activeSessions.delete(sessionId);
      }
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message || "服务暂时不可用" });
    }
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address());
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function startWebDemoServer({
  config,
  database,
  qwenClient,
  host = process.env.QQBOT_DEMO_HOST || "127.0.0.1",
  port = Number(process.env.QQBOT_DEMO_PORT) || 3001,
  maxRequests = Number(process.env.QQBOT_DEMO_MAX_REQUESTS) || 0,
  rateWindowMs = Number(process.env.QQBOT_DEMO_RATE_WINDOW_MS) || 60 * 60 * 1000,
} = {}) {
  if (!config) throw new Error("启动 Web Demo 时必须提供配置");
  if (!database) throw new Error("启动 Web Demo 时必须提供数据库");
  const normalizedMaxRequests = maxRequests || Math.max(1, Number(config.WebDemoRateLimit) || 20);
  const client = qwenClient || createQwenClient({ onUsage: (usage) => database.recordAIUsage(usage) });
  const inputService = new AIInputService({ config, qwenClient: client });
  const aiConversationService = new AIConversationService({
    config,
    database,
    qwenClient: client,
    inputService,
  });
  const server = http.createServer(createRequestHandler({
    aiConversationService,
    rateLimiter: createRateLimiter({ maxRequests: normalizedMaxRequests, windowMs: rateWindowMs }),
    activeSessions: new Set(),
  }));
  let address;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      address = await listen(server, host, port + attempt);
      break;
    } catch (error) {
      if (error.code !== "EADDRINUSE" || attempt === 9) throw error;
    }
  }
  const displayHost = address.address === "::" ? "localhost" : address.address;
  return {
    server,
    host: displayHost,
    port: address.port,
    url: `http://${displayHost}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function main() {
  hardenDataPermissions();
  const config = require(CONFIG_PATH);
  const database = new ChatDatabase(process.env.QQBOT_HISTORY_DATABASE || DEFAULT_DATABASE_PATH);
  const demo = await startWebDemoServer({ config, database });
  console.log(`布伦妮 Web Demo：${demo.url}`);
  const shutdown = async () => {
    await demo.close();
    database.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Web Demo 启动失败：${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  createDemoContext,
  createRateLimiter,
  createRequestHandler,
  getSession,
  startWebDemoServer,
};
