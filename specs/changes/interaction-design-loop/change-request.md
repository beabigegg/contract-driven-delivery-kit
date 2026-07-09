# Change Request

## Original Request

在 CDD 流程中加入 **human-in-the-design-loop**，與功能面的 acceptance oracle 對稱：介面設計必須在實作前由人類拍板，並與 API 契約互相對帳，避免前端開出後端無法兌現的支票。

具體內容：

1. 新增 `interaction-designer` agent（read-only proposer）與 `specs/changes/<id>/interaction-design.md` 產物，插在 `contract-reviewer` 之後、`implementation-planner` 之前。它與契約構成**收斂迴圈**（契約與介面設計互為約束），而非單向流。
2. 產物承載一條介面推導鏈：呈現的資訊與其理由 → 使用者在此的真實意圖與頻率 → 每個控制項對應哪一個意圖（含**被刪除的控制項與理由**）→ 狀態可逆性 → 意義⇄形式一致性承諾 → `## Open Decisions`（agent 提給人類的問題）→ `## Confirmed`（人類的答案）。
3. **Provenance 對帳**：`interaction-design.md` 裡的每個資訊項與每個 UI 狀態，都必須指名其供應來源——`contracts/api/api-contract.md` 的 endpoint + schema field、`errors` 欄的 error code、HTTP status，或 `contracts/data/data-shape-contract.md` `## Invalid Data Behavior` 的某一列。指不出來即為硬錯誤。反向（契約有欄位但無任何資訊項引用）為 advisory 警告，不阻擋。
4. 新增 gate check `enforceInteractionDesign`：檔案存在、零未解 `## Open Decisions`、有人類 `## Confirmed`、參照完整性（每個控制項引用一個意圖 id；每個意圖有一條路徑），以及 provenance 對帳。
5. **Hash-lock**：`cdd-kit design confirm <change-id>` 是唯一被允許寫入 `.cdd/design-lock.json` 的路徑。人類確認後若 agent 再修改交互設計，gate 失敗並要求重新確認（沿用 ADR 0010 的 tamper-evidence 機制）。
6. `frontend-engineer` 在設計未確認時 report `blocked`，並移除 states 那一行的 `when applicable` 逃生門——狀態一律來自已確認的設計，不由 AI 自行判斷。
7. `implementation-planner` 必須以路徑/章節引用已確認的設計。
8. `ui-ux-reviewer` 改為**對照已確認的設計**審查（Nielsen 等通用啟發式降為次要透鏡），並修正它指向不存在的 `contracts/ui/`（實際為 `contracts/css/`）。
9. 純視覺／文案微調可依 ADR 0011 的 `applicability: not-applicable` 標記跳過此節點，並必須記錄理由。
10. 先寫 **ADR 0012**，把三件事訂死：human-in-the-design-loop 的節點與收斂語意；provenance 對帳的 join 規則與硬/軟錯誤邊界；**絕不 gate 的清單**。

### Scope expansion (核准於 2026-07-09，由 ci-cd-gatekeeper 的發現觸發)

11. **讓 `cdd-kit gate` 真正在 CI 上執行。** `ci-cd-gatekeeper` 查證後確認：`.github/workflows/contract-driven-gates.yml`（及發給採用者的 `github-workflows/` 樣板）只跑 `cdd-kit validate`，**從未呼叫 `cdd-kit gate <id>`**。唯一執行 gate 的是本機 `.git/hooks/pre-commit`，而它可被 `--no-verify` 繞過（該 hook 自己的輸出就這麼寫）。

    後果：`contracts/ci/ci-gate-contract.md` 的 Gate Inventory 宣稱 `enforceAcceptanceOracle` 的 trigger 是 `pull_request; local`，**但 pull_request 那一半是假的**。ADR 0010 的 tamper-evidence、以及本 change 要蓋的 `enforceInteractionDesign`，在 PR 上都完全不設防。這個洞在 acceptance-oracle 那次已被發現並記為「carried forward」，現在它即將吞掉第二道必要 gate。

    因此本 change 擴大範圍，同時修正：
    - `.github/workflows/contract-driven-gates.yml`（本 repo 自身）
    - `github-workflows/contract-driven-gates.yml`（`build.js:114` 複製到 `assets/` 的採用者樣板；`assets/` 為禁改路徑，只改 source）

    CI 必須從 PR diff 推導出被觸及的 `specs/changes/<id>/`，對每一個執行 `cdd-kit gate <id>`。同時必須處理**版本釘選**問題：workflow 目前跑 `npm install -g contract-driven-delivery`（永遠是 npm latest），這等同於 CI 版的「全域 binary 過期」病——若採用者的 repo 用了尚未發布的檢查，CI 會用舊版評判新 repo。

    此擴充不改變 Tier 1 判定：CI workflow 變更可逆，無生產資料、無 auth/payment/併發面。分類理由（high risk + system-wide authority，但無不可逆 blast radius）原封不動成立。

### Scope expansion 2 (核准於 2026-07-09，由 backend-engineer 第四批的發現觸發)

