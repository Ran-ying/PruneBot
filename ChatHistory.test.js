const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { ChatDatabase } = require("./ChatDatabase");
const { startChatHistoryServer } = require("./ChatHistoryServer");

function createTemporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "qqbot-history-"));
  const database = new ChatDatabase(path.join(directory, "history.sqlite"));
  return {
    database,
    directory,
    remove() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createContext() {
  const payload = {
    op: 0,
    t: "C2C_MESSAGE_CREATE",
    d: {
      id: "incoming-message-id",
      author: { user_openid: "user-openid" },
      content: "你好，数据库",
      attachments: [{ content_type: "image/png", url: "https://example.com/image.png" }],
      timestamp: "2026-07-21T12:00:00Z",
    },
  };
  return {
    scene: "c2c",
    eventType: payload.t,
    payload,
    message: payload.d,
  };
}

test("SQLite 保存并筛选接收和发送记录", () => {
  const temporary = createTemporaryDatabase();
  const { database } = temporary;

  try {
    const context = createContext();
    database.recordIncoming(context, ["text", "image"]);
    database.recordOutgoing({
      context,
      payload: { content: "回复内容", msg_type: 0, msg_id: "incoming-message-id", msg_seq: 1 },
      response: { id: "outgoing-message-id", timestamp: 123456 },
      status: "sent",
      contentTypes: ["text"],
      attachments: [],
      aiGeneration: {
        model_outputs: [{ operation: "text", content: "{\"messages\":[]}" }],
        final_text: "回复内容",
        final_speech: "[empathetic]回复内容",
        planned_tags: ["[empathetic]"],
      },
    });
    assert.equal(database.hasReplyAttempt("incoming-message-id"), true);
    assert.equal(database.hasReplyAttempt("not-found"), false);
    assert.equal(database.hasSentOutgoingMessage("outgoing-message-id"), true);
    assert.equal(database.hasSentOutgoingMessage("not-found"), false);
    database.recordOutgoing({
      context,
      payload: { msg_type: 7, media: { file_info: "file-info" } },
      response: null,
      status: "failed",
      error: new Error("发送失败"),
      contentTypes: ["file"],
      attachments: [{ filename: "report.pdf" }],
    });

    const incoming = database.listMessages({ direction: "incoming" });
    assert.equal(incoming.total, 1);
    assert.deepEqual(incoming.records[0].content_types, ["text", "image"]);
    assert.equal(incoming.records[0].payload.d.content, "你好，数据库");
    database.updateMessageMediaAnalysis("incoming-message-id", {
      images: [{ attachment_indexes: [0], text: "一张测试图片", model: "qwen3-vl-flash" }],
      voices: [],
    });
    assert.equal(
      database.getMessage(incoming.records[0].id).media_analysis.images[0].text,
      "一张测试图片",
    );

    const files = database.listMessages({ type: "file", search: "incoming-message-id" });
    assert.equal(files.total, 1);
    assert.equal(files.records[0].status, "failed");
    assert.equal(files.records[0].error, "发送失败");
    const outgoingText = database.listMessages({ direction: "outgoing", type: "text" }).records[0];
    assert.equal(outgoingText.ai_generation.final_speech, "[empathetic]回复内容");
    assert.equal(outgoingText.ai_generation.model_outputs[0].operation, "text");

    const conversations = database.listConversations();
    assert.equal(conversations.total, 1);
    assert.equal(conversations.conversations[0].scene, "c2c");
    assert.equal(conversations.conversations[0].target_id, "user-openid");
    assert.equal(conversations.conversations[0].message_count, 3);
    assert.equal(conversations.conversations[0].failed_count, 1);
    assert.equal(conversations.conversations[0].blocked, false);

    database.setConversationBlocked("c2c", "user-openid", true);
    assert.equal(database.isConversationBlocked("c2c", "user-openid"), true);
    assert.equal(database.listConversations().conversations[0].blocked, true);
    database.setConversationBlocked("c2c", "user-openid", false);

    database.recordAIUsage({
      model: "qwen-flash",
      operation: "text",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    });
    assert.equal(database.getAIUsage().total_tokens, 120);

    const conversationMessages = database.listMessages({ targetId: "user-openid" });
    assert.equal(conversationMessages.total, 3);

    const stats = database.getStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.incoming, 1);
    assert.equal(stats.outgoing, 2);
    assert.equal(stats.failed, 1);
  } finally {
    database.close();
    temporary.remove();
  }
});

test("接收消息使用持久化状态去重并允许失败后重试", () => {
  const temporary = createTemporaryDatabase();
  const { database } = temporary;
  const context = createContext();

  try {
    assert.equal(database.claimIncomingMessage("c2c", "incoming-message-id"), true);
    const recordId = database.recordIncomingOnce(context, ["text", "image"]);
    assert.equal(Number.isInteger(recordId), true);
    assert.equal(database.recordIncomingOnce(context, ["text", "image"]), null);
    database.updateMessageAttachments(recordId, [{ local_url: "/media/archived.png" }]);
    assert.equal(database.getMessage(recordId).attachments[0].local_url, "/media/archived.png");

    database.finishIncomingMessage("c2c", "incoming-message-id", "failed", "临时发送失败");
    assert.equal(database.getMessageReceipt("c2c", "incoming-message-id").state, "failed");
    assert.equal(database.claimIncomingMessage("c2c", "incoming-message-id"), true);
    assert.equal(database.getMessageReceipt("c2c", "incoming-message-id").state, "processing");

    database.finishIncomingMessage("c2c", "incoming-message-id", "completed");
    assert.equal(database.claimIncomingMessage("c2c", "incoming-message-id"), false);
    assert.equal(database.listMessages({ direction: "incoming" }).total, 1);
  } finally {
    database.close();
    temporary.remove();
  }
});

