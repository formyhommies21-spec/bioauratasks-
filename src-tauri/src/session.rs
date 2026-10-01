//! Сессия Organism: cookie-авторизация, автообновление токена, хранение на диске.
//!
//! Organism выдаёт httpOnly-cookie на домен *.resetaura.io при POST /api/auth/login.
//! Эти же cookie принимает API задач (project.resetaura.io). Когда access истекает,
//! API отвечает 401, и мы вызываем POST /api/auth/refresh, после чего повторяем запрос.
//!
//! Cookie-банка сохраняется в файл, зашифрованный AES-256-GCM. Ключ лежит
//! в системном хранилище (Keychain на macOS, Credential Manager на Windows).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use reqwest::{Method, StatusCode};
use reqwest_cookie_store::{CookieStore, CookieStoreMutex};
use serde::Serialize;
use serde_json::Value;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

const KEYRING_SERVICE: &str = "io.resetaura.tasks-widget";
const KEYRING_USER: &str = "session-key";
const ENC_PREFIX: &str = "enc:v1:";

#[derive(Clone, Debug)]
pub struct Endpoints {
    /// Organism: логин, refresh, logout
    pub auth: String,
    /// Модуль задач
    pub project: String,
}

impl Default for Endpoints {
    fn default() -> Self {
        Self {
            auth: "https://organism.resetaura.io".into(),
            project: "https://project.resetaura.io".into(),
        }
    }
}

/// Ответ, который уходит во фронтенд. status = 0 означает «нет сети».
#[derive(Serialize)]
pub struct ApiResponse {
    pub status: u16,
    pub data: Value,
}

impl ApiResponse {
    fn offline(err: impl ToString) -> Self {
        Self { status: 0, data: Value::String(err.to_string()) }
    }
}

pub struct Session {
    client: reqwest::Client,
    jar: Arc<CookieStoreMutex>,
    file: PathBuf,
    key: Option<[u8; 32]>,
    endpoints: RwLock<Endpoints>,
    refresh_lock: tokio::sync::Mutex<()>,
    /// Увеличивается после каждого успешного refresh, чтобы параллельные
    /// запросы не обновляли токен по второму разу.
    generation: AtomicU64,
}

impl Session {
    pub fn new(data_dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&data_dir);
        let file = data_dir.join("session.dat");
        let key = load_or_create_key();
        let store = read_store(&file, key.as_ref()).unwrap_or_default();
        let jar = Arc::new(CookieStoreMutex::new(store));
        let client = reqwest::Client::builder()
            .cookie_provider(jar.clone())
            .user_agent(concat!("bioaura-tasks-widget/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(8))
            .timeout(std::time::Duration::from_secs(25))
            .build()
            .expect("http client");
        Self {
            client,
            jar,
            file,
            key,
            endpoints: RwLock::new(Endpoints::default()),
            refresh_lock: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
        }
    }

    pub fn set_endpoints(&self, auth: Option<String>, project: Option<String>) {
        let mut ep = self.endpoints.write().unwrap();
        if let Some(a) = auth.filter(|s| !s.trim().is_empty()) {
            ep.auth = a.trim().trim_end_matches('/').to_string();
        }
        if let Some(p) = project.filter(|s| !s.trim().is_empty()) {
            ep.project = p.trim().trim_end_matches('/').to_string();
        }
    }

    fn ep(&self) -> Endpoints {
        self.endpoints.read().unwrap().clone()
    }

    pub fn has_cookies(&self) -> bool {
        self.jar.lock().map(|s| s.iter_unexpired().next().is_some()).unwrap_or(false)
    }

    pub async fn login(&self, email: &str, password: &str) -> ApiResponse {
        self.clear();
        let url = format!("{}/api/auth/login", self.ep().auth);
        let body = serde_json::json!({ "email": email, "password": password });
        let res = match self.client.post(url).json(&body).send().await {
            Ok(r) => r,
            Err(e) => return ApiResponse::offline(e),
        };
        let out = to_response(res).await;
        if (200..300).contains(&out.status) {
            self.persist();
        }
        out
    }

    pub async fn logout(&self) {
        let url = format!("{}/api/auth/logout", self.ep().auth);
        let _ = self
            .client
            .post(url)
            .header("Content-Type", "application/json")
            .body("{}")
            .send()
            .await;
        self.clear();
    }

    fn clear(&self) {
        if let Ok(mut s) = self.jar.lock() {
            s.clear();
        }
        let _ = std::fs::remove_file(&self.file);
    }

    async fn refresh(&self, seen_generation: u64) -> bool {
        let _guard = self.refresh_lock.lock().await;
        // Пока ждали замок, другой запрос уже обновил токен
        if self.generation.load(Ordering::SeqCst) != seen_generation {
            return true;
        }
        let url = format!("{}/api/auth/refresh", self.ep().auth);
        let ok = matches!(
            self.client
                .post(url)
                .header("Content-Type", "application/json")
                .body("{}")
                .send()
                .await,
            Ok(r) if r.status().is_success()
        );
        if ok {
            self.generation.fetch_add(1, Ordering::SeqCst);
            self.persist();
        }
        ok
    }

    /// Запрос к API задач. path начинается с "/api/...".
    pub async fn request(&self, method: &str, path: &str, body: Option<Value>) -> ApiResponse {
        let method = match Method::from_bytes(method.to_uppercase().as_bytes()) {
            Ok(m) => m,
            Err(_) => return ApiResponse { status: 400, data: Value::String("bad method".into()) },
        };
        if !path.starts_with("/api/") {
            return ApiResponse { status: 400, data: Value::String("bad path".into()) };
        }
        let url = format!("{}{}", self.ep().project, path);

        for attempt in 0..2 {
            let gen = self.generation.load(Ordering::SeqCst);
            let mut rb = self.client.request(method.clone(), &url);
            if let Some(b) = &body {
                rb = rb.json(b);
            }
            let res = match rb.send().await {
                Ok(r) => r,
                Err(e) => return ApiResponse::offline(e),
            };
            if res.status() == StatusCode::UNAUTHORIZED && attempt == 0 {
                if self.refresh(gen).await {
                    continue;
                }
                return ApiResponse { status: 401, data: Value::String("unauthorized".into()) };
            }
            let out = to_response(res).await;
            // Сервер может продлевать cookie на любом ответе
            self.persist();
            return out;
        }
        ApiResponse { status: 401, data: Value::String("unauthorized".into()) }
    }

    fn persist(&self) {
        let mut buf: Vec<u8> = Vec::new();
        {
            let store = match self.jar.lock() {
                Ok(s) => s,
                Err(_) => return,
            };
            if cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut buf).is_err() {
                return;
            }
        }
        let content = match &self.key {
            Some(k) => match encrypt(k, &buf) {
                Some(c) => c.into_bytes(),
                None => return,
            },
            None => buf,
        };
        let tmp = self.file.with_extension("tmp");
        if std::fs::write(&tmp, content).is_ok() {
            let _ = std::fs::rename(&tmp, &self.file);
        }
    }
}

