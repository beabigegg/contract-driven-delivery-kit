# cdd-kit 全面審查與優化提案（Total Review & Optimization Proposal）

- 日期：2026-06-10
- 審查版本：`contract-driven-delivery@2.2.1`（branch `master` @ `95772f6`）
- 狀態：Proposed —— **P0-1 ～ P0-6 已實作**（P0-1～P0-4 於 PR #36 合併；P0-5 一鍵 `cdd-kit setup` 於 PR #37 合併；P0-6 `gate --explain` 於 PR #38 合併）；**P1 主題 A 首批（P1-1、P1-2、P1-4、P1-5）於 PR #39 合併**；**P1 主題 B 首批（P1-6、P1-7、P1-9、P1-10）於 PR #40 合併**；**P1-3（CER 去阻塞）+ P1-8（freshness mtime 修復）於 PR #41 合併**；**P1-11（gate.ts 拆分）於 PR #42 合併**；**P1-12 + P1-15 + P1-16（解析強化三項）於 PR #43 合併**；**P1-17（digest 共用模組）於 PR #44 合併**；**P1-14（`--json` 一致性）於 PR #45 合併**；**P1-13（rename 失敗調查 + helper 硬化）已完成**（本次 PR）——**至此 P0 與 P1 全數完成**；P2 待續
- 審查方式：四條並行深度審查（非工程師體驗與自動化、token 效率機制、CLI 品質與測試、文件與資產一致性），加上實際 build + 完整測試執行驗證。

---

## 0. 實作進度（Implementation Status）

| 項目 | 狀態 | 出處 |
|---|---|---|
| P0-1 修復 shipped prompt/doc UTF-8 亂碼 + CI guard | ✅ 已完成 | PR #36 |
| P0-2 `npm test` 乾淨環境可直接跑（pretest build） | ✅ 已完成 | PR #36 |
| P0-3 測試隔離環境 git 設定 | ✅ 已完成 | PR #36 |
| P0-4 kit 自身 CI workflow（Node 18/20/22 + mojibake guard） | ✅ 已完成 | PR #36 |
| P0-5 一鍵 `cdd-kit setup` | ✅ 已完成 | PR #37 |
| P0-6 `gate --explain` 非工程師模式 | ✅ 已完成 | PR #38 |
| P1-1 MCP 未註冊不得無聲降級 | ✅ 已完成 | 本次 PR |
| P1-2 `cdd-kit doctor --simple` | ✅ 已完成 | 本次 PR |
| P1-4 預設武裝 test-runner hook（advisory） | ✅ 已完成 | 本次 PR |
| P1-5 conformance 檢查引導啟用 | ✅ 已完成 | PR #39 |
| P1-6 graph-first 指示統一化（4 個高價值 agent） | ✅ 已完成 | 本次 PR |
| P1-7 查詢截斷可見化（index/graph/MCP） | ✅ 已完成 | 本次 PR |
| P1-9 graph-first hook 過時 map 不再導向 | ✅ 已完成 | PR #40 |
| P1-10 `AGENTS.template.md` 路由摘要擴充 | ✅ 已完成 | PR #40 |
| P1-3 CER 去阻塞（auto-safe 自動核准 + approve-interactive） | ✅ 已完成 | 本次 PR |
| P1-8 freshness digest 重算消除（mtime 修復） | ✅ 已完成 | PR #41 |
| P1-11 拆分 `gate.ts` 為 orchestrator + 6 模組（行為不變） | ✅ 已完成 | PR #42 |
| P1-12 tier 偵測 regex 強化（行首錨定 / 0–5 驗證 / structured+bold 衝突報錯） | ✅ 已完成 | 本次 PR |
| P1-15 CER 區段解析改用共用 markdown-section + `yaml.load` | ✅ 已完成 | 本次 PR |
| P1-16 `tier-policy.json` 解析/結構失敗要警告（不再無聲 fallback） | ✅ 已完成 | PR #43 |
| P1-17 doctor / context-scan 的 digest 邏輯抽共用模組 | ✅ 已完成 | PR #44 |
| P1-14 `--json` 一致性（list / abandon / archive + 文件化 exit code 語意） | ✅ 已完成 | PR #45 |
| P1-13 git-paths rename 失敗調查（根因：簽章環境，安全網無恙；helper 硬化） | ✅ 已完成 | 本次 PR |
| **P1 全部完成**；P2 | ⬜ 待續 | — |

