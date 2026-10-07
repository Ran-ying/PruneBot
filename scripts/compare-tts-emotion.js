const fs = require("node:fs");
const path = require("node:path");

const config = require("../data/Config.json");

const API_ROOT = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts";
const REFERENCE_URL =
  "https://patchwiki.biligame.com/images/ys/f/f2/17wg6cve61fql7i0u534uuw0kqieoza.mp3";
const OUTPUT_DIR = path.resolve(__dirname, "../Resources");

const QWEN_TEXT =
  "[amazed]你、你怎么突然这么说？[reluctantly]我当然高兴，只是有点没反应过来而已。[empathetic]嗯……总之，谢谢你。";
const PLAIN_TEXT =
  "你、你怎么突然这么说？我当然高兴，只是有点没反应过来而已。嗯……总之，谢谢你。";
const QWEN_INSTRUCTION =
  "像熟悉的朋友面对面说话。开头被突然夸奖后有一点意外和害羞，第二句嘴硬但藏不住高兴，结尾坦率温柔并稍微放慢。句子轻重分明，不要播音腔，不要字字等重。";
const COSY_INSTRUCTION =
  "面对朋友说话；先意外害羞，再嘴硬但高兴，结尾温柔放慢。不要播音腔。";

async function dashScopeRequest(pathname, body) {
  if (!config.AIKey) throw new Error("Config.json 中缺少 AIKey");

  const response = await fetch(`${API_ROOT}/${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.AIKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
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
      `${pathname} 失败：${response.status} ${data.message || data.code || responseText.slice(0, 300)}`,
    );
  }
  return data;
}

async function enrollVoice(targetModel, prefix) {
  const result = await dashScopeRequest("customization", {
    model: "voice-enrollment",
    input: {
      action: "create_voice",
      target_model: targetModel,
      prefix,
      url: REFERENCE_URL,
      language_hints: ["zh"],
      max_prompt_audio_length: 18.8,
      enable_preprocess: false,
    },
  });
  const voice =
    result.output?.voice ||
    result.output?.voice_id ||
    result.output?.custom_voice?.voice ||
    result.output?.data?.voice;
  if (!voice) {
    throw new Error(
      `${targetModel} 注册成功但没有返回可识别的 voice：${JSON.stringify(result)}`,
    );
  }
  return { voice, requestId: result.request_id };
}

async function synthesize({ model, voice, text, instruction, outputName }) {
  const result = await dashScopeRequest("SpeechSynthesizer", {
    model,
    input: {
      text,
      voice,
      format: "mp3",
      sample_rate: 24000,
      rate: 1,
      pitch: 1,
      language_hints: ["zh"],
      instruction,
    },
  });
  const audioUrl = result.output?.audio?.url;
  if (!audioUrl) throw new Error(`${model} 合成成功但没有返回音频 URL`);

  const audioResponse = await fetch(audioUrl, {
    signal: AbortSignal.timeout(180_000),
  });
  if (!audioResponse.ok) {
    throw new Error(`${model} 音频下载失败：${audioResponse.status}`);
  }
  const outputPath = path.join(OUTPUT_DIR, outputName);
  const audio = Buffer.from(await audioResponse.arrayBuffer());
  fs.writeFileSync(outputPath, audio);

  return {
    model,
    voice,
    outputPath,
    bytes: audio.length,
    characters: result.usage?.characters ?? null,
    requestId: result.request_id,
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const flashVoice =
    "qwen-audio-3.0-tts-flash-brune-aa7a2a8f73b74a469eab4abde7b6c2ee";
  const qwenPlus = await enrollVoice("qwen-audio-3.0-tts-plus", "bruneplus");
  const cosyPlus = await enrollVoice("cosyvoice-v3.5-plus", "brunecosy");

  const results = [];
  results.push(
    await synthesize({
      model: "qwen-audio-3.0-tts-flash",
      voice: flashVoice,
      text: QWEN_TEXT,
      instruction: QWEN_INSTRUCTION,
      outputName: "brune-voice-qwen-audio-flash-emotional.mp3",
    }),
  );
  results.push(
    await synthesize({
      model: "qwen-audio-3.0-tts-plus",
      voice: qwenPlus.voice,
      text: QWEN_TEXT,
      instruction: QWEN_INSTRUCTION,
      outputName: "brune-voice-qwen-audio-plus-emotional.mp3",
    }),
  );
  results.push(
    await synthesize({
      model: "cosyvoice-v3.5-plus",
      voice: cosyPlus.voice,
      text: PLAIN_TEXT,
      instruction: COSY_INSTRUCTION,
      outputName: "brune-voice-cosyvoice-v35-plus-emotional.mp3",
    }),
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        voices: {
          qwenPlus: qwenPlus.voice,
          cosyPlus: cosyPlus.voice,
        },
        text: PLAIN_TEXT,
        qwenInstruction: QWEN_INSTRUCTION,
        cosyInstruction: COSY_INSTRUCTION,
        results,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
