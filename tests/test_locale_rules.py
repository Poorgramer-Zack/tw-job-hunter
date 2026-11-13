import pytest

from tw_job_hunter.resume import locale_rules


def test_mainland_terms_replacement_dict_populated():
    mapping = locale_rules.MAINLAND_TERM_MAPPING
    assert "信息" in mapping and mapping["信息"] in ("資訊", "訊息")
    assert "視頻" in mapping and mapping["視頻"] == "影片"
    assert "項目" in mapping and mapping["項目"] == "專案"
    assert "賦能" in mapping
    assert "抓手" in mapping
    assert "我司" in mapping and mapping["我司"] in ("我們公司", "本公司")
    assert "默認" in mapping and mapping["默認"] == "預設"


def test_ai_fluff_phrases_list_populated():
    phrases = locale_rules.AI_FLUFF_PHRASES
    assert any("數位時代" in p or "快速發展" in p for p in phrases)
    assert any("共創價值" in p or "共創雙贏" in p for p in phrases)
    assert any("深感榮幸" in p for p in phrases)
    assert any("綜上所述" in p or "總的來說" in p for p in phrases)


def test_detect_mainland_terms():
    sample = "我在上個項目中負責視頻播放與信息推播優化，賦能團隊。"
    detected = locale_rules.detect_mainland_terms(sample)
    terms = [item["term"] for item in detected]
    assert "項目" in terms
    assert "視頻" in terms
    assert "信息" in terms
    assert "賦能" in terms
    # Check suggestion exists
    item = next(x for x in detected if x["term"] == "視頻")
    assert item["replacement"] == "影片"


def test_detect_ai_fluff():
    sample = "在快速發展的數位時代，我深感榮幸能應徵此職缺，期望發揮所長共創價值。"
    fluff = locale_rules.detect_ai_fluff(sample)
    assert len(fluff) >= 2


def test_normalize_tw_text_replaces_direct_terms():
    sample = "負責維護核心項目與視頻串流服務，預設配置保證性能。"
    # Note: 性能 is accepted in TW technical context or can stay, but 項目 and 視頻 must normalize
    normalized = locale_rules.normalize_tw_text(sample)
    assert "專案" in normalized and "項目" not in normalized
    assert "影片" in normalized and "視頻" not in normalized


def test_clean_bullet_formatting():
    raw = "  •  主導系統重構\n ▪   優化載入時間  \n - 提升效能  "
    cleaned = locale_rules.clean_text_spacing(raw)
    lines = cleaned.splitlines()
    assert lines[0] == "• 主導系統重構"
    assert lines[1] == "• 優化載入時間"
    assert lines[2] == "• 提升效能"
