import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NOTE_SOURCES, TEXTBOOK_SOURCES, chunkPages, createIndex, parsePagedText, searchIndex } from "./material-binding.mjs";
import { lookupPage, lookupSearch } from "./web-lookup.mjs";

// 为缺解析或解析过短的题目补写逐项解析：
//   本地阶段先用三色笔记与教材原文；--web 阶段再补一遍只读联网核验的官方页面。
// 用法：
//   node scripts/enrich-explanations.mjs --only-missing --apply
//   node scripts/enrich-explanations.mjs --web --only-missing --out tmp/enriched-web.jsonl --apply
// 常用参数：--limit 20 --subject law --batch 3 --concurrency 2 --max-length 60 --sites 3
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(name);

const limit = Number(option("--limit", "0"));
const subjectFilter = option("--subject", null);
const batchSize = Number(option("--batch", "3"));
const concurrency = Number(option("--concurrency", "2"));
const maxLength = Number(option("--max-length", "60"));
const model = option("--model", "deepseek-flash");
const effort = option("--effort", "low");
const resultsPath = resolve(root, option("--out", "tmp/enriched.jsonl"));
const apply = flag("--apply");
// 只补「原资料没有解析」的题：没有解析正文，或是「原资料未提供可用解析」这类占位说明。
const useWeb = flag("--web");
const onlyMissing = flag("--only-missing") || useWeb;
const maxSites = Number(option("--sites", "3"));
const mergeOnly = flag("--merge-only");
const promptDir = resolve(root, "tmp/enrich-prompts");
const answerDir = resolve(root, "tmp/enrich-answers");
mkdirSync(promptDir, { recursive: true });
mkdirSync(answerDir, { recursive: true });

const examsFile = join(root, "content/imported-exams.json");
const examData = JSON.parse(readFileSync(examsFile, "utf8"));
const questions = examData.questions;
const builtRaw = JSON.parse(readFileSync(join(root, "data/questions.json"), "utf8"));
const builtById = new Map((Array.isArray(builtRaw) ? builtRaw : builtRaw.questions || []).map((q) => [q.id, q]));

const docsDir = join(root, "docs");
const indexes = new Map();
for (const source of [...NOTE_SOURCES, ...TEXTBOOK_SOURCES]) {
  const pages = parsePagedText(readFileSync(join(docsDir, source.textName), "utf8"));
  indexes.set(source.id, { source, pages, index: createIndex(chunkPages(pages, { skip: page => page < 10 })) });
}

// 检索与题目最相关的讲义/教材片段，作为解析依据。
const retrievalCache = new Map();
function retrieve(subjectId, query, cacheKey = null) {
  if (cacheKey && retrievalCache.has(cacheKey)) return retrievalCache.get(cacheKey);
  const value = retrieveUncached(subjectId, query);
  if (cacheKey) retrievalCache.set(cacheKey, value);
  return value;
}

function sourceTextFor(question, context) {
  return [
    context,
    question.stem,
    question.options.map((option) => option.text).join(" "),
    String(question.explanation || ""),
    question.options.filter((option) => question.correctOptionIds.includes(option.id)).map((option) => option.text).join(" ")
  ].join("\n");
}

function retrieveUncached(subjectId, query) {
  const picked = [];
  const seen = new Set();
  for (const source of [...NOTE_SOURCES, ...TEXTBOOK_SOURCES]) {
    if (source.subjectId !== subjectId) continue;
    const isNotes = source.textName.startsWith("notes");
    const entry = indexes.get(source.id);
    let remaining = isNotes ? 6 : 4;
    for (const hit of searchIndex(entry.index, query, 16)) {
      if (remaining <= 0) break;
      if (hit.score < 15) continue;
      const key = `${source.id}:${hit.doc.page}`;
      if (seen.has(key)) continue;
      seen.add(key);
      remaining -= 1;
      picked.push(`【${isNotes ? "三色笔记" : "教材"} 第 ${hit.doc.page} 页】\n${hit.doc.quote}`);
    }
  }
  return picked.join("\n\n").slice(0, 11000);
}

