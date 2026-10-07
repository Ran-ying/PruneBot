const { DatabaseSync } = require("node:sqlite");
const {
  CHAT_DATABASE_PATH,
  ensureDataDirectory,
  hardenDataPermissions,
} = require("./RuntimePaths");

const DEFAULT_DATABASE_PATH = CHAT_DATABASE_PATH;
const VALID_DIRECTIONS = new Set(["incoming", "outgoing"]);
const VALID_SCENES = new Set(["c2c", "group", "channel", "direct"]);
const VALID_STATUSES = new Set(["received", "sent", "failed"]);
const VALID_RECEIPT_STATES = new Set(["processing", "completed", "ignored", "failed"]);

function toJson(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function fromJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getSenderId(scene, message = {}) {
  if (scene === "c2c") return message.author?.user_openid || null;
  if (scene === "group") return message.author?.member_openid || null;
  return message.author?.id || null;
}

function getTargetId(scene, message = {}) {
  if (scene === "c2c") return message.author?.user_openid || null;
  if (scene === "group") return message.group_openid || null;
  if (scene === "channel") return message.channel_id || null;
  if (scene === "direct") return message.guild_id || null;
  return null;
}

function getVisibleContent(payload = {}) {
  if (typeof payload.content === "string") return payload.content;
  if (typeof payload.markdown?.content === "string") return payload.markdown.content;
  if (payload.ark) return "[Ark 消息]";
  if (payload.embed || payload.embeds) return "[Embed 消息]";
  if (payload.media) return "[富媒体消息]";
  return "";
}

function normalizeRow(row) {
  if (!row) return null;
  const payload = fromJson(row.payload, {});
  const message = payload.d || payload;
  const mediaAnalysis = fromJson(row.media_analysis, {});
  const aiGeneration = fromJson(row.ai_generation, {});
  return {
    ...row,
    content_types: fromJson(row.content_types, []),
    attachments: fromJson(row.attachments, []),
    media_analysis: {
      images: Array.isArray(mediaAnalysis.images) ? mediaAnalysis.images : [],
      voices: Array.isArray(mediaAnalysis.voices) ? mediaAnalysis.voices : [],
    },
    ai_generation: aiGeneration && typeof aiGeneration === "object" ? aiGeneration : {},
    payload,
    response_payload: fromJson(row.response_payload, null),
    sender_display_name: message.author?.username || null,
    sender_avatar_url: message.author?.avatar || null,
  };
}

function normalizeConversation(row) {
  return {
    ...row,
    message_count: Number(row.message_count || 0),
    incoming_count: Number(row.incoming_count || 0),
    outgoing_count: Number(row.outgoing_count || 0),
    failed_count: Number(row.failed_count || 0),
    last_content_types: fromJson(row.last_content_types, []),
    blocked: Boolean(row.blocked),
  };
}

class ChatDatabase {
  constructor(databasePath = DEFAULT_DATABASE_PATH) {
    this.databasePath = databasePath;
    if (databasePath === DEFAULT_DATABASE_PATH) ensureDataDirectory();
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    if (databasePath === DEFAULT_DATABASE_PATH) hardenDataPermissions();
    this.createSchema();
    this.prepareStatements();
  }

  createSchema() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
        scene TEXT NOT NULL CHECK (scene IN ('c2c', 'group', 'channel', 'direct')),
        event_type TEXT,
        content_types TEXT NOT NULL DEFAULT '[]',
        qq_message_id TEXT,
        reply_to_message_id TEXT,
        sender_id TEXT,
        target_id TEXT,
        content TEXT NOT NULL DEFAULT '',
        attachments TEXT NOT NULL DEFAULT '[]',
        media_analysis TEXT NOT NULL DEFAULT '{}',
        ai_generation TEXT NOT NULL DEFAULT '{}',
        payload TEXT NOT NULL,
        response_payload TEXT,
        status TEXT NOT NULL CHECK (status IN ('received', 'sent', 'failed')),
        error TEXT,
        platform_timestamp TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_context_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_key TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        token_estimate INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_context_summaries (
        conversation_key TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        token_estimate INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_profiles (
        scene TEXT NOT NULL CHECK (scene IN ('c2c', 'group', 'channel', 'direct')),
        target_id TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
        blocked_at TEXT,
        profile_updated_at TEXT,
        PRIMARY KEY (scene, target_id)
      );

      CREATE TABLE IF NOT EXISTS ai_usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        operation TEXT NOT NULL,
        conversation_key TEXT,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        total_tokens INTEGER NOT NULL,
        estimated INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0, 1)),
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS message_receipts (
        scene TEXT NOT NULL CHECK (scene IN ('c2c', 'group', 'channel', 'direct')),
        qq_message_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('processing', 'completed', 'ignored', 'failed')),
        last_error TEXT,
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scene, qq_message_id)
      );
    `);
    const messageColumns = new Set(
      this.database.prepare("PRAGMA table_info(chat_messages)").all().map((row) => row.name),
    );
    if (!messageColumns.has("media_analysis")) {
      this.database.exec("ALTER TABLE chat_messages ADD COLUMN media_analysis TEXT NOT NULL DEFAULT '{}'");
    }
    if (!messageColumns.has("ai_generation")) {
      this.database.exec("ALTER TABLE chat_messages ADD COLUMN ai_generation TEXT NOT NULL DEFAULT '{}'");
    }
    const profileColumns = new Set(
      this.database.prepare("PRAGMA table_info(conversation_profiles)").all().map((row) => row.name),
    );
    if (!profileColumns.has("blocked")) {
      this.database.exec("ALTER TABLE conversation_profiles ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1))");
    }
    if (!profileColumns.has("blocked_at")) {
      this.database.exec("ALTER TABLE conversation_profiles ADD COLUMN blocked_at TEXT");
    }
    this.database.exec("CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages(created_at DESC)");
    this.database.exec("CREATE INDEX IF NOT EXISTS chat_messages_direction_idx ON chat_messages(direction)");
    this.database.exec("CREATE INDEX IF NOT EXISTS chat_messages_scene_idx ON chat_messages(scene)");
    this.database.exec("CREATE INDEX IF NOT EXISTS chat_messages_qq_id_idx ON chat_messages(qq_message_id)");
    this.database.exec("CREATE INDEX IF NOT EXISTS ai_context_messages_conversation_idx ON ai_context_messages(conversation_key, id)");
    this.database.exec("CREATE INDEX IF NOT EXISTS ai_usage_created_at_idx ON ai_usage_records(created_at DESC)");
    this.database.exec("CREATE INDEX IF NOT EXISTS ai_usage_model_idx ON ai_usage_records(model)");
  }

  prepareStatements() {
    this.insertStatement = this.database.prepare(`
      INSERT INTO chat_messages (
        direction,
        scene,
        event_type,
        content_types,
        qq_message_id,
        reply_to_message_id,
        sender_id,
        target_id,
        content,
        attachments,
        ai_generation,
        payload,
        response_payload,
        status,
        error,
        platform_timestamp,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertAIContextStatement = this.database.prepare(`
      INSERT INTO ai_context_messages (
        conversation_key, role, content, token_estimate, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    this.upsertAIContextSummaryStatement = this.database.prepare(`
      INSERT INTO ai_context_summaries (
        conversation_key, summary, token_estimate, updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(conversation_key) DO UPDATE SET
        summary = excluded.summary,
        token_estimate = excluded.token_estimate,
        updated_at = excluded.updated_at
    `);
    this.upsertConversationProfileStatement = this.database.prepare(`
      INSERT INTO conversation_profiles (
        scene, target_id, display_name, avatar_url, profile_updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(scene, target_id) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, conversation_profiles.display_name),
        avatar_url = COALESCE(excluded.avatar_url, conversation_profiles.avatar_url),
        profile_updated_at = CASE
          WHEN excluded.display_name IS NOT NULL OR excluded.avatar_url IS NOT NULL
          THEN excluded.profile_updated_at
          ELSE conversation_profiles.profile_updated_at
        END
    `);
    this.insertAIUsageStatement = this.database.prepare(`
      INSERT INTO ai_usage_records (
        model, operation, conversation_key, input_tokens, output_tokens,
        total_tokens, estimated, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.upsertSettingStatement = this.database.prepare(`
      INSERT INTO bot_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    this.updateMediaAnalysisStatement = this.database.prepare(`
      UPDATE chat_messages
      SET media_analysis = ?
      WHERE direction = 'incoming' AND qq_message_id = ?
    `);
    this.updateAttachmentsStatement = this.database.prepare(`
      UPDATE chat_messages
      SET attachments = ?
      WHERE id = ? AND direction = 'incoming'
    `);
    this.findIncomingMessageStatement = this.database.prepare(`
      SELECT 1
      FROM chat_messages
      WHERE direction = 'incoming' AND scene = ? AND qq_message_id = ?
      LIMIT 1
    `);
    this.findLatestReplyAttemptStatement = this.database.prepare(`
      SELECT status
      FROM chat_messages
      WHERE direction = 'outgoing' AND scene = ? AND reply_to_message_id = ?
      ORDER BY id DESC
      LIMIT 1
    `);
    this.getMessageReceiptStatement = this.database.prepare(`
      SELECT scene, qq_message_id, state, last_error, received_at, updated_at
      FROM message_receipts
      WHERE scene = ? AND qq_message_id = ?
    `);
    this.insertMessageReceiptStatement = this.database.prepare(`
      INSERT OR IGNORE INTO message_receipts (
        scene, qq_message_id, state, last_error, received_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.updateMessageReceiptStatement = this.database.prepare(`
      UPDATE message_receipts
      SET state = ?, last_error = ?, updated_at = ?
      WHERE scene = ? AND qq_message_id = ?
    `);
    this.findSentOutgoingMessageStatement = this.database.prepare(`
      SELECT 1
      FROM chat_messages
      WHERE direction = 'outgoing'
        AND status = 'sent'
        AND qq_message_id = ?
      LIMIT 1
    `);
  }

  insert(record) {
    if (!VALID_DIRECTIONS.has(record.direction)) throw new Error("无效的聊天记录方向");
    if (!VALID_SCENES.has(record.scene)) throw new Error("无效的聊天场景");
    if (!VALID_STATUSES.has(record.status)) throw new Error("无效的聊天记录状态");

    const result = this.insertStatement.run(
      record.direction,
      record.scene,
      record.eventType || null,
      toJson(record.contentTypes, []),
      record.qqMessageId || null,
      record.replyToMessageId || null,
      record.senderId || null,
      record.targetId || null,
      record.content || "",
      toJson(record.attachments, []),
      toJson(record.aiGeneration, {}),
      toJson(record.payload, {}),
      record.responsePayload ? toJson(record.responsePayload, null) : null,
      record.status,
      record.error || null,
      record.platformTimestamp ? String(record.platformTimestamp) : null,
      record.createdAt || new Date().toISOString(),
    );

    return Number(result.lastInsertRowid);
  }

  recordIncoming(context, contentTypes, attachments = context.message?.attachments || []) {
    const message = context.message || {};
    if (context.scene === "c2c") {
      this.upsertConversationProfile({
        scene: context.scene,
        targetId: getTargetId(context.scene, message),
        displayName: message.author?.username,
        avatarUrl: message.author?.avatar,
      });
    }
    return this.insert({
      direction: "incoming",
      scene: context.scene,
      eventType: context.eventType,
      contentTypes,
      qqMessageId: message.id,
      senderId: getSenderId(context.scene, message),
      targetId: getTargetId(context.scene, message),
      content: getVisibleContent(message),
      attachments,
      payload: context.payload,
      status: "received",
      platformTimestamp: message.timestamp,
    });
  }

  recordIncomingOnce(context, contentTypes, attachments = context.message?.attachments || []) {
    const messageId = context.message?.id;
    if (messageId && this.hasIncomingMessage(context.scene, messageId)) return null;
    return this.recordIncoming(context, contentTypes, attachments);
  }

  recordOutgoing({
    context,
    payload,
    response,
    status,
    error,
    contentTypes,
    attachments,
    aiGeneration,
  }) {
    const message = context.message || {};
    return this.insert({
      direction: "outgoing",
      scene: context.scene,
      eventType: context.eventType,
      contentTypes,
      qqMessageId: response?.id,
      replyToMessageId: payload.msg_id || message.id,
      senderId: "bot",
      targetId: getTargetId(context.scene, message),
      content: aiGeneration?.final_text || getVisibleContent(payload),
      attachments,
      aiGeneration,
      payload,
      responsePayload: response,
      status,
      error: error?.message || error || null,
      platformTimestamp: response?.timestamp,
    });
  }

  buildFilters(filters = {}) {
    const conditions = [];
    const parameters = [];

    if (VALID_DIRECTIONS.has(filters.direction)) {
      conditions.push("direction = ?");
      parameters.push(filters.direction);
    }
    if (VALID_SCENES.has(filters.scene)) {
      conditions.push("scene = ?");
      parameters.push(filters.scene);
    }
    if (filters.targetId) {
      conditions.push("target_id = ?");
      parameters.push(String(filters.targetId));
    }
    if (filters.type) {
      conditions.push("content_types LIKE ?");
      parameters.push(`%\"${String(filters.type).replaceAll("%", "").replaceAll("_", "")}\"%`);
    }
    if (filters.search) {
      const search = `%${String(filters.search).slice(0, 200)}%`;
      conditions.push("(content LIKE ? OR sender_id LIKE ? OR target_id LIKE ? OR event_type LIKE ? OR qq_message_id LIKE ? OR reply_to_message_id LIKE ?)");
      parameters.push(search, search, search, search, search, search);
    }

    return {
      whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
      parameters,
    };
  }

  listMessages(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const { whereSql, parameters } = this.buildFilters(filters);
    const rows = this.database.prepare(`
      SELECT *
      FROM chat_messages
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset);
    const countRow = this.database.prepare(`
      SELECT COUNT(*) AS total
      FROM chat_messages
      ${whereSql}
    `).get(...parameters);

    return {
      records: rows.map(normalizeRow),
      total: Number(countRow.total),
      limit,
      offset,
    };
  }

  listConversations(filters = {}) {
    const conditions = ["target_id IS NOT NULL", "target_id != ''"];
    const parameters = [];
    const searchConditions = [];
    const searchParameters = [];
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 200);

    if (VALID_SCENES.has(filters.scene)) {
      conditions.push("scene = ?");
      parameters.push(filters.scene);
    }
    if (filters.search) {
      const search = `%${String(filters.search).slice(0, 200)}%`;
      searchConditions.push("(target_id LIKE ? OR sender_id LIKE ? OR content LIKE ?)");
      searchParameters.push(search, search, search);
    }

    const rows = this.database.prepare(`
      WITH eligible_messages AS (
        SELECT *
        FROM chat_messages
        WHERE ${conditions.join(" AND ")}
      ), matched_conversations AS (
        SELECT DISTINCT scene, target_id
        FROM eligible_messages
        ${searchConditions.length > 0 ? `WHERE ${searchConditions.join(" AND ")}` : ""}
      ), grouped_conversations AS (
        SELECT
          eligible.scene,
          eligible.target_id,
          MAX(eligible.id) AS last_message_id,
          COUNT(*) AS message_count,
          SUM(CASE WHEN eligible.direction = 'incoming' THEN 1 ELSE 0 END) AS incoming_count,
          SUM(CASE WHEN eligible.direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing_count,
          SUM(CASE WHEN eligible.status = 'failed' THEN 1 ELSE 0 END) AS failed_count
        FROM eligible_messages AS eligible
        JOIN matched_conversations AS matched
          ON matched.scene = eligible.scene AND matched.target_id = eligible.target_id
        GROUP BY eligible.scene, eligible.target_id
      )
      SELECT
        grouped_conversations.*,
        latest.direction AS last_direction,
        latest.content AS last_content,
        latest.content_types AS last_content_types,
        latest.status AS last_status,
        latest.created_at AS last_created_at,
        latest.sender_id AS last_sender_id,
        profile.display_name,
        profile.avatar_url,
        profile.blocked
      FROM grouped_conversations
      JOIN eligible_messages AS latest
        ON latest.id = grouped_conversations.last_message_id
      LEFT JOIN conversation_profiles AS profile
        ON profile.scene = grouped_conversations.scene
        AND profile.target_id = grouped_conversations.target_id
      ORDER BY grouped_conversations.last_message_id DESC
      LIMIT ?
    `).all(...parameters, ...searchParameters, limit);

    return {
      conversations: rows.map(normalizeConversation),
      total: rows.length,
      limit,
    };
  }

  getMessage(id) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId < 1) return null;
    return normalizeRow(this.database.prepare("SELECT * FROM chat_messages WHERE id = ?").get(numericId));
  }

  updateMessageMediaAnalysis(qqMessageId, analysis) {
    if (!qqMessageId) return 0;
    const result = this.updateMediaAnalysisStatement.run(
      toJson(analysis, { images: [], voices: [] }),
      String(qqMessageId),
    );
    return Number(result.changes);
  }

  updateMessageAttachments(recordId, attachments) {
    const numericId = Number(recordId);
    if (!Number.isInteger(numericId) || numericId < 1) return 0;
    const result = this.updateAttachmentsStatement.run(toJson(attachments, []), numericId);
    return Number(result.changes);
  }

  hasIncomingMessage(scene, qqMessageId) {
    if (!VALID_SCENES.has(scene) || !qqMessageId) return false;
    return Boolean(this.findIncomingMessageStatement.get(scene, String(qqMessageId)));
  }

  claimIncomingMessage(scene, qqMessageId, { staleAfterMs = 5 * 60_000 } = {}) {
    if (!VALID_SCENES.has(scene) || !qqMessageId) return true;
    const messageId = String(qqMessageId);
    const now = new Date();
    const nowText = now.toISOString();
    let receipt = this.getMessageReceiptStatement.get(scene, messageId);

    if (!receipt) {
      const latestReply = this.findLatestReplyAttemptStatement.get(scene, messageId);
      const alreadyRecorded = this.hasIncomingMessage(scene, messageId);
      const initialState = latestReply?.status === "sent"
        ? "completed"
        : latestReply?.status === "failed"
          ? "processing"
          : alreadyRecorded ? "ignored" : "processing";
      const result = this.insertMessageReceiptStatement.run(
        scene,
        messageId,
        initialState,
        null,
        nowText,
        nowText,
      );
      if (Number(result.changes) > 0) return initialState === "processing";
      receipt = this.getMessageReceiptStatement.get(scene, messageId);
    }

    const updatedAt = Date.parse(receipt?.updated_at || "");
    const isStale = receipt?.state === "processing"
      && (!Number.isFinite(updatedAt) || now.getTime() - updatedAt >= Math.max(1, staleAfterMs));
    if (receipt?.state !== "failed" && !isStale) return false;

    this.updateMessageReceiptStatement.run(
      "processing",
      null,
      nowText,
      scene,
      messageId,
    );
    return true;
  }

  finishIncomingMessage(scene, qqMessageId, state, error = null) {
    if (!VALID_SCENES.has(scene) || !qqMessageId) return 0;
    if (!VALID_RECEIPT_STATES.has(state) || state === "processing") {
      throw new Error("无效的消息处理状态");
    }
    const result = this.updateMessageReceiptStatement.run(
      state,
      error?.message || error || null,
      new Date().toISOString(),
      scene,
      String(qqMessageId),
    );
    return Number(result.changes);
  }

  getMessageReceipt(scene, qqMessageId) {
    if (!VALID_SCENES.has(scene) || !qqMessageId) return null;
    return this.getMessageReceiptStatement.get(scene, String(qqMessageId)) || null;
  }

  upsertConversationProfile({ scene, targetId, displayName, avatarUrl }) {
    if (!VALID_SCENES.has(scene) || !targetId) return;
    const normalizedName = String(displayName || "").trim() || null;
    const normalizedAvatar = String(avatarUrl || "").trim() || null;
    this.upsertConversationProfileStatement.run(
      scene,
      String(targetId),
      normalizedName,
      normalizedAvatar,
      new Date().toISOString(),
    );
  }

  setConversationBlocked(scene, targetId, blocked) {
    if (!VALID_SCENES.has(scene) || !targetId) throw new Error("无效的封禁会话");
    this.upsertConversationProfile({ scene, targetId });
    this.database.prepare(`
      UPDATE conversation_profiles
      SET blocked = ?, blocked_at = ?
      WHERE scene = ? AND target_id = ?
    `).run(blocked ? 1 : 0, blocked ? new Date().toISOString() : null, scene, String(targetId));
  }

  getConversationProfile(scene, targetId) {
    if (!VALID_SCENES.has(scene) || !targetId) return null;
    const row = this.database.prepare(`
      SELECT scene, target_id, display_name, avatar_url,
             blocked, blocked_at, profile_updated_at
      FROM conversation_profiles
      WHERE scene = ? AND target_id = ?
    `).get(scene, String(targetId));
    if (!row) return null;
    return {
      ...row,
      blocked: Boolean(row.blocked),
    };
  }

  isConversationBlocked(scene, targetId) {
    return this.getConversationProfile(scene, targetId)?.blocked === true;
  }

  setServicePaused(paused) {
    this.upsertSettingStatement.run(
      "service_paused",
      paused ? "1" : "0",
      new Date().toISOString(),
    );
  }

  isServicePaused() {
    const row = this.database.prepare(
      "SELECT value FROM bot_settings WHERE key = 'service_paused'",
    ).get();
    return row?.value === "1";
  }

  recordAIUsage(record) {
    this.insertAIUsageStatement.run(
      String(record.model || "unknown"),
      String(record.operation || "chat"),
      record.conversationKey || null,
      Math.max(0, Number(record.inputTokens) || 0),
      Math.max(0, Number(record.outputTokens) || 0),
      Math.max(0, Number(record.totalTokens) || 0),
      record.estimated ? 1 : 0,
      record.createdAt || new Date().toISOString(),
    );
  }

  getAIUsage(days = 30) {
    const normalizedDays = Math.min(Math.max(Number(days) || 30, 1), 365);
    const modifier = `-${normalizedDays} days`;
    const summary = this.database.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COUNT(*) AS request_count,
        COALESCE(SUM(estimated), 0) AS estimated_count
      FROM ai_usage_records
      WHERE datetime(created_at) >= datetime('now', ?)
    `).get(modifier);
    const byModel = this.database.prepare(`
      SELECT model, operation,
             SUM(input_tokens) AS input_tokens,
             SUM(output_tokens) AS output_tokens,
             SUM(total_tokens) AS total_tokens,
             COUNT(*) AS request_count
      FROM ai_usage_records
      WHERE datetime(created_at) >= datetime('now', ?)
      GROUP BY model, operation
      ORDER BY total_tokens DESC
    `).all(modifier).map((row) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, key === "model" || key === "operation" ? value : Number(value)]),
    ));
    return {
      days: normalizedDays,
      ...Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value)])),
      by_model: byModel,
    };
  }

  hasReplyAttempt(replyToMessageId) {
    if (!replyToMessageId) return false;
    return Boolean(this.database.prepare(`
      SELECT 1
      FROM chat_messages
      WHERE direction = 'outgoing'
        AND reply_to_message_id = ?
      LIMIT 1
    `).get(replyToMessageId));
  }

  hasSentOutgoingMessage(qqMessageId) {
    if (!qqMessageId) return false;
    return Boolean(this.findSentOutgoingMessageStatement.get(String(qqMessageId)));
  }

  getStats() {
    const row = this.database.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS incoming,
        SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS outgoing,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN julianday(created_at) >= julianday('now', '-1 day') THEN 1 ELSE 0 END) AS last_24_hours
      FROM chat_messages
    `).get();

    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)]));
  }

  addAIContextMessage(conversationKey, role, content, tokenEstimate) {
    if (!conversationKey) throw new Error("AI 上下文缺少 conversationKey");
    if (role !== "user" && role !== "assistant") throw new Error("无效的 AI 上下文角色");

    const result = this.insertAIContextStatement.run(
      conversationKey,
      role,
      String(content),
      Math.max(1, Number(tokenEstimate) || 1),
      new Date().toISOString(),
    );
    return Number(result.lastInsertRowid);
  }

  addAIContextExchange(conversationKey, userContent, assistantContent, estimateTokens) {
    const estimate = typeof estimateTokens === "function" ? estimateTokens : () => 1;
    this.database.exec("BEGIN");
    try {
      const userId = this.addAIContextMessage(
        conversationKey,
        "user",
        userContent,
        estimate(userContent),
      );
      const assistantId = this.addAIContextMessage(
        conversationKey,
        "assistant",
        assistantContent,
        estimate(assistantContent),
      );
      this.database.exec("COMMIT");
      return { userId, assistantId };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listAIContextMessages(conversationKey) {
    return this.database.prepare(`
      SELECT id, conversation_key, role, content, token_estimate, created_at
      FROM ai_context_messages
      WHERE conversation_key = ?
      ORDER BY id ASC
    `).all(conversationKey);
  }

  deleteAIContextMessages(ids) {
    const numericIds = ids.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (numericIds.length === 0) return 0;

    const placeholders = numericIds.map(() => "?").join(", ");
    const result = this.database.prepare(
      `DELETE FROM ai_context_messages WHERE id IN (${placeholders})`,
    ).run(...numericIds);
    return Number(result.changes);
  }

  getAIContextSummary(conversationKey) {
    return this.database.prepare(`
      SELECT conversation_key, summary, token_estimate, updated_at
      FROM ai_context_summaries
      WHERE conversation_key = ?
    `).get(conversationKey) || null;
  }

  saveAIContextSummary(conversationKey, summary, tokenEstimate) {
    this.upsertAIContextSummaryStatement.run(
      conversationKey,
      String(summary),
      Math.max(1, Number(tokenEstimate) || 1),
      new Date().toISOString(),
    );
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  ChatDatabase,
  DEFAULT_DATABASE_PATH,
};
