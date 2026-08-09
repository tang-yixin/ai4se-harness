# SPEC: AI4SE Coding Agent Harness

> Spec-Driven, Subagent-Built, Human-Owned.

---

## 一、问题陈述

### 要解决的问题

当前 LLM 编码智能体（如 Claude Code、Cursor、GitHub Copilot）提供强大的代码生成能力，但它们的 harness 层——主循环、工具分发、治理护栏、反馈闭环——被封闭在各自的实现中。一个开发者如果想理解"一个 coding agent 到底是怎么工作的"、或者想自己控制这些机制的行为，几乎没有可参考的轻量实现。

### 目标用户

- 学习 AI4SE 的学生和研究者，需要一个可读、可改、可测试的 agent harness 参考实现
- 想在自己的项目中嵌入可控 coding agent 的开发者

### 为什么值得做

Agent = LLM + Harness。LLM 负责"下一步做什么"的决策，但其余都是工程：封装、治理、反馈、安全、分发。这个项目把 harness 层拆开来，用**确定性代码**而非提示词实现每个核心机制，让学习者能看清一台 coding agent 机器的内部构造。

---

## 二、用户故事

| # | 用户故事 | INVEST 验证 |
|---|---------|-------------|
| 1 | 作为一个开发者，我希望能**安全地配置我的 API key**，确保凭据不会被硬编码进源码、不会被提交到 Git、不会出现在日志中 | Independent, Negotiable, Valuable, Estimable, Small, Testable |
| 2 | 作为一个开发者，我希望**用自然语言给 agent 分配一个 coding 任务**，让它自主地读文件、写代码、执行命令来完成任务 | Independent, Negotiable, Valuable, Estimable, Small, Testable |
| 3 | 作为一个开发者，我希望**危险操作在执行前被拦截并要求我审批**，这样 agent 不会意外删除文件或执行破坏性命令 | Independent, Negotiable, Valuable, Estimable, Small, Testable |
| 4 | 作为一个开发者，我希望 agent **自动从测试/lint/类型检查中获取反馈并据此自我修正**，而不是反复犯同样的错误 | Independent, Negotiable, Valuable, Estimable, Small, Testable |
| 5 | 作为一个开发者，我希望**自定义护栏规则**，让 harness 适应我项目的安全边界，而不是使用一套写死的规则 | Independent, Negotiable, Valuable, Estimable, Small, Testable |
| 6 | 作为一个开发者，我希望**通过 npm 一键安装 harness 并通过 Docker 在任意环境运行**，无需复杂的依赖配置 | Independent, Negotiable, Valuable, Estimable, Small, Testable |

---

## 三、功能规约

### 3.1 Agent 主循环

Agent 主循环是 harness 的核心引擎，负责驱动"上下文组装 → LLM 调用 → 解析 → 护栏 → 执行 → 反馈 → 停机判断"的完整闭环。

**流程：**

```
用户输入
  │
  ▼
┌─────────────────────────────────────────────────────┐
│                   Agent 主循环                       │
│                                                     │
│  ① 上下文组装（system prompt + 对话历史 + 记忆摘要）  │
│           │                                         │
│           ▼                                         │
│  ② LLM 调用（DeepSeek API via OpenAI SDK）          │
│           │                                         │
│           ▼                                         │
│  ③ 解析响应（提取 text / tool_calls）                │
│           │                                         │
│           ▼                                         │
│  ④ 护栏检查 ─┬─ 安全 ────→ ⑤ 工具执行               │
│              │                                        │
│              ├─ deny ────→ (拒绝，记入反馈)           │
│              │                  │                    │
│              │                  ▼                    │
│              │            ⑦ 停机判断                  │
│              │                                      │
│              └─ confirm ─→ ⏸ HITL 等待              │
│                              ├─ 通过 → ⑤ 工具执行    │
│                              ├─ 拒绝 → 跳过          │
│                              └─ 超时 → 跳过+警告     │
│                                   │                 │
│                                   ▼                 │
│  ⑥ 结果处理：                                       │
│     ⑥a. 信号提取 — 收集原始输出                      │
│     ⑥b. 失败分类 — 归类失败类型                      │
│     ⑥c. 回灌格式化 — 生成 LLM 可读的反馈文本         │
│           │                                         │
│           ▼                                         │
│  ⑦ 停机判断                                         │
│      ├─ 目标达成（测试全绿）→ 结束                   │
│      ├─ 强制终止（超轮数/deny/超时）→ 结束           │
│      ├─ 用户中断 → 结束                              │
│      └─ 继续 → 回到①                                 │
└─────────────────────────────────────────────────────┘
```

