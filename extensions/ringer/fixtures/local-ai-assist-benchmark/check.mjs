import fs from "node:fs";

const key = process.argv[2];
if (!/^task-(?:0[1-9]|[12][0-9]|30)$/u.test(key ?? "")) {
  process.exit(2);
}
const actual = fs.readFileSync(new URL(`./${key}.txt`, import.meta.url), "utf8");
process.exit(actual === `after-${key}\n` ? 0 : 1);
