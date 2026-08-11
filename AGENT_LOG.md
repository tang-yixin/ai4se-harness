# Agent Log

> 按时间顺序记录关键节点。

---

## Phase 1: 规约与计划阶段

### 2026-08-05 ~ 08-06 — 需求讨论与 SPEC 设计

- 和 Claude Code（主 agent，deepseek-v4-pro 模型）反复讨论了 9 个模块的设计方案
- 核心决策：TypeScript + 治理护栏深度 + DeepSeek + npm/Docker 分发
- SPEC.md 定稿

### 2026-08-06 — PLAN.md 生成

- agent 根据 SPEC.md 拆解为 16 个 task (Task 0 ~ Task 15)
- 每个 task 含 TDD 步骤、文件列表、接口定义
- 依赖图合理，可并行组标注清楚

### 2026-08-06 — SPEC_PROCESS.md 冷启动验证

- 换了一个独立 agent 试跑 Task 1（LLM 抽象层）和 Task 4（工具系统）的部分步骤
- 验证结果记录在 SPEC_PROCESS.md
- Commit: `93cd473` — docs: add SPEC, PLAN, and SPEC_PROCESS from brainstorming phase

### 2026-08-06 — 最终 push

- 三份文档（SPEC + PLAN + SPEC_PROCESS）确认定稿
- Push 到 GitHub main 分支

---

## Phase 3: 实现阶段

> **格式说明**：每个 task 完成后记一条。以下为示例格式，实际内容在 task 完成后填写。

---

### 📋 Task N 示例（无错版）

时间：2026-08-07 15:00  
Task：Task 1 - LLM 抽象层  
分支：`task/1-llm-abstraction`  
做了什么：实现 LLMProvider 接口 + MockLLMProvider + DeepSeekProvider  
Commit Hash: `abc1234`

---

### 📋 Task N 示例（agent 出错版）


时间：2026-08-07 17:00  
Task：Task 4 - 工具系统  
分支：`task/4-tool-system`  
Agent做了什么：实现了 ToolRegistry + ToolDispatcher，但参数校验只写了 required 检查，漏了 type 检查。MockLLM history 忘了 push。  
我改了什么：
- 在 `ToolDispatcher.validateParams` 里补了 string/number 类型校验
- 在 `MockLLMProvider.complete()` 里补了 `this.history.push(...)`

教训：工具类的 task 要在 prompt 里明确列出所有校验维度（required + type + 范围），不然 agent 只会写最简单的 happy path  
Commit Hash: 

---

### 📋 Task N 示例（agent 完全搞错方向）

时间：2026-08-08 10:00  
Task：Task 12 - Agent 主循环  
分支：   
Agent做了什么：把主循环写成了一个递归函数，根本没有停机判断，LLM 的 tool_calls 被忽略直接跳过  
处理：放弃这个 subagent 的输出，重新写了一版 prompt，强调了"while 循环 + 显式 break 条件"，第二个 agent 产出合格  
教训：AgentLoop 这种核心模块，prompt 里必须把流程图附上。第一个 prompt 只给了文字描述，agent 根本没理解循环结构  
Commit Hash: 

---

### 📋 实现 checklist

- [x] Task 0: 项目脚手架与核心类型
- [x] Task 1: LLM 抽象层
- [x] Task 2: 配置加载器
- [x] Task 3: 凭据存储
- [x] Task 4: 工具系统（接口 + 注册 + 分发 + 黑名单）
- [x] Task 5: 5 个内置工具
- [x] Task 6: 护栏引擎
- [x] Task 7: HITL 状态机
- [x] Task 8: 范围围栏
- [x] Task 9: 记忆管理
- [x] Task 10: 决策指纹匹配器
- [ ] Task 11: 反馈闭环
- [ ] Task 12: Agent 主循环
- [ ] Task 13: CLI 入口
- [ ] Task 14: WebUI
- [ ] Task 15: 集成测试 + Docker + README

---

### 📋 Task 0 完成

时间：2026-08-10  
分支：`task/0-project-scaffold`  
做了什么：创建 package.json / tsconfig.json / vitest.config.ts / .harnessrc.json / src/core/types.ts，安装依赖，`npx tsc --noEmit` 零错误通过。纯脚手架 + 类型定义，无业务逻辑，一步到位。  
Commit Hash: `d49a7e7`

---

### 📋 Task 1 完成

