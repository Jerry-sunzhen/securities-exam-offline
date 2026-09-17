(function () {
  const imported = (q) => q.verificationStatus === "source_transcribed";
  const available = (q) => q && q.examEligible !== false;
  const multiple = (q) => q.selectionMode === "multiple" || q.type === "multiple";
  const points = (q, scheme) => scheme === "paper-100-v1" && q.type === "single" ? 0.5 : 1;
  // 模拟卷沿用的考试卷题型题量：单选 40、多选 40、判断 30、综合 10，共 120 题。
  const PAPER_TYPES = [["single", 40], ["multiple", 40], ["judgment", 30], ["case", 10]];
  // 把样卷比例折算到任意题量：先按权重取整，余数按小数部分从大到小补足。
  function paperMix(count, types = null) {
    const active = PAPER_TYPES.filter(([type]) => !types || types.has(type));
    const totalWeight = active.reduce((sum, [, weight]) => sum + weight, 0);
    if (!active.length || count <= 0) return [];
    const plan = active.map(([type, weight]) => {
      const exact = count * weight / totalWeight;
      return { type, exact, count: Math.floor(exact) };
    });
    let remaining = count - plan.reduce((sum, item) => sum + item.count, 0);
    for (const item of [...plan].sort((left, right) => (right.exact - right.count) - (left.exact - left.count))) {
      if (remaining <= 0) break;
      item.count += 1;
      remaining -= 1;
    }
    return plan;
  }
  const normalizedStem = (q) => q.subjectId + ":" + q.stem.replace(/[\s，。、“”：（）()【】.．]/g, "");
  function matches(q, { bank = "all", year = "all", source = "all" } = {}) {
    return available(q) && (bank === "all" || (bank === "imported" ? imported(q) : !imported(q))) &&
      (year === "all" || q.origins?.some((o) => String(o.year) === String(year))) &&
      (source === "all" || q.origins?.some((o) => o.sourceId === source));
  }
  function shuffled(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function grouped(pool) {
    const groups = new Map();
    for (const q of pool) {
      const key = q.caseGroupId || q.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(q);
    }
    return [...groups.values()].map((g) => g.sort((a,b) => (a.caseOrder || 0)-(b.caseOrder || 0)));
  }
  // rankOf 可选：返回每题优先级（越小越优先），同一段材料取组内最高优先级，用于练习时先出没做过的材料。
  function selectCases(pool, count, rankOf = null) {
    const groups = grouped(pool.filter((q) => q.type === "case" && q.caseMaterial));
    const complete = groups.filter((g) => g.length === g[0].caseGroupSize);
    const rank = typeof rankOf === "function" ? (group) => Math.min(...group.map(rankOf)) : () => 0;
    const buckets = new Map();
    for (const group of complete) {
      const key = rank(group);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(group);
    }
    const preferred = [...buckets.keys()].sort((left, right) => left - right).flatMap((key) => {
      const bucket = buckets.get(key);
      return [...shuffled(bucket.filter((g) => imported(g[0]))), ...shuffled(bucket.filter((g) => !imported(g[0])))];
    });
    const choices = new Map([[0, []]]);
    for (const group of preferred) {
      for (const [size, units] of [...choices].reverse()) {
        const next = size + group.length;
        if (next <= count && !choices.has(next)) choices.set(next, [...units, group]);
      }
      if (choices.has(count)) return choices.get(count).flat();
    }
    return choices.get(Math.max(...choices.keys())).flat();
  }
  function selectExam(questions, subjectId) {
    const pool = questions.filter((q) => available(q) && q.subjectId === subjectId);
    let cases = selectCases(pool, 10);
    // Some recalled papers mix four-question packs with two-question packs.
    // Fill the requested ten-question slot from remaining case items while
    // retaining their material/order metadata for review.
    if (cases.length < 10) {
      const used = new Set(cases.map(normalizedStem));
      for (const q of shuffled(pool.filter((item) => item.type === "case" && item.caseMaterial))) {
        if (!used.has(normalizedStem(q))) { cases.push(q); used.add(normalizedStem(q)); }
        if (cases.length === 10) break;
      }
    }
    if (cases.length !== 10) throw new Error("综合题可用题量不足，暂不能生成该科模考。");
    const result = [], used = new Set(cases.map(normalizedStem));
    for (const [type, count] of [["single",40],["multiple",40],["judgment",30]]) {
      const typed = pool.filter((q) => q.type === type);
      const preferred = [...shuffled(typed.filter(imported)), ...shuffled(typed.filter((q) => !imported(q)))];
      const selected = [];
      for (const q of preferred) {
        if (used.has(normalizedStem(q))) continue;
        used.add(normalizedStem(q)); selected.push(q);
        if (selected.length === count) break;
      }
      if (selected.length !== count) throw new Error("去重后的可用题量不足，请先补充题库。");
      result.push(...selected);
    }
    return [...result, ...cases];
  }
  globalThis.ExamBank = Object.freeze({ imported, available, multiple, points, paperMix, matches, selectCases, selectExam });
})();
