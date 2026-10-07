const http = require("node:http");
const {
  createPrivateKey,
  createPublicKey,
  sign: cryptoSign,
  verify: cryptoVerify,
} = require("node:crypto");

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const CALLBACK_ACK_OPCODE = 12;
const VALIDATION_OPCODE = 13;

function createSecretSeed(secret) {
  let seed = Buffer.from(String(secret || ""), "utf8");
  if (seed.length === 0) throw new Error("Webhook 缺少 AppSecret");
  while (seed.length < 32) seed = Buffer.concat([seed, seed]);
  return seed.subarray(0, 32);
}

function createWebhookKeyPair(secret) {
  const privateKey = createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, createSecretSeed(secret)]),
    format: "der",
    type: "pkcs8",
  });
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

function signWebhookMessage(secret, message) {
  const { privateKey } = createWebhookKeyPair(secret);
  return cryptoSign(null, Buffer.from(String(message), "utf8"), privateKey).toString("hex");
}

function verifyWebhookSignature({ secret, timestamp, rawBody, signature }) {
  if (!timestamp || !/^[a-f0-9]{128}$/iu.test(String(signature || ""))) return false;
  try {
    const { publicKey } = createWebhookKeyPair(secret);
    const message = Buffer.concat([Buffer.from(String(timestamp), "utf8"), rawBody]);
    return cryptoVerify(null, message, publicKey, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

async function readRawBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error("Webhook 请求内容过大");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(data));
}

function createWebhookHandler({
  onEvent,
  appId,
  appSecret,
  path = "/qqbot/events",
  maxTimestampSkewSeconds = 300,
  now = () => Date.now(),
} = {}) {
  if (typeof onEvent !== "function") throw new Error("Webhook Bot 缺少 onEvent");
  if (!String(appId || "").trim()) throw new Error("Webhook 缺少 AppID");
  createSecretSeed(appSecret);

  return async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }
      if (request.method !== "POST" || url.pathname !== path) {
        sendJson(response, 404, { error: "Not Found" });
        return;
      }
      if (String(request.headers["x-bot-appid"] || "") !== String(appId)) {
        sendJson(response, 401, { error: "无效的 X-Bot-Appid" });
        return;
      }

      const rawBody = await readRawBody(request);
      let payload;
      try {
        payload = JSON.parse(rawBody.toString("utf8"));
      } catch {
        sendJson(response, 400, { error: "Webhook 请求不是有效的 JSON" });
        return;
      }

      if (payload.op === VALIDATION_OPCODE) {
        const plainToken = String(payload.d?.plain_token || "");
        const eventTimestamp = String(payload.d?.event_ts || "");
        if (!plainToken || !eventTimestamp) {
          sendJson(response, 400, { error: "回调验证参数不完整" });
          return;
        }
        sendJson(response, 200, {
          plain_token: plainToken,
          signature: signWebhookMessage(appSecret, `${eventTimestamp}${plainToken}`),
        });
        return;
      }

      const timestamp = String(request.headers["x-signature-timestamp"] || "");
      const timestampSeconds = Number(timestamp);
      const timestampIsFresh = Number.isFinite(timestampSeconds)
        && Math.abs(now() / 1000 - timestampSeconds) <= Math.max(1, maxTimestampSkewSeconds);
      const signatureIsValid = timestampIsFresh && verifyWebhookSignature({
        secret: appSecret,
        timestamp,
        rawBody,
        signature: request.headers["x-signature-ed25519"],
      });
      if (!signatureIsValid) {
        sendJson(response, 401, { error: "Webhook 签名无效或已过期" });
        return;
      }

      await onEvent(payload);
      sendJson(response, 200, { op: CALLBACK_ACK_OPCODE });
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: error.message });
    }
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

async function startWebhookBot({
  onEvent,
  appId,
  appSecret,
  host = process.env.QQBOT_WEBHOOK_HOST || "127.0.0.1",
  port = Number(process.env.QQBOT_WEBHOOK_PORT) || 8080,
  path = process.env.QQBOT_WEBHOOK_PATH || "/qqbot/events",
} = {}) {
  const server = http.createServer(createWebhookHandler({ onEvent, appId, appSecret, path }));
  const address = await listen(server, host, port);
  const displayHost = address.address === "::" ? "localhost" : address.address;
  return {
    server,
    host: displayHost,
    port: address.port,
    path,
    url: `http://${displayHost}:${address.port}${path}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

module.exports = {
  CALLBACK_ACK_OPCODE,
  VALIDATION_OPCODE,
  createWebhookHandler,
  signWebhookMessage,
  startWebhookBot,
  verifyWebhookSignature,
};
