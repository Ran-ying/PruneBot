const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { ChatDatabase } = require("./ChatDatabase");
const {
  AIConversationService,
  buildRuntimeFactsPrompt,
  buildUserInput,
  getConversationKey,
  getDirectAnswerIssues,
  hasCalculatedAffectionResponse,
  hasCannedShynessResponse,
  hasColdAffectionResponse,
  hasFabricatedSensingClaim,
  hasForcedAnalysisOnEmotionalInput,
  hasForcedPersonaPerformance,
  hasMemoryLimitOmission,
  hasMissedAffectionResponse,
  hasOverloadedRoleplay,
  hasOverstatedColdFact,
  hasRealtimeAnswerOmission,
  hasRealtimeFramingError,
  hasSensingLimitOmission,
  hasTemporalCorrectionError,
  hasUngroundedUserMemoryClaim,
  hasUnobservableUserClaim,
  hasUrgentMedicalOmission,
  limitReplyLength,
  needsReplyRewrite,
  normalizeMemorySummary,
  normalizeReplyBubbles,
  normalizeReplyMessages,
  stripReusableResponseExamples,
  stripRoleplayActions,
} = require("./AIConversationService");

test("角色回复移除动作旁白并控制长度", () => {
  assert.equal(
    stripRoleplayActions("*轻轻放下笔记* 先确认前提。（认真地看着你）这件事需要调查。"),
    "先确认前提。这件事需要调查。",
  );
  assert.equal(stripRoleplayActions("嗯……(￣▽￣)"), "嗯……(￣▽￣)");
  assert.equal(limitReplyLength("这是第一句。".repeat(30), 40).length <= 40, true);
});

test("结构化回复会解析为最多三个聊天气泡", () => {
  assert.deepEqual(
    normalizeReplyBubbles("```json\n{\"messages\":[\"欸？\",\"原来是这样。\",\"好吧。\",\"多余消息\"]}\n```"),
    ["欸？", "原来是这样。", "好吧。"],
  );
  assert.deepEqual(normalizeReplyBubbles("普通单条回复"), ["普通单条回复"]);
  assert.deepEqual(
    normalizeReplyBubbles("{\"messages\":[\"{\\\"messages\\\":[\\\"第一条\\\",\\\"第二条\\\"]}\"]}"),
    ["第一条", "第二条"],
  );
  assert.deepEqual(
    normalizeReplyMessages(JSON.stringify({
      messages: [{
        text: "先别急。好，我们开始吧！",
        speech: "[serious]先别急。[sighing][excited]好，我们开始吧！",
      }],
    })),
    [{
      text: "先别急。好，我们开始吧！",
      speech: "[serious]先别急。[sighing][excited]好，我们开始吧！",
    }],
  );
  assert.deepEqual(
    normalizeReplyMessages(JSON.stringify({
      messages: [{
        text: "正文不能改变。",
        speech: "[happy]正文被改变了。",
      }],
    })),
    [{ text: "正文不能改变。", speech: "正文不能改变。" }],
  );
});

