import type { ToolRegistry } from '../registry.js';
import { listDirectoryTool } from './list-directory.js';
import { searchCodeTool } from './search-code.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { executeShellTool } from './execute-shell.js';

export { listDirectoryTool } from './list-directory.js';
export { searchCodeTool } from './search-code.js';
export { readFileTool } from './read-file.js';
export { writeFileTool } from './write-file.js';
export { executeShellTool } from './execute-shell.js';

/**
 * 将所有 5 个内置工具注册到给定的 ToolRegistry 中。
 * 工具列表：
 * - list_directory（读，low）—— 列出目录
 * - search_code（读，low）—— grep 搜索
 * - read_file（读，low）—— 读取文件
 * - write_file（写，medium）—— 写入文件
 * - execute_shell（执行，high）—— shell 命令
 */
export function registerAllTools(registry: ToolRegistry): void {
  registry.register(listDirectoryTool);
  registry.register(searchCodeTool);
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(executeShellTool);
}
