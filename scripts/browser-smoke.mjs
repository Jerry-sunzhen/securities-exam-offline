import puppeteer from "puppeteer-core";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { sprintPlan } from "../content/sprint-plan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.argv[2] ? resolve(root, process.argv[2]) : root;
const screenshotDir = mkdtempSync(resolve(tmpdir(), "securities-exam-screens-"));
const compiledStyles = readFileSync(resolve(appRoot, "styles.css"), "utf8");
if (!/tailwindcss v4\./.test(compiledStyles)) throw new Error("styles.css is not a Tailwind CSS v4 build artifact");
const questionPayload = JSON.parse(readFileSync(resolve(root, "data/questions.json"), "utf8"));
const expectedQuestions = questionPayload.meta.questionCount;
const expectedFinanceKnowledge = questionPayload.knowledgePoints.filter((item) => item.subjectId === "finance").length;
const expectedLawKnowledge = questionPayload.knowledgePoints.filter((item) => item.subjectId === "law").length;
// 题干不能只剩半句：导入时把行首的金额/比例当成题号，会留下「40元，时间是…」这类残句。
const truncatedStem = questionPayload.questions.filter((item) => /^\d+(?:\.\d+)?\s*(?:元|%|％)/.test(item.stem.trim()));
if (truncatedStem.length) throw new Error(`Questions lost their stem prefix: ${truncatedStem.map((item) => item.id).join(", ")}`);
const repairedOrderQuestion = questionPayload.questions.find((item) => item.stem.includes("则四位投资者的撮合成交顺序"));
if (!repairedOrderQuestion?.stem.startsWith("有甲、乙、丙、丁四个投资者，均申报买进X股票") || !repairedOrderQuestion.stem.includes("甲的买进价为10.75元")) {
  throw new Error(`Repaired question stem is still truncated: ${repairedOrderQuestion?.stem || "missing"}`);
}
// 综合材料题本身很少：来源里只有 11 份试卷带材料题，导入时要全部收进来。
const usableCase = questionPayload.questions.filter((item) => item.type === "case" && item.examEligible !== false);
const caseMaterials = new Set(usableCase.map((item) => `${item.subjectId}|${item.caseGroupId}`));
if (usableCase.length < 44 || caseMaterials.size < 19) {
  throw new Error(`综合材料题回收不全: ${usableCase.length} 题 / ${caseMaterials.size} 段材料`);
}
if (usableCase.some((item) => !item.caseMaterial || !item.caseGroupSize || item.caseOrder > item.caseGroupSize)) {
  throw new Error("综合材料题的段落元数据不完整");
}
await import(pathToFileURL(resolve(appRoot, "exam-bank.js")).href);
const bank = globalThis.ExamBank;
// 模考也要走「没做过 → 做错过 → 做对了」+ 最近最少出题：连续两次模考的同一科目
// 不该再撞到同一段材料。材料段数少，纯随机时平均每次会重 1.5 段。
for (const subject of questionPayload.subjects) {
  const lastSeen = new Map();
  const rank = (question) => (lastSeen.has(question.id) ? 2e7 : 0) + Math.min(Math.floor((lastSeen.get(question.id) || 0) / 1800000), 9e6 - 1);
  let previous = new Set();
  for (let round = 0; round < 3; round += 1) {
    const drawn = bank.selectExam(questionPayload.questions, subject.id, rank).filter((question) => question.type === "case");
    if (drawn.length !== 10) throw new Error(`${subject.id} 模考综合题不足: ${drawn.length} 题`);
    const groups = new Set(drawn.map((question) => question.caseGroupId));
    const overlap = [...groups].filter((key) => previous.has(key)).length;
    if (round > 0 && overlap) throw new Error(`${subject.id} 连续两次模考重复了 ${overlap} 段综合材料`);
    for (const question of drawn) lastSeen.set(question.id, (round + 1) * 1800000);
    previous = groups;
  }
}
// 同一题干不会在同一组练习/同一张卷子里出现两次：直接对题库跑一遍组卷用的去重函数。
const stemBuckets = new Map();
for (const question of questionPayload.questions) {
  const key = bank.normalizedStem(question);
  if (!stemBuckets.has(key)) stemBuckets.set(key, []);
  stemBuckets.get(key).push(question);
}
const realDuplicateGroup = [...stemBuckets.values()].find((group) => group.length > 1 && group.every((question) => question.type !== "case"));
if (!realDuplicateGroup) throw new Error("题库里没有可用于验证去重的同题干题目");
const deduped = bank.uniqByStem(realDuplicateGroup, realDuplicateGroup.length);
if (deduped.length !== 1 || deduped[0].id !== realDuplicateGroup[0].id) {
  throw new Error(`同题干题目没有被去重: ${JSON.stringify(deduped.map((question) => question.id))}`);
}
const distinctDraw = bank.uniqByStem(questionPayload.questions.filter((question) => question.type !== "case").slice(0, 40), 40);
if (distinctDraw.length !== 40) throw new Error(`去重后题量被削减: ${distinctDraw.length}`);
for (const subject of questionPayload.subjects) {
  for (const [type, count] of [["single", 40], ["multiple", 40], ["judgment", 30]]) {
    const pool = questionPayload.questions.filter((question) => question.subjectId === subject.id && question.type === type);
    if (bank.uniqByStem(pool, count).length !== count) {
      throw new Error(`${subject.id}/${type} 去重后凑不满 ${count} 题：题库不足或去重过度`);
    }
  }
}
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

