import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ToolDispatcher } from '../../src/tools/dispatcher.js';
import { Blacklist, GuardrailViolation } from '../../src/tools/blacklist.js';
import { Tool, ExecutionResult } from '../../src/core/types.js';

// ============================================================
// 测试用 mock 工具工厂
// ============================================================

/**
 * 创建一个简单的 mock 工具，可配置名称、参数 schema、执行行为。
 */
function createMockTool(overrides?: Partial<Tool>): Tool {
  return {
    name: 'echo',
    description: 'Echo back input',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    riskHint: 'low',
    execute: async (args) => ({
      toolName: 'echo',
      success: true,
      stdout: String(args.message),
      stderr: '',
      exitCode: 0,
    }),
    ...overrides,
  };
}

// 需要同时有 string 和 number 参数的工具
const mixedParamTool: Tool = {
  name: 'set_config',
  description: 'Set a numeric config value',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'number' },
    },
    required: ['key', 'value'],
  },
  riskHint: 'low',
  execute: async (args) => ({
    toolName: 'set_config',
    success: true,
    stdout: `${args.key}=${args.value}`,
    stderr: '',
    exitCode: 0,
  }),
};

// ============================================================
// ToolRegistry 测试
// ============================================================

describe('ToolRegistry', () => {
  it('注册并获取工具', () => {
    const registry = new ToolRegistry();
    const tool = createMockTool();
    registry.register(tool);

    expect(registry.get('echo')).toBe(tool);
  });

  it('获取不存在的工具返回 undefined', () => {
    const registry = new ToolRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('列出所有已注册工具', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool({ name: 'tool_a' }));
    registry.register(createMockTool({ name: 'tool_b' }));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name).sort()).toEqual(['tool_a', 'tool_b']);
  });

  it('空注册表返回空列表', () => {
    const registry = new ToolRegistry();
    expect(registry.list()).toEqual([]);
  });

  it('生成 LLM 可用的 ToolDef', () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool());

    const defs = registry.toToolDefs();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('echo');
    expect(defs[0].description).toBe('Echo back input');
    expect(defs[0].parameters).toEqual({
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    });
    expect(defs[0].riskHint).toBe('low');
  });

  it('空注册表的 toToolDefs 返回空数组', () => {
    const registry = new ToolRegistry();
    expect(registry.toToolDefs()).toEqual([]);
  });

  it('重复注册同名工具会覆盖旧工具', () => {
    const registry = new ToolRegistry();
    const first = createMockTool({ name: 'my_tool', description: 'First' });
    const second = createMockTool({ name: 'my_tool', description: 'Second' });

    registry.register(first);
    registry.register(second);

    expect(registry.get('my_tool')).toBe(second);
    expect(registry.list()).toHaveLength(1);
  });

  it('注册多个不同工具后 list 返回正确个数', () => {
    const registry = new ToolRegistry();
    const names = ['a', 'b', 'c', 'd', 'e'];

    for (const name of names) {
      registry.register(createMockTool({ name }));
    }

    expect(registry.list()).toHaveLength(5);
    for (const name of names) {
      expect(registry.get(name)).toBeDefined();
    }
  });
});

// ============================================================
// ToolDispatcher 测试
// ============================================================

