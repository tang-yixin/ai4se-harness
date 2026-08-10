import type { Tool } from '../../core/types.js';
import { readdirSync } from 'fs';

/**
 * list_directory 内置工具 —— 列出目录内容。
 * 纯读操作，风险等级低。条目前缀 'd' 表示目录，'-' 表示文件。
 */
export const listDirectoryTool: Tool = {
  name: 'list_directory',
  description: 'List contents of a directory. Entries prefixed with "d" are directories, "-" are files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list.' },
    },
    required: ['path'],
  },
  riskHint: 'low',
  async execute(args) {
    try {
      const dirPath = String(args.path);
      const entries = readdirSync(dirPath, { withFileTypes: true });
      const lines = entries.map(
        (entry) => `${entry.isDirectory() ? 'd' : '-'} ${entry.name}`,
      );
      return {
        toolName: 'list_directory',
        success: true,
        stdout: lines.join('\n'),
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'list_directory',
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  },
};
