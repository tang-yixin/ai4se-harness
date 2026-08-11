import type { ExecutionResult, Feedback, FailureType } from '../core/types.js';

// ============================================================
// ⑥c 回灌格式化器（Feedback Formatter）
// 生成 LLM 可读的结构化反馈文本
// 不调 LLM，纯字符串格式化
// ============================================================

/** 摘要中 stdout/stderr 的最大字符数 */
const SUMMARY_MAX_LENGTH = 500;

/**
 * 每种 FailureType 对应的修复建议文案
 */
const SUGGESTIONS: Record<FailureType, string> = {
  TEST_FAILURE:
    'Check the failing test assertions and fix the code logic accordingly.',
  TYPE_ERROR:
    'Fix TypeScript type errors — check the reported file paths and line numbers.',
  LINT_ERROR:
    'Run the linter to auto-fix formatting issues, or manually correct the reported violations.',
  SHELL_ERROR:
    'The shell command failed to execute. Check the command syntax and ensure required tools are installed.',
  GUARDRAIL_DENY:
    'The operation was blocked by a safety guardrail. Consider an alternative approach that does not trigger this restriction.',
  UNKNOWN_FAILURE:
    'The operation failed for an unknown reason. Review the raw output manually to diagnose the issue.',
};

export class FeedbackFormatter {
  /**
   * 将工具执行结果格式化为 Feedback 对象。
   *
   * @param result 工具执行结果
   * @param failureType 失败分类结果，null 表示成功
   * @returns 结构化的反馈对象
   */
  static format(result: ExecutionResult, failureType: FailureType | null): Feedback {
    const out = result.stdout ?? '';
    const err = result.stderr ?? '';
    const rawOutput = out && err ? out + '\n' + err : out || err;

    if (failureType === null) {
      // 成功反馈
      const outputPreview = truncateSummary(result.stdout || result.stderr || '');
      return {
        success: true,
        summary: `✓ ${result.toolName} executed successfully. ${outputPreview}`,
        rawOutput,
      };
    }

    // 失败反馈
    const errorPreview = truncateSummary(result.stderr || result.stdout || '');
    const suggestion = SUGGESTIONS[failureType];

    return {
      success: false,
      failureType,
      suggestion,
      summary: `✗ ${result.toolName} failed [${failureType}]: ${errorPreview}`,
      rawOutput,
    };
  }
}

/**
 * 截断过长的输出文本，用于摘要显示。
 * 使用 Array.from() 按 Unicode 码点截断，避免在多字节字符（中文、emoji）中间切断。
 */
function truncateSummary(text: string, maxLen: number = SUMMARY_MAX_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) {
    return trimmed;
  }
  // 按码点拆分再截断，防止代理对（surrogate pairs）被切成乱码
  return Array.from(trimmed).slice(0, maxLen).join('') + '...';
}
