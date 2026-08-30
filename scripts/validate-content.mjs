import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const payload = JSON.parse(readFileSync(resolve(root, "data/questions.json"), "utf8"));
const outline = JSON.parse(readFileSync(resolve(root, "data/outline.json"), "utf8"));
const coverageReport = JSON.parse(readFileSync(resolve(root, "data/coverage-report.json"), "utf8"));
const officialTextbookText = readFileSync(resolve(root, "docs/base-knowledge.txt"), "utf8");
const historicalLawTextbookText = readFileSync(resolve(root, "docs/law-regulations.txt"), "utf8");
const officialTextbookParts = officialTextbookText.split(/^===== PDF 第 (\d+) 页 =====\s*$/m);
const officialTextbookPages = new Map();
for (let index = 1; index < officialTextbookParts.length; index += 2) {
  officialTextbookPages.set(Number(officialTextbookParts[index]), officialTextbookParts[index + 1].trim());
}
const historicalLawTextbookParts = historicalLawTextbookText.split(/^===== PDF 第 (\d+) 页 =====\s*$/m);
const historicalLawTextbookPages = new Map();
for (let index = 1; index < historicalLawTextbookParts.length; index += 2) {
  historicalLawTextbookPages.set(Number(historicalLawTextbookParts[index]), historicalLawTextbookParts[index + 1].trim());
}
const chapterIds = new Set(payload.chapters.map((item) => item.id));
const ids = new Set();
const errors = [];
const warnings = [];
const answerPositions = { A: 0, B: 0, C: 0, D: 0 };
const multiCombinations = new Map();
const factCounts = new Map();
const caseGroups = new Map();
const allowedCitationKinds = new Set(["scope", "authority", "textbook"]);
const allowedSourceClasses = new Set(["china_law", "china_official", "china_official_textbook", "international_standard", "general_textbook", "historical_exam_textbook"]);

