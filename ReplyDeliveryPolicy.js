const DEFAULT_MAX_BUBBLES = 3;
const DEFAULT_EXPRESSION_CHANCE = 0.18;
const CASUAL_EXPRESSIONS = ["(´▽｀)", "(￣▽￣)", "✨", "嗯哼～"];

const REACTION_PREFIX = /^(嗯|欸|诶|啊|唔|哎|咦|好|好吧|原来|确实|没事|当然|等等|这样啊|是吗|真的吗|太好了|辛苦了|别急)/u;
const SERIOUS_TOPIC = /(自杀|自残|不想活|伤害自己|死亡|去世|葬礼|报警|诈骗|事故|生病|医院|疼痛|抑郁|焦虑|绝望|失业|分手|危险|违法|犯罪|急救)/u;
const CASUAL_TOPIC = /(哈哈|嘿嘿|开心|高兴|好耶|喜欢|可爱|好看|晚安|早安|回来|下班|吃饭|睡觉|玩|谢谢|想你|在吗|聊聊|照片|图片|表情|颜文字)/u;
const EXPRESSION_PATTERN = /\p{Extended_Pictographic}|[（(][^（）()\n]{1,16}[）)]|嗯哼～/u;
const ACKNOWLEDGEMENT_INPUT = /^(好吧|好的?|嗯+|哦+|噢+|行吧?|可以|收到|知道了|谢谢|谢了|晚安|早安|哈哈+|呵呵+)[。！？!?～~…]*$/u;
const CONCISE_INPUT = /(简单|简短|简要|一句话|概括|不用展开|不要展开|别太详细)/u;
const DETAILED_INPUT = /(详细|展开说|展开讲|深入|分析|解释一下|为什么|怎么做|如何|步骤|教程|方案|代码|列出|对比|总结|介绍|原理|完整|具体说明)/u;
const NARRATIVE_INPUT = /(?:讲讲|说说|聊聊).{0,12}(?:故事|经历|小时候|过去|以前)/u;

function buildTurnDeliveryPrompt(inputCount = 1) {
  const turnInstruction = inputCount > 1
    ? `本轮用户连续发送了 ${inputCount} 条消息。先在心里逐条确认其中的事实、情绪、问题和请求，再组织一份统一回复；可以合并相关内容，但不能漏掉其中任何一个需要回应的重点。不要机械地按序号逐条复述，只有存在自然转折时才拆成多个气泡。`
    : "本轮用户只发送了一条消息。回复使用一个或两个气泡：通常一句自然地答完；确有即时反应和后续正文时才拆成两句，不能机械拆句。";

  return [
    "聊天气泡数量与用户输入条数无关。多条输入可以综合成一条，单条输入也可以自然地回两条。",
    turnInstruction,
    "轻松闲聊中可以偶尔自然带出一个简短语气词；emoji 或颜文字只是极少数场景下的可选项，不需要定期出现。严肃、求助、知识解释和拒绝场景不要添加。",
    "不要为了制造松弛感而降低信息质量，不要把一个完整句子从中间切开，也不要每条消息都以问题结尾。",
    "节奏示例：用户单条说“终于下班了”，可以输出 {\"messages\":[\"终于下班啦。\",\"今天辛苦了，先歇一会儿吧 (´▽｀)\"]}。用户连续说“今天出去玩了”“但是突然下雨”，可以只输出 {\"messages\":[\"这也太扫兴了……你没淋湿吧？\"]}。示例只说明节奏，不要照抄措辞。",
  ].join("\n");
}

function getAdaptiveReplyConstraints(currentInput, inputCount = 1) {
  const text = String(currentInput || "").trim();
  if (Number(inputCount) === 1 && ACKNOWLEDGEMENT_INPUT.test(text)) {
    return { maxBubbles: 1, maxTotalCharacters: 24, style: "acknowledgement" };
  }
  if (Number(inputCount) === 1 && CONCISE_INPUT.test(text)) {
    return { maxBubbles: 2, maxTotalCharacters: 100, style: "concise" };
  }
  if (DETAILED_INPUT.test(text)) {
    return { maxBubbles: Number(inputCount) === 1 ? 2 : DEFAULT_MAX_BUBBLES, maxTotalCharacters: 0, style: "detailed" };
  }
  if (NARRATIVE_INPUT.test(text)) {
    return { maxBubbles: Number(inputCount) === 1 ? 2 : DEFAULT_MAX_BUBBLES, maxTotalCharacters: 240, style: "narrative" };
  }
  if (Number(inputCount) > 1) {
    return { maxBubbles: 2, maxTotalCharacters: 0, style: "batched" };
  }
  if (text.length <= 12) {
    return { maxBubbles: 2, maxTotalCharacters: 48, style: "short" };
  }
  if (text.length <= 30) {
    return { maxBubbles: 2, maxTotalCharacters: 80, style: "normal" };
  }
  if (text.length <= 60) {
    return { maxBubbles: 2, maxTotalCharacters: 180, style: "normal" };
  }
  return {
    maxBubbles: Number(inputCount) === 1 ? 2 : DEFAULT_MAX_BUBBLES,
    maxTotalCharacters: 0,
    style: "open",
  };
}

