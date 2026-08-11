/**
 * Agent 主循环 —— Harness 核心引擎。
 *
 * 负责驱动"上下文组装 → LLM 调用 → 解析 → 护栏 → 工具执行 → 反馈 → 停机判断"
 * 的完整闭环。严格遵循 SPEC §3.1 的流程图。
 *
 * 使用 while 循环而非递归，确保停机条件可追踪且不会栈溢出。
 */

import type { LLMProvider } from '../llm/provider.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { MemoryStore } from '../memory/store.js';
import type {
  HarnessConfig,
  Message,
  AgentPhase,
  ToolCall,
  Feedback,
  HITLRequest,
  ExecutionResult,
  LLMResponse,
} from './types.js';
import { ToolDispatcher } from '../tools/dispatcher.js';
import { GuardrailEngine } from '../guardrails/engine.js';
import { HITLStateMachine } from '../guardrails/hitl.js';
import { ScopeFenceGuard } from '../guardrails/scope-fence.js';
import { DecisionFingerprint } from '../guardrails/fingerprint.js';
import { SignalExtractor } from '../feedback/extractor.js';
import { FailureClassifier } from '../feedback/classifier.js';
import { FeedbackFormatter } from '../feedback/formatter.js';
import { GuardrailViolation } from '../tools/blacklist.js';
import { execSync } from 'child_process';

// ============================================================
// 类型定义
// ============================================================

/** AgentLoop 构造函数参数 */
export interface AgentLoopConfig {
  llm: LLMProvider;
  tools: ToolRegistry;
  config: HarnessConfig;
  memory: MemoryStore;
}

/** Agent 运行结果 */
export interface AgentResult {
  success: boolean;
  rounds: number;
  summary: string;
  phase: AgentPhase;
}

// ============================================================
// AgentLoop
// ============================================================

export class AgentLoop {
  private llm: LLMProvider;
  private tools: ToolRegistry;
  private config: HarnessConfig;
  private memory: MemoryStore;
  private guardrails: GuardrailEngine;
  /** HITL 状态机，公开供 CLI/WebUI 和测试使用 */
  readonly hitl: HITLStateMachine;
  /** 范围围栏，公开供测试验证 */
  readonly scopeFence: ScopeFenceGuard;

  constructor(config: AgentLoopConfig) {
    this.llm = config.llm;
    this.tools = config.tools;
    this.config = config.config;
    this.memory = config.memory;
    this.guardrails = new GuardrailEngine(config.config.guardrails.rules);
    this.hitl = new HITLStateMachine();
    this.scopeFence = new ScopeFenceGuard(config.config.scope);
  }

  // ============================================================
  // 公共方法：run()
  // ============================================================

