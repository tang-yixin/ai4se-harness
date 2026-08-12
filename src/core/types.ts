// ============================================================
// Message & LLM 类型
// ============================================================

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
  /** Assistant 消息中的 tool_calls（与 OpenAI/DeepSeek API 兼容） */
  toolCalls?: ToolCall[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  riskHint?: RiskLevel;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
  usage: { promptTokens: number; completionTokens: number };
}

// ============================================================
// 工具系统类型
// ============================================================

export interface ExecutionResult {
  toolName: string;
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  riskHint: RiskLevel;
  execute(args: Record<string, unknown>): Promise<ExecutionResult>;
}

// ============================================================
// 护栏类型（深度维度）
// ============================================================

export type RiskLevel = 'low' | 'medium' | 'high';

export type GuardrailAction = 'deny' | 'confirm';

export interface GuardrailRule {
  tool: string;
  pattern: string;      // 正则表达式字符串
  action: GuardrailAction;
}

export type HITLStatus = 'WAITING' | 'APPROVED' | 'DENIED' | 'TIMEOUT';

export interface HITLRequest {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
  risk: 'medium' | 'high';
  reason: string;
  status: HITLStatus;
  createdAt: number;
  timeoutSeconds: number;
}

export interface ScopeFence {
  workspaceRoot: string;
  allowedHosts: string[];
  maxShellTimeMs: number;
}

// ============================================================
// 记忆类型
// ============================================================

export interface MemoryEntry {
  key: string;
  value: string;
  category: 'project' | 'decision';
  updatedAt: number;
}

export interface DecisionRecord {
  toolName: string;
  commandFingerprint: string;
  action: 'approved' | 'denied';
  timestamp: number;
}

// ============================================================
// 反馈类型
// ============================================================

export type FailureType =
  | 'TEST_FAILURE'
  | 'TYPE_ERROR'
  | 'LINT_ERROR'
  | 'SHELL_ERROR'
  | 'GUARDRAIL_DENY'
  | 'UNKNOWN_FAILURE';

export interface Feedback {
  success: boolean;
  failureType?: FailureType;
  suggestion?: string;
  summary: string;
  rawOutput: string;
}

// ============================================================
// 配置类型
// ============================================================

export interface CheckDef {
  name: string;
  command: string;
  signalPattern: string;
}

export interface HarnessConfig {
  llm: {
    provider: string;
    model: string;
    baseURL: string;
    maxTokens: number;
  };
  guardrails: {
    rules: GuardrailRule[];
    hitlTimeoutSeconds: number;
  };
  scope: ScopeFence;
  memory: {
    maxTokens: number;
    summaryInterval: number;
    contextThreshold: number;
  };
  feedback: {
    autoFix: boolean;
    maxRetries: number;
    checks: CheckDef[];
  };
}

// ============================================================
// Agent 会话状态
// ============================================================

export type AgentPhase = 'idle' | 'running' | 'waiting_hitl' | 'completed' | 'error';

export interface AgentState {
  sessionId: string;
  task: string;
  messages: Message[];
  round: number;
  maxRounds: number;
  hitlQueue: HITLRequest[];
  phase: AgentPhase;
}
