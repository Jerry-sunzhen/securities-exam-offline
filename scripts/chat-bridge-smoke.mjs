import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(resolve(tmpdir(), "securities-codex-bridge-"));
const fakeCodex = resolve(temp, "fake-codex.mjs");
const fakeSource = `#!/usr/bin/env node
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const activeTurns = new Set();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
process.stderr.write("ARGS:" + JSON.stringify(process.argv.slice(2)) + "\\n");
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized") return;
  if (message.method === "initialize") return send({ id: message.id, result: { userAgent: "fake" } });
  if (message.method === "account/read") return send({ id: message.id, result: { account: { type: "chatgpt", email: null, planType: "plus" }, requiresOpenaiAuth: true } });
  if (message.method === "config/read") return send({ id: message.id, result: { config: { web_search: "live", model_provider: "fake", model_providers: { fake: { supports_standalone_web_search: true } } } } });
  if (message.method === "thread/start") return send({ id: message.id, result: { thread: { id: "fake-thread-123" } } });
  if (message.method === "thread/resume") return send({ id: message.id, result: { thread: { id: message.params.threadId } } });
  if (message.method === "turn/interrupt") {
    activeTurns.delete(message.params.turnId);
    process.stderr.write("INTERRUPTED\\n");
    return send({ id: message.id, result: {} });
  }
  if (message.method === "turn/start") {
    const threadId = message.params.threadId;
    const turnId = "fake-turn-123";
    const shouldSearch = message.params.input?.[0]?.text.includes("测试联网搜索");
    const start = () => {
      activeTurns.add(turnId);
      send({ id: message.id, result: { turn: { id: turnId, items: [], status: "inProgress" } } });
    };
    if (message.params.input?.[0]?.text.includes("测试打断")) setTimeout(start, 200);
    else start();
    setTimeout(() => {
      if (!activeTurns.has(turnId)) return;
      activeTurns.delete(turnId);
      if (shouldSearch) send({ method: "item/started", params: { threadId, turnId, item: { type: "webSearch", query: "证券公司最新公告" } } });
      send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "fake-item", delta: "测试回答" } });
      send({ method: "turn/completed", params: { threadId, turn: { id: turnId, items: [], status: "completed" } } });
    }, message.params.input?.[0]?.text.includes("测试打断") ? 250 : 10);
    return;
  }
  send({ id: message.id, error: { code: -32601, message: "unsupported" } });
});
`;
writeFileSync(fakeCodex, fakeSource);
chmodSync(fakeCodex, 0o700);

const availablePort = await new Promise((resolvePort, reject) => {
  const probe = createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const selected = probe.address().port;
    probe.close((error) => error ? reject(error) : resolvePort(selected));
  });
});

const bridge = spawn(process.execPath, ["scripts/local-codex-chat.mjs", "--port", String(availablePort)], {
  cwd: root,
  env: { ...process.env, SECURITIES_CODEX_BINARY: fakeCodex },
  stdio: ["ignore", "pipe", "pipe"]
});
let output = "";
bridge.stdout.setEncoding("utf8");
bridge.stderr.setEncoding("utf8");
bridge.stdout.on("data", (chunk) => { output += chunk; });
bridge.stderr.on("data", (chunk) => { output += chunk; });

try {
  const baseUrl = `http://127.0.0.1:${availablePort}`;
  const deadline = Date.now() + 10_000;
  while (!output.includes(baseUrl)) {
    if (bridge.exitCode !== null) throw new Error(`Bridge exited early: ${output}`);
    if (Date.now() > deadline) throw new Error(`Bridge startup timed out: ${output}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  const statusResponse = await fetch(`${baseUrl}/api/codex/status`);
  const status = await statusResponse.json();
  if (!statusResponse.ok || !status.available || !status.authenticated || status.planType !== "plus" || status.modelProvider !== "fake" || status.webSearchMode !== "live" || !status.webSearchAvailable || !output.includes("web_search=live") || !output.includes("model_providers.zycrafts.supports_standalone_web_search=true")) throw new Error(`Invalid status: ${JSON.stringify(status)}`);

  const chatResponse = await fetch(`${baseUrl}/api/codex/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "测试联网搜索", context: { question: { id: "F001-S" } } })
  });
  const events = (await chatResponse.text()).trim().split("\n").map((line) => JSON.parse(line));
  if (!chatResponse.ok || events[0]?.threadId !== "fake-thread-123" || !events.some((event) => event.type === "search" && event.query === "证券公司最新公告") || events.filter((event) => event.type === "delta").map((event) => event.text).join("") !== "测试回答" || events.at(-1)?.status !== "completed") {
    throw new Error(`Invalid chat stream: ${JSON.stringify(events)}`);
  }

  const abortController = new AbortController();
  const interruptedRequest = fetch(`${baseUrl}/api/codex/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "测试打断", threadId: "fake-thread-123" }),
    signal: abortController.signal
  });
  const interruptedResponse = await interruptedRequest;
  const interruptedReader = interruptedResponse.body.getReader();
  await interruptedReader.read();
  abortController.abort();
  let interrupted = false;
  try { await interruptedReader.read(); }
  catch (error) { interrupted = error.name === "AbortError"; }
  await new Promise((resolveWait) => setTimeout(resolveWait, 350));
  const resumedResponse = await fetch(`${baseUrl}/api/codex/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "中断后继续", threadId: "fake-thread-123" })
  });
  const resumedEvents = (await resumedResponse.text()).trim().split("\n").map((line) => JSON.parse(line));
  if (!interrupted || !resumedResponse.ok || resumedEvents.at(-1)?.status !== "completed" || !output.includes("INTERRUPTED")) {
    throw new Error(`Interrupt flow invalid: ${JSON.stringify({ interrupted, resumedEvents, output })}`);
  }

  const rejected = await fetch(`${baseUrl}/api/codex/status`, { headers: { Origin: "https://example.com" } });
  if (rejected.status !== 403) throw new Error(`Cross-origin request was not rejected: ${rejected.status}`);
  console.log(JSON.stringify({ ok: true, status, events, interruption: { interrupted, resumedEvents }, crossOriginStatus: rejected.status }, null, 2));
} finally {
  bridge.kill("SIGTERM");
  await new Promise((resolveExit) => {
    if (bridge.exitCode !== null) return resolveExit();
    bridge.once("exit", resolveExit);
    setTimeout(resolveExit, 2_000).unref();
  });
}
