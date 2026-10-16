const WebSocket = require("ws");
const { getToken } = require("./GetTokenFunction");
const { getGatewayUrl } = require("./OpenApiClient");

const OPCODE = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

const INTENTS = {
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C_EVENT: 1 << 25,
  PUBLIC_GUILD_MESSAGES: 1 << 30,
};

function getDefaultIntents() {
  return INTENTS.DIRECT_MESSAGE | INTENTS.GROUP_AND_C2C_EVENT | INTENTS.PUBLIC_GUILD_MESSAGES;
}

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

function getReconnectDelayMs(attempt, random = Math.random) {
  const baseDelay = Math.min(60_000, 5_000 * (2 ** Math.max(0, Number(attempt) || 0)));
  return Math.round(baseDelay * (0.8 + Math.min(1, Math.max(0, random())) * 0.4));
}

async function startWebSocketBot({
  onEvent,
  intents = getDefaultIntents(),
  WebSocketImpl = WebSocket,
  getTokenImpl = getToken,
  getGatewayUrlImpl = getGatewayUrl,
  random = Math.random,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) {
  if (typeof onEvent !== "function") throw new Error("WebSocket Bot 缺少 onEvent");

  let socket;
  let latestSequence = null;
  let sessionId = null;
  let heartbeatTimer = null;
  let heartbeatAcknowledged = true;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let stopped = false;

  function clearConnectionTimers() {
    clearIntervalImpl(heartbeatTimer);
    clearTimeoutImpl(reconnectTimer);
    heartbeatTimer = null;
    reconnectTimer = null;
  }

  function scheduleReconnect(error) {
    if (stopped || reconnectTimer) return;
    const delay = getReconnectDelayMs(reconnectAttempts, random);
    reconnectAttempts += 1;
    console.error(`WebSocket 将在 ${delay}ms 后重连：${error?.message || error || "连接已关闭"}`);
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect().catch(scheduleReconnect);
    }, delay);
  }

  function startHeartbeat(interval) {
    clearIntervalImpl(heartbeatTimer);
    heartbeatAcknowledged = true;
    heartbeatTimer = setIntervalImpl(() => {
      if (!socket || socket.readyState !== WebSocketImpl.OPEN) return;
      if (!heartbeatAcknowledged) {
        console.error("WebSocket 心跳 ACK 超时，主动重连");
        socket.terminate();
        return;
      }
      heartbeatAcknowledged = false;
      sendJson(socket, { op: OPCODE.HEARTBEAT, d: latestSequence });
    }, interval);
  }

  async function connect() {
    if (stopped) return;
    const gatewayUrl = await getGatewayUrlImpl();
    const currentSocket = new WebSocketImpl(gatewayUrl);
    socket = currentSocket;

    currentSocket.on("open", () => {
      console.log(`WebSocket 已连接：${gatewayUrl}`);
    });

    async function handleSocketMessage(rawMessage) {
      const payload = JSON.parse(rawMessage.toString());

      if (payload.op === OPCODE.HELLO) {
        const token = `QQBot ${await getTokenImpl()}`;
        if (sessionId && latestSequence !== null) {
          sendJson(currentSocket, {
            op: OPCODE.RESUME,
            d: { token, session_id: sessionId, seq: latestSequence },
          });
        } else {
          sendJson(currentSocket, {
            op: OPCODE.IDENTIFY,
            d: {
              token,
              intents,
              shard: [0, 1],
              properties: {
                $os: process.platform,
                $browser: "QQBot",
                $device: "QQBot",
              },
            },
          });
        }
        startHeartbeat(payload.d.heartbeat_interval);
        return;
      }

      if (payload.op === OPCODE.DISPATCH) {
        await onEvent(payload);
        if (typeof payload.s === "number") latestSequence = payload.s;
        if (payload.t === "READY" && payload.d?.session_id) {
          sessionId = payload.d.session_id;
          reconnectAttempts = 0;
        } else if (payload.t === "RESUMED") {
          reconnectAttempts = 0;
        }
        return;
      }

      if (payload.op === OPCODE.HEARTBEAT) {
        sendJson(currentSocket, { op: OPCODE.HEARTBEAT, d: latestSequence });
        return;
      }

      if (payload.op === OPCODE.HEARTBEAT_ACK) {
        heartbeatAcknowledged = true;
        return;
      }

      if (payload.op === OPCODE.INVALID_SESSION) {
        sessionId = null;
        latestSequence = null;
        currentSocket.close();
        return;
      }

      if (payload.op === OPCODE.RECONNECT) currentSocket.close();
    }

    currentSocket.on("message", (rawMessage) => {
      handleSocketMessage(rawMessage).catch((error) => {
        console.error("WebSocket 消息处理失败：", error.message);
        currentSocket.close();
      });
    });

    currentSocket.on("close", () => {
      clearIntervalImpl(heartbeatTimer);
      heartbeatTimer = null;
      if (!stopped && currentSocket === socket) scheduleReconnect("连接已关闭");
    });

    currentSocket.on("error", (error) => {
      console.error("WebSocket 错误：", error.message);
    });
  }

  try {
    await connect();
  } catch (error) {
    scheduleReconnect(error);
  }
  return {
    close() {
      stopped = true;
      clearConnectionTimers();
      if (
        socket
        && (socket.readyState === WebSocketImpl.OPEN || socket.readyState === WebSocketImpl.CONNECTING)
      ) {
        socket.close();
      }
    },
  };
}

module.exports = {
  startWebSocketBot,
  getReconnectDelayMs,
  INTENTS,
  OPCODE,
};
