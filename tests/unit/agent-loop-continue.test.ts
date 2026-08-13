import { describe, it, expect } from 'vitest';
import { AgentLoop } from '../../src/core/agent-loop.js';
import { MockLLMProvider } from '../../src/llm/mock.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { registerAllTools } from '../../src/tools/builtin/index.js';
import { MemoryStore } from '../../src/memory/store.js';
import { ConfigLoader } from '../../src/config/loader.js';
import type { HarnessConfig, LLMResponse } from '../../src/core/types.js';

// ============================================================
// 测试辅助函数（与 agent-loop.test.ts 保持一致）
// ============================================================

const memoryConfig = { maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 };

/** 无 checks 的默认配置——避免 runAutoChecks 产生真实子进程副作用 */
const noChecksConfig: HarnessConfig = {
  ...JSON.parse(JSON.stringify(ConfigLoader.DEFAULTS)),
  feedback: { ...JSON.parse(JSON.stringify(ConfigLoader.DEFAULTS.feedback)), checks: [] },
};

/** 深拷贝默认配置并合并自定义覆盖 */
function makeConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  const base = JSON.parse(JSON.stringify(ConfigLoader.DEFAULTS)) as HarnessConfig;
  return deepMerge(base, overrides) as HarnessConfig;
}

/** 简单深度合并（仅用于测试配置构造） */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      result[key] = deepMerge(
        (target[key] as Record<string, unknown>) ?? {},
        sv as Record<string, unknown>,
      );
    } else {
      result[key] = sv;
    }
  }
  return result;
}

/** 创建单个工具调用 LLM 响应 */
function toolCallResp(name: string, args: Record<string, unknown>, id = '1'): LLMResponse {
  return {
    content: null,
    toolCalls: [{ id, name, arguments: args }],
    finishReason: 'tool_calls',
    usage: { promptTokens: 50, completionTokens: 20 },
  };
}

/** 创建完成（stop）LLM 响应 */
function stopResp(content: string): LLMResponse {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 30 },
  };
}

/** 用给定 mock 创建 AgentLoop 实例 */
function makeLoop(
  mockLLM: MockLLMProvider,
  config: HarnessConfig = noChecksConfig,
  memory: MemoryStore = new MemoryStore(memoryConfig),
): AgentLoop {
  const registry = new ToolRegistry();
  registerAllTools(registry);
  return new AgentLoop({ llm: mockLLM, tools: registry, config, memory });
}

// ============================================================
// 测试套件
// ============================================================

