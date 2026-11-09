// API local de la PWA. En Convex, cada ruta GET será una query y cada POST una mutation/action.
import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, getSetting, scrubStoredPans } from "./db.js";
import { installAuth } from "./auth.js";
import { canAutoLogin, getToken, saveToken, tokenInfo } from "./newhotel.js";
import { syncAll, todayInHotel } from "./sync.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Modo demo: datos inventados, sin conexión a NewHotel.
const DEMO = process.env.DEMO === "1";
if (DEMO) {
  const { seedDemo } = await import("./demo-seed.js");
  const last = db.prepare("SELECT date FROM occupancy ORDER BY date DESC LIMIT 1").get();
  if (last?.date !== todayInHotel()) console.log("Demo:", JSON.stringify(seedDemo()));
}
app.get("/api/public-config", (_req, res) =>
  res.json({ demo: DEMO, demoUser: DEMO ? { email: "demo@demo.local", password: "demo-recepcion" } : null })
);
installAuth(app);

const PORT = Number(process.env.PORT || 3000);
const SYNC_MINUTES = Number(process.env.SYNC_INTERVAL_MIN || 10);

// Columnas que se muestran en listados (sin el JSON crudo).
const LIST_COLS = `id, reservation, roomNumber, roomType, arrival, departure, fullName, firstName,
  lastName, countryId, country, entity, clientType, groupName, rateAmount, rateCurrency, rateText,
  pension, guestType, age, gender, adults, children, babies, isHolder, state, inHouse, checkedOutAt`;

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

app.get("/api/status", (_req, res) => {
  const lastRuns = db.prepare("SELECT * FROM syncRuns ORDER BY id DESC LIMIT 15").all();
  const lastOk = db.prepare("SELECT finishedAt FROM syncRuns WHERE status='ok' ORDER BY id DESC LIMIT 1").get();
  const totals = db.prepare("SELECT COUNT(*) total, SUM(inHouse) inHouse FROM guests").get();
  res.json({
    workDate: db.prepare("SELECT date FROM occupancy ORDER BY date DESC LIMIT 1").get()?.date ?? null,
    demo: DEMO,
    hasToken: Boolean(getToken()),
    autoLogin: canAutoLogin(),
    token: DEMO ? { hotelName: getSetting("demoHotelName") || "Hotel Demo", userName: "Demo", expiresAt: null } : tokenInfo(),
    lastSyncAt: lastOk?.finishedAt ?? null,
    syncIntervalMinutes: SYNC_MINUTES,
    totals,
    runs: lastRuns,
    today: todayInHotel(),
  });
});

app.post("/api/token", (req, res) => {
  const token = String(req.body?.token || "");
  if (token.split(".").length !== 3) return res.status(400).json({ error: "Eso no parece un token JWT." });
  saveToken(token);
  res.json({ ok: true, token: tokenInfo() });
});

app.post("/api/sync", async (_req, res) => {
  if (DEMO) return res.json({ ok: false, error: "Modo demo: no hay conexión con NewHotel. Para regenerar los datos: npm run seed." });
  res.json(await syncAll());
});