// 冲刺计划：倒计时、当前段落高亮、任务深链接和完成态都要工作。
await page.click('[data-nav="plan"]');
await page.waitForSelector(".plan-block");
const expectedLawMultiYear = questionPayload.questions.filter((question) => question.subjectId === "law" && question.examEligible !== false && /多年考点/.test(question.repeatLabel || "")).length;
const sprintPlanSnapshot = await page.evaluate(() => {
  const countdown = document.querySelector("[data-sprint-clock]")?.textContent.trim() || "";
  const multiYearButton = [...document.querySelectorAll('[data-action="sprint-task"]')].find((button) => button.textContent.includes("刷法规多年考点"));
  return {
    view: document.querySelector(".page-title h2")?.textContent,
    countdown,
    blocks: document.querySelectorAll(".plan-block").length,
    checkboxes: document.querySelectorAll("[data-sprint-block]").length,
    examBlocks: document.querySelectorAll(".plan-block.exam").length,
    current: document.querySelector(".plan-block.current")?.dataset.blockId || null,
    hasCurrentMarker: Boolean(document.querySelector(".plan-now")),
    multiYearLabel: multiYearButton?.textContent.trim() || "",
    taskCount: document.querySelectorAll('[data-action="sprint-task"]').length
  };
});
const expectedPlanBlocks = sprintPlan.blocks.length;
const expectedPlanExams = sprintPlan.blocks.filter((block) => block.kind === "exam").length;
if (sprintPlanSnapshot.view !== "冲刺计划" || sprintPlanSnapshot.blocks !== expectedPlanBlocks || sprintPlanSnapshot.checkboxes !== expectedPlanBlocks - expectedPlanExams || sprintPlanSnapshot.examBlocks !== expectedPlanExams) {
  throw new Error(`冲刺计划结构不对: ${JSON.stringify(sprintPlanSnapshot)}`);
}
if (!/^(?:\d+ 天 )?\d{2}:\d{2}:\d{2}$/.test(sprintPlanSnapshot.countdown)) {
  throw new Error(`冲刺计划倒计时格式不对: ${sprintPlanSnapshot.countdown}`);
}
if (!sprintPlanSnapshot.hasCurrentMarker || !sprintPlanSnapshot.multiYearLabel.includes(`${expectedLawMultiYear} 题`)) {
  throw new Error(`冲刺计划缺少当前段落或多年考点题量: ${JSON.stringify(sprintPlanSnapshot)}`);
}
// 点任务按钮应当带着条件直接进练习：法规多年考点一共 36 题。
await page.evaluate(() => {
  [...document.querySelectorAll('[data-action="sprint-task"]')].find((button) => button.textContent.includes("刷法规多年考点")).click();
});
await page.waitForSelector(".question-card");
const sprintTaskSession = await page.evaluate(() => {
  const context = window.ExamApp.getChatContext();
  return { mode: context.mode, total: context.total, subject: context.question?.subject };
});
if (sprintTaskSession.mode !== "practice" || sprintTaskSession.total !== expectedLawMultiYear || sprintTaskSession.subject !== "证券市场基本法律法规") {
  throw new Error(`冲刺计划任务没有带对条件: ${JSON.stringify({ sprintTaskSession, expectedLawMultiYear })}`);
}
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-nav="plan"]');
// 勾选完成要写进档案，切走再回来仍然勾着。
await page.click('[data-nav="plan"]');
await page.waitForSelector("[data-sprint-block]");
const sprintBlockId = await page.evaluate(() => {
  const box = document.querySelector("[data-sprint-block]");
  box.click();
  return box.dataset.sprintBlock;
});
await page.evaluate(() => window.StudyDb.flush());
await page.click('[data-nav="dashboard"]');
await page.click('[data-nav="plan"]');
await page.waitForSelector("[data-sprint-block]");
const sprintProgress = await page.evaluate((id) => ({
  checked: document.querySelector(`[data-sprint-block="${id}"]`)?.checked || false,
  stored: JSON.parse(window.StudyDb.getSetting("sprint:done") || "[]"),
  label: document.querySelector(".sprint-progress")?.textContent || ""
}), sprintBlockId);
if (!sprintProgress.checked || !sprintProgress.stored.includes(sprintBlockId) || sprintProgress.label !== `已完成 1 / ${expectedPlanBlocks - expectedPlanExams} 段`) {
  throw new Error(`冲刺计划完成态没有持久化: ${JSON.stringify(sprintProgress)}`);
}
await page.screenshot({ path: resolve(screenshotDir, "smoke-sprint-plan.png"), fullPage: true });
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
const knowledgeCardsShape = await page.$$eval(".knowledge-card", (nodes) => {
  const withPoints = nodes.filter((node) => node.querySelectorAll(".knowledge-points li").length > 0);
  const withNotes = nodes.filter((node) => node.querySelector('.imported-links a[href*="notes-finance.html#page-"]'));
  const withTextbook = nodes.filter((node) => node.querySelector('.imported-links a[href*="base-knowledge.html#page-"]'));
  const first = nodes[0];
  return {
    total: nodes.length,
    withPoints: withPoints.length,
    withNotes: withNotes.length,
    withTextbook: withTextbook.length,
    badge: first?.querySelector(".source-tag")?.textContent || "",
    hasQuote: Boolean(first?.querySelector(".binding-quote blockquote")?.textContent.trim()),
    hasFrequencyBlock: Boolean(first?.querySelector(".knowledge-exam-frequency, .knowledge-panel-note")),
    legacyFields: nodes.filter((node) => /理解与边界|记忆钩子|正确说法|错误说法|考试提示/.test(node.textContent)).length
  };
});
if (knowledgeCardsShape.withPoints !== knowledgeCardsShape.total || knowledgeCardsShape.withNotes !== knowledgeCardsShape.total || knowledgeCardsShape.withTextbook < knowledgeCardsShape.total * 0.9 || knowledgeCardsShape.badge !== "三色笔记原文" || !knowledgeCardsShape.hasQuote || !knowledgeCardsShape.hasFrequencyBlock || knowledgeCardsShape.legacyFields !== 0) {
  throw new Error(`Knowledge cards are not note-sourced: ${JSON.stringify(knowledgeCardsShape)}`);
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
await page.$eval("#knowledge-K-F-010", (node) => node.scrollIntoView({ block: "start" }));
await new Promise((resolveWait) => setTimeout(resolveWait, 450));
const savedReadingPosition = await page.evaluate(() => window.ExamApp.getLastReadingPosition());
if (savedReadingPosition?.nodeId !== "knowledge-K-F-010" || savedReadingPosition?.outlineMode !== "guide" || savedReadingPosition?.knowledgeSubject !== "finance") {
  throw new Error(`Reading position was not saved at K-F-010: ${JSON.stringify(savedReadingPosition)}`);
}
await page.reload({ waitUntil: "load" });
await page.waitForSelector("#knowledge-K-F-010", { timeout: 15000 });
await page.waitForFunction(() => {
  const node = document.querySelector("#knowledge-K-F-010");
  return node && Math.abs(node.getBoundingClientRect().top - 18) <= 2;
});
const readingPositionRestore = await page.evaluate(() => ({
  position: window.ExamApp.getLastReadingPosition(),
  subject: document.querySelector("#knowledge-subject")?.value || "",
  guideActive: document.querySelector('[data-action="outline-mode"][data-mode="guide"]')?.classList.contains("active"),
  nodeTop: Math.round(document.querySelector("#knowledge-K-F-010")?.getBoundingClientRect().top || 0),
  activeChapter: document.querySelector(".toc-button.active")?.dataset.anchor || ""
}));
if (readingPositionRestore.position?.nodeId !== "knowledge-K-F-010" || readingPositionRestore.subject !== "finance" || !readingPositionRestore.guideActive || readingPositionRestore.nodeTop !== 18 || readingPositionRestore.activeChapter !== "knowledge-chapter-finance-2") {
  throw new Error(`Reading position did not restore: ${JSON.stringify(readingPositionRestore)}`);
}
await page.click('[data-action="start-memory"][data-chapter="finance-2"]');
await page.waitForSelector(".memory-card");
await page.click('[data-action="reveal-memory"]');
await page.waitForSelector(".memory-answer .knowledge-points li");
await page.click('[data-action="grade-memory"][data-grade="known"]');
const memoryReviewSaved = await page.evaluate(() => window.StudyDb.getKnowledgeReviews().some((row) => row.knowledge_id === "K-F-008" && row.grade === "known"));
if (!memoryReviewSaved) throw new Error("Knowledge memory review was not saved");
await page.click('[data-action="exit-memory"]');
await page.waitForSelector(".knowledge-card");
await page.select("#knowledge-subject", "law");
await page.waitForFunction((expected) => document.querySelectorAll(".knowledge-card").length === expected, {}, expectedLawKnowledge);
const lawKnowledgeCards = await page.$$eval(".knowledge-card", (nodes) => nodes.length);
const lawKnowledgeShape = await page.$$eval(".knowledge-card", (nodes) => {
  const withTextbook = nodes.filter((node) => node.querySelector('.imported-links a[href*="law-regulations.html#page-"]'));
  const first = withTextbook[0];
  return {
    total: nodes.length,
    withNotes: nodes.filter((node) => node.querySelector('.imported-links a[href*="notes-law.html#page-"]')).length,
    withTextbook: withTextbook.length,
    badge: first?.querySelector(".tag.binding-suggested")?.textContent || "",
    href: first?.querySelector('.imported-links a[href*="law-regulations.html"]')?.getAttribute("href") || "",
    intro: document.querySelector(".knowledge-intro")?.textContent || ""
  };
});
if (lawKnowledgeShape.withNotes !== lawKnowledgeShape.total || lawKnowledgeShape.withTextbook < lawKnowledgeShape.total * 0.5 || lawKnowledgeShape.badge !== "教材参考" || !/law-regulations\.html#page-\d+$/.test(lawKnowledgeShape.href) || !lawKnowledgeShape.intro.includes("历史辅助教材")) {
  throw new Error(`Law knowledge guide is not note-sourced: ${JSON.stringify(lawKnowledgeShape)}`);
}
await page.$eval(".knowledge-card", (node) => node.scrollIntoView({ block: "start" }));
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
if (!/第 1\/\d+ 问/.test(casePracticeHeader)) throw new Error(`Case practice did not start at a complete pack: ${casePracticeHeader}`);
const casePracticeTimer = await page.$eval("#session-timer", (node) => node.textContent.trim());
if (!/^建议用时 00:1[0-9]:\d{2}$/.test(casePracticeTimer)) throw new Error(`Case practice timer is not scaled to the selected count: ${casePracticeTimer}`);
const casePracticeContext = await page.evaluate(() => window.ExamApp.getChatContext());
if (casePracticeContext.scoringScheme !== "paper-100-v1" || casePracticeContext.totalPoints !== casePracticeContext.total) {
  throw new Error(`Case practice does not use the shared scoring rule: ${JSON.stringify({ scheme: casePracticeContext.scoringScheme, points: casePracticeContext.totalPoints, total: casePracticeContext.total })}`);
}
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-nav="practice"]');
await page.click('[data-nav="practice"]');
await page.waitForSelector('[data-action="start-practice"]');
await page.click('[data-action="start-practice"]');
await page.waitForSelector(".question-card");
const practiceTimer = await page.$eval("#session-timer", (node) => node.textContent.trim());
if (!/^建议用时 00:(29|30):\d{2}$/.test(practiceTimer)) throw new Error(`Practice timer is not scaled to the selected question count: ${practiceTimer}`);
const practiceHeader = await page.$eval(".session-meta", (node) => node.textContent);
if (!/章节练习 · 第 1\/\d+ 题 · 已完成 0 题/.test(practiceHeader)) throw new Error(`Practice header lost the answered count: ${practiceHeader}`);
const chatQuestionContext = await page.evaluate(() => window.ExamApp.getChatContext());
if (!chatQuestionContext.question?.id || chatQuestionContext.question.submitted || !chatQuestionContext.guidance?.includes("不直接揭晓答案")) {
  throw new Error(`Question chat context invalid: ${JSON.stringify(chatQuestionContext)}`);
}
// 全部章节练习按模拟卷题型比例抽题：30 题档位是 10 单选 / 10 多选 / 8 判断 / 2 综合。
const expectedComposition = [["单选", 10], ["多选", 10], ["判断", 8], ["综合", 2]];
const practiceComposition = chatQuestionContext.composition || {};
if (chatQuestionContext.total !== 30 || Object.keys(practiceComposition).length !== expectedComposition.length ||
  expectedComposition.some(([label, count]) => practiceComposition[label] !== count)) {
  throw new Error(`Practice composition does not follow the exam ratio: ${JSON.stringify(practiceComposition)}`);
}
if (chatQuestionContext.scoringScheme !== "paper-100-v1" || chatQuestionContext.totalPoints !== 25) {
  throw new Error(`Practice scoring does not follow the exam rule: ${JSON.stringify({ scheme: chatQuestionContext.scoringScheme, points: chatQuestionContext.totalPoints })}`);
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
  noteLink: document.querySelector('.imported-links a[href*="notes-"][href*="#page-"]')?.getAttribute("href") || "",
  hasQuote: Boolean(document.querySelector(".imported-links .binding-quote blockquote")?.textContent.trim())
}));
if (!sourceBlocks.status.includes("历年整理题") || sourceBlocks.scope || !/#page-\d+$/.test(sourceBlocks.noteLink) || !sourceBlocks.hasQuote) throw new Error(`Question source block missing: ${JSON.stringify(sourceBlocks)}`);
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

// 章节练习结束时给出当次看板：正确率、用时、章节/题型明细与错题清单。
await page.click('[data-nav="practice"]');
await page.waitForSelector("#practice-count");
const practiceNotice = await page.$eval(".form-grid .notice", (node) => node.textContent.replace(/\s+/g, " "));
const unseenBefore = Number(practiceNotice.match(/其中 (\d+) 道还没做过/)?.[1]);
if (!Number.isFinite(unseenBefore) || !practiceNotice.includes("没做过 → 做错过 → 已做对")) {
  throw new Error(`Practice panel does not advertise unseen-first selection: ${practiceNotice}`);
}
// 题量档位切换后，面板要如实预告本组按模拟卷比例分配的结果。
await page.select("#practice-count", "120");
const ratioNotice = await page.$eval(".form-grid .notice", (node) => node.textContent.replace(/\s+/g, " "));
if (!ratioNotice.includes("按模拟卷题型比例分配") || !ratioNotice.includes("单选 40 题 · 多选 40 题 · 判断 30 题 · 综合 10 题")) {
  throw new Error(`Practice panel does not advertise the 120-question exam ratio: ${ratioNotice}`);
}
await page.select("#practice-count", "30");
await page.click('[data-action="start-practice"]');
await page.waitForSelector(".question-card");
// 单选画 radio、多选画 checkbox，每个选项前都要有图标，且同一组练习不能出现同一题干。
const optionControls = new Set();
const walkedStems = new Set();
for (let index = 0; index < 30; index += 1) {
  const questionCard = await page.evaluate(() => {
    const node = document.querySelector(".question-card");
    const normalize = (text) => String(text || "").replace(/[\s，。、“”：（）()【】.．]/g, "");
    return {
      tag: node.querySelector(".question-tags .tag")?.textContent.trim() || "",
      stem: normalize(node.querySelector(".question-stem")?.textContent),
      types: [...new Set([...node.querySelectorAll(".option-input")].map((input) => input.type))],
      controls: node.querySelectorAll(".option").length,
      inputs: node.querySelectorAll(".option-input").length,
      icons: node.querySelectorAll(".option-icon svg").length,
      keys: node.querySelectorAll(".option .option-key").length
    };
  });
  // 综合材料题里既有单选也有多选的小问，按题型标签判断控件类型。
  const expectedControl = questionCard.tag === "多选" ? "checkbox" : questionCard.tag === "综合" ? questionCard.types[0] : "radio";
  if (questionCard.inputs !== questionCard.controls || questionCard.icons !== questionCard.controls || questionCard.keys !== questionCard.controls || questionCard.types.length !== 1 || questionCard.types[0] !== expectedControl) {
    throw new Error(`Option controls are not radio/checkbox with icons: ${JSON.stringify(questionCard)}`);
  }
  if (!questionCard.stem || walkedStems.has(questionCard.stem)) {
    throw new Error(`同一组练习出现重复题干: ${questionCard.stem.slice(0, 40)}`);
  }
  optionControls.add(questionCard.types[0]);
  walkedStems.add(questionCard.stem);
  await page.click(".question-card .option");
  await page.click('[data-action="submit-question"]');
  await page.waitForSelector(".explanation");
  if (index === 0) {
    const gradedIcons = await page.evaluate(() => ({
      correct: document.querySelectorAll(".question-card .option-icon.correct svg").length,
      marked: document.querySelectorAll(".question-card .option-icon.chosen svg").length
    }));
    if (!gradedIcons.correct || !gradedIcons.marked) throw new Error(`判卷后选项图标没有给出对错提示: ${JSON.stringify(gradedIcons)}`);
  }
  await page.click('[data-action="next-question"]');
  if (index < 29) await page.waitForFunction((next) => document.querySelector(".session-meta")?.textContent.includes(`第 ${next}/30 题`), {}, index + 2);
}
if (!optionControls.has("radio") || !optionControls.has("checkbox")) {
  throw new Error(`这一组题没有同时覆盖单选与多选的选项控件: ${[...optionControls].join(",")}`);
}
await page.waitForSelector(".practice-result");
const practiceBoard = await page.evaluate(() => {
  const board = document.querySelector(".practice-result");
  const text = board.textContent.replace(/\s+/g, " ");
  return {
    score: board.querySelector(".practice-result-score")?.textContent || "",
    metrics: board.querySelectorAll(".practice-result-metrics > div").length,
    tables: document.querySelectorAll(".session-shell .table").length,
    hasPace: text.includes("建议用时") && text.includes("用时"),
    hasRetry: Boolean(board.querySelector('[data-action="retry-practice-all"]')),
    hasWrongBlock: Boolean(document.querySelector(".practice-result-wrong")),
    points: board.querySelector(".practice-result-points")?.textContent.replace(/\s+/g, " ") || ""
  };
});
if (!/^\d+%$/.test(practiceBoard.score) || practiceBoard.metrics !== 4 || practiceBoard.tables < 3 || !practiceBoard.hasPace || !practiceBoard.hasRetry || !practiceBoard.hasWrongBlock) {
  throw new Error(`Practice result board is incomplete: ${JSON.stringify(practiceBoard)}`);
}
// 全部章节练习沿用模考计分：30 题档满分 25（单选 0.5 分，其余每题 1 分）。
if (!/得分 [\d.]+ \/ 25 分/.test(practiceBoard.points) || !practiceBoard.points.includes("单选 0.5 分")) {
  throw new Error(`Paper-style practice does not show the exam score: ${practiceBoard.points}`);
}
await page.click('[data-action="review-practice-all"]');
await page.waitForSelector(".question-card");
const practiceReviewHeader = await page.$eval(".session-meta", (node) => node.textContent);
if (!/练习复盘 · 第 1\/30 题/.test(practiceReviewHeader)) throw new Error(`Practice review header invalid: ${practiceReviewHeader}`);
await page.click('[data-action="exit-session"]');
await page.waitForSelector(".practice-result");
await page.click('[data-action="retry-practice-all"]');
await page.waitForSelector(".question-card");
const practiceRetryHeader = await page.$eval(".session-meta", (node) => node.textContent);
if (!/章节练习 · 第 1\/30 题/.test(practiceRetryHeader)) throw new Error(`Practice retry header invalid: ${practiceRetryHeader}`);
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-action="start-exam"]');

