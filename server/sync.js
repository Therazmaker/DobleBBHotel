// Sincronización NewHotel -> base de datos propia.
// En Convex esto será una internalAction (fetch) + internalMutation (upsert) + un cron.
import { db, tx } from "./db.js";
import { maskPan, scrub } from "./pci.js";
import { ensureFreshToken, fetchAll, get, post, IN_HOUSE_GUESTS_PAYLOAD } from "./newhotel.js";

export const HOTEL_TZ = process.env.HOTEL_TZ || "America/Lima";

export function todayInHotel() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HOTEL_TZ }).format(new Date());
}

const day = (s) => (typeof s === "string" && s.length >= 10 ? s.slice(0, 10) : null);

function parseRate(text) {
  const m = /^([\d.,]+)\s*([A-Z]{3})?$/.exec((text || "").trim());
  if (!m) return { amount: null, currency: null };
  return { amount: Number(m[1].replace(/,/g, "")), currency: m[2] || null };
}

export function normalizeGuest(g) {
  const [adults, children, babies] = String(g.resePaxs || "")
    .split(/\s+/)
    .map((n) => Number.parseInt(n, 10) || 0);
  const rate = parseRate(g.rate);
  return {
    id: g.id,
    occupationLine: g.occupationLine ?? null,
    reservation: g.reserva ?? null,
    roomNumber: g.roomNumber ?? null,
    roomType: g.type ?? null,
    arrival: day(g.guestArrival || g.arrivalDate),
    departure: day(g.guestDeparture || g.departureDate),
    firstName: g.guestFirstName ?? null,
    lastName: g.guestLastName ?? null,
    fullName: g.guestName ?? null,
    countryId: g.countryId || null,
    country: g.country || null,
    entity: g.entity || null,
    clientType: g.clientType || null,
    groupName: g.groupName || null,
    rateAmount: rate.amount,
    rateCurrency: rate.currency,
    rateText: g.rate ?? null,
    pension: g.pension || null,
    guestType: g.guestType || null,
    age: Number.isFinite(g.age) ? g.age : null,
    gender: g.gender || null,
    adults: adults ?? 0,
    children: children ?? 0,
    babies: babies ?? 0,
    isHolder: g.isHolder ? 1 : 0,
    state: g.stateReseDesc || g.state || null,
    email: g.emailAddress || null,
    phone: g.cellPhone || null,
    raw: JSON.stringify(scrub(g)),
  };
}

const COLS = [
  "id", "occupationLine", "reservation", "roomNumber", "roomType", "arrival", "departure",
  "firstName", "lastName", "fullName", "countryId", "country", "entity", "clientType",
  "groupName", "rateAmount", "rateCurrency", "rateText", "pension", "guestType", "age",
  "gender", "adults", "children", "babies", "isHolder", "state", "email", "phone", "raw",
];

let running = null;

export function syncGuests() {
  // Evita dos sincronizaciones a la vez.
  if (!running) running = doSyncGuests().finally(() => (running = null));
  return running;
}