app.get("/api/summary", (_req, res) => {
  const today = todayInHotel();
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);

  const kpis = one(
    `SELECT COUNT(*) guests,
            COUNT(DISTINCT roomNumber) rooms,
            COUNT(DISTINCT reservation) reservations,
            SUM(CASE WHEN guestType = 'Niño' THEN 1 ELSE 0 END) children,
            ROUND(AVG(CASE WHEN rateCurrency='USD' THEN rateAmount END), 2) avgRateUsd,
            COUNT(DISTINCT country) countries
     FROM guests WHERE inHouse = 1`
  );
  const arrivalsToday = one(`SELECT COUNT(*) n FROM guests WHERE arrival = ?`, today).n;
  const departuresToday = one(`SELECT COUNT(*) n FROM guests WHERE departure = ?`, today).n;
  const pendingDepartures = one(`SELECT COUNT(*) n FROM guests WHERE departure = ? AND inHouse = 1`, today).n;

  const top = (col, limit = 8) =>
    all(
      `SELECT COALESCE(NULLIF(${col}, ''), 'Sin dato') label, COUNT(*) value
       FROM guests WHERE inHouse = 1 GROUP BY label ORDER BY value DESC, label LIMIT ?`,
      limit
    );

  // Próximos 7 días: salidas previstas de quienes están en casa.
  const departuresNext = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, i);
    departuresNext.push({
      date: d,
      value: one(`SELECT COUNT(*) n FROM guests WHERE inHouse = 1 AND departure = ?`, d).n,
    });
  }
  const arrivalsPast = [];
  for (let i = -6; i <= 0; i++) {
    const d = addDays(today, i);
    arrivalsPast.push({ date: d, value: one(`SELECT COUNT(*) n FROM guests WHERE arrival = ?`, d).n });
  }

  const occupancy = one(`SELECT * FROM occupancy ORDER BY date DESC LIMIT 1`);
  const occupancyRaw = occupancy?.raw ? JSON.parse(occupancy.raw) : null;
  if (occupancy) delete occupancy.raw;
  const widget = (key) => {
    const r = one(`SELECT data FROM widgets WHERE key = ? ORDER BY date DESC LIMIT 1`, key);
    return r ? JSON.parse(r.data) : [];
  };
  const roomTypes = widget("bookingsroomtype").map((r) => ({
    name: r.roomTypeName, total: r.totalRooms, occupied: r.totalBookings, vacant: r.vacants,
    percent: r.totalRooms ? Math.round((r.totalBookings / r.totalRooms) * 10000) / 100 : 0,
  }));
  const occupancyByType = widget("bookingtypepercentage").map((d) => ({
    date: d.date.slice(0, 10), total: d.occupancy, individual: d.occupancyIndividualBookings,
    group: d.occupancyGroupBookings, company: d.occupancyCompanyBookings,
  }));
  const topNationalities = widget("topnationalities").map((d) => ({ label: d.x, value: d.y }));
  const inventory = occupancy?.inventory || null;
  const forecast = all(`SELECT * FROM forecast WHERE date >= ? ORDER BY date LIMIT 31`, today).map((f) => ({
    ...f,
    rooms: f.arrivals + f.stayovers,
    occupancyPercent: inventory ? Math.round(((f.arrivals + f.stayovers) / inventory) * 1000) / 10 : null,
  }));

  res.json({
    today,
    occupancy,
    occupancyRaw,
    roomTypes,
    occupancyByType,
    topNationalities,
    forecast,
    occupancyHistory: all(`SELECT date, occupancyPercent, roomsOccupied, adr FROM occupancy ORDER BY date DESC LIMIT 60`).reverse(),
    kpis: { ...kpis, arrivalsToday, departuresToday, pendingDepartures },
    byCountry: top("country"),
    byEntity: top("entity"),
    byRoomType: top("roomType"),
    byClientType: top("clientType", 6),
    departuresNext,
    arrivalsPast,
    history: all(`SELECT * FROM dailyStats ORDER BY date DESC LIMIT 30`).reverse(),
  });
});

app.get("/api/guests", (req, res) => {
  const { q = "", country = "", entity = "", status = "inhouse", sort = "room" } = req.query;
  const where = [];
  const params = [];
  if (status === "inhouse") where.push("inHouse = 1");
  if (status === "departed") where.push("inHouse = 0");
  if (country) (where.push("country = ?"), params.push(country));
  if (entity) (where.push("entity = ?"), params.push(entity));
  if (q) {
    where.push(
      "(fullName LIKE ? OR roomNumber LIKE ? OR reservation LIKE ? OR entity LIKE ? OR groupName LIKE ?)"
    );
    params.push(...Array(5).fill(`%${q}%`));
  }
  const order =
    {
      room: "CAST(roomNumber AS INTEGER), roomNumber, fullName",
      name: "lastName, firstName",
      arrival: "arrival DESC, CAST(roomNumber AS INTEGER)",
      departure: "departure, CAST(roomNumber AS INTEGER)",
    }[sort] || "CAST(roomNumber AS INTEGER)";

  const rows = db
    .prepare(
      `SELECT ${LIST_COLS} FROM guests ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY ${order} LIMIT 1000`
    )
    .all(...params);

  const facet = (col) =>
    db
      .prepare(
        `SELECT ${col} label, COUNT(*) n FROM guests WHERE ${status === "all" ? "1" : `inHouse = ${status === "departed" ? 0 : 1}`}
         AND ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col} ORDER BY n DESC, label`
      )
      .all();

  res.json({ rows, facets: { country: facet("country"), entity: facet("entity") } });
});

app.get("/api/guests/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM guests WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "No encontrado" });
  res.json({ ...row, raw: JSON.parse(row.raw || "{}") });
});

