# cdd-kit 全面審查與優化提案（Total Review & Optimization Proposal）

- 日期：2026-06-10
- 審查版本：`contract-driven-delivery@2.2.1`（branch `master` @ `95772f6`）
- 狀態：Proposed
- 審查方式：四條並行深度審查（非工程師體驗與自動化、token 效率機制、CLI 品質與測試、文件與資產一致性），加上實際 build + 完整測試執行驗證。

---

## 1. 執行摘要（Executive Summary）

cdd-kit 的核心工程品質**良好**：gate 的路徑安全防護、YAML 安全解析、schema 嚴格性（`additionalProperties: false`、no-waiver 政策）、57 個測試檔對 68 個源碼檔的覆蓋，都屬於成熟水準。code-map / code-graph / MCP 的 token 節約機制方向正確且大致有效。

但對照 kit 的兩個核心定位 —— **「服務非工程師、極致自動化」** 與 **「最少 token 找到要修的東西」** —— 本次審查找到三類系統性落差：

1. **自動化斷點**：onboarding 與升級流程需要使用者手動執行 7~10 條 shell 指令並做出多個技術決策；MCP 未註冊時 agent 默默退化為慢速模式而無人知曉；多個強制機制（conformance、test-runner hook、strict mode）預設休眠（dormant），呈現「看起來有護欄、實際沒擋」的安全假象。這直接違反「除關鍵決策外全自動」的設計目標。
2. **Token 效率的隱性損耗**：18 個 agent 中只有 4 個有 graph-first 指示；查詢結果被截斷但 agent 不知道；freshness 檢查在大 repo 上每次查詢都重算 digest；Go/Rust 有 stack 偵測但沒有 scanner；agent 提示檔內含 150+ 處 UTF-8 亂碼（`??`）**直接進入 LLM context**。
3. **可靠性債務**：`gate.ts` 單檔 1,455 行、32 個函式；tier 偵測依賴脆弱 regex；`npm test` 在乾淨環境直接失敗 480 個測試（缺 pretest build）；測試未隔離環境 git 設定；kit 自身沒有 CI workflow。

本提案將全部發現整併為 **P0（立即）/ P1（下一個 minor 版）/ P2（路線圖）** 三級，P0 共 6 項、合計約 3~4 人日，即可消除最痛的斷點。

### 本次實測健康快照

| 檢查 | 結果 |
|---|---|
| `node build.js` | ✅ 成功 |
| `npm test`（乾淨 clone 直接跑） | ❌ 480/815 失敗 —— `dist/cli/index.js` 不存在（缺 pretest build，見 P0-2） |
| `npm test`（build 後） | ⚠️ 803/815 通過；10 個失敗為環境 git commit-signing 干擾（測試未隔離 git config，見 P0-3）；2 個 `git-paths` rename 偵測失敗需調查（見 P1-13） |
| kit 自身 CI | ❌ 無 `.github/workflows/`（`github-workflows/` 只是給使用者的模板，見 P0-4） |
| UTF-8 亂碼 | ❌ README 43 處、17 個 agent 提示檔共 150+ 處（見 P0-1） |

---

## 2. P0：立即修復（高影響、低成本，建議本週完成）

### P0-1. 修復全面性 UTF-8 亂碼（agent 提示檔是重災區）

- **現況**：箭頭（→）等字元在 18 個檔案中變成 `??`：`README.md`（43 處）與 `.claude/agents/*.md` 全部 17 個 agent（6~16 處不等），如 `context-manifest.md ??Allowed Paths`。
- **為何重要**：agent 提示檔會被原封不動載入 LLM context。`??` 不只難看 —— 它破壞語意（「A → B」變成「A ?? B」），降低 agent 對工作流程指示的理解品質，等於每次呼叫 agent 都在燒 token 換取更差的指令遵循。對非工程師，README 的目錄樹（lines 1244-1279）已不可讀。
- **做法**：機械式全域替換 `??` → `→`（逐檔人工確認語意），並在 CI 加一條 guard（grep 檢查 shipped markdown 不得含 mojibake pattern）防止回歸。`.gitattributes` 已存在，確認編輯器/工具鏈以 UTF-8 寫入。
- **工作量**：0.5 天。

### P0-2. `npm test` 必須在乾淨環境可直接執行

