// 只读联网检索助手的离线冒烟：用本地假引擎和本地页面验证解析、过滤、抓取与跳转。
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helper = resolve(root, "scripts/web-lookup.mjs");

const searchHtml = `<!doctype html><html><body>
<div class="b_algo"><h2><a href="https://www.sac.net.cn/fwdt/ksfw/sppjcs/shpjcstz/202608/t20260814_82151.html">关于2026年9月证券行业专业人员水平评价统一测试的公告</a></h2><p>报名交费截止时间为2026年8月28日15时。</p></div>
<div class="b_algo"><h2><a href="https://example.com/holiday">2026年放假安排日历</a></h2><p>元旦、春节、清明节的放假日期。</p></div>
</body></html>`;

const articleHtml = `<!doctype html><html><head><title>关于2026年9月证券行业专业人员水平评价统一测试的公告</title></head>
<body><script>var a=1;</script><p>报名交费截止时间为2026年8月28日15时。</p><p>准考证打印时间：2026年9月16日15时至9月19日18时。</p></body></html>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/search") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(searchHtml);
  }
  if (url.pathname === "/article") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(articleHtml);
  }
  if (url.pathname === "/jump") {
    res.writeHead(302, { Location: "/article" });
    return res.end();
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});

const port = await new Promise((resolvePort, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolvePort(server.address().port));
});
const base = `http://127.0.0.1:${port}`;

const run = (args, env = {}) => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [helper, ...args], { cwd: root, env: { ...process.env, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => resolveRun({ code, stdout, stderr }));
});

try {
  const search = await run(["search", "证券 统一测试 公告", "--count", "3"], { SECURITIES_WEB_LOOKUP_SEARCH_ENDPOINT: `${base}/search` });
  if (search.code !== 0 || !search.stdout.includes("t20260814_82151.html") || !search.stdout.includes("已过滤 1 条")) {
    throw new Error(`search 行为不符合预期：${JSON.stringify(search)}`);
  }

  const article = await run(["fetch", `${base}/article`, "--max-chars", "120"]);
  if (article.code !== 0 || !article.stdout.includes("HTTP 状态：200") || !article.stdout.includes("报名交费截止时间为2026年8月28日15时") || article.stdout.includes("<p>")) {
    throw new Error(`fetch 行为不符合预期：${JSON.stringify(article)}`);
  }

  const jumped = await run(["fetch", `${base}/jump`, "--max-chars", "60"]);
  if (jumped.code !== 0 || !jumped.stdout.includes(`最终 URL：${base}/article`)) {
    throw new Error(`fetch 跳转行为不符合预期：${JSON.stringify(jumped)}`);
  }

  const missing = await run(["fetch", `${base}/missing`]);
  if (missing.code !== 1 || !missing.stdout.includes("HTTP 状态：404")) {
    throw new Error(`404 处理不符合预期：${JSON.stringify(missing)}`);
  }

  console.log(JSON.stringify({ ok: true, search: search.stdout.trim().split("\n").slice(0, 3), articleStatus: "200", redirect: "跟随成功" }));
} finally {
  server.close();
}
