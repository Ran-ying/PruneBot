const DEFAULT_ENDPOINT =
  "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
const DEFAULT_MODEL = "qwen-audio-3.0-tts-flash";
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_FALLBACK_TAG = "[empathetic]";
const DEFAULT_INSTRUCTION = [
  "像熟悉的朋友面对面自然说话，根据句意变化情绪、轻重和速度。",
  "声线清亮，认真中带一点自信和孩子气。",
  "不要播音腔，不要字字等重，停顿自然。",
].join("");

const TTS_CONTROL_TAGS = Object.freeze([
  "[sad]",
  "[amazed]",
  "[deep and loud shouting]",
  "[trembling]",
  "[angry]",
  "[excited]",
  "[sarcastic]",
  "[curious]",
  "[like dracula]",
  "[bored]",
  "[tired]",
  "[scornful]",
  "[shouting]",
  "[asmr]",
  "[panicked]",
  "[mischievously]",
  "[empathetic]",
  "[whispers]",
  "[reluctantly]",
  "[crying]",
  "[serious]",
  "[very slowly]",
  "[very fast]",
]);
const TTS_RICH_TAGS = Object.freeze([
  "[gasp]",
  "[sighing]",
  "[clears throat]",
  "[giggles]",
  "[laughing]",
  "[cough]",
  "[snorts]",
]);
const TTS_TAG_SET = new Set([...TTS_CONTROL_TAGS, ...TTS_RICH_TAGS]);

const EMOTION_RULES = [
  {
    tag: "[sad]",
    pattern: /(对不起|抱歉|难过|伤心|遗憾|失望|哭|痛苦|离开了|失去了)/u,
  },
  {
    tag: "[empathetic]",
    pattern: /(谢谢|辛苦了|没关系|没事|别担心|我陪你|照顾好|休息一下|喜欢你|关心你)/u,
  },
  {
    tag: "[amazed]",
    pattern: /(欸|诶|咦|居然|竟然|突然|怎么会|没想到|你、你|我、我)/u,
  },
  {
    tag: "[mischievously]",
    pattern: /(哼哼|骗你的|开玩笑|逗你|才不告诉你|秘密)/u,
  },
  {
    tag: "[excited]",
    pattern: /(太好了|好耶|成功了|赢了|厉害|真棒|迫不及待|！|!)/u,
  },
  {
    tag: "[curious]",
    pattern: /(为什么|怎么|什么|哪里|真的吗|是不是|吗[？?]?|呢[？?]?|[？?])/u,
  },
  {
    tag: "[serious]",
    pattern: /(注意|小心|必须|危险|严重|不能|不要|先确认|结论是)/u,
  },
];

function inferEmotionTag(text) {
  const value = String(text || "").trim();
  return EMOTION_RULES.find((rule) => rule.pattern.test(value))?.tag || "";
}

function normalizeComparableSpeechText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(/^(?:嗯|呃|唔|欸|诶|啊|哦|哎|咳)+/gu, "")
    .replace(/(?:嗯|啊|哦|吧|呀|啦)+$/gu, "")
    .replace(/(.)\1+/gu, "$1");
}

function getEditDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function hasMatchingSpeechCore(visibleText, spokenText) {
  const visible = normalizeComparableSpeechText(visibleText);
  const spoken = normalizeComparableSpeechText(spokenText);
  if (!visible || !spoken) return false;
  if (visible === spoken) return true;

  const criticalPattern = /\d+(?:\.\d+)?|不是|不能|不要|没有|禁止|别|没|不|无/gu;
  const visibleCritical = String(visibleText || "").match(criticalPattern) || [];
  const spokenCritical = String(spokenText || "").match(criticalPattern) || [];
  if (JSON.stringify(visibleCritical) !== JSON.stringify(spokenCritical)) return false;

  const lengthRatio = spoken.length / visible.length;
  if (lengthRatio < 0.72 || lengthRatio > 1.28) return false;
  const maxLength = Math.max(visible.length, spoken.length);
  const similarity = 1 - getEditDistance(visible, spoken) / maxLength;
  if (maxLength <= 8) return similarity >= 0.85;
  return similarity >= 0.78;
}

function normalizeTaggedSpeech(visibleText, speechText) {
  const visible = String(visibleText || "").trim();
  const speech = String(speechText || "").trim();
  if (!visible || !speech) return null;

  let hasUnknownTag = false;
  const withoutTags = speech.replace(/\[[^\]\n]{1,60}\]/gu, (tag) => {
    if (TTS_TAG_SET.has(tag)) return "";
    hasUnknownTag = true;
    return tag;
  });
  if (hasUnknownTag) return null;
  if (!hasMatchingSpeechCore(visible, withoutTags)) return null;
  return speech;
}

