import type { ExecutionResult } from '../core/types.js';

// ============================================================
// ⑥a 信号提取器（Signal Extractor）
// 纯字符串解析，不调 LLM，从工具执行结果中提取成功/失败信号
// ============================================================

/**
 * 信号提取结果：是否检测到失败信号
 */
export interface SignalResult {
  success: boolean;
}

/**
 * 明确指示操作失败的内在模式（不依赖外部配置）。
 * 这些是硬编码的"失败签名"——出现在输出中即表示有问题。
 */
const INTRINSIC_FAILURE_PATTERNS: RegExp[] = [
  /error\s+TS\d+/i, // TypeScript 类型错误（error TS2339 等）
  /\bFAIL\b/,        // 测试失败标记（独立单词 FAIL，避免误匹配 "FAILING" 外的其他词）
];

export class SignalExtractor {
  /**
   * 从 ExecutionResult 中提取成功/失败信号。
   *
   * 判断逻辑：
   * 1. exitCode !== 0 → 失败（操作系统级确定性信号）
   * 2. stdout/stderr 包含内在失败签名（如 "error TS"、"FAIL"）→ 失败
   * 3. 否则 → 成功
   *
   * 注意：不将 CheckDef.signalPattern 直接用于成功/失败判定，
   * 因为有些 signalPattern（如 "FAIL|passing"）中的 "passing" 是成功标记。
   * CheckDef 的 signalPattern 由 FailureClassifier 用于更细粒度的分类。
   *
   * @param result 工具执行结果
   * @param _signalPatterns 保留参数兼容性（CheckDef 的 signalPattern），当前未使用
   * @returns 信号提取结果
   */
  static extract(
    result: ExecutionResult,
    _signalPatterns?: Record<string, string>,
  ): SignalResult {
    // 规则 1：exitCode 非零 → 操作系统级失败信号
    if (result.exitCode !== 0) {
      return { success: false };
    }

    // 规则 2：输出中包含内在失败签名 → 确定性失败信号
    const combined = result.stdout + result.stderr;
    for (const pattern of INTRINSIC_FAILURE_PATTERNS) {
      if (pattern.test(combined)) {
        return { success: false };
      }
    }

    // 规则 3：无失败信号 → 成功
    return { success: true };
  }
}
