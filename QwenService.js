const { CONFIG_PATH } = require("./RuntimePaths");
const Config = require(CONFIG_PATH);

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_MODEL = "qwen-flash";
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_TIMEOUT_MS = 60_000;

function normalizeResponseContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((item) => (typeof item === "string" ? item : item?.text || ""))
    .filter(Boolean)
    .join("\n");
}

function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  const cjkCharacters = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  return Math.max(1, Math.ceil(cjkCharacters * 1.1 + (text.length - cjkCharacters) / 4));
}

function normalizeUsage(usage, messages, content) {
  const inputTokens = Number(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = Number(usage?.completion_tokens ?? usage?.output_tokens);
  const hasActualUsage = Number.isFinite(inputTokens) || Number.isFinite(outputTokens);
  const normalizedInput = Number.isFinite(inputTokens) ? inputTokens : estimateTokens(messages);
  const normalizedOutput = Number.isFinite(outputTokens) ? outputTokens : estimateTokens(content);
  const totalTokens = Number(usage?.total_tokens);
  return {
    inputTokens: normalizedInput,
    outputTokens: normalizedOutput,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : normalizedInput + normalizedOutput,
    estimated: !hasActualUsage,
  };
}

function createQwenClient({
  apiKey = process.env.DASHSCOPE_API_KEY || Config.AIKey,
  baseURL = process.env.DASHSCOPE_BASE_URL || Config.AIBaseURL || DEFAULT_BASE_URL,
  model = process.env.DASHSCOPE_MODEL || Config.AIModel || DEFAULT_MODEL,
  temperature = Config.AITemperature ?? DEFAULT_TEMPERATURE,
  enableThinking = Config.AIEnableThinking ?? false,
  timeoutMs = Config.AITimeoutMs ?? DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  onUsage,
} = {}) {
  async function createChatCompletionDetailed(messages, options = {}) {
    if (!apiKey) throw new Error("Config.json 中缺少 AIKey");
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("通义千问请求必须包含 messages");
    }

    const body = {
      model: options.model || model,
      messages,
    };
    if (options.temperature !== null) {
      body.temperature = options.temperature ?? temperature;
    }
    if (
      options.enableThinking !== null &&
      (options.enableThinking !== undefined || typeof enableThinking === "boolean")
    ) {
      body.enable_thinking = options.enableThinking ?? enableThinking;
    }
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    const response = await fetchImpl(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? timeoutMs),
    });

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = {};
    }

    if (!response.ok) {
      const message = data.error?.message || data.message || responseText.slice(0, 300);
      throw new Error(`通义千问请求失败：${response.status} ${message}`);
    }

    const content = normalizeResponseContent(data.choices?.[0]?.message?.content).trim();
    if (!content) throw new Error("通义千问返回了空内容");
    const usage = normalizeUsage(data.usage, messages, content);
    if (typeof onUsage === "function") {
      try {
        onUsage({
          model: body.model,
          operation: options.operation || "chat",
          conversationKey: options.conversationKey || null,
          ...usage,
        });
      } catch {
        // Usage accounting must never interrupt a successful model response.
      }
    }
    return { content, usage, model: body.model };
  }

  async function createChatCompletion(messages, options = {}) {
    const result = await createChatCompletionDetailed(messages, options);
    return result.content;
  }

  return {
    createChatCompletion,
    createChatCompletionDetailed,
    model,
  };
}

module.exports = {
  createQwenClient,
  estimateTokens,
  normalizeResponseContent,
  normalizeUsage,
};
