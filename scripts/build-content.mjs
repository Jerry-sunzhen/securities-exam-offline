import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { subjects, chapters } from "../content/catalog.mjs";
import { NOTE_SOURCES, TEXTBOOK_SOURCES, createMaterialContext, createNoteIndexes, bindQuestion, bindTextbook } from "./material-binding.mjs";
import { parseNotesSections, locateSection } from "./notes-sections.mjs";
import { cleanQuestion } from "./question-text.mjs";
import { sprintPlan } from "../content/sprint-plan.mjs";

// 内容全部来自内部材料：2026 新大纲三色笔记（讲义 + 题目定位）与两本教材（补充定位）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const dataDir = join(root, "data");
const vendorDir = join(root, "vendor");
const katexVendorDir = join(vendorDir, "katex");
mkdirSync(dataDir, { recursive: true });
mkdirSync(vendorDir, { recursive: true });
mkdirSync(katexVendorDir, { recursive: true });

const pdfName = "general-business-syllabus-2025.pdf";
const disciplineName = "discipline-and-law-syllabus-2026.doc";
const officialTextbookName = "base-knowledge.txt";
const officialTextbookViewerName = "base-knowledge.html";
const historicalLawTextbookName = "law-regulations.txt";
const historicalLawTextbookViewerName = "law-regulations.html";
const pdfPath = join(docsDir, pdfName);
const disciplinePath = join(docsDir, disciplineName);
const officialTextbookPath = join(docsDir, officialTextbookName);
const historicalLawTextbookPath = join(docsDir, historicalLawTextbookName);

const pages = JSON.parse(execFileSync("swift", [join(root, "scripts/extract-outline.swift"), pdfPath], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }))
  .map((page) => ({ text: page.text, title: page.title, page: page.page }));
const disciplineText = execFileSync("textutil", ["-convert", "txt", "-stdout", disciplinePath], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
const officialTextbookText = readFileSync(officialTextbookPath, "utf8");
const historicalLawTextbookText = readFileSync(historicalLawTextbookPath, "utf8");

function parseTextPages(text, expectedPageCount, label) {
  const parts = text.split(/^===== PDF 第 (\d+) 页 =====\s*$/m);
  const parsed = [];
  for (let index = 1; index < parts.length; index += 2) {
    parsed.push({ page: Number(parts[index]), text: parts[index + 1].trim() });
  }
  if (parsed.length !== expectedPageCount || parsed.some((page, index) => page.page !== index + 1)) {
    throw new Error(`${label} page sequence invalid: ${parsed.length} pages`);
  }
  return parsed;
}

const officialTextbookPages = parseTextPages(officialTextbookText, 568, "official finance textbook");
const historicalLawTextbookPages = parseTextPages(historicalLawTextbookText, 274, "historical law textbook");

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  })[character]);
}

function buildTextbookViewer(sourcePages, { title, heading, notice, internalPage }) {
  const sections = sourcePages.map((page) => `<article class="page" id="page-${page.page}"><header><strong>PDF 第 ${page.page} 页</strong>${internalPage(page) ? `<span>${escapeHtml(internalPage(page))}</span>` : ""}</header><pre>${escapeHtml(page.text)}</pre></article>`).join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="../styles.css" />
</head>
<body class="textbook-viewer">
  <header class="top"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(notice)}</span></header>
  <main>${sections}</main>
