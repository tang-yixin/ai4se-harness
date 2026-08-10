import { describe, it, expect, afterEach } from 'vitest';
import { CredentialStore, CredentialError } from '../../src/credentials/store.js';
import { unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CredentialStore', () => {
  const testFile = join(tmpdir(), 'test-credentials.enc');

  afterEach(() => {
    try { unlinkSync(testFile); } catch {}
  });

  // ================================================================
  // Happy path — 基本加解密
  // ================================================================

  it('加密后再解密应返回原始 API key', async () => {
    await CredentialStore.save('sk-test-key-12345', 'my-master-pw', testFile);

    const key = await CredentialStore.load('my-master-pw', testFile);
    expect(key).toBe('sk-test-key-12345');
  });

  it('包含特殊字符的 API key 应正确加解密', async () => {
    const specialKey = 'sk-!@#$%^&*()_+-=[]{}|;:,.<>?/~`"\'\\';
    await CredentialStore.save(specialKey, 'pw', testFile);

    const key = await CredentialStore.load('pw', testFile);
    expect(key).toBe(specialKey);
  });

  it('包含 Unicode 字符的密钥和密码应正确加解密', async () => {
    const unicodeKey = 'sk-🔐-测试密钥-日本語-한국어';
    await CredentialStore.save(unicodeKey, '主密码🔑', testFile);

    const key = await CredentialStore.load('主密码🔑', testFile);
    expect(key).toBe(unicodeKey);
  });

  it('超长 API key（10000 字符）应正确加解密', async () => {
    const longKey = 'sk-' + 'x'.repeat(10000);
    await CredentialStore.save(longKey, 'pw', testFile);

    const key = await CredentialStore.load('pw', testFile);
    expect(key).toBe(longKey);
  });

  // ================================================================
  // 错误密码
  // ================================================================

  it('使用错误主密码时应抛出 CredentialError', async () => {
    await CredentialStore.save('sk-test-key-12345', 'correct-pw', testFile);

    await expect(CredentialStore.load('wrong-pw', testFile)).rejects.toThrow(CredentialError);
  });

  it('使用错误主密码时错误消息应包含提示信息', async () => {
    await CredentialStore.save('sk-test-key-12345', 'correct-pw', testFile);

    await expect(CredentialStore.load('wrong-pw', testFile)).rejects.toThrow(/password|credential/i);
  });

  // ================================================================
  // 文件存在检测
  // ================================================================

  it('文件不存在时 exists 返回 false', () => {
    expect(CredentialStore.exists(testFile)).toBe(false);
  });

  it('保存后 exists 返回 true', async () => {
    await CredentialStore.save('sk-abc', 'pw', testFile);
    expect(CredentialStore.exists(testFile)).toBe(true);
  });

  // ================================================================
  // 删除
  // ================================================================

  it('删除后文件应不存在', async () => {
    await CredentialStore.save('sk-abc', 'pw', testFile);
    expect(CredentialStore.exists(testFile)).toBe(true);

    await CredentialStore.delete(testFile);
    expect(CredentialStore.exists(testFile)).toBe(false);
  });

  it('删除不存在的文件不应抛出错误', async () => {
    // 文件不存在，delete 应该是幂等的，不抛异常
    await expect(CredentialStore.delete(testFile)).resolves.not.toThrow();
  });

  // ================================================================
  // 空输入 / 极端值
  // ================================================================

  it('空 API key 应正确加解密', async () => {
    await CredentialStore.save('', 'pw', testFile);

    const key = await CredentialStore.load('pw', testFile);
    expect(key).toBe('');
  });

  it('空主密码应能正确加解密', async () => {
    await CredentialStore.save('sk-some-key', '', testFile);

    const key = await CredentialStore.load('', testFile);
    expect(key).toBe('sk-some-key');
  });

  // ================================================================
  // 错误路径 — 文件不存在 / 损坏
  // ================================================================

  it('从不存在的文件加载应抛出 CredentialError', async () => {
    await expect(CredentialStore.load('pw', '/nonexistent/path/to/credentials.enc'))
      .rejects.toThrow(CredentialError);
  });

  it('文件内容不是有效 JSON 时应抛出 CredentialError', async () => {
    writeFileSync(testFile, 'this is not json at all', 'utf-8');

    await expect(CredentialStore.load('pw', testFile)).rejects.toThrow(CredentialError);
  });

  it('文件被篡改（缺少必要字段）时应抛出 CredentialError', async () => {
    writeFileSync(testFile, JSON.stringify({ encryptedKey: 'abc' }), 'utf-8'); // 缺少 iv, salt, authTag

    await expect(CredentialStore.load('pw', testFile)).rejects.toThrow(CredentialError);
  });

  it('文件包含非法 Base64 数据时应抛出 CredentialError', async () => {
    writeFileSync(testFile, JSON.stringify({
      encryptedKey: '!!!not-valid-base64!!!',
      iv: '!!!not-valid-base64!!!',
      salt: '!!!not-valid-base64!!!',
      authTag: '!!!not-valid-base64!!!',
    }), 'utf-8');

    await expect(CredentialStore.load('pw', testFile)).rejects.toThrow(CredentialError);
  });

  // ================================================================
  // 多次调用 / 状态累积
  // ================================================================

  it('同一文件保存两次应覆盖旧数据，新密码加载成功', async () => {
    await CredentialStore.save('old-key', 'old-pw', testFile);
    // 用新密码覆盖
    await CredentialStore.save('new-key', 'new-pw', testFile);

    // 旧密码应失败
    await expect(CredentialStore.load('old-pw', testFile)).rejects.toThrow(CredentialError);

    // 新密码应成功
    const key = await CredentialStore.load('new-pw', testFile);
    expect(key).toBe('new-key');
  });

  it('多次加载同一文件应返回相同结果', async () => {
    await CredentialStore.save('consistent-key', 'pw', testFile);

    const key1 = await CredentialStore.load('pw', testFile);
    const key2 = await CredentialStore.load('pw', testFile);
    const key3 = await CredentialStore.load('pw', testFile);

    expect(key1).toBe('consistent-key');
    expect(key2).toBe('consistent-key');
    expect(key3).toBe('consistent-key');
  });

  // ================================================================
  // CredentialError 类型检查
  // ================================================================

  it('CredentialError 应是 Error 的子类', () => {
    const error = new CredentialError('test message');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(CredentialError);
    expect(error.name).toBe('CredentialError');
    expect(error.message).toBe('test message');
  });
});
