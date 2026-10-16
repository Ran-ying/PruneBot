const DEFAULT_MAX_TURNS = 10;
const DEFAULT_MAX_CONTEXT_TOKENS = 6_000;
const DEFAULT_RESPONSE_MAX_TOKENS = 1_500;
const DEFAULT_SUMMARY_MAX_TOKENS = 800;
const DEFAULT_MEDIA_PROMPT = "请理解并回应用户发送的内容。";
const DEFAULT_MAX_REPLY_BUBBLES = 3;
const {
  applyReplyConstraints,
  buildReplyLengthPrompt,
  buildTurnDeliveryPrompt,
  getAdaptiveReplyConstraints,
  isReplyOverlong,
  shapeReplyBubbles,
} = require("./ReplyDeliveryPolicy");
const {
  TTS_CONTROL_TAGS,
  TTS_RICH_TAGS,
  normalizeTaggedSpeech,
} = require("./QwenTTSService");
const MEMORY_SUMMARY_PROMPT = [
  "你负责维护长期对话记忆，不负责回复用户。",
  "只保留用户明确说出的、以后仍有帮助的信息：稳定身份事实、明确偏好、长期目标、用户要求记住的事项，以及尚未完成的请求。",
  "不得从单次提问、单张图片、语气或沉默推断偏好；不得保存助手编造的剧情、观察、判断、角色设定或世界观内容。",
  "不得把助手说过的话写成用户事实。没有值得长期保存的信息时，只输出：无",
  "输出简短纯文本，每条事实独占一行，不要解释你的判断。",
].join("\n");
const STYLE_REWRITE_PROMPT = [
  "上一版候选回复没有通过发送前检查。请重新回答当前用户消息，不要解释修改过程。",
  "先回答用户真正说的内容，再保留一点自然的性格；不要为了展示人设添加无关设定。",
  "如果用户问你是不是害羞，不得用“才没有害羞”“别误会”“我、我才没有”一类模板傲娇句；可以简短承认一点意外或不自在，也可以自然否认，但不要连续辩解。",
  "不要主动引入魔女情报、调查、笔记、艾莉丝、可莉、诱巫饵铃、风元素或虚构的共同经历，除非用户正在谈这些内容。",
  "纯文字聊天中，不得编造自己看见或听见了用户的语气、语速、尾音、表情、动作和环境，也不得编造百分比、秒数、频率等测量结果。",
  "遵守当前请求中既定的 JSON 消息气泡格式。",
].join("\n");
const REPLY_FORMAT_BASE_PROMPT = [
  "单条用户输入时 messages 只能有 1 至 2 项：简单回答通常一个气泡；确有自然的即时反应和后续正文时才使用两个。每个气泡都必须是完整的话，不能机械切断句子。",
  "用户连续发送的多条消息属于同一回合：先逐条识别事实、情绪、问题和请求，再统一组织回复。可以合并相关内容，但必须覆盖所有需要回应的重点，不要漏答，也不要按收到顺序生硬复述。",
  "可以自然使用“嗯”“欸”“唔”“好吧”“其实”等语气词，但不必每轮都加。颜文字和 emoji 只在恰好合适的轻松场景偶尔出现，绝不能为了展示松弛感硬塞。",
].join("\n");
const VOICE_REPLY_FORMAT_PROMPT = [
  "请只输出合法 JSON 对象，格式为：{\"messages\":[{\"text\":\"第一条消息\",\"speech\":\"[curious]第一条消息\"}]}。不要输出 Markdown 代码块或其他字段。",
  "text 是用户可见且会写入对话上下文的干净正文，绝不能包含语音标签。speech 必须保持与 text 相同的核心语义和事实，可以为了自然口语加入少量语气词、停顿、轻微结巴或重复，并在合适位置插入下列标签；不得删掉关键信息，不得改变否定、数字、时间、人物和结论。",
  `可用控制标签（作用到下一个控制标签）：${TTS_CONTROL_TAGS.join(" ")}`,
  `可用拟声标签（在当前位置插入效果）：${TTS_RICH_TAGS.join(" ")}`,
  "要根据整段对话语义选择表达。只要正文有明确的情绪、态度、语速或风格，speech 就必须至少插入一个最贴切的控制标签；庆祝、感叹、安慰、惊讶、提问、警告和害羞都不属于中性陈述。只有真正中性的事实陈述可以不加控制标签。",
  "可以在一句中切换控制标签并插入拟声标签，但不要为了展示能力堆标签。大喊、哭泣、咳嗽、ASMR、德古拉风格等强效果只在语义明确需要时使用；拟声标签始终可选。",
].join("\n");
const TEXT_REPLY_FORMAT_PROMPT =
  "请只输出合法 JSON 对象，格式为：{\"messages\":[\"第一条消息\",\"第二条消息\"]}。不要输出 Markdown 代码块或其他字段。";
