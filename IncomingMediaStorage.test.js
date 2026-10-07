const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { archiveIncomingImages } = require("./IncomingMediaStorage");

test("收到 QQ 图片时保存本地副本并保留原始 URL", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "qqbot-media-"));
  const originalUrl = "https://example.com/temporary-image";
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  try {
    const attachments = await archiveIncomingImages({
      id: "message-id",
      attachments: [{
        content_type: "image/png",
        filename: "photo.png",
        url: originalUrl,
      }],
    }, {
      mediaDirectory: directory,
      fetchImpl: async () => new Response(imageBytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
      logger: { error() {} },
    });

    assert.equal(attachments[0].url, originalUrl);
    assert.equal(attachments[0].original_url, originalUrl);
    assert.match(attachments[0].local_url, /^\/media\/[a-f0-9]{32}\.png$/);
    assert.deepEqual(
      readFileSync(path.join(directory, path.basename(attachments[0].local_url))),
      imageBytes,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("图片下载失败时仍保留原附件", async () => {
  const attachment = {
    content_type: "image/jpeg",
    url: "https://example.com/not-found",
  };
  const result = await archiveIncomingImages({ id: "message-id", attachments: [attachment] }, {
    fetchImpl: async () => new Response("", { status: 404 }),
    logger: { error() {} },
  });

  assert.deepEqual(result, [attachment]);
});
