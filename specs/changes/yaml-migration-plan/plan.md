---
plan-id: yaml-migration-plan
target-version: cdd-kit v1.17.0
audience: Sonnet implementer
status: ready-to-execute
created: 2026-04-30
---

# YAML 化遷移計畫 — agent-log 與 tasks.md 統一格式

## 0. 為何要做這個遷移（一段話交代動機）

cdd-kit 目前的「機器可解析」資料同時混用兩種格式：

1. `tasks.md` 開頭是真的 YAML frontmatter（`---` 包起來的 key:value），這個是 OK 的。
2. `agent-log/*.md` 是「看起來像 YAML 但其實是 Markdown 列表」的偽 YAML —
   `- status: complete` 這種寫法靠 `gate.ts` 內的一堆 regex 去抓，而 `- files-read:` 後面接縮排 2 格的子項，又是另一條 regex。

問題：
- `gate.ts` 已經有 ~700 行，超過一半在解析這個半結構化文字。每加一個欄位就要再加一條 regex；CRLF / 縮排錯一個空白就整段失效，但 gate 不會明確告知是格式問題還是內容問題。
- agent prompt 端要求 16 個 agent 各自手寫這個格式，自我驗證又寫了 5 條檢查清單（references/agent-log-protocol.md L75-95）—— 這是「教 LLM 不要寫錯 markdown」的反模式。
- runtime hook 已經在輸出 JSONL（`.cdd/runtime/<id>-files-read.jsonl`），我們已經在用真正的結構化資料，只是沒有在 agent-log 端統一。

把 agent-log 遷移成「真 YAML frontmatter（結構化欄位）+ Markdown 敘述（給人讀）」之後：
- `gate.ts` 可以丟掉 `parseFilesRead`、`parseListField`、`parseTaskFrontmatter` 三個自製解析器，改用 yaml lib 一次取得全欄位。
- agent prompt 不再需要教 LLM「怎麼縮排子項」這種低階格式知識，只要說「填 schema 裡的 key」即可。
- 新增欄位（例如 PR 連結、test-output 多行區塊）只要動 schema，不必改 regex。

## 1. 目標與非目標

### 目標（in scope）
1. agent-log 全面改用 YAML frontmatter 承載結構化欄位；正文 markdown 維持給人讀。
2. `tasks.md` frontmatter 已經是 YAML，這次只做「key 規範化」與「JSON Schema 文件化」，不破格。
3. `gate.ts` 改寫：刪除自製 regex 解析、改用 `yaml` 解析；gate 報錯訊息直接帶 schema path。
4. 提供 `cdd-kit migrate --to-yaml-logs` 一鍵升級 in-flight 與 archive 中的舊 agent-log。
5. 提供向後相容降級：偵測到舊格式時 gate 仍可解析（warn-only），給用戶一個 release window。
6. 16 個 agent prompt 中與「agent-log 格式」相關的段落統一 inline 換成「請填以下 schema 欄位」並改指 `references/agent-log-protocol.md`（後者也要更新）。

### 非目標（out of scope，避免 scope creep）
1. 不動 `change-classification.md`、`test-plan.md`、`ci-gates.md` 的 markdown 主結構 — 這些是寫給人看的決策紀錄，不是 gate 的解析對象。
2. 不引入新的 schema 驗證器（如 ajv）— 我們只用 `yaml.parse` + 手寫 typescript guard，依賴零增加。
3. 不換掉 runtime hook 的 JSONL — 它已經是好格式，只是消費端要對得起來。
4. 不重新分類 tier、不改 agent matrix — 純格式遷移。

## 2. 現況盤點（Sonnet 實作前必讀）

