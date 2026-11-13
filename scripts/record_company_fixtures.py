"""一次性腳本：錄製公司研調來源的真實回應，去識別化後存到 tests/fixtures/company/。

用法：TAVILY_API_KEY=... uv run python scripts/record_company_fixtures.py
每個請求間隔至少 3 秒，共約 15 個請求。

去識別化原則（因為 fixture 會進公開 repo）：
- 商工登記是政府開放資料，原樣保留。
- GoodJob、天眼通、Tavily：保留結構與統計數字，所有評論與搜尋摘要文字一律換成假文字，id 換成假 id。
- 天眼通原始資料含發文者 IP：白名單查詢本來就不取，這裡也不會寫入。
- 面試趣：只保留 JSON-LD 的公司資料與統計區塊，不保留任何心得文字。
"""
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

OUT = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "company"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
TAX_ID = "22099131"
_last = 0.0


def wait():
    global _last
    d = 3 - (time.monotonic() - _last)
    if d > 0:
        time.sleep(d)
    _last = time.monotonic()


def save(name: str, obj) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / name
    if isinstance(obj, str):
        p.write_text(obj, encoding="utf-8")
    else:
        p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    print("saved", name)


def fake_id(prefix: str, i: int) -> str:
    return f"{prefix}{i:022d}"


# ---------- 商工登記 ----------
GCIS = "https://data.gcis.nat.gov.tw/od/data/api/"