12. **實作 `rules[]` 綁定檢查——契約宣稱它存在，但它從未被寫出來。**

    `contracts/ci/ci-gate-contract.md:64` 與 `docs/adr/0010-acceptance-oracle.md` §4 都明文規定：「`--strict` 模式額外要求每條 `rules[]` 不變量至少綁一支測試」。實際查證：**`rules` 這個識別字在 `src/commands/gate-acceptance.ts` 中一次都沒有出現**，`scanAcceptanceDrivers` 只走訪 `cases[].expect`。這個檢查從來沒有被實作。

    後果：`acceptance.yml` 的 `rules[]` 目前只有 hash 保護（`rules[].{id,statement}` 在鎖定投影內，agent 不能偷刪或竄改），但**沒有任何機制確保它被測試證明**。本 change 自己鎖進去的 `aesthetics-never-blocks` 不變量因此是一條無人執法的宣言。

    這與 Scope expansion 1 是同一類病：**契約描述了一個現實中不存在的保護。** 維護者的判斷一致——修，不要留著說謊。

    因此本 change 撤銷原 Non-goal，於 `--strict` 模式加入 `rules[]` 綁定掃描。實作必須避開本 change 反覆譴責的「不懂脈絡的規則」陷阱：綁定比對必須是**全詞邊界**（重用 `mock-of-sut-scan.ts` 的 `isWordBoundaryOccurrence`），且必須是**change-scoped**（重用 `driverBelongsToChange`）。否則會重演 ADR 0010 出貨時掃描器的兩個假陽性 bug。

### Scope expansion 3 (核准於 2026-07-09；維護者選擇 `cdd-kit abandon` 處置陳年目錄後，發現該命令本身是壞的)

13. **`cdd-kit abandon` 回報成功但沒有做任何事；`validate` 從不認識 `status: abandoned`。**

    QA 的合併條件是先處置 `specs/changes/yaml-migration-plan/`（一份 2026-04-30 的計畫書，其描述的工作已由 `a6b624f` 實作上線，目錄卻留在原地，缺 5 個必要產物）。維護者選擇 `cdd-kit abandon`。

    實跑後發現兩個獨立缺陷：

    - **`src/commands/abandon.ts:20`**：`if (existsSync(tasksPath))` — 目錄若沒有 `tasks.yml`（陳年目錄的典型狀態），狀態寫入被靜默跳過，然後第 51 行**無條件回報 `Change ... marked as abandoned.`**。實測：目錄內容零變化，`plan.md` frontmatter 仍是 `status: ready-to-execute`。
      這與本 session 稍早依 codex review 修掉的 `installHooks` 假成功回報是同一個病：**命令宣告了一個沒有發生的保證。**

    - **`validate_spec_traceability.py`**：`REQUIRED` 五個產物是無條件要求，驗證器**完全沒有 `abandoned` 的概念**。所以即使狀態寫進去了，`validate` 依然會因缺少另外四個產物而失敗。

    合起來：**`cdd-kit abandon` 永遠不可能讓 `validate` 通過。** 這個命令的文件承諾（「保留目錄供 git 歷史」）在驗證層面從未兌現。任何 abandon 過 change 的採用者，`validate` 就永遠是紅的——在本 change 把 `validate` 接進 CI 之後，就變成永遠紅的 CI。

    修正方向沿用 ADR 0011 的標記紀律（marker + 必填理由 + fail-closed）：
    - `abandon` 在缺少 `tasks.yml` 時必須建立最小的一份（`status: abandoned` + 非空 `abandoned-reason` + `abandoned-at`），或以明確訊息硬失敗；**絕不可在未寫入狀態時回報成功**。
    - `validate_spec_traceability.py` 先讀 `tasks.yml` frontmatter：`status: abandoned` 且 `abandoned-reason` 非空 → 跳過該目錄的必要產物檢查並印出資訊性註記；`abandoned` 但無理由 → 硬錯誤。無標記的殘缺目錄照舊硬失敗。

### Deferred follow-ups (evidence recorded, owner assigned, NOT fixed here)

- **tier-floor 掃描器在否定句中命中關鍵字。** 本 change 的 `gate --strict` 輸出：`tier floor override: ... (matched: auth, endpoint, index, migration, payment)`。`auth` 與 `payment` 之所以命中，是因為 `change-request.md` 寫的是「**沒有** auth、**沒有** payment 面」。掃描器讀不出否定。這與 ADR 0012 § Never Gated 譴責的失效模式同構，只是長在 kit 自己的 `src/utils/tier-floor.ts` 上。
  維護者決定不在本 change 修正：該機制的失效方向是 fail-safe（寧可誤擋，不可誤放），且 `tier-floor-override` 需要實質理由並寫入 `agent-log/audit.yml`。修正它反而可能讓真正的 auth 變更逃逸。Owner: 後續 change。

- **`assets/github-workflows/` 與 `.github/workflows/` 的分岔** 現在更深了（前者用 `{{cdd-kit-version}}` 釘選發布版，後者用自身 build）。無 drift 檢查。Owner: 後續 change。

