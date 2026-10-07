const state = {
  scene: "",
  search: "",
  conversations: [],
  selected: null,
  messages: [],
  loadingConversations: false,
  messageRequestId: 0,
  paused: false,
};

const labels = {
  scene: {
    c2c: "私聊用户",
    group: "群聊",
    channel: "文字子频道",
    direct: "频道私信",
  },
  type: {
    text: "文字",
    image: "图片",
    video: "视频",
    voice: "语音",
    file: "文件",
    markdown: "Markdown",
    ark: "Ark",
    embed: "Embed",
    media: "富媒体",
    unknown_attachment: "未知附件",
    unknown: "未知消息",
  },
  status: { received: "已接收", sent: "已发送", failed: "发送失败" },
};

const elements = {
  conversationList: document.querySelector("#conversation-list"),
  conversationEmpty: document.querySelector("#conversation-empty"),
  conversationCount: document.querySelector("#conversation-count"),
  search: document.querySelector("#search-input"),
  scene: document.querySelector("#scene-filter"),
  refresh: document.querySelector("#refresh-button"),
  chatEmpty: document.querySelector("#chat-empty"),
  chatView: document.querySelector("#chat-view"),
  chatAvatar: document.querySelector("#chat-avatar"),
  chatTitle: document.querySelector("#chat-title"),
  chatSubtitle: document.querySelector("#chat-subtitle"),
  chatCount: document.querySelector("#chat-count"),
  block: document.querySelector("#block-button"),
  messageList: document.querySelector("#message-list"),
  pause: document.querySelector("#pause-button"),
  serviceStatus: document.querySelector("#service-status"),
  tokenCount: document.querySelector("#stat-tokens"),
  logout: document.querySelector("#logout-button"),
  back: document.querySelector("#back-button"),
  drawer: document.querySelector("#detail-drawer"),
  backdrop: document.querySelector("#drawer-backdrop"),
  closeDrawer: document.querySelector("#close-drawer-button"),
  detail: document.querySelector("#detail-content"),
};

elements.logout?.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("/login");
  }
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatConversationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatClock(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

function formatDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知日期";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getConversationKey(conversation) {
  return `${conversation.scene}:${conversation.target_id}`;
}

function getSceneAvatar(scene) {
  return { c2c: "私", group: "群", channel: "频", direct: "信" }[scene] || "聊";
}