> PR #36 額外收穫：P0-1 的 mojibake guard（`tools/check-mojibake.mjs`）在三輪高階 AI review 來回中，從「只擋 `??`」強化為涵蓋六類損壞（`??`、私有/控制/代理位元組、`` `n `` 字面跳脫、U+FFFD、孤立 CJK、Windows-1252 序列），掃描範圍鎖定對外英文 prompt 面（含 `specs/templates`、`tests/templates`、`contracts`），並排除可為非英文的 `specs/changes/` 工作文件。P0-3 的 git 隔離同步補上 `GIT_CONFIG_COUNT/KEY_*/VALUE_*`、`GIT_CONFIG`、`GIT_CONFIG_PARAMETERS` 覆寫清除。

---

## 1. 執行摘要（Executive Summary）

cdd-kit 的核心工程品質**良好**：gate 的路徑安全防護、YAML 安全解析、schema 嚴格性（`additionalProperties: false`、no-waiver 政策）、57 個測試檔對 68 個源碼檔的覆蓋，都屬於成熟水準。code-map / code-graph / MCP 的 token 節約機制方向正確且大致有效。

但對照 kit 的兩個核心定位 —— **「服務非工程師、極致自動化」** 與 **「最少 token 找到要修的東西」** —— 本次審查找到三類系統性落差：

1. **自動化斷點**：onboarding 與升級流程需要使用者手動執行 7~10 條 shell 指令並做出多個技術決策；MCP 未註冊時 agent 默默退化為慢速模式而無人知曉；多個強制機制（conformance、test-runner hook、strict mode）預設休眠（dormant），呈現「看起來有護欄、實際沒擋」的安全假象。這直接違反「除關鍵決策外全自動」的設計目標。
2. **Token 效率的隱性損耗**：18 個 agent 中只有 4 個有 graph-first 指示；查詢結果被截斷但 agent 不知道；freshness 檢查在大 repo 上每次查詢都重算 digest；~~Go/Rust 有 stack 偵測但沒有 scanner~~（已撤銷：改為移除 Go/Rust 偵測，見 P2-2）；agent 提示檔內含 150+ 處 UTF-8 亂碼（`??`）**直接進入 LLM context**。
3. **可靠性債務**：`gate.ts` 單檔 1,455 行、32 個函式；tier 偵測依賴脆弱 regex；`npm test` 在乾淨環境直接失敗 480 個測試（缺 pretest build）；測試未隔離環境 git 設定；kit 自身沒有 CI workflow。

本提案將全部發現整併為 **P0（立即）/ P1（下一個 minor 版）/ P2（路線圖）** 三級，P0 共 6 項、合計約 3~4 人日，即可消除最痛的斷點。

### 本次實測健康快照

| 檢查 | 結果 |
|---|---|
| `node build.js` | ✅ 成功 |
| `npm test`（乾淨 clone 直接跑） | ~~❌ 480/815 失敗 —— `dist/cli/index.js` 不存在（缺 pretest build）~~ → ✅ **已修（P0-2）**：`pretest` 自動 build，乾淨環境 815/815 通過 |
| `npm test`（build 後） | ~~⚠️ 803/815；10 個 git 簽章干擾~~ → ✅ **已修（P0-3）**：git 設定隔離後 815/815 通過（含本機 `commit.gpgsign=true`）。`git-paths` rename 在當前 git 版本通過；P1-13 仍保留追蹤 |
| kit 自身 CI | ~~❌ 無 `.github/workflows/`~~ → ✅ **已修（P0-4）**：`.github/workflows/test.yml`（Node 18/20/22 + mojibake guard），已綠 |
| UTF-8 亂碼 | ~~❌ README 43 處、agent 提示檔 150+ 處~~ → ✅ **已修（P0-1）**：README + 16 agent + `cdd-new` skill 全數重建，CI guard 防回歸 |