| 檔案 | 角色 | 目前格式 | 問題 |
|---|---|---|---|
| `src/commands/gate.ts` L147-204 | tasks.md frontmatter 解析 | 手刻 `parseTaskFrontmatter` | 不支援 list 換行語法、不支援嵌套；`parseListField` 把 `["7.1","7.2"]` 當 JSON 字串處理 |
| `src/commands/gate.ts` L427-475 | agent-log files-read 解析 | 純 regex `^\s*-\s*files-read:\s*$` + 後續縮排掃描 | 縮排寬度寫死 `\s{2,}`；CRLF 錯一個就 break；錯誤訊息只說「invalid format」不指哪一行 |
| `src/commands/gate.ts` L628-662 | agent-log status / artifacts / next-action 解析 | 三條獨立 regex | 改一個欄位要改三處；artifacts pointer 的「path:line-range」也是 regex 抓的，不能驗 schema |
| `.claude/skills/contract-driven-delivery/references/agent-log-protocol.md` | 規範 | markdown 範本 + 自我驗證清單 | 是「給 LLM 看的 prompt」而不是「給機器看的 schema」 |
| 16 個 `.claude/agents/*.md` | agent prompt | 各自有 `### Required artifacts for this agent` 段落 | 列舉「key 名稱與範例」但無 schema；list 結構靠 narration 維持 |
| `src/commands/migrate.ts` | 既有遷移工具 | 處理 v1.10 → v1.11 的 tasks.md frontmatter 補正 | 是這次新增 `--to-yaml-logs` flag 的最佳載點 |

## 3. 目標格式設計（Schema v1）

### 3.1 agent-log 新格式

每個 agent 寫一個檔案：`specs/changes/<change-id>/agent-log/<agent-name>.md`，結構為「YAML frontmatter（gate 解析） + Markdown 正文（給人讀）」：

```markdown
---
schema-version: agent-log/v1
agent: backend-engineer
change-id: add-jwt-auth
timestamp: 2026-04-30T12:34:56Z
status: complete            # complete | needs-review | blocked
next-action: none           # 字串；blocked 時 >= 10 字元且非 "none"
files-read:
  - src/api/auth.ts
  - tests/api/auth.test.ts
  - specs/changes/add-jwt-auth/test-plan.md
artifacts:
  files-changed:
    - src/api/auth.ts:45-120
    - src/api/middleware/jwt.ts:1-80
  tests-added:
    - tests/api/auth.test.ts::should reject expired token
    - tests/api/auth.test.ts::should issue token on valid creds
  contracts-touched:
    - contracts/api/api-contract.md
  test-output: |
    PASS tests/api/auth.test.ts (5 tests, 2.1s)
    Tests: 5 passed, 0 failed
    Time: 2.103s
  ci-run-url: https://ci.example.com/run/12345    # 選填
---

# Backend Engineer Log

## Summary
JWT 簽發與驗證實作完成；中介層在 src/api/middleware/jwt.ts。
測試先寫，全部通過。Contract 已在 contract-reviewer 階段更新。

## Notes
（人類可讀的補充說明，不參與 gate 解析）
```

關鍵設計：
- `schema-version` 是第一鍵；gate 看到 `agent-log/v1` 就走 YAML 路徑，舊檔（無 frontmatter）走 legacy 路徑。
- `artifacts` 從「list of strings (`<type>: <pointer>`)」改為「dict of typed lists」。每種 evidence type 是固定 key，值是 list of strings。這解決「regex 切冒號」的脆弱性。
- `test-output` 用 YAML literal block（`|`）承載多行，不用再煩惱換行跳脫。
- Markdown 正文（`# Backend Engineer Log` 起）gate 完全不解析，只給人讀。

### 3.2 tasks.md frontmatter 規範化

既有欄位（保留 + 文件化）：
```yaml
---
schema-version: tasks/v1       # 新增；舊檔無此 key 視為 legacy
change-id: add-jwt-auth
status: in-progress             # in-progress | completed | gate-blocked | abandoned | needs-review
tier: 2                         # 0-5 整數，不再接受字串
context-governance: v1
archive-tasks: ["7.1", "7.2"]   # YAML flow-list；現在 parseListField 已支援
depends-on: []
created: 2026-04-30             # 選填
completed:                      # 選填，close 時填
---
```

唯一行為變更：`tier` 從「可為空字串」改為「未填則為 null（缺漏，gate 報錯）」。其餘維持。

### 3.3 JSON Schema 檔案

