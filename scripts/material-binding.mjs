import { readFileSync } from "node:fs";
import { join } from "node:path";

// 仅保留用户提供的内部材料：2026 新大纲三色笔记 + 两本教材。
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

// 教材页只作补充定位，分数太低的匹配宁可不要，避免给出无关页码。
export const TEXTBOOK_MIN_SCORE = 55;

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

// BM25 检索：讲义、题目与教材用的是同一套参数。
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

// 讲义按「第X章」标题分章，用于把检索限制在题目所属章节内。
export function detectChapterRanges(pages, chapters) {
  const ranges = new Map();
  const lookup = new Map(chapters.map((chapter) => [normalize(chapter.title), chapter.id]));
  let current = null;
  for (const page of [...pages.keys()].sort((left, right) => left - right)) {
    const lines = String(pages.get(page) || "").split("\n").map((line) => normalize(line.trim()));
    for (const line of lines) {
      const chapterId = lookup.get(line);
      if (chapterId) { current = chapterId; break; }
    }
    if (!current) continue;
    const range = ranges.get(current) || { firstPage: page, lastPage: page };
    range.lastPage = page;
    ranges.set(current, range);
  }
  return ranges;
}

export function createMaterialContext({ docsDir }) {
  const notes = NOTE_SOURCES.map((source) => {
    const pages = parsePagedText(readFileSync(join(docsDir, source.textName), "utf8"));
    return { source, pages };
  });
  const textbooks = TEXTBOOK_SOURCES.map((source) => {
    const pages = parsePagedText(readFileSync(join(docsDir, source.textName), "utf8"));
    return { source, pages, index: createIndex(chunkPages(pages, { skip: (page) => page < 10 })) };
  });
  return { notes, textbooks };
}

// 讲义章节范围来自笔记自身的「第X章」标题。
export function createNoteIndexes(context, chapters) {
  return context.notes.map((entry) => {
    const scoped = new Map();
    const ranges = detectChapterRanges(entry.pages, chapters);
    for (const [chapterId, range] of ranges) {
      scoped.set(chapterId, createIndex(chunkPages(new Map([...entry.pages].filter(([page]) => page >= range.firstPage && page <= range.lastPage)))));
    }
    return { ...entry, index: createIndex(chunkPages(entry.pages)), scoped };
  });
}

function notesLink(entry, best) {
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
    reviewStatus: "suggested"
  };
}

export function bindQuestion(question, context, chapterId = null) {
  const entry = context.indexes?.find((item) => item.source.subjectId === question.subjectId);
  if (!entry) return [];
  const query = [
    question.stem, question.stem,
    (question.options || []).map((option) => option.text).join(""),
    String(question.explanation || "").slice(0, 650),
    question.caseMaterial || ""
  ].join("");
  const scoped = chapterId ? entry.scoped?.get(chapterId) : null;
  const scopedBest = scoped ? searchIndex(scoped, query, 1)[0] : null;
  const fullBest = searchIndex(entry.index, query, 1)[0];
  // 先按章节取页，避免同一本书里跨章节误配；差距明显时才退回整本检索。
  const best = scopedBest && (!fullBest || scopedBest.score * 1.15 >= fullBest.score) ? scopedBest : fullBest || scopedBest;
  return best ? [notesLink(entry, best)] : [];
}

// 讲义知识点补一条教材参考页：匹配分数太低就不给，避免误导。
export function bindTextbook(point, context) {
  const entry = context.textbooks?.find((item) => item.source.subjectId === point.subjectId);
  if (!entry) return null;
  const query = [point.topic, point.topic, ...(point.points || [])].join("");
  const best = searchIndex(entry.index, query, 1)[0];
  if (!best || best.score < TEXTBOOK_MIN_SCORE) return null;
  return {
    sourceId: entry.source.id,
    sourceLabel: entry.source.label,
    sourceTitle: entry.source.title,
    kind: "textbook",
    page: best.doc.page,
    quote: best.doc.quote,
    score: best.score,
    localPath: entry.source.viewerPath,
    method: "text_similarity",
    reviewStatus: "suggested"
  };
}