describe('ToolDispatcher', () => {
  it('分发工具调用并返回执行结果', async () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool());

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'echo', arguments: { message: 'hello' } },
      registry,
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('hello');
    expect(result.toolName).toBe('echo');
    expect(result.exitCode).toBe(0);
  });

  it('未知工具返回错误', async () => {
    const registry = new ToolRegistry();

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'unknown_tool', arguments: {} },
      registry,
    );

    expect(result.success).toBe(false);
    expect(result.toolName).toBe('unknown_tool');
    expect(result.stderr).toContain('Unknown tool');
    expect(result.exitCode).toBe(1);
  });

  it('缺少必填参数时校验失败', async () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool());

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'echo', arguments: {} }, // 缺少 'message'
      registry,
    );

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/parameter/i);
    expect(result.stderr).toContain('message');
  });

  it('参数类型错误时校验失败——string 应为 number', async () => {
    const registry = new ToolRegistry();
    registry.register(mixedParamTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'set_config', arguments: { key: 'port', value: 'not-a-number' } },
      registry,
    );

    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/parameter/i);
    expect(result.stderr).toContain('number');
  });

  it('参数类型错误时校验失败——number 应为 string', async () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool());

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'echo', arguments: { message: 42 } },
      registry,
    );

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('string');
  });

  it('正确类型的参数校验通过', async () => {
    const registry = new ToolRegistry();
    registry.register(mixedParamTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'set_config', arguments: { key: 'port', value: 8080 } },
      registry,
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('port=8080');
  });

  it('execute_shell 命中黑名单时抛出 GuardrailViolation', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'execute_shell',
      description: 'Execute shell command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      riskHint: 'high',
      execute: async (args) => ({
        toolName: 'execute_shell',
        success: true,
        stdout: String(args.command),
        stderr: '',
        exitCode: 0,
      }),
    });

    await expect(
      ToolDispatcher.dispatch(
        { id: '1', name: 'execute_shell', arguments: { command: 'rm -rf /' } },
        registry,
      ),
    ).rejects.toThrow(GuardrailViolation);

    // 验证异常包含被拦截的命令
    try {
      await ToolDispatcher.dispatch(
        { id: '2', name: 'execute_shell', arguments: { command: 'shutdown -h now' } },
        registry,
      );
      expect.fail('应该抛出异常');
    } catch (error) {
      expect(error).toBeInstanceOf(GuardrailViolation);
      expect((error as GuardrailViolation).command).toBe('shutdown -h now');
      expect(error.message).toContain('BLACKLIST');
    }
  });

  it('execute_shell 安全命令不被黑名单拦截', async () => {
    const registry = new ToolRegistry();
    let executed = false;
    registry.register({
      name: 'execute_shell',
      description: 'Execute shell command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command'],
      },
      riskHint: 'high',
      execute: async (args) => {
        executed = true;
        return {
          toolName: 'execute_shell',
          success: true,
          stdout: `executed: ${args.command}`,
          stderr: '',
          exitCode: 0,
        };
      },
    });

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'execute_shell', arguments: { command: 'npm test' } },
      registry,
    );

    expect(result.success).toBe(true);
    expect(executed).toBe(true);
  });

  it('工具 execute 抛出异常时被捕获并返回错误结果', async () => {
    const registry = new ToolRegistry();
    registry.register(
      createMockTool({
        execute: async () => {
          throw new Error('Boom!');
        },
      }),
    );

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'echo', arguments: { message: 'test' } },
      registry,
    );

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('Boom!');
    expect(result.exitCode).toBe(1);
  });

  it('多余参数不影响校验（允许额外参数通过）', async () => {
    const registry = new ToolRegistry();
    registry.register(createMockTool());

    // 传了 required 的 'message'，加上额外的 'extra' 参数
    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'echo', arguments: { message: 'hello', extra: 'ignored' } },
      registry,
    );

    expect(result.success).toBe(true);
    expect(result.stdout).toBe('hello');
  });

  it('参数值为 undefined（非缺失）但存在 key 时视为有效', async () => {
    const registry = new ToolRegistry();
    // 没有 required 参数的工具
    registry.register({
      name: 'optional_tool',
      description: 'Has optional params',
      parameters: {
        type: 'object',
        properties: { opt: { type: 'string' } },
      },
      riskHint: 'low',
      execute: async (args) => ({
        toolName: 'optional_tool',
        success: true,
        stdout: `opt=${args.opt}`,
        stderr: '',
        exitCode: 0,
      }),
    });

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'optional_tool', arguments: {} },
      registry,
    );

    expect(result.success).toBe(true);
  });
});

// ============================================================
// Blacklist 测试
// ============================================================

