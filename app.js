(function () {
  const outlineData = window.OUTLINE_DATA || { meta: {}, toc: [], pages: [], supplements: [] };
  const questionData = window.QUESTION_DATA || { meta: {}, subjects: [], chapters: [], questions: [] };
  const questionMap = new Map((questionData.questions || []).map((question) => [question.id, question]));

  const navItems = [
    ["dashboard", "⌂", "学习总览"],
    ["outline", "目", "完整大纲"],
    ["practice", "练", "章节练习"],
    ["mistakes", "错", "错题与收藏"],
    ["stats", "数", "学习统计"],
    ["profile", "档", "学习档案"]
  ];

  const pageInfo = {
    dashboard: ["学习总览", "从大纲、练习和模考逐步建立完整知识框架"],
    outline: ["完整考试大纲", "主大纲与 2026 纪法增补均可离线搜索阅读"],
    practice: ["章节练习", "按科目、章节和题型生成练习"],
    mistakes: ["错题与收藏", "集中修复薄弱知识点"],
    stats: ["学习统计", "区分答题次数、首次覆盖和章节正确率"],
    profile: ["学习档案", "绑定、导入、导出或合并 SQLite 学习记录"]
  };

  const state = {
    view: "dashboard",
    saveStatus: { state: "saved", message: "正在初始化", profileName: "浏览器档案", lastSavedAt: null, bound: false },
    outlineSearch: "",
    outlineSource: "main",
    practiceSubject: "finance",
    practiceChapter: "all",
    practiceCount: 20,
    practiceTypes: new Set(["single", "multiple", "judgment", "case"]),
    listTab: "wrong",
    session: null,
    activeExam: null,
    sessionTimer: null,
    toasts: []
  };

  const app = document.getElementById("app");
  app.innerHTML = '<div class="loading-screen">正在载入离线题库与学习档案…</div>';

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
            官方大纲版本：${escapeHtml(questionData.meta?.outlineVersion || "2025 + 纪法2026")}<br />
            内容核验截止：${escapeHtml(questionData.meta?.contentCutoff || "2026-07-17")}
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

  function renderDashboard() {
    const stats = StudyDb.getDashboard();
    const coverage = questionData.questions.length ? Math.round(stats.unique * 100 / questionData.questions.length) : 0;
    const subjects = questionData.subjects || [];
    return `
      <div class="grid">
        <section class="card hero-card">
          <h3>先建立知识地图，再用练习检验理解</h3>
          <p>建议先完整阅读两遍官方大纲：第一遍建立章节框架，第二遍标记“掌握、熟悉、了解”。刷题结果页会显示大纲原文、页码和答案依据。</p>
          <div class="hero-actions">
            <button class="button secondary" data-nav="outline">开始阅读大纲</button>
            <button class="button" data-action="quick-practice">随机练习 20 题</button>
            <button class="button ghost" data-action="start-exam">120 题模拟考试</button>
            ${state.activeExam ? '<button class="button secondary" data-action="resume-exam">恢复未完成模考</button>' : ""}
          </div>
        </section>
        <div class="grid cards-4">
          <section class="card card-body"><div class="metric-label">累计作答</div><div class="metric-value">${stats.total}</div><div class="metric-detail">包含重复练习</div></section>
          <section class="card card-body"><div class="metric-label">综合正确率</div><div class="metric-value">${stats.accuracy}%</div><div class="progress"><span style="width:${stats.accuracy}%"></span></div></section>
          <section class="card card-body"><div class="metric-label">题库覆盖</div><div class="metric-value">${coverage}%</div><div class="metric-detail">已完成 ${stats.unique} / ${questionData.questions.length} 题</div></section>
          <section class="card card-body"><div class="metric-label">当前错题</div><div class="metric-value">${stats.wrongUnique}</div><div class="metric-detail">模拟考试 ${stats.exams} 次</div></section>
        </div>
        <div class="grid two">
          <section class="card card-body">
            <h3 class="card-title">按科目开始</h3>
            <div class="quick-list">
              ${subjects.map((subject) => {
                const count = questionData.questions.filter((q) => q.subjectId === subject.id).length;
                return `<div class="quick-item"><div><strong>${escapeHtml(subject.title)}</strong><br /><span>${count} 道题 · ${subject.chapterCount} 章</span></div><button class="button small" data-action="practice-subject" data-subject="${subject.id}">开始练习</button></div>`;
              }).join("")}
            </div>
          </section>
          <section class="card card-body">
            <h3 class="card-title">本版本说明</h3>
            <div class="notice">当前题库由 ${questionData.meta?.factCount || 0} 个经大纲范围定位的知识单元生成 ${questionData.questions.length} 道题型练习；结构和引用定位已自动校验，不代表逐题经过官方或专家审定。多选题采用“全部选对才得分”的本地规则。</div>
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

  function renderOutline() {
    const query = state.outlineSearch.trim();
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

  function subjectChapters(subjectId) {
    return (questionData.chapters || []).filter((chapter) => chapter.subjectId === subjectId);
  }

  function renderPractice() {
    const chapters = subjectChapters(state.practiceSubject);
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
            <div class="field"><label>题目数量</label><select class="select" id="practice-count">${[10,20,30,50,100].map((count) => `<option value="${count}" ${state.practiceCount === count ? "selected" : ""}>${count} 题</option>`).join("")}</select></div>
            <div class="notice">当前条件共有 ${available} 道可用题。章节练习会即时显示答案、解析、大纲原文和引用出处。</div>
            <button class="button" data-action="start-practice" ${available ? "" : "disabled"}>开始章节练习</button>
          </div>
        </section>
        <section class="card card-body">
          <h3 class="card-title">模拟考试</h3>
          <p style="line-height:1.8;color:var(--muted)">按照官方公开框架生成 120 题、120 分钟的本地模拟卷。考试中不即时显示解析，交卷后统一查看成绩与错题。</p>
          <div class="quick-list">
            ${questionData.subjects.map((subject) => `<div class="quick-item"><div><strong>${escapeHtml(subject.title)}</strong><br /><span>120 题 · 120 分钟</span></div><button class="button small" data-action="start-exam-subject" data-subject="${subject.id}">开始模考</button></div>`).join("")}
          </div>
          <div class="notice" style="margin-top:16px">官方没有公布题型占比、章节权重和多选题评分细则。本工具的抽题分布仅用于训练。</div>
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
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px">
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
          <h3 class="card-title">章节表现</h3>
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
          <p style="line-height:1.8;color:var(--muted)">Chrome 支持直接绑定本地文件。绑定后，每次答题、收藏和交卷都会自动写回 SQLite；同时保留一份浏览器内部快照。</p>
          ${direct ? "" : '<div class="notice">当前环境未开放 File System Access API，只能使用手动导入和导出。</div>'}
          <div class="profile-actions" style="margin-top:16px">
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
          <ol style="line-height:1.9;color:#445066;padding-left:20px">
            <li>完成刷题并等待页面显示“已写入档案”。</li>
            <li>关闭页面，复制 <code>securities-study-profile.sqlite</code>。</li>
            <li>另一台电脑打开本工具，选择“打开并绑定档案”。</li>
            <li>如果两边都产生了记录，使用“合并另一份档案”，不要直接覆盖。</li>
          </ol>
          <h3 class="card-title" style="margin-top:22px">内容与版权</h3>
          <p style="line-height:1.75;color:var(--muted)">本工具仅供个人非商业学习。内置大纲原件版权归发布机构；题目为依据公开范围原创，不复制商业题库，不宣称官方题库或真题。</p>
        </section>
      </div>`;
  }

  function selectQuestions({ subjectId, chapterId = "all", count = 20, types = null, ids = null }) {
    let pool = ids ? ids.map((id) => questionMap.get(id)).filter(Boolean) : questionData.questions.filter((question) => {
      return (!subjectId || question.subjectId === subjectId) &&
        (chapterId === "all" || question.chapterId === chapterId) &&
        (!types || types.has(question.type));
    });
    return shuffle(pool).slice(0, Math.min(count, pool.length));
  }

  function selectExamQuestions(subjectId, count = 120) {
    const pool = questionData.questions.filter((question) => question.subjectId === subjectId);
    const groups = new Map();
    for (const question of pool) {
      const list = groups.get(question.factId) || [];
      list.push(question); groups.set(question.factId, list);
    }
    const orderedGroups = shuffle([...groups.values()]);
    const result = [];
    const targets = ["primary", "judgment", "multiple"];
    for (let pass = 0; result.length < count && pass < 3; pass += 1) {
      orderedGroups.forEach((group, index) => {
        if (result.length >= count) return;
        const target = targets[(index + pass) % targets.length];
        const match = group.find((question) => {
          if (result.some((item) => item.id === question.id)) return false;
          if (target === "primary") return question.type === "single" || question.type === "case";
          return question.type === target;
        }) || group.find((question) => !result.some((item) => item.id === question.id));
        if (match) result.push(match);
      });
    }
    return result;
  }

  function startSession({ mode, questions, subjectId = null, seconds = null }) {
    if (!questions.length) return toast("没有符合条件的题目", "error");
    const id = crypto.randomUUID();
    state.session = {
      id,
      mode,
      subjectId,
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
    if (mode === "exam") StudyDb.createSession({ id, mode, subjectId, questionIds: questions.map((q) => q.id) });
    render();
  }

  function startExam(subjectId) {
    const pool = selectExamQuestions(subjectId, 120);
    if (pool.length < 120) toast(`当前科目只有 ${pool.length} 道可用题，将以现有题量生成模拟卷`, "error");
    startSession({ mode: "exam", questions: pool, subjectId, seconds: 120 * 60 });
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
    const isMultiple = question.type === "multiple";
    return `
      <main class="main session-shell">
        <div class="session-header">
          <div><button class="button secondary small" data-action="exit-session">退出</button> <span class="session-meta">${session.mode === "exam" ? "模拟考试" : session.mode === "review" ? "模考复盘" : "章节练习"} · 第 ${session.index + 1}/${session.questions.length} 题</span></div>
          ${session.mode === "exam" ? `<div id="session-timer" class="timer ${session.remainingSeconds < 600 ? "warning" : ""}">${formatSeconds(session.remainingSeconds)}</div>` : `<div class="session-meta">已完成 ${Object.keys(session.submitted).length} 题</div>`}
        </div>
        <div class="progress" style="margin-bottom:16px"><span style="width:${Math.round((session.index + 1) * 100 / session.questions.length)}%"></span></div>
        <section class="card question-card">
          <div class="question-tags">
            <span class="tag">${type}</span>
            <span class="tag">${escapeHtml(subjectTitle(question.subjectId))}</span>
            <span class="tag">${escapeHtml(chapterTitle(question.chapterId))}</span>
            <span class="tag level-master">${escapeHtml(question.level || "掌握")}</span>
            ${question.negation ? '<span class="tag negative">注意否定表述</span>' : ""}
          </div>
          ${question.caseMaterial ? `<div class="case-material">${escapeHtml(question.caseMaterial)}</div>` : ""}
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
          ${isMultiple && !submitted ? '<div class="metric-detail" style="margin-top:12px">多选题可选择多个选项，全部选对才判定正确。</div>' : ""}
        </section>
      </main>`;
  }

  function renderStem(stem) {
    let safe = escapeHtml(stem);
    for (const word of ["不正确", "错误", "不属于", "不得", "不包括"]) {
      safe = safe.replaceAll(word, `<span style="color:var(--danger);text-decoration:underline">${word}</span>`);
    }
    return safe;
  }

  function renderExplanation(question, correct) {
    return `
      <div class="explanation">
        <div class="result-banner ${correct ? "correct" : "incorrect"}">${correct ? "回答正确" : `回答错误，正确答案：${question.correctOptionIds.join("、")}`}</div>
        <h4>解析</h4><p>${escapeHtml(question.explanation)}</p>
        ${question.optionExplanations ? `<h4>选项说明</h4>${question.options.map((option) => `<p><strong>${option.id}：</strong>${escapeHtml(question.optionExplanations[option.id] || "")}</p>`).join("")}` : ""}
        <h4>大纲定位与知识来源</h4>
        ${(question.citations || []).map(renderCitation).join("")}
        <h4>个人笔记</h4>
        <textarea class="textarea" id="question-note" placeholder="记录自己的理解、易错点或记忆方法……">${escapeHtml(StudyDb.getNote(question.id))}</textarea>
        <button class="button small" style="margin-top:8px" data-action="save-note">保存笔记</button>
      </div>`;
  }

  function renderCitation(citation) {
    const local = citation.localPath ? `<a href="${escapeHtml(citation.localPath)}${citation.page ? `#page=${citation.page}` : ""}" target="_blank">打开本地原件</a>` : "";
    const official = citation.url ? `<a href="${escapeHtml(citation.url)}" target="_blank">官方在线来源</a>` : "";
    const sourceType = citation.kind === "authority" ? "答案依据" : "考试范围定位";
    return `<div class="citation"><div class="citation-title"><span class="tag">${sourceType}</span> ${escapeHtml(citation.title)}</div><div class="citation-locator">${escapeHtml(citation.locator || "")}${citation.effectiveDate ? ` · 生效/版本：${escapeHtml(citation.effectiveDate)}` : ""}</div><blockquote>${escapeHtml(citation.quote || "")}</blockquote>${citation.kind === "scope" ? '<div class="metric-detail">此处用于证明该知识点属于官方考试范围；答案解析可能是依据该范围编写的原创归纳，并不等同于官方教材原文。</div>' : ""}<div class="citation-links">${local}${official}</div></div>`;
  }

  function chooseOption(optionId) {
    const session = state.session;
    const question = session.questions[session.index];
    const selected = new Set(session.answers[question.id] || []);
    if (question.type === "multiple") {
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
      if (correct) score += 1;
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
    const percent = Math.round(session.score * 100 / session.questions.length);
    const wrongIds = session.questions.filter((question) => !sameAnswer(new Set(session.answers[question.id] || []), new Set(question.correctOptionIds))).map((q) => q.id);
    return `<main class="main session-shell"><section class="card card-body"><div class="empty"><strong style="font-size:28px">${session.score} / ${session.questions.length}</strong><div style="margin:9px 0 18px">正确率 ${percent}% · ${percent >= 60 ? "达到本地模拟要求" : "建议回看薄弱章节"}</div><div class="action-group" style="justify-content:center"><button class="button" data-action="review-exam-wrong" ${wrongIds.length ? "" : "disabled"}>逐题复习错题</button><button class="button secondary" data-action="review-exam-all">查看全部解析与来源</button><button class="button secondary" data-action="exit-session">返回总览</button></div></div><div class="notice">该成绩只反映本工具的题型练习表现，不代表官方成绩预测。交卷记录已写入学习档案。</div></section></main>`;
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

  async function handleAction(action, target) {
    try {
      if (action === "quick-practice") startSession({ mode: "practice", questions: selectQuestions({ count: 20 }) });
      if (action === "practice-subject") { state.practiceSubject = target.dataset.subject; state.practiceChapter = "all"; state.view = "practice"; render(); }
      if (action === "start-exam") startExam(state.practiceSubject || "finance");
      if (action === "resume-exam") resumeExam();
      if (action === "start-exam-subject") startExam(target.dataset.subject);
      if (action === "start-practice") startSession({ mode: "practice", questions: selectQuestions({ subjectId: state.practiceSubject, chapterId: state.practiceChapter, count: state.practiceCount, types: state.practiceTypes }), subjectId: state.practiceSubject });
      if (action === "list-tab") { state.listTab = target.dataset.tab; render(); }
      if (action === "practice-list") startSession({ mode: "practice", questions: selectQuestions({ ids: getListQuestions().map((q) => q.id), count: getListQuestions().length }) });
      if (action === "jump-outline") {
        document.querySelectorAll(".toc-button.active").forEach((button) => button.classList.remove("active"));
        target.classList.add("active");
        const destination = document.getElementById(target.dataset.anchor) || document.getElementById(`outline-page-${target.dataset.page}`);
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
    if (nav) { state.view = nav.dataset.nav; render(); return; }
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) handleAction(actionTarget.dataset.action, actionTarget);
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.id === "outline-source") { state.outlineSource = target.value; render(); }
    if (target.id === "practice-subject") { state.practiceSubject = target.value; state.practiceChapter = "all"; render(); }
    if (target.id === "practice-chapter") { state.practiceChapter = target.value; render(); }
    if (target.id === "practice-count") { state.practiceCount = Number(target.value); render(); }
    if (target.dataset.practiceType) { if (target.checked) state.practiceTypes.add(target.dataset.practiceType); else state.practiceTypes.delete(target.dataset.practiceType); render(); }
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

  window.addEventListener("beforeunload", () => { StudyDb.flush().catch(() => {}); });

  StudyDb.onStatus((status) => {
    state.saveStatus = status;
    const pill = document.querySelector(".save-pill");
    if (pill) {
      pill.className = `save-pill ${status.state}`;
      pill.querySelector("span:last-child").textContent = `${status.message}${status.lastSavedAt ? ` · ${formatDate(status.lastSavedAt)}` : ""}`;
    }
  });

  StudyDb.init().then(() => { state.activeExam = StudyDb.getActiveExam(); render(); }).catch((error) => {
    console.error(error);
    app.innerHTML = `<div class="loading-screen"><div><strong>初始化失败</strong><p>${escapeHtml(error.message)}</p><p>请使用桌面版 Chrome 打开，并确认 vendor/sql-wasm.js 文件完整。</p></div></div>`;
  });
})();
