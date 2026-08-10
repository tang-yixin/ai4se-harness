/**
 * 护栏引擎 —— 第二层纵深防御。
 *
 * 根据工具名 + 参数动态判定风险等级。
 * 两层评估：
 *   1. 用户配置的规则（GuardrailRule[]）——deny/confirm
 *   2. 内置启发式分类 —— 命令模式 + 路径模式
 *
 * 返回 RiskAssessment，由调用方决定：
 *   - level='low'     → 直接放行
 *   - level='medium'  → 记录日志后放行
 *   - level='high' + action='deny'    → 拦截
 *   - level='high' + action='confirm' → 进入 HITL
 */

import type { GuardrailRule, RiskLevel, GuardrailAction } from '../core/types.js';

// ============================================================
// RiskAssessment 返回接口
// ============================================================

export interface RiskAssessment {
  /** 风险等级 */
  level: RiskLevel;
  /** 护栏动作（deny / confirm），仅当规则匹配时存在 */
  action?: GuardrailAction;
  /** 判定原因（可读文本，用于日志和审计） */
  reason: string;
}

// ============================================================
// 编译后的规则（正则预编译，避免每次调用都 new RegExp）
// ============================================================

interface CompiledRule {
  tool: string;
  pattern: RegExp;
  action: GuardrailAction;
}

// ============================================================
// 内置 shell 命令风险模式
// ============================================================

/** 低风险：纯读取/查询类命令，不会修改文件系统或外部状态 */
const LOW_RISK_SHELL_PATTERNS: RegExp[] = [
  /^ls\b/,
  /^dir\b/,
  /^cat\b/,
  /^echo\b/,
  /^pwd\b/,
  /^whoami\b/,
  /^date\b/,
  /^head\b/,
  /^tail\b/,
  /^wc\b/,
  /^sort\b/,
  /^uniq\b/,
  /^find\b/,
  /^grep\b/,
  /^git\s+status\b/,
  /^git\s+log\b/,
  /^git\s+diff\b/,
  /^npx\s+vitest\b/,
  /^npx\s+tsc\b/,
  /^node\s+--version\b/,
  /^npm\s+--version\b/,
];

/** 中风险：会修改但通常在安全范围内的命令 */
const MEDIUM_RISK_SHELL_PATTERNS: RegExp[] = [
  /^git\s+add\b/,
  /^git\s+commit\b/,
  /^git\s+checkout\b/,
  /^git\s+branch\b/,
  /^git\s+merge\b/,
  /^git\s+rebase\b/,
  /^git\s+reset\b/,
  /^git\s+stash\b/,
  /^npm\s+install\b/,
  /^npm\s+test\b/,
  /^npm\s+run\s+build\b/,
  /^npm\s+run\s+test\b/,
  /^npm\s+run\s+lint\b/,
  /^npm\s+run\s+start\b/,
  /^npm\s+run\s+dev\b/,
  /^npx\s+eslint\b/,
];

/** 高风险（需 confirm）：破坏性/外发/提权命令 */
const HIGH_RISK_SHELL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^sudo\b/, label: 'sudo（权限提升）' },
  { pattern: /^rm\b/, label: 'rm（删除文件）' },
  { pattern: /^mkfs\b/, label: 'mkfs（格式化文件系统）' },
  { pattern: /^fdisk\b/, label: 'fdisk（磁盘分区操作）' },
  { pattern: /^parted\b/, label: 'parted（磁盘分区操作）' },
  { pattern: /^chmod\b/, label: 'chmod（修改权限）' },
  { pattern: /^chown\b/, label: 'chown（修改所有者）' },
  { pattern: /^git\s+push\b/, label: 'git push（推送到远程）' },
  { pattern: /^docker\b/, label: 'docker（容器操作）' },
  { pattern: /^systemctl\b/, label: 'systemctl（系统服务控制）' },
  { pattern: /curl.*\|.*(bash|sh)/, label: 'curl pipe bash（管道注入风险）' },
  { pattern: /wget.*\|.*(bash|sh)/, label: 'wget pipe bash（管道注入风险）' },
];

// ============================================================
// 内置 write_file 路径风险模式
// ============================================================

/** 系统目录路径（高风险 + confirm） */
const SYSTEM_PATH_PATTERNS: RegExp[] = [
  /^\/etc\//,
  /^\/var\//,
  /^\/tmp\//,
  /^\/boot\//,
  /^\/sys\//,
  /^\/proc\//,
  /^\/dev\//,
  /^~\/\.ssh\//,
  /^~\/\.gnupg\//,
  /^~\/\.aws\//,
  /^~\/\.config\//,
  /^\~/,
];

