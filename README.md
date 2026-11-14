# tw-job-hunter

讓 Claude 直接搜尋 104 人力銀行與 Yourator 職缺、讀取完整 JD，並查詢公司的登記資料與社群口碑的本機 MCP server。

> **研究學習用途、非官方專案、僅限個人使用。** 本專案與 104、Yourator、GoodJob、求職天眼通、面試趣等網站沒有任何關係，使用的是這些網站前端自己呼叫、但未公開文件化的端點。請保持低頻、不要大量抓取、不要商業使用，並自行閱讀各站條款、承擔風險。詳見下方〈條款與風險〉。

## 功能

| 工具 / Skill | 說明 |
|---|---|
| `job104_search` (MCP) | 搜尋 104 職缺，回傳精簡清單（每頁約 20 筆）與分頁資訊 |
| `job104_job_detail` (MCP) | 讀取單一 104 職缺的完整內容：JD、薪資、工作條件、應徵條件、福利 |
| `yourator_search` (MCP) | 搜尋 Yourator 職缺，回傳精簡清單（每頁 20 筆）與 `has_more`（無總筆數） |
| `yourator_job_detail` (MCP) | 讀取單一 Yourator 職缺完整內容、遠端工作與面試型態，以及公司法定名稱 |
| `company_research` (MCP) | 公司研調：經濟部登記資料 + GoodJob / 天眼通 / 面試趣口碑，只給事實不給評分 |
| `parse_resume_pdf` (MCP) | 本機 PDF 履歷無損解析：高保真提取文字、分頁與章節結構，支援中文字元修復 |
| `job-fit` (Skill) | 比對履歷與 JD（104／Yourator 網址，或任何平台貼上的 JD 文字），列出硬性條件、契合點、缺口與推測事項；不輸出分數 |
| `job-hunt-flow` (Skill) | 串起搜尋、篩選、選定、適配度、公司研調、履歷調整與自薦信，每步交棒並在需要決定時停下來 |
| `resume-advisor` (Skill) | 履歷調整建議：依台灣人資偏好進行 STAR 量化改寫、關鍵字鏡像，杜絕 AI 腔調與中國用語 |
| `cover-letter` (Skill) | 自薦信擬定：300 字內四段式自然書信，無 `[...]` 標題、直擊職缺痛點且絕不自曝弱點 |

不做：登入、投遞、收藏、應徵者分析。所有請求都不登入、不帶 cookie。

## 安裝

需要 Node.js 20 以上（裝了 Claude Code 就有）。plugin 直接執行打包好的 `dist/server.js`，不用安裝依賴，也不用建置。

**方式一：Claude Code plugin（建議）**

```
claude plugin marketplace add /path/to/tw-job-hunter
claude plugin install tw-job-hunter@tw-job-hunter
```

在 Claude Code 內用 `/plugin` 安裝時，會跳出表單請你填 **Tavily API Key**（選填，見下）。之後要修改：`/plugin configure tw-job-hunter@tw-job-hunter`。在終端機執行 `claude plugin install` 不會跳出表單，需另外執行 `claude plugin configure tw-job-hunter@tw-job-hunter`。

**方式二：直接註冊 MCP server**

```
claude mcp add tw-job-hunter -- node /path/to/tw-job-hunter/dist/server.js
```

這種方式沒有設定表單，要用 Tavily 請自行設定環境變數 `TAVILY_API_KEY`。

安裝後在 Claude 中問「幫我找台北的後端遠端職缺」或「幫我查台灣積體電路製造的口碑」即可。

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

### `yourator_search`

| 參數 | 型別 | 說明 |
|---|---|---|
| `keyword` | str | 關鍵字（必填） |
| `page` | int | 頁碼，預設 1。Yourator 不提供總筆數，僅回傳 `has_more` |
| `areas` | list[str] | 中文地名，可多個，如 `["台北市", "新北市"]`（「台」「臺」通用，取自公開清單） |
| `job_categories` | list[str] | 中文職類子類名稱，可多個，如 `["前端工程"]` |
| `remote` | `full` / `partial` / `any` | 完全遠端 / 部分遠端 / 兩者皆可（聯集）。此為 Yourator 站方分類（由公司自填），單筆細節請讀 `yourator_job_detail` |
| `salary_min` | int | 薪資下限。採用**區間重疊**語意（職缺薪資區間與指定下限以上有重疊即符合，例如下限 60,000 可能含 40,000–70,000），並排除「面議」職缺 |
| `salary_type` | `monthly` / `yearly` | 月薪或年薪，預設月薪（年薪會除以 12 無條件進位換算為月薪） |
| `job_type` | `full_time` / `part_time` / `contract` / `temporary` / `intern` | 正職 / 副業或兼職 / 承攬 / 約聘 / 實習 |
| `order` | `relevance` / `newest` | 相關度（預設）/ 最近更新 |

