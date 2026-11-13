"""tw-job-hunter MCP server（stdio）。"""
from typing import Literal

from mcp.server.mcpserver import MCPServer

from .job104 import detail, search
from .job104.client import Job104Error

mcp = MCPServer("tw-job-hunter")


def _safe(fn, **kw) -> dict:
    try:
        return fn(**kw)
    except Job104Error as e:
        return {"error": {"type": e.type, "message": str(e)}}
    except ValueError as e:
        return {"error": {"type": "invalid_input", "message": str(e)}}


@mcp.tool()
def job104_search(
    keyword: str,
    page: int = 1,
    areas: list[str] | None = None,
    remote: Literal["full", "partial", "any"] | None = None,
    salary_min: int | None = None,
    salary_type: Literal["monthly", "yearly"] = "monthly",
    job_categories: list[str] | None = None,
    job_type: Literal["full_time", "part_time"] | None = None,
    order: Literal["relevance", "newest", "salary"] = "relevance",
) -> dict:
    """搜尋 104 人力銀行職缺，回傳精簡清單（每頁約 20 筆）與分頁資訊。完整 JD 請用 job104_job_detail。

    - areas：中文地名，可多個，例如 ["台北市", "新北市板橋區"]。
    - remote：full=完全遠端、partial=部分遠端、any=兩者皆可；不填則不篩選。
    - salary_min + salary_type：薪資下限（月薪或年薪）。注意：設了薪資下限後，104 會排除「待遇面議」的職缺。
    - job_categories：中文職類名稱，可多個，例如 ["軟體工程師"]。
    - job_type：full_time=全職、part_time=兼職。
    - order：relevance=相關度（預設）、newest=最新、salary=薪資高到低。
    """
    return _safe(
        search.search,
        keyword=keyword, page=page, areas=areas, remote=remote, salary_min=salary_min,
        salary_type=salary_type, job_categories=job_categories, job_type=job_type, order=order,
    )


@mcp.tool()
def job104_job_detail(job: str) -> dict:
    """取得單一 104 職缺的完整內容：JD、薪資、工作條件、應徵條件、福利。

    job 可以是職缺網址（如 https://www.104.com.tw/job/8u9za）或職缺代碼（如 8u9za）。
    職缺已下架時回傳 status="not_found"。
    """
    return _safe(detail.detail, job=job)


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
