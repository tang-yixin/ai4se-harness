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
- [ ] Task 3: 凭据存储
- [ ] Task 4: 工具系统（接口 + 注册 + 分发 + 黑名单）
- [ ] Task 5: 5 个内置工具
- [ ] Task 6: 护栏引擎
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