async function doSyncGuests() {
  const startedAt = new Date().toISOString();
  const runId = db
    .prepare("INSERT INTO syncRuns(module, startedAt, status) VALUES('guests', ?, 'running')")
    .run(startedAt).lastInsertRowid;

  try {
    await ensureFreshToken();
    const rows = (await fetchAll("guests/search", IN_HOUSE_GUESTS_PAYLOAD)).map(normalizeGuest);
    const now = new Date().toISOString();

    const exists = db.prepare("SELECT 1 FROM guests WHERE id = ?");
    const upsert = db.prepare(`
      INSERT INTO guests (${COLS.join(",")}, inHouse, firstSeenAt, lastSeenAt, checkedOutAt)
      VALUES (${COLS.map(() => "?").join(",")}, 1, ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        ${COLS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ")},
        inHouse = 1, lastSeenAt = excluded.lastSeenAt, checkedOutAt = NULL
    `);

    const result = tx(() => {
      let inserted = 0;
      let updated = 0;
      for (const r of rows) {
        exists.get(r.id) ? updated++ : inserted++;
        upsert.run(...COLS.map((c) => r[c]), now, now);
      }
      // Quien estaba en casa y ya no aparece -> se fue (check-out).
      const ids = rows.map((r) => r.id);
      const departed = db
        .prepare(
          `UPDATE guests SET inHouse = 0, checkedOutAt = ?
           WHERE inHouse = 1 ${ids.length ? `AND id NOT IN (${ids.map(() => "?").join(",")})` : ""}`
        )
        .run(now, ...ids).changes;

      // Foto del día.
      const s = db
        .prepare(
          `SELECT COUNT(*) guests, COUNT(DISTINCT roomNumber) rooms,
                  SUM(CASE WHEN guestType = 'Niño' THEN 0 ELSE 1 END) adults,
                  SUM(CASE WHEN guestType = 'Niño' THEN 1 ELSE 0 END) children,
                  AVG(rateAmount) avgRate
           FROM guests WHERE inHouse = 1`
        )
        .get();
      db.prepare(
        `INSERT INTO dailyStats(date, guests, rooms, adults, children, avgRate, updatedAt)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(date) DO UPDATE SET guests=excluded.guests, rooms=excluded.rooms,
           adults=excluded.adults, children=excluded.children, avgRate=excluded.avgRate,
           updatedAt=excluded.updatedAt`
      ).run(todayInHotel(), s.guests, s.rooms, s.adults ?? 0, s.children ?? 0, s.avgRate, now);

      return { inserted, updated, departed };
    });

    db.prepare(
      `UPDATE syncRuns SET status='ok', finishedAt=?, fetched=?, inserted=?, updated=?, departed=? WHERE id=?`
    ).run(new Date().toISOString(), rows.length, result.inserted, result.updated, result.departed, runId);

    return { ok: true, fetched: rows.length, ...result };
  } catch (e) {
    db.prepare(`UPDATE syncRuns SET status='error', finishedAt=?, error=? WHERE id=?`).run(
      new Date().toISOString(),
      String(e.message || e),
      runId
    );
    return { ok: false, error: String(e.message || e) };
  }
}

// ------------------------- Panel PMS (ocupación + previsión) -------------------------
let runningDash = null;
export function syncDashboard() {
  if (!runningDash) runningDash = doSyncDashboard().finally(() => (runningDash = null));
  return runningDash;
}

