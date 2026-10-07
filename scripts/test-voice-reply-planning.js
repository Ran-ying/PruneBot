const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { AIConversationService } = require("../AIConversationService");
const { ChatDatabase } = require("../ChatDatabase");
const { createQwenClient } = require("../QwenService");
const { QwenTTSService } = require("../QwenTTSService");
const config = require("../data/Config.json");

async function main() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "qqprunebot-voice-plan-"));
  const database = new ChatDatabase(path.join(temporaryDirectory, "test.sqlite"));
  const baseQwenClient = createQwenClient();
  const rawModelReplies = [];
  const qwenClient = {
    async createChatCompletion(messages, options) {
      const response = await baseQwenClient.createChatCompletion(messages, options);
      rawModelReplies.push({ operation: options?.operation || "text", response });
      return response;
    },
  };
  const transcript = "我准备了很久，今天终于成功了！你替我高兴吗？";
  const service = new AIConversationService({
    config: {
      ...config,
      AIReplyCasualExpressionChance: 0,
    },
    database,
    qwenClient,
    inputService: {
      async buildUserInput() {
        return {
          apiContent: `[语音转写]\n${transcript}`,
          memoryText: `[语音转写]\n${transcript}`,
        };
      },
    },
  });

  try {
    const result = await service.generateReply({
      scene: "c2c",
      message: {
        id: "voice-plan-test",
        content: "",
        author: { user_openid: "voice-plan-test-user" },
        attachments: [{ content_type: "voice" }],
      },
    });
    const first = result.speechReplies[0];
    const audio = await new QwenTTSService({ config }).synthesize(first.text, {
      conversationKey: result.conversationKey,
      speechText: first.speech,
    });
    const silk = Buffer.from(audio.fileData, "base64");

    process.stdout.write(`${JSON.stringify({
      reply: result.reply,
      rawModelReplies,
      speechReplies: result.speechReplies,
      tts: {
        model: audio.model,
        tags: audio.tags,
        characters: audio.characters,
        durationMs: audio.durationMs,
        silkBytes: silk.length,
        silkHeader: silk.subarray(0, 10).toString("ascii"),
        requestId: audio.requestId,
      },
    }, null, 2)}\n`);
  } finally {
    database.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
