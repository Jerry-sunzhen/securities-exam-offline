import puppeteer from "puppeteer-core";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.argv[2] ? resolve(root, process.argv[2]) : root;
const expectedQuestions = JSON.parse(readFileSync(resolve(root, "data/questions.json"), "utf8")).meta.questionCount;
const outlinePayload = JSON.parse(readFileSync(resolve(root, "data/outline.json"), "utf8"));
const expectedOutlinePages = outlinePayload.pages.filter((item) => item.page >= 4 && item.page !== 14).length;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  userDataDir: mkdtempSync(resolve(tmpdir(), "securities-exam-smoke-")),
  args: ["--allow-file-access-from-files", "--no-first-run"]
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(appRoot, "index.html")).href, { waitUntil: "load" });
await page.waitForSelector('[data-nav="outline"]', { timeout: 15000 });

const dashboardText = await page.$eval(".sidebar-footer", (node) => node.textContent);
if (!dashboardText.includes(String(expectedQuestions))) throw new Error("Question count missing on dashboard");

await page.click('[data-nav="outline"]');
await page.waitForSelector(".outline-page");
const outlinePages = await page.$$eval(".outline-page", (nodes) => nodes.length);
if (outlinePages !== expectedOutlinePages) throw new Error(`Expected ${expectedOutlinePages} outline pages, got ${outlinePages}`);
await page.screenshot({ path: resolve(root, "diagnostics/smoke-outline.png"), fullPage: false });

await page.click('[data-nav="practice"]');
await page.waitForSelector('[data-action="start-practice"]');
await page.click('[data-action="start-practice"]');
await page.waitForSelector(".question-card");
await page.click(".option");
await page.click('[data-action="submit-question"]');
await page.waitForSelector(".explanation");
const citations = await page.$$eval(".citation", (nodes) => nodes.length);
if (citations < 1) throw new Error("Question explanation has no citation");
await page.click('[data-action="bookmark-question"]');

const dataChecks = await page.evaluate(async () => {
  const testQuestionId = "SMOKE-LATEST-WRONG";
  window.StudyDb.run("DELETE FROM attempts WHERE question_id=?", [testQuestionId]);
  window.StudyDb.run(
    "INSERT INTO attempts(id,question_id,question_version,selected_json,is_correct,mode,created_at) VALUES (?,?,?,?,?,?,?)",
    [crypto.randomUUID(), testQuestionId, 1, "[]", 0, "practice", "2026-01-01T00:00:00.000Z"]
  );
  window.StudyDb.run(
    "INSERT INTO attempts(id,question_id,question_version,selected_json,is_correct,mode,created_at) VALUES (?,?,?,?,?,?,?)",
    [crypto.randomUUID(), testQuestionId, 1, "[]", 1, "practice", "2026-01-01T00:00:00.000Z"]
  );
  const latestWrongResolved = !window.StudyDb.getWrongQuestionIds().includes(testQuestionId);
  window.StudyDb.run("DELETE FROM attempts WHERE question_id=?", [testQuestionId]);

  window.StudyDb.run("INSERT OR REPLACE INTO notes(question_id,body,modified_at) VALUES (?,?,?)", ["F001-S", "newer-local-note", "2099-01-01T00:00:00.000Z"]);
  const wasmBinary = Uint8Array.from(atob(window.SQL_WASM_BASE64), (char) => char.charCodeAt(0));
  const SQL = await window.initSqlJs({ wasmBinary });
  const incoming = new SQL.Database();
  incoming.exec(`
    CREATE TABLE profile_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO profile_meta(key,value) VALUES ('schema_version','1');
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, question_version INTEGER,
      selected_json TEXT NOT NULL, is_correct INTEGER NOT NULL, mode TEXT NOT NULL,
      session_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE notes (question_id TEXT PRIMARY KEY, body TEXT NOT NULL, modified_at TEXT NOT NULL);
    INSERT INTO notes(question_id,body,modified_at) VALUES ('F001-S','older-incoming-note','2000-01-01T00:00:00.000Z');
  `);
  await window.StudyDb.mergeBytes(incoming.export());
  incoming.close();
  const newerNotePreserved = window.StudyDb.getNote("F001-S") === "newer-local-note";
  window.StudyDb.run("DELETE FROM notes WHERE question_id=?", ["F001-S"]);

  const beforeImport = { stats: window.StudyDb.getDashboard(), deviceId: window.StudyDb.getMeta().device_id };
  const incompatible = new SQL.Database();
  incompatible.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
  let incompatibleRejected = false;
  try {
    await window.StudyDb.importBytes(incompatible.export().buffer, "not-a-profile.sqlite");
  } catch (_) {
    incompatibleRejected = true;
  }
  incompatible.close();
  const afterImport = { stats: window.StudyDb.getDashboard(), deviceId: window.StudyDb.getMeta().device_id };
  const currentProfileIntact = incompatibleRejected && beforeImport.stats.total === afterImport.stats.total && beforeImport.deviceId === afterImport.deviceId;
  await window.StudyDb.flush();
  return { latestWrongResolved, newerNotePreserved, currentProfileIntact };
});
if (!Object.values(dataChecks).every(Boolean)) throw new Error(`Data checks failed: ${JSON.stringify(dataChecks)}`);

