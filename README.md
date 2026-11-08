# 文書日課（獨立網站版）

每日計畫行事曆＋文書題庫繳交。選手各自註冊登入，只看得到自己的資料；管理員可以看到所有選手的繳交，並點進去查看、開啟、下載檔案。手機與電腦都能開，手機可以「加到主畫面」當成應用使用。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`app.js` | 網站本體 |
| `config.js` | **你要填的**：Supabase 網址與金鑰 |
| `supabase/schema.sql` | 資料庫、權限規則、檔案儲存桶（整份貼到 Supabase 執行） |
| `manifest.webmanifest`、`icons/` | 手機安裝成應用（PWA）所需 |
| `.nojekyll` | 讓 GitHub Pages 原樣發布 |

## 設定步驟（約 20–30 分鐘，只做一次）

### 步驟 1：建立 Supabase 專案

1. 到 supabase.com 註冊，按 New project，選免費方案。地區選離你近的（例如 Singapore 或 Tokyo）。
2. 專案建好後，左邊選 **SQL Editor** → New query → 把 `supabase/schema.sql` 整份貼上 → **Run**。看到 Success 就完成。這份可以重複執行，不會重複建立。
3. 左邊選 **Project Settings → API**，抄下兩個值：
   - Project URL（長得像 `https://xxxx.supabase.co`）
   - anon public key（很長一串）

   不要用 `service_role` key，也不要把它放進網站。

### 步驟 2：填入 config.js

把剛抄的兩個值填進 `config.js`：

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "你的 anon key"
};
```

anon key 本來就是給瀏覽器用的，公開沒關係。資料安全靠步驟 1 建立的權限規則，不靠把金鑰藏起來。

### 步驟 3：放到網路上（GitHub Pages）

1. 在 GitHub 建一個新的 repository，把這個資料夾裡的所有檔案上傳（`config.js` 已填好的版本）。
2. 進 repository 的 **Settings → Pages**，Source 選 Deploy from a branch，Branch 選 `main`、資料夾選 `/ (root)`，按 Save。
3. 等 1–2 分鐘，頁面上會出現你的網址，格式通常是 `https://你的帳號.github.io/repository名稱/`。

GitHub Pages 只能放靜態網頁，不能跑伺服器程式，所以資料與檔案才放在 Supabase。

### 步驟 4：告訴 Supabase 你的網址

在 Supabase 左邊選 **Authentication → URL Configuration**：

- Site URL：填步驟 3 的網址。
- Redirect URLs：也加上同一個網址。

這是「忘記密碼」信件裡的連結能回到你網站的必要設定。

### 步驟 5：註冊自己，再升為管理員

1. 打開你的網站，按「註冊」，用你的信箱和密碼註冊。
2. 如果有開啟信箱確認，先到信箱點確認連結。
3. 回到 Supabase 的 SQL Editor，執行下面這句（把信箱改成你註冊的那個）：

```sql
update public.profiles set role = 'admin' where email = '你的信箱@example.com';
```

4. 回到網站重新整理，右上角會出現「管理員」標籤，並多一個「管理員」分頁。

管理員只能用這一句 SQL 設定，網站上沒有任何按鈕或網址能把人升成管理員。

## 手機安裝成應用

| 系統 | 做法 |
|---|---|
| iPhone | 用 Safari 開網址 → 分享按鈕 → 加入主畫面 |
| Android | 用 Chrome 開網址 → 右上選單 → 安裝應用程式（或加到主畫面） |

依 [MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_Installable) 的說明，網站要用 HTTPS、並附上含名稱、192 與 512 px 圖示、start_url、display 的 manifest 才能安裝；Service Worker 不是必要條件。本站已符合這些條件。iOS 16.4 以後也可以從其他瀏覽器的分享選單加入主畫面。

這個版本沒有離線功能：沒有網路時打不開資料。

## 選手怎麼加入

把網站網址給選手，請他們自己按「註冊」。選手註冊後預設就是一般選手，只能看到與寫入自己的計畫與繳交。

## 誰看得到什麼

| 資料 | 選手本人 | 其他選手 | 管理員 |
|---|---|---|---|
| 每日計畫 | 讀寫 | 看不到 | 看不到（只看得到自己的） |
| 題庫繳交紀錄與檔案 | 讀寫 | 看不到 | 可讀（開啟、下載） |
| 個人資料（名稱、信箱） | 讀，只能改自己的名稱 | 看不到 | 可讀 |
| 題庫起始年度設定 | 讀 | 讀 | 讀寫 |

