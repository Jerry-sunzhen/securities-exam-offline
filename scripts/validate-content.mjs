import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payload = JSON.parse(readFileSync(resolve(root, "data/questions.json"), "utf8"));
const outline = JSON.parse(readFileSync(resolve(root, "data/outline.json"), "utf8"));
const chapterIds = new Set(payload.chapters.map((item) => item.id));
const ids = new Set();
const errors = [];
const warnings = [];
const answerPositions = { A: 0, B: 0, C: 0, D: 0 };
const multiCombinations = new Map();
const factCounts = new Map();

if (!Array.isArray(payload.knowledgePoints) || payload.knowledgePoints.length !== payload.meta.factCount) {
  errors.push(`knowledge point count must equal fact count ${payload.meta.factCount}`);
} else {
  const knowledgeIds = new Set();
  for (const point of payload.knowledgePoints) {
    if (knowledgeIds.has(point.id)) errors.push(`duplicate knowledge point ${point.id}`);
    knowledgeIds.add(point.id);
    if (!chapterIds.has(point.chapterId)) errors.push(`${point.id}: unknown knowledge chapter`);
    if (!point.topic || !point.statement || !point.explanation) errors.push(`${point.id}: incomplete knowledge content`);
    if (!point.keyPoints?.length || !point.commonMistakes?.length) errors.push(`${point.id}: missing knowledge lists`);
    if (!point.citations?.length) errors.push(`${point.id}: missing knowledge citation`);
  }
}

for (const question of payload.questions) {
  if (ids.has(question.id)) errors.push(`duplicate id ${question.id}`);
  ids.add(question.id);
  if (!chapterIds.has(question.chapterId)) errors.push(`${question.id}: unknown chapter`);
  if (!question.factId) errors.push(`${question.id}: missing factId`);
  factCounts.set(question.factId, (factCounts.get(question.factId) || 0) + 1);
  if (question.verificationStatus !== "outline_checked") errors.push(`${question.id}: invalid verification status`);
  if (!question.stem || !question.explanation) errors.push(`${question.id}: missing stem/explanation`);
  if (!Array.isArray(question.options) || question.options.length < 2) errors.push(`${question.id}: invalid options`);
  const optionIds = new Set(question.options.map((option) => option.id));
  if (optionIds.size !== question.options.length) errors.push(`${question.id}: duplicate option ids`);
  if (new Set(question.options.map((option) => option.text.trim())).size !== question.options.length) warnings.push(`${question.id}: duplicate option text`);
  if (!question.correctOptionIds.length || question.correctOptionIds.some((id) => !optionIds.has(id))) errors.push(`${question.id}: invalid answers`);
  if (question.type === "single" || question.type === "case") {
    if (question.correctOptionIds.length !== 1) errors.push(`${question.id}: single/case must have one answer`);
    else answerPositions[question.correctOptionIds[0]] += 1;
  }
  if (question.type === "multiple") {
    if (question.correctOptionIds.length < 2) errors.push(`${question.id}: multiple needs >=2 answers`);
    const combination = [...question.correctOptionIds].sort().join("");
    multiCombinations.set(combination, (multiCombinations.get(combination) || 0) + 1);
  }
  if (!question.citations?.length) errors.push(`${question.id}: missing citation`);
  for (const citation of question.citations || []) {
    if (!["scope", "authority"].includes(citation.kind)) errors.push(`${question.id}: invalid citation kind`);
    if (!citation.title || !citation.quote || !citation.locator) errors.push(`${question.id}: incomplete citation`);
    if (citation.localPath) {
      const local = citation.localPath.replace(/^\.\//, "").split("#")[0];
      if (!existsSync(resolve(root, local))) errors.push(`${question.id}: missing local citation file ${local}`);
    }
    if (citation.title.includes("一般业务水平评价测试大纲") && citation.page) {
      const page = outline.pages.find((item) => item.page === citation.page);
      if (!page || !page.text.replace(/\s+/g, "").includes(citation.quote.replace(/\s+/g, ""))) {
        errors.push(`${question.id}: outline quote does not match page ${citation.page}`);
      }
    }
  }
}

for (const [factId, count] of factCounts) {
  if (count !== 3) errors.push(`${factId}: expected 3 question variants, got ${count}`);
}
const positionValues = Object.values(answerPositions);
if (Math.max(...positionValues) - Math.min(...positionValues) > 15) errors.push(`unbalanced single answer positions ${JSON.stringify(answerPositions)}`);
if (multiCombinations.size < 6) errors.push("multiple choice answer combinations are too concentrated");
if (Math.max(...multiCombinations.values()) > payload.questions.filter((q) => q.type === "multiple").length * 0.3) errors.push("one multiple answer combination exceeds 30%");

const normalized = new Map();
for (const question of payload.questions) {
  const key = question.stem.replace(/[\s，。、“”：（）()]/g, "");
  if (normalized.has(key)) warnings.push(`similar stem: ${normalized.get(key)} / ${question.id}`);
  else normalized.set(key, question.id);
}

const counts = Object.groupBy(payload.questions, (question) => question.subjectId);
const typeCounts = Object.groupBy(payload.questions, (question) => question.type);
console.log(`Questions: ${payload.questions.length}`);
for (const [subject, items] of Object.entries(counts)) console.log(`  ${subject}: ${items.length}`);
for (const [type, items] of Object.entries(typeCounts)) console.log(`  type ${type}: ${items.length}`);
console.log(`Outline pages: ${outline.pages.length}; TOC items: ${outline.toc.length}`);
console.log(`Warnings: ${warnings.length}`);
if (warnings.length) console.log(warnings.slice(0, 20).map((item) => `  WARN ${item}`).join("\n"));
if (payload.questions.length < 300 || payload.questions.length > 500) errors.push("question count must be 300-500");
for (const subject of payload.subjects) {
  const subjectFacts = new Set(payload.questions.filter((q) => q.subjectId === subject.id).map((q) => q.factId));
  if (subjectFacts.size < 60) errors.push(`${subject.id}: needs at least 60 fact groups for 120-question two-pass blueprint`);
}
if ((typeCounts.case || []).length < 20) errors.push("case question coverage is below 20");
if (errors.length) {
  console.error(errors.map((item) => `ERROR ${item}`).join("\n"));
  process.exit(1);
}
console.log("Validation passed.");