async function doSyncDashboard() {
  const startedAt = new Date().toISOString();
  const runId = db
    .prepare("INSERT INTO syncRuns(module, startedAt, status) VALUES('dashboard', ?, 'running')")
    .run(startedAt).lastInsertRowid;
  try {
    await ensureFreshToken();
    const WIDGETS = ["bookingsroomtype", "bookingtypepercentage", "topnationalities"];
    const [occ, fc, ...widgets] = await Promise.all([
      get("dashboardpms/currentoccupancy"),
      get("dashboardpms/bookinginout"),
      ...WIDGETS.map((w) => get(`dashboardpms/${w}`)),
    ]);
    const o = occ?.content?.data?.[0];
    const days = fc?.content?.data ?? [];
    const now = new Date().toISOString();
    const workDate = day(o?.selectedDate) || todayInHotel();

    tx(() => {
      if (o) {
        db.prepare(
          `INSERT INTO occupancy (date, inventory, roomsAvailable, roomsOccupied, roomsVacant, occupancyPercent,
             arrivalsTotal, arrivalsDone, arrivalsPending, departuresTotal, departuresDone, departuresPending,
             adults, children, breakfasts, currency, adr, revpar, revenueRoom, cleanRooms, dirtyRooms, raw, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(date) DO UPDATE SET
             inventory=excluded.inventory, roomsAvailable=excluded.roomsAvailable, roomsOccupied=excluded.roomsOccupied,
             roomsVacant=excluded.roomsVacant, occupancyPercent=excluded.occupancyPercent,
             arrivalsTotal=excluded.arrivalsTotal, arrivalsDone=excluded.arrivalsDone, arrivalsPending=excluded.arrivalsPending,
             departuresTotal=excluded.departuresTotal, departuresDone=excluded.departuresDone,
             departuresPending=excluded.departuresPending, adults=excluded.adults, children=excluded.children,
             breakfasts=excluded.breakfasts, currency=excluded.currency, adr=excluded.adr, revpar=excluded.revpar,
             revenueRoom=excluded.revenueRoom, cleanRooms=excluded.cleanRooms, dirtyRooms=excluded.dirtyRooms,
             raw=excluded.raw, updatedAt=excluded.updatedAt`
        ).run(
          day(o.selectedDate), o.inventory, o.roomAvailables, o.totalBookings, o.roomVacants, o.occupancyPercent,
          o.totalArrivals, o.currentArrivals, o.expectedArrivals, o.totalDepartures, o.currentDepartures,
          o.expectedDepartures, o.adults, o.children, o.breakfasts, o.currencyCode, o.averageDailyRate,
          o.revenuePerAvailableRoom, o.revenueRoom, Math.round(o.cleanRooms ?? 0), Math.round(o.notCleanRooms ?? 0),
          JSON.stringify(scrub(o)), now
        );
      }
      const up = db.prepare(
        `INSERT INTO forecast (date, arrivals, departures, stayovers, dayUse, updatedAt) VALUES (?,?,?,?,?,?)
         ON CONFLICT(date) DO UPDATE SET arrivals=excluded.arrivals, departures=excluded.departures,
           stayovers=excluded.stayovers, dayUse=excluded.dayUse, updatedAt=excluded.updatedAt`
      );
      for (const d of days) up.run(day(d.selectedDate), d.totalArrivals, d.totalDepartures, d.totalStayovers, d.dayUse ?? 0, now);
      const w = db.prepare(
        `INSERT INTO widgets (key, date, data, updatedAt) VALUES (?,?,?,?)
         ON CONFLICT(key, date) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`
      );
      WIDGETS.forEach((key, i) => {
        const data = widgets[i]?.content?.data;
        if (Array.isArray(data)) w.run(key, workDate, JSON.stringify(scrub(data)), now);
      });
    });

    db.prepare(`UPDATE syncRuns SET status='ok', finishedAt=?, fetched=? WHERE id=?`).run(
      new Date().toISOString(), days.length + (o ? 1 : 0), runId
    );
    return { ok: true, occupancy: Boolean(o), forecastDays: days.length };
  } catch (e) {
    db.prepare(`UPDATE syncRuns SET status='error', finishedAt=?, error=? WHERE id=?`).run(
      new Date().toISOString(), String(e.message || e), runId
    );
    return { ok: false, error: String(e.message || e) };
  }
}

// ---------------- Panel interactivo (llegadas/salidas pendientes, en casa) ----------------
const PANEL_KINDS = { arrival: "arrivals", departure: "departures", inhouse: "guests" };
let runningPanel = null;
export function syncPanel() {
  if (!runningPanel) runningPanel = doSyncPanel().finally(() => (runningPanel = null));
  return runningPanel;
}

