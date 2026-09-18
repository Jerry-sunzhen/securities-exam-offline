#!/usr/bin/env node
import { pathToFileURL } from "node:url";
// 本地只读联网检索助手：供学习助教在只读沙箱里核验时效信息。
// 只做两件事——搜关键词、读某个 URL 的正文摘要；不写文件、不带 cookie、不登录。
// 用法：
//   node scripts/web-lookup.mjs probe
//   node scripts/web-lookup.mjs search "证券公司 上市公司 信息披露" [--count 5]
//   node scripts/web-lookup.mjs fetch "https://www.sac.net.cn/" [--max-chars 4000]

// 既能当命令跑，也能被其它脚本 import 复用（import 时不解析参数、不执行命令）。
const entryPoint = process.argv[1] || "";
const isMain = (() => {
  if (!entryPoint) return false;
  try { return import.meta.url === pathToFileURL(entryPoint).href; } catch { return false; }
})();

const args = isMain ? process.argv.slice(2) : [];
const command = args[0] || "probe";
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const OPTION_FLAGS = new Set(["--count", "--max-chars", "--timeout", "--site"]);
const positional = [];
for (let index = 1; index < args.length; index += 1) {
  const value = args[index];
  if (OPTION_FLAGS.has(value)) { index += 1; continue; }
  if (value.startsWith("--")) continue;
  positional.push(value);
}
const timeoutMs = Number(option("--timeout", "25000"));
// 测试用：把检索请求指到本地假引擎，避免测试依赖真实搜索引擎。
const searchEndpoint = (process.env.SECURITIES_WEB_LOOKUP_SEARCH_ENDPOINT || "").trim();

const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const stamp = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}（本机时间）`;
};

const decodeEntities = (text) => text
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, "\"")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

const stripTags = (html) => decodeEntities(
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
)
  .replace(/\s+/g, " ")
  .trim();

const clipText = (text, max) => (text.length > max ? `${text.slice(0, max)}…（已截断）` : text);

async function request(url, { method = "GET", accept = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8" } = {}) {
  const response = await fetch(url, {
    method,
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8", Accept: accept },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const body = method === "HEAD" ? "" : await response.text();
  return { response, body, finalUrl: response.url || url };
}

function parseBingResults(html, limit) {
  const results = [];
  const blocks = html.split(/class="b_algo"/).slice(1);
  for (const block of blocks) {
    const anchor = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const url = decodeEntities(anchor[1]);
    const title = stripTags(anchor[2]);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    const snippetMatch = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block);
    const snippet = snippetMatch ? stripTags(snippetMatch[1]) : "";
    results.push({ title, url, snippet: clipText(snippet, 320) });
    if (results.length >= limit) break;
  }
  return results;
}

// 关键词拆分：中文按二元组，英文数字按整词，用于过滤搜索结果的相关性。
function queryTerms(query) {
  const cleaned = query.replace(/site:\S+/gi, " ").replace(/["'“”]/g, " ");
  const terms = new Set();
  for (const token of cleaned.split(/[\s，,、。；;：:()（）\[\]【】]+/).filter(Boolean)) {
    if (/^[A-Za-z0-9.+-]{2,}$/.test(token)) { terms.add(token.toLowerCase()); continue; }
    const cjk = token.replace(/[^\u4e00-\u9fa5]/g, "");
    if (cjk.length >= 2) {
      for (let i = 0; i < cjk.length - 1; i += 1) terms.add(cjk.slice(i, i + 2));
      if (cjk.length <= 6) terms.add(cjk);
    } else if (cjk.length === 1) terms.add(cjk);
  }
  return [...terms];
}

function hostMatches(url, site) {
  if (!site) return true;
  try { return new URL(url).hostname.toLowerCase().endsWith(site.toLowerCase()); } catch { return false; }
}

function isRelevant(result, terms, site = "") {
  if (site && !hostMatches(result.url, site)) return false;
  if (!terms.length) return true;
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

const isSearchHost = (url) => /^https?:\/\/([a-z0-9-]+\.)*(so|sogou|bing|baidu|360)\.(com|cn)\//i.test(url);

// 搜狗 / 360 的结果链接是站内跳转页，真正的目标 URL 在页面里的 location.replace 或 meta refresh 中。
async function resolveRedirect(url) {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const { body, finalUrl } = await request(url);
    if (/^https?:\/\//i.test(finalUrl) && finalUrl !== url && !isSearchHost(finalUrl)) return finalUrl;
    const jump = /window\.location\.replace\(\s*["']([^"']+)["']/i.exec(body)
      || /http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>]+)/i.exec(body);
    const target = jump ? decodeEntities(jump[1]).trim() : "";
    if (/^https?:\/\//i.test(target) && !isSearchHost(target)) return target;
    return null;
  } catch { return null; }
}

function parseSogouResults(html, limit) {
  const results = [];
  for (const block of (html.match(/<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>[\s\S]{0,900}?<\/h3>/g) || [])) {
    const anchor = /href="([^"]+)"/.exec(block);
    if (!anchor) continue;
    const title = stripTags(block);
    if (!title) continue;
    results.push({ title, url: decodeEntities(anchor[1]), snippet: "", needsResolve: true });
    if (results.length >= limit * 2) break;
  }
  return results;
}

function parse360Results(html, limit) {
  const results = [];
  for (const block of (html.match(/<h3[^>]*>[\s\S]{0,900}?<\/h3>/g) || [])) {
    const anchor = /href="([^"]+)"/.exec(block);
    if (!anchor) continue;
    const title = stripTags(block);
    if (!title || title.length < 4) continue;
    results.push({ title, url: decodeEntities(anchor[1]), snippet: "", needsResolve: true });
    if (results.length >= limit * 2) break;
  }
  return results;
}

const engines = searchEndpoint
  ? [{
      name: "自定义检索端点",
      build: (query) => `${searchEndpoint}${searchEndpoint.includes("?") ? "&" : "?"}q=${encodeURIComponent(query)}`,
      parse: (html, limit) => parseBingResults(html, limit).map((item) => ({ ...item, needsResolve: false }))
    }]
  : [
  { name: "Bing", build: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`, parse: (html, limit) => parseBingResults(html, limit).map((item) => ({ ...item, needsResolve: false })) },
  { name: "搜狗", build: (query) => `https://www.sogou.com/web?query=${encodeURIComponent(query)}`, parse: parseSogouResults },
  { name: "360 搜索", build: (query) => `https://www.so.com/s?q=${encodeURIComponent(query)}`, parse: parse360Results }
];

