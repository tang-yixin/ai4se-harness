/**
 * DecisionFingerprint 单元测试
 *
 * 测试两级决策指纹匹配：
 * - 精确匹配：工具名 + 命令完全相同
 * - 模糊匹配：工具名相同 + 命令相似度 > 阈值
 * - 无匹配：完全不同或低于阈值
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';
import { DecisionFingerprint } from '../../src/guardrails/fingerprint.js';

const memConfig = { maxTokens: 2000, summaryInterval: 10, contextThreshold: 0.8 };

describe('DecisionFingerprint', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(memConfig);
  });

  // ============================================================
  // 精确匹配
  // ============================================================

  it('exact match when identical command is found', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('exact');
    expect(result.previousAction).toBe('approved');
  });

  it('exact match for denied decision', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'rm -rf /important',
      action: 'denied',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'rm -rf /important');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('exact');
    expect(result.previousAction).toBe('denied');
  });

  it('exact match returns most recent decision when multiple exist', () => {
    // 先记录 approved
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: 1000,
    });
    // 后记录 denied
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'denied',
      timestamp: 2000,
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('exact');
    // 应该返回最近的（denied）
    expect(result.previousAction).toBe('denied');
  });

  // ============================================================
  // 模糊匹配
  // ============================================================

  it('fuzzy match for similar commands — added flag', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy --staging');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('fuzzy');
    expect(result.previousAction).toBe('approved');
  });

  it('fuzzy match for similar commands — different subcommand', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run build',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run test');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('fuzzy');
  });

  it('fuzzy match for commands with different paths', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'rm -rf /tmp/build',
      action: 'denied',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'rm -rf /tmp/cache');
    expect(result.matched).toBe(true);
    expect(result.level).toBe('fuzzy');
    expect(result.previousAction).toBe('denied');
  });

  it('fuzzy match prefers higher similarity when multiple decisions exist', () => {
    // 这条相似度较低
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'echo hello world',
      action: 'approved',
      timestamp: 1000,
    });
    // 这条更相似
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy --prod',
      action: 'denied',
      timestamp: 2000,
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy --staging');
    expect(result.matched).toBe(true);
    // 应该匹配到更相似的 npm run deploy --prod
    expect(result.previousAction).toBe('denied');
  });

  // ============================================================
  // 无匹配
  // ============================================================

  it('returns none for completely different commands', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', 'rm -rf /');
    expect(result.matched).toBe(false);
    expect(result.level).toBe('none');
    expect(result.previousAction).toBeUndefined();
  });

  it('returns none when no decisions exist', () => {
    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy');
    expect(result.matched).toBe(false);
    expect(result.level).toBe('none');
    expect(result.previousAction).toBeUndefined();
  });

  it('returns none when tool name does not match any decision', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm run deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'write_file', 'npm run deploy');
    expect(result.matched).toBe(false);
    expect(result.level).toBe('none');
  });

  // ============================================================
  // 边界测试：空输入 / 极端值
  // ============================================================

  it('handles empty command fingerprint', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: '',
      action: 'denied',
      timestamp: Date.now(),
    });

    // 精确匹配空字符串
    const exactResult = DecisionFingerprint.match(store, 'execute_shell', '');
    expect(exactResult.matched).toBe(true);
    expect(exactResult.level).toBe('exact');

    // 非空命令对空指纹不产生模糊匹配
    const fuzzyResult = DecisionFingerprint.match(store, 'execute_shell', 'ls');
    // ls 和 '' 的相似度应该低于阈值
    expect(fuzzyResult.level).toBe('none');
  });

  it('handles very short commands', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'ls',
      action: 'approved',
      timestamp: Date.now(),
    });

    // 'ls' vs 'la' — 有一定相似度但可能不够
    const result = DecisionFingerprint.match(store, 'execute_shell', 'la');
    // 两者共享 'l'，但相似度应该低于阈值
    expect(result.matched).toBe(false);
  });

  it('handles very long commands', () => {
    const longCmd1 = 'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans --force-recreate';
    const longCmd2 = 'docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans --force-recreate --no-deps';

    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: longCmd1,
      action: 'approved',
      timestamp: Date.now(),
    });

    const result = DecisionFingerprint.match(store, 'execute_shell', longCmd2);
    expect(result.matched).toBe(true);
    expect(result.level).toBe('fuzzy');
  });

  it('truncates extremely long strings to MAX_BIGRAM_INPUT_LENGTH without error', () => {
    // 构造一个远超上限的字符串
    const hugeString = 'x'.repeat(DecisionFingerprint.MAX_BIGRAM_INPUT_LENGTH + 5000);

    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: hugeString,
      action: 'approved',
      timestamp: Date.now(),
    });

    // 不应抛出异常，且相同超长字符串的精确匹配正常工作
    const exactResult = DecisionFingerprint.match(store, 'execute_shell', hugeString);
    expect(exactResult.level).toBe('exact');

    // 相似度计算也不应抛异常
    const sim = DecisionFingerprint.calculateSimilarity(hugeString, hugeString);
    expect(sim).toBe(1);
  });

  it('handles commands with special characters', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'curl -X POST https://api.example.com -H "Content-Type: application/json" -d \'{"key":"value"}\'',
      action: 'approved',
      timestamp: Date.now(),
    });

    // 精确匹配
    const exact = DecisionFingerprint.match(
      store, 'execute_shell',
      'curl -X POST https://api.example.com -H "Content-Type: application/json" -d \'{"key":"value"}\'',
    );
    expect(exact.level).toBe('exact');

    // 模糊匹配（改了 URL）
    const fuzzy = DecisionFingerprint.match(
      store, 'execute_shell',
      'curl -X POST https://api.example.com/v2 -H "Content-Type: application/json" -d \'{"key":"value"}\'',
    );
    expect(fuzzy.matched).toBe(true);
    expect(fuzzy.level).toBe('fuzzy');
  });

  it('handles commands with only whitespace difference', () => {
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'npm  run   deploy',
      action: 'approved',
      timestamp: Date.now(),
    });

    // 多个空格 vs 单个空格 — 这些是不同的指纹，但应该产生模糊匹配
    const result = DecisionFingerprint.match(store, 'execute_shell', 'npm run deploy');
    // 空格不同 → 非精确匹配，但高度相似 → 模糊匹配
    expect(result.matched).toBe(true);
    expect(result.level).toBe('fuzzy');
  });

  // ============================================================
  // 状态累积测试
  // ============================================================

  it('accumulates decisions correctly over multiple calls', () => {
    // 第一次调用时没有历史
    const r1 = DecisionFingerprint.match(store, 'execute_shell', 'git push');
    expect(r1.level).toBe('none');

    // 记录决策
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'git push',
      action: 'approved',
      timestamp: Date.now(),
    });

    // 第二次调用应该找到精确匹配
    const r2 = DecisionFingerprint.match(store, 'execute_shell', 'git push');
    expect(r2.level).toBe('exact');

    // 记录更多决策
    store.recordDecision({
      toolName: 'execute_shell',
      commandFingerprint: 'git commit -m "update"',
      action: 'approved',
      timestamp: Date.now(),
    });

    // 仍然能找到第一个决策
    const r3 = DecisionFingerprint.match(store, 'execute_shell', 'git push');
    expect(r3.level).toBe('exact');

    // 找到第二个决策
    const r4 = DecisionFingerprint.match(store, 'execute_shell', 'git commit -m "update"');
    expect(r4.level).toBe('exact');

    // 模糊匹配到两者之间的某个
    const r5 = DecisionFingerprint.match(store, 'execute_shell', 'git commit -m "fix"');
    expect(r5.level).toBe('fuzzy');
  });

  // ============================================================
  // 相似度算法正确性测试
  // ============================================================

  it('identical strings have similarity of 1.0', () => {
    const sim = DecisionFingerprint.calculateSimilarity('npm run deploy', 'npm run deploy');
    expect(sim).toBe(1.0);
  });

  it('completely different strings have low similarity', () => {
    const sim = DecisionFingerprint.calculateSimilarity('abcdef', 'ghijkl');
    expect(sim).toBeLessThan(DecisionFingerprint.FUZZY_THRESHOLD);
  });

  it('empty strings produce 0 similarity', () => {
    const sim = DecisionFingerprint.calculateSimilarity('', 'something');
    expect(sim).toBe(0);
  });

  it('both empty strings produce 1 similarity', () => {
    const sim = DecisionFingerprint.calculateSimilarity('', '');
    expect(sim).toBe(1);
  });

  it('prefix-similar commands have high similarity', () => {
    const sim = DecisionFingerprint.calculateSimilarity(
      'npm run deploy',
      'npm run deploy --staging',
    );
    // 长公共前缀 → 高相似度
    expect(sim).toBeGreaterThanOrEqual(DecisionFingerprint.FUZZY_THRESHOLD);
  });
});
