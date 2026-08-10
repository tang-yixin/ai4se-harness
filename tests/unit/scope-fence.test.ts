/**
 * ScopeFenceGuard 单元测试
 *
 * 覆盖范围围栏的两大职责：
 *   1. validatePath  — 路径边界校验
 *   2. validateHost — 主机白名单校验
 *
 * 测试清单：
 *   PLAN 要求的 Happy Path
 *   + 空输入 / 极端值
 *   + 错误路径 / 越界尝试
 *   + 多次调用 / 状态累积
 *   + Windows 路径兼容
 */

import { describe, it, expect } from 'vitest';
import { ScopeFenceGuard } from '../../src/guardrails/scope-fence.js';
import { resolve } from 'path';
import { tmpdir } from 'os';

// ============================================================
// 辅助函数
// ============================================================

/** 构造 ScopeFenceGuard 实例 */
function makeGuard(opts?: {
  workspaceRoot?: string;
  allowedHosts?: string[];
  maxShellTimeMs?: number;
}): ScopeFenceGuard {
  return new ScopeFenceGuard({
    workspaceRoot: opts?.workspaceRoot ?? '.',
    allowedHosts: opts?.allowedHosts ?? ['github.com'],
    maxShellTimeMs: opts?.maxShellTimeMs ?? 30000,
  });
}

// ============================================================
// validatePath — Happy Path（PLAN 要求的最低测试）
// ============================================================

