/**
 * CLI 入口 单元测试
 *
 * 测试范围：
 * - CLI 程序结构（命令注册）
 * - 边界条件（空参数、多次调用、不存在的命令等）
 */

import { describe, it, expect } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { Command } from 'commander';

describe('CLI Program Structure', () => {
  it('creates a program with the correct name', () => {
    const program = createProgram();
    expect(program.name()).toBe('harness');
  });

  it('has a non-empty description', () => {
    const program = createProgram();
    expect(program.description()).toBeTruthy();
  });

  it('has run, setup, and key as top-level commands', () => {
    const program = createProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('run');
    expect(names).toContain('setup');
    expect(names).toContain('key');
  });

  it('key command has status, update, delete subcommands', () => {
    const program = createProgram();
    const keyCmd = program.commands.find((c) => c.name() === 'key');
    expect(keyCmd).toBeDefined();
    const subNames = keyCmd!.commands.map((c) => c.name());
    expect(subNames).toContain('status');
    expect(subNames).toContain('update');
    expect(subNames).toContain('delete');
  });

  it('run command accepts a required <task> argument', () => {
    const program = createProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    // commander 内部将 <task> 作为必需参数
    // 检查命令是否注册了参数
    const hasRequiredArg = runCmd!.registeredArguments.some(
      (arg) => arg.required && arg.name() === 'task',
    );
    expect(hasRequiredArg).toBe(true);
  });

  it('run command has a --config option', () => {
    const program = createProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    // 检查 --config option 是否注册
    const configOption = runCmd!.options.find((o) => o.name() === 'config');
    expect(configOption).toBeDefined();
  });
});

describe('CLI Program — Edge Cases', () => {
  it('multiple createProgram calls produce independent programs', () => {
    const p1 = createProgram();
    const p2 = createProgram();

    // 两个程序实例应该各自独立
    expect(p1).not.toBe(p2);
    expect(p1.name()).toBe(p2.name());
    expect(p1.commands.length).toBe(p2.commands.length);
  });

  it('program name is always "harness" across calls', () => {
    for (let i = 0; i < 5; i++) {
      const program = createProgram();
      expect(program.name()).toBe('harness');
    }
  });

  it('setup command has no required arguments (self-contained)', () => {
    const program = createProgram();
    const setupCmd = program.commands.find((c) => c.name() === 'setup');
    expect(setupCmd).toBeDefined();
    // setup 命令不应该有必需的参数
    expect(setupCmd!.registeredArguments.length).toBe(0);
  });
});
