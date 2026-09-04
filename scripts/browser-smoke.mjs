import puppeteer from "puppeteer-core";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.argv[2] ? resolve(root, process.argv[2]) : root;
const screenshotDir = mkdtempSync(resolve(tmpdir(), "securities-exam-screens-"));
const compiledStyles = readFileSync(resolve(appRoot, "styles.css"), "utf8");
if (!/tailwindcss v4\./.test(compiledStyles)) throw new Error("styles.css is not a Tailwind CSS v4 build artifact");
const questionPayload = JSON.parse(readFileSync(resolve(root, "data/questions.json"), "utf8"));
const expectedQuestions = questionPayload.meta.questionCount;
const expectedFinanceKnowledge = questionPayload.knowledgePoints.filter((item) => item.subjectId === "finance").length;
const expectedLawKnowledge = questionPayload.knowledgePoints.filter((item) => item.subjectId === "law").length;
const outlinePayload = JSON.parse(readFileSync(resolve(root, "data/outline.json"), "utf8"));
const expectedOutlinePages = outlinePayload.pages.filter((item) => item.page >= 4 && item.page !== 14).length;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  userDataDir: mkdtempSync(resolve(tmpdir(), "securities-exam-smoke-")),
  args: ["--allow-file-access-from-files", "--no-first-run"]
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(appRoot, "index.html")).href, { waitUntil: "load" });
await page.waitForSelector('[data-nav="outline"]', { timeout: 15000 });
await page.waitForSelector(".codex-chat-panel");

const offlineChat = await page.evaluate(() => ({
  panelOpen: document.body.classList.contains("codex-chat-open"),
  status: document.querySelector("[data-chat-status]")?.textContent || "",
  setupVisible: !document.querySelector(".codex-chat-setup")?.hidden,
  contextApi: typeof window.ExamApp?.getChatContext === "function"
}));
if (!offlineChat.panelOpen || !offlineChat.status.includes("未启动") || !offlineChat.setupVisible || !offlineChat.contextApi) {
  throw new Error(`Offline Codex chat fallback invalid: ${JSON.stringify(offlineChat)}`);
}
const markdownRendering = await page.evaluate(() => {
  const markdown = [
    "# 核心结论",
    "**重点内容**和 `代码`",
    "",
    "- 第一项",
    "- 第二项",
    "",
    "| 项目 | 条件 |",
    "| --- | --- |",
    "| 合格 | 60% |",
    "",
    String.raw`\[`,
    String.raw`债券价值 = \frac{5}{1.04} + \frac{5}{1.04^2} + \frac{105}{1.04^3}`,
    String.raw`\]`,
    "",
    String.raw`收益率为 \(r = \frac{1}{1+i}\)。`,
    "",
    "`<script>alert(1)</script>`",
    "[危险链接](javascript:alert(1))",
    "[协会官网](https://www.sac.net.cn/)"
  ].join("\n");
  const container = document.createElement("div");
  container.innerHTML = window.CodexChat.renderMarkdown(markdown);
  return {
    heading: container.querySelector("h3")?.textContent || "",
    bold: container.querySelector("strong")?.textContent || "",
    listItems: container.querySelectorAll("ul li").length,
    tableCells: container.querySelectorAll("table td").length,
    escapedCode: [...container.querySelectorAll("code")].some((node) => node.textContent.includes("<script>")),
    mathBlocks: container.querySelectorAll(".codex-chat-math-display .katex-display").length,
    inlineMath: container.querySelectorAll(".katex:not(.katex-display .katex)").length,
    katexLoaded: typeof window.katex?.renderToString === "function",
    executableNodes: container.querySelectorAll("script,img,iframe,object").length,
    unsafeLinks: container.querySelectorAll('a[href^="javascript:"]').length,
    safeLink: container.querySelector('a[href^="https://www.sac.net.cn/"]')?.getAttribute("rel") || ""
  };
});
if (markdownRendering.heading !== "核心结论" || markdownRendering.bold !== "重点内容" || markdownRendering.listItems !== 2 || markdownRendering.tableCells !== 2 || markdownRendering.mathBlocks !== 1 || !markdownRendering.inlineMath || !markdownRendering.katexLoaded || !markdownRendering.escapedCode || markdownRendering.executableNodes || markdownRendering.unsafeLinks || !markdownRendering.safeLink.includes("noopener")) {
  throw new Error(`Codex Markdown rendering invalid: ${JSON.stringify(markdownRendering)}`);
}

