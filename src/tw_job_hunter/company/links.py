"""各站連結，純字串組合，不發出任何請求。已知公司 id 時給公司頁，否則給搜尋連結。"""
from urllib.parse import quote

from .common import short_name


def build(name: str, goodjob_name: str | None = None, qollie_id: str | None = None, itw_short_id: str | None = None) -> dict:
    short = short_name(name)
    q = quote(short, safe="")
    return {
        "goodjob": "https://www.goodjob.life/companies/" + quote(goodjob_name or name, safe=""),
        "qollie": f"https://www.qollie.com/companies/{qollie_id}" if qollie_id else f"https://www.qollie.com/search?keyword={q}",
        "interview_tw": f"https://interview.tw/c/{itw_short_id}" if itw_short_id else f"https://interview.tw/search?keyword={q}",
        "salary_tw": f"https://salary.tw/c/{itw_short_id}" if itw_short_id else "https://www.google.com/search?q=" + quote(f"{short} site:salary.tw", safe=""),
        "dcard": f"https://www.dcard.tw/search?query={q}&forum=job",
        "ptt": "https://www.google.com/search?q=" + quote(f"{short} site:ptt.cc", safe=""),
    }