describe('ScopeFenceGuard.validatePath — Happy Path', () => {
  it('允许工作区内的相对路径（./ 前缀）', () => {
    const guard = makeGuard();
    expect(guard.validatePath('./src/index.ts').allowed).toBe(true);
  });

  it('允许工作区内的相对路径（无前缀）', () => {
    const guard = makeGuard();
    expect(guard.validatePath('src/index.ts').allowed).toBe(true);
  });

  it('拒绝工作区外的绝对路径', () => {
    const guard = makeGuard();
    const result = guard.validatePath('/etc/hosts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('之外');
  });

  it('拒绝父目录穿越路径', () => {
    const guard = makeGuard();
    const result = guard.validatePath('../../../etc/passwd');
    expect(result.allowed).toBe(false);
  });
});

// ============================================================
// validateHost — Happy Path（PLAN 要求的最低测试）
// ============================================================

describe('ScopeFenceGuard.validateHost — Happy Path', () => {
  it('允许白名单中的主机（裸主机名）', () => {
    const guard = makeGuard();
    expect(guard.validateHost('github.com').allowed).toBe(true);
  });

  it('拒绝不在白名单中的主机', () => {
    const guard = makeGuard();
    const result = guard.validateHost('evil.example.com');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('不在允许的主机列表中');
  });
});

// ============================================================
// validatePath — 边界测试（空输入 / 极端值）
// ============================================================

describe('ScopeFenceGuard.validatePath — 边界测试', () => {
  it('拒绝空字符串路径', () => {
    const guard = makeGuard();
    const result = guard.validatePath('');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('为空');
  });

  it('拒绝纯空白路径', () => {
    const guard = makeGuard();
    const result = guard.validatePath('   \t  ');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('为空');
  });

  it('允许工作区根目录自身（"."）', () => {
    const guard = makeGuard({ workspaceRoot: '/tmp/test-workspace' });
    // 直接用解析后的工作区路径测试
    const workspaceRoot = resolve('/tmp/test-workspace');
    const directGuard = new ScopeFenceGuard({
      workspaceRoot,
      allowedHosts: [],
      maxShellTimeMs: 30000,
    });
    // 指向工作区根目录自身的文件
    const result = directGuard.validatePath(workspaceRoot + '/file.txt');
    expect(result.allowed).toBe(true);
  });

  it('拒绝 symlink 无法追踪的路径（保持拒绝，因为无法解析）', () => {
    // 这个测试验证越界路径能正确被拒绝，不依赖 symlink 是否存在
    const guard = makeGuard();
    const result = guard.validatePath('/nonexistent/../../../etc/shadow');
    expect(result.allowed).toBe(false);
  });

  it('允许根目录（workspaceRoot 为 / 时写入 / 下文件）', () => {
    // 极端情况：workspaceRoot 设为系统根目录
    const guard = makeGuard({ workspaceRoot: '/' });
    // /etc/hosts 在 / 下，应该允许（虽然通常不会这么做）
    const result = guard.validatePath('/etc/hosts');
    // 注意：这个行为取决于实现。保守实现：允许（因为技术上在 worktree 内）
    // 但在实际中护栏的第二层（GuardrailEngine）会拦截系统路径
    expect(result.allowed).toBe(true);
  });
});

// ============================================================
// validatePath — 越界尝试（多种穿越方式）
// ============================================================

describe('ScopeFenceGuard.validatePath — 越界尝试', () => {
  it('拒绝 Unix 风格父目录穿越（../）', () => {
    const guard = makeGuard();
    const result = guard.validatePath('../outside/file.ts');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('之外');
  });

  it('拒绝 Windows 风格父目录穿越（..\\）', () => {
    const guard = makeGuard();
    const result = guard.validatePath('..\\..\\..\\Windows\\System32\\config');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('之外');
  });

  it('拒绝深层父目录穿越', () => {
    const guard = makeGuard();
    const result = guard.validatePath(
      '../../../../../../../../../../etc/shadow',
    );
    expect(result.allowed).toBe(false);
  });

  it('允许工作区内的深层正常路径', () => {
    const guard = makeGuard();
    const result = guard.validatePath('./a/b/c/d/e/f/g/index.ts');
    expect(result.allowed).toBe(true);
  });

  it('拒绝绝对路径指向工作区外', () => {
    const guard = makeGuard({ workspaceRoot: '/home/user/project' });
    const result = guard.validatePath('/var/log/syslog');
    expect(result.allowed).toBe(false);
  });

  it('允许绝对路径指向工作区内', () => {
    const guard = makeGuard();
    const workspaceRoot = resolve(guard.getWorkspaceRoot());
    const result = guard.validatePath(workspaceRoot + '/src/file.ts');
    expect(result.allowed).toBe(true);
  });
});

// ============================================================
// validatePath — Windows 路径兼容
// ============================================================

describe('ScopeFenceGuard.validatePath — Windows 路径兼容', () => {
  it('拒绝 Windows 绝对路径指向其他盘符', () => {
    const guard = makeGuard({ workspaceRoot: 'C:\\Users\\dev\\project' });
    const result = guard.validatePath('D:\\secret\\file.txt');
    expect(result.allowed).toBe(false);
  });

  it('允许 Windows 绝对路径指向工作区内', () => {
    const guard = makeGuard({ workspaceRoot: 'C:\\Users\\dev\\project' });
    const result = guard.validatePath(
      'C:\\Users\\dev\\project\\src\\index.ts',
    );
    expect(result.allowed).toBe(true);
  });

  it('处理混合斜杠的路径', () => {
    const guard = makeGuard({ workspaceRoot: 'C:\\Users\\dev\\project' });
    // Windows 下有时会混用正反斜杠
    const result = guard.validatePath(
      'C:\\Users\\dev\\project/src/index.ts',
    );
    expect(result.allowed).toBe(true);
  });
});

// ============================================================
// validateHost — 边界测试（URL/端口/协议等格式）
// ============================================================

describe('ScopeFenceGuard.validateHost — 格式处理', () => {
  it('接受完整 HTTPS URL', () => {
    const guard = makeGuard();
    expect(guard.validateHost('https://github.com/user/repo').allowed).toBe(
      true,
    );
  });

  it('接受 HTTP URL', () => {
    const guard = makeGuard();
    expect(guard.validateHost('http://github.com/path').allowed).toBe(true);
  });

  it('接受带端口的 URL', () => {
    const guard = makeGuard();
    expect(
      guard.validateHost('https://github.com:443/user/repo').allowed,
    ).toBe(true);
  });

  it('接受不带协议的 host:port', () => {
    const guard = makeGuard();
    expect(guard.validateHost('github.com:22').allowed).toBe(true);
  });

  it('接受带路径的裸主机名', () => {
    const guard = makeGuard();
    expect(guard.validateHost('github.com/user/repo.git').allowed).toBe(true);
  });

  it('拒绝空字符串主机', () => {
    const guard = makeGuard();
    const result = guard.validateHost('');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('为空');
  });

  it('拒绝纯空白主机', () => {
    const guard = makeGuard();
    const result = guard.validateHost('   ');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('为空');
  });
});

// ============================================================
// validateHost — 多个白名单主机
// ============================================================

describe('ScopeFenceGuard.validateHost — 多个白名单', () => {
  it('支持多个允许的主机', () => {
    const guard = makeGuard({
      allowedHosts: ['github.com', 'gitlab.com', 'bitbucket.org'],
    });

    expect(guard.validateHost('github.com').allowed).toBe(true);
    expect(guard.validateHost('gitlab.com').allowed).toBe(true);
    expect(guard.validateHost('bitbucket.org').allowed).toBe(true);
    expect(guard.validateHost('evil.com').allowed).toBe(false);
  });

  it('空白名单拒绝所有主机', () => {
    const guard = makeGuard({ allowedHosts: [] });
    expect(guard.validateHost('github.com').allowed).toBe(false);
    expect(guard.validateHost('any-host.example.com').allowed).toBe(false);
  });

  it('子域名不被父域名的白名单隐式允许', () => {
    const guard = makeGuard({ allowedHosts: ['github.com'] });
    // api.github.com 是子域名，不在白名单中
    const result = guard.validateHost('api.github.com');
    expect(result.allowed).toBe(false);
  });

  it('IPv6 地址提取后去掉方括号与白名单匹配', () => {
    const guard = makeGuard({ allowedHosts: ['::1', 'localhost'] });
    // [::1]:8080 → 提取后应为 ::1（不含方括号）
    expect(guard.validateHost('[::1]:8080').allowed).toBe(true);
  });
});

// ============================================================
// 多次调用 / 状态累积
// ============================================================

describe('ScopeFenceGuard — 多次调用 / 状态累积', () => {
  it('连续多次 validatePath 调用互不干扰', () => {
    const guard = makeGuard();

    const r1 = guard.validatePath('./src/a.ts');
    const r2 = guard.validatePath('/etc/hosts');
    const r3 = guard.validatePath('./tests/b.test.ts');

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(false);
    expect(r3.allowed).toBe(true);
  });

  it('连续多次 validateHost 调用互不干扰', () => {
    const guard = makeGuard({ allowedHosts: ['github.com', 'npmjs.org'] });

    const h1 = guard.validateHost('github.com');
    const h2 = guard.validateHost('evil.com');
    const h3 = guard.validateHost('npmjs.org');

    expect(h1.allowed).toBe(true);
    expect(h2.allowed).toBe(false);
    expect(h3.allowed).toBe(true);
  });

  it('validatePath 和 validateHost 调用互不干扰', () => {
    const guard = makeGuard();

    const p1 = guard.validatePath('./ok.txt');
    const h1 = guard.validateHost('github.com');
    const p2 = guard.validatePath('/etc/bad.txt');
    const h2 = guard.validateHost('bad.com');

    expect(p1.allowed).toBe(true);
    expect(h1.allowed).toBe(true);
    expect(p2.allowed).toBe(false);
    expect(h2.allowed).toBe(false);
  });

  it('同一个 guard 实例多次处理相同的越界路径始终返回一致结果', () => {
    const guard = makeGuard();

    for (let i = 0; i < 5; i++) {
      const r = guard.validatePath('/etc/shadow');
      expect(r.allowed).toBe(false);
      expect(r.reason).toBeDefined();
    }
  });
});

// ============================================================
// getWorkspaceRoot / getMaxShellTimeMs
// ============================================================

describe('ScopeFenceGuard — 属性访问器', () => {
  it('getWorkspaceRoot 返回解析后的工作区根目录', () => {
    const guard = makeGuard({ workspaceRoot: '/tmp/my-project' });
    expect(guard.getWorkspaceRoot()).toBe(resolve('/tmp/my-project'));
  });

  it('getMaxShellTimeMs 返回配置的最大 shell 执行时间', () => {
    const guard = makeGuard({ maxShellTimeMs: 45000 });
    expect(guard.getMaxShellTimeMs()).toBe(45000);
  });

  it('getAllowedHosts 返回白名单列表', () => {
    const guard = makeGuard({ allowedHosts: ['a.com', 'b.com'] });
    expect(guard.getAllowedHosts()).toEqual(['a.com', 'b.com']);
  });
});

// ============================================================
// validatePath — 相对路径解析为工作区子路径
// ============================================================

describe('ScopeFenceGuard.validatePath — 相对路径解析', () => {
  it('相对路径解析为工作区的绝对路径子路径', () => {
    const guard = makeGuard({ workspaceRoot: '/tmp/test-dir' });
    // 相对路径 ./foo 应解析为 workspaceRoot/foo
    const result = guard.validatePath('./foo/bar.txt');
    expect(result.allowed).toBe(true);
  });

  it('路径中包含 .. 但不越界（先上后下）', () => {
    // 例如：工作区内 a/b/../c  → 实际是 a/c，仍在工作区内
    const guard = makeGuard({ workspaceRoot: '/tmp/test-dir' });
    const result = guard.validatePath('/tmp/test-dir/a/../c/file.txt');
    expect(result.allowed).toBe(true);
  });
});