**输入：** 用户任务描述（自然语言字符串）

**行为：** 循环执行上述 7 个步骤，直到停机条件满足

**输出：** 任务完成状态 + 摘要（成功/失败/被拦截 + 执行轮数 + 修改的文件列表）

**边界条件：**
- 最大循环轮数可配置（默认 50 轮）
- 单次 LLM 调用超时（默认 60 秒）
- 上下文窗口接近上限时触发摘要压缩（阈值 80%）

**错误处理：**
- LLM 调用失败（网络/限流/服务端错误）→ 最多重试 3 次，指数退避，全部失败则终止
- LLM 返回不可解析的响应 → 将原始响应注入 context，请求 LLM 重新生成

### 3.2 工具系统

Agent 可执行以下 5 个内置工具：

| 工具 | 功能 | 参数 |
|------|------|------|
| `list_directory` | 列出目录内容 | `path: string` |
| `search_code` | 在代码库中搜索（grep） | `pattern: string`, `path?: string` |
| `read_file` | 读取文件内容 | `path: string` |
| `write_file` | 创建或覆盖文件 | `path: string`, `content: string` |
| `execute_shell` | 执行 shell 命令 | `command: string`, `cwd?: string` |

**工具注册机制：** 每个工具实现 `Tool` 接口，注册到全局 `ToolRegistry`。新增工具只需实现接口并注册。

**参数校验：** 工具分发器在调用 `execute()` 前，用 JSON Schema 确定性校验参数，不依赖 LLM 自觉提供正确参数。校验失败直接返回错误，不进入执行。

**执行流程：**
```
LLM 响应中的 tool_calls
  → ToolDispatcher
    → 1. 按 name 匹配 Registry
    → 2. JSON Schema 参数校验（确定性）
    → 3. 提交给护栏引擎评估风险
    → 4. 放行后调用 tool.execute()
```

### 3.3 护栏引擎（深度维度）

护栏是三层纵深防御体系：

**第一层：工具内置硬黑名单**

`execute_shell` 内部维护禁止模式的 regex 列表：

```
/rm\s+-rf\s+\//
/format\s+[c-zC-Z]:/
/shutdown|reboot|halt/
/dd\s+if=/
/>\s*\/dev\/sd/
```

命中即抛 `GuardrailViolation` 异常，不进 LLM 上下文，直接终止当前动作。这是机械锁，不依赖任何智能判断。

**第二层：动态风险评估 + HITL 状态机**

`assessRisk(toolName, params) → RiskLevel` 根据规则表动态判定：

| 工具 | 条件 | 判定 |
|------|------|------|
| `execute_shell` | `ls`, `cat`, `echo` 等纯读命令 | `low` |
| `execute_shell` | `npm test`, `git status` 等 | `medium` |
| `execute_shell` | `sudo`, `curl \| bash`, `git push` 等 | `confirm` |
| `write_file` | 目标路径在 `workspaceRoot` 内 | `low` |
| `write_file` | 目标路径在 `workspaceRoot` 外（如 `../`）| `confirm` |
| `write_file` | 目标路径为系统目录（`/etc`, `~/.ssh`） | `high` |

`low` = 直接放行；`medium` = 记录日志后放行；`confirm` = 进入 HITL；`high` = 进入 HITL。

HITL 状态机：
```
IDLE → WAITING → APPROVED → 执行
              → DENIED   → 拒绝+反馈
              → TIMEOUT  → 跳过+警告（默认 60 秒超时）
```

**第三层：范围围栏（Scope Fence）**

应用启动时声明工作区边界：
```json
{
  "workspaceRoot": ".",
  "allowedHosts": ["github.com"],
  "maxShellTimeMs": 30000
}
```

- 所有 `write_file` 操作校验路径是否在 `workspaceRoot` 下，否则拒绝
- `execute_shell` 中检测到对非白名单主机的网络请求（`curl`/`wget`），触发 confirm

**规则可配置：** 护栏规则表不是硬编码的，而是从 `.harnessrc.json` 加载。规则引擎是确定性的代码，具体规则是用户可编辑的数据。