---

## 2. P0：立即修復（高影響、低成本，建議本週完成）

### P0-1. 修復全面性 UTF-8 亂碼（agent 提示檔是重災區）　✅ 已完成（PR #36）

- **現況**：箭頭（→）等字元在 18 個檔案中變成 `??`：`README.md`（43 處）與 `.claude/agents/*.md` 全部 17 個 agent（6~16 處不等），如 `context-manifest.md ??Allowed Paths`。
- **為何重要**：agent 提示檔會被原封不動載入 LLM context。`??` 不只難看 —— 它破壞語意（「A → B」變成「A ?? B」），降低 agent 對工作流程指示的理解品質，等於每次呼叫 agent 都在燒 token 換取更差的指令遵循。對非工程師，README 的目錄樹（lines 1244-1279）已不可讀。
- **做法**：機械式全域替換 `??` → `→`（逐檔人工確認語意），並在 CI 加一條 guard（grep 檢查 shipped markdown 不得含 mojibake pattern）防止回歸。`.gitattributes` 已存在，確認編輯器/工具鏈以 UTF-8 寫入。
- **工作量**：0.5 天。

### P0-2. `npm test` 必須在乾淨環境可直接執行　✅ 已完成（PR #36）

- **現況**：`package.json` 的 `test` 是 `vitest run`，但 CLI 測試依賴 `dist/cli/index.js`。乾淨 clone 後 `npm test` 直接失敗 480 個測試，錯誤訊息是 `Cannot find module .../dist/cli/index.js`。
- **為何重要**：這是任何貢獻者（包含 AI agent 自己）對 kit 做修改時的第一道體驗；對「極致自動化」的 kit 而言，自家測試需要隱性前置步驟是直接矛盾。
- **做法**：加 `"pretest": "node build.js"`（或在 vitest globalSetup 偵測 dist 缺失時自動 build）。
- **工作量**：0.25 天。

### P0-3. 測試需隔離環境 git 設定　✅ 已完成（PR #36）

- **現況**：`test/helpers.ts` 建測試 repo 時未停用 commit signing/hooks，在強制簽章的環境（如本次的沙箱、部分企業環境）`validate-versions.test.ts` 全部 10 個測試因 `git commit` 簽章失敗而炸掉。
- **做法**：測試中所有 git 呼叫統一加 `-c commit.gpgsign=false -c tag.gpgsign=false -c core.hooksPath=/dev/null`（或設 `GIT_CONFIG_GLOBAL=/dev/null` + 顯式 user.name/email）。
- **工作量**：0.25 天。

### P0-4. 為 kit 自身加上 CI workflow　✅ 已完成（PR #36）

- **現況**：repo 沒有 `.github/workflows/`；`github-workflows/contract-driven-gates.yml` 是發給使用者 repo 的模板，不會跑 kit 自己的測試。一個以「CI/CD gate 是必要交付物」為教義的 kit，自己沒有 CI。
- **做法**：新增 `.github/workflows/test.yml`：`npm ci → node build.js → tsc --noEmit → vitest run`，matrix 跑 Node 18/20/22；附帶 P0-1 的 mojibake guard 與 `cdd-kit code-map --check` 自我驗證。
- **工作量**：0.5 天。

### P0-5. 新增一鍵 `cdd-kit setup`（消除 onboarding 斷點）　✅ 已完成（本次 PR）

