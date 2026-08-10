/**
 * MemoryStore —— 记忆管理系统
 *
 * 管理三类记忆：
 * - 项目记忆 (project)：项目约定、代码风格等，存储在内存 Map 中
 * - 决策记忆 (decision)：作为 MemoryEntry 存储，同时有独立的 DecisionRecord 数组
 * - 会话记忆：对话历史由 AgentLoop 直接管理，不在此模块
 *
 * 功能：
 * - CRUD 操作（set/get/delete/clear）
 * - 按分类过滤
 * - maxTokens 截断摘要生成（1 token ≈ 4 字符的粗略估算）
 * - 决策记录与精确指纹匹配
 */

import type { MemoryEntry, DecisionRecord } from '../core/types.js';

/** 记忆系统配置 */
export interface MemoryConfig {
  /** 摘要最大 token 数 */
  maxTokens: number;
  /** 自动摘要间隔（轮数） */
  summaryInterval: number;
  /** 触发摘要的上下文窗口占用阈值 */
  contextThreshold: number;
}

export class MemoryStore {
  /** 项目/决策记忆条目（key → entry） */
  private entries: Map<string, MemoryEntry> = new Map();

  /** 决策历史记录（按时间顺序） */
  private decisions: DecisionRecord[] = [];

  /** 记忆配置 */
  readonly config: MemoryConfig;

  constructor(config: MemoryConfig) {
    this.config = { ...config };
  }

  // ============================================================
  // 项目记忆 CRUD
  // ============================================================

  /**
   * 存储一条记忆条目。如果 key 已存在则覆盖。
   *
   * @param key      唯一标识符
   * @param value    记忆内容
   * @param category 分类（project / decision）
   */
  set(key: string, value: string, category: 'project' | 'decision'): void {
    this.entries.set(key, {
      key,
      value,
      category,
      updatedAt: Date.now(),
    });
  }

  /**
   * 按 key 检索记忆条目
   *
   * @param key 条目标识符
   * @returns 找到的条目，不存在则返回 undefined
   */
  get(key: string): MemoryEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * 删除指定 key 的条目
   *
   * @param key 条目标识符
   * @returns 是否成功删除（key 不存在时返回 false）
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * 清空所有记忆条目和决策记录
   */
  clear(): void {
    this.entries.clear();
    this.decisions = [];
  }

  /**
   * 返回所有/指定分类的记忆条目
   *
   * @param category 可选，按分类过滤
   * @returns 条目数组（副本）
   */
  all(category?: 'project' | 'decision'): MemoryEntry[] {
    const allEntries = Array.from(this.entries.values());
    if (category) {
      return allEntries.filter(e => e.category === category);
    }
    return allEntries;
  }

  // ============================================================
  // 摘要生成
  // ============================================================

  /**
   * 生成记忆摘要字符串，用于注入 system prompt。
   *
   * 策略：
   * - 按 updatedAt 降序排列（最近更新的排前面）
   * - 用 1 token ≈ 4 字符的粗略估算截断
   * - 格式：[category] key: value
   *
   * @returns 截断后的摘要文本
   */
  summarize(): string {
    const entries = Array.from(this.entries.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );

    const maxChars = this.config.maxTokens * 4;

    // maxTokens 为 0 时不输出任何内容
    if (maxChars <= 0) {
      return '';
    }

    let totalChars = 0;
    const lines: string[] = [];

    for (const entry of entries) {
      const line = `[${entry.category}] ${entry.key}: ${entry.value}`;
      const lineLength = line.length;

      // 如果加了这一行就超出限制，停止
      if (totalChars + lineLength > maxChars) {
        // 但如果当前还没有任何输出，至少包含这一行（避免完全空的摘要）
        if (lines.length === 0) {
          lines.push(line);
        }
        break;
      }

      totalChars += lineLength;
      lines.push(line);
    }

    return lines.join('\n');
  }

  // ============================================================
  // 决策记录
  // ============================================================

  /**
   * 记录一条审批决策
   *
   * @param record 决策记录
   */
  recordDecision(record: DecisionRecord): void {
    this.decisions.push({ ...record });
  }

  /**
   * 精确匹配历史决策。
   * 工具名和命令指纹完全相同才算匹配。
   * 按倒序查找（优先返回最近的匹配）。
   *
   * @param toolName            工具名
   * @param commandFingerprint  命令指纹
   * @returns 匹配的决策记录，未找到返回 null
   */
  findDecision(
    toolName: string,
    commandFingerprint: string,
  ): DecisionRecord | null {
    // 倒序查找，优先返回最近的匹配
    for (let i = this.decisions.length - 1; i >= 0; i--) {
      const d = this.decisions[i];
      if (d.toolName === toolName && d.commandFingerprint === commandFingerprint) {
        return { ...d };
      }
    }
    return null;
  }

  /**
   * 返回所有决策记录的副本
   *
   * @returns 决策记录数组
   */
  getAllDecisions(): DecisionRecord[] {
    return this.decisions.map(d => ({ ...d }));
  }

  // ============================================================
  // 会话记忆管理（供 AgentLoop 使用）
  // ============================================================

  /**
   * 判断是否应该触发摘要（达到 summaryInterval 轮数 或 token 估算超阈值）。
   *
   * 上下文窗口大小由外部传入（如 AgentLoop 从 llm.maxTokens 获取），
   * 因为 memory.maxTokens 是摘要输出上限而非 LLM 上下文窗口大小，
   * 两者语义不同。若未传入则回退到 memory.maxTokens 作为近似。
   *
   * @param round               当前轮数
   * @param tokenEstimate       当前上下文 token 估算值
   * @param contextWindowTokens LLM 上下文窗口大小（可选，默认回退到 memory.maxTokens）
   * @returns 是否应该触发摘要
   */
  shouldSummarize(
    round: number,
    tokenEstimate: number,
    contextWindowTokens?: number,
  ): boolean {
    // 按轮数触发
    if (round > 0 && round % this.config.summaryInterval === 0) {
      return true;
    }

    // 按 token 阈值触发：使用外部传入的上下文窗口大小，
    // 若未传入则回退到 memory.maxTokens 作为近似
    const windowTokens = contextWindowTokens ?? this.config.maxTokens;
    if (windowTokens > 0 && tokenEstimate / windowTokens >= this.config.contextThreshold) {
      return true;
    }

    return false;
  }
}
