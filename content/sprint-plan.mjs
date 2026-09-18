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
      detail: "吃完就开工。今晚到 23:00，法规一共 4 小时，不铺开只挑重点。"
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
      detail: "197 道题、8 个多年考点。目标 60 题，做不完按多年考点 → 多选 → 判断的顺序取舍。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-2", count: 60, types: ["single", "multiple", "judgment"], label: "刷第二章 60 题" }]
    },
    {
      id: "tonight-4",
      date: "2026-09-18",
      start: "21:30",
      minutes: 60,
      focus: "law",
      title: "法规 · 第三章 证券公司业务规范",
      detail: "245 道题。目标 60 题，至少把多年考点和多选题过完。",
      tasks: [{ kind: "practice", subjectId: "law", chapterId: "law-3", count: 60, types: ["single", "multiple", "judgment"], label: "刷第三章 60 题" }]
    },
    {
      id: "tonight-5",
      date: "2026-09-18",
      start: "22:30",
      minutes: 30,
      focus: "law",
      title: "法规 · 错题与数字纸",
      detail: "重做今晚的错题，把遇到的期限、比例、人数、金额、处罚幅度抄成一页纸，明天只翻这页。做完就睡。",
      tasks: [
        { kind: "wrong", subjectId: "law", label: "重做今晚法规错题" },
        { kind: "memory", subjectId: "law", label: "法规背诵卡" }
      ]
    },
    {
      id: "sat-1",
      date: "2026-09-19",
      start: "07:30",
      minutes: 35,
      focus: "finance",
      title: "出门前 · 基础错题与一页纸",
      detail: "只翻错题本和昨天记的定义、分类、公式，不碰新题，别把考试节奏带乱。",
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
      minutes: 30,
      kind: "break",
      focus: "law",
      title: "吃饭与休息",
      detail: "间隙只有两个半小时，还要留出到考场的时间，先吃口东西，别复盘上午的题。"
    },
    {
      id: "sat-3",
      date: "2026-09-19",
      start: "11:00",
      minutes: 40,
      focus: "law",
      title: "间隙 · 违法违规责任与职业道德",
      detail: "第四章、第五章各 61 题，条文直白、容易再拿分，考前一小时看最划算。",
      tasks: [
        { kind: "practice", subjectId: "law", chapterId: "law-4", count: 30, types: ["single", "multiple", "judgment"], label: "回看第四章" },
        { kind: "practice", subjectId: "law", chapterId: "law-5", count: 30, types: ["single", "multiple", "judgment"], label: "回看第五章" }
      ]
    },
    {
      id: "sat-4",
      date: "2026-09-19",
      start: "11:40",
      minutes: 60,
      focus: "law",
      title: "间隙 · 第一、二章多年考点与错题",
      detail: "法规 36 个多年考点里有 29 个在第一、二章，是重复率最高的部分，放在进场前看。",
      tasks: [
        { kind: "multiYear", subjectId: "law", label: "刷法规多年考点" },
        { kind: "wrong", subjectId: "law", label: "重做法规错题" }
      ]
    },
    {
      id: "sat-5",
      date: "2026-09-19",
      start: "12:40",
      minutes: 20,
      focus: "law",
      title: "数字纸与进场",
      detail: "只看昨晚那页数字，然后出门。路程超过 30 分钟就把这段提前，别赶。",
      tasks: [{ kind: "memory", subjectId: "law", label: "最后过一遍法规卡" }]
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
      title: "今晚的时间怎么用",
      items: [
        "基础今天已经过完，今晚一整段都给法规，不再回头做基础的题。",
        "四个小时不可能刷完 995 道，目标是第一、二、三章和多年考点，第四、五章留到明天间隙。",
        "每题控制在 40 秒内，选错直接看解析，不纠结；做得慢就继续往下走。",
        "23:00 收工睡觉，明天上午还有一场考试，熬夜换来的记忆不划算。"
      ]
    },
    {
      title: "时间不够时的取舍顺序",
      items: [
        "先砍第三章的常规题，只做它的多年考点和多选题。",
        "再砍第二章剩余的题，只保留多年考点。",
        "不能砍：第一章、两科的多年考点、那页数字纸。",
        "明天间隙若只剩一小时，按「数字纸 → 第一、二章多年考点 → 出门」执行。"
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