  /**
   * 执行 Agent 主循环。
   *
   * @param task      用户任务描述（自然语言字符串）
   * @param maxRounds 最大循环轮数（默认 50）
   * @returns 任务完成状态 + 摘要
   */
  async run(task: string, maxRounds: number = 50): Promise<AgentResult> {
    // ---- 初始化消息数组 ----
    const messages: Message[] = [];

    // ① 上下文组装：system prompt（含记忆摘要）
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(),
    });

    // 用户任务
    messages.push({
      role: 'user',
      content: task,
    });

    let round = 0;
    let phase: AgentPhase = 'running';

    // ---- 主循环（while，非递归） ----
    while (round < maxRounds && phase === 'running') {
      round++;

      // ② LLM 调用
      const toolDefs = this.tools.toToolDefs();
      const response = await this.llm.complete(messages, toolDefs);

      // 处理 LLM 错误
      if (response.finishReason === 'error') {
        phase = 'error';
        break;
      }

      // ③ 解析响应：构建并推送 assistant 消息
      const assistantMsg = this.buildAssistantMessage(response);
      messages.push(assistantMsg);

      // 检查是否完成：stop 且无 tool_calls
      if (response.finishReason === 'stop' && response.toolCalls.length === 0) {
        phase = 'completed';
        break;
      }

      // 防御性：tool_calls 为空但未 stop → 继续下一轮
      if (response.toolCalls.length === 0) {
        continue;
      }

      // ---- 本轮反馈收集（每条 tool call 一条，最后合并） ----
      const roundFeedbacks: Feedback[] = [];

      // ④ 处理每个 toolCall
      for (const toolCall of response.toolCalls) {
        const toolFeedback = await this.processToolCall(toolCall, messages);
        if (toolFeedback) {
          roundFeedbacks.push(toolFeedback);
        }
      }

      // ⑤ 运行自动 checks
      await this.runAutoChecks(messages);

      // ⑥ 回灌反馈：每轮只加一条 [FEEDBACK] system 消息
      if (roundFeedbacks.length > 0) {
        const feedbackLines = roundFeedbacks.map((fb) => fb.summary);
        messages.push({
          role: 'system',
          content: `[FEEDBACK] ${feedbackLines.join(' | ')}`,
        });
      }

      // ⑦ 停机判断由 while 条件处理
    }

    // ---- 超轮数处理 ----
    if (round >= maxRounds && phase === 'running') {
      phase = 'error';
    }

    // ---- 构建结果 ----
    return {
      success: phase === 'completed',
      rounds: round,
      summary: this.buildSummary(messages, phase, round),
      phase,
    };
  }

  // ============================================================
  // 单个 ToolCall 处理（步骤 ④）
  // ============================================================

  /**
   * 处理单个工具调用：护栏检查 → 决策记忆 → HITL → 执行 → 反馈。
   *
   * @returns 反馈对象（无论成功失败），若为 null 表示被 HITL 阻止
   */
  private async processToolCall(
    toolCall: ToolCall,
    messages: Message[],
  ): Promise<Feedback | null> {
    // ---- ④a 护栏检查 ----
    const riskAssess = this.guardrails.assessRisk(toolCall.name, toolCall.arguments);

    // ---- ④b deny → 拦截 ----
    if (riskAssess.action === 'deny') {
      const denyFeedback: Feedback = {
        success: false,
        failureType: 'GUARDRAIL_DENY',
        suggestion: 'Consider an alternative approach that does not trigger this restriction.',
        summary: `✗ ${toolCall.name} BLOCKED by guardrail: ${riskAssess.reason}`,
        rawOutput: riskAssess.reason,
      };

      messages.push({
        role: 'tool',
        content: `BLOCKED: ${riskAssess.reason}`,
        toolCallId: toolCall.id,
      });

      // 记录决策
      this.memory.recordDecision({
        toolName: toolCall.name,
        commandFingerprint: this.buildFingerprint(toolCall),
        action: 'denied',
        timestamp: Date.now(),
      });

      return denyFeedback;
    }

    // ---- ④c confirm → HITL 审批 ----
    if (riskAssess.action === 'confirm') {
      const fingerprint = this.buildFingerprint(toolCall);

      // 检查决策记忆：精确匹配已批准 → 跳过 HITL
      const prevDecision = DecisionFingerprint.match(
        this.memory,
        toolCall.name,
        fingerprint,
      );

      if (prevDecision.level === 'exact' && prevDecision.previousAction === 'approved') {
        // 跳过 HITL，直接进入执行阶段（继续下面的代码）
      } else if (prevDecision.level === 'fuzzy') {
        // 模糊匹配 → 仍走 HITL，但降一级风险（from SPEC: high→medium）
        return await this.handleHITL(toolCall, fingerprint, riskAssess.reason, messages);
      } else {
        // 无匹配 → 进入 HITL
        return await this.handleHITL(toolCall, fingerprint, riskAssess.reason, messages);
      }
    }

    // ---- ④d 范围围栏检查（第三层纵深防御） ----
    // write_file: 校验路径是否在工作区内
    if (toolCall.name === 'write_file' && typeof toolCall.arguments.path === 'string') {
      const fenceResult = this.scopeFence.validatePath(toolCall.arguments.path);
      if (!fenceResult.allowed) {
        const fenceFeedback: Feedback = {
          success: false,
          failureType: 'GUARDRAIL_DENY',
          suggestion: 'Write to a path within the workspace root.',
          summary: `✗ ${toolCall.name} SCOPE FENCE BLOCK: ${fenceResult.reason}`,
          rawOutput: fenceResult.reason ?? '',
        };
        messages.push({
          role: 'tool',
          content: `SCOPE FENCE BLOCK: ${fenceResult.reason}`,
          toolCallId: toolCall.id,
        });
        return fenceFeedback;
      }
    }

    // execute_shell: 检测对非白名单主机的网络请求 → 触发 confirm
    if (toolCall.name === 'execute_shell' && typeof toolCall.arguments.command === 'string') {
      const hostUrl = this.extractCurlWgetUrl(toolCall.arguments.command);
      if (hostUrl) {
        const hostResult = this.scopeFence.validateHost(hostUrl);
        if (!hostResult.allowed) {
          // 非白名单主机 → 进入 HITL 审批
          const fingerprint = this.buildFingerprint(toolCall);
          return await this.handleHITL(
            toolCall,
            fingerprint,
            `Network request to non-allowed host: ${hostResult.reason}`,
            messages,
          );
        }
      }
    }

    // ---- ④e 执行工具（通过护栏 + 范围围栏） ----
    return this.executeTool(toolCall, messages);
  }

  /**
   * 处理 HITL 审批流程。
   *
   * 通过 waitForResolution 阻塞等待审批结果：
   *   - CLI 交互模式：onRequest 回调弹出提示 → 用户选择 → approve/deny
   *   - 自动化模式（无回调）：超时自动拒绝
   *   - 已批准的历史决策（精确匹配）：在调用此方法前已跳过 HITL
   *
   * @returns APPROVED 时执行工具并返回反馈；DENIED/TIMEOUT 时返回拒绝反馈
   */
  private async handleHITL(
    toolCall: ToolCall,
    fingerprint: string,
    reason: string,
    messages: Message[],
  ): Promise<Feedback | null> {
    const timeoutSeconds = this.config.guardrails.hitlTimeoutSeconds;

    const hitlReq: HITLRequest = {
      id: `hitl-${Date.now()}-${toolCall.id}`,
      toolName: toolCall.name,
      params: toolCall.arguments,
      risk: 'high',
      reason,
      status: 'WAITING',
      createdAt: Date.now(),
      timeoutSeconds,
    };

    // 提交到 HITL 状态机（触发 onRequest 回调，CLI 可在此弹出审批提示）
    this.hitl.submit(hitlReq);

    // 阻塞等待审批结果（外部 approve/deny 或超时）
    const status = await this.hitl.waitForResolution(hitlReq.id, timeoutSeconds);

    // ---- 已批准 → 执行工具 ----
    if (status === 'APPROVED') {
      return await this.executeTool(toolCall, messages);
    }

    // ---- 拒绝或超时 → 生成拒绝反馈 ----
    const isTimeout = status === 'TIMEOUT';
    const summary = isTimeout
      ? `✗ ${toolCall.name} HITL timeout: ${reason}`
      : `✗ ${toolCall.name} HITL denied (automated mode): ${reason}`;

    const suggestion = isTimeout
      ? 'The HITL request timed out. Try a lower-risk approach.'
      : 'Consider an alternative approach that does not require HITL approval.';

    const denyFeedback: Feedback = {
      success: false,
      failureType: 'GUARDRAIL_DENY',
      suggestion,
      summary,
      rawOutput: `HITL request ${hitlReq.id} ${status === 'TIMEOUT' ? 'timed out' : 'denied'}.`,
    };

    messages.push({
      role: 'tool',
      content: summary,
      toolCallId: toolCall.id,
    });

    this.memory.recordDecision({
      toolName: toolCall.name,
      commandFingerprint: fingerprint,
      action: 'denied',
      timestamp: Date.now(),
    });

    return denyFeedback;
  }

  /**
   * 执行工具并生成反馈。
   */
  private async executeTool(
    toolCall: ToolCall,
    messages: Message[],
  ): Promise<Feedback> {
    try {
      // ⑤ 工具分发
      const execResult: ExecutionResult = await ToolDispatcher.dispatch(
        toolCall,
        this.tools,
      );

      // 将执行结果 push 进对话历史
      messages.push({
        role: 'tool',
        content: JSON.stringify(execResult),
        toolCallId: toolCall.id,
      });

      // ⑥a 信号提取 + ⑥b 失败分类 + ⑥c 回灌格式化
      const checkPatterns = this.buildCheckPatterns();

      const failureType = FailureClassifier.classify(
        execResult.exitCode,
        execResult.stdout,
        execResult.stderr,
        checkPatterns,
      );

      return FeedbackFormatter.format(execResult, failureType);
    } catch (error) {
      // 硬黑名单违规（GuardrailViolation）—— 第二层防御
      if (error instanceof GuardrailViolation) {
        const denyFeedback: Feedback = {
          success: false,
          failureType: 'GUARDRAIL_DENY',
          suggestion:
            'The command was blocked by the hard blacklist. Choose a safer alternative.',
          summary: `✗ ${toolCall.name} BLACKLIST BLOCK: ${error.message}`,
          rawOutput: error.message,
        };

        messages.push({
          role: 'tool',
          content: error.message,
          toolCallId: toolCall.id,
        });

        return denyFeedback;
      }

      // 未知异常 → 重新抛出（不应静默吞掉）
      throw error;
    }
  }

  // ============================================================
  // 自动 Checks（步骤 ⑤）
  // ============================================================

  /**
   * 运行 config.feedback.checks 中定义的所有自动检查命令。
   * Checks 依赖容错：工具不可用时跳过，记录 info 日志，不报 FAIL。
   */
  private async runAutoChecks(messages: Message[]): Promise<void> {
    const checks = this.config.feedback.checks;
    if (checks.length === 0) return;

    const checkResults: string[] = [];

    for (const check of checks) {
      try {
        const output = execSync(check.command, {
          encoding: 'utf-8',
          timeout: 30000,
          stdio: 'pipe',
        });
        // 成功执行，截取前 500 字符
        const truncated = output.slice(0, 500);
        checkResults.push(`[CHECK:${check.name}] ${truncated}`);
      } catch (error: unknown) {
        const err = error as { stderr?: string; stdout?: string; message?: string; status?: number };
        const msg = err.stderr ?? err.stdout ?? err.message ?? String(error);

        // 工具不可用（命令找不到）→ 跳过，不报 FAIL
        // 检测策略:
        //   - POSIX (bash): "command not found" + 退出码 127
        //   - Windows (cmd.exe, English): "not recognized"
        //   - 通用: ENOENT（spawn 失败）
        //   局限性: 非英语 Windows cmd.exe 的错误消息因编码问题无法可靠检测，
        //   此种场景下 check 结果会被记录为普通失败而非跳过，不影响主流程。
        if (
          msg.includes('not found') ||
          msg.includes('command not found') ||
          msg.includes('not recognized') ||
          msg.includes('ENOENT') ||
          err.status === 127
        ) {
          checkResults.push(
            `[info] Check "${check.name}" skipped: tool not available in target project.`,
          );
        } else {
          // 工具可用但执行失败 → 记录输出
          const truncated = msg.slice(0, 500);
          checkResults.push(`[CHECK:${check.name}] ${truncated}`);
        }
      }
    }

    // 合并所有 check 结果到一条 system 消息
    if (checkResults.length > 0) {
      messages.push({
        role: 'system',
        content: checkResults.join('\n'),
      });
    }
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 构建 system prompt（含记忆摘要）。
   */
  private buildSystemPrompt(): string {
    const memorySummary = this.memory.summarize();

    return `You are a coding agent harness. You help developers with coding tasks.
You have access to tools for reading/writing files, executing shell commands, searching code, and listing directories.

Project memory:
${memorySummary || '(none)'}

Instructions:
- When you receive feedback about failures, use it to correct your approach.
- When unsure about a dangerous operation, ask for clarification.
- Respond step by step. After each tool call, wait for the result before making another.
- Read files before editing them. Understand the codebase before making changes.`;
  }

  /**
   * 构建 assistant 消息，将 tool_calls 信息编码到 content 中。
   * 确保下一轮 LLM 能看到自己调用过哪些工具。
   */
  private buildAssistantMessage(response: LLMResponse): Message {
    if (response.toolCalls.length > 0) {
      const toolCallDescs = response.toolCalls.map(
        (tc) => `${tc.name}(${JSON.stringify(tc.arguments)})`,
      );
      return {
        role: 'assistant',
        content: `[Tool calls: ${toolCallDescs.join(', ')}]`,
      };
    }

    return {
      role: 'assistant',
      content: response.content ?? '',
    };
  }

  /**
   * 构建命令指纹，用于决策记忆匹配。
   * - execute_shell → 使用 command 字符串
   * - write_file → 使用 path 字符串
   * - 其他 → 使用工具名 + 参数 JSON
   */
  private buildFingerprint(toolCall: ToolCall): string {
    if (toolCall.name === 'execute_shell' && typeof toolCall.arguments.command === 'string') {
      return toolCall.arguments.command;
    }
    if (toolCall.name === 'write_file' && typeof toolCall.arguments.path === 'string') {
      return toolCall.arguments.path;
    }
    return `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
  }

  /**
   * 从 shell 命令中提取 curl/wget 的目标 URL。
   * 用于 ScopeFenceGuard 的主机白名单校验。
   *
   * @returns 提取到的 URL 字符串，未找到时返回 null
   */
  private extractCurlWgetUrl(command: string): string | null {
    // 匹配 curl 或 wget 命令中的 URL 参数
    const patterns = [
      // curl [-options] URL
      /(?:curl|wget)\s+(?:-[a-zA-Z0-9]+\s+)*(?:--[a-zA-Z0-9-]+(?:=[^\s]+)?\s+)*['"]?(https?:\/\/[^\s'"]+)/i,
      // curl URL (simplest form)
      /(?:curl|wget)\s+['"]?(https?:\/\/[^\s'"]+)/i,
    ];
    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * 从 config.feedback.checks 构建 signalPatterns 映射表。
   */
  private buildCheckPatterns(): Record<string, string> {
    const patterns: Record<string, string> = {};
    for (const check of this.config.feedback.checks) {
      patterns[check.name] = check.signalPattern;
    }
    return patterns;
  }

  /**
   * 构建最终结果摘要。
   * 成功时：包含 LLM 最终输出的内容。
   * 失败/错误时：包含阶段和轮数信息。
   */
  private buildSummary(
    messages: Message[],
    phase: AgentPhase,
    round: number,
  ): string {
    if (phase === 'completed') {
      // 从后向前查找最后一个有内容的 assistant 消息
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'assistant' && msg.content && msg.content.trim().length > 0) {
          return msg.content;
        }
      }
    }

    if (phase === 'error') {
      return `Agent terminated with error after ${round} round(s).`;
    }

    return `Agent finished after ${round} rounds. Phase: ${phase}.`;
  }
}
