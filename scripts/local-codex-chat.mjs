import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { dirname, extname, resolve, sep } from "node:path";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const port = Number(option("--port", "43117"));
const staticRoot = resolve(projectRoot, option("--static-root", "."));
const codexBinary = process.env.SECURITIES_CODEX_BINARY || "codex";
const requestedWebSearchMode = process.env.SECURITIES_CODEX_WEB_SEARCH || "live";
const standaloneWebSearchProvider = (process.env.SECURITIES_CODEX_WEB_SEARCH_PROVIDER ?? "zycrafts").trim();
const tutorModel = (process.env.SECURITIES_CODEX_MODEL ?? "deepseek-flash").trim();
const tutorReasoningEffort = (process.env.SECURITIES_CODEX_REASONING_EFFORT ?? "medium").trim().toLowerCase();
// 助教的联网核验走本机 scripts/web-lookup.mjs：只读沙箱 + 允许出网，不放开写权限。
const networkEnabled = process.env.SECURITIES_CODEX_NETWORK !== "0";
const webSearchModes = new Set(["disabled", "cached", "indexed", "live"]);
const reasoningEfforts = new Set(["minimal", "low", "medium", "high", "xhigh"]);

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port 必须是 1024—65535 之间的整数");
if (!staticRoot.startsWith(`${projectRoot}${sep}`) && staticRoot !== projectRoot) throw new Error("--static-root 必须位于项目目录内");
if (!existsSync(resolve(staticRoot, "index.html"))) throw new Error(`未找到 ${resolve(staticRoot, "index.html")}`);
if (!webSearchModes.has(requestedWebSearchMode)) throw new Error("SECURITIES_CODEX_WEB_SEARCH 必须是 disabled、cached、indexed 或 live");
if (standaloneWebSearchProvider && !/^[A-Za-z0-9_-]+$/.test(standaloneWebSearchProvider)) {
  throw new Error("SECURITIES_CODEX_WEB_SEARCH_PROVIDER 只能包含字母、数字、下划线或连字符");
}
if (!/^[A-Za-z0-9._:-]+$/.test(tutorModel)) {
  throw new Error("SECURITIES_CODEX_MODEL 只能包含字母、数字、点、下划线、冒号或连字符");
}
if (!reasoningEfforts.has(tutorReasoningEffort)) {
  throw new Error("SECURITIES_CODEX_REASONING_EFFORT 必须是 minimal、low、medium、high 或 xhigh");
}

const configOverrides = [
  // 助教默认使用轻量模型和中等推理强度，只作用于本次聊天进程，不改动 ~/.codex/config.toml。
  "-c", `model="${tutorModel}"`,
  "-c", `model_reasoning_effort="${tutorReasoningEffort}"`,
  "-c", `web_search=${requestedWebSearchMode}`,
  "-c", "features.apps=false",
  "-c", "features.multi_agent=false",
  "-c", "mcp_servers.playwright.enabled=false",
  "-c", "mcp_servers.openaiDeveloperDocs.enabled=false",
  "-c", "mcp_servers.test-manage.enabled=false",
  "-c", "mcp_servers.figma.enabled=false",
  "-c", "mcp_servers.node_repl.enabled=false",
  "-c", "mcp_servers.computer-use.enabled=false"
];
if (requestedWebSearchMode !== "disabled" && standaloneWebSearchProvider) {
  configOverrides.push("-c", `model_providers.${standaloneWebSearchProvider}.supports_standalone_web_search=true`);
}
const codexArgs = ["app-server", ...configOverrides, "--stdio"];