function buildQuery(question) {
  return [
    question.stem,
    question.stem,
    question.options.map((option) => option.text).join(""),
    question.correctOptionIds.map((id) => question.options.find((option) => option.id === id)?.text || "").join(""),
    String(question.explanation || "").slice(0, 400)
  ].join("");
}

const PLACEHOLDER_EXPLANATION = /原资料未提供可用解析/;

function isMissingExplanation(question) {
  const text = String(question.explanation || "").trim();
  return !text || PLACEHOLDER_EXPLANATION.test(text);
}

function needsEnrichment(question) {
  if (onlyMissing) return isMissingExplanation(question);
  return String(question.explanation || "").trim().length < maxLength;
}

// 官方一手来源，按可信度排序；每个站点最多试一次检索，命中就先抓页面。
const OFFICIAL_SITES = ["csrc.gov.cn", "sac.net.cn", "gov.cn", "sse.com.cn", "szse.cn"];
const evidenceByQuestion = new Map();

// 检索词从短到长：先只搜法规名（Bing 的 site: 检索对长句几乎不命中），再退到「法规名 + 关键词」。
function webQueries(question) {
  const stem = String(question.stem || "");
  const legal = [...stem.matchAll(/《([^》]{2,40})》/g)].map((match) => match[1]);
  const words = stem
    .replace(/[《》()（）【】]/g, " ")
    .split(/[\s，。、；：？?!]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !/^(根据|下列|关于|说法|错误|正确|的是|以及|应当|以下|哪些|哪一|属于|不属于|可以|我国|目前|不正确的)/.test(word));
  const answerText = question.correctOptionIds
    .map((id) => question.options.find((option) => option.id === id)?.text || "")
    .join(" ")
    .replace(/[（(][^）)]*[）)]/g, " ")
    .replace(/[ⅠⅡⅢⅣⅤⅥ]/g, " ")
    .replace(/[^\u4e00-\u9fff\w%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const key = words.slice(0, 2).join(" ");
  const queries = [];
  if (legal.length) {
    queries.push(legal[0]);
    const typed = `${legal[0]} ${key}`.trim();
    if (typed !== legal[0]) queries.push(typed);
  }
  const generic = `${words.slice(0, 3).join(" ")} ${answerText.slice(0, 12)}`.trim();
  if (generic) queries.push(generic);
  return [...new Set(queries.map((query) => query.replace(/\s+/g, " ").trim().slice(0, 46)).filter((query) => query.length >= 3))];
}

// 只读联网核验：限定证监会/协会/政府/交易所站点检索，抓回正文交给模型当依据。
// 抓取结果按题目落盘缓存，重跑同一题不会重复请求站点。
const webCacheDir = resolve(root, "tmp/enrich-web-cache");
mkdirSync(webCacheDir, { recursive: true });
let webFetched = 0;

function localDate() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

async function webEvidence(question) {
  if (evidenceByQuestion.has(question.id)) return evidenceByQuestion.get(question.id);
  const cacheFile = join(webCacheDir, `${question.id}.json`);
  if (existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (cached && Array.isArray(cached.pages)) {
        evidenceByQuestion.set(question.id, cached);
        return cached;
      }
    } catch { /* 缓存坏了就按未命中处理 */ }
  }
  const queries = webQueries(question);
  const sites = OFFICIAL_SITES.slice(0, Math.max(1, maxSites));
  const pages = [];
  let query = queries[0] || "";
  outer: for (const candidate of queries) {
    query = candidate;
    for (const site of sites) {
      let found = null;
      try { found = await lookupSearch(candidate, 3, site); } catch { continue; }
      if (!found?.results?.length) continue;
      for (const hit of found.results.slice(0, 2)) {
        try {
          const page = await lookupPage(hit.url);
          if (page.status < 200 || page.status >= 300) continue;
          const text = String(page.text || "");
          if (text.length < 200) continue;
          pages.push({
            url: page.finalUrl || page.url,
            title: page.title || hit.title,
            fetchedAt: localDate(),
            text: text.slice(0, 7000),
            site
          });
        } catch { /* 单个页面抓不到就跳过，换下一站 */ }
        if (pages.length >= 2) break;
      }
      if (pages.length) break outer;
    }
  }
  const result = { query, queries, pages };
  evidenceByQuestion.set(question.id, result);
  writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  webFetched += 1;
  console.log(`联网核验 ${question.id}：检索「${query}」命中 ${pages.length} 页${pages.length ? `（${pages.map((page) => page.site).join("、")}）` : "，本题将只用本地资料"}`);
  return result;
}

