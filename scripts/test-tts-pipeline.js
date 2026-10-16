const fs = require("node:fs");
const path = require("node:path");

const { CONFIG_PATH, DATA_DIRECTORY, ensureDataDirectory } = require("../src/RuntimePaths");
const config = require(CONFIG_PATH);
const { QwenTTSService } = require("../src/QwenTTSService");

async function main() {
  const service = new QwenTTSService({ config });
  const result = await service.synthesize(
    "嗯，这样就好。以后我说话的时候，应该不会再像照着稿子念了。",
    { conversationKey: "manual:tts-pipeline-test" },
  );
  const silk = Buffer.from(result.fileData, "base64");
  ensureDataDirectory();
  const outputPath = path.join(DATA_DIRECTORY, "TestOutputs", "voice-pipeline-test.silk");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, silk, { mode: 0o600 });

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