async function doSyncPanel() {
  const runId = db
    .prepare("INSERT INTO syncRuns(module, startedAt, status) VALUES('panel', ?, 'running')")
    .run(new Date().toISOString()).lastInsertRowid;
  try {
    await ensureFreshToken();
    const kinds = Object.keys(PANEL_KINDS);
    const results = await Promise.all(kinds.map((k) => post(`interactivepanel/${PANEL_KINDS[k]}`, {})));
    const now = new Date().toISOString();
    const counts = {};

    tx(() => {
      const up = db.prepare(`
        INSERT INTO panel (kind, id, reservation, guest, room, roomTypeReserved, roomTypeOccupied, state, arrivalAt,
          departureAt, accountId, entity, groupName, paxs, pendingInvoice, totalExtras, raw, active, firstSeenAt, lastSeenAt, goneAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)
        ON CONFLICT(kind, id) DO UPDATE SET reservation=excluded.reservation, guest=excluded.guest, room=excluded.room,
          roomTypeReserved=excluded.roomTypeReserved, roomTypeOccupied=excluded.roomTypeOccupied, state=excluded.state,
          arrivalAt=excluded.arrivalAt, departureAt=excluded.departureAt, accountId=excluded.accountId,
          entity=excluded.entity, groupName=excluded.groupName, paxs=excluded.paxs, pendingInvoice=excluded.pendingInvoice,
          totalExtras=excluded.totalExtras, raw=excluded.raw, active=1, lastSeenAt=excluded.lastSeenAt, goneAt=NULL`);
      kinds.forEach((kind, i) => {
        const rows = results[i]?.content?.data ?? [];
        counts[kind] = rows.length;
        for (const r of rows) {
          up.run(
            kind, r.id, r.reservation ?? null, r.guest ?? null, r.room || null, r.roomTypeReserved ?? null,
            r.roomTypeOccupied ?? null, r.stateDescription ?? null, r.arrivalDateTime ?? null, r.departureDateTime ?? null,
            r.accountId ?? null, r.entityDescription || null, r.groupName || null, r.paxs ?? null,
            r.pendingInvoice == null ? null : r.pendingInvoice ? 1 : 0, r.totalExtras ?? null, JSON.stringify(scrub(r)), now, now
          );
        }
        const ids = rows.map((r) => r.id);
        db.prepare(
          `UPDATE panel SET active = 0, goneAt = ? WHERE kind = ? AND active = 1
           ${ids.length ? `AND id NOT IN (${ids.map(() => "?").join(",")})` : ""}`
        ).run(now, kind, ...ids);
      });
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    db.prepare(`UPDATE syncRuns SET status='ok', finishedAt=?, fetched=? WHERE id=?`).run(new Date().toISOString(), total, runId);
    return { ok: true, ...counts };
  } catch (e) {
    db.prepare(`UPDATE syncRuns SET status='error', finishedAt=?, error=? WHERE id=?`).run(
      new Date().toISOString(), String(e.message || e), runId
    );
    return { ok: false, error: String(e.message || e) };
  }
}

// ------------------------------ Cuentas corrientes ------------------------------
const ACCOUNTS_SEARCH = {
  hasTotal: false, sortDirection: 1, isCurrentAccountIdNotNull: true, number: null, serie: null,
  arrivalComparator: 2221, arrivalFrom: null, reservationState: 602, departureComparator: 2221,
  departureDateFrom: null, firstName: null, lastName: null, roomNumber: null,
};
const movementsPayload = (accountId, desc) => ({
  page: 1, pagesize: 500, hasTotal: false, sortDirection: 1, accountType: 241, accountId, accountDescription: desc,
  currentAccount: { accountType: 241, accountId, accountDescription: desc },
  currency: "PEN", department: null, dateFilterType: 2221, dateBegin: null, docNumber: null,
  isMaster: true, isExtra1: true, isExtra2: true, isExtra3: true, isExtra4: true, isExtra5: true,
  groupingFlags: 0, descriptionFlags: 0,
});

/** Ejecuta fn sobre items con concurrencia limitada (no saturar NewHotel). */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: String(e.message || e) }; }
      }
    })
  );
  return out;
}

let runningAcc = null;
export function syncAccounts() {
  if (!runningAcc) runningAcc = doSyncAccounts().finally(() => (runningAcc = null));
  return runningAcc;
}

