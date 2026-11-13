/** PDF 履歷無損高保真解析模組。 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { extractText } from "unpdf";
import { cleanTextSpacing } from "./locale_rules.js";

export class FileNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileNotFoundError";
  }
}

export const SECTION_MARKERS: Array<[string, string[]]> = [
  ["experience", ["工作經歷", "經歷", "職歷", "工作經驗", "employment history", "work experience"]],
  ["projects", ["專案成就", "專案經驗", "專案", "精選專案", "作品集", "projects", "portfolio"]],
  ["skills", ["專業技能", "技能專長", "擅長工具", "技術棧", "skills", "technical skills", "backend", "frontend", "ai-native"]],
  ["education", ["學歷", "教育背景", "最高學歷", "education", "academic background"]],
  ["autobiography", ["自傳", "自我介紹", "求職自傳", "autobiography", "cover letter"]],
  ["summary", ["個人資料", "基本資料", "個人簡介", "關於我", "summary", "profile", "about me"]],
];

export interface ResumeParseResult {
  status: "ok" | "warning";
  message?: string;
  page_count: number;
  total_characters: number;
  text: string;
  pages: string[];
  sections: Record<string, string>;
}

/** 將 PDF 中提取的康熙部首與相容字元轉換為標準繁體字（NFKC 已涵蓋，例如 U+2F2F「⼯」→「工」）。 */
export function normalizeKangxiAndUnicode(text: string): string {
  return text ? text.normalize("NFKC") : "";
}

/** 切分履歷常見大區塊。 */
export function splitIntoSections(text: string): Record<string, string> {
  const sections: Record<string, string[]> = { summary: [] };
  let currentSection = "summary";

  for (const line of text.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const normalizedLine = normalizeKangxiAndUnicode(trimmed);
    const lineLower = normalizedLine.toLowerCase();

    let matchedSection: string | null = null;
    for (const [secName, keywords] of SECTION_MARKERS) {
      for (const kw of keywords) {
        if (
          normalizedLine.length <= 25 &&
          (lineLower.startsWith(kw) || lineLower.endsWith(kw) || lineLower.includes(kw))
        ) {
          matchedSection = secName;
          break;
        }
      }
      if (matchedSection) break;
    }

    if (matchedSection) {
      currentSection = matchedSection;
      if (!sections[currentSection]) {
        sections[currentSection] = [];
      }
      sections[currentSection].push(trimmed);
    } else {
      sections[currentSection].push(trimmed);
    }
  }

  const output: Record<string, string> = {};
  for (const [k, v] of Object.entries(sections)) {
    if (v.length > 0) {
      output[k] = v.join("\n").trim();
    }
  }
  return output;
}

/** 無損提取 PDF 履歷文字與結構化章節。 */
export async function extractResumePdf(filePath: string): Promise<ResumeParseResult> {
  const resolved = path.resolve(filePath);
  let isFile = false;
  try {
    const fileStat = await stat(filePath);
    isFile = fileStat.isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new FileNotFoundError(`找不到履歷檔案：${resolved}`);
  }

  try {
    const buffer = await readFile(filePath);
    const { totalPages, text: rawPages } = await extractText(new Uint8Array(buffer), {
      mergePages: false,
    });

    const pageTexts: string[] = [];
    for (const txt of rawPages) {
      const normalizedTxt = normalizeKangxiAndUnicode(txt ?? "");
      const cleanedPage = cleanTextSpacing(normalizedTxt);
      pageTexts.push(cleanedPage);
    }

    const combinedText = pageTexts.join("\n\n").trim();
    const totalChars = combinedText.length;

    if (totalChars < 50) {
      return {
        status: "warning",
        message: "偵測到該 PDF 可能為圖片或掃描檔，提取文字過少（小於50字）。建議提供可選取文字之電子履歷。",
        page_count: totalPages,
        total_characters: totalChars,
        text: combinedText,
        pages: pageTexts,
        sections: {},
      };
    }

    const sections = splitIntoSections(combinedText);

    return {
      status: "ok",
      page_count: totalPages,
      total_characters: totalChars,
      text: combinedText,
      pages: pageTexts,
      sections,
    };
  } catch (err) {
    if (err instanceof FileNotFoundError) {
      throw err;
    }
    const errName = err instanceof Error ? err.name : "Error";
    const errMsg = err instanceof Error ? err.message : String(err);
    throw new Error(`讀取 PDF 失敗：${errName} - ${errMsg}`, { cause: err });
  }
}
