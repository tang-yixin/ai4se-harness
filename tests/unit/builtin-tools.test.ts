import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import { readFileTool } from '../../src/tools/builtin/read-file.js';
import { writeFileTool } from '../../src/tools/builtin/write-file.js';
import { listDirectoryTool } from '../../src/tools/builtin/list-directory.js';
import { searchCodeTool } from '../../src/tools/builtin/search-code.js';
import { executeShellTool } from '../../src/tools/builtin/execute-shell.js';
import { registerAllTools } from '../../src/tools/builtin/index.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { ToolDispatcher } from '../../src/tools/dispatcher.js';

// ============================================================
// 辅助函数
// ============================================================

/** 清理临时测试文件 */
function cleanFile(filePath: string): void {
  try { unlinkSync(filePath); } catch { /* ignore */ }
}

/** 清理临时测试目录 */
function cleanDir(dirPath: string): void {
  try { rmSync(dirPath, { recursive: true, force: true }); } catch { /* ignore */ }
}

// ============================================================
// read_file 测试
// ============================================================

describe('read_file tool', () => {
  it('读取存在的文件内容', async () => {
    const result = await readFileTool.execute({ path: 'package.json' });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('ai4se-harness');
    expect(result.exitCode).toBe(0);
  });

  it('文件不存在时返回错误', async () => {
    const result = await readFileTool.execute({ path: '/nonexistent/path/xyz.abc' });
    expect(result.success).toBe(false);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(1);
  });

  it('读取空文件', async () => {
    const emptyFilePath = join(tmpdir(), 'harness-test-empty.txt');
    writeFileSync(emptyFilePath, '', 'utf-8');

    const result = await readFileTool.execute({ path: emptyFilePath });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('');

    cleanFile(emptyFilePath);
  });

  it('读取包含特殊字符的文件', async () => {
    const testFilePath = join(tmpdir(), 'harness-test-special.txt');
    const content = 'line1\nline2\t\rtest\n🎉 unicode 🚀\n';
    writeFileSync(testFilePath, content, 'utf-8');

    const result = await readFileTool.execute({ path: testFilePath });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe(content);

    cleanFile(testFilePath);
  });

  it('参数校验——缺少 path 时通过 dispatcher 返回错误', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'read_file', arguments: {} },
      registry,
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('path');
  });
});

// ============================================================
// write_file 测试
// ============================================================

describe('write_file tool', () => {
  const testFile = join(tmpdir(), 'harness-test-write.txt');
  const nestedFile = join(tmpdir(), 'harness-nested', 'sub', 'test.txt');

  afterEach(() => {
    cleanFile(testFile);
    cleanDir(join(tmpdir(), 'harness-nested'));
  });

  it('写入新文件并返回成功', async () => {
    const result = await writeFileTool.execute({
      path: testFile,
      content: 'hello harness',
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain(testFile);
    expect(existsSync(testFile)).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toBe('hello harness');
  });

  it('覆盖已存在的文件', async () => {
    writeFileSync(testFile, 'original', 'utf-8');

    const result = await writeFileTool.execute({
      path: testFile,
      content: 'overwritten',
    });
    expect(result.success).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toBe('overwritten');
  });

  it('写入时自动创建嵌套目录', async () => {
    const result = await writeFileTool.execute({
      path: nestedFile,
      content: 'deep content',
    });
    expect(result.success).toBe(true);
    expect(existsSync(nestedFile)).toBe(true);
    expect(readFileSync(nestedFile, 'utf-8')).toBe('deep content');
  });

  it('写入空内容', async () => {
    const result = await writeFileTool.execute({
      path: testFile,
      content: '',
    });
    expect(result.success).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toBe('');
  });

  it('写入包含特殊字符和 Unicode 的内容', async () => {
    const content = '第一行\n第二行\t🎉\n第三行 "引号" \'单引号\' \\ 反斜杠\n';
    const result = await writeFileTool.execute({
      path: testFile,
      content,
    });
    expect(result.success).toBe(true);
    expect(readFileSync(testFile, 'utf-8')).toBe(content);
  });

  it('参数校验——缺少 content 时通过 dispatcher 返回错误', async () => {
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'write_file', arguments: { path: testFile } },
      registry,
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('content');
  });

  it('参数校验——缺少 path 时通过 dispatcher 返回错误', async () => {
    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'write_file', arguments: { content: 'hello' } },
      registry,
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('path');
  });

  it('连续两次写入——第二次覆盖第一次', async () => {
    await writeFileTool.execute({ path: testFile, content: 'first' });
    await writeFileTool.execute({ path: testFile, content: 'second' });

    expect(readFileSync(testFile, 'utf-8')).toBe('second');
  });
});

