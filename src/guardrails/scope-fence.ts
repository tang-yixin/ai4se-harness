/**
 * 范围围栏（Scope Fence）—— 第三层纵深防御。
 *
 * 职责：
 *   1. 路径边界校验：确保所有 write_file 操作的目标路径在 workspaceRoot 内
 *   2. 主机白名单校验：确保 execute_shell 中的网络请求目标主机在白名单中
 *
 * 这是纯确定性逻辑，不依赖任何 LLM 判断。
 *
 * 路径比较采用「平台无关」策略：先把 Windows 反斜杠统一为正斜杠、显式识别
 * 盘符绝对路径（C:\... / D:/...），再在纯 POSIX 语义下用 posix.relative 判断
 * 是否越界。这样无论 harness 跑在 Linux / macOS / Windows，都能一致地识别并
 * 拦截两种风格的父目录穿越（../ 与 ..\）以及跨盘符绝对路径。
 */

import type { ScopeFence } from '../core/types.js';
import { resolve, posix } from 'path';

/** Windows 盘符绝对路径（C:\... / D:/...） */
const WIN_DRIVE_RE = /^([A-Za-z]):[\\/](.*)$/;

// ============================================================
// 校验结果接口
// ============================================================

/** validatePath 和 validateHost 返回的校验结果 */
export interface FenceResult {
  /** 是否放行 */
  allowed: boolean;
  /** 拒绝原因（仅 allowed=false 时有值） */
  reason?: string;
}

// ============================================================
// 平台无关的路径解析辅助
// ============================================================

/** 解析后的绝对路径表示：盘符（小写或 null）+ POSIX 绝对路径 */
interface ParsedPath {
  /** Windows 盘符（小写），无盘符为 null */
  drive: string | null;
  /** 盘符后的 POSIX 绝对路径（如 /Users/dev/project） */
  path: string;
}

/**
 * 将工作区根解析为平台无关的 (盘符, 绝对路径)。
 *
 * - 盘符绝对路径（C:\...）直接识别，避免被 Linux 的 resolve 破坏盘符语义
 * - 非盘符路径用平台 resolve 绝对化（保证 . → 工作目录），再归一化正斜杠，
 *   并剥离 Windows 上 resolve 可能引入的盘符（resolve('.') 在 Windows 上返回 C:\...）
 */
function parseRoot(raw: string): ParsedPath {
  const slash = raw.replace(/\\/g, '/');
  const m = slash.match(WIN_DRIVE_RE);
  if (m) {
    return { drive: m[1].toLowerCase(), path: '/' + m[2] };
  }
  const abs = resolve(raw).replace(/\\/g, '/');
  const am = abs.match(WIN_DRIVE_RE);
  if (am) {
    return { drive: am[1].toLowerCase(), path: '/' + am[2] };
  }
  return { drive: null, path: abs };
}

/**
 * 将目标路径解析为 (盘符, 绝对路径)，相对路径以 rootPath 为基准解析。
 */
function parseTarget(
  raw: string,
  rootDrive: string | null,
  rootPath: string,
): ParsedPath {
  const slash = raw.replace(/\\/g, '/');
  const m = slash.match(WIN_DRIVE_RE);
  if (m) {
    return { drive: m[1].toLowerCase(), path: '/' + m[2] };
  }
  if (slash.startsWith('/')) {
    // POSIX 绝对路径；在 Windows 盘符工作区语义下表示「当前盘符根」
    return { drive: rootDrive, path: slash };
  }
  return { drive: rootDrive, path: posix.resolve(rootPath, slash) };
}

/**
 * 判断 POSIX 绝对路径 target 是否在 root 之外（越界）。
 */
function isOutside(root: string, target: string): boolean {
  const rel = posix.relative(root, target);
  return rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel);
}

// ============================================================
// ScopeFenceGuard
// ============================================================

export class ScopeFenceGuard {
  /** 平台格式的工作区根目录（getWorkspaceRoot 返回，保留平台原生路径形式） */
  private workspaceRoot: string;

  /** 工作区根盘符（小写）；非盘符为 null */
  private rootDrive: string | null;

  /** 工作区根盘符后的 POSIX 绝对路径（用于平台无关越界判定） */
  private rootPath: string;

  /** 允许访问的主机白名单（裸主机名，不含协议和端口） */
  private allowedHosts: string[];

  /** shell 命令最大执行时间（ms） */
  readonly maxShellTimeMs: number;

