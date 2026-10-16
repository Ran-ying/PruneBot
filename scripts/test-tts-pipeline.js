const fs = require("node:fs");
const path = require("node:path");

const config = require("../data/Config.json");
const { QwenTTSService } = require("../src/QwenTTSService");

async function main() {
  const service = new QwenTTSService({ config });
  const result = await service.synthesize(
    "嗯，这样就好。以后我说话的时候，应该不会再像照着稿子念了。",
    { conversationKey: "manual:tts-pipeline-test" },
  );
  const silk = Buffer.from(result.fileData, "base64");
  const outputPath = path.resolve(
    __dirname,
    "../Resources/brune-voice-qwen-audio-flash-qq-test.silk",
  );
  fs.writeFileSync(outputPath, silk);

  process.stdout.write(`${JSON.stringify({
    outputPath,
    bytes: silk.length,
    header: silk.subarray(0, 10).toString("ascii"),
    durationMs: result.durationMs,
    characters: result.characters,
    model: result.model,
    tags: result.tags,
    requestId: result.requestId,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
