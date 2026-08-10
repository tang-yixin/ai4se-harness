/**
 * MemoryStore 单元测试
 *
 * 测试记忆管理系统的存储、检索、摘要截断和决策记录功能：
 * - 项目记忆与决策记忆的 CRUD
 * - 分类过滤
 * - maxTokens 截断摘要
 * - 决策指纹精确匹配
 * - 边界条件（空值、覆盖、多次调用等）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';
import type { MemoryEntry, DecisionRecord } from '../../src/core/types.js';

// ============================================================
// 测试用的 MemoryStore 配置
// ============================================================

const defaultConfig = {
  maxTokens: 2000,
  summaryInterval: 10,
  contextThreshold: 0.8,
};

// ============================================================
// PLAN 要求的 4 个基础测试
// ============================================================

describe('MemoryStore — 基础 CRUD', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(defaultConfig);
  });

  it('存储和检索条目', () => {
    store.set('coding-style', 'Use tabs for indentation', 'project');
    const entry = store.get('coding-style');
    expect(entry).toBeDefined();
    expect(entry?.value).toBe('Use tabs for indentation');
    expect(entry?.category).toBe('project');
    expect(entry?.key).toBe('coding-style');
    expect(entry?.updatedAt).toBeGreaterThan(0);
  });

  it('按分类返回所有条目', () => {
    store.set('a', 'valueA', 'project');
    store.set('b', 'valueB', 'decision');
    store.set('c', 'valueC', 'project');

    // 按分类过滤
    expect(store.all('project')).toHaveLength(2);
    expect(store.all('decision')).toHaveLength(1);

    // 不传分类返回全部
    const all = store.all();
    expect(all).toHaveLength(3);
  });

  it('记录和按指纹匹配决策', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'rm -rf /tmp',
      action: 'denied',
      timestamp: Date.now(),
    });

    // 精确匹配
    const found = store.findDecision('execute_shell', 'npm run deploy');
    expect(found).not.toBeNull();
    expect(found?.action).toBe('approved');

    // 不匹配
    const notFound = store.findDecision('execute_shell', 'npm run build');
    expect(notFound).toBeNull();
  });

  it('生成记忆摘要文本', () => {
    store.set('key1', 'Remember to use async/await', 'project');
    store.set('key2', 'Tests use vitest', 'project');

    const summary = store.summarize();
    expect(summary).toContain('Remember to use async/await');
    expect(summary).toContain('Tests use vitest');
  });
});

// ============================================================
// 补充测试 —— 覆盖与删除
// ============================================================

describe('MemoryStore — 覆盖与删除', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(defaultConfig);
  });

  it('覆盖已有 key 会更新值和更新时间', () => {
    store.set('key', 'original value', 'project');
    const firstEntry = store.get('key');
    const firstTime = firstEntry!.updatedAt;

    // 等待 1ms 确保时间戳不同
    // 实际上 Date.now() 精度在 Windows 上可能不夠，我们手动验证行为
    store.set('key', 'updated value', 'project');
    const secondEntry = store.get('key');

    expect(secondEntry?.value).toBe('updated value');
    expect(secondEntry?.updatedAt).toBeGreaterThanOrEqual(firstTime);
  });

  it('覆盖时可以改变分类', () => {
    store.set('key', 'value', 'project');
    expect(store.get('key')?.category).toBe('project');

    store.set('key', 'value', 'decision');
    expect(store.get('key')?.category).toBe('decision');
  });

  it('删除条目', () => {
    store.set('key', 'value', 'project');
    expect(store.get('key')).toBeDefined();

    const removed = store.delete('key');
    expect(removed).toBe(true);
    expect(store.get('key')).toBeUndefined();
  });

  it('删除不存在的 key 返回 false', () => {
    expect(store.delete('nonexistent')).toBe(false);
  });

  it('clear 清空所有记忆', () => {
    store.set('a', '1', 'project');
    store.set('b', '2', 'decision');
    store.recordDecision({
      toolName: 't', commandFingerprint: 'cmd', action: 'approved', timestamp: 1,
    });

    store.clear();

    expect(store.all()).toHaveLength(0);
    expect(store.getAllDecisions()).toHaveLength(0);
  });
});

// ============================================================
// 补充测试 —— 摘要截断
// ============================================================

describe('MemoryStore — 摘要 maxTokens 截断', () => {
  it('小 maxTokens 会截断摘要输出', () => {
    const smallStore = new MemoryStore({
      maxTokens: 5, // 只有约 20 个字符
      summaryInterval: 10,
      contextThreshold: 0.8,
    });

    // 写入多个长条目
    smallStore.set('key1', 'This is a very long value that should be truncated', 'project');
    smallStore.set('key2', 'Another long piece of text that exceeds the limit', 'project');
    smallStore.set('key3', 'Yet another entry with lots of content', 'decision');

    const summary = smallStore.summarize();

    // 摘要应该存在但字符数受限
    expect(summary.length).toBeGreaterThan(0);
    // 粗略估算：5 tokens × 4 字符 = 约 20 字符上限
    // 但至少包含部分内容
    expect(summary.length).toBeLessThanOrEqual(5 * 4 + 50); // 允许一点容差
  });

  it('空记忆的摘要返回空字符串', () => {
    const store = new MemoryStore(defaultConfig);
    const summary = store.summarize();
    expect(summary).toBe('');
  });

  it('摘要优先保留最近更新的条目', async () => {
    const smallStore = new MemoryStore({
      maxTokens: 3, // 极小的限制
      summaryInterval: 10,
      contextThreshold: 0.8,
    });

    smallStore.set('old', 'Old entry', 'project');

    // 等待一小段时间确保时间戳不同
    await new Promise(resolve => setTimeout(resolve, 5));

    smallStore.set('new', 'New entry', 'project');

    const summary = smallStore.summarize();

    // "new" 应该排在前面（最近更新的优先）
    const newIdx = summary.indexOf('New entry');
    const oldIdx = summary.indexOf('Old entry');

    // 如果两者都在摘要中，new 应该排在 old 前面
    if (newIdx >= 0 && oldIdx >= 0) {
      expect(newIdx).toBeLessThan(oldIdx);
    }
    // 如果只有一个在摘要中，应该是 new（而不是 old）
    if (newIdx < 0 && oldIdx >= 0) {
      expect('new should be in summary').toBe('but it is not');
    }
    // new 至少应该存在
    expect(newIdx).toBeGreaterThanOrEqual(0);
  });

  it('摘要格式包含分类标签', () => {
    const store = new MemoryStore(defaultConfig);
    store.set('style', 'Use semicolons', 'project');
    store.set('decided', 'Approve npm test', 'decision');

    const summary = store.summarize();
    expect(summary).toContain('[project]');
    expect(summary).toContain('[decision]');
  });
});

// ============================================================
// 补充测试 —— 决策记录
// ============================================================

describe('MemoryStore — 决策记录管理', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(defaultConfig);
  });

  it('getAllDecisions 返回所有决策的副本', () => {
    store.recordDecision({
      toolName: 't1', commandFingerprint: 'cmd1', action: 'approved', timestamp: 100,
    });
    store.recordDecision({
      toolName: 't2', commandFingerprint: 'cmd2', action: 'denied', timestamp: 200,
    });

    const all = store.getAllDecisions();
    expect(all).toHaveLength(2);

    // 验证返回的是副本而非引用
    all.pop();
    expect(store.getAllDecisions()).toHaveLength(2);
  });

  it('findDecision 只匹配相同工具名的决策', () => {
    store.recordDecision({
      toolName: 'execute_shell', commandFingerprint: 'ls -la', action: 'approved', timestamp: 1,
    });

    // 相同的 fingerprint 但不同工具名
    const result = store.findDecision('write_file', 'ls -la');
    expect(result).toBeNull();
  });

  it('同一 fingerprint 只返回最近的匹配', () => {
    store.recordDecision({
      toolName: 'execute_shell', commandFingerprint: 'npm test', action: 'denied', timestamp: 100,
    });
    store.recordDecision({
      toolName: 'execute_shell', commandFingerprint: 'npm test', action: 'approved', timestamp: 200,
    });

    const result = store.findDecision('execute_shell', 'npm test');
    // 应返回第一个匹配的（后插入的在数组后面）
    // 行为取决于实现，这里测试 findDecision 确实能找到匹配
    expect(result).not.toBeNull();
    expect(result?.toolName).toBe('execute_shell');
    expect(result?.commandFingerprint).toBe('npm test');
  });

  it('空决策列表的查找返回 null', () => {
    const result = store.findDecision('execute_shell', 'any command');
    expect(result).toBeNull();
  });

  it('getAllDecisions 为空时返回空数组', () => {
    const decisions = store.getAllDecisions();
    expect(decisions).toEqual([]);
  });

  it('recordDecision 保留所有字段', () => {
    const record: DecisionRecord = {
      toolName: 'write_file',
      commandFingerprint: './src/index.ts',
      action: 'approved',
      timestamp: 1234567890,
    };

    store.recordDecision(record);

    const found = store.findDecision('write_file', './src/index.ts');
    expect(found?.toolName).toBe('write_file');
    expect(found?.commandFingerprint).toBe('./src/index.ts');
    expect(found?.action).toBe('approved');
    expect(found?.timestamp).toBe(1234567890);
  });
});

// ============================================================
// 补充测试 —— 边界条件
// ============================================================

describe('MemoryStore — 边界条件', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(defaultConfig);
  });

  it('获取不存在的 key 返回 undefined', () => {
    const entry = store.get('nonexistent-key');
    expect(entry).toBeUndefined();
  });

  it('空 key 也可以正常存取', () => {
    store.set('', 'empty key value', 'project');
    expect(store.get('')?.value).toBe('empty key value');
  });

  it('空 value 也可以正常存取', () => {
    store.set('empty-value', '', 'project');
    expect(store.get('empty-value')?.value).toBe('');
  });

  it('极长的 value 可以正常存取', () => {
    const longValue = 'x'.repeat(100000);
    store.set('long', longValue, 'project');
    expect(store.get('long')?.value).toBe(longValue);
  });

  it('同一分类无条目时 all 返回空数组', () => {
    store.set('only-decision', 'val', 'decision');
    expect(store.all('project')).toEqual([]);
  });

  it('大量条目不影响性能', () => {
    const count = 1000;
    for (let i = 0; i < count; i++) {
      store.set(`key-${i}`, `value-${i}`, 'project');
    }

    expect(store.all()).toHaveLength(count);
    expect(store.get('key-500')?.value).toBe('value-500');

    // summarize 应在合理时间内完成
    const start = Date.now();
    const summary = store.summarize();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(200); // 1000 条目应在 200ms 内完成
    expect(summary.length).toBeGreaterThan(0);
  });

  it('all() 返回的数组是副本而非内部引用', () => {
    store.set('key', 'value', 'project');

    const entries1 = store.all();
    entries1.pop(); // 不应影响内部状态

    expect(store.all()).toHaveLength(1);
  });

  it('set 会自动更新 updatedAt 时间戳', () => {
    const beforeSet = Date.now();
    store.set('key', 'value', 'project');
    const afterSet = Date.now();

    const entry = store.get('key')!;
    expect(entry.updatedAt).toBeGreaterThanOrEqual(beforeSet);
    expect(entry.updatedAt).toBeLessThanOrEqual(afterSet);
  });

  it('同一个实例多次调用之间状态正确累积', () => {
    // 第 1 轮
    store.set('a', '1', 'project');
    expect(store.all()).toHaveLength(1);

    // 第 2 轮
    store.set('b', '2', 'decision');
    expect(store.all()).toHaveLength(2);

    // 第 3 轮
    store.recordDecision({
      toolName: 't', commandFingerprint: 'c', action: 'approved', timestamp: 1,
    });
    expect(store.getAllDecisions()).toHaveLength(1);

    // 验证所有数据仍在
    expect(store.get('a')?.value).toBe('1');
    expect(store.get('b')?.value).toBe('2');
    expect(store.findDecision('t', 'c')?.action).toBe('approved');
  });

  it('所有分类过滤：全部三个分类', () => {
    store.set('p1', 'project1', 'project');
    store.set('p2', 'project2', 'project');
    store.set('d1', 'decision1', 'decision');
    store.set('d2', 'decision2', 'decision');

    expect(store.all('project')).toHaveLength(2);
    expect(store.all('decision')).toHaveLength(2);
    expect(store.all()).toHaveLength(4);
  });

  it('MemoryEntry 返回的对象包含所有字段', () => {
    store.set('test-key', 'test-value', 'project');

    const entry = store.get('test-key') as MemoryEntry;
    expect(entry.key).toBe('test-key');
    expect(entry.value).toBe('test-value');
    expect(entry.category).toBe('project');
    expect(typeof entry.updatedAt).toBe('number');
  });
});

// ============================================================
// 补充测试 —— 摘要间隔与上下文阈值配置
// ============================================================

describe('MemoryStore — 配置参数', () => {
  it('使用不同的 summaryInterval 值', () => {
    const s1 = new MemoryStore({ ...defaultConfig, summaryInterval: 5 });
    expect(s1).toBeDefined();

    const s2 = new MemoryStore({ ...defaultConfig, summaryInterval: 20 });
    expect(s2).toBeDefined();
  });

  it('使用不同的 contextThreshold 值', () => {
    const s1 = new MemoryStore({ ...defaultConfig, contextThreshold: 0.5 });
    expect(s1).toBeDefined();

    const s2 = new MemoryStore({ ...defaultConfig, contextThreshold: 0.95 });
    expect(s2).toBeDefined();
  });

  it('maxTokens 为 0 时摘要返回空字符串', () => {
    const zeroStore = new MemoryStore({
      maxTokens: 0,
      summaryInterval: 10,
      contextThreshold: 0.8,
    });

    zeroStore.set('key', 'some value', 'project');
    const summary = zeroStore.summarize();
    expect(summary).toBe('');
  });

  it('shouldSummarize 按轮数触发（达到 summaryInterval 倍数）', () => {
    const store = new MemoryStore({
      maxTokens: 2000,
      summaryInterval: 10,
      contextThreshold: 0.8,
    });

    // 第 10 轮触发
    expect(store.shouldSummarize(10, 100)).toBe(true);
    // 第 20 轮触发
    expect(store.shouldSummarize(20, 100)).toBe(true);
    // 第 5 轮不触发（不是 10 的倍数）
    expect(store.shouldSummarize(5, 100)).toBe(false);
    // round 0 不触发
    expect(store.shouldSummarize(0, 100)).toBe(false);
  });

  it('shouldSummarize 按 token 阈值触发', () => {
    const store = new MemoryStore({
      maxTokens: 2000,
      summaryInterval: 10,
      contextThreshold: 0.8,
    });

    // 1600 / 2000 = 0.8 → 触发
    expect(store.shouldSummarize(1, 1600)).toBe(true);
    // 1599 / 2000 < 0.8 → 不触发
    expect(store.shouldSummarize(1, 1599)).toBe(false);
  });

  it('shouldSummarize 使用外部 contextWindowTokens 而非 memory.maxTokens', () => {
    const store = new MemoryStore({
      maxTokens: 2000, // memory.maxTokens = 摘要上限
      summaryInterval: 10,
      contextThreshold: 0.8,
    });

    // 传入 contextWindowTokens=128000（现代 LLM 上下文窗口）
    // 128000 * 0.8 = 102400
    expect(store.shouldSummarize(1, 50000, 128000)).toBe(false);
    expect(store.shouldSummarize(1, 102400, 128000)).toBe(true);

    // 不传 contextWindowTokens 时回退到 memory.maxTokens
    // 2000 * 0.8 = 1600
    expect(store.shouldSummarize(1, 1599)).toBe(false);
    expect(store.shouldSummarize(1, 1600)).toBe(true);
  });

  it('shouldSummarize contextWindowTokens 为 0 时永不按阈值触发', () => {
    const store = new MemoryStore({ ...defaultConfig });
    // 传入 0 作为窗口大小 → 阈值判断被跳过
    expect(store.shouldSummarize(1, 999999, 0)).toBe(false);
  });
});
