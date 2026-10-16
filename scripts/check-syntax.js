// Syntax-check application, test, browser and maintenance JavaScript without running it.
const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

const root = join(__dirname, "..");
const files = ["main.js"];
for (const dir of ["src", "tests", "scripts", "public"]) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".js")) files.push(join(dir, entry.name));
  }
}
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "pipe" });
  } catch (error) {
    process.stderr.write(`Syntax check failed: ${file}\n`);
    if (error.stderr) process.stderr.write(error.stderr);
    process.exitCode = 1;
  }
}
if (!process.exitCode) console.log(`Syntax check passed: ${files.length} JavaScript files`);