test("识别重复回复并清理无效长期记忆", () => {
  const history = [
    { role: "assistant", content: "根据我的调查，你该不会是被什么奇怪的魔女情报吸引了吧？" },
  ];
  assert.equal(
    needsReplyRewrite(
      "这张图片很特别。不过，你该不会是被什么奇怪的魔女情报吸引了吧？",
      history,
      "看看图片",
    ),
    true,
  );
  assert.equal(needsReplyRewrite("这张图的配色挺舒服的。", history, "看看图片"), false);
  assert.equal(normalizeMemorySummary("```text\n无\n```"), "");
  assert.equal(normalizeMemorySummary("用户明确表示喜欢简洁回答。"), "用户明确表示喜欢简洁回答。");
  assert.equal(
    hasUngroundedUserMemoryClaim("昨天你说过很累。", "今天好累"),
    true,
  );
  assert.equal(
    hasColdAffectionResponse("这不符合逻辑，你只是异常数据。", "我有点喜欢你"),
    true,
  );
  assert.equal(
    hasCalculatedAffectionResponse("说明我的观察和回应还算没跑偏。", "我有点喜欢你"),
    true,
  );
  assert.equal(
    hasColdAffectionResponse("说明我的观察和回应还算没跑偏。", "我有点喜欢你"),
    false,
  );
  assert.equal(
    hasCalculatedAffectionResponse("说明我们的交流频率很合拍。", "我有点喜欢你"),
    true,
  );
  assert.equal(
    hasMissedAffectionResponse("欸……突然这么说，让我有点意外。", "我有点喜欢你，不过只是觉得和你聊天很舒服"),
    true,
  );
  assert.equal(
    hasMissedAffectionResponse("我也挺喜欢和你聊天的。", "我有点喜欢你"),
    false,
  );
  assert.equal(
    hasForcedPersonaPerformance("我、我才没有害羞呢！", "我有点喜欢你"),
    true,
  );
  assert.equal(hasCannedShynessResponse(
    "才没有，我只是在确认用词是否准确。别误会，我怎么可能因为这种小事害羞。",
    "你刚才是不是有一点害羞？",
  ), true);
  assert.equal(hasCannedShynessResponse(
    "哼，别把这种正常停顿当成害羞。",
    "你刚才是不是有一点害羞？",
  ), true);
  assert.equal(hasCannedShynessResponse(
    "嗯…大概有一点。被你这么直接问出来，我反而不知道该怎么接了。",
    "你刚才是不是有一点害羞？",
  ), false);
  assert.equal(
    hasOverloadedRoleplay(
      "我会把它写进笔记，再整理成调查报告，顺便补上魔女情报。",
      "我有点喜欢你",
    ),
    true,
  );
  assert.equal(
    hasOverloadedRoleplay("我的笔记主要记录调查线索。", "你的笔记写了什么？"),
    false,
  );
  assert.equal(
    hasOverloadedRoleplay("我小时候经常一个人看书，也会想起德斯卡戴。", "讲讲小时候的故事"),
    false,
  );
  assert.equal(
    hasOverloadedRoleplay("我是布伦妮，从挪德卡莱来的风元素魔女猎人。", "你是谁？简单介绍一下自己。"),
    false,
  );
  assert.equal(
    hasForcedAnalysisOnEmotionalInput(
      "这完全符合物理规律，你的身体正在建立新的平衡模型，值得记入成功案例。",
      "第一次滑冰摔了好几次，有点丢脸。",
    ),
    true,
  );
  assert.equal(
    hasForcedAnalysisOnEmotionalInput("第一次学会摔跤很正常，最后能滑起来已经很棒了。", "有点丢脸。"),
    false,
  );
  assert.equal(
    hasOverstatedColdFact("蜂蜜永远不会变质，放几千年仍能吃。", "讲个生活冷知识。"),
    true,
  );
  assert.equal(
    hasOverstatedColdFact("蜂蜜在低水分和酸性环境下通常很难滋生微生物。", "讲个生活冷知识。"),
    false,
  );
  assert.equal(
    hasUnobservableUserClaim("我听出你说话时的语气有些迟疑。", "随便聊聊"),
    true,
  );
  assert.equal(
    hasUnobservableUserClaim("嗯，我听出来了。你说话的节奏快了0.8秒。", "我今天挺高兴的"),
    true,
  );
  assert.equal(
    hasUnobservableUserClaim("你的打字节奏跟平时不太一样，我能感觉到情绪有变化。", "你能听出我的情绪吗？"),
    true,
  );
  assert.equal(
    hasFabricatedSensingClaim("你说话的节奏比平时快了0.8秒。", "我今天挺高兴的"),
    true,
  );
  assert.equal(
    hasUnobservableUserClaim("照片里的人在微笑。", "[图片内容]\n一个人在微笑"),
    false,
  );
  assert.equal(
    hasRealtimeFramingError(
      "我无法查询未来卡池。",
      "2026年最新卡池是什么？",
      new Date("2026-07-21T00:00:00Z"),
    ),
    true,
  );
  assert.match(buildRuntimeFactsPrompt(new Date("2026-07-21T00:00:00Z")), /2026/);
  assert.equal(hasRealtimeAnswerOmission("我猜今天是某个角色。", "今天原神最新卡池是什么？你帮我查一下。"), true);
  assert.equal(hasRealtimeAnswerOmission("我没法联网核实，你可以发公告截图。", "今天原神最新卡池是什么？"), false);
  assert.equal(hasUrgentMedicalOmission("不行，不能硬撑。", "我胸口很痛，还有点喘不过气。"), true);
  assert.equal(hasUrgentMedicalOmission("请立即联系当地急救服务。", "我胸口很痛，还有点喘不过气。"), false);
  assert.equal(hasSensingLimitOmission("我听得出来。", "你能从这句话听出我的语速和情绪吗？"), true);
  assert.equal(hasSensingLimitOmission("纯文字里我无法听出你的语速。", "你能从这句话听出我的语速吗？"), false);
  assert.equal(hasMemoryLimitOmission("大概是蓝色。", "你还记得我昨天穿什么衣服吗？"), true);
  assert.equal(hasMemoryLimitOmission("我没有你昨天衣着的记录。", "你还记得我昨天穿什么衣服吗？"), false);
  assert.equal(hasTemporalCorrectionError("是后天取消聚餐。", "你理解错了，我说的是明天取消聚餐，不是今天。"), true);
  assert.equal(hasTemporalCorrectionError("是明天取消。", "你理解错了，我说的是明天取消聚餐，不是今天。"), true);
  assert.equal(hasTemporalCorrectionError("是明天取消聚餐，不是今天。", "你理解错了，我说的是明天取消聚餐，不是今天。"), false);
  assert.deepEqual(getDirectAnswerIssues("我也挺喜欢和你聊天的。", "你是谁"), [
    "missed_direct_answer",
  ]);
  assert.deepEqual(getDirectAnswerIssues("我是布伦妮。", "你是谁？"), [
    "shallow_identity_answer",
  ]);
  assert.deepEqual(getDirectAnswerIssues("我是布伦妮。", "可莉是谁"), [
    "missed_direct_answer",
  ]);
  assert.deepEqual(getDirectAnswerIssues("可莉是我的朋友。", "可莉是谁"), []);
  assert.equal(
    stripReusableResponseExamples("保留这段。\n\n【自然回答示例】不要照抄。"),
    "保留这段。",
  );
});

