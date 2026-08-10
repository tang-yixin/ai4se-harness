import type { Tool } from '../../core/types.js';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

/**
 * write_file 内置工具 —— 创建或覆盖文件。
 * 写入前自动创建所需目录。风险等级 medium —— 会修改文件系统。
 */
export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Create or overwrite a file with given content. Creates parent directories as needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write to.' },
      content: { type: 'string', description: 'Content to write into the file.' },
    },
    required: ['path', 'content'],
  },
  riskHint: 'medium',
  async execute(args) {
    try {
      const filePath = String(args.path);
      const content = String(args.content);

      // 确保父目录存在
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf-8');

      return {
        toolName: 'write_file',
        success: true,
        stdout: `File written: ${filePath} (${content.length} bytes)`,
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        toolName: 'write_file',
        success: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      };
    }
  },
};
