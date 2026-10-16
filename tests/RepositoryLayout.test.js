const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("仓库内部 CommonJS 相对导入都能定位到当前目录结构", () => {
  const targets = ["main.js"];
  for (const directory of ["src", "tests", "scripts"]) {
    for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".js")) {
        targets.push(path.join(directory, entry.name));
      }
    }
  }

  for (const target of targets) {
    const abs = path.join(root, target);
    const code = readFileSync(abs, "utf8");
    for (const match of code.matchAll(/require\(["'](\.[^"'\n]+)["']\)/gu)) {
      const stem = path.resolve(path.dirname(abs), match[1]);
      const candidates = [stem, `${stem}.js`, `${stem}.json`, path.join(stem, "index.js")];
      assert.ok(candidates.some(existsSync), `${target}: unresolved ${match[1]}`);
    }
  }
});

test("启动命令使用整理后的入口，用户数据目录始终排除提交", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.start, "node main.js");
  assert.equal(pkg.scripts["start:demo"], "node src/WebDemoServer.js");
  for (const name of ["eval:live", "eval:deep", "eval:voice", "test:tts", "check:token"]) {
    const command = pkg.scripts[name];
    assert.match(command, /^node scripts\/.+\.js$/u);
    assert.ok(existsSync(path.join(root, command.slice(5))), name);
  }
  const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(gitignore, /^\/data\/\*/mu);
  assert.match(gitignore, /^!\/data\/Config\.example\.json$/mu);
});
