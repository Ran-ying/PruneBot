const test = require("node:test");
const assert = require("node:assert/strict");
const { GroupReplyPolicy } = require("./GroupReplyPolicy");

function createContext({
  eventType = "GROUP_MESSAGE_CREATE",
  content = "大家晚上好",
  memberId = "member-1",
  messageReference,
} = {}) {
  return {
    scene: "group",
    eventType,
    message: {
      id: "message-1",
      group_openid: "group-1",
      author: { member_openid: memberId },
      content,
      message_reference: messageReference,
    },
  };
}

test("群聊被 @ 时始终回复", () => {
  const policy = new GroupReplyPolicy({ mode: "at_only" });
  const result = policy.evaluate(createContext({ eventType: "GROUP_AT_MESSAGE_CREATE" }));
  assert.deepEqual(result, { shouldReply: true, reason: "at_bot" });
});

test("普通群事件通过 mentions 标记识别真实的 @ 机器人负载", () => {
  const policy = new GroupReplyPolicy({ mode: "at_only", botNames: ["布伦妮"] });
  const context = createContext({
    eventType: "GROUP_MESSAGE_CREATE",
    content: "<@bot-openid> 为什么不说话",
  });
  context.message.mentions = [{
    bot: true,
    id: "bot-openid",
    is_you: true,
    member_openid: "bot-openid",
    username: "布伦妮",
  }];

  assert.deepEqual(policy.evaluate(context), { shouldReply: true, reason: "at_bot" });
});

test("at_only 模式不处理全量群消息", () => {
  const policy = new GroupReplyPolicy({ mode: "at_only" });
  const result = policy.evaluate(createContext({ content: "布伦妮，在吗？" }));
  assert.deepEqual(result, { shouldReply: false, reason: "at_only" });
});

test("smart 模式响应点名和回复机器人的消息", () => {
  const database = {
    hasSentOutgoingMessage(messageId) {
      return messageId === "bot-message-1";
    },
  };
  const policy = new GroupReplyPolicy({
    mode: "smart",
    botNames: ["布伦妮", "Brune"],
    database,
  });

  assert.equal(policy.evaluate(createContext({ content: "Brune，你怎么看？" })).reason, "bot_name");
  assert.equal(policy.evaluate(createContext({
    content: "接着说",
    memberId: "member-2",
    messageReference: { message_id: "bot-message-1" },
  })).reason, "reply_to_bot");
});

test("刚与机器人交谈的群成员可以自然连续发送消息", () => {
  let currentTime = 1_000;
  const policy = new GroupReplyPolicy({
    conversationWindowMs: 10_000,
    now: () => currentTime,
  });
  policy.evaluate(createContext({ eventType: "GROUP_AT_MESSAGE_CREATE" }));

  currentTime = 2_000;
  assert.equal(
    policy.evaluate(createContext({ content: "我还想问另一件事" })).reason,
    "active_conversation",
  );
  assert.equal(
    policy.evaluate(createContext({ content: "哈哈" })).reason,
    "ordinary_group_message",
  );
  assert.equal(
    policy.evaluate({
      ...createContext({ content: "" }),
      message: {
        ...createContext({ content: "" }).message,
        attachments: [{ content_type: "image/png", url: "https://example.com/image.png" }],
      },
    }).reason,
    "active_conversation",
  );
  assert.equal(
    policy.evaluate(createContext({ content: "我也想问", memberId: "member-2" })).reason,
    "ordinary_group_message",
  );

  currentTime = 20_000;
  assert.equal(
    policy.evaluate(createContext({ content: "过了一会儿再说" })).reason,
    "ordinary_group_message",
  );
});

test("私聊和频道消息不受群聊策略限制", () => {
  const policy = new GroupReplyPolicy();
  const result = policy.evaluate({ scene: "c2c", eventType: "C2C_MESSAGE_CREATE", message: {} });
  assert.deepEqual(result, { shouldReply: true, reason: "non_group" });
});
