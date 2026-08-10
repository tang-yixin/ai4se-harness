/**
 * HITL（Human-in-the-Loop）状态机
 *
 * 管理人机交互审批请求的生命周期。
 *
 * 状态转换：
 *   IDLE → WAITING → APPROVED → 执行
 *                 → DENIED   → 拒绝 + 反馈
 *                 → TIMEOUT  → 跳过 + 警告
 *
 * 使用方式：
 *   1. 护栏引擎返回 action='confirm' 时，创建 HITLRequest
 *   2. 调用 submit() 提交请求 → 进入 WAITING
 *   3. 用户交互（CLI / WebUI）调用 approve() 或 deny()
 *   4. 每轮循环调用 checkTimeout() 处理超时
 *   5. 通过 getRequest(id) 查询请求的最终状态
 */

import type { HITLRequest } from '../core/types.js';

export class HITLStateMachine {
  /** 等待审批的请求（key = request.id） */
  private pending: Map<string, HITLRequest> = new Map();

  /** 已解析的请求历史（APPROVED/DENIED/TIMEOUT），按解析顺序 */
  private history: HITLRequest[] = [];

  // ============================================================
  // 回调
  // ============================================================

  /** 新请求提交时触发 */
  onRequest?: (req: HITLRequest) => void;

  /** 请求被解析（批准/拒绝/超时）时触发 */
  onResolved?: (req: HITLRequest) => void;

  // ============================================================
  // 公共方法
  // ============================================================

  /**
   * 提交新的 HITL 审批请求。
   *
   * - 强制将 status 设为 WAITING
   * - 强制刷新 createdAt 为当前时间
   * - 如果 ID 已存在于 pending 中，返回 false（不会覆盖）
   * - 如果 ID 存在于历史中但已不在 pending，则可以重新提交
   *
   * @returns true 表示提交成功，false 表示 ID 重复
   */
  submit(request: HITLRequest): boolean {
    // 检查是否已存在相同 ID 的等待中请求
    if (this.pending.has(request.id)) {
      return false;
    }

    // 强制设置状态和时间戳
    request.status = 'WAITING';
    request.createdAt = Date.now();

    this.pending.set(request.id, request);
    this.onRequest?.(request);
    return true;
  }

  /**
   * 批准指定 ID 的等待中请求。
   *
   * @returns true 表示批准成功，false 表示请求不存在或已解析
   */
  approve(id: string): boolean {
    return this.resolve(id, 'APPROVED');
  }

  /**
   * 拒绝指定 ID 的等待中请求。
   *
   * @returns true 表示拒绝成功，false 表示请求不存在或已解析
   */
  deny(id: string): boolean {
    return this.resolve(id, 'DENIED');
  }

  /**
   * 检查所有等待中的请求是否超时。
   *
   * 超时判定：当前时间 - createdAt > timeoutSeconds * 1000。
   * 超时的请求 status 设为 TIMEOUT，从 pending 移除，移入 history。
   *
   * @returns 本次超时的请求列表
   */
  checkTimeout(): HITLRequest[] {
    const now = Date.now();
    const timedOut: HITLRequest[] = [];

    for (const [id, req] of this.pending) {
      if (req.status !== 'WAITING') continue;

      const elapsed = now - req.createdAt;
      const limit = req.timeoutSeconds * 1000;

      if (elapsed >= limit) {
        req.status = 'TIMEOUT';
        timedOut.push(req);
        this.pending.delete(id);
        this.history.push(req);
        this.onResolved?.(req);
      }
    }

    return timedOut;
  }

  /**
   * 获取所有处于 WAITING 状态的请求。
   */
  getPending(): HITLRequest[] {
    return Array.from(this.pending.values()).filter(
      (r) => r.status === 'WAITING',
    );
  }

  /**
   * 获取所有已解析的请求（按解析时间排序）。
   */
  getHistory(): HITLRequest[] {
    return [...this.history];
  }

  /**
   * 根据 ID 查找请求（先在 pending 中查找，再在 history 中查找）。
   *
   * @returns 找到的请求，不存在返回 undefined
   */
  getRequest(id: string): HITLRequest | undefined {
    if (!id) return undefined;
    return this.pending.get(id) ?? this.history.find((r) => r.id === id);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  /**
   * 将等待中的请求解析为给定的终态。
   *
   * @param id     请求 ID
   * @param status 目标终态（APPROVED 或 DENIED）
   * @returns true 表示解析成功
   */
  private resolve(id: string, status: 'APPROVED' | 'DENIED'): boolean {
    const req = this.pending.get(id);
    if (!req || req.status !== 'WAITING') return false;

    req.status = status;
    this.pending.delete(id);
    this.history.push(req);
    this.onResolved?.(req);
    return true;
  }
}
