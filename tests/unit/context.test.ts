/**
 * 上下文预算管理（context.ts）单元测试
 *
 * 覆盖：
 * - estimateTokens：1 token ≈ 4 字符的粗略估算（含 tool_calls 开销）
 * - truncateText：超限截断并追加标记
 * - compressContext：确定性滑动窗口压缩
 *   · 保留 system + 首个 user + 最近 keepRecentMessages 条
 *   · 以整块丢弃中间，插入 [context truncated] 标记
 *   · 绝不拆散 assistant tool_calls ↔ tool 结果配对
 *   · 不修改输入数组
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  truncateText,
  compressContext,
} from '../../src/memory/context.js';
import type { Message, ToolCall } from '../../src/core/types.js';

// ============================================================
// 测试辅助
// ============================================================

function sys(content: string): Message {
  return { role: 'system', content };
}

function user(content: string): Message {
  return { role: 'user', content };
}

function assistant(content: string, toolCalls?: ToolCall[]): Message {
  return { role: 'assistant', content, toolCalls };
}

function tool(content: string, toolCallId: string): Message {
  return { role: 'tool', content, toolCallId };
}

/** 检测是否存在「孤儿 tool 结果」：tool 消息前没有带 toolCalls 的 assistant */
function hasOrphanToolResult(msgs: Message[]): boolean {
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'tool') continue;
    let j = i - 1;
    while (j >= 0 && msgs[j].role === 'tool') j--;
    if (j < 0) return true;
    const prev = msgs[j];
    if (prev.role !== 'assistant' || !prev.toolCalls || prev.toolCalls.length === 0) {
      return true;
    }
  }
  return false;
}

// ============================================================
// estimateTokens
// ============================================================

describe('context — estimateTokens', () => {
  it('空消息数组返回 0', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('按 1 token ≈ 4 字符向上取整', () => {
    // 8 字符 → 2 token；7 字符 → 2 token（ceil）
    expect(estimateTokens([{ role: 'user', content: '12345678' }])).toBe(2);
    expect(estimateTokens([{ role: 'user', content: '1234567' }])).toBe(2);
    expect(estimateTokens([{ role: 'user', content: '' }])).toBe(0);
  });

  it('计入 tool_calls 的名称与参数 JSON', () => {
    const msgs: Message[] = [
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: '1', name: 'read_file', arguments: { path: 'x' } }],
      },
    ];
    // name 'read_file' = 9 字符；arguments JSON '{"path":"x"}' = 12 字符
    // 合计 21 字符 → ceil(21/4) = 6 token
    expect(estimateTokens(msgs)).toBe(6);
  });
});

// ============================================================
// truncateText
// ============================================================

describe('context — truncateText', () => {
  it('不超过上限时原样返回', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('恰好等于上限时原样返回', () => {
    expect(truncateText('hello', 5)).toBe('hello');
  });

  it('超限时截断并追加截断标记（含原始长度）', () => {
    const out = truncateText('0123456789', 4);
    expect(out.startsWith('0123')).toBe(true);
    expect(out).toContain('TRUNCATED');
    expect(out).toContain('10'); // 原始长度
    expect(out.length).toBeLessThan(40);
  });
});

// ============================================================
// compressContext
// ============================================================

describe('context — compressContext', () => {
  it('消息数不超过前缀+保留数时原样返回', () => {
    const msgs = [sys('s'), user('u'), assistant('a'), tool('t', '1')];
    const out = compressContext(msgs, { keepRecentMessages: 4 });
    expect(out).toEqual(msgs);
  });

  it('超限时保留 system + 首 user + 最近 keepRecentMessages 条', () => {
    const msgs = [
      sys('system'),
      user('task'),
      assistant('a1', [{ id: '1', name: 'read_file', arguments: { path: 'a' } }]),
      tool('t1', '1'),
      assistant('a2', [{ id: '2', name: 'read_file', arguments: { path: 'b' } }]),
      tool('t2', '2'),
      assistant('a3', [{ id: '3', name: 'read_file', arguments: { path: 'c' } }]),
      tool('t3', '3'),
    ];

    const out = compressContext(msgs, { keepRecentMessages: 2 });

    // 前缀：system + 首 user
    expect(out[0]).toEqual(msgs[0]);
    expect(out[1]).toEqual(msgs[1]);
    // 中间被替换为一条标记
    expect(out[2].role).toBe('system');
    expect(out[2].content).toContain('[context truncated');
    expect(out[2].content).toContain('4 earlier messages');
    // 后缀：最后 2 条
    expect(out.slice(3)).toEqual(msgs.slice(6));
    // 无孤儿 tool 结果
    expect(hasOrphanToolResult(out)).toBe(false);
  });

  it('后缀起点落在 tool 消息上时向前推进，不拆散配对', () => {
    // 构造 keepRecentMessages=3，使后缀起点恰好落在 tool('t2') 上
    const msgs = [
      sys('s'),
      user('u'),
      assistant('a1', [{ id: '1', name: 'read_file', arguments: {} }]),
      tool('t1', '1'),
      assistant('a2', [{ id: '2', name: 'read_file', arguments: {} }]),
      tool('t2', '2'),
      assistant('a3', [{ id: '3', name: 'read_file', arguments: {} }]),
      tool('t3', '3'),
    ];

    const out = compressContext(msgs, { keepRecentMessages: 3 });
    expect(hasOrphanToolResult(out)).toBe(false);
    // a3 与其 tool 结果 t3 应一起被保留
    const last = out[out.length - 1];
    const secondLast = out[out.length - 2];
    expect(secondLast.role).toBe('assistant');
    expect(secondLast.toolCalls?.length).toBe(1);
    expect(last.role).toBe('tool');
  });

  it('不修改输入数组（返回新数组）', () => {
    const msgs = [
      sys('s'),
      user('u'),
      assistant('a1', [{ id: '1', name: 'read_file', arguments: {} }]),
      tool('t1', '1'),
      assistant('a2', [{ id: '2', name: 'read_file', arguments: {} }]),
      tool('t2', '2'),
      assistant('a3', [{ id: '3', name: 'read_file', arguments: {} }]),
      tool('t3', '3'),
    ];
    const before = JSON.parse(JSON.stringify(msgs));

    compressContext(msgs, { keepRecentMessages: 2 });

    expect(msgs).toEqual(before);
  });

  it('多次压缩后仍保持配对不变量', () => {
    // 模拟长会话：多次压缩后不产生孤儿 tool 结果
    let msgs: Message[] = [sys('s'), user('u')];
    for (let i = 0; i < 6; i++) {
      msgs.push(assistant(`a${i}`, [{ id: String(i), name: 'read_file', arguments: {} }]));
      msgs.push(tool(`t${i}`, String(i)));
    }
    // 每次压缩后再次累积，再压缩
    for (let round = 0; round < 3; round++) {
      msgs = compressContext(msgs, { keepRecentMessages: 4 });
      expect(hasOrphanToolResult(msgs)).toBe(false);
      msgs.push(assistant('more', [{ id: 'x', name: 'list_directory', arguments: {} }]));
      msgs.push(tool('more-result', 'x'));
    }
    expect(hasOrphanToolResult(msgs)).toBe(false);
  });
});
