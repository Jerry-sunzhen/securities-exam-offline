// 考前冲刺的日程数据。时间按北京时间（UTC+8）写死，方便「现在该做哪一段」自动定位。
// 块里的 tasks 是深链接：点一下就带着对应条件进入练习/模考/背诵，不用手动再选一遍筛选条件。

export const sprintPlan = {
  title: "最后一天半冲刺",
  timezone: "+08:00",
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
      start: "14:30",
      minutes: 120
    }
  ],
  blocks: [
    {
      id: "fri-1",
      date: "2026-09-18",
      start: "09:00",
      minutes: 60,
      focus: "finance",
      title: "基础 · 错题重刷",
      detail: "快节奏做，只回读解析里标了教材与笔记出处的那一段。目标 80—120 题。",
      tasks: [{ kind: "wrong", subjectId: "finance", label: "练习基础错题" }]
    },
    {
      id: "fri-2",
      date: "2026-09-18",
      start: "10:00",
      minutes: 70,
      focus: "finance",
      title: "基础 · 多年考点",
      detail: "覆盖两年以上真题的知识点，考的重复率最高。先做这一遍，再回讲义页对原文。",
      tasks: [{ kind: "multiYear", subjectId: "finance", label: "刷多年考点题" }]
    },
    {
      id: "fri-3",
      date: "2026-09-18",
      start: "11:10",
      minutes: 110,
      focus: "finance",
      title: "基础 · 限时模拟",
      detail: "严格按考试节奏计时，做完只看错题落在哪些章节。",
      tasks: [{ kind: "exam", subjectId: "finance", label: "开始 120 题模考" }]
    },
    {
      id: "fri-4",
      date: "2026-09-18",
      start: "13:00",
      minutes: 60,
      kind: "break",
      focus: "both",
      title: "午休",
      detail: "吃饭、走动一下，别把上午的错题带到下午。"
    },
    {
      id: "fri-5",
      date: "2026-09-18",
      start: "14:00",
      minutes: 90,
      focus: "law",
      title: "法规 · 第一章 证券市场基本法律法规",
      detail: "431 道题、21 个多年考点，是这一科最大的一块，先做题，把解析当讲义读。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-1", count: 120, types: ["single", "multiple", "judgment"], label: "刷第一章 120 题" }]
    },
    {
      id: "fri-6",
      date: "2026-09-18",
      start: "15:30",
      minutes: 90,
      focus: "law",
      title: "法规 · 第二章 证券经营机构管理规范",
      detail: "197 道题、8 个多年考点。做不完就按多年考点 → 多选 → 判断的顺序取舍。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-2", count: 60, types: ["single", "multiple", "judgment"], label: "刷第二章 60 题" }]
    },
    {
      id: "fri-7",
      date: "2026-09-18",
      start: "17:00",
      minutes: 30,
      kind: "break",
      focus: "both",
      title: "休息",
      detail: "站起来走一走，晚饭别吃太晚。"
    },
    {
      id: "fri-8",
      date: "2026-09-18",
      start: "17:30",
      minutes: 60,
      focus: "law",
      title: "法规 · 第三章 证券公司业务规范",
      detail: "245 道题。至少把多年考点和多选题过完。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-3", count: 60, types: ["single", "multiple", "judgment"], label: "刷第三章 60 题" }]
    },
    {
      id: "fri-9",
      date: "2026-09-18",
      start: "18:30",
      minutes: 50,
      focus: "law",
      title: "法规 · 违法违规责任与职业道德",
      detail: "第四章 61 题、第五章 61 题，章节短、条文直白，是性价比较高的部分。",
      tasks: [
        { kind: "practice", subjectId: "law", chapterId: "law-4", count: 30, types: ["single", "multiple", "judgment"], label: "刷第四章 30 题" },
        { kind: "practice", subjectId: "law", chapterId: "law-5", count: 30, types: ["single", "multiple", "judgment"], label: "刷第五章 30 题" }
      ]
    },
    {
      id: "fri-10",
      date: "2026-09-18",
      start: "19:20",
      minutes: 40,
      focus: "law",
      title: "法规 · 错题 + 数字纸",
      detail: "重做当天错题，并把期限、比例、人数、金额、处罚幅度抄成一页纸。",
      tasks: [
        { kind: "wrong", subjectId: "law", label: "重做法规错题" },
        { kind: "memory", subjectId: "law", label: "法规背诵卡" }
      ]
    },
    {
      id: "fri-11",
      date: "2026-09-18",
      start: "20:00",
      minutes: 20,
      focus: "law",
      title: "睡前 · 只看数字纸",
      detail: "不做新题。数字约束睡一觉后还会记得更牢。",
      tasks: [{ kind: "memory", subjectId: "law", label: "再背一遍法规卡" }]
    },
    {
      id: "sat-1",
      date: "2026-09-19",
      start: "07:30",
      minutes: 35,
      focus: "finance",
      title: "出门前 · 基础错题与一页纸",
      detail: "只翻错题本和昨天记的定义、分类、公式，不碰新题。",
      tasks: [{ kind: "wrong", subjectId: "finance", label: "过一遍基础错题" }]
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
      detail: "120 题 120 分钟。单选 40 题控制在 25 分钟内，把时间留给多选和材料题；判断题不留空。"
    },
    {
      id: "sat-2",
      date: "2026-09-19",
      start: "10:30",
      minutes: 40,
      focus: "law",
      title: "间隙 · 法规错题重做",
      detail: "先把自己昨天做错的题过一遍，这是最快捡回来的分。",
      tasks: [{ kind: "wrong", subjectId: "law", label: "重做法规错题" }]
    },
    {
      id: "sat-3",
      date: "2026-09-19",
      start: "11:10",
      minutes: 60,
      focus: "law",
      title: "间隙 · 违法违规责任与职业道德",
      detail: "第四章、第五章条文直白，考前再看一遍最划算。",
      tasks: [
        { kind: "practice", subjectId: "law", chapterId: "law-4", count: 30, types: ["single", "multiple", "judgment"], label: "回看第四章" },
        { kind: "practice", subjectId: "law", chapterId: "law-5", count: 30, types: ["single", "multiple", "judgment"], label: "回看第五章" }
      ]
    },
    {
      id: "sat-4",
      date: "2026-09-19",
      start: "12:10",
      minutes: 60,
      focus: "law",
      title: "间隙 · 第一、二章多年考点",
      detail: "法规的 36 个多年考点里有 29 个在第一、二章，这是重复率最高的部分。",
      tasks: [{ kind: "multiYear", subjectId: "law", label: "刷法规多年考点" }]
    },
    {
      id: "sat-5",
      date: "2026-09-19",
      start: "13:10",
      minutes: 20,
      focus: "law",
      title: "间隙 · 数字纸与进场",
      detail: "只看昨晚那页数字，然后留足时间进考场，午饭别吃太饱。",
      tasks: [{ kind: "memory", subjectId: "law", label: "最后过一遍法规卡" }]
    },
    {
      id: "exam-2",
      date: "2026-09-19",
      start: "14:30",
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
      title: "时间不够时的取舍顺序",
      items: [
        "先砍周五那套 120 题模拟，改成错得多的章节各抽 20 题。",
        "再砍第四、五章的精读。",
        "最后放弃基础的未做题，它们对提分的贡献不如错题和多年考点。",
        "不能砍：基础的错题本、法规第一章、两科的多年考点、那页数字纸。"
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