const tutorInstructionsBase = `你是证券行业专业人员一般业务水平评价测试的本地学习助教。默认使用简洁、准确的中文回答。
你的主要任务是解释当前题目、金融基础概念、证券市场基本法律法规、案例材料和复习方法。
项目目录包含题库、大纲、学习说明、三色笔记讲义摘录和教材参考页。需要核实时可以只读检索这些本地文件；不得修改、创建或删除任何文件，除下面明确允许的只读联网检索命令外，不要执行其他 shell 命令或外部操作。
回答尽量快：概念解释、常识性公式和判断口径直接用你已有的知识回答；只有当用户问到具体题目、需要教材/讲义出处，或涉及必须核对的数字和法条时，才用一次检索定位，一次回答最多检索两处，不要为了“确认一下”反复翻文件。
本地资料优先。`;
const searchGuidance = `用户问到“最新、截至目前、现行有效、近期公告、考试安排、是否已上市或已变更”等可能随时间变化的信息时，必须先核验再回答，不能只凭记忆下结论，也不能一边说无法联网一边给出确定口径。
核验方式只有一种：运行只读命令 node scripts/web-lookup.mjs —— 检索用 node scripts/web-lookup.mjs search "关键词"，读某个页面用 node scripts/web-lookup.mjs fetch "https://…"。不要使用 curl、wget、浏览器、MCP 或其他外部工具，不要写文件；除只读查看项目内资料和这条检索命令外，不要执行其他 shell 命令。
检索关键词控制在 2~4 个词，不要拿整句话去搜；已知官方域名时用 node scripts/web-lookup.mjs search "关键词" --site sac.net.cn。搜索只给摘要和线索，结论要落到抓取到的官方页面上：先在搜索结果里找到官方链接，再用 fetch 读那一页。
优先中国证券业协会、证监会、交易所、政府网站等一手来源，二手站点只当线索。回答里给出关键来源 URL 和本机抓取日期，并区分官方公告、公司披露与搜索摘要。检索失败、被拦截或没有结果时直接说明，降级到本地资料并标注核验截止日期，不要用猜测的 URL 反复试。普通概念和题目解析优先用本地资料；一次回答最多检索两三次。
`;
const builtinSearchGuidance = `用户问到“最新、截至目前、现行有效、近期公告、考试安排、是否已上市或已变更”等可能随时间变化的信息时，必须先使用内置 web search 核验再回答，不能只凭记忆下结论，也不能在尚未尝试搜索时声称自己无法联网。
联网时只用 Codex 内置 web search，不要为了搜索执行 shell、curl、wget、浏览器、MCP 或其他外部工具。优先中国证券业协会、监管机关、政府网站、交易所和公司官网等一手来源；回答中列出关键来源 URL 和访问日期，并区分官方公告、公司披露与搜索摘要。搜索不可用或失败时明确说明，降级到本地资料及其核验截止日期。
`;
const tutorInstructionsTail = `引用口径按优先级区分：中国现行有效法律法规和官方资料优先；讲义与题目出处来自个人整理的三色笔记，属于定位信息；教材参考页由文本相似度自动匹配，金融科为 2025 协会统编教材、法规科为 2020 商业教材，都需提示识别误差和时效边界。
不要把本项目说成官方题库、真题或完整覆盖，不得保证通过考试。遇到可能随时间变化的法规、日期、比例、期限或考试安排，要说明资料核验截止日期，并提醒以最新官方公告或有效规则为准。
题目尚未提交时，除非用户明确要求直接给答案，优先通过关键词、排除法和追问引导。涉及具体投资决策时，明确区分考试知识解释与个性化投资建议。
这是问答面板，不是代码开发会话。不要提议编辑项目，不要启动子代理，不要请求执行权限。`;
const buildTutorInstructions = ({ builtinAvailable = false, localLookup = false } = {}) => [
  tutorInstructionsBase,
  localLookup ? searchGuidance : builtinAvailable ? builtinSearchGuidance : offlineGuidance,
  tutorInstructionsTail
].join("\n");