新增 `.claude/skills/contract-driven-delivery/references/schemas/agent-log-v1.json`
與 `tasks-v1.json`，作為「人類可讀規格 + 之後若引入 ajv 即可直接套」的雙用文件。

不在執行階段使用 ajv（依賴零增加），但 `references/agent-log-protocol.md` 改為直接內嵌 schema 表，agent prompt 用「請對照 schema」一句帶過。

## 4. gate.ts 改寫策略

### 4.1 新增依賴
`package.json` 加入 `"yaml": "^2.5.0"`（純 JS、零原生依賴，~50KB）。
不引入 ajv —— 改用本檔 §4.3 的 typescript guard 函式手刻 schema 檢查。

### 4.2 模組拆分（gate.ts 700 行 → 拆三個檔）

```
src/commands/gate.ts                      (~250 行；orchestration only)
src/utils/agent-log-parser.ts             (~180 行；YAML + legacy fallback)
src/utils/tasks-frontmatter-parser.ts     (~120 行；既有 + schema-version 路由)
```

`gate.ts` 退回「只負責流程：載 policy → 找檔 → 呼解析器 → 收集 errors → exit」。具體解析交給 utils。
這個拆分不只為了清爽，也讓 `migrate.ts` 與 `validate.ts` 之後能 import 同一個解析器，避免又長出第二份 regex。

### 4.3 agent-log-parser.ts 介面

```ts
export interface AgentLogV1 {
  schemaVersion: 'agent-log/v1';
  agent: string;
  changeId: string;
  timestamp: string;             // ISO 8601
  status: 'complete' | 'needs-review' | 'blocked';
  nextAction: string;
  filesRead: string[];
  artifacts: Record<string, string[] | string>;  // dict of typed evidence
}

export interface ParsedAgentLog {
  format: 'v1' | 'legacy';
  raw: AgentLogV1 | LegacyAgentLog;
  errors: string[];               // schema 違反；空陣列 = OK
  warnings: string[];             // 例如 legacy 格式提示
}

export function parseAgentLog(content: string, opts: { changeId: string }): ParsedAgentLog;
```

實作分支：
1. 嘗試解析 frontmatter（`yaml.parse`）。若 `schema-version === 'agent-log/v1'`，走 v1 校驗。
2. 否則走既有 `parseFilesRead` + status regex（搬到此檔），回傳 `format: 'legacy'`。
3. v1 校驗用 type guard 函式，失敗時 errors 帶 `schema path`，例如：
   - `agent-log.status: invalid value "done" (expected: complete | needs-review | blocked)`
   - `agent-log.files-read[2]: absolute path not allowed (got "/etc/foo")`
   - `agent-log.artifacts.test-output: must be string when present`

### 4.4 gate.ts 對解析結果的反應

```ts
const parsed = parseAgentLog(content, { changeId });

if (parsed.format === 'legacy') {
  if (strict || isNewChange) {
    errors.push(`agent-log/${f}: legacy format detected; run "cdd-kit migrate --to-yaml-logs ${changeId}"`);
    continue;
  }
  warnings.push(`agent-log/${f}: legacy format (warning only; migrate before next release)`);
}

errors.push(...parsed.errors.map(e => `agent-log/${f}: ${e}`));
```

舊 `parseFilesRead`、`parseListField`、`parseTaskFrontmatter` 從 `gate.ts` 移除（搬到 utils；繼續支援 legacy，由 parser 內部呼叫）。

### 4.5 既有測試的處理
`test/cli/gate.test.ts` 內所有寫死 agent-log 的 fixture 都要新增「v1 版本」的對照測試。原 legacy fixture **保留**並改為 `'legacy format triggers warning in lax mode'` 的分支，這樣同時驗證新舊路徑。

## 5. agent prompt 更新方式

### 5.1 references/agent-log-protocol.md 改寫

砍掉「Required structure」那段範本（L20-33），換成：