</body>
</html>\n`;
}

writeFileSync(join(docsDir, officialTextbookViewerName), buildTextbookViewer(officialTextbookPages, {
  title: "金融市场基础知识（2025）本地全文",
  heading: "《金融市场基础知识》（2025）本地全文",
  notice: "中国证券业协会编 · 扫描版识别文字可能有误，请以原书为准 · 可使用浏览器“在页面中查找”",
  internalPage: (page) => page.page >= 12 && page.page <= 566 ? `书内第 ${page.page - 11} 页` : ""
}));
writeFileSync(join(docsDir, historicalLawTextbookViewerName), buildTextbookViewer(historicalLawTextbookPages, {
  title: "证券市场基本法律法规（2020 商业备考教材）本地全文",
  heading: "《证券市场基本法律法规》（2020 商业备考教材）本地全文",
  notice: "历史辅助参考 · 非协会统编教材 · 非现行法律及考试答案依据 · 涉及规则必须核对最新官方文本 · 识别文字可能有误",
  internalPage: (page) => page.page >= 10 && page.page <= 271 ? `书内第 ${page.page - 9} 页` : ""
}));

function makeToc(sourcePages) {
  const toc = [];
  const pattern = /^(金融市场基础知识|证券市场基本法律法规|第[一二三四五六七八九十]+章[^\n]*|第[一二三四五六七八九十]+节[^\n]*)$/gm;
  for (const page of sourcePages.filter((entry) => entry.page >= 4 && entry.page !== 14)) {
    for (const match of page.text.matchAll(pattern)) {
      const title = match[1].trim();
      toc.push({ title, page: page.page, level: title.includes("章") || !title.includes("节") ? "chapter" : "section" });
    }
  }
  const seen = new Set();
  return toc.filter((item) => {
    const key = item.title;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function parsePagedSource(text) {
  const parts = text.split(/^===== PDF 第 (\d+) 页 =====\s*$/m);
  const list = [];
  for (let index = 1; index < parts.length; index += 2) list.push({ page: Number(parts[index]), text: parts[index + 1].trim() });
  return list;
}

const outline = {
  meta: { title: "证券行业专业人员一般业务水平评价测试大纲（2025）", pageCount: pages.length, effectiveFrom: "2026-01-01" },
  toc: makeToc(pages), pages,
  supplementToc: [{ title: "纪法知识大纲（2026）", page: 1, level: "chapter" }],
  supplements: [{ page: 1, title: "证券行业专业人员水平评价测试纪法知识大纲（2026）", text: disciplineText }]
};

// 三色笔记：既生成可翻阅的本地全文，也解析成讲义知识点。
const noteSources = NOTE_SOURCES.map((source) => {
  const text = readFileSync(join(docsDir, source.textName), "utf8");
  const pageList = parsePagedSource(text);
  if (!pageList.length) throw new Error(`${source.textName}: no pages parsed`);
  writeFileSync(join(docsDir, source.viewerName), buildTextbookViewer(pageList, {
    title: `${source.title} 本地全文`,
    heading: `${source.title} 本地全文`,
    notice: "用户提供的 2026 新大纲备考笔记 · 识别文字可能有误，请以原文件为准 · 可使用浏览器“在页面中查找”",
    internalPage: () => ""
  }));
  const pageMap = new Map(pageList.map((page) => [page.page, page.text]));
  const sections = parseNotesSections({ pages: pageMap, chapters, subjectId: source.subjectId, idPrefix: source.id === "notes-finance" ? "K-F" : "K-L" });
  if (!sections.length) throw new Error(`${source.textName}: no knowledge sections parsed`);
  return { ...source, pages: pageMap, sections, pageCount: pageList.length, localTextPath: `./docs/${source.textName}`, localViewerPath: `./docs/${source.viewerName}` };
});

const materialContext = createMaterialContext({ docsDir });
materialContext.indexes = createNoteIndexes(materialContext, chapters);

const knowledgePoints = [];
for (const entry of noteSources) {
  for (const section of entry.sections) {
    knowledgePoints.push({
      id: section.id,
      subjectId: section.subjectId,
      chapterId: section.chapterId,
      topic: section.topic,
      number: section.number,
      page: section.page,
      pageEnd: section.pageEnd,
      points: section.lines,
      bookLinks: section.bookLinks.map((link) => ({
        sourceId: entry.id,
        sourceLabel: entry.label,
        sourceTitle: entry.title,
        kind: "notes",
        page: link.page,
        quote: link.quote,
        localPath: `./docs/${entry.viewerName}`,
        method: "section",
        reviewStatus: "verified"
      }))
    });
  }
}
for (const point of knowledgePoints) {
  const textbook = bindTextbook(point, materialContext);
  if (textbook) point.bookLinks.push(textbook);
}

const importedPath = join(root, "content/imported-exams.json");
const imported = existsSync(importedPath) ? JSON.parse(readFileSync(importedPath, "utf8")) : null;
const importedQuestions = imported?.questions || [];
// 题目文本来自 PDF 识别，先统一清洗水印、断行、标点与混入的后续题目，再做材料绑定。
const correctionsPath = join(root, "content/exam-corrections.json");
const corrections = new Map((existsSync(correctionsPath) ? JSON.parse(readFileSync(correctionsPath, "utf8")) : []).map((item) => [item.id, item]));
const textStats = { changed: 0 };
for (const question of importedQuestions) {
  const result = cleanQuestion(question, { corrections });
  if (result.changed) textStats.changed += 1;
}
const bindingStats = { bound: 0, notes: 0, textbook: 0, knowledgeWithTextbook: knowledgePoints.filter((point) => point.bookLinks.some((link) => link.kind === "textbook")).length };
for (const question of importedQuestions) {
  const entry = noteSources.find((source) => source.subjectId === question.subjectId);
  if (!entry) throw new Error(`${question.id}: 缺少对应科目的笔记`);
  // 第一遍整本检索定位，第二遍在推导出的章节内收紧一次。
  const first = bindQuestion(question, materialContext);
  if (!first.length) throw new Error(`${question.id}: 无法绑定备考笔记出处`);
  const firstSection = locateSection(entry.sections, first[0].page, first[0].quote, entry.pages.get(first[0].page) || "") || entry.sections[0];
  const second = bindQuestion(question, materialContext, firstSection.chapterId);
  const link = second[0] || first[0];
  const section = locateSection(entry.sections, link.page, link.quote, entry.pages.get(link.page) || "") || firstSection;
  const point = knowledgePoints.find((item) => item.id === section.id);
  delete question.factId;
  question.chapterId = point.chapterId;
  question.knowledgeLinks = [{ knowledgeId: point.id, topic: point.topic, page: point.page, score: link.score, method: "notes_section", reviewStatus: "verified" }];
  question.bookLinks = [link, ...point.bookLinks.filter((item) => item.kind === "textbook").map((item) => ({ ...item, method: "knowledge_point" }))];
  bindingStats.bound += 1;
  if (question.bookLinks.some((item) => item.kind === "notes")) bindingStats.notes += 1;
  if (question.bookLinks.some((item) => item.kind === "textbook")) bindingStats.textbook += 1;
}

const allQuestions = [...importedQuestions];
const questionPayload = {
  meta: {
    title: "证券从业内部资料题库",
    questionCount: allQuestions.length,
    importedQuestionCount: importedQuestions.length,
    eligibleQuestionCount: allQuestions.filter((question) => question.examEligible !== false).length,
    importedSourceCount: imported?.sources?.length || 0,
    importedHeldCount: allQuestions.filter((question) => question.examEligible === false).length,
    cleanedQuestionCount: textStats.changed,
    knowledgePointCount: knowledgePoints.length,
    caseGroupCount: new Set(allQuestions.filter((question) => question.type === "case").map((question) => question.caseGroupId || question.id)).size,
    caseQuestionCount: allQuestions.filter((question) => question.type === "case").length,
    conditionalCaseQuestionCount: allQuestions.filter((question) => question.type === "judgment" && question.caseGroupId).length,
    materialBinding: {
      boundQuestionCount: bindingStats.bound,
      notesBoundQuestionCount: bindingStats.notes,
      textbookBoundQuestionCount: bindingStats.textbook,
      boundKnowledgePointCount: knowledgePoints.length,
      textbookBoundKnowledgePointCount: bindingStats.knowledgeWithTextbook
    },
    materialSources: [
      ...noteSources.map((source) => ({
        id: source.id,
        kind: "notes",
        subjectId: source.subjectId,
        title: source.title,
        pageCount: source.pageCount,
        localTextPath: source.localTextPath,
        localViewerPath: source.localViewerPath,
        notice: source.notice
      })),
      ...TEXTBOOK_SOURCES.map((source) => ({
        id: source.id,
        kind: "textbook",
        subjectId: source.subjectId,
        title: source.title,
        pageCount: source.id === "base-knowledge" ? officialTextbookPages.length : historicalLawTextbookPages.length,
        localTextPath: `./docs/${source.textName}`,
        localViewerPath: source.viewerPath,
        notice: source.id === "base-knowledge"
          ? "中国证券业协会统编教材，扫描版识别文本可能存在误差，请以原书页面为准。"
          : "2020 历史辅助教材，仅用于定位复习，涉及规则必须核对最新官方文本。"
      }))
    ],
    outlineVersion: "一般业务大纲2025 + 纪法大纲2026",
    contentCutoff: "2026-08-18",
    disclaimer: "讲义与题目均来自本地内部资料：讲义按 2026 新大纲三色笔记的「知识点」原文整理，题目为历年试题整理资料，答案与解析按原资料保存；不是官方题库，也不代表官方答案。"
  },
  subjects, chapters, knowledgePoints, questions: allQuestions,
  importedSources: imported?.sources || [],
  importedUnparsed: imported?.unparsed || []
};

writeFileSync(join(dataDir, "outline.json"), JSON.stringify(outline, null, 2));
writeFileSync(join(dataDir, "questions.json"), JSON.stringify(questionPayload, null, 2));
writeFileSync(join(dataDir, "outline.js"), `window.OUTLINE_DATA = ${JSON.stringify(outline)};\n`);
writeFileSync(join(dataDir, "questions.js"), `window.QUESTION_DATA = ${JSON.stringify(questionPayload)};\n`);
writeFileSync(join(dataDir, "sprint-plan.js"), `window.SPRINT_PLAN = ${JSON.stringify(sprintPlan)};\n`);
copyFileSync(join(root, "node_modules/sql.js/dist/sql-wasm.js"), join(vendorDir, "sql-wasm.js"));
const wasmBase64 = readFileSync(join(root, "node_modules/sql.js/dist/sql-wasm.wasm")).toString("base64");
writeFileSync(join(vendorDir, "sql-wasm-data.js"), `window.SQL_WASM_BASE64 = "${wasmBase64}";\n`);
const katexDistDir = join(root, "node_modules/katex/dist");
copyFileSync(join(katexDistDir, "katex.min.js"), join(katexVendorDir, "katex.min.js"));
copyFileSync(join(katexDistDir, "katex.min.css"), join(katexVendorDir, "katex.min.css"));
cpSync(join(katexDistDir, "fonts"), join(katexVendorDir, "fonts"), { recursive: true });
console.log(`Built ${allQuestions.length} imported questions, ${knowledgePoints.length} note knowledge points (${bindingStats.knowledgeWithTextbook} with textbook page), ${bindingStats.notes} questions bound to notes; outline ${pages.length} pages.`);
