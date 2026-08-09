# Agent Log

> 按时间顺序记录关键节点。格式随意，主要是记下做了什么、agent 有没有搞错、我改了哪里。

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

### 📋 Task N 示例

**时间**：2026-08-07 15:00  
**Task**：Task 1 - LLM 抽象层  
**分支**：`task/1-llm-abstraction`  
**触发的技能**：subagent-driven-development, test-driven-development

**做了什么**：实现 LLMProvider 接口 + MockLLMProvider + DeepSeekProvider

**Agent 输出**：
- 3 个文件：`src/llm/provider.ts`, `src/llm/mock.ts`, `src/llm/deepseek.ts`
- 测试文件：`tests/unit/llm.test.ts`
- 测试结果：3/3 通过
- Commit: `abc1234`

**我改了什么**：（示例）无，agent 产出直接用 / （示例）DeepSeekProvider 的错误处理漏了 429 限流情况，补了一个状态判断

**教训**：（示例）给 agent 的 prompt 里要明确要求"用 ESM import 加 .js 后缀"，不然它写的是 bare specifier，TypeScript 编译不过

---

### 📋 Task N 示例（agent 出错版）

**时间**：2026-08-07 17:00  
**Task**：Task 4 - 工具系统  
**分支**：`task/4-tool-system`

**Agent 做了什么**：实现了 ToolRegistry + ToolDispatcher，但参数校验只写了 required 检查，漏了 type 检查。MockLLM history 忘了 push。

**我改了什么**：
- 在 `ToolDispatcher.validateParams` 里补了 string/number 类型校验
- 在 `MockLLMProvider.complete()` 里补了 `this.history.push(...)`

**教训**：工具类的 task 要在 prompt 里明确列出所有校验维度（required + type + 范围），不然 agent 只会写最简单的 happy path

---

### 📋 Task N 示例（agent 完全搞错方向）

**时间**：2026-08-08 10:00  
**Task**：Task 12 - Agent 主循环

**Agent 做了什么**：把主循环写成了一个递归函数，根本没有停机判断，LLM 的 tool_calls 被忽略直接跳过

**处理**：放弃这个 subagent 的输出，重新写了一版 prompt，强调了"while 循环 + 显式 break 条件"，第二个 agent 产出合格

**教训**：AgentLoop 这种核心模块，prompt 里必须把流程图附上。第一个 prompt 只给了文字描述，agent 根本没理解循环结构

---

### 📋 快速格式（简单 task，无修改时用）

| 时间 | Task | 分支 | 测试 | Commit | 备注 |
|------|------|------|------|--------|------|
| 08-07 | Task 0 scaffold | task/0-scaffold | ✅ 编译通过 | `def5678` | 无修改 |
| 08-07 | Task 2 config | task/2-config | ✅ 3/3 | `ghi9012` | 无修改 |

---

### 📋 实现 checklist

- [ ] Task 0: 项目脚手架与核心类型
- [ ] Task 1: LLM 抽象层
- [ ] Task 2: 配置加载器
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
