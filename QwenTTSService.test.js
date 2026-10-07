const test = require("node:test");
const assert = require("node:assert/strict");
const {
  QwenTTSService,
  TTS_CONTROL_TAGS,
  TTS_RICH_TAGS,
  buildExpressiveText,
  hasMatchingSpeechCore,
  inferEmotionTag,
  normalizeTaggedSpeech,
} = require("./QwenTTSService");

test("根据回复内容选择克制的情绪标签", () => {
  assert.equal(inferEmotionTag("谢谢你，今天辛苦了。"), "[empathetic]");
  assert.equal(inferEmotionTag("欸，你怎么突然这么说？"), "[amazed]");
  assert.equal(inferEmotionTag("太好了！这次成功了！"), "[excited]");
  assert.equal(inferEmotionTag("普通陈述。"), "");
  assert.equal(buildExpressiveText("为什么会这样？"), "[curious]为什么会这样？");
  assert.equal(buildExpressiveText("[sad]我知道了。"), "[sad]我知道了。");
  assert.equal(buildExpressiveText("为什么会这样？", false), "为什么会这样？");
  assert.equal(
    buildExpressiveText("普通陈述。", true, "普通陈述。"),
    "[empathetic]普通陈述。",
  );
});

test("支持全部官方标签，允许轻微口语变化但拒绝改变核心意思", () => {
  assert.equal(TTS_CONTROL_TAGS.length, 23);
  assert.equal(TTS_RICH_TAGS.length, 7);
  const text = "先别急。好，我们开始吧！";
  const speech = "[serious]先别急。[sighing][excited]好，我们开始吧！";
  assert.equal(normalizeTaggedSpeech(text, speech), speech);
  assert.equal(normalizeTaggedSpeech(text, "[happy]先别急。好，我们开始吧！"), null);
  assert.equal(normalizeTaggedSpeech(text, "[serious]先别急。我们取消吧！"), null);
  assert.equal(
    normalizeTaggedSpeech(
      "我觉得可以。",
      "[reluctantly]嗯……我、我觉得可以。",
    ),
    "[reluctantly]嗯……我、我觉得可以。",
  );
  assert.equal(hasMatchingSpeechCore("今天是晴天。", "今天是雨天。"), false);
  assert.equal(hasMatchingSpeechCore("一共需要 100 元。", "一共需要 900 元。"), false);
  assert.equal(hasMatchingSpeechCore("现在可以开始。", "现在不可以开始。"), false);
  assert.equal(
    buildExpressiveText(text, true, speech),
    speech,
  );
});

test("合成 PCM、编码 SILK 并返回 QQ 可上传的 Base64", async () => {
  const calls = [];
  const usage = [];
  const service = new QwenTTSService({
    config: {
      AIKey: "test-key",
      AITTSEnabled: true,
      AITTSVoice: "test-voice",
      AITTSInstruction: "自然说话。",
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              output: { audio: { url: "https://example.com/audio.wav" } },
              usage: { characters: 12 },
              request_id: "request-1",
            });
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Uint8Array.from([82, 73, 70, 70]).buffer;
        },
      };
    },
    encodeSilk: async (pcm, sampleRate) => {
      assert.equal(Buffer.from(pcm).toString("ascii"), "RIFF");
      assert.equal(sampleRate, 24000);
      return { data: Uint8Array.from([2, 35, 33, 83, 73, 76, 75]), duration: 1234 };
    },
    onUsage: (record) => usage.push(record),
  });

  const result = await service.synthesize("谢谢你。", {
    conversationKey: "c2c:user-1",
    speechText: "[empathetic]谢谢你。",
  });
  const body = JSON.parse(calls[0].options.body);

  assert.equal(body.model, "qwen-audio-3.0-tts-flash");
  assert.equal(body.input.text, "[empathetic]谢谢你。");
  assert.equal(body.input.format, "pcm");
  assert.equal(body.input.sample_rate, 24000);
  assert.equal(Buffer.from(result.fileData, "base64").toString("ascii"), "\u0002#!SILK");
  assert.equal(result.durationMs, 1234);
  assert.equal(result.requestId, "request-1");
  assert.deepEqual(result.tags, ["[empathetic]"]);
  assert.deepEqual(usage, [{
    model: "qwen-audio-3.0-tts-flash",
    operation: "tts",
    conversationKey: "c2c:user-1",
    characters: 12,
  }]);
});

test("配置关闭或文本过长时不进入语音合成", () => {
  const disabled = new QwenTTSService({
    config: { AIKey: "test-key", AITTSEnabled: false, AITTSVoice: "voice" },
  });
  assert.equal(disabled.canSynthesize("你好"), false);

  const limited = new QwenTTSService({
    config: {
      AIKey: "test-key",
      AITTSEnabled: true,
      AITTSVoice: "voice",
      AITTSMaxCharacters: 4,
    },
  });
  assert.equal(limited.canSynthesize("刚好四字"), true);
  assert.equal(limited.canSynthesize("超过四个字"), false);
});
