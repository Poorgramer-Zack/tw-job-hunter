"""經濟部商工登記開放資料：統編 -> 登記資料、名稱 -> 統編。API 與欄位見 design.md。"""
import re
from datetime import date

from tw_job_hunter.company.common import COMPANY_SUFFIXES
from tw_job_hunter.company.http import request

SOURCE = "經濟部商工 API"
BASE = "https://data.gcis.nat.gov.tw/od/data/api/"
TAXID_API = "5F64D864-61CB-4D0D-8AD9-492047CC1EA6"  # 公司登記基本資料-應用一
NAME_API = "6BBA2268-1367-4B42-9CCA-BC17499EBE8C"  # 公司名稱查詢（Company_Status 必填，缺漏會得到空 body）
STATUS_APPROVED = "01"  # 核准設立
MAX_CANDIDATES = 10
FULL_NAME_TAILS = (*COMPANY_SUFFIXES, "公司")


def _query(api_id: str, flt: str) -> list[dict]:
    rows = request(SOURCE, "GET", BASE + api_id, params={"$format": "json", "$filter": flt, "$skip": 0, "$top": 50}, allow_empty=True)
    return rows or []  # 空 body = 查無


def roc_to_iso(s: str | None) -> str | None:
    """民國 7 碼日期 "0760221" -> "1987-02-21"；空值或格式不符回 None。"""
    if not s or not re.fullmatch(r"\d{7}", s):
        return None
    return f"{int(s[:3]) + 1911}-{s[3:5]}-{s[5:7]}"


def years_since(iso: str | None, today: date) -> int | None:
    if not iso:
        return None
    d = date.fromisoformat(iso)
    return today.year - d.year - ((today.month, today.day) < (d.month, d.day))


def get_by_tax_id(tax_id: str, today: date | None = None) -> dict:
    if not re.fullmatch(r"\d{8}", tax_id or ""):
        raise ValueError(f"統一編號必須是 8 碼數字，收到「{tax_id}」")
    rows = _query(TAXID_API, f"Business_Accounting_NO eq {tax_id}")
    if not rows:
        return {"status": "not_found"}
    r = rows[0]
    setup = roc_to_iso(r.get("Company_Setup_Date"))
    return {
        "status": "ok",
        "data": {
            "tax_id": r.get("Business_Accounting_NO"),
            "name": r.get("Company_Name"),
            "status": r.get("Company_Status_Desc"),
            "capital": r.get("Capital_Stock_Amount"),
            "paid_in_capital": r.get("Paid_In_Capital_Amount"),
            "responsible": r.get("Responsible_Name") or None,
            "address": r.get("Company_Location"),
            "setup_date": setup,
            "years_since_setup": years_since(setup, today or date.today()),
        },
    }


def _norm(s: str) -> str:
    return s.strip().replace("臺", "台")


def _is_full_name(query: str, company: str) -> bool:
    """公司名稱 = 查詢字串 + 標準公司詞尾，才算「簡稱後接詞尾」；「台積電機有限公司」不算「台積電」的全名。"""
    return company.startswith(query) and company[len(query):] in FULL_NAME_TAILS


def resolve_name(name: str) -> dict:
    name = (name or "").strip()
    if not name:
        raise ValueError("公司名稱不可為空")
    # 官方資料不把「臺」與「台」視為相同，兩種寫法都查再合併
    variants = dict.fromkeys([name, name.replace("臺", "台"), name.replace("台", "臺")])
    q = _norm(name)
    rows: dict[str, dict] = {}
    for v in variants:
        for r in _query(NAME_API, f"Company_Name like {v} and Company_Status eq {STATUS_APPROVED}"):
            rows.setdefault(r["Business_Accounting_NO"], r)
        if any(_norm(r["Company_Name"]) == q for r in rows.values()):
            break  # 已有完全相同的名稱，不必再查另一種寫法
    if not rows:
        return {"status": "not_found", "message": f"查無「{name}」；簡稱請改用公司全名或統編"}
    exact = [r for r in rows.values() if _norm(r["Company_Name"]) == q]
    full = [r for r in rows.values() if _is_full_name(q, _norm(r["Company_Name"]))]
    pick = exact[0] if exact else (full[0] if len(full) == 1 else None)
    if pick:
        return {"status": "ok", "tax_id": pick["Business_Accounting_NO"], "name": pick["Company_Name"]}
    return {
        "status": "needs_selection",
        "candidates": [
            {"tax_id": r["Business_Accounting_NO"], "name": r["Company_Name"], "status": r.get("Company_Status_Desc"), "address": r.get("Company_Location")}
            for r in list(rows.values())[:MAX_CANDIDATES]
        ],
    }
