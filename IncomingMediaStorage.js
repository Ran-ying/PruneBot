const path = require("node:path");
const { createHash } = require("node:crypto");
const { access, chmod, mkdir, writeFile } = require("node:fs/promises");
const { CHAT_MEDIA_DIRECTORY } = require("./RuntimePaths");

const DEFAULT_MEDIA_DIRECTORY = CHAT_MEDIA_DIRECTORY;
const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

const EXTENSIONS_BY_CONTENT_TYPE = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
]);

function isImageAttachment(attachment) {
  return String(attachment?.content_type || "").toLowerCase().startsWith("image/");
}

function getImageExtension(attachment, responseContentType) {
  const contentType = String(responseContentType || attachment.content_type || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (EXTENSIONS_BY_CONTENT_TYPE.has(contentType)) {
    return EXTENSIONS_BY_CONTENT_TYPE.get(contentType);
  }

  const filenameExtension = path.extname(String(attachment.filename || "")).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(filenameExtension)) {
    return filenameExtension === ".jpeg" ? ".jpg" : filenameExtension;
  }
  return ".img";
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function archiveImageAttachment(attachment, options) {
  const {
    messageId,
    attachmentIndex,
    mediaDirectory,
    fetchImpl,
    maxImageBytes,
    timeoutMs,
  } = options;
  const response = await fetchImpl(attachment.url, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxImageBytes) throw new Error("图片超过本地保存大小限制");

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > maxImageBytes) throw new Error("图片超过本地保存大小限制");

  const extension = getImageExtension(attachment, response.headers.get("content-type"));
  const digest = createHash("sha256")
    .update(`${messageId}:${attachmentIndex}:${attachment.url}`)
    .digest("hex")
    .slice(0, 32);
  const filename = `${digest}${extension}`;
  const filePath = path.join(mediaDirectory, filename);

  await mkdir(mediaDirectory, { recursive: true, mode: 0o700 });
  await chmod(mediaDirectory, 0o700).catch(() => {});
  if (!(await fileExists(filePath))) await writeFile(filePath, data, { mode: 0o600 });
  await chmod(filePath, 0o600).catch(() => {});

  return {
    ...attachment,
    original_url: attachment.url,
    local_url: `/media/${filename}`,
    archived_at: new Date().toISOString(),
  };
}

async function archiveIncomingImages(message = {}, {
  mediaDirectory = DEFAULT_MEDIA_DIRECTORY,
  fetchImpl = fetch,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  logger = console,
} = {}) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  return Promise.all(attachments.map(async (attachment, attachmentIndex) => {
    if (!isImageAttachment(attachment) || !attachment.url) return attachment;

    try {
      return await archiveImageAttachment(attachment, {
        messageId: message.id || "unknown-message",
        attachmentIndex,
        mediaDirectory,
        fetchImpl,
        maxImageBytes,
        timeoutMs,
      });
    } catch (error) {
      logger.error(`图片本地保存失败：${error.message}`);
      return attachment;
    }
  }));
}

module.exports = {
  DEFAULT_MEDIA_DIRECTORY,
  archiveIncomingImages,
  getImageExtension,
  isImageAttachment,
};
