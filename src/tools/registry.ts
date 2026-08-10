import type { Tool, ToolDef } from '../core/types.js';

/**
 * 工具注册表 —— 管理所有可用工具。
 * 每个工具实现 Tool 接口，通过 register() 注册到此表。
 * 主循环和分发器通过此表查找和执行工具。
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * 注册一个工具。同名工具会被覆盖（后注册的优先生效）。
   */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 按名称获取工具，未注册时返回 undefined。
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 返回所有已注册的工具列表。
   */
  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 将所有已注册工具转换为 LLM function-calling 所需的 ToolDef 格式。
   */
  toToolDefs(): ToolDef[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      riskHint: t.riskHint,
    }));
  }
}
