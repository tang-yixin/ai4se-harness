/**
 * CredentialStore —— 凭据加密存储模块
 *
 * 使用 PBKDF2 密钥派生 + AES-256-GCM 认证加密来保护 API key。
 * 加密后的凭据存储在文件中，只有知道主密码才能解密。
 *
 * 安全特性：
 * - PBKDF2 100,000 轮迭代（抗暴力破解）
 * - AES-256-GCM 认证加密（防篡改）
 * - 每次保存使用随机 salt + 随机 IV
 * - 明文 key 只存在于进程内存中，不落盘
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
} from 'crypto';
import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// ================================================================
// 加密常量
// ================================================================

const ALGORITHM = 'aes-256-gcm';
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH = 32; // 256 bits for AES-256
const IV_LENGTH = 16; // GCM 推荐 12-16 字节
const SALT_LENGTH = 32; // 256-bit salt

// ================================================================
// 加密文件数据结构
// ================================================================

interface CredentialFile {
  /** AES-256-GCM 加密后的 API key（Base64） */
  encryptedKey: string;
  /** 初始化向量（Base64） */
  iv: string;
  /** PBKDF2 salt（Base64） */
  salt: string;
  /** GCM 认证标签（Base64） */
  authTag: string;
}

// ================================================================
// 自定义错误类型
// ================================================================

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

// ================================================================
// CredentialStore
// ================================================================

export class CredentialStore {
  /**
   * 获取默认的凭据文件路径。
   * 位置：~/.ai4se-harness/credentials.enc
   */
  static defaultPath(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
    return join(home, '.ai4se-harness', 'credentials.enc');
  }

  /**
   * 检查凭据文件是否存在。
   * @param filePath 凭据文件路径，默认使用 ~/.ai4se-harness/credentials.enc
   */
  static exists(filePath?: string): boolean {
    return existsSync(filePath ?? CredentialStore.defaultPath());
  }

  /**
   * 使用主密码加密并保存 API key 到文件。
   *
   * 加密流程：
   * 1. 生成随机 salt（32 字节）和 IV（16 字节）
   * 2. 主密码 + salt → PBKDF2(100,000 轮) → 256-bit 密钥
   * 3. API key → AES-256-GCM 加密 → 密文 + authTag
   * 4. { encryptedKey, iv, salt, authTag } 写入 JSON 文件
   *
   * @param apiKey     要加密的 API key 明文
   * @param masterPassword 主密码（用于派生加密密钥）
   * @param filePath   凭据文件路径，默认使用 ~/.ai4se-harness/credentials.enc
   */
  static async save(
    apiKey: string,
    masterPassword: string,
    filePath?: string,
  ): Promise<void> {
    // 生成随机 salt 和 IV
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);

    // PBKDF2 派生密钥
    const key = pbkdf2Sync(
      masterPassword,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512',
    );

    // AES-256-GCM 加密
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(apiKey, 'utf-8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // 构建凭据文件内容
    const data: CredentialFile = {
      encryptedKey: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      salt: salt.toString('base64'),
      authTag: authTag.toString('base64'),
    };

    // 确保目录存在
    const targetPath = filePath ?? CredentialStore.defaultPath();
    const dir = dirname(targetPath);
    mkdirSync(dir, { recursive: true });

    writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 从文件中加载并解密 API key。
   *
   * 解密流程：
   * 1. 读取 JSON 文件，提取 encryptedKey, iv, salt, authTag
   * 2. 主密码 + salt → PBKDF2(100,000 轮) → 256-bit 密钥
   * 3. AES-256-GCM 解密 → 明文 API key
   * 4. 如果 authTag 不匹配（密码错误或文件被篡改），抛出 CredentialError
   *
   * @param masterPassword 主密码
   * @param filePath       凭据文件路径，默认使用 ~/.ai4se-harness/credentials.enc
   * @returns 解密后的 API key 明文
   * @throws CredentialError 密码错误、文件不存在、或数据损坏时
   */
  static async load(
    masterPassword: string,
    filePath?: string,
  ): Promise<string> {
    const targetPath = filePath ?? CredentialStore.defaultPath();

    // 读取并解析凭据文件
    let raw: string;
    try {
      raw = readFileSync(targetPath, 'utf-8');
    } catch {
      throw new CredentialError(
        'Cannot read credential file. Run "harness setup" first.',
      );
    }

    let data: CredentialFile;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new CredentialError(
        'Credential file is corrupted: invalid JSON.',
      );
    }

    // 验证必要字段（用 hasOwnProperty 而非 truthiness，因为空字符串是合法值）
    if (!Object.hasOwn(data, 'encryptedKey')
      || !Object.hasOwn(data, 'iv')
      || !Object.hasOwn(data, 'salt')
      || !Object.hasOwn(data, 'authTag')) {
      throw new CredentialError(
        'Credential file is corrupted: missing required fields.',
      );
    }

    // 预检 Base64 合法性——Buffer.from 在 Node.js 中遇到非法字符不会抛异常，
    // 而是静默跳过，因此必须先做格式校验，否则错误消息会被解密步骤兜底为"密码错误"
    const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!BASE64_RE.test(data.salt)
      || !BASE64_RE.test(data.iv)
      || !BASE64_RE.test(data.authTag)
      || !BASE64_RE.test(data.encryptedKey)) {
      throw new CredentialError(
        'Credential file is corrupted: invalid Base64 encoding.',
      );
    }

    const salt = Buffer.from(data.salt, 'base64');
    const iv = Buffer.from(data.iv, 'base64');
    const authTag = Buffer.from(data.authTag, 'base64');
    const encryptedKey = Buffer.from(data.encryptedKey, 'base64');

    // PBKDF2 派生密钥
    const key = pbkdf2Sync(
      masterPassword,
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      'sha512',
    );

    // AES-256-GCM 解密
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    try {
      const decrypted = Buffer.concat([
        decipher.update(encryptedKey),
        decipher.final(),
      ]);
      return decrypted.toString('utf-8');
    } catch {
      throw new CredentialError('Incorrect master password or corrupted credential file.');
    }
  }

  /**
   * 删除凭据文件。
   * 如果文件不存在，静默成功（幂等操作）。
   *
   * @param filePath 凭据文件路径，默认使用 ~/.ai4se-harness/credentials.enc
   */
  static async delete(filePath?: string): Promise<void> {
    const targetPath = filePath ?? CredentialStore.defaultPath();
    if (existsSync(targetPath)) {
      unlinkSync(targetPath);
    }
  }
}