- **現況**：`package.json` 的 `test` 是 `vitest run`，但 CLI 測試依賴 `dist/cli/index.js`。乾淨 clone 後 `npm test` 直接失敗 480 個測試，錯誤訊息是 `Cannot find module .../dist/cli/index.js`。
- **為何重要**：這是任何貢獻者（包含 AI agent 自己）對 kit 做修改時的第一道體驗；對「極致自動化」的 kit 而言，自家測試需要隱性前置步驟是直接矛盾。
- **做法**：加 `"pretest": "node build.js"`（或在 vitest globalSetup 偵測 dist 缺失時自動 build）。
- **工作量**：0.25 天。

### P0-3. 測試需隔離環境 git 設定

- **現況**：`test/helpers.ts` 建測試 repo 時未停用 commit signing/hooks，在強制簽章的環境（如本次的沙箱、部分企業環境）`validate-versions.test.ts` 全部 10 個測試因 `git commit` 簽章失敗而炸掉。
- **做法**：測試中所有 git 呼叫統一加 `-c commit.gpgsign=false -c tag.gpgsign=false -c core.hooksPath=/dev/null`（或設 `GIT_CONFIG_GLOBAL=/dev/null` + 顯式 user.name/email）。
- **工作量**：0.25 天。

### P0-4. 為 kit 自身加上 CI workflow

- **現況**：repo 沒有 `.github/workflows/`；`github-workflows/contract-driven-gates.yml` 是發給使用者 repo 的模板，不會跑 kit 自己的測試。一個以「CI/CD gate 是必要交付物」為教義的 kit，自己沒有 CI。
- **做法**：新增 `.github/workflows/test.yml`：`npm ci → node build.js → tsc --noEmit → vitest run`，matrix 跑 Node 18/20/22；附帶 P0-1 的 mojibake guard 與 `cdd-kit code-map --check` 自我驗證。
- **工作量**：0.5 天。

### P0-5. 新增一鍵 `cdd-kit setup`（消除 onboarding 斷點）

- **現況**：非工程師完成完整安裝需要跨多個 session 執行 7~10 條指令並理解其差異：`init` → `claude mcp add ...` → `install-hooks` → `install-agent-hooks --graph-first` → `install-agent-hooks --test-runner` → `context-scan` →（升級時再加 `refresh --yes` → `migrate --all` → `doctor --strict`）。README 中 update/upgrade/refresh/migrate 四個指令的語意差異連工程師都需要查表（README lines 503-510 自己就附了一張對照表）。
- **為何重要**：這是「極致自動化」最大的單點違反。目標使用者不具備判斷「我需要 refresh 還是 upgrade 還是 migrate」的背景。
- **做法**：新增冪等的 `cdd-kit setup`（fresh 與 upgrade 通用）：自動偵測現狀後依序執行 init/refresh、detect-stack、install-hooks、install-agent-hooks（graph-first advisory + test-runner advisory）、best-effort MCP 註冊（直接執行 `claude mcp add`，失敗只警告不阻斷）、context-scan、code-map，最後印出逐步成功/失敗摘要與「下一步：`/cdd-new <描述你的需求>`」。現有細粒度指令保留為進階介面。
- **工作量**：2~3 天。

### P0-6. Gate 失敗訊息的非工程師模式（`--explain`）

- **現況**：gate 錯誤假設工程背景，如 `mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped`、`tier floor violation: ... record tier-floor-override: "<reason>" in tasks.yml frontmatter`。非工程師不知道什麼是 frontmatter、為什麼 "auth" 字樣會觸發 tier 0、也不知道下一步該叫 Claude 做什麼。
- **做法**：
  1. `cdd-kit gate <id> --explain`：每個失敗附「白話原因 + 建議對 Claude 說的一句話」（例：「這個變更涉及登入驗證，屬於高風險，系統要求更嚴格的測試等級。請對 Claude 說：『請把這個 change 重新分類為 tier 0』」）。
  2. 既有錯誤輸出末尾固定加一行：`Need help? Run: cdd-kit gate <id> --explain`。
  3. 同步修掉 gate 輸出中 warning 重複列印兩次的問題（`gate.ts:1430-1452`）。
- **工作量**：2 天。

---

## 3. P1：下一個 minor 版（v2.3）

### 主題 A：把「休眠的自動化」變成「活的自動化」