```md
## Required structure (schema)

Agent logs are YAML frontmatter + markdown body. Required frontmatter keys
and their types are defined in
`references/schemas/agent-log-v1.json` and summarised below:

| key | type | required | notes |
|---|---|---|---|
| schema-version | const "agent-log/v1" | yes | first key |
| agent | string | yes | matches your agent file name |
| change-id | string | yes | matches the directory |
| timestamp | ISO 8601 string | yes | UTC, with Z suffix |
| status | enum: complete\|needs-review\|blocked | yes | |
| next-action | string | yes | "none" only when status=complete |
| files-read | list of repo-relative paths | yes (governed) | no absolute, no ".." |
| artifacts.<type> | list of strings or string | per-agent | see your agent prompt for required types |

`cdd-kit gate` rejects any log whose frontmatter does not parse as YAML or
violates the schema above. The error message names the failing path.
```

自我驗證清單從「人類 checklist」改為「請呼叫 `cdd-kit validate-log specs/changes/<id>/agent-log/<name>.md` 自驗」（新增 CLI 子命令，§6.2）。

### 5.2 16 個 agent prompt 的調整（一個範本，套到全部）

每個 agent 檔末尾的 `## Machine-Verifiable Evidence` 段落，把「Required artifacts for this agent」從散文 list 改為 schema fragment：

before（backend-engineer 現況）：
```
### Required artifacts for this agent
- `files-changed`: list of `path/to/file.ts:line-range`
- `tests-added`: list of `test-file.ts::test-name`
- `test-output`: last 10 lines of `npm test` or equivalent stdout
- `contracts-touched`: list of contract file paths or "none"
```

after：
```
### Required artifacts (filled into agent-log frontmatter `artifacts:` dict)
artifacts:
  files-changed: [...]      # list of "path:line-range"
  tests-added: [...]        # list of "file.ts::test name"
  test-output: |            # multi-line string; last 10 lines of test stdout
    ...
  contracts-touched: [...]  # list of paths, or [] if none
```

形式 = YAML 片段，agent 直接複製到 frontmatter，不必再學「縮排規則」。

### 5.3 cdd-new / cdd-resume / cdd-close skill 的調整

只動兩處：
1. `cdd-new` SKILL.md L92-97 那張「Write Responsibilities」表的後續說明，補一句「agent-log frontmatter must use schema-version: agent-log/v1」。
2. `cdd-resume` SKILL.md L20-34 既有的格式偵測段落，擴充偵測 agent-log v1：「if any agent-log lacks frontmatter, run `cdd-kit migrate --to-yaml-logs`」。

cdd-close SKILL.md 不需改 —— 它讀 agent-log 是給 archive.md 提取摘要用，YAML 只會更好讀（直接 `yaml.parse` 即可）。

## 6. CLI 與 migrate 工具更新

### 6.1 `cdd-kit migrate --to-yaml-logs [<change-id>|--all]`

擴充 `src/commands/migrate.ts` 既有 `migrateOne`：

新增子函式 `migrateAgentLogs(changeDir)`：
1. 列舉 `agent-log/*.md`。
2. 對每個檔，嘗試 `yaml.parse` frontmatter — 若已是 v1 → skip。
3. 否則呼叫 `parseLegacyAgentLog`（從新 parser 模組借）→ 得到結構化資料 → 序列化為 v1 frontmatter + 把原 markdown body 保留在後。
4. 寫入 `<file>.cdd-migrate.tmp` → atomic rename（沿用既有 `commitWritesAtomically`）。

舊備份機制（`.cdd/migrate-backup/<stamp>/`）自動覆蓋這次新增 — 不必重寫。

加 flag：
```
--to-yaml-logs       Migrate agent-log/*.md files to schema-version: agent-log/v1
--from-version <v>   Force re-migration (default: auto-detect)
```

`--all` 已存在，與本旗標可組合：`cdd-kit migrate --all --to-yaml-logs`。

### 6.2 新 CLI 子命令 `cdd-kit validate-log <path>`

讓 agent 在輸出前自驗（取代 prompt 內的 5 條 checklist）。實作 ~30 行：呼叫 `parseAgentLog` → 印 errors → exit 0/1。
這個一定要加，因為這是 agent prompt 「請自驗」段落能變短的唯一前提。

