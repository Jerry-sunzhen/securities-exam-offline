import { existsSync, readFileSync } from "node:fs";
import { questionTextIssues } from "./question-text.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payload = JSON.parse(readFileSync(resolve(root, "data/questions.json"), "utf8"));
const outline = JSON.parse(readFileSync(resolve(root, "data/outline.json"), "utf8"));
const officialTextbookText = readFileSync(resolve(root, "docs/base-knowledge.txt"), "utf8");
const historicalLawTextbookText = readFileSync(resolve(root, "docs/law-regulations.txt"), "utf8");
const errors = [];
const warnings = [];

const countPages = (text) => {
  const parts = text.split(/^===== PDF 第 (\d+) 页 =====\s*$/m);
  return (parts.length - 1) / 2;
};
if (countPages(officialTextbookText) !== 568) errors.push("official finance textbook text must contain 568 pages");
if (countPages(historicalLawTextbookText) !== 274) errors.push("historical law textbook text must contain 274 pages");

const chapterIds = new Set(payload.chapters.map((item) => item.id));
const subjectIds = new Set(payload.subjects.map((item) => item.id));
const materialPages = new Map();
for (const source of payload.meta?.materialSources || []) {
  const text = readFileSync(resolve(root, source.localTextPath.replace(/^\.\//, "")), "utf8");
  const pages = new Map();
  const parts = text.split(/^===== PDF 第 (\d+) 页 =====\s*$/m);
  for (let index = 1; index < parts.length; index += 2) pages.set(Number(parts[index]), parts[index + 1]);
  materialPages.set(source.id, { source, pages });
}

function validateBookLinks(links, owner, { requireNotes = false } = {}) {
  if (!links?.length) { errors.push(`${owner}: 缺少材料出处绑定`); return; }
  for (const link of links) {
    if (!link.sourceId || !link.localPath) errors.push(`${owner}: 出处绑定缺少来源信息`);
    const material = materialPages.get(link.sourceId);
    if (!material) { errors.push(`${owner}: 出处绑定引用了未知来源 ${link.sourceId}`); continue; }
    if (!Number.isInteger(link.page) || link.page < 1 || link.page > material.source.pageCount) errors.push(`${owner}: 出处页码 ${link.page} 超出 ${link.sourceId} 范围`);
    if (!link.quote || link.quote.replace(/\s+/g, "").length < 20) errors.push(`${owner}: 出处绑定缺少可核对原文`);
    const pageText = material.pages.get(link.page) || "";
    if (link.quote && !pageText.replace(/\s+/g, "").includes(link.quote.replace(/\s+/g, ""))) errors.push(`${owner}: 出处原文与 ${link.sourceId} 第 ${link.page} 页不一致`);
    if (!new Set(["verified", "suggested"]).has(link.reviewStatus)) errors.push(`${owner}: 出处绑定核验状态无效`);
    if (!new Set(["notes", "textbook"]).has(link.kind)) errors.push(`${owner}: 出处绑定类型无效`);
    if (!existsSync(resolve(root, link.localPath.replace(/^\.\//, "")))) errors.push(`${owner}: 出处阅读文件不存在 ${link.localPath}`);
  }
  if (requireNotes && !links.some((link) => link.kind === "notes")) errors.push(`${owner}: 缺少三色笔记出处`);
}

// 讲义必须完全来自内部材料：只允许笔记原文与教材页码，不允许第一版的人工归纳字段。
const knowledgeIds = new Set();
if (payload.knowledgePoints?.length !== payload.meta.knowledgePointCount) errors.push("knowledge point count metadata is stale");
for (const point of payload.knowledgePoints || []) {
  if (knowledgeIds.has(point.id)) errors.push(`duplicate knowledge point ${point.id}`);
  knowledgeIds.add(point.id);
  if (!/^K-[FL]-\d{3}$/.test(point.id)) errors.push(`${point.id}: invalid knowledge point id`);
  if (!subjectIds.has(point.subjectId)) errors.push(`${point.id}: unknown subject`);
  if (!chapterIds.has(point.chapterId)) errors.push(`${point.id}: unknown chapter`);
  if (!point.topic) errors.push(`${point.id}: missing topic`);
  if (!Array.isArray(point.points) || point.points.length < 1) errors.push(`${point.id}: missing note text`);
  if (!Number.isInteger(point.page) || point.page < 1) errors.push(`${point.id}: missing note page`);
  for (const legacy of ["statement", "explanation", "keyPoints", "commonMistakes", "memoryHook", "detailSections", "examTips", "citations", "level"]) {
    if (point[legacy] !== undefined) errors.push(`${point.id}: 讲义不应再包含第一版字段 ${legacy}`);
  }
  validateBookLinks(point.bookLinks, point.id, { requireNotes: true });
}

const knownKnowledge = new Map((payload.knowledgePoints || []).map((point) => [point.id, point]));
const ids = new Set();
const multiCombination = new Map();
const caseGroups = new Map();
for (const question of payload.questions) {
  if (ids.has(question.id)) errors.push(`duplicate id ${question.id}`);
  ids.add(question.id);
  if (!/^IMP-[FL]-[a-f0-9]{16}$/.test(question.id)) errors.push(`${question.id}: invalid id`);
  for (const legacy of ["factId", "level", "citations", "difficulty", "statement", "keyPoints"]) {
    if (question[legacy] !== undefined) errors.push(`${question.id}: 题目不应再保留第一版字段 ${legacy}`);
  }
  if (!subjectIds.has(question.subjectId)) errors.push(`${question.id}: unknown subject`);
  if (!chapterIds.has(question.chapterId)) errors.push(`${question.id}: unknown chapter`);
  if (!["single", "multiple", "judgment", "case"].includes(question.type)) errors.push(`${question.id}: invalid type`);
  if (!question.stem || !Array.isArray(question.options) || question.options.length < 2) errors.push(`${question.id}: incomplete question`);
  if (!Array.isArray(question.correctOptionIds) || !question.correctOptionIds.length) errors.push(`${question.id}: answer missing`);
  if (question.examEligible !== false && question.correctOptionIds.some((id) => !question.options.some((option) => option.id === id))) errors.push(`${question.id}: answer not in options`);
  if (!question.origins?.length || !question.origins[0].sourceId) errors.push(`${question.id}: source provenance missing`);
  if (question.type === "multiple" && question.examEligible !== false) {
    const key = [...question.correctOptionIds].sort().join("");
    multiCombination.set(key, (multiCombination.get(key) || 0) + 1);
  }
  if (question.type === "case") {
    if (!question.caseMaterial || !question.caseGroupId || !question.caseOrder || !question.caseGroupSize) errors.push(`${question.id}: incomplete case metadata`);
    const group = caseGroups.get(question.caseGroupId) || [];
    group.push(question);
    caseGroups.set(question.caseGroupId, group);
  }
  const links = question.knowledgeLinks || [];
  if (links.length !== 1) errors.push(`${question.id}: 每道题应绑定到唯一一条笔记知识点`);
  for (const link of links) {
    const point = knownKnowledge.get(link.knowledgeId);
    if (!point) errors.push(`${question.id}: 知识点 ${link.knowledgeId} 不存在`);
    else if (point.subjectId !== question.subjectId) errors.push(`${question.id}: 知识点与题目科目不一致`);
  }
  validateBookLinks(question.bookLinks, question.id, { requireNotes: true });
}

if (caseGroups.size) {
  for (const [groupId, items] of caseGroups) {
    const expectedSize = items[0].caseGroupSize;
    if (expectedSize !== items.length) errors.push(`${groupId}: case group size ${items.length} does not match ${expectedSize}`);
    if (new Set(items.map((item) => item.caseMaterial)).size !== 1) errors.push(`${groupId}: case group must share one material`);
    if (new Set(items.map((item) => item.subjectId)).size !== 1) errors.push(`${groupId}: case group crosses subjects`);
    const orders = items.map((item) => item.caseOrder).sort((left, right) => left - right);
    if (orders.join(",") !== [...orders.keys()].map((index) => index + 1).join(",")) errors.push(`${groupId}: case question order is not consecutive`);
  }
}

// 题干、选项、解析必须是清洗后的文本：不能残留水印、页码、混入的后续题目或重复标点。
// 解析也不该停在「监事会的职权有：」这种引导语上：那说明来源里的分条内容被切掉了。
const danglingExplanation = /[，、；：]?\s*(?:有|包括|如下|如下所示|以下|分别是|情形有|条件有|职责有|内容有|特点有|特征有|需要|应当)\s*[：:]\s*$/;
let textIssueCount = 0;
for (const question of payload.questions) {
  for (const issue of questionTextIssues(question)) {
    errors.push(`${question.id}: ${issue}`);
    textIssueCount += 1;
  }
  if (danglingExplanation.test(String(question.explanation || "").trim())) errors.push(`${question.id}: 解析停在引导语上，分条内容疑似被截断`);
  if (question.examEligible === false && !question.issues?.length) errors.push(`${question.id}: 不可练习的题目必须写明原因`);
}
console.log(`Text cleanup issues: ${textIssueCount}`);

// 解析完整性：每道题都要有解析；联网补充的解析必须能回查到官方页面。
const PLACEHOLDER = /原资料未提供可用解析/;
const EXPLANATION_SOURCES = new Set(["local-materials-ai", "official-web"]);
const explanationStats = { placeholder: [], supplemented: 0, webVerified: 0 };
for (const question of payload.questions) {
  const text = String(question.explanation || "").trim();
  if (!text) errors.push(`${question.id}: 缺少解析`);
  else if (PLACEHOLDER.test(text)) explanationStats.placeholder.push(question.id);
  const source = question.explanationSource;
  if (source !== undefined) {
    if (!EXPLANATION_SOURCES.has(source)) errors.push(`${question.id}: 未知的解析来源 ${source}`);
    else explanationStats.supplemented += 1;
    if (source === "official-web") explanationStats.webVerified += 1;
  }
  if (source === "official-web") {
    const references = Array.isArray(question.explanationReferences) ? question.explanationReferences : [];
    if (!references.length) errors.push(`${question.id}: 联网补充的解析缺少来源页面`);
    for (const reference of references) {
      if (!/^https?:\/\//i.test(String(reference.url || ""))) errors.push(`${question.id}: 解析来源不是可访问的链接`);
      if (!reference.fetchedAt) errors.push(`${question.id}: 解析来源缺少抓取日期`);
    }
  }
  for (const checked of Array.isArray(question.explanationCheckedSources) ? question.explanationCheckedSources : []) {
    if (!/^https?:\/\//i.test(String(checked.url || ""))) errors.push(`${question.id}: 联网核验页面不是可访问的链接`);
  }
}
console.log(`讲解补充: ${explanationStats.supplemented} 题（其中联网核验 ${explanationStats.webVerified} 题），仍为占位解析 ${explanationStats.placeholder.length} 题`);
if (explanationStats.placeholder.length) {
  const bySubject = new Map();
  for (const id of explanationStats.placeholder) {
    const subject = payload.questions.find((question) => question.id === id)?.subjectId || "unknown";
    bySubject.set(subject, (bySubject.get(subject) || 0) + 1);
  }
  console.log(`  占位解析分布：${[...bySubject.entries()].map(([key, value]) => `${key} ${value}`).join("，")}`);
}

const normalized = new Map();
for (const question of payload.questions) {
  const key = question.stem.replace(/[\s，。、“”：（）()]/g, "");
  if (normalized.has(key)) warnings.push(`similar stem: ${normalized.get(key)} / ${question.id}`);
  else normalized.set(key, question.id);
}

const bySubject = Object.groupBy(payload.questions, (question) => question.subjectId);
const byType = Object.groupBy(payload.questions, (question) => question.type);
console.log(`Questions: ${payload.questions.length}`);
for (const [subject, items] of Object.entries(bySubject)) console.log(`  ${subject}: ${items.length}`);
for (const [type, items] of Object.entries(byType)) console.log(`  type ${type}: ${items.length}`);
console.log(`Knowledge points: ${payload.knowledgePoints.length}`);

if (payload.meta.questionCount !== payload.questions.length || payload.meta.importedQuestionCount !== payload.questions.length) errors.push("question count metadata is stale");
if (payload.meta.eligibleQuestionCount !== payload.questions.filter((q) => q.examEligible !== false).length) errors.push("eligible question metadata is stale");
if (payload.meta.materialBinding?.boundQuestionCount !== payload.questions.length) errors.push("material binding metadata is stale");
if (payload.meta.materialBinding?.notesBoundQuestionCount !== payload.questions.length) errors.push("every question must bind to a note page");
if (payload.meta.materialBinding?.boundKnowledgePointCount !== payload.knowledgePoints.length) errors.push("knowledge point binding metadata is stale");
if (payload.questions.length < 2000) errors.push("question bank must keep the imported past-exam records");
if (!outline.pages?.length) errors.push("outline pages missing");

for (const subject of payload.subjects) {
  const eligible = (bySubject[subject.id] || []).filter((q) => q.examEligible !== false);
  for (const [type, count] of Object.entries({ single: 40, multiple: 40, judgment: 30, case: 10 })) {
    const stems = new Set(eligible.filter((q) => q.type === type).map((q) => q.stem));
    if (stems.size < count) errors.push(`${subject.id}: ${type} 可用题量不足（${stems.size}/${count}），无法生成模考`);
  }
  const groups = new Set(eligible.map((q) => q.knowledgeLinks?.[0]?.knowledgeId).filter(Boolean));
  if (groups.size < 120) warnings.push(`${subject.id}: 知识点组数 ${groups.size}，模考去重会更激进`);
  const subjectGroups = [...caseGroups.values()].filter((items) => items[0].subjectId === subject.id);
  if (subjectGroups.length < 5) errors.push(`${subject.id}: needs at least five complete case groups`);
  if (payload.meta.caseGroupCount !== caseGroups.size) errors.push("case group metadata is stale");
}
if (payload.meta.caseQuestionCount !== (byType.case || []).length) errors.push("case question metadata is stale");
if ((byType.case || []).length < 20) errors.push("case question coverage is below 20");
if (multiCombination.size < 6) warnings.push("multiple choice answer combinations are concentrated");
const multipleTotal = (byType.multiple || []).length;
if (multipleTotal && Math.max(...multiCombination.values()) > multipleTotal * 0.3) warnings.push("one multiple answer combination exceeds 30%");

if (errors.length) {
  console.error(errors.map((item) => `ERROR ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Warnings: ${warnings.length}`);
if (warnings.length) console.log(warnings.slice(0, 20).map((item) => `  WARN ${item}`).join("\n"));
console.log("Validation passed.");