const dashboardText = await page.$eval(".sidebar-footer", (node) => node.textContent);
if (!dashboardText.includes(String(expectedQuestions))) throw new Error("Question count missing on dashboard");
const desktopTailwindStyles = await page.evaluate(() => {
  const style = (selector) => getComputedStyle(document.querySelector(selector));
  const cardColumns = style(".grid.cards-4").gridTemplateColumns.split(/\s+/).filter(Boolean).length;
  return {
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    sidebarPosition: style(".sidebar").position,
    sidebarWidth: Math.round(document.querySelector(".sidebar").getBoundingClientRect().width),
    cardRadius: style(".card").borderRadius,
    cardColumns,
    chatWidth: Math.round(document.querySelector(".codex-chat-panel").getBoundingClientRect().width)
  };
});
if (desktopTailwindStyles.bodyBackground !== "rgb(244, 247, 251)" || desktopTailwindStyles.sidebarPosition !== "sticky" || desktopTailwindStyles.sidebarWidth !== 244 || desktopTailwindStyles.cardRadius !== "17px" || desktopTailwindStyles.cardColumns !== 2 || desktopTailwindStyles.chatWidth !== 370) {
  throw new Error(`Tailwind desktop layout invalid: ${JSON.stringify(desktopTailwindStyles)}`);
}

