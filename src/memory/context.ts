/**
 * 上下文预算管理 —— 确定性纯函数集合。
 *
 * 主循环（AgentLoop）在 messages 逼近模型上下文窗口时调用这些函数，
 * 把无限增长的历史压缩到预算之内，避免超出窗口后 API 报错导致任务失败。
 *
 * 三个纯函数，无 I/O、无 LLM 调用、无副作用，可直接单测：
 * - estimateTokens：按 1 token ≈ 4 字符粗略估算消息序列的 token 数
 * - truncateText：文本超限截断，追加截断标记
 * - compressContext：滑动窗口压缩，丢弃中间历史，保留锚点
 */

import type { Message } from '../core/types.js';

/** token 估算比例：1 token ≈ 4 字符（与 MemoryStore.summarize 保持一致的启发式） */
const TOKEN_CHARS = 4;

/**
 * 估算消息序列的总 token 数。
 *
 * 仅按字符长度粗略估算（不调用 tokenizer，保持确定性且零成本）：
 * - 每条消息按 content 长度 / 4 向上取整
 * - assistant 的 tool_calls 额外计入 name + arguments JSON 的长度 / 4
 *
 * @param messages 消息序列
 * @returns 估算的 token 数
 */
export function estimateTokens(messages: Message[]): number {
  let total = 0;

  for (const msg of messages) {
    total += Math.ceil((msg.content?.length ?? 0) / TOKEN_CHARS);

    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        const args = JSON.stringify(tc.arguments ?? {});
        total += Math.ceil((tc.name.length + args.length) / TOKEN_CHARS);
      }
    }
  }

  return total;
}

/**
 * 将文本截断到 maxChars 字符以内，超限时追加截断标记。
 *
 * @param text     原始文本
 * @param maxChars 字符上限（<= 0 时返回空串）
 * @returns 截断后的文本（未超限则原样返回）
 */
export function truncateText(text: string, maxChars: number): string {
  if (maxChars <= 0) {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + `...[TRUNCATED ${text.length} chars]`;
}

/** 压缩上下文时的选项 */
export interface CompressOptions {
  /** 始终保留的尾部消息条数（system 与首个 user 之外的最近 N 条） */
  keepRecentMessages: number;
}

/**
 * 压缩上下文：丢弃中间的旧历史，保留「锚点」。
 *
 * 不变量：
 * 1. 永远保留 messages[0]（system）与 messages[1]（首个 user 任务）
 * 2. 永远保留最后 keepRecentMessages 条
 * 3. 绝不拆散「assistant 的 tool_calls ↔ 其 tool 结果」配对
 *    （OpenAI/DeepSeek 协议要求二者紧邻，否则 API 返回 400）
 * 4. 确定性、无 LLM 调用；丢弃处插入一条 [context truncated] 标记
 *
 * 边界处理：若后缀起点恰落在 tool 消息上，说明该 tool 结果的配对 assistant
 * 已被划入丢弃区，于是把起点向前推进，将这条 tool 消息一并丢弃，避免留下孤儿。
 *
 * @param messages 原始消息序列（不会被修改）
 * @param options  压缩选项
 * @returns 压缩后的新数组（无中间可丢时返回原数组的副本）
 */
export function compressContext(messages: Message[], options: CompressOptions): Message[] {
  const keep = options.keepRecentMessages;
  const n = messages.length;

  // 前缀固定保留前两条（system + 首 user）；不足两条则全保留
  let prefixEnd = Math.min(2, n);

  // 后缀保留最后 keep 条，但起点不得落在 tool 消息上
  let suffixStart = Math.max(prefixEnd, n - keep);

  // 后缀起点是 tool 消息 → 向前推进，连同其配对 assistant 一起丢弃
  while (suffixStart < n && messages[suffixStart].role === 'tool') {
    suffixStart++;
  }

  // 前缀终点是 tool 消息（防御性，正常不会发生）→ 向后推进
  while (prefixEnd < suffixStart && messages[prefixEnd].role === 'tool') {
    prefixEnd++;
  }

  // 没有可丢弃的中间段
  if (prefixEnd >= suffixStart) {
    return messages.slice();
  }

  const dropped = suffixStart - prefixEnd;
  const marker: Message = {
    role: 'system',
    content: `[context truncated: ${dropped} earlier messages removed to fit context budget]`,
  };

  return [
    ...messages.slice(0, prefixEnd),
    marker,
    ...messages.slice(suffixStart),
  ];
}
