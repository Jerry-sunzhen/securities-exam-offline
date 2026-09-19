// 历年整理题全部来自 PDF 识别文本，这里集中处理页眉页脚、水印、断行、
// 标点噪声和「解析里混进后续题目」等问题，构建、清洗脚本与校验共用同一套规则。

const WATERMARK_PATTERNS = [
  /证券从业\s*[-—－–]\s*证券市场基本法律法规/g,
  /证券从业\s*[-—－–]\s*金融市场基础知识/g,
  /JMYT\s*\d*\s*获取?/gi,
  /绝密押题[^\n]{0,40}/g,
  /金融类押题[^\n]{0,40}/g,
  /更多课件押题资料[^\n]{0,40}/g,
  /LC\s*命中率[^\n]{0,40}/g,
  /命中率[^\n]{0,40}/g,
  /老店铺[^\n]{0,40}/g,
  /微信\s*[:：]?\s*\d{5,}/g,
  /QQ\s*[:：]?\s*\d{5,}/gi
];

// 独立成行的水印/页码碎片，例如「信」「5 / 22」。纯数字行只在题干、
// 解析和材料里当噪声处理，不能套用到选项上（选项本身就是纯数字）。
const WATERMARK_CHAR_LINE = /^(?:[金融类押题认准微信]|[信微准认题押类融])$/;
const JUNK_LINE_PATTERNS = [
  WATERMARK_CHAR_LINE,
  /^\d{1,3}\s*\/\s*\d{1,3}$/,
  /^第\s*\d{1,3}\s*页$/,
  /^[A-Z]{2,8}\d{0,6}$/
];
const NUMERIC_JUNK_LINE = /^\d{1,2}$/;
// 版式水印「金融类押题信认」拆成单字后，常孤零零挂在行尾（前面留了空格），
// 例如「基金份额的发售  金」。只在「空格 + 单字 + 行尾/右括号」这种形态下删，
// 避免误伤「备用金」「标准」这类正常词。
const STRAY_WATERMARK_CHAR = /(?<=[\u4e00-\u9fff\d）)】》.．])\s+[金融类押题信认微准](?=\s*$|\s*[）)】》])/g;
// 同一颗水印字落在行首、后面紧跟右括号的情况：「微  ）对该金融债券…」。
const LEADING_STRAY_CHAR = /^[金融类押题信认微准]\s+(?=[）)】》])/;

const SECTION_LABEL = /^【\s*(?:单项|多项|不定项|组合型|判断|单选|多选)?选择题\s*】|^【\s*判断题\s*】|^【\s*题干\s*】/;
const ANSWER_MARKER = /(?:【\s*(?:参考|正确)?答案\s*】|(?:参考|正确)?答案\s*[:：])\s*(?:[A-EＡ-Ｅ][A-EＡ-Ｅ、,，\s]*|正确|错误|对|错|√|×)?/g;
const EXPLAIN_MARKER = /【\s*(?:慧考|本题)?\s*解析\s*】|【本题知识点已过期】/;
const NEXT_QUESTION = /(?:^|\n)\s*\d{1,3}\s*[、.．]\s*(?=[^\s\d])/;
const PAGE_NOISE = /(?<=[\u4e00-\u9fff。；：、）])\s?\d{1,3}\s+\d{1,2}(?=\s*[\u4e00-\u9fff]|\s*$)/g;
// 版心外的页码只剩一位/两位数字时，常挂在句尾（前面是空格或标点）。
// 只在题干、解析、材料里生效：选项本身就是「5；10」「9：15-9：25」这类数字，
// 一旦套用就会把合法选项截断。
const TRAILING_PAGE_DIGIT = /(?<=[\u4e00-\u9fff])\s+\d{1,2}\s*$|(?<=[；：，、。])\s?\d{1,2}\s*$/gm;
const ROMAN_LINE = /^([Il]{1,4}|[Il]{1,4}[Vv]|[Vv][Il]{1,3})(?:\s*[.、．]\s*|\s+|(?=[\u4e00-\u9fff\d《]))/;
// 题干里的填空括号，空格数量不定。
const BLANK_BRACKET = /[（(][\s\u3000]{0,20}[）)]/;
const DEFAULT_EXPLANATION = "原资料未提供可用解析；请结合教材定位和现行官方规则自行核对。";

// 个别题目的「解析」其实是资料里下一道题的题干和选项，这种直接换回默认说明。
function isPastedQuestion(text) {
  const markers = text.match(/(?:^|\n)\s*[A-D]\s*[.．、]/g) || [];
  if (markers.length >= 3) return true;
  if (/\n\s*A\s*[.．、]\s*(?:对|错|正确|错误)\s*\n\s*B\s*[.．、]/.test(text)) return true;
  return /^\s*\d{1,3}\s+[\u4e00-\u9fff]/.test(text) && /[A-D]\s*[.．、]/.test(text);
}
const ANSWER_HINT = /参考答案|【\s*(?:参考|正确)?答案\s*】/;
const ROMAN_FORMS = { I: "Ⅰ", II: "Ⅱ", III: "Ⅲ", IV: "Ⅳ", V: "Ⅴ", L: "Ⅰ", l: "Ⅰ", ll: "Ⅱ", lll: "Ⅲ", lV: "Ⅳ", lv: "Ⅳ", i: "Ⅰ", ii: "Ⅱ", iii: "Ⅲ", iv: "Ⅳ", v: "Ⅴ" };

function stripWatermarks(text) {
  let value = text;
  for (const pattern of WATERMARK_PATTERNS) value = value.replace(pattern, "");
  return value;
}