| # | 提案 | 現況與根據 | 工作量 |
|---|---|---|---|
| P1-1 | **MCP 未註冊不得無聲降級**：`init`/`setup` 直接嘗試 `claude mcp add`（互動詢問一次）；`doctor` 將 MCP 未註冊從 informational 提升為 warning，並說明後果（「agent 將以較慢的 CLI fallback 模式運作」） | `src/utils/mcp-hint.ts`；README line 568-569 明言該檢查 never fails strict —— agent 默默用慢速模式，使用者只覺得「kit 很慢」 | 1 天 |
| P1-2 | **`cdd-kit doctor --simple`**：以 ✅/⚠️ 加白話文總結健康狀態（必要檔案、chokepoint live/dormant、MCP、contracts），結尾給「下一步」 | doctor 現有輸出 15+ 行技術細節，非工程師無法判斷「現在是好是壞」 | 1 天 |
| P1-3 | **Context Expansion Request 去阻塞**：(a) 實作 `.cdd/context-policy.json` 中已存在但從未被使用的 `autoApprovePatterns` 自動核准；(b) 新增 `cdd-kit context approve-interactive` 逐筆白話說明＋Y/N | CER `status: pending` 會讓 `/cdd-resume` 停住，非工程師面對一串技術路徑不知如何裁決，session 無聲卡死 | 1~2 天 |
| P1-4 | **預設武裝 test-runner hook（advisory）**：init 時與 graph-first 一起裝，`--no-test-runner` 可關 | ADR 0005 §10 自己說「ship advisory first」，但現在連 advisory 都是 opt-in；非工程師永遠不會主動執行 `install-agent-hooks --test-runner` | 0.5 天 |
| P1-5 | **conformance 檢查引導啟用**：當偵測到 API contract 與前後端碼存在時，`setup`/`doctor --fix` 主動詢問是否啟用 `.cdd/conformance.json`，而非永久 `"enabled": false` | README 自述這是「無人工審查時的機械防漂移網」，但預設關閉 —— 最需要它的人（非工程師）最不可能去開 | 0.5 天 |

### 主題 B：Token 效率補洞

| # | 提案 | 現況與根據 | 工作量 |
|---|---|---|---|
| P1-6 | **graph-first 指示統一化**：為 `implementation-planner`、`test-strategist`、`spec-architect`、`spec-drift-auditor` 等補上 index/graph 優先指示（18 個 agent 目前只有 4 個有） | 缺指示的 agent 直接整檔 Read，graph-first 的省 token 效果只覆蓋少數角色 | 0.5 天 |
| P1-7 | **查詢截斷可見化**：`index query`/`graph query`/MCP 回傳加 `total_matches` 與 `truncated: true` 欄位 | `index-query.ts:169` 內部 `.slice(0, 8)`，agent 無從得知結果被截斷，導致漏讀（以為只有 8 個）或多讀（不會改用更精確的查詢詞） | 1 天 |
| P1-8 | **freshness digest 快取 / `--no-refresh`**：session 內快取 `sourcesDigest`，或讓 MCP/CLI 查詢支援跳過驗證 | `freshness.ts:62-99` 每次查詢都可能走 stat 全樹 + SHA1 全量重算；大 repo 一個 session 5 次查詢就重算 5 次 | 1 天 |
| P1-9 | **graph-first hook 先檢查 map 新鮮度**：map 不存在或已過期時不輸出 advisory（避免 nag 噪音讓 agent 學會忽略它），並提示 `cdd-kit code-map` | `hooks/pre-tool-use-graph-first.sh:54-66` 目前無條件輸出 | 0.5 天 |
| P1-10 | **`AGENTS.template.md` 擴充每個 agent 1~2 行職責摘要**（維持 <500 tokens） | 現在只有名字清單（22 行），主 agent 選錯 sub-agent 的成本遠高於這幾百 token | 0.25 天 |

### 主題 C：可靠性與一致性

