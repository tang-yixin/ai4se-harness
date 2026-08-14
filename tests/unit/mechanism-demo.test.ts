/**
 * 机制演示（Mechanism Demo）—— 对应 SPEC §A.6 的交付要求。
 *
 * 用 MockLLMProvider 驱动 AgentLoop，在零网络依赖下**确定性**复现三个行为：
 *   ① 治理护栏拦截危险动作（硬黑名单 BLACKLIST BLOCK）
 *   ② 注入一次失败 → 反馈闭环回灌 [FEEDBACK] → agent 下一轮收到该反馈
 *   ③ 重点维度（治理护栏）：范围围栏硬拒绝越界写（SCOPE FENCE BLOCK，优先于 HITL）
 *
 * 运行：npx vitest run tests/unit/mechanism-demo.test.ts
 */

import { describe, it, expect } from 'vitest';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { MockLLMProvider } from '../../src/llm/mock.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { registerAllTools } from '../../src/tools/builtin/index.js';
import { MemoryStore } from '../../src/memory/store.js';
import { ConfigLoader } from '../../src/config/loader.js';
import type { HarnessConfig, LLMResponse, Message } from '../../src/core/types.js';

// ============================================================
// 辅助函数
// ============================================================

const memoryConfig = { maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 };

/** 无自动 checks 的配置——避免 runAutoChecks 产生真实子进程副作用 */
const noChecksConfig: HarnessConfig = {
  ...JSON.parse(JSON.stringify(ConfigLoader.DEFAULTS)),
  feedback: { ...JSON.parse(JSON.stringify(ConfigLoader.DEFAULTS.feedback)), checks: [] },
};

/** 构造单个工具调用响应 */
function toolCallResp(name: string, args: Record<string, unknown>, id = '1'): LLMResponse {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: args }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 50, completionTokens: 20 },
  };
}

/** 构造完成（stop）响应 */
function stopResp(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 30 },
  };
}

/** 用预设响应队列跑一次 AgentLoop，返回 mock 实例与结果 */
async function runAgent(
  responses: LLMResponse[],
  task: string,
): Promise<{ mockLLM: MockLLMProvider; result: Awaited<ReturnType<AgentLoop['run']>> }> {
  const mockLLM = new MockLLMProvider(responses);
  const registry = new ToolRegistry();
  registerAllTools(registry);

  const loop = new AgentLoop({
    llm: mockLLM,
    tools: registry,
    config: noChecksConfig,
    memory: new MemoryStore(memoryConfig),
  });

  const result = await loop.run(task);
  return { mockLLM, result };
}

/** 检查消息历史中是否存在某类消息且内容包含指定子串 */
function hasContent(messages: Message[], role: string, substr: string): boolean {
  return messages.some((m) => m.role === role && m.content.includes(substr));
}

// ============================================================
// 机制演示
// ============================================================

describe('机制演示（SPEC §A.6）', () => {
  it('① 治理护栏拦截危险动作：硬黑名单 BLACKLIST BLOCK', async () => {
    const { mockLLM, result } = await runAgent(
      [
        toolCallResp('execute_shell', { command: 'format C:' }, '1'),
        stopResp('I will not run that dangerous command.'),
      ],
      'Format the disk',
    );

    // 黑名单命中 → 工具结果里出现 BLACKLIST BLOCK，且未真正执行
    expect(result.messages).toBeDefined();
    expect(hasContent(result.messages!, 'tool', 'BLACKLIST BLOCK')).toBe(true);
    // agent 第二轮收到拦截反馈后正常结束
    expect(result.phase).toBe('completed');
    expect(mockLLM.history.length).toBe(2);
  });

  it('② 注入失败 → 反馈闭环回灌 [FEEDBACK] → agent 下一轮收到反馈', async () => {
    const { mockLLM } = await runAgent(
      [
        toolCallResp('execute_shell', { command: 'exit 1' }, '1'),
        stopResp('The command failed; let me try a different approach.'),
      ],
      'Run a command that fails',
    );

    // 第二轮 LLM 调用收到的消息历史里，应包含第一轮失败的回灌反馈
    const secondCallMessages = mockLLM.history[1].messages;
    const gotFeedback = secondCallMessages.some(
      (m) => m.role === 'system' && m.content.includes('[FEEDBACK]') && m.content.includes('failed'),
    );
    expect(gotFeedback).toBe(true);
    expect(mockLLM.history.length).toBe(2);
  });

  it('③ 重点维度（治理护栏）：范围围栏硬拒绝越界写（优先于 HITL）', async () => {
    const { result } = await runAgent(
      [
        toolCallResp('write_file', { path: '../outside.txt', content: 'x' }, '1'),
        stopResp('I will write within the workspace instead.'),
      ],
      'Write outside the workspace',
    );

    // 越界写被范围围栏硬拒绝（SCOPE FENCE BLOCK），不得经 HITL 审批绕过
    expect(result.messages).toBeDefined();
    expect(hasContent(result.messages!, 'tool', 'SCOPE FENCE BLOCK')).toBe(true);
    expect(result.phase).toBe('completed');
  });
});
