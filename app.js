(function () {
  const outlineData = window.OUTLINE_DATA || { meta: {}, toc: [], pages: [], supplements: [] };
  const questionData = window.QUESTION_DATA || { meta: {}, subjects: [], chapters: [], knowledgePoints: [], questions: [] };
  const questionMap = new Map((questionData.questions || []).map((question) => [question.id, question]));
  // 历年题的考频索引：只统计已核验可练的导入题，按知识点归集年份与题量。
  const examFrequencyMap = (() => {
    const map = new Map();
    for (const question of questionData.questions || []) {
      if (question.verificationStatus !== "source_transcribed" || question.examEligible === false || !question.factId) continue;
      const entry = map.get(question.factId) || { count: 0, years: new Set(), questions: [] };
      entry.count += 1;
      for (const year of question.repeatYears || []) {
        const parsed = Number(year);
        if (parsed) entry.years.add(parsed);
      }
      entry.questions.push(question);
      map.set(question.factId, entry);
    }
    for (const entry of map.values()) {
      entry.years = [...entry.years].sort((left, right) => left - right);
      entry.questions.sort((left, right) => (right.repeatCount || 0) - (left.repeatCount || 0) || (right.year || 0) - (left.year || 0));
      entry.multiYear = entry.years.length >= 2;
    }
    return map;
  })();
  const READING_POSITION_KEY = "securities-exam-reading-position-v1";
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  function getLastReadingPosition() {
    try {
      const value = JSON.parse(localStorage.getItem(READING_POSITION_KEY) || "null");
      if (!value || value.view !== "outline" || typeof value.nodeId !== "string") return null;
      if (!/^(?:knowledge-|outline-)/.test(value.nodeId)) return null;
      return value;
    } catch {
      return null;
    }
  }

  const initialReadingPosition = getLastReadingPosition();

  const navItems = [
    ["dashboard", "⌂", "学习总览"],
    ["outline", "知", "知识讲义"],
    ["practice", "练", "章节练习"],
    ["mistakes", "错", "错题与收藏"],
    ["stats", "数", "学习统计"],
    ["profile", "档", "学习档案"]
  ];

  const pageInfo = {
    dashboard: ["学习总览", "从大纲、练习和模考逐步建立完整知识框架"],
    outline: ["知识讲义与官方大纲", "先读详细知识点，再用官方原文核对考试范围"],
    practice: ["章节练习", "按科目、章节和题型生成练习"],
    mistakes: ["错题与收藏", "集中修复薄弱知识点"],
    stats: ["学习统计", "区分答题次数、首次覆盖和章节正确率"],
    profile: ["学习档案", "绑定、导入、导出或合并 SQLite 学习记录"]
  };

  const state = {
    view: "dashboard",
    saveStatus: { state: "saved", message: "正在初始化", profileName: "浏览器档案", lastSavedAt: null, bound: false },
    outlineSearch: "",
    multiYearOnly: false,
    outlineMode: "guide",
    outlineSource: "main",
    knowledgeSubject: "finance",
    practiceSubject: "finance",
    practiceChapter: "all",
    practiceCount: 20,
    practiceTypes: new Set(["single", "multiple", "judgment", "case"]),
    listTab: "wrong",
    session: null,
    memorySession: null,
    activeExam: null,
    sessionTimer: null,
    toasts: []
  };

  const app = document.getElementById("app");
  app.innerHTML = '<div class="loading-screen">正在载入离线题库与学习档案…</div>';
  let restoringReadingPosition = false;
  let readingPositionTimer = null;
  let readingRestoreToken = 0;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function shuffle(items, seed = Math.random()) {
    const copy = [...items];
    let random = seed * 2147483647;
    const next = () => {
      random = random * 48271 % 2147483647;
      return random / 2147483647;
    };
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function sameAnswer(a, b) {
    return [...a].sort().join("|") === [...b].sort().join("|");
  }

  function toast(message, type = "") {
    const item = { id: crypto.randomUUID(), message, type };
    state.toasts.push(item);
    renderToasts();
    setTimeout(() => {
      state.toasts = state.toasts.filter((entry) => entry.id !== item.id);
      renderToasts();
    }, 3500);
  }

  function renderToasts() {
    let stack = document.querySelector(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    stack.innerHTML = state.toasts.map((entry) => `<div class="toast ${entry.type}">${escapeHtml(entry.message)}</div>`).join("");
  }

  function layout(content) {
    const [title, subtitle] = pageInfo[state.view] || ["证券从业模拟刷题工具", ""];
    const save = state.saveStatus;
    const saveText = `${save.message}${save.lastSavedAt ? ` · ${formatDate(save.lastSavedAt)}` : ""}`;
    return `
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-mark">证</div>
            <div><h1>证券从业刷题工具</h1><p>纯离线 · 大纲驱动 · 来源可追溯</p></div>
          </div>
          <nav class="nav-list">
            ${navItems.map(([id, icon, label]) => `
              <button class="nav-button ${state.view === id ? "active" : ""}" data-nav="${id}">
                <span class="nav-icon">${icon}</span><span>${label}</span>
              </button>`).join("")}
          </nav>
          <div class="sidebar-footer">
            <strong>${escapeHtml(questionData.meta?.factCount || "—")} 个大纲核对知识单元</strong>
            ${escapeHtml(questionData.meta?.questionCount || questionData.questions.length)} 道题型练习<br />
            ${escapeHtml(questionData.meta?.casePackCount || 0)} 个综合案例包 · ${escapeHtml(questionData.meta?.caseQuestionCount || 0)} 问<br />
            官方大纲版本：${escapeHtml(questionData.meta?.outlineVersion || "2025 + 纪法2026")}<br />
            内容核验截止：${escapeHtml(questionData.meta?.contentCutoff || "2026-08-18")}
          </div>
        </aside>
        <main class="main">
          <header class="topbar">
            <div class="page-title"><h2>${title}</h2><p>${subtitle}</p></div>
            <div class="save-pill ${save.state}" title="${escapeHtml(save.profileName)}">
              <span class="save-dot"></span><span>${escapeHtml(saveText)}</span>
            </div>
          </header>
          ${content}
        </main>
      </div>`;
  }

  function render() {
    if (state.memorySession) {
      app.innerHTML = renderMemorySession();
      return;
    }
    if (state.session) {
      app.innerHTML = renderSession();
      bindSessionTimer();
      return;
    }
    const renderer = {
      dashboard: renderDashboard,
      outline: renderOutline,
      practice: renderPractice,
      mistakes: renderMistakes,
      stats: renderStats,
      profile: renderProfile
    }[state.view] || renderDashboard;
    app.innerHTML = layout(renderer());
  }

  function applyReadingPositionState(position) {
    if (!position) return false;
    const subjectIds = new Set((questionData.subjects || []).map((subject) => subject.id));
    state.view = "outline";
    state.outlineMode = position.outlineMode === "official" ? "official" : "guide";
    state.knowledgeSubject = subjectIds.has(position.knowledgeSubject) ? position.knowledgeSubject : "finance";
    state.outlineSource = position.outlineSource === "supplement" ? "supplement" : "main";
    state.outlineSearch = "";
    return true;
  }

  function updateActiveReadingToc(nodeId) {
    let tocAnchor = nodeId;
    if (state.outlineMode === "guide" && nodeId.startsWith("knowledge-") && !nodeId.startsWith("knowledge-chapter-")) {
      const point = (questionData.knowledgePoints || []).find((item) => `knowledge-${item.id}` === nodeId);
      if (point) tocAnchor = `knowledge-chapter-${point.chapterId}`;
    }
    document.querySelectorAll(".toc-button.active").forEach((button) => button.classList.remove("active"));
    const activeButton = [...document.querySelectorAll(".toc-button[data-anchor]")].find((button) => button.dataset.anchor === tocAnchor);
    activeButton?.classList.add("active");
  }

  function saveReadingPosition(nodeId) {
    if (state.view !== "outline" || state.session || state.memorySession || !nodeId) return null;
    const node = document.getElementById(nodeId);
    const position = {
      version: 1,
      view: "outline",
      outlineMode: state.outlineMode,
      knowledgeSubject: state.knowledgeSubject,
      outlineSource: state.outlineSource,
      nodeId,
      nodeLabel: (node?.querySelector("h2,h3,h4")?.textContent || node?.textContent || "").trim().slice(0, 120),
      scrollY: Math.max(0, Math.round(window.scrollY)),
      updatedAt: new Date().toISOString()
    };
    try { localStorage.setItem(READING_POSITION_KEY, JSON.stringify(position)); }
    catch { /* 禁用本地存储时不影响阅读。 */ }
    updateActiveReadingToc(nodeId);
    return position;
  }

  function captureReadingPosition() {
    if (restoringReadingPosition || state.view !== "outline" || state.session || state.memorySession) return null;
    const selector = state.outlineMode === "guide"
      ? ".knowledge-chapter[id], .knowledge-card[id]"
      : ".outline-page[id], .outline-heading[id]";
    const candidates = [...document.querySelectorAll(selector)];
    if (!candidates.length) return null;
    const threshold = Math.min(220, Math.round(window.innerHeight * 0.3));
    let current = candidates[0];
    for (const candidate of candidates) {
      if (candidate.getBoundingClientRect().top <= threshold) current = candidate;
      else break;
    }
    return saveReadingPosition(current.id);
  }

  function scheduleReadingPositionCapture() {
    clearTimeout(readingPositionTimer);
    readingPositionTimer = setTimeout(captureReadingPosition, 160);
  }

  function restoreReadingPosition(position = getLastReadingPosition()) {
    if (!position || state.view !== "outline") return false;
    const restoreToken = ++readingRestoreToken;
    restoringReadingPosition = true;
    const align = () => {
      if (restoreToken !== readingRestoreToken || state.view !== "outline") return;
      const destination = document.getElementById(position.nodeId);
      if (destination) destination.scrollIntoView({ behavior: "auto", block: "start" });
      else window.scrollTo({ top: Math.max(0, Number(position.scrollY) || 0), behavior: "auto" });
      updateActiveReadingToc(destination?.id || position.nodeId);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      align();
      // 右侧助教打开时主区域有 200ms 宽度过渡，期间正文换行会改变节点纵向位置。
      // 在过渡结束前后重复校准，避免首次定位随后被页面重排推离视口。
      for (const delay of [80, 160, 240, 340, 460]) setTimeout(align, delay);
      setTimeout(() => {
        if (restoreToken !== readingRestoreToken) return;
        align();
        restoringReadingPosition = false;
        captureReadingPosition();
      }, 560);
    }));
    return true;
  }

  function openLastReadingPosition() {
    const position = getLastReadingPosition();
    if (!position) {
      state.view = "outline";
      render();
      window.scrollTo({ top: 0, behavior: "auto" });
      scheduleReadingPositionCapture();
      return;
    }
    applyReadingPositionState(position);
    render();
    restoreReadingPosition(position);
  }

  function resetReadingPositionAfterRender() {
    readingRestoreToken += 1;
    restoringReadingPosition = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      restoringReadingPosition = false;
      captureReadingPosition();
    }));
  }

  function renderDashboard() {
    const stats = StudyDb.getDashboard();
    const questionCoverage = questionData.questions.length ? Math.round(stats.unique * 100 / questionData.questions.length) : 0;
    const answeredFactIds = new Set(StudyDb.getAttemptRows().map((attempt) => questionMap.get(attempt.question_id)?.factId).filter(Boolean));
    const factCount = questionData.meta?.factCount || (questionData.knowledgePoints || []).length;
    const factCoverage = factCount ? Math.round(answeredFactIds.size * 100 / factCount) : 0;
    const subjects = questionData.subjects || [];
    return `
      <div class="grid">
        <section class="card hero-card">
          <h3>先建立知识地图，再用练习检验理解</h3>
          <p>建议先完整阅读两遍官方大纲：第一遍建立章节框架，第二遍标记“掌握、熟悉、了解”。刷题结果页会显示大纲原文、页码和答案依据。</p>
          <div class="hero-actions">
            <button class="button secondary" data-nav="outline">开始阅读知识讲义</button>
            <button class="button" data-action="quick-practice">随机练习 20 题</button>
            <button class="button ghost" data-action="start-exam">120 个不同知识点模考</button>
            ${state.activeExam ? '<button class="button secondary" data-action="resume-exam">恢复未完成模考</button>' : ""}
          </div>
        </section>
        <div class="grid cards-4">
          <section class="card card-body"><div class="metric-label">累计作答</div><div class="metric-value">${stats.total}</div><div class="metric-detail">包含重复练习</div></section>
          <section class="card card-body"><div class="metric-label">综合正确率</div><div class="metric-value">${stats.accuracy}%</div><div class="progress"><span style="width:${stats.accuracy}%"></span></div></section>
          <section class="card card-body"><div class="metric-label">知识组覆盖</div><div class="metric-value">${factCoverage}%</div><div class="metric-detail">${answeredFactIds.size} / ${factCount} 组 · 题型 ${questionCoverage}%</div></section>
          <section class="card card-body"><div class="metric-label">当前错题</div><div class="metric-value">${stats.wrongUnique}</div><div class="metric-detail">模拟考试 ${stats.exams} 次</div></section>
        </div>
        <div class="grid two">
          <section class="card card-body">
            <h3 class="card-title">按科目开始 <span class="metric-label">（含历年题去重版）</span></h3>
            <div class="quick-list">
              ${subjects.map((subject) => {
                const count = questionData.questions.filter((q) => q.subjectId === subject.id && q.examEligible !== false).length;
                return `<div class="quick-item"><div><strong>${escapeHtml(subject.title)}</strong><br /><span>${count} 道题 · ${subject.chapterCount} 章</span></div><button class="button small" data-action="practice-subject" data-subject="${subject.id}">开始练习</button></div>`;
              }).join("")}
            </div>
          </section>
          <section class="card card-body">
            <h3 class="card-title">本版本说明</h3>
            <div class="notice">当前题库包含 ${questionData.meta?.authoredQuestionCount || 780} 道原创基础题，以及 ${questionData.meta?.importedQuestionCount || 0} 道历年整理题（去重后），共 ${questionData.questions.filter((q) => q.examEligible !== false).length} 道可练习题；待核验题不会进入默认练习。多选题采用“全部选对才得分”的本地规则。</div>
            <div class="profile-status">
              <div class="status-row"><span>主大纲</span><strong>2025 版，24 页</strong></div>
              <div class="status-row"><span>补充范围</span><strong>纪法知识大纲 2026</strong></div>
              <div class="status-row"><span>档案</span><strong>${escapeHtml(state.saveStatus.profileName)}</strong></div>
            </div>
          </section>
        </div>
      </div>`;
  }

  function highlightText(text, query) {
    const safe = escapeHtml(text);
    if (!query) return safe;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return safe.replace(new RegExp(escaped, "gi"), (match) => `<span class="highlight">${match}</span>`);
  }

  function outlineAnchor(page, title) {
    let hash = 2166136261;
    for (const char of `${page}:${title}`) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return `outline-${page}-${(hash >>> 0).toString(36)}`;
  }

  function joinOutlineLines(lines) {
    return lines.reduce((result, line) => {
      if (!result) return line;
      const needsSpace = /[A-Za-z0-9)]$/.test(result) && /^[A-Za-z0-9(]/.test(line);
      return `${result}${needsSpace ? " " : ""}${line}`;
    }, "");
  }

  function parseOutlineBlocks(text) {
    const blocks = [];
    let paragraph = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      blocks.push({ type: "paragraph", text: joinOutlineLines(paragraph) });
      paragraph = [];
    };
    const headingType = (line) => {
      if (/^(金融市场基础知识|证券市场基本法律法规)$/.test(line)) return "subject";
      if (/^第[一二三四五六七八九十]+章/.test(line)) return "chapter";
      if (/^第[一二三四五六七八九十]+节/.test(line)) return "section";
      if (/^[一二三四五六七八九十]+、/.test(line)) return "subheading";
      return null;
    };
    for (const rawLine of String(text || "").replaceAll("\r", "").split("\n")) {
      const line = rawLine.trim();
      if (!line || /^\d+$/.test(line)) { flushParagraph(); continue; }
      const type = headingType(line);
      if (type) {
        flushParagraph();
        blocks.push({ type, text: line });
        continue;
      }
      paragraph.push(line);
      if (/[。！？]$/.test(line)) flushParagraph();
    }
    flushParagraph();
    return blocks;
  }

  function renderOutlinePage(page, query) {
    const blocks = parseOutlineBlocks(page.text);
    return `<article class="card outline-page" id="outline-page-${page.page}">
      <div class="outline-page-label">官方原件 · 第 ${page.page} 页</div>
      <div class="outline-text">${blocks.map((block) => {
        if (block.type === "paragraph") return `<p>${highlightText(block.text, query)}</p>`;
        const tag = block.type === "subject" || block.type === "chapter" ? "h3" : "h4";
        const anchor = outlineAnchor(page.page, block.text);
        return `<${tag} class="outline-heading ${block.type}" id="${anchor}">${highlightText(block.text, query)}</${tag}>`;
      }).join("")}</div>
    </article>`;
  }

  function renderOutlineModeSwitch() {
    return `<div class="outline-mode-bar">
      <div class="outline-mode-switch" role="tablist" aria-label="阅读模式">
        <button class="${state.outlineMode === "guide" ? "active" : ""}" data-action="outline-mode" data-mode="guide">知识讲义</button>
        <button class="${state.outlineMode === "official" ? "active" : ""}" data-action="outline-mode" data-mode="official">官方大纲原文</button>
      </div>
      <span>${state.outlineMode === "guide" ? "推荐先按章节阅读，再进入对应练习" : "用于核对官方考试范围和掌握层级"}</span>
    </div>`;
  }

  function knowledgeMatches(point, query) {
    if (!query) return true;
    const sourceText = [
      point.topic,
      point.statement,
      point.explanation,
      point.memoryHook,
      ...(point.keyPoints || []),
      ...(point.commonMistakes || []),
      ...(point.detailSections || []).flatMap((section) => [section.title, ...(section.points || [])]),
      ...(point.examTips || []),
      ...(point.citations || []).flatMap((citation) => [citation.title, citation.publisher, citation.locator, citation.quote, citation.originalQuote])
    ].join("\n");
    return sourceText.includes(query);
  }

  function isChinaAuthority(citation) {
    return citation.sourceClass === "china_law" || citation.sourceClass === "china_official" || citation.sourceClass === "china_official_textbook";
  }

  function renderKnowledgePoint(point, query) {
    const references = (point.citations || []).filter((citation) => citation.kind !== "scope");
    const referenceCount = references.length;
    const hasChinaAuthority = references.some(isChinaAuthority);
    const hasOfficialTextbook = references.some((citation) => citation.sourceClass === "china_official_textbook");
    const hasInternationalStandard = references.some((citation) => citation.sourceClass === "international_standard");
    const hasHistoricalTextbook = references.some((citation) => citation.sourceClass === "historical_exam_textbook");
    const sourceBadge = hasOfficialTextbook
      ? { className: "verified", label: "协会统编教材", coreLabel: "教材对应结论" }
      : hasChinaAuthority
      ? { className: "verified", label: "中国官方资料", coreLabel: "核心结论" }
      : hasInternationalStandard
        ? { className: "international", label: "国际标准参考", coreLabel: "国际标准概念 · 非中国规则原文" }
        : hasHistoricalTextbook
          ? { className: "historical", label: "2020历史教材", coreLabel: "讲义归纳 · 历史教材仅供辅助" }
        : referenceCount
          ? { className: "supplement", label: "非官方原理补充", coreLabel: "通用金融原理 · 非中国官方答案" }
          : { className: "summary", label: "讲义归纳", coreLabel: "项目讲义归纳" };
    const frequency = examFrequencyMap.get(point.id);
    return `<article class="card knowledge-card" id="knowledge-${point.id}">
      <header class="knowledge-card-header">
        <div><span class="knowledge-index">${escapeHtml(point.id)}</span><h3>${highlightText(point.topic, query)}</h3></div>
        <div class="knowledge-card-tags"><span class="tag level-master">${escapeHtml(point.level)}</span><span class="tag source-tag ${sourceBadge.className}">${sourceBadge.label}</span>${frequency ? `<span class="tag exam-tag">历年 ${frequency.count} 题</span>` : ""}${frequency?.multiYear ? `<span class="tag repeat-tag">★ 多年考点 · ${frequency.years.join(" / ")}</span>` : ""}</div>
      </header>
      <div class="knowledge-core"><span>${sourceBadge.coreLabel}</span><strong>${highlightText(point.statement, query)}</strong></div>
      <div class="knowledge-explanation"><h4>理解与边界</h4><p>${highlightText(point.explanation, query)}</p></div>
      ${point.memoryHook ? `<div class="knowledge-memory"><span>记忆钩子</span><strong>${highlightText(point.memoryHook, query)}</strong></div>` : ""}
      ${(point.detailSections || []).length ? `<div class="knowledge-detail-grid">${point.detailSections.map((section) => `<section class="knowledge-detail"><h4>${highlightText(section.title, query)}</h4><ul>${(section.points || []).map((item) => `<li>${highlightText(item, query)}</li>`).join("")}</ul></section>`).join("")}</div>` : ""}
      <div class="knowledge-columns">
        <section class="knowledge-panel key"><h4>正确说法（需要记住）</h4><p class="knowledge-panel-note">以下内容均正确。</p><ul>${(point.keyPoints || []).map((item) => `<li>${highlightText(item, query)}</li>`).join("")}</ul></section>
        <section class="knowledge-panel mistake"><h4>错误说法（不要这样记）</h4><p class="knowledge-panel-note">以下内容均错误，是常见干扰项。</p><ul>${(point.commonMistakes || []).map((item) => `<li>${highlightText(item, query)}</li>`).join("")}</ul></section>
      </div>
      ${(point.examTips || []).length ? `<section class="knowledge-exam-tips"><h4>考试提示</h4><ul>${point.examTips.map((item) => `<li>${highlightText(item, query)}</li>`).join("")}</ul></section>` : ""}
      ${frequency ? `<details class="knowledge-exam-frequency"${frequency.multiYear ? " open" : ""}><summary>关联历年考点 ${frequency.count} 道${frequency.multiYear ? ` · 覆盖 ${frequency.years.join(" / ")} 年` : frequency.years.length ? ` · ${frequency.years[0]} 年` : ""}</summary><ul>${frequency.questions.slice(0, 8).map((item) => `<li><span class="exam-year">${escapeHtml(String(item.year || "—"))}</span>${highlightText(item.stem, query)}${item.repeatLabel ? `<span class="exam-repeat">${escapeHtml(item.repeatLabel)}</span>` : ""}</li>`).join("")}</ul>${frequency.questions.length > 8 ? `<p class="knowledge-panel-note">另有 ${frequency.questions.length - 8} 道同知识点历年题，可在练习页继续刷。</p>` : ""}<button class="button secondary small" data-action="practice-fact" data-fact="${escapeHtml(point.id)}">刷这个知识点的历年题</button></details>` : ""}
      <details class="knowledge-sources"><summary>${referenceCount ? `查看参考原文（${referenceCount} 条）` : "查看出处说明"}</summary>${renderSourceReferences(point.citations || [])}</details>
    </article>`;
  }

  function renderKnowledgeGuide(query) {
    const points = (questionData.knowledgePoints || []).filter((point) => point.subjectId === state.knowledgeSubject && knowledgeMatches(point, query) && (!state.multiYearOnly || examFrequencyMap.get(point.id)?.multiYear));
    const examTotal = points.reduce((total, point) => total + (examFrequencyMap.get(point.id)?.count || 0), 0);
    const pointsWithExams = points.filter((point) => examFrequencyMap.has(point.id)).length;
    const multiYearPoints = points.filter((point) => examFrequencyMap.get(point.id)?.multiYear).length;
    const chinaAuthorityCount = points.filter((point) => (point.citations || []).some(isChinaAuthority)).length;
    const officialTextbookCount = points.filter((point) => (point.citations || []).some((citation) => citation.sourceClass === "china_official_textbook")).length;
    const internationalStandardCount = points.filter((point) => (point.citations || []).some((citation) => citation.sourceClass === "international_standard")).length;
    const generalTextbookCount = points.filter((point) => (point.citations || []).some((citation) => citation.sourceClass === "general_textbook")).length;
    const historicalTextbookCount = points.filter((point) => (point.citations || []).some((citation) => citation.sourceClass === "historical_exam_textbook")).length;
    const withoutChinaAuthorityCount = points.length - chinaAuthorityCount;
    const chapters = subjectChapters(state.knowledgeSubject);
    const visibleChapters = chapters.map((chapter) => ({
      ...chapter,
      points: points.filter((point) => point.chapterId === chapter.id)
    })).filter((chapter) => chapter.points.length);
    return `
      <div class="outline-toolbar knowledge-toolbar">
        <input class="input outline-search" id="outline-search" value="${escapeHtml(state.outlineSearch)}" placeholder="搜索知识点、结论、误区或法规来源……" />
        <select class="select outline-source" id="knowledge-subject">
          ${questionData.subjects.map((subject) => `<option value="${subject.id}" ${state.knowledgeSubject === subject.id ? "selected" : ""}>${escapeHtml(subject.title)}</option>`).join("")}
        </select>
        <button class="button secondary" data-action="start-memory" data-subject="${state.knowledgeSubject}">今日背诵 12 个</button>
        <button class="button ${state.multiYearOnly ? "" : "secondary"}" data-action="toggle-multi-year">${state.multiYearOnly ? "显示全部知识点" : "只看多年考点"}</button>
        <button class="button" data-action="practice-subject" data-subject="${state.knowledgeSubject}">学习后去刷题</button>
        <span class="outline-result-count">${query ? `找到 ${points.length} 个知识点` : `${points.length} 个知识点`}</span>
      </div>
      <div class="outline-layout knowledge-layout">
        <aside class="card outline-toc knowledge-toc">
          <div class="outline-toc-header"><div><span>${escapeHtml(subjectTitle(state.knowledgeSubject))}</span><strong>章节讲义</strong></div><span>${points.length} 点</span></div>
          <div class="outline-toc-list">
            ${visibleChapters.map((chapter) => `<button class="toc-button chapter" data-action="jump-outline" data-anchor="knowledge-chapter-${chapter.id}"><span>${escapeHtml(chapter.title)}</span><small>${chapter.points.length}</small></button>`).join("") || '<div class="empty">没有匹配章节</div>'}
          </div>
        </aside>
        <section class="knowledge-reader">
          <div class="card knowledge-intro"><strong>先看来源等级，再记答案；大纲位置不作为答案出处。</strong><span>已关联 ${examTotal} 道历年整理题，覆盖 ${pointsWithExams} 个知识点，其中 ${multiYearPoints} 个属于两年以上重复考点，卡片会标出年份。</span><span>当前 ${points.length} 个知识点中，${officialTextbookCount} 个附有协会统编教材摘录，${chinaAuthorityCount} 个有中国法规、官方资料或协会教材支持，${internationalStandardCount} 个有国际标准参考，${generalTextbookCount} 个有通用开放教材补充，${historicalTextbookCount} 个有2020历史商业教材辅助；${withoutChinaAuthorityCount} 个尚未附中国权威原文。</span>${state.knowledgeSubject === "finance" ? `<span>已收录《中国证券业专业人员一般业务水平评价测试统编教材（2025）·金融市场基础知识》568 页本地识别文本，并按知识点定位摘录。识别文字可能存在同形字、标点和表格误差，请以原书为准。<a href="./docs/base-knowledge.html" target="_blank">打开教材全文</a> · <a href="https://www.sac.net.cn/fwdt/ksfw/jcdg/202512/t20251231_70825.html" target="_blank">查看协会教材页面</a></span>` : ""}${state.knowledgeSubject === "law" ? `<span>已收录《证券市场基本法律法规》（2020 商业备考教材）274 页本地识别文本，并为仍有可比基础内容的知识点提供历史摘录。它不是协会统编教材，也不作为现行规则或考试答案依据；涉及法条、期限、比例、处罚和业务规则时必须核对最新官方文本。<a href="./docs/law-regulations.html" target="_blank">打开历史教材全文</a></span>` : ""}</div>
          ${visibleChapters.map((chapter) => {
            const chapterExamCount = chapter.points.reduce((total, point) => total + (examFrequencyMap.get(point.id)?.count || 0), 0);
            return `<section class="knowledge-chapter" id="knowledge-chapter-${chapter.id}"><header class="knowledge-chapter-header"><div><span>${escapeHtml(subjectTitle(chapter.subjectId))}</span><h2>${escapeHtml(chapter.title)}</h2></div><div class="knowledge-chapter-actions"><strong>${chapter.points.length} 个知识点${chapterExamCount ? ` · 历年 ${chapterExamCount} 题` : ""}</strong><button class="button secondary small" data-action="start-memory" data-subject="${chapter.subjectId}" data-chapter="${chapter.id}">背这一章</button></div></header><div class="knowledge-list">${chapter.points.map((point) => renderKnowledgePoint(point, query)).join("")}</div></section>`;
          }).join("") || '<div class="card empty"><strong>没有匹配知识点</strong>请尝试更短的关键词。</div>'}
        </section>
      </div>`;
  }

  function renderOfficialOutline(query) {
    const sourcePages = state.outlineSource === "supplement"
      ? (outlineData.supplements || [])
      : (outlineData.pages || []).filter((page) => page.page >= 4 && page.page !== 14);
    const pages = sourcePages;
    const filtered = query ? pages.filter((page) => page.text.includes(query) || page.title?.includes(query)) : pages;
    const toc = state.outlineSource === "supplement" ? (outlineData.supplementToc || []) : (outlineData.toc || []);
    return `
      <div class="outline-toolbar">
        <input class="input outline-search" id="outline-search" value="${escapeHtml(state.outlineSearch)}" placeholder="搜索股票、内幕交易、适当性、债券估值……" />
        <select class="select outline-source" id="outline-source">
          <option value="main" ${state.outlineSource === "main" ? "selected" : ""}>一般业务主大纲（2025）</option>
          <option value="supplement" ${state.outlineSource === "supplement" ? "selected" : ""}>纪法知识增补（2026）</option>
        </select>
        <a class="button secondary" href="${state.outlineSource === "main" ? "./docs/general-business-syllabus-2025.pdf" : "./docs/discipline-and-law-syllabus-2026.doc"}" target="_blank">打开官方原件</a>
        <span class="outline-result-count">${query ? `找到 ${filtered.length} 个相关页` : `正文 ${pages.length} 页`}</span>
      </div>
      <div class="outline-layout">
        <aside class="card outline-toc">
          <div class="outline-toc-header"><div><span>学习导航</span><strong>目录</strong></div><span>${toc.length} 项</span></div>
          <div class="outline-toc-list">
            ${toc.map((item) => `<button class="toc-button ${item.level === "chapter" ? "chapter" : "section"}" data-action="jump-outline" data-page="${item.page}" data-anchor="${outlineAnchor(item.page, item.title)}"><span>${escapeHtml(item.title)}</span><small>${item.page}</small></button>`).join("") || '<div class="empty">暂无目录</div>'}
          </div>
        </aside>
        <section class="outline-reader">
          ${filtered.map((page) => renderOutlinePage(page, query)).join("") || '<div class="card empty"><strong>没有匹配内容</strong>请尝试更短的关键词。</div>'}
        </section>
      </div>`;
  }

  function renderOutline() {
    const query = state.outlineSearch.trim();
    return `${renderOutlineModeSwitch()}${state.outlineMode === "guide" ? renderKnowledgeGuide(query) : renderOfficialOutline(query)}
      <button type="button" class="button outline-back-to-top" data-action="back-to-top"><span aria-hidden="true">↑</span> 回到顶部</button>`;
  }

  function startMemorySession(subjectId, chapterId = null) {
    const points = (questionData.knowledgePoints || []).filter((point) =>
      point.subjectId === subjectId && (!chapterId || point.chapterId === chapterId)
    );
    const reviews = new Map(StudyDb.getKnowledgeReviews().map((review) => [review.knowledge_id, review]));
    const now = Date.now();
    const due = points.filter((point) => {
      const review = reviews.get(point.id);
      return review && new Date(review.next_review_at).getTime() <= now;
    }).sort((a, b) => String(reviews.get(a.id)?.next_review_at).localeCompare(String(reviews.get(b.id)?.next_review_at)));
    const unseen = points.filter((point) => !reviews.has(point.id));
    const upcoming = points.filter((point) => reviews.has(point.id) && !due.includes(point))
      .sort((a, b) => String(reviews.get(a.id)?.next_review_at).localeCompare(String(reviews.get(b.id)?.next_review_at)));
    const limit = chapterId ? points.length : Math.min(12, points.length);
    const queue = [...due, ...unseen, ...upcoming].slice(0, limit);
    if (!queue.length) {
      toast("当前没有可背诵的知识点", "error");
      return;
    }
    state.memorySession = {
      subjectId,
      chapterId,
      points: queue,
      index: 0,
      revealed: false,
      finished: false,
      results: { again: 0, hard: 0, known: 0 }
    };
    render();
  }

  function renderMemoryAnswer(point) {
    const citations = point.citations || [];
    const hasChinaAuthority = citations.some(isChinaAuthority);
    const hasOfficialTextbook = citations.some((citation) => citation.sourceClass === "china_official_textbook");
    const hasInternationalStandard = citations.some((citation) => citation.sourceClass === "international_standard");
    const hasHistoricalTextbook = citations.some((citation) => citation.sourceClass === "historical_exam_textbook");
    const sourceNote = hasOfficialTextbook
      ? "本条附有协会统编教材摘录；识别文本可能有误，仍应以原书页面及最新规则为准。"
      : hasChinaAuthority
      ? "本条附有中国法规或官方资料；仍应以来源原文及最新规则为准。"
      : hasInternationalStandard
        ? "本条目前只有国际标准参考，尚缺中国权威原文，不能直接当作中国现行规则。"
        : hasHistoricalTextbook
          ? "本条附有2020年商业教材历史摘录，但不属于协会统编教材，也不能作为现行规则或考试答案依据。"
        : "本条目前只有通用教材或讲义归纳，尚缺中国权威原文，不是中国考试官方答案。";
    return `<div class="memory-answer">
      <div class="knowledge-core"><span>核心答案</span><strong>${escapeHtml(point.statement)}</strong></div>
      <div class="memory-source-note ${hasChinaAuthority ? "verified" : "warning"}">${sourceNote}</div>
      <div class="knowledge-explanation"><h4>理解与边界</h4><p>${escapeHtml(point.explanation)}</p></div>
      ${point.memoryHook ? `<div class="knowledge-memory"><span>记忆钩子</span><strong>${escapeHtml(point.memoryHook)}</strong></div>` : ""}
      ${(point.detailSections || []).map((section) => `<section class="knowledge-detail"><h4>${escapeHtml(section.title)}</h4><ul>${(section.points || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`).join("")}
      <div class="knowledge-columns">
        <section class="knowledge-panel key"><h4>正确说法（需要记住）</h4><p class="knowledge-panel-note">以下内容均正确。</p><ul>${(point.keyPoints || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
        <section class="knowledge-panel mistake"><h4>错误说法（不要这样记）</h4><p class="knowledge-panel-note">以下内容均错误，是常见干扰项。</p><ul>${(point.commonMistakes || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>
      </div>
    </div>`;
  }

  function renderMemorySession() {
    const session = state.memorySession;
    if (session.finished) {
      const total = session.points.length;
      return `<main class="main session-shell memory-shell">
        <section class="card card-body memory-summary">
          <span class="knowledge-index">背诵完成</span>
          <h2>${total} 个知识点已记录</h2>
          <p>还不会 ${session.results.again} 个 · 模糊 ${session.results.hard} 个 · 已掌握 ${session.results.known} 个</p>
          <div class="memory-summary-grid">
            <div><strong>${session.results.again}</strong><span>10 分钟后再看</span></div>
            <div><strong>${session.results.hard}</strong><span>明天复习</span></div>
            <div><strong>${session.results.known}</strong><span>按记忆间隔复习</span></div>
          </div>
          <button class="button" data-action="exit-memory">返回知识讲义</button>
        </section>
      </main>`;
    }
    const point = session.points[session.index];
    const chapter = questionData.chapters.find((item) => item.id === point.chapterId);
    const progress = Math.round(session.index * 100 / session.points.length);
    return `<main class="main session-shell memory-shell">
      <header class="session-header">
        <div><button class="button secondary small" data-action="exit-memory">退出</button> <span class="session-meta">背诵卡 · 第 ${session.index + 1}/${session.points.length} 个</span></div>
        <span class="session-meta">${escapeHtml(chapter?.title || subjectTitle(point.subjectId))}</span>
      </header>
      <div class="memory-progress"><span style="width:${progress}%"></span></div>
      <article class="card memory-card ${session.revealed ? "revealed" : ""}">
        <div class="question-tags"><span class="tag level-master">${escapeHtml(point.level)}</span><span class="tag">${escapeHtml(point.id)}</span></div>
        <p class="memory-eyebrow">先遮住答案，用自己的话回答</p>
        <h2>${escapeHtml(point.topic)}</h2>
        <div class="memory-prompt">请说出：<strong>核心结论</strong>、至少 <strong>2 个关键词</strong>，以及 <strong>1 个常见误区</strong>。</div>
        ${session.revealed ? renderMemoryAnswer(point) : `<button class="button memory-reveal" data-action="reveal-memory">显示答案</button>`}
        ${session.revealed ? `<div class="memory-grades"><span>对照答案后评价：</span><button class="button danger" data-action="grade-memory" data-grade="again">还不会</button><button class="button secondary" data-action="grade-memory" data-grade="hard">有点模糊</button><button class="button" data-action="grade-memory" data-grade="known">已经掌握</button></div>` : ""}
      </article>
    </main>`;
  }

  function subjectChapters(subjectId) {
    return (questionData.chapters || []).filter((chapter) => chapter.subjectId === subjectId);
  }

  function renderPractice() {
    const chapters = subjectChapters(state.practiceSubject);
    const caseOnly = state.practiceTypes.size === 1 && state.practiceTypes.has("case");
    const countChoices = caseOnly ? [8,16,24,32,40] : [10,20,30,50,100];
    const available = questionData.questions.filter((question) => {
      return question.subjectId === state.practiceSubject &&
        (state.practiceChapter === "all" || question.chapterId === state.practiceChapter) &&
        state.practiceTypes.has(question.type);
    }).length;
    return `
      <div class="grid two">
        <section class="card card-body">
          <h3 class="card-title">生成章节练习</h3>
          <div class="form-grid">
            <div class="form-grid cols-2">
              <div class="field"><label>科目</label><select class="select" id="practice-subject">${questionData.subjects.map((subject) => `<option value="${subject.id}" ${state.practiceSubject === subject.id ? "selected" : ""}>${escapeHtml(subject.title)}</option>`).join("")}</select></div>
              <div class="field"><label>章节</label><select class="select" id="practice-chapter"><option value="all">全部章节</option>${chapters.map((chapter) => `<option value="${chapter.id}" ${state.practiceChapter === chapter.id ? "selected" : ""}>${escapeHtml(chapter.title)}</option>`).join("")}</select></div>
            </div>
            <div class="field"><label>题型</label><div class="checkbox-row">${[["single","单选"],["multiple","多选"],["judgment","判断"],["case","综合材料"]].map(([id,label]) => `<label class="check-chip"><input type="checkbox" data-practice-type="${id}" ${state.practiceTypes.has(id) ? "checked" : ""} />${label}</label>`).join("")}</div></div>
            <div class="field"><label>题目数量</label><select class="select" id="practice-count">${countChoices.map((count) => `<option value="${count}" ${state.practiceCount === count ? "selected" : ""}>${caseOnly ? `${count / 4} 组 · ` : ""}${count} 题</option>`).join("")}</select></div>
            <div class="notice">当前条件共有 ${available} 道可用题。${caseOnly && state.practiceChapter === "all" ? "综合材料专项会按完整题组连续出题，同一材料连续回答 4 问。" : "章节练习会即时显示答案、解析、大纲原文和引用出处。"}</div>
            <div class="action-group"><button class="button" data-action="start-practice" ${available ? "" : "disabled"}>开始章节练习</button><button class="button secondary" data-action="start-case-practice">综合案例专项 · 4组16问</button></div>
          </div>
        </section>
        <section class="card card-body">
          <h3 class="card-title">模拟考试</h3>
          <p class="prose-muted">按照官方公开框架生成 120 题、120 分钟的本地模拟卷；每科抽取 120 个不同底层知识组，其中稳定包含 4 个完整案例题组（16 问）。考试中不即时显示解析，交卷后统一查看成绩与错题。</p>
          <div class="quick-list">
            ${questionData.subjects.map((subject) => `<div class="quick-item"><div><strong>${escapeHtml(subject.title)}</strong><br /><span>120 题 · 120 分钟 · 120 个不同知识组</span></div><button class="button small" data-action="start-exam-subject" data-subject="${subject.id}">开始模考</button></div>`).join("")}
          </div>
          <div class="notice mt-4-safe">官方没有公布题型占比、章节权重和多选题评分细则。本工具的抽题分布仅用于训练。</div>
        </section>
      </div>`;
  }

  function getListQuestions() {
    const ids = state.listTab === "wrong" ? StudyDb.getWrongQuestionIds() : StudyDb.getBookmarkIds();
    return ids.map((id) => questionMap.get(id)).filter(Boolean);
  }

  function renderMistakes() {
    const items = getListQuestions();
    return `
      <section class="card card-body">
        <div class="mb-3.5 flex items-center justify-between gap-3">
          <div class="action-group">
            <button class="button ${state.listTab === "wrong" ? "" : "secondary"} small" data-action="list-tab" data-tab="wrong">当前错题</button>
            <button class="button ${state.listTab === "bookmarks" ? "" : "secondary"} small" data-action="list-tab" data-tab="bookmarks">收藏题目</button>
          </div>
          <button class="button small" data-action="practice-list" ${items.length ? "" : "disabled"}>练习本列表</button>
        </div>
        ${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>题目</th><th>科目</th><th>章节</th><th>题型</th></tr></thead><tbody>${items.map((q) => `<tr><td>${escapeHtml(q.stem).slice(0,90)}${q.stem.length > 90 ? "…" : ""}</td><td>${escapeHtml(subjectTitle(q.subjectId))}</td><td>${escapeHtml(chapterTitle(q.chapterId))}</td><td>${typeLabel(q.type)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>这里还是空的</strong>答错或收藏的题目会自动出现在这里。</div>'}
      </section>`;
  }

  function subjectTitle(id) { return questionData.subjects.find((item) => item.id === id)?.title || id; }
  function chapterTitle(id) { return questionData.chapters.find((item) => item.id === id)?.title || id; }
  function typeLabel(type) { return ({ single: "单选", multiple: "多选", judgment: "判断", case: "综合" })[type] || type; }

  function renderStats() {
    const attempts = StudyDb.getAttemptRows();
    const grouped = new Map();
    for (const attempt of attempts) {
      const question = questionMap.get(attempt.question_id);
      if (!question) continue;
      const key = question.chapterId;
      const current = grouped.get(key) || { total: 0, correct: 0, unique: new Set() };
      current.total += 1;
      current.correct += Number(attempt.is_correct);
      current.unique.add(question.id);
      grouped.set(key, current);
    }
    const history = StudyDb.getExamHistory();
    return `
      <div class="grid two">
        <section class="card card-body">
          <h3 class="card-title">章节表现 <span class="metric-label">（含历年题去重版）</span></h3>
          ${grouped.size ? `<div class="table-wrap"><table class="table"><thead><tr><th>章节</th><th>已覆盖</th><th>作答次数</th><th>正确率</th></tr></thead><tbody>${questionData.chapters.map((chapter) => {
            const item = grouped.get(chapter.id);
            if (!item) return "";
            const bankCount = questionData.questions.filter((q) => q.chapterId === chapter.id).length;
            return `<tr><td>${escapeHtml(chapter.title)}</td><td>${item.unique.size}/${bankCount}</td><td>${item.total}</td><td>${Math.round(item.correct * 100 / item.total)}%</td></tr>`;
          }).join("")}</tbody></table></div>` : '<div class="empty"><strong>暂无统计</strong>完成一些章节练习后再回来查看。</div>'}
        </section>
        <section class="card card-body">
          <h3 class="card-title">最近模拟考试</h3>
          ${history.length ? `<div class="quick-list">${history.map((item) => `<div class="quick-item"><div><strong>${escapeHtml(subjectTitle(item.subject_id))}</strong><br /><span>${formatDate(item.completed_at)} · ${Math.round((item.duration_seconds || 0)/60)} 分钟</span></div><strong>${item.score}/${item.total}</strong></div>`).join("")}</div>` : '<div class="empty"><strong>还没有模考记录</strong>准备完成第一轮学习后再做整卷。</div>'}
        </section>
      </div>`;
  }

  function renderProfile() {
    const direct = StudyDb.hasDirectFileSupport();
    const meta = StudyDb.getMeta();
    return `
      <div class="grid two">
        <section class="card card-body">
          <h3 class="card-title">SQLite 学习档案</h3>
          <p class="prose-muted">Chrome 支持直接绑定本地文件。绑定后，每次答题、收藏和交卷都会自动写回 SQLite；同时保留一份浏览器内部快照。</p>
          ${direct ? "" : '<div class="notice">当前环境未开放 File System Access API，只能使用手动导入和导出。</div>'}
          <div class="profile-actions mt-4-safe">
            <button class="button" data-action="new-profile" ${direct ? "" : "disabled"}>新建并绑定档案</button>
            <button class="button secondary" data-action="open-profile" ${direct ? "" : "disabled"}>打开并绑定档案</button>
            <button class="button secondary" data-action="import-profile">手动导入</button>
            <button class="button secondary" data-action="export-profile">导出档案</button>
            <button class="button ghost" data-action="merge-profile">合并另一份档案</button>
          </div>
          <div class="profile-status">
            <div class="status-row"><span>当前档案</span><strong>${escapeHtml(state.saveStatus.profileName)}</strong></div>
            <div class="status-row"><span>文件绑定</span><strong>${state.saveStatus.bound ? "已绑定，自动写回" : "未绑定，浏览器自动保存"}</strong></div>
            <div class="status-row"><span>最后保存</span><strong>${formatDate(state.saveStatus.lastSavedAt)}</strong></div>
            <div class="status-row"><span>档案创建</span><strong>${formatDate(meta.created_at)}</strong></div>
          </div>
        </section>
        <section class="card card-body">
          <h3 class="card-title">迁移规则</h3>
          <div class="notice">必须在原电脑确认“已写入档案”后，再把 SQLite 文件带到另一台电脑。不要在两台电脑上同时编辑同一个网盘文件。</div>
          <ol class="profile-steps">
            <li>完成刷题并等待页面显示“已写入档案”。</li>
            <li>关闭页面，复制 <code>securities-study-profile.sqlite</code>。</li>
            <li>另一台电脑打开本工具，选择“打开并绑定档案”。</li>
            <li>如果两边都产生了记录，使用“合并另一份档案”，不要直接覆盖。</li>
          </ol>
          <h3 class="card-title mt-22-safe">内容与版权</h3>
          <p class="content-note">本工具仅供个人非商业学习。内置大纲原件版权归发布机构；题目为依据公开范围原创，不复制商业题库，不宣称官方题库或真题。</p>
        </section>
      </div>`;
  }

  function selectQuestions({ subjectId, chapterId = "all", count = 20, types = null, ids = null }) {
    let pool = ids ? ids.map((id) => questionMap.get(id)).filter((question) => question && question.examEligible !== false) : questionData.questions.filter((question) => {
      return (!subjectId || question.subjectId === subjectId) &&
        (chapterId === "all" || question.chapterId === chapterId) &&
        (!types || types.has(question.type)) && question.examEligible !== false;
    });
    if (types?.size === 1 && types.has("case")) {
      const importedCaseSelection = ExamBank.selectCases(pool, count);
      if (importedCaseSelection.length) return importedCaseSelection;
      const groups = new Map();
      for (const question of pool) {
        const key = question.caseGroupId || question.id;
        const list = groups.get(key) || [];
        list.push(question); groups.set(key, list);
      }
      const orderedGroups = shuffle([...groups.values()]).map((group) => group.sort((left, right) => (left.caseOrder || 1) - (right.caseOrder || 1)));
      const result = [];
      for (const group of orderedGroups) {
        if (result.length + group.length > count) continue;
        result.push(...group);
        if (result.length === count) break;
      }
      return result.length ? result : orderedGroups.flat().slice(0, Math.min(count, pool.length));
    }
    return shuffle(pool).slice(0, Math.min(count, pool.length));
  }

  function selectExamQuestions(subjectId) {
    return ExamBank.selectExam(questionData.questions, subjectId);
  }

  function startSession({ mode, questions, subjectId = null, seconds = null, scoringScheme = "legacy" }) {
    if (!questions.length) return toast("没有符合条件的题目", "error");
    const id = crypto.randomUUID();
    state.session = {
      id,
      mode,
      subjectId,
      scoringScheme,
      totalPoints: questions.reduce((sum, q) => sum + ExamBank.points(q, scoringScheme), 0),
      questions,
      index: 0,
      answers: {},
      submitted: {},
      startedAt: Date.now(),
      remainingSeconds: seconds,
      deadlineAt: seconds ? Date.now() + seconds * 1000 : null,
      finished: false,
      score: null
    };
    if (mode === "exam") StudyDb.createSession({ id, mode, subjectId, questionIds: questions.map((q) => q.id), scoringScheme, totalPoints: state.session.totalPoints });
    render();
  }

  function startExam(subjectId) {
    const pool = selectExamQuestions(subjectId, 120);
    if (pool.length < 120) toast(`当前科目只有 ${pool.length} 道可用题，将以现有题量生成模拟卷`, "error");
    startSession({ mode: "exam", questions: pool, subjectId, seconds: 120 * 60, scoringScheme: "paper-100-v1" });
  }

  function bindSessionTimer() {
    clearInterval(state.sessionTimer);
    if (!state.session || state.session.mode !== "exam" || state.session.finished) return;
    state.sessionTimer = setInterval(() => {
      if (!state.session) return clearInterval(state.sessionTimer);
      state.session.remainingSeconds = Math.max(0, Math.ceil((state.session.deadlineAt - Date.now()) / 1000));
      const timer = document.getElementById("session-timer");
      if (timer) {
        timer.textContent = formatSeconds(state.session.remainingSeconds);
        timer.classList.toggle("warning", state.session.remainingSeconds < 600);
      }
      if (state.session.remainingSeconds <= 0) finishExam().catch((error) => toast(error.message, "error"));
    }, 1000);
  }

  function formatSeconds(seconds) {
    const safe = Math.max(0, Number(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return [h, m, s].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function renderSession() {
    const session = state.session;
    if (session.finished) return renderExamResult(session);
    const question = session.questions[session.index];
    const selected = new Set(session.answers[question.id] || []);
    const submitted = Boolean(session.submitted[question.id]);
    const correct = sameAnswer(selected, new Set(question.correctOptionIds));
    const type = typeLabel(question.type);
    const isMultiple = ExamBank.multiple(question);
    return `
      <main class="main session-shell">
        <div class="session-header">
          <div><button class="button secondary small" data-action="exit-session">退出</button> <span class="session-meta">${session.mode === "exam" ? "模拟考试" : session.mode === "review" ? "模考复盘" : "章节练习"} · 第 ${session.index + 1}/${session.questions.length} 题</span></div>
          ${session.mode === "exam" ? `<div id="session-timer" class="timer ${session.remainingSeconds < 600 ? "warning" : ""}">${formatSeconds(session.remainingSeconds)}</div>` : `<div class="session-meta">已完成 ${Object.keys(session.submitted).length} 题</div>`}
        </div>
        <div class="progress session-progress"><span style="width:${Math.round((session.index + 1) * 100 / session.questions.length)}%"></span></div>
        <section class="card question-card">
          <div class="question-tags">
            <span class="tag">${type}</span>
            <span class="tag">${escapeHtml(subjectTitle(question.subjectId))}</span>
            <span class="tag">${escapeHtml(chapterTitle(question.chapterId))}</span>
            <span class="tag level-master">${escapeHtml(question.level || "掌握")}</span>
            ${question.repeatLabel ? `<span class="tag repeat-tag">★ ${escapeHtml(question.repeatLabel)}</span>` : ""}
            ${question.negation ? '<span class="tag negative">注意否定表述</span>' : ""}
          </div>
          ${question.caseMaterial ? `<div class="case-material"><strong>综合案例 · ${escapeHtml(question.caseGroupTitle || "材料题")} · 第 ${question.caseOrder || 1}/${question.caseGroupSize || 1} 问</strong><p>${escapeHtml(question.caseMaterial)}</p></div>` : ""}
          <div class="question-stem">${renderStem(question.stem)}</div>
          <div class="options">
            ${question.options.map((option, index) => {
              const chosen = selected.has(option.id);
              const isRight = question.correctOptionIds.includes(option.id);
              let optionClass = chosen ? "selected" : "";
              if (submitted) optionClass += isRight ? " correct" : (chosen ? " incorrect" : "");
              return `<button class="option ${optionClass}" data-action="choose-option" data-option="${option.id}" ${submitted ? "disabled" : ""}><span class="option-key">${String.fromCharCode(65 + index)}</span><span>${escapeHtml(option.text)}</span></button>`;
            }).join("")}
          </div>
          <div class="question-actions">
            <div class="action-group">
              <button class="button secondary" data-action="prev-question" ${session.index === 0 ? "disabled" : ""}>上一题</button>
              <button class="button ghost" data-action="bookmark-question">${StudyDb.isBookmarked(question.id) ? "取消收藏" : "收藏"}</button>
            </div>
            <div class="action-group">
              ${session.mode === "practice" && !submitted ? `<button class="button" data-action="submit-question" ${selected.size ? "" : "disabled"}>提交答案</button>` : ""}
              ${session.mode === "exam" ? `<button class="button" data-action="next-question">${session.index === session.questions.length - 1 ? "交卷" : "下一题"}</button>` : submitted ? `<button class="button" data-action="next-question">${session.index === session.questions.length - 1 ? "完成练习" : "下一题"}</button>` : ""}
            </div>
          </div>
          ${submitted ? renderExplanation(question, correct) : ""}
          ${isMultiple && !submitted ? '<div class="metric-detail mt-3">多选题可选择多个选项，全部选对才判定正确。</div>' : ""}
        </section>
      </main>`;
  }

  function renderStem(stem) {
    let safe = escapeHtml(stem);
    for (const word of ["不正确", "错误", "不属于", "不得", "不包括"]) {
      safe = safe.replaceAll(word, `<span class="stem-negation">${word}</span>`);
    }
    return safe;
  }

  function renderExplanation(question, correct) {
    return `
      <div class="explanation">
        <div class="result-banner ${correct ? "correct" : "incorrect"}">${correct ? "回答正确" : `回答错误，正确答案：${question.correctOptionIds.join("、")}`}</div>
        <h4>解析</h4><p>${escapeHtml(question.explanation)}</p>
        ${question.optionExplanations ? `<h4>选项说明</h4>${question.options.map((option) => `<p><strong>${option.id}：</strong>${escapeHtml(question.optionExplanations[option.id] || "")}</p>`).join("")}` : ""}
        <h4>答案出处与核验说明</h4>
        ${renderSourceReferences(question.citations || [])}${renderImportedLinks(question)}
        <h4>个人笔记</h4>
        <textarea class="textarea" id="question-note" placeholder="记录自己的理解、易错点或记忆方法……">${escapeHtml(StudyDb.getNote(question.id))}</textarea>
        <button class="button small mt-2-safe" data-action="save-note">保存笔记</button>
      </div>`;
  }

  function renderCitation(citation) {
    const sourceClass = citation.sourceClass || (citation.kind === "textbook" ? "general_textbook" : "china_official");
    const isRecognizedTextbook = sourceClass === "china_official_textbook" || sourceClass === "historical_exam_textbook";
    const localFragment = citation.page ? (isRecognizedTextbook ? `#page-${citation.page}` : `#page=${citation.page}`) : "";
    const localLabel = isRecognizedTextbook ? "打开教材对应页" : "打开本地原件";
    const local = citation.localPath ? `<a href="${escapeHtml(citation.localPath)}${localFragment}" target="_blank">${localLabel}</a>` : "";
    const presentation = sourceClass === "china_official_textbook"
      ? { citationClass: "official-textbook-citation", tagClass: "source-official-textbook", label: "协会统编教材 · 请核对原书", link: "查看协会教材页面", quoteLabel: "教材识别文本摘录" }
      : sourceClass === "historical_exam_textbook"
      ? { citationClass: "historical-textbook-citation", tagClass: "source-historical-textbook", label: "2020 商业教材 · 历史辅助 · 非答案依据", link: "", quoteLabel: "历史教材识别文本摘录 · 仅供对照" }
      : sourceClass === "general_textbook"
      ? { citationClass: "textbook-citation", tagClass: "source-textbook", label: "通用开放教材 · 非中国考试官方教材", link: "打开通用开放教材", quoteLabel: "项目中文短译 · 仅辅助理解" }
      : sourceClass === "international_standard"
        ? { citationClass: "international-citation", tagClass: "source-international", label: "国际标准参考 · 非中国现行规则", link: "打开国际标准原文", quoteLabel: "项目中文短译 / 国际标准要点" }
        : { citationClass: "authority-citation", tagClass: "source-authority", label: sourceClass === "china_law" ? "中国现行法律依据" : "中国官方资料", link: "打开中国官方来源", quoteLabel: "相关原文 / 条文要点" };
    const online = citation.url ? `<a href="${escapeHtml(citation.url)}" target="_blank">${presentation.link}</a>` : "";
    const metadata = [citation.publisher, citation.jurisdiction ? `适用范围：${citation.jurisdiction}` : "", citation.license ? `许可：${citation.license}` : "", citation.effectiveDate ? `版本：${citation.effectiveDate}` : ""].filter(Boolean).map(escapeHtml).join(" · ");
    const original = citation.originalQuote ? `<details class="citation-original"><summary>查看英文原文</summary><blockquote lang="en">${escapeHtml(citation.originalQuote)}</blockquote></details>` : "";
    const textNotice = citation.textNotice ? `<div class="citation-text-notice">${escapeHtml(citation.textNotice)}</div>` : "";
    return `<div class="citation ${presentation.citationClass}"><div class="citation-title"><span class="tag ${presentation.tagClass}">${presentation.label}</span> ${escapeHtml(citation.title)}</div><div class="citation-locator">${escapeHtml(citation.locator || "")}</div>${metadata ? `<div class="citation-meta">${metadata}</div>` : ""}<div class="citation-quote-label">${presentation.quoteLabel}</div><blockquote>${escapeHtml(citation.quote || "")}</blockquote>${textNotice}${original}<div class="citation-links">${local}${online}</div></div>`;
  }

  function renderImportedLinks(question) {
    if (!question?.bookLinks?.length && !question?.knowledgeLinks?.length) return "";
    const books = (question.bookLinks || []).map((link) => `<li>教材第 ${escapeHtml(String(link.page))} 页（自动匹配，相关度 ${escapeHtml(String(link.score))}）</li>`).join("");
    const points = (question.knowledgeLinks || []).map((link) => `<li>${escapeHtml(link.topic)}（自动关联，相关度 ${escapeHtml(String(link.score))}）</li>`).join("");
    return `<div class="imported-links"><strong>历年题教材定位（自动匹配）</strong><ul>${books}${points}</ul><small>关联结果用于定位复习，尚未逐题人工确认，不作为答案核验结论。</small></div>`;
  }

  function renderScopeReference(citation) {
    const local = citation.localPath ? `<a href="${escapeHtml(citation.localPath)}${citation.page ? `#page=${citation.page}` : ""}" target="_blank">本地大纲</a>` : "";
    const official = citation.url ? `<a href="${escapeHtml(citation.url)}" target="_blank">官方大纲</a>` : "";
    return `<div class="scope-reference"><div><span class="tag">大纲范围 · 非答案出处</span><strong>${escapeHtml(citation.locator || citation.title)}</strong></div><div class="citation-links">${local}${official}</div></div>`;
  }

  function renderSourceReferences(citations) {
    if (!citations.length) return `<div class="source-status supplement"><strong>历年整理题 · 来源答案待核验</strong><span>题目来自本地历年试题整理资料，答案和解析按原资料保存；现行规则应以最新官方文本复核。</span></div><div class="scope-reference"><div><span class="tag">大纲范围 · 非答案出处</span><strong>历年试题教材定位</strong></div></div>`;
    const chinaAuthorities = citations.filter(isChinaAuthority);
    const hasOfficialTextbook = chinaAuthorities.some((citation) => citation.sourceClass === "china_official_textbook");
    const hasOtherChinaAuthority = chinaAuthorities.some((citation) => citation.sourceClass !== "china_official_textbook");
    const internationalStandards = citations.filter((citation) => citation.sourceClass === "international_standard");
    const generalTextbooks = citations.filter((citation) => citation.sourceClass === "general_textbook" || (!citation.sourceClass && citation.kind === "textbook"));
    const historicalTextbooks = citations.filter((citation) => citation.sourceClass === "historical_exam_textbook");
    const references = [...chinaAuthorities, ...internationalStandards, ...generalTextbooks, ...historicalTextbooks];
    const scopes = citations.filter((citation) => citation.kind === "scope");
    const status = chinaAuthorities.length
      ? `<div class="source-status verified"><strong>${hasOfficialTextbook ? (hasOtherChinaAuthority ? "有协会统编教材及中国法规/官方资料支持" : "有协会统编教材摘录支持") : "有中国法规/官方资料支持"}</strong><span>${hasOfficialTextbook ? "教材摘录按 PDF 页定位，但识别文字可能存在误差；" : ""}绿色资料优先用于核验中国制度和考试口径；国际标准、通用教材与2020历史教材仅作补充，发生差异时以协会统编教材、中国现行法律和监管规则为准。</span></div>`
      : internationalStandards.length
        ? `<div class="source-status international"><strong>仅有国际标准参考，尚缺中国权威原文</strong><span>这些资料可以解释风险管理等国际通用概念，但不能直接证明中国现行制度或考试口径。</span></div>`
        : historicalTextbooks.length
          ? `<div class="source-status supplement"><strong>仅有2020商业教材历史辅助，尚缺中国权威原文</strong><span>该书不是协会统编教材，且早于多项现行法律与规则；摘录只能帮助理解历史框架，不能作为当前考试答案。</span></div>`
        : generalTextbooks.length
          ? `<div class="source-status supplement"><strong>仅有非官方原理补充，尚缺中国权威原文</strong><span>Saylor 是 2012 年美国开放教材，不是中国证券业协会考试教材，也不作为中国现行规则的答案依据。</span></div>`
          : '<div class="source-status summary"><strong>讲义归纳，暂无独立权威原文</strong><span>本条依据公开考试范围整理，不是官方答案。大纲只用于确认“考什么”，不能证明这里的完整结论。</span></div>';
    return `${status}${references.map(renderCitation).join("")}
      ${scopes.length ? `<div class="scope-reference-list"><span>考试范围核对（学习时可忽略）</span>${scopes.map(renderScopeReference).join("")}</div>` : ""}`;
  }

  function chooseOption(optionId) {
    const session = state.session;
    const question = session.questions[session.index];
    const selected = new Set(session.answers[question.id] || []);
    if (ExamBank.multiple(question)) {
      if (selected.has(optionId)) selected.delete(optionId); else selected.add(optionId);
    } else {
      selected.clear(); selected.add(optionId);
    }
    session.answers[question.id] = [...selected];
    if (session.mode === "exam") {
      StudyDb.recordExamAnswer({
        sessionId: session.id,
        questionId: question.id,
        selected: [...selected],
        isCorrect: sameAnswer(selected, new Set(question.correctOptionIds))
      });
    }
    render();
  }

  function submitPracticeAnswer() {
    const session = state.session;
    const question = session.questions[session.index];
    const selected = session.answers[question.id] || [];
    if (!selected.length) return;
    const correct = sameAnswer(new Set(selected), new Set(question.correctOptionIds));
    session.submitted[question.id] = true;
    StudyDb.recordAttempt({ questionId: question.id, questionVersion: question.version || 1, selected, isCorrect: correct, mode: "practice", sessionId: session.id });
    render();
  }

  function nextQuestion() {
    const session = state.session;
    if (session.mode === "exam" && session.index === session.questions.length - 1) return finishExam();
    if (session.mode === "review" && session.index === session.questions.length - 1) {
      state.session = null; state.view = "stats"; render(); return;
    }
    if (session.mode === "practice" && session.index === session.questions.length - 1) {
      toast("本组练习已完成", "success");
      state.session = null; state.view = "stats"; render(); return;
    }
    session.index = Math.min(session.index + 1, session.questions.length - 1);
    render();
  }

  async function finishExam() {
    const session = state.session;
    if (!session || session.finished) return;
    clearInterval(state.sessionTimer);
    let score = 0;
    for (const question of session.questions) {
      const selected = session.answers[question.id] || [];
      const correct = sameAnswer(new Set(selected), new Set(question.correctOptionIds));
      if (correct) score += ExamBank.points(question, session.scoringScheme);
      StudyDb.recordAttempt({ questionId: question.id, questionVersion: question.version || 1, selected, isCorrect: correct, mode: "exam", sessionId: session.id });
    }
    const duration = Math.round((Date.now() - session.startedAt) / 1000);
    StudyDb.completeSession({ id: session.id, score, durationSeconds: duration });
    await StudyDb.flush();
    state.activeExam = null;
    session.score = score;
    session.finished = true;
    render();
  }

  function renderExamResult(session) {
    const percent = Math.round(session.score * 100 / (session.totalPoints || session.questions.length));
    const wrongIds = session.questions.filter((question) => !sameAnswer(new Set(session.answers[question.id] || []), new Set(question.correctOptionIds))).map((q) => q.id);
    return `<main class="main session-shell"><section class="card card-body"><div class="empty"><strong class="exam-score">${session.score} / ${session.totalPoints || session.questions.length}</strong><div class="exam-result-summary">得分率 ${percent}% · ${percent >= 60 ? "达到本地模拟要求" : "建议回看薄弱章节"}</div><div class="action-group center-actions"><button class="button" data-action="review-exam-wrong" ${wrongIds.length ? "" : "disabled"}>逐题复习错题</button><button class="button secondary" data-action="review-exam-all">查看全部解析与来源</button><button class="button secondary" data-action="exit-session">返回总览</button></div></div><div class="notice">该成绩只反映本工具的题型练习表现，不代表官方成绩预测。交卷记录已写入学习档案。</div></section></main>`;
  }

  function beginExamReview(wrongOnly) {
    const previous = state.session;
    const questions = wrongOnly ? previous.questions.filter((question) => !sameAnswer(new Set(previous.answers[question.id] || []), new Set(question.correctOptionIds))) : previous.questions;
    state.session = {
      ...previous,
      mode: "review",
      questions,
      index: 0,
      finished: false,
      submitted: Object.fromEntries(questions.map((question) => [question.id, true])),
      remainingSeconds: null,
      deadlineAt: null
    };
    render();
  }

  function resumeExam() {
    const active = state.activeExam;
    if (!active) return;
    const questions = active.questionIds.map((id) => questionMap.get(id)).filter(Boolean);
    const elapsed = Math.max(0, Math.round((Date.now() - new Date(active.started_at).getTime()) / 1000));
    const firstUnanswered = questions.findIndex((question) => !(question.id in active.answers));
    state.session = {
      id: active.id,
      mode: "exam",
      subjectId: active.subject_id,
      scoringScheme: active.scoringScheme || "legacy",
      totalPoints: active.total,
      questions,
      index: firstUnanswered === -1 ? questions.length - 1 : firstUnanswered,
      answers: active.answers,
      submitted: {},
      startedAt: new Date(active.started_at).getTime(),
      remainingSeconds: Math.max(0, 120 * 60 - elapsed),
      deadlineAt: new Date(active.started_at).getTime() + 120 * 60 * 1000,
      finished: false,
      score: null
    };
    render();
  }

  function getChatContext() {
    const context = {
      view: state.memorySession ? "背诵卡" : state.session ? "答题" : (pageInfo[state.view]?.[0] || state.view),
      contentCutoff: questionData.meta?.contentCutoff || "2026-08-18"
    };
    if (state.session && !state.session.finished) {
      const session = state.session;
      const question = session.questions[session.index];
      const submitted = Boolean(session.submitted[question.id]) || session.mode === "review";
      Object.assign(context, {
        mode: session.mode,
        progress: `${session.index + 1}/${session.questions.length}`,
        question: {
          id: question.id,
          type: typeLabel(question.type),
          subject: subjectTitle(question.subjectId),
          chapter: chapterTitle(question.chapterId),
          caseMaterial: question.caseMaterial || null,
          stem: question.stem,
          options: question.options.map((option) => ({ id: option.id, text: option.text })),
          selectedOptionIds: session.answers[question.id] || [],
          submitted
        }
      });
      if (submitted) {
        context.question.correctOptionIds = question.correctOptionIds;
        context.question.explanation = question.explanation;
      } else {
        context.guidance = "题目尚未提交。除非用户明确索要答案，优先用提问和排除法引导，不直接揭晓答案。";
      }
    } else if (state.memorySession && !state.memorySession.finished) {
      const point = state.memorySession.points[state.memorySession.index];
      context.memoryCard = {
        id: point.id,
        subject: subjectTitle(point.subjectId),
        chapter: chapterTitle(point.chapterId),
        topic: point.topic,
        revealed: state.memorySession.revealed
      };
      if (state.memorySession.revealed) {
        context.memoryCard.statement = point.statement;
        context.memoryCard.explanation = point.explanation;
      }
    } else if (state.view === "outline") {
      context.subject = subjectTitle(state.knowledgeSubject);
      context.search = state.outlineSearch || null;
    } else if (state.view === "practice") {
      context.subject = subjectTitle(state.practiceSubject);
      context.chapter = state.practiceChapter === "all" ? "全部章节" : chapterTitle(state.practiceChapter);
    }
    return context;
  }

  window.ExamApp = Object.freeze({ getChatContext, getLastReadingPosition });

  async function handleAction(action, target) {
    try {
      if (action === "quick-practice") startSession({ mode: "practice", questions: selectQuestions({ count: 20 }) });
      if (action === "practice-subject") { captureReadingPosition(); state.practiceSubject = target.dataset.subject; state.practiceChapter = "all"; state.view = "practice"; render(); }
      if (action === "start-exam") startExam(state.practiceSubject || "finance");
      if (action === "resume-exam") resumeExam();
      if (action === "start-exam-subject") startExam(target.dataset.subject);
      if (action === "start-practice") startSession({ mode: "practice", questions: selectQuestions({ subjectId: state.practiceSubject, chapterId: state.practiceChapter, count: state.practiceCount, types: state.practiceTypes }), subjectId: state.practiceSubject });
      if (action === "start-case-practice") startSession({ mode: "practice", questions: selectQuestions({ subjectId: state.practiceSubject, chapterId: "all", count: 16, types: new Set(["case"]) }), subjectId: state.practiceSubject });
      if (action === "list-tab") { state.listTab = target.dataset.tab; render(); }
      if (action === "practice-list") startSession({ mode: "practice", questions: selectQuestions({ ids: getListQuestions().map((q) => q.id), count: getListQuestions().length }) });
      if (action === "toggle-multi-year") { state.multiYearOnly = !state.multiYearOnly; render(); }
      if (action === "practice-fact") {
        captureReadingPosition();
        const factId = target.dataset.fact;
        const related = (questionData.questions || []).filter((question) => question.factId === factId && question.examEligible !== false && question.verificationStatus === "source_transcribed");
        if (!related.length) { toast("这个知识点暂无可用历年题", "error"); return; }
        startSession({ mode: "practice", questions: shuffle(related).slice(0, Math.min(20, related.length)), subjectId: related[0].subjectId });
      }
      if (action === "outline-mode") { captureReadingPosition(); state.outlineMode = target.dataset.mode; state.outlineSearch = ""; render(); resetReadingPositionAfterRender(); }
      if (action === "back-to-top") {
        readingRestoreToken += 1;
        restoringReadingPosition = false;
        window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        scheduleReadingPositionCapture();
      }
      if (action === "start-memory") { captureReadingPosition(); startMemorySession(target.dataset.subject || state.knowledgeSubject, target.dataset.chapter || null); }
      if (action === "reveal-memory") { state.memorySession.revealed = true; render(); }
      if (action === "grade-memory") {
        const memory = state.memorySession;
        const point = memory.points[memory.index];
        const grade = target.dataset.grade;
        StudyDb.recordKnowledgeReview(point.id, grade);
        memory.results[grade] += 1;
        if (memory.index >= memory.points.length - 1) memory.finished = true;
        else { memory.index += 1; memory.revealed = false; }
        render();
      }
      if (action === "exit-memory") { state.memorySession = null; openLastReadingPosition(); }
      if (action === "jump-outline") {
        document.querySelectorAll(".toc-button.active").forEach((button) => button.classList.remove("active"));
        target.classList.add("active");
        const destination = document.getElementById(target.dataset.anchor) || document.getElementById(`outline-page-${target.dataset.page}`);
        if (destination) saveReadingPosition(destination.id);
        destination?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      if (action === "choose-option") chooseOption(target.dataset.option);
      if (action === "submit-question") submitPracticeAnswer();
      if (action === "next-question") nextQuestion();
      if (action === "prev-question") { state.session.index = Math.max(0, state.session.index - 1); render(); }
      if (action === "bookmark-question") { const q = state.session.questions[state.session.index]; const enabled = StudyDb.toggleBookmark(q.id); toast(enabled ? "已收藏" : "已取消收藏", "success"); render(); }
      if (action === "save-note") { const q = state.session.questions[state.session.index]; StudyDb.saveNote(q.id, document.getElementById("question-note")?.value || ""); toast("笔记已保存", "success"); }
      if (action === "exit-session") {
        clearInterval(state.sessionTimer);
        const wasUnfinishedExam = state.session?.mode === "exam" && !state.session.finished;
        state.session = null;
        if (wasUnfinishedExam) state.activeExam = StudyDb.getActiveExam();
        state.view = "dashboard";
        render();
      }
      if (action === "review-exam-wrong") beginExamReview(true);
      if (action === "review-exam-all") beginExamReview(false);
      if (action === "new-profile") { await StudyDb.createBoundProfile(); toast("学习档案已创建并绑定", "success"); render(); }
      if (action === "open-profile") { await StudyDb.openBoundProfile(); toast("学习档案已打开", "success"); render(); }
      if (action === "import-profile") document.getElementById("profile-file-input").click();
      if (action === "export-profile") { await StudyDb.exportProfile(); toast("学习档案已导出", "success"); }
      if (action === "merge-profile") document.getElementById("merge-file-input").click();
    } catch (error) {
      console.error(error);
      toast(error.message || "操作失败", "error");
    }
  }

  app.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      captureReadingPosition();
      if (nav.dataset.nav === "outline") openLastReadingPosition();
      else { state.view = nav.dataset.nav; render(); }
      return;
    }
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) handleAction(actionTarget.dataset.action, actionTarget);
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "outline-source") { captureReadingPosition(); state.outlineSource = target.value; render(); resetReadingPositionAfterRender(); }
    if (target.id === "knowledge-subject") { captureReadingPosition(); state.knowledgeSubject = target.value; state.outlineSearch = ""; render(); resetReadingPositionAfterRender(); }
    if (target.id === "practice-subject") { state.practiceSubject = target.value; state.practiceChapter = "all"; render(); }
    if (target.id === "practice-chapter") { state.practiceChapter = target.value; render(); }
    if (target.id === "practice-count") { state.practiceCount = Number(target.value); render(); }
    if (target.dataset.practiceType) {
      if (target.checked) state.practiceTypes.add(target.dataset.practiceType); else state.practiceTypes.delete(target.dataset.practiceType);
      const caseOnly = state.practiceTypes.size === 1 && state.practiceTypes.has("case");
      if (caseOnly && ![8,16,24,32,40].includes(state.practiceCount)) state.practiceCount = 16;
      if (!caseOnly && ![10,20,30,50,100].includes(state.practiceCount)) state.practiceCount = 20;
      render();
    }
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "outline-search") {
      state.outlineSearch = event.target.value;
      clearTimeout(state.outlineDebounce);
      state.outlineDebounce = setTimeout(() => {
        render();
        const input = document.getElementById("outline-search");
        if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
      }, 180);
    }
  });

  document.getElementById("profile-file-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await StudyDb.importBytes(await file.arrayBuffer(), file.name); toast("档案已导入", "success"); render(); }
    catch (error) { toast(error.message || "导入失败", "error"); }
    event.target.value = "";
  });

  document.getElementById("merge-file-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await StudyDb.mergeBytes(await file.arrayBuffer()); toast("另一份档案已合并", "success"); render(); }
    catch (error) { toast(error.message || "合并失败", "error"); }
    event.target.value = "";
  });

  window.addEventListener("scroll", scheduleReadingPositionCapture, { passive: true });
  window.addEventListener("pagehide", captureReadingPosition);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") captureReadingPosition(); });
  window.addEventListener("beforeunload", () => { captureReadingPosition(); StudyDb.flush().catch(() => {}); });

  StudyDb.onStatus((status) => {
    state.saveStatus = status;
    const pill = document.querySelector(".save-pill");
    if (pill) {
      pill.className = `save-pill ${status.state}`;
      pill.querySelector("span:last-child").textContent = `${status.message}${status.lastSavedAt ? ` · ${formatDate(status.lastSavedAt)}` : ""}`;
    }
  });

  StudyDb.init().then(() => {
    state.activeExam = StudyDb.getActiveExam();
    if (!state.activeExam && initialReadingPosition) {
      applyReadingPositionState(initialReadingPosition);
      render();
      restoreReadingPosition(initialReadingPosition);
    } else render();
  }).catch((error) => {
    console.error(error);
    app.innerHTML = `<div class="loading-screen"><div><strong>初始化失败</strong><p>${escapeHtml(error.message)}</p><p>请使用桌面版 Chrome 打开，并确认 vendor/sql-wasm.js 文件完整。</p></div></div>`;
  });
})();
