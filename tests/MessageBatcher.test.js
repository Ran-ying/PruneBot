const test = require("node:test");
const assert = require("node:assert/strict");
const { MessageBatcher } = require("../src/MessageBatcher");

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("连续消息在安静窗口结束后合并为一个批次", async () => {
  const batches = [];
  const batcher = new MessageBatcher({
    waitMs: 50,
    maxWaitMs: 200,
    processBatch: async (items, key) => batches.push({ key, items }),
  });

  batcher.enqueue("c2c:user-1", "第一条");
  await sleep(5);
  batcher.enqueue("c2c:user-1", "第二条");
  await sleep(80);

  assert.deepEqual(batches, [{
    key: "c2c:user-1",
    items: ["第一条", "第二条"],
  }]);
  batcher.close();
});

test("不同消息键不会合并，达到数量上限时立即处理", async () => {
  const batches = [];
  const batcher = new MessageBatcher({
    waitMs: 100,
    maxWaitMs: 200,
    maxMessages: 2,
    processBatch: async (items, key) => batches.push({ key, items }),
  });

  batcher.enqueue("group:1:user-a", "A1");
  batcher.enqueue("group:1:user-b", "B1");
  batcher.enqueue("group:1:user-a", "A2");
  await sleep(15);

  assert.deepEqual(batches, [{
    key: "group:1:user-a",
    items: ["A1", "A2"],
  }]);
  batcher.close();
});

test("关闭聚合器时返回尚未处理的消息", () => {
  const batcher = new MessageBatcher({
    waitMs: 1_000,
    processBatch: async () => {},
  });
  batcher.enqueue("c2c:user-1", "尚未处理");
  assert.deepEqual(batcher.close(), ["尚未处理"]);
});
