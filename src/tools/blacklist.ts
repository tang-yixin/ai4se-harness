/**
 * 硬黑名单 —— 第一层纵深防御。
 * 纯正则匹配引擎，对 execute_shell 的命令进行强制拦截。
 * 命中即阻止执行，不依赖任何智能判断。
 */

/** 禁止模式列表：匹配任一即拦截 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  // rm -rf /（递归强制删除根目录或系统目录）
  /rm\s+-rf\s+\//i,
  // format X: 等（Windows 格式化命令，A-Z 任意盘符）
  /format\s+[a-zA-Z]:/i,
  // shutdown / reboot / halt（系统关机/重启）
  /(shutdown|reboot|halt)/i,
  // dd if=（磁盘直接写入，可能覆盖引导扇区）
  /dd\s+if=/i,
  // 重定向覆盖 /dev/sd* 块设备
  />\s*\/dev\/sd/i,
];

/**
 * 黑名单违规异常。
 * 当命令命中硬黑名单时抛出，不进 LLM 上下文，直接终止当前动作。
 * 这是机械锁——不依赖任何智能判断。
 */
export class GuardrailViolation extends Error {
  /** 被拦截的命令 */
  readonly command: string;

  constructor(command: string) {
    super(`BLACKLIST BLOCK: command "${command}" is forbidden. ${Blacklist.REASON}`);
    this.name = 'GuardrailViolation';
    this.command = command;
  }
}

export class Blacklist {
  /** 黑名单拦截时的原因说明 */
  static readonly REASON = 'This command matches a hard-blocked pattern and cannot be executed.';

  /**
   * 检查命令是否命中硬黑名单。
   * @param command 待检查的 shell 命令字符串
   * @returns true 表示命中黑名单，应拦截；false 表示通过
   */
  static check(command: string): boolean {
    if (!command || command.trim().length === 0) {
      return false;
    }
    return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(command));
  }
}