describe('AgentLoop 多轮对话（continue / getMessages）', () => {
  // ---- 核心：run 后 continue 复用消息历史 ----
  it('run() 后 continue() 复用消息历史', async () => {
    const mockLLM = new MockLLMProvider([
      toolCallResp('read_file', { path: 'package.json' }, '1'),
      stopResp('First task done.'),
      toolCallResp('list_directory', { path: '.' }, '2'),
      stopResp('Second task done.'),
    ]);
    const loop = makeLoop(mockLLM);

    const r1 = await loop.run('Read package.json');
    expect(r1.success).toBe(true);

    const r2 = await loop.continue('Now list the directory');
    expect(r2.success).toBe(true);

    const msgs = loop.getMessages();
    // 首个消息是 system prompt
    expect(msgs[0].role).toBe('system');

    // 两条 user 消息按顺序排列
    const userMsgs = msgs.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBe(2);
    expect(userMsgs[0].content).toBe('Read package.json');
    expect(userMsgs[1].content).toBe('Now list the directory');

    // 第一轮与第二轮的工具结果都在历史中
    const toolContents = msgs.filter((m) => m.role === 'tool').map((m) => m.content).join('|');
    expect(toolContents).toContain('read_file');
    expect(toolContents).toContain('list_directory');

    // 两条 assistant 回复都在
    const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(2);
  });

  // ---- 核心：continue 不重复 system prompt ----
  it('continue() 不重复 system prompt', async () => {
    const mockLLM = new MockLLMProvider([
      stopResp('First reply.'),
      stopResp('Second reply.'),
      stopResp('Third reply.'),
    ]);
    const loop = makeLoop(mockLLM);

    await loop.run('hello');
    await loop.continue('again');
    await loop.continue('once more');

    const msgs = loop.getMessages();
    const systemPrompts = msgs.filter(
      (m) => m.role === 'system' && m.content.includes('You are a coding agent'),
    );
    expect(systemPrompts.length).toBe(1);
    // system prompt 始终是第一条消息
    expect(msgs[0].role).toBe('system');
  });

  // ---- 核心：MemoryStore 决策记录跨轮持久 ----
  it('continue() 复用同一 MemoryStore 的决策记录', async () => {
    const config = makeConfig({
      guardrails: {
        rules: [{ tool: 'execute_shell', pattern: 'sudo.*', action: 'confirm' }],
        hitlTimeoutSeconds: 60,
      },
    });
    const memory = new MemoryStore(memoryConfig);
    // 预置已批准决策（与现有 "skips HITL" 测试一致）
    memory.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'sudo systemctl restart nginx',
      action: 'approved',
      timestamp: Date.now(),
    });

    const mockLLM = new MockLLMProvider([
      // run 第一轮：调用与历史批准完全相同的命令 → 跳过 HITL 直接执行
      toolCallResp('execute_shell', { command: 'sudo systemctl restart nginx' }, '1'),
      stopResp('Restarted nginx (pre-approved).'),
      // continue 第一轮：再次调用同一命令 → 决策记忆仍生效，仍跳过 HITL
      toolCallResp('execute_shell', { command: 'sudo systemctl restart nginx' }, '2'),
      stopResp('Restarted nginx again (still pre-approved).'),
    ]);
    const loop = makeLoop(mockLLM, config, memory);

    await loop.run('Restart nginx');
    await loop.continue('Restart nginx again');

    // 两轮都没有 HITL 拒绝/超时消息（决策记忆跨轮持久，跳过 HITL）
    const msgs = loop.getMessages();
    const hitlDenied = msgs.filter(
      (m) => m.role === 'tool' && (m.content.includes('HITL') || m.content.includes('timeout')),
    );
    expect(hitlDenied.length).toBe(0);

    // 决策记忆仍存在
    expect(memory.getAllDecisions().length).toBeGreaterThanOrEqual(1);
  });

  // ---- 核心：getMessages 返回只读副本 ----
  it('getMessages() 返回只读副本，修改返回值不影响内部状态', async () => {
    const mockLLM = new MockLLMProvider([
      toolCallResp('read_file', { path: 'package.json' }, '1'),
      stopResp('Done.'),
    ]);
    const loop = makeLoop(mockLLM);
    await loop.run('Read file');

    const snapshot = loop.getMessages();
    const originalLength = snapshot.length;

    // 修改返回数组：不应影响内部状态
    snapshot.push({ role: 'user', content: 'injected' });
    expect(loop.getMessages().length).toBe(originalLength);

    // 修改返回消息对象的内容：不应影响内部状态
    snapshot[0].content = 'hacked';
    expect(loop.getMessages()[0].content).not.toBe('hacked');

    // 修改 toolCalls 的 arguments：不应影响内部状态
    const assistantMsg = snapshot.find((m) => m.role === 'assistant' && m.toolCalls);
    if (assistantMsg?.toolCalls) {
      assistantMsg.toolCalls[0].arguments.path = '/hacked/path';
    }
    const internalAssistant = loop
      .getMessages()
      .find((m) => m.role === 'assistant' && m.toolCalls);
    expect(internalAssistant?.toolCalls?.[0].arguments.path).toBe('package.json');
  });

  // ---- run 向后兼容 + messages 字段 ----
  it('AgentResult 返回 messages 且 run() 每次重置历史', async () => {
    const mockLLM = new MockLLMProvider([
      stopResp('First task done.'),
      stopResp('Second task done.'),
    ]);
    const loop = makeLoop(mockLLM);

    const r1 = await loop.run('Task 1');
    expect(r1.messages).toBeDefined();
    expect(r1.messages![0].role).toBe('system');
    expect(r1.messages![1].content).toBe('Task 1');

    const r2 = await loop.run('Task 2');
    expect(r2.messages![1].content).toBe('Task 2');
    // run() 重置历史：第二个 run 只有一条 user 消息
    const userMsgs = r2.messages!.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBe(1);
  });

  // ---- 边界：continue 在 run 之前调用（空历史） ----
  it('continue() 在 run() 之前调用会初始化 system prompt', async () => {
    const mockLLM = new MockLLMProvider([stopResp('Solo reply.')]);
    const loop = makeLoop(mockLLM);

    const result = await loop.continue('solo message');
    expect(result.success).toBe(true);

    const msgs = loop.getMessages();
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toBe('solo message');
  });

  // ---- 边界：continue 空字符串任务 ----
  it('continue() 处理空字符串任务', async () => {
    const mockLLM = new MockLLMProvider([
      stopResp('first'),
      stopResp('second'),
    ]);
    const loop = makeLoop(mockLLM);

    await loop.run('hello');
    const result = await loop.continue('');

    expect(result.success).toBe(true);
    const userMsgs = loop.getMessages().filter((m) => m.role === 'user');
    expect(userMsgs.length).toBe(2);
    expect(userMsgs[1].content).toBe('');
  });

  // ---- 多次调用：状态累积 ----
  it('多次 continue() 按顺序累积用户消息', async () => {
    const mockLLM = new MockLLMProvider([
      stopResp('r1'),
      stopResp('c1'),
      stopResp('c2'),
    ]);
    const loop = makeLoop(mockLLM);

    await loop.run('first');
    await loop.continue('second');
    await loop.continue('third');

    const userMsgs = loop.getMessages().filter((m) => m.role === 'user');
    expect(userMsgs.map((m) => m.content)).toEqual(['first', 'second', 'third']);
  });

  // ---- 错误路径：run 出错后 continue 可恢复 ----
  it('run() 以 error 结束后 continue() 仍可继续', async () => {
    const mockLLM = new MockLLMProvider([
      // run 第一轮 → LLM error
      {
        content: null,
        toolCalls: [],
        finishReason: 'error',
        usage: { promptTokens: 0, completionTokens: 0 },
      },
      // continue → 正常完成
      stopResp('Recovered.'),
    ]);
    const loop = makeLoop(mockLLM);

    const r1 = await loop.run('will fail');
    expect(r1.phase).toBe('error');

    const r2 = await loop.continue('try again');
    expect(r2.phase).toBe('completed');
    expect(r2.success).toBe(true);
  });

  // ---- continue 的 LLM 调用能看到完整历史 ----
  it('continue() 的 LLM 调用能看到完整累计历史', async () => {
    const mockLLM = new MockLLMProvider([
      toolCallResp('read_file', { path: 'package.json' }, '1'),
      stopResp('Done.'),
      stopResp('Continue reply.'),
    ]);
    const loop = makeLoop(mockLLM);

    await loop.run('Read file');
    await loop.continue('Anything else?');

    // continue() 的 LLM 调用（history[2]）应包含第一轮的工具结果和 assistant 回复
    const continueCallMessages = mockLLM.history[2].messages;
    const roles = continueCallMessages.map((m) => m.role);
    expect(roles).toContain('assistant');
    expect(roles).toContain('tool');

    // 且真正的 system prompt 只有一个（[FEEDBACK] 等 system 消息不计入）
    const systemCount = continueCallMessages.filter(
      (m) => m.role === 'system' && m.content.includes('You are a coding agent'),
    ).length;
    expect(systemCount).toBe(1);
  });
});