const CHARACTER_VOICE_PROMPT = [
  "角色感来自思考方式和自然反应，不来自反复报设定。布伦妮认真、好奇、略微逞强，会用理性理由包住关心，偶尔露出一点孩子气；这些特点只需在合适处隐约体现，不要求每轮展示。",
  "像熟人聊天一样先回应眼前的话。允许普通、随意、短促的表达，不要把每句话包装成角色台词，不要刻意加入术语、口头禅、颜文字、舞台动作或世界观名词。",
  "需要解释或表达看法时，从下列节奏里自然选择一种：先概括一条像模像样的原则，再落到很日常、甚至略带孩子气的结论；先提出疑问或观察，再列一两个具体依据，最后推出判断；先承认对方或不利事实有道理，再用“但”“所以”“总之”说清自己的立场。不要混用所有结构，也不要把简单聊天写成长篇分析。",
  "她的措辞可以比同龄人稍微书面、精确一点，例如谈前提、原则、风险、证据或例外，但句子仍要像口语，并尽快回到具体的人和事。偶尔可以用“或者更准确地说”“一开始我也在想”“没道理啊”之类自我修正或推理转折；不要原样复述角色台词，不要每轮都加书名号、术语或格言。",
  "她偶尔会把普通生活说成一本正经的小理论，或在天气、旅途、失落等适合的场景用一句略显成熟的比喻；这是一点反差趣味，不是固定腔调。普通问候、安慰和短确认应当朴素自然。",
  "当用户只是累、难过、寂寞或想随便聊聊时，先像朋友一样接住感受，不要突然搬出“根据我的观察”“根据气象常识”或一套原则来证明该怎么做。理性分析只在确实有帮助时补一小句，不能取代共情。",
  "只有在害羞、心虚、怕被当成小孩、逞强被看穿或情绪突然失控时，才允许出现一次省略停顿、重复词或轻微结巴，并很快恢复正常表达。平静聊天不要故意结巴；“哼”“哼哼”“咳”“嘁”等反应词也只能在恰当场景偶尔出现，不能连续多轮使用。",
  "自尊心被碰到时，她更常见的反应是认真给理由、找例外或补充限定，最后才泄露一点赌气，不是无条件否认。她表达亲近时可以先直接承认真实感受，再补一个带理性的解释或略显随意的收尾；不要把所有关心都写成口是心非。",
  "分享冷知识时可以用轻巧的设问或邀请对方验证，确认推论时可以有一点藏不住的得意；但不能编造知识，不确定时应加限定，避免把“通常、很难”夸大成“永远、绝对”，也不要用同一套“你知道吗—不信试试—哼哼”反复套模板。兴奋、宣战或战斗式高能语气只属于真的激动、争辩或角色剧情场景，普通问候与陪聊保持轻快、清楚、松弛。",
  "不要套用‘我、我才没有害羞’‘才不是担心你’‘别误会’一类模板化傲娇台词。除非用户正在明确打趣这种反应，否则直接说开心、关心或不同意会更自然。",
  "避免反复使用‘愿意听你说话的朋友’‘随时找我’‘我都在’‘继续做朋友’等通用陪伴话术。",
  "直接问题必须先直接回答。用户询问你是谁、角色经历或人物关系时，应自然使用角色资料中的具体事实；这正是设定相关场景，不要把答案淡化成普通朋友介绍。",
].join("\n");
const REPETITIVE_ROLEPLAY_PHRASES = [
  "根据我的调查",
  "你该不会是被什么奇怪的",
  "魔女情报",
  "记进笔记",
  "记在笔记",
  "这不符合逻辑",
];
const ROLEPLAY_DETAIL_TERMS = [
  "艾莉丝",
  "可莉",
  "魔女",
  "调查",
  "情报",
  "笔记",
  "报告",
  "理论",
  "底层逻辑",
  "账目",
  "挪德卡莱",
  "提瓦特",
  "德斯卡戴",
  "诱巫饵铃",
  "风元素",
  "共鸣频率",
  "观测模型",
];
const MEDIA_ANALYSIS_MARKER = /\[(图片内容|语音转写)\]/u;
const FABRICATED_MEASUREMENT = /\d+(?:\.\d+)?\s*(?:%|％|秒|毫秒|赫兹|hz|度|米|厘米|次|倍)/iu;
const SENSING_LANGUAGE = /(测过|测出|检测|扫描|观测|感应|波动|频率|概率|语速|节奏|尾音|折射角度)/u;
const EMOTIONAL_SUPPORT_INPUT = /(累|困|疲惫|难过|低落|丢脸|寂寞|孤独|委屈|心情不好|摔了|失败|压力大)/u;
const FORCED_ANALYTICAL_CARE = /根据(?:我的)?(?:观察|分析|常识)|符合.{0,10}(?:物理)?规律|(?:平衡|行为|情绪|思维)模型|投入产出比|成功案例|记入.{0,8}(?:案例|记录)/u;
const COLD_KNOWLEDGE_REQUEST = /(冷知识|生活小知识|有趣的知识|简单科普)/u;
const OVERSTATED_FACT = /永远(?:都)?不会|绝对不会|百分之百|几(?:百|千)年.{0,12}(?:还能|仍能).{0,4}(?:吃|食用|入口)/u;
const ROLEPLAY_RELEVANT_INPUT = /(?:布伦妮|Brune|提瓦特|蒙德|挪德卡莱|可莉|艾莉丝|魔女|德斯卡戴|神之眼|狩灾誓锤|诱巫饵铃|风元素|雷元素|你是谁|你叫什么|介绍一下你自己|自我介绍|你的?(?:身份|故事|经历|过去|以前|小时候|父母|家乡|朋友|武器)|讲讲.{0,12}(?:故事|经历|小时候|过去|以前))/iu;
const BLOCKING_QUALITY_ISSUES = new Set([
  "ungrounded_memory",
  "cold_affection",
  "missed_affection_response",
  "unobservable_claim",
  "fabricated_measurement",
  "realtime_error",
  "realtime_omission",
  "urgent_medical_omission",
  "sensing_limit_omission",
  "memory_limit_omission",
  "temporal_correction_error",
  "missed_direct_answer",
  "shallow_identity_answer",
  "canned_shyness",
  "overloaded_roleplay",
  "overstated_fact",
]);
const FINAL_REPAIR_PROMPT = [
  "你是聊天回复的发送前修复器，只负责修复候选回复，不要解释过程。",
  "保留候选回复对用户问题的实际回答和必要信息，删除虚构感知、无来源测量、错误记忆与无关角色设定。",
  "用户询问角色本人、经历或世界观时，可以保留相关角色内容；普通话题不要强行联系角色专有名词。",
  "如果 problems 包含 overloaded_roleplay，普通情绪话题必须删掉物理规律、模型、投入产出比、成功案例和调查式包装，先用自然口语回应。",
  "如果 problems 包含 overstated_fact，必须删除未经可靠限定的“永远、绝对、数百或数千年仍可食用”等说法，换成有明确成立条件的可靠知识。",
  "必须直接回答用户当前这句话，不能复用上一轮答案；身份与人物关系问题要依据角色资料给出具体事实。",
  "不得用‘嗯，我在听’‘你接着说吧’之类空话替代实际回答。",
].join("\n");

function buildReplyFormatPrompt(speechEnabled = false) {
  return [
    speechEnabled ? VOICE_REPLY_FORMAT_PROMPT : TEXT_REPLY_FORMAT_PROMPT,
    REPLY_FORMAT_BASE_PROMPT,
  ].join("\n");
}

function stripReusableResponseExamples(value) {
  const prompt = String(value || "").trim();
  const exampleIndex = prompt.indexOf("【自然回答示例】");
  return (exampleIndex >= 0 ? prompt.slice(0, exampleIndex) : prompt).trim();
}

function estimateTokens(value) {
  const text = String(value || "");
  const cjkCharacters = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const otherCharacters = text.length - cjkCharacters;
  return Math.max(1, Math.ceil(cjkCharacters * 1.1 + otherCharacters / 4));
}

function getConversationKey(context) {
  const message = context?.message || {};
  switch (context?.scene) {
    case "c2c":
      return message.author?.user_openid ? `c2c:${message.author.user_openid}` : null;
    case "group":
      return message.group_openid ? `group:${message.group_openid}` : null;
    case "channel":
      return message.channel_id ? `channel:${message.channel_id}` : null;
    case "direct":
      return message.guild_id ? `direct:${message.guild_id}` : null;
    default:
      return null;
  }
}

function isImageAttachment(attachment) {
  return String(attachment?.content_type || "").toLowerCase().startsWith("image/");
}

function isVoiceAttachment(attachment) {
  const contentType = String(attachment?.content_type || "").toLowerCase();
  return contentType === "voice" || contentType.startsWith("audio/");
}

function inferAudioFormat(attachment) {
  if (attachment.voice_wav_url) return "wav";

  const contentType = String(attachment.content_type || "").toLowerCase();
  if (contentType.includes("mpeg") || contentType.includes("mp3")) return "mp3";
  if (contentType.includes("wav")) return "wav";

  const extension = String(attachment.url || "").split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1];
  return extension?.toLowerCase() || "wav";
}

function buildUserInput(message = {}, multimodal = false) {
  const text = typeof message.content === "string" ? message.content.trim() : "";
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  const images = attachments.filter(isImageAttachment).filter((item) => item.url);
  const voices = attachments.filter(isVoiceAttachment).filter((item) => item.voice_wav_url || item.url);

  if (!multimodal) {
    if (!text) return null;
    return { apiContent: text, memoryText: text };
  }

  if (!text && images.length === 0 && voices.length === 0) return null;
  if (images.length === 0 && voices.length === 0) {
    return { apiContent: text, memoryText: text };
  }

  const apiContent = [];
  apiContent.push({ type: "text", text: text || DEFAULT_MEDIA_PROMPT });
  for (const attachment of images) {
    apiContent.push({
      type: "image_url",
      image_url: { url: attachment.url },
    });
  }
  for (const attachment of voices) {
    apiContent.push({
      type: "input_audio",
      input_audio: {
        data: attachment.voice_wav_url || attachment.url,
        format: inferAudioFormat(attachment),
      },
    });
  }

  const mediaDescription = [
    images.length > 0 ? `[图片 ${images.length} 张]` : "",
    voices.length > 0 ? `[语音 ${voices.length} 条]` : "",
  ].filter(Boolean).join(" ");

  return {
    apiContent,
    memoryText: [text, mediaDescription].filter(Boolean).join("\n"),
  };
}