### `yourator_job_detail`

| 參數 | 型別 | 說明 |
|---|---|---|
| `job` | str | 職缺網址（如 `https://www.yourator.co/companies/{公司}/jobs/{編號}`）或路徑（`/companies/{公司}/jobs/{編號}`） |

- 遠端型態分開回傳 `remote_work`（遠端工作）與 `remote_interview`（遠端面試），各自為 `full` / `partial` / `none` / `unknown` 並附原文。
- 若職缺頁面無 DOM 內容區塊但有結構化資料（JSON-LD），會降級把描述文字放進 `work_content`（可能同時包含條件要求），其餘內容欄位為 `null`。
- Yourator 不提供統一編號，結果僅回傳 `company_legal_name`，可傳給 `company_research` 查詢登記資料與口碑。
- 職缺不存在或已關閉時回傳 `{"status": "not_found"}`。

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

### `parse_resume_pdf`

| 參數 | 型別 | 說明 |
|---|---|---|
| `pdf_path` | str | 本機 PDF 履歷檔案路徑（如 `C:/path/to/resume.pdf`） |

回傳分頁內容、總字元數與啟發式切分之履歷區塊（經歷、技能、專案、學歷等）。

## 獨立 Skills

### `/resume-advisor` (履歷調整建議)
- 遵循台灣求職市場原則：5 年以下經驗嚴格遵守 1 頁 A4 原則；嚴禁進度條與星等評分。
- STAR 量化改寫：`[強動詞] + [對象/規模] + [技術] + [量化成果]`，提供逐條 Before/After 對照。
- 內建在地化繁體與去 AI 虛詞規則，杜絕「賦能、抓手、視頻、在快速發展的數位時代」等表達。

### `/cover-letter` (自薦信擬定)
- 300 繁體字以內，30 秒快速閱畢之四段式結構（破題 $\to$ 成果鉤子 $\to$ 職缺痛點對接 $\to$ 禮貌收尾）。
- **嚴禁中括號標題**：禁止輸出 `[動機]`、`[核心優勢]`、`[...]` 等標籤，段落間僅以空行自然銜接。
- **嚴格禁止自曝弱點**：未掌握或熟練度不高之技能一律不提，嚴禁出現自我削弱的語句。

### `/job-fit` (適配度分析)
- 固定五區塊輸出，順序不可調換：**硬性條件、契合點、缺口、推測事項、待釐清**。
- JD 支援 104 與 Yourator 職缺網址，也能直接貼上任何平台的 JD 文字；履歷可給 PDF 路徑解析，或直接貼上文字。
- **不輸出分數、百分比、星等**：履歷沒寫的一律標「未提及」，不把猜測寫成事實。
- **推測事項獨立一區**：JD 沒寫、但依職務內容可能需要的能力，每項開頭標「推測」，與明文要求分開列。

### `/job-hunt-flow` (求職流程引導)
- 串起完整流程：搜尋 → 篩選 → 選定 → 適配度 → 公司研調 → 履歷調整（可選）→ 自薦信。
- 每一步交棒給對應的工具或 Skill（`job104_search`、`yourator_search`、`company_research`、`job-fit`、`resume-advisor`、`cover-letter`），這個 Skill 只管順序。
- 在**篩選後、適配度完成後、研調後、自薦信前**停下來問使用者，不會自動跑完整條流程。
- 可從任一階段開始：已給職缺網址就跳到選定，已貼上 JD 就跳到適配度。

## 錯誤

所有錯誤都以 `{"error": {"type": ..., "message": ...}}` 回傳，不會讓 server 崩潰：