## Business / User Goal

使用者是非寫程式的 solo developer，全部實作委派給 AI agent。功能面已有 acceptance oracle（人類提供答案卷、hash-lock、AI 不能改）；**設計面完全沒有對應物**。

證據：`cdd-new/SKILL.md` 的 Tier 2–3 agent 順序中，`frontend-engineer` 在第 7 步就開始寫畫面，而 `ui-ux-reviewer`（第 9 步）與 `visual-reviewer`（第 10 步）都在程式寫完之後才進場。設計在這條流水線上**只以事後審查的身分出現**，從來不是實作的前置輸入。`implementation-plan.md` 裡也從未有人談過「這一頁要呈現什麼資訊、使用者會怎麼操作」。

後果對應到業界已觀察到的 AI 生成介面三大症狀（TechOrange 2026-07-08，引 Business Insider）：平均美學、只優化 happy path、邊界狀態被省略。本 change 只處理**後兩者可被機械保證的部分**，第一項明確排除。

此外，`contracts/data/data-shape-contract.md` 的 `## Invalid Data Behavior` 表格已有一欄字面叫 `error code / UI state`，預填 `empty dataset`、`wrong type`、`over max row limit`、`unexpected enum` 等列——但**該欄從未有任何消費者**，因為 kit 裡沒有任何產物記載過 UI 有哪些狀態。本 change 讓這座蓋了一半的橋接上。

## Non-goals

- **不 gate 視覺美感、動效、版面品味。** 這些需要脈絡才能判斷，寫成規則必然誤判（例：hover 動效出現在不可點元素上，可能是合法的「游標所在」回饋，不是 bug）。ADR 0012 必須把這條寫成明文禁令。
- 不建立 CSS/token/顏色層面的新掃描器。
- 不驗證 latency 承諾與往返次數（N+1）。這是語意層，靜態 join 檢查不到；對帳表只負責把事實攤開讓人判斷，latency budget 的驗證屬於 `stress-soak-engineer` 的既有職責。
- ~~不改動 acceptance oracle（ADR 0010）本身的機制。~~ **此 Non-goal 已於 2026-07-09 由維護者明確撤銷**，見下方 Scope expansion 2。
- 不處理 `specs/changes/yaml-migration-plan/`（既有、無關）。
- 不修正 tier-floor 掃描器的否定句誤判（見下方 Deferred follow-ups）。

## Constraints

- **Subagent 無法與使用者對話。** 因此「設計 agent 跟使用者討論」必須實作為：agent 提案 → main Claude 主持對話 → 人類拍板 → 寫入並鎖定。kit 內已有此模式的兩個先例：`Step 0: Request quality check` 與 `## Atomic Split Proposal`。
- 所有正確性保證必須留在 **portable layer**（CLI validators + `gate` + settings.json hooks），不得依賴 Claude Code 專屬的 Workflow/Loop/Worktree（ADR 0010 §5）。
- 新增的必要 gate check 必須採 `isNewChange || strict` 遷移窗（比照 `enforceTestEvidence` / `enforceAcceptanceOracle`），否則既有 change 目錄會在一夜之間全數失敗。
- `.cdd/design-lock.json` 必須是 agent 硬禁寫路徑，比照 `.cdd/acceptance-lock.json`。
- 資產規則：只編輯 `.claude/` 版本，再跑 `node build.js` 產生 `assets/`；絕不手改 `assets/`。
- 全域 `cdd-kit` 為 2.2.1（過期），本地驗證一律用 `node dist/cli/index.js`。

## Known Context

- ADR 0010（acceptance oracle）提供本 change 可直接複用的 tamper-evidence 樣板：canonical projection hash、lock 檔、write-block hook、單一 sanctioned writer CLI、`isNewChange || strict` 遷移窗。
- ADR 0011（`applicability: not-applicable` 標記）提供「此契約面不適用」的既有機制，可直接用於「本 change 無需交互設計」的跳過路徑。
- ADR 0007（data-shape conformance）已建好 `openapi export` 與 schema 驗證機制，provenance 對帳的欄位存在性檢查可接上它。
- `contracts/api/api-contract.md` 已有 `errors` 欄與 `## Schemas`（Tier A 欄位表 / Tier B json-schema）。
- `.claude/skills/contract-driven-delivery/scripts/applicability.py` 是 not-applicable 標記的唯一 pass/fail 權威。

## Open Questions

- 最陰險的失效模式是「狀態無判別依據」：設計要求區分「沒有異常」與「沒收到資料」，但 API 兩者都回 `[]`。對帳表要求每個狀態指名一個 discriminator（欄位 / error code / HTTP status），此規則的嚴格程度需在 ADR 0012 定案。
- `interaction-design.md` 是每個 change 一份的產物，或應同時在 `contracts/css/` 留下長期的「版面語言」契約？本 change 先做前者；後者留待後續 ADR。

## Requested Delivery Date / Priority

高。此節點缺失會讓每一個觸及 UI 的 change 都在無人拍板的情況下由 AI 決定介面形狀。
