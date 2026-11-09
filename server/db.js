// Base de datos local (SQLite integrado en Node 22).
// Las tablas tienen la misma forma que tendrán en Convex (convex/schema.ts),
// para que la migración sea copiar la lógica, no rediseñarla.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || resolve(here, "../data/hotel.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS guests (
  id             TEXT PRIMARY KEY,     -- id de NewHotel
  occupationLine TEXT,
  reservation    TEXT,
  roomNumber     TEXT,
  roomType       TEXT,
  arrival        TEXT,                 -- YYYY-MM-DD
  departure      TEXT,                 -- YYYY-MM-DD
  firstName      TEXT,
  lastName       TEXT,
  fullName       TEXT,
  countryId      TEXT,
  country        TEXT,
  entity         TEXT,
  clientType     TEXT,
  groupName      TEXT,
  rateAmount     REAL,
  rateCurrency   TEXT,
  rateText       TEXT,
  pension        TEXT,
  guestType      TEXT,
  age            INTEGER,
  gender         TEXT,
  adults         INTEGER,
  children       INTEGER,
  babies         INTEGER,
  isHolder       INTEGER,
  state          TEXT,
  email          TEXT,
  phone          TEXT,
  raw            TEXT,                 -- registro completo de NewHotel (JSON)
  inHouse        INTEGER NOT NULL DEFAULT 1,
  firstSeenAt    TEXT NOT NULL,
  lastSeenAt     TEXT NOT NULL,
  checkedOutAt   TEXT
);
CREATE INDEX IF NOT EXISTS guests_inhouse   ON guests(inHouse);
CREATE INDEX IF NOT EXISTS guests_arrival   ON guests(arrival);
CREATE INDEX IF NOT EXISTS guests_departure ON guests(departure);

CREATE TABLE IF NOT EXISTS syncRuns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  module     TEXT NOT NULL,
  startedAt  TEXT NOT NULL,
  finishedAt TEXT,
  status     TEXT NOT NULL,            -- running | ok | error
  fetched    INTEGER DEFAULT 0,
  inserted   INTEGER DEFAULT 0,
  updated    INTEGER DEFAULT 0,
  departed   INTEGER DEFAULT 0,
  error      TEXT
);

-- Foto diaria de ocupación (una fila por día, se actualiza en cada sync)
CREATE TABLE IF NOT EXISTS dailyStats (
  date      TEXT PRIMARY KEY,
  guests    INTEGER,
  rooms     INTEGER,
  adults    INTEGER,
  children  INTEGER,
  avgRate   REAL,
  updatedAt TEXT
);

-- dashboardpms/currentoccupancy: una fila por día (la última lectura del día)
CREATE TABLE IF NOT EXISTS occupancy (
  date                 TEXT PRIMARY KEY,
  inventory            INTEGER,
  roomsAvailable       INTEGER,
  roomsOccupied        INTEGER,   -- totalBookings
  roomsVacant          INTEGER,
  occupancyPercent     REAL,
  arrivalsTotal        INTEGER,
  arrivalsDone         INTEGER,
  arrivalsPending      INTEGER,
  departuresTotal      INTEGER,
  departuresDone       INTEGER,
  departuresPending    INTEGER,
  adults               INTEGER,
  children             INTEGER,
  breakfasts           INTEGER,
  currency             TEXT,
  adr                  REAL,
  revpar               REAL,
  revenueRoom          REAL,
  cleanRooms           INTEGER,
  dirtyRooms           INTEGER,
  raw                  TEXT,
  updatedAt            TEXT
);

-- dashboardpms/bookinginout: previsión por día (habitaciones)
CREATE TABLE IF NOT EXISTS forecast (
  date       TEXT PRIMARY KEY,
  arrivals   INTEGER,
  departures INTEGER,
  stayovers  INTEGER,
  dayUse     INTEGER,
  updatedAt  TEXT
);

