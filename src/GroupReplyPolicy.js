const GROUP_AT_EVENT = "GROUP_AT_MESSAGE_CREATE";
const GROUP_MESSAGE_EVENT = "GROUP_MESSAGE_CREATE";

const GROUP_REPLY_MODE = Object.freeze({
  AT_ONLY: "at_only",
  SMART: "smart",
});

function normalizeBotNames(botNames) {
  const names = Array.isArray(botNames) ? botNames : [];
  return names
    .map((name) => String(name || "").trim().toLowerCase())
    .filter(Boolean);
}

function getGroupMemberKey(context) {
  const message = context?.message || {};
  const groupId = message.group_openid;
  const memberId = message.author?.member_openid;
  if (!groupId || !memberId) return null;
  return `${groupId}:member:${memberId}`;
}

function getReferencedMessageId(message = {}) {
  return message.message_reference?.message_id
    || message.message_reference?.id
    || message.reply?.message_id
    || message.reply_to_message_id
    || null;
}

function containsBotName(content, botNames) {
  const text = String(content || "").trim().toLowerCase();
  if (!text) return false;
  return normalizeBotNames(botNames).some((name) => text.includes(name));
}

function getCurrentBotMentions(message = {}, botNames = []) {
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  return mentions.filter((mention) => {
    if (mention?.is_you === true) return true;
    return mention?.bot === true && containsBotName(mention.username, botNames);
  });
}

function mentionsCurrentBot(message = {}, botNames = []) {
  return getCurrentBotMentions(message, botNames).length > 0;
}

function stripCurrentBotMention(content, message = {}, botNames = []) {
  let text = String(content || "");
  for (const mention of getCurrentBotMentions(message, botNames)) {
    const ids = [mention.id, mention.member_openid].filter(Boolean);
    for (const id of new Set(ids)) {
      text = text.replaceAll(`<@${id}>`, "").replaceAll(`<@!${id}>`, "");
    }
  }
  return text.replace(/^\s+/u, "").trimEnd();
}

function isTerminalGroupChatter(content) {
  const text = String(content || "")
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？!?、,.~～…]+/g, "");
  if (!text) return true;

  return /^(哈+|呵+|嘿+|嘻+|嗯+|哦+|噢+|啊+|好+|好的|行|可以|收到|知道了|谢谢|谢了|晚安|拜拜|再见|6+|666+|ok|okay|kk|thx)$/.test(text);
}

function hasNonTextContent(message = {}) {
  return (Array.isArray(message.attachments) && message.attachments.length > 0)
    || Boolean(message.markdown)
    || Boolean(message.ark)
    || (Array.isArray(message.embeds) && message.embeds.length > 0);
}

class GroupReplyPolicy {
  constructor({
    mode = GROUP_REPLY_MODE.SMART,
    botNames = ["布伦妮", "Brune"],
    conversationWindowMs = 120_000,
    database = null,
    now = () => Date.now(),
  } = {}) {
    this.mode = mode === GROUP_REPLY_MODE.AT_ONLY
      ? GROUP_REPLY_MODE.AT_ONLY
      : GROUP_REPLY_MODE.SMART;
    this.botNames = normalizeBotNames(botNames);
    this.conversationWindowMs = Math.max(Number(conversationWindowMs) || 0, 0);
    this.database = database;
    this.now = now;
    this.activeConversations = new Map();
  }

  activate(context) {
    const key = getGroupMemberKey(context);
    if (!key || this.conversationWindowMs <= 0) return;
    this.activeConversations.set(key, this.now() + this.conversationWindowMs);
  }

  isActive(context) {
    const key = getGroupMemberKey(context);
    if (!key) return false;

    const expiresAt = this.activeConversations.get(key) || 0;
    if (expiresAt <= this.now()) {
      this.activeConversations.delete(key);
      return false;
    }
    return true;
  }

  referencesBotMessage(message) {
    const referencedMessageId = getReferencedMessageId(message);
    return Boolean(
      referencedMessageId
      && this.database?.hasSentOutgoingMessage(referencedMessageId),
    );
  }

  evaluate(context) {
    if (context?.scene !== "group") {
      return { shouldReply: true, reason: "non_group" };
    }

    if (context.eventType === GROUP_AT_EVENT) {
      this.activate(context);
      return { shouldReply: true, reason: "at_bot" };
    }

    if (mentionsCurrentBot(context.message, this.botNames)) {
      this.activate(context);
      return { shouldReply: true, reason: "at_bot" };
    }

    if (context.eventType !== GROUP_MESSAGE_EVENT) {
      return { shouldReply: false, reason: "unsupported_group_event" };
    }

    if (this.mode === GROUP_REPLY_MODE.AT_ONLY) {
      return { shouldReply: false, reason: "at_only" };
    }

    if (this.referencesBotMessage(context.message)) {
      this.activate(context);
      return { shouldReply: true, reason: "reply_to_bot" };
    }

    if (containsBotName(context.message?.content, this.botNames)) {
      this.activate(context);
      return { shouldReply: true, reason: "bot_name" };
    }

    const hasMeaningfulContent = hasNonTextContent(context.message)
      || !isTerminalGroupChatter(context.message?.content);
    if (this.isActive(context) && hasMeaningfulContent) {
      this.activate(context);
      return { shouldReply: true, reason: "active_conversation" };
    }

    return { shouldReply: false, reason: "ordinary_group_message" };
  }

  clear() {
    this.activeConversations.clear();
  }
}

module.exports = {
  GROUP_REPLY_MODE,
  GroupReplyPolicy,
  containsBotName,
  getGroupMemberKey,
  getCurrentBotMentions,
  getReferencedMessageId,
  hasNonTextContent,
  isTerminalGroupChatter,
  mentionsCurrentBot,
  stripCurrentBotMention,
};