await page.click('[data-nav="outline"]');
await page.waitForSelector(".knowledge-card");
const knowledgeCards = await page.$$eval(".knowledge-card", (nodes) => nodes.length);
if (knowledgeCards !== expectedFinanceKnowledge) throw new Error(`Expected ${expectedFinanceKnowledge} finance knowledge cards, got ${knowledgeCards}`);
const chatScrollProbe = await page.evaluate(() => {
  const messages = document.querySelector(".codex-chat-messages");
  messages.innerHTML = `<div style="height:2400px">滚动隔离回归内容</div>`;
  messages.scrollTop = messages.scrollHeight;
  window.scrollTo(0, 700);
  const rect = messages.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    pageScrollBefore: window.scrollY,
    messagesAtBottom: messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 1,
    overscrollBehaviorY: getComputedStyle(messages).overscrollBehaviorY
  };
});
await page.mouse.move(chatScrollProbe.x, chatScrollProbe.y);
await page.mouse.wheel({ deltaY: 700 });
await new Promise((resolveWait) => setTimeout(resolveWait, 100));
const chatScrollAfter = await page.evaluate(() => window.scrollY);
if (!chatScrollProbe.messagesAtBottom || chatScrollProbe.overscrollBehaviorY !== "contain" || chatScrollAfter !== chatScrollProbe.pageScrollBefore) {
  throw new Error(`Chat scroll isolation invalid: ${JSON.stringify({ ...chatScrollProbe, pageScrollAfter: chatScrollAfter })}`);
}
const knowledgeSections = await page.$eval(".knowledge-card", (node) => ({
  hasCore: Boolean(node.querySelector(".knowledge-core")),
  panels: node.querySelectorAll(".knowledge-panel").length,
  hasSources: Boolean(node.querySelector(".knowledge-sources")),
  labelsMistakesAsWrong: node.querySelector(".knowledge-panel.mistake")?.textContent.includes("以下内容均错误")
}));
if (!knowledgeSections.hasCore || knowledgeSections.panels !== 2 || !knowledgeSections.hasSources || !knowledgeSections.labelsMistakesAsWrong) throw new Error(`Incomplete knowledge card: ${JSON.stringify(knowledgeSections)}`);
const detailedKnowledge = await page.$eval("#knowledge-F005", (node) => ({
  hasMemoryHook: Boolean(node.querySelector(".knowledge-memory")),
  detailSections: node.querySelectorAll(".knowledge-detail").length,
  hasExamTips: Boolean(node.querySelector(".knowledge-exam-tips")),
  hasOfficialTextbookSource: Boolean(node.querySelector(".source-official-textbook")),
  hasAuthoritySource: Boolean(node.querySelector(".source-authority")),
  hasTextbookSource: Boolean(node.querySelector(".source-textbook")),
  hasOriginalQuote: Boolean(node.querySelector(".citation-original"))
}));
if (!detailedKnowledge.hasMemoryHook || detailedKnowledge.detailSections < 2 || !detailedKnowledge.hasExamTips || !detailedKnowledge.hasOfficialTextbookSource || !detailedKnowledge.hasAuthoritySource || !detailedKnowledge.hasTextbookSource || !detailedKnowledge.hasOriginalQuote) {
  throw new Error(`Detailed knowledge missing: ${JSON.stringify(detailedKnowledge)}`);
}
const textbookIntegration = await page.$eval("#knowledge-F001", (node) => {
  node.querySelector(".knowledge-sources")?.setAttribute("open", "");
  return {
    badge: node.querySelector(".source-tag")?.textContent || "",
    sourceLabel: node.querySelector(".source-official-textbook")?.textContent || "",
    status: node.querySelector(".source-status")?.textContent || "",
    localHref: node.querySelector(".official-textbook-citation .citation-links a")?.getAttribute("href") || "",
    hasTextNotice: Boolean(node.querySelector(".citation-text-notice"))
  };
});
if (!textbookIntegration.badge.includes("协会统编教材") || !textbookIntegration.sourceLabel.includes("请核对原书") || !textbookIntegration.status.includes("协会统编教材摘录") || !textbookIntegration.localHref.includes("base-knowledge.html#page-") || !textbookIntegration.hasTextNotice) {
  throw new Error(`Official textbook integration missing: ${JSON.stringify(textbookIntegration)}`);
}
const textbookPage = await browser.newPage();
await textbookPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await textbookPage.goto(pathToFileURL(resolve(appRoot, "docs/base-knowledge.html")).href + "#page-17", { waitUntil: "load" });
await textbookPage.waitForSelector("#page-17:target");
const textbookViewer = await textbookPage.evaluate(() => ({
  pages: document.querySelectorAll(".page").length,
  targetText: document.querySelector("#page-17")?.textContent || ""
}));
if (textbookViewer.pages !== 568 || !textbookViewer.targetText.includes("货币市场")) throw new Error(`Official textbook viewer invalid: ${JSON.stringify(textbookViewer)}`);
await textbookPage.screenshot({ path: resolve(screenshotDir, "smoke-textbook.png"), fullPage: false });
await textbookPage.close();
await page.screenshot({ path: resolve(screenshotDir, "smoke-knowledge.png"), fullPage: false });
await page.$eval("#knowledge-F005", (node) => node.scrollIntoView({ block: "start" }));
await new Promise((resolveWait) => setTimeout(resolveWait, 450));
const savedReadingPosition = await page.evaluate(() => window.ExamApp.getLastReadingPosition());
if (savedReadingPosition?.nodeId !== "knowledge-F005" || savedReadingPosition?.outlineMode !== "guide" || savedReadingPosition?.knowledgeSubject !== "finance") {
  throw new Error(`Reading position was not saved at F005: ${JSON.stringify(savedReadingPosition)}`);
}
await page.reload({ waitUntil: "load" });
await page.waitForSelector("#knowledge-F005", { timeout: 15000 });
await page.waitForFunction(() => {
  const node = document.querySelector("#knowledge-F005");
  return node && Math.abs(node.getBoundingClientRect().top - 18) <= 2;
});
const readingPositionRestore = await page.evaluate(() => ({
  position: window.ExamApp.getLastReadingPosition(),
  subject: document.querySelector("#knowledge-subject")?.value || "",
  guideActive: document.querySelector('[data-action="outline-mode"][data-mode="guide"]')?.classList.contains("active"),
  nodeTop: Math.round(document.querySelector("#knowledge-F005")?.getBoundingClientRect().top || 0),
  activeChapter: document.querySelector(".toc-button.active")?.dataset.anchor || ""
}));
if (readingPositionRestore.position?.nodeId !== "knowledge-F005" || readingPositionRestore.subject !== "finance" || !readingPositionRestore.guideActive || readingPositionRestore.nodeTop !== 18 || readingPositionRestore.activeChapter !== "knowledge-chapter-finance-2") {
  throw new Error(`Reading position did not restore: ${JSON.stringify(readingPositionRestore)}`);
}
await page.click('[data-action="start-memory"][data-chapter="finance-2"]');
await page.waitForSelector(".memory-card");
await page.click('[data-action="reveal-memory"]');
await page.waitForSelector(".memory-answer .knowledge-memory");
await page.click('[data-action="grade-memory"][data-grade="known"]');
const memoryReviewSaved = await page.evaluate(() => window.StudyDb.getKnowledgeReviews().some((row) => row.knowledge_id === "F005" && row.grade === "known"));
if (!memoryReviewSaved) throw new Error("Knowledge memory review was not saved");
await page.click('[data-action="exit-memory"]');
await page.waitForSelector(".knowledge-card");
await page.select("#knowledge-subject", "law");
await page.waitForFunction((expected) => document.querySelectorAll(".knowledge-card").length === expected, {}, expectedLawKnowledge);
const lawKnowledgeCards = await page.$$eval(".knowledge-card", (nodes) => nodes.length);
const historicalTextbookIntegration = await page.$eval("#knowledge-L001", (node) => {
  node.querySelector(".knowledge-sources")?.setAttribute("open", "");
  return {
    intro: document.querySelector(".knowledge-intro")?.textContent || "",
    sourceLabel: node.querySelector(".source-historical-textbook")?.textContent || "",
    localHref: node.querySelector(".historical-textbook-citation .citation-links a")?.getAttribute("href") || "",
    notice: node.querySelector(".historical-textbook-citation .citation-text-notice")?.textContent || ""
  };
});
if (!historicalTextbookIntegration.intro.includes("不是协会统编教材") || !historicalTextbookIntegration.intro.includes("不作为现行规则或考试答案依据") || !historicalTextbookIntegration.sourceLabel.includes("历史辅助 · 非答案依据") || historicalTextbookIntegration.localHref !== "./docs/law-regulations.html#page-14" || !historicalTextbookIntegration.notice.includes("必须核对最新官方文本")) {
  throw new Error(`Historical textbook integration missing: ${JSON.stringify(historicalTextbookIntegration)}`);
}
await page.$eval("#knowledge-L001", (node) => node.scrollIntoView({ block: "start" }));
await page.screenshot({ path: resolve(screenshotDir, "smoke-law-knowledge.png"), fullPage: false });
const historicalTextbookPage = await browser.newPage();
await historicalTextbookPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
await historicalTextbookPage.goto(pathToFileURL(resolve(appRoot, "docs/law-regulations.html")).href + "#page-14", { waitUntil: "load" });
await historicalTextbookPage.waitForSelector("#page-14:target");
const historicalTextbookViewer = await historicalTextbookPage.evaluate(() => ({
  pages: document.querySelectorAll(".page").length,
  targetText: document.querySelector("#page-14")?.textContent || ""
}));
if (historicalTextbookViewer.pages !== 274 || !historicalTextbookViewer.targetText.includes("法律关系是根据法律规范产生的")) throw new Error(`Historical textbook viewer invalid: ${JSON.stringify(historicalTextbookViewer)}`);
await historicalTextbookPage.screenshot({ path: resolve(screenshotDir, "smoke-law-textbook.png"), fullPage: false });
await historicalTextbookPage.close();
await page.click('[data-action="outline-mode"][data-mode="official"]');
await page.waitForSelector(".outline-page");
const outlinePages = await page.$$eval(".outline-page", (nodes) => nodes.length);
if (outlinePages !== expectedOutlinePages) throw new Error(`Expected ${expectedOutlinePages} outline pages, got ${outlinePages}`);
await page.screenshot({ path: resolve(screenshotDir, "smoke-outline.png"), fullPage: false });

