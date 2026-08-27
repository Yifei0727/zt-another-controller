use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// PBKDF2-HMAC-SHA256 iteration count for password hashing.
/// High enough to resist offline brute-force of the (random-must-change) admin
/// password while staying fast for a single login (~few ms).
const PBKDF2_ITERS: u32 = 200_000;
/// Salt length in bytes (16 bytes -> 32 hex chars).
const SALT_LEN: usize = 16;
/// Derived key length in bytes.
const DK_LEN: usize = 32;

// ============================================================================
// 数据模型
//   原方案只有单个 admin.json（无盐 SHA256）与 apikeys.json（整文件覆盖写）。
//   现改为 users / api_keys 两个集合，并补齐审计字段：
//     status     : "active" | "disabled"（禁用即软删除）
//     created_at : 创建时间（epoch 秒）
//     expires_at : 失效时间；有效时为 NULL，禁用/删除时写入当时时间
//     created_by : 创建人用户名（首个 admin 为 "system"）
//   密码哈希从「无盐 SHA256」升级为「PBKDF2-HMAC-SHA256」，legacy 格式在登录时惰性迁移。
//   写入采用「临时文件 + rename」原子写，避免崩溃/断电导致整文件损坏锁死。
// ============================================================================

fn default_active() -> String {
    "active".to_string()
}
fn default_system() -> String {
    "system".to_string()
}

#[derive(Serialize, Deserialize, Clone)]
struct User {
    id: String,
    username: String,
    /// 新格式：`pbkdf2$<iters>$<salt_hex>$<hash_hex>`；旧格式（惰性迁移）：`<sha256_hex>`。
    pass_hash: String,
    #[serde(default = "default_active")]
    status: String,
    created_at: u64,
    #[serde(default)]
    expires_at: Option<u64>,
    #[serde(default = "default_system")]
    created_by: String,
    #[serde(default)]
    must_change: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct ApiKey {
    id: String,
    name: String,
    /// 明文 key 的前若干字符，供 UI 辨识。
    prefix: String,
    /// 随机 token 的 sha256 hex（随机密钥用 sha256 即可，无需 KDF）。
    hash: String,
    #[serde(default = "default_active")]
    status: String,
    created_at: u64,
    #[serde(default)]
    expires_at: Option<u64>,
    #[serde(default = "default_system")]
    created_by: String,
    #[serde(default)]
    last_used_at: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct ApiKeyPublic {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub status: String,
    pub created_at: u64,
    pub expires_at: Option<u64>,
    pub created_by: String,
    pub last_used_at: Option<u64>,
    pub active: bool,
}

#[derive(Serialize)]
pub struct ApiKeyIssued {
    pub id: String,
    pub name: String,
    pub prefix: String,
    /// 明文 key —— 仅在创建时返回一次。
    pub key: String,
    pub created_at: u64,
}

/// 暴露给 main.rs 的当前会话用户信息（不暴露 User 内部结构）。
#[derive(Clone)]
pub struct UserInfo {
    pub username: String,
    pub must_change: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct UsersFile {
    users: Vec<User>,
}
#[derive(Serialize, Deserialize, Default)]
struct KeysFile {
    keys: Vec<ApiKey>,
}

pub struct AuthState {
    users_path: PathBuf,
    keys_path: PathBuf,
    users: Mutex<Vec<User>>,
    keys: Mutex<Vec<ApiKey>>,
    sessions: Mutex<HashMap<String, (String, Instant)>>,
}

// ---- 哈希工具 ----

fn sha256_hex(p: &str) -> String {
    let mut h = Sha256::new();
    h.update(p.as_bytes());
    format!("{:x}", h.finalize())
}

/// HMAC-SHA256 (RFC 2104)，块长 64 字节。
fn hmac_sha256(key: &[u8], data: &[u8]) -> [u8; 32] {
    let mut k = [0u8; 64];
    if key.len() > 64 {
        let h = Sha256::digest(key);
        k[..32].copy_from_slice(&h);
    } else {
        k[..key.len()].copy_from_slice(key);
    }
    for b in k.iter_mut() {
        *b ^= 0x36;
    }
    let mut inner = Sha256::new();
    inner.update(&k);
    inner.update(data);
    let inner = inner.finalize();
    for b in k.iter_mut() {
        *b ^= 0x36 ^ 0x5c;
    }
    let mut outer = Sha256::new();
    outer.update(&k);
    outer.update(inner);
    let o = outer.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&o);
    out
}

/// PBKDF2-HMAC-SHA256 (RFC 8018)，dk 长度须为 32。
fn pbkdf2_sha256(pass: &[u8], salt: &[u8], iters: u32, dk: &mut [u8]) {
    assert_eq!(dk.len(), DK_LEN);
    let mut index: u32 = 1;
    let mut offset = 0usize;
    while offset < dk.len() {
        let mut msg = salt.to_vec();
        msg.push((index >> 24) as u8);
        msg.push((index >> 16) as u8);
        msg.push((index >> 8) as u8);
        msg.push(index as u8);
        let mut u = hmac_sha256(pass, &msg);
        let mut t = u;
        for _ in 1..iters {
            u = hmac_sha256(pass, &u);
            for j in 0..t.len() {
                t[j] ^= u[j];
            }
        }
        let take = std::cmp::min(dk.len() - offset, t.len());
        dk[offset..offset + take].copy_from_slice(&t[..take]);
        offset += take;
        index += 1;
    }
}

fn to_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{:02x}", x));
    }
    s
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = (bytes[i] as char).to_digit(16)?;
        let lo = (bytes[i + 1] as char).to_digit(16)?;
        out.push((hi * 16 + lo) as u8);
        i += 2;
    }
    Some(out)
}