app.get("/api/movements", (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || "") ? req.query.date : todayInHotel();
  const arrivals = db.prepare(`SELECT ${LIST_COLS} FROM guests WHERE arrival = ? ORDER BY CAST(roomNumber AS INTEGER)`).all(date);
  const departures = db
    .prepare(`SELECT ${LIST_COLS} FROM guests WHERE departure = ? ORDER BY inHouse DESC, CAST(roomNumber AS INTEGER)`)
    .all(date);
  const pms = db.prepare(`SELECT * FROM forecast WHERE date = ?`).get(date) || null;
  res.json({ date, arrivals, departures, pms });
});

// Panel del día (PMS): llegadas y salidas pendientes con nombre.
const PANEL_COLS = `kind, id, reservation, guest, room, roomTypeReserved, roomTypeOccupied, state, arrivalAt,
  departureAt, accountId, entity, groupName, paxs, pendingInvoice, totalExtras, active, firstSeenAt, lastSeenAt, goneAt`;
const panelRows = (kind, onlyActive = true) =>
  db
    .prepare(
      `SELECT ${PANEL_COLS} FROM panel WHERE kind = ? ${onlyActive ? "AND active = 1" : ""}
       ORDER BY CASE WHEN room IS NULL OR room = '' THEN 1 ELSE 0 END, CAST(room AS INTEGER), guest`
    )
    .all(kind);

app.get("/api/panel", (_req, res) => {
  const last = db.prepare("SELECT finishedAt FROM syncRuns WHERE module='panel' AND status='ok' ORDER BY id DESC LIMIT 1").get();
  res.json({ syncedAt: last?.finishedAt ?? null, arrivals: panelRows("arrival"), departures: panelRows("departure") });
});

// Informe de contingencia: todo lo necesario para operar si NewHotel no responde.
app.get("/api/contingency", (_req, res) => {
  const lastOk = db.prepare("SELECT finishedAt FROM syncRuns WHERE status='ok' ORDER BY id DESC LIMIT 1").get();
  const occupancy = db.prepare("SELECT * FROM occupancy ORDER BY date DESC LIMIT 1").get();
  if (occupancy) delete occupancy.raw;
  const inHouse = db
    .prepare(
      `SELECT roomNumber, roomType, reservation, arrival, departure, entity, rateText, pension, groupName,
              GROUP_CONCAT(fullName, ' / ') names, COUNT(*) paxs,
              MAX(CASE WHEN isHolder = 1 THEN fullName END) holder
       FROM guests WHERE inHouse = 1
       GROUP BY roomNumber, reservation ORDER BY CAST(roomNumber AS INTEGER), roomNumber`
    )
    .all();
  res.json({
    generatedAt: new Date().toISOString(),
    dataAsOf: lastOk?.finishedAt ?? null,
    today: todayInHotel(),
    occupancy,
    inHouse,
    arrivals: panelRows("arrival"),
    departures: panelRows("departure").map((d) => ({
      ...d,
      balance: db.prepare("SELECT totalAmount FROM accounts WHERE accountId = ?").get(d.accountId)?.totalAmount ?? null,
    })),
    balances: db
      .prepare(
        `SELECT room, reservation, guest, holder, company, departure, totalAmount, masterAmount,
                extra1Amount + extra2Amount + extra3Amount + extra4Amount + extra5Amount extrasAmount, remarks
         FROM accounts WHERE active = 1 AND ABS(totalAmount) > 0.005 ORDER BY CAST(room AS INTEGER), room`
      )
      .all(),
  });
});

// Cuentas corrientes
const ACC_COLS = `accountId, reservation, room, roomType, arrival, departure, term, paxs, company, groupName, holder, guest,
  remarks, masterAmount, extra1Amount, extra2Amount, extra3Amount, extra4Amount, extra5Amount, totalAmount,
  totalInvoiced, pendingInvoices, active, updatedAt, goneAt`;

