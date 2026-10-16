const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { getReconnectDelayMs, OPCODE, startWebSocketBot } = require("../src/WebSocketBot");

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  message(payload) {
    this.emit("message", Buffer.from(JSON.stringify(payload)));
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    if (this.readyState > FakeWebSocket.OPEN) return;
    this.readyState = 3;
    this.emit("close");
  }

  terminate() {
    this.close();
  }
}

test("WebSocket 重连使用 Resume 补发已处理序号之后的事件", async () => {
  FakeWebSocket.instances = [];
  const reconnectCallbacks = [];
  const controller = await startWebSocketBot({
    onEvent: async () => {},
    WebSocketImpl: FakeWebSocket,
    getGatewayUrlImpl: async () => "wss://example.test/gateway",
    getTokenImpl: async () => "token-value",
    random: () => 0.5,
    setTimeoutImpl(callback) {
      reconnectCallbacks.push(callback);
      return callback;
    },
    clearTimeoutImpl() {},
    setIntervalImpl: () => Symbol("heartbeat"),
    clearIntervalImpl() {},
  });

  const first = FakeWebSocket.instances[0];
  first.open();
  first.message({ op: OPCODE.HELLO, d: { heartbeat_interval: 45_000 } });
  await nextTurn();
  assert.equal(first.sent[0].op, OPCODE.IDENTIFY);
  first.message({ op: OPCODE.DISPATCH, s: 42, t: "READY", d: { session_id: "session-1" } });
  await nextTurn();

  first.close();
  assert.equal(reconnectCallbacks.length, 1);
  await reconnectCallbacks[0]();
  const second = FakeWebSocket.instances[1];
  second.open();
  second.message({ op: OPCODE.HELLO, d: { heartbeat_interval: 45_000 } });
  await nextTurn();

  assert.deepEqual(second.sent[0], {
    op: OPCODE.RESUME,
    d: { token: "QQBot token-value", session_id: "session-1", seq: 42 },
  });
  controller.close();
});

test("WebSocket 退避时间带抖动并封顶", () => {
  assert.equal(getReconnectDelayMs(0, () => 0), 4_000);
  assert.equal(getReconnectDelayMs(0, () => 1), 6_000);
  assert.equal(getReconnectDelayMs(20, () => 0.5), 60_000);
});
