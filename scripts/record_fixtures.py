"""一次性腳本：錄製 104 真實回應到 tests/fixtures/，並實測有爭議的搜尋參數。

用法：uv run python scripts/record_fixtures.py [--probe]
每次請求間隔至少 3 秒。--probe 會多發幾個請求驗證參數語意。
"""
import json
import sys
import time
from pathlib import Path

import requests  # httpx 與 curl_cffi 實測皆被 Cloudflare 擋下，只有 requests 可用

FIX = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
H = {"User-Agent": UA, "Accept": "application/json, text/plain, */*", "Accept-Language": "zh-TW,zh;q=0.9"}
SEARCH = "https://www.104.com.tw/jobs/search/api/jobs"
_last = 0.0


def get(url, params=None, referer="https://www.104.com.tw/jobs/search/"):
    global _last
    wait = 3 - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    r = requests.get(url, params=params, headers={**H, "Referer": referer}, timeout=20)
    ct = r.headers.get("content-type", "")
    print(f"GET {r.request.url}\n  -> {r.status_code} {ct[:30]}")
    if r.status_code != 200 or "json" not in ct:
        print("  BODY:", r.text[:200].replace("\n", " "))
        return None
    return r.json()


def save(name, obj):
    FIX.mkdir(parents=True, exist_ok=True)
    (FIX / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  saved {name}")


def record():
    s = get(SEARCH, {"keyword": "python", "page": 1, "pagesize": 20, "order": 15})
    if not s:
        sys.exit("search failed")
    save("search.json", s)
    slug = s["data"][0]["link"]["job"].rstrip("/").split("/")[-1].split("?")[0]
    d = get(f"https://www.104.com.tw/job/ajax/content/{slug}", referer=f"https://www.104.com.tw/job/{slug}")
    if d:
        save("detail.json", d)
    area = get("https://static.104.com.tw/category-tool/json/Area.json")
    if area:
        save("Area.json", area)
    cat = get("https://static.104.com.tw/category-tool/json/JobCat.json")
    if cat:
        save("JobCat.json", cat)
    # 已下架職缺：用一個不太可能存在的代碼
    gone = requests.get("https://www.104.com.tw/job/ajax/content/zzzzz", headers={**H, "Referer": "https://www.104.com.tw/job/zzzzz"}, timeout=20)
    print("closed-job probe:", gone.status_code, gone.text[:200].replace("\n", " "))
    save("detail_closed.txt", {"status": gone.status_code, "body": gone.text[:2000]})


def summarize(label, s, key=None):
    if not s:
        print(f"  [{label}] FAILED")
        return
    jobs = s.get("data", [])
    pag = s.get("metadata", {}).get("pagination", {})
    print(f"  [{label}] total={pag.get('total')} page_count={len(jobs)}")
    if key and jobs:
        from collections import Counter
        print("   ", key, Counter(j.get(key) for j in jobs))
    for j in jobs[:3]:
        print("    -", j.get("jobName"), "|", j.get("salaryDesc"), "|", j.get("periodDesc"), "|", j.get("optionEdu"), "|", j.get("jobType"), "| remote", j.get("remoteWorkType"))


def probe():
    base = {"keyword": "python", "page": 1, "pagesize": 20, "order": 15}
    summarize("remoteWork=1", get(SEARCH, {**base, "remoteWork": 1}), "remoteWorkType")
    summarize("remoteWork=2", get(SEARCH, {**base, "remoteWork": 2}), "remoteWorkType")
    summarize("scmin=60000 M strict", get(SEARCH, {**base, "scmin": 60000, "sctp": "M", "scstrict": 1}))
    summarize("scmin=60000 M strict scneg=0", get(SEARCH, {**base, "scmin": 60000, "sctp": "M", "scstrict": 1, "scneg": 0}))
    summarize("jobexp=3 (3-5y?)", get(SEARCH, {**base, "jobexp": 3}), "periodDesc")
    summarize("edu=4 (大學?)", get(SEARCH, {**base, "edu": 4}), "optionEdu")
    summarize("ro=1 (全職?)", get(SEARCH, {**base, "ro": 1}), "jobType")
    summarize("ro=2 (兼職?)", get(SEARCH, {**base, "ro": 2}), "jobType")
    summarize("order=16", get(SEARCH, {**base, "order": 16}))


if __name__ == "__main__":
    record()
    if "--probe" in sys.argv:
        probe()