- **現況**：非工程師完成完整安裝需要跨多個 session 執行 7~10 條指令並理解其差異：`init` → `claude mcp add ...` → `install-hooks` → `install-agent-hooks --graph-first` → `install-agent-hooks --test-runner` → `context-scan` →（升級時再加 `refresh --yes` → `migrate --all` → `doctor --strict`）。README 中 update/upgrade/refresh/migrate 四個指令的語意差異連工程師都需要查表（README lines 503-510 自己就附了一張對照表）。
- **為何重要**：這是「極致自動化」最大的單點違反。目標使用者不具備判斷「我需要 refresh 還是 upgrade 還是 migrate」的背景。
- **做法**：新增冪等的 `cdd-kit setup`（fresh 與 upgrade 通用）：自動偵測現狀後依序執行 init/refresh、detect-stack、install-hooks、install-agent-hooks（graph-first advisory + test-runner advisory）、best-effort MCP 註冊（直接執行 `claude mcp add`，失敗只警告不阻斷）、context-scan、code-map，最後印出逐步成功/失敗摘要與「下一步：`/cdd-new <描述你的需求>`」。現有細粒度指令保留為進階介面。
- **工作量**：2~3 天。
- **實作（本次 PR）**：新增 `src/commands/setup.ts` 與 `cdd-kit setup` 指令。冪等：以 `.cdd/` 是否存在區分 fresh / upgrade，fresh 走 `init`（`arm:false`，由 setup 統一武裝），upgrade 走 `refresh --yes`。六步驟依序執行 scaffold → detect-stack → 武裝 chokepoints（pre-commit gate + graph-first/test-runner agent hooks，皆 advisory）→ best-effort MCP 註冊（偵測 `claude` CLI 不存在或 `claude mcp add` 失敗時只警告並印出手動指令，不阻斷）→ context-scan → code-map，最後印出逐步成功/失敗摘要與「下一步：`/cdd-new <describe your change>`」。每步皆 best-effort（缺 git repo 或 `claude` CLI 只降為警告），唯 scaffold 失敗才以非零退出。`--provider`、`--force`、`--no-arm`、`--no-mcp` 可微調；既有細粒度指令保留為進階介面。測試 `test/cli/setup.test.ts`（8 例）涵蓋 fresh、冪等 upgrade、best-effort MCP 跳過、各 flag 與非法 provider 拒絕；README Quick Start 與 CLI Reference 同步改以 `setup` 為建議入口。

### P0-6. Gate 失敗訊息的非工程師模式（`--explain`）　✅ 已完成（本次 PR）

- **現況**：gate 錯誤假設工程背景，如 `mark archive items in archive-tasks frontmatter; mark N/A items as status: skipped`、`tier floor violation: ... record tier-floor-override: "<reason>" in tasks.yml frontmatter`。非工程師不知道什麼是 frontmatter、為什麼 "auth" 字樣會觸發 tier 0、也不知道下一步該叫 Claude 做什麼。
- **做法**：
  1. `cdd-kit gate <id> --explain`：每個失敗附「白話原因 + 建議對 Claude 說的一句話」（例：「這個變更涉及登入驗證，屬於高風險，系統要求更嚴格的測試等級。請對 Claude 說：『請把這個 change 重新分類為 tier 0』」）。
  2. 既有錯誤輸出末尾固定加一行：`Need help? Run: cdd-kit gate <id> --explain`。
  3. 同步修掉 gate 輸出中 warning 重複列印兩次的問題（`gate.ts:1430-1452`）。
- **工作量**：2 天。
- **實作說明（本次 PR）**：新增純函式 `src/utils/gate-explain.ts`（`explainGateError(error) → { why, sayToClaude } | null`），以「最特定優先」的關鍵字比對涵蓋 tier floor、missing/stub/placeholder artifact、pending tasks、test-evidence、依賴環/未就緒上游、contract、malformed YAML 等失敗族，無對應時回 `null` 讓呼叫端退回通用提示。`gate.ts` 新增 `GateOptions.explain` 與共用的 `reportGateFailure(changeId, errors, explain, headline?)`，三個失敗出口（change not found、artifact/tier 等錯誤、validators 拋錯）統一走它；非 explain 模式末尾固定附 `Need help? Run: cdd-kit gate <id> --explain`。同時移除成功路徑上第二次列印 warnings 的區塊（原 `gate.ts:1450-1452`），warning 現在只在錯誤檢查前列印一次。kit 內容維持英文。測試：`test/utils/gate-explain.test.ts`（純函式映射 + null 退回）與 `test/cli/gate.test.ts` 新增 EXPLAIN-1~4（提示行、explain 標註、缺 change 仍給白話下一步、通過時 warning 只印一次）。

---

