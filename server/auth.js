// Login del personal con su usuario y contraseña de NewHotel.
//
// - NewHotel disponible: se valida contra NewHotel (auth/html). Si es correcto, se guarda una
//   huella scrypt de la contraseña (nunca la contraseña) para poder entrar después sin NewHotel.
// - NewHotel caído (sin respuesta, timeout o 5xx): se valida contra esa huella guardada.
//   Solo pueden entrar quienes hayan iniciado sesión al menos una vez con NewHotel disponible
//   en los últimos OFFLINE_DAYS días.
// - NewHotel responde 401: contraseña incorrecta. Se rechaza (no se usa la huella).
// - Usuarios "local": administradores de emergencia creados con `npm run add-user`.
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { db } from "./db.js";
import { BASE_URL } from "./newhotel.js";

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  email             TEXT PRIMARY KEY,
  name              TEXT,
  source            TEXT NOT NULL,      -- newhotel | local
  role              TEXT,               -- 'admin' para usuarios locales
  passwordHash      TEXT NOT NULL,      -- scrypt$N$salt$hash
  lastOnlineLoginAt TEXT,
  lastLoginAt       TEXT,
  disabled          INTEGER NOT NULL DEFAULT 0,
  createdAt         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  tokenHash TEXT PRIMARY KEY,
  email     TEXT NOT NULL,
  mode      TEXT NOT NULL,              -- online | offline | local
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loginAttempts (
  key TEXT NOT NULL,
  at  TEXT NOT NULL
);
`);

const OFFLINE_DAYS = Number(process.env.AUTH_OFFLINE_DAYS || 30);
const SESSION_HOURS = Number(process.env.AUTH_SESSION_HOURS || 12);
const COOKIE = "rp_session";
const N = 16384;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32, { N });
  return `scrypt$${N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(pw, stored) {
  try {
    const [, n, salt, hash] = stored.split("$");
    const expected = Buffer.from(hash, "base64");
    const got = scryptSync(pw, Buffer.from(salt, "base64"), expected.length, { N: Number(n) });
    return timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Comprueba credenciales contra NewHotel: 'ok' | 'invalid' | 'unavailable' | '2fa' */
async function checkWithNewHotel(email, password) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE_URL}/auth/html`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ userEmail: email, password }),
      signal: ctrl.signal,
    });
    if (res.status === 401 || res.status === 403) return { status: "invalid" };
    if (!res.ok) return { status: "unavailable" };
    const body = await res.json().catch(() => null);
    if (body?.code === 401) return { status: "invalid" };
    const c = body?.content;
    if (!c?.token) return c?.twoFactorRequired ? { status: "2fa" } : { status: "unavailable" };
    let name = null;
    try {
      name = JSON.parse(Buffer.from(c.token.split(".")[1], "base64url").toString()).app_username || null;
    } catch {}
    const hotels = Object.values(c.hotels || {}).flat().map((h) => h.id);
    return { status: "ok", name, hotels };
  } catch {
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

function tooManyAttempts(key) {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  db.prepare("DELETE FROM loginAttempts WHERE at < ?").run(since);
  return db.prepare("SELECT COUNT(*) n FROM loginAttempts WHERE key = ?").get(key).n >= 8;
}

function createSession(res, email, mode) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  db.prepare("INSERT INTO sessions(tokenHash, email, mode, createdAt, expiresAt) VALUES(?,?,?,?,?)").run(
    sha(token), email, mode, now.toISOString(), expires.toISOString()
  );
  db.prepare("UPDATE users SET lastLoginAt = ? WHERE email = ?").run(now.toISOString(), email);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${secure}`
  );
}

function readSession(req) {
  const m = /(?:^|;\s*)rp_session=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const s = db
    .prepare(
      `SELECT s.email, s.mode, s.expiresAt, u.name, u.source, u.role, u.disabled
       FROM sessions s JOIN users u ON u.email = s.email WHERE s.tokenHash = ?`
    )
    .get(sha(m[1]));
  if (!s || s.disabled || new Date(s.expiresAt) < new Date()) return null;
  return { email: s.email, name: s.name, mode: s.mode, source: s.source, role: s.role };
}

export function installAuth(app) {
  app.post("/api/login", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password) return res.status(400).json({ error: "Escribe usuario y contraseña." });
    const ip = req.socket.remoteAddress || "?";
    if (tooManyAttempts(`e:${email}`) || tooManyAttempts(`i:${ip}`))
      return res.status(429).json({ error: "Demasiados intentos. Espera 10 minutos." });

    const fail = (msg, code = 401) => {
      const at = new Date().toISOString();
      db.prepare("INSERT INTO loginAttempts(key, at) VALUES(?, ?), (?, ?)").run(`e:${email}`, at, `i:${ip}`, at);
      return res.status(code).json({ error: msg });
    };

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (user?.disabled) return fail("Usuario desactivado.");

    // Administradores locales de emergencia: no dependen de NewHotel.
    if (user?.source === "local") {
      if (!verifyPassword(password, user.passwordHash)) return fail("Usuario o contraseña incorrectos.");
      createSession(res, email, "local");
      return res.json({ ok: true, mode: "local" });
    }

    if (process.env.DEMO === "1") return fail("Modo demo: entra con el usuario de prueba que aparece debajo.");
    const nh = await checkWithNewHotel(email, password);
    if (nh.status === "ok") {
      const hotelId = process.env.NEWHOTEL_HOTEL_ID;
      if (hotelId && !nh.hotels.includes(hotelId)) return fail("Tu usuario de NewHotel no tiene acceso a este hotel.", 403);
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users(email, name, source, passwordHash, lastOnlineLoginAt, createdAt) VALUES(?,?,?,?,?,?)
         ON CONFLICT(email) DO UPDATE SET name = COALESCE(excluded.name, users.name),
           passwordHash = excluded.passwordHash, lastOnlineLoginAt = excluded.lastOnlineLoginAt`
      ).run(email, nh.name, "newhotel", hashPassword(password), now, now);
      createSession(res, email, "online");
      return res.json({ ok: true, mode: "online" });
    }
    if (nh.status === "invalid") return fail("Usuario o contraseña incorrectos.");
    if (nh.status === "2fa")
      return fail("Tu usuario de NewHotel tiene doble factor: pide a sistemas un acceso local.", 403);

    // NewHotel no responde: modo contingencia con la huella guardada.
    if (!user) return fail("NewHotel no responde y este usuario nunca ha entrado aquí. Usa un acceso de emergencia.", 503);
    const age = (Date.now() - new Date(user.lastOnlineLoginAt || 0)) / 86_400_000;
    if (age > OFFLINE_DAYS)
      return fail(`NewHotel no responde y tu último acceso validado tiene más de ${OFFLINE_DAYS} días.`, 503);
    if (!verifyPassword(password, user.passwordHash)) return fail("Usuario o contraseña incorrectos.");
    createSession(res, email, "offline");
    return res.json({ ok: true, mode: "offline" });
  });

  app.post("/api/logout", (req, res) => {
    const m = /(?:^|;\s*)rp_session=([^;]+)/.exec(req.headers.cookie || "");
    if (m) db.prepare("DELETE FROM sessions WHERE tokenHash = ?").run(sha(m[1]));
    res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: "Sin sesión" });
    res.json(s);
  });

  // Todo lo demás de /api requiere sesión.
  app.use("/api", (req, res, next) => {
    const s = readSession(req);
    if (!s) return res.status(401).json({ error: "Sesión caducada. Vuelve a entrar." });
    req.user = s;
    next();
  });
}