async function doSyncAccounts() {
  const runId = db
    .prepare("INSERT INTO syncRuns(module, startedAt, status) VALUES('accounts', ?, 'running')")
    .run(new Date().toISOString()).lastInsertRowid;
  try {
    await ensureFreshToken();
    const list = (await post("reservations/account/search", { ...ACCOUNTS_SEARCH, page: 1, pagesize: 500 }))?.content?.data ?? [];
    const props = await pool(list, 5, (a) =>
      get(`currentaccounts/currentaccountproperties?currentAccountId=${encodeURIComponent(a.accountId)}`).then((r) => r?.content)
    );
    // Movimientos solo de cuentas con importe (o con pendiente de facturar)
    const withBalance = list.filter((a, i) => props[i] && !props[i].error && (props[i].totalAmount || props[i].pendingInvoices));
    const movs = await pool(withBalance, 4, (a) =>
      post("currentaccounts/search", movementsPayload(a.accountId, a.reservation)).then((r) => r?.content?.data ?? [])
    );
    const now = new Date().toISOString();
    let movCount = 0;
    let errors = 0;

    tx(() => {
      const upA = db.prepare(`
        INSERT INTO accounts (accountId, occupationLineId, reservation, room, roomType, arrival, departure, term, paxs, company,
          groupName, holder, guest, remarks, masterAmount, extra1Amount, extra2Amount, extra3Amount, extra4Amount, extra5Amount,
          totalAmount, totalInvoiced, pendingInvoices, raw, active, firstSeenAt, updatedAt, goneAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,NULL)
        ON CONFLICT(accountId) DO UPDATE SET occupationLineId=excluded.occupationLineId, reservation=excluded.reservation,
          room=excluded.room, roomType=excluded.roomType, arrival=excluded.arrival, departure=excluded.departure, term=excluded.term,
          paxs=excluded.paxs, company=excluded.company, groupName=excluded.groupName, holder=excluded.holder, guest=excluded.guest,
          remarks=excluded.remarks, masterAmount=excluded.masterAmount, extra1Amount=excluded.extra1Amount,
          extra2Amount=excluded.extra2Amount, extra3Amount=excluded.extra3Amount, extra4Amount=excluded.extra4Amount,
          extra5Amount=excluded.extra5Amount, totalAmount=excluded.totalAmount, totalInvoiced=excluded.totalInvoiced,
          pendingInvoices=excluded.pendingInvoices, raw=excluded.raw, active=1, updatedAt=excluded.updatedAt, goneAt=NULL`);
      list.forEach((a, i) => {
        const p = props[i];
        if (!p || p.error) return void errors++;
        upA.run(
          a.accountId, p.occupationLineId ?? a.id ?? null, p.reservationNumber ?? a.reservation ?? null, p.room ?? a.room ?? null,
          p.roomType ?? null, day(p.arrivalDate), day(p.departureDate), p.term ?? null, p.paxs ?? null,
          p.reservationCompany || null, p.reservationGroup || null, p.reservationHolder || null, a.guest || null,
          maskPan(p.remarks) || null, p.masterAmount ?? 0, p.extra1Amount ?? 0, p.extra2Amount ?? 0, p.extra3Amount ?? 0,
          p.extra4Amount ?? 0, p.extra5Amount ?? 0, p.totalAmount ?? 0, p.totalInvoiced ?? 0, p.pendingInvoices ?? 0,
          JSON.stringify(scrub(p)), now, now
        );
      });
      const ids = list.map((a) => a.accountId);
      db.prepare(
        `UPDATE accounts SET active = 0, goneAt = ? WHERE active = 1
         ${ids.length ? `AND accountId NOT IN (${ids.map(() => "?").join(",")})` : ""}`
      ).run(now, ...ids);

      const upM = db.prepare(`
        INSERT INTO accountMovements (id, accountId, date, time, registrationDate, service, description, folder, invoiceTo,
          units, net, tax, gross, total, paymentType, currency, raw, active, firstSeenAt, lastSeenAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
        ON CONFLICT(id) DO UPDATE SET date=excluded.date, time=excluded.time, service=excluded.service,
          description=excluded.description, folder=excluded.folder, invoiceTo=excluded.invoiceTo, units=excluded.units,
          net=excluded.net, tax=excluded.tax, gross=excluded.gross, total=excluded.total, paymentType=excluded.paymentType,
          raw=excluded.raw, active=1, lastSeenAt=excluded.lastSeenAt`);
      withBalance.forEach((a, i) => {
        const rows = Array.isArray(movs[i]) ? movs[i] : null;
        if (!rows) return void errors++;
        for (const m of rows) {
          movCount++;
          upM.run(
            m.id, a.accountId, day(m.date), m.time ?? null, m.registrationDate ?? null, m.service || null, maskPan(m.description) || null,
            m.account || null, m.invoiceToDescription || null, m.units ?? null, m.netValue ?? null, m.taxValue ?? null,
            m.grossValue ?? null, m.totalValue ?? m.amount ?? null, m.paymentType || m.typePayment || null, m.currency || null,
            JSON.stringify(scrub(m)), now, now
          );
        }
        const mids = rows.map((m) => m.id);
        db.prepare(
          `UPDATE accountMovements SET active = 0 WHERE accountId = ? AND active = 1
           ${mids.length ? `AND id NOT IN (${mids.map(() => "?").join(",")})` : ""}`
        ).run(a.accountId, ...mids);
      });
      // Cuentas que quedaron a 0: sus movimientos ya no están pendientes
      const zero = list.filter((a, i) => props[i] && !props[i].error && !props[i].totalAmount && !props[i].pendingInvoices);
      const z = db.prepare(`UPDATE accountMovements SET active = 0 WHERE accountId = ? AND active = 1`);
      for (const a of zero) z.run(a.accountId);
    });

    db.prepare(`UPDATE syncRuns SET status=?, finishedAt=?, fetched=?, error=? WHERE id=?`).run(
      errors ? "error" : "ok", new Date().toISOString(), list.length,
      errors ? `${errors} cuentas no se pudieron leer` : null, runId
    );
    return { ok: !errors, accounts: list.length, withBalance: withBalance.length, movements: movCount, errors };
  } catch (e) {
    db.prepare(`UPDATE syncRuns SET status='error', finishedAt=?, error=? WHERE id=?`).run(
      new Date().toISOString(), String(e.message || e), runId
    );
    return { ok: false, error: String(e.message || e) };
  }
}

