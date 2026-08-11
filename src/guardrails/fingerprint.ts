/**
 * 决策指纹匹配器 —— 两级匹配（精确 + 模糊）
 *
 * 根据 SPEC §3.5 的决策指纹匹配策略：
 * - 精确匹配：工具名 + 命令完全相同 → 复用历史决策，跳过 HITL
 * - 模糊匹配：工具名相同 + 命令相似度 > 阈值 → 仍走 HITL，但降一级（high→medium）
 * - 无匹配：走标准风险评估流程
 *
 * 相似度算法：Dice 系数（基于字符 bigram）
 *   - 将两个字符串分别拆分为连续两个字符组成的集合
 *   - Dice = 2 × |交集| / (|集合A| + |集合B|)
 *   - 取值范围 [0, 1]，1 表示完全相同
 *   - 对短字符串和长字符串均有较好表现
 */

import type { MemoryStore } from '../memory/store.js';

/** 匹配结果 */
export interface MatchResult {
  /** 是否匹配 */
  matched: boolean;
  /** 匹配级别 */
  level: 'exact' | 'fuzzy' | 'none';
  /** 历史决策动作（匹配时返回） */
  previousAction?: 'approved' | 'denied';
}

export class DecisionFingerprint {
  /** 模糊匹配的相似度阈值（0-1），默认 0.6 */
  static readonly FUZZY_THRESHOLD = 0.6;

  /**
   * bigram 生成的最大字符数上限。
   * 超过此长度的输入只取前 MAX_BIGRAM_INPUT_LENGTH 个字符生成 bigram，
   * 防止极端超长字符串（如文件内容被误传为命令）造成不必要的内存开销。
   * 10,000 字符远超实际 shell 命令的合理长度。
   */
  static readonly MAX_BIGRAM_INPUT_LENGTH = 10_000;

  /**
   * 两级决策指纹匹配。
   *
   * 匹配优先级：精确匹配 → 模糊匹配（取最高相似度）→ 无匹配
   *
   * @param store              MemoryStore 实例（提供决策记录查询）
   * @param toolName           工具名称
   * @param commandFingerprint 命令指纹（对 execute_shell 为命令字符串，对 write_file 为路径，否则为 JSON 序列化）
   * @returns 匹配结果
   */
  static match(
    store: MemoryStore,
    toolName: string,
    commandFingerprint: string,
  ): MatchResult {
    // 第 1 级：精确匹配 —— 工具名 + 指纹完全相同
    const exact = store.findDecision(toolName, commandFingerprint);
    if (exact) {
      return {
        matched: true,
        level: 'exact',
        previousAction: exact.action,
      };
    }

    // 第 2 级：模糊匹配 —— 工具名相同 + 相似度 > 阈值
    const allDecisions = store.getAllDecisions();
    let bestSimilarity = 0;
    let bestDecision: { action: 'approved' | 'denied' } | null = null;

    for (const d of allDecisions) {
      // 工具名必须相同
      if (d.toolName !== toolName) continue;

      const similarity = DecisionFingerprint.calculateSimilarity(
        commandFingerprint,
        d.commandFingerprint,
      );

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestDecision = d;
      }
    }

    if (bestDecision && bestSimilarity >= DecisionFingerprint.FUZZY_THRESHOLD) {
      return {
        matched: true,
        level: 'fuzzy',
        previousAction: bestDecision.action,
      };
    }

    // 第 3 级：无匹配
    return { matched: false, level: 'none' };
  }

  /**
   * 计算两个字符串的相似度（Dice 系数，基于字符 bigram）。
   *
   * 算法：
   * 1. 将字符串拆分为连续两字符组成的 bigram 集合
   * 2. 计算 Dice 系数：2 × |交集| / (|集合A| + |集合B|)
   *
   * 边界情况：
   * - 两个都为空字符串 → 1.0
   * - 一个为空 → 0.0
   * - 单字符字符串 → 0 个 bigram，与空串相同处理
   *
   * @param a 字符串 A
   * @param b 字符串 B
   * @returns 相似度 [0, 1]
   */
  static calculateSimilarity(a: string, b: string): number {
    // 两个都为空 → 完全相同
    if (a.length === 0 && b.length === 0) {
      return 1;
    }

    // 一个为空（或长度不足 2）→ 无法生成 bigram
    if (a.length < 2 || b.length < 2) {
      return 0;
    }

    const bigramsA = DecisionFingerprint.toBigramSet(a);
    const bigramsB = DecisionFingerprint.toBigramSet(b);

    // 计算交集大小
    let intersectionSize = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) {
        intersectionSize++;
      }
    }

    const totalSize = bigramsA.size + bigramsB.size;
    if (totalSize === 0) {
      return 0;
    }

    return (2 * intersectionSize) / totalSize;
  }

  /**
   * 将字符串转换为 bigram 集合。
   *
   * 例如 "hello" → Set { "he", "el", "ll", "lo" }
   *
   * @param s 输入字符串
   * @returns bigram 集合
   */
  private static toBigramSet(s: string): Set<string> {
    // 防御性截断：超过上限只取前缀，避免极端长字符串的内存开销
    const capped = s.length > DecisionFingerprint.MAX_BIGRAM_INPUT_LENGTH
      ? s.substring(0, DecisionFingerprint.MAX_BIGRAM_INPUT_LENGTH)
      : s;

    const bigrams = new Set<string>();
    for (let i = 0; i < capped.length - 1; i++) {
      bigrams.add(capped.substring(i, i + 2));
    }
    return bigrams;
  }
}
