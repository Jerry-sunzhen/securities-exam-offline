(function () {
  const outlineData = window.OUTLINE_DATA || { meta: {}, toc: [], pages: [], supplements: [] };
  const questionData = window.QUESTION_DATA || { meta: {}, subjects: [], chapters: [], knowledgePoints: [], questions: [] };
  const questionMap = new Map((questionData.questions || []).map((question) => [question.id, question]));
  const STEM_MARKERS = "ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ①②③④⑤⑥⑦⑧⑨⑩";
  const STEM_MARKER_GLOBAL = new RegExp(`[${STEM_MARKERS}]`, "g");
  const STEM_STATEMENT_PATTERN = new RegExp(`^[（(]?([${STEM_MARKERS}])[)）]?[\\s.、,，:：]*([\\s\\S]+)$`);
  const STEM_COMBO_PATTERN = new RegExp(`^[\\s${STEM_MARKERS}.、,，．。]+$`);
  // 历年题的考频索引：只统计已核验可练的导入题，按知识点归集年份与题量。
  const examFrequencyMap = (() => {
    const map = new Map();
    for (const question of questionData.questions || []) {
      const knowledgeId = question.knowledgeLinks?.[0]?.knowledgeId;
      if (question.verificationStatus !== "source_transcribed" || question.examEligible === false || !knowledgeId) continue;
      const entry = map.get(knowledgeId) || { count: 0, years: new Set(), questions: [] };
      entry.count += 1;
      for (const year of question.repeatYears || []) {
        const parsed = Number(year);
        if (parsed) entry.years.add(parsed);
      }
      entry.questions.push(question);
      map.set(knowledgeId, entry);
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
    dashboard: ["学习总览", "从三色笔记讲义、练习和模考逐步建立完整知识框架"],
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
    practiceCount: 30,
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
            <strong>${escapeHtml(questionData.meta?.knowledgePointCount || (questionData.knowledgePoints || []).length)} 个笔记知识点</strong>
            ${escapeHtml(questionData.meta?.questionCount || questionData.questions.length)} 道题 · ${escapeHtml(questionData.meta?.eligibleQuestionCount || questionData.questions.length)} 道可练<br />
            ${escapeHtml(questionData.meta?.caseGroupCount || 0)} 组综合案例 · ${escapeHtml(questionData.meta?.caseQuestionCount || 0)} 问<br />
            每道题绑定复习资料页码<br />
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
    const answeredKnowledgeIds = new Set(StudyDb.getAttemptRows().map((attempt) => questionMap.get(attempt.question_id)?.knowledgeLinks?.[0]?.knowledgeId).filter(Boolean));
    const knowledgeTotal = questionData.meta?.knowledgePointCount || (questionData.knowledgePoints || []).length;
    const factCoverage = knowledgeTotal ? Math.round(answeredKnowledgeIds.size * 100 / knowledgeTotal) : 0;
    const subjects = questionData.subjects || [];
    return `
      <div class="grid">
        <section class="card hero-card">
          <h3>先过一遍笔记要点，再用真题检验</h3>
          <p>讲义按 2026 新大纲三色笔记的原文整理。答完题可以跳到对应笔记页和教材参考页核对原文；时间紧时优先刷带「★ 多年考点」标记的题。</p>
          <div class="hero-actions">
            <button class="button secondary" data-nav="outline">开始阅读知识讲义</button>
            <button class="button" data-action="quick-practice">随机练习 30 题</button>
            <button class="button ghost" data-action="start-exam">120 题限时模考</button>
            ${state.activeExam ? '<button class="button secondary" data-action="resume-exam">恢复未完成模考</button>' : ""}
          </div>
        </section>
        <div class="grid cards-4">
          <section class="card card-body"><div class="metric-label">累计作答</div><div class="metric-value">${stats.total}</div><div class="metric-detail">包含重复练习</div></section>
          <section class="card card-body"><div class="metric-label">综合正确率</div><div class="metric-value">${stats.accuracy}%</div><div class="progress"><span style="width:${stats.accuracy}%"></span></div></section>
          <section class="card card-body"><div class="metric-label">知识点覆盖</div><div class="metric-value">${factCoverage}%</div><div class="metric-detail">${answeredKnowledgeIds.size} / ${knowledgeTotal} 个 · 题型 ${questionCoverage}%</div></section>
          <section class="card card-body"><div class="metric-label">当前错题</div><div class="metric-value">${stats.wrongUnique}</div><div class="metric-detail">模拟考试 ${stats.exams} 次</div></section>
        </div>
        <div class="grid two">
          <section class="card card-body">
            <h3 class="card-title">按科目开始 <span class="metric-label">（历年整理题去重）</span></h3>
            <div class="quick-list">
              ${subjects.map((subject) => {
                const count = questionData.questions.filter((q) => q.subjectId === subject.id && q.examEligible !== false).length;
                return `<div class="quick-item"><div><strong>${escapeHtml(subject.title)}</strong><br /><span>${count} 道题 · ${subject.chapterCount} 章</span></div><button class="button small" data-action="practice-subject" data-subject="${subject.id}">开始练习</button></div>`;
              }).join("")}
            </div>
          </section>
          <section class="card card-body">
            <h3 class="card-title">本版本说明</h3>
            <div class="notice">讲义与题目都来自本地内部资料：讲义为 2026 新大纲三色笔记原文，第一版自拟内容已全部移除。题库由本地历年试题整理资料迁移而来，共 ${questionData.meta?.importedQuestionCount || 0} 道（去重后），其中 ${questionData.meta?.eligibleQuestionCount || 0} 道进入练习与模考；待核验题不会进入默认练习。每道题都绑定到具体笔记页码，答完题可以在解析区直接打开对应页。原资料解析过短的题目，会由本地三色笔记与教材原文辅助补写逐项解析并标注「AI 补充」，原解析仍可在解析区展开对比。多选题采用“全部选对才得分”的本地规则。</div>
            <div class="profile-status">
              <div class="status-row"><span>讲义来源</span><strong>2026 新大纲三色笔记</strong></div>
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
      ...(point.points || []),
      ...(point.bookLinks || []).map((link) => link.sourceTitle || link.sourceLabel || "")
    ].join("\n");
    return sourceText.includes(query);
  }

  function renderKnowledgePoint(point, query) {
    const frequency = examFrequencyMap.get(point.id);
    const links = point.bookLinks || [];
    const sourceItems = links.map((link) => {
      const badge = link.kind === "notes"
        ? '<span class="tag binding-verified">三色笔记</span>'
        : '<span class="tag binding-suggested">教材参考</span>';
      const page = escapeHtml(String(link.page));
      const title = escapeHtml(link.sourceTitle || link.sourceLabel || "复习资料");
      const quote = link.quote
        ? `<details class="binding-quote"><summary>查看原文</summary><blockquote>${escapeHtml(link.quote.slice(0, 320))}${link.quote.length > 320 ? "…" : ""}</blockquote></details>`
        : "";
      return `<li><div class="binding-head">${badge}<strong>${title}</strong><span class="binding-page">第 ${page} 页</span></div><a href="${escapeHtml(link.localPath)}#page-${page}" target="_blank">打开第 ${page} 页</a>${quote}</li>`;
    }).join("");
    const frequencyBlock = frequency
      ? `<details class="knowledge-exam-frequency"${frequency.multiYear ? " open" : ""}><summary>关联历年真题 ${frequency.count} 道${frequency.multiYear ? ` · 覆盖 ${frequency.years.join(" / ")} 年` : frequency.years.length ? ` · ${frequency.years[0]} 年` : ""}</summary><ul>${frequency.questions.slice(0, 8).map((item) => `<li><span class="exam-year">${escapeHtml(String(item.year || "—"))}</span>${highlightText(normalizeExamText(item.stem).split("\n")[0], query)}${item.repeatLabel ? `<span class="exam-repeat">${escapeHtml(item.repeatLabel)}</span>` : ""}</li>`).join("")}</ul>${frequency.questions.length > 8 ? `<p class="knowledge-panel-note">另有 ${frequency.questions.length - 8} 道同知识点真题，可在练习页继续刷。</p>` : ""}<button class="button secondary small" data-action="practice-knowledge" data-knowledge="${escapeHtml(point.id)}">刷这个知识点的真题</button></details>`
      : '<p class="knowledge-panel-note">当前题库里还没有归到这条知识点的真题，可直接读原文。</p>';
    return `<article class="card knowledge-card" id="knowledge-${point.id}">
      <header class="knowledge-card-header">
        <div><span class="knowledge-index">笔记第 ${escapeHtml(String(point.page))}${point.pageEnd && point.pageEnd !== point.page ? `–${escapeHtml(String(point.pageEnd))}` : ""} 页</span><h3>${highlightText(point.topic, query)}</h3></div>
        <div class="knowledge-card-tags"><span class="tag source-tag verified">三色笔记原文</span>${frequency ? `<span class="tag exam-tag">历年 ${frequency.count} 题</span>` : ""}${frequency?.multiYear ? `<span class="tag repeat-tag">★ 多年考点 · ${frequency.years.join(" / ")}</span>` : ""}</div>
      </header>
      <ul class="knowledge-points">${(point.points || []).map((item) => `<li>${highlightText(item, query)}</li>`).join("")}</ul>
      <div class="imported-links"><strong>材料出处</strong><ul>${sourceItems}</ul><small>讲义按 2026 新大纲三色笔记的「知识点」原文整理；教材页由文本相似度自动定位，仅供补充核对。</small></div>
      ${frequencyBlock}
    </article>`;
  }

  function renderKnowledgeGuide(query) {
    const points = (questionData.knowledgePoints || []).filter((point) => point.subjectId === state.knowledgeSubject && knowledgeMatches(point, query) && (!state.multiYearOnly || examFrequencyMap.get(point.id)?.multiYear));
    const examTotal = points.reduce((total, point) => total + (examFrequencyMap.get(point.id)?.count || 0), 0);
    const pointsWithExams = points.filter((point) => examFrequencyMap.has(point.id)).length;
    const multiYearPoints = points.filter((point) => examFrequencyMap.get(point.id)?.multiYear).length;
    const notesBoundCount = points.filter((point) => (point.bookLinks || []).some((link) => link.kind === "notes")).length;
    const textbookBoundCount = points.filter((point) => (point.bookLinks || []).some((link) => link.kind === "textbook")).length;
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
          <div class="card knowledge-intro"><strong>讲义内容全部来自 2026 新大纲三色笔记，题目来自历年试题整理资料。</strong><span>已关联 ${examTotal} 道历年真题，覆盖 ${pointsWithExams} 个知识点，其中 ${multiYearPoints} 个属于两年以上重复考点。</span><span>当前 ${points.length} 个知识点全部按笔记原文整理：${notesBoundCount} 个带三色笔记页码，${textbookBoundCount} 个另有教材参考页（自动定位，仅供补充核对）。</span>${state.knowledgeSubject === "finance" ? '<span>教材参考页来自《金融市场基础知识》（2025 统编教材）本地识别文本，扫描件可能存在同形字与标点误差。<a href="./docs/base-knowledge.html" target="_blank">打开教材全文</a></span>' : '<span>教材参考页来自《证券市场基本法律法规》（2020 商业备考教材），它是历史辅助教材，涉及法条、期限、比例和处罚时必须核对最新官方文本。<a href="./docs/law-regulations.html" target="_blank">打开历史教材全文</a></span>'}</div>
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
    const notes = (point.bookLinks || []).filter((link) => link.kind === "notes");
    const sourceNote = notes.length
      ? `本条来自 ${escapeHtml(notes[0].sourceTitle || "三色笔记")} 第 ${notes[0].page} 页；识别文字可能有误，可打开原文核对。`
      : "本条暂无原文出处。";
    return `<div class="memory-answer">
      <ul class="knowledge-points">${(point.points || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      <div class="memory-source-note verified">${sourceNote}</div>
      ${notes.length ? `<a class="button secondary small" href="${escapeHtml(notes[0].localPath)}#page-${notes[0].page}" target="_blank">打开笔记第 ${notes[0].page} 页</a>` : ""}
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
        <div class="question-tags"><span class="tag">三色笔记</span><span class="tag">第 ${escapeHtml(String(point.page))} 页</span></div>
        <p class="memory-eyebrow">先遮住答案，用自己的话回答</p>
        <h2>${escapeHtml(point.topic)}</h2>
        <div class="memory-prompt">请先复述这条知识点的要点，再展开对照笔记原文。</div>
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
    // 综合材料题全库只有 19~21 道，材料专项沿用小题量档位；常规练习是 30/60/120。
    const countChoices = caseOnly ? [8, 16, 24, 32, 40] : [30, 60, 120];
    const matchesPracticeFilter = (question) => question.subjectId === state.practiceSubject &&
      (state.practiceChapter === "all" || question.chapterId === state.practiceChapter) &&
      state.practiceTypes.has(question.type);
    const matching = questionData.questions.filter(matchesPracticeFilter);
    const available = matching.length;
    const { attempted } = questionHistory();
    const availableUnseen = matching.filter((question) => !attempted.has(question.id)).length;
    // 全部章节按官方卷题型比例出题，这里先把分配结果告诉用户。
    const paperPlan = practiceUsesPaperMix() ? ExamBank.paperMix(state.practiceCount, state.practiceTypes) : [];
    const paperMixNote = paperPlan.length > 1
      ? `本题组按模拟卷题型比例分配：${paperPlan.map((item) => `${typeLabel(item.type)} ${item.count} 题`).join(" · ")}。`
      : "";
    const scoringNote = "计分方式：单选 0.5 分，多选、判断、综合每题 1 分。";
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
            <div class="notice">当前条件共有 ${available} 道可用题，其中 ${availableUnseen} 道还没做过。${caseOnly && state.practiceChapter === "all" ? "综合材料专项按完整材料出题，同一段材料下的小问会连续作答，并优先出没做过的材料。" : "抽题顺序为没做过 → 做错过 → 已做对，同一档内随机；答完即时显示答案、解析和笔记/教材出处。"}${paperMixNote ? ` ${paperMixNote}` : ""} ${scoringNote}</div>
            <div class="action-group"><button class="button" data-action="start-practice" ${available ? "" : "disabled"}>开始章节练习</button><button class="button secondary" data-action="start-case-practice">综合案例专项 · 按材料出题</button></div>
          </div>
        </section>
        <section class="card card-body">
          <h3 class="card-title">模拟考试</h3>
          <p class="prose-muted">按照公开题型生成 120 题、120 分钟的本地模拟卷：40 单选、40 多选、30 判断和 10 道材料题，题干去重。考试中不即时显示解析，交卷后统一查看成绩与错题。</p>
          <div class="quick-list">
            ${questionData.subjects.map((subject) => `<div class="quick-item"><div><strong>${escapeHtml(subject.title)}</strong><br /><span>120 题 · 120 分钟 · 40 单选 / 40 多选 / 30 判断 / 10 材料题</span></div><button class="button small" data-action="start-exam-subject" data-subject="${subject.id}">开始模考</button></div>`).join("")}
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
        ${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>题目</th><th>科目</th><th>章节</th><th>题型</th></tr></thead><tbody>${items.map((q) => `<tr><td>${escapeHtml(normalizeExamText(q.stem).replace(/\n/g, " ")).slice(0,90)}${q.stem.length > 90 ? "…" : ""}</td><td>${escapeHtml(subjectTitle(q.subjectId))}</td><td>${escapeHtml(chapterTitle(q.chapterId))}</td><td>${typeLabel(q.type)}</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty"><strong>这里还是空的</strong>答错或收藏的题目会自动出现在这里。</div>'}
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
          <p class="content-note">本工具仅供个人非商业学习。内置大纲原件、统编教材与备考笔记版权归原发布机构；题目来自本地历年试题整理资料，答案按原资料保存；解析除原资料内容外，还包含依据本地三色笔记与教材原文辅助补写并标注「AI 补充」的部分，均不宣称官方题库或真题。</p>
        </section>
      </div>`;
  }

  // 章节练习的抽题顺序：没做过 → 做过且最近做错 → 做过且最近做对。
  function questionHistory() {
    const attempted = new Set();
    for (const row of StudyDb.getAttemptRows()) attempted.add(row.question_id);
    return { attempted, wrong: new Set(StudyDb.getWrongQuestionIds()) };
  }

  function questionTier(question, history) {
    if (!history.attempted.has(question.id)) return 0;
    return history.wrong.has(question.id) ? 1 : 2;
  }

  function prioritizeQuestions(pool, history) {
    const tiers = [[], [], []];
    for (const question of pool) tiers[questionTier(question, history)].push(question);
    return tiers.flatMap((tier) => shuffle(tier));
  }

  function prioritizeGroups(groups, history) {
    const buckets = new Map();
    for (const group of groups) {
      const tier = Math.min(...group.map((question) => questionTier(question, history)));
      if (!buckets.has(tier)) buckets.set(tier, []);
      buckets.get(tier).push(group);
    }
    return [...buckets.keys()].sort((left, right) => left - right).flatMap((tier) => shuffle(buckets.get(tier)));
  }

  // 综合材料题按整段材料出题：同一段材料下的小问保持连续。
  function selectCaseQuestions(pool, count, history) {
    const importedCaseSelection = ExamBank.selectCases(pool, count, history ? (question) => questionTier(question, history) : null);
    if (importedCaseSelection.length) return importedCaseSelection;
    const groups = new Map();
    for (const question of pool) {
      const key = question.caseGroupId || question.id;
      const list = groups.get(key) || [];
      list.push(question); groups.set(key, list);
    }
    const rawGroups = [...groups.values()];
    const orderedGroups = (history ? prioritizeGroups(rawGroups, history) : shuffle(rawGroups)).map((group) => group.sort((left, right) => (left.caseOrder || 1) - (right.caseOrder || 1)));
    const result = [];
    for (const group of orderedGroups) {
      if (result.length + group.length > count) continue;
      result.push(...group);
      if (result.length === count) break;
    }
    return result.length ? result : orderedGroups.flat().slice(0, Math.min(count, pool.length));
  }

  // 全部章节练习按本工具模拟卷的题型比例出题（单选 40 / 多选 40 / 判断 30 / 综合 10 折算），
  // 每个题型内部仍然按没做过 → 做错过 → 已做对的优先级抽题。
  function selectPaperPractice(pool, plan, count, history) {
    const selected = [];
    const used = new Set();
    const seenStems = new Set();
    const take = (question) => {
      if (!question || used.has(question.id)) return false;
      if (question.type !== "case") {
        const key = ExamBank.normalizedStem(question);
        if (seenStems.has(key)) return false;
        seenStems.add(key);
      }
      used.add(question.id);
      selected.push(question);
      return true;
    };
    for (const item of plan) {
      if (item.type === "case") {
        for (const question of selectCaseQuestions(pool.filter((question) => question.type === "case"), item.count, history)) take(question);
        continue;
      }
      const typed = pool.filter((question) => question.type === item.type);
      const ordered = history ? prioritizeQuestions(typed, history) : shuffle(typed);
      let taken = 0;
      for (const question of ordered) {
        if (taken >= item.count) break;
        if (take(question)) taken += 1;
      }
    }
    // 某个题型题量不足（例如综合材料凑不满整段）时，用普通题按同样顺序补足总题量。
    if (selected.length < count) {
      const backfill = pool.filter((question) => question.type !== "case");
      for (const question of (history ? prioritizeQuestions(backfill, history) : shuffle(backfill))) {
        if (take(question) && selected.length >= count) break;
      }
    }
    return selected.slice(0, count);
  }

  // 全部章节练习与模考共用同一套结构：题型比例 + 单选 0.5 分、其余每题 1 分的计分。
  function practiceUsesPaperMix() {
    if (state.practiceChapter !== "all") return false;
    if (state.practiceTypes.size === 1 && state.practiceTypes.has("case")) return false;
    return ExamBank.paperMix(state.practiceCount, state.practiceTypes).length > 1;
  }

  function selectQuestions({ subjectId, chapterId = "all", count = 30, types = null, ids = null }) {
    let pool = ids ? ids.map((id) => questionMap.get(id)).filter((question) => question && question.examEligible !== false) : questionData.questions.filter((question) => {
      return (!subjectId || question.subjectId === subjectId) &&
        (chapterId === "all" || question.chapterId === chapterId) &&
        (!types || types.has(question.type)) && question.examEligible !== false;
    });
    // 练习本列表来自用户自己的错题/收藏，保持随机即可；按条件抽题时优先出没做过的题。
    const history = ids ? null : questionHistory();
    if (types?.size === 1 && types.has("case")) return selectCaseQuestions(pool, count, history);
    if (!ids && chapterId === "all") {
      const plan = ExamBank.paperMix(count, types);
      if (plan.length > 1) return selectPaperPractice(pool, plan, count, history);
    }
    const ordered = history ? prioritizeQuestions(pool, history) : shuffle(pool);
    // 错题本/收藏按用户自己的列表原样出题，不在这里去重。
    if (ids) return ordered.slice(0, Math.min(count, pool.length));
    // 同一组练习里同一题干只出一道：题库里存在同一道题在不同年份试卷重复出现的情况。
    return ExamBank.uniqByStem(ordered, Math.min(count, pool.length));
  }

  function selectExamQuestions(subjectId) {
    return ExamBank.selectExam(questionData.questions, subjectId);
  }

  // 练习不计入成绩，但同样按"120 题 / 120 分钟"的配速给出建议用时。
  function sessionBudgetSeconds(mode, questionCount) {
    if (mode === "exam") return 120 * 60;
    if (mode === "practice") return Math.max(1, questionCount) * 60;
    return null;
  }

  // 练习与模考共用同一套计分：单选 0.5 分，多选、判断、综合每题 1 分。
  // "legacy" 只用于旧档案里按每题 1 分记录的历史模考。
  function startSession({ mode, questions, subjectId = null, seconds = null, scoringScheme = "paper-100-v1" }) {
    if (!questions.length) return toast("没有符合条件的题目", "error");
    const id = crypto.randomUUID();
    const budget = seconds ?? sessionBudgetSeconds(mode, questions.length);
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
      budgetSeconds: budget,
      remainingSeconds: budget,
      deadlineAt: budget ? Date.now() + budget * 1000 : null,
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
    const session = state.session;
    if (!session || session.finished || !session.deadlineAt) return;
    if (session.mode !== "exam" && session.mode !== "practice") return;
    state.sessionTimer = setInterval(() => {
      const active = state.session;
      if (!active || active.finished || !active.deadlineAt) return clearInterval(state.sessionTimer);
      active.remainingSeconds = Math.ceil((active.deadlineAt - Date.now()) / 1000);
      const timer = document.getElementById("session-timer");
      if (timer) {
        const tone = timerTone(active);
        timer.textContent = timerLabel(active);
        timer.classList.toggle("warning", tone === "warning");
        timer.classList.toggle("overtime", tone === "overtime");
      }
      // 只有模考到点自动交卷；练习超时继续计时，方便看完解析。
      if (active.mode === "exam" && active.remainingSeconds <= 0) finishExam().catch((error) => toast(error.message, "error"));
    }, 1000);
  }

  function formatSeconds(seconds) {
    const safe = Math.max(0, Number(seconds || 0));
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const s = safe % 60;
    return [h, m, s].map((value) => String(value).padStart(2, "0")).join(":");
  }

  // 练习计时只做配速参考：按"120 题 / 120 分钟"换算成每题 1 分钟。
  function timerLabel(session) {
    const remaining = Number(session.remainingSeconds || 0);
    if (session.mode === "exam") return formatSeconds(remaining);
    return remaining > 0 ? `建议用时 ${formatSeconds(remaining)}` : `超时 ${formatSeconds(-remaining)}`;
  }

  function timerTone(session) {
    const remaining = Number(session.remainingSeconds || 0);
    if (session.mode === "exam") return remaining < 600 ? "warning" : "";
    if (remaining <= 0) return "overtime";
    return remaining < 60 ? "warning" : "";
  }

  function renderSession() {
    const session = state.session;
    if (session.finished) return session.mode === "exam" ? renderExamResult(session) : renderPracticeResult(session);
    const question = session.questions[session.index];
    const selected = new Set(session.answers[question.id] || []);
    const submitted = Boolean(session.submitted[question.id]);
    const correct = sameAnswer(selected, new Set(question.correctOptionIds));
    const type = typeLabel(question.type);
    const isMultiple = ExamBank.multiple(question);
    return `
      <main class="main session-shell">
        <div class="session-header">
          <div><button class="button secondary small" data-action="exit-session">退出</button> <span class="session-meta">${session.mode === "exam" ? "模拟考试" : session.mode === "review" ? (session.reviewKind === "practice" ? "练习复盘" : "模考复盘") : "章节练习"} · 第 ${session.index + 1}/${session.questions.length} 题${session.mode === "practice" ? ` · 已完成 ${Object.keys(session.submitted).length} 题` : ""}</span></div>
          ${session.deadlineAt ? `<div id="session-timer" class="timer ${timerTone(session)}">${timerLabel(session)}</div>` : `<div class="session-meta">已完成 ${Object.keys(session.submitted).length} 题</div>`}
        </div>
        <div class="progress session-progress"><span style="width:${Math.round((session.index + 1) * 100 / session.questions.length)}%"></span></div>
        <section class="card question-card">
          <div class="question-tags">
            <span class="tag">${type}</span>
            <span class="tag">${escapeHtml(subjectTitle(question.subjectId))}</span>
            <span class="tag">${escapeHtml(chapterTitle(question.chapterId))}</span>
            ${question.sourceKind === "mock" ? '<span class="tag exam-mock">机构模拟题</span>' : '<span class="tag exam-origin">历年整理题</span>'}
            ${question.repeatLabel ? `<span class="tag repeat-tag">★ ${escapeHtml(question.repeatLabel)}</span>` : ""}
            ${question.negation ? '<span class="tag negative">注意否定表述</span>' : ""}
          </div>
          ${question.caseMaterial ? `<div class="case-material"><strong>综合案例 · ${escapeHtml(question.caseGroupTitle || "材料题")} · 第 ${question.caseOrder || 1}/${question.caseGroupSize || 1} 问</strong><p>${escapeHtml(question.caseMaterial)}</p></div>` : ""}
          <div class="question-stem">${renderStem(question.stem)}</div>
          <div class="options${compactOptions(question) ? " compact" : ""}" ${isMultiple ? 'role="group" aria-label="多选题选项"' : 'role="radiogroup" aria-label="单选题选项"'}>
            ${renderOptions(question, selected, submitted, isMultiple)}
          </div>
          <div class="question-actions">
            <div class="action-group">
              <button class="button secondary" data-action="prev-question" ${session.index === 0 ? "disabled" : ""}>上一题</button>
              <button class="button ghost" data-action="bookmark-question">${StudyDb.isBookmarked(question.id) ? "取消收藏" : "收藏"}</button>
            </div>
            <div class="action-group">
              ${session.mode === "practice" && !submitted ? `<button class="button" data-action="submit-question" ${selected.size ? "" : "disabled"}>提交答案</button>` : ""}
              ${session.mode === "exam" ? `<button class="button" data-action="next-question">${session.index === session.questions.length - 1 ? "交卷" : "下一题"}</button>` : submitted ? `<button class="button" data-action="next-question">${session.index === session.questions.length - 1 ? (session.mode === "review" ? "结束复盘" : "完成练习") : "下一题"}</button>` : ""}
            </div>
          </div>
          ${submitted ? renderExplanation(question, correct) : ""}
          ${isMultiple && !submitted ? '<div class="metric-detail mt-3">多选题可选择多个选项，全部选对才判定正确。</div>' : ""}
        </section>
      </main>`;
  }

  // 历年题来自扫描件识别文本，句读常被识别成半角句点：中文之间的“.”按顿号还原。
  function normalizeExamText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/([\u4e00-\u9fff])\.(?=[\u4e00-\u9fff])/g, "$1、")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+$/gm, "")
      .trim();
  }

  function splitStemLines(text) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length !== 1) return lines;
    // 单行题干中出现顺序排列的 Ⅰ/Ⅱ/Ⅲ 或 ①/②/③ 分项时，按标记拆行。
    const markers = [...lines[0].matchAll(STEM_MARKER_GLOBAL)];
    if (markers.length < 2) return lines;
    const ascending = markers.every((marker, index) => index === 0 || STEM_MARKERS.indexOf(marker[0]) > STEM_MARKERS.indexOf(markers[index - 1][0]));
    if (!ascending) return lines;
    const first = lines[0].slice(0, markers[0].index).trim();
    return [first, ...markers.map((marker, index) => lines[0].slice(marker.index, index + 1 < markers.length ? markers[index + 1].index : lines[0].length).trim())].filter(Boolean);
  }

  // 识别文本常在句中断行：中文直接续接，英文与数字之间补空格。
  function joinStemText(previous, next) {
    if (!previous) return next;
    const needsSpace = /[A-Za-z0-9]/.test(previous.slice(-1)) && /[A-Za-z0-9]/.test(next.slice(0, 1));
    return needsSpace ? `${previous} ${next}` : previous + next;
  }

  function parseStem(rawStem) {
    const lines = splitStemLines(normalizeExamText(rawStem));
    let lead = "";
    const statements = [];
    for (const line of lines) {
      const match = line.match(STEM_STATEMENT_PATTERN);
      if (match) statements.push({ key: match[1], text: match[2].trim() });
      else if (statements.length) statements[statements.length - 1].text = joinStemText(statements[statements.length - 1].text, line);
      else lead = joinStemText(lead, line);
    }
    return { lead, statements };
  }

  function renderStemText(text) {
    let safe = escapeHtml(text);
    for (const word of ["不正确", "错误", "不属于", "不得", "不包括"]) {
      safe = safe.replaceAll(word, `<span class="stem-negation">${word}</span>`);
    }
    return safe;
  }

  function renderStem(stem) {
    const { lead, statements } = parseStem(stem);
    const leadHtml = lead ? `<p class="stem-lead">${renderStemText(lead)}</p>` : "";
    if (!statements.length) return leadHtml || `<p class="stem-lead">${renderStemText(normalizeExamText(stem))}</p>`;
    const listHtml = statements.map((statement) => `<li><span class="stem-key">${escapeHtml(statement.key)}</span><span class="stem-text">${renderStemText(statement.text)}</span></li>`).join("");
    return `${leadHtml}<ul class="stem-statements">${listHtml}</ul>`;
  }

  // 组合选择题的选项就是 Ⅰ/Ⅱ/Ⅲ 的排列，用顿号统一显示并排成两列。
  function formatOptionText(text) {
    if (!STEM_COMBO_PATTERN.test(text || "")) return normalizeExamText(text);
    const keys = String(text).match(STEM_MARKER_GLOBAL) || [];
    return keys.join("、");
  }

  // 单选画 radio、多选画 checkbox，选项前的图标同时承担勾选状态与判卷结果的提示。
  function optionIcon({ multiple, chosen, submitted, isRight }) {
    const shape = multiple
      ? '<rect x="2.6" y="2.6" width="12.8" height="12.8" rx="3.6" />'
      : '<circle cx="9" cy="9" r="6.4" />';
    let mark = "";
    if (submitted && isRight) mark = '<path d="M5.6 9.3l2.4 2.4 4.6-5" />';
    else if (submitted && chosen) mark = '<path d="M6.3 6.3l5.4 5.4M11.7 6.3l-5.4 5.4" />';
    else if (chosen && multiple) mark = '<path d="M5.6 9.3l2.4 2.4 4.6-5" />';
    else if (chosen) mark = '<circle cx="9" cy="9" r="3.1" fill="currentColor" stroke="none" />';
    return `<svg class="option-icon-svg" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}${mark}</svg>`;
  }

  function optionIconClass({ multiple, chosen, submitted, isRight }) {
    const classes = ["option-icon", multiple ? "checkbox" : "radio"];
    if (chosen) classes.push("chosen");
    if (submitted && isRight) classes.push("correct");
    if (submitted && chosen && !isRight) classes.push("incorrect");
    return classes.join(" ");
  }

  function renderOptions(question, selected, submitted, isMultiple) {
    return question.options.map((option, index) => {
      const chosen = selected.has(option.id);
      const isRight = question.correctOptionIds.includes(option.id);
      let optionClass = chosen ? "selected" : "";
      if (submitted) optionClass += isRight ? " correct" : (chosen ? " incorrect" : "");
      const state = { multiple: isMultiple, chosen, submitted, isRight };
      return `<label class="option ${optionClass}">
        <input class="option-input" type="${isMultiple ? "checkbox" : "radio"}" name="question-${question.id}" value="${option.id}" data-action="choose-option" data-option="${option.id}" ${chosen ? "checked" : ""} ${submitted ? "disabled" : ""} />
        <span class="${optionIconClass(state)}">${optionIcon(state)}</span>
        <span class="option-key">${String.fromCharCode(65 + index)}</span>
        <span class="option-text">${escapeHtml(formatOptionText(option.text))}</span>
      </label>`;
    }).join("");
  }

  // 选项本身很短（年份、金额、Ⅰ/Ⅱ 组合等）时排成两列，避免一道题占满整屏。
  function compactOptions(question) {
    if (question.options.length < 2) return false;
    return question.options.every((option) => {
      const text = formatOptionText(option.text);
      return text.length > 0 && text.length <= 10 && !text.includes("\n");
    });
  }

  function renderExplanation(question, correct) {
    const enriched = question.explanationSource === "local-materials-ai";
    const sourceExplanation = String(question.sourceExplanation || "").trim();
    return `
      <div class="explanation">
        <div class="result-banner ${correct ? "correct" : "incorrect"}">${correct ? "回答正确" : `回答错误，正确答案：${question.correctOptionIds.join("、")}`}</div>
        <h4>解析${enriched ? ' <span class="tag binding-suggested">AI 补充</span>' : ""}</h4><p>${escapeHtml(question.explanation)}</p>
        ${enriched && sourceExplanation ? `<details class="binding-quote"><summary>查看原资料解析（未改写）</summary><blockquote>${escapeHtml(sourceExplanation)}</blockquote></details>` : ""}
        ${question.optionExplanations ? `<h4>选项说明</h4>${question.options.map((option) => `<p><strong>${option.id}：</strong>${escapeHtml(question.optionExplanations[option.id] || "")}</p>`).join("")}` : ""}
        <h4>答案出处与核验说明</h4>
        ${renderAnswerStatus(question)}${renderImportedLinks(question)}
        <h4>个人笔记</h4>
        <textarea class="textarea" id="question-note" placeholder="记录自己的理解、易错点或记忆方法……">${escapeHtml(StudyDb.getNote(question.id))}</textarea>
        <button class="button small mt-2-safe" data-action="save-note">保存笔记</button>
      </div>`;
  }

  function renderImportedLinks(question) {
    const links = question?.bookLinks || [];
    const points = question?.knowledgeLinks || [];
    if (!links.length && !points.length) return "";
    const items = links.map((link) => {
      const page = escapeHtml(String(link.page));
      const title = escapeHtml(link.sourceTitle || link.sourceLabel || "复习资料");
      const badge = link.reviewStatus === "verified"
        ? '<span class="tag binding-verified">教材定位</span>'
        : '<span class="tag binding-suggested">自动匹配</span>';
      const cross = link.crossSubject ? '<span class="tag binding-cross">另一科笔记</span>' : "";
      const open = link.localPath ? `<a href="${escapeHtml(link.localPath)}#page-${page}" target="_blank">打开第 ${page} 页</a>` : "";
      const quote = link.quote ? `<details class="binding-quote"><summary>查看匹配原文</summary><blockquote>${escapeHtml(link.quote.slice(0, 300))}${link.quote.length > 300 ? "…" : ""}</blockquote></details>` : "";
      return `<li><div class="binding-head"><strong>${title}</strong><span class="binding-page">第 ${page} 页</span>${badge}${cross}</div>${open}${quote}</li>`;
    }).join("");
    const pointsHtml = points.length ? `<li class="binding-points"><div class="binding-head"><strong>关联知识点</strong></div><div class="binding-point-list">${points.map((link) => `<span>${escapeHtml(link.topic)}</span>`).join("")}</div></li>` : "";
    return `<div class="imported-links"><strong>教材与笔记出处</strong><ul>${items}${pointsHtml}</ul><small>每道题都会绑定到可回查的复习资料页码，点开即可核对原文；「教材定位」指按知识点在教材中的页码摘录原文，「自动匹配」由文本相似度给出。两者都只用于定位复习，不代表答案经官方核对。</small></div>`;
  }

  function renderAnswerStatus(question) {
    if (question?.explanationSource === "local-materials-ai") {
      return '<div class="source-status supplement"><strong>历年整理题 · 答案按原资料保存</strong><span>答案按原资料保存；原解析过短，本段解析由本地三色笔记与教材原文辅助补写，只有校验通过的题目才会替换，可能仍有个别表述偏差。原资料解析与可回查页码都在本页，涉及现行规则时以最新官方文本为准。</span></div>';
    }
    return '<div class="source-status supplement"><strong>历年整理题 · 答案按原资料保存</strong><span>题目来自本地历年试题整理资料，答案与解析按原资料保存；涉及现行规则时以最新官方文本为准。可回查的笔记与教材页码见下方「教材与笔记出处」。</span></div>';
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
      exitReview(); return;
    }
    if (session.mode === "practice" && session.index === session.questions.length - 1) {
      finishPractice(); return;
    }
    session.index = Math.min(session.index + 1, session.questions.length - 1);
    render();
  }

  // 练习不计成绩，但结束后给出当次看板：正确率、用时、章节与题型明细、错题清单。
  function finishPractice() {
    const session = state.session;
    if (!session || session.finished) return;
    clearInterval(state.sessionTimer);
    session.elapsedSeconds = Math.max(0, Math.round((Date.now() - session.startedAt) / 1000));
    session.finished = true;
    render();
  }

  function practiceResultStats(session) {
    const rows = (session?.questions || []).map((question) => {
      const selected = session.answers[question.id] || [];
      const correct = sameAnswer(new Set(selected), new Set(question.correctOptionIds));
      return { question, selected, answered: selected.length > 0, correct };
    });
    const answered = rows.filter((row) => row.answered);
    const correct = rows.filter((row) => row.correct);
    const wrong = rows.filter((row) => row.answered && !row.correct);
    return {
      rows, answered, correct, wrong,
      skipped: rows.filter((row) => !row.answered),
      rate: answered.length ? Math.round(correct.length * 100 / answered.length) : 0
    };
  }

  function formatDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.floor(total / 60);
    if (minutes >= 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
    return `${minutes} 分 ${total % 60} 秒`;
  }

  function groupedResultRows(rows, keyOf, labelOf, order) {
    const groups = new Map();
    for (const row of rows) {
      const key = keyOf(row.question);
      const current = groups.get(key) || { key, label: labelOf(key), total: 0, correct: 0 };
      current.total += 1;
      current.correct += row.correct ? 1 : 0;
      groups.set(key, current);
    }
    const list = [...groups.values()];
    if (order) list.sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key));
    else list.sort((left, right) => (left.correct / left.total) - (right.correct / right.total) || right.total - left.total);
    return list;
  }

  function renderResultTable(title, items, label) {
    return `<section class="card card-body"><h3 class="card-title">${escapeHtml(title)}</h3>${items.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>${escapeHtml(label)}</th><th>题量</th><th>正确</th><th>正确率</th></tr></thead><tbody>${items.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${item.total}</td><td>${item.correct}</td><td>${Math.round(item.correct * 100 / item.total)}%</td></tr>`).join("")}</tbody></table></div>` : '<div class="empty">本次没有可统计的作答。</div>'}</section>`;
  }

  // 按模拟卷结构生成的练习沿用模考计分，未作答按 0 分。
  function practicePoints(session) {
    let score = 0;
    let total = 0;
    for (const question of session.questions) {
      const points = ExamBank.points(question, session.scoringScheme);
      total += points;
      if (sameAnswer(new Set(session.answers[question.id] || []), new Set(question.correctOptionIds))) score += points;
    }
    return { score: Math.round(score * 10) / 10, total: Math.round(total * 10) / 10 };
  }

  function renderPracticeResult(session) {
    const stats = practiceResultStats(session);
    const points = session.scoringScheme === "paper-100-v1" ? practicePoints(session) : null;
    const elapsed = Number(session.elapsedSeconds || 0) || Math.round((Date.now() - session.startedAt) / 1000);
    const budget = Number(session.budgetSeconds || 0);
    const pace = budget
      ? (elapsed > budget ? `超出建议用时 ${formatDuration(elapsed - budget)}` : `比建议用时快 ${formatDuration(budget - elapsed)}`)
      : "本次没有建议用时";
    const chapters = groupedResultRows(stats.answered, (question) => question.chapterId, (id) => chapterTitle(id));
    const types = groupedResultRows(stats.answered, (question) => question.type, (type) => typeLabel(type), ["single", "multiple", "judgment", "case"]);
    return `<main class="main session-shell">
      <section class="card card-body practice-result">
        <span class="metric-label">本次章节练习</span>
        <div class="practice-result-head">
          <div class="practice-result-score-line"><strong class="practice-result-score">${stats.rate}%</strong><span class="practice-result-fraction">答对 ${stats.correct.length} / 已作答 ${stats.answered.length} 题</span></div>
          <div class="practice-result-pace"><strong>用时 ${formatDuration(elapsed)}</strong><span>${budget ? `建议用时 ${formatDuration(budget)} · ${pace}` : escapeHtml(pace)}</span></div>
          ${points ? `<div class="practice-result-points"><strong>得分 ${points.score} / ${points.total} 分</strong><span>计分方式：单选 0.5 分，其余每题 1 分，未作答按 0 分</span></div>` : ""}
        </div>
        <div class="practice-result-metrics">
          <div><strong>${stats.rows.length}</strong><span>本组题量</span></div>
          <div><strong>${stats.correct.length}</strong><span>答对</span></div>
          <div><strong>${stats.wrong.length}</strong><span>答错</span></div>
          <div><strong>${stats.skipped.length}</strong><span>未作答</span></div>
        </div>
        <div class="action-group mt-4-safe">
          <button class="button" data-action="retry-practice-all">重做本组 ${stats.rows.length} 题</button>
          <button class="button secondary" data-action="retry-practice-wrong" ${stats.wrong.length ? "" : "disabled"}>只重做 ${stats.wrong.length} 道错题</button>
          <button class="button secondary" data-action="review-practice-all">逐题看解析</button>
          <button class="button ghost" data-action="exit-session">返回总览</button>
        </div>
        <div class="notice">本次 ${stats.answered.length} 道作答已写入学习档案，学习统计会累计；正确率只按已作答的题计算。</div>
      </section>
      <div class="grid two mt-4-safe">
        ${renderResultTable("章节正确率", chapters, "章节")}
        ${renderResultTable("题型正确率", types, "题型")}
      </div>
      <section class="card card-body practice-result-wrong mt-4-safe">
        <h3 class="card-title">本次错题${stats.wrong.length ? `（${stats.wrong.length}）` : ""}</h3>
        ${stats.wrong.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>题目</th><th>章节</th><th>你的答案</th><th>正确答案</th></tr></thead><tbody>${stats.wrong.map((row) => `<tr><td>${escapeHtml(normalizeExamText(row.question.stem).replace(/\\n/g, " ")).slice(0, 70)}${row.question.stem.length > 70 ? "…" : ""}</td><td>${escapeHtml(chapterTitle(row.question.chapterId))}</td><td class="wrong-answer">${escapeHtml(row.selected.join("、") || "未作答")}</td><td class="right-answer">${escapeHtml(row.question.correctOptionIds.join("、"))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><strong>这组全部答对</strong>可以换一批题，或者回去背这一章的笔记要点。</div>`}
      </section>
    </main>`;
  }

  function beginPracticeReview(scope) {
    const previous = state.session;
    const stats = practiceResultStats(previous);
    const list = (scope === "wrong" ? stats.wrong : stats.rows).map((row) => row.question);
    if (!list.length) return toast(scope === "wrong" ? "本次没有错题" : "本次没有可查看的题目", "error");
    state.reviewReturn = previous;
    state.session = {
      ...previous,
      mode: "review",
      reviewKind: "practice",
      questions: list,
      index: 0,
      finished: false,
      submitted: Object.fromEntries(list.map((question) => [question.id, true])),
      remainingSeconds: null,
      deadlineAt: null
    };
    render();
  }

  function startPracticeFrom(questions, subjectId, scoringScheme = "paper-100-v1") {
    if (!questions.length) return toast("没有可练习的题目", "error");
    state.reviewReturn = null;
    startSession({ mode: "practice", questions: shuffle(questions), subjectId: subjectId || questions[0]?.subjectId || state.practiceSubject, scoringScheme });
  }

  function exitReview() {
    const back = state.reviewReturn || null;
    state.reviewReturn = null;
    if (back) { state.session = back; render(); return; }
    state.session = null; state.view = "stats"; render();
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
      reviewKind: "exam",
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
      const composition = {};
      for (const item of session.questions) composition[typeLabel(item.type)] = (composition[typeLabel(item.type)] || 0) + 1;
      Object.assign(context, {
        mode: session.mode,
        progress: `${session.index + 1}/${session.questions.length}`,
        total: session.questions.length,
        composition,
        scoringScheme: session.scoringScheme,
        totalPoints: session.totalPoints,
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
        context.memoryCard.points = (point.points || []).join("\n");
        context.memoryCard.sourcePage = point.page;
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
      if (action === "quick-practice") startSession({ mode: "practice", questions: selectQuestions({ count: 30 }) });
      if (action === "practice-subject") { captureReadingPosition(); state.practiceSubject = target.dataset.subject; state.practiceChapter = "all"; state.view = "practice"; render(); }
      if (action === "start-exam") startExam(state.practiceSubject || "finance");
      if (action === "resume-exam") resumeExam();
      if (action === "start-exam-subject") startExam(target.dataset.subject);
      if (action === "start-practice") startSession({ mode: "practice", questions: selectQuestions({ subjectId: state.practiceSubject, chapterId: state.practiceChapter, count: state.practiceCount, types: state.practiceTypes }), subjectId: state.practiceSubject });
      if (action === "start-case-practice") startSession({ mode: "practice", questions: selectQuestions({ subjectId: state.practiceSubject, chapterId: "all", count: 16, types: new Set(["case"]) }), subjectId: state.practiceSubject });
      if (action === "list-tab") { state.listTab = target.dataset.tab; render(); }
      if (action === "practice-list") startSession({ mode: "practice", questions: selectQuestions({ ids: getListQuestions().map((q) => q.id), count: getListQuestions().length }) });
      if (action === "toggle-multi-year") { state.multiYearOnly = !state.multiYearOnly; render(); }
      if (action === "practice-knowledge") {
        captureReadingPosition();
        const knowledgeId = target.dataset.knowledge;
        const related = (questionData.questions || []).filter((question) => question.knowledgeLinks?.[0]?.knowledgeId === knowledgeId && question.examEligible !== false && question.verificationStatus === "source_transcribed");
        if (!related.length) { toast("这个知识点暂无可用历年题", "error"); return; }
        const relatedOrdered = prioritizeQuestions(related, questionHistory());
        startSession({ mode: "practice", questions: ExamBank.uniqByStem(relatedOrdered, Math.min(20, related.length)), subjectId: related[0].subjectId });
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
        if (state.session?.mode === "review" && state.reviewReturn) { exitReview(); return; }
        clearInterval(state.sessionTimer);
        state.reviewReturn = null;
        const wasUnfinishedExam = state.session?.mode === "exam" && !state.session.finished;
        state.session = null;
        if (wasUnfinishedExam) state.activeExam = StudyDb.getActiveExam();
        state.view = "dashboard";
        render();
      }
      if (action === "review-exam-wrong") beginExamReview(true);
      if (action === "review-exam-all") beginExamReview(false);
      if (action === "retry-practice-all") startPracticeFrom(state.session.questions.map((question) => question), state.session.subjectId, state.session.scoringScheme);
      if (action === "retry-practice-wrong") startPracticeFrom(practiceResultStats(state.session).wrong.map((row) => row.question), state.session.subjectId, state.session.scoringScheme);
      if (action === "review-practice-wrong") beginPracticeReview("wrong");
      if (action === "review-practice-all") beginPracticeReview("all");
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
      if (!caseOnly && ![30, 60, 120].includes(state.practiceCount)) state.practiceCount = 30;
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
