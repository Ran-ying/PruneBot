const test = require("node:test");
const assert = require("node:assert/strict");
const { createChatHistoryAuth, parseCookies, safeEqual } = require("../src/ChatHistoryAuth");

function createRequest(cookie = "") {
  return {
    headers: { cookie },
    socket: { remoteAddress: "127.0.0.1", encrypted: false },
  };
}

test("聊天记录会话签名可验证且到期失效", () => {
  let currentTime = 1_000;
  const auth = createChatHistoryAuth({
    password: "secret",
    sessionHours: 1,
    now: () => currentTime,
  });
  const request = createRequest();
  const cookie = auth.createSessionCookie(request).split(";")[0];
  assert.equal(auth.isAuthenticated(createRequest(cookie)), true);

  currentTime += 3_600_001;
  assert.equal(auth.isAuthenticated(createRequest(cookie)), false);
  assert.equal(auth.isAuthenticated(createRequest(`${cookie}tampered`)), false);
});

test("密码和 Cookie 解析不会依赖明文长度", () => {
  assert.equal(safeEqual("same", "same"), true);
  assert.equal(safeEqual("short", "a much longer value"), false);
  assert.deepEqual(parseCookies("a=1; session=abc.def; theme=light"), {
    a: "1",
    session: "abc.def",
    theme: "light",
  });
});
