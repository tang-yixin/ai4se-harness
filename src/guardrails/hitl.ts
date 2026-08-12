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

  /**
   * 异步等待请求被解析（审批 / 拒绝 / 超时）。
   *
   * 以 100ms 间隔轮询请求状态：
   *   - 若请求被外部 approve()/deny() 解析 → 返回对应终态
   *   - 若请求超时（当前时间 - createdAt > timeoutSeconds * 1000）
   *     → 标记为 TIMEOUT 并返回
   *   - 若请求不存在（ID 无效或已从所有 Map 移除）→ 返回 TIMEOUT
   *
   * 此方法是 CLI 交互式审批的关键：CLI 注册 onRequest 回调
   * 提示用户输入，主循环通过此方法阻塞等待用户决策。
   *
   * @param id             请求 ID
   * @param timeoutSeconds 超时秒数（与请求创建时设置的一致）
   * @returns 最终状态：'APPROVED' | 'DENIED' | 'TIMEOUT'
   */
  async waitForResolution(
    id: string,
    timeoutSeconds: number,
  ): Promise<'APPROVED' | 'DENIED' | 'TIMEOUT'> {
    const deadline = Date.now() + timeoutSeconds * 1000;

    while (Date.now() < deadline) {
      // 检查请求当前状态
      const req = this.getRequest(id);

      // 请求不存在 → 视为超时（防御性）
      if (!req) {
        return 'TIMEOUT';
      }

      // 已被外部 approve()/deny() 解析
      if (req.status !== 'WAITING') {
        return req.status as 'APPROVED' | 'DENIED' | 'TIMEOUT';
      }

      // 检查超时
      const elapsed = Date.now() - req.createdAt;
      if (elapsed >= timeoutSeconds * 1000) {
        req.status = 'TIMEOUT';
        this.pending.delete(id);
        this.history.push(req);
        this.onResolved?.(req);
        return 'TIMEOUT';
      }

      // 等待下一轮轮询（~100ms）
      await new Promise((r) => setTimeout(r, 100));
    }

    // deadline 已过 → 超时
    const finalReq = this.getRequest(id);
    if (finalReq && finalReq.status === 'WAITING') {
      finalReq.status = 'TIMEOUT';
      this.pending.delete(id);
      this.history.push(finalReq);
      this.onResolved?.(finalReq);
    }

    return 'TIMEOUT';
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
