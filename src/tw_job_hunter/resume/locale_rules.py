"""台灣在地化用語與去 AI 腔調規則庫 (參考 speak-human-tw 精神與前次研究報告)。"""
import re

# 繁體台灣對應中國大陸常見用語替換表
MAINLAND_TERM_MAPPING: dict[str, str] = {
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
}

# AI 腔調高頻虛詞與假大空句型黑名單
AI_FLUFF_PHRASES: list[str] = [
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
]

_BULLET_RE = re.compile(r"^\s*([•▪\-*●•▪●])\s*", re.MULTILINE)


def detect_mainland_terms(text: str) -> list[dict[str, str]]:
    """檢測文本中包含的中國大陸慣用語，並提供台灣在地化替換建議。"""
    found: list[dict[str, str]] = []
    if not text:
        return found
    for term, replacement in MAINLAND_TERM_MAPPING.items():
        if term in text:
            found.append({"term": term, "replacement": replacement})
    return found


def detect_ai_fluff(text: str) -> list[str]:
    """檢測文本中是否包含 AI 常見空泛套話或浮誇虛詞。"""
    if not text:
        return []
    return [phrase for phrase in AI_FLUFF_PHRASES if phrase in text]


def normalize_tw_text(text: str) -> str:
    """自動替換確定性的常用大陸用語為台灣在地詞彙。"""
    if not text:
        return ""
    normalized = text
    # 依長度降序排列，避免子字串覆蓋
    for term in sorted(MAINLAND_TERM_MAPPING.keys(), key=len, reverse=True):
        if term in normalized:
            normalized = normalized.replace(term, MAINLAND_TERM_MAPPING[term])
    return normalized


def clean_text_spacing(text: str) -> str:
    """統一項目符號為標準 '• '，並清理行首尾多餘空格。"""
    if not text:
        return ""
    lines = []
    for line in text.splitlines():
        trimmed = line.strip()
        if not trimmed:
            continue
        # 將各類 bullet 統一為 '• '
        if _BULLET_RE.match(trimmed):
            trimmed = _BULLET_RE.sub("• ", trimmed)
        lines.append(trimmed)
    return "\n".join(lines)