/// 用随机盐派生新格式哈希：`pbkdf2$<iters>$<salt_hex>$<hash_hex>`。
fn pbkdf2_hash(pass: &str) -> String {
    let mut rng = rand::thread_rng();
    let salt: Vec<u8> = (0..SALT_LEN).map(|_| rng.gen::<u8>()).collect();
    let mut dk = [0u8; DK_LEN];
    pbkdf2_sha256(pass.as_bytes(), &salt, PBKDF2_ITERS, &mut dk);
    format!(
        "pbkdf2${}${}${}",
        PBKDF2_ITERS,
        to_hex(&salt),
        to_hex(&dk)
    )
}

/// 常量时间比较，避免计时侧信道。
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut r = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        r |= x ^ y;
    }
    r == 0
}

/// 校验存储的哈希。
/// 返回：
///   None                       -> 密码不匹配
///   Some(true)                 -> 匹配，但为 legacy 格式，需惰性升级
///   Some(false)                -> 匹配，新格式
fn verify_pass(stored: &str, pass: &str) -> Option<bool> {
    if let Some(rest) = stored.strip_prefix("pbkdf2$") {
        let parts: Vec<&str> = rest.split('$').collect();
        if parts.len() != 3 {
            return None;
        }
        let iters: u32 = parts[0].parse().ok()?;
        let salt = from_hex(parts[1])?;
        let expected = from_hex(parts[2])?;
        let mut dk = [0u8; DK_LEN];
        pbkdf2_sha256(pass.as_bytes(), &salt, iters, &mut dk);
        if ct_eq(&dk, &expected) {
            Some(false)
        } else {
            None
        }
    } else {
        // legacy：无盐 SHA256
        if stored == sha256_hex(pass) {
            Some(true)
        } else {
            None
        }
    }
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn random_token() -> String {
    let mut rng = rand::thread_rng();
    (0..32).map(|_| format!("{:02x}", rng.gen::<u8>())).collect()
}

// ---- 原子写 ----

fn atomic_write<T: Serialize>(p: &Path, v: &T) -> std::io::Result<()> {
    let s = serde_json::to_string_pretty(v)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, s)?;
    std::fs::rename(&tmp, p)?;
    Ok(())
}

// ---- AuthState 实现 ----

