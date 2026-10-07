const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  DATA_DIRECTORY,
  CONFIG_PATH,
  TOKEN_STORAGE_PATH,
  CHAT_DATABASE_PATH,
  CHAT_MEDIA_DIRECTORY,
} = require("./RuntimePaths");

test("持久化配置、数据库和媒体文件统一存放在 data 目录", () => {
  const expectedDirectory = process.env.QQBOT_DATA_DIRECTORY
    ? path.resolve(process.env.QQBOT_DATA_DIRECTORY)
    : path.join(__dirname, "data");
  assert.equal(DATA_DIRECTORY, expectedDirectory);
  assert.equal(CONFIG_PATH, path.join(DATA_DIRECTORY, "Config.json"));
  assert.equal(TOKEN_STORAGE_PATH, path.join(DATA_DIRECTORY, "Storage.json"));
  assert.equal(CHAT_DATABASE_PATH, path.join(DATA_DIRECTORY, "ChatHistory.sqlite"));
  assert.equal(CHAT_MEDIA_DIRECTORY, path.join(DATA_DIRECTORY, "ChatMedia"));
});
