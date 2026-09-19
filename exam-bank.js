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
  // 同一题干在一张卷子/一组练习里只出现一次：模考与练习共用这套判断。
  // 综合材料按整段出题，不参与去重，避免把材料组拆散。
  // 组合型改写来的多选题题干只剩引导句（「下列…正确的有」），光看题干会把不同题
  // 当成同一道，所以这类题连选项一起参与比较。
  const normalizedStem = (q) => q.subjectId + ":" + (q.combinationConverted
    ? `${q.stem}\n${(q.options || []).map((option) => option.text).join("\n")}`
    : q.stem).replace(/[\s，。、“”：（）()【】.．]/g, "");
  function uniqByStem(ordered, count) {
    const picked = [];
    const seen = new Set();
    for (const question of ordered) {
      if (picked.length >= count) break;
      if (question.type !== "case") {
        const key = normalizedStem(question);
        if (seen.has(key)) continue;
        seen.add(key);
      }
      picked.push(question);
    }
    return picked;
  }
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
  // 从给定材料组里挑一组：题量尽量正好等于 count，其次让优先级高（没做过、最久没做）
  // 的材料优先。材料组只有 9~11 组，直接枚举所有子集，顺带保证「能不用刚做过的就不用」。
  function pickCaseGroups(groups, count, rankOfGroup) {
    let best = null;
    for (let mask = 1; mask < (1 << groups.length); mask += 1) {
      let size = 0;
      let cost = 0;
      for (let index = 0; index < groups.length; index += 1) {
        if (!(mask & (1 << index))) continue;
        size += groups[index].length;
        cost += rankOfGroup(groups[index]);
      }
      if (size > count) continue;
      const exact = size === count;
      // 先看题量是否正好，再比优先级总和；同分时保留先遍历到的（也就是随机顺序里的那组）。
      if (!best || (exact && !best.exact) || (exact === best.exact && cost < best.cost)) best = { exact, cost, mask };
    }
    if (!best) return [];
    return groups.filter((group, index) => best.mask & (1 << index));
  }

  const groupKey = (group) => group[0].caseGroupId || group[0].id;
  // rankOf 可选：返回每题优先级（越小越优先），同一段材料取组内最高优先级。
  function selectCases(pool, count, rankOf = null) {
    const groups = grouped(pool.filter((q) => q.type === "case" && q.caseMaterial));
    const complete = groups.filter((g) => g.length === g[0].caseGroupSize);
    const rankOfGroup = typeof rankOf === "function" ? (group) => Math.min(...group.map(rankOf)) : () => 0;
    const stemsOf = new Map(complete.map((group) => [group, new Set(group.map((question) => normalizedStem(question)))]));
    // 历年资料里存在两段材料考同一道小问的情况：整段出题时按题干去重，
    // 同一张卷子或同一组练习里只留其中一段。淘汰顺序按材料编号走，
    // 保证「哪一段被留下」可复现，档内再打乱，所以不会固定轮转。
    const buckets = new Map();
    const keptStems = new Set();
    for (const group of [...complete].sort((left, right) => groupKey(left).localeCompare(groupKey(right)))) {
      const stems = stemsOf.get(group);
      if ([...stems].some((stem) => keptStems.has(stem))) continue;
      for (const stem of stems) keptStems.add(stem);
      const key = rankOfGroup(group);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(group);
    }
    // 优先出没做过的材料；同一档里先出历年并入的题，其余顺序随机。
    const preferred = [...buckets.keys()].sort((left, right) => left - right).flatMap((key) => {
      const bucket = buckets.get(key);
      return [...shuffled(bucket.filter((g) => imported(g[0]))), ...shuffled(bucket.filter((g) => !imported(g[0])))];
    });
    return pickCaseGroups(preferred, count, rankOfGroup).flat();
  }

  // rankOf 可选，口径与 selectCases 一致：模考也按「没做过 → 做错过 → 做对了」
  // 叠加最近一次作答时间挑材料，避免连续两次模考大面积重题。
  function selectExam(questions, subjectId, rankOf = null) {
    const pool = questions.filter((q) => available(q) && q.subjectId === subjectId);
    let cases = selectCases(pool, 10, rankOf);
    // Some recalled papers mix four-question packs with two-question packs.
    // Fill the requested ten-question slot from remaining case items while
    // retaining their material/order metadata for review.
    if (cases.length < 10) {
      const usedGroups = new Set(cases.map((q) => q.caseGroupId || q.id));
      const remaining = pool.filter((item) => item.type === "case" && item.caseMaterial);
      const ordered = typeof rankOf === "function"
        ? [...remaining].sort((left, right) => rankOf(left) - rankOf(right))
        : shuffled(remaining);
      // 先补还没出现过的材料，实在凑不满再回头用已经用过的。
      const fresh = ordered.filter((q) => !usedGroups.has(q.caseGroupId || q.id));
      const spent = ordered.filter((q) => usedGroups.has(q.caseGroupId || q.id));
      const usedStems = new Set(cases.map((question) => normalizedStem(question)));
      for (const q of [...fresh, ...spent]) {
        if (cases.length === 10) break;
        const key = normalizedStem(q);
        if (usedStems.has(key)) continue;
        usedStems.add(key);
        cases.push(q);
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
  globalThis.ExamBank = Object.freeze({ imported, available, multiple, points, paperMix, matches, normalizedStem, uniqByStem, selectCases, selectExam });
})();
