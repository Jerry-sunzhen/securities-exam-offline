import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { subjects, chapters } from "../content/catalog.mjs";
import { facts } from "../content/facts.mjs";
import { casePacks, caseScenarios } from "../content/cases.mjs";
import { financeReferenceMap } from "../content/finance-references.mjs";
import { officialFinanceTextbookNeedles } from "../content/official-finance-textbook.mjs";
import { historicalLawTextbookLocators } from "../content/historical-law-textbook.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(root, "docs");
const dataDir = join(root, "data");
const vendorDir = join(root, "vendor");
mkdirSync(dataDir, { recursive: true });
mkdirSync(vendorDir, { recursive: true });

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

const normalizeText = (value) => String(value || "").replace(/\s+/g, "");

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
const officialTextbookRanges = {
  "finance-1": [12, 45],
  "finance-2": [46, 123],
  "finance-3": [124, 206],
  "finance-4": [207, 293],
  "finance-5": [294, 400],
  "finance-6": [401, 452],
  "finance-7": [453, 508],
  "finance-8": [509, 566]
};

function extractTextbookQuote(pageText, needle) {
  const text = normalizeText(pageText);
  const normalizedNeedle = normalizeText(needle);
  const matchIndex = text.indexOf(normalizedNeedle);
  if (matchIndex < 0) throw new Error(`official textbook quote missing needle: ${needle}`);

  let start = matchIndex;
  for (let index = matchIndex - 1; index >= Math.max(0, matchIndex - 90); index -= 1) {
    if (/[。！？；]/.test(text[index])) { start = index + 1; break; }
  }

  let end = Math.min(text.length, matchIndex + normalizedNeedle.length + 420);
  let sentenceCount = 0;
  let lastBoundary = -1;
  for (let index = matchIndex + normalizedNeedle.length; index < end; index += 1) {
    if (/[。！？]/.test(text[index])) {
      sentenceCount += 1;
      lastBoundary = index + 1;
      if (sentenceCount === 2) { end = index + 1; break; }
    }
  }
  if (sentenceCount < 2 && lastBoundary > matchIndex + normalizedNeedle.length) end = lastBoundary;
  return text.slice(start, end);
}

function extractHistoricalTextbookQuote(pageText, needle, endNeedle = "") {
  const quote = extractTextbookQuote(pageText, needle);
  const maxLength = 360;
  const normalizedNeedle = normalizeText(needle);
  const matchIndex = quote.indexOf(normalizedNeedle);
  if (endNeedle) {
    const normalizedEndNeedle = normalizeText(endNeedle);
    const endIndex = quote.indexOf(normalizedEndNeedle, matchIndex);
    if (endIndex < 0) throw new Error(`historical textbook quote missing end needle: ${endNeedle}`);
    return quote.slice(0, endIndex + normalizedEndNeedle.length);
  }
  for (let index = matchIndex + normalizedNeedle.length; index < Math.min(quote.length, maxLength); index += 1) {
    if (/[。！？；]/.test(quote[index])) return quote.slice(0, index + 1);
  }
  if (quote.length <= maxLength) return quote;

  const shortened = quote.slice(0, maxLength);
  const minimumBoundary = Math.max(120, shortened.indexOf(normalizedNeedle) + normalizedNeedle.length);
  for (let index = shortened.length - 1; index >= minimumBoundary; index -= 1) {
    if (/[。！？；]/.test(shortened[index])) return shortened.slice(0, index + 1);
  }
  return shortened;
}