- 每日計畫刻意設成連管理員也看不到，因為那是選手自己的私人行程。若你想讓管理員也能看，需要改規則，告訴我即可。
- 管理員目前不能代選手刪除繳交或檔案，只能查看與下載。
- 檔案放在私人儲存桶，沒有公開網址。每次開啟或下載，網站才向 Supabase 要一個 3 分鐘有效的簽名連結。

## 免費方案要注意的事

以下兩點來自 [Supabase 定價整理（JetAdmin，2026）](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/)，不是 Supabase 官方頁面，數字請以你專案的實際頁面為準：

- 免費專案**閒置約一週會被暫停**，需要到後台手動重新啟用。你自己每天會用，通常不會碰到；暑假或長假沒人用時要留意。
- 免費方案每個專案資料庫 500 MB、檔案儲存 1 GB，每月活躍使用者 50,000。

我自己的估算（假設每份作答檔約 0.5 MB）：每位選手 168 題全部繳完約 84 MB，1 GB 大約夠 12 位選手繳滿。實際用量取決於檔案大小，請定期到 Supabase 的 Storage 看用量。選手的檔案若都很大（例如掃描檔），會更快用完。

## 信箱確認與寄信

Supabase 預設要求新註冊者先點信箱裡的確認連結。這會讓註冊多一步，也有寄信頻率的限制（我沒有在這次查證確切數字）。如果選手一次大量註冊遇到問題，可以到 Authentication 的設定調整是否要求信箱確認，或設定自己的寄信服務，細節請看 Supabase 官方文件。

## 疑難排解

| 看到的情況 | 可能原因與做法 |
|---|---|
| 「還差一步設定」 | `config.js` 還沒填，或沒有一起上傳。填好後重新整理 |
| 「無法載入登入程式」 | 網站從 jsDelivr 載入 Supabase 程式庫失敗。檢查網路；若一直如此，把 `index.html` 裡那行 `<script src="https://cdn.jsdelivr.net/...">` 的版本號換成 Supabase 目前的 2.x 版本，或改用 unpkg |
| 登入後說「讀取資料失敗」 | 多半是 `schema.sql` 沒有執行成功。回 SQL Editor 再執行一次 |
| 忘記密碼信連結打不開或回到錯的地方 | 步驟 4 的 Site URL / Redirect URLs 沒填對 |
| 看不到「管理員」分頁 | 步驟 5 的 SQL 沒執行，或信箱與註冊的不同。執行後重新整理 |
| 上傳說沒有權限 | 登入已過期，重新登入。若仍不行，確認 `schema.sql` 完整執行（含儲存桶與檔案規則） |
| 手機上「開啟」PDF 沒反應 | 瀏覽器擋了彈出視窗，改按「下載」 |

## 這個版本的測試狀況

已用自動化測試驗證：

- 前端流程（登入、註冊提示、行事曆新增/勾選/順延/刪除/切月、題庫繳交與重新繳交、假副檔名被擋、管理員列表/搜尋/進入選手頁/開啟與下載、選手無法進入管理員頁、手機寬度無橫向捲動、淺色與深色）。共 66 項，全數通過。這是用模擬的後端測的。
- 資料庫權限規則：在真實的 PostgreSQL 16 上，補上 Supabase 的角色與 auth/storage 結構後執行 `schema.sql` 兩次（可重複執行），並測了 51 項權限情境（選手互看、管理員範圍、不能自升管理員、路徑偽造、未登入等），全數通過。

**尚未驗證，需要你設定完後實際試一次：**

- 連到真正的 Supabase 專案（登入、寄信、檔案上傳下載）。
- 從 jsDelivr 載入 Supabase 程式庫（測試環境連不到外網）。
- GitHub Pages 發布，以及手機上的「加入主畫面」與選檔上傳。
- 我是用 Supabase 的架構做的模擬，Supabase 自己的實際行為（例如儲存桶對 DOCX 的檔案類型檢查）可能有差異。

建議的驗收順序：註冊自己 → 升管理員 → 用另一個信箱註冊一個測試選手 → 測試選手上傳一份 PDF 和一份 DOCX → 用管理員帳號點進去開啟與下載。