**HITL 审批通道：**
- **交互模式**：CLI 终端直接弹出确认提示 `⚠️ 危险操作: [详情] (A)pprove / (D)eny?`
- **自动化模式**：WebUI（`localhost:3099`）提供 HTTP 审批接口（`POST /hitl/:id/approve`、`POST /hitl/:id/deny`）+ SSE 实时推送

### 3.4 反馈闭环

反馈闭环回答：agent 怎么确定性地知道自己做对了还是做错了？

**信号来源：**
- `checks` 命令的输出（测试结果、类型检查、lint）
- 工具执行的 exit code
- 护栏拒绝判定

**处理流水线：**

```
工具执行结果 → ⑥a 信号提取 → ⑥b 失败分类 → ⑥c 回灌格式化 → 注入①
```

**⑥a 信号提取器（Signal Extractor）：** 纯字符串解析，不调 LLM：
- `exitCode !== 0` → 标记为 failure
- stdout 含 `FAIL` / `error TS` / `warning` → 按模式分类
- 否则 → success

**⑥b 失败分类器（Failure Classifier）：** 确定性归类：
- `TEST_FAILURE` → 建议修复代码逻辑
- `TYPE_ERROR` → 建议修正类型标注
- `LINT_ERROR` → 建议格式化
- `SHELL_ERROR` → 建议检查命令
- `GUARDRAIL_DENY` → 建议换一种方式
- `UNKNOWN_FAILURE` → 建议检查原始输出，人工判断（兜底，防止看不懂的失败被标为成功）

**⑥c 回灌格式化（Feedback Formatter）：** 生成 LLM 可读的结构化反馈文本：
- 成功：`"✓ write_file(src/index.ts) 执行成功，文件已写入。"`
- 失败：`"✗ run_test 失败。类型: TEST_FAILURE。3/5 tests failed。建议修复 src/parser.ts 的断言逻辑。"`

**自动 Check 机制：** 每轮工具执行后，AgentLoop 自动运行 `.harnessrc.json` 中 `feedback.checks` 定义的命令（如 `npx tsc --noEmit`、`npm test`），收集输出交给反馈提取器。不通过 LLM 主动调用——检查是自动化的，agent 只看结果。

**Checks 依赖容错：** checks 命令取决于目标项目的工具链配置。如果目标项目未安装对应工具（如 `npx tsc` 不可用），自动跳过该 check 并记录一条 info 日志（如 `[info] typecheck skipped: tsc not available`），而非将其视为 FAIL。这避免了 agent 因目标项目未装 TypeScript 而每轮都收到假阳性失败反馈。

**自动重试：** 反馈结果允许后，如果 `autoFix: true`，LLM 收到失败反馈后自动尝试修复（最多 `maxRetries` 次，默认 3）。

### 3.5 记忆系统

三类记忆，不做向量检索，走简单摘要 + 规则匹配：

| 类型 | 存储内容 | 存储位置 | 检索方式 |
|------|---------|----------|----------|
| 会话记忆 | 当前会话的对话历史 | 内存数组 | 直接拼接进 context |
| 项目记忆 | 项目约定、代码风格 | `.harness-memory.json` | 启动时加载（maxTokens 截断） |
| 决策记忆 | 用户的历史审批决策 | `.harness-decisions.json` | 护栏查询（两级指纹匹配） |

**会话记忆压缩：** 双轨触发——每 10 轮自动触发 + token 估算超 80% 窗口强制触发。摘要由 harness 自己的 LLM 抽象层生成，不引入第二条调用路径。

**决策指纹匹配：**
- **精确匹配**：工具名 + 命令完全相同 → 复用历史决策，跳过 HITL
- **模糊匹配**：工具名相同 + 命令相似度 > 阈值 → 仍走 HITL，但降一级（high→medium）
- **无匹配**：走标准风险评估流程

**项目记忆截断：** 加载 `.harness-memory.json` 时按 `maxTokens` 限制截断，优先保留最近条目，旧的只保留标题。

### 3.6 配置系统

配置文件 `.harnessrc.json`，首次运行时自动生成带注释的模板。

