#!/usr/bin/env node
// 读取学习档案（SQLite）并与题库比对，输出进度、正确率和薄弱点评估。
// 用法：node scripts/study-progress.mjs <档案.sqlite> [题库 JSON]
// 档案口径与 App 一致：错题 = 最近一次作答仍为错的题；没做过 = attempts 里没有该题。
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js/dist/sql-wasm.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = process.argv[2];
if (!profilePath) {
  console.error("用法：node scripts/study-progress.mjs <学习档案.sqlite> [题库 JSON]");
  process.exit(1);
}
const questionPath = resolve(process.argv[3] || resolve(root, "data/questions.json"));

const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(readFileSync(profilePath)));
const payload = JSON.parse(readFileSync(questionPath, "utf8"));
const questions = payload.questions.filter((question) => question.examEligible !== false);
const byId = new Map(questions.map((question) => [question.id, question]));
const subjectTitle = new Map(payload.subjects.map((subject) => [subject.id, subject.title]));
const chapterTitle = new Map(payload.chapters.map((chapter) => [chapter.id, chapter.title]));
const typeLabel = { single: "单选", multiple: "多选", judgment: "判断", case: "综合" };

function rows(sql) {
  const result = db.exec(sql);
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
}
function hasTable(name) {
  return db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`).length > 0;
}
const safeRows = (sql, table) => (hasTable(table) ? rows(sql) : []);

const attempts = safeRows("SELECT question_id, is_correct, mode, created_at FROM attempts ORDER BY created_at", "attempts");
const bookmarks = new Set(safeRows("SELECT question_id FROM bookmarks WHERE deleted_at IS NULL", "bookmarks").map((row) => row.question_id));
const notes = safeRows("SELECT question_id FROM notes", "notes");
const exams = safeRows("SELECT mode, subject_id, score, total, started_at, completed_at FROM exam_sessions ORDER BY started_at", "exam_sessions");
const reviews = safeRows("SELECT knowledge_id, grade, review_count FROM knowledge_reviews", "knowledge_reviews");

const latest = new Map();
const attemptsPerQuestion = new Map();
for (const attempt of attempts) {
  if (!byId.has(attempt.question_id)) continue;
  latest.set(attempt.question_id, attempt);
  attemptsPerQuestion.set(attempt.question_id, (attemptsPerQuestion.get(attempt.question_id) || 0) + 1);
}
const attemptedIds = new Set(latest.keys());
const wrongIds = [...latest.values()].filter((attempt) => !attempt.is_correct).map((attempt) => attempt.question_id);

const percent = (correct, total) => (total ? `${Math.round(correct * 100 / total)}%` : "—");
const bucket = (question) => `${question.subjectId}/${question.chapterId}/${question.type}`;

function coverage(list) {
  const seen = list.filter((question) => attemptedIds.has(question.id));
  const correct = seen.filter((question) => latest.get(question.id).is_correct).length;
  return { total: list.length, seen: seen.length, unseen: list.length - seen.length, correct, accuracy: percent(correct, seen.length) };
}
function table(title, groups) {
  console.log(`\n${title}`);
  console.log("  分组              题量  已做  未做  正确率");
  for (const [name, list] of groups) {
    const stat = coverage(list);
    console.log(`  ${name.padEnd(16)}${String(stat.total).padStart(4)}${String(stat.seen).padStart(6)}${String(stat.unseen).padStart(6)}${stat.accuracy.padStart(7)}`);
  }
}

const subjects = [...new Set(questions.map((question) => question.subjectId))];
console.log(`档案：${profilePath}`);
console.log(`作答记录 ${attempts.length} 条 · 覆盖 ${attemptedIds.size} 道题（题库可练 ${questions.length} 道）· 收藏 ${bookmarks.size} · 笔记 ${notes.length} · 背诵卡 ${reviews.length}`);
if (exams.length) {
  console.log(`模考 ${exams.length} 次：${exams.map((exam) => `${subjectTitle.get(exam.subject_id) || exam.subject_id} ${exam.score ?? "未交"}/${exam.total}`).join("，")}`);
}
const first = attempts[0]?.created_at, last = attempts[attempts.length - 1]?.created_at;
if (first) console.log(`作答时间：${first} → ${last}`);
const totalCorrect = [...latest.values()].filter((attempt) => attempt.is_correct).length;
console.log(`总体：做过 ${attemptedIds.size} 道，正确率 ${percent(totalCorrect, attemptedIds.size)}，当前错题 ${wrongIds.length} 道`);

for (const subjectId of subjects) {
  const list = questions.filter((question) => question.subjectId === subjectId);
  const stat = coverage(list);
  console.log(`\n【${subjectTitle.get(subjectId) || subjectId}】可练 ${stat.total} · 已做 ${stat.seen} · 未做 ${stat.unseen} · 正确率 ${stat.accuracy}`);
  table("按章节", [...new Map(list.map((question) => [question.chapterId, list.filter((item) => item.chapterId === question.chapterId)])).entries()]
    .map(([chapterId, items]) => [chapterTitle.get(chapterId) || chapterId, items]));
  table("按题型", ["single", "multiple", "judgment", "case"]
    .map((type) => [typeLabel[type], list.filter((question) => question.type === type)])
    .filter(([, items]) => items.length));
}

const wrongByChapter = new Map();
for (const id of wrongIds) {
  const question = byId.get(id);
  const key = `${subjectTitle.get(question.subjectId)} · ${chapterTitle.get(question.chapterId)}`;
  wrongByChapter.set(key, (wrongByChapter.get(key) || 0) + 1);
}
console.log(`\n错题分布（当前未订正 ${wrongIds.length} 道）`);
for (const [key, count] of [...wrongByChapter.entries()].sort((left, right) => right[1] - left[1])) console.log(`  ${key}：${count} 道`);

const multiYear = questions.filter((question) => (question.repeatYears || []).length > 1);
const multiYearLeft = multiYear.filter((question) => !attemptedIds.has(question.id));
console.log(`\n多年考点题：共 ${multiYear.length} 道，没做过 ${multiYearLeft.length} 道`);
for (const subjectId of subjects) {
  const list = multiYearLeft.filter((question) => question.subjectId === subjectId);
  if (list.length) console.log(`  ${subjectTitle.get(subjectId)}：${list.length} 道（${[...new Set(list.map((question) => chapterTitle.get(question.chapterId)))].join("、")}）`);
}

const unseenBySubject = new Map();
for (const question of questions) {
  if (attemptedIds.has(question.id)) continue;
  if (!unseenBySubject.has(question.subjectId)) unseenBySubject.set(question.subjectId, []);
  unseenBySubject.get(question.subjectId).push(question);
}
console.log("\n没做过的题最多、最该补的章节");
for (const [subjectId, list] of unseenBySubject) {
  const byChapter = [...new Set(list.map((question) => question.chapterId))]
    .map((chapterId) => [chapterId, list.filter((question) => question.chapterId === chapterId).length])
    .sort((left, right) => right[1] - left[1]).slice(0, 3);
  console.log(`  ${subjectTitle.get(subjectId)}：${byChapter.map(([chapterId, count]) => `${chapterTitle.get(chapterId)} ${count} 道`).join(" · ")}`);
}

const recentYears = questions.filter((question) => (question.origins || []).some((origin) => Number(origin.year) >= 2025));
for (const subjectId of subjects) {
  const list = recentYears.filter((question) => question.subjectId === subjectId);
  const stat = coverage(list);
  console.log(`\n${subjectTitle.get(subjectId)} 2025/2026 真题：${stat.total} 道 · 已做 ${stat.seen} · 未做 ${stat.unseen} · 正确率 ${stat.accuracy}`);
}
