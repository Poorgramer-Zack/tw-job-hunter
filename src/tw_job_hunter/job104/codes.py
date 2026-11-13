"""104 地區與職類代碼：中文名稱 -> 代碼。程序內快取，每次啟動重新下載。"""
from tw_job_hunter.job104.client import get_json

AREA_URL = "https://static.104.com.tw/category-tool/json/Area.json"
JOBCAT_URL = "https://static.104.com.tw/category-tool/json/JobCat.json"
REFERER = "https://www.104.com.tw/jobs/search/"

_cache: dict[str, dict[str, str]] = {}


def _norm(name: str) -> str:
    return name.strip().replace("臺", "台")


def _flatten(nodes: list, out: dict[str, str]) -> None:
    for n in nodes:
        out[_norm(n["des"])] = n["no"]
        _flatten(n.get("n", []), out)


def _table(url: str) -> dict[str, str]:
    if url not in _cache:
        out: dict[str, str] = {}
        _flatten(get_json(url, referer=REFERER), out)
        _cache[url] = out
    return _cache[url]


def _lookup(url: str, name: str, kind: str) -> str:
    table = _table(url)
    key = _norm(name)
    if key in table:
        return table[key]
    hits = [k for k in table if key in k]
    if len(hits) == 1:
        return table[hits[0]]
    if not hits:
        raise ValueError(f"無法辨識的{kind}：「{name}」")
    raise ValueError(f"{kind}「{name}」有多個符合：{'、'.join(hits[:10])}，請指定更明確的名稱")


def area_code(name: str) -> str:
    return _lookup(AREA_URL, name, "地區")


def jobcat_code(name: str) -> str:
    return _lookup(JOBCAT_URL, name, "職類")
