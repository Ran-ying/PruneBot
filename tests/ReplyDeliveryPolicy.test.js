const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyReplyConstraints,
  buildReplyLengthPrompt,
  buildTurnDeliveryPrompt,
  getAdaptiveReplyConstraints,
  isReplyOverlong,
  maybeAddCasualExpression,
  shapeReplyBubbles,
  splitNaturalReaction,
} = require("../src/ReplyDeliveryPolicy");

test("回复长度根据用户消息复杂度自适应", () => {
  const acknowledgement = getAdaptiveReplyConstraints("好吧", 1);
  assert.deepEqual(acknowledgement, {
    maxBubbles: 1,
    maxTotalCharacters: 24,
    style: "acknowledgement",
  });
  assert.match(buildReplyLengthPrompt(acknowledgement), /不要延伸新话题/);

  const shortQuestion = getAdaptiveReplyConstraints("啥意思呢", 1);
  assert.equal(shortQuestion.maxTotalCharacters, 48);
  assert.equal(isReplyOverlong("很长的话。".repeat(20), shortQuestion), true);
  assert.equal(getAdaptiveReplyConstraints("请详细分析这段代码", 1).maxTotalCharacters, 0);
  assert.deepEqual(getAdaptiveReplyConstraints("简单告诉我为什么天空是蓝色的", 1), {
    maxBubbles: 2,
    maxTotalCharacters: 100,
    style: "concise",
  });
  assert.deepEqual(getAdaptiveReplyConstraints("讲讲小时候的故事", 1), {
    maxBubbles: 2,
    maxTotalCharacters: 240,
    style: "narrative",
  });

  const constrained = applyReplyConstraints([
    "嗯，我记下了。",
    "这是本来不应该继续展开的一大段额外分析。",
  ], acknowledgement);
  assert.deepEqual(constrained, ["嗯，我记下了。"]);
});

test("单条输入的短反应和正文可以拆成自然气泡", () => {
  assert.deepEqual(
    splitNaturalReaction("欸？原来是临时改时间了，那就说得通了。"),
    ["欸？", "原来是临时改时间了，那就说得通了。"],
  );
  assert.deepEqual(
    splitNaturalReaction("这个问题需要先核对输入，再分别检查数据库和接口状态。"),
    ["这个问题需要先核对输入，再分别检查数据库和接口状态。"],
  );
  assert.deepEqual(
    splitNaturalReaction("我指的是换一种更容易说明白的方式。比如画图，或者直接告诉我你没听懂哪一句。"),
    ["我指的是换一种更容易说明白的方式。", "比如画图，或者直接告诉我你没听懂哪一句。"],
  );
});

test("多条输入不会因为句号被机械拆成多条回复", () => {
  assert.deepEqual(shapeReplyBubbles(
    ["嗯，原来是这样。那你先别着急，我们把后面那件事说清楚。"],
    {
      inputCount: 2,
      currentInput: "第一条\n第二条",
      expressionChance: 0,
    },
  ), ["嗯，原来是这样。那你先别着急，我们把后面那件事说清楚。"]);
  assert.match(buildTurnDeliveryPrompt(2), /统一回复/);
  assert.equal(getAdaptiveReplyConstraints("第一件事\n第二件事", 2).maxTotalCharacters, 0);
});

test("轻松聊天偶尔添加一个颜文字，严肃消息不添加", () => {
  const relaxed = maybeAddCasualExpression(["终于下班啦。"], {
    currentInput: "我下班啦",
    chance: 1,
    random: () => 0,
  });
  assert.deepEqual(relaxed, ["终于下班啦。 (´▽｀)"]);

  const serious = maybeAddCasualExpression(["先联系急救人员。"], {
    currentInput: "有人受伤了，需要急救",
    chance: 1,
    random: () => 0,
  });
  assert.deepEqual(serious, ["先联系急救人员。"]);

  const notForced = maybeAddCasualExpression(["今天也可以聊一会儿。"], {
    currentInput: "陪我聊聊",
    chance: 0,
    recentReplies: ["一", "二", "三", "四", "五"],
    maxGap: 5,
    random: () => 0,
  });
  assert.deepEqual(notForced, ["今天也可以聊一会儿。"]);
});

test("单条输入最多两个气泡，多条输入提示必须覆盖全部重点", () => {
  assert.equal(getAdaptiveReplyConstraints("请完整解释这个很长的问题", 1).maxBubbles, 2);
  assert.equal(getAdaptiveReplyConstraints("第一件事\n第二件事", 2).maxBubbles, 2);
  assert.match(buildTurnDeliveryPrompt(3), /不能漏掉其中任何一个/);
});