await page.click('[data-nav="practice"]');
await page.waitForSelector('[data-action="start-practice"]');
await page.click('[data-action="start-case-practice"]');
await page.waitForSelector(".case-material strong");
const casePracticeHeader = await page.$eval(".case-material strong", (node) => node.textContent || "");
if (!casePracticeHeader.includes("第 1/4 问")) throw new Error(`Case practice did not start at a complete pack: ${casePracticeHeader}`);
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-nav="practice"]');
await page.click('[data-nav="practice"]');
await page.waitForSelector('[data-action="start-practice"]');
await page.click('[data-action="start-practice"]');
await page.waitForSelector(".question-card");
const chatQuestionContext = await page.evaluate(() => window.ExamApp.getChatContext());
if (!chatQuestionContext.question?.id || chatQuestionContext.question.submitted || !chatQuestionContext.guidance?.includes("不直接揭晓答案")) {
  throw new Error(`Question chat context invalid: ${JSON.stringify(chatQuestionContext)}`);
}
await page.click(".option");
await page.click('[data-action="submit-question"]');
await page.waitForSelector(".explanation");
const submittedChatContext = await page.evaluate(() => window.ExamApp.getChatContext());
if (!submittedChatContext.question?.submitted || !submittedChatContext.question.correctOptionIds?.length || !submittedChatContext.question.explanation) {
  throw new Error(`Submitted question chat context invalid: ${JSON.stringify(submittedChatContext)}`);
}
const sourceBlocks = await page.evaluate(() => ({
  status: document.querySelector(".source-status")?.textContent || "",
  scope: document.querySelector(".scope-reference")?.textContent || "",
  referenceLabel: document.querySelector(".source-official-textbook, .source-textbook, .source-international, .source-authority")?.textContent || ""
}));
if (!/(协会统编教材|中国法规\/官方资料|国际标准参考|非官方原理补充)/.test(sourceBlocks.status) || !sourceBlocks.scope.includes("非答案出处") || !/(协会统编教材|中国现行法律依据|中国官方资料|国际标准参考|通用开放教材)/.test(sourceBlocks.referenceLabel)) throw new Error(`Question source classification missing: ${JSON.stringify(sourceBlocks)}`);
await page.click('[data-action="bookmark-question"]');

