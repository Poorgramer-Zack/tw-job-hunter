import pytest

from tw_job_hunter.job104 import codes


@pytest.mark.usefixtures("offline_codes")
@pytest.mark.parametrize("name,code", [
    ("台北市", "6001001000"),
    ("臺北市", "6001001000"),
    (" 台北市 ", "6001001000"),
    ("新北市板橋區", "6001002003"),
    ("板橋", "6001002003"),
])
def test_area_lookup(name, code):
    assert codes.area_code(name) == code


@pytest.mark.usefixtures("offline_codes")
def test_area_unknown():
    with pytest.raises(ValueError, match="無法辨識的地區"):
        codes.area_code("火星")


@pytest.mark.usefixtures("offline_codes")
def test_area_ambiguous_lists_candidates():
    with pytest.raises(ValueError, match="多個符合.*中正區"):
        codes.area_code("中正區")


@pytest.mark.usefixtures("offline_codes")
def test_jobcat_lookup():
    assert codes.jobcat_code("軟體工程師") == "2007001004"


def test_table_cached(monkeypatch):
    n = [0]

    def fake(url, params=None, referer=None):
        n[0] += 1
        return [{"no": "1", "des": "甲"}]

    monkeypatch.setattr(codes, "get_json", fake)
    codes.area_code("甲")
    codes.area_code("甲")
    assert n[0] == 1
