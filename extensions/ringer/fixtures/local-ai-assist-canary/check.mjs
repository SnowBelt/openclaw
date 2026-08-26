import fs from "node:fs";

const key = process.argv[2];
if (!/^(alpha|bravo)$/u.test(key ?? "")) {
  process.exit(2);
}
const actual = fs.readFileSync(new URL(`./${key}.txt`, import.meta.url), "utf8");
process.exit(actual === "after\n" ? 0 : 1);