| # | 提案 | 現況與根據 | 工作量 |
|---|---|---|---|
| P1-11 | **拆分 `gate.ts`** 為 orchestrator + `gate-tier` / `gate-artifacts` / `gate-evidence` / `gate-dependencies` / `gate-contracts` 五模組（行為不變） | 1,455 行、32 函式單檔，是第二大檔（765 行）的兩倍；難以單測與安全擴充 | 3 天 |
| P1-12 | **tier 偵測 regex 強化**：錨定行首、範圍驗證 0–5、明確優先序（tasks.yml > structured > bold）、structured 與 bold 並存時報錯 | `gate.ts:287-357`；loose pattern `/\b(tier\s*[0-5]|low|...)\b/i` 可被「tier-based」「critical systems」等措辭誤觸 | 1 天 |
| P1-13 | **調查 `git-paths` rename 偵測失敗**：本次實測 2 個測試失敗（rename 出敏感目錄時只回傳新路徑，遺漏 `src/auth/middleware.ts` 舊路徑）——若為 git 版本相依的 `--name-status` 解析差異，會讓 tier-floor 的 rename-aware 防護在某些環境失效（安全網漏洞） | `test/cli/git-paths.test.ts:70,100` 於 git 2.x 新版環境失敗 | 1 天 |
| P1-14 | **`--json` 一致性**：補 `list`、`context list`、`abandon`、`archive`；文件化各指令 JSON schema 與 exit code 語意（0/1/2） | 17 個指令有 `--json`，其餘混雜純文字，自動化 wrapper 難以解析 | 0.5 天 |
| P1-15 | **CER 區段解析改用共用 markdown-section 工具 + `yaml.load`**，取代手刻 regex | `gate.ts:191-207` 對縮排/空行敏感，格式稍異即無聲漏算 pending | 1 天 |
| P1-16 | **`tier-policy.json` 解析失敗要警告**（現為無聲 fallback 到預設值）並加 schema 驗證 | `src/utils/tier-floor.ts:91-120`；使用者改壞 JSON 後以為自訂規則生效，實際全被忽略 | 0.25 天 |
| P1-17 | **doctor 與 context-scan 的 digest 邏輯抽共用模組**（註解自承「the two MUST stay in lockstep」） | `doctor.ts:49-61` vs `context-scan.ts` 重複實作，漂移即「永遠顯示 stale」 | 0.5 天 |

---

## 4. P2：路線圖（v2.4+）

| # | 提案 | 說明 | 工作量 |
|---|---|---|---|
| P2-1 | **實作 `change.yml`/`trace.yml`（`cdd-kit metadata`）** | `docs/machine-readable-change-design.md` 已完成設計但零實作；這是消除「markdown 當資料庫」脆弱性（P1-12、P1-15 的根因）的治本方案：gate 改讀生成的 YAML，markdown 退為人類介面。**短期行動**：先在該文件頂部標註 `Status: Proposed — not yet implemented`，避免使用者誤以為 `cdd-kit metadata` 已存在 | 4 天（標註 0.1 天） |
| P2-2 | **Go / Rust scanner** | `stack-detect.ts:82-120` 偵測 Go/Rust，但 `code-map/config.ts:8-17` 只掃 py/js/ts/vue —— Go/Rust 專案的 graph-first 指示完全空轉，agent 退回全檔 Read | 每語言 2~3 天 |
| P2-3 | **新 MCP 工具：`cdd_contract_locate`、`cdd_test_impact`** | 前者以 code symbol 反查相關 contract 切片（省 2~3 輪工具呼叫）；後者回答「改了這個檔，哪些測試受影響」——目前 agent 只能手動 grep | 各 2~3 天 |
| P2-4 | **暴露 unresolved references** | graph builder 已記錄 unresolved（`builder.ts:283-313`）但 MCP/CLI 都看不到；agent 做 impact 分析時漏掉 DI 容器/外部服務呼叫 | 1~2 天 |
| P2-5 | **i18n 訊息目錄（繁中優先）** | 全部訊息 English-only 且散落各檔；先集中到 `src/messages.ts` 建翻譯掛點，繁中為第一個目標語系 —— 目標使用者明確包含中文非工程師 | 3~5 天 + 翻譯 |
| P2-6 | **Tier 4（低風險）變更的 manifest 自動生成** | 對 micro-change 自動產出最小 `context-manifest.md`（allowed = change dir + 變更檔），降低小變更的 ceremony 與 token 開銷 | 1~2 天 |
| P2-7 | **`tier-floor-override` 審計強化** | 現況：任意 free-text（可以是 "fix"）即可降級通過且無持久審計。要求 reason ≥ 20 字、記入 `agent-log/audit.yml`（含時間戳） | 1 天 |
| P2-8 | **`visual-reviewer` 模型升級 haiku → sonnet** | 視覺/可及性審查需要比較性判斷，haiku 容易漏細節；其餘 model 配置（5 opus / 11 sonnet / 2 haiku）合理 | 0.1 天 |
| P2-9 | **Dogfooding 範例**：在 `specs/archive/2026/` 收錄一個完整走完流程的真實 change（含 agent-log、test-evidence） | kit 自身 `specs/changes/` 只有一個 plan.md；使用者與 agent 都缺「成功長什麼樣」的範本 | 1 天 |
| P2-10 | **補測試缺口**：`abandon`、`archive`、`graph` engine fallback 鏈、`install-agent-hooks` 目前零直接測試 | 由測試檔對映分析確認 | 2 天 |
| P2-11 | **README CLI Reference 重組**：以 `cdd-kit <group> <sub>` 巢狀格式整併 graph/test/contract/index 散落段落；補 `lint-agents` 文件；README 與 install.md 去重 | 文件審查確認多處散落與重複 | 1 天 |

