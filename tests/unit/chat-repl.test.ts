/**
 * chat REPL 交互循环 单元测试
 *
 * 覆盖 Task 16 的交互式多轮对话，重点回归：
 *   - HITL 审批提示复用同一个 readline 接口，用户多输入（如 "aa"）
 *     不会串扰/泄漏到下一轮对话消息。
 *   - 空行跳过、exit/quit 正常退出。
 *
 * 通过 PassThrough 流模拟 stdin（非 TTY），无需真实终端或网络。
 * 同步点采用「harness> 提示出现次数」与 HITL 提示文本，避免竞态。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'stream';
import { createInterface } from 'readline';
import { runChatRepl } from '../../src/cli/index.js';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { MockLLMProvider } from '../../src/llm/mock.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { registerAllTools } from '../../src/tools/builtin/index.js';
import { MemoryStore } from '../../src/memory/store.js';
import { ConfigLoader } from '../../src/config/loader.js';
import type { HarnessConfig, LLMResponse } from '../../src/core/types.js';

// ============================================================
// 测试辅助
// ============================================================

const memoryConfig = { maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 };

const HITL_PROMPT = '   (A)pprove / (D)eny? ';
const CHAT_PROMPT = 'harness> ';

/** 构造一条 execute_shell + echo 的 confirm 规则，无自动 checks（避免副作用） */
function confirmEchoConfig(): HarnessConfig {
  const base = JSON.parse(JSON.stringify(ConfigLoader.DEFAULTS)) as HarnessConfig;
  base.guardrails.rules = [{ tool: 'execute_shell', pattern: 'echo', action: 'confirm' }];
  base.feedback.checks = [];
  return base;
}

function toolCallResp(name: string, args: Record<string, unknown>, id = '1'): LLMResponse {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: args }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 50, completionTokens: 20 },
  };
}

function stopResp(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 30 },
  };
}

/** 轮询等待谓词成立，超时报错（避免固定 sleep 的脆弱性） */
async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: 超时未满足条件');
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 收集 LLM 历史中所有 user 消息内容（按出现顺序） */
function userMessages(mockLLM: MockLLMProvider): string[] {
  return mockLLM.history.flatMap((h) =>
    h.messages.filter((m) => m.role === 'user').map((m) => m.content),
  );
}

/**
 * 最后一次 complete() 调用所见到的 user 消息序列。
 * continue() 会复用历史，因此最后一次调用携带了截至当前的全部 user 消息，
 * 用它断言「没有多出泄漏的 a/aa」最精确。
 */
function lastUserMessages(mockLLM: MockLLMProvider): string[] {
  const last = mockLLM.history[mockLLM.history.length - 1];
  return last.messages.filter((m) => m.role === 'user').map((m) => m.content);
}

/** 搭建一个可驱动的 chat REPL：返回输入流、prompt 记录、结束 promise 与 loop */
function setupRepl(responses: LLMResponse[], withAsk = true) {
  const mockLLM = new MockLLMProvider(responses);

  const registry = new ToolRegistry();
  registerAllTools(registry);

  const loop = new AgentLoop({
    llm: mockLLM,
    tools: registry,
    config: confirmEchoConfig(),
    memory: new MemoryStore(memoryConfig),
  });

  const input = new PassThrough();
  const rl = createInterface({ input, output: new PassThrough() });

  const prompts: string[] = [];
  const origQuestion = rl.question.bind(rl);
  rl.question = ((prompt: string, cb: (answer: string) => void) => {
    prompts.push(prompt);
    return origQuestion(prompt, cb);
  }) as typeof rl.question;

  // 交互式 HITL 输入：复用同一个 rl，模拟 TTY 下 chat 命令注入的 ask
  const ask = withAsk
    ? (prompt: string): Promise<string> =>
        new Promise<string>((resolve) => rl.question(prompt, (ans) => resolve(ans.trim())))
    : undefined;

  const replDone = runChatRepl(loop, rl, ask);
  const chatPrompts = () => prompts.filter((p) => p === CHAT_PROMPT).length;

  return { mockLLM, input, prompts, replDone, chatPrompts, loop };
}