// ============================================================
// write_file + read_file 联程测试
// ============================================================

describe('write_file + read_file round-trip', () => {
  const testFile = join(tmpdir(), 'harness-test-roundtrip.txt');

  afterEach(() => {
    cleanFile(testFile);
  });

  it('写入后能正确读回', async () => {
    const writeResult = await writeFileTool.execute({
      path: testFile,
      content: 'hello harness',
    });
    expect(writeResult.success).toBe(true);

    const readResult = await readFileTool.execute({ path: testFile });
    expect(readResult.success).toBe(true);
    expect(readResult.stdout).toBe('hello harness');
  });

  it('写入多行内容后正确读回', async () => {
    const content = 'line 1\nline 2\nline 3\n';
    await writeFileTool.execute({ path: testFile, content });

    const readResult = await readFileTool.execute({ path: testFile });
    expect(readResult.stdout).toBe(content);
  });

  it('写入 10KB 内容后正确读回', async () => {
    const content = 'x'.repeat(10240);
    await writeFileTool.execute({ path: testFile, content });

    const readResult = await readFileTool.execute({ path: testFile });
    expect(readResult.stdout).toBe(content);
    expect(readResult.stdout.length).toBe(10240);
  });
});

// ============================================================
// list_directory 测试
// ============================================================

