import { financeFacts } from "./facts-finance.mjs";
import { financeExpansionFacts } from "./facts-finance-expansion.mjs";
import { lawFacts } from "./facts-law.mjs";
import { lawExpansionFacts } from "./facts-law-expansion.mjs";

export const facts = [...financeFacts, ...financeExpansionFacts, ...lawFacts, ...lawExpansionFacts];
