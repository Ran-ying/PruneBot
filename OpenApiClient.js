const APIList = require("./API.json");
const { getToken } = require("./GetTokenFunction");

const OPENAPI_BASE_URL = APIList.OpenAPI.BaseURL;

async function openapiFetch(path, options = {}) {
  const token = await getToken();
  const response = await fetch(`${OPENAPI_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      Authorization: `QQBot ${token}`,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`OpenAPI 请求失败：${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function getGatewayUrl() {
  const data = await openapiFetch("/gateway", {
    method: "GET",
  });

  return data.url;
}

module.exports = {
  openapiFetch,
  getGatewayUrl,
};
