const assert = require("node:assert/strict");
const path = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { AIConversationService } = require("./AIConversationService");
const { AIInputService } = require("./AIInputService");
const { ChatDatabase } = require("./ChatDatabase");
const { createQwenClient } = require("./QwenService");
const { CONFIG_PATH } = require("./RuntimePaths");

const Config = require(CONFIG_PATH);
const ROLEPLAY_OVERLOAD = /(诱巫饵铃|魔女情报|狩灾誓锤|风元素|提瓦特|记进笔记|根据我的调查)/u;
const FORCED_ROLEPLAY_ANALOGY = /像我.{0,12}(?:检查账目|调查|笔记)/u;
const CALCULATED_AFFECTION = /(?:观察|分析|回应).{0,18}(?:没跑偏|正确|准确)|交流频率|频率.{0,8}(?:合拍|一致)/u;
const FORCED_TSUNDERE = /(我[、，]?我才没有|才不是.{0,10}(?:担心|关心|害羞)|别误会.{0,12}(?:担心|关心|喜欢)|友好.{0,6}(?:档案|记录))/u;
const STAGE_ACTION = /[*＊][^*＊\n]+[*＊]|[（(](?:轻轻|缓缓|抬头|低头|脸红|叹气|看着|笑)[^）)\n]*[）)]/u;

function createContext({ id, content }) {
  return {
    scene: "c2c",
    eventType: "C2C_MESSAGE_CREATE",
    payload: {
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: { id, content, author: { user_openid: "live-eval-user" } },
    },
    message: { id, content, author: { user_openid: "live-eval-user" } },
  };
}

function validateResult(scenario, result) {
  assert.ok(result.generated, `${scenario.name}：模型没有成功生成回复`);
  assert.ok(result.reply.trim(), `${scenario.name}：回复为空`);
  assert.ok(result.replies.length >= 1, `${scenario.name}：没有可发送气泡`);
  assert.ok(
    result.replies.length <= scenario.maxBubbles,
    `${scenario.name}：气泡数量超过 ${scenario.maxBubbles}`,
  );
  assert.doesNotMatch(result.reply, STAGE_ACTION, `${scenario.name}：出现舞台动作`);
  if (!scenario.roleplayTopic) {
    assert.doesNotMatch(result.reply, ROLEPLAY_OVERLOAD, `${scenario.name}：普通话题人设过载`);
    assert.doesNotMatch(result.reply, FORCED_ROLEPLAY_ANALOGY, `${scenario.name}：出现刻意角色类比`);
    assert.doesNotMatch(result.reply, FORCED_TSUNDERE, `${scenario.name}：出现模板化傲娇表演`);
  }
  if (scenario.affection) {
    assert.doesNotMatch(result.reply, CALCULATED_AFFECTION, `${scenario.name}：亲近表达过于计算式`);
    assert.doesNotMatch(result.reply, /刚才这句没组织好/u, `${scenario.name}：退化为质量兜底句`);
  }
}

async function main() {
  const directory = mkdtempSync(path.join(tmpdir(), "qqbot-live-eval-"));
  const database = new ChatDatabase(path.join(directory, "eval.sqlite"));
  const usage = [];
  const qwenClient = createQwenClient({ onUsage: (record) => usage.push(record) });
  const inputService = new AIInputService({ config: Config, qwenClient });
  const service = new AIConversationService({
    config: Config,
    database,
    qwenClient,
    inputService,
  });

  const scenarios = [
    {
      name: "连续三条输入",
      maxBubbles: 3,
      contexts: [
        createContext({ id: "batch-1", content: "我今天第一次去学滑冰" }),
        createContext({ id: "batch-2", content: "摔了好几次，有点丢脸" }),
        createContext({ id: "batch-3", content: "不过最后能自己滑一小段了。你觉得我还要继续吗？" }),
      ],
    },
    {
      name: "单条轻松聊天",
      maxBubbles: 2,
      contexts: [createContext({ id: "single-casual", content: "今天终于下班了" })],
    },
    {
      name: "单条知识问答",
      maxBubbles: 2,
      contexts: [createContext({ id: "single-fact", content: "简单告诉我为什么天空通常是蓝色的？" })],
    },
    {
      name: "单条亲近表达",
      maxBubbles: 2,
      affection: true,
      contexts: [createContext({
        id: "single-affection",
        content: "我有点喜欢你，不过只是觉得和你聊天很舒服",
      })],
    },
    {
      name: "冷知识与轻微得意",
      maxBubbles: 2,
      contexts: [createContext({
        id: "style-fact",
        content: "讲一个靠谱但不常见的生活冷知识，别太长。",
      })],
    },
    {
      name: "理性包装关心",
      maxBubbles: 2,
      contexts: [createContext({
        id: "style-care",
        content: "我已经很困了，但还想熬夜把报告做完。",
      })],
    },
    {
      name: "承认再坚持立场",
      maxBubbles: 2,
      contexts: [createContext({
        id: "style-disagreement",
        content: "做事凭感觉就够了，想那么多只会拖慢速度。",
      })],
    },
    {
      name: "低落天气闲聊",
      maxBubbles: 2,
      contexts: [createContext({
        id: "style-rain",
        content: "窗外一直下雨，我的心情也有点低落。",
      })],
    },
  ];

  try {
    const scenarioFilter = String(process.argv[2] || "").trim();
    const selectedScenarios = scenarioFilter
      ? scenarios.filter((scenario) => scenario.name.includes(scenarioFilter))
      : scenarios;
    assert.ok(selectedScenarios.length > 0, `没有找到场景：${scenarioFilter}`);
    const results = [];
    for (const scenario of selectedScenarios) {
      const latest = scenario.contexts.at(-1);
      const context = scenario.contexts.length > 1
        ? { ...latest, batchContexts: scenario.contexts }
        : latest;
      const result = await service.generateReply(context);
      validateResult(scenario, result);
      results.push({
        scenario: scenario.name,
        input: scenario.contexts.map((item) => item.message.content),
        replies: result.replies,
      });
    }

    const totals = usage.reduce((sum, record) => ({
      requests: sum.requests + 1,
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      totalTokens: sum.totalTokens + record.totalTokens,
    }), { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    console.log(JSON.stringify({ results, usage: totals }, null, 2));
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`真实模型回归失败：${error.message}`);
    process.exitCode = 1;
  });
}