**配置结构：**
```jsonc
{
  "llm": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "baseURL": "https://api.deepseek.com/v1",
    "maxTokens": 4096
  },
  "guardrails": {
    "rules": [
      { "tool": "execute_shell", "pattern": "sudo.*", "action": "confirm" },
      { "tool": "execute_shell", "pattern": "(curl|wget).*\\|.*(bash|sh)", "action": "deny" },
      { "tool": "write_file", "pattern": "\\.\\.\\/", "action": "confirm" },
      { "tool": "write_file", "pattern": "^\\/(etc|var|tmp)\\/", "action": "confirm" }
    ],
    "hitlTimeoutSeconds": 60
  },
  "scope": {
    "workspaceRoot": ".",
    "allowedHosts": ["github.com"],
    "maxShellTimeMs": 30000
  },
  "memory": {
    "maxTokens": 2000,
    "summaryInterval": 10,
    "contextThreshold": 0.8
  },
  "feedback": {
    "autoFix": true,
    "maxRetries": 3,
    "checks": [
      { "name": "typecheck", "command": "npx tsc --noEmit", "signalPattern": "error TS" },
      { "name": "lint", "command": "npx eslint --format compact", "signalPattern": "error\\b|warning\\b" },
      { "name": "test", "command": "npm test", "signalPattern": "FAIL|passing" }
    ]
  }
}
```

**配置加载流程：**
1. 启动时读取 `./.harnessrc.json`
2. 对每个字段做类型和合法性校验（正则是否有效、maxTokens 是否为正整数等）
3. 缺失的字段合并默认值
4. 配置错误在启动时报错退出，不带到运行时

---

## 四、非功能性需求

### 4.1 性能

- 主循环单轮延迟（不含 LLM 网络调用）< 10ms
- CLI 启动到可交互 < 500ms
- 记忆文件读写 < 50ms（文件 < 100KB 时）

### 4.2 安全 —— 凭据威胁模型

**威胁模型：**
| 威胁 | 对策 |
|------|------|
| API key 硬编码在源码中 | 代码中不出现任何 key 字面量，全部从 `CredentialStore` 获取 |
| API key 被提交到 Git | `credentials.enc` 已在 `.gitignore` 中；`git-secrets` 或 pre-commit hook 扫描 |
| API key 出现在日志/终端输出中 | 日志模块在输出前过滤 key 模式（`sk-...` / `deepseek-...`） |
| 加密文件被窃取 | AES-256-GCM 认证加密，无主密码无法解密 |
| 主密码被暴力破解 | PBKDF2 100,000 轮迭代 |
| 进程内存 dump 泄露 key | ⚠️ 本项目不防内存 dump（明文 key 在进程内存中，操作系统级攻击面） |
| `.env` 文件泄露 | 本项目不使用 `.env` 文件存 key（env 变量是明文，且 `export` 进 shell history） |

**安全边界声明：** 本项目假设操作系统用户空间是可信的。不防御内核级攻击、硬件 keylogger、或物理访问。

### 4.3 可用性

- 首次运行自动引导凭据录入（`harness setup`）
- 配置有合理默认值，零配置可运行
- 错误消息包含明确的修复建议（如 "护栏规则第 3 条的正则表达式无效: ..."）

### 4.4 可观测性

- 每轮循环输出：当前轮数、LLM 决策摘要、工具调用和结果
- 可配置日志级别（`debug` / `info` / `warn` / `error`）
- CLI 输出使用颜色区分：信息（白色）、成功（绿色）、警告（黄色）、错误（红色）、HITL（闪烁）

---

## 五、系统架构

### 5.1 组件图

```
┌──────────────────────────────────────────────────────────┐
│                      用户接口层                           │
│   ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│   │ CLI 入口 │  │  WebUI   │  │ 配置命令(status/      │   │
│   │(交互模式)│  │(仪表盘)  │  │ update/delete/setup)  │   │
│   └────┬─────┘  └────┬─────┘  └──────────┬───────────┘   │
│        └──────────────┼──────────────────┘               │
│                       ▼                                   │
│              Agent 主循环 (AgentLoop)                      │
│   ┌────────────────────────────────────────────────────┐  │
│   │  ①上下文组装 → ②LLM调用 → ③解析响应 →             │  │
│   │  ④护栏检查 → ⑤工具执行 → ⑥结果处理 → ⑦停机判断   │  │
│   ├────────────────────────────────────────────────────┤  │
│   │  ⑥a 信号提取 → ⑥b 失败分类 → ⑥c 回灌格式化       │  │
│   └────────────────────────────────────────────────────┘  │
│                                                           │
│   ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────────┐  │
│   │ 工具注册 │ │ 护栏引擎│ │ 记忆管理 │ │ 配置加载器   │  │
│   │(Registry│ │(深度)   │ │(Memory)  │ │(ConfigLoader)│  │
│   │+Dispatcher)│         │ │          │ │              │  │
│   └────┬─────┘ └────┬────┘ └────┬─────┘ └──────┬───────┘  │
│        └────────────┼───────────┼──────────────┘          │
│                     ▼           ▼                          │
│             LLMProvider      CredentialStore               │
│            (接口+实现)       (加密文件+主密码)              │
└──────────────────────────────────────────────────────────┘
```

