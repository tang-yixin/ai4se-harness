import type { Message, ToolDef, LLMResponse } from '../core/types.js';

/** LLM 抽象层接口 —— 所有 LLM Provider 必须实现此接口 */
export interface LLMProvider {
  /** 发送消息并获取 LLM 响应 */
  complete(messages: Message[], tools: ToolDef[]): Promise<LLMResponse>;
}