/** 越界路径（父目录穿越，覆盖 Unix 和 Windows 风格） */
const TRAVERSAL_PATTERNS: RegExp[] = [
  /\.\.\//,     // Unix:   ../ 开头或路径中包含 ../
  /\.\.\\/,     // Windows: ..\ 开头或路径中包含 ..\
];

// ============================================================
// GuardrailEngine
// ============================================================

export class GuardrailEngine {
  private compiledRules: CompiledRule[];

  /**
   * @param rules 用户配置的护栏规则列表（来自 .harnessrc.json）
   */
  constructor(rules: GuardrailRule[]) {
    this.compiledRules = rules.map((r) => ({
      tool: r.tool,
      // 使用大小写不敏感匹配，防止大小写变体绕过
      pattern: new RegExp(r.pattern, 'i'),
      action: r.action,
    }));
  }

  /**
   * 评估给定工具调用参数的风险等级。
   *
   * @param toolName  工具名称（如 execute_shell、write_file）
   * @param params    工具参数（如 { command: 'ls' }、{ path: './src/index.ts' }）
   * @returns 风险评估结果
   */
  assessRisk(
    toolName: string,
    params: Record<string, unknown>,
  ): RiskAssessment {
    // 提取用于规则/模式匹配的搜索值
    const searchableValue = this.extractSearchableValue(toolName, params);

    // ---------- 第一层：用户配置规则 ----------
    for (const rule of this.compiledRules) {
      if (rule.tool === toolName && rule.pattern.test(searchableValue)) {
        return {
          level: 'high',
          action: rule.action,
          reason: `匹配用户规则: ${rule.tool} /${rule.pattern.source}/ → ${rule.action}`,
        };
      }
    }

    // ---------- 第二层：内置启发式 ----------
    return this.builtinAssessment(toolName, searchableValue);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 从参数中提取用于模式匹配的字符串值。
   * 不同工具的语义不同：
   *   - execute_shell → 提取 command
   *   - write_file    → 提取 path
   *   - 其他          → 空串（不参与匹配）
   */
  private extractSearchableValue(
    toolName: string,
    params: Record<string, unknown>,
  ): string {
    switch (toolName) {
      case 'execute_shell':
        return typeof params.command === 'string' ? params.command : '';
      case 'write_file':
        return typeof params.path === 'string' ? params.path : '';
      default:
        return '';
    }
  }

  /**
   * 内置启发式风险评估。
   * 当没有用户规则匹配时使用。
   */
  private builtinAssessment(
    toolName: string,
    value: string,
  ): RiskAssessment {
    switch (toolName) {
      case 'execute_shell':
        return this.assessShellCommand(value);
      case 'write_file':
        return this.assessWritePath(value);
      default:
        // read_file / list_directory / search_code 等只读工具 → 始终 low
        return {
          level: 'low',
          reason: `工具 ${toolName} 默认为低风险（只读）`,
        };
    }
  }

  /**
   * 对 shell 命令进行内置风险分级。
   */
  private assessShellCommand(command: string): RiskAssessment {
    const trimmed = command.trim();

    // 空命令/纯空白 → 中风险（不合理但也不是攻击）
    if (trimmed.length === 0) {
      return {
        level: 'medium',
        reason: '命令为空或纯空白',
      };
    }

    // 高风险模式（先检查，优先级最高）
    for (const { pattern, label } of HIGH_RISK_SHELL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'high',
          action: 'confirm',
          reason: `命令匹配高风险模式 (${label}): /${pattern.source}/`,
        };
      }
    }

    // 中风险模式
    for (const pattern of MEDIUM_RISK_SHELL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'medium',
          reason: `命令匹配中风险模式: /${pattern.source}/`,
        };
      }
    }

    // 低风险模式
    for (const pattern of LOW_RISK_SHELL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'low',
          reason: `命令匹配低风险模式: /${pattern.source}/`,
        };
      }
    }

    // 未识别的命令 → 中风险（保守策略）
    return {
      level: 'medium',
      reason: `未识别的命令，默认中风险: "${trimmed.substring(0, 80)}"`,
    };
  }

  /**
   * 对 write_file 路径进行内置风险分级。
   */
  private assessWritePath(path: string): RiskAssessment {
    const trimmed = path.trim();

    // 空路径 → 中风险
    if (trimmed.length === 0) {
      return {
        level: 'medium',
        reason: '文件路径为空',
      };
    }

    // 系统目录检查
    for (const pattern of SYSTEM_PATH_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'high',
          action: 'confirm',
          reason: `路径匹配系统目录模式: /${pattern.source}/`,
        };
      }
    }

    // 父目录穿越检查
    for (const pattern of TRAVERSAL_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'high',
          action: 'confirm',
          reason: `路径包含父目录穿越 (../)`,
        };
      }
    }

    // 默认低风险（工作区内）
    return {
      level: 'low',
      reason: '路径在工作区范围内',
    };
  }
}