class CodexConnection extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.pending = new Map();
    this.nextId = 1;
    this.starting = null;
    this.loadedThreads = new Set();
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.proc && !this.proc.killed) return;
    this.starting = this.#start();
    try { await this.starting; } finally { this.starting = null; }
  }

  async #start() {
    this.proc = spawn(codexBinary, codexArgs, {
      cwd: projectRoot,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => process.stderr.write(`[codex] ${chunk}`));
    createInterface({ input: this.proc.stdout }).on("line", (line) => {
      try { this.#handle(JSON.parse(line)); }
      catch (error) { console.error("无法解析 Codex app-server 消息：", error.message); }
    });
    this.proc.once("exit", (code, signal) => {
      const error = new Error(`Codex app-server 已退出（${signal || code || "unknown"}）`);
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
      this.pending.clear();
      this.loadedThreads.clear();
      this.proc = null;
      this.emit("exit", error);
    });
    this.proc.once("error", (error) => {
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
      this.pending.clear();
    });
    await this.call("initialize", {
      clientInfo: { name: "securities_exam_tutor", title: "证券考试本地 AI 助教", version: "0.1.0" }
    }, 20_000);
    this.notify("initialized", {});
  }

  #handle(message) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Codex 请求失败"));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.#rejectServerRequest(message);
      return;
    }
    if (message.method) this.emit("notification", message);
  }

  #rejectServerRequest(message) {
    let result;
    if (["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(message.method)) result = { decision: "decline" };
    else if (["applyPatchApproval", "execCommandApproval"].includes(message.method)) result = { decision: { denied: { rejection: "本地学习助教仅允许只读问答" } } };
    else if (message.method === "item/tool/requestUserInput") result = { answers: {} };
    else if (message.method === "mcpServer/elicitation/request") result = { action: "decline" };
    else {
      this.#write({ id: message.id, error: { code: -32601, message: "本地学习助教不支持该交互请求" } });
      return;
    }
    this.#write({ id: message.id, result });
  }

  #write(message) {
    if (!this.proc?.stdin?.writable) throw new Error("Codex app-server 未运行");
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) { this.#write({ method, params }); }

  async call(method, params = {}, timeoutMs = 60_000) {
    if (method !== "initialize") await this.start();
    const id = this.nextId++;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Codex 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
    });
    this.#write({ method, id, params });
    return promise;
  }

  async thread(requestedThreadId) {
    if (requestedThreadId && this.loadedThreads.has(requestedThreadId)) return requestedThreadId;
    const developerInstructions = buildTutorInstructions(await webSearchReadiness());
    if (requestedThreadId) {
      try {
        await this.call("thread/resume", {
          threadId: requestedThreadId,
          cwd: projectRoot,
          sandbox: "read-only",
          approvalPolicy: "never",
          developerInstructions
        });
        this.loadedThreads.add(requestedThreadId);
        return requestedThreadId;
      } catch (error) {
        console.warn(`无法恢复旧对话，将新建线程：${error.message}`);
      }
    }
    const result = await this.call("thread/start", {
      cwd: projectRoot,
      sandbox: "read-only",
      approvalPolicy: "never",
      personality: "friendly",
      developerInstructions
    });
    const threadId = result?.thread?.id;
    if (!threadId) throw new Error("Codex 没有返回对话线程 ID");
    this.loadedThreads.add(threadId);
    return threadId;
  }

  stop() {
    if (this.proc && !this.proc.killed) this.proc.kill("SIGTERM");
  }
}

const codex = new CodexConnection();
const busyThreads = new Set();

// codex 只对开启 features.standalone_web_search 的第三方供应商暴露内置联网工具；供应商声明
// supports_standalone_web_search 并不代表当前模型真的拿到了该工具，所以这里直接问 codex 生效值。
const webSearchFeatureCache = { at: 0, value: null };
function readWebSearchFeature(timeoutMs = 8_000) {
  return new Promise((resolvePromise) => {
    let child;
    try { child = spawn(codexBinary, ["features", "list", ...configOverrides], { cwd: projectRoot, env: process.env, stdio: ["ignore", "pipe", "ignore"] }); }
    catch { return resolvePromise(null); }
    let stdout = "";
    const finish = (value) => { clearTimeout(timer); resolvePromise(value); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(null); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", () => finish(null));
    child.once("close", () => {
      // 形如：standalone_web_search   under development  false（阶段名本身可能含空格）
      const matched = /^standalone_web_search\b[^\n]*?\b(true|false)\s*$/m.exec(stdout);
      finish(matched ? matched[1] === "true" : null);
    });
  });
}

async function standaloneWebSearchFeature() {
  if (webSearchFeatureCache.at && Date.now() - webSearchFeatureCache.at < 30_000) return webSearchFeatureCache.value;
  const value = await readWebSearchFeature();
  webSearchFeatureCache.value = value;
  webSearchFeatureCache.at = Date.now();
  return value;
}

// 模型自带的 web search 在第三方代理上经常拿不到，所以助教的联网能力以本机只读检索助手为准：
// 用 scripts/web-lookup.mjs 直接访问网络，模型只负责给出关键词和读结果。
const localLookupCache = { at: 0, value: null };
const localLookupEnabled = networkEnabled && requestedWebSearchMode !== "disabled";

function probeLocalLookup(timeoutMs = 25_000) {
  return new Promise((resolvePromise) => {
    let child;
    try {
      child = spawn(process.execPath, [resolve(projectRoot, "scripts/web-lookup.mjs"), "probe", "--timeout", "8000"], {
        cwd: projectRoot, env: process.env, stdio: ["ignore", "ignore", "ignore"]
      });
    } catch { return resolvePromise(false); }
    const finish = (value) => { clearTimeout(timer); resolvePromise(value); };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(false); }, timeoutMs);
    child.once("error", () => finish(false));
    child.once("close", (code) => finish(code === 0));
  });
}

