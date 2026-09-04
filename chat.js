(function () {
  const storageKey = "securities-exam-codex-chat-v1";
  const load = () => {
    try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); }
    catch { return {}; }
  };
  const saved = load();
  const state = {
    open: typeof saved.open === "boolean" ? saved.open : window.innerWidth >= 1180,
    includeContext: saved.includeContext !== false,
    threadId: typeof saved.threadId === "string" ? saved.threadId : null,
    messages: Array.isArray(saved.messages) ? saved.messages.slice(-30) : [],
    available: false,
    authenticated: false,
    planType: null,
    webSearchAvailable: false,
    webSearchMessage: "",
    statusText: "正在连接本机 Codex…",
    busy: false,
    requestController: null,
    responseReader: null,
    stopRequested: false
  };

  const root = document.createElement("div");
  root.id = "codex-chat-root";
  root.innerHTML = `
    <button class="codex-chat-launcher" type="button" aria-controls="codex-chat-panel" aria-expanded="false">
      <span class="codex-chat-launcher-icon">AI</span><span>问助教</span>
    </button>
    <aside class="codex-chat-panel" id="codex-chat-panel" aria-label="本机 Codex 学习助教" aria-hidden="true">
      <header class="codex-chat-header">
        <div class="codex-chat-title"><span class="codex-chat-logo">AI</span><div><strong>学习助教</strong><span>本机 Codex · 只读</span></div></div>
        <div class="codex-chat-header-actions">
          <button type="button" data-chat-action="new" title="新对话">＋</button>
          <button type="button" data-chat-action="close" title="收起">×</button>
        </div>
      </header>
      <div class="codex-chat-status"><span class="codex-chat-status-dot"></span><span data-chat-status>正在连接本机 Codex…</span></div>
      <div class="codex-chat-messages" aria-live="polite"></div>
      <div class="codex-chat-setup" hidden>
        <strong>需要从本地聊天服务打开</strong>
        <span>在项目目录的终端运行：</span>
        <code>pnpm dev</code>
        <span>然后访问 <code>http://127.0.0.1:43117</code>。服务只监听本机，不会暴露到局域网。</span>
        <button type="button" data-chat-action="retry">重新连接</button>
      </div>
      <form class="codex-chat-form">
        <label class="codex-chat-context"><input type="checkbox" data-chat-context checked /><span>附带当前题目或页面</span><span class="codex-chat-context-name" data-chat-context-name></span></label>
        <textarea rows="3" maxlength="4000" placeholder="问当前题目、概念区别、法规边界或复习方法…" aria-label="向 AI 助教提问"></textarea>
        <div class="codex-chat-form-footer"><span>Enter 发送 · Shift+Enter 换行</span><button type="submit">发送</button></div>
      </form>
    </aside>`;
  document.body.appendChild(root);

  const panel = root.querySelector(".codex-chat-panel");
  const launcher = root.querySelector(".codex-chat-launcher");
  const messagesNode = root.querySelector(".codex-chat-messages");
  const setupNode = root.querySelector(".codex-chat-setup");
  const form = root.querySelector(".codex-chat-form");
  const textarea = form.querySelector("textarea");
  const submitButton = form.querySelector('button[type="submit"]');
  const formHint = form.querySelector(".codex-chat-form-footer > span");
  const contextCheckbox = root.querySelector("[data-chat-context]");

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        open: state.open,
        includeContext: state.includeContext,
        threadId: state.threadId,
        messages: state.messages.slice(-30)
      }));
    } catch { /* 浏览器禁用存储时，聊天仍可在当前页面使用。 */ }
  }

  function setOpen(open, { focus = true } = {}) {
    state.open = open;
    document.body.classList.toggle("codex-chat-open", open);
    panel.setAttribute("aria-hidden", String(!open));
    launcher.setAttribute("aria-expanded", String(open));
    save();
    if (open) {
      updateContextLabel();
      if (focus) setTimeout(() => textarea.focus({ preventScroll: true }), 120);
    }
  }

  function setStatus(kind, text) {
    state.statusText = text;
    root.dataset.status = kind;
    root.querySelector("[data-chat-status]").textContent = text;
  }

  function onlineStatusText() {
    const account = state.planType ? ` · ${state.planType}` : "";
    const search = state.webSearchAvailable ? " · 可联网核验" : state.webSearchMessage ? ` · ${state.webSearchMessage}` : "";
    return `已连接${account}${search}`;
  }

  function escapeMarkdownHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeMarkdownHref(value) {
    const href = String(value || "").trim();
    if (/^https?:\/\/[^\s]+$/i.test(href)) return href;
    if (/^(?:\.\.?\/|\/|#)[^\s]*$/.test(href) && !href.startsWith("//")) return href;
    return null;
  }

  function renderMath(value, displayMode) {
    const source = String(value ?? "").trim();
    if (!source) return "";
    if (typeof window.katex?.renderToString !== "function") {
      return `<span class="codex-chat-math-fallback">${escapeMarkdownHtml(source)}</span>`;
    }
    try {
      return window.katex.renderToString(source, {
        displayMode,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "htmlAndMathml"
      });
    } catch {
      return `<span class="codex-chat-math-fallback">${escapeMarkdownHtml(source)}</span>`;
    }
  }

  function renderMarkdownInline(value) {
    const tokens = [];
    const hold = (html) => {
      const token = `\uE000CODEXMD${tokens.length}\uE001`;
      tokens.push([token, html]);
      return token;
    };
    let text = String(value ?? "");
    text = text.replace(/`([^`\n]+)`/g, (_match, code) => hold(`<code>${escapeMarkdownHtml(code)}</code>`));
    text = text.replace(/\\\(([^\n]*?)\\\)/g, (_match, source) => hold(renderMath(source, false)));
    text = text.replace(/\$\$(?!\s*\n)([\s\S]*?)\$\$/g, (_match, source) => hold(renderMath(source, true)));
    text = text.replace(/\$(?!\$)(?=\S)([^$\n]*?\S)\$(?!\$)/g, (_match, source) => hold(renderMath(source, false)));
    text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, rawHref) => {
      const href = safeMarkdownHref(rawHref);
      const safeLabel = renderMarkdownInline(label);
      return href
        ? hold(`<a href="${escapeMarkdownHtml(href)}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`)
        : hold(safeLabel);
    });
    text = text.replace(/<(https?:\/\/[^\s<>]+)>/gi, (_match, href) => hold(`<a href="${escapeMarkdownHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeMarkdownHtml(href)}</a>`));
    text = escapeMarkdownHtml(text);
    text = text
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      .replace(/(^|[^\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    for (const [token, html] of tokens) text = text.replaceAll(token, html);
    return text;
  }

  function splitMarkdownTableRow(line) {
    const source = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cell = "";
    let escaped = false;
    for (const character of source) {
      if (escaped) { cell += character; escaped = false; continue; }
      if (character === "\\") { escaped = true; continue; }
      if (character === "|") { cells.push(cell.trim()); cell = ""; continue; }
      cell += character;
    }
    cells.push(cell.trim());
    return cells;
  }

  function isMarkdownTableSeparator(line) {
    const cells = splitMarkdownTableRow(line);
    return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
  }

  function renderMarkdown(value) {
    const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
    const html = [];
    const isBlockStart = (index) => {
      const line = lines[index] || "";
      return !line.trim() || /^\s*```/.test(line) || /^\s{0,3}#{1,6}\s+/.test(line) ||
        /^\s{0,3}>\s?/.test(line) || /^\s*[-+*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line) ||
        /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
        /^\s*(?:\\\[|\$\$)\s*$/.test(line) ||
        (index + 1 < lines.length && line.includes("|") && isMarkdownTableSeparator(lines[index + 1]));
    };
    let index = 0;
    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) { index += 1; continue; }

      const oneLineMath = line.match(/^\s*(\\\[|\$\$)\s*(.*?)\s*(\\\]|\$\$)\s*$/);
      if (oneLineMath) {
        html.push(`<div class="codex-chat-math-display">${renderMath(oneLineMath[2], true)}</div>`);
        index += 1;
        continue;
      }
      const mathOpening = line.match(/^\s*(\\\[|\$\$)\s*$/);
      if (mathOpening) {
        const closingPattern = mathOpening[1] === "\\[" ? /^\s*\\\]\s*$/ : /^\s*\$\$\s*$/;
        const source = [];
        index += 1;
        while (index < lines.length && !closingPattern.test(lines[index])) source.push(lines[index++]);
        if (index < lines.length) index += 1;
        html.push(`<div class="codex-chat-math-display">${renderMath(source.join("\n"), true)}</div>`);
        continue;
      }

      const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
      if (fence) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
        if (index < lines.length) index += 1;
        const language = fence[1] ? ` class="language-${escapeMarkdownHtml(fence[1])}"` : "";
        html.push(`<pre><code${language}>${escapeMarkdownHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = Math.min(6, heading[1].length + 2);
        html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        html.push("<hr>");
        index += 1;
        continue;
      }

      if (/^\s{0,3}>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s{0,3}>\s?/, ""));
        html.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        const tag = unordered ? "ul" : "ol";
        const pattern = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
        const items = [];
        while (index < lines.length) {
          const match = lines[index].match(pattern);
          if (!match) break;
          items.push(`<li>${renderMarkdownInline(match[1])}</li>`);
          index += 1;
        }
        html.push(`<${tag}>${items.join("")}</${tag}>`);
        continue;
      }

      if (index + 1 < lines.length && line.includes("|") && isMarkdownTableSeparator(lines[index + 1])) {
        const headers = splitMarkdownTableRow(line);
        index += 2;
        const rows = [];
        while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitMarkdownTableRow(lines[index++]));
        const headerHtml = headers.map((cell) => `<th>${renderMarkdownInline(cell)}</th>`).join("");
        const bodyHtml = rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${renderMarkdownInline(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("");
        html.push(`<div class="codex-chat-table-wrap"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
        continue;
      }

      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && !isBlockStart(index)) paragraph.push(lines[index++].trim());
      html.push(`<p>${paragraph.map(renderMarkdownInline).join("<br>")}</p>`);
    }
    return html.join("");
  }

  function createMessage(message) {
    const article = document.createElement("article");
    article.className = `codex-chat-message ${message.role}`;
    const label = document.createElement("span");
    label.className = "codex-chat-message-label";
    label.textContent = message.role === "user" ? "你" : "AI 助教";
    const content = document.createElement("div");
    content.className = "codex-chat-message-content";
    const messageText = message.text || (state.busy && message.role === "assistant" ? "正在思考…" : "");
    if (message.role === "assistant") content.innerHTML = renderMarkdown(messageText);
    else content.textContent = messageText;
    article.append(label, content);
    return article;
  }

  function messagesNearBottom() {
    const distance = messagesNode.scrollHeight - messagesNode.scrollTop - messagesNode.clientHeight;
    return distance <= 24;
  }

  function canScrollVertically(node, deltaY) {
    if (!node || node.scrollHeight <= node.clientHeight + 1) return false;
    if (deltaY < 0) return node.scrollTop > 0;
    return node.scrollTop + node.clientHeight < node.scrollHeight - 1;
  }

  panel.addEventListener("wheel", (event) => {
    if (event.defaultPrevented || event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const target = event.target instanceof Element ? event.target : null;
    const nestedScroller = target?.closest("textarea, pre, .codex-chat-table-wrap");
    if (nestedScroller && panel.contains(nestedScroller) && canScrollVertically(nestedScroller, event.deltaY)) return;
    if (target?.closest(".codex-chat-messages") && canScrollVertically(messagesNode, event.deltaY)) return;
    event.preventDefault();
  }, { passive: false });

  function renderMessages() {
    const shouldStickToBottom = messagesNearBottom();
    const previousScrollTop = messagesNode.scrollTop;
    messagesNode.replaceChildren();
    if (!state.messages.length) {
      const welcome = document.createElement("div");
      welcome.className = "codex-chat-welcome";
      welcome.innerHTML = "<strong>有疑问就直接问</strong><span>我可以结合当前题目和项目内的学习资料，解释概念、选项与案例；涉及最新状态时会按状态栏提示尝试联网核验。回答仅作备考辅助，以最新官方规则为准。</span>";
      messagesNode.appendChild(welcome);
    } else {
      for (const message of state.messages) messagesNode.appendChild(createMessage(message));
    }
    messagesNode.scrollLeft = 0;
    messagesNode.scrollTop = shouldStickToBottom ? messagesNode.scrollHeight : previousScrollTop;
  }

  function currentContext() {
    if (!state.includeContext) return null;
    try { return window.ExamApp?.getChatContext?.() || null; }
    catch { return null; }
  }

  function updateContextLabel() {
    const context = currentContext();
    const name = root.querySelector("[data-chat-context-name]");
    if (!state.includeContext) name.textContent = "";
    else if (context?.question?.id) name.textContent = context.question.id;
    else if (context?.memoryCard?.id) name.textContent = context.memoryCard.id;
    else name.textContent = context?.view || "当前页面";
  }

  function updateAvailability() {
    setupNode.hidden = state.available && state.authenticated;
    form.classList.toggle("disabled", !state.available || !state.authenticated);
    textarea.disabled = !state.available || !state.authenticated || state.busy;
    submitButton.disabled = !state.available || !state.authenticated;
    submitButton.textContent = state.busy ? "停止" : "发送";
    submitButton.classList.toggle("stop", state.busy);
    submitButton.setAttribute("aria-label", state.busy ? "停止回答" : "发送问题");
    submitButton.title = state.busy ? "停止当前回答" : "发送问题";
    if (formHint) formHint.textContent = state.busy ? "正在回答 · 点击停止" : "Enter 发送 · Shift+Enter 换行";
    panel.setAttribute("aria-busy", String(state.busy));
  }

  function stopMessage() {
    if (!state.busy) return;
    state.stopRequested = true;
    setStatus("connecting", "正在停止回答…");
    state.requestController?.abort();
    state.responseReader?.cancel().catch(() => {});
  }

  async function checkStatus() {
    if (location.protocol === "file:") {
      state.available = false;
      state.authenticated = false;
      setStatus("offline", "本地聊天服务未启动");
      updateAvailability();
      return;
    }
    setStatus("connecting", "正在连接本机 Codex…");
    try {
      const response = await fetch("./api/codex/status", { signal: AbortSignal.timeout(20_000) });
      const result = await response.json();
      if (!response.ok || !result.available) throw new Error(result.error || "Codex 不可用");
      state.available = true;
      state.authenticated = Boolean(result.authenticated);
      state.planType = result.planType || null;
      state.webSearchAvailable = Boolean(result.webSearchAvailable);
      state.webSearchMessage = result.webSearchMessage || "";
      if (state.authenticated) setStatus("online", onlineStatusText());
      else setStatus("offline", "Codex 尚未登录，请先运行 codex login");
    } catch (error) {
      state.available = false;
      state.authenticated = false;
      setStatus("offline", error.message || "本地聊天服务未启动");
    }
    updateAvailability();
  }

  async function sendMessage(text) {
    const userMessage = { role: "user", text };
    const assistantMessage = { role: "assistant", text: "" };
    state.messages.push(userMessage, assistantMessage);
    state.busy = true;
    state.stopRequested = false;
    state.requestController = new AbortController();
    renderMessages();
    updateAvailability();
    save();
    const assistantNode = messagesNode.lastElementChild?.querySelector(".codex-chat-message-content");
    try {
      const response = await fetch("./api/codex/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, threadId: state.threadId, context: currentContext() }),
        signal: state.requestController.signal
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `请求失败（${response.status}）`);
      }
      const reader = response.body.getReader();
      state.responseReader = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "thread") state.threadId = event.threadId;
          if (event.type === "delta") {
            assistantMessage.text += event.text || "";
            const shouldStickToBottom = messagesNearBottom();
            if (assistantNode) assistantNode.innerHTML = renderMarkdown(assistantMessage.text);
            messagesNode.scrollLeft = 0;
            if (shouldStickToBottom) messagesNode.scrollTop = messagesNode.scrollHeight;
          }
          if (event.type === "search") setStatus("connecting", `正在联网检索${event.query ? `：${event.query}` : ""}…`);
          if (event.type === "error") throw new Error(event.error || "Codex 回答失败");
          if (event.type === "done" && event.status !== "completed") throw new Error(event.error || `回答已${event.status}`);
        }
        if (done) break;
      }
      if (!assistantMessage.text) assistantMessage.text = "没有收到回答，请重试。";
      if (!state.stopRequested) setStatus("online", onlineStatusText());
    } catch (error) {
      if (state.stopRequested || error?.name === "AbortError") {
        assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n> 已停止生成。` : "已停止生成。";
        setStatus("online", "已停止回答");
      } else {
        assistantMessage.text = assistantMessage.text || `连接失败：${error.message}`;
        setStatus("offline", "连接中断，可重新尝试");
      }
    } finally {
      if (state.stopRequested && !assistantMessage.text.includes("已停止生成")) {
        assistantMessage.text = assistantMessage.text ? `${assistantMessage.text}\n\n> 已停止生成。` : "已停止生成。";
        setStatus("online", "已停止回答");
      }
      state.busy = false;
      state.requestController = null;
      state.responseReader = null;
      state.stopRequested = false;
      renderMessages();
      updateAvailability();
      save();
      textarea.focus({ preventScroll: true });
    }
  }

  launcher.addEventListener("click", () => setOpen(!state.open));
  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-chat-action]")?.dataset.chatAction;
    if (action === "close") setOpen(false);
    if (action === "retry") checkStatus();
    if (action === "new" && !state.busy) {
      state.threadId = null;
      state.messages = [];
      renderMessages();
      save();
      textarea.focus({ preventScroll: true });
    }
  });
  contextCheckbox.checked = state.includeContext;
  contextCheckbox.addEventListener("change", () => {
    state.includeContext = contextCheckbox.checked;
    updateContextLabel();
    save();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.busy) {
      stopMessage();
      return;
    }
    const text = textarea.value.trim();
    if (!text || state.busy || !state.available || !state.authenticated) return;
    textarea.value = "";
    sendMessage(text);
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  document.addEventListener("click", () => setTimeout(updateContextLabel, 0));

  window.CodexChat = Object.freeze({ renderMarkdown });

  renderMessages();
  setOpen(state.open, { focus: false });
  updateContextLabel();
  updateAvailability();
  checkStatus();
})();
