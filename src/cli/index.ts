#!/usr/bin/env node

/**
 * CLI 入口 —— AI4SE Coding Agent Harness 的命令行界面。
 *
 * 使用 commander.js 提供以下命令：
 *   harness run <task>          — 运行 coding agent 执行任务
 *   harness setup              — 交互式配置凭据
 *   harness key status         — 检查 API key 是否已配置
 *   harness key update         — 更新已存储的 API key
 *   harness key delete         — 删除已存储的 API key
 *
 * 入口点检测：
 *   只有作为 CLI 入口点运行时才会调用 program.parse()；
 *   被测试文件 import 时只导出 createProgram()，不触发命令行解析。
 */

import { Command } from 'commander';
import { existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { createInterface, type Interface } from 'readline';
import { stdin, stdout, env, argv, exit } from 'process';
import { ConfigLoader } from '../config/loader.js';
import { CredentialStore } from '../credentials/store.js';
import { MemoryStore } from '../memory/store.js';
import { ToolRegistry } from '../tools/registry.js';
import { registerAllTools } from '../tools/builtin/index.js';
import { AgentLoop } from '../core/agent-loop.js';
import type { AgentResult } from '../core/agent-loop.js';
import { DeepSeekProvider } from '../llm/deepseek.js';

// ============================================================
// 常量
// ============================================================

const VERSION = '1.0.0';
const DEFAULT_CONFIG_PATH = './.harnessrc.json';
const MAX_PASSWORD_RETRIES = 3;

// ============================================================
// 公开导出：createProgram()
// ============================================================

/**
 * 创建并配置 Commander 程序实例。
 * 导出此函数以便测试代码检查程序结构，无需触发命令行解析。
 *
 * @returns 已配置所有命令和选项的 Commander Command 实例
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('harness')
    .description(
      'AI4SE Coding Agent Harness — deterministic governance, feedback, '
      + 'and tool orchestration for LLM-powered coding agents.',
    )
    .version(VERSION);

  // ==========================================================
  // harness run <task>
  // ==========================================================
  program
    .command('run <task>')
    .description('Run a coding task with the agent')
    .option('-c, --config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
    .action(async (task: string, options: { config: string }) => {
      try {
        // 初始化各模块（配置加载、API key 解析、工具注册）
        const loop = await initAgentLoop(options.config);

        // 交互式 HITL 审批（仅在 TTY 下注册，run 模式用独立 promptLine）
        if (stdin.isTTY) {
          registerHitlPrompt(loop, promptLine);
        }

        console.log(`Starting agent for task: "${task}"\n`);

        const result = await loop.run(task);
        printResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        exit(1);
      }
    });

  // ==========================================================
  // harness chat
  // ==========================================================
  program
    .command('chat')
    .description('Interactive multi-turn chat with the agent')
    .option('-c, --config <path>', 'Config file path', DEFAULT_CONFIG_PATH)
    .action(async (options: { config: string }) => {
      try {
        // 复用同一 AgentLoop 实例，保证 MemoryStore（决策记忆）跨轮持久
        const loop = await initAgentLoop(options.config);

        console.log('AI4SE Harness — interactive chat mode.');
        console.log('Type your message, or "exit" / "quit" to leave.\n');

        // 单一 readline 接口：chat REPL 与 HITL 审批共用，避免竞争接口
        // 导致输入串扰（多输入的字符泄漏到下一轮）与流状态损坏（异常退出）。
        // 仅在 TTY 下提供交互式 HITL 审批；非 TTY（管道）保持无人值守自动拒绝。
        const rl = createInterface({ input: stdin, output: stdout });
        const ask = stdin.isTTY
          ? (prompt: string): Promise<string> =>
              new Promise<string>((resolve) => rl.question(prompt, (ans) => resolve(ans.trim())))
          : undefined;
        await runChatRepl(loop, rl, ask);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        exit(1);
      }
    });

  // ==========================================================
  // harness setup
  // ==========================================================
  program
    .command('setup')
    .description('Configure credentials and generate default config')
    .action(async () => {
      try {
        console.log('AI4SE Harness Setup');
        console.log('───────────────────\n');

        const apiKey = await promptMasked('Enter your DeepSeek API key: ');
        if (!apiKey) {
          console.error('API key cannot be empty.');
          exit(1);
        }

        const masterPassword = await promptMasked('Set a master password: ');
        if (!masterPassword) {
          console.error('Master password cannot be empty.');
          exit(1);
        }

        const confirmPassword = await promptMasked('Confirm master password: ');
        if (masterPassword !== confirmPassword) {
          console.error('Passwords do not match.');
          exit(1);
        }

        await CredentialStore.save(apiKey, masterPassword);
        console.log(`\nCredentials saved to ${CredentialStore.defaultPath()}`);

        // 检查当前目录下是否有配置文件，没有则自动生成默认模板
        const defaultConfigPath = resolve(DEFAULT_CONFIG_PATH);
        if (!existsSync(defaultConfigPath)) {
          // 使用 ConfigLoader.DEFAULTS 生成完整的默认配置模板
          const defaultConfig = buildDefaultConfigTemplate();
          writeFileSync(defaultConfigPath, defaultConfig, 'utf-8');
          console.log(`Default config template written to ${defaultConfigPath}`);
        }

        console.log('\nSetup complete. You can now run: harness run "your task"');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Setup failed: ${message}`);
        exit(1);
      }
    });

  // ==========================================================
  // harness key [subcommand]
  // ==========================================================
  const keyCmd = program
    .command('key')
    .description('Manage stored API key');

  // harness key status
  keyCmd
    .command('status')
    .description('Check if a key is configured')
    .action(() => {
      if (CredentialStore.exists()) {
        console.log('DeepSeek API key: (configured)');
      } else {
        console.log('No API key configured. Run "harness setup".');
      }
    });

  // harness key update
  keyCmd
    .command('update')
    .description('Update the stored API key')
    .action(async () => {
      try {
        if (!CredentialStore.exists()) {
          console.log('No existing credentials. Use "harness setup" to configure.');
          return;
        }

        const oldPassword = await promptMasked('Current master password: ');

        // 验证旧密码
        try {
          await CredentialStore.load(oldPassword);
        } catch {
          console.error('Incorrect current password.');
          exit(1);
        }

        const newKey = await promptMasked('Enter new DeepSeek API key: ');
        if (!newKey) {
          console.error('API key cannot be empty.');
          exit(1);
        }

        const newPassword = await promptMasked(
          'Set new master password (or same as before): ',
        );
        if (!newPassword) {
          console.error('Master password cannot be empty.');
          exit(1);
        }

        await CredentialStore.save(newKey, newPassword);
        console.log('Key updated successfully.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        exit(1);
      }
    });

  // harness key delete
  keyCmd
    .command('delete')
    .description('Delete the stored API key')
    .action(async () => {
      try {
        if (!CredentialStore.exists()) {
          console.log('No credentials to delete.');
          return;
        }

        await CredentialStore.delete();
        console.log('Credentials deleted.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        exit(1);
      }
    });

  return program;
}

// ============================================================
// 内部辅助函数
// ============================================================

/**
 * 初始化 AgentLoop：加载配置、解析 API key、注册工具与 HITL 审批回调。
 *
 * run 与 chat 两个命令共用此初始化逻辑，避免重复。
 * hitl.onRequest 回调在返回前只注册一次，chat 模式的多轮循环不会重复注册。
 *
 * @param configPath 配置文件路径
 * @returns 已初始化好的 AgentLoop 实例
 */
async function initAgentLoop(configPath: string): Promise<AgentLoop> {
  // 加载配置（校验失败会直接抛出 ConfigError）
  const config = ConfigLoader.load(configPath);

  // 获取 API key（先查环境变量，再交互式解密凭据文件）
  const apiKey = await resolveApiKey();
  if (apiKey === null) {
    console.error(
      'No API key configured.\n'
      + 'Options:\n'
      + '  1. Run "harness setup" to configure interactively\n'
      + '  2. Set DEEPSEEK_API_KEY environment variable',
    );
    exit(1);
  }

  // 初始化各模块
  const llm = new DeepSeekProvider({
    apiKey,
    model: config.llm.model,
    baseURL: config.llm.baseURL,
    maxTokens: config.llm.maxTokens,
  });

  const tools = new ToolRegistry();
  registerAllTools(tools);

  const memory = new MemoryStore(config.memory);

  const loop = new AgentLoop({ llm, tools, config, memory });

  return loop;
}

/**
 * 输出 Agent 运行结果摘要（run 与 chat 共用）。
 */
function printResult(result: AgentResult): void {
  console.log('\n─────────────────────────────────────');
  console.log(result.summary);
  console.log(`Rounds: ${result.rounds} | Phase: ${result.phase}`);
}

/**
 * 注册交互式 HITL 审批回调 —— 当护栏引擎标记 confirm 时弹出终端提示。
 *
 * `ask` 为注入的输入函数：run 模式用 promptLine（独立接口），
 * chat 模式用共享 rl 的 question（与 REPL 同一接口，避免竞争）。
 */
function registerHitlPrompt(
  loop: AgentLoop,
  ask: (prompt: string) => Promise<string>,
): void {
  loop.hitl.onRequest = async (req) => {
    console.log(
      `\n⚠️  Dangerous operation detected:\n`
      + `   Tool   : ${req.toolName}\n`
      + `   Reason : ${req.reason}\n`
      + `   Params : ${JSON.stringify(req.params)}`,
    );

    const answer = await ask('   (A)pprove / (D)eny? ');

    if (answer.toLowerCase() === 'a' || answer.toLowerCase() === 'approve') {
      loop.hitl.approve(req.id);
      console.log('   → Approved\n');
    } else {
      loop.hitl.deny(req.id);
      console.log('   → Denied\n');
    }
  };
}

/**
 * 交互式多轮对话 REPL（chat 命令）。导出仅供测试（与 createProgram 同类），
 * 非 CLI 公共 API。
 *
 * 复用同一个 readline 接口 `rl` 驱动聊天循环与 HITL 审批提示，
 * 采用回调驱动的 question() 循环而非 for await，避免创建第二个 readline
 * 接口与 REPL 竞争 stdin —— 那会带来输入串扰（多输入字符泄漏）与
 * 流状态损坏（异常退出）。
 *
 * @param loop 已初始化的 AgentLoop 实例
 * @param rl   共享的 readline 接口（input 指向 stdin）
 * @param ask  可选的交互式 HITL 输入函数；未提供则保持无人值守（自动拒绝）
 * @returns 当用户输入 exit/quit 时 resolve；运行出错时 reject，由调用方统一退出
 */
export function runChatRepl(
  loop: AgentLoop,
  rl: Interface,
  ask?: (prompt: string) => Promise<string>,
): Promise<void> {
  if (ask) {
    registerHitlPrompt(loop, ask);
  }

  return new Promise<void>((resolve, reject) => {
    let first = true;

    const askNext = (): void => {
      rl.question('harness> ', async (raw) => {
        const input = raw.trim();

        // 空行跳过
        if (input.length === 0) {
          askNext();
          return;
        }

        // 退出指令
        if (input === 'exit' || input === 'quit') {
          rl.close();
          console.log('Bye.');
          resolve();
          return;
        }

        try {
          const result = first ? await loop.run(input) : await loop.continue(input);
          first = false;
          printResult(result);
          askNext();
        } catch (error) {
          // 出错时关闭接口并向上抛，由 chat 命令的 catch 统一输出并退出
          // （与 run 命令一致，避免在库函数内调用 process.exit）
          rl.close();
          reject(error);
        }
      });
    };

    askNext();
  });
}

/**
 * 构建默认的 .harnessrc.json 配置模板字符串。
 *
 * 内容与 ConfigLoader.DEFAULTS 保持同步，输出为格式化的 JSON 字符串。
 * 用户可自由编辑此文件来定制 agent 行为（护栏规则、check 命令等）。
 *
 * @returns 格式化后的默认配置 JSON 字符串
 */
function buildDefaultConfigTemplate(): string {
  const template = {
    llm: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      baseURL: 'https://api.deepseek.com/v1',
      maxTokens: 8192,
    },
    guardrails: {
      rules: [
        { tool: 'execute_shell', pattern: 'sudo.*', action: 'confirm' },
        { tool: 'execute_shell', pattern: '(curl|wget).*\\|.*(bash|sh)', action: 'deny' },
        { tool: 'write_file', pattern: '^\\/(etc|var|tmp)\\/', action: 'confirm' },
      ],
      hitlTimeoutSeconds: 60,
    },
    scope: {
      workspaceRoot: '.',
      allowedHosts: ['github.com'],
      maxShellTimeMs: 30000,
    },
    memory: {
      maxTokens: 2000,
      summaryInterval: 10,
      contextThreshold: 0.8,
      contextWindowTokens: 64000,
      keepRecentMessages: 8,
      maxToolResultChars: 8000,
    },
    feedback: {
      autoFix: true,
      maxRetries: 3,
      checks: [
        { name: 'typecheck', command: 'npx tsc --noEmit', signalPattern: 'error TS' },
        { name: 'lint', command: 'npx eslint --format compact', signalPattern: 'error\\b|warning\\b' },
        { name: 'test', command: 'npm test', signalPattern: 'FAIL|passing' },
      ],
    },
  };

  return JSON.stringify(template, null, 2) + '\n';
}