// 未做题优先：这一轮 30 题此前都没做过，完成后未做题数应恰好减少 30。
await page.click('[data-nav="practice"]');
await page.waitForSelector("#practice-count");
const unseenAfter = Number((await page.$eval(".form-grid .notice", (node) => node.textContent)).match(/其中 (\d+) 道还没做过/)?.[1]);
if (!Number.isFinite(unseenAfter) || unseenBefore - unseenAfter !== 30) {
  throw new Error(`Practice did not prefer unseen questions: before=${unseenBefore} after=${unseenAfter}`);
}
// 指定章节的练习也统一按同一套计分：满分等于本组题目的分数之和。
await page.waitForSelector("#practice-chapter");
const chapterValue = await page.$$eval("#practice-chapter option", (nodes) => nodes.find((node) => node.value !== "all")?.value || "");
await page.select("#practice-chapter", chapterValue);
await page.click('[data-action="start-practice"]');
await page.waitForSelector(".question-card");
const chapterPracticeContext = await page.evaluate(() => window.ExamApp.getChatContext());
const chapterPracticePoints = Object.entries(chapterPracticeContext.composition).reduce((sum, [label, count]) => sum + (label === "单选" ? count * 0.5 : count), 0);
if (chapterPracticeContext.scoringScheme !== "paper-100-v1" || chapterPracticeContext.totalPoints !== chapterPracticePoints) {
  throw new Error(`Chapter practice scoring invalid: ${JSON.stringify({ scheme: chapterPracticeContext.scoringScheme, points: chapterPracticeContext.totalPoints, expected: chapterPracticePoints, composition: chapterPracticeContext.composition })}`);
}
await page.click('[data-action="exit-session"]');
await page.waitForSelector('[data-nav="dashboard"]');
await page.click('[data-nav="practice"]');
await page.waitForSelector("#practice-chapter");
await page.select("#practice-chapter", "all");
await page.click('[data-nav="dashboard"]');
await page.waitForSelector('[data-action="start-exam"]');
await page.click('[data-action="start-exam"]');
await page.waitForSelector(".question-card");