function buildExpressiveText(
  text,
  enabled = true,
  speechText,
  fallbackTag = DEFAULT_FALLBACK_TAG,
) {
  const value = String(text || "").trim();
  if (!value || !enabled) return value;
  const normalizedFallbackTag = TTS_CONTROL_TAGS.includes(fallbackTag)
    ? fallbackTag
    : DEFAULT_FALLBACK_TAG;
  if (typeof speechText === "string") {
    const speech = normalizeTaggedSpeech(value, speechText) || value;
    const hasControlTag = TTS_CONTROL_TAGS.some((tag) => speech.includes(tag));
    return hasControlTag ? speech : `${inferEmotionTag(value) || normalizedFallbackTag}${speech}`;
  }
  if (/^\[[a-z ]+\]/iu.test(value)) return value;
  return `${inferEmotionTag(value) || normalizedFallbackTag}${value}`;
}

function getErrorMessage(data, responseText) {
  return data?.message || data?.error?.message || data?.code || responseText.slice(0, 300);
}

class QwenTTSService {
  constructor({
    config,
    fetchImpl = fetch,
    encodeSilk,
    onUsage,
  } = {}) {
    this.apiKey = process.env.DASHSCOPE_API_KEY || config?.AIKey;
    this.enabled = config?.AITTSEnabled === true;
    this.model = String(config?.AITTSModel || DEFAULT_MODEL);
    this.voice = String(config?.AITTSVoice || "");
    this.endpoint = String(config?.AITTSEndpoint || DEFAULT_ENDPOINT);
    this.sampleRate = Number(config?.AITTSSampleRate) || DEFAULT_SAMPLE_RATE;
    this.timeoutMs = Number(config?.AITTSTimeoutMs) || DEFAULT_TIMEOUT_MS;
    this.instruction = String(config?.AITTSInstruction || DEFAULT_INSTRUCTION).trim();
    this.fallbackTag = TTS_CONTROL_TAGS.includes(config?.AITTSDefaultTag)
      ? config.AITTSDefaultTag
      : DEFAULT_FALLBACK_TAG;
    this.emotionTagsEnabled = config?.AITTSEmotionTagsEnabled !== false;
    this.maxCharacters = Math.max(1, Number(config?.AITTSMaxCharacters) || 400);
    this.fetchImpl = fetchImpl;
    this.encodeSilkImpl = encodeSilk;
    this.onUsage = onUsage;
  }

  canSynthesize(text) {
    const value = String(text || "").trim();
    return this.enabled &&
      Boolean(this.apiKey) &&
      Boolean(this.voice) &&
      value.length > 0 &&
      value.length <= this.maxCharacters;
  }

  async encodeSilk(pcm) {
    if (typeof this.encodeSilkImpl === "function") {
      return this.encodeSilkImpl(pcm, this.sampleRate);
    }
    const { encode } = await import("silk-wasm");
    return encode(pcm, this.sampleRate);
  }

  async synthesize(text, { conversationKey = null, speechText } = {}) {
    const originalText = String(text || "").trim();
    if (!this.canSynthesize(originalText)) {
      throw new Error(
        originalText.length > this.maxCharacters
          ? `回复超过语音合成上限（${this.maxCharacters} 字）`
          : "语音合成未启用或配置不完整",
      );
    }

    const synthesisText = buildExpressiveText(
      originalText,
      this.emotionTagsEnabled,
      speechText,
      this.fallbackTag,
    );
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          text: synthesisText,
          voice: this.voice,
          format: "pcm",
          sample_rate: this.sampleRate,
          rate: 1,
          pitch: 1,
          language_hints: ["zh"],
          instruction: this.instruction,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = {};
    }
    if (!response.ok || data.code) {
      throw new Error(
        `百炼语音合成失败：${response.status} ${getErrorMessage(data, responseText)}`,
      );
    }

    const audioUrl = data.output?.audio?.url;
    if (!audioUrl) throw new Error("百炼语音合成成功但没有返回音频 URL");

    const audioResponse = await this.fetchImpl(audioUrl, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!audioResponse.ok) {
      throw new Error(`合成音频下载失败：${audioResponse.status}`);
    }
    const pcm = Buffer.from(await audioResponse.arrayBuffer());
    if (pcm.length === 0) throw new Error("百炼返回了空音频");

    const silk = await this.encodeSilk(pcm);
    const silkData = Buffer.from(silk.data || silk);
    if (silkData.length === 0) throw new Error("SILK 编码结果为空");

    const characters = Number(data.usage?.characters) || synthesisText.length;
    if (typeof this.onUsage === "function") {
      this.onUsage({
        model: this.model,
        operation: "tts",
        conversationKey,
        characters,
      });
    }

    return {
      fileData: silkData.toString("base64"),
      filename: `reply-${Date.now()}.silk`,
      durationMs: Number(silk.duration) || null,
      characters,
      model: this.model,
      voice: this.voice,
      requestId: data.request_id || null,
      tags: synthesisText.match(/\[[^\]\n]{1,60}\]/gu) || [],
    };
  }
}

module.exports = {
  DEFAULT_INSTRUCTION,
  DEFAULT_FALLBACK_TAG,
  QwenTTSService,
  TTS_CONTROL_TAGS,
  TTS_RICH_TAGS,
  buildExpressiveText,
  inferEmotionTag,
  hasMatchingSpeechCore,
  normalizeTaggedSpeech,
};
