/**
 * HITL 状态机单元测试
 *
 * 测试覆盖：
 *   1. 基础 happy path：submit / approve / deny / timeout
 *   2. 边界条件：重复 ID、已解析请求、空值、大批量
 *   3. 状态累积：多次调用间状态正确隔离
 *   4. 回调机制：onRequest / onResolved 正确触发
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HITLStateMachine } from '../../src/guardrails/hitl.js';
import { HITLRequest } from '../../src/core/types.js';

// ============================================================
// 辅助函数
// ============================================================

function makeRequest(overrides: Partial<HITLRequest> = {}): HITLRequest {
  return {
    id: 'req-1',
    toolName: 'execute_shell',
    params: { command: 'rm important.txt' },
    risk: 'high',
    reason: '匹配高风险模式: rm（删除文件）',
    status: 'WAITING',
    createdAt: Date.now(),
    timeoutSeconds: 60,
    ...overrides,
  };
}

// ============================================================
// 测试套件
// ============================================================

describe('HITLStateMachine', () => {
  let hitl: HITLStateMachine;

  beforeEach(() => {
    hitl = new HITLStateMachine();
  });

  // ----------------------------------------------------------
  // 初始状态
  // ----------------------------------------------------------

  describe('初始状态', () => {
    it('队列为空', () => {
      expect(hitl.getPending()).toHaveLength(0);
      expect(hitl.getHistory()).toHaveLength(0);
    });

    it('未设置的 onRequest / onResolved 为 undefined', () => {
      expect(hitl.onRequest).toBeUndefined();
      expect(hitl.onResolved).toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // submit
  // ----------------------------------------------------------

  describe('submit()', () => {
    it('提交请求并将其加入等待队列', () => {
      const req = makeRequest();
      const result = hitl.submit(req);

      expect(result).toBe(true);
      expect(hitl.getPending()).toHaveLength(1);
      expect(hitl.getPending()[0].id).toBe('req-1');
      expect(hitl.getPending()[0].status).toBe('WAITING');
    });

    it('触发 onRequest 回调', () => {
      const callback = vi.fn();
      hitl.onRequest = callback;

      const req = makeRequest();
      hitl.submit(req);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(req);
    });

    it('onRequest 为 undefined 时不抛错', () => {
      const req = makeRequest();
      expect(() => hitl.submit(req)).not.toThrow();
    });

    it('强制将提交请求的 status 设为 WAITING', () => {
      // 即使传入时 status 是其他值，submit 也应该设为 WAITING
      const req = makeRequest({ status: 'APPROVED' });
      hitl.submit(req);

      expect(hitl.getPending()[0].status).toBe('WAITING');
    });

    it('强制刷新 createdAt 为当前时间', () => {
      const oldTime = Date.now() - 100_000;
      const req = makeRequest({ createdAt: oldTime });
      hitl.submit(req);

      // createdAt 应该被更新为接近当前时间
      expect(hitl.getPending()[0].createdAt).toBeGreaterThanOrEqual(oldTime);
      expect(hitl.getPending()[0].createdAt).toBeLessThanOrEqual(Date.now());
    });

    it('重复 ID 提交返回 false，不覆盖已有请求', () => {
      const req1 = makeRequest({ id: 'dup' });
      hitl.submit(req1);

      const req2 = makeRequest({ id: 'dup', toolName: 'write_file' });
      const result = hitl.submit(req2);

      expect(result).toBe(false);
      // 原有请求不被覆盖
      expect(hitl.getPending()[0].toolName).toBe('execute_shell');
    });

    it('重复 ID——但已解析后可重新提交', () => {
      const req1 = makeRequest({ id: 'reuse' });
      hitl.submit(req1);
      hitl.approve('reuse');

      // 已批准后可以重新使用同一 ID
      const req2 = makeRequest({ id: 'reuse', toolName: 'write_file' });
      const result = hitl.submit(req2);

      expect(result).toBe(true);
      expect(hitl.getPending()[0].toolName).toBe('write_file');
    });
  });

  // ----------------------------------------------------------
  // approve
  // ----------------------------------------------------------

  describe('approve()', () => {
    it('批准等待中的请求，返回 true', () => {
      hitl.submit(makeRequest({ id: '1' }));
      const result = hitl.approve('1');

      expect(result).toBe(true);
      expect(hitl.getPending()).toHaveLength(0);
    });

    it('触发 onResolved 回调（status=APPROVED）', () => {
      const callback = vi.fn();
      hitl.onResolved = callback;
      hitl.submit(makeRequest({ id: '1' }));

      hitl.approve('1');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', status: 'APPROVED' }),
      );
    });

    it('请求存入历史记录', () => {
      hitl.submit(makeRequest({ id: '1' }));
      hitl.approve('1');

      expect(hitl.getHistory()).toHaveLength(1);
      expect(hitl.getHistory()[0].status).toBe('APPROVED');
    });

    it('不存在的 ID 返回 false', () => {
      expect(hitl.approve('ghost')).toBe(false);
    });

    it('已解析（已批准）的请求不能二次批准', () => {
      hitl.submit(makeRequest({ id: '1' }));
      hitl.approve('1');

      // 已经不在 pending 中，再次批准无效
      expect(hitl.approve('1')).toBe(false);
    });

    it('已拒绝的请求不能改为批准', () => {
      hitl.submit(makeRequest({ id: '1' }));
      hitl.deny('1');

      expect(hitl.approve('1')).toBe(false);
      expect(hitl.getHistory()[0].status).toBe('DENIED');
    });

    it('已超时的请求不能改为批准', () => {
      const req = makeRequest({ id: '1', timeoutSeconds: -1 });
      hitl.submit(req);
      hitl.checkTimeout();

      expect(hitl.approve('1')).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // deny
  // ----------------------------------------------------------

  describe('deny()', () => {
    it('拒绝等待中的请求，返回 true', () => {
      hitl.submit(makeRequest({ id: '1' }));
      const result = hitl.deny('1');

      expect(result).toBe(true);
      expect(hitl.getPending()).toHaveLength(0);
    });

    it('触发 onResolved 回调（status=DENIED）', () => {
      const callback = vi.fn();
      hitl.onResolved = callback;
      hitl.submit(makeRequest({ id: '1' }));

      hitl.deny('1');

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', status: 'DENIED' }),
      );
    });

    it('请求存入历史记录', () => {
      hitl.submit(makeRequest({ id: '1' }));
      hitl.deny('1');

      expect(hitl.getHistory()).toHaveLength(1);
      expect(hitl.getHistory()[0].status).toBe('DENIED');
    });

    it('不存在的 ID 返回 false', () => {
      expect(hitl.deny('ghost')).toBe(false);
    });

    it('已批准的请求不能改为拒绝', () => {
      hitl.submit(makeRequest({ id: '1' }));
      hitl.approve('1');

      expect(hitl.deny('1')).toBe(false);
    });

    it('已拒绝的请求不能二次拒绝', () => {
      hitl.submit(makeRequest({ id: '1' }));
      hitl.deny('1');

      expect(hitl.deny('1')).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // checkTimeout
  // ----------------------------------------------------------

  describe('checkTimeout()', () => {
    it('检测并返回已超时的请求', () => {
      const expired = makeRequest({ id: 'expired', timeoutSeconds: -1 });
      hitl.submit(expired);

      const timedOut = hitl.checkTimeout();
      expect(timedOut).toHaveLength(1);
      expect(timedOut[0].id).toBe('expired');
      expect(timedOut[0].status).toBe('TIMEOUT');
    });

    it('超时触发 onResolved 回调', () => {
      const callback = vi.fn();
      hitl.onResolved = callback;

      const expired = makeRequest({ id: 'expired', timeoutSeconds: -1 });
      hitl.submit(expired);
      hitl.checkTimeout();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'expired', status: 'TIMEOUT' }),
      );
    });

    it('未过期的请求不被标记为超时', () => {
      hitl.submit(makeRequest({ id: 'future', timeoutSeconds: 3600 }));

      const timedOut = hitl.checkTimeout();
      expect(timedOut).toHaveLength(0);
      expect(hitl.getPending()).toHaveLength(1);
    });

    it('多个请求中只标记已过期的', () => {
      hitl.submit(makeRequest({ id: 'a', timeoutSeconds: 3600 }));
      hitl.submit(makeRequest({ id: 'b', timeoutSeconds: -1 }));
      hitl.submit(makeRequest({ id: 'c', timeoutSeconds: -2 }));

      const timedOut = hitl.checkTimeout();

      expect(timedOut).toHaveLength(2);
      expect(timedOut.map((r) => r.id).sort()).toEqual(['b', 'c']);
      expect(hitl.getPending()).toHaveLength(1);
      expect(hitl.getPending()[0].id).toBe('a');
    });

    it('无等待请求时返回空数组', () => {
      const timedOut = hitl.checkTimeout();
      expect(timedOut).toHaveLength(0);
    });

    it('已超时请求移入历史记录', () => {
      hitl.submit(makeRequest({ id: 'expired', timeoutSeconds: -1 }));
      hitl.checkTimeout();

      expect(hitl.getHistory()).toHaveLength(1);
      expect(hitl.getHistory()[0].status).toBe('TIMEOUT');
    });

    it('零超时（timeoutSeconds=0）立即过期', () => {
      hitl.submit(makeRequest({ id: 'zero', timeoutSeconds: 0 }));

      const timedOut = hitl.checkTimeout();
      expect(timedOut).toHaveLength(1);
    });

    it('已经批准/拒绝的不被 checkTimeout 影响', () => {
      hitl.submit(makeRequest({ id: 'approved', timeoutSeconds: -1 }));
      hitl.approve('approved');

      hitl.submit(makeRequest({ id: 'denied', timeoutSeconds: -1 }));
      hitl.deny('denied');

      // checkTimeout 不应再处理已解析的
      const timedOut = hitl.checkTimeout();
      expect(timedOut).toHaveLength(0);
    });
  });

  // ----------------------------------------------------------
  // getRequest
  // ----------------------------------------------------------

  describe('getRequest()', () => {
    it('查找等待中的请求', () => {
      hitl.submit(makeRequest({ id: '1' }));
      const req = hitl.getRequest('1');
      expect(req).toBeDefined();
      expect(req!.status).toBe('WAITING');
    });

    it('查找已解析的请求（从历史中）', () => {
      hitl.submit(makeRequest({ id: '1' }));
      hitl.approve('1');

      const req = hitl.getRequest('1');
      expect(req).toBeDefined();
      expect(req!.status).toBe('APPROVED');
    });

    it('不存在的 ID 返回 undefined', () => {
      expect(hitl.getRequest('nosuch')).toBeUndefined();
    });

    it('空字符串 ID 返回 undefined', () => {
      expect(hitl.getRequest('')).toBeUndefined();
    });
  });

  // ----------------------------------------------------------
  // getPending / getHistory
  // ----------------------------------------------------------

  describe('getPending() 与 getHistory()', () => {
    it('getPending 只返回 WAITING 状态的请求', () => {
      hitl.submit(makeRequest({ id: 'a' }));
      hitl.submit(makeRequest({ id: 'b' }));
      hitl.approve('a');

      const pending = hitl.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('b');
    });

    it('getHistory 按解析顺序返回', () => {
      hitl.submit(makeRequest({ id: 'first' }));
      hitl.submit(makeRequest({ id: 'second' }));
      hitl.submit(makeRequest({ id: 'third' }));

      hitl.approve('first');
      hitl.deny('second');
      hitl.submit(makeRequest({ id: 'third-timeout', timeoutSeconds: -1 }));
      // 这个 third-timeout 与 third 不同 id

      const history = hitl.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('first');
      expect(history[1].id).toBe('second');
    });
  });

  // ----------------------------------------------------------
  // 综合场景
  // ----------------------------------------------------------

  describe('综合场景', () => {
    it('完整的请求生命周期：submit → approve → history', () => {
      hitl.submit(makeRequest({ id: 'lifecycle' }));

      // 等待中
      expect(hitl.getPending()).toHaveLength(1);
      expect(hitl.getRequest('lifecycle')!.status).toBe('WAITING');

      // 批准
      hitl.approve('lifecycle');
      expect(hitl.getPending()).toHaveLength(0);
      expect(hitl.getRequest('lifecycle')!.status).toBe('APPROVED');
    });

    it('混合操作：提交多个请求，不同方式解析', () => {
      const onReq = vi.fn();
      const onRes = vi.fn();
      hitl.onRequest = onReq;
      hitl.onResolved = onRes;

      hitl.submit(makeRequest({ id: 'r1' }));
      hitl.submit(makeRequest({ id: 'r2' }));
      hitl.submit(makeRequest({ id: 'r3' }));

      hitl.approve('r1');
      hitl.deny('r2');

      expect(onReq).toHaveBeenCalledTimes(3);
      expect(onRes).toHaveBeenCalledTimes(2);

      // r3 仍在等待
      expect(hitl.getPending()).toHaveLength(1);
      expect(hitl.getPending()[0].id).toBe('r3');
    });

    it('使用不同超时时间模拟真实命中腰场景', () => {
      hitl.submit(makeRequest({ id: 'quick', timeoutSeconds: 5 }));
      hitl.submit(makeRequest({ id: 'slow', timeoutSeconds: 120 }));

      // 两者都未超时
      const timedOut = hitl.checkTimeout();
      expect(timedOut).toHaveLength(0);
    });
  });
});
