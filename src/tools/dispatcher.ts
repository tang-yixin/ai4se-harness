import type { ToolCall, ExecutionResult } from '../core/types.js';
import type { ToolRegistry } from './registry.js';
import { Blacklist, GuardrailViolation } from './blacklist.js';

/**
 * 工具分发器 —— 接收 LLM 返回的 ToolCall，完成校验、黑名单检查、执行。
 *
 * 执行流程：
 * 1. 按 name 在 Registry 中查找工具
 * 2. JSON Schema 参数校验（确定性）
 * 3. execute_shell 硬黑名单检查
 * 4. 调用 tool.execute()
 */
export class ToolDispatcher {
  /**
   * 分发一个工具调用。
   * @param call LLM 返回的工具调用请求
   * @param registry 工具注册表
   * @returns 执行结果（成功或失败，不会抛出异常）
   */
  static async dispatch(
    call: ToolCall,
    registry: ToolRegistry,
  ): Promise<ExecutionResult> {
    // 1. 查找工具
    const tool = registry.get(call.name);
    if (!tool) {
      return {
        toolName: call.name,
        success: false,
        stdout: '',
        stderr: `Unknown tool: "${call.name}". Available tools: ${registry.list().map((t) => t.name).join(', ') || '(none)'}`,
        exitCode: 1,
      };
    }

    // 2. 参数校验（JSON Schema 子集：required + type）
    const validationError = validateParams(call.arguments, tool.parameters);
    if (validationError) {
      return {
        toolName: call.name,
        success: false,
        stdout: '',
        stderr: `Parameter validation failed: ${validationError}`,
        exitCode: 1,
      };
    }

    // 3. execute_shell 硬黑名单检查（第一层纵深防御）
    //    命中 → 抛出 GuardrailViolation，不进 LLM 上下文，直接终止
    if (call.name === 'execute_shell' && typeof call.arguments.command === 'string') {
      if (Blacklist.check(call.arguments.command)) {
        throw new GuardrailViolation(call.arguments.command);
      }
    }

    // 4. 执行工具
    try {
      return await tool.execute(call.arguments);
    } catch (error) {
      return {
        toolName: call.name,
        success: false,
        stdout: '',
        stderr: `Tool execution error: ${error instanceof Error ? error.message : String(error)}`,
        exitCode: 1,
      };
    }
  }
}

// ============================================================
// 内部参数校验函数
// ============================================================

/**
 * 对工具参数做 JSON Schema 子集校验。
 * 支持：required 字段检查、string/number 类型检查。
 *
 * @param args 实际传入的参数
 * @param schema 工具定义的 parameters schema
 * @returns 校验失败时返回错误描述字符串；通过返回 null
 */
function validateParams(
  args: Record<string, unknown>,
  schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] },
): string | null {
  // 检查必填字段
  for (const field of schema.required ?? []) {
    if (!(field in args) || args[field] === undefined) {
      return `Missing required parameter: "${field}"`;
    }
  }

  // 检查字段类型
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (key in args && args[key] !== undefined && args[key] !== null) {
      const ps = propSchema as { type?: string };
      const value = args[key];

      if (ps.type === 'string' && typeof value !== 'string') {
        return `Parameter "${key}" must be a string, got ${typeof value}`;
      }
      if (ps.type === 'number' && typeof value !== 'number') {
        return `Parameter "${key}" must be a number, got ${typeof value}`;
      }
      if (ps.type === 'boolean' && typeof value !== 'boolean') {
        return `Parameter "${key}" must be a boolean, got ${typeof value}`;
      }
      if (ps.type === 'array' && !Array.isArray(value)) {
        return `Parameter "${key}" must be an array, got ${typeof value}`;
      }
      if (ps.type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
        return `Parameter "${key}" must be an object, got ${typeof value}`;
      }
    }
  }

  return null;
}
