import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = resolve(root, "release");
if (!/tailwindcss v4\./.test(readFileSync(resolve(root, "styles.css"), "utf8"))) {
  throw new Error("styles.css 不是 Tailwind CSS v4 构建产物，请先运行 npm run build:styles");
}
rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });

for (const item of ["index.html", "styles.css", "app.js", "exam-bank.js", "chat.js", "db.js", "README.md", "study-plan.md", "exam-guide-and-sources.md", "docs"]) {
  cpSync(resolve(root, item), resolve(release, item), { recursive: true });
}
rmSync(resolve(release, "docs/.gitkeep"), { force: true });
mkdirSync(resolve(release, "data"), { recursive: true });
cpSync(resolve(root, "data/outline.js"), resolve(release, "data/outline.js"));
cpSync(resolve(root, "data/questions.js"), resolve(release, "data/questions.js"));
cpSync(resolve(root, "data/sprint-plan.js"), resolve(release, "data/sprint-plan.js"));
mkdirSync(resolve(release, "vendor"), { recursive: true });
cpSync(resolve(root, "vendor/sql-wasm.js"), resolve(release, "vendor/sql-wasm.js"));
cpSync(resolve(root, "vendor/sql-wasm-data.js"), resolve(release, "vendor/sql-wasm-data.js"));
cpSync(resolve(root, "vendor/katex"), resolve(release, "vendor/katex"), { recursive: true });

console.log(`Release ready: ${release}`);
