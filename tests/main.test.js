const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CONTENT_TYPE,
  buildAIGenerationRecord,
  buildMediaUploadPayload,
  buildReplyPayload,
  classifyAttachment,
  createBatchedContext,
  createReplyContext,
  getMessageBatchKey,
  getMessageContentTypes,
  getOutgoingContentTypes,
  hasVoiceInput,
  shouldUseVoiceReply,
} = require("../main");

test("同一用户消息的多个回复气泡递增 msg_seq", () => {
  const context = {
    scene: "c2c",
    nextMessageSequence: 1,
    message: {
      id: "message-id",
      author: { user_openid: "user-1" },
    },
  };

  assert.deepEqual(buildReplyPayload(context, { content: "第一条", msg_type: 0 }), {
    content: "第一条",
    msg_type: 0,
    msg_id: "message-id",
    msg_seq: 1,
  });
  assert.deepEqual(buildReplyPayload(context, { content: "第二条", msg_type: 0 }), {
    content: "第二条",
    msg_type: 0,
    msg_id: "message-id",
    msg_seq: 2,
  });
});

test("消息聚合键隔离群成员并使用最新消息作为回复目标", () => {
  const first = {
    scene: "group",
    message: {
      id: "message-1",
      group_openid: "group-1",
      author: { member_openid: "user-a" },
    },
  };
  const second = {
    scene: "group",
    message: {
      id: "message-2",
      group_openid: "group-1",
      author: { member_openid: "user-a" },
    },
  };
  const otherUser = {
    ...second,
    message: { ...second.message, author: { member_openid: "user-b" } },
  };

  assert.equal(getMessageBatchKey(first), "group:group-1:sender:user-a");
  assert.notEqual(getMessageBatchKey(first), getMessageBatchKey(otherUser));
  const batched = createBatchedContext([first, second]);
  assert.equal(batched.message.id, "message-2");
  assert.equal(batched.nextMessageSequence, 1);
  assert.deepEqual(batched.batchContexts, [first, second]);
});

test("交给 AI 的群消息移除机器人 mention 但保留原始消息", () => {
  const context = {
    scene: "group",
    eventType: "GROUP_MESSAGE_CREATE",
    message: {
      id: "message-1",
      group_openid: "group-1",
      author: { member_openid: "user-a" },
      content: "<@bot-openid> 为什么不说话",
      mentions: [{
        bot: true,
        id: "bot-openid",
        is_you: true,
        member_openid: "bot-openid",
        username: "布伦妮",
      }],
    },
  };

  const replyContext = createReplyContext(context);
  assert.equal(replyContext.message.content, "为什么不说话");
  assert.equal(context.message.content, "<@bot-openid> 为什么不说话");

  const mentionOnly = createReplyContext({
    ...context,
    message: { ...context.message, content: "<@bot-openid>" },
  });
  assert.equal(mentionOnly.message.content, "在吗？");
});

test("classifyAttachment 支持所有接收附件类型", () => {
  assert.equal(classifyAttachment({ content_type: "image/png" }), CONTENT_TYPE.IMAGE);
  assert.equal(classifyAttachment({ content_type: "video/mp4" }), CONTENT_TYPE.VIDEO);
  assert.equal(classifyAttachment({ content_type: "voice" }), CONTENT_TYPE.VOICE);
  assert.equal(classifyAttachment({ content_type: "audio/wav" }), CONTENT_TYPE.VOICE);
  assert.equal(classifyAttachment({ content_type: "file" }), CONTENT_TYPE.FILE);
  assert.equal(classifyAttachment({ content_type: "application/zip", filename: "a.zip" }), CONTENT_TYPE.FILE);
  assert.equal(classifyAttachment({ content_type: "custom/type" }), CONTENT_TYPE.UNKNOWN_ATTACHMENT);
});

test("混合消息会保留文字和每一个附件类型", () => {
  const types = getMessageContentTypes({
    content: "查看附件",
    attachments: [
      { content_type: "image/jpeg" },
      { content_type: "video/mp4" },
      { content_type: "voice" },
      { content_type: "file" },
    ],
  });

  assert.deepEqual(types, [
    CONTENT_TYPE.TEXT,
    CONTENT_TYPE.IMAGE,
    CONTENT_TYPE.VIDEO,
    CONTENT_TYPE.VOICE,
    CONTENT_TYPE.FILE,
  ]);
});

test("无法识别内容的消息仍会进入 unknown 处理", () => {
  assert.deepEqual(getMessageContentTypes({ id: "message-id" }), [CONTENT_TYPE.UNKNOWN]);
});

test("发送负载可以识别结构化消息和富媒体", () => {
  assert.deepEqual(getOutgoingContentTypes({ markdown: { content: "# 标题" }, msg_type: 2 }), [CONTENT_TYPE.MARKDOWN]);
  assert.deepEqual(getOutgoingContentTypes({ image: "https://example.com/a.png" }), [CONTENT_TYPE.IMAGE]);
  assert.deepEqual(getOutgoingContentTypes({ media: { file_info: "file-info" }, msg_type: 7 }), [CONTENT_TYPE.MEDIA]);
});

test("QQ 语音上传使用 SILK Base64 且不占主动消息频次", () => {
  assert.deepEqual(buildMediaUploadPayload(3, {
    fileData: "AiMhU0lMS19WMw==",
  }), {
    file_type: 3,
    file_data: "AiMhU0lMS19WMw==",
    srv_send_msg: false,
  });
});

test("默认仅在用户发送语音时使用语音回复", () => {
  const textContext = {
    scene: "c2c",
    message: {
      attachments: [],
      author: { user_openid: "user-1" },
    },
  };
  const voiceContext = {
    ...textContext,
    message: {
      ...textContext.message,
      attachments: [{ content_type: "voice" }],
    },
  };
  const batchedContext = {
    ...textContext,
    batchContexts: [voiceContext, textContext],
  };

  assert.equal(hasVoiceInput(textContext), false);
  assert.equal(hasVoiceInput(voiceContext), true);
  assert.equal(hasVoiceInput(batchedContext), true);
  assert.equal(shouldUseVoiceReply(textContext, "voice_on_voice"), false);
  assert.equal(shouldUseVoiceReply(voiceContext, "voice_on_voice"), true);
  assert.equal(shouldUseVoiceReply(batchedContext, "voice_on_voice"), true);
  assert.equal(shouldUseVoiceReply(textContext, "voice"), true);
  assert.equal(shouldUseVoiceReply(voiceContext, "text"), false);
  assert.equal(shouldUseVoiceReply({ ...voiceContext, scene: "channel" }, "voice"), false);
});

test("聊天记录保留文字模型原始输出和最终配音计划", () => {
  assert.deepEqual(buildAIGenerationRecord({
    replies: ["好，我们开始吧！"],
    speechReplies: [{
      text: "好，我们开始吧！",
      speech: "[excited]好，[giggles]我们开始吧！",
    }],
    modelOutputs: [{
      operation: "text",
      content: "{\"messages\":[{\"text\":\"好，我们开始吧！\"}]}",
    }],
  }, 0, {
    mode: "voice",
    applied_tags: ["[excited]", "[giggles]"],
  }), {
    model_outputs: [{
      operation: "text",
      content: "{\"messages\":[{\"text\":\"好，我们开始吧！\"}]}",
    }],
    final_text: "好，我们开始吧！",
    final_speech: "[excited]好，[giggles]我们开始吧！",
    planned_tags: ["[excited]", "[giggles]"],
    delivery: {
      mode: "voice",
      applied_tags: ["[excited]", "[giggles]"],
    },
  });
});