时间：2026-08-10  
Task：Task 1 - LLM 抽象层  
分支：`task/1-llm-abstraction`  
做了什么：TDD 三步走（红→绿）实现 LLMProvider 接口 + MockLLMProvider + DeepSeekProvider，4 个测试全部通过，`npx tsc --noEmit` 零错误  

**代码 review 后改进：** `deepseek.ts` 中 JSON.parse 和网络异常原来被同一个 try-catch 兜底，无法区分"该重试"和"该让 LLM 重写"。改为两层独立 try-catch：网络错误 → `content: null`，JSON 解析失败 → `content: "[PARSE_ERROR] ...原始arguments..."`。上层 AgentLoop 后续可按 SPEC §3.1 差异化处理。

**改进时遇到的 bug：** 重构把 `.map()` 换成了 `for...of` 循环，OpenAI SDK v7 的 `ChatCompletionMessageToolCall` 是 discriminated union，`function` 属性不是所有变体都有，TS 直接报错 `Property 'function' does not exist`。修复：加了一层类型断言先尝试取 `function`，没有就 `continue` 跳过。SDK v4 → v7 的类型变化导致的，不影响运行时。

Commit Hash: `19929b6`

---

### 📋 Task 2 完成

时间：2026-08-10  
Task：Task 2 - 配置加载器  
分支：`task/2-config-loader`  
做了什么：TDD 实现 ConfigLoader，37 个测试覆盖加载/合并/校验/边界/错误路径，`npx tsc --noEmit` 零错误。

**实现要点：**
- `ConfigLoader.load(filePath?)` — 读取 `.harnessrc.json`，深度合并默认值，校验后返回 `HarnessConfig`
- 文件不存在 → 使用 `DEFAULTS`（不报错）；JSON 语法错误 → 抛出 `ConfigError`
- 校验维度：护栏规则结构（tool/pattern/action 必填 + action 合法值）、CheckDef 结构（name/command/signalPattern 必填）、所有正整数字段 > 0、contextThreshold ∈ [0,1]、所有正则字段合法可编译、LLM 字符串字段非空
- `deepMerge` 语义：对象递归合并、数组替换不拼接、null 值跳过回退默认值
- 每次 `load()` 通过 `structuredClone` 深拷贝 DEFAULTS，返回独立副本，用户修改不影响后续调用

**遇到的技术问题：**
- TypeScript 7 + `moduleResolution: "bundler"` 不会自动引入 `@types/node`，`import { readFileSync } from 'fs'` 无法解析。解决方案：文件顶部加 `/// <reference types="node" />` 三斜线指令。后续 task 中用到 Node 内置模块的源文件都需同样处理。
- `HarnessConfig` 接口缺少索引签名导致无法传给 `Record<string, unknown>` 参数，用 `as unknown as Record<string, unknown>` 类型断言桥接。

**代码 review 后改进：**
- `deepClone` 从 `JSON.parse(JSON.stringify(obj))` 改为 `structuredClone(obj)`，正确处理 `undefined`、`NaN` 等 JSON 无法序列化的值。一行改动，测试全部保持绿色。

Commit Hash: `4de3065`

---

### 📋 Task 3 完成

时间：2026-08-10  
Task：Task 3 - 凭据存储  
分支：`task/3-credential-store`  
做了什么：TDD 实现 CredentialStore —— PBKDF2 (100,000 轮, SHA-512) 密钥派生 + AES-256-GCM 认证加密，19 个测试全部通过，`npx tsc --noEmit` 零错误，无回归。

**实现要点：**
- `CredentialStore.save(apiKey, masterPassword, filePath?)` — 随机 salt + 随机 IV → PBKDF2 → AES-256-GCM 加密，JSON 落盘
- `CredentialStore.load(masterPassword, filePath?)` — 读取 → PBKDF2 → AES-256-GCM 解密，authTag 防篡改
- `CredentialStore.delete(filePath?)` — 幂等删除（文件不存在不抛异常）
- `CredentialStore.exists(filePath?)` — 同步存在检测
- `CredentialError` — 自定义错误类型（`name: 'CredentialError'`）
- 默认路径 `~/.ai4se-harness/credentials.enc`，使用 `path.join()` + `os.homedir()` 三级回退确保跨平台