-- interactivepanel/{arrivals,departures,guests}: panel del día de trabajo del PMS
-- kind = arrival (llegada pendiente) | departure (salida pendiente) | inhouse (habitación ocupada)
-- active = 1 mientras aparece en el panel; 0 cuando desaparece (llegó / salió)
CREATE TABLE IF NOT EXISTS panel (
  kind             TEXT NOT NULL,
  id               TEXT NOT NULL,
  reservation      TEXT,
  guest            TEXT,
  room             TEXT,
  roomTypeReserved TEXT,
  roomTypeOccupied TEXT,
  state            TEXT,
  arrivalAt        TEXT,
  departureAt      TEXT,
  accountId        TEXT,
  entity           TEXT,
  groupName        TEXT,
  paxs             TEXT,
  pendingInvoice   INTEGER,
  totalExtras      REAL,
  raw              TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  firstSeenAt      TEXT NOT NULL,
  lastSeenAt       TEXT NOT NULL,
  goneAt           TEXT,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS panel_active ON panel(kind, active);

-- Otros widgets del Sumario del PMS, guardados tal cual (una foto por widget y día de trabajo)
-- key = bookingsroomtype | bookingtypepercentage | topnationalities
CREATE TABLE IF NOT EXISTS widgets (
  key       TEXT NOT NULL,
  date      TEXT NOT NULL,
  data      TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (key, date)
);

-- Cuentas corrientes de huéspedes en casa (currentaccounts/currentaccountproperties)
CREATE TABLE IF NOT EXISTS accounts (
  accountId        TEXT PRIMARY KEY,
  occupationLineId TEXT,
  reservation      TEXT,
  room             TEXT,
  roomType         TEXT,
  arrival          TEXT,
  departure        TEXT,
  term             TEXT,
  paxs             TEXT,
  company          TEXT,
  groupName        TEXT,
  holder           TEXT,
  guest            TEXT,
  remarks          TEXT,
  masterAmount     REAL,
  extra1Amount     REAL,
  extra2Amount     REAL,
  extra3Amount     REAL,
  extra4Amount     REAL,
  extra5Amount     REAL,
  totalAmount      REAL,
  totalInvoiced    REAL,
  pendingInvoices  REAL,
  raw              TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  firstSeenAt      TEXT NOT NULL,
  updatedAt        TEXT NOT NULL,
  goneAt           TEXT
);

-- Movimientos (cargos y pagos) de cada cuenta (currentaccounts/search)
CREATE TABLE IF NOT EXISTS accountMovements (
  id               TEXT PRIMARY KEY,
  accountId        TEXT NOT NULL,
  date             TEXT,
  time             TEXT,
  registrationDate TEXT,
  service          TEXT,
  description      TEXT,
  folder           TEXT,    -- master / extra 1..5
  invoiceTo        TEXT,
  units            REAL,
  net              REAL,
  tax              REAL,
  gross            REAL,
  total            REAL,
  paymentType      TEXT,
  currency         TEXT,
  raw              TEXT,
  active           INTEGER NOT NULL DEFAULT 1,  -- 0 = ya no aparece (facturado / anulado)
  firstSeenAt      TEXT NOT NULL,
  lastSeenAt       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_account ON accountMovements(accountId, active);

-- Estado de habitaciones (roomstatus/search)
CREATE TABLE IF NOT EXISTS rooms (
  id                TEXT PRIMARY KEY,
  room              TEXT,
  floor             TEXT,
  roomType          TEXT,
  status            INTEGER,     -- 661 Sucio, 662 En limpieza, 663 Verificar, 664 Limpio
  statusDescription TEXT,
  occupancyStatus   TEXT,        -- Libre, Ocupado, Estancia, Entrada Prevista, En Check-Out...
  maintenanceStatus TEXT,
  outOfOrder        INTEGER,
  inactivityType    TEXT,
  inactivityStart   TEXT,
  inactivityEnd     TEXT,
  malfunction       TEXT,
  mainGuest         TEXT,
  attentions        TEXT,
  raw               TEXT,
  updatedAt         TEXT NOT NULL
);

-- Reservas por llegar (reservations/search, estado 601), próximos días
CREATE TABLE IF NOT EXISTS reservations (
  id            TEXT PRIMARY KEY,   -- id de la línea de reserva (un grupo tiene varias líneas)
  reservation   TEXT,
  guest         TEXT,
  arrival       TEXT,
  departure     TEXT,
  arrivalTime   TEXT,
  nights        INTEGER,
  adults        INTEGER,
  children      INTEGER,
  babies        INTEGER,
  roomTypeReserved TEXT,
  roomTypeOccupied TEXT,
  room          TEXT,
  pension       TEXT,
  priceRate     TEXT,
  company       TEXT,
  agency        TEXT,
  segment       TEXT,
  groupName     TEXT,
  voucher       TEXT,
  country       TEXT,
  balance       REAL,
  depositRequired INTEGER,
  confirmation  TEXT,
  comments      TEXT,
  accountId     TEXT,
  raw           TEXT,
  active        INTEGER NOT NULL DEFAULT 1,  -- 0 = ya no aparece (llegó, cancelada o movida)
  firstSeenAt   TEXT NOT NULL,
  lastSeenAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reservations_arrival ON reservations(arrival, active);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`);

export function getSetting(key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function tx(fn) {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// Limpieza única de números de tarjeta en datos ya guardados (idempotente).
import { maskPan, scrub } from "./pci.js";
const JSON_COLS = new Set(["raw", "data"]);
// En columnas JSON se enmascaran solo los textos (no los importes con muchos decimales).
const clean = (col, v) => {
  if (!JSON_COLS.has(col)) return maskPan(v);
  try { return JSON.stringify(scrub(JSON.parse(v))); } catch { return maskPan(v); }
};
export function scrubStoredPans() {
  const targets = [
    ["accounts", "accountId", ["remarks", "raw"]],
    ["guests", "id", ["raw"]],
    ["panel", "rowid", ["raw"]],
    ["accountMovements", "id", ["description", "raw"]],
    ["occupancy", "date", ["raw"]],
    ["widgets", "rowid", ["data"]],
  ];
  let changed = 0;
  tx(() => {
    for (const [table, key, cols] of targets) {
      const rows = db.prepare(`SELECT ${key} k, ${cols.join(", ")} FROM ${table}`).all();
      for (const r of rows) {
        const upd = cols.filter((c) => typeof r[c] === "string" && clean(c, r[c]) !== r[c]);
        if (!upd.length) continue;
        db.prepare(`UPDATE ${table} SET ${upd.map((c) => `${c} = ?`).join(", ")} WHERE ${key} = ?`).run(
          ...upd.map((c) => clean(c, r[c])), r.k
        );
        changed++;
      }
    }
  });
  return changed;
}