function findOfficialTextbookCitations(fact) {
  if (fact.subjectId !== "finance") return [];
  const configuredNeedles = officialFinanceTextbookNeedles[fact.id];
  const fallbackNeedle = fact.textbookSearch || fact.topic;
  const needles = configuredNeedles?.length
    ? configuredNeedles
    : [Array.isArray(fallbackNeedle) ? fallbackNeedle[0] : fallbackNeedle];
  if (!needles?.length) throw new Error(`${fact.id}: missing official textbook locator`);
  const [firstPage, lastPage] = officialTextbookRanges[fact.chapterId] || [];
  if (!firstPage) throw new Error(`${fact.id}: missing official textbook chapter range`);

  return needles.map((needle) => {
    const normalizedNeedle = normalizeText(needle);
    const matches = officialTextbookPages.filter((page) =>
      page.page >= firstPage && page.page <= lastPage && normalizeText(page.text).includes(normalizedNeedle)
    );
    if (!matches.length) {
      throw new Error(`${fact.id}: official textbook match missing for “${needle}”`);
    }
    // Curated legacy locators are unique. Expansion facts may deliberately use a
    // repeated textbook term; the first match inside the fact's chapter is a
    // stable, reviewable anchor and the extracted quote is still validated.
    const page = matches[0];
    return {
      kind: "authority",
      sourceClass: "china_official_textbook",
      jurisdiction: "中国大陆 / 证券业一般业务水平评价测试",
      answerBasis: true,
      title: "《金融市场基础知识》（证券行业专业人员一般业务水平评价测试统编教材 2025）",
      publisher: "中国证券业协会编，中国财政经济出版社出版",
      locator: `PDF 第${page.page}页 · 书内第${page.page - 11}页`,
      quote: extractTextbookQuote(page.text, needle),
      page: page.page,
      localPath: `./docs/${officialTextbookViewerName}`,
      fullTextPath: `./docs/${officialTextbookName}`,
      url: "https://www.sac.net.cn/fwdt/ksfw/jcdg/202512/t20251231_70825.html",
      effectiveDate: "2025年版（内容更新截至2025年9月）",
      textNotice: "本段来自扫描版识别文本，可能存在同形字、标点或表格识别误差，请以原书页面为准。"
    };
  });
}

