import type { LLMProvider } from './provider.js';
import type { Message, ToolDef, ToolCall, LLMResponse, FinishReason } from '../core/types.js';
import OpenAI from 'openai';

/** DeepSeekProvider 构造参数 */
export interface DeepSeekOptions {
  /** DeepSeek API key（不硬编码，由 CredentialStore 在运行时提供） */
  apiKey: string;
  /** 模型名称，默认 'deepseek-chat' */
  model?: string;
  /** API 基础 URL，默认 'https://api.deepseek.com/v1' */
  baseURL?: string;
  /** 最大输出 token 数，默认 4096 */
  maxTokens?: number;
}

/**
 * DeepSeek LLM Provider。
 * 使用 OpenAI 兼容协议调用 DeepSeek API。
 * 响应格式归一化，统一返回 LLMResponse 类型。
 */
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
    // 第一步：调用 DeepSeek API（网络/限流/服务端错误在此层捕获）
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        tools: tools.length > 0
          ? tools.map(t => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            }))
          : undefined,
        max_tokens: this.maxTokens,
      });
    } catch (error) {
      // 网络/限流/服务端错误 → 由上层重试逻辑处理（指数退避）
      return {
        content: null,
        toolCalls: [],
        finishReason: 'error',
        usage: { promptTokens: 0, completionTokens: 0 },
      };
    }

    // 第二步：解析 tool_calls（独立 try-catch，与网络错误区分）
    // SPEC §3.1：LLM 返回不可解析的响应 → 保留原始内容，上层可注入 context 请求重新生成
    const choice = response.choices[0];
    const message = choice.message;
    const rawToolCalls = message.tool_calls ?? [];
    const toolCalls: ToolCall[] = [];

    for (const tc of rawToolCalls) {
      // OpenAI SDK v7: tool_calls 元素可能是 ChatCompletionMessageToolCall 的多种变体
      // 我们只处理有 function 属性的标准 function call 类型
      const funcCall = (tc as { function?: { name: string; arguments: string } }).function;
      if (!funcCall) continue;

      try {
        toolCalls.push({
          id: tc.id,
          name: funcCall.name,
          arguments: JSON.parse(funcCall.arguments),
        });
      } catch {
        // arguments JSON 畸形（DeepSeek 偶发）→ 保留原始字符串，标记 [PARSE_ERROR]
        return {
          content: `[PARSE_ERROR] 无法解析 tool call "${funcCall.name}" 的 arguments JSON。` +
            `原始内容: ${funcCall.arguments}`,
          toolCalls: [],
          finishReason: 'error',
          usage: {
            promptTokens: response.usage?.prompt_tokens ?? 0,
            completionTokens: response.usage?.completion_tokens ?? 0,
          },
        };
      }
    }

    // 第三步：finish_reason 归一化
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
  }
}
