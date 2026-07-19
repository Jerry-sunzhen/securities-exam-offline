import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { subjects, chapters } from "../content/catalog.mjs";
import { facts } from "../content/facts.mjs";
import { caseScenarios } from "../content/cases.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const dataDir = join(root, "data");
const vendorDir = join(root, "vendor");
mkdirSync(dataDir, { recursive: true });
mkdirSync(vendorDir, { recursive: true });

const pdfName = "general-business-syllabus-2025.pdf";
const disciplineName = "discipline-and-law-syllabus-2026.doc";
const pdfPath = join(docsDir, pdfName);
const disciplinePath = join(docsDir, disciplineName);

const pages = JSON.parse(execFileSync("swift", [join(root, "scripts/extract-outline.swift"), pdfPath], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }))
  .map((page) => ({ text: page.text, title: page.title, page: page.page }));
const disciplineText = execFileSync("textutil", ["-convert", "txt", "-stdout", disciplinePath], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();

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

function findOutlineCitation(fact) {
  if (fact.supplementSearch) {
    const queries = Array.isArray(fact.supplementSearch) ? fact.supplementSearch : [fact.supplementSearch];
    const compact = disciplineText.replace(/\s+/g, "");
    const normalizedQueries = queries.map((query) => query.replace(/\s+/g, ""));
    const query = normalizedQueries.find((item) => compact.includes(item));
    if (!query) throw new Error(`${fact.id}: cannot locate discipline citation for ${queries.join(" / ")}`);
    const index = compact.indexOf(query);
    return {
      kind: "scope",
      title: "《证券行业专业人员水平评价测试纪法知识大纲（2026）》",
      locator: "一般业务法规科增补范围",
      quote: compact.slice(Math.max(0, index - 70), Math.min(compact.length, index + query.length + 220)),
      page: null,
      localPath: `./docs/${disciplineName}`,
      url: "https://www.sac.net.cn/pxzx/pxzdydg/202511/t20251110_68680.html",
      effectiveDate: "2026年6月版"
    };
  }
  const queries = Array.isArray(fact.citationSearch) ? fact.citationSearch : [fact.citationSearch || fact.topic];
  const contentPages = pages.filter((entry) => fact.subjectId === "finance" ? entry.page >= 4 && entry.page <= 13 : entry.page >= 14);
  const normalizedQueries = queries.map((query) => query.replace(/\s+/g, ""));
  const page = contentPages.find((entry) => {
    const compact = entry.text.replace(/\s+/g, "");
    return normalizedQueries.every((query) => compact.includes(query));
  }) || contentPages.find((entry) => {
    const compact = entry.text.replace(/\s+/g, "");
    return normalizedQueries.some((query) => compact.includes(query));
  });
  if (!page) throw new Error(`${fact.id}: cannot locate outline citation for ${queries.join(" / ")}`);
  const quoteSource = page.text.replace(/\s+/g, "");
  const query = normalizedQueries.find((item) => quoteSource.includes(item));
  if (!query) throw new Error(`${fact.id}: outline page found but query missing`);
  const index = quoteSource.indexOf(query);
  const start = Math.max(0, index - 80);
  const end = Math.min(quoteSource.length, index + query.length + 220);
  return {
    kind: "scope",
    title: "《证券行业专业人员一般业务水平评价测试大纲（2025）》",
    locator: `${chapters.find((c) => c.id === fact.chapterId)?.title || ""} · PDF第${page.page}页`,
    quote: quoteSource.slice(start, end).trim(),
    page: page.page,
    localPath: `./docs/${pdfName}`,
    url: "https://www.sac.net.cn/pxzx/pxzdydg/202511/t20251110_68680.html",
    effectiveDate: "2026-01-01"
  };
}

function optionize(values) {
  return values.map((text, index) => ({ id: String.fromCharCode(65 + index), text }));
}

function stableShuffle(values, key) {
  let seed = [...key].reduce((total, char) => (total * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildQuestions() {
  const output = [];
  const knowledgePoints = [];
  for (const fact of facts) {
    const outlineCitation = findOutlineCitation(fact);
    const citations = [
      outlineCitation,
      ...(fact.authorityCitations || []).map((citation) => ({ kind: "authority", ...citation }))
    ];
    knowledgePoints.push({
      id: fact.id,
      subjectId: fact.subjectId,
      chapterId: fact.chapterId,
      level: fact.level,
      topic: fact.topic,
      statement: fact.statement,
      explanation: fact.explanation,
      keyPoints: fact.correctPoints,
      commonMistakes: fact.incorrectPoints,
      citations
    });
    const caseScenario = caseScenarios[fact.id];
    const singleValues = [fact.statement, ...fact.incorrectPoints.slice(0, 3)];
    const singleOrder = stableShuffle(singleValues, `${fact.id}-single`);
    const singleOptions = optionize(singleOrder);
    output.push({
      id: `${fact.id}-S`, version: 1, subjectId: fact.subjectId, chapterId: fact.chapterId,
      factId: fact.id, verificationStatus: "outline_checked",
      type: caseScenario ? "case" : "single", level: fact.level, difficulty: fact.difficulty || "medium",
      stem: caseScenario?.stem || fact.singleStem || `关于${fact.topic}，下列表述正确的是（）。`, caseMaterial: caseScenario?.material || null,
      options: singleOptions, correctOptionIds: [singleOptions.find((option) => option.text === fact.statement).id],
      explanation: fact.explanation, optionExplanations: fact.optionExplanations || null,
      citations, negation: Boolean(fact.negation)
    });

    const judgmentTrue = Number(fact.id.replace(/\D/g, "")) % 2 === 0;
    const judgmentStatement = judgmentTrue ? fact.statement : fact.falseStatement;
    output.push({
      id: `${fact.id}-J`, version: 1, subjectId: fact.subjectId, chapterId: fact.chapterId,
      factId: fact.id, verificationStatus: "outline_checked",
      type: "judgment", level: fact.level, difficulty: fact.difficulty || "easy",
      stem: `${judgmentStatement}（判断正误）`,
      options: [{ id: "A", text: "正确" }, { id: "B", text: "错误" }],
      correctOptionIds: [judgmentTrue ? "A" : "B"], explanation: fact.explanation,
      citations, negation: false
    });

    const multiValues = [...fact.correctPoints, ...fact.incorrectPoints].slice(0, 5);
    const multiOrder = stableShuffle(multiValues, `${fact.id}-multiple`);
    const multiOptions = optionize(multiOrder);
    output.push({
      id: `${fact.id}-M`, version: 1, subjectId: fact.subjectId, chapterId: fact.chapterId,
      factId: fact.id, verificationStatus: "outline_checked",
      type: "multiple", level: fact.level, difficulty: fact.difficulty || "medium",
      stem: fact.multiStem || `关于${fact.topic}，下列说法正确的有（）。`,
      options: multiOptions,
      correctOptionIds: multiOptions.filter((option) => fact.correctPoints.includes(option.text)).map((option) => option.id),
      explanation: fact.explanation, citations, negation: false
    });
  }
  return { questions: output, knowledgePoints };
}

const { questions, knowledgePoints } = buildQuestions();
const outline = {
  meta: { title: "证券行业专业人员一般业务水平评价测试大纲（2025）", pageCount: pages.length, effectiveFrom: "2026-01-01" },
  toc: makeToc(pages), pages,
  supplementToc: [{ title: "纪法知识大纲（2026）", page: 1, level: "chapter" }],
  supplements: [{ page: 1, title: "证券行业专业人员水平评价测试纪法知识大纲（2026）", text: disciplineText }]
};
const questionPayload = {
  meta: {
    title: "证券从业原创离线题库",
    questionCount: questions.length,
    factCount: facts.length,
    outlineVersion: "一般业务大纲2025 + 纪法大纲2026",
    contentCutoff: "2026-07-17",
    disclaimer: "依据官方公开范围原创，不是官方题库、真题或押题。"
  },
  subjects, chapters, knowledgePoints, questions
};

writeFileSync(join(dataDir, "outline.json"), JSON.stringify(outline, null, 2));
writeFileSync(join(dataDir, "questions.json"), JSON.stringify(questionPayload, null, 2));
writeFileSync(join(dataDir, "outline.js"), `window.OUTLINE_DATA = ${JSON.stringify(outline)};\n`);
writeFileSync(join(dataDir, "questions.js"), `window.QUESTION_DATA = ${JSON.stringify(questionPayload)};\n`);
copyFileSync(join(root, "node_modules/sql.js/dist/sql-wasm.js"), join(vendorDir, "sql-wasm.js"));
const wasmBase64 = readFileSync(join(root, "node_modules/sql.js/dist/sql-wasm.wasm")).toString("base64");
writeFileSync(join(vendorDir, "sql-wasm-data.js"), `window.SQL_WASM_BASE64 = "${wasmBase64}";\n`);
console.log(`Built ${questions.length} questions from ${facts.length} facts; outline ${pages.length} pages.`);
