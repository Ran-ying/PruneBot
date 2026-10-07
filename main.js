const { startWebSocketBot } = require("./WebSocketBot");
const { startWebhookBot } = require("./WebhookBot");
const { CONFIG_PATH, hardenDataPermissions } = require("./RuntimePaths");
const Config = {
  AIReplyNaturalSplitEnabled: true,
  AIAdaptiveReplyLengthEnabled: true,
  AIReplyCasualExpressionChance: 0.1,
  AIReplyExpressionMaxGap: 0,
  ...require(CONFIG_PATH),
};
const { AIConversationService, getConversationKey } = require("./AIConversationService");
const { AIInputService } = require("./AIInputService");
const { ChatDatabase, DEFAULT_DATABASE_PATH } = require("./ChatDatabase");
const { startChatHistoryServer } = require("./ChatHistoryServer");
const { archiveIncomingImages } = require("./IncomingMediaStorage");
const { createQwenClient } = require("./QwenService");
const { QwenTTSService } = require("./QwenTTSService");
const { MessageBatcher } = require("./MessageBatcher");
const { GroupReplyPolicy, mentionsCurrentBot, stripCurrentBotMention } = require("./GroupReplyPolicy");
const {
  sendC2CMessageRequest,
  sendGroupMessageRequest,
  sendChannelMessageRequest,
  sendDirectMessageRequest,
  uploadC2CMedia,
  uploadGroupMedia,
} = require("./MessageService");

const RECEIVE_MODE = process.env.QQBOT_RECEIVE_MODE || "websocket";
let chatDatabase = null;
let chatHistoryServer = null;
let webSocketBot = null;
let webhookBot = null;
let aiConversationService = null;
let ttsService = null;
let messageBatcher = null;
let groupReplyPolicy = null;
const pendingMessageIds = new Set();
const conversationTasks = new Map();
const incomingRecordTasks = new Map();
const mediaArchiveTasks = new Set();

const SCENE = Object.freeze({
  C2C: "c2c",
  GROUP: "group",
  CHANNEL: "channel",
  DIRECT: "direct",
});

const MESSAGE_TYPE = Object.freeze({
  TEXT: 0,
  MARKDOWN: 2,
  ARK: 3,
  EMBED: 4,
  MEDIA: 7,
});

const MEDIA_TYPE = Object.freeze({
  IMAGE: 1,
  VIDEO: 2,
  VOICE: 3,
  FILE: 4,
});

const CONTENT_TYPE = Object.freeze({
  TEXT: "text",
  IMAGE: "image",
  VIDEO: "video",
  VOICE: "voice",
  FILE: "file",
  MARKDOWN: "markdown",
  ARK: "ark",
  EMBED: "embed",
  MEDIA: "media",
  UNKNOWN_ATTACHMENT: "unknown_attachment",
  UNKNOWN: "unknown",
});

const EVENT_SCENE = new Map([
  ["C2C_MESSAGE_CREATE", SCENE.C2C],
  ["GROUP_AT_MESSAGE_CREATE", SCENE.GROUP],
  ["GROUP_MESSAGE_CREATE", SCENE.GROUP],
  ["AT_MESSAGE_CREATE", SCENE.CHANNEL],
  ["MESSAGE_CREATE", SCENE.CHANNEL],
  ["DIRECT_MESSAGE_CREATE", SCENE.DIRECT],
]);

function classifyAttachment(attachment = {}) {
  const contentType = String(attachment.content_type || "").toLowerCase();

  if (contentType.startsWith("image/")) return CONTENT_TYPE.IMAGE;
  if (contentType.startsWith("video/")) return CONTENT_TYPE.VIDEO;
  if (contentType.startsWith("audio/") || contentType === "voice") return CONTENT_TYPE.VOICE;
  if (contentType === "file" || attachment.filename) return CONTENT_TYPE.FILE;
  return CONTENT_TYPE.UNKNOWN_ATTACHMENT;
}

