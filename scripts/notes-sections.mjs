// 把三色笔记识别文本解析成结构化知识点：按「第X章」分章，按「知识点N：标题」分段。
// 讲义与题目都只使用这里的原文，不再保留第一版的人工归纳内容。
function normalize(value) {
  return String(value || "").replace(/\s+/g, "");
}

// 章标题有时被识别到页面末尾，正文实际从下一页开始；用位置比例判断。
function chapterByPage(pages, chapters) {
  const byLabel = new Map();
  for (const chapter of chapters) {
    const match = normalize(chapter.title).match(/^第[一二三四五六七八九十]+章/);
    if (match) byLabel.set(match[0], chapter.id);
  }
  const result = new Map();
  let current = null;
  let pending = null;
  for (const page of [...pages.keys()].sort((left, right) => left - right)) {
    if (pending) { current = pending; pending = null; }
    const lines = String(pages.get(page) || "").split("\n").map(normalize).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].length > 30) continue;
      const match = lines[index].match(/^第[一二三四五六七八九十]+章/);
      if (!match || !byLabel.has(match[0])) continue;
      // 只有标题落在该页最后一行时，才认为正文从下一页开始。
      if (index === lines.length - 1) pending = byLabel.get(match[0]);
      else current = byLabel.get(match[0]);
      break;
    }
    result.set(page, current);
  }
  return result;
}

export function parseNotesSections({ pages, chapters, subjectId, idPrefix }) {
  const scopedChapters = chapters.filter((chapter) => chapter.subjectId === subjectId);
  const chapterPages = chapterByPage(pages, scopedChapters);
  const sections = [];
  let current = null;
  for (const page of [...pages.keys()].sort((left, right) => left - right)) {
    const chapterId = chapterPages.get(page) || null;
    const rawLines = String(pages.get(page) || "").split("\n");
    for (let index = 0; index < rawLines.length; index += 1) {
      const line = rawLines[index].trim();
      const compact = normalize(line);
      const match = compact.match(/^知识点([0-9〇零一二三四五六七八九十百]+)[：:](.*)$/);
      if (match) {
        if (!chapterId) { current = null; continue; }
        current = {
          id: "", subjectId, chapterId, number: match[1], topic: match[2].trim(),
          page, pageEnd: page, lines: [], pageRanges: new Map(), pendingTitle: !match[2]
        };
        sections.push(current);
      }
      if (!current) continue;
      if (current.pendingTitle) {
        if (!line) continue;
        current.topic = line.slice(0, 60);
        current.pendingTitle = false;
        continue;
      }
      const range = current.pageRanges.get(page);
      if (!range) current.pageRanges.set(page, { start: index, end: index });
      else range.end = index;
      current.pageEnd = page;
      if (line && current.lines.length < 60) current.lines.push(line);
    }
  }
  sections.forEach((section, order) => {
    section.id = `${idPrefix}-${String(order + 1).padStart(3, "0")}`;
    section.topic = section.topic.replace(/[（(]☆+[）)]/g, "").trim() || `知识点${section.number}`;
    section.keywords = section.topic;
    const candidates = [...section.pageRanges.entries()].slice(0, 3).map(([page, range]) => {
      const rawLines = String(pages.get(page) || "").split("\n");
      let quote = rawLines.slice(range.start, range.end + 1).join("\n").trim();
      // 太短的段落扩到页尾，保证引文足够核对。
      if (normalize(quote).length < 60) {
        const tail = rawLines.slice(range.start).join("\n").trim();
        if (tail) quote = tail;
      }
      if (quote.length > 900) {
        quote = quote.slice(0, 900);
        const cut = quote.lastIndexOf("\n");
        if (cut > 300) quote = quote.slice(0, cut);
      }
      return { page, quote };
    });
    // 段落正好卡在页尾时该页只剩标题，丢弃过短的引文；全都很短时保留最长的一条。
    const usable = candidates.filter((link) => normalize(link.quote).length >= 20);
    if (usable.length) {
      section.bookLinks = usable;
    } else {
      // 整段都极短（一般是被识别到页尾的标题行）：向前多取几行凑成可核对的引文。
      const longest = [...candidates].sort((left, right) => normalize(right.quote).length - normalize(left.quote).length)[0];
      const range = section.pageRanges.get(longest.page);
      const rawLines = String(pages.get(longest.page) || "").split("\n");
      section.bookLinks = [{ page: longest.page, quote: rawLines.slice(Math.max(0, range.start - 8)).join("\n").trim() }];
    }
  });
  return sections;
}

// 反查题目绑定到的笔记页属于哪个知识点：用引文在页内的位置判断。
function sectionStartOffset(section, page, pageText) {
  const range = section.pageRanges.get(page);
  if (!range) return section.page <= page ? 0 : null;
  const before = pageText.split("\n").slice(0, range.start).join("\n");
  return normalize(before).length;
}

export function locateSection(sections, page, quote, pageText) {
  const here = sections.filter((section) => section.page <= page && page <= section.pageEnd);
  if (!here.length) return null;
  const offset = normalize(pageText).indexOf(normalize(quote));
  if (offset < 0) return here[0];
  let best = here[0];
  for (const section of here) {
    const start = sectionStartOffset(section, page, pageText);
    if (start !== null && start <= offset) best = section;
  }
  return best;
}