**测试覆盖（19 个）：** 基本加解密、特殊字符、Unicode、超长 key (10000 字符)、错误密码、空 API key、空主密码、文件不存在、JSON 损坏、字段缺失、Base64 非法、覆盖保存、多次加载一致性、delete 幂等、CredentialError 类型检查。

**实现相比 PLAN 参考代码的改进：**
- 跨平台路径：`path.dirname()` + `path.join()` 替代 `lastIndexOf('/')` 字符串切割
- `mkdirSync` 顶部统一 import，而非方法内 `await import('fs')`
- 字段校验用 `Object.hasOwn()` 替代 truthiness 检查，正确处理空字符串

**代码 review 后改进：**
- Base64 校验原为 try/catch，但 Node.js 的 `Buffer.from(str, 'base64')` 遇到非法字符静默跳过不抛异常，catch 分支为死代码。改为正则 `/^[A-Za-z0-9+/]*={0,2}$/` 预检，确保非法 Base64 精确报出而非被解密步骤兜底为"密码错误"。
- `async` 标记内部全同步调用（`pbkdf2Sync`/`randomBytes`/`writeFileSync` 等）——PLAN 接口约定 `Promise<void>`，保持现状；未来性能敏感时可切换异步版 crypto。

Commit Hash: `e545490`

---

### 📋 Task 4 完成

时间：2026-08-10  
Task：Task 4 - 工具系统（接口 + 注册 + 分发 + 黑名单）  
分支：`task/4-tool-system`  
做了什么：TDD 实现 ToolRegistry + ToolDispatcher（含 JSON Schema 参数校验）+ Blacklist（含 GuardrailViolation 异常），34 个测试全部通过，`npx tsc --noEmit` 零错误，94 个存量测试无回归。

**实现要点：**
- `ToolRegistry` — Map 存储，register/get/list/toToolDefs，同名覆盖，空注册表安全
- `ToolDispatcher.dispatch()` — 四步流水线：查找工具 → JSON Schema 参数校验（required + string/number/boolean/array/object 六种类型）→ execute_shell 硬黑名单检查 → 执行。参数校验失败返回 `ExecutionResult`，黑名单命中抛出 `GuardrailViolation`
- `Blacklist` — 5 个禁止模式的纯正则匹配引擎（rm -rf / / format X: / shutdown|reboot|halt / dd if= / > /dev/sd），大小写不敏感，空/空白命令安全
- `GuardrailViolation` — 继承 Error，携带被拦截的 `command` 字段，供 Task 6 GuardrailEngine 精确 catch/透传

**代码 review 后的改进：**
1. **GuardrailViolation 异常** — 原实现黑名单命中返回 `ExecutionResult { success: false }`，调用方无法区分黑名单拦截 vs 参数校验失败。改为 dispatcher 抛出 `GuardrailViolation`，对齐 SPEC §3.3「命中即抛异常」的语义，同时为 Task 6 的 GuardrailEngine 提供显式契约。
2. **format 模式补全盘符** — `[c-zC-Z]` 实际不匹配 A/B 盘，改为 `[a-zA-Z]` 覆盖全部盘符，测试同步追加 `format A:` / `format B:` 用例。
3. **dd if= 模式保持 SPEC 原样** — 审核指出 `dd if=/dev/urandom of=/tmp/test` 无害却被拦截，但这是 SPEC 明文定义的「宁可误拦截不可漏过」策略，不改。

Commit Hash: `37c3a13`

---

### 📋 Task 5 完成

时间：2026-08-10  
Task：Task 5 - 5 个内置工具  
分支：`task/5-builtin-tools`  
做了什么：TDD 实现 list_directory / search_code / read_file / write_file / execute_shell + registerAllTools，46 个新测试 + 94 个存量测试共 140 全部通过，`npx tsc --noEmit` 零错误。

**实现要点：**
- 5 个工具全部实现 `Tool` 接口，riskHint 遵循 SPEC：读操作 low、写操作 medium、shell 执行 high
- `list_directory` — `readdirSync` + `withFileTypes`，条目前缀 `d`/`-` 区分目录/文件
- `search_code` — grep 搜索，自动排除 `node_modules`/`dist`/`.git`，grep 不可用时降级到 Windows findstr
- `read_file` / `write_file` — 标准文件 I/O，write 自动 `mkdirSync` 创建父目录
- `execute_shell` — `execSync` 封装，失败时保留 stdout/stderr/exitCode
- `registerAllTools(registry)` — 一键注册全部 5 个工具到 `ToolRegistry`

