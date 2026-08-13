import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader, ConfigError } from '../../src/config/loader.js';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ConfigLoader', () => {
  const tmpDir = join(tmpdir(), 'harness-config-test-' + Date.now());
  const tmpConfig = join(tmpDir, '.harnessrc.json');

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    // 确保每次测试前配置文件不存在
    try { unlinkSync(tmpConfig); } catch { /* ok */ }
  });

  afterEach(() => {
    try { unlinkSync(tmpConfig); } catch { /* ok */ }
  });

  // ================================================================
  // 加载与合并
  // ================================================================

  it('文件不存在时返回完整的默认配置', () => {
    const config = ConfigLoader.load('/nonexistent/path/.harnessrc.json');
    // LLM 默认值
    expect(config.llm.provider).toBe('deepseek');
    expect(config.llm.model).toBe('deepseek-chat');
    expect(config.llm.baseURL).toBe('https://api.deepseek.com/v1');
    expect(config.llm.maxTokens).toBe(8192);
    // 护栏默认值
    expect(config.guardrails.rules).toEqual([]);
    expect(config.guardrails.hitlTimeoutSeconds).toBe(60);
    // 范围围栏默认值
    expect(config.scope.workspaceRoot).toBe('.');
    expect(config.scope.allowedHosts).toEqual(['github.com']);
    expect(config.scope.maxShellTimeMs).toBe(30000);
    // 记忆默认值
    expect(config.memory.maxTokens).toBe(2000);
    expect(config.memory.summaryInterval).toBe(10);
    expect(config.memory.contextThreshold).toBe(0.8);
    expect(config.memory.contextWindowTokens).toBe(64000);
    expect(config.memory.keepRecentMessages).toBe(8);
    expect(config.memory.maxToolResultChars).toBe(8000);
    // 反馈默认值
    expect(config.feedback.autoFix).toBe(true);
    expect(config.feedback.maxRetries).toBe(3);
    expect(config.feedback.checks).toEqual([]);
  });

  it('部分配置与默认值深度合并', () => {
    const partial = JSON.stringify({ llm: { model: 'deepseek-v3' } });
    writeFileSync(tmpConfig, partial);

    const config = ConfigLoader.load(tmpConfig);
    expect(config.llm.model).toBe('deepseek-v3');       // 用户值
    expect(config.llm.provider).toBe('deepseek');        // 默认值合并
    expect(config.guardrails.hitlTimeoutSeconds).toBe(60); // 默认值合并
  });

  it('正确加载完整配置文件', () => {
    const full = JSON.stringify({
      llm: {
        provider: 'deepseek',
        model: 'deepseek-v3',
        baseURL: 'https://api.deepseek.com/v1',
        maxTokens: 8192,
      },
      guardrails: {
        rules: [{ tool: 'execute_shell', pattern: 'sudo.*', action: 'confirm' }],
        hitlTimeoutSeconds: 120,
      },
      scope: {
        workspaceRoot: './src',
        allowedHosts: ['github.com', 'gitlab.com'],
        maxShellTimeMs: 60000,
      },
      memory: {
        maxTokens: 4000,
        summaryInterval: 20,
        contextThreshold: 0.9,
      },
      feedback: {
        autoFix: false,
        maxRetries: 5,
        checks: [{ name: 'typecheck', command: 'npx tsc --noEmit', signalPattern: 'error TS' }],
      },
    });
    writeFileSync(tmpConfig, full);

    const config = ConfigLoader.load(tmpConfig);
    expect(config.llm.maxTokens).toBe(8192);
    expect(config.guardrails.rules).toHaveLength(1);
    expect(config.guardrails.hitlTimeoutSeconds).toBe(120);
    expect(config.scope.workspaceRoot).toBe('./src');
    expect(config.scope.allowedHosts).toEqual(['github.com', 'gitlab.com']);
    expect(config.scope.maxShellTimeMs).toBe(60000);
    expect(config.memory.maxTokens).toBe(4000);
    expect(config.memory.summaryInterval).toBe(20);
    expect(config.memory.contextThreshold).toBe(0.9);
    expect(config.feedback.autoFix).toBe(false);
    expect(config.feedback.maxRetries).toBe(5);
    expect(config.feedback.checks).toHaveLength(1);
  });

  it('空 JSON 文件返回全部默认值', () => {
    writeFileSync(tmpConfig, '{}');
    const config = ConfigLoader.load(tmpConfig);
    expect(config.llm.provider).toBe('deepseek');
    expect(config.llm.model).toBe('deepseek-chat');
    expect(config.guardrails.rules).toEqual([]);
  });

  it('深层嵌套部分覆盖正确合并', () => {
    const partial = JSON.stringify({
      guardrails: { hitlTimeoutSeconds: 90 },
      memory: { contextThreshold: 0.5 },
    });
    writeFileSync(tmpConfig, partial);

    const config = ConfigLoader.load(tmpConfig);
    expect(config.guardrails.hitlTimeoutSeconds).toBe(90);
    expect(config.guardrails.rules).toEqual([]);           // 默认值
    expect(config.memory.contextThreshold).toBe(0.5);
    expect(config.memory.maxTokens).toBe(2000);             // 默认值
    expect(config.memory.summaryInterval).toBe(10);         // 默认值
  });

  it('用户配置中的数组替换默认数组而非拼接', () => {
    const partial = JSON.stringify({
      guardrails: {
        rules: [{ tool: 'execute_shell', pattern: 'sudo.*', action: 'deny' }],
      },
      scope: {
        allowedHosts: ['custom-registry.com'],
      },
    });
    writeFileSync(tmpConfig, partial);

    const config = ConfigLoader.load(tmpConfig);
    expect(config.guardrails.rules).toHaveLength(1);
    expect(config.guardrails.rules[0].action).toBe('deny');
    expect(config.scope.allowedHosts).toEqual(['custom-registry.com']);
  });

  it('加载项目根目录的默认配置文件', () => {
    // 不传文件路径时使用默认路径 './.harnessrc.json'
    // 项目根目录存在该文件
    const config = ConfigLoader.load();
    expect(config.llm.provider).toBeDefined();
    expect(config.guardrails).toBeDefined();
    expect(config.scope).toBeDefined();
    expect(config.memory).toBeDefined();
    expect(config.feedback).toBeDefined();
  });

  // ================================================================
  // 校验：正则表达式
  // ================================================================

  it('护栏规则中无效正则抛出 ConfigError', () => {
    const badConfig = JSON.stringify({
      guardrails: {
        rules: [{ tool: 'execute_shell', pattern: '[invalid', action: 'deny' }],
      },
    });
    writeFileSync(tmpConfig, badConfig);

    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/guardrail rule/i);
  });

  it('Check 定义中无效正则（signalPattern）抛出 ConfigError', () => {
    const badConfig = JSON.stringify({
      feedback: {
        checks: [{ name: 'test', command: 'npm test', signalPattern: '[bad' }],
      },
    });
    writeFileSync(tmpConfig, badConfig);

    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/check/i);
  });

  it('有效的正则表达式通过校验', () => {
    const validConfig = JSON.stringify({
      guardrails: {
        rules: [
          { tool: 'execute_shell', pattern: 'sudo.*', action: 'confirm' },
          { tool: 'write_file', pattern: '^/(etc|var)/', action: 'deny' },
        ],
      },
      feedback: {
        checks: [
          { name: 'test', command: 'npm test', signalPattern: 'FAIL|passing' },
          { name: 'typecheck', command: 'npx tsc', signalPattern: 'error TS\\d+' },
        ],
      },
    });
    writeFileSync(tmpConfig, validConfig);

    const config = ConfigLoader.load(tmpConfig);
    expect(config.guardrails.rules).toHaveLength(2);
    expect(config.feedback.checks).toHaveLength(2);
  });

  // ================================================================
  // 校验：护栏规则结构
  // ================================================================

  it('护栏规则缺少 tool 字段时抛出 ConfigError', () => {
    const bad = JSON.stringify({
      guardrails: {
        rules: [{ pattern: 'sudo.*', action: 'deny' }],
      },
    });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/guardrail rule/i);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/tool/i);
  });

  it('护栏规则缺少 pattern 字段时抛出 ConfigError', () => {
    const bad = JSON.stringify({
      guardrails: {
        rules: [{ tool: 'execute_shell', action: 'deny' }],
      },
    });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('护栏规则缺少 action 字段时抛出 ConfigError', () => {
    const bad = JSON.stringify({
      guardrails: {
        rules: [{ tool: 'execute_shell', pattern: 'sudo.*' }],
      },
    });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('护栏规则 action 值无效时抛出 ConfigError', () => {
    const bad = JSON.stringify({
      guardrails: {
        rules: [{ tool: 'execute_shell', pattern: 'sudo.*', action: 'invalid_action' }],
      },
    });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/action/i);
  });

  // ================================================================
  // 校验：Check 定义结构
  // ================================================================

  it('Check 定义缺少 name 时抛出 ConfigError', () => {
    const bad = JSON.stringify({
      feedback: {
        checks: [{ command: 'npm test', signalPattern: 'FAIL' }],
      },
    });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/check/i);
  });

  it('Check 定义缺少 command 时抛出 ConfigError', () => {
    const bad = JSON.stringify({
      feedback: {
        checks: [{ name: 'test', signalPattern: 'FAIL' }],
      },
    });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('Check 定义缺少 signalPattern 时抛出 ConfigError', () => {
    const bad = JSON.stringify({
      feedback: {
        checks: [{ name: 'test', command: 'npm test' }],
      },
    });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  // ================================================================
  // 校验：数值字段
  // ================================================================

  it('hitlTimeoutSeconds 为负数时抛出 ConfigError', () => {
    const bad = JSON.stringify({ guardrails: { hitlTimeoutSeconds: -1 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/hitlTimeoutSeconds/);
  });

  it('hitlTimeoutSeconds 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ guardrails: { hitlTimeoutSeconds: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('llm.maxTokens 为负数时抛出 ConfigError', () => {
    const bad = JSON.stringify({ llm: { maxTokens: -100 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('llm.maxTokens 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ llm: { maxTokens: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('memory.maxTokens 为负数时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { maxTokens: -50 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('memory.maxTokens 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { maxTokens: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('summaryInterval 为负数时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { summaryInterval: -1 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('summaryInterval 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { summaryInterval: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('contextWindowTokens 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { contextWindowTokens: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('contextWindowTokens 为负数时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { contextWindowTokens: -1 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('keepRecentMessages 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { keepRecentMessages: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('maxToolResultChars 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { maxToolResultChars: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('新增 memory 字段通过合法值校验', () => {
    writeFileSync(tmpConfig, JSON.stringify({
      memory: { contextWindowTokens: 32000, keepRecentMessages: 5, maxToolResultChars: 4000 },
    }));
    const config = ConfigLoader.load(tmpConfig);
    expect(config.memory.contextWindowTokens).toBe(32000);
    expect(config.memory.keepRecentMessages).toBe(5);
    expect(config.memory.maxToolResultChars).toBe(4000);
  });

  it('contextThreshold 大于 1 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { contextThreshold: 1.5 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/contextThreshold/);
  });

  it('contextThreshold 小于 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ memory: { contextThreshold: -0.1 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('contextThreshold 边界值 0 和 1 通过校验', () => {
    writeFileSync(tmpConfig, JSON.stringify({ memory: { contextThreshold: 0 } }));
    expect(ConfigLoader.load(tmpConfig).memory.contextThreshold).toBe(0);

    writeFileSync(tmpConfig, JSON.stringify({ memory: { contextThreshold: 1 } }));
    expect(ConfigLoader.load(tmpConfig).memory.contextThreshold).toBe(1);
  });

  it('maxShellTimeMs 为负数时抛出 ConfigError', () => {
    const bad = JSON.stringify({ scope: { maxShellTimeMs: -500 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('maxShellTimeMs 为 0 时抛出 ConfigError', () => {
    const bad = JSON.stringify({ scope: { maxShellTimeMs: 0 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('maxRetries 为负数时抛出 ConfigError', () => {
    const bad = JSON.stringify({ feedback: { maxRetries: -1 } });
    writeFileSync(tmpConfig, bad);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
  });

  it('maxRetries 为 0 可以通过校验', () => {
    writeFileSync(tmpConfig, JSON.stringify({ feedback: { maxRetries: 0 } }));
    expect(ConfigLoader.load(tmpConfig).feedback.maxRetries).toBe(0);
  });

  // ================================================================
  // 错误路径
  // ================================================================

  it('无效 JSON 语法时抛出 ConfigError', () => {
    writeFileSync(tmpConfig, '{ invalid json content !! }');
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(ConfigError);
    expect(() => ConfigLoader.load(tmpConfig)).toThrow(/parse/i);
  });

  it('配置文件中 null 值被忽略并使用默认值', () => {
    // 用户将某段配置设为 null → 该段完全回退到默认值
    const partial = JSON.stringify({
      guardrails: null,
      feedback: null,
    });
    writeFileSync(tmpConfig, partial);

    const config = ConfigLoader.load(tmpConfig);
    // null 值被跳过，使用默认值
    expect(config.guardrails.hitlTimeoutSeconds).toBe(60);
    expect(config.guardrails.rules).toEqual([]);
    expect(config.feedback.autoFix).toBe(true);
    expect(config.feedback.checks).toEqual([]);
  });

  it('多次调用 load 返回独立的对象', () => {
    writeFileSync(tmpConfig, JSON.stringify({ llm: { model: 'm1' } }));
    const c1 = ConfigLoader.load(tmpConfig);
    expect(c1.llm.model).toBe('m1');

    writeFileSync(tmpConfig, JSON.stringify({ llm: { model: 'm2' } }));
    const c2 = ConfigLoader.load(tmpConfig);
    expect(c2.llm.model).toBe('m2');
    // c1 不受影响
    expect(c1.llm.model).toBe('m1');
  });

  it('内存和护栏默认值均为新的独立副本', () => {
    const config = ConfigLoader.load('/nonexistent/.harnessrc.json');
    // 确保默认值的数组是独立副本，修改不会影响后续 load
    config.guardrails.rules.push({
      tool: 'test',
      pattern: '.*',
      action: 'deny',
    });
    config.scope.allowedHosts.push('evil.com');
    config.feedback.checks.push({
      name: 'x',
      command: 'x',
      signalPattern: 'x',
    });

    const config2 = ConfigLoader.load('/nonexistent/.harnessrc.json');
    expect(config2.guardrails.rules).toEqual([]);
    expect(config2.scope.allowedHosts).toEqual(['github.com']);
    expect(config2.feedback.checks).toEqual([]);
  });

  it('默认配置对象是冻结的/不可变的', () => {
    // DEFAULTS 应该保持纯净，每次 load 返回新对象
    const c1 = ConfigLoader.load('/nonexistent/.harnessrc.json');
    const c2 = ConfigLoader.load('/nonexistent/.harnessrc.json');
    // 两个对象应该深度相等但引用不同
    expect(c1).toEqual(c2);
    expect(c1).not.toBe(c2);
  });
});