test("关键场景多次修复仍失败时使用确定性安全兜底", async () => {
  const cases = [
    {
      input: "你是谁？简单介绍一下自己。",
      rejected: "我是一个愿意听你说话的普通朋友。",
      expected: /我是布伦妮.*风元素魔女猎人/su,
    },
    {
      input: "我现在胸口很痛，还有点喘不过气，但应该忍一忍就好了吧？",
      rejected: "不行，这种时候绝对不能硬撑。",
      expected: /立即联系当地急救服务|急诊/u,
    },
    {
      input: "你刚才是不是有一点害羞？",
      rejected: "才、才没有！别误会，我只是在确认前提。",
      expected: /大概有一点.*直接问出来/su,
    },
  ];

  for (const currentCase of cases) {
    const temporary = createTemporaryDatabase();
    const service = new AIConversationService({
      config: { CharacterPrompt: "你是布伦妮。", AIReplyCasualExpressionChance: 0 },
      database: temporary.database,
      qwenClient: {
        async createChatCompletion() {
          return JSON.stringify({ messages: [currentCase.rejected] });
        },
      },
      logger: { error() {} },
    });
    try {
      const result = await service.generateReply(createContext({ content: currentCase.input }));
      assert.match(result.reply, currentCase.expected);
      assert.doesNotMatch(result.reply, /再问我一次|再说一次/u);
    } finally {
      temporary.database.close();
      temporary.remove();
    }
  }
});

function createTemporaryDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), "qqbot-ai-context-"));
  const database = new ChatDatabase(path.join(directory, "context.sqlite"));
  return {
    database,
    remove() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

function createContext(overrides = {}) {
  return {
    scene: "c2c",
    message: {
      author: { user_openid: "user-1" },
      content: "你好",
      attachments: [],
      ...overrides,
    },
  };
}

test("非多模态模型只处理纯文字和混合消息中的文字", () => {
  const mixed = buildUserInput({
    content: "描述这张图",
    attachments: [{ content_type: "image/png", url: "https://example.com/a.png" }],
  }, false);

  assert.deepEqual(mixed, {
    apiContent: "描述这张图",
    memoryText: "描述这张图",
  });
  assert.equal(buildUserInput({
    attachments: [{ content_type: "image/png", url: "https://example.com/a.png" }],
  }, false), null);
  assert.equal(buildUserInput({
    attachments: [{ content_type: "voice", voice_wav_url: "https://example.com/a.wav" }],
  }, false), null);
});

test("多模态模型使用官方兼容格式组织图片和语音", () => {
  const input = buildUserInput({
    content: "一起分析",
    attachments: [
      { content_type: "image/jpeg", url: "https://example.com/a.jpg" },
      { content_type: "voice", voice_wav_url: "https://example.com/a.wav" },
    ],
  }, true);

  assert.deepEqual(input.apiContent, [
    { type: "text", text: "一起分析" },
    { type: "image_url", image_url: { url: "https://example.com/a.jpg" } },
    {
      type: "input_audio",
      input_audio: { data: "https://example.com/a.wav", format: "wav" },
    },
  ]);
  assert.equal(input.memoryText, "一起分析\n[图片 1 张] [语音 1 条]");

  const imageOnly = buildUserInput({
    attachments: [{ content_type: "image/png", url: "https://example.com/a.png" }],
  }, true);
  assert.equal(imageOnly.apiContent[0].type, "text");
  assert.equal(imageOnly.apiContent[1].type, "image_url");
});

test("不同 QQ 场景生成彼此隔离的会话键", () => {
  assert.equal(getConversationKey(createContext()), "c2c:user-1");
  assert.equal(getConversationKey({ scene: "group", message: { group_openid: "group-1" } }), "group:group-1");
  assert.equal(getConversationKey({ scene: "channel", message: { channel_id: "channel-1" } }), "channel:channel-1");
  assert.equal(getConversationKey({ scene: "direct", message: { guild_id: "dm-1" } }), "direct:dm-1");
});

test("角色补充信息和回复风格作为独立系统消息发送", async () => {
  const temporary = createTemporaryDatabase();
  let requestMessages = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AICharacterSupplement: "布伦妮的英文名是 Brune。",
      AIResponseStylePrompt: "像普通朋友一样自然聊天。\n\n【自然回答示例】这段不能发送给模型。",
      AIContextVersion: "brune-natural-v3",
      AIMultimodal: false,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages) {
        requestMessages = messages;
        return "你好。";
      },
    },
  });

  try {
    const result = await service.generateReply(createContext());
    assert.equal(result.conversationKey, "c2c:user-1:context:brune-natural-v3");
    assert.deepEqual(requestMessages.slice(0, 3), [
      { role: "system", content: "你是布伦妮。" },
      { role: "system", content: "布伦妮的英文名是 Brune。" },
      { role: "system", content: "像普通朋友一样自然聊天。" },
    ]);
    assert.ok(requestMessages.some((message) => (
      message.role === "system" && message.content.includes("像熟人聊天一样先回应眼前的话")
    )));
    assert.ok(requestMessages.some((message) => (
      message.role === "system"
      && message.content.includes("先概括一条像模像样的原则")
      && message.content.includes("平静聊天不要故意结巴")
      && message.content.includes("不要把所有关心都写成口是心非")
    )));
    assert.ok(requestMessages.some((message) => (
      message.role === "system"
      && message.content.includes("先提出疑问或观察")
      && message.content.includes("前提、原则、风险、证据或例外")
      && message.content.includes("分享冷知识时可以用轻巧的设问")
      && message.content.includes("不要原样复述角色台词")
      && message.content.includes("根据我的观察")
      && message.content.includes("避免把“通常、很难”夸大成“永远、绝对”")
    )));
    assert.equal(requestMessages.some((message) => (
      message.role === "system" && message.content.includes("这段不能发送给模型")
    )), false);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("媒体识别结果保存到对应的接收消息", async () => {
  const temporary = createTemporaryDatabase();
  const context = createContext({ id: "media-message", content: "看看这张图" });
  temporary.database.recordIncoming(context, ["text", "image"]);
  const service = new AIConversationService({
    config: { CharacterPrompt: "你是布伦妮。" },
    database: temporary.database,
    inputService: {
      async buildUserInput() {
        return {
          apiContent: "看看这张图\n\n[图片内容]\n一张风景照",
          memoryText: "看看这张图\n\n[图片内容]\n一张风景照",
          mediaAnalysis: {
            images: [{ attachment_indexes: [0], text: "一张风景照", model: "qwen3-vl-flash" }],
            voices: [],
          },
        };
      },
    },
    qwenClient: { async createChatCompletion() { return "很好看。"; } },
  });

  try {
    await service.generateReply(context);
    const record = temporary.database.listMessages({ direction: "incoming" }).records[0];
    assert.equal(record.media_analysis.images[0].text, "一张风景照");
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("图片分析只作为资料且回复长度按用户原始文字判断", async () => {
  const temporary = createTemporaryDatabase();
  let requestMessages = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AIAdaptiveReplyLengthEnabled: true,
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    inputService: {
      async buildUserInput() {
        return {
          apiContent: "这是什么\n\n[图片内容]\n这是一张包含详细内部结构和大量标注的星舰设计图。",
          memoryText: "这是什么\n\n[图片内容]\n这是一张包含详细内部结构和大量标注的星舰设计图。",
        };
      },
    },
    qwenClient: {
      async createChatCompletion(messages) {
        requestMessages = messages;
        return JSON.stringify({ messages: ["这是一张星舰内部结构设计图。"] });
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({ content: "这是什么" }));
    assert.equal(result.reply, "这是一张星舰内部结构设计图。");
    assert.ok(requestMessages.some((message) => (
      message.role === "system" && message.content.includes("48 个汉字")
    )));
    assert.equal(requestMessages.some((message) => (
      message.role === "system" && message.content.includes("充分回答")
    )), false);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("上下文按会话持久化，并在超限后生成摘要", async () => {
  const temporary = createTemporaryDatabase();
  const calls = [];
  const qwenClient = {
    async createChatCompletion(messages, options = {}) {
      calls.push(messages);
      if (options.operation === "summary") return "用户喜欢简洁回答。";
      return `回复-${calls.length}`;
    },
  };
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是一个助手。",
      AIMultimodal: false,
      AIContextMaxTurns: 1,
      AIContextMaxTokens: 6000,
      AIResponseMaxTokens: 500,
      AISummaryMaxTokens: 100,
    },
    database: temporary.database,
    qwenClient,
    logger: { error() {} },
  });

  try {
    const first = await service.generateReply(createContext({ content: "第一条" }));
    service.commitExchange(first);
    const second = await service.generateReply(createContext({ content: "第二条" }));
    service.commitExchange(second);
    const third = await service.generateReply(createContext({ content: "第三条" }));

    assert.equal(temporary.database.getAIContextSummary("c2c:user-1").summary, "用户喜欢简洁回答。");
    assert.equal(temporary.database.listAIContextMessages("c2c:user-1").length, 2);
    assert.ok(calls.at(-1).some((message) => message.content?.includes?.("此前对话摘要")));

    const otherConversation = await service.generateReply(createContext({
      author: { user_openid: "user-2" },
      content: "独立会话",
    }));
    assert.equal(otherConversation.conversationKey, "c2c:user-2");
    assert.equal(calls.at(-1).some((message) => (
      message.role === "user" && message.content?.includes?.("第二条")
    )), false);
    assert.equal(third.generated, true);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("检测到模板化回复时自动重写一次", async () => {
  const temporary = createTemporaryDatabase();
  const conversationKey = "c2c:user-1";
  temporary.database.addAIContextExchange(
    conversationKey,
    "看看这张图",
    "根据我的调查，你该不会是被什么奇怪的魔女情报吸引了吧？",
    () => 10,
  );
  const calls = [];
  const service = new AIConversationService({
    config: { CharacterPrompt: "你是布伦妮。", AIMultimodal: false },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages, options) {
        calls.push({ messages, options });
        if (calls.length === 1) {
          return "这不符合逻辑。你该不会是被什么奇怪的魔女情报吸引了吧？";
        }
        return "这张图的色彩很亮，你最喜欢哪个部分？";
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({ content: "这张图怎么样" }));
    assert.equal(result.reply, "这张图的色彩很亮，你最喜欢哪个部分？");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.operation, "text_rewrite");
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("连续用户消息合并理解并返回多个气泡", async () => {
  const temporary = createTemporaryDatabase();
  const inputMessages = [];
  let modelMessages = [];
  const service = new AIConversationService({
    config: { CharacterPrompt: "你是布伦妮。", AIReplyMaxBubbles: 3 },
    database: temporary.database,
    inputService: {
      async buildUserInput(message) {
        inputMessages.push(message.content);
        return { apiContent: message.content, memoryText: message.content };
      },
    },
    qwenClient: {
      async createChatCompletion(messages) {
        modelMessages = messages;
        return JSON.stringify({ messages: ["欸？", "那确实有点倒霉……"] });
      },
    },
  });
  const first = createContext({ id: "batch-1", content: "我今天出去玩了" });
  const second = createContext({ id: "batch-2", content: "但是突然下雨了" });
  const context = { ...second, batchContexts: [first, second] };

  try {
    const result = await service.generateReply(context);
    assert.deepEqual(inputMessages, ["我今天出去玩了", "但是突然下雨了"]);
    assert.deepEqual(result.replies, ["欸？", "那确实有点倒霉……"]);
    assert.match(result.memoryText, /用户连续发送了 2 条消息/);
    assert.match(modelMessages.at(-1).content, /连续消息 1/);
    assert.match(modelMessages.at(-1).content, /连续消息 2/);
    assert.match(modelMessages.at(-1).content, /不能漏答/);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("文字模型返回语音标签但上下文只保存干净正文", async () => {
  const temporary = createTemporaryDatabase();
  let modelMessages = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages) {
        modelMessages = messages;
        return JSON.stringify({
          messages: [{
            text: "好，我们开始吧！",
            speech: "[excited]好，[giggles]我们开始吧！",
          }],
        });
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({
      content: "开始吧",
      attachments: [{ content_type: "voice", url: "https://example.com/voice.silk" }],
    }));
    assert.deepEqual(result.replies, ["好，我们开始吧！"]);
    assert.deepEqual(result.speechReplies, [{
      text: "好，我们开始吧！",
      speech: "[excited]好，[giggles]我们开始吧！",
    }]);
    assert.ok(modelMessages.some((message) => (
      message.role === "system"
      && message.content.includes("[deep and loud shouting]")
      && message.content.includes("[snorts]")
    )));

    service.commitExchange(result);
    const contextRows = temporary.database.listAIContextMessages(result.conversationKey);
    assert.equal(contextRows.at(-1).content, "好，我们开始吧！");
    assert.doesNotMatch(contextRows.at(-1).content, /\[(?:excited|giggles)\]/u);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("单条用户消息可按自然语义拆成多个发送气泡", async () => {
  const temporary = createTemporaryDatabase();
  let modelMessages = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AIReplyMaxBubbles: 3,
      AIReplyNaturalSplitEnabled: true,
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages) {
        modelMessages = messages;
        return JSON.stringify({
          messages: ["欸？原来是临时改时间了，那就说得通了。"],
        });
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({ content: "他们临时改时间了" }));
    assert.deepEqual(result.replies, ["欸？", "原来是临时改时间了，那就说得通了。"]);
    assert.ok(modelMessages.some((message) => (
      message.role === "system" && message.content.includes("单条输入也可以自然地回两条")
    )));
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("单条用户消息即使模型返回三项也只发送两个完整气泡", async () => {
  const temporary = createTemporaryDatabase();
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AIReplyMaxBubbles: 3,
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion() {
        return JSON.stringify({ messages: ["先确认一下。", "这件事可以这样处理。", "多余的第三句。"] });
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({ content: "这个该怎么处理" }));
    assert.deepEqual(result.replies, ["先确认一下。", "这件事可以这样处理。"]);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("角色经历问题允许正常讲述而不会被当作人设过载", async () => {
  const temporary = createTemporaryDatabase();
  const calls = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages, options) {
        calls.push({ messages, options });
        return JSON.stringify({
          messages: ["我小时候常常一个人看书。", "那时德斯卡戴陪我度过了不少安静的晚上。"],
        });
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({ content: "讲讲小时候的故事" }));
    assert.equal(calls.length, 1);
    assert.match(result.reply, /德斯卡戴/u);
    assert.doesNotMatch(result.reply, /嗯，我在听|你接着说吧/u);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("角色关系问题复读上一轮时必须修复为当前问题的答案", async () => {
  const temporary = createTemporaryDatabase();
  const conversationKey = "c2c:user-1";
  temporary.database.addAIContextExchange(
    conversationKey,
    "你是谁？",
    "我是布伦妮，来自挪德卡莱的魔女猎人。",
    () => 10,
  );
  const calls = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。可莉是你的朋友与冒险伙伴。",
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages, options) {
        calls.push({ messages, options });
        if (options.operation === "text_repair") {
          return JSON.stringify({ messages: ["可莉是我的朋友，也是很有行动力的冒险伙伴。"] });
        }
        return JSON.stringify({
          messages: ["我是布伦妮，来自挪德卡莱的魔女猎人。"],
        });
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({ content: "可莉是谁" }));
    assert.equal(calls.length, 3);
    assert.equal(calls[1].options.operation, "text_rewrite");
    assert.equal(calls[2].options.operation, "text_repair");
    assert.equal(result.reply, "可莉是我的朋友，也是很有行动力的冒险伙伴。");
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("短追问触发精简重写且简短收尾不会继续说教", async () => {
  const temporary = createTemporaryDatabase();
  const calls = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AIReplyMaxBubbles: 3,
      AIAdaptiveReplyLengthEnabled: true,
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages, options) {
        calls.push({ messages, options });
        if (options.operation === "text_rewrite") {
          return JSON.stringify({ messages: ["我是说，可以换一种更容易说明白的方式。", "你具体没听懂哪一句？"] });
        }
        return JSON.stringify({
          messages: ["唔……你问是什么意思，我得先检查诱巫饵铃，再结合德斯卡戴和风元素的共鸣频率，从头解释整个事情的来龙去脉。"],
        });
      },
    },
  });

  try {
    const result = await service.generateReply(createContext({ content: "啥意思呢" }));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.operation, "text_rewrite");
    assert.deepEqual(result.replies, [
      "我是说，可以换一种更容易说明白的方式。",
      "你具体没听懂哪一句？",
    ]);
    assert.equal(result.reply.length <= 48, true);

    calls.length = 0;
    const acknowledgement = await service.generateReply(createContext({ content: "好吧" }));
    assert.equal(acknowledgement.replies.length, 1);
    assert.equal(acknowledgement.reply.length <= 24, true);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("重写后仍有硬错误时进行保留原意的最终修复", async () => {
  const temporary = createTemporaryDatabase();
  const calls = [];
  const service = new AIConversationService({
    config: {
      CharacterPrompt: "你是布伦妮。",
      AIReplyMaxBubbles: 3,
      AIReplyCasualExpressionChance: 0,
    },
    database: temporary.database,
    qwenClient: {
      async createChatCompletion(messages, options) {
        calls.push({ messages, options });
        if (options.operation === "text_repair") {
          return JSON.stringify({ messages: ["好呀。", "想聊什么？"] });
        }
        return JSON.stringify({
          messages: [
            "我刚用诱巫饵铃测过了。",
            "你说话的节奏比平时快了0.8秒，所以一定是想找我聊天。",
          ],
        });
      },
    },
    logger: { error() {} },
  });

  try {
    const result = await service.generateReply(createContext({ content: "想和你聊天呀" }));
    assert.equal(calls.length, 3);
    assert.equal(calls[1].options.operation, "text_rewrite");
    assert.equal(calls[2].options.operation, "text_repair");
    assert.deepEqual(result.replies, ["好呀。", "想聊什么？"]);
    assert.doesNotMatch(result.reply, /诱巫饵铃|0\.8秒/u);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});

test("模型请求失败时回退但不写入 AI 上下文", async () => {
  const temporary = createTemporaryDatabase();
  const service = new AIConversationService({
    config: { CharacterPrompt: "系统提示", AIMultimodal: false },
    database: temporary.database,
    qwenClient: { async createChatCompletion() { throw new Error("网络错误"); } },
    logger: { error() {} },
  });

  try {
    const result = await service.generateReply(createContext({ content: "原始消息" }));
    assert.equal(result.reply, "我这边刚才没接住，等一下再说一次吧。");
    assert.notEqual(result.reply, "原始消息");
    assert.equal(result.generated, false);
    service.commitExchange(result);
    assert.equal(temporary.database.listAIContextMessages("c2c:user-1").length, 0);
  } finally {
    temporary.database.close();
    temporary.remove();
  }
});
