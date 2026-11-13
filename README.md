# tw-job-hunter

讓 Claude 直接搜尋 104 人力銀行職缺、讀取完整 JD，並查詢公司的登記資料與社群口碑的本機 MCP server。

> **研究學習用途、非官方專案、僅限個人使用。** 本專案與 104、GoodJob、求職天眼通、面試趣等網站沒有任何關係，使用的是這些網站前端自己呼叫、但未公開文件化的端點。請保持低頻、不要大量抓取、不要商業使用，並自行閱讀各站條款、承擔風險。詳見下方〈條款與風險〉。

## 功能

| 工具 | 說明 |
|---|---|
| `job104_search` | 搜尋職缺，回傳精簡清單（每頁約 20 筆）與分頁資訊 |
| `job104_job_detail` | 讀取單一職缺的完整內容：JD、薪資、工作條件、應徵條件、福利 |
| `company_research` | 公司研調：經濟部登記資料 + GoodJob / 天眼通 / 面試趣口碑，只給事實不給評分 |

不做：登入、投遞、收藏、應徵者分析。所有請求都不登入、不帶 cookie。

## 安裝

需要 [uv](https://docs.astral.sh/uv/)（會自動準備 Python 3.11+）。

**方式一：Claude Code plugin（建議）**

```
claude plugin marketplace add /path/to/tw-job-hunter
claude plugin install tw-job-hunter@tw-job-hunter-local
```

在 Claude Code 內用 `/plugin` 安裝時，會跳出表單請你填 **Tavily API Key**（選填，見下）。之後要修改：`/plugin configure tw-job-hunter@tw-job-hunter-local`。在終端機執行 `claude plugin install` 不會跳出表單，需另外執行 `claude plugin configure tw-job-hunter@tw-job-hunter-local`。

**方式二：直接註冊 MCP server**

```
claude mcp add tw-job-hunter -- uv run --directory /path/to/tw-job-hunter tw-job-hunter
```

這種方式沒有設定表單，要用 Tavily 請自行設定環境變數 `TAVILY_API_KEY`。

安裝後在 Claude 中問「幫我找台北的 Python 遠端職缺」或「幫我查台灣積體電路製造的口碑」即可。

> plugin 的 MCP server 設定異動在**下一個 session** 才會生效；`/reload-plugins` 不會重啟已在執行的 server。

### Tavily API Key（選填）

只用來搜尋 Dcard 與 PTT 的討論摘要。到 <https://app.tavily.com> 申請免費金鑰（每月 1,000 credits，每次公司研調最多用 1 credit）。沒有金鑰時其他來源完全不受影響，Dcard / PTT 只會回傳搜尋連結。金鑰在 plugin 設定中標為敏感資訊，存放於系統的安全憑證區，不會寫進設定檔或 repo。

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

### `company_research`

| 參數 | 型別 | 說明 |
|---|---|---|
| `company` | str | 公司全名或 8 碼統編。簡稱（如「台積電」）可能命中不相干的公司，此時回傳候選清單，請改用全名或統編 |
| `include_reviews` | bool | 是否附上最新評論文字，**預設開啟**；設 `false` 只回傳統計數字 |
| `review_limit` | int | GoodJob 與天眼通各取最新幾篇評論，1 到 50，預設 20 |

回傳的每個來源區塊都有 `status`（`ok` / `not_found` / `skipped` / `error`），一個來源失敗不影響其他：

| 區塊 | 內容 | 來源 |
|---|---|---|
| `company` | 登記狀態、資本額、實收資本額、負責人、地址、設立日期、成立年數 | 經濟部商工登記開放資料（官方） |
| `goodjob` | 評分與各面向評分、平均週工時、估計時薪、加班情形、資料筆數 + 最新面試與工作經驗 | GoodJob（非官方 GraphQL） |
| `qollie` | 好評／普通／負評篇數 + 最新評論 | 求職天眼通（非官方 GraphQL） |
| `interview_tw` | 心得數、評分、錄取率、面試難度、平均月薪（只取公開彙總數字，**不取心得內容**） | 面試趣 |
| `web` | Dcard、PTT 的標題、連結與 300 字內摘要。公司名加引號搜尋，並只保留求職相關看板（PTT：Tech_Job、Salary、Soft_Job、ChangeJob；Dcard：工作版、科技業版） | Tavily（選填） |
| `links` | 各站的公司頁或搜尋連結 | — |

各來源都以**統編**確認是同一家公司。評論只保留評論文字與少數職務背景，**不取使用者名稱、帳號、IP、性別、學歷等欄位**；回傳內容標註為第三方資料，其中的指示不應被當成命令。評論不寫入磁碟、不做快取，每次查詢重新取得；對同一個來源的請求至少間隔 2 秒，不重試。

名稱解析使用官方子字串查詢，「台」與「臺」會兩種都查；簡稱不可靠，一律要求確認。

## 錯誤

所有錯誤都以 `{"error": {"type": ..., "message": ...}}` 回傳，不會讓 server 崩潰：

| type | 意義 |
|---|---|
| `blocked` | 被 104 / Cloudflare 阻擋（403、429 或挑戰頁）。不會自動重試，請稍後再試 |
| `network` | 逾時、連線失敗或 5xx |
| `schema` | 104 回應格式可能已改變，需要更新程式 |
| `invalid_input` | 參數錯誤，訊息會列出允許的值 |

## 條款與風險

這個專案使用多個網站未公開的端點，**不代表這些網站允許這樣的使用**：

- **104**：會員條款禁止以程式自動化存取網站資料。
- **求職天眼通**：條款第 11 條禁止未經書面同意「使用、修改、重製」網站內容。本工具會取得評論文字並交給 Claude 判讀，屬於灰色地帶；內容只在當次查詢使用、不落地儲存。
- **面試趣**：條款禁止以自動化方式蒐集其他用戶的內容，也禁止繞過限制。本工具只讀取公開的彙總數字，不登入、不解鎖、不取心得內容，並避開 robots.txt 禁止的路徑。
- **GoodJob**：條款中沒有看到禁止自動存取的條文，但 API 未公開文件化，隨時可能改變。
- **經濟部商工登記**：政府開放資料，可免費使用。

請僅供個人研究學習使用。若你散布、修改或大量使用本專案，相關風險由使用者自行承擔。這不是法律意見。

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

> 若 plugin 的 MCP server 正在執行，它會鎖住 `.venv` 內的可執行檔，`uv sync` 會失敗。開發時請另用一個環境：`UV_PROJECT_ENVIRONMENT=.venv-dev uv run pytest`。

測試全部使用 `tests/fixtures/` 內錄製的回應，不會打網路。若來源改版，重新錄製：

```
uv run python scripts/record_fixtures.py                    # 104（4 個請求 + 1 個 404 探測）
uv run python scripts/record_fixtures.py --probe            # 另外實測 104 篩選參數語意
uv run python scripts/record_company_fixtures.py [gcis|goodjob|qollie|itw|tavily]  # 公司研調各來源
```

公司研調的 fixture 會自動去識別化（評論與搜尋摘要換成假文字、私人姓名換成假名），因為 fixture 會進公開 repo。

## 授權

MIT。