// 静默 console 输出，保持测试输出整洁
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// 测试套件
// ============================================================

describe('chat REPL（runChatRepl）', () => {
  it('HITL 审批多输入 "aa" 不泄漏到下一轮对话', async () => {
    const { mockLLM, input, prompts, replDone, chatPrompts } = setupRepl([
      stopResp('hello there'),
      toolCallResp('execute_shell', { command: 'echo hi' }, '1'),
      stopResp('done after hitl'),
      stopResp('got next message'),
    ]);

    // 第一条普通消息（初始已有 1 个 harness> 提示，处理完后再提示 1 次）
    input.write('hi\n');
    await waitFor(() => chatPrompts() >= 2);

    // 触发 HITL confirm
    input.write('trigger hil\n');
    await waitFor(() => prompts.includes(HITL_PROMPT));

    // HITL 处多输入一个字符 "aa"
    input.write('aa\n');
    await waitFor(() => chatPrompts() >= 3);

    // 下一轮消息
    input.write('next message\n');
    await waitFor(() => chatPrompts() >= 4);

    input.write('exit\n');
    await replDone;

    // 关键断言：最后一次 continue 见到的 user 序列严格等于预期，无泄漏的 "a"/"aa"
    expect(lastUserMessages(mockLLM)).toEqual(['hi', 'trigger hil', 'next message']);
    expect(userMessages(mockLLM)).not.toContain('a');
    expect(userMessages(mockLLM)).not.toContain('aa');
  });

  it('HITL 审批单字符 "a" 通过且不泄漏', async () => {
    const { mockLLM, input, prompts, replDone, chatPrompts } = setupRepl([
      stopResp('first reply'),
      toolCallResp('execute_shell', { command: 'echo hi' }, '1'),
      stopResp('after approve'),
      stopResp('second message done'),
    ]);

    input.write('hi\n');
    await waitFor(() => chatPrompts() >= 2);

    input.write('trigger hil\n');
    await waitFor(() => prompts.includes(HITL_PROMPT));

    input.write('a\n'); // 正确审批
    await waitFor(() => chatPrompts() >= 3);

    input.write('second message\n');
    await waitFor(() => chatPrompts() >= 4);

    input.write('quit\n');
    await replDone;

    expect(lastUserMessages(mockLLM)).toEqual(['hi', 'trigger hil', 'second message']);
    expect(userMessages(mockLLM)).not.toContain('a');
  });

  it('跳过空行，支持 quit 正常退出', async () => {
    const { mockLLM, input, replDone, chatPrompts } = setupRepl([
      stopResp('reply to hello'),
    ]);

    input.write('   \n'); // 空白行，应被跳过并重新提示
    await waitFor(() => chatPrompts() >= 2);

    input.write('hello\n');
    await waitFor(() => chatPrompts() >= 3);

    input.write('quit\n');
    await replDone;

    // 空行不应触发 LLM 调用，只有 "hello" 触发一次
    expect(userMessages(mockLLM)).toEqual(['hello']);
  });

  it('不提供 ask 时 HITL 无人值守自动拒绝，不弹审批', async () => {
    const { input, prompts, replDone, chatPrompts, loop } = setupRepl(
      [
        toolCallResp('execute_shell', { command: 'echo hi' }, '1'),
        stopResp('auto-denied done'),
      ],
      false,
    );

    // 触发 HITL confirm 的消息
    input.write('trigger hil\n');
    await waitFor(() => chatPrompts() >= 2); // 处理完并重新提示，未被阻塞

    input.write('exit\n');
    await replDone;

    // 全程不弹 HITL 审批提示
    expect(prompts).not.toContain(HITL_PROMPT);
    // 该 HITL 请求被自动拒绝（走 deny 分支，工具未执行）
    expect(loop.hitl.getHistory()).toHaveLength(1);
    expect(loop.hitl.getHistory()[0].status).toBe('DENIED');
  });
});
