/**
 * .env 加载 单元测试
 *
 * 覆盖：
 *   - parseEnvContent（纯函数）：解析格式、注释、引号、CRLF、边界
 *   - loadEnvFile：读文件写 process.env、文件不存在静默、不覆盖已存在环境变量
 */

import { describe, it, expect, afterEach } from 'vitest';
import { parseEnvContent, loadEnvFile } from '../../src/cli/index.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// 使用独特前缀避免与真实环境变量冲突
const TEST_KEY_A = '__HARNESS_ENV_TEST_A__';
const TEST_KEY_B = '__HARNESS_ENV_TEST_B__';

// ============================================================
// parseEnvContent — 纯函数
// ============================================================

describe('parseEnvContent（纯函数）', () => {
  it('解析基本 KEY=VALUE', () => {
    expect(parseEnvContent('FOO=bar')).toEqual({ FOO: 'bar' });
  });

  it('跳过空行与 # 注释', () => {
    expect(parseEnvContent('# 这是注释\n\nFOO=bar\n# 又一条注释')).toEqual({
      FOO: 'bar',
    });
  });

  it('去掉成对引号', () => {
    expect(parseEnvContent('FOO="bar"\nBAZ=\'qux\'')).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    });
  });

  it('值内可含 = 号', () => {
    expect(parseEnvContent('FOO=a=b=c')).toEqual({ FOO: 'a=b=c' });
  });

  it('支持 CRLF 换行', () => {
    expect(parseEnvContent('FOO=bar\r\nBAZ=qux')).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    });
  });

  it('跳过无 = 的无效行', () => {
    expect(parseEnvContent('FOO=bar\n这是一行无效内容\nBAZ=qux')).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    });
  });

  it('空内容返回空对象', () => {
    expect(parseEnvContent('')).toEqual({});
  });
});

// ============================================================
// loadEnvFile — 读文件写 env
// ============================================================

describe('loadEnvFile（读文件 + 写 process.env）', () => {
  let tmpDir: string | null = null;

  function makeEnvFile(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), 'harness-env-'));
    const p = join(tmpDir, '.env');
    writeFileSync(p, content, 'utf-8');
    return p;
  }

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
    delete process.env[TEST_KEY_A];
    delete process.env[TEST_KEY_B];
  });

  it('文件不存在时静默返回（不抛异常）', () => {
    expect(() => loadEnvFile(join(tmpdir(), 'nonexistent.env'))).not.toThrow();
  });

  it('读取 .env 并写入 process.env', () => {
    const p = makeEnvFile(`${TEST_KEY_A}=hello\n${TEST_KEY_B}=world`);
    loadEnvFile(p);
    expect(process.env[TEST_KEY_A]).toBe('hello');
    expect(process.env[TEST_KEY_B]).toBe('world');
  });

  it('已存在的环境变量不被 .env 覆盖', () => {
    process.env[TEST_KEY_A] = 'already-set';
    const p = makeEnvFile(`${TEST_KEY_A}=from-file`);
    loadEnvFile(p);
    expect(process.env[TEST_KEY_A]).toBe('already-set');
  });
});