## 3. P1：下一個 minor 版（v2.3）

### 主題 A：把「休眠的自動化」變成「活的自動化」

| # | 提案 | 現況與根據 | 工作量 |
|---|---|---|---|
| P1-1 ✅ | **MCP 未註冊不得無聲降級**：`doctor` 將 MCP 未註冊依「確定性」分級——`claude` 在場且確認 cdd-kit 未註冊→**warning**（會讓 `--strict` 失敗），無法驗證（無 `claude` CLI／`mcp list` 出錯）→維持 informational | `src/utils/mcp-hint.ts`；README line 568-569 明言該檢查 never fails strict —— agent 默默用慢速模式，使用者只覺得「kit 很慢」 | 1 天 |
| P1-2 ✅ | **`cdd-kit doctor --simple`**：白話健康視圖——把所有通過的檢查收合成一行，先給一字結論再給單一「下一步」，並遵守 `--strict`／退出碼 | doctor 現有輸出 15+ 行技術細節，非工程師無法判斷「現在是好是壞」 | 1 天 |
| P1-3 ✅ | **Context Expansion Request 去阻塞**：(a) `loadContextPolicy` 現在讀取 `contextExpansion.{mode,autoApprovePatterns}`；`mode: "auto-safe"` 下，落在安全區（`src/**`、`tests/**`、`contracts/**`、`specs/changes/<current-change-id>/**`）且非 forbidden 的路徑在 `context request` 時直接核准、不留 pending；另加 `cdd-kit context auto-approve <id>` 處理既有 pending CER（全安全→approved，混合→裁剪保留待審）。(b) 新增 `cdd-kit context approve-interactive <id>` 逐筆白話標註（安全區／需審／policy 封鎖）＋ y/n/q，讀 stdin、EOF 乾淨停止不卡死。無 policy 檔或非 auto-safe 模式維持原 pending 行為 | CER `status: pending` 會讓 `/cdd-resume` 停住，非工程師面對一串技術路徑不知如何裁決，session 無聲卡死 | 1~2 天 |
| P1-4 ✅ | **預設武裝 test-runner hook（advisory）**：`init`／`setup` 預設與 graph-first 一起裝（皆 advisory），`init --no-test-runner` 可只留 graph-first | ADR 0005 §10 自己說「ship advisory first」，但現在連 advisory 都是 opt-in；非工程師永遠不會主動執行 `install-agent-hooks --test-runner` | 0.5 天 |
| P1-5 ✅ | **conformance 檢查引導啟用**：偵測到 API contract + 真實原始碼且仍關閉時，`doctor` 顯示提示、`doctor --fix` 直接開啟（從預設 asset seed），`setup` 印出同樣建議——絕不無聲開啟 | README 自述這是「無人工審查時的機械防漂移網」，但預設關閉 —— 最需要它的人（非工程師）最不可能去開 | 0.5 天 |

### 主題 B：Token 效率補洞