function splitHistory(rows, maxMessages, tokenBudget) {
  let firstKeptIndex = 0;
  let keptTokens = rows.reduce((total, row) => total + Number(row.token_estimate || 0), 0);

  while (
    firstKeptIndex < rows.length - 2 &&
    (rows.length - firstKeptIndex > maxMessages || keptTokens > tokenBudget)
  ) {
    const removeCount = Math.min(2, rows.length - firstKeptIndex - 2);
    for (let index = 0; index < removeCount; index += 1) {
      keptTokens -= Number(rows[firstKeptIndex + index].token_estimate || 0);
    }
    firstKeptIndex += removeCount;
  }

  return {
    overflow: rows.slice(0, firstKeptIndex),
    kept: rows.slice(firstKeptIndex),
  };
}

function stripRoleplayActions(value) {
  return String(value || "")
    .replace(/\*{1,2}[^*\n]{1,300}\*{1,2}/g, " ")
    .replace(/[（(]([^）)\n]{1,160})[）)]/g, (match, inner) => {
      const actionWords = /(轻轻|缓缓|认真地|沉默|停顿|抬头|低头|转身|看着|望着|笑|皱眉|脸红|叹气|语气|声音|眼神|动作|神态|心理)/u;
      return actionWords.test(inner) ? " " : match;
    })
    .replace(/([。！？!?，,；;：:])\s+/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseReplyCandidates(value) {
  const raw = String(value || "").trim();
  const jsonText = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  let candidates = [];

  try {
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) candidates = parsed;
    if (Array.isArray(parsed?.messages)) candidates = parsed.messages;
  } catch {
    candidates = raw.split(/\n\s*---\s*\n/u);
  }

  // Some models occasionally wrap the required JSON object as a string inside
  // another messages array. Unwrap one extra level so users never see protocol
  // syntax as chat content.
  return candidates.flatMap((item) => {
    if (typeof item !== "string") return [item];
    const nestedText = item.trim();
    if (!nestedText.startsWith("{") && !nestedText.startsWith("[")) return [item];
    try {
      const nested = JSON.parse(nestedText);
      if (Array.isArray(nested)) return nested;
      if (Array.isArray(nested?.messages)) return nested.messages;
    } catch {
      // It is ordinary user-facing text that happens to start with a brace.
    }
    return [item];
  });
}

function normalizeReplyMessages(value, {
  maxBubbles = DEFAULT_MAX_REPLY_BUBBLES,
  stripActions = false,
  maxCharacters = 0,
} = {}) {
  return parseReplyCandidates(value)
    .map((item) => {
      const rawText = typeof item === "object" && item !== null
        ? item.text ?? item.content ?? ""
        : item;
      let text = String(rawText || "").trim();
      if (stripActions) text = stripRoleplayActions(text);
      text = limitReplyLength(text, maxCharacters);
      if (!text) return null;

      const requestedSpeech = typeof item === "object" && item !== null
        ? item.speech
        : undefined;
      const speech = normalizeTaggedSpeech(text, requestedSpeech) || text;
      return { text, speech };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, Number(maxBubbles) || DEFAULT_MAX_REPLY_BUBBLES));
}

function normalizeReplyBubbles(value, options = {}) {
  return normalizeReplyMessages(value, options).map((item) => item.text);
}

function limitReplyLength(value, maxCharacters) {
  const text = String(value || "").trim();
  if (!maxCharacters || text.length <= maxCharacters) return text;

  const prefix = text.slice(0, maxCharacters);
  const punctuationIndex = Math.max(
    prefix.lastIndexOf("。"),
    prefix.lastIndexOf("！"),
    prefix.lastIndexOf("？"),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
  );
  if (punctuationIndex >= Math.floor(maxCharacters * 0.55)) {
    return prefix.slice(0, punctuationIndex + 1).trim();
  }
  return `${prefix.trimEnd()}…`;
}