const dataChecks = await page.evaluate(async () => {
  const testQuestionId = "SMOKE-LATEST-WRONG";
  window.StudyDb.run("DELETE FROM attempts WHERE question_id=?", [testQuestionId]);
  window.StudyDb.run(
    "INSERT INTO attempts(id,question_id,question_version,selected_json,is_correct,mode,created_at) VALUES (?,?,?,?,?,?,?)",
    [crypto.randomUUID(), testQuestionId, 1, "[]", 0, "practice", "2026-01-01T00:00:00.000Z"]
  );
  window.StudyDb.run(
    "INSERT INTO attempts(id,question_id,question_version,selected_json,is_correct,mode,created_at) VALUES (?,?,?,?,?,?,?)",
    [crypto.randomUUID(), testQuestionId, 1, "[]", 1, "practice", "2026-01-01T00:00:00.000Z"]
  );
  const latestWrongResolved = !window.StudyDb.getWrongQuestionIds().includes(testQuestionId);
  window.StudyDb.run("DELETE FROM attempts WHERE question_id=?", [testQuestionId]);

  window.StudyDb.run("INSERT OR REPLACE INTO notes(question_id,body,modified_at) VALUES (?,?,?)", ["F001-S", "newer-local-note", "2099-01-01T00:00:00.000Z"]);
  const wasmBinary = Uint8Array.from(atob(window.SQL_WASM_BASE64), (char) => char.charCodeAt(0));
  const SQL = await window.initSqlJs({ wasmBinary });
  const incoming = new SQL.Database();
  incoming.exec(`
    CREATE TABLE profile_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO profile_meta(key,value) VALUES ('schema_version','1');
    CREATE TABLE attempts (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, question_version INTEGER,
      selected_json TEXT NOT NULL, is_correct INTEGER NOT NULL, mode TEXT NOT NULL,
      session_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE notes (question_id TEXT PRIMARY KEY, body TEXT NOT NULL, modified_at TEXT NOT NULL);
    INSERT INTO notes(question_id,body,modified_at) VALUES ('F001-S','older-incoming-note','2000-01-01T00:00:00.000Z');
  `);
  await window.StudyDb.mergeBytes(incoming.export());
  incoming.close();
  const newerNotePreserved = window.StudyDb.getNote("F001-S") === "newer-local-note";
  window.StudyDb.run("DELETE FROM notes WHERE question_id=?", ["F001-S"]);

  const beforeImport = { stats: window.StudyDb.getDashboard(), deviceId: window.StudyDb.getMeta().device_id };
  const incompatible = new SQL.Database();
  incompatible.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
  let incompatibleRejected = false;
  try {
    await window.StudyDb.importBytes(incompatible.export().buffer, "not-a-profile.sqlite");
  } catch (_) {
    incompatibleRejected = true;
  }
  incompatible.close();
  const afterImport = { stats: window.StudyDb.getDashboard(), deviceId: window.StudyDb.getMeta().device_id };
  const currentProfileIntact = incompatibleRejected && beforeImport.stats.total === afterImport.stats.total && beforeImport.deviceId === afterImport.deviceId;
  await window.StudyDb.flush();
  return { latestWrongResolved, newerNotePreserved, currentProfileIntact };
});
if (!Object.values(dataChecks).every(Boolean)) throw new Error(`Data checks failed: ${JSON.stringify(dataChecks)}`);