| type | 意義 |
|---|---|
| `blocked` | 被 104 / Cloudflare 阻擋（403、429 或挑戰頁）。不會自動重試，請稍後再試 |
| `network` | 逾時、連線失敗或 5xx |
| `schema` | 104 回應格式可能已改變，需要更新程式 |
| `invalid_input` | 參數錯誤，訊息會列出允許的值 |
| `not_found` | 找不到檔案：PDF 路徑打錯或檔案已移動（`parse_resume_pdf`） |

## 條款與風險

這個專案使用多個網站未公開的端點，**不代表這些網站允許這樣的使用**：

- **104**：會員條款禁止以程式自動化存取網站資料。
- **Yourator**：`robots.txt` 僅禁止 `/r/*`（本專案不存取該路徑），所有請求皆匿名唯讀且遵守節流。但列表與詳情端點仍屬未公開文件化的前端資料介面，請保持低頻使用。
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

這些端點隨時可能改變。2026-11-13 實測 Node 內建 `fetch` 可以取得 104 搜尋、詳情與代碼表。

Cloudflare 會看 TLS 指紋：舊版用 Python 時，`httpx` 與 `curl_cffi`（模擬 Chrome 指紋）都被擋，只有 `requests` 能過。transport 目前集中在 `src/job104/client.ts`；若日後 `fetch` 也被擋，只需換掉這個檔案（例如用 Playwright 攔截頁面請求），parser 與工具不用動。

## 專案結構

```
src/
  server.ts          # MCP server：註冊 6 個工具，錯誤轉成結構化結果
  job104/            # 104：client（節流、被擋偵測）、codes（地區/職類代碼）、search、detail
  yourator/          # Yourator：codes（地區/職類代碼）、search、detail（共用 company/http.ts 節流）
  company/           # 公司研調：research 是入口，各來源一個模組
    http.ts          #   共用 HTTP 層（逾時、錯誤分類、每來源 2 秒間隔）與 graphql helper
    registry.ts      #   經濟部商工登記
    goodjob.ts  qollie.ts  interview_tw.ts  web.ts   # 各口碑來源
    common.ts  links.ts                              # 共用小工具、各站連結
  resume/            # 履歷解析
    parser.ts        #   unpdf 本機 PDF 解析與中文字元清洗
    locale_rules.ts  #   speak-human-tw 繁體在地化與去 AI 腔調規則庫
skills/              # 獨立 Skills
  job-hunt-flow/     #   求職流程引導 Skill
  job-fit/           #   適配度分析 Skill
  resume-advisor/    #   履歷調整建議 Skill
  cover-letter/      #   自薦信擬定 Skill
tests/               # vitest 測試（fixtures/ 為錄製並去識別化的回應）
scripts/             # 一次性腳本：錄製 fixture
dist/                # 建置產物 server.js，要隨程式碼一起 commit
.claude-plugin/      # plugin 與本機 marketplace 設定
```

各來源互相獨立、同時查詢；同一來源的請求由 `src/company/http.ts` 的每來源 Promise 串列保證間隔。新增來源只需在 `company/` 加一個模組並在 `research.ts` 註冊。

## 開發

```
npm install
npm test                              # vitest，298 個測試
npm run build                         # tsup，打包成單一 dist/server.js
./node_modules/.bin/tsc --noEmit      # 型別檢查（Windows PowerShell 用 .\node_modules\.bin\tsc.cmd --noEmit）
```

plugin 安裝時不會跑建置，實際執行的是 repo 裡的 `dist/server.js`。改完 `src/` 後要跑 `npm run build`，並把產生的 `dist/server.js` 一起 commit。`npm run check:dist` 會重新建置再比對 git 差異，忘了更新 `dist/` 就失敗。

測試全部使用 `tests/fixtures/` 內錄製的回應，不會打網路。若來源改版，重新錄製：

```
npx tsx scripts/record-fixtures.ts                    # 104（4 個請求 + 1 個 404 探測）
npx tsx scripts/record-fixtures.ts --probe            # 另外實測 104 篩選參數語意
npx tsx scripts/record-yourator-fixtures.ts           # Yourator（公開列表、代碼表與詳情，已去識別化）
TAVILY_API_KEY=... npx tsx scripts/record-company-fixtures.ts [gcis|goodjob|qollie|itw|tavily]  # 公司研調各來源
```

公司研調的 fixture 會自動去識別化（評論與搜尋摘要換成假文字、私人姓名換成假名），因為 fixture 會進公開 repo。

## 授權

MIT。
