import type { Tool } from '../../core/types.js';
import { execSync } from 'child_process';
import { getDefaultShell } from '../../core/platform.js';

/**
 * execute_shell 内置工具 —— 执行 shell 命令。
 * 风险等级 high —— 可以执行任意命令。硬黑名单由 ToolDispatcher 在分发前拦截。
 */
export const executeShellTool: Tool = {
  name: 'execute_shell',
  description: 'Execute a shell command. Returns stdout, stderr, and exit code.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute.' },
      cwd: { type: 'string', description: 'Working directory for the command (default: current).' },
    },
    required: ['command'],
  },
  riskHint: 'high',
  async execute(args) {
    const command = String(args.command);

    try {
      const cwd = args.cwd ? String(args.cwd) : undefined;
      const result = execSync(command, {
        encoding: 'utf-8',
        timeout: 30000,
        cwd,
        shell: getDefaultShell(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      return {
        toolName: 'execute_shell',
        success: true,
        stdout: result,
        stderr: '',
        exitCode: 0,
      };
    } catch (error: any) {
      // execSync 在非零 exit code 或超时时抛出异常
      return {
        toolName: 'execute_shell',
        success: false,
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? error.message ?? String(error),
        exitCode: error.status ?? 1,
      };
    }
  },
};