def gcis(api_id: str, flt: str):
    wait()
    r = requests.get(GCIS + api_id, params={"$format": "json", "$filter": flt, "$skip": 0, "$top": 50}, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    return r.json() if r.content else []


def anonymize_owner(rows: list[dict]) -> list[dict]:
    """TSMC 以外的負責人是私人姓名，不放進公開 repo。"""
    for r in rows:
        if r.get("Business_Accounting_NO") != TAX_ID:
            r["Responsible_Name"] = "測試負責人"
    return rows


def record_gcis():
    save("gcis_taxid.json", gcis("5F64D864-61CB-4D0D-8AD9-492047CC1EA6", f"Business_Accounting_NO eq {TAX_ID}"))
    save("gcis_name_search.json", anonymize_owner(gcis("6BBA2268-1367-4B42-9CCA-BC17499EBE8C", "Company_Name like 台灣積體電路製造 and Company_Status eq 01")[:5]))
    save("gcis_name_abbrev.json", anonymize_owner(gcis("6BBA2268-1367-4B42-9CCA-BC17499EBE8C", "Company_Name like 台積電 and Company_Status eq 01")[:5]))


# ---------- GoodJob ----------
GJ = "https://api.goodjob.life/graphql"
GJ_QUERY = """query($q:String!){search_companies(query:$q,hasData:false,limit:5){
 id name businessNumber dataCount experienceCount salaryWorkTimeCount policyReviewCount
 salary_work_time_statistics{count average_week_work_time average_estimated_hourly_wage
  overtime_frequency_count{seldom sometimes usually almost_everyday}
  has_overtime_salary_count{yes no unknown} is_overtime_salary_legal_count{yes no unknown} has_compensatory_dayoff_count{yes no unknown}
  job_average_salaries{job_title{name} average_salary{type amount} data_count}}
 companyRatingStatistics{averageRating ratingCount ratingDistribution{rating count}}
 companyAspectRatingStatistics{aspect type averageRating ratingCount}
 topNJobTitles{all{name}}
 interviewExperiencesResult(start:0,limit:2){count interviewExperiences{id title job_title{name} region experience_in_year interview_time{year month} interview_result created_at averageSectionRating sections{subtitle content}}}
 workExperiencesResult(start:0,limit:2){count workExperiences{id title job_title{name} region experience_in_year data_time{year month} week_work_time recommend_to_others created_at averageSectionRating sections{subtitle content}}}}}"""


def goodjob(q: str):
    wait()
    r = requests.post(GJ, json={"query": GJ_QUERY, "variables": {"q": q}}, headers={"User-Agent": "tw-job-hunter/0.1 (personal research)", "Content-Type": "application/json"}, timeout=30)
    r.raise_for_status()
    return r.json()


def sanitize_goodjob(resp: dict) -> dict:
    for c in resp["data"]["search_companies"]:
        for key, items in (("interviewExperiencesResult", "interviewExperiences"), ("workExperiencesResult", "workExperiences")):
            for i, e in enumerate((c.get(key) or {}).get(items, [])):
                e["id"] = fake_id("gj", i)
                e["title"] = f"假資料 公司 職稱 {i}"
                for j, s in enumerate(e.get("sections") or []):
                    s["content"] = f"假評論內容 {i}-{j}。這是測試用的文字，不是真實使用者的評論。"
    return resp


def record_goodjob():
    save("goodjob_taxid_22099131.json", sanitize_goodjob(goodjob(TAX_ID)))
    save("goodjob_not_found.json", goodjob("00000000"))


# ---------- 天眼通 ----------
QL = "https://www.qollie.com/graphql"
QS = requests.Session()
QS.headers.update({"User-Agent": UA, "Origin": "https://www.qollie.com", "Referer": "https://www.qollie.com/search"})


def qollie(query: str, variables: dict):
    wait()
    r = QS.post(QL, json={"query": query, "variables": variables}, timeout=30)
    r.raise_for_status()
    return r.json()


def record_qollie():
    search = qollie("""query S($k:String){ searchCompanies(query:{kind:"company",keyword:$k,limit:10,page:1}){ _id name taxId } }""", {"k": "台積電"})
    save("qollie_search.json", search)
    cid = next(c["_id"] for c in search["data"]["searchCompanies"] if c["taxId"] == TAX_ID)
    save("qollie_stat.json", qollie("""query C($id:ID!){ getCompanyStat(id:$id){ good normal bad total experienced question chat } }""", {"id": cid}))
    cm = qollie("""query Q($id:ID!){ searchComments(query:{companyId:$id,limit:3,page:1}){ _id content pros cons judge category createdAt } }""", {"id": cid})
    for i, c in enumerate(cm["data"]["searchComments"]):
        c["_id"] = fake_id("ql", i)
        for k in ("content", "pros", "cons"):
            if c.get(k):
                c[k] = f"假評論內容 {k} {i}。這是測試用的文字。"
    save("qollie_comments.json", cm)


# ---------- 面試趣 ----------
ITW = "https://interview.tw"
XHR = {"Accept": "application/json", "X-Requested-With": "XMLHttpRequest"}
IS = requests.Session()
IS.headers.update({"User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9"})


def record_interview_tw():
    wait()
    ac = IS.get(f"{ITW}/auto-complete/companies", params={"search": "台灣積體電路製造", "limit": 5}, headers=XHR, timeout=20).json()
    save("itw_autocomplete.json", ac)
    sid = next(c["shortId"] for c in ac["source"] if c.get("code") == TAX_ID)
    wait()
    html = IS.get(f"{ITW}/c/{sid}", timeout=20).text
    # 只保留 JSON-LD 的公司資料（移除 Review/ItemList）與統計區塊；不保留任何心得文字
    ld = None
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
        data = json.loads(m.group(1))
        if any(g.get("@type") == "WebPage" for g in data.get("@graph", [])):
            ld = data
    page = next(g for g in ld["@graph"] if g.get("@type") == "WebPage")
    org = page["mainEntity"]
    org = {k: org[k] for k in ("@type", "name", "alternateName", "taxID", "address", "aggregateRating", "url") if k in org}
    ld_min = {"@context": "https://schema.org", "@graph": [{"@type": "WebPage", "mainEntity": org}]}
    start = html.index('class="iw_company-info-list')
    start = html.rfind("<div", 0, start)
    end = html.index('id="interview-container"', start)
    info = html[start:end]
    info = re.sub(r"<svg.*?</svg>", "", info, flags=re.S)
    info = re.sub(r'<div id="interview-container".*', "", info, flags=re.S)
    save("itw_company.html", f'<html><head><script type="application/ld+json">{json.dumps(ld_min, ensure_ascii=False)}</script></head><body>{info}</div></body></html>')
    wait()
    save("itw_salary_average.json", IS.get(f"{ITW}/c/{sid}/salary-average", headers=XHR, timeout=20).json())


# ---------- Tavily ----------
def record_tavily():
    key = os.environ.get("TAVILY_API_KEY")
    if not key:
        print("no TAVILY_API_KEY, skip tavily fixture")
        return
    from tavily import TavilyClient

    wait()
    r = TavilyClient(api_key=key).search("台灣積體電路製造 面試 薪水 評價", search_depth="basic", include_domains=["dcard.tw", "ptt.cc"], max_results=3)
    for i, x in enumerate(r["results"]):
        x["title"] = f"假標題 {i}"
        x["content"] = f"假摘要 {i}。這是測試用的文字。" * 5
        x["url"] = re.sub(r"M\.\d+\.A\.\w+", f"M.0.A.FAKE{i}", x["url"])
    r.pop("answer", None)
    r.pop("images", None)
    r.pop("request_id", None)
    save("tavily_search.json", r)


if __name__ == "__main__":
    only = sys.argv[1:] or ["gcis", "goodjob", "qollie", "itw", "tavily"]
    for name, fn in (("gcis", record_gcis), ("goodjob", record_goodjob), ("qollie", record_qollie), ("itw", record_interview_tw), ("tavily", record_tavily)):
        if name in only:
            fn()
