function isImageAttachment(attachment = {}) {
  return String(attachment.content_type || "").toLowerCase().startsWith("image/");
}

function isVoiceAttachment(attachment = {}) {
  const contentType = String(attachment.content_type || "").toLowerCase();
  return contentType === "voice" || contentType.startsWith("audio/");
}

class AIInputService {
  constructor({ config, qwenClient, logger = console }) {
    this.qwenClient = qwenClient;
    this.logger = logger;
    this.visionEnabled = config.AIVisionEnabled !== false;
    this.asrEnabled = config.AIASREnabled !== false;
    this.visionModel = String(config.AIVisionModel || "qwen3-vl-flash");
    this.asrModel = String(config.AIASRModel || "qwen3-asr-flash");
    this.visionMaxTokens = Math.max(32, Number(config.AIVisionMaxTokens) || 240);
  }

  async callModel(messages, options) {
    if (typeof this.qwenClient.createChatCompletionDetailed === "function") {
      const result = await this.qwenClient.createChatCompletionDetailed(messages, options);
      return result.content;
    }
    return this.qwenClient.createChatCompletion(messages, options);
  }

  async describeImages(images, conversationKey) {
    if (!this.visionEnabled || images.length === 0) return "";
    const content = [{
      type: "text",
      text: "请用简体中文客观、简短地描述这些聊天图片。识别主体、可见文字、表情和与聊天有关的信息；不要扮演角色，不要回复用户。",
    }];
    for (const image of images) {
      content.push({ type: "image_url", image_url: { url: image.url } });
    }
    return this.callModel([{ role: "user", content }], {
      model: this.visionModel,
      operation: "vision",
      conversationKey,
      maxTokens: this.visionMaxTokens,
      temperature: 0.1,
      enableThinking: false,
    });
  }

  async transcribeVoice(attachment, conversationKey) {
    const referenceText = String(attachment.asr_refer_text || "").trim();
    if (referenceText) return { text: referenceText, source: "qq", model: null };
    if (!this.asrEnabled) return null;

    const audioUrl = attachment.voice_wav_url || attachment.url;
    if (!audioUrl) return null;
    const text = await this.callModel([{
      role: "user",
      content: [{ type: "input_audio", input_audio: audioUrl }],
    }], {
      model: this.asrModel,
      operation: "asr",
      conversationKey,
      temperature: null,
      enableThinking: null,
    });
    return { text, source: "qwen", model: this.asrModel };
  }

  async buildUserInput(message = {}, conversationKey = null) {
    const text = typeof message.content === "string" ? message.content.trim() : "";
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const images = attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter((item) => isImageAttachment(item.attachment) && item.attachment.url);
    const voices = attachments
      .map((attachment, index) => ({ attachment, index }))
      .filter((item) => isVoiceAttachment(item.attachment));
    const sections = [];
    const mediaAnalysis = { images: [], voices: [] };
    if (text) sections.push(text);

    if (images.length > 0) {
      try {
        const description = await this.describeImages(
          images.map((item) => item.attachment),
          conversationKey,
        );
        if (description) {
          sections.push(`[图片内容]\n${description}`);
          mediaAnalysis.images.push({
            attachment_indexes: images.map((item) => item.index),
            text: description,
            model: this.visionModel,
          });
        }
      } catch (error) {
        this.logger.error(`图片理解失败：${error.message}`);
        sections.push("[用户发送了图片，但图片识别暂时失败]");
      }
    }

    if (voices.length > 0) {
      const transcripts = await Promise.all(voices.map(async ({ attachment, index }) => {
        try {
          const transcript = await this.transcribeVoice(attachment, conversationKey);
          return transcript ? { ...transcript, attachment_index: index } : null;
        } catch (error) {
          this.logger.error(`语音识别失败：${error.message}`);
          return "";
        }
      }));
      const usableTranscripts = transcripts.filter(Boolean);
      if (usableTranscripts.length > 0) {
        mediaAnalysis.voices.push(...usableTranscripts);
        sections.push(`[语音转写]\n${usableTranscripts.map((item) => item.text).join("\n")}`);
      } else {
        sections.push("[用户发送了语音，但语音识别暂时失败]");
      }
    }

    if (sections.length === 0) return null;
    const combined = sections.join("\n\n");
    return { apiContent: combined, memoryText: combined, mediaAnalysis };
  }
}

module.exports = {
  AIInputService,
  isImageAttachment,
  isVoiceAttachment,
};
