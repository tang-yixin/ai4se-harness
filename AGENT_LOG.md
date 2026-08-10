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
- [ ] Task 7: HITL 状态机
- [ ] Task 8: 范围围栏
- [ ] Task 9: 记忆管理
- [ ] Task 10: 决策指纹匹配器
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

Commit Hash: `0e9be4f`

