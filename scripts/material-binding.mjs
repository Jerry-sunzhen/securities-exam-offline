import { readFileSync } from "node:fs";
import { join } from "node:path";

// 复习资料（2026 新大纲三色笔记）与两本教材全文，用于把每道题绑定到具体页码。
export const NOTE_SOURCES = [
  {
    id: "notes-finance",
    subjectId: "finance",
    label: "三色笔记",
    title: "2026 新大纲《金融市场基础知识》三色笔记",
    textName: "notes-finance.txt",
    viewerName: "notes-finance.html",
    notice: "来自用户提供的 2026 新大纲三色笔记 PDF 识别文本，页码为 PDF 页；识别文字可能有误，以原文件为准。"
  },
  {
    id: "notes-law",
    subjectId: "law",
    label: "三色笔记",
    title: "2026 新大纲《证券市场基本法律法规》三色笔记",
    textName: "notes-law.txt",
    viewerName: "notes-law.html",
    notice: "来自用户提供的 2026 新大纲三色笔记 PDF 识别文本，页码为 PDF 页；识别文字可能有误，以原文件为准。"
  }
];

export const TEXTBOOK_SOURCES = [
  {
    id: "base-knowledge",
    subjectId: "finance",
    label: "统编教材",
    title: "《金融市场基础知识》（2025 统编教材）",
    textName: "base-knowledge.txt",
    viewerPath: "./docs/base-knowledge.html"
  },
  {
    id: "law-regulations",
    subjectId: "law",
    label: "2020 教材",
    title: "《证券市场基本法律法规》（2020 商业备考教材）",
    textName: "law-regulations.txt",
    viewerPath: "./docs/law-regulations.html"
  }
];

export function parsePagedText(text) {
  const pages = new Map();
  const parts = text.split(/^===== PDF 第 (\d+) 页 =====\s*$/m);
  for (let index = 1; index < parts.length; index += 2) pages.set(Number(parts[index]), parts[index + 1].trim());
  return pages;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, "");
}

function tokens(value) {
  const normalized = String(value || "").toLowerCase().replace(/\s+/g, "");
  const runs = normalized.match(/[\u4e00-\u9fff]+|[a-z0-9]+/g) || [];
  const output = [];
  for (const run of runs) {
    if (/^[a-z0-9]+$/.test(run)) { output.push(run); continue; }
    for (let index = 0; index < run.length - 1; index += 1) output.push(run.slice(index, index + 2));
    if (run.length === 1) output.push(run);
  }
  return output;
}

// BM25 检索：与 scripts/import-exams.py 中的实现保持同一套参数。
export function createIndex(docs) {
  const postings = new Map();
  const lengths = [];
  docs.forEach((doc, index) => {
    const counts = new Map();
    for (const token of tokens(doc.search)) counts.set(token, (counts.get(token) || 0) + 1);
    let length = 0;
    for (const [token, count] of counts) {
      length += count;
      const list = postings.get(token) || [];
      list.push([index, count]);
      postings.set(token, list);
    }
    lengths.push(length);
  });
  const average = lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, docs.length);
  return { docs, postings, lengths, average };
}

export function searchIndex(index, query, limit = 3) {
  const scores = new Map();
  const queryCounts = new Map();
  for (const token of tokens(query)) queryCounts.set(token, (queryCounts.get(token) || 0) + 1);
  for (const [token, queryFrequency] of queryCounts) {
    const list = index.postings.get(token);
    if (!list) continue;
    const idf = Math.log(1 + (index.docs.length - list.length + 0.5) / (list.length + 0.5));
    for (const [docIndex, termFrequency] of list) {
      const lengthNorm = 1.2 * (0.25 + 0.75 * index.lengths[docIndex] / Math.max(1, index.average));
      const score = idf * termFrequency * 2.2 / (termFrequency + lengthNorm) * Math.min(queryFrequency, 2);
      scores.set(docIndex, (scores.get(docIndex) || 0) + score);
    }
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([docIndex, score]) => ({ doc: index.docs[docIndex], score: Math.round(score * 100) / 100 }));
}

// 把页文本切成重叠窗口，避免答案句子正好跨页或跨段落时检索不到。
export function chunkPages(pages, { size = 420, step = 240, minimum = 60, skip = () => false } = {}) {
  const docs = [];
  for (const [page, rawText] of pages) {
    if (skip(page)) continue;
    const body = normalize(rawText);
    if (!body) continue;
    if (body.length <= size) {
      docs.push({ page, quote: body, search: body });
      continue;
    }
    for (let start = 0; start < body.length; start += step) {
      const quote = body.slice(start, start + size);
      if (quote.length < minimum) continue;
      docs.push({ page, quote, search: quote });
    }
  }
  return docs;
}