app.get("/api/accounts", (req, res) => {
  const { q = "", balance = "" } = req.query;
  const where = ["active = 1"];
  const params = [];
  if (balance === "1") where.push("ABS(totalAmount) > 0.005");
  if (q) {
    where.push("(guest LIKE ? OR holder LIKE ? OR room LIKE ? OR reservation LIKE ? OR company LIKE ?)");
    params.push(...Array(5).fill(`%${q}%`));
  }
  const rows = db
    .prepare(`SELECT ${ACC_COLS} FROM accounts WHERE ${where.join(" AND ")} ORDER BY CAST(room AS INTEGER), room, reservation`)
    .all(...params);
  const totals = db
    .prepare(`SELECT COUNT(*) n, SUM(CASE WHEN ABS(totalAmount) > 0.005 THEN 1 ELSE 0 END) withBalance, SUM(totalAmount) total
              FROM accounts WHERE active = 1`)
    .get();
  const last = db.prepare("SELECT finishedAt FROM syncRuns WHERE module='accounts' AND status='ok' ORDER BY id DESC LIMIT 1").get();
  res.json({ rows, totals, syncedAt: last?.finishedAt ?? null });
});

app.get("/api/accounts/:id", (req, res) => {
  const acc = db.prepare(`SELECT ${ACC_COLS} FROM accounts WHERE accountId = ?`).get(req.params.id);
  if (!acc) return res.status(404).json({ error: "Cuenta no encontrada" });
  const movements = db
    .prepare(
      `SELECT id, date, time, registrationDate, service, description, folder, invoiceTo, units, net, tax, gross, total,
              paymentType, currency, active
       FROM accountMovements WHERE accountId = ? AND active = 1 ORDER BY registrationDate, date, time`
    )
    .all(req.params.id);
  res.json({ ...acc, movements });
});

// Estado de habitaciones
app.get("/api/rooms", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, room, floor, roomType, status, statusDescription, occupancyStatus, maintenanceStatus, outOfOrder,
              inactivityType, inactivityStart, inactivityEnd, malfunction, mainGuest, attentions, updatedAt
       FROM rooms ORDER BY CAST(floor AS INTEGER), CAST(room AS INTEGER), room`
    )
    .all();
  const t = db.prepare("SELECT data FROM widgets WHERE key = 'roomstatus-totals' ORDER BY date DESC LIMIT 1").get();
  res.json({ rows, totals: t ? JSON.parse(t.data) : null, syncedAt: rows[0]?.updatedAt ?? null });
});

// Reservas por llegar
app.get("/api/reservations", (req, res) => {
  const { date = "", q = "" } = req.query;
  const where = ["active = 1"];
  const params = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) (where.push("arrival = ?"), params.push(date));
  if (q) {
    where.push("(guest LIKE ? OR reservation LIKE ? OR company LIKE ? OR voucher LIKE ? OR groupName LIKE ?)");
    params.push(...Array(5).fill(`%${q}%`));
  }
  const rows = db
    .prepare(
      `SELECT id, reservation, guest, arrival, departure, arrivalTime, nights, adults, children, babies, roomTypeReserved,
              roomTypeOccupied, room, pension, priceRate, company, agency, segment, groupName, voucher, country, balance,
              depositRequired, confirmation, comments, lastSeenAt
       FROM reservations WHERE ${where.join(" AND ")} ORDER BY arrival, arrivalTime, guest`
    )
    .all(...params);
  const byDay = db
    .prepare("SELECT arrival date, COUNT(*) n, SUM(CASE WHEN room IS NULL OR room = '' THEN 1 ELSE 0 END) unassigned FROM reservations WHERE active = 1 GROUP BY arrival ORDER BY arrival")
    .all();
  res.json({ rows, byDay });
});

// Planning de alojamientos (versión compacta guardada en la última sincronización)
app.get("/api/planning", (_req, res) => {
  const w = db.prepare("SELECT data, updatedAt FROM widgets WHERE key = 'roomplanning' ORDER BY date DESC LIMIT 1").get();
  if (!w) return res.status(404).json({ error: "Todavía no hay planning respaldado." });
  res.json({ ...JSON.parse(w.data), syncedAt: w.updatedAt });
});

// Frontend compilado (npm run build).
const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

const scrubbed = scrubStoredPans();
if (scrubbed) {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;"); // no dejar restos del dato original en el archivo
  console.log(`PCI: ${scrubbed} registros con números de tarjeta enmascarados`);
}

app.listen(PORT, () => {
  console.log(`Hotel dashboard en http://localhost:${PORT}`);
  const tick = async () => {
    if (DEMO || (!getToken() && !canAutoLogin() && !process.env.NEWHOTEL_ALLOW_NO_TOKEN)) return;
    const r = await syncAll();
    console.log(new Date().toISOString(), "sync", JSON.stringify(r));
  };
  tick();
  setInterval(tick, SYNC_MINUTES * 60_000);
});
