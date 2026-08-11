import { describe, it, expect } from 'vitest';
import { SignalExtractor } from '../../src/feedback/extractor.js';
import { FailureClassifier } from '../../src/feedback/classifier.js';
import { FeedbackFormatter } from '../../src/feedback/formatter.js';
import { ExecutionResult } from '../../src/core/types.js';

// 模拟 .harnessrc.json 中 feedback.checks 定义的信号模式
const signalPatterns: Record<string, string> = {
  typecheck: 'error TS',
  lint: 'error\\b|warning\\b',
  test: 'FAIL|passing',
};

// ============================================================
// 辅助工厂函数
// ============================================================

function makeSuccessResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    toolName: 'echo',
    success: true,
    stdout: 'hello world',
    stderr: '',
    exitCode: 0,
    ...overrides,
  };
}

function makeFailureResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    toolName: 'execute_shell',
    success: false,
    stdout: '',
    stderr: 'command not found',
    exitCode: 127,
    ...overrides,
  };
}

// ============================================================
// ⑥a SignalExtractor 测试
// ============================================================

describe('SignalExtractor', () => {
  // ---- Happy Path ----

  it('detects success from exitCode 0 and no error patterns', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell',
      success: true,
      stdout: 'All tests passing.',
      stderr: '',
      exitCode: 0,
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(true);
  });

  it('detects failure from non-zero exit code', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell',
      success: false,
      stdout: '',
      stderr: 'command not found',
      exitCode: 127,
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(false);
  });

  it('detects failure when stdout contains error patterns even with exitCode 0', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell',
      success: true,
      stdout: 'src/index.ts(10,5): error TS2339: Property not found',
      stderr: '',
      exitCode: 0, // tsc 有时 exitCode 可能为 0 但仍然有类型错误输出
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(false);
  });

  // ---- 边界测试：空输入 / 极端值 ----

  it('returns success for empty stdout and stderr with exitCode 0', () => {
    const result: ExecutionResult = {
      toolName: 'echo',
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(true);
  });

  it('returns failure for empty stdout and stderr with non-zero exitCode', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell',
      success: false,
      stdout: '',
      stderr: '',
      exitCode: 1,
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(false);
  });

  it('handles very long stdout without error patterns', () => {
    const longOutput = 'a'.repeat(100_000) + '\nAll good.\n';
    const result = makeSuccessResult({ stdout: longOutput });
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(true);
  });

  it('handles very long stdout with error pattern buried inside', () => {
    const prefix = 'a'.repeat(50_000);
    const suffix = 'b'.repeat(50_000);
    const result = makeFailureResult({
      stdout: prefix + 'error TS2339: bad type' + suffix,
      stderr: '',
      exitCode: 1,
    });
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(false);
  });

  it('works with empty signalPatterns (only exitCode matters)', () => {
    const failureResult = makeFailureResult({ exitCode: 1, stdout: 'nothing special' });
    const failureSignal = SignalExtractor.extract(failureResult, {});
    expect(failureSignal.success).toBe(false);

    const successResult = makeSuccessResult({ exitCode: 0, stdout: 'something with error TS in it' });
    const successSignal = SignalExtractor.extract(successResult, {});
    // 没有 signalPatterns 时，仅靠 exitCode 判断
    expect(successSignal.success).toBe(true);
  });

  it('handles whitespace-only stdout and stderr', () => {
    const result: ExecutionResult = {
      toolName: 'cmd',
      success: false,
      stdout: '   \n\t  \n  ',
      stderr: '   ',
      exitCode: 1,
    };
    const signal = SignalExtractor.extract(result, signalPatterns);
    expect(signal.success).toBe(false);
  });

  // ---- 多次调用 ----

  it('correctly processes multiple results sequentially', () => {
    const results: ExecutionResult[] = [
      makeSuccessResult({ stdout: 'All good' }),
      makeFailureResult({ exitCode: 1, stderr: 'FAIL: test failed' }),
      makeSuccessResult({ stdout: 'recovery successful' }),
      makeFailureResult({ exitCode: 2, stderr: 'error TS9999: fatal' }),
    ];

    const signals = results.map(r => SignalExtractor.extract(r, signalPatterns));
    expect(signals.map(s => s.success)).toEqual([true, false, true, false]);
  });
});

