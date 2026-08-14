# AI4SE Coding Agent Harness

一个用 **确定性代码**（而非提示词）实现的轻量 coding agent harness。它把「LLM 只负责下一步做什么」之外的工程——主循环、工具分发、治理护栏、反馈闭环、凭据安全——拆开摊平，让学习者能看清一台 coding agent 机器的内部构造。

> Agent = LLM + Harness。LLM 负责决策，其余都是工程。

## 特性

- **主循环**：上下文组装 → LLM 调用 → 解析 → 护栏 → 工具执行 → 反馈 → 停机判断的完整闭环
- **5 个内置工具**：`list_directory` / `search_code` / `read_file` / `write_file` / `execute_shell`
- **三层护栏**：硬黑名单（正则机械锁）→ 动态风险评估 + HITL 人工审批 → 范围围栏（Scope Fence）
- **反馈闭环**：信号提取 → 失败分类 → 回灌格式化，自动运行 `checks` 命令（`tsc` / `eslint` / `npm test`）并让 agent 据结果自我修正
- **确定性上下文压缩**：token 估算超阈值（默认 80%）时触发滑动窗口压缩，不调 LLM
- **凭据安全**：AES-256-GCM + PBKDF2 加密存储，key 不落盘、不进 Git、不出现在日志

## 前置要求

- Node.js ≥ 18（推荐 22 LTS）
- npm ≥ 9

## 安装

两种方式任选其一：

