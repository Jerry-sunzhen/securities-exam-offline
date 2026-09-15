#!/usr/bin/env node
// 一次性/可重复执行：就地清洗 content/imported-exams.json 的题干、选项、解析和材料。
// 只改文本，不重算题目 id，保证已有学习档案里的作答记录仍然对得上。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanQuestion, questionTextIssues } from "./question-text.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpusPath = join(root, "content/imported-exams.json");
const correctionsPath = join(root, "content/exam-corrections.json");
const corrections = new Map(JSON.parse(readFileSync(correctionsPath, "utf8")).map((item) => [item.id, item]));
const payload = JSON.parse(readFileSync(corpusPath, "utf8"));
const report = { questions: payload.questions.length, changed: 0, eligible: 0, held: 0, residualIssues: [] };
for (const question of payload.questions) {
  if (cleanQuestion(question, { corrections }).changed) report.changed += 1;
  if (question.examEligible !== false) report.eligible += 1;
  else report.held += 1;
  for (const issue of questionTextIssues(question)) report.residualIssues.push(`${question.id}: ${issue}`);
}
payload.meta.heldCount = report.held;
payload.meta.textCleaning = {
  cleanedAt: "2026-09-15",
  tool: "scripts/clean-imported-exams.mjs",
  notice: "题干/选项/解析已去除 PDF 水印、页眉页码、断行与混入的后续题目；题目 id 保持不变。"
};
writeFileSync(corpusPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(JSON.stringify(report, null, 1));
if (report.residualIssues.length) {
  console.error(report.residualIssues.slice(0, 20).join("\n"));
  process.exitCode = 1;
}