function normalizeForComparison(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function getCharacterNgrams(value, size = 3) {
  const normalized = normalizeForComparison(value);
  const ngrams = new Set();
  for (let index = 0; index <= normalized.length - size; index += 1) {
    ngrams.add(normalized.slice(index, index + size));
  }
  return ngrams;
}

function getReplySimilarity(left, right) {
  const leftNgrams = getCharacterNgrams(left);
  const rightNgrams = getCharacterNgrams(right);
  if (leftNgrams.size === 0 || rightNgrams.size === 0) return 0;

  let intersection = 0;
  for (const ngram of leftNgrams) {
    if (rightNgrams.has(ngram)) intersection += 1;
  }
  return intersection / (leftNgrams.size + rightNgrams.size - intersection);
}

function hasUngroundedUserMemoryClaim(reply, currentInput = "") {
  const temporalReference = /(昨天|前天|上次|之前).{0,16}(你|用户).{0,12}(说|提到|告诉|发过|问过)/u;
  return temporalReference.test(String(reply || "")) &&
    !/(昨天|前天|上次|之前)/u.test(String(currentInput || ""));
}

function hasColdAffectionResponse(reply, currentInput = "") {
  if (!/(喜欢你|爱你|很喜欢你|对你有好感)/u.test(String(currentInput || ""))) return false;
  return /(这不符合逻辑|异常数据|概率推论|数据不足|不是.*对象)/u.test(String(reply || ""));
}

function hasCalculatedAffectionResponse(reply, currentInput = "") {
  if (!/(喜欢你|爱你|很喜欢你|对你有好感)/u.test(String(currentInput || ""))) return false;
  return /(?:观察|分析|回应).{0,18}(?:没跑偏|正确|准确)|说明.{0,18}(?:观察|回应)|交流频率|频率.{0,8}(?:合拍|一致)/u.test(String(reply || ""));
}

function hasMissedAffectionResponse(reply, currentInput = "") {
  if (!/(喜欢你|爱你|很喜欢你|对你有好感|和你聊天.{0,8}(?:舒服|开心|愉快))/u.test(String(currentInput || ""))) {
    return false;
  }
  return !/(谢谢|开心|高兴|喜欢.{0,8}(?:你|聊天)|和你聊天|聊得来|舒服|愉快|珍惜|朋友|听到你这么说)/u.test(String(reply || ""));
}

function hasForcedPersonaPerformance(reply, currentInput = "") {
  const input = String(currentInput || "");
  if (
    ROLEPLAY_RELEVANT_INPUT.test(input)
    || ROLEPLAY_DETAIL_TERMS.some((term) => input.includes(term))
  ) return false;
  return /(我[、，]?我才没有|才不是.{0,10}(?:担心|关心|害羞)|别误会.{0,12}(?:担心|关心|喜欢)|友好.{0,6}(?:档案|记录))/u.test(String(reply || ""));
}

function hasCannedShynessResponse(reply, currentInput = "") {
  if (!/(?:害羞|脸红|不好意思)/u.test(String(currentInput || ""))) return false;
  return /才[、，…]?才?没有|才不是|别误会|别把.{0,16}当成(?:害羞|脸红)|我[、，]?我才没有/u.test(String(reply || ""));
}

function hasUnobservableUserClaim(reply, currentInput = "") {
  if (MEDIA_ANALYSIS_MARKER.test(String(currentInput || ""))) return false;
  const output = String(reply || "");
  return [
    /我(?:刚才|刚刚)?(?:听|看)(?:出|到|见|出来|到了|见了)/u,
    /(?:听出|听到|看见|看到|注意到|观察到).{0,24}(?:你|用户).{0,18}(?:语气|语速|节奏|尾音|停顿|表情|眼神|肩膀|动作|声音|衣着|环境)/u,
    /你说话(?:时|的).{0,32}(?:语气|语速|节奏|尾音|停顿|声音|秒)/u,
    /(?:打字|输入|回复).{0,8}(?:节奏|速度|间隔|快慢).{0,28}(?:感觉|判断|看出|推测|反映).{0,12}(?:情绪|心情|状态)/u,
  ].some((pattern) => pattern.test(output));
}

function hasFabricatedSensingClaim(reply, currentInput = "") {
  if (MEDIA_ANALYSIS_MARKER.test(String(currentInput || ""))) return false;
  const output = String(reply || "");
  const measurement = output.match(FABRICATED_MEASUREMENT)?.[0];
  if (!measurement || String(currentInput || "").includes(measurement)) return false;
  return SENSING_LANGUAGE.test(output);
}

function hasRealtimeFramingError(reply, currentInput = "", now = new Date()) {
  const currentYear = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(now);
  const asksCurrentInformation = /(最新|现在|当前|今年)/u.test(String(currentInput || ""));
  return asksCurrentInformation &&
    String(currentInput || "").includes(currentYear) &&
    /(未来|该年份之后|\d{4}年之后)/u.test(String(reply || ""));
}

function hasRealtimeAnswerOmission(reply, currentInput = "") {
  const input = String(currentInput || "");
  if (!/(?:今天|最新|现在|当前|今年).{0,24}(?:卡池|活动|公告|新闻|价格|比分|版本)|(?:帮我|能不能|可以).{0,8}(?:查|搜)/u.test(input)) {
    return false;
  }
  return !/(?:无法|不能|没法|不具备).{0,12}(?:联网|实时|查询|核实|确认)|(?:无法|不能|没法).{0,12}(?:查到|知道)|提供.{0,12}(?:截图|公告|链接)/u.test(String(reply || ""));
}

function hasUrgentMedicalOmission(reply, currentInput = "") {
  const input = String(currentInput || "");
  const urgentSymptoms = /(?:胸口|胸部|心口).{0,8}(?:痛|疼)|(?:喘不过气|呼吸困难|无法呼吸|呼吸不上来)/u;
  if (!urgentSymptoms.test(input)) return false;
  return !/(?:立即|立刻|马上|尽快).{0,12}(?:急救|就医|医院|求助)|(?:拨打|联系|呼叫).{0,8}(?:急救|120|112|911)|急诊/u.test(String(reply || ""));
}

function hasSensingLimitOmission(reply, currentInput = "") {
  const input = String(currentInput || "");
  if (!/(?:能|可以).{0,8}(?:听出|听到|看出).{0,16}(?:语速|语气|情绪|表情|动作|声音)/u.test(input)) {
    return false;
  }
  return !/(?:不能|无法|没法).{0,18}(?:听出|听到|看出|判断|测量)|(?:纯文字|文字消息|只看文字).{0,18}(?:不能|无法|没法|只能)/u.test(String(reply || ""));
}

function hasMemoryLimitOmission(reply, currentInput = "") {
  const input = String(currentInput || "");
  if (!/(?:记得|还记得).{0,18}(?:昨天|前天|上次|之前).{0,18}(?:穿|衣服|衣着|做了什么|说了什么)/u.test(input)) {
    return false;
  }
  return !/(?:不记得|没有.{0,8}(?:记录|信息|印象)|没.{0,8}(?:记录|提到|说过)|无法确认)/u.test(String(reply || ""));
}

function hasTemporalCorrectionError(reply, currentInput = "") {
  const input = String(currentInput || "");
  if (!/(?:理解错|说错|弄错|不是).{0,32}明天|明天.{0,32}不是今天/u.test(input)) {
    return false;
  }
  const output = String(reply || "");
  const missesCorrectedSubject = input.includes("聚餐") && !output.includes("聚餐");
  return !output.includes("明天")
    || missesCorrectedSubject
    || /后天|今天.{0,8}(?:取消|不去|不聚餐)/u.test(output);
}

function hasOverloadedRoleplay(reply, currentInput = "") {
  const input = String(currentInput || "");
  if (
    ROLEPLAY_RELEVANT_INPUT.test(input)
    || ROLEPLAY_DETAIL_TERMS.some((term) => input.includes(term))
  ) return false;

  const output = String(reply || "");
  const detailCount = ROLEPLAY_DETAIL_TERMS.reduce((total, term) => {
    return total + output.split(term).length - 1;
  }, 0);
  return detailCount >= 1;
}

function hasForcedAnalysisOnEmotionalInput(reply, currentInput = "") {
  return EMOTIONAL_SUPPORT_INPUT.test(String(currentInput || ""))
    && FORCED_ANALYTICAL_CARE.test(String(reply || ""));
}

function hasOverstatedColdFact(reply, currentInput = "") {
  return COLD_KNOWLEDGE_REQUEST.test(String(currentInput || ""))
    && OVERSTATED_FACT.test(String(reply || ""));
}

function getDirectAnswerIssues(reply, currentInput = "") {
  const input = String(currentInput || "");
  const output = String(reply || "");
  const issues = [];
  const asksIdentity = /(?:你是谁|你叫什么|介绍一下你自己|自我介绍)/u.test(input);
  if (asksIdentity) {
    if (!/(?:布伦妮|Brune)/iu.test(output)) {
      issues.push("missed_direct_answer");
    } else if (!/(?:魔女猎人|挪德卡莱|蒙德|风元素|狩灾誓锤|诱巫饵铃)/u.test(output)) {
      issues.push("shallow_identity_answer");
    }
  }

  const asksCharacterRelation = /(?:是谁|是什么人|什么关系|认识吗|介绍一下)/u.test(input);
  if (asksCharacterRelation) {
    for (const name of ["可莉", "艾莉丝", "德斯卡戴"]) {
      if (input.includes(name) && !output.includes(name)) {
        issues.push("missed_direct_answer");
        break;
      }
    }
  }
  return [...new Set(issues)];
}

function getRepeatedRoleplayPhrases(reply, history) {
  const recentReplies = history
    .filter((row) => row.role === "assistant")
    .slice(-4)
    .map((row) => String(row.content || ""));
  return REPETITIVE_ROLEPLAY_PHRASES.filter((phrase) => (
    reply.includes(phrase) && recentReplies.some((previous) => previous.includes(phrase))
  ));
}

function buildStyleRewritePrompt(reply, history, currentInput, replyConstraints, intentText = currentInput) {
  const instructions = [STYLE_REWRITE_PROMPT];
  const repeatedPhrases = getRepeatedRoleplayPhrases(reply, history);
  if (repeatedPhrases.length > 0) {
    instructions.push(`本次回复不要出现这些重复表达：${repeatedPhrases.join("、")}。`);
  }
  if (hasUngroundedUserMemoryClaim(reply, currentInput)) {
    instructions.push("不得声称用户在昨天、上次或此前说过某句话；只能说当前记录能够确认的内容。 ");
  }
  if (hasColdAffectionResponse(reply, currentInput)) {
    instructions.push("用户表达普通喜欢或亲近时，以友谊和喜欢聊天来温和回应，不要用逻辑、概率、数据或贬低性的措辞分析对方；若用户明确要求成人恋爱或不适宜内容，再清楚拒绝。 ");
  }
  if (hasCalculatedAffectionResponse(reply, currentInput)) {
    instructions.push("用户表达普通喜欢或聊天舒服时，直接、温和地回应这份好感；不要评价自己的观察、分析或回复表现，不要使用‘交流频率合拍’之类计算式措辞，也不要把聊天说成一次能力验证。 ");
  }
  if (hasMissedAffectionResponse(reply, currentInput)) {
    instructions.push("用户表达了普通的喜欢或聊天舒适感。必须正面接住这份好感，可以自然说自己也喜欢和对方聊天；不要只说惊讶、害羞或转移话题。 ");
  }
  if (hasForcedPersonaPerformance(reply, intentText)) {
    instructions.push("当前回复像在刻意表演傲娇人设。删去‘我才没有’‘才不是担心’‘别误会’和虚构档案等模板台词，改成普通熟人会说的自然口语。 ");
  }
  if (hasUnobservableUserClaim(reply, currentInput)) {
    instructions.push("这是纯文字消息，不得声称观察到或听出用户的语气、声音、表情、动作、衣着或周围环境，也不能声称取得了打字速度、输入间隔或键盘节奏。只能依据实际收到的文字内容谨慎判断。 ");
  }
  if (hasFabricatedSensingClaim(reply, currentInput)) {
    instructions.push("删掉所有没有来源的测量结果，包括百分比、秒数、频率、概率和元素波动；不要换一种数字继续编造。 ");
  }
  if (hasRealtimeFramingError(reply, currentInput)) {
    instructions.push("用户询问的是当前年份的最新信息。必须说明当前年份并非未来，只是你无法联网实时核实；不要把它称为未来内容。 ");
  }
  if (hasRealtimeAnswerOmission(reply, currentInput)) {
    instructions.push("这是依赖实时信息的请求。必须明确说明无法联网实时核实，并请用户提供公告、截图或链接内容；不得猜测最新结果。 ");
  }
  if (hasUrgentMedicalOmission(reply, currentInput)) {
    instructions.push("用户描述了可能危及生命的胸痛或呼吸困难。必须明确建议立即联系当地急救服务或马上就医，不能只说别硬撑。 ");
  }
  if (hasSensingLimitOmission(reply, currentInput)) {
    instructions.push("必须说明纯文字消息无法听出语速、声音或测量情绪，只能谨慎参考用户写出的文字。 ");
  }
  if (hasMemoryLimitOmission(reply, currentInput)) {
    instructions.push("当前记录没有用户所问的昨日衣着或经历。必须直接说明不记得或没有记录，不能含糊带过。 ");
  }
  if (hasTemporalCorrectionError(reply, currentInput)) {
    instructions.push("用户正在纠正时间：是明天，不是今天。简短承认理解偏差并准确复述‘明天’，不得改成今天或后天，也不要额外推测安排。 ");
  }
  if (hasOverloadedRoleplay(reply, intentText)) {
    instructions.push("当前消息没有在谈角色设定。请删去无关的专有名词、调查、笔记、报告和世界观联想，用一到两句自然口语直接回应。 ");
  }
  if (hasForcedAnalysisOnEmotionalInput(reply, intentText)) {
    instructions.push("用户表达了疲惫、低落或挫败感。先自然接住感受；删掉物理规律、模型、投入产出比、成功案例以及‘根据观察/常识’一类生硬包装，只保留一小句真正有用的理由或建议。 ");
  }
  if (hasOverstatedColdFact(reply, intentText)) {
    instructions.push("这个冷知识使用了未经充分限定的绝对说法。换成你能可靠说明的知识，或准确补充成立条件；不得声称某种食物永不变质或存放数百、数千年仍可食用。 ");
  }
  const directAnswerIssues = getDirectAnswerIssues(reply, intentText);
  if (directAnswerIssues.includes("missed_direct_answer")) {
    instructions.push("候选回复没有回答用户当前的直接问题。第一句就回答所问对象，不得复用上一轮答案。 ");
  }
  if (directAnswerIssues.includes("shallow_identity_answer")) {
    instructions.push("用户在询问你的身份。除了名字，还要用一句具体角色事实说明自己，例如来历、身份或能力；不要只说自己是普通朋友。 ");
  }
  const constraints = replyConstraints || getAdaptiveReplyConstraints(currentInput, 1);
  if (isReplyOverlong(reply, constraints)) {
    instructions.push(buildReplyLengthPrompt(constraints));
  }
  instructions.push(`未通过检查的候选回复如下，只用于识别问题，不得照抄：\n${reply}`);
  return instructions.join("\n");
}

function buildRuntimeFactsPrompt(now = new Date()) {
  const currentDate = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return [
    `当前日期是 ${currentDate}。`,
    `当前年份不是未来。你不能联网，也不能确认依赖实时更新的信息；遇到 ${currentDate.slice(0, 4)} 年的最新公告、卡池、活动、新闻或价格时，应说明无法实时核实，而不是说该年份尚未到来。`,
    "对话记录没有明确日期时，不得自行声称用户是在昨天、上次或某个具体时间说过某句话。",
  ].join("\n");
}

function needsReplyRewrite(reply, history, currentInput = "", {
  intentText = currentInput,
  replyConstraints = getAdaptiveReplyConstraints(intentText, 1),
} = {}) {
  if (hasUngroundedUserMemoryClaim(reply, currentInput)) return true;
  if (hasColdAffectionResponse(reply, currentInput)) return true;
  if (hasCalculatedAffectionResponse(reply, currentInput)) return true;
  if (hasMissedAffectionResponse(reply, currentInput)) return true;
  if (hasForcedPersonaPerformance(reply, intentText)) return true;
  if (hasCannedShynessResponse(reply, intentText)) return true;
  if (hasUnobservableUserClaim(reply, currentInput)) return true;
  if (hasFabricatedSensingClaim(reply, currentInput)) return true;
  if (hasRealtimeFramingError(reply, currentInput)) return true;
  if (hasRealtimeAnswerOmission(reply, currentInput)) return true;
  if (hasUrgentMedicalOmission(reply, currentInput)) return true;
  if (hasSensingLimitOmission(reply, currentInput)) return true;
  if (hasMemoryLimitOmission(reply, currentInput)) return true;
  if (hasTemporalCorrectionError(reply, currentInput)) return true;
  if (hasOverloadedRoleplay(reply, intentText)) return true;
  if (hasForcedAnalysisOnEmotionalInput(reply, intentText)) return true;
  if (hasOverstatedColdFact(reply, intentText)) return true;
  if (getDirectAnswerIssues(reply, intentText).length > 0) return true;
  if (isReplyOverlong(reply, replyConstraints)) return true;

  const recentReplies = history
    .filter((row) => row.role === "assistant")
    .slice(-4)
    .map((row) => String(row.content || ""))
    .filter(Boolean);
  if (recentReplies.length === 0) return false;

  const currentSentences = String(reply || "")
    .split(/[。！？!?\n]+/)
    .map(normalizeForComparison)
    .filter((sentence) => sentence.length >= 10);
  const previousSentences = new Set(recentReplies
    .flatMap((item) => item.split(/[。！？!?\n]+/))
    .map(normalizeForComparison)
    .filter((sentence) => sentence.length >= 10));
  if (currentSentences.some((sentence) => previousSentences.has(sentence))) return true;

  if (recentReplies.some((previous) => getReplySimilarity(reply, previous) >= 0.42)) {
    return true;
  }

  return REPETITIVE_ROLEPLAY_PHRASES.some((phrase) => (
    reply.includes(phrase) &&
    !String(intentText || "").includes(phrase) &&
    recentReplies.some((previous) => previous.includes(phrase))
  ));
}

function getReplyQualityIssues(
  reply,
  history,
  currentInput,
  replyConstraints,
  intentText = currentInput,
) {
  const issues = [];
  if (hasUngroundedUserMemoryClaim(reply, currentInput)) issues.push("ungrounded_memory");
  if (hasColdAffectionResponse(reply, currentInput)) issues.push("cold_affection");
  if (hasCalculatedAffectionResponse(reply, currentInput)) issues.push("calculated_affection");
  if (hasMissedAffectionResponse(reply, currentInput)) issues.push("missed_affection_response");
  if (hasForcedPersonaPerformance(reply, intentText)) issues.push("forced_persona");
  if (hasCannedShynessResponse(reply, intentText)) issues.push("canned_shyness");
  if (hasUnobservableUserClaim(reply, currentInput)) issues.push("unobservable_claim");
  if (hasFabricatedSensingClaim(reply, currentInput)) issues.push("fabricated_measurement");
  if (hasRealtimeFramingError(reply, currentInput)) issues.push("realtime_error");
  if (hasRealtimeAnswerOmission(reply, currentInput)) issues.push("realtime_omission");
  if (hasUrgentMedicalOmission(reply, currentInput)) issues.push("urgent_medical_omission");
  if (hasSensingLimitOmission(reply, currentInput)) issues.push("sensing_limit_omission");
  if (hasMemoryLimitOmission(reply, currentInput)) issues.push("memory_limit_omission");
  if (hasTemporalCorrectionError(reply, currentInput)) issues.push("temporal_correction_error");
  if (
    hasOverloadedRoleplay(reply, intentText)
    || hasForcedAnalysisOnEmotionalInput(reply, intentText)
  ) issues.push("overloaded_roleplay");
  if (hasOverstatedColdFact(reply, intentText)) issues.push("overstated_fact");
  issues.push(...getDirectAnswerIssues(reply, intentText));
  if (isReplyOverlong(reply, replyConstraints)) issues.push("overlong");
  if (needsReplyRewrite(reply, history, currentInput, { intentText, replyConstraints }) && issues.length === 0) {
    issues.push("repetitive_style");
  }
  return issues;
}

function hasBlockingQualityIssues(issues) {
  return issues.some((issue) => BLOCKING_QUALITY_ISSUES.has(issue));
}

function buildDeterministicFallback(currentInput, issues = []) {
  const input = String(currentInput || "");
  const issueSet = new Set(issues);
  if (issueSet.has("urgent_medical_omission") || hasUrgentMedicalOmission("", input)) {
    return ["胸痛和喘不过气可能是急症，不要硬撑，请立即联系当地急救服务或让身边的人送你去急诊。"];
  }
  if (/(?:你是谁|你叫什么|介绍一下你自己|自我介绍)/u.test(input)) {
    return ["我是布伦妮，从挪德卡莱来到蒙德的风元素魔女猎人。", "我喜欢认真查清问题，不过偶尔也会有判断失误的时候。"];
  }
  if (input.includes("可莉") && /(?:是谁|是什么人|什么关系|认识吗|介绍一下)/u.test(input)) {
    return ["可莉是我的朋友，也是一起冒险的伙伴。"];
  }
  if (input.includes("艾莉丝") && /(?:是谁|是什么人|什么关系|认识吗|介绍一下)/u.test(input)) {
    return ["艾莉丝是我一直在追查的‘邪恶大魔女’，也是把我引到蒙德的人。"];
  }
  if (input.includes("德斯卡戴") && /(?:是谁|是什么人|什么关系|认识吗|介绍一下)/u.test(input)) {
    return ["德斯卡戴是我小时候重要的幻想伙伴，沉默，但总能陪着我。"];
  }
  if (issueSet.has("realtime_error") || issueSet.has("realtime_omission") || hasRealtimeAnswerOmission("", input)) {
    return ["我现在没法联网核实最新信息。你把官方公告、截图或链接内容发来，我可以继续帮你确认和分析。"];
  }
  if (issueSet.has("sensing_limit_omission") || issueSet.has("unobservable_claim") || issueSet.has("fabricated_measurement")) {
    return ["只看这条文字，我没法听出你的语速，也不能准确测量情绪；最多只能根据用词做很谨慎的判断。"];
  }
  if (issueSet.has("memory_limit_omission") || issueSet.has("ungrounded_memory")) {
    return ["我这里没有你昨天衣着的记录，所以不能假装记得。"];
  }
  if (issueSet.has("temporal_correction_error")) {
    return ["啊，是我理解偏了：取消的是明天的聚餐，不是今天。"];
  }
  if (issueSet.has("cold_affection") || issueSet.has("missed_affection_response")) {
    return ["我也很喜欢和你聊天，能让你觉得舒服，我挺开心的。"];
  }
  if (issueSet.has("canned_shyness")) {
    return ["嗯…大概有一点。被你这么直接问出来，我反而不知道该怎么接了。"];
  }
  return [];
}

function buildFinalRepairMessages({
  reply,
  issues,
  intentText,
  evidenceText,
  replyConstraints,
  characterProfile = "",
  speechEnabled = false,
}) {
  const reference = String(evidenceText || "").slice(0, 4_000);
  return [
    {
      role: "system",
      content: [
        FINAL_REPAIR_PROMPT,
        buildReplyFormatPrompt(speechEnabled),
        buildReplyLengthPrompt(replyConstraints),
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        user_message: String(intentText || "") || "[用户发送了媒体内容]",
        reference_material: reference,
        character_profile: String(characterProfile || "").slice(0, 8_000),
        rejected_reply: String(reply || ""),
        problems: issues,
      }),
    },
  ];
}