function isJunkLine(line) {
  return JUNK_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

function stripPageNoise(line, { optionMode = false } = {}) {
  const value = line.replace(PAGE_NOISE, "");
  return optionMode ? value : value.replace(TRAILING_PAGE_DIGIT, "");
}

function normalizeLines(text, { joinLines, numericJunk = false, optionMode = false }) {
  const rawLines = normalizeQuotes(stripWatermarks(text))
    .split("\n")
    .map((line) => stripPageNoise(line.replace(/[ \t\u3000]+/g, " "), { optionMode })
      .replace(STRAY_WATERMARK_CHAR, "")
      .replace(LEADING_STRAY_CHAR, "")
      .replace(/[ \t]+$/g, "")
      .replace(/\\+(?=["“”])/g, "")
      .trim())
    .filter((line) => {
      if (!line) return false;
      if (WATERMARK_CHAR_LINE.test(line)) return false;
      if (optionMode) return true;
      return !isJunkLine(line) && !(numericJunk && NUMERIC_JUNK_LINE.test(line));
    });
  // 断行常把句末标点、右引号或右括号挤到下一行开头，把它还给上一行。
  const lines = [];
  for (const line of rawLines) {
    const danglingPunct = line.match(/^([；;：:，,、。．.》」”’）)】"']+)/);
    if (danglingPunct && lines.length) {
      const previous = lines.pop();
      const rawPunct = danglingPunct[1];
      const punct = rawPunct
        .replace(/[;]/g, "；").replace(/[:]/g, "：").replace(/,/g, "，").replace(/\./g, "。");
      const rest = line.slice(danglingPunct[0].length);
      // 右引号、右括号是被拆开的短语，后面的文字要接回同一行。
      const isClosingMark = /^[》」”’）)】"']/.test(rawPunct);
      lines.push(`${previous}${punct}${isClosingMark ? rest : ""}`);
      if (rest && !isClosingMark) lines.push(rest);
      continue;
    }
    const trimmed = line.replace(/^[.．。]+\s*/, "");
    if (trimmed) lines.push(trimmed);
  }
  if (joinLines) return lines.join("");
  return lines.join("\n").replace(/\n{2,}/g, "\n");
}

// 识别文本里引号半角/全角混用，甚至左右颠倒（“五级“），这里来回扫一遍统一成“”。
function normalizeQuotes(text) {
  let open = false;
  let result = "";
  for (const char of text) {
    if (char === "”") {
      result += open ? "”" : "“";
      open = !open;
    } else if (char === "“" || char === '"') {
      result += open ? "”" : "“";
      open = !open;
    } else {
      result += char;
    }
  }
  return result;
}

// ①②③…列表里，第几项之间应该是分号；识别成冒号的（…2000户：④…）改回来。
// 但「A项：①……」「选项B：②……」这类选项标注后的冒号是正常的，不能改成分号。
const OPTION_LABEL_TAIL = /(?:选项\s*[A-D]|[A-D]\s*项)$/;
function fixListColons(text) {
  const circled = /[\u2460-\u2473]/;
  return text.split("\n").map((line) => {
    let seenItem = false;
    let result = "";
    for (const char of line) {
      if (circled.test(char)) {
        seenItem = true;
        result += char;
      } else if (char === "：" && seenItem && !OPTION_LABEL_TAIL.test(result)) {
        result += "；";
      } else {
        result += char;
      }
    }
    return result;
  }).join("\n");
}

function normalizePunctuation(text, { optionMode = false } = {}) {
  let value = text
    // 识别文本里的异体标点：小冒号、小分号、制表斜线、全角句点，
    // 统一成正常写法后再交给后面的规则处理。
    .replace(/∶/g, "：")
    .replace(/﹔/g, "；")
    .replace(/╱/g, "/")
    .replace(/．/g, ".")
    .replace(/[（(]\s*0\s*[）)]/g, "（ ）")
    .replace(/([\u4e00-\u9fff]),\s*/g, "$1，")
    .replace(/([\u4e00-\u9fff]);\s*/g, "$1；")
    .replace(/([\u4e00-\u9fff]):\s*/g, "$1：")
    .replace(/([\u4e00-\u9fff])\?\s*/g, "$1？")
    .replace(/([\u4e00-\u9fff]),(?=[\u4e00-\u9fff《])/g, "$1，")
    .replace(/([，。、；：！？])\1+/g, "$1")
    .replace(/([，,])(?=[，,])/g, "，")
    .replace(/[，,]{2,}/g, "，")
    .replace(/[。．.]{2,}/g, "。")
    // 编号列表「（1）.具备」里，编号后面多出的句点是识别噪声。
    .replace(/（(\d{1,2})）\s*\.\s*(?=[\u4e00-\u9fff])/g, "（$1）")
    // 空括号后面紧跟的句点：接中文时是被识别成句点的顿号，接行尾时是句末标点。
    .replace(/（\s*）\s*\.\s*(?=[\u4e00-\u9fff《“A-Za-z0-9])/g, "（ ）、")
    .replace(/（\s*）\s*\.(?=\s*$)/gm, "（ ）。")
    // 右括号、右书名号、右引号后面的句点，多半是被识别成句点的顿号。
    .replace(/([）》」”’])\s*\.\s*(?=[\u4e00-\u9fff《“A-Za-z0-9])/g, "$1、")
    // 选项字母之间的句点是顿号（「A.D：…」「B.D正确」）。
    .replace(/(?<![A-Za-z0-9])([A-D])\.(?=[A-D](?![A-Za-z]))/g, "$1、")
    // 组合型选择题里「Ⅰ.Ⅱ.Ⅲ项符合题意」之间的句点应为顿号。
    .replace(/([ⅠⅡⅢⅣⅤⅥ])\s*\.\s*(?=[ⅠⅡⅢⅣⅤⅥ])/g, "$1、")
    // 资料里的「<1>.」式序号是排版遗留，统一成「（1）」。
    .replace(/<(\d{1,2})>\.?(?=[\u4e00-\u9fff])/g, "（$1）")
    // 分页断行会把同一段文字重复一遍（「A银行A银行代理甲公司…」）。
    .replace(/([A-Za-z\u4e00-\u9fff]{2,8})\1(?=[A-Za-z\u4e00-\u9fff])/g, "$1")
    // 断行会吃掉英文术语里的空格，甚至留下连字符（「U-nitTrust」）。
    .replace(/U-nitTrust/g, "Unit Trust")
    .replace(/Col-lectiveInvestmentScheme/g, "Collective Investment Scheme")
    .replace(/ListedOpen-endedFunds/g, "Listed Open-ended Funds")
    .replace(/InitialPublicOffering/g, "Initial Public Offering")
    .replace(/SecuritiesInvestmentTrust/g, "Securities Investment Trust")
    .replace(/MutualFund/g, "Mutual Fund")
    .replace(/RightsOffering/g, "Rights Offering")
    .replace(/DepositaryReceipts/g, "Depositary Receipts")
    .replace(/SpotRates/g, "Spot Rates")
    .replace(/ZeroRates/g, "Zero Rates")
    .replace(/RiskManagement/g, "Risk Management")
    .replace(/RiskAppetite/g, "Risk Appetite")
    .replace(/ExpectedLoss/g, "Expected Loss")
    .replace(/Non\.systematicRisk/g, "Non-systematic Risk")
    .replace(/MichaelC\.Jensen/g, "Michael C. Jensen")
    .replace(/ISO31000/g, "ISO 31000")
    .replace(/([\u4e00-\u9fff])\.(?=[\u4e00-\u9fff])/g, "$1、")
    // 并列项之间被识别成句点，后面直接跟拉丁字母、数字或罗马数字编号。
    .replace(/([\u4e00-\u9fff])\.(?=[A-Za-z0-9ⅠⅡⅢⅣⅤⅥ])/g, "$1、")
    .replace(/(符合|依照|根据|依据|按照|遵守)，(?=《)/g, "$1")
    .replace(/[（(]+\s*[金微准融类押题信认?？]?\s*[）)]/g, "（ ）")
    // 反斜杠转义、半角括号、日文中点、行末句点等识别噪声。
    .replace(/\\+(?=["“”])/g, "")
    .replace(/\((?=[\u4e00-\u9fff\dA-Za-z%ⅠⅡⅢⅣⅤⅥ])/g, "（")
    .replace(/(?<=[\u4e00-\u9fff\dA-Za-z%ⅠⅡⅢⅣⅤⅥ”）’》」])\)/g, "）")
    .replace(/・/g, "·")
    // 引号的异体写法，以及右引号/右括号后面紧跟的半角标点
    .replace(/＂/g, "”").replace(/〝/g, "“").replace(/〞/g, "”").replace(/＇/g, "’")
    .replace(/([”’）)】》])\s*([,;:])/g, (match, left, mark) => `${left}${mark === "," ? "，" : mark === ";" ? "；" : "："}`)
    .replace(/(如下|如下所示|包括|分别是|情形有)；/g, "$1：")
    // 识别把填空括号读成「0」「0）」的情况（赎回费为0 这类真实数值不受影响）。
    .replace(/(?<![0-9A-Za-z])0）(?=[\u4e00-\u9fff。，、；：]|$)/g, "（ ）")
    .replace(/(?<![0-9A-Za-z])0\s*[?？](?=[\s。，、；：]|$)/g, "（ ）")
    .replace(/\s+(?=[（(]\s*[）)])/g, "")
    // 行首的 1）2）3）列表编号
    .replace(/(?<=^|\n)(\d{1,2})）/g, "（$1）")
    .replace(/([\u4e00-\u9fff])\.(?=\s*$)/gm, "$1。")
    .replace(/([（(])([Il]{1,4})(?=\s*(?:正确|错误|对|错)[）)])/g, (match, left, token) => `${left}${romanValue(token) || token}`)
    .replace(/\(([^()]{0,20})\)/g, (match, inner) => (/^[\u4e00-\u9fff\d%．.、\s]+$/.test(inner) && !/[A-Za-z]/.test(inner) ? `（${inner}）` : match))
    .replace(/(?<=[\u4e00-\u9fff。；：、）])\s+\d{1,3}\s*$/g, "")
    // 识别文本里确认过的错字/异体字（逐条来自实际语料校对）。
    .replace(/劵/g, "券")
    .replace(/査/g, "查")
    .replace(/岀/g, "出")
    .replace(/胞资/g, "融资")
    .replace(/入民币/g, "人民币")
    .replace(/顾间/g, "顾问")
    .replace(/风险言/g, "风险官")
    .replace(/翳记/g, "登记")
    .replace(/单值/g, "单位")
    .replace(/自分之/g, "百分之")
    .replace(/宜告/g, "宣告")
    .replace(/投者/g, "投资者")
    .replace(/基全/g, "基金")
    .replace(/募篥/g, "募集")
    .replace(/棋拟/g, "模拟")
    .replace(/昀市值/g, "的市值")
    .replace(/绐/g, "给")
    .replace(/声書/g, "声誉")
    .replace(/剌激/g, "刺激")
    .replace(/基铈场/g, "基金市场")
    .replace(/在基市场/g, "在基金市场")
    .replace(/末按规定/g, "未按规定")
    .replace(/拉牌/g, "挂牌")
    .replace(/参不优先/g, "参与优先")
    .replace(/合法村/g, "合法权益")
    .replace(/[l](?=年)/g, "1")
    .replace(/〈/g, "（")
    .replace(/《([^》（）\n]{1,40})[）)]/g, "《$1》")
    .replace(/齠變柊起獲俯示鳟唼酒函/g, "警示函")
    .replace(PAGE_NOISE, "");
  if (!optionMode) value = value.replace(TRAILING_PAGE_DIGIT, "");
  return fixListColons(value);
}

function romanValue(token) {
  const canonical = token.replace(/[lL]/g, "I").toUpperCase();
  const table = { "I": "Ⅰ", "II": "Ⅱ", "III": "Ⅲ", "IV": "Ⅳ", "V": "Ⅴ", "VI": "Ⅵ" };
  return table[canonical] || ROMAN_FORMS[token] || ROMAN_FORMS[token.toUpperCase()];
}

// 识别文本里 I / l / II / lII / IV 这类罗马数字写法，统一成 Ⅰ Ⅱ Ⅲ Ⅳ。
function normalizeRomanTokens(text) {
  const swap = (token) => romanValue(token) || token;
  return text.split("\n").map((line) => {
    let value = line
      // 《证券公司流动性风险管理指引I》里的 I 是识别噪声，不是编号。
      .replace(/(?<=[\u4e00-\u9fff])[Il]{1,4}(?=》)/g, "")
      // （I正确）（IV项错误）（II正确，Ⅳ错误）
      .replace(/([（(])([IlV]{1,4})(?=\s*(?:选项|项)?\s*[，,、）)]|\s*(?:选项|项)?\s*(?:正确|错误))/g, (match, left, token) => `${left}${swap(token)}`)
      // 选项I正确 / 第IV项
      .replace(/(?<=选项)([IlV]{1,4})(?=\s*(?:正确|错误|[，,、。]))/g, (match, token) => swap(token))
      .replace(/(?<=第)([IlV]{1,4})(?=\s*(?:项|条|章|款))/, (match, token) => swap(token))
      // 顿号、逗号、分号后面的编号：III、IV属于… / ，IV错误
      .replace(/(?<=[、，；：])([IlV]{1,4})(?=[、，；：。\s）)]|[\u4e00-\u9fff])/g, (match, token) => swap(token));
    // 行首编号：I2015年… / III、IV属于… / IV《办法》
    const head = value.match(ROMAN_LINE);
    if (head) {
      const roman = romanValue(head[1]);
      if (roman) {
        const separator = /^\s*[、]/.test(value.slice(head[1].length)) ? "、" : ". ";
        value = `${roman}${separator}${value.slice(head[0].length).trim()}`;
      }
    }
    return value;
  }).join("\n");
}

function stripEdgePunctuation(text, { leading = false } = {}) {
  let value = text.trim();
  if (leading) value = value.replace(/^[.．。，、；：,;:]+/, "").trim();
  return value.replace(/[，、；：,;]+$/, "").replace(/(?:[.．。])+$/g, (match) => (value.length > match.length ? "。" : match)).trim();
}

// 资料会在解析后面补一段「考点：章节定位 + 原文重复」，只留前面的有效解析。
function trimKaodian(text) {
  const match = /(?:考查)?(?:【\s*)?考点(?:\s*】)?\s*[:：]/.exec(text);
  if (!match) return text;
  const head = text.slice(0, match.index).trim();
  let tail = text.slice(match.index + match[0].length)
    .replace(/^(?:\s*(?:考查)?(?:【\s*)?考点(?:\s*】)?\s*[:：]\s*)+/, "")
    .trim();
  if (head) return head;
  // 解析本身就是考点原文时，去掉开头的「第X章-第Y节…」定位行。
  const lines = tail.split("\n");
  if (lines.length > 1 && /^第\s*\d+\s*章/.test(lines[0].trim())) tail = lines.slice(1).join("\n").trim();
  return tail.replace(/^(?:\s*(?:【[^】]{0,10}】|[:：]))+/, "").trim();
}

// 解析文本里常常接在后面题目的题干、答案和解析，只保留本题真正的那一段。
function trimExplanation(raw) {
  let text = stripWatermarks(String(raw || "")).replace(/\r/g, "");
  for (let round = 0; round < 6; round += 1) {
    const boundary = findExplanationBoundary(text);
    if (!boundary) break;
    const next = boundary.keepAfter ? text.slice(boundary.end) : text.slice(0, boundary.index);
    if (next === text) break;
    text = next;
  }
  text = text.replace(ANSWER_MARKER, "");
  text = text.replace(new RegExp(EXPLAIN_MARKER.source, "g"), "");
  text = text.replace(/^[\s（(]*(?:对|错|正确|错误)[）)]\s*/, "");
  text = normalizeLines(text, { joinLines: false, numericJunk: true });
  // 来源排版会把点号单独留在行首（「（1）\n.充分了解…」），去掉多余点号并接回同一行。
  text = text.replace(/[（(](\d{1,2})[）)]\s*[.。]?\s*\n\s*(?=\S)/g, "（$1）");
  text = text.replace(/^\s*(?:知识点)?解析\s*[:：]\s*/, "").replace(/^(?:【[^】]{0,10}】\s*)+/, "");
  text = normalizeRomanTokens(text);
  text = trimKaodian(text);
  text = normalizePunctuation(text).replace(/[（(]\s*$/, "").replace(/[，、；]\s*$/, "").trim();
  // 清理「【考点】：」标记被去掉后留在行首的标点。
  text = text.replace(/^[\s：:；;，,、]+/, "").replace(/\n[\s：:；;，,、]+/g, "\n").trim();
  text = trimDanglingLead(text);
  if (isPastedQuestion(text)) return DEFAULT_EXPLANATION;
  if (!text || text.length < 6 || /^[一二三四五六七八九十]+\s*[、.．]?\s*(?:材料题|单项选择题|多项选择题|判断题|单选题|多选题)$/.test(text)) return DEFAULT_EXPLANATION;
  return text;
}

// 「…知情人包括」「…情形有」这种被截断的引导语，去掉后补上句号。
function trimDanglingLead(text) {
  const trimmed = text.replace(/[，、；：]?\s*(?:包括|如下|如下所示|以下|分别是|的有|的有以下|情形有|条件有|职责有|内容有|特点有|特征有)\s*$/, "").trim();
  if (!trimmed || trimmed === text) return text;
  if (!/[。！？]$/.test(trimmed)) return `${trimmed}。`;
  return trimmed;
}

function findExplanationBoundary(text) {
  const candidates = [];
  const answer = new RegExp(ANSWER_MARKER.source).exec(text);
  if (answer) candidates.push({ index: answer.index, end: answer.index + answer[0].length });
  const next = NEXT_QUESTION.exec(text);
  // 只有后面紧跟「（ ）」这种空括号时才认定是下一题，避免把法条里的「1.…2.…」当边界。
  if (next && (BLANK_BRACKET.test(text.slice(next.index + next[0].length, next.index + next[0].length + 240)) || ANSWER_HINT.test(text.slice(next.index + next[0].length, next.index + next[0].length + 240)))) {
    candidates.push({ index: next.index, end: next.index + next[0].length });
  }
  const explain = EXPLAIN_MARKER.exec(text);
  if (explain) candidates.push({ index: explain.index, end: explain.index + explain[0].length });
  if (!candidates.length) return null;
  candidates.sort((left, right) => left.index - right.index);
  const first = candidates[0];
  const before = text.slice(0, first.index);
  const stemLike = BLANK_BRACKET.test(before.slice(-80));
  if (stemLike || first.index < 12) return { ...first, keepAfter: true };
  return { ...first, keepAfter: false };
}

// 组合型选择题的选项常常写成「I、lI、III」这种大小写混排的罗马数字。
function normalizeStatementOption(text) {
  if (!/[ⅠⅡⅢⅣⅤⅥIlVv]/.test(text) || !/^[\sⅠⅡⅢⅣⅤⅥIlVv、,，.．。]+$/.test(text)) return text;
  const tokens = text.split(/[、,，.．。]+/).map((token) => token.trim()).filter(Boolean);
  if (!tokens.length) return text;
  const mapped = tokens.map((token) => (/[IlVv]/.test(token) ? romanValue(token) : token));
  if (mapped.some((token) => !token || !/^[ⅠⅡⅢⅣⅤⅥ]$/.test(token))) return text;
  return mapped.join("、");
}

function cleanOptionText(raw) {
  const lines = String(raw || "").split("\n").filter((line) => !/^\s*[A-D]\s*[.．、]\s*[A-D]\s*$/.test(line));
  const joined = normalizeLines(lines.join("\n"), { joinLines: true, optionMode: true });
  // 有些来源会在选项末尾带上「A.A B.B D.D」这样的答案标记串，或粘上水印单字。
  const trimmed = joined
    .replace(/(?:[A-D]\s*[.．、]\s*[A-D])+\s*$/, "")
    .replace(/([ⅠⅡⅢⅣⅤⅥIlVv\d、,，.．])\s*[金微准融类押题信认]\s*$/, "$1");
  return normalizeStatementOption(stripEdgePunctuation(normalizePunctuation(trimmed, { optionMode: true }), { leading: true }));
}

function cleanStemText(raw) {
  const lines = normalizeLines(raw, { joinLines: false, numericJunk: true });
  return stripEdgePunctuation(normalizePunctuation(normalizeRomanTokens(lines)), { leading: true });
}

// 判断题有时把「（」「）」挤进了选项，单独收拾一下。
function normalizeJudgmentOptions(question) {
  const options = question.options || [];
  const judgment = options.length === 2;
  if (!judgment) return;
  for (const option of options) {
    const value = option.text.replace(/[（(）)]/g, "").trim();
    if (/^(?:正确|对|√)$/.test(value)) option.text = "正确";
    else if (/^(?:错误|错|×)$/.test(value)) option.text = "错误";
  }
  if (/[（(]$/.test(question.stem)) question.stem = `${question.stem.slice(0, -1)}（ ）`;
}

// 填空的「（ ）」有时被拆开：左半留在题干末尾，右半粘在第一个选项结尾。
function repairBlankBracket(question) {
  const stem = String(question.stem || "");
  if (!/[（(]\s*$/.test(stem)) return false;
  const options = question.options || [];
  const head = stem.replace(/\s*[（(]\s*$/, "");
  let repaired = false;
  for (const option of options) {
    const index = option.text.search(/[）)]/);
    if (index < 0 || !option.text.slice(0, index).trim()) continue;
    // 「）方式进行的标准化金融期货合约的交易。」这种是被拆开的题干后半句。
    const tail = option.text.slice(index + 1).trim();
    question.stem = `${head}（ ）${tail}`;
    option.text = option.text.slice(0, index).trim();
    repaired = true;
    break;
  }
  return repaired;
}

// 组合型选择题的引导句是「…包括」+ 分条时，填空常被识别漏掉。
function repairMissingBlankMark(question) {
  if (question.type === "judgment") return false;
  const stem = String(question.stem || "");
  if (!stem.trim() || /[（(]\s*[）)]/.test(stem)) return false;
  const lines = stem.split("\n");
  const firstItem = lines.findIndex((line) => /^\s*(?:[ⅠⅡⅢⅣⅤⅥ]|[①-⑳]|\d{1,2}\s*[.、．])/.test(line));
  const insertAt = (index) => {
    const line = lines[index];
    const tail = line.match(/[。]\s*$/);
    lines[index] = tail ? `${line.slice(0, tail.index)}（ ）${tail[0]}` : `${line}（ ）`;
  };
  if (firstItem > 0) insertAt(firstItem - 1);
  else if (firstItem === 0) return false;
  else insertAt(lines.length - 1);
  question.stem = lines.join("\n");
  return true;
}

// 判断题题干末尾多出一个右括号时，补回被挤掉的「（ ）」。
function repairDanglingCloseParen(question) {
  const stem = String(question.stem || "");
  if (!/。\s*[）)]\s*$/.test(stem)) return false;
  const trimmed = stem.replace(/。\s*[）)]\s*$/, "。");
  const count = (text) => [(text.match(/（/g) || []).length - (text.match(/）/g) || []).length];
  if (count(trimmed)[0] !== 0) return false;
  question.stem = stem.replace(/。\s*[）)]\s*$/, "。（ ）");
  return true;
}

// 选择题题干末尾的填空被识别成 0 时补回「（ ）」。
function repairMissingBlank(question) {
  if (question.type === "judgment") return false;
  const stem = String(question.stem || "");
  if (/[（(]\s*[）)]/.test(stem)) return false;
  const match = stem.match(/0\s*([。])?$/);
  if (!match) return false;
  question.stem = `${stem.slice(0, match.index).trimEnd()}（ ）${match[1] || ""}`;
  return true;
}

// 题干里塞进了完整的 A-D 选项、选项却只剩「正确/错误」时，按题干里的选项还原题目。
function repairStemOptions(question) {
  const options = question.options || [];
  const judgment = options.length === 2 && options.every((option) => /^(?:正确|错误)$/.test(option.text));
  if (!judgment) return false;
  const firstA = /(?:^|\n|\s)A\s*[.．、]\s*/.exec(question.stem);
  if (!firstA) return false;
  const head = question.stem.slice(0, firstA.index);
  const rest = question.stem.slice(firstA.index);
  const parts = rest.split(/\s*(?=[A-D]\s*[.．、]\s*)/).filter(Boolean);
  const parsed = [];
  for (const part of parts) {
    const match = part.match(/^([A-D])\s*[.．、]\s*([\s\S]*)$/);
    if (match) parsed.push({ id: match[1], text: cleanOptionText(match[2]) });
  }
  if (parsed.length !== 4 || parsed.map((option) => option.id).join("") !== "ABCD" || parsed.some((option) => !option.text)) return false;
  if (question.correctOptionIds.some((id) => !parsed.some((option) => option.id === id))) return false;
  let stem = cleanStemText(head).replace(/[\s]*[0Oo]\s*[.。．]?\s*$/, "").trim();
  if (!/[（(]/.test(stem)) stem = `${stem}（ ）`;
  question.stem = stem;
  question.options = parsed;
  question.type = question.correctOptionIds.length > 1 ? "multiple" : "single";
  question.selectionMode = question.type === "multiple" ? "multiple" : "single";
  return true;
}

// 现行考试只有单选题和多选题，没有「组合型选择题」那种把 Ⅰ/Ⅱ/Ⅲ 排成选项的单选。
// 历年资料里这类题有七百多道，构建时统一改写成真正的多选题：题干的 Ⅰ~Ⅳ 每条变成
// A~D 四个选项，原答案选项包含的条目就是正确项。否定题干（「错误的有」）同理，
// 题干原样保留，答案仍是让题干成立的那几条，所以不需要额外的翻转逻辑。
const ROMAN_ORDER = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ"];
const COMBINATION_OPTION_TEXT = /^[\sⅠⅡⅢⅣⅤⅥ、，,．.。]+$/;

function isCombinationOptionText(text) {
  const value = String(text || "");
  return /[ⅠⅡⅢⅣⅤⅥ]/.test(value) && COMBINATION_OPTION_TEXT.test(value);
}

function combinationMembers(text) {
  return [...new Set(String(text || "").match(/[ⅠⅡⅢⅣⅤⅥ]/g) || [])];
}

// 把题干拆成引导句 + 四条陈述。编号按出现顺序重新记为 Ⅰ~Ⅳ：原资料偶尔把 Ⅲ 识别成
// 第二个 Ⅱ，而正文里的《巴塞尔Ⅲ》这类词会混进编号，所以先只认行首的编号。
function splitCombinationStatements(stem) {
  const text = String(stem || "");
  const markers = [];
  const pattern = /[ⅠⅡⅢⅣⅤⅥ]/g;
  let match;
  while ((match = pattern.exec(text))) {
    const at = match.index;
    const previous = at ? text[at - 1] : "\n";
    markers.push({ at, lineStart: at === 0 || /[\n。；：、，,）)]/.test(previous) });
  }
  const lineStarts = markers.filter((marker) => marker.lineStart);
  const picked = lineStarts.length === 4 ? lineStarts : markers;
  if (picked.length !== 4) return null;
  for (let index = 1; index < picked.length; index += 1) {
    if (ROMAN_ORDER.indexOf(text[picked[index].at]) < ROMAN_ORDER.indexOf(text[picked[index - 1].at])) return null;
  }
  const lead = text.slice(0, picked[0].at).trim();
  const statements = picked.map((marker, index) => {
    const end = index + 1 < picked.length ? picked[index + 1].at : text.length;
    return text.slice(marker.at + 1, end).replace(/^[\s.、．,，:：]+/, "").trim();
  });
  return { lead, statements };
}

function convertCombinationChoice(question) {
  if (question.type !== "single" || question.caseMaterial) return false;
  const options = question.options || [];
  if (options.length !== 4 || !options.every((option) => isCombinationOptionText(option.text))) return false;
  const parsed = splitCombinationStatements(question.stem);
  if (!parsed || !parsed.lead) return false;
  const statements = parsed.statements.map((text) => cleanOptionText(text));
  if (statements.some((text) => !text || text.length > 600) || new Set(statements).size !== statements.length) return false;
  const answer = options.find((option) => (question.correctOptionIds || []).includes(option.id));
  if (!answer) return false;
  const truth = new Set(combinationMembers(answer.text));
  if (!truth.size) return false;
  const ids = ["A", "B", "C", "D"];
  question.stem = parsed.lead;
  question.options = statements.map((text, index) => ({ id: ids[index], text }));
  question.correctOptionIds = statements.map((text, index) => (truth.has(ROMAN_ORDER[index]) ? ids[index] : null)).filter(Boolean);
  // 只有一条成立时仍按单选题出，多选题至少要两条正确项。
  question.type = question.correctOptionIds.length > 1 ? "multiple" : "single";
  question.selectionMode = question.type === "multiple" ? "multiple" : "single";
  // 原解析收尾常写「故本题选择 B 选项」，改成多选题后字母已经换了含义，这类结论句统一删掉。
  question.explanation = String(question.explanation || "").replace(/(?:[，,；;。]?\s*(?:故|所以|因此)?\s*(?:本题|此题)?\s*(?:应)?\s*(?:选|选择)\s*[A-D]\s*(?:选项|项)?\s*[。.．]?\s*)$/, "").trim();
  question.combinationConverted = true;
  return true;
}

// 多个来源答案一致时，「不同来源答案冲突」是合并过程留下的假标记。
function reconcileOriginConflicts(question) {
  if (!question.issues?.includes("不同来源答案冲突")) return;
  const origins = question.origins || [];
  if (!origins.length) return;
  const answer = [...question.correctOptionIds].sort().join("");
  const consistent = origins.every((origin) => [...(origin.answer || [])].sort().join("") === answer);
  if (consistent) question.issues = question.issues.filter((issue) => issue !== "不同来源答案冲突");
}

function optionKey(text) {
  return String(text).replace(/[\s\u3000]+/g, "").replace(/[，,]/g, ",").replace(/[。．.]/g, ".").toLowerCase();
}

function recomputeIssues(question) {
  const issues = [];
  const options = question.options || [];
  const judgment = options.length === 2 && options.every((option) => ["正确", "错误", "对", "错"].includes(option.text.trim()));
  if (question.type === "judgment" && !judgment) issues.push("判断题选项异常");
  if (!judgment && options.length !== 4) issues.push("选项数量异常");
  if (options.some((option) => !option.text.trim() || option.text.length > 750)) issues.push("选项缺失或疑似跨题");
  if (new Set(options.map((option) => optionKey(option.text))).size !== options.length) issues.push("选项文字重复");
  const ids = new Set(options.map((option) => option.id));
  if (!question.correctOptionIds?.length || question.correctOptionIds.some((id) => !ids.has(id))) issues.push("答案与选项不匹配");
  if (question.type === "single" && question.correctOptionIds.length !== 1 && question.correctOptionIds.length) issues.push("单选题答案数量异常");
  if (question.type === "multiple" && question.correctOptionIds?.length === 1) issues.push("多选题答案数量异常");
  if (question.type === "single" && options.length === 4 && options.every((option) => isCombinationOptionText(option.text))) issues.push("组合型选项待拆分");
  if (question.stem.length > 1800) issues.push("题干疑似混入其他内容");
  if (question.type === "case" && !question.caseMaterial) issues.push("综合题材料待恢复");
  return issues;
}

const RECOMPUTABLE_ISSUES = new Set(["选项文字重复", "答案与选项不匹配", "选项数量异常", "选项缺失或疑似跨题", "题干疑似混入其他内容", "综合题材料待恢复", "判断题选项异常", "单选题答案数量异常", "多选题答案数量异常", "组合型选项待拆分"]);

export function applyCorrection(question, correction) {
  if (!correction) return false;
  for (const field of ["stem", "explanation", "correctOptionIds", "type", "selectionMode", "options"]) {
    if (correction[field] === undefined) continue;
    question[field] = JSON.parse(JSON.stringify(correction[field]));
  }
  // 定点替换：只改几个字符时不必重写整段题干或整个选项数组。
  // field 取值 "stem" / "explanation" / "option:D" 等。
  if (Array.isArray(correction.textReplacements)) {
    for (const item of correction.textReplacements) {
      const field = String(item.field || "");
      const replace = (text) => String(text == null ? "" : text).split(item.from).join(item.to);
      const optionField = field.startsWith("option:");
      const target = optionField
        ? (question.options || []).find((option) => option.id === field.slice("option:".length))
        : null;
      if (optionField) {
        if (target) target.text = replace(target.text);
      } else if (field === "stem" || field === "explanation" || field === "caseMaterial") {
        question[field] = replace(question[field]);
      }
    }
  }
  // 原资料题号被识别噪声带偏时，允许逐题写回真实题号。
  if (correction.originNumber !== undefined && question.origins?.[0]) question.origins[0].number = String(correction.originNumber);
  question.corrections = [...new Set([...(question.corrections || []), correction.reason].filter(Boolean))];
  if (correction.resolveIssues) {
    question.issues = (question.issues || []).filter((issue) => !correction.resolveIssues.includes(issue));
  }
  if (correction.hold) {
    question.issues = [...new Set([...(question.issues || []), correction.reason || "原资料标注本题知识点已过期"])];
  }
  return true;
}

export function cleanQuestion(question, { corrections = new Map() } = {}) {
  const before = { stem: question.stem, options: (question.options || []).map((option) => option.text), explanation: question.explanation, material: question.caseMaterial };
  applyCorrection(question, corrections instanceof Map ? corrections.get(question.id) : corrections[question.id]);
  question.stem = cleanStemText(String(question.stem || "").replace(SECTION_LABEL, ""));
  for (const option of question.options || []) option.text = cleanOptionText(option.text);
  normalizeJudgmentOptions(question);
  repairStemOptions(question);
  convertCombinationChoice(question);
  repairBlankBracket(question);
  repairDanglingCloseParen(question);
  repairMissingBlank(question);
  repairMissingBlankMark(question);
  question.explanation = trimExplanation(question.explanation);
  if (question.caseMaterial) question.caseMaterial = normalizePunctuation(normalizeLines(question.caseMaterial, { joinLines: false })).trim();
  reconcileOriginConflicts(question);
  const issues = new Set((question.issues || []).filter((issue) => !RECOMPUTABLE_ISSUES.has(issue)));
  for (const issue of recomputeIssues(question)) issues.add(issue);
  question.issues = [...issues].sort();
  question.examEligible = question.issues.length === 0;
  question.reviewStatus = question.issues.length ? "held" : "source_answer";
  return {
    id: question.id,
    changed: before.stem !== question.stem || before.explanation !== question.explanation || before.material !== question.caseMaterial ||
      before.options.some((text, index) => text !== (question.options[index] || {}).text)
  };
}

export function questionTextIssues(question) {
  const issues = [];
  const fields = [
    ["题干", question.stem],
    ["解析", question.explanation],
    ["材料", question.caseMaterial || ""],
    ...(question.options || []).map((option) => [`选项${option.id}`, option.text])
  ];
  for (const [label, text] of fields) {
    if (!text) continue;
    if (/证券从业\s*[-—－]|JMYT|慧考解析|参考答案|【\s*答\s*案\s*】|绝密押题|命中率|https?:\/\/|www\./.test(text)) issues.push(`${label}残留水印或答案标记`);
    // 【固定】这类原文高亮不是答案标记；这里只认出真正的答案/解析标记。
    if (NEXT_QUESTION.test(`\n${text}`) && /【\s*(?:参考|正确|标准)?答案|【\s*(?:慧考|本题|题目|详细)?解析|参考答案|答案\s*[:：]|解析\s*[:：]/.test(text)) issues.push(`${label}混入后续题目`);
    if (/[\u4e00-\u9fff]\s?\d{1,3}\s+\d{1,2}(?:\s|$)/.test(text)) issues.push(`${label}残留页码噪声`);
    if (/^【\s*(?:单项|多项|不定项|判断)?选择题\s*】/.test(text)) issues.push(`${label}残留题型标记`);
    if (/。。|，，|、、|；；|：：/.test(text)) issues.push(`${label}重复标点`);
    if (/[\u4e00-\u9fff]\.[\u4e00-\u9fff]/.test(text)) issues.push(`${label}句点误用`);
    if (/[劵胞]/.test(text)) issues.push(`${label}错字`);
    if (/["']/.test(text)) issues.push(`${label}残留半角引号`);
    if (/考点\s*[:：]/.test(text)) issues.push(`${label}残留考点标注`);
    // 「合约标的的期权合约」「以…为目的的规范」是正常表述，排除「标/目」开头的组合。
    if (/(?<![标目])的的|和和|不不|了了/.test(text)) issues.push(`${label}叠字`);
    if (/[∶﹔╱．]/.test(text)) issues.push(`${label}异体标点`);
    if (/([）》」”’])\s*\.\s*[\u4e00-\u9fff《A-Za-z0-9]/.test(text)) issues.push(`${label}句点当顿号`);
    if (/(?<![A-Za-z0-9])[A-D]\.[A-D](?![A-Za-z])/.test(text)) issues.push(`${label}选项字母间句点`);
    if (/[ⅠⅡⅢⅣⅤⅥ]\s*\.\s*(?=[ⅠⅡⅢⅣⅤⅥ])/.test(text)) issues.push(`${label}罗马数字间句点`);
    if (/（\d{1,2}）\s*\.\s*[\u4e00-\u9fff]/.test(text)) issues.push(`${label}列表编号后多余句点`);
    if (/一一/.test(text)) issues.push(`${label}破折号异常`);
    if (/(?:^|\n)\s*[；;：:，,、。．.》」”’）)】]/.test(text)) issues.push(`${label}行首残留标点`);
    if (/([Il]{2,}|[Il][Vv]|[Vv][Il])[.、．]/.test(text)) issues.push(`${label}罗马数字写法异常`);
    if ((text.match(/（/g) || []).length !== (text.match(/）/g) || []).length) issues.push(`${label}括号不配对`);
    if (/(?<=[\u4e00-\u9fff])\s+\d{1,3}\s*$/.test(text)) issues.push(`${label}行尾残留数字`);
  }
  return [...new Set(issues)];
}