| # | 提案 | 現況與根據 | 工作量 |
|---|---|---|---|
| P1-6 ✅ | **graph-first 指示統一化**：為 `implementation-planner`、`test-strategist`、`spec-architect`、`spec-drift-auditor` 補上 graph-first「Code map (READ FIRST)」段落（依各 agent 的 `tools` 分流：有 Bash 的 spec-drift-auditor 用 `cdd-kit index query --with-source` 命令式，其餘三個無 Bash 改用「先讀 `.cdd/code-map.yml` 再做 offset/limit 定點 Read」） | 缺指示的 agent 直接整檔 Read，graph-first 的省 token 效果只覆蓋少數角色 | 0.5 天 |
| P1-7 ✅ | **查詢截斷可見化**：`index query`/`graph query`/MCP 回傳加 `total_matches`/`returned`/`truncated`；`index query` 另加每檔 `match_count`/`matches_truncated`；文字模式印 `results: N (of M; raise --limit …)`。per-file cap（原 `.slice(0, 8)`）抽為具名常數 `PER_FILE_MATCH_CAP` | `index-query.ts:169` 內部 `.slice(0, 8)`，agent 無從得知結果被截斷，導致漏讀（以為只有 8 個）或多讀（不會改用更精確的查詢詞） | 1 天 |
| P1-8 ✅ | **freshness digest 重算消除（mtime 修復）**：當「mtime 說 stale 但 digest 確認內容未變」（典型為 git clone 後全樹 mtime 變新）時，查詢路徑 `ensureCodeMapFresh` 把 code-map 的 mtime 往前推（best-effort），讓下一次查詢走便宜的 mtime 快速路徑、跳過全樹 SHA 重算。`FreshnessResult` 新增 `verifiedByDigest` 旗標。**僅限查詢路徑**（`index`/`graph` 且 refresh 開啟）；`--no-refresh`、`doctor`、`gate` 一律不寫 map（doctor「不寫檔」契約不受影響，因其呼叫的是 `checkCodeMapFreshness` 而非 `ensureCodeMapFresh`） | `freshness.ts:62-99` 每次查詢都可能走 stat 全樹 + SHA1 全量重算；大 repo 一個 session 5 次查詢就重算 5 次 | 1 天 |
| P1-9 ✅ | **graph-first hook 過時 map 不再導向**：當「即將被讀的檔」比 `.cdd/code-map.yml` 新時（單檔 `-nt` 比較，便宜），跳過 graph-first advisory、改印一行 `cdd-kit code-map` 刷新提示，且永不阻擋（strict 也放行）——避免把 agent 導向過時索引 | `hooks/pre-tool-use-graph-first.sh:54-66` 目前無條件輸出 | 0.5 天 |
| P1-10 ✅ | **`AGENTS.template.md` 路由摘要擴充**：每個 agent 一行「何時選用／與相似 agent 如何區分」（如 ui-ux vs visual、bug-fix vs 一般 engineer），並補回漏列的 `bug-fix-engineer`、`dependency-security-reviewer`（原本 16 個，現 18 個齊全），維持 <500 tokens | 現在只有名字清單，主 agent 選錯 sub-agent 的成本遠高於這幾百 token | 0.25 天 |

### 主題 C：可靠性與一致性