// --------------------- Recepción / Ama de llaves / Reservas ---------------------
const RES_DAYS = Number(process.env.RESERVATIONS_DAYS || 7);
const reservationsPayload = (dateIso) => ({
  page: 1, pageSize: 1000, sortColumn: null, sortDirection: 1, number: null, serie: null, reservationState: 601,
  firstName: null, lastName: null, roomId: null, arrivalComparator: 2221, arrivalFrom: `${dateIso}T00:00:00`,
  departureComparator: 2221, departureDateFrom: null, createdComparator: 2221, creationDateFrom: null,
  isOccupancy: false, cancellationComparator: 2221, cancellationDateFrom: null, deadlineComparator: 2221,
  deadlineFrom: null, lastModifiedComparator: 2221, lastModifiedFrom: null, nightsComparator: 2221, nightsFrom: null,
  cancelled: true, checkOuts: false, noShows: null, noShowsWithoutGuarantee: true, showADR: true, showBalance: true,
  excludeBalanced: false, showCommentsInPrint: true, totalReservationPrice: false, hasTotal: false,
});
const ROOM_STATUS_PAYLOAD = {
  roomId: null, roomTypeIds: null, roomBlockId: null, floorNo: null, roomStatusIds: null, occupied: null,
  hideOutOfOrders: null, hideOutOfRentals: null, active: null, preAssigned: null, preCheckIn: null,
  withChecklistCompleted: null, roomMaidId: null, supervisorId: null,
};
const planningPayload = (dateIso) => ({
  initialDate: `${dateIso}T00:00:00`, roomTypeIds: null, roomBlockId: null, floorNo: null, roomFeaturesIds: null,
  roomTypeGroupIds: null, arrivalComparator: 2221, arrivalDateFrom: null, departureComparator: 2221,
  departureDateFrom: null, isOccupancy: false, reservationState: null, roomId: null, showUnassignedRooms: true,
  hideReservationCheckedOut: false, groupByRoomType: false,
});
const addDaysIso = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Versión compacta del planning (el original pesa ~1 MB). */
function compactPlanning(c) {
  const b = (x) => ({
    id: x.bookingId, no: x.bookingNo, name: maskPan(x.bookingDescription || x.holder || ""), company: x.companyName || "",
    from: day(x.initialDate || x.arrival), to: day(x.finalDate || x.departure), arrival: day(x.arrival),
    departure: day(x.departure), state: x.bookingState, stateDesc: x.stateDescription, nights: x.nights,
    paxs: x.paxs, group: x.groupName || "", overbooked: !!x.isOverbooked, pending: !!x.pendingAmountFlag,
    roomType: x.reservedRoomType || "",
  });
  const unassigned = new Map();
  for (const u of c.unassignedRooms || []) {
    if (!u.reservationId || unassigned.has(u.reservationId)) continue;
    unassigned.set(u.reservationId, {
      id: u.reservationId, no: u.reservationNumber, name: maskPan(u.reservation || ""), company: u.entity || "",
      arrival: day(u.arrival), departure: day(u.departure), nights: u.nights, paxs: u.paxs,
      roomType: u.reservedRoomType || u.roomTypeDescription || "", state: u.state, group: u.group || "",
    });
  }
  return {
    workDate: day(c.workDate), from: day(c.fromDate), to: day(c.toDate),
    dates: (c.dates || []).map((d) => day(d.date)),
    availability: (c.newTotalRooms || []).map((d) => ({ date: day(d.date), available: d.availableRooms, occupancy: d.occupancy })),
    statuses: c.roomStatusUsed || [],
    rooms: (c.rooms || []).map((r) => ({
      id: r.roomId, room: r.roomName, type: r.roomTypeAbbreviation, status: r.roomStatus, statusId: r.roomStatusId,
      inactive: !!r.hasInactivity, bookings: (r.bookings || []).map(b),
    })),
    unassigned: [...unassigned.values()].sort((a, z) => (a.arrival || "").localeCompare(z.arrival || "")),
  };
}