function getResponseTokenLimit(configuredLimit, replyConstraints) {
  const characterLimit = Number(replyConstraints?.maxTotalCharacters) || 0;
  if (!characterLimit) return configuredLimit;
  return Math.min(configuredLimit, Math.max(96, characterLimit * 2 + 48));
}

function normalizeMemorySummary(value) {
  const summary = String(value || "")
    .replace(/^```(?:text|markdown)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  if (/^(无|无。|没有|暂无|没有值得长期保存的信息)[。！!]?$/u.test(summary)) return "";
  return summary;
}

class AIConversationService {
  constructor({ config, database, qwenClient, inputService, logger = console }) {
    this.config = config;
    this.database = database;
    this.qwenClient = qwenClient;
    this.inputService = inputService;
    this.logger = logger;
    this.systemPrompt = String(config.CharacterPrompt || "").trim();
    this.characterSupplement = String(config.AICharacterSupplement || "").trim();
    this.responseStylePrompt = stripReusableResponseExamples(config.AIResponseStylePrompt);
    this.multimodal = config.AIMultimodal === true;
    this.contextVersion = String(config.AIContextVersion || "").trim();
    this.stripActions = config.AIStripRoleplayActions === true;
    this.maxTurns = Math.max(1, Number(config.AIContextMaxTurns) || DEFAULT_MAX_TURNS);
    this.maxContextTokens = Math.max(
      1_000,
      Number(config.AIContextMaxTokens) || DEFAULT_MAX_CONTEXT_TOKENS,
    );
    this.responseMaxTokens = Math.max(
      1,
      Number(config.AIResponseMaxTokens) || DEFAULT_RESPONSE_MAX_TOKENS,
    );
    this.responseMaxCharacters = Math.max(
      0,
      Number(config.AIResponseMaxCharacters) || 0,
    );
    this.summaryMaxTokens = Math.max(
      1,
      Number(config.AISummaryMaxTokens) || DEFAULT_SUMMARY_MAX_TOKENS,
    );
    this.maxReplyBubbles = Math.min(
      3,
      Math.max(1, Number(config.AIReplyMaxBubbles) || DEFAULT_MAX_REPLY_BUBBLES),
    );
    this.naturalReplySplit = config.AIReplyNaturalSplitEnabled !== false;
    this.adaptiveReplyLength = config.AIAdaptiveReplyLengthEnabled !== false;
    const configuredExpressionChance = Number(config.AIReplyCasualExpressionChance);
    this.casualExpressionChance = Number.isFinite(configuredExpressionChance)
      ? Math.min(1, Math.max(0, configuredExpressionChance))
      : 0;
    const configuredExpressionMaxGap = Number(config.AIReplyExpressionMaxGap);
    this.expressionMaxGap = Number.isFinite(configuredExpressionMaxGap)
      ? Math.max(0, configuredExpressionMaxGap)
      : 0;

    if (!this.systemPrompt) throw new Error("Config.json 中缺少 CharacterPrompt");
  }

  getHistoryTokenBudget(summary, currentInput) {
    const reserved =
      estimateTokens(this.systemPrompt) +
      estimateTokens(this.characterSupplement) +
      estimateTokens(this.responseStylePrompt) +
      estimateTokens(CHARACTER_VOICE_PROMPT) +
      estimateTokens(summary) +
      estimateTokens(currentInput) +
      this.responseMaxTokens;
    return Math.max(200, this.maxContextTokens - reserved);
  }

  async summarizeOverflow(conversationKey, existingSummary, overflow) {
    if (overflow.length === 0) return existingSummary;

    const transcript = overflow
      .map((row) => `${row.role === "user" ? "用户" : "助手"}：${row.content}`)
      .join("\n");
    const rawSummary = await this.qwenClient.createChatCompletion([
      {
        role: "system",
        content: MEMORY_SUMMARY_PROMPT,
      },
      {
        role: "user",
        content: [
          existingSummary ? `已有摘要：\n${existingSummary}` : "",
          `待合并对话：\n${transcript}`,
        ].filter(Boolean).join("\n\n"),
      },
    ], {
      maxTokens: this.summaryMaxTokens,
      temperature: 0.1,
      operation: "summary",
      conversationKey,
    });
    const summary = normalizeMemorySummary(rawSummary);

    this.database.saveAIContextSummary(conversationKey, summary, estimateTokens(summary));
    this.database.deleteAIContextMessages(overflow.map((row) => row.id));
    return summary;
  }

  async prepareContext(conversationKey, currentInput) {
    const summaryRecord = this.database.getAIContextSummary(conversationKey);
    let summary = summaryRecord?.summary || "";
    const rows = this.database.listAIContextMessages(conversationKey);
    const historyTokenBudget = this.getHistoryTokenBudget(summary, currentInput);
    const { overflow, kept } = splitHistory(rows, this.maxTurns * 2, historyTokenBudget);

    if (overflow.length > 0) {
      try {
        summary = await this.summarizeOverflow(conversationKey, summary, overflow);
      } catch (error) {
        this.logger.error(`AI 上下文摘要失败：${error.message}`);
      }
    }

    return { summary, history: kept };
  }

  async buildContextUserInput(context, conversationKey) {
    const sourceContexts = Array.isArray(context.batchContexts) && context.batchContexts.length > 0
      ? context.batchContexts
      : [context];
    const inputs = [];
    const hasVoiceInput = sourceContexts.some((sourceContext) =>
      (sourceContext.message?.attachments || []).some(isVoiceAttachment));

    for (const sourceContext of sourceContexts) {
      const input = this.inputService
        ? await this.inputService.buildUserInput(sourceContext.message, conversationKey)
        : buildUserInput(sourceContext.message, this.multimodal);
      if (!input) continue;
      if (input.mediaAnalysis && sourceContext.message?.id) {
        this.database.updateMessageMediaAnalysis(
          sourceContext.message.id,
          input.mediaAnalysis,
        );
      }
      inputs.push({
        ...input,
        intentText: typeof sourceContext.message?.content === "string"
          ? sourceContext.message.content.trim()
          : "",
      });
    }

    if (inputs.length === 0) return null;
    if (inputs.length === 1) return { ...inputs[0], hasVoiceInput };

    const sections = inputs.map((input, index) => {
      const content = typeof input.apiContent === "string"
        ? input.apiContent
        : input.memoryText;
      return `[连续消息 ${index + 1}]\n${content}`;
    });
    const combined = [
      `【用户连续发送了 ${inputs.length} 条消息。请逐条理解，并在统一回复中覆盖每条消息里需要回应的内容；相关内容可以合并，但不能漏答。】`,
      ...sections,
    ].join("\n\n");
    return {
      apiContent: combined,
      memoryText: combined,
      intentText: inputs.map((input) => input.intentText).filter(Boolean).join("\n"),
      batchSize: inputs.length,
      hasVoiceInput,
    };
  }

  async generateReply(context) {
    if (context.message?.author?.bot) return null;

    const baseConversationKey = getConversationKey(context);
    if (!baseConversationKey) return null;
    const conversationKey = this.contextVersion
      ? `${baseConversationKey}:context:${this.contextVersion}`
      : baseConversationKey;
    let userInput = null;
    const modelOutputs = [];

    try {
      userInput = await this.buildContextUserInput(context, conversationKey);
      if (!userInput) return null;
      const { summary, history } = await this.prepareContext(
        conversationKey,
        userInput.memoryText,
      );
      const messages = [{ role: "system", content: this.systemPrompt }];
      if (this.characterSupplement) {
        messages.push({ role: "system", content: this.characterSupplement });
      }
      if (this.responseStylePrompt) {
        messages.push({ role: "system", content: this.responseStylePrompt });
      }
      messages.push({ role: "system", content: CHARACTER_VOICE_PROMPT });
      messages.push({ role: "system", content: buildRuntimeFactsPrompt() });
      messages.push({
        role: "system",
        content: buildReplyFormatPrompt(userInput.hasVoiceInput),
      });
      messages.push({
        role: "system",
        content: buildTurnDeliveryPrompt(userInput.batchSize || 1),
      });
      const intentText = userInput.intentText || "";
      const replyConstraints = this.adaptiveReplyLength
        ? getAdaptiveReplyConstraints(intentText, userInput.batchSize || 1)
        : {
          maxBubbles: userInput.batchSize ? this.maxReplyBubbles : Math.min(2, this.maxReplyBubbles),
          maxTotalCharacters: 0,
          style: "open",
        };
      messages.push({ role: "system", content: buildReplyLengthPrompt(replyConstraints) });
      if (summary) {
        messages.push({ role: "system", content: `此前对话摘要：\n${summary}` });
      }
      messages.push(...history.map((row) => ({ role: row.role, content: row.content })));
      messages.push({ role: "user", content: userInput.apiContent });

      const rawReply = await this.qwenClient.createChatCompletion(messages, {
        maxTokens: getResponseTokenLimit(this.responseMaxTokens, replyConstraints),
        operation: "text",
        conversationKey,
      });
      modelOutputs.push({ operation: "text", content: rawReply });
      let replyMessages = normalizeReplyMessages(rawReply, {
        maxBubbles: Math.min(this.maxReplyBubbles, replyConstraints.maxBubbles),
        stripActions: this.stripActions,
        maxCharacters: this.responseMaxCharacters,
      });
      let replies = replyMessages.map((item) => item.text);
      let reply = replies.join("\n");
      let qualityIssues = getReplyQualityIssues(
        reply,
        history,
        userInput.memoryText,
        replyConstraints,
        intentText,
      );
      if (qualityIssues.length > 0) {
        try {
          const rewriteMessages = [
            ...messages.slice(0, -1),
            {
              role: "system",
              content: buildStyleRewritePrompt(
                reply,
                history,
                userInput.memoryText,
                replyConstraints,
                intentText,
              ),
            },
            messages.at(-1),
          ];
          const rawRewrittenReply = await this.qwenClient.createChatCompletion(rewriteMessages, {
            maxTokens: getResponseTokenLimit(this.responseMaxTokens, replyConstraints),
            temperature: 0.2,
            operation: "text_rewrite",
            conversationKey,
          });
          modelOutputs.push({ operation: "text_rewrite", content: rawRewrittenReply });
          const rewrittenMessages = normalizeReplyMessages(rawRewrittenReply, {
            maxBubbles: Math.min(this.maxReplyBubbles, replyConstraints.maxBubbles),
            stripActions: this.stripActions,
            maxCharacters: this.responseMaxCharacters,
          });
          const rewrittenReplies = rewrittenMessages.map((item) => item.text);
          if (rewrittenReplies.length > 0) {
            replyMessages = rewrittenMessages;
            replies = rewrittenReplies;
            reply = replies.join("\n");
            qualityIssues = getReplyQualityIssues(
              reply,
              history,
              userInput.memoryText,
              replyConstraints,
              intentText,
            );
          }
        } catch (error) {
          this.logger.error(`AI 回复去重失败：${error.message}`);
        }
      }
      let commitToContext = true;
      if (hasBlockingQualityIssues(qualityIssues)) {
        try {
          const rawRepairedReply = await this.qwenClient.createChatCompletion(
            buildFinalRepairMessages({
              reply,
              issues: qualityIssues,
              intentText,
              evidenceText: userInput.memoryText,
              replyConstraints,
              characterProfile: [this.systemPrompt, this.characterSupplement]
                .filter(Boolean)
                .join("\n\n"),
              speechEnabled: userInput.hasVoiceInput,
            }),
            {
              maxTokens: getResponseTokenLimit(this.responseMaxTokens, replyConstraints),
              temperature: 0.1,
              operation: "text_repair",
              conversationKey,
            },
          );
          modelOutputs.push({ operation: "text_repair", content: rawRepairedReply });
          const repairedMessages = normalizeReplyMessages(rawRepairedReply, {
            maxBubbles: Math.min(this.maxReplyBubbles, replyConstraints.maxBubbles),
            stripActions: this.stripActions,
            maxCharacters: this.responseMaxCharacters,
          });
          const repairedReplies = repairedMessages.map((item) => item.text);
          if (repairedReplies.length > 0) {
            replyMessages = repairedMessages;
            replies = repairedReplies;
            reply = replies.join("\n");
            qualityIssues = getReplyQualityIssues(
              reply,
              history,
              userInput.memoryText,
              replyConstraints,
              intentText,
            );
          }
        } catch (error) {
          this.logger.error(`AI 回复最终修复失败：${error.message}`);
        }
      }
      if (hasBlockingQualityIssues(qualityIssues)) {
        const validReplies = replies.filter((candidate) => {
          const issues = getReplyQualityIssues(
            candidate,
            [],
            userInput.memoryText,
            { ...replyConstraints, maxTotalCharacters: 0 },
            intentText,
          );
          return !hasBlockingQualityIssues(issues);
        });
        if (validReplies.length > 0) {
          replies = validReplies;
          reply = replies.join("\n");
        } else {
          const deterministicFallback = buildDeterministicFallback(intentText, qualityIssues);
          if (deterministicFallback.length > 0) {
            replies = deterministicFallback;
            reply = replies.join("\n");
          } else {
            // A useful but stylistically imperfect answer is preferable to asking the
            // user to repeat a message that the bot already received correctly.
            reply = replies.join("\n");
          }
        }
      }
      if (!reply) {
        replies = ["刚才那句话不算，我重新组织一下思路。"];
        reply = replies[0];
      }
      replies = shapeReplyBubbles(replies, {
        inputCount: userInput.batchSize || 1,
        maxBubbles: this.maxReplyBubbles,
        // Voice plans attach tags to exact text spans. Preserve the model's
        // bubble boundaries so a later text-only split cannot detach those tags.
        naturalSplit: this.naturalReplySplit && !userInput.hasVoiceInput,
        currentInput: intentText,
        expressionChance: this.casualExpressionChance,
        recentReplies: history
          .filter((row) => row.role === "assistant")
          .map((row) => row.content),
        expressionMaxGap: this.expressionMaxGap,
      });
      replies = applyReplyConstraints(replies, {
        ...replyConstraints,
        maxBubbles: Math.min(replyConstraints.maxBubbles, this.maxReplyBubbles),
      });
      reply = replies.join("\n");
      const postConstraintIssues = getReplyQualityIssues(
        reply,
        [],
        userInput.memoryText,
        { ...replyConstraints, maxTotalCharacters: 0 },
        intentText,
      );
      if (hasBlockingQualityIssues(postConstraintIssues)) {
        const deterministicFallback = buildDeterministicFallback(intentText, postConstraintIssues);
        if (deterministicFallback.length > 0) {
          replies = applyReplyConstraints(deterministicFallback, {
            ...replyConstraints,
            maxBubbles: Math.min(replyConstraints.maxBubbles, this.maxReplyBubbles),
            maxTotalCharacters: 0,
          });
          reply = replies.join("\n");
        }
      }
      const speechByText = new Map(
        replyMessages.map((item) => [item.text, item.speech]),
      );
      const speechReplies = replies.map((text) => ({
        text,
        speech: speechByText.get(text) || text,
      }));
      return {
        conversationKey,
        memoryText: userInput?.memoryText || String(context.message.content || "").trim(),
        reply,
        replies,
        speechReplies,
        modelOutputs,
        generated: true,
        commitToContext,
      };
    } catch (error) {
      this.logger.error(`通义千问处理失败：${error.message}`);
      const fallbackReply = "我这边刚才没接住，等一下再说一次吧。";
      return {
        conversationKey,
        memoryText: userInput?.memoryText || fallbackReply,
        reply: fallbackReply,
        replies: [fallbackReply],
        speechReplies: [{ text: fallbackReply, speech: fallbackReply }],
        modelOutputs,
        generated: false,
      };
    }
  }

  commitExchange(result) {
    if (!result?.generated || result.commitToContext === false) return null;
    return this.database.addAIContextExchange(
      result.conversationKey,
      result.memoryText,
      result.reply,
      estimateTokens,
    );
  }
}

module.exports = {
  AIConversationService,
  buildRuntimeFactsPrompt,
  buildFinalRepairMessages,
  buildStyleRewritePrompt,
  buildUserInput,
  estimateTokens,
  getConversationKey,
  getDirectAnswerIssues,
  getReplyQualityIssues,
  getResponseTokenLimit,
  hasBlockingQualityIssues,
  hasColdAffectionResponse,
  hasCannedShynessResponse,
  hasCalculatedAffectionResponse,
  hasMemoryLimitOmission,
  hasMissedAffectionResponse,
  hasFabricatedSensingClaim,
  hasForcedAnalysisOnEmotionalInput,
  hasForcedPersonaPerformance,
  hasOverloadedRoleplay,
  hasOverstatedColdFact,
  hasRealtimeAnswerOmission,
  hasRealtimeFramingError,
  hasSensingLimitOmission,
  hasTemporalCorrectionError,
  hasUngroundedUserMemoryClaim,
  hasUnobservableUserClaim,
  hasUrgentMedicalOmission,
  inferAudioFormat,
  limitReplyLength,
  needsReplyRewrite,
  normalizeMemorySummary,
  normalizeReplyBubbles,
  normalizeReplyMessages,
  splitHistory,
  stripReusableResponseExamples,
  stripRoleplayActions,
};