function webContextFor(question) {
  const evidence = evidenceByQuestion.get(question.id);
  if (!evidence?.pages?.length) return "";
  return evidence.pages.map((page, index) => `【联网核验 ${index + 1}】${page.title || page.url} · ${page.url} · 抓取 ${page.fetchedAt}\n${page.text}`).join("\n\n");
}

function webTextFor(question) {
  const evidence = evidenceByQuestion.get(question.id);
  if (!evidence?.pages?.length) return "";
  return evidence.pages.map((page) => page.text).join("\n");
}

const targets = questions.filter((q) => needsEnrichment(q) && (!subjectFilter || q.subjectId === subjectFilter));
const selected = mergeOnly ? [] : (limit > 0 ? targets.slice(0, limit) : targets);
if (!mergeOnly) console.log(`需要补解析：${targets.length} 题，本次处理 ${selected.length} 题（batch=${batchSize}，concurrency=${concurrency}，model=${model}）`);

const batches = [];
for (let index = 0; index < selected.length; index += batchSize) batches.push(selected.slice(index, index + batchSize));

function buildPrompt(batch) {
  const body = batch.map((question, index) => {
    const query = buildQuery(question);
    const web = webContextFor(question);
    return `=== 第 ${index + 1} 题 ===
【题干】${question.stem}
【选项】
${question.options.map((o) => `${o.id}. ${o.text}`).join("\n")}
【原资料答案】${question.correctOptionIds.join("、")}
【原资料解析】${String(question.explanation || "").trim() || "（原资料没有解析）"}
【本地参考原文】
${retrieve(question.subjectId, query, question.id) || "（无）"}
${web ? `【联网核验原文】（证监会、协会、政府、交易所官网只读抓取，可直接引用其中的数字与条文）\n${web}` : "【联网核验原文】（本次没有抓到可用官方页面）"}`;
  }).join("\n\n");
  const webRules = useWeb ? `
6. 联网核验原文是官方一手来源：解析里的数字、期限、比例、条文序号要来自它或本地参考原文，并按下面格式标出用到的页面编号。
7. 每题都必须另起一行以「参考：」结尾，填用到的联网核验页面编号（如「参考：1」或「参考：1、2」）；没抓到页面或没用到联网页面就写「参考：无」。这一行不能省略。` : "";
  return `你在为证券从业资格考试（一般业务水平评价测试）整理习题解析。下面有 ${batch.length} 道题，每题给出题干、选项、原资料答案、原资料解析，以及从考生内部资料（2026 新大纲三色笔记、教材参考页）检索到的原文片段${useWeb ? "和从官网抓回来的联网核验原文" : ""}。

输出格式（严格遵守，不要有多余文字，每题两行：解析一行，「参考：」一行）：
[1]
第 1 题的解析（一个自然段）
参考：1
[2]
第 2 题的解析（一个自然段）
参考：无

每题解析的要求：
1. 先说明正确答案为什么成立，再逐项说明其他选项为什么错；每个选项以“A 项：”“B 项：”这样的形式开头，各一句。选项是“Ⅰ、Ⅱ、Ⅲ、Ⅳ”这类组合时，同样要按“A 项：”“B 项：”“C 项：”“D 项：”四条分析，并在每条里点明它包含的组合错在哪里。
2. 事实只能来自题干、选项、原资料答案与原资料解析、本地参考原文${useWeb ? "、联网核验原文" : ""}。这些之外的具体数字、期限、比例、条文序号不要写。
3. 120～260 个汉字，一个自然段，中文标点；不要标题、不要列表符号、不要重复题干。
4. 正确项也要按“X 项：”写出来，不要只在开头一句带过。
5. 只有当题干、选项、原资料答案、原资料解析${useWeb ? "、本地参考原文和联网核验原文" : "和参考原文"}合起来仍无法判断时，该题才写 INSUFFICIENT。${webRules}

${body}`;
}