### 5.2 数据流

```
用户输入 → CLI 解析 → AgentLoop.run(task)
  → 每轮循环:
    ① MemoryStore.get() + 对话历史 → messages[]
    ② LLMProvider.complete(messages, tools) → LLMResponse
    ③ ResponseParser.parse(LLMResponse) → Instruction[]
    ④ GuardrailEngine.assessRisk(instruction) → RiskLevel
       ├─ deny → 记入反馈
       ├─ confirm → HITLStateMachine.wait() → APPROVED/DENIED/TIMEOUT
       └─ safe → ToolDispatcher.dispatch(instruction)
            → tool.execute(params) → ExecutionResult
    ⑤ CheckRunner.run(checks[]) → CheckResult[]
    ⑥ FeedbackPipeline.process(ExecutionResult + CheckResult[]) → Feedback
    ⑦ StopJudge.shouldStop(state) → boolean
  → 返回 FinalResult
```

### 5.3 外部依赖

| 依赖 | 用途 | 备选方案 |
|------|------|----------|
| DeepSeek API (`api.deepseek.com`) | LLM 推理 | 可切换至 OpenAI API（同 SDK） |
| OpenAI Node.js SDK (`openai`) | LLM API 调用 | 无（核心依赖） |
| Node.js `crypto` 模块 | AES-256-GCM 加解密 | 无（标准库） |
| `commander.js` | CLI 参数解析 | `yargs` |
| `express` | WebUI HTTP 服务 | 无（轻量够用） |

### 5.4 源代码包结构

```
ai4se-harness/
├── src/
│   ├── core/                  # 主循环
│   │   ├── agent-loop.ts      #   AgentLoop（7 步骤）
│   │   └── types.ts           #   核心类型定义
│   ├── llm/                   # LLM 抽象层
│   │   ├── provider.ts        #   LLMProvider 接口
│   │   ├── deepseek.ts        #   DeepSeekProvider
│   │   └── mock.ts            #   MockLLMProvider（含 history）
│   ├── tools/                 # 工具系统
│   │   ├── registry.ts        #   工具注册表
│   │   ├── dispatcher.ts      #   工具分发器 + 参数校验
│   │   ├── blacklist.ts       #   硬黑名单
│   │   └── builtin/           #   5 个内置工具
│   │       ├── list-directory.ts
│   │       ├── search-code.ts
│   │       ├── read-file.ts
│   │       ├── write-file.ts
│   │       └── execute-shell.ts
│   ├── guardrails/            # 护栏引擎（深度维度）
│   │   ├── engine.ts          #   assessRisk() + 规则匹配
│   │   ├── hitl.ts            #   HITL 状态机
│   │   ├── scope-fence.ts     #   范围围栏
│   │   └── fingerprint.ts     #   决策指纹匹配
│   ├── memory/                # 记忆管理
│   │   ├── store.ts           #   记忆读写 + maxTokens 截断
│   │   └── summarizer.ts      #   摘要器（调 LLM）
│   ├── feedback/              # 反馈闭环
│   │   ├── extractor.ts       #   ⑥a 信号提取
│   │   ├── classifier.ts      #   ⑥b 失败分类
│   │   └── formatter.ts       #   ⑥c 回灌格式化
│   ├── config/                # 配置
│   │   └── loader.ts          #   ConfigLoader（读取+校验+默认值）
│   ├── credentials/           # 凭据
│   │   └── store.ts           #   CredentialStore（PBKDF2 + AES-256-GCM）
│   ├── cli/                   # CLI 入口
│   │   └── index.ts           #   commander.js 入口
│   └── web/                   # WebUI（轻量仪表盘）
│       └── server.ts          #   Express + SSE
├── tests/
│   ├── unit/                  # 单元测试（mock LLM，零网络依赖）
│   │   ├── agent-loop.test.ts
│   │   ├── guardrails.test.ts
│   │   ├── feedback.test.ts
│   │   ├── tools.test.ts
│   │   ├── memory.test.ts
│   │   └── credentials.test.ts
│   └── integration/           # 集成测试（需 DeepSeek API key）
│       └── harness.test.ts
├── package.json
├── .harnessrc.json            # 默认配置模板
├── Dockerfile
└── README.md
```

