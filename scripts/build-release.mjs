import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const release = resolve(root, "release");
rmSync(release, { recursive: true, force: true });
mkdirSync(release, { recursive: true });

for (const item of ["index.html", "styles.css", "app.js", "db.js", "README.md", "study-plan.md", "exam-guide-and-sources.md", "docs"]) {
  cpSync(resolve(root, item), resolve(release, item), { recursive: true });
}
rmSync(resolve(release, "docs/.gitkeep"), { force: true });
mkdirSync(resolve(release, "data"), { recursive: true });
cpSync(resolve(root, "data/outline.js"), resolve(release, "data/outline.js"));
cpSync(resolve(root, "data/questions.js"), resolve(release, "data/questions.js"));
mkdirSync(resolve(release, "vendor"), { recursive: true });
cpSync(resolve(root, "vendor/sql-wasm.js"), resolve(release, "vendor/sql-wasm.js"));
cpSync(resolve(root, "vendor/sql-wasm-data.js"), resolve(release, "vendor/sql-wasm-data.js"));

console.log(`Release ready: ${release}`);
