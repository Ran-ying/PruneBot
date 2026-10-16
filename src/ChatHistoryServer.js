const http = require("node:http");
const path = require("node:path");
const { readFile } = require("node:fs/promises");
const { DEFAULT_MEDIA_DIRECTORY } = require("./IncomingMediaStorage");
const { createChatHistoryAuth } = require("./ChatHistoryAuth");

const PUBLIC_DIRECTORY = path.join(__dirname, "..", "public");
const STATIC_FILES = new Map([
  ["/", { file: "chat-history.html", type: "text/html; charset=utf-8" }],
  ["/styles.css", { file: "chat-history.css", type: "text/css; charset=utf-8" }],
  ["/app.js", { file: "chat-history.js", type: "text/javascript; charset=utf-8" }],
]);
const LOGIN_STATIC_FILES = new Map([
  ["/login", { file: "login.html", type: "text/html; charset=utf-8" }],
  ["/login.css", { file: "login.css", type: "text/css; charset=utf-8" }],
  ["/login.js", { file: "login.js", type: "text/javascript; charset=utf-8" }],
]);
const MEDIA_CONTENT_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".bmp", "image/bmp"],
  [".img", "application/octet-stream"],
]);

function sendJson(response, statusCode, data, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end();
}

async function sendStaticFile(response, staticFile) {
  try {
    const content = await readFile(path.join(PUBLIC_DIRECTORY, staticFile.file));
    response.writeHead(200, {
      "Content-Type": staticFile.type,
      "Cache-Control": "no-cache",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    response.end(content);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

async function sendMediaFile(response, pathname, mediaDirectory) {
  const filename = decodeURIComponent(pathname.slice("/media/".length));
  if (!filename || filename !== path.basename(filename)) {
    sendJson(response, 400, { error: "无效的媒体文件路径" });
    return;
  }

  try {
    const content = await readFile(path.join(mediaDirectory, filename));
    response.writeHead(200, {
      "Content-Type": MEDIA_CONTENT_TYPES.get(path.extname(filename).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "媒体文件不存在" });
      return;
    }
    throw error;
  }
}

async function readJsonBody(request, maxBytes = 16 * 1024) {
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
    const error = new Error("请求内容不是有效的 JSON");
    error.statusCode = 400;
    throw error;
  }
}

function createRequestHandler(database, {
  mediaDirectory = DEFAULT_MEDIA_DIRECTORY,
  password = "",
  sessionHours = 24,
} = {}) {
  const auth = createChatHistoryAuth({ password, sessionHours });
  return async (request, response) => {
    const url = new URL(request.url, "http://localhost");

    try {
      const loginFile = LOGIN_STATIC_FILES.get(url.pathname);
      if (request.method === "GET" && loginFile) {
        if (url.pathname === "/login" && auth.isAuthenticated(request)) {
          redirect(response, "/");
          return;
        }
        await sendStaticFile(response, loginFile);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const retryAfter = auth.getRetryAfter(request);
        if (retryAfter > 0) {
          sendJson(response, 429, { error: `尝试次数过多，请在 ${retryAfter} 秒后重试` }, {
            "Retry-After": String(retryAfter),
          });
          return;
        }
        const body = await readJsonBody(request);
        if (!auth.verifyPassword(body.password)) {
          auth.recordFailure(request);
          sendJson(response, 401, { error: "密码错误" });
          return;
        }
        auth.recordSuccess(request);
        sendJson(response, 200, { authenticated: true }, {
          "Set-Cookie": auth.createSessionCookie(request),
        });
        return;
      }

      if (!auth.isAuthenticated(request)) {
        if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
          redirect(response, "/login");
        } else {
          sendJson(response, 401, { error: "请先登录" });
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        sendJson(response, 200, { authenticated: false }, {
          "Set-Cookie": auth.createExpiredCookie(request),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/settings/pause") {
        const body = await readJsonBody(request);
        if (typeof body.paused !== "boolean") {
          sendJson(response, 400, { error: "paused 必须是布尔值" });
          return;
        }
        database.setServicePaused(body.paused);
        sendJson(response, 200, { paused: database.isServicePaused() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/conversations/block") {
        const body = await readJsonBody(request);
        const scene = String(body.scene || "");
        const targetId = String(body.target_id || "").trim();
        if (
          !["c2c", "group", "channel", "direct"].includes(scene) ||
          !targetId ||
          typeof body.blocked !== "boolean"
        ) {
          sendJson(response, 400, { error: "无效的封禁参数" });
          return;
        }
        database.setConversationBlocked(scene, targetId, body.blocked);
        sendJson(response, 200, database.getConversationProfile(scene, targetId));
        return;
      }

      if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method Not Allowed" });
        return;
      }

      if (url.pathname.startsWith("/media/")) {
        await sendMediaFile(response, url.pathname, mediaDirectory);
        return;
      }

      if (url.pathname === "/api/messages") {
        sendJson(response, 200, database.listMessages({
          direction: url.searchParams.get("direction"),
          scene: url.searchParams.get("scene"),
          type: url.searchParams.get("type"),
          search: url.searchParams.get("search"),
          targetId: url.searchParams.get("target_id"),
          limit: url.searchParams.get("limit"),
          offset: url.searchParams.get("offset"),
        }));
        return;
      }

      if (url.pathname === "/api/conversations") {
        sendJson(response, 200, database.listConversations({
          scene: url.searchParams.get("scene"),
          search: url.searchParams.get("search"),
          limit: url.searchParams.get("limit"),
        }));
        return;
      }

      if (url.pathname === "/api/stats") {
        sendJson(response, 200, database.getStats());
        return;
      }

      if (url.pathname === "/api/service-state") {
        sendJson(response, 200, { paused: database.isServicePaused() });
        return;
      }

      if (url.pathname === "/api/usage") {
        sendJson(response, 200, database.getAIUsage(url.searchParams.get("days")));
        return;
      }

      const messageMatch = url.pathname.match(/^\/api\/messages\/(\d+)$/);
      if (messageMatch) {
        const record = database.getMessage(messageMatch[1]);
        sendJson(response, record ? 200 : 404, record || { error: "记录不存在" });
        return;
      }

      const staticFile = STATIC_FILES.get(url.pathname);
      if (staticFile) {
        await sendStaticFile(response, staticFile);
        return;
      }

      sendJson(response, 404, { error: "Not Found" });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve(server.address());
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, host);
  });
}

async function startChatHistoryServer({
  database,
  mediaDirectory = DEFAULT_MEDIA_DIRECTORY,
  host = process.env.QQBOT_HISTORY_HOST || "127.0.0.1",
  port = Number(process.env.QQBOT_HISTORY_PORT) || 3000,
  password = process.env.QQBOT_HISTORY_PASSWORD || "",
  sessionHours = 24,
} = {}) {
  if (!database) throw new Error("启动聊天记录页面时必须提供 database");

  const server = http.createServer(createRequestHandler(database, {
    mediaDirectory,
    password,
    sessionHours,
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
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

module.exports = {
  createRequestHandler,
  startChatHistoryServer,
};