// 讲义按「第X章」标题分章，用于把检索限制在题干所属章节内。
export function detectChapterRanges(pages, chapters) {
  const ranges = new Map();
  const lookup = new Map(chapters.map((chapter) => [normalize(chapter.title), chapter.id]));
  let current = null;
  for (const [page] of pages) {
    const body = pages.get(page) || "";
    for (const line of body.split("\n")) {
      const chapterId = lookup.get(normalize(line.trim()));
      if (chapterId) { current = chapterId; break; }
    }
    if (!current) continue;
    const range = ranges.get(current) || { firstPage: page, lastPage: page };
    range.lastPage = page;
    ranges.set(current, range);
  }
  return ranges;
}

// 部分知识点摘录只有十几个字，绑定出处时按页扩展成一段可读原文。
function extendQuote(pageText, quote, target = 220) {
  const normalizedQuote = String(quote || "").replace(/\s+/g, "");
  if (!pageText || normalizedQuote.length >= target) return quote;
  const page = pageText.replace(/\s+/g, "");
  const index = page.indexOf(normalizedQuote);
  if (index < 0) return quote;
  const start = Math.max(0, index - Math.floor((target - normalizedQuote.length) / 2));
  return page.slice(start, Math.min(page.length, start + target));
}

function citationLink(citation, source, textbookPages) {
  const pageText = textbookPages?.get(source.id)?.get(citation.page) || "";
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    sourceTitle: citation.title || source.title,
    kind: "textbook",
    page: citation.page,
    quote: extendQuote(pageText, citation.quote),
    score: null,
    localPath: citation.localPath || source.viewerPath,
    method: "knowledge_point",
    reviewStatus: "verified"
  };
}

export function createMaterialContext({ docsDir, chapters, knowledgePoints }) {
  const notes = NOTE_SOURCES.map((source) => {
    const pages = parsePagedText(readFileSync(join(docsDir, source.textName), "utf8"));
    return { source, pages, ranges: detectChapterRanges(pages, chapters) };
  });
  const indexes = notes.map((entry) => ({
    ...entry,
    index: createIndex(chunkPages(entry.pages)),
    scoped: new Map([...entry.ranges.entries()].map(([chapterId, range]) => [
      chapterId,
      createIndex(chunkPages(new Map([...entry.pages].filter(([page]) => page >= range.firstPage && page <= range.lastPage))))
    ]))
  }));
  const factMap = new Map(knowledgePoints.map((point) => [point.id, point]));
  const textbookPages = new Map(TEXTBOOK_SOURCES.map((source) => [
    source.id,
    parsePagedText(readFileSync(join(docsDir, source.textName), "utf8"))
  ]));
  return { notes, indexes, factMap, textbookPages };
}

function buildQuery(question, fact) {
  return [
    question.stem, question.stem,
    (question.options || []).map((option) => option.text).join(""),
    String(question.explanation || "").slice(0, 650),
    question.caseMaterial || "",
    fact?.topic || "", fact?.statement || ""
  ].join("");
}

function notesLink(entry, best, crossSubject) {
  return {
    sourceId: entry.source.id,
    sourceLabel: entry.source.label,
    sourceTitle: entry.source.title,
    kind: "notes",
    page: best.doc.page,
    quote: best.doc.quote,
    score: best.score,
    localPath: `./docs/${entry.source.viewerName}`,
    method: "text_similarity",
    reviewStatus: "suggested",
    ...(crossSubject ? { crossSubject: true } : {})
  };
}

export function bindQuestion(question, context) {
  const fact = context.factMap.get(question.factId);
  const query = buildQuery(question, fact);
  const own = context.indexes.find((entry) => entry.source.subjectId === question.subjectId);
  const other = context.indexes.find((entry) => entry.source.subjectId !== question.subjectId);

  let ownBest = null;
  if (own) {
    const scoped = question.chapterId ? own.scoped.get(question.chapterId) : null;
    const scopedBest = scoped ? searchIndex(scoped, query, 1)[0] : null;
    const fullBest = searchIndex(own.index, query, 1)[0];
    // 先按章节取页，避免同一本书里跨章节误配；差距明显时才退回整本检索。
    ownBest = scopedBest && (!fullBest || scopedBest.score * 1.15 >= fullBest.score) ? scopedBest : fullBest;
    if (!ownBest) ownBest = fullBest || scopedBest;
  }
  const otherBest = other ? searchIndex(other.index, query, 1)[0] : null;

  const links = [];
  // 押题卷里常混入另一科的题：另一本笔记明显更贴合时，绑定到那一本。
  const preferOther = ownBest && otherBest &&
    otherBest.score > ownBest.score * 1.25 && otherBest.score - ownBest.score > 15;
  const chosen = (!ownBest && otherBest) || preferOther
    ? { entry: other, best: otherBest, crossSubject: true }
    : ownBest ? { entry: own, best: ownBest, crossSubject: false } : null;
  if (chosen) links.push(notesLink(chosen.entry, chosen.best, chosen.crossSubject));

  const textbookSource = TEXTBOOK_SOURCES.find((source) => source.subjectId === question.subjectId);
  const citation = (fact?.citations || []).find((entry) => entry.sourceClass === (question.subjectId === "finance" ? "china_official_textbook" : "historical_exam_textbook"));
  if (citation && textbookSource) links.push(citationLink(citation, textbookSource, context.textbookPages));
  return links;
}