function printResults(engineName, query, results, filteredCount) {
  console.log(`检索时间：${stamp()}`);
  console.log(`查询：${query}`);
  console.log(`来源：${engineName} 网页搜索（摘要与排序由搜索引擎给出，结论要落到官方页面再确认）`);
  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.title}`);
    console.log(`   ${result.url}`);
    if (result.snippet) console.log(`   ${result.snippet}`);
  });
  if (filteredCount > 0) console.log(`（已过滤 ${filteredCount} 条与关键词无关的结果）`);
}

// 返回 { engine, query, results, filtered }；搜不到时 results 为空数组。
export async function lookupSearch(query, limit = 5, site = "") {
  if (!query) throw new Error("search 需要关键词");
  const fullQuery = site ? `site:${site} ${query}` : query;
  const terms = queryTerms(fullQuery);
  const attempts = [];
  let best = null;
  for (const engine of engines) {
    let results = [];
    try {
      const { body, response } = await request(engine.build(fullQuery));
      if (!response.ok) { attempts.push(`${engine.name}:HTTP ${response.status}`); continue; }
      results = engine.parse(body, limit);
    } catch (error) { attempts.push(`${engine.name}:${error.message}`); continue; }
    const relevant = [];
    for (const result of results) {
      if (relevant.length >= limit) break;
      if (process.env.SECURITIES_WEB_LOOKUP_DEBUG) console.error(`[debug] ${engine.name} 候选 ${isRelevant(result, terms, site) ? "相关" : "过滤"}：${result.title.slice(0, 40)} | ${result.url.slice(0, 60)}`);
      if (!isRelevant(result, terms, site)) continue;
      if (result.needsResolve) {
        const raw = result.url.startsWith("/") ? `https://www.sogou.com${result.url}` : result.url;
        const resolved = await resolveRedirect(raw);
        if (!resolved) continue;
        result.url = resolved;
      }
      relevant.push(result);
    }
    // 相关结果够多就直接采用；只有一条时先记下来，继续试下一个引擎，最后再回退到它。
    if (relevant.length >= Math.min(2, limit) || (relevant.length >= 1 && results.length <= 2)) {
      return { engine: engine.name, query: fullQuery, results: relevant, filtered: results.length - relevant.length, attempts };
    }
    if (relevant.length && (!best || relevant.length > best.results.length)) best = { engine: engine.name, results: relevant, filtered: results.length - relevant.length };
    attempts.push(`${engine.name}:${relevant.length} 条相关结果`);
  }
  if (best) return { engine: best.engine, query: fullQuery, results: best.results, filtered: best.filtered, attempts, fallback: true };
  return { engine: "", query: fullQuery, results: [], filtered: 0, attempts };
}