function buildReplyLengthPrompt(constraints) {
  if (constraints.style === "acknowledgement") {
    return "用户只是简短确认、应答或收尾。只回复一个很短的聊天气泡，通常一句话即可；不要分析用户为什么这样说，不要延伸新话题，不要讲角色世界观。";
  }
  if (constraints.style === "detailed") {
    return "用户明确需要解释、分析或操作细节。可以按实际需要充分回答，不必为了简短而省略关键内容。";
  }
  if (constraints.style === "concise") {
    return "用户明确要求简单、简短或不要展开。直接给出核心答案，通常一个气泡，必要时最多两个，总长度控制在约 100 个汉字以内。";
  }
  if (constraints.style === "narrative") {
    return "用户在邀请你讲故事或个人经历。可以自然展开两三段，但要围绕所问内容，不要借题堆砌无关设定。";
  }
  if (constraints.style === "short") {
    return "用户发来的是很短的日常消息或追问。先直接回应，通常一至两句、一个或两个气泡，总长度不超过约 48 个汉字；不要分析语气，不要自行扩写背景故事。";
  }
  if (constraints.style === "batched") {
    return "用户连续发送了多条内容。合并理解后集中回应，通常一个气泡，确有自然转折时最多两个；不要按输入条数逐项复述。完整覆盖所有重点比强行压缩字数更重要，绝不能把答案截在半句。";
  }
  return "根据问题本身决定长度。日常对话保持简洁，只有信息量确实较大时才展开。";
}

function truncateAtNaturalBoundary(value, maxCharacters) {
  const text = String(value || "").trim();
  if (!maxCharacters || text.length <= maxCharacters) return text;
  const prefix = text.slice(0, maxCharacters);
  const boundaries = ["。", "！", "？", "!", "?", "…"];
  const boundaryIndex = Math.max(...boundaries.map((item) => prefix.lastIndexOf(item)));
  if (boundaryIndex >= Math.floor(maxCharacters * 0.5)) {
    return prefix.slice(0, boundaryIndex + 1).trim();
  }
  return `${prefix.trimEnd()}…`;
}

function applyReplyConstraints(replies, constraints) {
  const maxBubbles = Math.max(1, Number(constraints?.maxBubbles) || DEFAULT_MAX_BUBBLES);
  const maxTotalCharacters = Math.max(0, Number(constraints?.maxTotalCharacters) || 0);
  const bubbles = (Array.isArray(replies) ? replies : [replies])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, maxBubbles);
  if (!maxTotalCharacters) return bubbles;

  const constrained = [];
  let usedCharacters = 0;
  for (const bubble of bubbles) {
    if (constrained.length > 0 && usedCharacters + bubble.length > maxTotalCharacters) break;
    constrained.push(bubble);
    usedCharacters += bubble.length;
  }
  return constrained;
}

function isReplyOverlong(reply, constraints) {
  const maxTotalCharacters = Math.max(0, Number(constraints?.maxTotalCharacters) || 0);
  return maxTotalCharacters > 0 && String(reply || "").length > maxTotalCharacters;
}

function splitNaturalReaction(text, maxBubbles = DEFAULT_MAX_BUBBLES) {
  const value = String(text || "").trim();
  if (!value || maxBubbles < 2) return value ? [value] : [];

  const paragraphs = value
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length >= 2 && paragraphs.length <= maxBubbles) return paragraphs;

  const match = value.match(/^(.{1,32}?[。！？!?])\s*(.{5,})$/su);
  if (!match) return [value];
  const naturalTwoBeatReply = REACTION_PREFIX.test(match[1])
    || (value.length >= 34 && match[1].length <= 32);
  if (!naturalTwoBeatReply) return [value];
  return [match[1].trim(), match[2].trim()].slice(0, maxBubbles);
}

function isCasualInput(value) {
  const text = String(value || "").trim();
  if (!text || SERIOUS_TOPIC.test(text)) return false;
  if (CASUAL_TOPIC.test(text)) return true;
  return text.length <= 14 && !/[?？]/u.test(text);
}

function maybeAddCasualExpression(replies, {
  currentInput = "",
  chance = DEFAULT_EXPRESSION_CHANCE,
  random = Math.random,
} = {}) {
  const bubbles = replies.map((item) => String(item || "").trim()).filter(Boolean);
  const normalizedChance = Math.min(1, Math.max(0, Number(chance) || 0));
  if (
    bubbles.length === 0
    || !isCasualInput(currentInput)
    || bubbles.some((item) => EXPRESSION_PATTERN.test(item))
    || normalizedChance === 0
    || random() >= normalizedChance
  ) {
    return bubbles;
  }

  const expression = CASUAL_EXPRESSIONS[Math.floor(random() * CASUAL_EXPRESSIONS.length)]
    || CASUAL_EXPRESSIONS[0];
  let targetIndex = bubbles.length - 1;
  if (bubbles.length > 1 && bubbles[0].length <= 12) targetIndex = 0;
  if (bubbles[targetIndex].length > 80) return bubbles;

  bubbles[targetIndex] = `${bubbles[targetIndex]} ${expression}`;
  return bubbles;
}

function shapeReplyBubbles(replies, {
  inputCount = 1,
  maxBubbles = DEFAULT_MAX_BUBBLES,
  naturalSplit = true,
  currentInput = "",
  expressionChance = DEFAULT_EXPRESSION_CHANCE,
  recentReplies = [],
  expressionMaxGap = 5,
  random = Math.random,
} = {}) {
  const limit = Math.max(1, Math.min(DEFAULT_MAX_BUBBLES, Number(maxBubbles) || 1));
  let bubbles = (Array.isArray(replies) ? replies : [replies])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, limit);

  if (naturalSplit && Number(inputCount) === 1 && bubbles.length === 1) {
    bubbles = splitNaturalReaction(bubbles[0], limit);
  }

  return maybeAddCasualExpression(bubbles, {
    currentInput,
    chance: expressionChance,
    recentReplies,
    maxGap: expressionMaxGap,
    random,
  }).slice(0, limit);
}

module.exports = {
  applyReplyConstraints,
  buildReplyLengthPrompt,
  buildTurnDeliveryPrompt,
  getAdaptiveReplyConstraints,
  isCasualInput,
  isReplyOverlong,
  maybeAddCasualExpression,
  shapeReplyBubbles,
  splitNaturalReaction,
};