  /**
   * @param config 围栏配置（来自 HarnessConfig.scope）
   */
  constructor(config: ScopeFence) {
    this.workspaceRoot = resolve(config.workspaceRoot);
    this.allowedHosts = [...config.allowedHosts];
    this.maxShellTimeMs = config.maxShellTimeMs;

    const root = parseRoot(config.workspaceRoot);
    this.rootDrive = root.drive;
    this.rootPath = root.path;
  }

  // ============================================================
  // 公共方法 — 路径校验
  // ============================================================

  /**
   * 校验给定的文件路径是否在工作区根目录内。
   *
   * 校验逻辑（平台无关）：
   *   1. 空/空白路径 → 拒绝
   *   2. 归一化分隔符（\ → /）并识别盘符绝对路径
   *   3. 盘符不一致（含「目标有盘符、工作区无盘符」或反之）→ 拒绝
   *   4. 盘符一致时，用 POSIX 语义判断盘符后路径是否越界
   *
   * @param targetPath 要校验的文件路径（相对/绝对，POSIX 或 Windows 风格）
   * @returns 校验结果
   */
  validatePath(targetPath: string): FenceResult {
    // 空/空白路径 → 拒绝
    if (!targetPath || targetPath.trim().length === 0) {
      return {
        allowed: false,
        reason: '路径为空或纯空白，拒绝写入操作。',
      };
    }

    const target = parseTarget(targetPath.trim(), this.rootDrive, this.rootPath);

    if (target.drive !== this.rootDrive) {
      return this.deny(targetPath);
    }

    if (isOutside(this.rootPath, target.path)) {
      return this.deny(targetPath);
    }

    return { allowed: true };
  }

  // ============================================================
  // 公共方法 — 主机校验
  // ============================================================