async function search(query, limit, site) {
  const found = await lookupSearch(query, limit, site);
  if (!found.results.length) {
    console.log(`检索时间：${stamp()}`);
    console.log(`查询：${found.query}`);
    console.log(`未能拿到可信的搜索结果（${found.attempts.join("；")}）。`);
    console.log("建议改用更短的关键词、加 --site 限定官方域名，或用 fetch 直接读取已知官方页面（如 https://www.sac.net.cn/ ）。");
    return 1;
  }
  if (found.fallback) console.log(`（只找到 ${found.results.length} 条相关结果，结论请务必用 fetch 打开页面确认）`);
  printResults(found.engine, found.query, found.results, found.filtered);
  return 0;
}

// 返回 { url, finalUrl, status, title, text }；text 为去标签后的正文（未截断）。
export async function lookupPage(target) {
  if (!/^https?:\/\//i.test(target || "")) throw new Error("fetch 需要 http/https 开头的完整 URL");
  let attempt;
  try { attempt = await request(target); }
  catch { attempt = await request(target); }
  const { body, response, finalUrl } = attempt;
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] || "");
  return { url: target, finalUrl, status: response.status, title, text: stripTags(body) };
}

async function fetchPage(target, maxChars) {
  const page = await lookupPage(target);
  console.log(`抓取时间：${stamp()}`);
  const { finalUrl, status, title, text } = page;
  console.log(`请求 URL：${target}`);
  console.log(`最终 URL：${finalUrl}`);
  console.log(`HTTP 状态：${status}`);
  if (title) console.log(`页面标题：${title}`);
  console.log(`正文摘录：${text ? clipText(text, maxChars) : "（未提取到正文，可能是 PDF、脚本渲染页面或空响应）"}`);
  return status >= 200 && status < 300 ? 0 : 1;
}

// 探测本机是否能出网：官方站点偶尔很慢，所以多个目标、任一成功即算可用。
const PROBE_TARGETS = ["https://www.sac.net.cn/", "https://www.gov.cn/", "https://www.csrc.gov.cn/"];

async function probeOne(target) {
  const started = Date.now();
  const { response } = await request(target, { method: "HEAD" });
  return { ok: response.ok, status: response.status, ms: Date.now() - started, target };
}

async function probe() {
  const failures = [];
  for (const target of PROBE_TARGETS) {
    try {
      const result = await probeOne(target);
      if (result.ok) {
        console.log(`本地联网可用：${result.target} 返回 HTTP ${result.status}（${result.ms}ms，探测时间 ${stamp()}）`);
        return 0;
      }
      failures.push(`${target} HTTP ${result.status}`);
    } catch (error) {
      failures.push(`${target} ${error.message}`);
    }
  }
  console.log(`本地联网不可用：${failures.join("；")}（探测时间 ${stamp()}）`);
  return 1;
}

if (isMain) try {
  const limit = Number(option("--count", "5"));
  const maxChars = Number(option("--max-chars", "4000"));
  if (command === "search") process.exitCode = await search(positional.join(" ").trim(), Number.isFinite(limit) && limit > 0 ? Math.min(limit, 10) : 5, option("--site", ""));
  else if (command === "fetch") process.exitCode = await fetchPage(positional[0], Number.isFinite(maxChars) && maxChars > 0 ? Math.min(maxChars, 12000) : 4000);
  else if (command === "probe") process.exitCode = await probe();
  else {
    console.error("用法：node scripts/web-lookup.mjs probe | search \"关键词\" [--count 5] [--site sac.net.cn] | fetch <URL> [--max-chars 4000]");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`联网检索失败：${error.message}`);
  process.exitCode = 1;
}