function validateCitation(citation, owner) {
  if (!allowedCitationKinds.has(citation.kind)) errors.push(`${owner}: invalid citation kind ${citation.kind}`);
  if (!citation.title || !citation.quote || !citation.locator) errors.push(`${owner}: incomplete citation`);
  if (citation.kind !== "scope" && citation.sourceClass !== "historical_exam_textbook" && !citation.url) errors.push(`${owner}: reference citation needs a URL`);
  if (citation.kind !== "scope" && !allowedSourceClasses.has(citation.sourceClass)) errors.push(`${owner}: invalid source class ${citation.sourceClass}`);
  if (citation.kind !== "scope" && typeof citation.answerBasis !== "boolean") errors.push(`${owner}: reference must declare whether it is an answer basis`);
  if ((citation.sourceClass === "china_law" || citation.sourceClass === "china_official" || citation.sourceClass === "china_official_textbook") && (citation.kind !== "authority" || citation.answerBasis !== true)) {
    errors.push(`${owner}: Chinese law/official source must be an authority answer basis`);
  }
  if (citation.sourceClass === "china_official_textbook") {
    const sourcePage = officialTextbookPages.get(citation.page);
    if (!sourcePage) errors.push(`${owner}: official textbook page ${citation.page} missing`);
    if (!citation.textNotice || !citation.fullTextPath) errors.push(`${owner}: official textbook citation needs text provenance`);
    if (sourcePage && !sourcePage.replace(/\s+/g, "").includes(citation.quote.replace(/\s+/g, ""))) {
      errors.push(`${owner}: official textbook quote does not match source page ${citation.page}`);
    }
  }
  if (citation.sourceClass === "historical_exam_textbook") {
    const sourcePage = historicalLawTextbookPages.get(citation.page);
    if (citation.kind !== "textbook" || citation.answerBasis !== false) errors.push(`${owner}: historical exam textbook must be a non-answer textbook reference`);
    if (!sourcePage) errors.push(`${owner}: historical law textbook page ${citation.page} missing`);
    if (!citation.textNotice || !citation.fullTextPath || !citation.publisher || !citation.effectiveDate) errors.push(`${owner}: historical law textbook citation needs provenance and version warnings`);
    if (citation.quote.replace(/\s+/g, "").length > 360) errors.push(`${owner}: historical law textbook quote exceeds 360 characters`);
    if (sourcePage && !sourcePage.replace(/\s+/g, "").includes(citation.quote.replace(/\s+/g, ""))) {
      errors.push(`${owner}: historical law textbook quote does not match source page ${citation.page}`);
    }
  }
  if (citation.sourceClass === "international_standard" && (citation.kind !== "authority" || citation.answerBasis !== false || !citation.originalQuote)) {
    errors.push(`${owner}: international standard must be a non-China supporting authority with original text`);
  }
  if (citation.kind === "textbook" && citation.sourceClass === "general_textbook") {
    if (citation.sourceClass !== "general_textbook" || citation.answerBasis !== false) errors.push(`${owner}: open textbook must be classified as non-official supplementary material`);
    if (!citation.originalQuote || !citation.publisher || !citation.license || !citation.jurisdiction) errors.push(`${owner}: incomplete textbook citation`);
    if (!/^https:\/\//.test(citation.url || "")) errors.push(`${owner}: textbook citation URL must use HTTPS`);
  } else if (citation.kind === "textbook" && citation.sourceClass !== "historical_exam_textbook") {
    errors.push(`${owner}: unsupported textbook source class ${citation.sourceClass}`);
  }
  if (citation.kind !== "scope" && citation.url && !/^https:\/\//.test(citation.url)) errors.push(`${owner}: reference citation URL must use HTTPS`);
  if (citation.localPath) {
    const local = citation.localPath.replace(/^\.\//, "").split("#")[0];
    if (!existsSync(resolve(root, local))) errors.push(`${owner}: missing local citation file ${local}`);
  }
  if (citation.title.includes("一般业务水平评价测试大纲") && citation.page) {
    const page = outline.pages.find((item) => item.page === citation.page);
    if (!page || !page.text.replace(/\s+/g, "").includes(citation.quote.replace(/\s+/g, ""))) {
      errors.push(`${owner}: outline quote does not match page ${citation.page}`);
    }
  }
}

if (!Array.isArray(payload.knowledgePoints) || payload.knowledgePoints.length !== payload.meta.factCount) {
  errors.push(`knowledge point count must equal fact count ${payload.meta.factCount}`);
} else {
  const knowledgeIds = new Set();
  for (const point of payload.knowledgePoints) {
    if (knowledgeIds.has(point.id)) errors.push(`duplicate knowledge point ${point.id}`);
    knowledgeIds.add(point.id);
    if (!chapterIds.has(point.chapterId)) errors.push(`${point.id}: unknown knowledge chapter`);
    if (!point.topic || !point.statement || !point.explanation) errors.push(`${point.id}: incomplete knowledge content`);
    if (!point.keyPoints?.length || !point.commonMistakes?.length) errors.push(`${point.id}: missing knowledge lists`);
    if (point.detailSections && !Array.isArray(point.detailSections)) errors.push(`${point.id}: invalid detail sections`);
    for (const section of point.detailSections || []) {
      if (!section.title || !Array.isArray(section.points) || !section.points.length) errors.push(`${point.id}: incomplete detail section`);
    }
    if (point.examTips && !Array.isArray(point.examTips)) errors.push(`${point.id}: invalid exam tips`);
    if (!point.citations?.length) errors.push(`${point.id}: missing knowledge citation`);
    for (const citation of point.citations || []) validateCitation(citation, point.id);
    if (point.subjectId === "finance" && !(point.citations || []).some((citation) => citation.kind === "authority" || citation.kind === "textbook")) {
      errors.push(`${point.id}: finance knowledge point needs a non-syllabus reference`);
    }
    if (point.subjectId === "finance" && !(point.citations || []).some((citation) => citation.sourceClass === "china_official_textbook")) {
      errors.push(`${point.id}: finance knowledge point needs an official textbook citation`);
    }
    const lawNumber = point.subjectId === "law" ? Number(point.id.replace(/\D/g, "")) : 0;
    if (point.subjectId === "law" && lawNumber >= 71 && !(point.citations || []).some((citation) =>
      citation.answerBasis === true && (citation.sourceClass === "china_law" || citation.sourceClass === "china_official")
    )) {
      errors.push(`${point.id}: expanded law knowledge point needs a current Chinese authority answer basis`);
    }
  }
}

for (const question of payload.questions) {
  if (ids.has(question.id)) errors.push(`duplicate id ${question.id}`);
  ids.add(question.id);
  if (!chapterIds.has(question.chapterId)) errors.push(`${question.id}: unknown chapter`);
  if (!question.factId) errors.push(`${question.id}: missing factId`);
  factCounts.set(question.factId, (factCounts.get(question.factId) || 0) + 1);
  if (question.verificationStatus !== "outline_checked") errors.push(`${question.id}: invalid verification status`);
  if (!question.stem || !question.explanation) errors.push(`${question.id}: missing stem/explanation`);
  if (!Array.isArray(question.options) || question.options.length < 2) errors.push(`${question.id}: invalid options`);
  const optionIds = new Set(question.options.map((option) => option.id));
  if (optionIds.size !== question.options.length) errors.push(`${question.id}: duplicate option ids`);
  if (new Set(question.options.map((option) => option.text.trim())).size !== question.options.length) warnings.push(`${question.id}: duplicate option text`);
  if (!question.correctOptionIds.length || question.correctOptionIds.some((id) => !optionIds.has(id))) errors.push(`${question.id}: invalid answers`);
  if (question.type === "single" || question.type === "case") {
    if (question.correctOptionIds.length !== 1) errors.push(`${question.id}: single/case must have one answer`);
    else answerPositions[question.correctOptionIds[0]] += 1;
  }
  if (question.type === "case") {
    if (!question.caseMaterial || !question.caseGroupId || !question.caseGroupTitle || !question.caseOrder || !question.caseGroupSize) errors.push(`${question.id}: incomplete case-pack metadata`);
    const group = caseGroups.get(question.caseGroupId) || [];
    group.push(question); caseGroups.set(question.caseGroupId, group);
  } else if (question.caseGroupId || question.caseMaterial) {
    errors.push(`${question.id}: non-case question has case-pack metadata`);
  }
  if (question.type === "multiple") {
    if (question.correctOptionIds.length < 2) errors.push(`${question.id}: multiple needs >=2 answers`);
    const combination = [...question.correctOptionIds].sort().join("");
    multiCombinations.set(combination, (multiCombinations.get(combination) || 0) + 1);
  }
  if (!question.citations?.length) errors.push(`${question.id}: missing citation`);
  for (const citation of question.citations || []) validateCitation(citation, question.id);
}

for (const [factId, count] of factCounts) {
  if (count !== 3) errors.push(`${factId}: expected 3 question variants, got ${count}`);
}
const positionValues = Object.values(answerPositions);
if (Math.max(...positionValues) - Math.min(...positionValues) > 15) errors.push(`unbalanced single answer positions ${JSON.stringify(answerPositions)}`);
if (multiCombinations.size < 6) errors.push("multiple choice answer combinations are too concentrated");
if (Math.max(...multiCombinations.values()) > payload.questions.filter((q) => q.type === "multiple").length * 0.3) errors.push("one multiple answer combination exceeds 30%");

const normalized = new Map();
for (const question of payload.questions) {
  const key = question.stem.replace(/[\s，。、“”：（）()]/g, "");
  if (normalized.has(key)) warnings.push(`similar stem: ${normalized.get(key)} / ${question.id}`);
  else normalized.set(key, question.id);
}

const counts = Object.groupBy(payload.questions, (question) => question.subjectId);
const typeCounts = Object.groupBy(payload.questions, (question) => question.type);
console.log(`Questions: ${payload.questions.length}`);
for (const [subject, items] of Object.entries(counts)) console.log(`  ${subject}: ${items.length}`);
for (const [type, items] of Object.entries(typeCounts)) console.log(`  type ${type}: ${items.length}`);
console.log(`Outline pages: ${outline.pages.length}; TOC items: ${outline.toc.length}`);
console.log(`Warnings: ${warnings.length}`);
if (warnings.length) console.log(warnings.slice(0, 20).map((item) => `  WARN ${item}`).join("\n"));
if (payload.questions.length !== payload.meta.factCount * 3 || payload.meta.questionCount !== payload.questions.length) {
  errors.push(`question metadata must describe exactly three variants per fact (${payload.meta.factCount} facts / ${payload.questions.length} questions)`);
}
if (payload.questions.length < 720 || payload.questions.length > 1500) errors.push("question count must be 720-1500 for two complete subject banks");
for (const subject of payload.subjects) {
  const subjectFacts = new Set(payload.questions.filter((q) => q.subjectId === subject.id).map((q) => q.factId));
  if (subjectFacts.size < 120) errors.push(`${subject.id}: needs at least 120 fact groups for a 120-question unique-fact exam`);
  const mockFactIds = [...subjectFacts].slice(0, 120);
  if (mockFactIds.length !== 120 || new Set(mockFactIds).size !== 120) errors.push(`${subject.id}: cannot form a 120-question unique-fact exam`);
  if (payload.meta.subjectFactCounts?.[subject.id] !== subjectFacts.size) errors.push(`${subject.id}: subject fact metadata is stale`);
}
if ((typeCounts.case || []).length < 20) errors.push("case question coverage is below 20");
if (payload.meta.caseQuestionCount !== (typeCounts.case || []).length || payload.meta.casePackCount !== caseGroups.size) errors.push("case-pack metadata counts are stale");
for (const [groupId, items] of caseGroups) {
  const expectedSize = items[0].caseGroupSize;
  if (expectedSize !== 4 || items.length !== expectedSize) errors.push(`${groupId}: case pack must contain exactly four questions`);
  if (new Set(items.map((item) => item.factId)).size !== items.length) errors.push(`${groupId}: case pack repeats a fact`);
  if (new Set(items.map((item) => item.caseMaterial)).size !== 1 || new Set(items.map((item) => item.caseGroupTitle)).size !== 1) errors.push(`${groupId}: case pack must share one material and title`);
  if (new Set(items.map((item) => item.subjectId)).size !== 1) errors.push(`${groupId}: case pack crosses subjects`);
  const orders = items.map((item) => item.caseOrder).sort((left, right) => left - right);
  if (orders.join(",") !== "1,2,3,4") errors.push(`${groupId}: case question order must be 1-4`);
}
for (const subject of payload.subjects) {
  const subjectGroups = [...caseGroups.values()].filter((items) => items[0].subjectId === subject.id);
  const expected = payload.meta.subjectCasePackCounts?.[subject.id];
  if (subjectGroups.length < 10 || expected !== subjectGroups.length) errors.push(`${subject.id}: needs at least 10 complete case packs and current metadata`);
}
if (officialTextbookPages.size !== 568) errors.push(`official textbook text must contain 568 pages, got ${officialTextbookPages.size}`);
if (historicalLawTextbookPages.size !== 274) errors.push(`historical law textbook text must contain 274 pages, got ${historicalLawTextbookPages.size}`);
const financeFactCount = payload.knowledgePoints.filter((point) => point.subjectId === "finance").length;
const expectedFinanceCoverage = `${financeFactCount}/${financeFactCount}`;
if (payload.meta.financeOfficialTextbookCoverage !== expectedFinanceCoverage || payload.meta.financeChinaAuthorityCoverage !== expectedFinanceCoverage || payload.meta.officialFinanceTextbook?.fullTextIntegrated !== true) {
  errors.push("official finance textbook integration metadata is incomplete");
}
const lawPoints = payload.knowledgePoints.filter((point) => point.subjectId === "law");
const historicalLawCount = lawPoints.filter((point) => point.citations.some((citation) => citation.sourceClass === "historical_exam_textbook")).length;
const currentLawAuthorityCount = lawPoints.filter((point) => point.citations.some((citation) =>
  citation.answerBasis === true && (citation.sourceClass === "china_law" || citation.sourceClass === "china_official")
)).length;
if (payload.meta.lawHistoricalTextbookCoverage !== `${historicalLawCount}/${lawPoints.length}` || payload.meta.historicalLawTextbook?.fullTextIntegrated !== true || payload.meta.historicalLawTextbook?.answerBasis !== false) {
  errors.push("historical law textbook integration metadata is incomplete or misclassified");
}
if (payload.meta.lawCurrentAuthorityCoverage !== `${currentLawAuthorityCount}/${lawPoints.length}`) errors.push("current law authority coverage metadata is stale");

if (coverageReport.meta?.factCount !== payload.meta.factCount || coverageReport.meta?.questionCount !== payload.questions.length) {
  errors.push("coverage report content counts are stale");
}
if (!coverageReport.meta?.limitation?.includes("自动近似映射") || !Array.isArray(coverageReport.requirements)) {
  errors.push("coverage report must disclose its approximate mapping limitation");
} else {
  const requirementIds = new Set();
  for (const requirement of coverageReport.requirements) {
    if (requirementIds.has(requirement.id)) errors.push(`coverage report duplicate requirement ${requirement.id}`);
    requirementIds.add(requirement.id);
    if (!chapterIds.has(requirement.chapterId)) errors.push(`${requirement.id}: coverage report has unknown chapter`);
    if (!new Set(["mapped", "partial", "unmapped"]).has(requirement.status)) errors.push(`${requirement.id}: invalid coverage status`);
    if (requirement.status === "unmapped" && requirement.factIds.length) errors.push(`${requirement.id}: unmapped requirement must not list facts`);
    if (requirement.factIds.some((factId) => !factCounts.has(factId))) errors.push(`${requirement.id}: coverage report references an unknown fact`);
    if (requirement.questionCount !== requirement.factIds.length * 3) errors.push(`${requirement.id}: coverage question count is stale`);
  }
  for (const subject of payload.subjects) {
    const summary = coverageReport.meta.bySubject?.[subject.id];
    const items = coverageReport.requirements.filter((item) => item.subjectId === subject.id);
    const mappedOrPartial = items.filter((item) => item.status !== "unmapped").length;
    if (!summary || summary.requirements !== items.length || summary.mapped + summary.partial + summary.unmapped !== items.length) {
      errors.push(`${subject.id}: coverage report summary is inconsistent`);
    }
    if (!summary || mappedOrPartial / items.length < 0.8) errors.push(`${subject.id}: approximate outline mapping fell below 80%`);
  }
  const reportFactIds = new Set((coverageReport.facts || []).map((item) => item.factId));
  if (reportFactIds.size !== payload.meta.factCount || [...factCounts.keys()].some((factId) => !reportFactIds.has(factId))) errors.push("coverage report must list every fact");
}
if (errors.length) {
  console.error(errors.map((item) => `ERROR ${item}`).join("\n"));
  process.exit(1);
}
console.log("Validation passed.");
