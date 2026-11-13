/** 台灣在地化用語與去 AI 腔調規則庫。 */

export const MAINLAND_TERM_MAPPING: Record<string, string> = {
  "信息": "資訊",
  "視頻": "影片",
  "項目": "專案",
  "賦能": "支援／協助",
  "抓手": "著手點／突破點",
  "複盤": "檢討回顧",
  "我司": "本公司",
  "默認": "預設",
  "內存": "記憶體",
  "套件": "套件",
  "組件": "元件",
  "接口": "介面／API",
  "鏈接": "連結",
  "登陸": "登入",
  "支持": "支援",
  "優化": "最佳化／優化",
  "底層邏輯": "核心架構／本質原因",
  "閉環": "完整流程",
  "顆粒度": "細緻度／精細度",
  "維度": "面向／構面",
  "打法": "策略／做法",
  "痛點": "核心困難／瓶頸",
};

export const AI_FLUFF_PHRASES: string[] = [
  "在快速發展的數位時代",
  "在日新月異的科技浪潮中",
  "深感榮幸能應徵",
  "貴司為業界翹楚",
  "貴公司是業界龍頭",
  "發揮所長共創價值",
  "發揮所長，共創雙贏",
  "創造雙贏",
  "具備跨領域整合能力",
  "熱愛挑戰自我",
  "綜上所述",
  "總的來說",
  "我堅信我的加入能為",
  "為貴公司賦能",
  "擁有高度的團隊協作精神與抗壓性",
];

const BULLET_RE = /^\s*([•▪\-*●])\s*/;

export interface MainlandTermMatch {
  term: string;
  replacement: string;
}

/** 檢測文本中包含的中國大陸慣用語，並提供台灣在地化替換建議。 */
export function detectMainlandTerms(text: string): MainlandTermMatch[] {
  if (!text) return [];
  const found: MainlandTermMatch[] = [];
  for (const [term, replacement] of Object.entries(MAINLAND_TERM_MAPPING)) {
    if (text.includes(term)) {
      found.push({ term, replacement });
    }
  }
  return found;
}

/** 檢測文本中是否包含 AI 常見空泛套話或浮誇虛詞。 */
export function detectAiFluff(text: string): string[] {
  if (!text) return [];
  return AI_FLUFF_PHRASES.filter((phrase) => text.includes(phrase));
}

/** 自動替換確定性的常用大陸用語為台灣詞彙。 */
export function normalizeTwText(text: string): string {
  if (!text) return "";
  let normalized = text;
  const sortedTerms = Object.keys(MAINLAND_TERM_MAPPING).sort(
    (a, b) => b.length - a.length,
  );
  for (const term of sortedTerms) {
    if (normalized.includes(term)) {
      normalized = normalized.replaceAll(term, MAINLAND_TERM_MAPPING[term]);
    }
  }
  return normalized;
}

/** 統一項目符號為標準 '• '，並清理行首尾多餘空格。 */
export function cleanTextSpacing(text: string): string {
  if (!text) return "";
  const lines: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    let trimmed = line.trim();
    if (!trimmed) continue;
    if (BULLET_RE.test(trimmed)) {
      trimmed = trimmed.replace(BULLET_RE, "• ");
    }
    lines.push(trimmed);
  }
  return lines.join("\n");
}