### 6.3 `cdd-kit doctor` 加一筆檢查

在 doctor 巡檢輸出新增「YAML log compliance: N legacy / M v1 / K invalid」一行，幫使用者目視看見遷移進度。低成本、高可見度。

## 7. 向後相容策略（critical：不能讓 in-flight change 一升級就壞）

### 7.1 三階段時間軸

| 階段 | 版本 | 行為 |
|---|---|---|
| Phase 1（本次釋出） | v1.17.0 | gate 同時接受 v1 與 legacy；legacy 在 non-strict 模式下 warning，strict 模式下 error。新建檔（cdd-new）一律 v1。 |
| Phase 2（v1.18.x） | v1.18.x | gate 對 legacy 預設 error（即使非 strict）；提供 `--accept-legacy-logs` flag 作緊急開關。 |
| Phase 3（v2.0.0） | v2.0.0 | 移除 legacy 解析路徑；遷移工具仍保留作為 archive 升級用。 |

Phase 1 → 2 至少間隔 4 週，期間透過 doctor 提示遷移。

### 7.2 archive 不強制遷移
`specs/archive/<year>/<id>/` 是冷資料，gate 從不掃描。archive 中的舊 agent-log **永遠不必遷移**。
但若使用者想統一格式，提供 `cdd-kit migrate --all --include-archive --to-yaml-logs` 作為一次性清理選項。

### 7.3 schema-version 缺失時的偵測順序
parser 看到 frontmatter 但 `schema-version` 缺失時：
1. 若 frontmatter 有 `agent` + `status` + `files-read` 三鍵 → 推測為「v1 但忘了寫 schema-version」→ warning 提示補上。
2. 否則視為 legacy。

這個 fallback 避免 LLM 漏寫 schema-version 就直接 fail。

## 8. 對其他子系統的影響

| 子系統 | 影響 | 處理 |
|---|---|---|
| `validate.ts` | 無直接影響（只跑 python 驗證器） | 不動 |
| python validators (`scripts/validate_*.py`) | 不解析 agent-log | 不動 |
| runtime hook (`.cdd/runtime/<id>-files-read.jsonl`) | 已是 JSONL；gate.ts L605-625 會比對 declared vs runtime | 比對邏輯不動，只把資料來源換成 `parsed.filesRead` |
| `archive.ts` | 只搬目錄不解析內容 | 不動 |
| `context-scan.ts` | 產 project-map / contracts-index，不碰 agent-log | 不動 |
| AGENTS.template.md / CODEX.template.md / CLAUDE.template.md | 提及格式的段落 | 全文搜尋 `files-read:` 或 `status:` 出現處，更新範例為 v1 |

## 9. 測試計畫（Sonnet 必須先寫測試再實作）

### 9.1 單元測試（`test/cli/agent-log-parser.test.ts` 新檔）
- v1 frontmatter 完整 happy path
- v1 缺 status → error 訊息含 `agent-log.status`
- v1 status 為 `done` → error 列出合法值
- v1 files-read 含 `..` → 拒絕並指該 index
- v1 artifacts 是 string 而非 list（schema 允許 test-output 為 string） → 接受
- legacy 格式 → format='legacy', errors=[]
- 完全空檔 → format='legacy', error: 'no parsable structure'
- frontmatter 是 YAML 但無 schema-version 且有 agent/status/files-read → warning + 視為 v1
- multi-doc YAML（含 `---` 在中間） → 只解第一段，其餘進 markdown body

### 9.2 整合測試（擴充 `test/cli/gate.test.ts`）
- 新增 `gate accepts v1 agent-log` 測試組（複製既有 happy path，改 fixture 為 v1）
- 新增 `gate warns on legacy agent-log in non-strict` 測試
- 新增 `gate errors on legacy agent-log in --strict`
- 新增 `gate routes schema error to file:path` 測試（驗錯誤訊息可被 cdd-new 的 fix-back routing table 抓到）