let runningOps = null;
export function syncOperations() {
  if (!runningOps) runningOps = doSyncOperations().finally(() => (runningOps = null));
  return runningOps;
}

async function doSyncOperations() {
  const runId = db
    .prepare("INSERT INTO syncRuns(module, startedAt, status) VALUES('operations', ?, 'running')")
    .run(new Date().toISOString()).lastInsertRowid;
  try {
    await ensureFreshToken();
    const workDate = db.prepare("SELECT date FROM occupancy ORDER BY date DESC LIMIT 1").get()?.date || todayInHotel();
    const days = Array.from({ length: RES_DAYS }, (_, i) => addDaysIso(workDate, i));
    const [rs, planning, ...resDays] = await Promise.all([
      post("roomstatus/search", ROOM_STATUS_PAYLOAD),
      post("roomplanning/calendar", planningPayload(addDaysIso(workDate, -2))),
      ...days.map((d) => post("reservations/search", reservationsPayload(d))),
    ]);
    const roomRows = rs?.content?.data ?? [];
    const now = new Date().toISOString();
    let resCount = 0;

    tx(() => {
      const upR = db.prepare(`
        INSERT INTO rooms (id, room, floor, roomType, status, statusDescription, occupancyStatus, maintenanceStatus,
          outOfOrder, inactivityType, inactivityStart, inactivityEnd, malfunction, mainGuest, attentions, raw, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET room=excluded.room, floor=excluded.floor, roomType=excluded.roomType,
          status=excluded.status, statusDescription=excluded.statusDescription, occupancyStatus=excluded.occupancyStatus,
          maintenanceStatus=excluded.maintenanceStatus, outOfOrder=excluded.outOfOrder, inactivityType=excluded.inactivityType,
          inactivityStart=excluded.inactivityStart, inactivityEnd=excluded.inactivityEnd, malfunction=excluded.malfunction,
          mainGuest=excluded.mainGuest, attentions=excluded.attentions, raw=excluded.raw, updatedAt=excluded.updatedAt`);
      for (const r of roomRows) {
        upR.run(
          r.id, r.room, String(r.floor ?? ""), r.roomType, r.status, r.statusDescription, r.occupancyStatus || null,
          r.maintenanceStatus || null, r.outOfOrder ? 1 : 0, r.inactivityTypeDescription || null, day(r.inactivityStart),
          day(r.inactivityEnd), maskPan(r.malfunctionDescription) || null, r.mainGuest || null, maskPan(r.attentions) || null,
          JSON.stringify(scrub(r)), now
        );
      }
      const totals = rs?.content ? { clean: rs.content.clean, dirty: rs.content.dirty, verify: rs.content.verify,
        cleaning: rs.content.cleaning, totalRooms: rs.content.totalRooms } : null;
      const w = db.prepare(
        `INSERT INTO widgets (key, date, data, updatedAt) VALUES (?,?,?,?)
         ON CONFLICT(key, date) DO UPDATE SET data=excluded.data, updatedAt=excluded.updatedAt`
      );
      if (totals) w.run("roomstatus-totals", workDate, JSON.stringify(totals), now);
      if (planning?.content) w.run("roomplanning", workDate, JSON.stringify(compactPlanning(planning.content)), now);

      const upRes = db.prepare(`
        INSERT INTO reservations (id, reservation, guest, arrival, departure, arrivalTime, nights, adults, children, babies,
          roomTypeReserved, roomTypeOccupied, room, pension, priceRate, company, agency, segment, groupName, voucher, country,
          balance, depositRequired, confirmation, comments, accountId, raw, active, firstSeenAt, lastSeenAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
        ON CONFLICT(id) DO UPDATE SET reservation=excluded.reservation, guest=excluded.guest, arrival=excluded.arrival,
          departure=excluded.departure, arrivalTime=excluded.arrivalTime, nights=excluded.nights, adults=excluded.adults,
          children=excluded.children, babies=excluded.babies, roomTypeReserved=excluded.roomTypeReserved,
          roomTypeOccupied=excluded.roomTypeOccupied, room=excluded.room, pension=excluded.pension, priceRate=excluded.priceRate,
          company=excluded.company, agency=excluded.agency, segment=excluded.segment, groupName=excluded.groupName,
          voucher=excluded.voucher, country=excluded.country, balance=excluded.balance, depositRequired=excluded.depositRequired,
          confirmation=excluded.confirmation, comments=excluded.comments, accountId=excluded.accountId, raw=excluded.raw,
          active=1, lastSeenAt=excluded.lastSeenAt`);
      days.forEach((d, i) => {
        const rows = resDays[i]?.content?.data ?? [];
        resCount += rows.length;
        for (const r of rows) {
          upRes.run(
            r.id || r.reservationId, r.reservation,
            r.guest || r.holderFullName || [r.holderLastName, r.holderFirstName].filter(Boolean).join(", ") || (r.groupName ? `Grupo ${r.groupName}` : null), day(r.arrivalDate), day(r.departureDate),
            r.arrivalTime ? r.arrivalTime.slice(11, 16) : null, r.nights ?? null, r.adults ?? 0, r.children ?? 0, r.babies ?? 0,
            r.roomTypeReserved || null, r.roomTypeOccupied || null, r.room || null, r.pension || null, r.priceRate || null,
            r.company || null, r.agency || null, r.segment || null, r.groupName || null, r.voucher || null,
            r.countryName || r.countryCode || null, r.balance ?? null, r.depositRequired ? 1 : 0, r.confirmationStatus || null,
            maskPan(r.commentsFormatted || r.comments) || null, r.accountId || null, JSON.stringify(scrub(r)), now, now
          );
        }
        const ids = rows.map((r) => r.id || r.reservationId);
        db.prepare(
          `UPDATE reservations SET active = 0 WHERE arrival = ? AND active = 1
           ${ids.length ? `AND id NOT IN (${ids.map(() => "?").join(",")})` : ""}`
        ).run(d, ...ids);
      });
      // Reservas de días ya pasados dejan de estar "por llegar"
      db.prepare("UPDATE reservations SET active = 0 WHERE arrival < ? AND active = 1").run(workDate);
    });

    db.prepare(`UPDATE syncRuns SET status='ok', finishedAt=?, fetched=? WHERE id=?`).run(
      new Date().toISOString(), roomRows.length + resCount, runId
    );
    return { ok: true, rooms: roomRows.length, reservations: resCount, days: days.length, planning: !!planning?.content };
  } catch (e) {
    db.prepare(`UPDATE syncRuns SET status='error', finishedAt=?, error=? WHERE id=?`).run(
      new Date().toISOString(), String(e.message || e), runId
    );
    return { ok: false, error: String(e.message || e) };
  }
}

/** Sincroniza todos los módulos. */
export async function syncAll() {
  const guests = await syncGuests();
  const [dashboard, panel] = await Promise.all([syncDashboard(), syncPanel()]);
  const accounts = await syncAccounts();
  const operations = await syncOperations();
  return {
    ok: guests.ok && dashboard.ok && panel.ok && accounts.ok && operations.ok,
    guests, dashboard, panel, accounts, operations,
    error: guests.error || dashboard.error || panel.error || accounts.error || operations.error,
  };
}