---

## 六、领域与机制设计

> 本节为 Coding Agent Harness 项目（A）的额外 SPEC 要求（§A.5）。

### 6.1 领域分析：Coding 场景

**反馈信号：**
- 测试套件结果（pass/fail 计数）——客观、确定、可解析
- 类型检查错误（`tsc --noEmit` 输出）——确定性强、按行号精确定位
- Lint 警告/错误——标准化输出格式
- 命令退出码（exit code）——操作系统级确定性信号

**危险动作：**
- 破坏性 shell 命令（`rm -rf`、`format`、`shutdown`）
- 文件写入工作区外（`/etc/hosts`、`~/.ssh/config`）
- 管道注入（`curl ... | bash`）
- 权限提升（`sudo`）
- 外发网络请求（`curl` 非白名单地址、`git push`）

**所需工具：** 5 个内置工具覆盖 coding 闭环——`list_directory`（发现）、`search_code`（搜索）、`read_file`（理解）、`write_file`（修改）、`execute_shell`（执行）。

**记忆需求：** 项目约定（代码风格、测试框架选择）、用户审批偏好（哪些操作用户习惯性批准）、对话上下文管理（什么需要跨轮保留）。

### 6.2 重点维度：治理护栏

**为什么选治理护栏：**
- 护栏的每个决策（放行/拦截/审批）都是确定性的 if-else 逻辑，天然适合"机制必须是代码"的要求
- 三层纵深防御（硬黑名单 → 动态规则 → 范围围栏）是典型的工程纵深设计
- HITL 状态机的状态转换路径确定，每一条都可以用 mock 测试完整覆盖
- 护栏是"LLM 的不可靠性"与"操作系统的不可逆性"之间的唯一防线——它最能体现 harness 的价值

**编码实现方式：**
- `blacklist.ts`：正则匹配引擎，纯字符串处理，无 LLM 依赖
- `engine.ts`：规则表加载 + `assessRisk()` 判定函数，规则是配置数据，引擎是代码
- `hitl.ts`：有限状态机（4 状态 × 5 转换），每个转换路径可独立单元测试
- `scope-fence.ts`：路径前缀校验 + 主机白名单比对，纯确定性逻辑
- `fingerprint.ts`：两级匹配（精确 + 模糊），字符串相似度算法

### 6.3 各维度"可独立测试"说明

| 维度 | 如何用 mock LLM 做确定性单元测试 |
|------|-------------------------------|
| 主循环 | 注入 `MockLLMProvider` 的预设响应队列，断言循环轮数、最终状态、回灌内容 |
| 工具分发 | 构造 `ToolCall` 对象，直接调用 `ToolDispatcher.dispatch()`，断言分发结果 |
| 护栏引擎 | 构造各种 `(toolName, params)` 组合，断言 `assessRisk()` 的返回值和 HITL 状态迁移 |
| 反馈闭环 | 注入已知的 stdout/stderr 字符串，断言信号类型和失败分类 |
| 记忆管理 | 直接调用 `MemoryStore` 的读写接口，断言存储/检索/截断行为 |
| 配置加载 | 提供有效/无效的 JSON 文件，断言加载成功/失败、默认值合并 |

---

## 七、数据模型

### 核心实体

**Message：**
```
{
  role: "system" | "user" | "assistant" | "tool",
  content: string,
  toolCallId?: string,
  name?: string
}
```

**ToolCall：**
```
{
  id: string,
  name: string,           // 工具名（对应 ToolRegistry）
  arguments: Record<string, unknown>  // 经 JSON Schema 校验后的参数
}
```

**LLMResponse：**
```
{
  content: string | null,
  toolCalls: ToolCall[],
  finishReason: "stop" | "tool_calls" | "length" | "error",
  usage: { promptTokens: number, completionTokens: number }
}
```

**GuardrailRule：**
```
{
  tool: string,           // 工具名
  pattern: string,        // 正则表达式
  action: "deny" | "confirm"
}
```

**HITLRequest：**
```
{
  id: string,
  toolName: string,
  params: Record<string, unknown>,
  risk: "medium" | "high",
  status: "WAITING" | "APPROVED" | "DENIED" | "TIMEOUT",
  createdAt: number,
  timeoutSeconds: number
}
```