### 9.3 migrate 測試（擴充 `test/cli/migrate.test.ts`）
- legacy log → v1 後 yaml.parse 通過、原 markdown body 保留
- v1 log → migrate 跑兩次 idempotent，不修改檔
- 有壞掉的 legacy（缺 status）→ migrate 失敗、備份保留、原檔不動

### 9.4 文件測試（擴充 `test/cli/skill-prompts.test.ts`）
- agent-log-protocol.md 不再含舊範本字串 `## Required structure\n\n` 後接 markdown frame
- agent-log-protocol.md 含 `schema-version: agent-log/v1` 字串
- backend-engineer.md / qa-reviewer.md 至少含 `artifacts:` YAML 片段（取代散文 list）

## 10. 對 Sonnet implementer 的執行步驟（按順序，不要重排）

> **Sonnet 注意**：請完整跑完每一步、把該步驟的測試跑綠後再進下一步。每步都先讀現有檔再改，不要憑記憶。

### Step 1 — 建立基礎設施（純新增、零破壞）
1.1 `npm install yaml@^2.5.0 --save`
1.2 新增 `src/utils/agent-log-parser.ts`（介面同 §4.3）— 先寫骨架 + v1 解析；legacy 路徑 throw `not-yet-implemented`。
1.3 新增 `.claude/skills/contract-driven-delivery/references/schemas/agent-log-v1.json` 與 `tasks-v1.json`（欄位定義同 §3.1 與 §3.2）。
1.4 新增 `test/cli/agent-log-parser.test.ts`，先寫 v1 happy path + 兩條錯誤情境。跑紅 → 補實作 → 跑綠。

### Step 2 — 把 legacy 解析搬進新 parser（不動 gate.ts 行為）
2.1 把 `gate.ts` 內 `parseFilesRead` / `parseTaskFrontmatter` / `parseListField` 整段複製進 `agent-log-parser.ts` 與 `tasks-frontmatter-parser.ts`。
2.2 在 parser 內提供 `parseLegacy()` → 回 `{format:'legacy', ...}`。
2.3 補測試：legacy fixture（從現有 gate.test.ts 抓）→ 應通過 parseLegacy。
2.4 此時 gate.ts 仍用自己的舊 regex，沒人在用新 parser — 確認 `npm test` 全綠才進下一步。

### Step 3 — gate.ts 切換到新 parser
3.1 在 gate.ts 對 agent-log 段（L568-666）改為呼叫 `parseAgentLog`。
3.2 同段對 tasks.md frontmatter 改為呼叫 `parseTasksFrontmatter`。
3.3 移除 gate.ts 內 `parseFilesRead`、`parseTaskFrontmatter`、`parseListField`、`parseDependsOn`、`lintFrontmatter` 等區塊（保留 `parseListSection` — context-manifest 還在用）。
3.4 跑 `npm test`。預期既有所有測試仍綠（因為 parser 行為未變）。任何紅燈都是搬遷中漏抓的 case，修到綠為止。

### Step 4 — 新增 `--to-yaml-logs` migrate
4.1 在 `migrate.ts` 加 `migrateAgentLogs` 子函式 + flag。
4.2 寫 `test/cli/migrate.test.ts` 三條 case（§9.3）。
4.3 對 `specs/changes/yaml-migration-plan/` 自己做 dry-run 驗收（這個目錄沒有 agent-log，會 noop — 預期行為）。

### Step 5 — 新增 `cdd-kit validate-log` 與 doctor 檢查
5.1 新增 `src/commands/validate-log.ts` ~30 行。
5.2 在 `src/cli/index.ts` 註冊子命令。
5.3 doctor.ts 加一筆「YAML log compliance」掃描。
5.4 doctor.test.ts 補一條「掃到 0 legacy 0 invalid」的測試。

### Step 6 — 文件與 prompt 同步
6.1 改 `references/agent-log-protocol.md`（§5.1）。
6.2 對 16 個 agent prompt 套 §5.2 範本（用 sed/edit 不要 regex 全替換 — 每個 agent 的 required artifacts 不同）。
6.3 cdd-new / cdd-resume SKILL.md 套 §5.3 微調。
6.4 跑 `test/cli/skill-prompts.test.ts`。