function runCodex(prompt, id) {
  return new Promise((resolvePromise) => {
    const answerFile = join(answerDir, `${id}.txt`);
    const child = spawn(process.env.SECURITIES_CODEX_BINARY || "codex", [
      "exec", "--skip-git-repo-check",
      "-c", `model="${model}"`,
      "-c", `model_reasoning_effort="${effort}"`,
      "-c", "features.apps=false",
      "-c", "features.multi_agent=false",
      "-c", "mcp_servers.playwright.enabled=false",
      "-c", "mcp_servers.openaiDeveloperDocs.enabled=false",
      "-c", "mcp_servers.figma.enabled=false",
      "-c", "mcp_servers.test-manage.enabled=false",
      "-c", "mcp_servers.node_repl.enabled=false",
      "-c", "mcp_servers.computer-use.enabled=false",
      "-o", answerFile, "-"
    ], { cwd: root, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdin.end(prompt);
    child.on("close", (code) => { writeFileSync(join(promptDir, `${id}.txt`), prompt); resolvePromise({ code, stderr, answerFile }); });
  });
}

function parseAnswers(text, count) {
  const sections = new Map();
  const pattern = /^\[(\d+)\]\s*$/gm;
  const matches = [...String(text || "").matchAll(pattern)];
  matches.forEach((match, index) => {
    const start = match.index + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    sections.set(Number(match[1]), text.slice(start, end).trim());
  });
  const out = [];
  for (let n = 1; n <= count; n += 1) out.push(sections.get(n) || null);
  return out;
}

// 模型会在末尾附一行「参考：1、2」，这里拆出来变成可回查的来源链接，正文不留这行。
function splitReferences(text) {
  const raw = String(text || "").trim();
  const match = /(?:^|\s)参考[：:]\s*([^\n]*)$/.exec(raw);
  if (!match) return { body: raw, indexes: [] };
  const indexes = [...match[1].matchAll(/\d+/g)].map((item) => Number(item[0])).filter((value) => value > 0);
  return { body: raw.slice(0, match.index).trim(), indexes };
}

function referencesFor(question, indexes) {
  const pages = evidenceByQuestion.get(question.id)?.pages || [];
  const seen = new Set();
  const picked = [];
  for (const index of indexes) {
    const page = pages[index - 1];
    if (!page) continue;
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    picked.push({ title: page.title || page.url, url: page.url, fetchedAt: page.fetchedAt });
  }
  return picked;
}

// 写回前统一收拾一遍：去掉与界面上「正确答案」重复的开头，避开被清洗规则判为噪声的写法。
function polishExplanation(text) {
  return String(text || "")
    .replace(/^[（(]?\s*(?:本题|此题)?\s*(?:正确|参考)?\s*答案\s*(?:为|是|[:：])\s*[A-D](?:\s*[、，,和]\s*[A-D])*\s*项?\s*[。．.，,：:]?\s*/, "")
    .replace(/一一对应/g, "逐项对应")
    .replace(/一一/g, "逐一")
    .replace(/\s+/g, " ")
    .trim();
}

// 校验：长度、是否提到正确项、数字是否都能在原文里找到。
const NUMBER_PATTERN = /\d+(?:\.\d+)?%?/g;
function validate(explanation, question, context) {
  const text = String(explanation || "").trim();
  if (!text) return "空解析";
  if (/INSUFFICIENT/i.test(text)) return "资料不足";
  const hanzi = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  if (hanzi < 90) return `汉字过少(${hanzi})`;
  if (hanzi > 420) return `汉字过多(${hanzi})`;
  for (const id of question.correctOptionIds) {
    if (!new RegExp(`${id}\\s*项|选项\\s*${id}`).test(text)) return `未分析正确项 ${id}`;
  }
  for (const number of text.match(NUMBER_PATTERN) || []) {
    if (!context.includes(number)) return `数字 ${number} 不在原文`;
  }
  if (/"|“|”/.test(text) && !/[\u4e00-\u9fff]/.test(text)) return "无有效内容";
  return null;
}

let cursor = 0;
let applied = 0;
let skipped = 0;
const started = Date.now();

async function worker(workerId) {
  while (cursor < batches.length) {
    const index = cursor;
    cursor += 1;
    const batch = batches[index];
    if (useWeb) {
      for (const question of batch) await webEvidence(question);
    }
    const id = `${String(index).padStart(4, "0")}-${workerId}`;
    const prompt = buildPrompt(batch);
    const { code, stderr, answerFile } = await runCodex(prompt, id);
    if (code !== 0) {
      console.log(`批次 ${index} 失败：${stderr.slice(-200)}`);
      skipped += batch.length;
      continue;
    }
    const answers = parseAnswers(existsSync(answerFile) ? readFileSync(answerFile, "utf8") : "", batch.length);
    batch.forEach((question, position) => {
      const context = [sourceTextFor(question, retrieve(question.subjectId, buildQuery(question), question.id)), webTextFor(question)].join("\n");
      const raw = String(answers[position] || "");
      const { body, indexes } = splitReferences(raw);
      const polished = polishExplanation(body || raw);
      const references = referencesFor(question, indexes);
      const reason = validate(polished, question, context);
      const checkedSources = (evidenceByQuestion.get(question.id)?.pages || []).map((page) => ({ title: page.title || page.url, url: page.url, fetchedAt: page.fetchedAt }));
      const record = { id: question.id, subjectId: question.subjectId, batch: index, explanation: polished || null, references, checkedSources, webQuery: evidenceByQuestion.get(question.id)?.query || null, rejected: reason, model };
      appendFileSync(resultsPath, `${JSON.stringify(record)}\n`);
      if (reason) skipped += 1; else applied += 1;
    });
    console.log(`批次 ${index + 1}/${batches.length} 完成（${((Date.now() - started) / 1000).toFixed(0)}s，可用 ${applied}，未通过 ${skipped}）`);
  }
}

await Promise.all(Array.from({ length: Math.max(1, concurrency) }, (_, index) => worker(index + 1)));

if (!mergeOnly) console.log(`生成结束：可用 ${applied}，未通过/跳过 ${skipped}，结果写入 ${resultsPath}`);
if (useWeb) {
  const withPages = [...evidenceByQuestion.values()].filter((evidence) => evidence.pages?.length).length;
  console.log(`联网核验：本次新抓取 ${webFetched} 题，共 ${evidenceByQuestion.size} 题有记录，其中 ${withPages} 题抓到可用官方页面。`);
}
if (!apply && !mergeOnly) {
  console.log("加 --apply 才会写回 content/imported-exams.json（未执行）。");
} else {
  const records = readFileSync(resultsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const byId = new Map(records.filter((record) => !record.rejected).map((record) => [record.id, record]));
  let merged = 0;
  for (const question of questions) {
    const record = byId.get(question.id);
    if (!record) continue;
    const original = String(question.explanation || "").trim();
    const enriched = polishExplanation(record.explanation);
    if (!enriched || original === enriched) continue;
    // 原解析只是「原资料未提供可用解析」这类占位时不留存，避免展示无意义内容。
    if (original && !/原资料未提供可用解析/.test(original)) question.sourceExplanation = original;
    question.explanation = enriched;
    const references = Array.isArray(record.references) ? record.references : [];
    const checkedSources = Array.isArray(record.checkedSources) ? record.checkedSources : [];
    question.explanationSource = references.length ? "official-web" : "local-materials-ai";
    if (references.length) question.explanationReferences = references;
    if (checkedSources.length) question.explanationCheckedSources = checkedSources;
    question.explanationModel = record.model;
    merged += 1;
  }
  writeFileSync(examsFile, `${JSON.stringify(examData, null, 2)}\n`);
  console.log(`已写回 ${merged} 题解析。`);
}
