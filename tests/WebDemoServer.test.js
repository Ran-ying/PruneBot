const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createRateLimiter, startWebDemoServer } = require("../src/WebDemoServer");
const { ChatDatabase } = require("../src/ChatDatabase");
const { mkdtempSync, rmSync } = require("node:fs");
const path = require("node:path");
const { tmpdir } = require("node:os");

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = options.body ? JSON.stringify(options.body) : null;
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: options.method || "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.headers || {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("Web Demo 限流器按窗口限制请求", () => {
  const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, false);
  assert.equal(limiter.check("b").allowed, true);
});

test("Web Demo 服务隔离会话并且不向浏览器暴露密钥", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "qqbot-web-demo-"));
  const database = new ChatDatabase(path.join(directory, "demo.sqlite"));
  const calls = [];
  const qwenClient = {
    async createChatCompletion(messages) {
      calls.push(messages);
      return JSON.stringify({ messages: ["收到。"] });
    },
  };
  const demo = await startWebDemoServer({
    config: { CharacterPrompt: "你是布伦妮。", AIReplyCasualExpressionChance: 0 },
    database,
    qwenClient,
    host: "127.0.0.1",
    port: 0,
    maxRequests: 3,
  });
  try {
    const page = await request(demo.url);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /和布伦妮聊聊/u);
    assert.doesNotMatch(page.body, /AIKey|DASHSCOPE/u);

    const style = await request(`${demo.url}/demo.css`);
    assert.equal(style.statusCode, 200);
    assert.match(style.headers["content-type"], /^text\/css/u);

    const script = await request(`${demo.url}/demo.js`);
    assert.equal(script.statusCode, 200);
    assert.match(script.headers["content-type"], /^text\/javascript/u);

    const characterImage = await request(`${demo.url}/brune.png`);
    assert.equal(characterImage.statusCode, 200);
    assert.equal(characterImage.headers["content-type"], "image/png");

    const first = await request(`${demo.url}/api/chat`, {
      method: "POST",
      headers: { Origin: demo.url },
      body: { message: "你好" },
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(JSON.parse(first.body).messages, ["收到。"]);
    const cookie = first.headers["set-cookie"]?.[0];
    assert.match(cookie, /HttpOnly/u);

    const second = await request(`${demo.url}/api/chat`, {
      method: "POST",
      headers: { Origin: demo.url, Cookie: cookie.split(";", 1)[0] },
      body: { message: "继续" },
    });
    assert.equal(second.statusCode, 200);
    assert.equal(calls.length, 2);
    const firstKey = calls[0].at(-1).content;
    const secondHistory = calls[1].find((message) => message.role === "user" && message.content === "你好");
    assert.equal(firstKey, "你好");
    assert.ok(secondHistory);

    const crossSite = await request(`${demo.url}/api/chat`, {
      method: "POST",
      headers: { Origin: "https://example.invalid" },
      body: { message: "跨站前端也可调用" },
    });
    assert.equal(crossSite.statusCode, 200);
  } finally {
    await demo.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
