const MONEY_BANKING_REPO = "https://github.com/saylordotorg/text_money-and-banking-v2.0/blob/master";
const PERSONAL_FINANCE_REPO = "https://github.com/saylordotorg/text_personal-finance/blob/master";

const textbook = ({ book = "money", file, locator, quote, originalQuote }) => ({
  kind: "textbook",
  sourceClass: "general_textbook",
  jurisdiction: "通用原理 / 美国教材",
  answerBasis: false,
  title: book === "money" ? "Money and Banking, v. 2.0" : "Personal Finance",
  publisher: "Saylor Academy",
  locator,
  quote,
  originalQuote,
  url: `${book === "money" ? MONEY_BANKING_REPO : PERSONAL_FINANCE_REPO}/${file}`,
  license: "CC BY-NC-SA 3.0",
  effectiveDate: "2012（非中国考试教材）"
});

const authority = ({ title, publisher, locator, quote, url, effectiveDate, originalQuote, sourceClass = "china_official", jurisdiction = "中国大陆", answerBasis = true }) => ({
  kind: "authority",
  sourceClass,
  jurisdiction,
  answerBasis,
  title,
  publisher,
  locator,
  quote,
  url,
  effectiveDate,
  ...(originalQuote ? { originalQuote } : {})
});

const lawUrls = {
  pboc: "https://flk.npc.gov.cn/detail2.html?MmM5MDlmZGQ2NzhiZjE3OTAxNjc4YmY2MjAwMzAyY2I=",
  securities: "https://flk.npc.gov.cn/detail2.html?ZmY4MDgwODE3MWU5ZTE4MTAxNzI3ZTMyYjk0ZDdkZTY=",
  company: "https://flk.npc.gov.cn/detail2.html?ZmY4MDgxODE4YzkxMDhlYjAxOGNiNjkyMmY3NTBjMDc=",
  fund: "https://flk.npc.gov.cn/detail2.html?MmM5MDlmZGQ2NzhiZjE3OTAxNjc4YmY3OTU4MDA3OTk=",
  futures: "https://flk.npc.gov.cn/detail2.html?ZmY4MDgxODE4MDJkMjg1MzAxODA0NGMxMmY5ZDA3MGM=",
  commercialBank: "https://flk.npc.gov.cn/detail2.html?MmM5MDlmZGQ2NzhiZjE3OTAxNjc4YmY3ZWJhOTA4NmI=",
  insurance: "https://flk.npc.gov.cn/detail2.html?MmM5MDlmZGQ2NzhiZjE3OTAxNjc4YmY3YzQwNjA4MTE=",
  trust: "https://flk.npc.gov.cn/detail2.html?MmM5MDlmZGQ2NzhiZjE3OTAxNjc4YmY2MGUxZDAyNzE=",
  budget: "https://flk.npc.gov.cn/detail2.html?ZmY4MDgwODE2ZjEzNWY0NjAxNmYyMTI0MDFiMzE3Y2M="
};

const law = (key, title, locator, quote) => authority({
  sourceClass: "china_law",
  title,
  publisher: "国家法律法规数据库（全国人大常委会办公厅）",
  locator,
  quote,
  url: lawUrls[key],
  effectiveDate: "现行有效文本（2026-08-18 核对）"
});

