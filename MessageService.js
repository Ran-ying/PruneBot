const { openapiFetch } = require("./OpenApiClient");

async function postMessage(path, payload) {
  return openapiFetch(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function sendC2CMessageRequest(openid, payload) {
  return postMessage(`/v2/users/${openid}/messages`, payload);
}

async function sendGroupMessageRequest(groupOpenid, payload) {
  return postMessage(`/v2/groups/${groupOpenid}/messages`, payload);
}

async function sendChannelMessageRequest(channelId, payload) {
  return postMessage(`/channels/${channelId}/messages`, payload);
}

async function sendDirectMessageRequest(guildId, payload) {
  return postMessage(`/dms/${guildId}/messages`, payload);
}

async function uploadC2CMedia(openid, media) {
  return postMessage(`/v2/users/${openid}/files`, media);
}

async function uploadGroupMedia(groupOpenid, media) {
  return postMessage(`/v2/groups/${groupOpenid}/files`, media);
}

module.exports = {
  sendC2CMessageRequest,
  sendGroupMessageRequest,
  sendChannelMessageRequest,
  sendDirectMessageRequest,
  uploadC2CMedia,
  uploadGroupMedia,
};
