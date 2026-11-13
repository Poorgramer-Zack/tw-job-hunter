import { describe, expect, it } from "vitest";
import {
  AI_FLUFF_PHRASES,
  MAINLAND_TERM_MAPPING,
  cleanTextSpacing,
  detectAiFluff,
  detectMainlandTerms,
  normalizeTwText,
} from "../../src/resume/locale_rules.js";

describe("locale_rules", () => {
  it("MAINLAND_TERM_MAPPING 包含台灣在地化常用對照", () => {
    expect(MAINLAND_TERM_MAPPING).toHaveProperty("信息");
    expect(["資訊", "訊息"]).toContain(MAINLAND_TERM_MAPPING["信息"]);
    expect(MAINLAND_TERM_MAPPING["視頻"]).toBe("影片");
    expect(MAINLAND_TERM_MAPPING["項目"]).toBe("專案");
    expect(MAINLAND_TERM_MAPPING).toHaveProperty("賦能");
    expect(MAINLAND_TERM_MAPPING).toHaveProperty("抓手");
    expect(["我們公司", "本公司"]).toContain(MAINLAND_TERM_MAPPING["我司"]);
    expect(MAINLAND_TERM_MAPPING["默認"]).toBe("預設");
  });

  it("AI_FLUFF_PHRASES 包含常見 AI 空泛詞彙", () => {
    expect(
      AI_FLUFF_PHRASES.some((p) => p.includes("數位時代") || p.includes("快速發展")),
    ).toBe(true);
    expect(
      AI_FLUFF_PHRASES.some((p) => p.includes("共創價值") || p.includes("共創雙贏")),
    ).toBe(true);
    expect(AI_FLUFF_PHRASES.some((p) => p.includes("深感榮幸"))).toBe(true);
    expect(
      AI_FLUFF_PHRASES.some((p) => p.includes("綜上所述") || p.includes("總的來說")),
    ).toBe(true);
  });

  it("detectMainlandTerms 能偵測大陸用語並提供替換建議", () => {
    const sample = "我在上個項目中負責視頻播放與信息推播優化，賦能團隊。";
    const detected = detectMainlandTerms(sample);
    const terms = detected.map((item) => item.term);
    expect(terms).toContain("項目");
    expect(terms).toContain("視頻");
    expect(terms).toContain("信息");
    expect(terms).toContain("賦能");
    const videoItem = detected.find((x) => x.term === "視頻");
    expect(videoItem?.replacement).toBe("影片");
  });

  it("detectAiFluff 能偵測 AI 腔調虛詞", () => {
    const sample =
      "在快速發展的數位時代，我深感榮幸能應徵此職缺，期望發揮所長共創價值。";
    const fluff = detectAiFluff(sample);
    expect(fluff.length).toBeGreaterThanOrEqual(2);
  });

  it("normalizeTwText 能將確定性大陸用語替換為台灣詞彙", () => {
    const sample = "負責維護核心項目與視頻串流服務，預設配置保證性能。";
    const normalized = normalizeTwText(sample);
    expect(normalized).toContain("專案");
    expect(normalized).not.toContain("項目");
    expect(normalized).toContain("影片");
    expect(normalized).not.toContain("視頻");
  });

  it("cleanTextSpacing 能統一項目符號並清理行首尾空格", () => {
    const raw = "  •  主導系統重構\n ▪   優化載入時間  \n - 提升效能  ";
    const cleaned = cleanTextSpacing(raw);
    const lines = cleaned.split("\n");
    expect(lines[0]).toBe("• 主導系統重構");
    expect(lines[1]).toBe("• 優化載入時間");
    expect(lines[2]).toBe("• 提升效能");
  });
});