const examBlueprint = await page.evaluate(() => {
  const active = window.StudyDb.getActiveExam();
  const map = new Map(window.QUESTION_DATA.questions.map((question) => [question.id, question]));
  const factCounts = new Map();
  for (const id of active.questionIds) {
    const question = map.get(id);
    const factId = question?.knowledgeLinks?.[0]?.knowledgeId;
    factCounts.set(factId, (factCounts.get(factId) || 0) + 1);
  }
  const caseEntries = active.questionIds.map((id, index) => ({ question: map.get(id), index })).filter((entry) => entry.question?.type === "case");
  const caseGroups = Object.groupBy(caseEntries, (entry) => entry.question.caseGroupId);
  const completeAndConsecutive = Object.values(caseGroups).every((entries) =>
    entries.every((entry) => entry.question.caseGroupSize >= entry.question.caseOrder) &&
    entries.map((entry) => entry.question.caseOrder).every((order, index) => index === 0 || order >= entries[index - 1].question.caseOrder) &&
    entries.every((entry, index) => index === 0 || entry.index === entries[index - 1].index + 1)
  );
  return {
    total: active.questionIds.length,
    uniqueFacts: factCounts.size,
    maxVariantsPerFact: Math.max(...factCounts.values()),
    typeCounts: Object.groupBy(active.questionIds.map((id) => map.get(id)), (question) => question?.type),
    caseQuestions: caseEntries.length,
    caseGroups: Object.keys(caseGroups).length,
    completeAndConsecutive
  };
});
if (examBlueprint.total !== 120 || examBlueprint.caseQuestions !== 10 || examBlueprint.caseGroups < 1 || !examBlueprint.completeAndConsecutive || examBlueprint.typeCounts.single?.length !== 40 || examBlueprint.typeCounts.multiple?.length !== 40 || examBlueprint.typeCounts.judgment?.length !== 30) throw new Error(`Invalid exam blueprint: ${JSON.stringify(examBlueprint)}`);

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
  document.querySelector(".source-status")?.textContent.includes("历年整理题") &&
  document.querySelector('.imported-links a[href*="notes-"][href*="#page-"]')
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
  knowledgeCardsShape,
  textbookViewer,
  lawKnowledgeShape,
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