  /**
   * 校验给定的主机名/URL 是否在白名单中。
   *
   * 校验逻辑：
   *   1. 空/空白 → 拒绝
   *   2. 提取裸主机名（去掉协议、端口、路径、query、hash）
   *   3. 精确匹配白名单
   *
   * 注意：子域名不被父域名隐式允许。例如白名单中有 github.com 时，
   * api.github.com 不会被允许（除非显式加入白名单）。
   *
   * @param hostOrUrl 主机名或完整 URL
   * @returns 校验结果
   */
  validateHost(hostOrUrl: string): FenceResult {
    // 空/空白 → 拒绝
    if (!hostOrUrl || hostOrUrl.trim().length === 0) {
      return {
        allowed: false,
        reason: '主机名或 URL 为空，拒绝网络操作。',
      };
    }

    const hostname = this.extractHostname(hostOrUrl);

    // 再次检查提取后的主机名是否为空
    if (hostname.length === 0) {
      return {
        allowed: false,
        reason: `无法从 "${hostOrUrl}" 中提取有效的主机名。`,
      };
    }

    if (this.allowedHosts.includes(hostname)) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `主机 "${hostname}" 不在允许的主机列表中：[${this.allowedHosts.join(', ')}]。`,
    };
  }

  // ============================================================
  // 公共方法 — shell 命令输出路径校验
  // ============================================================

  /**
   * 从 shell 命令中提取输出目标路径，并用 validatePath() 逐一校验。
   *
   * 目的：防止 agent 通过 shell 重定向（> / >> / tee / dd of=）将内容
   * 写入工作区外，从而绕过 write_file 的路径边界检查。
   *
   * 覆盖的重定向模式：
   * - 标准输出重定向：>、>>、1>、2>、&>、1>>、2>>、&>>
   * - tee 命令（含 -a 追加模式）
   * - dd 命令的 of= 参数
   *
   * 已知局限（在 JSDoc 中显式标注）：
   * - **cd 绕过**：`cd .. && echo hello > test.txt` 无法静态检测——cd 改变
   *   的是 shell 进程的 CWD，字符串层面无法判定 test.txt 最终落点。
   *   这是 shell 灵活性的固有限制，不尝试修复。
   * - **引号、eval、heredoc、动态变量展开**：正则解析不处理 shell 语法，
   *   复杂构造无法覆盖。
   * - **误拦截风险**：极少数情况下，命令字符串中含 `>` 字符（如 echo ">"）
   *   可能触发假阳性提取。提取到的"路径"经 validatePath() 判定在工作区内
   *   时会放行，仍有可能越界的假路径被误拦，但比漏拦更安全。
   *
   * 策略：提取不到路径 → 放行（保守，不过度拦截）。
   *       任一提取路径越界 → 拒绝。
   *
   * @param command shell 命令字符串
   * @returns 校验结果
   */
  validateShellCommand(command: string): FenceResult {
    // 空/空白命令 → 放行
    if (!command || command.trim().length === 0) {
      return { allowed: true };
    }

    // 提取所有输出目标路径
    const paths = this.extractShellOutputPaths(command);

    // 无提取路径 → 放行（保守策略：不理解的不拦截）
    if (paths.length === 0) {
      return { allowed: true };
    }

    // 逐个校验：任一越界则拒绝
    for (const path of paths) {
      const result = this.validatePath(path);
      if (!result.allowed) {
        return result;
      }
    }

    return { allowed: true };
  }

  // ============================================================
  // 属性访问器
  // ============================================================

  /** 获取工作区根目录的绝对路径 */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /** 获取允许的主机列表（只读副本） */
  getAllowedHosts(): string[] {
    return [...this.allowedHosts];
  }

  /** 获取最大 shell 执行时间 */
  getMaxShellTimeMs(): number {
    return this.maxShellTimeMs;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /** 构造路径越界的拒绝结果 */
  private deny(targetPath: string): FenceResult {
    return {
      allowed: false,
      reason: `路径 "${targetPath}" 解析后在工作区根目录 "${
        this.workspaceRoot
      }" 之外。`,
    };
  }

  /**
   * 从 shell 命令字符串中提取所有输出目标路径。
   *
   * 支持三种输出模式：
   * 1. 重定向操作符：>  >>  1>  2>  &>  1>>  2>>  &>>
   * 2. tee 命令（含 -a 等标志位）
   * 3. dd 命令的 of= 参数
   *
   * @param command shell 命令字符串
   * @returns 提取到的路径数组（可能为空）
   */
  private extractShellOutputPaths(command: string): string[] {
    const paths: string[] = [];

    // 模式 1: 重定向 — [N][&]>>? path
    // 匹配: 可选数字前缀 + 可选 & + 一个或多个 > + 可选空格 + 路径token
    const redirectRe = /[0-9]*&?>+\s*([^\s|;&<>]+)/g;
    let match: RegExpExecArray | null;
    while ((match = redirectRe.exec(command)) !== null) {
      const path = match[1];
      if (path && path.length > 0) {
        paths.push(path);
      }
    }

    // 模式 2: tee [-flags] path
    const teeRe = /tee(?:\s+-[a-zA-Z0-9]+)*\s+([^\s|;&<>]+)/g;
    while ((match = teeRe.exec(command)) !== null) {
      const path = match[1];
      if (path && path.length > 0) {
        paths.push(path);
      }
    }

    // 模式 3: dd if=... of=path
    const ddRe = /\bdd\b.*?\bof=([^\s|;&<>]+)/g;
    // reset lastIndex before use (regexes above may have consumed the string)
    while ((match = ddRe.exec(command)) !== null) {
      const path = match[1];
      if (path && path.length > 0) {
        paths.push(path);
      }
    }

    return paths;
  }

  /**
   * 从 URL 或主机名字符串中提取裸主机名。
   *
   * 示例：
   *   "github.com"                → "github.com"
   *   "https://github.com"        → "github.com"
   *   "github.com:443"            → "github.com"
   *   "https://github.com/a/b"    → "github.com"
   *   "http://user@github.com:80" → "github.com"
   */
  private extractHostname(hostOrUrl: string): string {
    let host = hostOrUrl.trim();

    // 去掉协议前缀（https?://）
    const protocolMatch = host.match(/^https?:\/\/(.+)$/i);
    if (protocolMatch) {
      host = protocolMatch[1];
    }

    // 去掉认证信息 (user:pass@)
    const atIndex = host.lastIndexOf('@');
    if (atIndex !== -1) {
      host = host.substring(atIndex + 1);
    }

    // 去掉端口（:port）
    // 注意：IPv6 地址形如 [::1]:8080，需要特殊处理
    // 提取后去掉方括号，以匹配白名单中不加括号的写法（如 ::1）
    if (host.startsWith('[')) {
      const bracketEnd = host.indexOf(']');
      if (bracketEnd !== -1) {
        host = host.substring(1, bracketEnd); // 去掉方括号，[::1] → ::1
      }
    } else {
      // IPv4 / 主机名：host:port → host
      const colonIndex = host.indexOf(':');
      if (colonIndex !== -1) {
        host = host.substring(0, colonIndex);
      }
    }

    // 去掉路径、query、hash
    const pathIndex = host.indexOf('/');
    if (pathIndex !== -1) {
      host = host.substring(0, pathIndex);
    }

    return host;
  }
}