**MemoryEntry：**
```
{
  key: string,
  value: string,
  category: "project" | "decision",
  updatedAt: number
}
```

**CredentialData（落盘前加密）：**
```
{
  provider: "deepseek",
  encryptedKey: string,   // AES-256-GCM 密文（Base64）
  salt: string,           // PBKDF2 salt（Base64）
  iv: string,             // AES IV（Base64）
  authTag: string         // GCM 认证标签（Base64）
}
```

### 状态变量（主循环运行时）

```
{
  sessionId: string,
  task: string,               // 用户原始任务
  messages: Message[],        // 对话历史
  round: number,              // 当前轮数
  hitlQueue: HITLRequest[],   // 待审批队列
  history: {                  // 执行历史
    toolCalls: { tool: string, params: unknown, result: string }[],
    errors: { type: string, message: string }[]
  },
  phase: "idle" | "running" | "waiting_hitl" | "completed" | "error"
}
```

---

## 八、凭据与分发设计

### 8.1 凭据存储方案

**方案：** AES-256-GCM 加密文件 + 主密码

**存储位置：** `~/.ai4se-harness/credentials.enc`

**加密流程：**
1. 用户输入 DeepSeek API key（隐藏回显）
2. 用户设置主密码（隐藏回显，需确认）
3. 主密码 → PBKDF2（100,000 轮，随机 salt）→ 派生 256-bit 密钥
4. API key → AES-256-GCM 加密（随机 IV）→ 密文 + salt + IV + authTag 写入文件
5. 明文 key 仅保留在进程内存中，不落盘

**解密流程（后续启动）：**
1. 读取 `credentials.enc`
2. 提示输入主密码（隐藏回显）
3. 主密码 + salt → PBKDF2 派生密钥 → AES-256-GCM 解密
4. 密码错误 → 最多 3 次重试 → 退出

**CLI 凭据命令：**

| 命令 | 功能 |
|------|------|
| `harness setup` | 引导式首次配置（录入 key + 设主密码 + 生成默认配置） |
| `harness key status` | 显示 `DeepSeek API key: (configured)`（不暴露任何明文或尾部字符） |
| `harness key update` | 更新已存储的 key（先验证旧主密码） |
| `harness key delete` | 删除 `credentials.enc` + 清空内存中的 key |

### 8.2 分发方案

**主方案：npm 包**

```bash
npm install -g ai4se-harness
harness setup    # 配置 DeepSeek API key
harness run "用 TypeScript 写一个快速排序函数"
```

`package.json` 中加入 `"bin"` 字段，`npm install -g` 后 `harness` 命令全局可用。

**辅方案：Docker 容器**

```bash
docker build -t ai4se-harness https://github.com/tang-yixin/ai4se-harness.git
docker run -it --rm -v $(pwd):/workspace ai4se-harness run "你的任务"
```

`docker run` 时需要挂载工作目录（`-v`），并通过环境变量或交互输入传递 API key。

**不采用方案：** 原生二进制。TypeScript 项目打包为二进制（`bun build --compile` 或 `pkg`）在做 shell 执行和文件路径解析时容易出现平台相关的奇怪问题，调试成本高且不增加工程深度。

### 8.3 目标机器 Key 配置方式

- **npm 安装**：执行 `harness setup`，交互式引导录入（隐藏输入），生成 `~/.ai4se-harness/credentials.enc`
- **Docker 运行**：通过 `-e DEEPSEEK_API_KEY=sk-...` 环境变量传入（环境变量有明文风险，Docker 内运行相对隔离），或容器内执行 `harness setup` 交互录入

### 8.4 已知限制

- 仅支持 DeepSeek API 作为 LLM 后端（OpenAI 兼容协议，切换供应商成本低）
- 仅支持 Windows / macOS / Linux（需 Node.js ≥ 18）
- Docker 镜像基于 `node:22-alpine`，体积约 200MB
- 当前版本仅支持单会话，不支持多个 agent 同时运行

---

## 九、技术选型与理由