### Step 7 — CHANGELOG / package.json / README
7.1 `package.json` 版號 → `1.17.0`。
7.2 CHANGELOG.md 加 `## 1.17.0` 段落，列：
   - feat(gate): YAML schema-versioned agent-log (agent-log/v1)
   - feat(migrate): `--to-yaml-logs` for legacy agent-log upgrade
   - feat(cli): `cdd-kit validate-log` for agent self-check
   - chore(prompts): replace agent-log markdown template with YAML schema reference
   - deprecate: legacy agent-log format (gate warns; remove in v2.0)
7.3 README.md 在「Resume / migrate」段補一句「v1.17 introduces YAML-frontmatter agent logs; run `cdd-kit migrate --to-yaml-logs` after upgrade」。

### Step 8 — 全量回歸
8.1 `npm run build` → 無錯。
8.2 `npm test` → 全綠。
8.3 在 `specs/changes/yaml-migration-plan/` 之外另開一個 sandbox（git worktree 或 temp repo），跑：
   - `cdd-kit init`
   - 手動造一個 legacy agent-log
   - `cdd-kit gate <id>` → 應 warning
   - `cdd-kit gate <id> --strict` → 應 error
   - `cdd-kit migrate <id> --to-yaml-logs` → 應升級
   - 再跑 `cdd-kit gate <id> --strict` → 應綠
8.4 所有檢查通過後再 commit；commit 訊息分 step 切（Step 1-2 一個 commit，Step 3 一個，Step 4-5 一個，Step 6 一個，Step 7-8 一個）—— 方便 review。

## 11. 風險與緩解

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| LLM 不熟 YAML literal block (`|`)，把 test-output 寫成 list | 中 | gate 報錯 → fix-back 重跑 agent | parser 在偵測到 test-output 是 list 時自動 join 為字串並 warn；agent prompt 直接給範例 |
| 既有 in-flight change 升級後 gate 突然 fail | 高 | 工作中斷 | Phase 1 用 warning-only；CHANGELOG 與 doctor 雙重提醒；migrate --all 一鍵升級 |
| 16 個 agent prompt 改錯一個 → 該 agent 產出格式不對 | 中 | 個別 agent log 進 fix-back loop | skill-prompts.test.ts 對每個 agent 補一條「含 artifacts: YAML 片段」斷言 |
| yaml lib bundle 大小增加 | 低 | dist 變大 ~50KB | 可接受；esbuild treeshake 後實際更小 |
| schema-version 缺失導致誤判 | 中 | legacy / v1 路徑走錯 | §7.3 fallback：有 v1 三大 key 就視為 v1 並 warn |

## 12. 驗收條件（gate for this migration plan）

實作完成等同滿足以下全部條件：
- [ ] `npm test` 全綠（含新增 ≥ 30 條測試）
- [ ] `npm run build` 無錯
- [ ] gate.ts 行數 < 350（從 ~700 壓回去）
- [ ] gate.ts 不含 `parseFilesRead` / `parseTaskFrontmatter` 字樣（移到 utils）
- [ ] `references/agent-log-protocol.md` 不再含舊「Required structure」markdown 範本，改為 schema 表
- [ ] `cdd-kit migrate --to-yaml-logs --all --dry-run` 在乾淨 repo 上回報 0 changes
- [ ] sandbox 場景（§Step 8.3）端到端通過
- [ ] CHANGELOG / package.json / README 同步
- [ ] 16 個 agent prompt 至少有 14 個含 `artifacts:` YAML 片段（兩個純讀 agent 例外可不寫）

## 13. 不在這個計畫內、但下一輪該做的（給 planner 留個尾巴）

- 若 v1.17 釋出後 4 週內 doctor 報告 < 5% legacy 殘留，可以在 v1.18 直接收緊（提早進 Phase 2）。
- 之後若想加 ajv 做 runtime 嚴格 schema 校驗，本次的 JSON schema 檔可以直接套，不必重寫。
- runtime hook 的 JSONL 也可以考慮升 schema-version；但與本次解耦。