await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-action="start-exam"]');
await page.click('[data-action="start-exam"]');
await page.waitForSelector(".question-card");

const examBlueprint = await page.evaluate(() => {
  const active = window.StudyDb.getActiveExam();
  const map = new Map(window.QUESTION_DATA.questions.map((question) => [question.id, question]));
  const factCounts = new Map();
  for (const id of active.questionIds) {
    const question = map.get(id);
    const factId = question?.factId;
    factCounts.set(factId, (factCounts.get(factId) || 0) + 1);
  }
  const caseEntries = active.questionIds.map((id, index) => ({ question: map.get(id), index })).filter((entry) => entry.question?.type === "case");
  const caseGroups = Object.groupBy(caseEntries, (entry) => entry.question.caseGroupId);
  const completeAndConsecutive = Object.values(caseGroups).every((entries) =>
    entries.length === 4 &&
    entries.map((entry) => entry.question.caseOrder).join(",") === "1,2,3,4" &&
    entries.every((entry, index) => index === 0 || entry.index === entries[index - 1].index + 1)
  );
  return {
    total: active.questionIds.length,
    uniqueFacts: factCounts.size,
    maxVariantsPerFact: Math.max(...factCounts.values()),
    caseQuestions: caseEntries.length,
    caseGroups: Object.keys(caseGroups).length,
    completeAndConsecutive
  };
});
if (examBlueprint.total !== 120 || examBlueprint.uniqueFacts !== 120 || examBlueprint.maxVariantsPerFact !== 1 || examBlueprint.caseQuestions !== 16 || examBlueprint.caseGroups !== 4 || !examBlueprint.completeAndConsecutive) throw new Error(`Invalid exam blueprint: ${JSON.stringify(examBlueprint)}`);