/**
 * 解析 API key。
 *
 * 优先级：
 *   1. DEEPSEEK_API_KEY 环境变量（Docker / CI / 自动化场景）
 *   2. 交互式输入主密码，从 ~/.ai4se-harness/credentials.enc 解密
 *
 * 主密码最多重试 MAX_PASSWORD_RETRIES 次。
 *
 * @returns API key 明文；如果凭据文件不存在且无环境变量则返回 null
 */
async function resolveApiKey(): Promise<string | null> {
  // 优先使用环境变量
  const envKey = env['DEEPSEEK_API_KEY'];
  if (envKey) {
    return envKey;
  }

  // 无环境变量 → 需要凭据文件
  if (!CredentialStore.exists()) {
    return null;
  }

  for (let attempt = 1; attempt <= MAX_PASSWORD_RETRIES; attempt++) {
    const prompt = attempt === 1
      ? 'Master password: '
      : `Master password (attempt ${attempt}/${MAX_PASSWORD_RETRIES}): `;
    const password = await promptMasked(prompt);

    try {
      return await CredentialStore.load(password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_PASSWORD_RETRIES) {
        console.error(message);
      } else {
        throw new Error(
          `Failed to decrypt credentials after ${MAX_PASSWORD_RETRIES} attempts.`,
        );
      }
    }
  }

  return null;
}

