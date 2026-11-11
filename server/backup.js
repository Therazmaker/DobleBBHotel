// Copia de seguridad diaria de la base: un archivo hotel-AAAA-MM-DD.db por día, se guardan
// BACKUP_KEEP_DAYS días (30 por defecto). BACKUP_DIR puede ser otro disco o una carpeta
// compartida de la red (\\equipo\carpeta). Uso manual: npm run backup
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, getSetting, setSetting } from "./db.js";
import { todayInHotel } from "./sync.js";

const here = dirname(fileURLToPath(import.meta.url));
export const BACKUP_DIR = resolve(process.env.BACKUP_DIR || join(here, "../data/backups"));
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 30);
const NAME = /^hotel-(\d{4}-\d{2}-\d{2})\.db$/;

export function backupNow() {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const day = todayInHotel();
  const file = join(BACKUP_DIR, `hotel-${day}.db`);
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  // VACUUM INTO hace una copia consistente aunque la app esté escribiendo.
  db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  // Se escribe en .tmp y luego se renombra: si se corta a medias no queda una copia rota.
  rmSync(file, { force: true });
  renameSync(tmp, file);
  for (const f of readdirSync(BACKUP_DIR)) {
    const m = NAME.exec(f);
    if (m && (Date.parse(day) - Date.parse(m[1])) / 86_400_000 >= KEEP_DAYS) rmSync(join(BACKUP_DIR, f), { force: true });
  }
  const info = { at: new Date().toISOString(), file, bytes: statSync(file).size, ok: true };
  setSetting("lastBackup", JSON.stringify(info));
  return info;
}

export function lastBackup() {
  try { return JSON.parse(getSetting("lastBackup") || "null"); } catch { return null; }
}

/** Hace la copia del día si todavía no existe (se llama cada hora desde el servidor). */
export function backupIfDue() {
  const last = lastBackup();
  const day = todayInHotel();
  if (last?.ok && last.file?.endsWith(`hotel-${day}.db`)) return null;
  try {
    return backupNow();
  } catch (e) {
    const info = { at: new Date().toISOString(), ok: false, error: e.message };
    setSetting("lastBackup", JSON.stringify({ ...last, lastError: info }));
    console.error("Backup falló:", e.message);
    return info;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(backupNow()));
}