// ============================================================
// ⑥b FailureClassifier 测试
// ============================================================

describe('FailureClassifier', () => {
  // ---- Happy Path ----

  it('classifies TypeScript errors (TYPE_ERROR)', () => {
    const stdout = "src/index.ts(10,5): error TS2339: Property 'x' does not exist";
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    expect(type).toBe('TYPE_ERROR');
  });

  it('classifies test failures (TEST_FAILURE)', () => {
    const stdout = 'FAIL src/test.ts > should work\nTests: 2 failed, 5 passed';
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    expect(type).toBe('TEST_FAILURE');
  });

  it('classifies unknown failure as fallback (UNKNOWN_FAILURE)', () => {
    const type = FailureClassifier.classify(1, 'some random garbage output', '', signalPatterns);
    expect(type).toBe('UNKNOWN_FAILURE');
  });

  it('returns null for success (exitCode 0, no error patterns)', () => {
    const stdout = 'All tests passing.';
    const type = FailureClassifier.classify(0, stdout, '', signalPatterns);
    expect(type).toBeNull();
  });

  // ---- 其他失败类型 ----

  it('classifies lint errors (LINT_ERROR)', () => {
    const stdout = 'src/app.ts:1:1 - error: Unexpected var, use let or const instead';
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    // 不应被 TYPE_ERROR 误匹配（"error TS" 不在其中）
    expect(type).toBe('LINT_ERROR');
  });

  it('classifies shell errors (SHELL_ERROR) when exitCode != 0 but no specific pattern', () => {
    const stderr = '/bin/sh: nonexistent-command: not found';
    const type = FailureClassifier.classify(127, '', stderr, signalPatterns);
    expect(type).toBe('SHELL_ERROR');
  });

  it('classifies guardrail denial (GUARDRAIL_DENY)', () => {
    const stderr = 'BLACKLIST BLOCK: command "rm -rf /" is forbidden.';
    const type = FailureClassifier.classify(1, '', stderr, signalPatterns);
    expect(type).toBe('GUARDRAIL_DENY');
  });

  it('classifies guardrail denial from GUARDRAIL keyword', () => {
    const stderr = 'GUARDRAIL DENY: this operation was blocked by a safety rule.';
    const type = FailureClassifier.classify(1, '', stderr, signalPatterns);
    expect(type).toBe('GUARDRAIL_DENY');
  });

  // ---- 优先级测试 ----

  it('TYPE_ERROR takes priority over TEST_FAILURE when both patterns present', () => {
    const stdout = 'error TS2339: bad type\nFAIL test case\n';
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    // TYPE_ERROR 应该优先被检测到
    expect(type).toBe('TYPE_ERROR');
  });

  it('GUARDRAIL_DENY takes priority over general error patterns', () => {
    const stderr = 'BLACKLIST BLOCK: dangerous command\nerror: something went wrong';
    const type = FailureClassifier.classify(1, '', stderr, signalPatterns);
    expect(type).toBe('GUARDRAIL_DENY');
  });

  // ---- 边界测试 ----

  it('returns UNKNOWN_FAILURE for empty strings with non-zero exitCode', () => {
    const type = FailureClassifier.classify(1, '', '', signalPatterns);
    expect(type).toBe('UNKNOWN_FAILURE');
  });

  it('returns null for empty strings with exitCode 0', () => {
    const type = FailureClassifier.classify(0, '', '', signalPatterns);
    expect(type).toBeNull();
  });

  it('handles very long output containing error patterns', () => {
    const prefix = 'x'.repeat(100_000);
    const stdout = prefix + '\nFAIL: critical test failure\n' + 'y'.repeat(100_000);
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    expect(type).toBe('TEST_FAILURE');
  });

  it('is case-insensitive for type error detection', () => {
    const stdout = 'ERROR TS2304: Cannot find name';
    const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
    expect(type).toBe('TYPE_ERROR');
  });

  it('detects "failing" and "failed" as test failures', () => {
    const tests = [
      '1 test failing',
      'tests failed: 2',
      'Test Suite Failed',
    ];
    for (const stdout of tests) {
      const type = FailureClassifier.classify(1, stdout, '', signalPatterns);
      expect(type).toBe('TEST_FAILURE');
    }
  });

  it('returns UNKNOWN_FAILURE when output matches none of the known patterns but exitCode != 0', () => {
    const type = FailureClassifier.classify(2, 'some unrecognizable error output', '', signalPatterns);
    expect(type).toBe('UNKNOWN_FAILURE');
  });

  // ---- 多次调用 / 状态累积 ----

  it('correctly classifies multiple outputs independently', () => {
    const cases: [number, string, string, string | null][] = [
      [1, 'error TS1000: bad', '', 'TYPE_ERROR'],
      [1, 'FAIL: test', '', 'TEST_FAILURE'],
      [0, 'all ok', '', null],
      [1, '', 'BLACKLIST BLOCK', 'GUARDRAIL_DENY'],
      [3, 'unknown garbage', '', 'UNKNOWN_FAILURE'],
    ];

    for (const [exitCode, stdout, stderr, expected] of cases) {
      const type = FailureClassifier.classify(exitCode, stdout, stderr, signalPatterns);
      expect(type).toBe(expected);
    }
  });

  it('works with empty signalPatterns (uses built-in fallback patterns)', () => {
    // 即使没有自定义 signalPatterns，内置的 error TS/FAIL 等关键词仍应工作
    const type = FailureClassifier.classify(1, 'error TS9999: bad', '', {});
    expect(type).toBe('TYPE_ERROR');
  });
});