function getMessageContentTypes(message = {}) {
  const types = [];

  if (typeof message.content === "string" && message.content.trim()) {
    types.push(CONTENT_TYPE.TEXT);
  }

  for (const attachment of message.attachments || []) {
    types.push(classifyAttachment(attachment));
  }

  if (message.markdown) types.push(CONTENT_TYPE.MARKDOWN);
  if (message.ark) types.push(CONTENT_TYPE.ARK);
  if (Array.isArray(message.embeds) && message.embeds.length > 0) {
    types.push(CONTENT_TYPE.EMBED);
  }

  return types.length > 0 ? types : [CONTENT_TYPE.UNKNOWN];
}

function hasVoiceInput(context = {}) {
  const contexts = Array.isArray(context.batchContexts) && context.batchContexts.length > 0
    ? context.batchContexts
    : [context];
  return contexts.some((item) =>
    (item.message?.attachments || []).some(
      (attachment) => classifyAttachment(attachment) === CONTENT_TYPE.VOICE,
    ));
}

function shouldUseVoiceReply(context, replyMode = "voice_on_voice") {
  if (context.scene !== SCENE.C2C && context.scene !== SCENE.GROUP) return false;
  const mode = String(replyMode || "").toLowerCase();
  if (mode === "voice" || mode === "voice_and_text") return true;
  if (mode === "voice_on_voice") return hasVoiceInput(context);
  return false;
}

function createMessageContext(payload, scene) {
  return {
    scene,
    eventType: payload.t,
    payload,
    message: payload.d,
    nextMessageSequence: 1,
  };
}

function getMessageSenderId(context) {
  const message = context.message || {};
  if (context.scene === SCENE.C2C) return message.author?.user_openid || "unknown";
  if (context.scene === SCENE.GROUP) return message.author?.member_openid || "unknown";
  return message.author?.id || "unknown";
}

function getMessageBatchKey(context) {
  const conversationKey = getConversationKey(context);
  if (!conversationKey) return null;
  return `${conversationKey}:sender:${getMessageSenderId(context)}`;
}

function createBatchedContext(contexts) {
  const latest = contexts.at(-1);
  return {
    ...latest,
    batchContexts: contexts,
    nextMessageSequence: 1,
  };
}

