const test = require("node:test");
const assert = require("node:assert/strict");
const { AIInputService } = require("../src/AIInputService");

test("图片由视觉模型描述后交给文字模型", async () => {
  const calls = [];
  const service = new AIInputService({
    config: { AIVisionModel: "qwen3-vl-flash", AIASREnabled: true },
    qwenClient: {
      async createChatCompletionDetailed(messages, options) {
        calls.push({ messages, options });
        return { content: "画面里是一只戴帽子的猫。" };
      },
    },
  });

  const result = await service.buildUserInput({
    content: "它在做什么？",
    attachments: [{ content_type: "image/png", url: "https://example.com/cat.png" }],
  }, "c2c:user-1");

  assert.match(result.apiContent, /它在做什么/);
  assert.match(result.apiContent, /画面里是一只戴帽子的猫/);
  assert.deepEqual(result.mediaAnalysis.images, [{
    attachment_indexes: [0],
    text: "画面里是一只戴帽子的猫。",
    model: "qwen3-vl-flash",
  }]);
  assert.equal(calls[0].options.model, "qwen3-vl-flash");
  assert.equal(calls[0].options.operation, "vision");
});

test("语音优先使用 QQ 自带转写，缺失时调用 ASR 模型", async () => {
  const calls = [];
  const service = new AIInputService({
    config: { AIASRModel: "qwen3-asr-flash" },
    qwenClient: {
      async createChatCompletionDetailed(messages, options) {
        calls.push({ messages, options });
        return { content: "模型转写内容" };
      },
    },
  });

  const result = await service.buildUserInput({
    attachments: [
      { content_type: "voice", asr_refer_text: "QQ 转写内容" },
      { content_type: "voice", voice_wav_url: "https://example.com/voice.wav" },
    ],
  }, "c2c:user-1");

  assert.match(result.apiContent, /QQ 转写内容/);
  assert.match(result.apiContent, /模型转写内容/);
  assert.deepEqual(result.mediaAnalysis.voices, [
    { text: "QQ 转写内容", source: "qq", model: null, attachment_index: 0 },
    { text: "模型转写内容", source: "qwen", model: "qwen3-asr-flash", attachment_index: 1 },
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.model, "qwen3-asr-flash");
  assert.equal(calls[0].options.operation, "asr");
  assert.equal(calls[0].messages[0].content[0].input_audio, "https://example.com/voice.wav");
});