| # | 提案 | 現況與根據 | 工作量 |
|---|---|---|---|
| P1-11 ✅ | **拆分 `gate.ts`** 為 orchestrator（187 行）+ `gate-shared` / `gate-tier` / `gate-artifacts` / `gate-evidence` / `gate-dependencies` / `gate-contracts` 六模組（行為不變，887 測試全綠不變）。額外抽出 `gate-shared`（共用 Ajv 實例、`TasksFile` 型別、`loadYamlFile`、`ajvErrorsToMessages`）避免循環相依 | 原 1,455 行、32 函式單檔，是第二大檔（765 行）的兩倍；難以單測與安全擴充 | 3 天 |
| P1-12 ✅ | **tier 偵測 regex 強化**：`gate-tier.ts` 抽出 `parseStructuredTier`/`parseBoldTier`（皆行首錨定 + 0–5 驗證）、`hasLooseRiskMarker`（風險字僅在 list item / 標籤值 / `Tier N` 位置才算 marker，prose「critical systems」「high load」不再誤觸）；structured 與 bold 並存且值不一致時改報 error（不再無聲挑一個） | loose pattern `/\b(tier\s*[0-5]|low|...)\b/i` 可被「tier-based」「critical systems」等措辭誤觸 | 1 天 |
| P1-13 ✅ | **調查 `git-paths` rename 偵測失敗** — 結論：**生產端安全網從未壞過**，不是 git 版本的 `--name-status` 解析差異。實驗重現：host 全域 `commit.gpgsign=true`（即同批 10 個簽章失敗的根因）使測試 helper 的 `git commit` 默默失敗（`stdio:'ignore'` 吞錯），`git mv` 隨後作用在從未 commit 的 index entry，diff 自然只剩 `A <new>`——這正是「遺漏舊路徑」的全部成因。對照實驗：即使 `status.renames=false`/`diff.renames=false`，兩側路徑仍以 `D old` + `A new` 出現，parser 正確處理。P0-3 的 git 隔離已修復；本次補第二道防線：測試 `git()` helper 改為 assert exit status、失敗即指名出錯指令 | `test/cli/git-paths.test.ts:70,100` 於原審查環境失敗 | 1 天 |
| P1-14 ✅ | **`--json` 一致性**：補 `list`、`abandon`、`archive`（`context list` 已於 P1-3 補）；README 新增「Machine-readable output (--json) and exit codes」段落，文件化各 payload 與 exit code 語意（實測全 codebase 僅 0/1，無 2——0 = 完成（含合法空結果）、1 = 無法完成；照實文件化） | 17 個指令有 `--json`，其餘混雜純文字，自動化 wrapper 難以解析 | 0.5 天 |
| P1-15 ✅ | **CER 區段解析改用共用 markdown-section 工具 + `yaml.load`**：新增 `src/utils/markdown-section.ts`（`sectionBody`/`stripHtmlComments`），`context.ts` 與 `gate-artifacts.ts` 共用；gate 的 pending 計數改 `yaml.load`（CER 區段本就是 YAML 序列），無法解析時退回原 line-scan，永不少算 | `gate.ts:191-207` 對縮排/空行敏感，格式稍異即無聲漏算 pending | 1 天 |
| P1-16 ✅ | **`tier-policy.json` 解析/結構失敗要警告**：`loadTierPolicy` 對 JSON 解析失敗、非物件、`rules` 非陣列、單條 rule shape 不符（`maxTier` 非 0–5 整數、`patterns` 非陣列）逐項 `log.warn`（指明「your custom tier rules are NOT in effect」）；檔案缺席與 `enabled:false` 維持靜默 | 使用者改壞 JSON 後以為自訂規則生效，實際全被忽略 | 0.25 天 |
| P1-17 ✅ | **doctor 與 context-scan 的 digest 邏輯抽共用模組**：`inputsDigest` 移入 `src/utils/digest.ts`；輸入檔選擇（`findContractFiles`、`projectMapInputs`）抽至新 `src/utils/context-inputs.ts`，writer 與 checker 改 import 同一函式，lockstep 由註解約定變為結構保證 | `doctor.ts:49-61` vs `context-scan.ts` 重複實作，漂移即「永遠顯示 stale」 | 0.5 天 |

---

## 4. P2：路線圖（v2.4+）

