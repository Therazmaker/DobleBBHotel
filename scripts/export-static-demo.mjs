// Exporta la demo (datos inventados) a archivos JSON para la versión estática (GitHub Pages).
// Arranca el servidor en modo demo con una base temporal, consulta la API y guarda las respuestas.
// Uso: node scripts/export-static-demo.mjs <carpeta-destino>
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] || "dist/demo-data");
const tmp = mkdtempSync(join(tmpdir(), "respaldo-demo-"));
process.env.DEMO = "1";
process.env.DB_PATH = join(tmp, "demo.db");
process.env.PORT = process.env.EXPORT_PORT || "3999";

await import("../server/index.js");
const base = `http://localhost:${process.env.PORT}`;
await new Promise((r) => setTimeout(r, 300));

const login = await fetch(`${base}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "demo@demo.local", password: "demo-recepcion" }),
});
if (!login.ok) throw new Error(`Login demo falló: ${login.status}`);
const cookie = login.headers.get("set-cookie").split(";")[0];
const get = async (path) => {
  const r = await fetch(`${base}${path}`, { headers: { cookie } });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};

mkdirSync(out, { recursive: true });
const save = (name, data) => writeFileSync(join(out, `${name}.json`), JSON.stringify(data));

const status = await get("/api/status");
const today = status.workDate || status.today;
save("status", status);
save("summary", await get("/api/summary"));
save("panel", await get("/api/panel"));
save("contingency", await get("/api/contingency"));
save("rooms", await get("/api/rooms"));
save("planning", await get("/api/planning"));

const guests = await get("/api/guests?status=all&sort=room");
save("guests", guests.rows);
const guestDetail = {};
for (const g of guests.rows) guestDetail[g.id] = await get(`/api/guests/${g.id}`);
save("guest-detail", guestDetail);

const accounts = await get("/api/accounts");
save("accounts", accounts);
const accountDetail = {};
for (const a of accounts.rows) accountDetail[a.accountId] = await get(`/api/accounts/${a.accountId}`);
save("account-detail", accountDetail);

save("reservations", await get("/api/reservations"));

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const movements = {};
for (let i = -5; i <= 10; i++) {
  const d = addDays(today, i);
  movements[d] = await get(`/api/movements?date=${d}`);
}
save("movements", movements);
save("meta", { exportedAt: new Date().toISOString(), today });

rmSync(tmp, { recursive: true, force: true });
console.log(`Demo estática exportada en ${out} (fecha de trabajo ${today})`);
process.exit(0);