async fn to_response(res: reqwest::Response) -> ApiResponse {
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    let data = if text.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or(Value::String(text))
    };
    ApiResponse { status, data }
}

fn load_or_create_key() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).ok()?;
    if let Ok(existing) = entry.get_password() {
        if let Ok(bytes) = B64.decode(existing.trim()) {
            if bytes.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                return Some(k);
            }
        }
    }
    let mut k = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut k);
    entry.set_password(&B64.encode(k)).ok()?;
    Some(k)
}

fn encrypt(key: &[u8; 32], plain: &[u8]) -> Option<String> {
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let ct = cipher.encrypt(Nonce::from_slice(&nonce), plain).ok()?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Some(format!("{ENC_PREFIX}{}", B64.encode(out)))
}

fn decrypt(key: &[u8; 32], text: &str) -> Option<Vec<u8>> {
    let raw = B64.decode(text.strip_prefix(ENC_PREFIX)?.trim()).ok()?;
    if raw.len() < 13 {
        return None;
    }
    let (nonce, ct) = raw.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    cipher.decrypt(Nonce::from_slice(nonce), ct).ok()
}

fn read_store(file: &PathBuf, key: Option<&[u8; 32]>) -> Option<CookieStore> {
    let content = std::fs::read_to_string(file).ok()?;
    let plain = if content.starts_with(ENC_PREFIX) {
        decrypt(key?, &content)?
    } else {
        content.into_bytes()
    };
    cookie_store::serde::json::load_all(BufReader::new(plain.as_slice())).ok()
}

#[cfg(test)]
mod tests {
    //! Запуск: python3 tests/fake_server.py & cargo test -- --ignored
    use super::*;

    #[test]
    fn encrypt_roundtrip() {
        let mut k = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut k);
        let c = encrypt(&k, b"{\"cookies\":1}").unwrap();
        assert!(c.starts_with(ENC_PREFIX));
        assert_eq!(decrypt(&k, &c).unwrap(), b"{\"cookies\":1}");
        let mut other = k;
        other[0] ^= 1;
        assert!(decrypt(&other, &c).is_none());
    }

    #[tokio::test]
    #[ignore]
    async fn login_refresh_and_restore() {
        let dir = std::env::temp_dir().join(format!("bioaura-widget-test-{}", std::process::id()));
        let base = "http://127.0.0.1:18765".to_string();

        let s = Session::new(dir.clone());
        s.set_endpoints(Some(base.clone()), Some(base.clone()));
        assert!(!s.has_cookies());

        let bad = s.login("d@x.ru", "wrong").await;
        assert_eq!(bad.status, 401);

        let ok = s.login("d@x.ru", "secret").await;
        assert_eq!(ok.status, 200, "{:?}", ok.data);
        assert!(s.has_cookies());

        // access-токен «истёк»: сервер ответит 401, сессия должна сама сделать refresh
        let r = s.request("GET", "/api/tasks?sort=due&limit=500", None).await;
        assert_eq!(r.status, 200, "{:?}", r.data);
        assert_eq!(r.data["total"], 1);

        // «перезапуск»: новая сессия из того же каталога, без логина
        drop(s);
        let s2 = Session::new(dir.clone());
        s2.set_endpoints(Some(base.clone()), Some(base));
        assert!(s2.has_cookies());
        let r2 = s2.request("GET", "/api/tasks", None).await;
        assert_eq!(r2.status, 200, "{:?}", r2.data);

        s2.logout().await;
        assert!(!s2.has_cookies());
        let r3 = s2.request("GET", "/api/tasks", None).await;
        assert_eq!(r3.status, 401);
        let _ = std::fs::remove_dir_all(dir);
    }
}
