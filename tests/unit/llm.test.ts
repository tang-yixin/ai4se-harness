import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../src/llm/mock.js';
import { LLMResponse } from '../../src/core/types.js';

describe('MockLLMProvider', () => {
  it('按顺序返回预设响应', async () => {
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

  it('记录所有调用历史', async () => {
    const mock = new MockLLMProvider([
      { content: 'ok', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5 } },
    ]);

    await mock.complete(
      [{ role: 'user', content: 'hello' }],
      [{ name: 'read_file', description: '', parameters: { type: 'object', properties: {} } }],
    );

    expect(mock.history.length).toBe(1);
    expect(mock.history[0].messages[0].content).toBe('hello');
    expect(mock.history[0].tools[0].name).toBe('read_file');
  });

  it('支持错误注入', async () => {
    const mock = new MockLLMProvider([
      { content: null, toolCalls: [], finishReason: 'error', usage: { promptTokens: 0, completionTokens: 0 } },
    ]);

    const r = await mock.complete([], []);
    expect(r.finishReason).toBe('error');
  });

  it('响应队列耗尽时返回默认兜底响应', async () => {
    const mock = new MockLLMProvider([]);

    const r = await mock.complete([{ role: 'user', content: 'test' }], []);
    expect(r.finishReason).toBe('stop');
    expect(r.content).toBe('No more mock responses.');
  });
});
