"""PDF 履歷無損高保真解析模組。

使用 pypdf 提取多頁文字、清洗符號並辨識主要履歷區塊。
包含 104 匯出 PDF 常見之康熙部首 (Kangxi Radicals) 與相容字元正規化。
"""
from pathlib import Path
from typing import Any
import unicodedata

import pypdf

from tw_job_hunter.resume.locale_rules import clean_text_spacing

# 104 常見特殊部首對照修正（如 '⼯' ⼈ -> '工' 工, '⼈' ⼇ -> '人' 人）
RADICAL_REPLACEMENTS = {
    "⼈": "工",
    "⼇": "人",
    "⼘": "力",
    "⼚": "匕",
    "⼝": "十",
    "⼞": "卜",
    "⼯": "山",
    "⼴": "巾",
    "⽉": "日",
    "⽊": "月",
    "⽋": "木",
    "⽕": "水",
    "⽥": "目",
    "⽷": "糸",
    "⽿": "言",
    "⾋": "車",
    "⾔": "門",
}

# 常見履歷區塊標題關鍵字模式
SECTION_MARKERS = [
    ("experience", ["工作經歷", "經歷", "職歷", "工作經驗", "employment history", "work experience"]),
    ("projects", ["專案成就", "專案經驗", "專案", "精選專案", "作品集", "projects", "portfolio"]),
    ("skills", ["專業技能", "技能專長", "擅長工具", "技術棧", "skills", "technical skills", "backend", "frontend", "ai-native"]),
    ("education", ["學歷", "教育背景", "最高學歷", "education", "academic background"]),
    ("autobiography", ["自傳", "自我介紹", "求職自傳", "autobiography", "cover letter"]),
    ("summary", ["個人資料", "基本資料", "個人簡介", "關於我", "summary", "profile", "about me"]),
]


def normalize_kangxi_and_unicode(text: str) -> str:
    """將 PDF 中提取的康熙部首與相容字元轉換為標準繁體字。"""
    if not text:
        return ""
    text = unicodedata.normalize("NFKC", text)
    for radical, normal in RADICAL_REPLACEMENTS.items():
        text = text.replace(radical, normal)
    return text


def _split_into_sections(text: str) -> dict[str, str]:
    """切分履歷常見大區塊。"""
    sections: dict[str, list[str]] = {}
    current_section = "summary"
    sections[current_section] = []

    lines = text.splitlines()
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue

        normalized_line = normalize_kangxi_and_unicode(trimmed)
        line_lower = normalized_line.lower()

        # 比對段落標題（字數通常較短，或是常見章節起點）
        matched_section = None
        for sec_name, keywords in SECTION_MARKERS:
            for kw in keywords:
                # 若行首或行尾吻合標題詞且長度有限，判定為章節標記
                if len(normalized_line) <= 25 and (line_lower.startswith(kw) or line_lower.endswith(kw) or kw in line_lower):
                    matched_section = sec_name
                    break
            if matched_section:
                break

        if matched_section:
            current_section = matched_section
            if current_section not in sections:
                sections[current_section] = []
            sections[current_section].append(trimmed)
        else:
            sections[current_section].append(trimmed)

    return {k: "\n".join(v).strip() for k, v in sections.items() if v}


def extract_resume_pdf(file_path: str | Path) -> dict[str, Any]:
    """無損提取 PDF 履歷文字與結構化章節。"""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"找不到履歷檔案：{path.resolve()}")

    try:
        reader = pypdf.PdfReader(str(path))
        page_texts: list[str] = []
        for page in reader.pages:
            txt = page.extract_text() or ""
            normalized_txt = normalize_kangxi_and_unicode(txt)
            cleaned_page = clean_text_spacing(normalized_txt)
            page_texts.append(cleaned_page)

        combined_text = "\n\n".join(page_texts).strip()
        total_chars = len(combined_text)

        if total_chars < 50:
            return {
                "status": "warning",
                "message": "偵測到該 PDF 可能為圖片或掃描檔，提取文字過少（小於50字）。建議提供可選取文字之電子履歷。",
                "page_count": len(reader.pages),
                "total_characters": total_chars,
                "text": combined_text,
                "pages": page_texts,
                "sections": {},
            }

        sections = _split_into_sections(combined_text)

        return {
            "status": "ok",
            "page_count": len(reader.pages),
            "total_characters": total_chars,
            "text": combined_text,
            "pages": page_texts,
            "sections": sections,
        }
    except Exception as e:
        if isinstance(e, FileNotFoundError):
            raise
        raise RuntimeError(f"讀取 PDF 失敗：{type(e).__name__} - {e}") from e