// ============================================================
// ⑥c FeedbackFormatter 测试
// ============================================================

describe('FeedbackFormatter', () => {
  // ---- Happy Path ----

  it('formats success feedback', () => {
    const result: ExecutionResult = {
      toolName: 'write_file',
      success: true,
      stdout: 'File written: src/index.ts',
      stderr: '',
      exitCode: 0,
    };
    const fb = FeedbackFormatter.format(result, null);
    expect(fb.success).toBe(true);
    expect(fb.summary).toContain('write_file');
    expect(fb.summary).toContain('success');
  });

  it('formats failure feedback with suggestion', () => {
    const result: ExecutionResult = {
      toolName: 'run_test',
      success: false,
      stdout: 'FAIL 3/5 tests',
      stderr: '',
      exitCode: 1,
    };
    const fb = FeedbackFormatter.format(result, 'TEST_FAILURE');
    expect(fb.success).toBe(false);
    expect(fb.failureType).toBe('TEST_FAILURE');
    expect(fb.suggestion).toBeDefined();
    expect(fb.suggestion!.length).toBeGreaterThan(0);
  });

  it('formats guardrail denial feedback', () => {
    const result: ExecutionResult = {
      toolName: 'execute_shell',
      success: false,
      stdout: '',
      stderr: 'BLACKLIST BLOCK',
      exitCode: 1,
    };
    const fb = FeedbackFormatter.format(result, 'GUARDRAIL_DENY');
    expect(fb.success).toBe(false);
    expect(fb.suggestion).toContain('alternative');
  });

  // ---- 所有失败类型的建议 ----

  it('provides suggestions for all failure types', () => {
    const failureTypes = [
      'TEST_FAILURE',
      'TYPE_ERROR',
      'LINT_ERROR',
      'SHELL_ERROR',
      'GUARDRAIL_DENY',
      'UNKNOWN_FAILURE',
    ] as const;

    for (const ft of failureTypes) {
      const result = makeFailureResult({ stderr: 'error' });
      const fb = FeedbackFormatter.format(result, ft);
      expect(fb.failureType).toBe(ft);
      expect(fb.suggestion).toBeDefined();
      expect(fb.suggestion!.length).toBeGreaterThan(0);
      expect(fb.success).toBe(false);
    }
  });

  // ---- 边界测试 ----

  it('truncates very long stdout in success summary', () => {
    const longStdout = 'x'.repeat(10_000);
    const result = makeSuccessResult({ stdout: longStdout });
    const fb = FeedbackFormatter.format(result, null);
    expect(fb.success).toBe(true);
    // 摘要不应包含完整的长输出（应被截断）
    expect(fb.summary.length).toBeLessThan(longStdout.length);
  });

  it('handles empty stdout and stderr', () => {
    const result: ExecutionResult = {
      toolName: 'dummy',
      success: false,
      stdout: '',
      stderr: '',
      exitCode: 1,
    };
    const fb = FeedbackFormatter.format(result, 'UNKNOWN_FAILURE');
    expect(fb.success).toBe(false);
    expect(fb.failureType).toBe('UNKNOWN_FAILURE');
    expect(fb.summary).toBeDefined();
    expect(fb.rawOutput).toBe('');
  });

  it('handles whitespace-only stdout and stderr', () => {
    const result: ExecutionResult = {
      toolName: 'test_tool',
      success: true,
      stdout: '   \n  ',
      stderr: '  \t  ',
      exitCode: 0,
    };
    const fb = FeedbackFormatter.format(result, null);
    expect(fb.success).toBe(true);
    expect(fb.summary).toContain('test_tool');
  });

  it('includes rawOutput in feedback', () => {
    const result: ExecutionResult = {
      toolName: 'check',
      success: false,
      stdout: 'line1\nline2',
      stderr: 'err1\nerr2',
      exitCode: 1,
    };
    const fb = FeedbackFormatter.format(result, 'SHELL_ERROR');
    expect(fb.rawOutput).toContain('line1');
    expect(fb.rawOutput).toContain('err1');
  });

  // ---- 多次调用 / 状态累积 ----

  it('produces independent Feedback instances for consecutive calls', () => {
    const r1 = makeSuccessResult({ toolName: 'tool_a', stdout: 'output A' });
    const r2 = makeFailureResult({ toolName: 'tool_b', stderr: 'bad error' });

    const fb1 = FeedbackFormatter.format(r1, null);
    const fb2 = FeedbackFormatter.format(r2, 'SHELL_ERROR');

    // fb1 不应受 fb2 影响
    expect(fb1.success).toBe(true);
    expect(fb1.summary).toContain('tool_a');
    expect(fb1.failureType).toBeUndefined();

    // fb2 应正确反映失败
    expect(fb2.success).toBe(false);
    expect(fb2.failureType).toBe('SHELL_ERROR');
  });

  // ---- 格式验证 ----

  it('success summary starts with checkmark symbol', () => {
    const result = makeSuccessResult({ toolName: 'read_file', stdout: 'file contents' });
    const fb = FeedbackFormatter.format(result, null);
    expect(fb.summary).toMatch(/^✓/);
  });

  it('failure summary starts with cross symbol', () => {
    const result = makeFailureResult({ toolName: 'compile', stderr: 'type error' });
    const fb = FeedbackFormatter.format(result, 'TYPE_ERROR');
    expect(fb.summary).toMatch(/^✗/);
  });

  it('failure summary includes the failure type in brackets', () => {
    const result = makeFailureResult({ stderr: 'fail' });
    const fb = FeedbackFormatter.format(result, 'TEST_FAILURE');
    expect(fb.summary).toContain('[TEST_FAILURE]');
  });
});
