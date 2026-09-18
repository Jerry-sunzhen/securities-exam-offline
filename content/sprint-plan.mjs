// 考前冲刺的日程数据。时间按北京时间（UTC+8）写死，方便「现在该做哪一段」自动定位。
// 块里的 tasks 是深链接：点一下就带着对应条件进入练习/模考/背诵，不用手动再选一遍筛选条件。

export const sprintPlan = {
  title: "最后一天冲刺",
  timezone: "+08:00",
  days: [
    { date: "2026-09-18", label: "9 月 18 日 · 周五晚上（到 23:00）" },
    { date: "2026-09-19", label: "9 月 19 日 · 周六（考试当天）" }
  ],
  exams: [
    {
      id: "exam-finance",
      subjectId: "finance",
      label: "金融市场基础知识",
      date: "2026-09-19",
      start: "08:30",
      minutes: 120
    },
    {
      id: "exam-law",
      subjectId: "law",
      label: "证券市场基本法律法规",
      date: "2026-09-19",
      start: "13:00",
      minutes: 120
    }
  ],
  blocks: [
    {
      id: "tonight-1",
      date: "2026-09-18",
      start: "18:30",
      minutes: 30,
      kind: "break",
      focus: "law",
      title: "晚饭",
      detail: "吃完就开工。当晚到 23:00，法规一共 4 小时，不铺开只挑重点。"
    },
    {
      id: "tonight-2",
      date: "2026-09-18",
      start: "19:00",
      minutes: 80,
      focus: "law",
      title: "法规 · 第一章 证券市场基本法律法规",
      detail: "431 道题、21 个多年考点，是这一科最大也最常考的一块。先做题，把解析当讲义读，目标 120 题。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-1", count: 120, types: ["single", "multiple", "judgment"], label: "刷第一章 120 题" }]
    },
    {
      id: "tonight-3",
      date: "2026-09-18",
      start: "20:20",
      minutes: 70,
      focus: "law",
      title: "法规 · 第二章 证券经营机构管理规范",
      detail: "194 道题、8 个多年考点。目标 60 题，做不完按多年考点 → 多选 → 判断的顺序取舍。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-2", count: 60, types: ["single", "multiple", "judgment"], label: "刷第二章 60 题" }]
    },
    {
      id: "tonight-4",
      date: "2026-09-18",
      start: "21:30",
      minutes: 60,
      focus: "law",
      title: "法规 · 第三章 证券公司业务规范",
      detail: "246 道题。目标 60 题，至少把多年考点和多选题过完。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-3", count: 60, types: ["single", "multiple", "judgment"], label: "刷第三章 60 题" }]
    },
    {
      id: "sat-1",
      date: "2026-09-19",
      start: "06:30",
      minutes: 50,
      focus: "finance",
      title: "出门前 · 基础错题与一页纸",
      detail: "上午考基础，先把状态切回这一科：只翻错题和结论，不做新题，也别再碰法规。",
      tasks: [{ kind: "wrong", subjectId: "finance", label: "过一遍基础错题" }]
    },
    {
      id: "sat-2",
      date: "2026-09-19",
      start: "07:20",
      minutes: 60,
      kind: "break",
      focus: "finance",
      title: "出门与到场",
      detail: "按路程倒推出门时间，宁早不晚。到场后只看自己的结论，不和别人对答案、不开新题。"
    },
    {
      id: "exam-1",
      date: "2026-09-19",
      start: "08:30",
      minutes: 120,
      kind: "exam",
      focus: "finance",
      subjectId: "finance",
      title: "考试 · 金融市场基础知识",
      detail: "120 题 120 分钟。单选 40 题控制在 25 分钟内，多数时间留给多选和材料题；判断题不留空。"
    },
    {
      id: "sat-3",
      date: "2026-09-19",
      start: "10:30",
      minutes: 30,
      kind: "break",
      focus: "law",
      title: "吃饭与休息",
      detail: "不复盘上午的题、不对答案。吃点清淡的，别吃太饱，下午还有两小时。"
    },
    {
      id: "sat-4",
      date: "2026-09-19",
      start: "11:00",
      minutes: 30,
      focus: "law",
      title: "间隙 · 法规错题收尾",
      detail: "第四、五章已经刷完，这段只收尾错题本里剩下的法规错题，重做一遍即可，不再精读解析。",
      tasks: [{ kind: "wrong", subjectId: "law", label: "收尾法规错题" }]
    },
    {
      id: "sat-5",
      date: "2026-09-19",
      start: "11:30",
      minutes: 25,
      focus: "law",
      title: "间隙 · 法规多年考点",
      detail: "36 个多年考点里 29 个在第一、二章，是重复率最高的一块，放在进场前看。",
      tasks: [{ kind: "multiYear", subjectId: "law", label: "刷法规多年考点" }]
    },
    {
      id: "sat-6",
      date: "2026-09-19",
      start: "11:55",
      minutes: 20,
      focus: "law",
      title: "结论与数字速览",
      detail: "只扫期限、比例、人数、金额、处罚幅度，别再做题；12:15 之后不再输入新内容。",
      tasks: [{ kind: "memory", subjectId: "law", label: "最后过一遍法规卡" }]
    },
    {
      id: "sat-7",
      date: "2026-09-19",
      start: "12:15",
      minutes: 15,
      kind: "break",
      focus: "law",
      title: "出门缓冲",
      detail: "留足到考场的时间，路上只回忆，不看书。"
    },
    {
      id: "exam-2",
      date: "2026-09-19",
      start: "13:00",
      minutes: 120,
      kind: "exam",
      focus: "law",
      subjectId: "law",
      title: "考试 · 证券市场基本法律法规",
      detail: "同样 120 题。先把单选、判断做完拿分，多选留到最后，每题都回到主体、权限、禁止行为、后果四问。"
    }
  ],
  notes: [
    {
      title: "今天剩下的时间怎么用",
      items: [
        "上午考基础：出门前只翻错题和结论，不碰法规，把状态留在这一科。",
        "10:30—13:00 的间隙按「吃饭 → 法规错题收尾 → 多年考点 → 结论速览 → 出门」走，两小时用满，但不加新内容。",
        "第一到第五章都已经刷过一轮，间隙不再回去补章节题，重点放在错题和多年考点上。",
        "进考场前 20 分钟停止输入新内容，只看自己的结论。"
      ]
    },
    {
      title: "时间不够时的取舍顺序",
      items: [
        "先砍 11:30 的多年考点，再砍 11:00 的错题收尾。",
        "不能砍：基础的错题、10:30 的吃饭、12:15 的出门缓冲。",
        "路上时间超过 30 分钟就把 12:15 提前，按「错题 → 多年考点 → 出门」的顺序保。",
        "考场外不要和别人对答案，也不要在交卷前临时改多选题。"
      ]
    },
    {
      title: "法规的四问法",
      items: [
        "主体是谁：证监会、交易所、证券公司、从业人员还是投资者。",
        "可以做什么：业务范围与权限。",
        "不得做什么：禁止行为与利益冲突。",
        "违反后果是什么：处罚种类、幅度、由谁处罚。"
      ]
    },
    {
      title: "两个必须注意的坑",
      items: [
        "法规卡片的教材参考页来自 2020 商业教材，只能帮助理解脉络，里面的期限、比例、金额、处罚幅度一律不要背。",
        "本地题库不是官方题库。模拟稳定到 70% 再进考场，给 60 分及格线留余量。"
      ]
    }
  ]
};