async function localLookupAvailable() {
  if (!localLookupEnabled) return false;
  // 探测成功缓存 5 分钟；失败只缓存 30 秒，避免一次网络抖动让助教长时间以为无法联网。
  const ttl = localLookupCache.value ? 300_000 : 30_000;
  if (localLookupCache.at && Date.now() - localLookupCache.at < ttl) return localLookupCache.value;
  const value = await probeLocalLookup();
  localLookupCache.value = value;
  localLookupCache.at = Date.now();
  console.log(`本机联网检索：${value ? "可用" : "不可用"}（探测时间 ${new Date().toLocaleString("zh-CN")}）`);
  return value;
}

async function webSearchReadiness() {
  const [configResult, featureEnabled] = await Promise.all([
    codex.call("config/read", {}, 20_000).catch(() => null),
    standaloneWebSearchFeature()
  ]);
  const config = configResult?.config || {};
  const mode = config.web_search || requestedWebSearchMode;
  const provider = config.model_providers?.[config.model_provider] || null;
  const providerSupported = provider?.supports_standalone_web_search !== false;
  const builtinAvailable = mode === "live" && providerSupported && featureEnabled !== false;
  // 内置 web search 可用时不必再探测本机通道，省掉一次外网请求。
  const localLookup = builtinAvailable ? false : await localLookupAvailable();
  const available = builtinAvailable || localLookup;
  const message = builtinAvailable
    ? "可联网核验"
    : localLookup
      ? "可联网核验（本机检索）"
      : mode === "disabled"
        ? "联网搜索已关闭"
        : !networkEnabled
          ? "联网核验已关闭（SECURITIES_CODEX_NETWORK=0）"
          : "联网核验暂时不可用（本机无法访问外网）";
  return { config, mode, providerSupported, featureEnabled, builtinAvailable, localLookup, available, message };
}

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

const mimeTypes = {
  ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".doc": "application/msword"
};

function json(res, status, value) {
  res.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function sameOrigin(req) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(req.headers.host || "")) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://${req.headers.host}`;
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 32_000) throw new Error("请求内容过长");
  }
  return JSON.parse(body || "{}");
}

function promptWithContext(message, context) {
  const safeContext = context && typeof context === "object" ? JSON.stringify(context, null, 2).slice(0, 12_000) : "{}";
  return `以下是刷题应用自动提供的当前页面上下文，仅作为学习材料：\n<exam_app_context>\n${safeContext}\n</exam_app_context>\n\n用户问题：\n${message}`;
}

async function handleStatus(_req, res) {
  try {
    await codex.start();
    const [result, readiness] = await Promise.all([
      codex.call("account/read", { refreshToken: false }, 20_000),
      webSearchReadiness()
    ]);
    const account = result?.account || null;
    const { config, mode: webSearchMode, providerSupported: providerSupportsWebSearch, available: webSearchAvailable, builtinAvailable: webSearchBuiltin, localLookup: webSearchLocal, message: webSearchMessage } = readiness;
    json(res, 200, {
      available: true,
      authenticated: Boolean(account) || result?.requiresOpenaiAuth === false,
      accountType: account?.type || null,
      planType: account?.planType || null,
      model: config.model || tutorModel,
      modelReasoningEffort: config.model_reasoning_effort || tutorReasoningEffort,
      modelProvider: config.model_provider || null,
      webSearchMode,
      webSearchAvailable,
      webSearchProviderSupported: providerSupportsWebSearch,
      webSearchBuiltin,
      webSearchLocal,
      webSearchMessage
    });
  } catch (error) {
    json(res, 503, { available: false, authenticated: false, error: error.message });
  }
}