describe('Blacklist', () => {
  // ---- 应被拦截的命令 ----

  it('拦截 rm -rf /', () => {
    expect(Blacklist.check('rm -rf /')).toBe(true);
    expect(Blacklist.check('rm -rf /etc')).toBe(true);
    expect(Blacklist.check('rm -rf / --no-preserve-root')).toBe(true);
  });

  it('拦截 rm -rf 变体（大小写）', () => {
    expect(Blacklist.check('RM -RF /')).toBe(true);
    expect(Blacklist.check('Rm -Rf /tmp')).toBe(true);
  });

  it('拦截 format 命令（含 A/B 盘符）', () => {
    expect(Blacklist.check('format C:')).toBe(true);
    expect(Blacklist.check('format d: /q')).toBe(true);
    expect(Blacklist.check('format A:')).toBe(true);
    expect(Blacklist.check('format B: /FS:NTFS')).toBe(true);
    expect(Blacklist.check('FORMAT C: /FS:NTFS')).toBe(true);
  });

  it('拦截 shutdown', () => {
    expect(Blacklist.check('shutdown -h now')).toBe(true);
    expect(Blacklist.check('shutdown /s')).toBe(true);
  });

  it('拦截 reboot', () => {
    expect(Blacklist.check('reboot')).toBe(true);
    expect(Blacklist.check('reboot -f')).toBe(true);
  });

  it('拦截 halt', () => {
    expect(Blacklist.check('halt')).toBe(true);
    expect(Blacklist.check('halt -p')).toBe(true);
  });

  it('拦截 dd if=', () => {
    expect(Blacklist.check('dd if=/dev/zero of=/dev/sda')).toBe(true);
    expect(Blacklist.check('dd if=/dev/urandom of=/tmp/test bs=1M count=100')).toBe(true);
  });

  it('拦截重定向到 /dev/sd 设备', () => {
    expect(Blacklist.check('cat file > /dev/sda')).toBe(true);
    expect(Blacklist.check('echo test > /dev/sdb1')).toBe(true);
  });

  // ---- 不应被拦截的命令 ----

  it('放行安全的读操作命令', () => {
    expect(Blacklist.check('ls -la')).toBe(false);
    expect(Blacklist.check('cat package.json')).toBe(false);
    expect(Blacklist.check('echo hello')).toBe(false);
    expect(Blacklist.check('pwd')).toBe(false);
  });

  it('放行开发相关命令', () => {
    expect(Blacklist.check('npm test')).toBe(false);
    expect(Blacklist.check('npm run build')).toBe(false);
    expect(Blacklist.check('npx vitest run')).toBe(false);
    expect(Blacklist.check('git status')).toBe(false);
    expect(Blacklist.check('git diff')).toBe(false);
    expect(Blacklist.check('npx tsc --noEmit')).toBe(false);
  });

  // ---- 边界情况 ----

  it('空字符串返回 false', () => {
    expect(Blacklist.check('')).toBe(false);
  });

  it('仅空格字符返回 false', () => {
    expect(Blacklist.check('   ')).toBe(false);
  });

  it('命令中包含但不完全匹配黑名单模式时放行', () => {
    // "format" 只应匹配 format C: 格式，而不是任意含 format 的字符串
    // 但当前规则是 /\bformat\s+[c-zC-Z]:/i 所以 "npm run format" 不匹配
    expect(Blacklist.check('npm run format')).toBe(false);
  });

  it('Blacklist.REASON 是字符串', () => {
    expect(typeof Blacklist.REASON).toBe('string');
    expect(Blacklist.REASON.length).toBeGreaterThan(0);
  });

  it('多次调用返回一致结果', () => {
    // 确保无状态副作用
    expect(Blacklist.check('rm -rf /')).toBe(true);
    expect(Blacklist.check('rm -rf /')).toBe(true);
    expect(Blacklist.check('ls')).toBe(false);
    expect(Blacklist.check('ls')).toBe(false);
  });
});