/**
 * 普通文本输入提示（不回显掩码，用于 HITL 审批等非敏感输入）。
 *
 * @param promptText 提示文本（如 "(A)pprove / (D)eny? "）
 * @returns 用户输入字符串（去除首尾空白）
 */
function promptLine(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * 带字符掩码的密码提示。
 *
 * 在 stdin 启用 raw mode，每次按键回显 '*' 而非实际字符。
 * 支持 Backspace 删除（覆盖最后一个 '*'）。
 * Ctrl+C 直接退出进程。
 *
 * @param promptText 提示文本（如 "Master password: "）
 * @returns 用户输入的明文密码
 */
function promptMasked(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    // 非 TTY 环境（如管道输入）fallback 到 readline
    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin, output: stdout });
      rl.question(promptText, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    stdout.write(promptText);

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    let password = '';

    const onData = (data: Buffer): void => {
      const chars = data.toString();

      for (const char of chars) {
        // Enter
        if (char === '\r' || char === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(password);
          return;
        }

        // Backspace / Delete
        if (char === '\x7f' || char === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
            // 光标回退 → 空格覆盖 → 再回退
            stdout.write('\b \b');
          }
          continue;
        }

        // Ctrl+C
        if (char === '\x03') {
          cleanup();
          stdout.write('\n');
          exit(1);
        }

        // 可打印字符
        if (char >= ' ') {
          password += char;
          stdout.write('*');
        }
      }
    };

    const cleanup = (): void => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    stdin.on('data', onData);
  });
}

// ============================================================
// 入口点检测与启动
// ============================================================

/**
 * 判断当前模块是否为 CLI 入口点（而非被测试代码 import）。
 *
 * 比较 process.argv[1] 与当前文件的规范化路径。
 * 同时检查常见的运行模式（tsx、编译后的 dist 路径等）。
 */
function isEntryPoint(): boolean {
  const entryArg = argv[1];
  if (!entryArg) return false;

  const currentFile = fileURLToPath(import.meta.url);
  const normalizedEntry = resolve(entryArg);
  const normalizedCurrent = resolve(currentFile);

  // 精确匹配（经 resolve 规范化）
  if (normalizedEntry === normalizedCurrent) return true;

  // 跨平台后缀匹配
  return (
    entryArg.endsWith('/cli/index.js')
    || entryArg.endsWith('\\cli\\index.js')
    || entryArg.endsWith('/cli/index.ts')
    || entryArg.endsWith('\\cli\\index.ts')
    || entryArg.includes('cli/index')
  );
}

// 仅在作为 CLI 入口点运行时解析命令
if (isEntryPoint()) {
  createProgram().parse();
}
