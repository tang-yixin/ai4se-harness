import type { LLMProvider } from './provider.js';
import type { Message, ToolDef, LLMResponse } from '../core/types.js';

/**
 * Mock LLM Provider —— 用于单元测试。
 * 构造函数接收预设响应队列，每次调用 complete() 按 FIFO 顺序弹出响应。
 * 所有调用记录保存在 history 数组中，便于测试断言。
 */
export class MockLLMProvider implements LLMProvider {
  private responseQueue: LLMResponse[];
  /** 记录每次 complete() 调用的参数，用于测试断言 */
  history: Array<{ messages: Message[]; tools: ToolDef[] }> = [];

  constructor(responses: LLMResponse[]) {
    this.responseQueue = [...responses];
  }

  async complete(messages: Message[], tools: ToolDef[]): Promise<LLMResponse> {
    // 记录调用历史
    this.history.push({ messages: [...messages], tools: [...tools] });

    // 队列耗尽时返回兜底响应
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

  /** 创建返回错误的 mock 实例的便捷方法 */
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
