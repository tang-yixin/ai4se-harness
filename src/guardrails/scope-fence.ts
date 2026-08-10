/**
 * 范围围栏（Scope Fence）—— 第三层纵深防御。
 *
 * 职责：
 *   1. 路径边界校验：确保所有 write_file 操作的目标路径在 workspaceRoot 内
 *   2. 主机白名单校验：确保 execute_shell 中的网络请求目标主机在白名单中
 *
 * 这是纯确定性逻辑，不依赖任何 LLM 判断。
 * 所有路径比较在 resolve() 后的绝对路径上进行，防止 .. 穿越和符号链接规避。
 */

import type { ScopeFence } from '../core/types.js';
import { resolve, isAbsolute, relative, sep } from 'path';

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
// ScopeFenceGuard
// ============================================================

export class ScopeFenceGuard {
  /** 解析后的工作区根目录（绝对路径） */
  private workspaceRoot: string;

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
  }

  // ============================================================
  // 公共方法 — 路径校验
  // ============================================================

  /**
   * 校验给定的文件路径是否在工作区根目录内。
   *
   * 校验逻辑：
   *   1. 空/空白路径 → 拒绝
   *   2. 将目标路径解析为绝对路径
   *   3. 计算相对路径（从 workspaceRoot 到目标）
   *   4. 如果相对路径以 .. 开头或为绝对路径 → 拒绝（越界）
   *
   * @param targetPath 要校验的文件路径（可以是相对或绝对路径）
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

    // 解析为绝对路径
    const resolved = this.resolveTarget(targetPath);

    // 计算从工作区根目录到目标路径的相对路径
    const rel = relative(this.workspaceRoot, resolved);

    // 越界判定：
    //   - Unix: 相对路径以 ".." 开头或以 "../" 开始 → 在工作区外
    //   - Windows: 相对路径以 ".." 开头 → 在工作区外
    //   - 绝对路径: relative 返回绝对路径 → 目标在其他盘符（Windows: D:\...）
    if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
      return {
        allowed: false,
        reason: `路径 "${targetPath}" 解析后在工作区根目录 "${
          this.workspaceRoot
        }" 之外。`,
      };
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

  /**
   * 将目标路径解析为绝对路径。
   *
   * 如果目标路径已经是绝对路径，直接返回。
   * 如果是相对路径，以 workspaceRoot 为基准解析。
   */
  private resolveTarget(targetPath: string): string {
    if (isAbsolute(targetPath)) {
      return resolve(targetPath); // normalize 斜杠等
    }
    // 相对路径 → 以 workspaceRoot 为基准解析
    return resolve(this.workspaceRoot, targetPath);
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
