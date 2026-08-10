import type { Tool } from '../../core/types.js';
import { readFileSync } from 'fs';

/**
 * read_file 内置工具 —— 读取文件全部内容。
 * 纯读操作，风险等级低，不影响文件系统状态。
 */
export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the entire content of a file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to read.' },
    },
    required: ['path'],
  },
  riskHint: 'low',
  async execute(args) {
    try {
      const filePath = String(args.path);
      const content = readFileSync(filePath, 'utf-8');
      return {
        toolName: 'read_file',
        success: true,
        stdout: content,
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'read_file',
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  },
};