await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-action="start-exam"]');
await page.click('[data-action="start-exam"]');
await page.waitForSelector(".question-card");

const examBlueprint = await page.evaluate(() => {
  const active = window.StudyDb.getActiveExam();
  const map = new Map(window.QUESTION_DATA.questions.map((question) => [question.id, question]));
  const factCounts = new Map();
  for (const id of active.questionIds) {
    const factId = map.get(id)?.factId;
    factCounts.set(factId, (factCounts.get(factId) || 0) + 1);
  }
  return { total: active.questionIds.length, maxVariantsPerFact: Math.max(...factCounts.values()) };
});
if (examBlueprint.total !== 120 || examBlueprint.maxVariantsPerFact > 2) throw new Error(`Invalid exam blueprint: ${JSON.stringify(examBlueprint)}`);

await page.click(".option");
await page.evaluate(() => window.StudyDb.flush());
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-action="resume-exam"]');
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-action="resume-exam"]', { timeout: 15000 });
const bookmarkPersisted = await page.evaluate(() => window.StudyDb.isBookmarked(window.StudyDb.getBookmarkIds()[0]));
if (!bookmarkPersisted) throw new Error("Bookmark was not persisted across reload");
await page.click('[data-action="resume-exam"]');
await page.waitForSelector(".question-card");
await page.click('[data-action="prev-question"]');
await page.waitForSelector(".option.selected");

for (let index = 0; index < 120; index += 1) {
  await page.click('[data-action="next-question"]');
}
await page.waitForFunction(() => document.body.textContent.includes("查看全部解析与来源"), { timeout: 30000 });
await page.click('[data-action="review-exam-all"]');
await page.waitForSelector(".citation");
const resultReviewHasSource = await page.$eval(".citation", (node) => node.textContent.includes("考试范围定位"));
if (!resultReviewHasSource) throw new Error("Exam review does not show source classification");
await page.screenshot({ path: resolve(root, "diagnostics/smoke-review.png"), fullPage: true });
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-nav="outline"]');

const dashboard = await page.evaluate(async () => {
  await window.StudyDb.flush();
  return {
    stats: window.StudyDb.getDashboard(),
    fsApi: typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function",
    externalResources: performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => /^https?:/i.test(url))
  };
});
if (dashboard.stats.total < 121) throw new Error("Practice or exam attempts were not saved");
if (!dashboard.fsApi) throw new Error("Chrome File System Access API unavailable on file://");
if (dashboard.externalResources.length) throw new Error(`Unexpected network resources: ${dashboard.externalResources.join(", ")}`);

await page.screenshot({ path: resolve(root, "diagnostics/smoke-dashboard.png"), fullPage: true });
await browser.close();

if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`);
console.log(JSON.stringify({
  ok: true,
  outlinePages,
  citations,
  dataChecks,
  examBlueprint,
  resultReviewHasSource,
  stats: dashboard.stats,
  fsApi: dashboard.fsApi,
  externalResources: dashboard.externalResources
}, null, 2));
