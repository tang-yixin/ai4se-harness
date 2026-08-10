/// <reference types="node" />

import { readFileSync } from 'fs';
import type { HarnessConfig } from '../core/types.js';

/**
 * 配置加载错误——在校验阶段抛出，包含具体修复建议
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * 配置加载器
 *
 * 启动时读取 `.harnessrc.json`，对每个字段做类型和合法性校验，
 * 缺失字段合并默认值，配置错误在启动时报错退出。
 */
export class ConfigLoader {
  /** 静态默认配置——每次 load() 会深拷贝，不会被用户修改污染 */
  static readonly DEFAULTS: HarnessConfig = {
    llm: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      maxTokens: 4096,
    },
    guardrails: {
      rules: [],
      hitlTimeoutSeconds: 60,
    },
    scope: {
      workspaceRoot: '.',
      allowedHosts: ['github.com'],
      maxShellTimeMs: 30000,
    },
    memory: {
      maxTokens: 2000,
      summaryInterval: 10,
      contextThreshold: 0.8,
    },
    feedback: {
      autoFix: true,
      maxRetries: 3,
      checks: [],
    },
  };

  /**
   * 加载配置文件
   *
   * @param filePath 配置文件路径，默认 `./.harnessrc.json`
   * @returns 校验通过并合并默认值后的完整配置
   * @throws ConfigError 当文件存在但 JSON 非法或校验失败时
   */
  static load(filePath: string = './.harnessrc.json'): HarnessConfig {
    let userConfig: Partial<HarnessConfig> = {};

    try {
      const raw = readFileSync(filePath, 'utf-8');
      userConfig = JSON.parse(raw);
    } catch (err: unknown) {
      // 区分"文件不存在"和"JSON 解析错误"
      if (err instanceof SyntaxError) {
        throw new ConfigError(
          `Failed to parse config file "${filePath}": ${err.message}。请检查 JSON 语法。`,
        );
      }
      // 文件不存在 → 使用全部默认值（ENOENT 或其他 I/O 错误）
      // 但如果文件存在但无法读取（权限问题），也应该报错
      const nodeErr = err as { code?: string; message?: string };
      if (nodeErr.code === 'ENOENT' || nodeErr.code === 'ENOTDIR') {
        // 文件不存在，直接使用默认值
        const defaults = ConfigLoader.deepClone(ConfigLoader.DEFAULTS) as unknown as Record<string, unknown>;
        return ConfigLoader.validate(defaults);
      }
      // 其他 I/O 错误（如权限不足）
      throw new ConfigError(
        `Cannot read config file "${filePath}": ${nodeErr.message ?? String(err)}。`,
      );
    }

    // 深度合并用户配置与默认值
    const defaults = ConfigLoader.deepClone(ConfigLoader.DEFAULTS) as unknown as Record<string, unknown>;
    const merged = ConfigLoader.deepMerge(defaults, userConfig as Record<string, unknown>);

    // 校验合并后的配置
    return ConfigLoader.validate(merged);
  }

  // ================================================================
  // 合并逻辑
  // ================================================================

  /**
   * 深度合并两个配置对象
   *
   * - 基本类型：source 覆盖 target
   * - 嵌套对象：递归合并
   * - 数组：source 直接替换（不拼接）
   * - null / undefined 在 source 中：跳过，保留 target 原值
   */
  private static deepMerge(
    target: Record<string, unknown>,
    source: Partial<Record<string, unknown>>,
  ): Record<string, unknown> {
    const result = { ...target };

    for (const key of Object.keys(source)) {
      const sourceVal = source[key];
      // null 或 undefined → 跳过，保留默认值
      if (sourceVal === null || sourceVal === undefined) {
        continue;
      }

      if (Array.isArray(sourceVal)) {
        // 数组：直接替换
        result[key] = [...sourceVal];
      } else if (typeof sourceVal === 'object') {
        // 嵌套对象：递归合并
        const targetVal = target[key];
        if (targetVal && typeof targetVal === 'object' && !Array.isArray(targetVal)) {
          result[key] = ConfigLoader.deepMerge(
            targetVal as Record<string, unknown>,
            sourceVal as Record<string, unknown>,
          );
        } else {
          // target 中不存在或不是对象 → 直接浅拷贝 source
          result[key] = { ...(sourceVal as Record<string, unknown>) };
        }
      } else {
        // 基本类型（string, number, boolean）：直接覆盖
        result[key] = sourceVal;
      }
    }

    return result;
  }

  /**
   * 深拷贝配置对象，确保返回的配置与 DEFAULTS 无共享引用。
   * 使用 structuredClone 而非 JSON 序列化，以正确处理 undefined、NaN 等值。
   */
  private static deepClone<T>(obj: T): T {
    return structuredClone(obj);
  }

  // ================================================================
  // 校验逻辑
  // ================================================================

  /**
   * 校验合并后的配置，全部通过后返回（窄化类型）
   */
  private static validate(config: Record<string, unknown>): HarnessConfig {
    // 校验护栏规则
    ConfigLoader.validateGuardrailRules(config);

    // 校验 feedback checks
    ConfigLoader.validateChecks(config);

    // 校验数值字段
    ConfigLoader.validateNumericFields(config);

    // 校验 LLM 字符串字段
    ConfigLoader.validateLlmFields(config);

    return config as unknown as HarnessConfig;
  }

  /**
   * 校验护栏规则：结构完整 + 正则有效
   */
  private static validateGuardrailRules(config: Record<string, unknown>): void {
    const guardrails = config.guardrails as Record<string, unknown> | undefined;
    if (!guardrails) return; // 不应该发生（默认值保证存在），但防御性保留

    const rules = guardrails.rules as unknown[];
    if (!Array.isArray(rules)) {
      throw new ConfigError('guardrails.rules must be an array.');
    }

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as Record<string, unknown>;

      // 检查必填字段
      if (typeof rule.tool !== 'string' || rule.tool.trim() === '') {
        throw new ConfigError(
          `Guardrail rule #${i + 1}: missing or empty "tool" field.`,
        );
      }
      if (typeof rule.pattern !== 'string' || rule.pattern.trim() === '') {
        throw new ConfigError(
          `Guardrail rule #${i + 1}: missing or empty "pattern" field.`,
        );
      }
      if (typeof rule.action !== 'string') {
        throw new ConfigError(
          `Guardrail rule #${i + 1}: missing "action" field.`,
        );
      }
      if (rule.action !== 'deny' && rule.action !== 'confirm') {
        throw new ConfigError(
          `Guardrail rule #${i + 1}: invalid action "${rule.action}" — must be "deny" or "confirm".`,
        );
      }

      // 校验正则是否合法
      try {
        new RegExp(rule.pattern);
      } catch {
        throw new ConfigError(
          `Guardrail rule #${i + 1}: pattern "${rule.pattern}" is not a valid regex.`,
        );
      }
    }
  }

  /**
   * 校验 feedback.checks：结构完整 + signalPattern 正则有效
   */
  private static validateChecks(config: Record<string, unknown>): void {
    const feedback = config.feedback as Record<string, unknown> | undefined;
    if (!feedback) return;

    const checks = feedback.checks as unknown[];
    if (!Array.isArray(checks)) {
      throw new ConfigError('feedback.checks must be an array.');
    }

    for (let i = 0; i < checks.length; i++) {
      const check = checks[i] as Record<string, unknown>;

      if (typeof check.name !== 'string' || check.name.trim() === '') {
        throw new ConfigError(
          `Check #${i + 1}: missing or empty "name" field.`,
        );
      }
      if (typeof check.command !== 'string' || check.command.trim() === '') {
        throw new ConfigError(
          `Check #${i + 1}: missing or empty "command" field.`,
        );
      }
      if (typeof check.signalPattern !== 'string' || check.signalPattern.trim() === '') {
        throw new ConfigError(
          `Check #${i + 1}: missing or empty "signalPattern" field.`,
        );
      }

      // 校验正则
      try {
        new RegExp(check.signalPattern);
      } catch {
        throw new ConfigError(
          `Check #${i + 1}: signalPattern "${check.signalPattern}" is not a valid regex.`,
        );
      }
    }
  }

  /**
   * 校验所有数值字段的范围
   */
  private static validateNumericFields(config: Record<string, unknown>): void {
    // guardrails.hitlTimeoutSeconds
    const hitlTimeout = (config.guardrails as Record<string, unknown>)?.hitlTimeoutSeconds;
    if (typeof hitlTimeout !== 'number' || hitlTimeout <= 0 || !Number.isFinite(hitlTimeout)) {
      throw new ConfigError(
        `guardrails.hitlTimeoutSeconds must be a positive number, got ${JSON.stringify(hitlTimeout)}.`,
      );
    }

    // llm.maxTokens
    const llmMaxTokens = (config.llm as Record<string, unknown>)?.maxTokens;
    if (typeof llmMaxTokens !== 'number' || llmMaxTokens <= 0 || !Number.isFinite(llmMaxTokens)) {
      throw new ConfigError(
        `llm.maxTokens must be a positive number, got ${JSON.stringify(llmMaxTokens)}.`,
      );
    }

    // memory.maxTokens
    const memMaxTokens = (config.memory as Record<string, unknown>)?.maxTokens;
    if (typeof memMaxTokens !== 'number' || memMaxTokens <= 0 || !Number.isFinite(memMaxTokens)) {
      throw new ConfigError(
        `memory.maxTokens must be a positive number, got ${JSON.stringify(memMaxTokens)}.`,
      );
    }

    // memory.summaryInterval
    const summaryInterval = (config.memory as Record<string, unknown>)?.summaryInterval;
    if (typeof summaryInterval !== 'number' || summaryInterval <= 0 || !Number.isFinite(summaryInterval)) {
      throw new ConfigError(
        `memory.summaryInterval must be a positive number, got ${JSON.stringify(summaryInterval)}.`,
      );
    }

    // memory.contextThreshold: [0, 1]
    const contextThreshold = (config.memory as Record<string, unknown>)?.contextThreshold;
    if (typeof contextThreshold !== 'number' || contextThreshold < 0 || contextThreshold > 1) {
      throw new ConfigError(
        `memory.contextThreshold must be between 0 and 1 inclusive, got ${JSON.stringify(contextThreshold)}.`,
      );
    }

    // scope.maxShellTimeMs
    const maxShellTime = (config.scope as Record<string, unknown>)?.maxShellTimeMs;
    if (typeof maxShellTime !== 'number' || maxShellTime <= 0 || !Number.isFinite(maxShellTime)) {
      throw new ConfigError(
        `scope.maxShellTimeMs must be a positive number, got ${JSON.stringify(maxShellTime)}.`,
      );
    }

    // feedback.maxRetries (>= 0 only, can be 0 to disable retry)
    const maxRetries = (config.feedback as Record<string, unknown>)?.maxRetries;
    if (typeof maxRetries !== 'number' || maxRetries < 0 || !Number.isFinite(maxRetries)) {
      throw new ConfigError(
        `feedback.maxRetries must be a non-negative number, got ${JSON.stringify(maxRetries)}.`,
      );
    }
  }

  /**
   * 校验 LLM 字符串字段（非空）
   */
  private static validateLlmFields(config: Record<string, unknown>): void {
    const llm = config.llm as Record<string, unknown> | undefined;
    if (!llm) return;

    if (typeof llm.provider !== 'string' || llm.provider.trim() === '') {
      throw new ConfigError('llm.provider must be a non-empty string.');
    }
    if (typeof llm.model !== 'string' || llm.model.trim() === '') {
      throw new ConfigError('llm.model must be a non-empty string.');
    }
    if (typeof llm.baseURL !== 'string' || llm.baseURL.trim() === '') {
      throw new ConfigError('llm.baseURL must be a non-empty string.');
    }
  }
}
