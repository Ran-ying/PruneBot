const test = require("node:test");
const assert = require("node:assert/strict");
const { createQwenClient } = require("./QwenService");

test("使用 OpenAI 兼容格式调用通义千问", async () => {
  let request;
  let recordedUsage;
  const client = createQwenClient({
    apiKey: "test-key",
    model: "qwen-flash",
    temperature: 0.1,
    onUsage: (usage) => { recordedUsage = usage; },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "模型回复" } }],
        usage: { prompt_tokens: 25, completion_tokens: 5, total_tokens: 30 },
      }), { status: 200 });
    },
  });
  const messages = [
    { role: "system", content: "系统提示词" },
    { role: "user", content: "原始文字" },
  ];

  const result = await client.createChatCompletion(messages, { maxTokens: 512 });
  const body = JSON.parse(request.options.body);

  assert.equal(result, "模型回复");
  assert.equal(request.url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(body.model, "qwen-flash");
  assert.deepEqual(body.messages, messages);
  assert.equal(body.temperature, 0.1);
  assert.equal(body.enable_thinking, false);
  assert.equal(body.max_tokens, 512);
  assert.deepEqual(recordedUsage, {
    model: "qwen-flash",
    operation: "chat",
    conversationKey: null,
    inputTokens: 25,
    outputTokens: 5,
    totalTokens: 30,
    estimated: false,
  });
});

test("输入 0 也会调用通义千问", async () => {
  let called = false;
  const client = createQwenClient({
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "这是模型对 0 的回复" } }],
      }), { status: 200 });
    },
  });

  const result = await client.createChatCompletion([{ role: "user", content: "0" }]);
  assert.equal(called, true);
  assert.equal(result, "这是模型对 0 的回复");
});

test("通义千问调用失败时抛出可读错误", async () => {
  const client = createQwenClient({
    apiKey: "test-key",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "限流" },
    }), { status: 429 }),
  });

  await assert.rejects(
    client.createChatCompletion([{ role: "user", content: "你好" }]),
    /429 限流/,
  );
});