| # | 提案 | 說明 | 工作量 |
|---|---|---|---|
| P2-1 ✅ | **實作 `change.yml`/`trace.yml`（`cdd-kit metadata`）** | **已完成**（generator：PR #48；gate/doctor freshness 整合：本次 PR）。`cdd-kit metadata <id>`（`--check`/`--all`/`--json`）從現有工件**衍生**出 `change.yml`（status/tier/lane/types/required-agents/artifacts/context/dependencies）與 `trace.yml`（AC→tests→gates＋agent-log evidence），治本「markdown 當資料庫」脆弱性（P1-12、P1-15 根因）：generator 集中、一次性解析 markdown，agent/MCP 改讀結構化 YAML。刻意為**衍生索引**——markdown 仍是 source of truth，缺/過時索引永不影響 gate pass/fail；gate 只在索引已生成且過時時印 warn-only 提示，`doctor --fix` 重生。設計文件 `docs/machine-readable-change-design.md` 已標註 Implemented | 4 天 |
| ~~P2-2~~ | ~~**Go / Rust scanner**~~ — **已撤銷（descoped）** | 使用者不以 Go/Rust 開發，故反向移除整個 Go/Rust 支援面：`stack-detect.ts` 不再偵測 `go.mod`/`Cargo.toml`（回報 `unknown`），刪除 `ci-templates/{go,rust}.yml`，README detect-stack 表與 polyglot 計數一併清理。此 scanner 項目連帶取消（無偵測即無需 scanner） | — |
| P2-3 ✅ | **新 MCP 工具：`cdd_contract_locate`、`cdd_test_impact`** | **已完成**（`cdd_test_impact`：PR #50；`cdd_contract_locate`：本次 PR）。前者以 code symbol 反查相關 contract 切片（名稱相等橋接，省 graph→read→猜 schema→contract-query 來回）；後者回答「改了這個檔，哪些測試受影響」（遞移 importer 測試 + 鏡像路徑，每筆附 `reason`）。兩者皆 CLI 子命令 + 薄 MCP wrapper，與既有 7 個工具同構 | 各 2~3 天 |
| P2-4 ✅ | **暴露 unresolved references** | **已完成**（本次 PR）。新增 `cdd-kit graph unresolved [path-or-symbol]` + `cdd_graph_unresolved` MCP 工具，並讓 `graph impact` 額外帶上來源於影響集合的 unresolved（text + `--json`）。原本 builder 記錄的 `calls`/`extends`/`implements` 無法解析參照（DI 容器查找、外部服務呼叫、動態派發、歧義名稱）只在 `graph status` 顯示一個總數——impact 分析靜默漏掉這段 blast radius。每筆於查詢時補「同名候選節點」（索引不動），把**歧義**（有候選、目標存在但無法確定連結）與**真外部/動態**（圖中無此節點）分辨開來；空結果＝健康（exit 0）。CLI flags：`--kind`、`--limit`(50)、`--map`、`--no-refresh`、`--json`；native engine only | 1~2 天 |
| P2-5 | **i18n 訊息目錄（繁中優先）** | 全部訊息 English-only 且散落各檔；先集中到 `src/messages.ts` 建翻譯掛點，繁中為第一個目標語系 —— 目標使用者明確包含中文非工程師 | 3~5 天 + 翻譯 |
| P2-6 ✅ | **Tier 4（低風險）變更的 manifest 自動生成** | **已完成**（本次 PR）。新增 `cdd-kit manifest <id>`：對 tier 4-5 micro-change 產出最小 `context-manifest.md`（Allowed Paths = change dir + `git status` 變更檔 + 三個預設）。刻意限縮 tier 4-5（tier 0-3 拒絕，仍需手寫含 per-agent work packets 的完整 manifest）；不 `--force` 不覆蓋既有 manifest；需先設 tier。flags `--force`/`--json` | 1~2 天 |
| P2-7 ✅ | **`tier-floor-override` 審計強化** | **已完成**（本次 PR）。override reason 須 ≥ 20 字（過短不再降級、floor violation 維持），每次有效 bypass 以時間戳 + 命中 floor + reason append 到 `agent-log/audit.yml`；寫入冪等（重跑 gate 不重複）且 best-effort（永不讓 gate 因審計寫入失敗） | 1 天 |
| P2-8 ✅ | **`visual-reviewer` 模型升級 haiku → sonnet** | **已完成**（本次 PR）。改 agent frontmatter、`.cdd/model-policy.json`、`doctor --fix` 預設 role map、`/cdd-new` 模型徽章說明四處；其餘 roster 不變（改後 5 opus / 12 sonnet / 1 haiku） | 0.1 天 |
| P2-9 ✅ | **Dogfooding 範例**：在 `specs/archive/2026/` 收錄一個完整走完流程的 change（含 agent-log、test-evidence） | **已完成**（本次 PR）。新增 `specs/archive/2026/add-order-filter/`：七個必備工件全填、窄範圍 context-manifest、完成態 tasks.yml、通過的 test-evidence + test-runs summaries、每個必備 agent 一份 agent-log、archive.md（promoted lessons）、README 導覽，及 archive `INDEX.md`。illustrative（不執行真碼） | 1 天 |
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
| ~~machine-readable 設計未實作~~ —（已實作 P2-1）`cdd-kit metadata` 已存在 | `src/commands/metadata.ts`；`docs/machine-readable-change-design.md`（Status: Implemented） |
| ~~Go/Rust scanner 缺~~ —（已撤銷）改為移除 Go/Rust 偵測 | `src/utils/stack-detect.ts` 不再偵測 `go.mod`/`Cargo.toml` |
| tier-policy 無聲 fallback | `src/utils/tier-floor.ts:91-120` |
| digest 邏輯重複 | `src/commands/doctor.ts:49-61` |
| model 配置 | `.claude/agents/*.md` frontmatter（5 opus / 11 sonnet / 2 haiku） |