**方式一（最快）：Docker 公开镜像** —— 已发布到 `ghcr.io/tang-yixin/ai4se-harness`，无需本地装 Node / 依赖，见 [Docker 章节](#docker)。

**方式二：从源码构建**（本项目尚未发布到 npm）：

```bash
git clone <仓库地址> ai4se-harness
cd ai4se-harness
npm install          # 安装依赖
npm run build        # 编译 TypeScript → dist/
npm install -g .     # 全局安装，暴露 harness 命令
```

验证安装：

```bash
harness --version
```

## 快速开始

首次运行需要配置 DeepSeek API key：

```bash
harness setup
```

按提示录入 API key、设置并确认主密码。完成后会：

1. 将 key 加密保存到 `~/.ai4se-harness/credentials.enc`
2. 在当前目录生成默认配置模板 `.harnessrc.json`

然后即可分配任务：

```bash
harness run "用 TypeScript 写一个快速排序函数并附单元测试"
```

可以开启交互式多轮对话：

```bash
harness chat
```

也可以不落盘、通过环境变量传入 key。本地开发推荐用 `.env` 文件（放在运行 harness 的目录，已加入 `.gitignore`）：

```bash
echo 'DEEPSEEK_API_KEY=sk-...' > .env
harness run "你的任务"
```

Docker / CI 场景则直接注入环境变量：

```bash
export DEEPSEEK_API_KEY=sk-...   # 注意：export 会进入 shell history
harness run "你的任务"
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `harness run <task> [--config <path>]` | 执行单个 coding 任务 |
| `harness chat` | 交互式多轮对话（agent 跨轮记住上下文） |
| `harness setup` | 首次配置：录入 key + 设主密码 + 生成默认配置 |
| `harness key status` | 检查 key 是否已配置（只显示 `(configured)`，不暴露明文） |
| `harness key update` | 更新已存储的 key（先验证旧主密码） |
| `harness key delete` | 删除凭据文件 |

## 凭据安全

| 项 | 说明 |
|----|------|
| 存储位置 | `~/.ai4se-harness/credentials.enc`（用户主目录，**不在仓库内**） |
| 加密算法 | AES-256-GCM 认证加密 |
| 密钥派生 | PBKDF2（100,000 轮，SHA-512，随机 salt） |
| 明文去向 | 仅存在于进程内存中，不落盘 |

API key 的解析优先级：

1. `DEEPSEEK_API_KEY` 环境变量（Docker / CI / 自动化）
2. `.env` 文件中的 `DEEPSEEK_API_KEY`（本地开发，不覆盖已存在的环境变量）
3. 交互式输入主密码，从 `credentials.enc` 解密（最多重试 3 次）

**安全边界**：本项目假设操作系统用户空间可信，不防御内核级攻击、硬件 keylogger、物理访问，也不防进程内存 dump（明文 key 在内存中）。

## 配置

配置文件为当前目录下的 `.harnessrc.json`（也可用 `-c` 指定）。首次运行或执行 `harness setup` 会生成带默认值的模板，缺失字段自动合并默认值，非法字段（如无效正则、非正数）在启动时报错退出。

默认配置：

```jsonc
{
  "llm": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "baseURL": "https://api.deepseek.com/v1",
    "maxTokens": 8192
  },
  "guardrails": {
    "rules": [
      { "tool": "execute_shell", "pattern": "sudo.*", "action": "confirm" },
      { "tool": "execute_shell", "pattern": "(curl|wget).*\\|.*(bash|sh)", "action": "deny" },
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
    "contextThreshold": 0.8,
    "contextWindowTokens": 64000,
    "keepRecentMessages": 8,
    "maxToolResultChars": 8000
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

> 说明：上面 `guardrails.rules` 是**用户可编辑规则**，`harness setup` 默认只生成这 3 条。护栏还有**代码内置**、不在本配置文件中的部分：硬黑名单（`src/tools/blacklist.ts`，如 `rm -rf /`、`format`、`shutdown`）、内置启发式风险分级（`src/guardrails/engine.ts`，含 `../` 父目录穿越、系统目录 `/etc`、`sudo` 等模式的自动识别）以及范围围栏（`src/guardrails/scope-fence.ts`）。它们与上面的配置规则叠加，构成完整护栏。

## 架构概览

主循环 7 步：

```
用户输入
  → ① 上下文组装（system prompt + 对话历史 + 记忆）
  → ② LLM 调用（DeepSeek API，经 OpenAI SDK）
  → ③ 解析响应（text / tool_calls）
  → ④ 护栏检查 ── 安全 → ⑤ 工具执行
                ├─ deny → 记入反馈
                └─ confirm → HITL 人工审批（approve/deny/timeout）
  → ⑥ 结果处理（信号提取 → 失败分类 → 回灌格式化）
  → ⑦ 停机判断（目标达成 / 超轮数 / 用户中断）→ 否则回到①
```

**记忆**是纯内存存储（`Map` + 数组），**不落盘**，进程退出即清空——除凭据外不跨进程保留任何状态。**上下文压缩**是确定性的滑动窗口：始终保留 system + 首个用户任务 + 最近 `keepRecentMessages` 条，整块丢弃中间历史并插入 `[context truncated]` 标记，绝不拆散 assistant 的 tool_calls 与 tool 结果配对。

## 目录结构

```
ai4se-harness/
├── src/
│   ├── cli/index.ts          # CLI 入口（commander）
│   ├── config/loader.ts      # 配置加载 + 校验 + 默认值合并
│   ├── core/
│   │   ├── agent-loop.ts     # Agent 主循环
│   │   ├── types.ts          # 核心类型定义
│   │   └── platform.ts
│   ├── credentials/store.ts  # 凭据加密存储（PBKDF2 + AES-256-GCM）
│   ├── feedback/             # 反馈闭环
│   │   ├── extractor.ts      #   ⑥a 信号提取
│   │   ├── classifier.ts     #   ⑥b 失败分类
│   │   └── formatter.ts      #   ⑥c 回灌格式化
│   ├── guardrails/           # 护栏引擎（深度维度）
│   │   ├── engine.ts         #   assessRisk() + 规则匹配
│   │   ├── hitl.ts           #   HITL 状态机
│   │   ├── scope-fence.ts    #   范围围栏
│   │   └── fingerprint.ts    #   决策指纹匹配
│   ├── llm/
│   │   ├── provider.ts       #   LLMProvider 接口
│   │   ├── deepseek.ts       #   DeepSeekProvider
│   │   └── mock.ts           #   MockLLMProvider（测试用）
│   ├── memory/
│   │   ├── store.ts          #   记忆管理（纯内存）
│   │   └── context.ts        #   上下文预算（确定性压缩）
│   └── tools/
│       ├── registry.ts       #   工具注册表
│       ├── dispatcher.ts     #   工具分发器 + JSON Schema 参数校验
│       ├── blacklist.ts      #   硬黑名单
│       └── builtin/          #   5 个内置工具
├── tests/unit/               # 单元测试（mock LLM，零网络依赖）
├── Dockerfile
└── .github/workflows/ci.yml
```

> 说明：CLI 入口是 `src/cli/index.ts`；`package.json` 的 `main` 字段（`dist/index.js`）是残留死值，实际可执行命令由 `bin` 字段映射到 `dist/cli/index.js`。

## 测试

```bash
npm test             # vitest run，505 个用例，零网络依赖（使用 MockLLMProvider）
npx tsc --noEmit     # 类型检查
```

> 说明：本项目没有 `tests/integration/`（真实 DeepSeek API key 的集成测试无法在 CI 零网络依赖下运行）。端到端集成由 `tests/unit/agent-loop*.test.ts` 用 `MockLLMProvider` 串联全部模块承担。

### 机制演示（SPEC §A.6）

用 mock LLM 确定性复现三个核心机制，可单独运行：

```bash
npx vitest run tests/unit/mechanism-demo.test.ts
```

覆盖：① 硬黑名单拦截危险命令（`BLACKLIST BLOCK`）② 注入失败 → 反馈闭环回灌 `[FEEDBACK]` → agent 下一轮收到反馈 ③ 范围围栏硬拒绝越界写（`SCOPE FENCE BLOCK`）。

## Docker

镜像已发布到 GitHub Container Registry（公开），可直接拉取运行、无需本地构建：

```bash
# 验证
docker run --rm ghcr.io/tang-yixin/ai4se-harness:latest --version

# 运行任务：挂载工作目录，并通过环境变量传入 API key
docker run --rm \
  -v "$(pwd)":/workspace \
  -e DEEPSEEK_API_KEY=sk-... \
  ghcr.io/tang-yixin/ai4se-harness:latest run "你的任务"
```

本地构建（开发 / 二次修改时）：

```bash
docker build -t ai4se-harness .
docker run --rm ai4se-harness --version
```

容器内通过 `-e DEEPSEEK_API_KEY=...` 传入 key（环境变量有明文风险，但 Docker 内运行相对隔离）；也可进入容器执行 `harness setup` 交互录入。

> 注意：上面 `$(pwd)` 是 Bash 语法；Windows PowerShell 请改用 `${PWD}`。

## 已知限制

- **无 LLM 失败重试**：LLM 调用失败会直接终止，不做自动重试与指数退避
- **仅支持 DeepSeek**：唯一 LLM 后端（OpenAI 兼容协议，切换供应商成本低）
- **单会话**：同一进程内不支持多个 agent 并发运行
- **shell 护栏为字符串级**：依赖正则匹配，`cd ..`、`sed -i` 等变体可绕过，不能替代操作系统级沙箱
- **记忆不持久化**：项目记忆与决策记忆仅存内存，进程退出即清空
- 支持 Windows / macOS / Linux（需 Node.js ≥ 18）

## 许可证

MIT
