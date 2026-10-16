const APIList = require("../API.json");
const { CONFIG_PATH, TOKEN_STORAGE_PATH, ensureDataDirectory } = require("./RuntimePaths");
const Config = require(CONFIG_PATH);
const fs = require("node:fs/promises");

const REFRESH_BEFORE_EXPIRE_SECONDS = 60;

async function readStorage() {
  try {
    const content = await fs.readFile(TOKEN_STORAGE_PATH, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeStorage(storage) {
  ensureDataDirectory();
  await fs.writeFile(TOKEN_STORAGE_PATH, `${JSON.stringify(storage, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.chmod(TOKEN_STORAGE_PATH, 0o600);
}

function isTokenValid(storage) {
  if (!storage.access_token || !storage.expires_at) {
    return false;
  }

  const refreshAt = storage.expires_at - REFRESH_BEFORE_EXPIRE_SECONDS * 1000;
  return Date.now() < refreshAt;
}

async function requestNewAppAccessToken() {
  const response = await fetch(APIList.GetAccessToken.URL, {
    method: APIList.GetAccessToken.Method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      appId: Config.AppID,
      clientSecret: Config.AppSecret,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`获取 access_token 失败：${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function getToken() {
  const storage = await readStorage();

  if (isTokenValid(storage)) {
    return storage.access_token;
  }

  const data = await requestNewAppAccessToken();
  const expiresAt = Date.now() + data.expires_in * 1000;

  await writeStorage({
    access_token: data.access_token,
    expires_in: data.expires_in,
    expires_at: expiresAt,
    expires_at_text: new Date(expiresAt).toISOString(),
  });

  return data.access_token;
}

module.exports = {
  getToken,
};