const refs = {
  marketTerms: textbook({
    file: "s05-05-financial-markets.html",
    locator: "Chapter 2 §2.5，段落 wright-ch02_s04_p02–p03",
    quote: "货币市场交易距到期不足一年的工具；期限为一年或更长的证券在资本市场交易。（项目中文短译）",
    originalQuote: "Money markets are used to trade instruments with less than a year to maturity (repayment of principal). … Securities with a year or more to maturity trade in capital markets."
  }),
  financialSystem: textbook({
    file: "s05-02-financial-systems.html",
    locator: "Chapter 2 §2.2，段落 wright-ch02_s02_p01",
    quote: "金融体系是由中介机构、服务机构和市场紧密连接形成的网络，主要用于配置资本、分担风险和促进交易，并把借款者与出借者有效连接起来。（项目中文短译）",
    originalQuote: "A financial system is a densely interconnected network of intermediaries, facilitators, and markets that serves three major purposes: allocating capital, sharing risks, and facilitating all types of trade, including intertemporal exchange. … Efficiently linking borrowers to lenders is the system’s main function."
  }),
  directFinance: textbook({
    file: "s05-05-financial-markets.html",
    locator: "Chapter 2 §2.5，段落 wright-ch02_s04_p05",
    quote: "金融市场常被称为“直接融资”，但经纪商、交易商和投资银行等服务机构通常仍会参与；服务机构参与不等于资金必须先成为中介自身的负债。（项目中文短译）",
    originalQuote: "Some call financial markets ‘direct finance,’ though most admit the term is a misnomer because the functioning of the markets is usually aided by one or more market facilitators, including brokers, dealers, brokerages, and investment banks."
  }),
  intermediary: textbook({
    file: "s05-06-financial-intermediaries.html",
    locator: "Chapter 2 §2.6，段落 wright-ch02_s05_p01",
    quote: "金融中介也连接储蓄者与借款者，但会进行资产转换；例如银行向存款人发行自身负债，再持有借款人的贷款、抵押贷款或债券。（项目中文短译）",
    originalQuote: "Sometimes called the indirect method of finance, intermediaries, like markets, link investors/lenders/savers to borrowers/entrepreneurs/spenders but do so in an ingenious way, by transforming assets. … investor–depositors own claims on the bank itself rather than on the bank’s borrowers."
  }),
  internationalMarkets: textbook({
    file: "s05-05-financial-markets.html",
    locator: "Chapter 2 §2.5，段落 wright-ch02_s04_p08",
    quote: "金融市场的国际化程度不断提高；政府、公司等发行人可以在外国市场发行债券，投资者也可以投资外国证券交易所。（项目中文短译）",
    originalQuote: "Financial markets are increasingly international in scope. … Today, governments, corporations, and other securities issuers (borrowers) can sell bonds … in a foreign country … It is now also quite easy to invest in foreign stock exchanges."
  }),
  centralBalance: textbook({
    file: "s18-01-the-central-bank-s-balance-she.html",
    locator: "Chapter 15 §15.1，段落 wright-ch14_s01_p01–p03",
    quote: "中央银行资产包括政府证券和对商业银行的贷款；最重要的负债是流通中货币和准备金，两者构成货币基础。（项目中文短译）",
    originalQuote: "Like any bank, the central bank’s balance sheet is composed of assets and liabilities. Its assets … include government securities and discount loans. … Its most important liabilities are currency in circulation and reserves. … Currency in circulation (C) and reserves (R) compose the monetary base."
  }),
  multiplier: textbook({
    file: "s18-04-a-more-sophisticated-money-mul.html",
    locator: "Chapter 15 §15.4，段落 wright-ch15_s01_p03–p06",
    quote: "简单存款乘数使用 ΔD＝(1/rr)×ΔR，并假设公众不增加现金持有、银行不增加超额准备金；更现实的乘数还要纳入现金和超额准备金。（项目中文短译）",
    originalQuote: "The simple deposit multiplier … ΔD = (1/rr) × ΔR. The equation provides an upper-bound estimate for changes in deposits. It assumes that the public will hold no more currency and that banks will hold no increased excess reserves."
  }),
  openMarket: textbook({
    file: "s19-02-open-market-operations-and-the.html",
    locator: "Chapter 16 §16.2，段落 wright-ch16_s02_p01–p02",
    quote: "中央银行可用公开市场操作改变货币基础；例如要增加货币供给时买入债券，也可通过回购和逆回购进行临时操作。（项目中文短译）",
    originalQuote: "It uses dynamic OMO to change the level of the MB … If it wanted to increase the money supply, for example, it would buy bonds ‘dynamically.’ … It enters into two types of trades … outright ones … and temporary ones, called repos and reverse repos."
  }),
  transmission: textbook({
    file: "s27-03-transmission-mechanisms.html",
    locator: "Chapter 24 §24.3，段落 wright-ch24_s03_p02–p09、p24",
    quote: "货币政策可通过实际利率、资产价格与财富效应、银行贷款和资产负债表等机制传导；因此不能只看短期利率。（项目中文短译）",
    originalQuote: "Expansionary monetary policy (EMP), real interest rates down, investment up, aggregate output up. … The wealth effect is a transmission mechanism … The credit view posits several straightforward transmission mechanisms, including bank loans, asymmetric information, and balance sheets."
  }),
  regulatorFunctions: textbook({
    file: "s05-08-regulation.html",
    locator: "Chapter 2 §2.8，段落 wright-ch02_s07_p02–p03",
    quote: "金融监管旨在提高透明度、保护消费者、促进竞争和效率，并维护金融体系稳健；这些目标相互关联但不等同。（项目中文短译）",
    originalQuote: "Regulators serve four major functions. First, they try to reduce asymmetric information by encouraging transparency. … A second … goal is to protect consumers … Third, they strive to promote financial system competition and efficiency … Finally, regulators also try to ensure the soundness of the financial system."
  }),
  debtEquity: textbook({
    file: "s05-04-financial-instruments.html",
    locator: "Chapter 2 §2.4，段落 wright_1.1-5066-20111010-162921-684023",
    quote: "债务工具体现借款人与出借人的关系，约定支付本金和利息；权益工具体现所有权，持有人分享发行人的利润；优先股和可转换债券具有混合属性。（项目中文短译）",
    originalQuote: "Debt instruments, such as bonds, indicate a lender–borrower relationship … Equity instruments, such as stocks, represent an ownership stake … Hybrid instruments, such as preferred stock, have some of the characteristics of both debt and equity instruments."
  }),
  commonPreferred: textbook({
    book: "personal",
    file: "s19-01-stocks-and-stock-markets.html",
    locator: "Chapter 15 §15.1 ‘Common Stock and Preferred Stock’，段落 fwk-134226-ch15_s01_s02_p01–p06",
    quote: "普通股和优先股的差异主要体现在表决权、风险和股利；公司困难时通常先清偿债权人，再到优先股股东，普通股股东取得剩余。（项目中文短译）",
    originalQuote: "The differences between common and preferred have to do with the investor’s voting rights, risk, and dividends. … its first responsibility is to satisfy creditors, then the preferred shareholders, and then the common shareholders."
  }),
  stockValue: textbook({
    book: "personal",
    file: "s19-02-stock-value.html",
    locator: "Chapter 15 §15.2，段落 fwk-134226-ch15_s02_p01、p13",
    quote: "股票的价值来自为投资者创造收益的能力；市场中供求力量决定股票价格，而预期盈利和增长潜力会影响需求。（项目中文短译）",
    originalQuote: "The value of a stock is in its ability to create a return, to create income or a gain in value for the investor. … In the stock market, the forces of supply and demand determine stock prices."
  }),
  relativeValue: textbook({
    book: "personal",
    file: "s19-03-common-measures-of-value.html",
    locator: "Chapter 15 §15.3 ‘Price-to-Earnings Ratio’，段落 fwk-134226-ch15_s03_s03_p04、p07–p08",
    quote: "市盈率可用来比较公司相对贵或便宜，但应与同行业公司或可比指数比较；账面价值来自资产负债表，与市场价值不是同一口径。（项目中文短译）",
    originalQuote: "By comparing the P/E ratio of different companies, you can see how expensive they are relative to each other. … You can compare it to other companies in the same industry or to the average P/E ratio for a stock index of similar type companies."
  }),
  timeValue: textbook({
    book: "personal",
    file: "s08-01-the-time-value-of-money.html",
    locator: "Chapter 4 §4.1，段落 fwk-134226-ch04_s01_p05–p07",
    quote: "未来现金流离当前流动性越远，机会成本和风险越大，现值越低；因此比较不同时点现金流时要先换算为等价现值。（项目中文短译）",
    originalQuote: "The further in the future cash flows are … the more opportunity cost and risk you have, and the more that takes away from the present value (PV) of your wealth. … The equivalent present values today will be less than the nominal or face values in the future."
  }),
  indexes: textbook({
    book: "personal",
    file: "s16-04-diversification-return-with-le.html",
    locator: "Chapter 12 §12.4 ‘Diversification and Portfolio Theory’，段落 fwk-134226-ch12_s04_s02_p02",
    quote: "指数通过衡量包含某类资产投资组合的收益，反映整个资产类别的表现，并可作为比较具体投资的基准。（项目中文短译）",
    originalQuote: "Indexes are a way of measuring the performance of an entire asset class by measuring returns for a portfolio containing all the investments in that asset class. Essentially, the index becomes a benchmark …"
  }),
  bondTerms: textbook({
    book: "personal",
    file: "s20-01-bonds-and-bond-markets.html",
    locator: "Chapter 16 §16.1 ‘Bond Features’，段落 fwk-134226-ch16_s01_s01_p02–p08",
    quote: "债券条款会规定面值、票息、到期日、是否可赎回或转换、担保和偿付顺序等；面值本金通常在到期时偿还。（项目中文短译）",
    originalQuote: "The coupon is usually paid to the investor twice yearly. It is calculated as a percentage of the face value … The face value, the principal amount borrowed, is paid back at maturity."
  }),
  convertible: textbook({
    book: "personal",
    file: "s20-01-bonds-and-bond-markets.html",
    locator: "Chapter 16 §16.1 ‘Bond Features’，段落 fwk-134226-ch16_s01_s01_p06",
    quote: "可转换债券是可在特定条件下转换为普通股的公司债券；转换后，债券持有人变为股东并承担更多公司风险。（项目中文短译）",
    originalQuote: "A convertible bond is a corporate bond that may be converted into common equity at maturity or after some specified time. If a bond were converted into stock, the bondholder would become a shareholder, assuming more of the company’s risk."
  }),
  mortgageBacked: textbook({
    book: "personal",
    file: "s21-02-real-estate-investments.html",
    locator: "Chapter 17 §17.2 ‘Indirect Investments’，段落 fwk-134226-ch17_s02_s02_p07–p08",
    quote: "抵押贷款支持证券由一组抵押贷款的还款现金流支持；它仍会受到利率、再投资、通胀、经济周期和违约等风险影响。（项目中文短译）",
    originalQuote: "Mortgage-backed securities (MBS) are bonds secured by pools of mortgages … Like any bond, mortgage-backed securities are vulnerable to interest rate, reinvestment, and inflation risk … and to default risk."
  }),
  repo: textbook({
    file: "s19-02-open-market-operations-and-the.html",
    locator: "Chapter 16 §16.2，段落 wright-ch16_s02_p02",
    quote: "在回购中，中央银行买入政府债券，同时卖方承诺在约定的近期从中央银行购回；逆回购则是先卖出证券并约定近期买回。（项目中文短译）",
    originalQuote: "In a repo (aka a repurchase agreement), the Fed purchases government bonds with the guarantee that the sellers will repurchase them from the Fed … In a reverse repo … the Fed sells securities and the buyer agrees to sell them to the Fed again in the near future."
  }),
  bondRates: textbook({
    book: "personal",
    file: "s20-02-bond-value.html",
    locator: "Chapter 16 §16.2 ‘Bond Price and Yield’，段落 fwk-134226-ch16_s02_s01_p06–p08",
    quote: "债券价格与到期收益率反向变动；一般利率上升时，债券收益率上升、价格下跌，反之亦然。（项目中文短译）",
    originalQuote: "Bond prices, their market values, have an inverse relationship to the yield to maturity. … as interest rates increase, bond yields increase, and bond prices fall. As interest rates fall, bond yields fall, and bond prices increase."
  }),
  yieldToMaturity: textbook({
    file: "s07-05-what-s-the-yield-on-that.html",
    locator: "Chapter 4 §4.5，段落 wright-ch04_s05_p01、p11",
    quote: "已知现值和未来现金流时，可以反向求使现值公式成立的利率，即到期收益率；附息债券通常需要通过金融计算器、电子表格或迭代求解。（项目中文短译）",
    originalQuote: "Sometimes it is useful to do the opposite, to calculate the interest rate, or yield to maturity, if given the PV and FV. … one backs into the yield to maturity by making successive guesses about i and plugging them into the PV formula."
  }),
  yieldCurve: textbook({
    book: "personal",
    file: "s20-02-bond-value.html",
    locator: "Chapter 16 §16.2 ‘Yield Curve’，段落 fwk-134226-ch16_s02_s03_p02–p03",
    quote: "收益率曲线比较不同到期期限债券的收益率，用图形表示利率期限结构，即利率与期限的关系。（项目中文短译）",
    originalQuote: "The yield curve is a graph of U.S. Treasury securities compared in terms of the yields for bonds of different maturities. … The yield curve illustrates the term structure of interest rates … or the relationship of interest rates to time."
  }),
  mutualFund: textbook({
    book: "personal",
    file: "s21-01-mutual-funds.html",
    locator: "Chapter 17 §17.1，段落 fwk-134226-ch17_s01_p01、p04",
    quote: "共同基金是证券投资组合，能以一次交易提供较低成本的分散投资和专业证券选择，但分散投资并不等于没有风险。（项目中文短译）",
    originalQuote: "A mutual fund is a portfolio of securities … A mutual fund provides an investor with cheaper and simpler diversification and security selection, requiring only one transaction to own a diversified portfolio."
  }),
  openClosedEtf: textbook({
    book: "personal",
    file: "s21-01-mutual-funds.html",
    locator: "Chapter 17 §17.1 ‘Structures and Types of Mutual Funds’，段落 fwk-134226-ch17_s01_s01_p03–p07",
    quote: "封闭式基金发行有限份额并在投资者之间交易；开放式基金份额由基金申购、赎回；ETF在交易所像股票一样连续交易。（项目中文短译）",
    originalQuote: "Closed-end funds are funds for which a limited number of shares are issued. … Most mutual funds are open-end funds in which investors buy shares directly from the fund and redeem or sell shares back to the fund. … Exchange-traded funds (ETFs) … are traded like stocks."
  }),
  reit: textbook({
    book: "personal",
    file: "s21-02-real-estate-investments.html",
    locator: "Chapter 17 §17.2 ‘Indirect Investments’，段落 fwk-134226-ch17_s02_s02_p04、p06",
    quote: "REIT通过持有和管理不动产让投资者以份额间接投资；其作用类似不动产投资的共同基金，可提高流动性和分散度。（项目中文短译；该段讲通用 REIT 结构，不代表中国具体监管规则）",
    originalQuote: "A real estate investment trust (REIT) … behaves much like a mutual fund for real estate investors. … REITs do for real estate what mutual funds do for other assets. They provide investors with a way to invest with more liquidity and diversity."
  }),
  derivatives: textbook({
    file: "s15-01-derivatives-and-their-function.html",
    locator: "Chapter 12 §12.1，段落 wright_1.1-5066-20111012-150526-164876、164991",
    quote: "金融衍生工具的价格最终来自某项基础资产的价格或表现；四种主要形式是远期、期货、期权和互换，可用于套期保值或投机。（项目中文短译）",
    originalQuote: "Financial derivatives are special types of financial instruments, the prices of which are ultimately derived from the price or performance of some underlying asset. … the four main types of derivatives—forwards, futures, options, and swaps."
  }),
  forwardsFutures: textbook({
    file: "s15-02-forwards-and-futures.html",
    locator: "Chapter 12 §12.2，段落 wright_1.1-5066-20111012-151408-326171、326210",
    quote: "远期合约由买卖双方现在约定未来购买交付资产的价格；期货交易所通过统一重量、质量和到期日等条款并执行合约，减少远期合约的寻找对手方、流动性和违约问题。（项目中文短译）",
    originalQuote: "In a forward contract, a buyer and a seller agree today on the price of an asset to be purchased and delivered in the future. … Exchanges … developed futures … by … developing standardized weights, definitions, standards, and expiration dates … and enforcing contracts between counterparties."
  }),
  options: textbook({
    file: "s15-03-options-and-swaps.html",
    locator: "Chapter 12 §12.3，段落 wright_1.1-5066-20111012-152421-400675",
    quote: "期权给予持有人按预定执行价格买入（看涨）或卖出（看跌）基础资产的权利而非义务；期权发行人则承担相应义务。（项目中文短译）",
    originalQuote: "Options … give their holders the option (which is to say the right, but not the obligation) to purchase (call) or sell (put) an underlying asset at a predetermined strike price."
  }),
  swaps: textbook({
    file: "s15-03-options-and-swaps.html",
    locator: "Chapter 12 §12.3，段落 wright_1.1-5066-20111012-152905-626601",
    quote: "互换是在预定条件下、通常反复进行的一项资产或现金流交换；利率互换可用固定付款交换与浮动利率挂钩的付款。（项目中文短译）",
    originalQuote: "Swaps are exchanges of one asset for another on a predetermined, typically repeated basis. … Such an agreement, called an interest rate swap, would buffer the bank against rising interest rates while protecting the finance company from lower ones."
  }),
  investmentRisk: textbook({
    book: "personal",
    file: "s16-03-measuring-return-and-risk.html",
    locator: "Chapter 12 §12.3 ‘Risk’，段落 fwk-134226-ch12_s03_s02_p01、p10",
    quote: "投资风险是实际收益偏离预期收益的可能；市场变化可以同时影响整个资产类别，而且压力期市场效率与流动性也可能下降。（项目中文短译）",
    originalQuote: "Investment risk is the idea that an investment will not perform as expected, that its actual return will deviate from the expected return. … changes in a market can affect an investment’s value."
  }),
  diversification: textbook({
    book: "personal",
    file: "s16-04-diversification-return-with-le.html",
    locator: "Chapter 12 §12.4，段落 fwk-134226-ch12_s04_p01–p03",
    quote: "分散投资把资金配置到不同资产类别，可降低对经济、资产类别和市场风险的暴露，但投资仍然意味着承担风险。（项目中文短译）",
    originalQuote: "To invest is to assume risk … another way to lessen risk is to diversify—to spread out your investments among a number of different asset classes. Investing in different asset classes reduces your exposure to economic, asset class, and market risks."
  }),
  creditRisk: textbook({
    book: "personal",
    file: "s20-02-bond-value.html",
    locator: "Chapter 16 §16.2 ‘Bond Risks’，段落 fwk-134226-ch16_s02_s02_p01",
    quote: "债券的违约风险是公司无法支付票息或偿还本金的风险，可结合评级以及经济、行业和公司因素评估。（项目中文短译）",
    originalQuote: "The risk that the company will be unable to make its payments is default risk—the risk that it will default on the bond. You can estimate default risk by looking at the bond rating as well as the economic, sector, and firm-specific factors."
  }),
  liquidityConcept: textbook({
    file: "s05-07-competition-between-markets-an.html",
    locator: "Chapter 2 §2.7，段落 wright_1.1-5066-20111011-120057-649305",
    quote: "流动性是资产以接近其真实市场价值出售的速度；高流动性资产可以快速、低成本成交，低流动性资产可能需要更长时间并产生较高出售成本。（项目中文短译）",
    originalQuote: "Liquidity is the speed with which an asset can be sold at something close to its real market value. A highly ‘liquid’ asset … can be exchanged instantaneously at no cost. … An ‘illiquid’ asset … may take months or years to sell."
  }),

  pbocDuties: law("pboc", "《中华人民共和国中国人民银行法》", "第二条至第四条",
    "中国人民银行在国务院领导下，制定和执行货币政策，防范和化解金融风险，维护金融稳定。第四条所列职责还包括发行人民币、经理国库、维护支付清算系统正常运行等。"),
  pbocTools: law("pboc", "《中华人民共和国中国人民银行法》", "第二十三条",
    "中国人民银行为执行货币政策，可以要求银行业金融机构按规定比例交存存款准备金，确定中央银行基准利率，办理再贴现，向商业银行提供贷款，并在公开市场上买卖国债、其他政府债券、金融债券及外汇。"),
  marketLayers: law("securities", "《中华人民共和国证券法》", "第三十七条",
    "公开发行的证券，应当在依法设立的证券交易所上市交易或者在国务院批准的其他全国性证券交易场所交易。非公开发行的证券，可以在前述场所或按照国务院规定设立的区域性股权市场转让。"),
  registration: law("securities", "《中华人民共和国证券法》", "第九条、第十九条、第二十一条、第二十五条",
    "公开发行证券必须符合法定条件并依法注册。发行申请文件应充分披露投资者作出价值判断和投资决策所必需的信息，内容真实、准确、完整；股票依法发行后，经营与收益变化由发行人负责，由此引致的投资风险由投资者负责。"),
  chinaHistory: authority({
    title: "《优化金融环境 改善金融生态》",
    publisher: "中国人民银行",
    locator: "正文第 2 段（2005 年讲话，官网 2009-07-07 发布）",
    quote: "改革开放以来，我国金融业自身改革和支持经济社会发展取得巨大成效，金融宏观调控和监管显著加强，金融机构和金融市场体系不断完善，并初步建立了与社会主义市场经济相适应的金融体制。",
    url: "https://www.pbc.gov.cn/redianzhuanti/118742/118726/119512/2840832/index.html",
    effectiveDate: "历史发展材料"
  }),
  pbcMarketFactors: authority({
    title: "《优化金融环境 改善金融生态》",
    publisher: "中国人民银行",
    locator: "正文第 1 段",
    quote: "金融生态通常指金融运行的一系列外部基础条件，主要包括宏观经济环境、法制环境、信用环境、市场环境和制度环境等方面。",
    url: "https://www.pbc.gov.cn/redianzhuanti/118742/118726/119512/2840832/index.html",
    effectiveDate: "概念材料"
  }),
  regulatorReform: authority({
    title: "《党和国家机构改革方案》",
    publisher: "中国政府网 / 新华社",
    locator: "金融监管体制改革第（八）至（十）项",
    quote: "国家金融监督管理总局统一负责除证券业之外的金融业监管，强化机构监管、行为监管、功能监管、穿透式监管、持续监管；地方政府设立的金融监管机构专司监管职责；中国证监会调整为国务院直属机构并强化资本市场监管职责。",
    url: "https://www.gov.cn/xinwen/2023-03/16/content_5747072.htm",
    effectiveDate: "2023-03-16"
  }),
  financeConferenceSystem: authority({
    title: "中央金融工作会议在北京举行",
    publisher: "中国政府网 / 新华社",
    locator: "关于现代金融机构和市场体系的段落",
    quote: "会议提出打造现代金融机构和市场体系，优化融资结构，更好发挥资本市场枢纽功能，发展多元化股权融资，促进债券市场高质量发展，并打造规则统一、监管协同的金融市场。",
    url: "https://www.gov.cn/yaowen/liebiao/202310/content_6912992.htm",
    effectiveDate: "2023-10-31"
  }),
  financeConferenceService: authority({
    title: "中央金融工作会议在北京举行",
    publisher: "中国政府网 / 新华社",
    locator: "关于金融服务实体经济的段落",
    quote: "会议强调坚持把金融服务实体经济作为根本宗旨；优化资金供给结构，把更多金融资源用于科技创新、先进制造、绿色发展和中小微企业，并盘活低效金融资源、提高资金使用效率。",
    url: "https://www.gov.cn/yaowen/liebiao/202310/content_6912992.htm",
    effectiveDate: "2023-10-31"
  }),
  financeConferenceRisk: authority({
    title: "中央金融工作会议在北京举行",
    publisher: "中国政府网 / 新华社",
    locator: "关于金融安全与风险防控的段落",
    quote: "会议强调把防控风险作为金融工作的永恒主题，牢牢守住不发生系统性金融风险的底线；维护金融市场稳健运行，防范风险跨区域、跨市场、跨境传递共振，并对风险早识别、早预警、早暴露、早处置。",
    url: "https://www.gov.cn/yaowen/liebiao/202310/content_6912992.htm",
    effectiveDate: "2023-10-31"
  }),
  commercialBankBusiness: law("commercialBank", "《中华人民共和国商业银行法》", "第二条至第四条",
    "商业银行是依法设立的吸收公众存款、发放贷款、办理结算等业务的企业法人；其经营以安全性、流动性、效益性为原则，实行自主经营、自担风险、自负盈亏、自我约束。"),
  trustDefinition: law("trust", "《中华人民共和国信托法》", "第二条、第十四条至第十六条",
    "信托是委托人将财产权委托给受托人，由受托人按委托人的意愿，以自己的名义，为受益人利益或特定目的管理、处分的行为；信托财产与委托人其他财产及受托人固有财产相区别。"),
  insuranceDefinition: law("insurance", "《中华人民共和国保险法》", "第二条",
    "保险是投保人按合同约定支付保险费，保险人对合同约定的可能事故造成的财产损失承担赔偿责任，或者在被保险人死亡、伤残、疾病或达到约定条件时承担给付保险金责任的商业保险行为。"),
  securitiesIssue: law("securities", "《中华人民共和国证券法》", "第九条、第二十六条",
    "公开发行证券必须符合法律、行政法规规定的条件并依法注册。依法需要承销的，发行人应与证券公司签订承销协议，承销采取代销或者包销方式。"),
  suitability: law("securities", "《中华人民共和国证券法》", "第八十八条",
    "证券公司销售证券、提供服务时，应充分了解投资者相关情况，如实说明重要内容，充分揭示投资风险，并销售、提供与投资者状况相匹配的证券、服务。"),
  securitiesBusiness: law("securities", "《中华人民共和国证券法》", "第一百二十条",
    "取得经营证券业务许可证的证券公司，可以依法经营证券经纪、投资咨询、财务顾问、证券承销与保荐、融资融券、做市交易、证券自营等部分或全部证券业务；资产管理业务适用基金法等规定。"),
  securitiesServices: law("securities", "《中华人民共和国证券法》", "第一百六十三条",
    "证券服务机构为证券发行、上市、交易等活动制作、出具审计、鉴证、资产评估、财务顾问、资信评级或法律意见等文件，应当勤勉尽责，并核查验证所依据资料的真实性、准确性、完整性。"),
  securitiesExchange: law("securities", "《中华人民共和国证券法》", "第九十六条、第一百零九条、第一百一十二条、第一百一十五条",
    "证券交易所组织和监督证券交易，实行自律管理；应为组织公平的集中交易提供保障，对证券交易实行实时监控，并依法制定上市规则、交易规则、会员管理规则和其他业务规则。"),
  securitiesAssociation: law("securities", "《中华人民共和国证券法》", "第一百六十四条至第一百六十六条",
    "证券业协会是证券业的自律性组织、社会团体法人；其职责包括组织会员遵守证券法律法规、制定会员自律规则、实施自律管理、开展行业研究与服务以及纠纷调解等。"),
  companyRights: law("company", "《中华人民共和国公司法》", "第三条、第四条",
    "公司有独立法人财产并以全部财产对公司债务承担责任；股份有限公司股东以认购股份为限承担责任，并依法享有资产收益、参与重大决策和选择管理者等权利。"),
  disclosure: law("securities", "《中华人民共和国证券法》", "第十九条、第七十八条、第八十二条",
    "发行申请文件应充分披露投资者作出价值判断和投资决策所必需的信息，内容真实、准确、完整；信息披露义务人应及时依法履行披露义务，披露的信息真实、准确、完整，简明清晰、通俗易懂。"),
  priceTime: authority({
    title: "如何理解证券竞价交易“价格优先、时间优先”成交原则？",
    publisher: "深圳证券交易所投资者教育中心",
    locator: "《深圳证券交易所交易规则》3.5.1 条释义",
    quote: "较高价格买入申报优先于较低价格买入申报，较低价格卖出申报优先于较高价格卖出申报；买卖方向、价格相同的，先申报者优先于后申报者。",
    url: "https://investor.szse.cn/knowledge/t20191204_572385.html",
    effectiveDate: "规则原理材料（具体交易以现行规则为准）"
  }),
  exchangeRiskMeasure: law("securities", "《中华人民共和国证券法》", "第一百一十三条",
    "证券交易所应加强证券交易风险监测；出现重大异常波动时，可以按照业务规则采取限制交易、强制停牌等处置措施，严重影响市场稳定的，可以临时停市。"),
  marginBusiness: law("securities", "《中华人民共和国证券法》", "第一百二十条",
    "证券融资融券属于许可证券业务；除证券公司外，任何单位和个人不得从事证券融资融券业务。证券公司开展该业务应采取措施严格防范和控制风险，不得违反规定向客户出借资金或者证券。"),
  centralDebt: law("budget", "《中华人民共和国预算法》", "第三十四条",
    "中央一般公共预算中必需的部分资金可以通过举借国内和国外债务等方式筹措；中央政府债务实行余额管理，由国务院财政部门统一管理。"),
  localDebt: law("budget", "《中华人民共和国预算法》", "第三十五条",
    "经国务院批准的省、自治区、直辖市，可以在国务院确定的限额内发行地方政府债券举借债务；债务应有偿还计划和稳定资金来源，只能用于公益性资本支出，不得用于经常性支出。"),
  netPrice: authority({
    title: "《深圳证券交易所债券交易规则》",
    publisher: "深圳证券交易所",
    locator: "净价交易与全价结算定义（具体品种以现行规则为准）",
    quote: "债券净价是不含应计利息的价格；全价为净价与应计利息之和。区分两者可以避免把行情报价直接当作最终结算金额。",
    url: "https://www.szse.cn/lawrules/rule/bond/",
    effectiveDate: "现行规则入口（2026-08-18 核对）"
  }),
  fundStructure: law("fund", "《中华人民共和国证券投资基金法》", "第三条、第五条至第七条",
    "基金管理人依照法律和基金合同管理基金财产，基金托管人履行安全保管职责；基金财产独立于管理人、托管人的固有财产，基金财产债务由基金财产本身承担。"),
  fundPublicPrivate: law("fund", "《中华人民共和国证券投资基金法》", "第五十条、第八十七条、第九十一条",
    "公开募集基金应经注册，未经注册不得公开或变相公开募集；非公开募集基金应向合格投资者募集，不得向合格投资者之外的单位和个人募集，也不得向不特定对象公开宣传推介。"),
  fundOpenClosed: law("fund", "《中华人民共和国证券投资基金法》", "第四十五条",
    "封闭式基金的基金份额总额在基金合同期限内固定不变，基金份额持有人不得申请赎回；开放式基金的份额总额不固定，基金份额可以在基金合同约定的时间和场所申购或者赎回。"),
  fundStages: law("fund", "《中华人民共和国证券投资基金法》", "第五十五条至第六十条、第六十六条、第六十九条",
    "募集申请注册后方可发售基金份额，募集期届满并满足条件后基金合同生效；开放式基金合同生效后，可按合同约定办理基金份额申购、赎回，其价格依据申购、赎回日份额净值加减有关费用计算。"),
  fundNav: law("fund", "《中华人民共和国证券投资基金法》", "第十九条、第六十九条、第七十条",
    "基金管理人应计算并公告基金资产净值，确定基金份额申购、赎回价格；申购、赎回价格依据当日基金份额净值加减费用计算，净值计价错误达到规定标准时应公告并采取纠正措施。"),
  fundFees: law("fund", "《中华人民共和国证券投资基金法》", "第四十六条、第五十二条",
    "基金份额持有人按所持份额享受收益和承担风险；基金合同应载明基金管理人、基金托管人报酬及其他费用的提取、支付方式与比例。"),
  fundDisclosure: law("fund", "《中华人民共和国证券投资基金法》", "第七十四条至第七十六条",
    "基金信息披露义务人应依法披露基金信息并保证真实、准确、完整；公开披露内容包括募集情况、基金资产净值和份额净值、申购赎回价格、资产组合报告、财务会计报告和重大事项等。"),
  infraReit: authority({
    title: "关于做好基础设施领域不动产投资信托基金（REITs）试点项目申报工作的通知",
    publisher: "国家发展和改革委员会",
    locator: "发改办投资〔2020〕586号，第一部分及项目基本条件",
    quote: "开展基础设施 REITs 试点有助于盘活存量资产、调动社会资本并促进基础设施高质量发展；试点项目应持续健康平稳运营，现金流持续稳定且来源合理分散。",
    url: "https://www.ndrc.gov.cn/xxgk/zcfb/tz/202008/t20200803_1235506.html",
    effectiveDate: "2020-07-31（试点政策材料）"
  }),
  futuresDefinitions: law("futures", "《中华人民共和国期货和衍生品法》", "第三条",
    "期货合约是期货交易场所统一制定、约定未来特定时间和地点交割一定数量标的物的标准化合约；期权合约约定买方有权在未来以特定价格买入或卖出标的物；互换和远期合约也有法定定义。"),
  hedgeDefinition: law("futures", "《中华人民共和国期货和衍生品法》", "第四条",
    "国家鼓励利用期货和衍生品市场从事套期保值等风险管理活动。套期保值是交易者为管理资产、负债等价值变化产生的风险，达成与上述资产、负债等基本吻合的期货或衍生品交易。"),
  liquidityRisk: authority({
    sourceClass: "international_standard",
    jurisdiction: "国际标准 / 非中国现行规则",
    answerBasis: false,
    title: "Principles for Sound Liquidity Risk Management and Supervision",
    publisher: "Basel Committee on Banking Supervision / BIS",
    locator: "Abstract，第 1–2 段",
    quote: "流动性是银行在不发生不可接受损失的情况下，为资产增加提供资金并在债务到期时履约的能力；市场环境逆转表明流动性可能迅速消失。（项目中文短译）",
    originalQuote: "Liquidity is the ability of a bank to fund increases in assets and meet obligations as they come due, without incurring unacceptable losses. … The reversal in market conditions illustrated how quickly liquidity can evaporate.",
    url: "https://www.bis.org/publ/bcbs144.htm",
    effectiveDate: "2008-09（2019 年完成复核）"
  }),
  operationalRisk: authority({
    sourceClass: "international_standard",
    jurisdiction: "国际标准 / 非中国现行规则",
    answerBasis: false,
    title: "Basel Framework — Definition of operational risk",
    publisher: "Basel Committee on Banking Supervision / BIS",
    locator: "OPE10.1",
    quote: "操作风险是由不完善或有问题的内部程序、人员、系统或外部事件导致损失的风险；该定义包含法律风险。（项目中文短译）",
    originalQuote: "Operational risk is defined as the risk of loss resulting from inadequate or failed internal processes, people and systems or from external events. This definition includes legal risk.",
    url: "https://www.bis.org/basel_framework/chapter/OPE/10.htm",
    effectiveDate: "Basel Framework（2026-08-18 核对）"
  }),
  marketRisk: authority({
    sourceClass: "international_standard",
    jurisdiction: "国际标准 / 非中国现行规则",
    answerBasis: false,
    title: "Basel Framework — Definition of market risk",
    publisher: "Basel Committee on Banking Supervision / BIS",
    locator: "MAR10.1",
    quote: "市场风险是由市场价格变动引起损失的风险；市场风险框架覆盖的风险包括利率、信用利差、权益、外汇和商品等风险。（项目中文短译）",
    originalQuote: "Market risk is the risk of losses arising from movements in market prices. The risks subject to market risk capital requirements include but are not limited to: default risk, interest rate risk, credit spread risk, equity risk, foreign exchange risk and commodities risk.",
    url: "https://www.bis.org/basel_framework/chapter/MAR/10.htm",
    effectiveDate: "Basel Framework（2026-08-18 核对）"
  })
};