**测试覆盖（46 个）：** read_file (5)、write_file (8)、round-trip (3)、list_directory (5)、search_code (7)、execute_shell (8)、registerAllTools (6)、通过 ToolDispatcher 分发 (4)

**遇到的技术问题：**
- TS 7.x + `@types/node` 26.x 中 `ExecSyncOptions.shell` 从 `boolean` 改为 `string`，需传平台 shell 路径
- grep 默认搜索 `node_modules` 导致超时，添加 `--exclude-dir` 排除
- 测试搜索模式字符串在测试文件自身中出现导致误匹配，搜索路径从 `.` 改为 `src/`

**代码 review 后改进：**
1. `getDefaultShell()` 从两份重复定义提取到 `src/core/platform.ts`，消除 DRY
2. Windows 上优先检测 Git Bash 的 `bash.exe`（POSIX shell，单引号可阻止 `$()` 展开），降低 search_code 的 shell 注入风险
3. 测试辅助函数 `rmdirSync` → `rmSync`，消除 Node.js DEP0147 弃用警告

Commit Hash: `c075a57`

---

### 📋 Task 6 完成

时间：2026-08-10  
Task：Task 6 - 护栏引擎  
分支：`task/6-guardrails-engine`  
做了什么：TDD 实现 GuardrailEngine —— 第二层纵深防御的风险评估引擎，76 个新测试 + 140 个存量测试共 216 全部通过，`npx tsc --noEmit` 零错误。

**实现要点：**
- 两层评估架构：① 用户可配置规则（GuardrailRule[]，正则预编译，按顺序优先匹配）→ ② 内置启发式分类
- `assessRisk(toolName, params)` 返回 `{ level, action?, reason }`：
  - `level='low'` → 直接放行；`medium` → 记录日志后放行
  - `level='high'` + `action='deny'` → 拦截；`action='confirm'` → 进入 HITL
- **execute_shell 三级内置分类**：
  - 低风险（23 条）：`ls`, `cat`, `git status`, `git diff`, `npx vitest`, `npx tsc` 等纯读命令
  - 中风险（16 条）：`git add/commit`, `npm install`, `npm test`, `npm run build/test/lint` 等有副作用但安全的命令
  - 高风险+confirm（12 条）：`sudo`, `rm`, `mkfs`, `fdisk`, `parted`, `chmod`, `chown`, `git push`, `docker`, `systemctl`, `curl|bash`, `wget|bash`
