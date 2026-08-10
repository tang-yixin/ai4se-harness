import { existsSync } from 'fs';

/**
 * 平台相关工具函数。
 * 提供跨平台的 shell 检测等通用能力。
 */

/**
 * 获取当前平台的默认 shell。
 * - Windows：优先使用 Git Bash 的 bash.exe（grep 依赖 POSIX shell），
 *   不可用时降级到 cmd.exe。
 * - Unix/macOS：使用 $SHELL 或 /bin/sh。
 */
export function getDefaultShell(): string {
  if (process.platform === 'win32') {
    // Git Bash 通常安装在以下路径之一
    const gitBashPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const bashPath of gitBashPaths) {
      if (existsSync(bashPath)) {
        return bashPath;
      }
    }
    return process.env.ComSpec || 'cmd.exe';
  }
  return process.env.SHELL || '/bin/sh';
}
