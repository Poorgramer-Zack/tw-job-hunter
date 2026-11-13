# tw-job-hunter

讓 Claude 直接搜尋 104 人力銀行職缺、讀取完整 JD 的本機 MCP server。

> **研究學習用途、非官方專案。** 本專案與 104 人力銀行無任何關係，使用的是 104 網站前端自己呼叫、但未公開文件化的 JSON 端點。104 的會員條款禁止以程式自動化存取網站資料，使用本專案前請自行閱讀條款並承擔風險。請保持低頻、個人使用；不要拿來大量抓取或商業用途。

## 功能

| 工具 | 說明 |
|---|---|
| `job104_search` | 搜尋職缺，回傳精簡清單（每頁約 20 筆）與分頁資訊 |
| `job104_job_detail` | 讀取單一職缺的完整內容：JD、薪資、工作條件、應徵條件、福利 |

不做：登入、投遞、收藏、應徵者分析。所有請求都不登入、不帶 cookie。

## 安裝

需要 [uv](https://docs.astral.sh/uv/)（會自動準備 Python 3.11+）。

**方式一：Claude Code plugin**

```
claude plugin add /path/to/tw-job-hunter
```

**方式二：直接註冊 MCP server**

```
claude mcp add tw-job-hunter -- uv run --directory /path/to/tw-job-hunter tw-job-hunter
```

安裝後在 Claude 中問「幫我找台北的 Python 遠端職缺」即可。

## 工具參數

### `job104_search`

| 參數 | 型別 | 說明 |
|---|---|---|
| `keyword` | str | 關鍵字（必填） |
| `page` | int | 頁碼，預設 1 |
| `areas` | list[str] | 中文地名，可多個，如 `["台北市", "新北市板橋區"]`。「台」「臺」通用；名稱有多個符合時會回錯誤並列出候選 |
| `remote` | `full` / `partial` / `any` | 完全遠端 / 部分遠端 / 兩者皆可。不填則不篩選 |
| `salary_min` | int | 薪資下限。**設了下限後 104 會排除「待遇面議」的職缺** |
| `salary_type` | `monthly` / `yearly` | 月薪或年薪，預設月薪 |
| `job_categories` | list[str] | 中文職類名稱，可多個，如 `["軟體工程師"]` |
| `job_type` | `full_time` / `part_time` | 全職 / 兼職 |
| `order` | `relevance` / `newest` / `salary` | 相關度（預設）/ 最新 / 薪資高到低 |

每頁 104 會多塞 2 筆廣告職缺（共 22 筆），回應中無法區分，照實回傳。

### `job104_job_detail`

| 參數 | 型別 | 說明 |
|---|---|---|
| `job` | str | 職缺網址（如 `https://www.104.com.tw/job/8u9za`）或職缺代碼（如 `8u9za`） |

職缺已下架時回傳 `{"status": "not_found"}`。

## 錯誤

所有錯誤都以 `{"error": {"type": ..., "message": ...}}` 回傳，不會讓 server 崩潰：

| type | 意義 |
|---|---|
| `blocked` | 被 104 / Cloudflare 阻擋（403、429 或挑戰頁）。不會自動重試，請稍後再試 |
| `network` | 逾時、連線失敗或 5xx |
| `schema` | 104 回應格式可能已改變，需要更新程式 |
| `invalid_input` | 參數錯誤，訊息會列出允許的值 |

## 行為限制

- 同一個 server 程序內，任兩次對 104 的請求至少間隔 1 秒。
- 被擋時不重試。
- 104 的工作經驗、學歷篩選參數在實測中看不出效果，第一版沒有提供。

## 關於端點

這些端點隨時可能改變。目前（2026-11-13）實測：
- 一般 `requests` 可以取得資料。
- `httpx` 與 `curl_cffi`（模擬 Chrome 指紋）都會被 Cloudflare 擋下。

因此 transport 固定用 `requests`，並集中在 `src/tw_job_hunter/job104/client.py`。若日後連 `requests` 也被擋，只需替換這個檔案（例如改用 Playwright 攔截頁面請求），parser 與工具不用動。

## 開發

```
uv sync
uv run pytest
```

測試全部使用 `tests/fixtures/` 內錄製的真實回應，不會打 104。若 104 改版，重新錄製：

```
uv run python scripts/record_fixtures.py          # 只錄製 fixture（4 個請求 + 1 個 404 探測）
uv run python scripts/record_fixtures.py --probe  # 另外實測篩選參數語意
```

## 授權

MIT。