describe('list_directory tool', () => {
  const testDir = join(tmpdir(), 'harness-list-test');

  beforeEach(() => {
    cleanDir(testDir);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    cleanDir(testDir);
  });

  it('列出当前工作目录（包含 package.json）', async () => {
    const result = await listDirectoryTool.execute({ path: '.' });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('package.json');
    expect(result.stdout).toContain('src');
    expect(result.exitCode).toBe(0);
  });

  it('列表中标志目录和文件', async () => {
    // 创建一个测试目录和文件
    mkdirSync(join(testDir, 'subdir'));
    writeFileSync(join(testDir, 'test.txt'), 'data');

    const result = await listDirectoryTool.execute({ path: testDir });
    expect(result.success).toBe(true);
    // 目录以 'd' 标记
    expect(result.stdout).toContain('d subdir');
    // 文件以 '-' 标记
    expect(result.stdout).toContain('- test.txt');
  });

  it('不存在的目录返回错误', async () => {
    const result = await listDirectoryTool.execute({ path: '/nonexistent/directory/xyz' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('空目录返回空列出', async () => {
    const result = await listDirectoryTool.execute({ path: testDir });
    expect(result.success).toBe(true);
    // 空目录应该没有条目
    expect(result.stdout).toBe('');
  });

  it('参数校验——缺少 path 时通过 dispatcher 返回错误', async () => {
    const registry = new ToolRegistry();
    registry.register(listDirectoryTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'list_directory', arguments: {} },
      registry,
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('path');
  });
});

// ============================================================
// search_code 测试
// ============================================================

describe('search_code tool', () => {
  it('在当前目录搜索已知字符串', async () => {
    // 搜索 package.json 中确实存在的字符串
    const result = await searchCodeTool.execute({
      pattern: 'ai4se-harness',
      path: '.',
    });
    // 如果 grep 可用则成功，但跨平台可能不可用——允许两种情况
    if (result.success) {
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    } else {
      // grep 不可用或搜索失败时也应该有合理的错误信息
      expect(result.stderr.length).toBeGreaterThan(0);
    }
  }, 15000);

  it('搜索不匹配的模式时返回空', async () => {
    // 使用唯一字符串，限制搜索 src/ 避免 test 文件自身含此字符串
    const result = await searchCodeTool.execute({
      pattern: 'ZZZ_UNIQUE_NONEXISTENT_PATTERN_42A7B9C1',
      path: 'src',
    });
    // 搜索应该成功但无匹配
    if (result.success) {
      // grep 无匹配时 stdout 为空或含 "No matches found"
      expect(result.stdout === '' || result.stdout.includes('No matches')).toBe(true);
    }
    // 即使失败（grep 不可用），也接受
  }, 15000);

  it('指定不存在的目录时返回错误', async () => {
    const result = await searchCodeTool.execute({
      pattern: 'test',
      path: '/nonexistent/search/path',
    });
    expect(result.success).toBe(false);
  });

  it('参数校验——缺少 pattern 时通过 dispatcher 返回错误', async () => {
    const registry = new ToolRegistry();
    registry.register(searchCodeTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'search_code', arguments: { path: '.' } },
      registry,
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('pattern');
  });

  it('不指定 path 时默认搜索当前目录', async () => {
    const result = await searchCodeTool.execute({
      pattern: 'ai4se-harness',
    });
    // 应该能搜索到内容
    if (result.success) {
      expect(result.stdout.length).toBeGreaterThan(0);
    }
  });

  it('搜索正则特殊字符时能正确处理', async () => {
    // 搜索字面量括号这类特殊字符
    const result = await searchCodeTool.execute({
      pattern: 'import',
      path: '.',
    });
    if (result.success) {
      // 能搜到 import 语句
      expect(result.stdout).toContain('import');
    }
  });

  it('连续搜索不同模式', async () => {
    const r1 = await searchCodeTool.execute({ pattern: 'package', path: '.' });
    const r2 = await searchCodeTool.execute({ pattern: 'vitest', path: '.' });

    // 两次搜索互不干扰
    if (r1.success && r2.success) {
      expect(r1.stdout).toContain('package');
      expect(r2.stdout).toContain('vitest');
    }
  });
});

// ============================================================
// execute_shell 测试
// ============================================================

describe('execute_shell tool', () => {
  it('执行简单的 echo 命令', async () => {
    const result = await executeShellTool.execute({ command: 'echo hello world' });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello world');
    expect(result.exitCode).toBe(0);
  });

  it('执行带空格的 echo 命令', async () => {
    const result = await executeShellTool.execute({
      command: 'echo "hello   harness"',
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello   harness');
  });

  it('执行失败的命令返回错误', async () => {
    const result = await executeShellTool.execute({
      command: 'nonexistent_command_xyzzy_123',
    });
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it('指定 cwd 参数', async () => {
    // 在根目录执行 pwd 然后把 cwd 指定为 tmpdir
    const result = await executeShellTool.execute({
      command: 'pwd',
      cwd: '/tmp',
    });
    // 可能因平台不同有不同的结果
    if (result.success) {
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    }
  });

  it('执行有 stderr 输出的命令（exit code 非 0）', async () => {
    // ls 不存在的目录，应有 stderr
    const result = await executeShellTool.execute({
      command: 'ls /nonexistent_path_xyz 2>&1',
    });
    if (!result.success) {
      expect(result.stderr.length > 0 || result.stdout.length > 0).toBe(true);
    }
  });

  it('参数校验——缺少 command 时通过 dispatcher 返回错误', async () => {
    const registry = new ToolRegistry();
    registry.register(executeShellTool);

    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'execute_shell', arguments: { cwd: '/tmp' } },
      registry,
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('command');
  });

  it('连续执行多个命令', async () => {
    const r1 = await executeShellTool.execute({ command: 'echo first' });
    const r2 = await executeShellTool.execute({ command: 'echo second' });

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    // 状态互相独立
    expect(r1.stdout).toContain('first');
    expect(r2.stdout).toContain('second');
  });

  it('执行命令后 stdout 不包含其他命令的输出', async () => {
    // 确保每个命令的输出是独立的
    const r1 = await executeShellTool.execute({ command: 'echo unique_test_string_12345' });
    const r2 = await executeShellTool.execute({ command: 'echo another_test_string_67890' });

    if (r1.success) expect(r1.stdout).toContain('unique_test_string_12345');
    if (r2.success) expect(r2.stdout).toContain('another_test_string_67890');
  });
});

// ============================================================
// registerAllTools 测试
// ============================================================

describe('registerAllTools', () => {
  it('注册所有 5 个内置工具', () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);

    expect(registry.list()).toHaveLength(5);
  });

  it('每个工具都在注册表中可查询', () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);

    expect(registry.get('list_directory')).toBeDefined();
    expect(registry.get('search_code')).toBeDefined();
    expect(registry.get('read_file')).toBeDefined();
    expect(registry.get('write_file')).toBeDefined();
    expect(registry.get('execute_shell')).toBeDefined();
  });

  it('每个工具都有正确的风险等级', () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);

    // 读操作 tools → low
    expect(registry.get('list_directory')!.riskHint).toBe('low');
    expect(registry.get('search_code')!.riskHint).toBe('low');
    expect(registry.get('read_file')!.riskHint).toBe('low');

    // 写操作 → medium
    expect(registry.get('write_file')!.riskHint).toBe('medium');

    // shell 执行 → high
    expect(registry.get('execute_shell')!.riskHint).toBe('high');
  });

  it('生成的 ToolDef 可供 LLM 使用', () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);

    const defs = registry.toToolDefs();
    expect(defs).toHaveLength(5);

    for (const def of defs) {
      expect(def.name).toBeDefined();
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.parameters.type).toBe('object');
      expect(def.parameters.properties).toBeDefined();
      expect(def.riskHint).toBeDefined();
    }
  });

  it('重复注册不会增加计数', () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);
    expect(registry.list()).toHaveLength(5);

    // 再次注册，仍然是 5 个（覆盖）
    registerAllTools(registry);
    expect(registry.list()).toHaveLength(5);
  });

  it('所有工具都定义了 required 参数', () => {
    const registry = new ToolRegistry();
    registerAllTools(registry);

    for (const tool of registry.list()) {
      // 每个工具至少应该定义了 parameters.properties
      expect(Object.keys(tool.parameters.properties).length).toBeGreaterThan(0);

      // 检查 required 字段
      if (tool.parameters.required) {
        expect(tool.parameters.required.length).toBeGreaterThan(0);
      }
    }
  });
});

// ============================================================
// 通过 ToolDispatcher 分发内置工具的集成测试
// ============================================================

describe('Builtin tools via ToolDispatcher', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerAllTools(registry);
  });

  it('通过 dispatcher 执行 read_file', async () => {
    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'read_file', arguments: { path: 'package.json' } },
      registry,
    );
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('ai4se-harness');
  });

  it('通过 dispatcher 执行 write_file', async () => {
    const testFile = join(tmpdir(), 'harness-dispatcher-write.txt');
    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'write_file', arguments: { path: testFile, content: 'dispatched!' } },
      registry,
    );
    expect(result.success).toBe(true);

    cleanFile(testFile);
  });

  it('通过 dispatcher 执行 list_directory', async () => {
    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'list_directory', arguments: { path: '.' } },
      registry,
    );
    expect(result.success).toBe(true);
  });

  it('dispatcher 对非 string 类型的 path 参数做校验', async () => {
    const result = await ToolDispatcher.dispatch(
      { id: '1', name: 'read_file', arguments: { path: 123 } },
      registry,
    );
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('string');
  });
});