- **write_file 内置分类**：系统目录检测（`/etc/`, `/var/`, `~/.ssh/` 等 12 个模式）+ 父目录穿越检测（Unix `../` + Windows `..\`）
- **其他工具**（read_file/list_directory/search_code）：始终 low
- 未识别命令保守策略 → 默认 `medium`，不盲目放行
- 跨工具规则隔离：execute_shell 规则不影响 write_file，反之亦然

**测试覆盖（76 个）：** PLAN 7 个基础测试 + 命令分类（23 low + 9 medium + 11 high）+ 路径分类（7）+ 边界条件（12）+ 跨工具隔离（2）+ 分类完整性（3）+ 规则优先级/空参数/超长命令/状态不累积等

**相比 PLAN 参考代码的改进：**
- PLAN 的 `defaultRisk('execute_shell')` 直接返回 `medium`，与测试 (`ls -la` → `low`) 矛盾；增加了完整的三级内置命令模式表解决
- PLAN 硬编码所有规则匹配返回 `level: 'high'`；本实现保持了正确的分层逻辑
- 新增了空命令/空路径防御、Windows 反斜杠穿越检测、mkfs/fdisk/parted 磁盘破坏命令检测
- `extractSearchableValue` 通过 `typeof` 做类型守卫，防御 params 中值类型不符的情况

**代码 review 后改进：**
1. `npm test` / `npm run test` 从 LOW 移至 MEDIUM —— 对齐 SPEC §3.3（npm test 会执行脚本，有副作用）
2. `TRAVERSAL_PATTERNS` 新增 `/\.\.\\/` 覆盖 Windows 反斜杠穿越（`..\..\..\windows\system32`）
3. HIGH_RISK 新增 `mkfs`/`fdisk`/`parted` 三条底层磁盘破坏命令

Commit Hash: `be797f2`

---

### 📋 Task 7 完成

时间：2026-08-10  
Task：Task 7 - HITL 状态机  
分支：`task/7-hitl-state-machine`  
做了什么：TDD 实现 HITLStateMachine —— 人机交互审批的有限状态机（WAITING → APPROVED/DENIED/TIMEOUT），39 个新测试 + 216 个存量测试共 255 全部通过，`npx tsc --noEmit` 零错误。

**实现要点：**
- 四个核心状态 + 五条转换路径：submit → WAITING；approve → APPROVED；deny → DENIED；checkTimeout → TIMEOUT
- `submit(request)` — 强制 status=WAITING + 刷新 createdAt，重复 ID 返回 false 防覆盖
- `approve(id)` / `deny(id)` — 仅对 WAITING 状态生效，已解析请求二次操作返回 false
- `checkTimeout()` — 遍历 pending，按 `(now - createdAt) >= timeoutSeconds*1000` 判定超时，幂等
- `getRequest(id)` — 双向查找（pending → history），WebUI 审批接口依赖此方法
- `getHistory()` — 按解析顺序保留已处理请求，支持审计追踪
- 两个可选回调：`onRequest`（新请求到达）、`onResolved`（请求被解析，含终态 status）

**测试覆盖（39 个）：** 初始状态 (2) + submit (6) + approve (7) + deny (6) + checkTimeout (7) + getRequest (4) + getPending/getHistory (2) + 综合场景 (3) + 状态不累积 + 空值 + 并发无关

**相比 PLAN 参考代码的改进：**
- 请求历史：已解析请求不丢弃，保留在 `history` 中供 `getRequest()` 查询和 `getHistory()` 审计
- `submit` 返回值 `boolean`：调用方可感知重复 ID 冲突并做相应处理
- 强制状态重置：`submit()` 总是将 status 覆写为 WAITING、刷新 createdAt，防御调用方传脏数据
- `getRequest(id)` 双向查找：先查 pending 再查 history，WebUI 轮询审批结果时无需额外状态存储
- 空 ID 防护：`getRequest('')` 直接返回 undefined，防止空字符串误匹配

Commit Hash: `f9314b5`

---

### 📋 Task 8 完成

时间：2026-08-10  
Task：Task 8 - 范围围栏（Scope Fence）  
分支：`task/8-scope-fence`  
做了什么：TDD 实现 ScopeFenceGuard —— 第三层纵深防御，工作区边界控制。40 个新测试 + 255 个存量测试共 295 全部通过，`npx tsc --noEmit` 零错误。

**实现要点：**
- `validatePath(path)` — 将目标路径以 workspaceRoot 为基准解析为绝对路径后，通过 `path.relative()` 判定是否在工作区内。支持 Unix `../` 和 Windows `..\` 两种父目录穿越检测 + Windows 跨盘符检测（`isAbsolute(rel)`）
- `validateHost(hostOrUrl)` — 从 URL/主机名中提取裸主机名（处理协议、端口、认证信息、路径、query），与白名单精确匹配。IPv6 去方括号处理。子域名不被父域名隐式允许
- 三个属性访问器：`getWorkspaceRoot()` / `getAllowedHosts()` / `getMaxShellTimeMs()`
- 空/空白输入统一拒绝

**测试覆盖（40 个）：** PLAN 6 个基础测试 + 边界（空值/纯空白/根目录）+ 越界尝试（深层穿越/跨盘符）+ Windows 路径兼容 + 主机格式（URL/端口/协议/子域名/IPv6）+ 多白名单 + 多次调用状态不累积 + 属性访问器

**代码 review 后改进：**
1. IPv6 方括号处理：`extractHostname` 中 `[::1]` 提取后去掉方括号变为 `::1`，匹配白名单中的无括号写法
2. 符号链接穿越：审计指出 `path.resolve()` 不追踪符号链接，判断为接受——GuardrailEngine（第二层）的系统目录检测可兜底

Commit Hash: `1dd42c9`

---

### 📋 Task 9 完成

时间：2026-08-10  
Task：Task 9 - 记忆管理  
分支：`task/9-memory-store`  
做了什么：TDD 实现 MemoryStore —— 三类记忆（项目记忆 / 决策记忆 / 会话记忆）的存储与检索，含 maxTokens 截断摘要生成和精确指纹匹配。37 个新测试 + 295 个存量测试共 332 全部通过，`npx tsc --noEmit` 零错误。

**实现要点：**
- 项目记忆 (`set`/`get`/`delete`/`clear`/`all`) — 基于 Map 的 key-value 存储，支持按 category 过滤
- `summarize()` — 按 updatedAt 降序排列，1 token ≈ 4 字符粗略估算，maxTokens 截断。maxTokens=0 时返回空字符串
- `recordDecision(record)` — 决策记录追加到数组，保留完整 DecisionRecord 字段
- `findDecision(toolName, fingerprint)` — 倒序精确匹配（工具名 + 命令指纹完全相同），返回最近匹配的副本
- `getAllDecisions()` — 返回决策数组的深拷贝，防止外部修改内部状态
- `shouldSummarize(round, tokenEstimate, contextWindowTokens?)` — 双轨触发判断（轮数 + token 阈值），接受外部 LLM 上下文窗口大小参数

**测试覆盖（37 个）：** PLAN 4 个基础测试 + 覆盖与删除 (4) + 摘要截断 (5) + 决策记录管理 (6) + 边界条件（空 key/value/超长值/大量条目/状态累积/返回副本）(14) + 配置参数与 shouldSummarize (8)

**相比 PLAN 参考代码的改进：**
- `all()` 返回新数组副本而非内部引用，防止外部意外修改
- `clear()` 同时清空 entries 和 decisions，PLAN 未定义此方法
- `delete(key)` 返回 boolean 指示是否成功删除
- `summarize()` 新增 `maxChars <= 0` 提前返回，避免零值输出非空摘要
- `findDecision()` 倒序查找 + 返回副本，调用方拿到独立数据
- `shouldSummarize()` 新增 `contextWindowTokens` 可选参数，解决 `memory.maxTokens` 被混用作 LLM 上下文窗口大小的问题

**代码 review 后改进：**
1. `shouldSummarize` 混用 `memory.maxTokens` 为上下文窗口大小 → 新增可选参数 `contextWindowTokens`，由调用方（AgentLoop）从 `llm.maxTokens` 传入，未传时回退到 `memory.maxTokens` 保持向后兼容
2. `recordDecision` 无重复检测 → reviewer 确认为设计提醒，不改（同一操作多次审批各自独立记录）

Commit Hash: `3e47f8b`

---

### 📋 Task 10 完成

时间：2026-08-11  
Task：Task 10 - 决策指纹匹配器  
分支：`task/10-decision-fingerprint`  
做了什么：TDD 实现 DecisionFingerprint —— 两级决策指纹匹配（精确匹配 + 模糊匹配），22 个新测试 + 332 个存量测试共 354 全部通过，`npx tsc --noEmit` 零错误。

**实现要点：**
- `DecisionFingerprint.match(store, toolName, commandFingerprint)` → `MatchResult { matched, level: 'exact'|'fuzzy'|'none', previousAction? }`
- **精确匹配** — 委托 `MemoryStore.findDecision()`（工具名 + 指纹完全相同），倒序优先返回最近决策
- **模糊匹配** — 遍历同工具名的所有历史决策，取最高相似度，≥ 阈值 0.6 返回 `level='fuzzy'`
- `calculateSimilarity(a, b)` — Dice 系数（基于字符 bigram），public static 可独立调用验证
- `toBigramSet(s)` — 将字符串拆分为连续两字符集合，含 `MAX_BIGRAM_INPUT_LENGTH = 10_000` 防御性截断

**测试覆盖（22 个）：** 精确匹配 (3) + 模糊匹配 (4) + 无匹配 (3) + 空输入/极端值 (5) + 状态累积 (1) + 相似度算法正确性 (5) + 超长字符串截断 (1)

**相比 PLAN 参考代码的设计变更：**
1. **相似度算法从 LCP 改为 Dice 系数** — PLAN 指定最长公共前缀，但 LCP 对中缀/后缀变异不敏感（如 `echo hello` vs `printf "hello"` 前缀不同 LCP≈0）。Dice 系数基于 bigram 交集，对所有位置的变异均有均匀区分度，是信息检索领域的标准度量。阈值 0.6 经手工验证合理。
2. **新增 `MAX_BIGRAM_INPUT_LENGTH` 截断** — 代码 review 指出超长字符串（如文件内容被误传为命令）会产生 ~N 个 bigram 对象，有理论内存压力。加 10,000 字符上限，对实际 shell 命令（极少超 1KB）零影响。

Commit Hash: `8f0198e`