impl AuthState {
    pub fn new(data_dir: &str) -> Self {
        let dir = Path::new(data_dir);
        let _ = std::fs::create_dir_all(dir);

        let users_path = dir.join("users.json");
        let mut users = if users_path.exists() {
            read_users(&users_path).unwrap_or_default()
        } else {
            Vec::new()
        };
        if users.is_empty() {
            if let Some(legacy) = read_legacy_admin(&dir.join("admin.json")) {
                // 从旧 admin.json 迁移：保留现有密码哈希（旧格式，登录时惰性升级为 PBKDF2），
                // 避免升级部署后管理员被锁死。
                let u = User {
                    id: format!("usr_{}", random_token()),
                    username: legacy.user,
                    pass_hash: legacy.pass_hash,
                    status: "active".to_string(),
                    created_at: now_secs(),
                    expires_at: None,
                    created_by: "system".to_string(),
                    must_change: legacy.must_change,
                };
                users.push(u);
                if atomic_write(&users_path, &UsersFile { users: users.clone() }).is_err() {
                    eprintln!("zt-console: 警告：无法写入 {}", users_path.display());
                } else {
                    println!("zt-console: 已从 admin.json 迁移管理员账户到 users.json");
                }
                let _ = std::io::stdout().flush();
            } else {
                // 首次全新启动：生成随机 admin 密码，PBKDF2 哈希，强制改密，仅打印一次。
                let pw = generate_password();
                let admin = User {
                    id: format!("usr_{}", random_token()),
                    username: "admin".to_string(),
                    pass_hash: pbkdf2_hash(&pw),
                    status: "active".to_string(),
                    created_at: now_secs(),
                    expires_at: None,
                    created_by: "system".to_string(),
                    must_change: true,
                };
                users.push(admin);
                let _ = atomic_write(&users_path, &UsersFile { users: users.clone() });
                print_first_run_banner(&pw);
                let _ = std::io::stdout().flush();
            }
        }

        let keys_path = dir.join("apikeys.json");
        let keys = read_keys(&keys_path).unwrap_or_default();

        Self {
            users_path,
            keys_path,
            users: Mutex::new(users),
            keys: Mutex::new(keys),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    fn save_users(&self) -> std::io::Result<()> {
        let u = self.users.lock().unwrap();
        atomic_write(&self.users_path, &UsersFile { users: u.clone() })
    }

    fn save_keys(&self) -> std::io::Result<()> {
        let k = self.keys.lock().unwrap();
        atomic_write(&self.keys_path, &KeysFile { keys: k.clone() })
    }

    pub fn login(&self, user: &str, pass: &str) -> Option<(String, bool)> {
        let mut users = self.users.lock().unwrap();
        let u = users
            .iter_mut()
            .find(|u| u.username == user && u.status == "active")?;
        let matched = verify_pass(&u.pass_hash, pass)?;
        if matched {
            // legacy 格式惰性升级为新格式。
            u.pass_hash = pbkdf2_hash(pass);
            let _ = self.save_users();
        }
        let token = random_token();
        let exp = Instant::now() + Duration::from_secs(60 * 60 * 24 * 7);
        self.sessions
            .lock()
            .unwrap()
            .insert(token.clone(), (u.username.clone(), exp));
        Some((token, u.must_change))
    }

    /// 当前会话对应的用户（用于 /me、记录 created_by）。
    pub fn user_by_token(&self, token: &str) -> Option<UserInfo> {
        let s = self.sessions.lock().unwrap();
        let username = s.get(token).map(|(u, _)| u.clone())?;
        self.users
            .lock()
            .unwrap()
            .iter()
            .find(|u| u.username == username)
            .map(|u| UserInfo {
                username: u.username.clone(),
                must_change: u.must_change,
            })
    }

    /// 校验会话（仅 cookie，不含 API key）。
    pub fn valid(&self, token: &str) -> bool {
        let mut s = self.sessions.lock().unwrap();
        if let Some((_, exp)) = s.get(token) {
            if Instant::now() < *exp {
                return true;
            }
            s.remove(token);
            false
        } else {
            false
        }
    }

    pub fn logout(&self, token: &str) {
        self.sessions.lock().unwrap().remove(token);
    }

    pub fn change_password(&self, token: &str, current: &str, new: &str) -> bool {
        let username = match self.user_by_token(token) {
            Some(u) => u.username,
            None => return false,
        };
        let mut users = self.users.lock().unwrap();
        let u = match users.iter_mut().find(|u| u.username == username) {
            Some(u) => u,
            None => return false,
        };
        if verify_pass(&u.pass_hash, current).is_none() {
            return false;
        }
        u.pass_hash = pbkdf2_hash(new);
        u.must_change = false;
        if self.save_users().is_err() {
            return false;
        }
        // 改密后使其它会话失效，但保留执行改密的会话。
        let mut s = self.sessions.lock().unwrap();
        s.retain(|k, _| k == token);
        true
    }

    /// 仅代理（/api/controller/*）用：会话或 API key 均可。
    pub fn authenticate(&self, token: &str) -> bool {
        if self.valid(token) {
            return true;
        }
        let mut ks = self.keys.lock().unwrap();
        if let Some(k) = ks
            .iter_mut()
            .find(|k| k.status == "active" && k.hash == sha256_hex(token))
        {
            k.last_used_at = Some(now_secs());
            let _ = self.save_keys();
            true
        } else {
            false
        }
    }

    /// 颁发 API key。created_by 取当前会话用户名。
    pub fn issue_api_key(&self, name: &str, created_by: &str) -> Option<ApiKeyIssued> {
        let mut rng = rand::thread_rng();
        let raw: String = (0..32).map(|_| format!("{:02x}", rng.gen::<u8>())).collect();
        let key = format!("ztk_{raw}");
        let id = format!("key_{}", &raw[..16]);
        let prefix = key.chars().take(12).collect::<String>();
        let name = if name.trim().is_empty() {
            "未命名密钥".to_string()
        } else {
            name.trim().to_string()
        };
        let created = now_secs();
        let api_key = ApiKey {
            id: id.clone(),
            name: name.clone(),
            prefix: prefix.clone(),
            hash: sha256_hex(&key),
            status: "active".to_string(),
            created_at: created,
            expires_at: None,
            created_by: created_by.to_string(),
            last_used_at: None,
        };
        let mut ks = self.keys.lock().unwrap();
        ks.push(api_key);
        let _ = self.save_keys();
        Some(ApiKeyIssued {
            id,
            name,
            prefix,
            key,
            created_at: created,
        })
    }

    /// 列出所有 key（含已禁用，供 UI 显示状态）。
    pub fn list_api_keys(&self) -> Vec<ApiKeyPublic> {
        self.keys
            .lock()
            .unwrap()
            .iter()
            .map(|k| ApiKeyPublic {
                id: k.id.clone(),
                name: k.name.clone(),
                prefix: k.prefix.clone(),
                status: k.status.clone(),
                created_at: k.created_at,
                expires_at: k.expires_at,
                created_by: k.created_by.clone(),
                last_used_at: k.last_used_at,
                active: k.status == "active",
            })
            .collect()
    }

    /// 吊销（软删除）：status=disabled，expires_at=当前时间。
    pub fn revoke_api_key(&self, id: &str) -> bool {
        let mut ks = self.keys.lock().unwrap();
        if let Some(k) = ks.iter_mut().find(|k| k.id == id && k.status == "active") {
            k.status = "disabled".to_string();
            k.expires_at = Some(now_secs());
            let _ = self.save_keys();
            true
        } else {
            false
        }
    }
}

// ---- 读取 ----

fn read_users(p: &Path) -> Option<Vec<User>> {
    let s = std::fs::read_to_string(p).ok()?;
    let f: UsersFile = serde_json::from_str(&s).ok()?;
    Some(f.users)
}

fn read_keys(p: &Path) -> Option<Vec<ApiKey>> {
    let s = std::fs::read_to_string(p).ok()?;
    let f: KeysFile = serde_json::from_str(&s).ok()?;
    Some(f.keys)
}

/// 兼容旧版 admin.json（单管理员、无盐 SHA256）。
#[derive(Deserialize)]
struct LegacyAdmin {
    user: String,
    pass_hash: String,
    #[serde(default)]
    must_change: bool,
}
fn read_legacy_admin(p: &Path) -> Option<LegacyAdmin> {
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&s).ok()
}

/// 生成强随机密码（16 字符，排除易混字符）。
fn generate_password() -> String {
    const CHARSET: &[u8] = b"abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::thread_rng();
    (0..16)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

fn print_first_run_banner(pw: &str) {
    println!(
        "\n\
==============================================================\n\
 ZT-CONSOLE 首次启动：管理员初始密码（随机生成，请妥善保存）\n\
   用户名 : admin\n\
   密码   : {pw}\n\
   说明   : 密码哈希(PBKDF2-HMAC-SHA256)已写入 DATA_DIR/users.json。\n\
           登录后系统会强制要求修改密码（「设置 → 修改密码」）。\n\
           此提示仅首次启动时打印一次；若遗失请删除 users.json 重新生成。\n\
==============================================================\n"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pbkdf2_sha256_known_vectors() {
        // RFC 兼容测试向量（PBKDF2-HMAC-SHA256）。
        let cases: &[(&[u8], &[u8], u32, &str)] = &[
            (
                b"password",
                b"salt",
                1,
                "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b",
            ),
            (
                b"password",
                b"salt",
                2,
                "ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43",
            ),
            (
                b"password",
                b"salt",
                4096,
                "c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a",
            ),
        ];
        for (p, s, c, expected) in cases {
            let mut dk = [0u8; 32];
            pbkdf2_sha256(p, s, *c, &mut dk);
            assert_eq!(to_hex(&dk), *expected, "iters={c}");
        }
    }

    #[test]
    fn verify_roundtrip() {
        let h = pbkdf2_hash("s3cret-pass");
        assert!(verify_pass(&h, "s3cret-pass") == Some(false));
        assert!(verify_pass(&h, "wrong") == None);
        // legacy
        let legacy = sha256_hex("s3cret-pass");
        assert!(verify_pass(&legacy, "s3cret-pass") == Some(true));
        assert!(verify_pass(&legacy, "nope") == None);
    }
}
