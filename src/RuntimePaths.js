const path = require("node:path");
const { chmodSync, existsSync, mkdirSync } = require("node:fs");

const DATA_DIRECTORY = process.env.QQBOT_DATA_DIRECTORY
  ? path.resolve(process.env.QQBOT_DATA_DIRECTORY)
  : path.join(__dirname, "..", "data");

const CONFIG_PATH = path.join(DATA_DIRECTORY, "Config.json");
const TOKEN_STORAGE_PATH = path.join(DATA_DIRECTORY, "Storage.json");
const CHAT_DATABASE_PATH = path.join(DATA_DIRECTORY, "ChatHistory.sqlite");
const CHAT_MEDIA_DIRECTORY = path.join(DATA_DIRECTORY, "ChatMedia");

function ensureDataDirectory() {
  mkdirSync(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
  try {
    chmodSync(DATA_DIRECTORY, 0o700);
  } catch {
    // Some mounted filesystems do not support POSIX permissions.
  }
}

function hardenDataPermissions() {
  ensureDataDirectory();
  const privateFiles = [
    CONFIG_PATH,
    TOKEN_STORAGE_PATH,
    CHAT_DATABASE_PATH,
    `${CHAT_DATABASE_PATH}-shm`,
    `${CHAT_DATABASE_PATH}-wal`,
  ];
  for (const filePath of privateFiles) {
    if (!existsSync(filePath)) continue;
    try {
      chmodSync(filePath, 0o600);
    } catch {
      // Permission hardening is best-effort on non-POSIX filesystems.
    }
  }
  if (existsSync(CHAT_MEDIA_DIRECTORY)) {
    try {
      chmodSync(CHAT_MEDIA_DIRECTORY, 0o700);
    } catch {
      // Permission hardening is best-effort on non-POSIX filesystems.
    }
  }
}

module.exports = {
  DATA_DIRECTORY,
  CONFIG_PATH,
  TOKEN_STORAGE_PATH,
  CHAT_DATABASE_PATH,
  CHAT_MEDIA_DIRECTORY,
  ensureDataDirectory,
  hardenDataPermissions,
};
