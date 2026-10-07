const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CALLBACK_ACK_OPCODE,
  signWebhookMessage,
  startWebhookBot,
} = require("./WebhookBot");

const APP_ID = "11111111";
const APP_SECRET = "DG5g3B4j9X2KOErG";

test("Webhook 回调地址验证使用 QQ 官方 Ed25519 算法", async () => {
  const webhook = await startWebhookBot({
    onEvent: async () => {},
    appId: APP_ID,
    appSecret: APP_SECRET,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Appid": APP_ID,
      },
      body: JSON.stringify({
        op: 13,
        d: { plain_token: "Arq0D5A61EgUu4OxUvOp", event_ts: "1725442341" },
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      plain_token: "Arq0D5A61EgUu4OxUvOp",
      signature: "87befc99c42c651b3aac0278e71ada338433ae26fcb24307bdc5ad38c1adc2d01bcfcadc0842edac85e85205028a1132afe09280305f13aa6909ffc2d652c706",
    });
  } finally {
    await webhook.close();
  }
});

test("Webhook 只处理签名有效且时间新鲜的事件", async () => {
  const events = [];
  const webhook = await startWebhookBot({
    onEvent: async (payload) => events.push(payload),
    appId: APP_ID,
    appSecret: APP_SECRET,
    host: "127.0.0.1",
    port: 0,
  });
  const payload = { op: 0, t: "C2C_MESSAGE_CREATE", d: { id: "message-1" } };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));

  try {
    const validResponse = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Appid": APP_ID,
        "X-Signature-Timestamp": timestamp,
        "X-Signature-Ed25519": signWebhookMessage(APP_SECRET, `${timestamp}${body}`),
      },
      body,
    });
    assert.equal(validResponse.status, 200);
    assert.deepEqual(await validResponse.json(), { op: CALLBACK_ACK_OPCODE });
    assert.deepEqual(events, [payload]);

    const invalidResponse = await fetch(webhook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Bot-Appid": APP_ID,
        "X-Signature-Timestamp": timestamp,
        "X-Signature-Ed25519": "00".repeat(64),
      },
      body,
    });
    assert.equal(invalidResponse.status, 401);
    assert.equal(events.length, 1);
  } finally {
    await webhook.close();
  }
});