await page.click(".option");
await page.evaluate(() => window.StudyDb.flush());
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-action="resume-exam"]');
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-action="resume-exam"]', { timeout: 15000 });
const bookmarkPersisted = await page.evaluate(() => window.StudyDb.isBookmarked(window.StudyDb.getBookmarkIds()[0]));
if (!bookmarkPersisted) throw new Error("Bookmark was not persisted across reload");
await page.click('[data-action="resume-exam"]');
await page.waitForSelector(".question-card");
await page.click('[data-action="prev-question"]');
await page.waitForSelector(".option.selected");

for (let index = 0; index < 120; index += 1) {
  await page.click('[data-action="next-question"]');
}
await page.waitForFunction(() => document.body.textContent.includes("查看全部解析与来源"), { timeout: 30000 });
await page.click('[data-action="review-exam-all"]');
await page.waitForSelector(".source-status");
const resultReviewHasSource = await page.evaluate(() => Boolean(
  document.querySelector(".source-status") && document.querySelector(".scope-reference")?.textContent.includes("非答案出处")
));
if (!resultReviewHasSource) throw new Error("Exam review does not show source classification");
await page.screenshot({ path: resolve(screenshotDir, "smoke-review.png"), fullPage: true });
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-nav="outline"]');

const dashboard = await page.evaluate(async () => {
  await window.StudyDb.flush();
  return {
    stats: window.StudyDb.getDashboard(),
    fsApi: typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function",
    externalResources: performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => /^https?:/i.test(url))
  };
});
if (dashboard.stats.total < 121) throw new Error("Practice or exam attempts were not saved");
if (!dashboard.fsApi) throw new Error("Chrome File System Access API unavailable on file://");
if (dashboard.externalResources.length) throw new Error(`Unexpected network resources: ${dashboard.externalResources.join(", ")}`);