test("聊天记录页面和 API 使用同一个 SQLite 数据库", async () => {
  const temporary = createTemporaryDatabase();
  const { database } = temporary;
  const mediaDirectory = path.join(temporary.directory, "media");
  mkdirSync(mediaDirectory);
  writeFileSync(path.join(mediaDirectory, "archived.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const recordId = database.recordIncoming(createContext(), ["text", "image"]);
  const historyServer = await startChatHistoryServer({
    database,
    host: "127.0.0.1",
    port: 0,
    mediaDirectory,
  });

  try {
    const pageResponse = await fetch(historyServer.url);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /QQ Bot 聊天记录/);

    const listResponse = await fetch(`${historyServer.url}/api/messages?direction=incoming`);
    const list = await listResponse.json();
    assert.equal(list.total, 1);
    assert.equal(list.records[0].id, recordId);

    const conversationsResponse = await fetch(`${historyServer.url}/api/conversations`);
    const conversations = await conversationsResponse.json();
    assert.equal(conversations.total, 1);
    assert.equal(conversations.conversations[0].target_id, "user-openid");

    const detailResponse = await fetch(`${historyServer.url}/api/messages/${recordId}`);
    const detail = await detailResponse.json();
    assert.equal(detail.qq_message_id, "incoming-message-id");
    assert.deepEqual(detail.media_analysis, { images: [], voices: [] });
    assert.deepEqual(detail.ai_generation, {});

    const statsResponse = await fetch(`${historyServer.url}/api/stats`);
    const stats = await statsResponse.json();
    assert.equal(stats.total, 1);

    const pauseResponse = await fetch(`${historyServer.url}/api/settings/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(pauseResponse.status, 200);
    assert.equal(database.isServicePaused(), true);

    const blockResponse = await fetch(`${historyServer.url}/api/conversations/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene: "c2c", target_id: "user-openid", blocked: true }),
    });
    assert.equal(blockResponse.status, 200);
    assert.equal(database.isConversationBlocked("c2c", "user-openid"), true);

    const stateResponse = await fetch(`${historyServer.url}/api/service-state`);
    assert.deepEqual(await stateResponse.json(), { paused: true });

    const usageResponse = await fetch(`${historyServer.url}/api/usage?days=30`);
    assert.equal((await usageResponse.json()).total_tokens, 0);

    const mediaResponse = await fetch(`${historyServer.url}/media/archived.png`);
    assert.equal(mediaResponse.status, 200);
    assert.equal(mediaResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await mediaResponse.arrayBuffer()), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  } finally {
    await historyServer.close();
    database.close();
    temporary.remove();
  }
});

test("聊天记录密码同时保护页面、API 和媒体文件", async () => {
  const temporary = createTemporaryDatabase();
  const { database } = temporary;
  const mediaDirectory = path.join(temporary.directory, "protected-media");
  mkdirSync(mediaDirectory);
  writeFileSync(path.join(mediaDirectory, "protected.png"), Buffer.from([0x89, 0x50]));
  database.recordIncoming(createContext(), ["text"]);
  const historyServer = await startChatHistoryServer({
    database,
    host: "127.0.0.1",
    port: 0,
    mediaDirectory,
    password: "history-secret",
    sessionHours: 24,
  });

  try {
    const pageResponse = await fetch(historyServer.url, { redirect: "manual" });
    assert.equal(pageResponse.status, 302);
    assert.equal(pageResponse.headers.get("location"), "/login");

    const loginPageResponse = await fetch(`${historyServer.url}/login`);
    assert.equal(loginPageResponse.status, 200);
    assert.match(await loginPageResponse.text(), /请输入管理密码/);

    const unauthorizedApi = await fetch(`${historyServer.url}/api/messages`);
    assert.equal(unauthorizedApi.status, 401);
    const unauthorizedMedia = await fetch(`${historyServer.url}/media/protected.png`, {
      redirect: "manual",
    });
    assert.equal(unauthorizedMedia.status, 302);

    const wrongPassword = await fetch(`${historyServer.url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    assert.equal(wrongPassword.status, 401);

    const loginResponse = await fetch(`${historyServer.url}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({ password: "history-secret" }),
    });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get("set-cookie");
    assert.match(cookie, /qqbot_history_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    const cookieHeader = cookie.split(";")[0];

    const authorizedApi = await fetch(`${historyServer.url}/api/messages`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(authorizedApi.status, 200);
    const authorizedMedia = await fetch(`${historyServer.url}/media/protected.png`, {
      headers: { Cookie: cookieHeader },
    });
    assert.equal(authorizedMedia.status, 200);

    const logoutResponse = await fetch(`${historyServer.url}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookieHeader },
    });
    assert.equal(logoutResponse.status, 200);
    assert.match(logoutResponse.headers.get("set-cookie"), /Max-Age=0/);
  } finally {
    await historyServer.close();
    database.close();
    temporary.remove();
  }
});