---

## 5. 建議的執行順序

```
Week 1  (P0)      : P0-1 亂碼修復 → P0-2/P0-3 測試可跑性 → P0-4 自身 CI
                    （先讓「改 kit 本身」這件事安全，後續所有改動都有網）
Week 2  (P0)      : P0-5 cdd-kit setup → P0-6 gate --explain
Week 3-4 (P1 A+B) : P1-1~P1-5 自動化活化 → P1-6~P1-10 token 補洞
Week 5-6 (P1 C)   : P1-11 gate 拆分 → P1-12/13/15 解析強化 → 其餘一致性項
v2.4+   (P2)      : P2-1 machine-readable metadata 為核心，其餘按使用回饋排序
```

原則：**先修自我可驗證性（P0-1~4），再動行為**。P1-11（gate 拆分）刻意排在解析強化之前完成，讓後續 regex 修正落在小模組裡可獨立測試。

## 6. 不建議做的事

- **不要**把 graph-first / contract-write / test-runner hook 直接預設 strict——advisory 先行（ADR 0005 §10 的判斷正確），strict 等 P1-9 消除誤報後再考慮。
- **不要**為了非工程師而新增更多 markdown 表單／儀式——本提案所有 UX 改善都是「指令合併、訊息翻譯、預設值修正」，不新增任何使用者必填工件（與 Artifact Minimization 原則一致）。
- **不要**在 P2-1 之前繼續往 gate.ts 疊加新的 markdown regex 解析——新需求若涉及結構化資料，優先走 schema/YAML。

## 7. 附錄：發現與證據對照

| 發現 | 證據位置 |
|---|---|
| 乾淨環境 `npm test` 失敗 480 測試 | 本次實測；`package.json:42` 無 pretest |
| build 後 12 失敗（10 簽章環境 + 2 rename） | 本次實測；`test/cli/validate-versions.test.ts`、`test/cli/git-paths.test.ts:70,100` |
| kit 自身無 CI | repo 無 `.github/workflows/`；`github-workflows/` 為使用者模板 |
| 亂碼 | `grep -c '??'`：README 43、17 個 agent 檔 6~16 處 |
| 18 agent 僅 4 個 graph-first | `.claude/agents/*.md` 全量比對 |
| 查詢截斷不可見 | `src/commands/index-query.ts:166-169` |
| freshness 重複重算 | `src/code-map/freshness.ts:62-99` |
| gate.ts 規模 | 1,455 行（次大檔 `cli/index.ts` 765 行） |
| tier regex 脆弱 | `src/commands/gate.ts:41,287-357` |
| CER 解析脆弱 | `src/commands/gate.ts:191-207` |
| autoApprovePatterns 未被使用 | `.cdd/context-policy.json` vs `src/commands/context.ts` |
| MCP 檢查 never-fails | `README.md:568-569`、`src/commands/doctor.ts` |
| conformance 預設關閉 | `.cdd/conformance.json` `"enabled": false` |
| machine-readable 設計未實作 | `docs/machine-readable-change-design.md`；CLI 無 `metadata` 指令 |
| Go/Rust scanner 缺 | `src/utils/stack-detect.ts:82-120` vs `src/code-map/config.ts:8-17` |
| tier-policy 無聲 fallback | `src/utils/tier-floor.ts:91-120` |
| digest 邏輯重複 | `src/commands/doctor.ts:49-61` |
| model 配置 | `.claude/agents/*.md` frontmatter（5 opus / 11 sonnet / 2 haiku） |