export const financeReferenceMap = {
  F001: [refs.marketTerms],
  F002: [refs.financialSystem],
  F003: [refs.directFinance, refs.intermediary],
  F004: [refs.internationalMarkets],
  F005: [refs.pbocDuties, refs.centralBalance],
  F006: [refs.multiplier, refs.pbocTools],
  F007: [refs.pbocTools, refs.openMarket],
  F008: [refs.transmission],
  F009: [refs.marketLayers],
  F010: [refs.registration],
  F061: [refs.chinaHistory],
  F062: [refs.financeConferenceSystem],
  F063: [refs.pbcMarketFactors, refs.investmentRisk],
  F064: [refs.regulatorReform, refs.regulatorFunctions],
  F065: [refs.regulatorReform, refs.pbocDuties],
  F066: [refs.financeConferenceService],
  F067: [refs.financeConferenceRisk],
  F068: [refs.intermediary, refs.fundStructure],
  F069: [refs.commercialBankBusiness, refs.insuranceDefinition, refs.trustDefinition, refs.securitiesBusiness],
  F070: [refs.commercialBankBusiness, refs.securitiesBusiness, refs.insuranceDefinition],
  F011: [refs.securitiesIssue],
  F012: [refs.mutualFund, refs.diversification],
  F013: [refs.suitability],
  F014: [refs.securitiesBusiness],
  F015: [refs.securitiesServices],
  F016: [refs.securitiesExchange],
  F017: [refs.securitiesAssociation],
  F018: [refs.debtEquity, refs.companyRights],
  F019: [refs.companyRights, refs.commonPreferred],
  F020: [refs.commonPreferred, refs.debtEquity],
  F021: [refs.disclosure],
  F022: [refs.priceTime],
  F023: [refs.exchangeRiskMeasure],
  F024: [refs.marginBusiness],
  F025: [refs.indexes],
  F026: [refs.stockValue, refs.relativeValue],
  F027: [refs.timeValue],
  F028: [refs.stockValue, refs.relativeValue, refs.timeValue],
  F029: [refs.bondTerms],
  F030: [refs.debtEquity],
  F031: [refs.centralDebt, refs.bondTerms],
  F032: [refs.localDebt],
  F033: [refs.convertible],
  F034: [refs.mortgageBacked],
  F035: [refs.repo],
  F036: [refs.netPrice],
  F037: [refs.bondRates],
  F038: [refs.yieldToMaturity, refs.bondRates],
  F039: [refs.yieldCurve],
  F040: [refs.fundStructure, refs.mutualFund],
  F041: [refs.fundOpenClosed, refs.openClosedEtf],
  F042: [refs.fundPublicPrivate],
  F043: [refs.openClosedEtf],
  F044: [refs.fundStages],
  F045: [refs.fundNav],
  F046: [refs.fundFees],
  F047: [refs.fundDisclosure],
  F048: [refs.infraReit, refs.reit],
  F049: [refs.futuresDefinitions, refs.derivatives],
  F050: [refs.futuresDefinitions, refs.forwardsFutures],
  F051: [refs.futuresDefinitions, refs.options],
  F052: [refs.futuresDefinitions, refs.options],
  F053: [refs.forwardsFutures, refs.futuresDefinitions],
  F054: [refs.swaps, refs.futuresDefinitions],
  F055: [refs.hedgeDefinition],
  F056: [refs.investmentRisk, refs.marketRisk, refs.creditRisk, refs.liquidityRisk, refs.operationalRisk],
  F057: [refs.marketRisk, refs.investmentRisk],
  F058: [refs.creditRisk],
  F059: [refs.liquidityRisk, refs.liquidityConcept],
  F060: [refs.operationalRisk]
};