function findHistoricalLawTextbookCitations(fact) {
  if (fact.subjectId !== "law") return [];
  const locator = historicalLawTextbookLocators[fact.id];
  if (!locator) return [];
  const page = historicalLawTextbookPages.find((entry) => entry.page === locator.page);
  if (!page || !normalizeText(page.text).includes(normalizeText(locator.needle))) {
    throw new Error(`${fact.id}: historical law textbook locator missing on PDF page ${locator.page}`);
  }
  return [{
    kind: "textbook",
    sourceClass: "historical_exam_textbook",
    jurisdiction: "中国大陆证券从业考试历史口径（2020）",
    answerBasis: false,
    title: "《证券市场基本法律法规》（2020 商业备考教材）",
    publisher: "证券业从业人员一般从业资格考试专用教材编写组编，中国铁道出版社有限公司",
    locator: `PDF 第${page.page}页 · 书内第${page.page - 9}页`,
    quote: extractHistoricalTextbookQuote(page.text, locator.needle, locator.endNeedle),
    page: page.page,
    localPath: `./docs/${historicalLawTextbookViewerName}`,
    fullTextPath: `./docs/${historicalLawTextbookName}`,
    effectiveDate: "2020年2月第1版（历史版本）",
    textNotice: "本段来自2020年商业备考书的扫描版识别文本，仅供历史辅助，不是协会统编教材，也不是2025/2026考试或中国现行法律的答案依据。法条、期限、比例、处罚及业务规则必须核对最新官方文本；识别文字也可能有误。"
  }];
}

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
  for (const [factIndex, fact] of facts.entries()) {
    const outlineCitation = findOutlineCitation(fact);
    const citations = [
      outlineCitation,
      ...findOfficialTextbookCitations(fact),
      ...(fact.authorityCitations || []).map((citation) => ({
        kind: "authority",
        sourceClass: "china_official",
        jurisdiction: "中国大陆",
        answerBasis: true,
        ...citation
      })),
      ...findHistoricalLawTextbookCitations(fact),
      ...(financeReferenceMap[fact.id] || []).map((citation) => ({ ...citation }))
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
      memoryHook: fact.memoryHook || null,
      detailSections: fact.detailSections || [],
      examTips: fact.examTips || [],
      citations
    });
    const caseScenario = caseScenarios[fact.id];
    const singleValues = [fact.statement, ...fact.incorrectPoints.slice(0, 3)];
    const singleOrder = stableShuffle(singleValues, `${fact.id}-single`);
    const correctIndex = singleOrder.indexOf(fact.statement);
    const targetCorrectIndex = factIndex % 4;
    [singleOrder[correctIndex], singleOrder[targetCorrectIndex]] = [singleOrder[targetCorrectIndex], singleOrder[correctIndex]];
    const singleOptions = optionize(singleOrder);
    output.push({
      id: `${fact.id}-S`, version: 1, subjectId: fact.subjectId, chapterId: fact.chapterId,
      factId: fact.id, verificationStatus: "outline_checked",
      type: caseScenario ? "case" : "single", level: fact.level, difficulty: fact.difficulty || "medium",
      stem: caseScenario?.stem || fact.singleStem || `关于${fact.topic}，下列表述正确的是（）。`, caseMaterial: caseScenario?.material || null,
      caseGroupId: caseScenario?.groupId || null, caseGroupTitle: caseScenario?.groupTitle || null,
      caseOrder: caseScenario?.order || null, caseGroupSize: caseScenario?.size || null,
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
const financeKnowledgePoints = knowledgePoints.filter((point) => point.subjectId === "finance");
const lawKnowledgePoints = knowledgePoints.filter((point) => point.subjectId === "law");
const sourceCoverage = (predicate) => `${financeKnowledgePoints.filter((point) => point.citations.some(predicate)).length}/${financeKnowledgePoints.length}`;
const lawSourceCoverage = (predicate) => `${lawKnowledgePoints.filter((point) => point.citations.some(predicate)).length}/${lawKnowledgePoints.length}`;

function splitRequirementText(text) {
  return (text.match(/[^；。]+[；。]?/g) || [])
    .map((item) => item.trim())
    .filter((item) => /^(掌握|熟悉|了解)/.test(item));
}

function extractMainOutlineRequirements() {
  const requirements = [];
  let currentSubjectId = null;
  let currentChapterId = null;
  let currentSection = "";
  let sectionText = "";
  const chapterLookup = new Map(chapters.map((chapter) => [`${chapter.subjectId}:${normalizeText(chapter.title)}`, chapter.id]));

  const flushSection = () => {
    if (!currentSubjectId || !currentChapterId || !sectionText) return;
    for (const text of splitRequirementText(sectionText)) {
      requirements.push({
        id: `${currentSubjectId === "finance" ? "FIN" : "LAW"}-${String(requirements.filter((item) => item.subjectId === currentSubjectId && item.source === "main").length + 1).padStart(3, "0")}`,
        source: "main",
        subjectId: currentSubjectId,
        chapterId: currentChapterId,
        section: currentSection,
        level: text.match(/^(掌握|熟悉|了解)/)?.[1] || null,
        text
      });
    }
    sectionText = "";
  };

  for (const page of pages.filter((entry) => (entry.page >= 4 && entry.page <= 13) || (entry.page >= 15 && entry.page <= 24))) {
    const subjectId = page.page <= 13 ? "finance" : "law";
    if (subjectId !== currentSubjectId) {
      flushSection();
      currentSubjectId = subjectId;
      currentChapterId = null;
      currentSection = "";
    }
    for (const rawLine of page.text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^\d+$/.test(line) || line === "金融市场基础知识" || line === "证券市场基本法律法规") continue;
      if (/^第[一二三四五六七八九十]+章/.test(line)) {
        flushSection();
        currentChapterId = chapterLookup.get(`${subjectId}:${normalizeText(line)}`) || null;
        currentSection = "";
        continue;
      }
      if (/^第[一二三四五六七八九十]+节/.test(line)) {
        flushSection();
        currentSection = line;
        continue;
      }
      if (currentChapterId && currentSection) sectionText += normalizeText(line);
    }
  }
  flushSection();
  return requirements;
}

function extractDisciplineRequirements() {
  const compact = normalizeText(disciplineText);
  const start = compact.search(/(?:掌握|熟悉)《习近平/);
  if (start < 0) throw new Error("cannot locate 2026 discipline requirements");
  return splitRequirementText(compact.slice(start)).map((text, index) => ({
    id: `DISC-${String(index + 1).padStart(3, "0")}`,
    source: "discipline-2026",
    subjectId: "law",
    chapterId: "law-5",
    section: "纪法知识增补（2026）",
    level: text.match(/^(掌握|熟悉|了解)/)?.[1] || null,
    text
  }));
}

function bigrams(value) {
  const compact = normalizeText(value).replace(/[《》（）、，：“”"']/g, "");
  const output = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) output.add(compact.slice(index, index + 2));
  return output;
}

function requirementSimilarity(requirement, fact) {
  const required = bigrams(requirement.text);
  const factText = [fact.topic, fact.statement, fact.citationSearch, fact.supplementSearch]
    .flat(Infinity).filter(Boolean).join("");
  const candidate = bigrams(factText);
  if (!required.size || !candidate.size) return 0;
  let overlap = 0;
  for (const token of required) if (candidate.has(token)) overlap += 1;
  return overlap / required.size;
}

function buildCoverageReport() {
  const requirements = [...extractMainOutlineRequirements(), ...extractDisciplineRequirements()];
  const pointMap = new Map(knowledgePoints.map((point) => [point.id, point]));
  const factMappings = new Map(facts.map((fact) => [fact.id, []]));
  const mappedRequirements = requirements.map((requirement) => {
    const candidates = facts.filter((fact) =>
      fact.subjectId === requirement.subjectId &&
      fact.chapterId === requirement.chapterId &&
      (requirement.source === "discipline-2026" ? Boolean(fact.supplementSearch) : !fact.supplementSearch)
    );
    const exact = candidates.filter((fact) => {
      const searches = [requirement.source === "discipline-2026" ? fact.supplementSearch : fact.citationSearch]
        .flat(Infinity).filter(Boolean).map(normalizeText).filter((item) => item.length >= 4);
      const text = normalizeText(requirement.text);
      return searches.some((search) => text.includes(search) || search.includes(text.replace(/^(掌握|熟悉|了解)/, "")));
    });
    let status = "mapped";
    let matches = exact.map((fact) => ({ fact, score: 1 }));
    if (!matches.length) {
      matches = candidates
        .map((fact) => ({ fact, score: requirementSimilarity(requirement, fact) }))
        .filter((item) => item.score >= 0.24)
        .sort((left, right) => right.score - left.score)
        .slice(0, 2);
      status = matches.length ? "partial" : "unmapped";
    }
    for (const match of matches) factMappings.get(match.fact.id)?.push(requirement.id);
    const factIds = matches.map((item) => item.fact.id);
    const answerBasisTypes = [...new Set(factIds.flatMap((factId) =>
      (pointMap.get(factId)?.citations || [])
        .filter((citation) => citation.answerBasis === true)
        .map((citation) => citation.sourceClass)
    ))];
    return {
      ...requirement,
      status,
      factIds,
      questionCount: factIds.length * 3,
      answerBasisTypes,
      matchScores: matches.map((item) => Number(item.score.toFixed(2)))
    };
  });

  const summarize = (items) => ({
    requirements: items.length,
    mapped: items.filter((item) => item.status === "mapped").length,
    partial: items.filter((item) => item.status === "partial").length,
    unmapped: items.filter((item) => item.status === "unmapped").length,
    mappedOrPartialRate: items.length ? Number((items.filter((item) => item.status !== "unmapped").length * 100 / items.length).toFixed(1)) : 0
  });
  const bySubject = Object.fromEntries(subjects.map((subject) => [subject.id, summarize(mappedRequirements.filter((item) => item.subjectId === subject.id))]));
  const byChapter = Object.fromEntries(chapters.map((chapter) => [chapter.id, {
    title: chapter.title,
    ...summarize(mappedRequirements.filter((item) => item.chapterId === chapter.id))
  }]));
  return {
    meta: {
      generatedFromContentCutoff: "2026-08-18",
      outlineVersion: "一般业务大纲2025 + 纪法大纲2026",
      mappingMethod: "大纲要求按分号和句号自动拆分；先用事实的 citationSearch/supplementSearch 精确锚定，再用同科同章文本二元组相似度给出近似关联。",
      limitation: "这是用于发现扩题缺口的自动近似映射，不等于协会确认、专家逐条审定或真实考试命中率。partial 不能视为完整覆盖。",
      statusMeaning: {
        mapped: "题组检索锚点与该大纲要求直接匹配",
        partial: "仅有同章文本相似关联，需要人工复核或继续扩题",
        unmapped: "未找到达到阈值的题组"
      },
      factCount: facts.length,
      questionCount: questions.length,
      summary: summarize(mappedRequirements),
      bySubject,
      byChapter
    },
    requirements: mappedRequirements,
    facts: facts.map((fact) => ({
      factId: fact.id,
      subjectId: fact.subjectId,
      chapterId: fact.chapterId,
      topic: fact.topic,
      requirementIds: factMappings.get(fact.id) || []
    }))
  };
}

const coverageReport = buildCoverageReport();
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
    casePackCount: casePacks.length,
    caseQuestionCount: questions.filter((question) => question.type === "case").length,
    subjectCasePackCounts: Object.fromEntries(subjects.map((subject) => [subject.id, casePacks.filter((pack) => pack.subjectId === subject.id).length])),
    outlineVersion: "一般业务大纲2025 + 纪法大纲2026",
    contentCutoff: "2026-08-18",
    financeIndependentReferenceCoverage: sourceCoverage((citation) => citation.kind !== "scope"),
    financeChinaAuthorityCoverage: sourceCoverage((citation) => citation.sourceClass === "china_law" || citation.sourceClass === "china_official" || citation.sourceClass === "china_official_textbook"),
    financeOfficialTextbookCoverage: sourceCoverage((citation) => citation.sourceClass === "china_official_textbook"),
    financeInternationalStandardCoverage: sourceCoverage((citation) => citation.sourceClass === "international_standard"),
    financeGeneralTextbookCoverage: sourceCoverage((citation) => citation.sourceClass === "general_textbook"),
    lawHistoricalTextbookCoverage: lawSourceCoverage((citation) => citation.sourceClass === "historical_exam_textbook"),
    lawCurrentAuthorityCoverage: lawSourceCoverage((citation) => citation.answerBasis === true && (citation.sourceClass === "china_law" || citation.sourceClass === "china_official")),
    subjectFactCounts: Object.fromEntries(subjects.map((subject) => [subject.id, knowledgePoints.filter((point) => point.subjectId === subject.id).length])),
    outlineRequirementCoverage: coverageReport.meta.bySubject,
    officialFinanceTextbook: {
      title: "证券行业专业人员一般业务水平评价测试统编教材（2025）《金融市场基础知识》",
      compiler: "中国证券业协会",
      publisher: "中国财政经济出版社",
      noticeUrl: "https://www.sac.net.cn/fwdt/ksfw/jcdg/202512/t20251231_70825.html",
      fullTextIntegrated: true,
      sourceFormat: "扫描版 PDF 的 UTF-8 识别文本",
      pageCount: officialTextbookPages.length,
      localTextPath: `./docs/${officialTextbookName}`,
      localViewerPath: `./docs/${officialTextbookViewerName}`,
      textNotice: "识别文本可能存在同形字、标点及表格识别误差，请以原书页面为准。"
    },
    historicalLawTextbook: {
      title: "《证券市场基本法律法规》（2020 商业备考教材）",
      compiler: "证券业从业人员一般从业资格考试专用教材编写组",
      publisher: "中国铁道出版社有限公司",
      isbn: "978-7-113-26419-2",
      fullTextIntegrated: true,
      sourceFormat: "扫描版 PDF 的 UTF-8 识别文本",
      pageCount: historicalLawTextbookPages.length,
      localTextPath: `./docs/${historicalLawTextbookName}`,
      localViewerPath: `./docs/${historicalLawTextbookViewerName}`,
      answerBasis: false,
      textNotice: "仅作2020历史辅助参考，不是协会统编教材或现行规则依据；识别文字可能有误。"
    },
    disclaimer: "依据官方公开范围原创，不是官方题库、真题或押题。"
  },
  subjects, chapters, knowledgePoints, questions
};

writeFileSync(join(dataDir, "outline.json"), JSON.stringify(outline, null, 2));
writeFileSync(join(dataDir, "questions.json"), JSON.stringify(questionPayload, null, 2));
writeFileSync(join(dataDir, "coverage-report.json"), JSON.stringify(coverageReport, null, 2));
writeFileSync(join(dataDir, "outline.js"), `window.OUTLINE_DATA = ${JSON.stringify(outline)};\n`);
writeFileSync(join(dataDir, "questions.js"), `window.QUESTION_DATA = ${JSON.stringify(questionPayload)};\n`);
copyFileSync(join(root, "node_modules/sql.js/dist/sql-wasm.js"), join(vendorDir, "sql-wasm.js"));
const wasmBase64 = readFileSync(join(root, "node_modules/sql.js/dist/sql-wasm.wasm")).toString("base64");
writeFileSync(join(vendorDir, "sql-wasm-data.js"), `window.SQL_WASM_BASE64 = "${wasmBase64}";\n`);
console.log(`Built ${questions.length} questions from ${facts.length} facts; outline ${pages.length} pages.`);