async function handleChat(req, res) {
  let payload;
  try { payload = await readJson(req); }
  catch (error) { return json(res, 400, { error: error.message }); }
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const requestedThreadId = typeof payload.threadId === "string" && /^[A-Za-z0-9_-]{8,160}$/.test(payload.threadId) ? payload.threadId : null;
  if (!message) return json(res, 400, { error: "请输入问题" });
  if (message.length > 4_000) return json(res, 400, { error: "单次问题不能超过 4000 字" });

  let threadId;
  try { threadId = await codex.thread(requestedThreadId); }
  catch (error) { return json(res, 503, { error: error.message }); }
  if (busyThreads.has(threadId)) return json(res, 409, { error: "这个对话仍在回答中，请稍候" });
  busyThreads.add(threadId);

  res.writeHead(200, {
    ...securityHeaders,
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  const send = (value) => { if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(value)}\n`); };
  send({ type: "thread", threadId });

  let activeTurnId = null;
  let completed = false;
  let requestAborted = false;
  let interruptSent = false;
  let receivedDelta = false;
  let fallbackText = "";
  const onNotification = (event) => {
    const params = event.params || {};
    if (params.threadId !== threadId) return;
    if (activeTurnId && params.turnId && params.turnId !== activeTurnId) return;
    if (event.method === "item/agentMessage/delta") {
      receivedDelta = true;
      send({ type: "delta", text: params.delta || "" });
    } else if (event.method === "item/started" && params.item?.type === "webSearch") {
      const query = params.item.query || params.item.action?.query || params.item.action?.queries?.[0] || null;
      send({ type: "search", query });
    } else if (event.method === "item/completed" && params.item?.type === "agentMessage") {
      fallbackText = params.item.text || fallbackText;
    } else if (event.method === "turn/completed") {
      completed = true;
      if (!receivedDelta && fallbackText) send({ type: "delta", text: fallbackText });
      const status = params.turn?.status || "completed";
      send({ type: "done", status, error: params.turn?.error?.message || null });
      cleanup();
      res.end();
    }
  };
  const cleanup = () => {
    codex.off("notification", onNotification);
    busyThreads.delete(threadId);
  };
  codex.on("notification", onNotification);
  const interruptTurn = () => {
    if (!activeTurnId || interruptSent) return;
    interruptSent = true;
    codex.call("turn/interrupt", { threadId, turnId: activeTurnId }, 10_000).catch(() => {});
  };
  const abortTurn = () => {
    if (completed || requestAborted) return;
    requestAborted = true;
    cleanup();
    interruptTurn();
  };
  req.on("aborted", abortTurn);
  res.on("close", () => { if (!res.writableEnded) abortTurn(); });

  try {
    const result = await codex.call("turn/start", {
      threadId,
      input: [{ type: "text", text: promptWithContext(message, payload.context) }],
      cwd: projectRoot,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: localLookupEnabled },
      personality: "friendly"
    }, 60_000);
    activeTurnId = result?.turn?.id || null;
    if (requestAborted) interruptTurn();
  } catch (error) {
    completed = true;
    send({ type: "error", error: error.message });
    cleanup();
    res.end();
  }
}

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname); }
  catch { return json(res, 400, { error: "无效路径" }); }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = resolve(staticRoot, relative);
  if ((!file.startsWith(`${staticRoot}${sep}`) && file !== staticRoot) || !existsSync(file) || !statSync(file).isFile()) {
    return json(res, 404, { error: "Not found" });
  }
  res.writeHead(200, {
    ...securityHeaders,
    "Cache-Control": /\.(?:js|css)$/.test(file) ? "no-cache" : "no-store",
    "Content-Type": mimeTypes[extname(file).toLowerCase()] || "application/octet-stream"
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const method = req.method || "GET";
  if (!sameOrigin(req)) return json(res, 403, { error: "只允许本机同源页面访问 Codex 助教" });
  if (method === "GET" && req.url === "/api/codex/status") return handleStatus(req, res);
  if (method === "POST" && req.url === "/api/codex/chat") return handleChat(req, res);
  if (!["GET", "HEAD"].includes(method)) return json(res, 405, { error: "Method not allowed" });
  return serveStatic(req, res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`证券考试工具已启动：http://127.0.0.1:${port}`);
  console.log(`Codex web search 模式：${requestedWebSearchMode}（是否可用以状态栏检测结果为准）`);
  console.log("右侧 AI 助教会自动连接本机 Codex；按 Control-C 停止。");
});

const shutdown = () => {
  codex.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2_000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