| 项 | 选型 | 理由 |
|----|------|------|
| 语言 | TypeScript | 静态类型在 TDD + subagent 迭代中提供编译期错误捕捉；全栈统一（CLI + WebUI 同一语言）；对 AI 生成的代码有更好的接口约束 |
| 运行时 | Node.js ≥ 18 | LTS 版本，生态成熟 |
| LLM SDK | OpenAI SDK (`openai` npm 包) | DeepSeek API 与 OpenAI 兼容，通过设置 `baseURL` 接入；AI 对此 SDK 的代码生成最准确 |
| LLM 模型 | DeepSeek Chat | 成本低、tool calling 支持、中文友好 |
| CLI 框架 | `commander.js` | 轻量、TypeScript 类型支持好、社区成熟 |
| WebUI | Express + SSE | 轻量（不做 SPA）、SSE 天然适合实时状态推送 |
| 加密 | Node.js `crypto` 模块（AES-256-GCM + PBKDF2） | 标准库无额外依赖、算法选择符合工业标准 |
| 测试框架 | Vitest | 原生 ESM + TypeScript 支持、与 Vite 生态一致、速度快 |
| CI/CD | GitHub Actions | 免费额度、与 GitHub 仓库深度集成 |
| 部署 | 任选 Vercel / Railway（学生免费额度） | WebUI 仅需轻量 HTTP 服务，无数据库 |
| 分发 | npm（主）+ Docker（辅） | npm 面向 TS/JS 开发者最自然；Docker 兜底任意环境 |

---

## 十、验收标准

| # | 功能 | "完成"的客观判定标准 |
|---|------|---------------------|
| 1 | 凭据安全存储 | `harness setup` 引导录入 → 生成 `credentials.enc` → `harness key status` 显示 `(configured)` → 源码中无 key 字面量 → Git 历史中无凭据 |
| 2 | Agent 主循环 | 在 mock LLM 下执行一次完整 3 轮循环 → `expect(mockLLM.history.length).toBe(3)` → agent 最终返回完成状态 |
| 3 | 工具系统 | 5 个工具全部注册 → JSON Schema 校验拒绝非法参数 → `execute_shell("ls")` 正确返回 stdout |
| 4 | 护栏硬黑名单 | `execute_shell("rm -rf /")` → 抛出 `GuardrailViolation` → 未执行 |
| 5 | HITL 审批 | `write_file("/etc/hosts")` → 触发 HITL → `POST /hitl/:id/approve` → 执行成功 |
| 6 | 反馈闭环 | 注入 `"FAIL: 3/5 tests"` → 分类为 `TEST_FAILURE` → agent 下一轮消息中看到反馈文本 |
| 7 | 配置加载 | 删除 `.harnessrc.json` → 使用默认配置运行 → 配置错误（如无效正则）→ 启动时报错退出 |
| 8 | 一键测试 | `npm test` 或 `make test` 运行全部单元测试且全绿（零网络依赖） |
| 9 | CI pass | GitHub Actions 中 `unit-test` job 通过 |
| 10 | WebUI 可访问 | `localhost:3099/status` 返回当前会话状态 JSON |
| 11 | npm 安装 | `npm install -g` 后 `harness --version` 输出版本号 |
| 12 | Docker 运行 | `docker run ai4se-harness --version` 输出版本号 |

---

## 十一、风险与未决问题

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| DeepSeek API 的 tool calling 行为与 OpenAI 有细微差异 | LLM 响应解析失败 | 在 `DeepSeekProvider` 中做响应格式归一化；保留原始响应用于调试 |
| 护栏规则的正则表达式被 LLM 学会绕过 | 危险命令可能不被拦截 | 多层防御（硬黑名单 + 规则引擎 + 范围围栏），不依赖单一机制 |
| 对话摘要质量不高导致 agent 丢失上下文 | agent 行为偏离任务目标 | 摘要 prompt 精心设计；保留最近 N 轮完整对话不被压缩 |
| `npm install -g` 在不同平台的行为不一致 | 用户安装失败 | Docker 方案兜底；README 写清晰的前提条件（Node.js ≥ 18） |
| 主密码遗忘 | key 永久不可恢复 | README 安全边界说明中明确警告；建议用户自己备份 key |
| TypeScript 7.x（刚安装的版本）可能存在不兼容 | 编译或运行错误 | 锁定 `package.json` 中的 `typescript` 版本；CI 中测试多个 TS 版本 |

---

> 本文档由 brainstorming 过程驱动，记录了从模糊想法到精确设计的完整路径。所有设计决策均有明确理由，所有机制均有确定的测试策略。SPEC 完成并通过冷启动验证后，方可进入 PLAN 阶段。