await page.screenshot({ path: resolve(screenshotDir, "smoke-dashboard.png"), fullPage: true });
const mobilePage = await browser.newPage();
await mobilePage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await mobilePage.evaluateOnNewDocument(() => localStorage.removeItem("securities-exam-reading-position-v1"));
await mobilePage.goto(pathToFileURL(resolve(appRoot, "index.html")).href, { waitUntil: "load" });
await mobilePage.waitForSelector('[data-nav="outline"]', { timeout: 15000 });
if (await mobilePage.evaluate(() => document.body.classList.contains("codex-chat-open"))) {
  await mobilePage.waitForFunction(() => {
    const panel = document.querySelector(".codex-chat-panel");
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= window.innerWidth + 1;
  });
  await mobilePage.click('[data-chat-action="close"]');
  await mobilePage.waitForFunction(() => !document.body.classList.contains("codex-chat-open"));
  await new Promise((resolveWait) => setTimeout(resolveWait, 250));
}
const mobileTailwindStyles = await mobilePage.evaluate(() => {
  const style = (selector) => getComputedStyle(document.querySelector(selector));
  return {
    viewport: window.innerWidth,
    layoutColumns: style(".layout").gridTemplateColumns.split(/\s+/).filter(Boolean).length,
    cardColumns: style(".grid.cards-4").gridTemplateColumns.split(/\s+/).filter(Boolean).length,
    sidebarPosition: style(".sidebar").position,
    navDisplay: style(".nav-list").display,
    mainPaddingLeft: style(".main").paddingLeft,
    documentWidth: document.documentElement.scrollWidth
  };
});
if (mobileTailwindStyles.layoutColumns !== 1 || mobileTailwindStyles.cardColumns !== 1 || mobileTailwindStyles.sidebarPosition !== "static" || mobileTailwindStyles.navDisplay !== "flex" || mobileTailwindStyles.mainPaddingLeft !== "16px" || mobileTailwindStyles.documentWidth > mobileTailwindStyles.viewport + 1) {
  throw new Error(`Tailwind mobile layout invalid: ${JSON.stringify(mobileTailwindStyles)}`);
}
await mobilePage.screenshot({ path: resolve(screenshotDir, "smoke-mobile.png"), fullPage: true });
await mobilePage.click(".codex-chat-launcher");
await mobilePage.waitForFunction(() => document.body.classList.contains("codex-chat-open"));
await new Promise((resolveWait) => setTimeout(resolveWait, 250));
const mobileChatStyles = await mobilePage.evaluate(() => {
  const messages = document.querySelector(".codex-chat-messages");
  const article = document.createElement("article");
  article.className = "codex-chat-message assistant";
  article.innerHTML = `<span class="codex-chat-message-label">AI 助教</span><div class="codex-chat-message-content">${window.CodexChat.renderMarkdown([
    "## 宽内容回归",
    "这是用于确认手机端长回复不会被横向裁切的说明。",
    "",
    "| 金融机构类型 | 主要职责 | 监管要求 | 风险管理 | 备考提示 |",
    "| --- | --- | --- | --- | --- |",
    "| 证券公司、基金公司、信托公司、消费金融公司 | 服务实体经济和资本市场 | 遵守最新有效规则 | 建立内部控制机制 | 结合场景理解 |",
    "",
    "```text",
    "long-unbroken-content-abcdefghijklmnopqrstuvwxyz-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "```"
  ].join("\n"))}</div>`;
  messages.replaceChildren(article);
  messages.scrollLeft = 0;
  const panelRect = document.querySelector(".codex-chat-panel").getBoundingClientRect();
  const bubbleRect = article.querySelector(".codex-chat-message-content").getBoundingClientRect();
  const tableWrap = article.querySelector(".codex-chat-table-wrap");
  return {
    viewport: window.innerWidth,
    panelLeft: Math.round(panelRect.left),
    panelRight: Math.round(panelRect.right),
    panelWidth: Math.round(panelRect.width),
    bubbleLeft: Math.round(bubbleRect.left),
    bubbleRight: Math.round(bubbleRect.right),
    messagesClientWidth: messages.clientWidth,
    messagesScrollWidth: messages.scrollWidth,
    messagesScrollLeft: messages.scrollLeft,
    tableScrollsInternally: Boolean(tableWrap && tableWrap.scrollWidth > tableWrap.clientWidth)
  };
});
if (mobileChatStyles.panelLeft !== 0 || mobileChatStyles.panelRight !== mobileChatStyles.viewport || mobileChatStyles.panelWidth !== mobileChatStyles.viewport || mobileChatStyles.bubbleLeft < 0 || mobileChatStyles.bubbleRight > mobileChatStyles.viewport || mobileChatStyles.messagesScrollWidth > mobileChatStyles.messagesClientWidth || mobileChatStyles.messagesScrollLeft !== 0 || !mobileChatStyles.tableScrollsInternally) {
  throw new Error(`Mobile chat overflow invalid: ${JSON.stringify(mobileChatStyles)}`);
}
await mobilePage.screenshot({ path: resolve(screenshotDir, "smoke-mobile-chat.png"), fullPage: false });
await mobilePage.close();
await browser.close();

if (errors.length) throw new Error(`Page errors: ${errors.join(" | ")}`);
console.log(JSON.stringify({
  ok: true,
  screenshotDir,
  desktopTailwindStyles,
  mobileTailwindStyles,
  mobileChatStyles,
  readingPositionRestore,
  outlinePages,
  knowledgeCards,
  lawKnowledgeCards,
  detailedKnowledge,
  textbookIntegration,
  textbookViewer,
  historicalTextbookIntegration,
  historicalTextbookViewer,
  memoryReviewSaved,
  casePracticeHeader,
  offlineChat,
  markdownRendering,
  chatScrollIsolation: { pageScrollBefore: chatScrollProbe.pageScrollBefore, pageScrollAfter: chatScrollAfter, overscrollBehaviorY: chatScrollProbe.overscrollBehaviorY },
  chatQuestionContext: { question: chatQuestionContext.question, guidance: chatQuestionContext.guidance },
  submittedChatContext: { id: submittedChatContext.question.id, submitted: submittedChatContext.question.submitted },
  sourceBlocks,
  dataChecks,
  examBlueprint,
  resultReviewHasSource,
  stats: dashboard.stats,
  fsApi: dashboard.fsApi,
  externalResources: dashboard.externalResources
}, null, 2));