function safeImageUrl(value) {
  const url = String(value || "").trim();
  if (!/^https?:\/\//i.test(url)) return "";
  return url.replace(/^http:\/\/thirdqq\.qlogo\.cn/i, "https://thirdqq.qlogo.cn");
}

function avatarContent(url, fallback, alt) {
  const safeUrl = safeImageUrl(url);
  return safeUrl
    ? `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(alt)}">`
    : escapeHtml(fallback);
}

function compactId(value) {
  const text = String(value || "未知会话");
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-6)}`;
}

function contentLabel(record) {
  if (record.last_content) return record.last_content;
  const types = record.last_content_types || record.content_types || [];
  return `[${types.map((type) => labels.type[type] || type).join("、") || "无正文"}]`;
}

function renderConversations() {
  elements.conversationList.innerHTML = state.conversations.map((conversation, index) => {
    const selected = state.selected && getConversationKey(conversation) === getConversationKey(state.selected);
    const previewPrefix = conversation.last_direction === "outgoing" ? "机器人：" : "";
    const failure = conversation.failed_count > 0;
    const metaClass = conversation.blocked ? " blocked" : failure ? " failed" : "";
    const metaText = conversation.blocked
      ? "已封禁"
      : failure ? `${conversation.failed_count} 条失败` : `${conversation.message_count} 条`;
    return `
      <button class="conversation-item${selected ? " selected" : ""}" type="button" role="option"
        aria-selected="${selected}" data-index="${index}">
        <span class="conversation-avatar ${escapeHtml(conversation.scene)}">${avatarContent(conversation.avatar_url, getSceneAvatar(conversation.scene), "会话头像")}</span>
        <span class="conversation-name-row">
          <span class="conversation-name">${escapeHtml(conversation.display_name || labels.scene[conversation.scene] || conversation.scene)} · ${escapeHtml(compactId(conversation.target_id))}</span>
          <span class="conversation-time">${escapeHtml(formatConversationTime(conversation.last_created_at))}</span>
        </span>
        <span class="conversation-preview">${escapeHtml(previewPrefix + contentLabel(conversation))}</span>
        <span class="conversation-meta${metaClass}">${metaText}</span>
      </button>
    `;
  }).join("");

  elements.conversationEmpty.hidden = state.conversations.length > 0;
  elements.conversationCount.textContent = String(state.conversations.length);
}

function renderAttachments(record) {
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const images = attachments.filter((item) => String(item.content_type || "").startsWith("image/") && (item.local_url || item.url));
  const others = attachments.filter((item) => !images.includes(item));
  const imageHtml = images.length > 0
    ? `<div class="message-images">${images.map((item) => `<img src="${escapeHtml(item.local_url || item.url)}" alt="聊天图片" loading="lazy">`).join("")}</div>`
    : "";
  const otherHtml = others.length > 0
    ? `<div class="attachment-list">${others.map((item) => {
      const type = String(item.content_type || "");
      const name = item.filename || (type.startsWith("audio/") || type === "voice" ? "语音" : type.startsWith("video/") ? "视频" : "附件");
      return `<span class="attachment-item">${escapeHtml(name)}</span>`;
    }).join("")}</div>`
    : "";
  return imageHtml + otherHtml;
}

function renderMediaAnalysis(record) {
  const analysis = record.media_analysis || {};
  const images = Array.isArray(analysis.images) ? analysis.images : [];
  const voices = Array.isArray(analysis.voices) ? analysis.voices : [];
  const items = [
    ...images.filter((item) => item.text).map((item) => ({
      label: "识图结果",
      text: item.text,
    })),
    ...voices.filter((item) => item.text).map((item) => ({
      label: item.source === "qq" ? "QQ 语音转写" : "千问语音转写",
      text: item.text,
    })),
  ];
  if (items.length === 0) return "";
  return `<div class="media-analysis">${items.map((item) => `
    <div class="analysis-item">
      <span>${escapeHtml(item.label)}</span>
      <p>${escapeHtml(item.text)}</p>
    </div>
  `).join("")}</div>`;
}

function renderAIGenerationSummary(record) {
  const generation = record.ai_generation || {};
  const plannedTags = Array.isArray(generation.planned_tags) ? generation.planned_tags : [];
  const appliedTags = Array.isArray(generation.delivery?.applied_tags)
    ? generation.delivery.applied_tags
    : [];
  const tags = appliedTags.length > 0 ? appliedTags : plannedTags;
  if (tags.length === 0) return "";
  return `<div class="media-analysis">
    <div class="analysis-item">
      <span>语音标签</span>
      <p>${escapeHtml(tags.join(" "))}</p>
    </div>
  </div>`;
}

function renderMessages({ scrollToBottom = false } = {}) {
  const wasNearBottom = elements.messageList.scrollHeight - elements.messageList.scrollTop - elements.messageList.clientHeight < 100;
  let previousDay = "";
  const records = [...state.messages].reverse();
  const html = records.map((record) => {
    const day = formatDay(record.created_at);
    const separator = day !== previousDay ? `<div class="day-separator"><span>${escapeHtml(day)}</span></div>` : "";
    previousDay = day;
    const outgoing = record.direction === "outgoing";
    const failed = record.status === "failed";
    const sender = outgoing
      ? "机器人"
      : record.sender_display_name || state.selected?.display_name || compactId(record.sender_id || "用户");
    const avatarUrl = outgoing ? "" : record.sender_avatar_url || state.selected?.avatar_url;
    const text = record.content
      ? `<div class="message-text">${escapeHtml(record.content)}</div>`
      : `<div class="message-text message-placeholder">${escapeHtml(contentLabel(record))}</div>`;

    return `${separator}
      <article class="message-row ${outgoing ? "outgoing" : "incoming"}${failed ? " failed" : ""}">
        <span class="message-avatar">${avatarContent(avatarUrl, outgoing ? "Bot" : "用户", outgoing ? "机器人头像" : "用户头像")}</span>
        <div class="message-column">
          <span class="sender-label">${escapeHtml(sender)}</span>
          <div class="message-bubble" role="button" tabindex="0" data-id="${record.id}" aria-label="查看消息详情">
            ${text}
            ${renderAttachments(record)}
            ${renderMediaAnalysis(record)}
            ${renderAIGenerationSummary(record)}
          </div>
          <span class="message-footer">${escapeHtml(formatClock(record.created_at))} · <span class="${failed ? "failed" : ""}">${escapeHtml(labels.status[record.status] || record.status)}</span></span>
        </div>
      </article>`;
  }).join("");

  elements.messageList.innerHTML = `<div class="message-list-inner">${html || '<div class="panel-empty">这个会话还没有消息</div>'}</div>`;
  elements.messageList.querySelectorAll(".message-images img").forEach((image) => {
    image.addEventListener("error", () => {
      const placeholder = document.createElement("span");
      placeholder.className = "expired-image";
      placeholder.textContent = "图片链接已失效";
      image.replaceWith(placeholder);
    }, { once: true });
  });
  if (scrollToBottom || wasNearBottom) {
    requestAnimationFrame(() => {
      elements.messageList.scrollTop = elements.messageList.scrollHeight;
    });
  }
}

function renderSelectedConversation() {
  if (!state.selected) {
    elements.chatEmpty.hidden = false;
    elements.chatView.hidden = true;
    return;
  }

  const conversation = state.selected;
  elements.chatEmpty.hidden = true;
  elements.chatView.hidden = false;
  elements.chatAvatar.innerHTML = avatarContent(conversation.avatar_url, getSceneAvatar(conversation.scene), "会话头像");
  elements.chatTitle.textContent = conversation.display_name || labels.scene[conversation.scene] || conversation.scene;
  elements.chatSubtitle.textContent = `OpenID · ${conversation.target_id}`;
  elements.chatCount.textContent = `${conversation.message_count} 条消息`;
  elements.block.textContent = conversation.blocked ? "解除封禁" : "封禁";
  elements.block.className = `conversation-action${conversation.blocked ? " unblock" : ""}`;
}

async function loadConversations({ quiet = false } = {}) {
  if (state.loadingConversations) return;
  state.loadingConversations = true;
  if (!quiet) elements.refresh.disabled = true;

  try {
    const parameters = new URLSearchParams({ limit: "200" });
    if (state.scene) parameters.set("scene", state.scene);
    if (state.search) parameters.set("search", state.search);
    const response = await fetch(`/api/conversations?${parameters}`);
    if (!response.ok) throw new Error("会话加载失败");
    const data = await response.json();
    const selectedKey = state.selected ? getConversationKey(state.selected) : null;
    state.conversations = data.conversations;
    state.selected = state.conversations.find((item) => getConversationKey(item) === selectedKey)
      || state.conversations[0]
      || null;
    renderConversations();
    renderSelectedConversation();
    if (state.selected) await loadMessages({ quiet, scrollToBottom: !selectedKey });
  } catch (error) {
    elements.conversationEmpty.hidden = false;
    elements.conversationEmpty.textContent = error.message;
  } finally {
    state.loadingConversations = false;
    elements.refresh.disabled = false;
  }
}

async function loadMessages({ quiet = false, scrollToBottom = false } = {}) {
  if (!state.selected) return;
  const requestId = ++state.messageRequestId;
  const selectedKey = getConversationKey(state.selected);

  try {
    const parameters = new URLSearchParams({
      scene: state.selected.scene,
      target_id: state.selected.target_id,
      limit: "200",
    });
    const response = await fetch(`/api/messages?${parameters}`);
    if (!response.ok) throw new Error("消息加载失败");
    const data = await response.json();
    if (requestId !== state.messageRequestId || !state.selected || getConversationKey(state.selected) !== selectedKey) return;
    state.messages = data.records;
    renderMessages({ scrollToBottom });
  } catch (error) {
    if (!quiet && requestId === state.messageRequestId) {
      elements.messageList.innerHTML = `<div class="panel-empty">${escapeHtml(error.message)}</div>`;
    }
  }
}

async function loadStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) return;
    const stats = await response.json();
    document.querySelector("#stat-total").textContent = stats.total;
    document.querySelector("#stat-recent").textContent = stats.last_24_hours;
    document.querySelector("#stat-failed").textContent = stats.failed;
    document.querySelector("#failed-summary").hidden = stats.failed === 0;
  } catch {
    // The conversation view remains usable when statistics are unavailable.
  }
}

async function selectConversation(index) {
  const conversation = state.conversations[index];
  if (!conversation) return;
  state.selected = conversation;
  state.messages = [];
  renderConversations();
  renderSelectedConversation();
  document.body.classList.add("conversation-open");
  await loadMessages({ scrollToBottom: true });
}

async function updateServiceState() {
  const response = await fetch("/api/service-state");
  if (!response.ok) return;
  const result = await response.json();
  state.paused = result.paused === true;
  elements.serviceStatus.classList.toggle("paused", state.paused);
  elements.serviceStatus.querySelector("span").textContent = state.paused ? "已暂停" : "运行中";
  elements.pause.textContent = state.paused ? "恢复服务" : "暂停服务";
  elements.pause.classList.toggle("resume", state.paused);
}

async function loadUsage() {
  const response = await fetch("/api/usage?days=30");
  if (!response.ok) return;
  const usage = await response.json();
  elements.tokenCount.textContent = new Intl.NumberFormat("zh-CN", {
    notation: usage.total_tokens >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(usage.total_tokens);
  elements.tokenCount.parentElement.title = `近 30 天：输入 ${usage.input_tokens}，输出 ${usage.output_tokens}，${usage.request_count} 次模型调用`;
}

async function toggleService() {
  elements.pause.disabled = true;
  try {
    const response = await fetch("/api/settings/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: !state.paused }),
    });
    if (!response.ok) throw new Error("服务状态更新失败");
    await updateServiceState();
  } finally {
    elements.pause.disabled = false;
  }
}

async function toggleBlock() {
  if (!state.selected) return;
  elements.block.disabled = true;
  try {
    const response = await fetch("/api/conversations/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scene: state.selected.scene,
        target_id: state.selected.target_id,
        blocked: !state.selected.blocked,
      }),
    });
    if (!response.ok) throw new Error("封禁状态更新失败");
    await loadConversations({ quiet: true });
  } finally {
    elements.block.disabled = false;
  }
}

function detailBlock(title, value, className = "") {
  if (value === null || value === undefined || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return `<section class="detail-block ${className}"><h3>${escapeHtml(title)}</h3><pre>${escapeHtml(text)}</pre></section>`;
}

async function openDetail(id) {
  const response = await fetch(`/api/messages/${id}`);
  if (!response.ok) return;
  const record = await response.json();
  const createdAt = new Date(record.created_at);
  const timestamp = Number.isNaN(createdAt.getTime()) ? record.created_at : createdAt.toLocaleString("zh-CN", { hour12: false });

  elements.detail.innerHTML = `
    <div class="detail-summary">
      <div><span>方向</span><strong>${record.direction === "incoming" ? "用户 → 机器人" : "机器人 → 用户"}</strong></div>
      <div><span>状态</span><strong>${escapeHtml(labels.status[record.status] || record.status)}</strong></div>
      <div><span>场景</span><strong>${escapeHtml(labels.scene[record.scene] || record.scene)}</strong></div>
      <div><span>记录时间</span><strong>${escapeHtml(timestamp)}</strong></div>
      <div><span>QQ 消息 ID</span><strong>${escapeHtml(record.qq_message_id || "-")}</strong></div>
      <div><span>回复消息 ID</span><strong>${escapeHtml(record.reply_to_message_id || "-")}</strong></div>
      <div><span>发送者</span><strong>${escapeHtml(record.sender_id || "-")}</strong></div>
      <div><span>会话目标</span><strong>${escapeHtml(record.target_id || "-")}</strong></div>
    </div>
    ${detailBlock("消息内容", record.content)}
    ${detailBlock("消息类型", record.content_types)}
    ${detailBlock("附件", record.attachments)}
    ${detailBlock("媒体识别结果", record.media_analysis)}
    ${detailBlock("AI 生成与配音", record.ai_generation)}
    ${detailBlock("错误", record.error, "error")}
    ${detailBlock("完整负载", record.payload)}
    ${detailBlock("平台响应", record.response_payload)}
  `;
  elements.backdrop.hidden = false;
  elements.drawer.classList.add("open");
  elements.drawer.setAttribute("aria-hidden", "false");
  elements.closeDrawer.focus();
}

function closeDetail() {
  elements.drawer.classList.remove("open");
  elements.drawer.setAttribute("aria-hidden", "true");
  elements.backdrop.hidden = true;
}

async function refreshAll(options = {}) {
  await Promise.all([loadStats(), loadUsage(), updateServiceState(), loadConversations(options)]);
}

elements.conversationList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-index]");
  if (item) selectConversation(Number(item.dataset.index));
});

elements.messageList.addEventListener("click", (event) => {
  const bubble = event.target.closest("[data-id]");
  if (bubble) openDetail(bubble.dataset.id);
});

elements.messageList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const bubble = event.target.closest("[data-id]");
  if (bubble) {
    event.preventDefault();
    openDetail(bubble.dataset.id);
  }
});

elements.scene.addEventListener("change", () => {
  state.scene = elements.scene.value;
  state.selected = null;
  loadConversations();
});

let searchTimer;
elements.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = elements.search.value.trim();
    state.selected = null;
    loadConversations();
  }, 250);
});

elements.refresh.addEventListener("click", () => refreshAll());
elements.pause.addEventListener("click", toggleService);
elements.block.addEventListener("click", toggleBlock);
elements.back.addEventListener("click", () => document.body.classList.remove("conversation-open"));
elements.closeDrawer.addEventListener("click", closeDetail);
elements.backdrop.addEventListener("click", closeDetail);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDetail();
});

refreshAll();
setInterval(() => refreshAll({ quiet: true }), 10_000);