function createReplyContext(context) {
  if (context?.scene !== SCENE.GROUP || !mentionsCurrentBot(context.message, Config.AIGroupBotNames)) {
    return context;
  }

  const content = stripCurrentBotMention(
    context.message?.content,
    context.message,
    Config.AIGroupBotNames,
  );
  const hasOtherContent = content
    || (Array.isArray(context.message?.attachments) && context.message.attachments.length > 0)
    || context.message?.markdown
    || context.message?.ark
    || (Array.isArray(context.message?.embeds) && context.message.embeds.length > 0);

  return {
    ...context,
    message: {
      ...context.message,
      content: hasOtherContent ? content : "在吗？",
    },
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getReplyBubbleDelayMs() {
  const minimum = Math.max(0, Number(Config.AIReplyBubbleDelayMinMs) || 0);
  const maximum = Math.max(minimum, Number(Config.AIReplyBubbleDelayMaxMs) || minimum);
  if (minimum === maximum) return minimum;
  return Math.floor(minimum + Math.random() * (maximum - minimum + 1));
}

function runKeyedTask(tasks, key, task) {
  const previous = tasks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  tasks.set(key, current);
  return current.finally(() => {
    if (tasks.get(key) === current) tasks.delete(key);
  });
}

function runConversationTask(context, task) {
  const key = getConversationKey(context) || getMessageBatchKey(context);
  return runKeyedTask(conversationTasks, key, task);
}

function buildReplyPayload(context, body) {
  const payload = { ...body };

  if (!payload.msg_id && !payload.event_id && context.message.id) {
    payload.msg_id = context.message.id;
  }

  if (
    (context.scene === SCENE.C2C || context.scene === SCENE.GROUP) &&
    payload.msg_id &&
    payload.msg_seq === undefined
  ) {
    payload.msg_seq = context.nextMessageSequence;
    context.nextMessageSequence += 1;
  }

  return payload;
}

function getOutgoingContentTypes(payload, preferredTypes = []) {
  if (preferredTypes.length > 0) return [...new Set(preferredTypes)];

  const types = [];
  if (payload.markdown || payload.msg_type === MESSAGE_TYPE.MARKDOWN) types.push(CONTENT_TYPE.MARKDOWN);
  if (payload.ark || payload.msg_type === MESSAGE_TYPE.ARK) types.push(CONTENT_TYPE.ARK);
  if (payload.embed || payload.msg_type === MESSAGE_TYPE.EMBED) types.push(CONTENT_TYPE.EMBED);
  if (payload.image) types.push(CONTENT_TYPE.IMAGE);
  if (payload.media || payload.msg_type === MESSAGE_TYPE.MEDIA) types.push(CONTENT_TYPE.MEDIA);
  if (typeof payload.content === "string" && payload.content.trim()) types.push(CONTENT_TYPE.TEXT);
  return types.length > 0 ? [...new Set(types)] : [CONTENT_TYPE.UNKNOWN];
}

async function recordIncomingMessage(context) {
  if (!chatDatabase) return;
  try {
    const recordId = chatDatabase.recordIncomingOnce(
      context,
      getMessageContentTypes(context.message),
      context.message?.attachments || [],
    );
    if (!recordId) return;

    const archiveTask = archiveIncomingImages(context.message)
      .then((attachments) => chatDatabase?.updateMessageAttachments(recordId, attachments))
      .catch((error) => console.error("接收图片后台归档失败：", error.message));
    mediaArchiveTasks.add(archiveTask);
    archiveTask.then(() => mediaArchiveTasks.delete(archiveTask));
  } catch (error) {
    console.error("接收消息记录失败：", error.message);
  }
}

function finishIncomingMessage(context, state, error = null) {
  const messageId = context?.message?.id;
  if (!chatDatabase || !messageId) return;
  try {
    chatDatabase.finishIncomingMessage(context.scene, messageId, state, error);
  } catch (databaseError) {
    console.error("更新消息处理状态失败：", databaseError.message);
  }
}

function recordOutgoingMessage(context, payload, response, status, error, metadata) {
  if (!chatDatabase) return;
  try {
    chatDatabase.recordOutgoing({
      context,
      payload,
      response,
      status,
      error,
      contentTypes: getOutgoingContentTypes(payload, metadata.contentTypes),
      attachments: metadata.attachments || [],
      aiGeneration: metadata.aiGeneration || {},
    });
  } catch (databaseError) {
    console.error("发送消息记录失败：", databaseError.message);
  }
}

// 通用发送入口。需要平台新增字段时，可以直接通过 body 传入。
async function sendRawMessage(context, body, metadata = {}) {
  const payload = buildReplyPayload(context, body);

  try {
    let response;
    switch (context.scene) {
      case SCENE.C2C:
        response = await sendC2CMessageRequest(context.message.author.user_openid, payload);
        break;
      case SCENE.GROUP:
        response = await sendGroupMessageRequest(context.message.group_openid, payload);
        break;
      case SCENE.CHANNEL:
        response = await sendChannelMessageRequest(context.message.channel_id, payload);
        break;
      case SCENE.DIRECT:
        response = await sendDirectMessageRequest(context.message.guild_id, payload);
        break;
      default:
        throw new Error(`不支持的消息场景：${context.scene}`);
    }

    recordOutgoingMessage(context, payload, response, "sent", null, metadata);
    return response;
  } catch (error) {
    recordOutgoingMessage(context, payload, null, "failed", error, metadata);
    throw error;
  }
}

async function sendTextMessage(context, content, metadata = {}) {
  const body = { content };
  if (context.scene === SCENE.C2C || context.scene === SCENE.GROUP) {
    body.msg_type = MESSAGE_TYPE.TEXT;
  }
  return sendRawMessage(context, body, metadata);
}

async function sendMarkdownMessage(context, markdown, keyboard) {
  const body = { markdown };
  if (keyboard) body.keyboard = keyboard;
  if (context.scene === SCENE.C2C || context.scene === SCENE.GROUP) {
    body.msg_type = MESSAGE_TYPE.MARKDOWN;
  }
  return sendRawMessage(context, body);
}

async function sendArkMessage(context, ark) {
  const body = { ark };
  if (context.scene === SCENE.C2C || context.scene === SCENE.GROUP) {
    body.msg_type = MESSAGE_TYPE.ARK;
  }
  return sendRawMessage(context, body);
}

async function sendEmbedMessage(context, embed) {
  if (context.scene === SCENE.C2C || context.scene === SCENE.GROUP) {
    throw new Error("QQ 单聊和群聊不支持发送 Embed 消息");
  }
  return sendRawMessage(context, { embed });
}

function buildMediaUploadPayload(fileType, source) {
  const media = { file_type: fileType, srv_send_msg: false };
  if (source.fileData) {
    media.file_data = source.fileData;
  } else if (source.url) {
    media.url = source.url;
  } else {
    throw new Error("富媒体消息必须提供 url 或 fileData");
  }
  return media;
}

async function uploadMedia(context, fileType, source) {
  const media = buildMediaUploadPayload(fileType, source);
  if (context.scene === SCENE.C2C) {
    return uploadC2CMedia(context.message.author.user_openid, media);
  }
  if (context.scene === SCENE.GROUP) {
    return uploadGroupMedia(context.message.group_openid, media);
  }

  throw new Error("该富媒体上传接口只支持 QQ 单聊和群聊");
}

async function sendMediaMessage(context, fileType, source, metadata = {}) {
  if (
    fileType === MEDIA_TYPE.IMAGE &&
    (context.scene === SCENE.CHANNEL || context.scene === SCENE.DIRECT)
  ) {
    if (!source.url) throw new Error("频道图片消息必须提供公网 url");
    return sendRawMessage(context, { image: source.url }, {
      ...metadata,
      contentTypes: [CONTENT_TYPE.IMAGE],
      attachments: [{ url: source.url, file_type: fileType }],
    });
  }

  const uploaded = await uploadMedia(context, fileType, source);
  return sendRawMessage(context, {
    msg_type: MESSAGE_TYPE.MEDIA,
    media: { file_info: uploaded.file_info },
  }, {
    ...metadata,
    contentTypes: [{
      [MEDIA_TYPE.IMAGE]: CONTENT_TYPE.IMAGE,
      [MEDIA_TYPE.VIDEO]: CONTENT_TYPE.VIDEO,
      [MEDIA_TYPE.VOICE]: CONTENT_TYPE.VOICE,
      [MEDIA_TYPE.FILE]: CONTENT_TYPE.FILE,
    }[fileType] || CONTENT_TYPE.MEDIA],
    attachments: [{
      file_type: fileType,
      url: source.url || null,
      filename: source.filename || null,
      has_file_data: Boolean(source.fileData),
      file_data_size: source.fileData ? String(source.fileData).length : 0,
    }],
  });
}

async function sendImageMessage(context, source) {
  return sendMediaMessage(context, MEDIA_TYPE.IMAGE, source);
}

async function sendVideoMessage(context, source) {
  return sendMediaMessage(context, MEDIA_TYPE.VIDEO, source);
}

async function sendVoiceMessage(context, source, metadata = {}) {
  return sendMediaMessage(context, MEDIA_TYPE.VOICE, source, metadata);
}

async function sendFileMessage(context, source) {
  return sendMediaMessage(context, MEDIA_TYPE.FILE, source);
}

// 以下方法是业务处理入口。context.payload 始终保留完整的 WebSocket/Webhook 负载。
async function handleTextMessage(context) {
  console.log("未交给 AI 的文字消息：", context.message.content.trim());
}

async function handleImageMessage(context, attachment) {
  console.log("忽略图片消息：", attachment);
}

async function handleVideoMessage(context, attachment) {
  console.log("忽略视频消息：", attachment);
}

async function handleVoiceMessage(context, attachment) {
  console.log("忽略语音消息：", attachment);
}

async function handleFileMessage(context, attachment) {
  console.log("忽略文件消息：", attachment);
}

async function handleMarkdownMessage(context) {
  console.log("忽略 Markdown 消息：", context.message.markdown);
}

async function handleArkMessage(context) {
  console.log("忽略 Ark 消息：", context.message.ark);
}

async function handleEmbedMessage(context) {
  console.log("忽略 Embed 消息：", context.message.embeds);
}

async function handleUnknownAttachment(context, attachment) {
  console.log("收到未知附件消息：", attachment, context.eventType);
}

async function handleUnknownMessage(context) {
  console.log("收到未知格式消息：", context.message);
}

function buildAIGenerationRecord(result, replyIndex, delivery = {}) {
  const text = result.replies?.[replyIndex] || "";
  const speech = result.speechReplies?.[replyIndex]?.speech || text;
  return {
    model_outputs: Array.isArray(result.modelOutputs) ? result.modelOutputs : [],
    final_text: text,
    final_speech: speech,
    planned_tags: speech.match(/\[[^\]\n]{1,60}\]/gu) || [],
    delivery,
  };
}

async function dispatchMessageContent(context) {
  const message = context.message;
  let handled = false;

  if (message.author?.bot) {
    console.log("忽略机器人发送的消息");
    return;
  }

  if (aiConversationService) {
    const result = await aiConversationService.generateReply(context);
    if (result) {
      const replies = Array.isArray(result.replies) && result.replies.length > 0
        ? result.replies.slice(0, 3)
        : [result.reply].filter(Boolean);
      const sentReplies = [];
      const conversationKey = getConversationKey(context);
      for (const [replyIndex, reply] of replies.entries()) {
        if (sentReplies.length > 0) await sleep(getReplyBubbleDelayMs());
        try {
          const replyMode = String(Config.AITTSReplyMode || "voice_on_voice").toLowerCase();
          const useVoice =
            shouldUseVoiceReply(context, replyMode) &&
            ttsService?.canSynthesize(reply);

          if (useVoice) {
            try {
              const speechText = result.speechReplies?.[replyIndex]?.speech;
              const audio = await ttsService.synthesize(reply, {
                conversationKey,
                speechText,
              });
              await sendVoiceMessage(context, audio, {
                aiGeneration: buildAIGenerationRecord(result, replyIndex, {
                  mode: "voice",
                  tts_model: audio.model,
                  tts_voice: audio.voice,
                  applied_tags: audio.tags,
                  tts_characters: audio.characters,
                  duration_ms: audio.durationMs,
                  tts_request_id: audio.requestId,
                }),
              });
              console.log(
                `已发送 AI 语音回复：${audio.model}，${audio.characters} 字符，`
                + `${audio.durationMs ?? "未知"}ms，标签 `
                + `${audio.tags.length > 0 ? audio.tags.join(" ") : "模型自动表达"}`,
              );
              if (replyMode === "voice_and_text") {
                try {
                  await sendTextMessage(context, reply, {
                    aiGeneration: buildAIGenerationRecord(result, replyIndex, {
                      mode: "voice_and_text",
                      paired_voice_request_id: audio.requestId,
                    }),
                  });
                } catch (error) {
                  console.error(`语音已发送，但附带原文发送失败：${error.message}`);
                }
              }
            } catch (error) {
              console.error(`AI 语音回复失败，已退回文字：${error.message}`);
              await sendTextMessage(context, reply, {
                aiGeneration: buildAIGenerationRecord(result, replyIndex, {
                  mode: "text_fallback",
                  tts_error: error.message,
                }),
              });
            }
          } else {
            await sendTextMessage(context, reply, {
              aiGeneration: buildAIGenerationRecord(result, replyIndex, {
                mode: "text",
              }),
            });
          }
          sentReplies.push(reply);
        } catch (error) {
          if (sentReplies.length === 0) throw error;
          console.error(`后续消息气泡发送失败：${error.message}`);
          break;
        }
      }
      if (sentReplies.length > 0) {
        aiConversationService.commitExchange({
          ...result,
          replies: sentReplies,
          reply: sentReplies.join("\n"),
        });
      }
      return;
    }
  }

  if (typeof message.content === "string" && message.content.trim()) {
    handled = true;
    await handleTextMessage(context);
  }

  for (const attachment of message.attachments || []) {
    handled = true;
    switch (classifyAttachment(attachment)) {
      case CONTENT_TYPE.IMAGE:
        await handleImageMessage(context, attachment);
        break;
      case CONTENT_TYPE.VIDEO:
        await handleVideoMessage(context, attachment);
        break;
      case CONTENT_TYPE.VOICE:
        await handleVoiceMessage(context, attachment);
        break;
      case CONTENT_TYPE.FILE:
        await handleFileMessage(context, attachment);
        break;
      default:
        await handleUnknownAttachment(context, attachment);
    }
  }

  if (message.markdown) {
    handled = true;
    await handleMarkdownMessage(context);
  }
  if (message.ark) {
    handled = true;
    await handleArkMessage(context);
  }
  if (Array.isArray(message.embeds) && message.embeds.length > 0) {
    handled = true;
    await handleEmbedMessage(context);
  }
  if (!handled) await handleUnknownMessage(context);
}

async function processMessageBatch(contexts) {
  if (contexts.length === 0) return;
  const context = createBatchedContext(contexts);
  try {
    await runConversationTask(context, () => dispatchMessageContent(context));
    for (const item of contexts) finishIncomingMessage(item, "completed");
    const ids = contexts.map((item) => item.message?.id || "NO_ID").join(", ");
    console.log(`已处理消息批次（${contexts.length} 条）：${ids}`);
  } catch (error) {
    for (const item of contexts) finishIncomingMessage(item, "failed", error);
    throw error;
  } finally {
    for (const item of contexts) {
      if (item.message?.id) pendingMessageIds.delete(item.message.id);
    }
  }
}

async function receiveMessage(payload) {
  if (!payload || payload.op !== 0 || !payload.d) return;

  const scene = EVENT_SCENE.get(payload.t);
  if (!scene) return;

  const context = createMessageContext(payload, scene);
  const batchKey = getMessageBatchKey(context);
  if (context.message.id) {
    if (pendingMessageIds.has(context.message.id)) {
      console.log(`忽略正在处理的重复消息：${context.message.id}`);
      return;
    }
    if (chatDatabase && !chatDatabase.claimIncomingMessage(scene, context.message.id)) {
      console.log(`忽略已完成或已忽略的重复消息：${context.message.id}`);
      return;
    }
    pendingMessageIds.add(context.message.id);
  }
  await runKeyedTask(
    incomingRecordTasks,
    batchKey || `message:${context.message.id || "unknown"}`,
    () => recordIncomingMessage(context),
  );
  const targetId = {
    [SCENE.C2C]: context.message.author?.user_openid,
    [SCENE.GROUP]: context.message.group_openid,
    [SCENE.CHANNEL]: context.message.channel_id,
    [SCENE.DIRECT]: context.message.guild_id,
  }[scene];
  if (chatDatabase?.isServicePaused()) {
    finishIncomingMessage(context, "ignored", "service_paused");
    if (context.message.id) pendingMessageIds.delete(context.message.id);
    console.log(`服务已暂停，仅记录消息：${payload.t}`);
    return;
  }
  if (chatDatabase?.isConversationBlocked(scene, targetId)) {
    finishIncomingMessage(context, "ignored", "conversation_blocked");
    if (context.message.id) pendingMessageIds.delete(context.message.id);
    console.log(`会话已封禁，仅记录消息：${scene}`);
    return;
  }
  const groupReplyDecision = groupReplyPolicy?.evaluate(context)
    || { shouldReply: true, reason: "policy_not_initialized" };
  if (!groupReplyDecision.shouldReply) {
    finishIncomingMessage(context, "ignored", groupReplyDecision.reason);
    if (context.message.id) pendingMessageIds.delete(context.message.id);
    console.log(`群消息仅记录，不回复：${groupReplyDecision.reason} ${payload.d.id || "NO_ID"}`);
    return;
  }
  const replyContext = createReplyContext(context);
  if (messageBatcher && batchKey) {
    messageBatcher.enqueue(batchKey, replyContext);
    console.log(`消息已进入聚合队列：${payload.t} ${payload.d.id || "NO_ID"}`);
    return;
  }

  try {
    await dispatchMessageContent(replyContext);
    finishIncomingMessage(context, "completed");
    console.log(`已处理消息：${payload.t} ${payload.d.id || "NO_ID"}`);
  } catch (error) {
    finishIncomingMessage(context, "failed", error);
    throw error;
  } finally {
    if (context.message.id) pendingMessageIds.delete(context.message.id);
  }
}

async function main() {
  hardenDataPermissions();
  const databasePath = process.env.QQBOT_HISTORY_DATABASE || DEFAULT_DATABASE_PATH;
  chatDatabase = new ChatDatabase(databasePath);
  const qwenClient = createQwenClient({
    onUsage: (usage) => chatDatabase.recordAIUsage(usage),
  });
  ttsService = new QwenTTSService({
    config: Config,
    onUsage: (usage) => {
      console.log(
        `AI 用量：${usage.model} ${usage.operation} ${usage.characters} 字符`
        + `${usage.conversationKey ? `，会话 ${usage.conversationKey}` : ""}`,
      );
    },
  });
  const inputService = new AIInputService({ config: Config, qwenClient });
  aiConversationService = new AIConversationService({
    config: Config,
    database: chatDatabase,
    qwenClient,
    inputService,
  });
  groupReplyPolicy = new GroupReplyPolicy({
    mode: Config.AIGroupReplyMode,
    botNames: Config.AIGroupBotNames,
    conversationWindowMs: Config.AIGroupConversationWindowMs,
    database: chatDatabase,
  });
  messageBatcher = new MessageBatcher({
    waitMs: Config.AIMessageBatchWaitMs,
    maxWaitMs: Config.AIMessageBatchMaxWaitMs,
    maxMessages: Config.AIMessageBatchMaxMessages,
    processBatch: processMessageBatch,
  });
  if (String(Config.ChatHistoryPassword || "").trim()) {
    chatHistoryServer = await startChatHistoryServer({
      database: chatDatabase,
      password: Config.ChatHistoryPassword,
      sessionHours: Config.ChatHistorySessionHours,
    });
    console.log(`聊天记录页面：${chatHistoryServer.url}`);
  } else {
    console.error("Config.json 缺少 ChatHistoryPassword，聊天记录页面未启动");
  }

  const options = { onEvent: receiveMessage };
  if (RECEIVE_MODE === "webhook") {
    webhookBot = await startWebhookBot({
      ...options,
      appId: Config.AppID,
      appSecret: Config.AppSecret,
    });
    console.log(`Webhook 回调地址：${webhookBot.url}`);
    return;
  }
  webSocketBot = await startWebSocketBot(options);
}

async function shutdown() {
  if (webSocketBot) {
    webSocketBot.close();
    webSocketBot = null;
  }
  if (webhookBot) {
    await webhookBot.close();
    webhookBot = null;
  }
  if (groupReplyPolicy) {
    groupReplyPolicy.clear();
    groupReplyPolicy = null;
  }
  if (messageBatcher) {
    const abandoned = messageBatcher.close();
    for (const context of abandoned) {
      finishIncomingMessage(context, "failed", "service_shutting_down");
    }
    messageBatcher = null;
  }
  pendingMessageIds.clear();
  incomingRecordTasks.clear();
  conversationTasks.clear();
  if (chatHistoryServer) {
    await chatHistoryServer.close();
    chatHistoryServer = null;
  }
  if (mediaArchiveTasks.size > 0) {
    await Promise.allSettled([...mediaArchiveTasks]);
    mediaArchiveTasks.clear();
  }
  if (chatDatabase) {
    chatDatabase.close();
    chatDatabase = null;
  }
  aiConversationService = null;
  ttsService = null;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
    shutdown().catch((shutdownError) => console.error(shutdownError));
  });

  process.once("SIGINT", () => shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => shutdown().finally(() => process.exit(0)));
}

module.exports = {
  SCENE,
  MESSAGE_TYPE,
  MEDIA_TYPE,
  CONTENT_TYPE,
  classifyAttachment,
  hasVoiceInput,
  shouldUseVoiceReply,
  getMessageContentTypes,
  getOutgoingContentTypes,
  buildMediaUploadPayload,
  buildAIGenerationRecord,
  buildReplyPayload,
  getMessageBatchKey,
  createBatchedContext,
  createReplyContext,
  receiveMessage,
  processMessageBatch,
  dispatchMessageContent,
  handleTextMessage,
  handleImageMessage,
  handleVideoMessage,
  handleVoiceMessage,
  handleFileMessage,
  handleMarkdownMessage,
  handleArkMessage,
  handleEmbedMessage,
  handleUnknownAttachment,
  handleUnknownMessage,
  sendRawMessage,
  sendTextMessage,
  sendMarkdownMessage,
  sendArkMessage,
  sendEmbedMessage,
  sendImageMessage,
  sendVideoMessage,
  sendVoiceMessage,
  sendFileMessage,
};
