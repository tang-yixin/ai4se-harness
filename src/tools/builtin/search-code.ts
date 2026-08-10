import type { Tool } from '../../core/types.js';
import { execSync } from 'child_process';
import { getDefaultShell } from '../../core/platform.js';

/**
 * search_code 内置工具 —— 在代码库中通过 grep 搜索模式。
 * 纯读操作，风险等级低。
 *
 * 平台兼容说明：
 * - Unix/macOS：直接使用 grep -rn
 * - Windows：Git Bash 通常自带 grep；若不可用则尝试 findstr 降级
 */
export const searchCodeTool: Tool = {
  name: 'search_code',
  description:
    'Search codebase using grep. Provide a regex pattern. Searches .ts and .js files by default.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for.' },
      path: { type: 'string', description: 'Directory to search in (default: current directory).' },
    },
    required: ['pattern'],
  },
  riskHint: 'low',
  async execute(args) {
    try {
      const pattern = String(args.pattern);
      const searchDir = args.path ? String(args.path) : '.';

      // 优先使用 grep；失败时尝试 findstr（Windows 降级）
      const stdout = searchWithGrep(pattern, searchDir);

      return {
        toolName: 'search_code',
        success: true,
        stdout: stdout.trim(),
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'search_code',
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  },
};

/**
 * 使用 grep 搜索。优先尝试 grep，不可用时尝试 Windows findstr。
 * 自动排除 node_modules、dist、.git 等大型非源码目录。
 */
function searchWithGrep(pattern: string, searchDir: string): string {
  // 转义 pattern 中的单引号，防止 shell 注入
  const escapedPattern = pattern.replace(/'/g, "'\\''");

  // 排除目录列表（避免搜索 node_modules 等，防止超时）
  const excludeDirs = ['node_modules', 'dist', '.git', '.svn', 'coverage', '__pycache__'];
  const excludeArgs = excludeDirs.map((d) => `--exclude-dir=${d}`).join(' ');

  try {
    // 优先使用 grep（Unix / Git Bash）
    const result = execSync(
      `grep -rn ${excludeArgs} --include="*.ts" --include="*.js" --include="*.tsx" --include="*.jsx" '${escapedPattern}' "${searchDir}"`,
      {
        encoding: 'utf-8',
        timeout: 10000,
        shell: getDefaultShell(),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return result;
  } catch (error: any) {
    // grep exit code 1 = no matches found（不是真正的错误）
    if (error.status === 1) {
      return 'No matches found.';
    }

    // grep exit code > 1 = 真正的错误（如目录不存在、权限不足）
    if (error.status > 1) {
      const detail = (error.stderr || error.stdout || error.message || '').trim();
      throw new Error(`grep failed with exit code ${error.status}: ${detail}`);
    }

    // grep 命令本身不存在 (ENOENT / not found) → 尝试 Windows findstr 降级
    if (error.code === 'ENOENT' || error.message?.includes('not found')) {
      return searchWithFindstr(pattern, searchDir);
    }

    // 其他未知错误
    throw new Error(`grep failed: ${error.message}`);
  }
}

/**
 * Windows 降级方案：使用 findstr 搜索。
 */
function searchWithFindstr(pattern: string, searchDir: string): string {
  try {
    const result = execSync(
      `findstr /s /i /r /c:"${pattern}" "${searchDir}\\*.ts" "${searchDir}\\*.js"`,
      {
        encoding: 'utf-8',
        timeout: 15000,
        shell: getDefaultShell(),
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return result || 'No matches found.';
  } catch (error: any) {
    if (error.status === 1 && !error.stdout) {
      return 'No matches found.';
    }
    throw new Error(`search_code failed: ${error.message}`);
  }
}
