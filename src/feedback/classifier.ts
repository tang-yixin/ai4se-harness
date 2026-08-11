import type { FailureType } from '../core/types.js';

// ============================================================
// ⑥b 失败分类器（Failure Classifier）
// 确定性归类：根据 exit code + stdout/stderr 内容判定失败类型
// 不调 LLM，纯规则匹配
// ============================================================

export class FailureClassifier {
  /**
   * 对执行结果进行确定性失败分类。
   *
   * 分类优先级（从高到低）：
   * 1. GUARDRAIL_DENY — 安全护栏拦截（BLACKLIST BLOCK / GUARDRAIL）
   * 2. TYPE_ERROR     — TypeScript 类型错误（"error TS"）
   * 3. TEST_FAILURE   — 测试失败（"FAIL" / "failing" / "failed"）
   * 4. LINT_ERROR     — 代码风格问题（"error:" / "warning:" lint 格式）
   * 5. SHELL_ERROR    — Shell 命令执行失败（特定 shell 错误格式）
   * 6. UNKNOWN_FAILURE — 无法识别的失败（兜底，exitCode !== 0 但输出不可识别）
   *
   * 返回 null 表示成功（exitCode === 0 且无任何错误模式匹配）
   *
   * @param exitCode 命令退出码
   * @param stdout 标准输出
   * @param stderr 标准错误
   * @param _signalPatterns 保留参数兼容性。
   *   当前分类器使用内置模式，暂未使用此参数。
   *   预留用于未来迭代：用户可通过 .harnessrc.json 的 feedback.checks[].signalPattern
   *   自定义分类关键词（例如 pytest 用户可用 "FAILED" 替代 "FAIL"）。
   * @returns 失败类型，或 null 表示成功
   */
  static classify(
    exitCode: number,
    stdout: string,
    stderr: string,
    _signalPatterns?: Record<string, string>,
  ): FailureType | null {
    const combined = stdout + stderr;

    // 快速路径：exitCode === 0 且无内容 → 成功
    if (exitCode === 0 && combined.trim() === '') {
      return null;
    }

    // 按优先级进行模式匹配

    // 1. 护栏拦截（最高优先级——安全相关）
    if (/BLACKLIST\s+BLOCK|GUARDRAIL/i.test(combined)) {
      return 'GUARDRAIL_DENY';
    }

    // 2. TypeScript 类型错误（"error TS" 后跟数字）
    if (/error\s+TS\d+/i.test(combined)) {
      return 'TYPE_ERROR';
    }

    // 3. 测试失败（"FAIL" 作为独立标记，或 "failing"/"failed"）
    if (/\bFAIL\b/.test(combined) || /failing|failed/i.test(combined)) {
      return 'TEST_FAILURE';
    }

    // 4. Lint 错误（lint 工具的标准输出格式 "error:" 或 "warning:"）
    if (/error:|warning:/i.test(combined)) {
      return 'LINT_ERROR';
    }

    // 5. Shell 错误（可识别的 shell 错误消息格式）
    if (/\/bin\/sh:|command not found|No such file|cannot execute/i.test(combined)) {
      return 'SHELL_ERROR';
    }

    // 6. 未知失败（exitCode 非零但输出不可识别，或输出完全为空）
    if (exitCode !== 0) {
      return 'UNKNOWN_FAILURE';
    }

    // 7. 兜底：exitCode === 0 且无错误模式匹配 → 成功
    return null;
  }
}
