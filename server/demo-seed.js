// Datos de prueba INVENTADOS para el modo demo (DEMO=1). Ningún dato real de NewHotel.
// Genera un hotel ficticio coherente: reservas en el tiempo -> huéspedes en casa, ocupación,
// previsión, panel, cuentas con cargos y pagos, estado de habitaciones, planning y reservas futuras.
//
// Uso: npm run seed   (borra los datos de la base y genera nuevos, relativos a la fecha de hoy)
import { randomUUID } from "node:crypto";
import { db, tx, setSetting } from "./db.js";
import { hashPassword } from "./auth.js";
import { todayInHotel } from "./sync.js";

export const DEMO_HOTEL = "Hotel Demo Miraflores";
export const DEMO_USER = { email: "demo@demo.local", password: "demo-recepcion" };

// --------------------------------- utilidades ---------------------------------
let seed = 20261109;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p) => rnd() < p;
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const diff = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86_400_000);
const r2 = (n) => Math.round(n * 100) / 100;
const iso = (d, hm = "00:00") => `${d}T${hm}:00Z`;

const FIRST = ["Lucía", "Mateo", "Valentina", "Santiago", "Camila", "Sebastián", "Isabella", "Diego", "Martina", "Nicolás",
  "Sofía", "Tomás", "Emma", "Joaquín", "Julia", "Andrés", "Paula", "Gabriel", "Daniela", "Felipe", "Laura", "Hugo",
  "Carmen", "Pedro", "Ana", "Javier", "Elena", "Marco", "Olivia", "Lukas", "Chloé", "Giulia", "John", "Emily"];
const LAST = ["García", "Rodríguez", "Martínez", "López", "Fernández", "Pérez", "Gómez", "Sánchez", "Díaz", "Torres",
  "Ramírez", "Flores", "Rojas", "Vargas", "Castro", "Silva", "Morales", "Ortiz", "Navarro", "Herrera", "Medina",
  "Quispe", "Mendoza", "Rossi", "Müller", "Dubois", "Smith", "Costa", "Almeida", "Fuentes"];
const COUNTRIES = [["PE", "Perú", 18], ["CL", "Chile", 16], ["BR", "Brasil", 12], ["CO", "Colombia", 10], ["ES", "España", 9],
  ["AR", "Argentina", 8], ["US", "Estados Unidos", 7], ["MX", "México", 5], ["DE", "Alemania", 4], ["FR", "Francia", 4],
  ["IT", "Italia", 3], ["EC", "Ecuador", 4]];
const ENTITIES = [["Andes Travel SAC", "Agencia", 18], ["Online Travel Demo", "Agencia", 22], ["Huésped Directo", "Individuales", 15],
  ["Corporación Minera Sur", "Empresa", 10], ["Turismo Pacífico Demo", "Agencia", 12], ["Congresos Lima Demo", "Grupo", 8],
  ["Viajes Altiplano EIRL", "Agencia", 8], ["Consultora Norte SAC", "Empresa", 7]];
const weighted = (list) => {
  const total = list.reduce((t, x) => t + x[x.length - 1], 0);
  let r = rnd() * total;
  for (const x of list) if ((r -= x[x.length - 1]) <= 0) return x;
  return list[0];
};
const ROOM_TYPES = [["Classic King", "NK2", 22, 64], ["Classic Twin", "NT2", 18, 62], ["Suite", "SU2", 10, 120], ["Classic Triple", "NT3", 10, 78]];
const REMARKS = ["", "", "", "Cama junta", "Llegada tarde, después de las 23:00", "Agencia asume alojamiento, extras a cuenta del pax",
  "Cliente frecuente: amenities de bienvenida", "Pide habitación en piso alto", "Alérgico a frutos secos",
  "Tarjeta de garantía 4111 1111 1111 1111 (ejemplo: se guarda enmascarada)", "Factura a nombre de la empresa"];

// ------------------------------- generación -------------------------------
export function seedDemo() {
  seed = 20261109;
  const today = todayInHotel();
  const now = new Date().toISOString();
  const START = addDays(today, -12);
  const END = addDays(today, 40);

  // Habitaciones: 6 pisos x 10
  const rooms = [];
  let typeQueue = ROOM_TYPES.flatMap(([name, code, n, base]) => Array.from({ length: n }, () => ({ name, code, base })));
  typeQueue = typeQueue.sort(() => rnd() - 0.5);
  for (let floor = 2; floor <= 7; floor++)
    for (let n = 1; n <= 10; n++) {
      const t = typeQueue.pop();
      rooms.push({ id: randomUUID(), room: `${floor}${String(n).padStart(2, "0")}`, floor: String(floor), type: t.name, code: t.code, base: t.base });
    }
  const inventory = rooms.length;

  // Reservas por habitación a lo largo del tiempo (~75 % de ocupación)
  let resNo = 4100;
  const bookings = [];
  const groups = ["G-CONGRESO", "G-MINERA"];
  for (const room of rooms) {
    let d = addDays(START, -int(0, 4));
    while (d < END) {
      d = addDays(d, chance(0.55) ? 0 : int(1, 3));
      const nights = pick([1, 1, 2, 2, 2, 3, 3, 4, 5, 6]);
      const dep = addDays(d, nights);
      const [entity, clientType] = weighted(ENTITIES);
      const [countryId, country] = weighted(COUNTRIES);
      const adults = room.type === "Classic Triple" ? int(2, 3) : room.type === "Classic King" ? int(1, 2) : int(1, 2);
      const children = chance(0.08) ? 1 : 0;
      const usd = room.base + int(-6, 18);
      const group = clientType === "Grupo" ? pick(groups) : "";
      const guests = Array.from({ length: adults + children }, (_, i) => ({
        id: randomUUID(), first: pick(FIRST), last: `${pick(LAST)} ${pick(LAST)}`, child: i >= adults,
        age: i >= adults ? int(4, 12) : int(22, 70), gender: pick(["Masculino", "Femenino"]),
      }));
      bookings.push({
        id: randomUUID(), lineId: randomUUID(), accountId: randomUUID(), no: `${++resNo}/${today.slice(0, 4)}`,
        voucher: `V${int(100000, 999999)}`, room, arrival: d, departure: dep, nights, adults, children,
        entity, clientType: clientType === "Individuales" ? "Individuales" : clientType === "Grupo" ? "Grupo" : "Individuales",
        isGroup: clientType === "Grupo", group, country, countryId, usd, guests,
        remarks: pick(REMARKS), createdOn: addDays(d, -int(3, 90)),
      });
      d = dep;
    }
  }

  // Estados relativos a hoy
  for (const b of bookings) {
    if (b.departure < today) b.state = 606;
    else if (b.departure === today) b.state = chance(0.55) ? 606 : 602; // salieron / pendientes de salir
    else if (b.arrival < today) b.state = 602;
    else if (b.arrival === today) b.state = chance(0.3) ? 602 : 601; // algunos ya llegaron
    else b.state = 601;
    // Reservas futuras: muchas aún sin habitación asignada
    b.assigned = b.state !== 601 || b.arrival === today || chance(0.35);
  }
  // Un par de días de sobreventa: reservas extra sin habitación
  for (const off of [3, 4, 11]) {
    for (let i = 0; i < 4; i++) {
      const room = pick(rooms);
      const [entity] = weighted(ENTITIES);
      const [countryId, country] = weighted(COUNTRIES);
      const d = addDays(today, off);
      bookings.push({
        id: randomUUID(), lineId: randomUUID(), accountId: randomUUID(), no: `${++resNo}/${today.slice(0, 4)}`,
        voucher: `V${int(100000, 999999)}`, room, arrival: d, departure: addDays(d, 2), nights: 2, adults: 2, children: 0,
        entity, clientType: "Individuales", isGroup: false, group: "", country, countryId, usd: room.base + 10,
        guests: [{ id: randomUUID(), first: pick(FIRST), last: `${pick(LAST)} ${pick(LAST)}`, child: false, age: 40, gender: "Femenino" }],
        remarks: "Reserva de última hora", createdOn: addDays(today, -1), state: 601, assigned: false, overbooked: true,
      });
    }
  }

  const covers = (b, d) => b.arrival <= d && d < b.departure;
  const inHouse = bookings.filter((b) => b.state === 602);
  const tonight = bookings.filter((b) => covers(b, today));

  // Estado de limpieza de cada habitación
  const roomState = new Map();
  for (const r of rooms) {
    const cur = inHouse.find((b) => b.room === r);
    const leftToday = bookings.find((b) => b.room === r && b.departure === today && b.state === 606);
    const arrivingToday = bookings.find((b) => b.room === r && b.arrival === today && b.state === 601);
    let occ = "Libre";
    if (cur && cur.departure === today) occ = arrivingToday ? "Salida Prevista / Entrada Prevista" : "Salida Prevista";
    else if (cur) occ = cur.arrival === today ? "Ocupado" : "Estancia";
    else if (leftToday) occ = arrivingToday ? "Entrada Prevista" : "En Check-Out";
    else if (arrivingToday) occ = "Entrada Prevista";
    let status = 664;
    if (leftToday || (cur && cur.arrival < today && chance(0.6))) status = 661;
    if (status === 661 && chance(0.08)) status = 662;
    if (status === 664 && chance(0.04)) status = 663;
    roomState.set(r.id, { status, occ, guest: cur ? `${cur.guests[0].last}, ${cur.guests[0].first}` : "" });
  }
  const ooo = rooms.filter((r) => roomState.get(r.id).occ === "Libre").slice(0, 2);
  const statusDesc = { 661: "Sucio", 662: "Limpiando", 663: "Verificar", 664: "Limpia" };

  // Cuentas de huéspedes en casa (cargos, extras y pagos)
  const SERVICES_EXTRA = [["Restaurante Alimentos", "Restaurante", 25, 120, "extra 1"], ["Bar Bebidas", "Bar", 12, 60, "extra 1"],
    ["Lavandería", "Lavandería", 18, 70, "extra 3"], ["Minibar", "Minibar", 8, 35, "extra 2"]];
  const PAYMENTS = ["Efectivo (PEN)", "Visa POS", "Mastercard POS", "Transferencia"];
  const accounts = [];
  for (const b of inHouse) {
    const nightsElapsed = Math.max(1, diff(b.arrival, today) + (b.departure === today ? 0 : 0));
    const agencyPays = !["Huésped Directo"].includes(b.entity) && chance(0.6);
    const movements = [];
    for (let i = 0; i < nightsElapsed; i++) {
      const d = addDays(b.arrival, i);
      const total = r2(b.usd * 3.75);
      movements.push({ id: randomUUID(), date: d, time: "06:30", service: "Alojamiento", description: "Alojamiento/Alojamiento",
        folder: "master", invoiceTo: agencyPays ? "Entidad" : "Cliente", units: 1, total, payment: null });
    }
    const nExtras = chance(0.55) ? int(1, 4) : 0;
    for (let i = 0; i < nExtras; i++) {
      const [service, dept, a, z, folder] = pick(SERVICES_EXTRA);
      const d = addDays(b.arrival, int(0, Math.max(0, nightsElapsed - 1)));
      movements.push({ id: randomUUID(), date: d, time: `${int(8, 22)}:${pick(["05", "20", "35", "50"])}`, service,
        description: `${dept}/${service} - ${int(1000, 9999)}`, folder, invoiceTo: "Cliente", units: int(1, 3), total: r2(int(a, z) + rnd()), payment: null });
    }
    const charges = movements.reduce((t, m) => t + m.total, 0);
    if (!agencyPays && chance(0.5)) {
      const paid = chance(0.4) ? r2(charges + b.usd * 3.75 * (b.nights - nightsElapsed)) : r2(charges * pick([0.5, 1]));
      movements.push({ id: randomUUID(), date: b.arrival, time: "15:10", service: "", description: "", folder: "master",
        invoiceTo: "Cliente", units: null, total: -paid, payment: pick(PAYMENTS) });
    }
    const folderSum = (f) => r2(movements.filter((m) => m.folder === f).reduce((t, m) => t + m.total, 0));
    const total = r2(movements.reduce((t, m) => t + m.total, 0));
    accounts.push({ b, movements, total, folders: { master: folderSum("master"), e1: folderSum("extra 1"), e2: folderSum("extra 2"), e3: folderSum("extra 3") } });
  }

  // ------------------------------- escribir -------------------------------
  tx(() => {
    for (const t of ["guests", "occupancy", "forecast", "widgets", "panel", "accounts", "accountMovements", "rooms",
      "reservations", "dailyStats", "syncRuns", "sessions"])
      db.prepare(`DELETE FROM ${t}`).run();
    db.prepare("DELETE FROM settings WHERE key = 'token'").run();
    setSetting("demoHotelName", DEMO_HOTEL);

    // Usuario demo (local)
    db.prepare(
      `INSERT INTO users(email, name, source, role, passwordHash, createdAt) VALUES(?,?,?,?,?,?)
       ON CONFLICT(email) DO UPDATE SET passwordHash = excluded.passwordHash, disabled = 0`
    ).run(DEMO_USER.email, "Recepción (demo)", "local", "admin", hashPassword(DEMO_USER.password), now);

    // Huéspedes (en casa + salidos hoy)
    const insG = db.prepare(`INSERT INTO guests (id, occupationLine, reservation, roomNumber, roomType, arrival, departure,
      firstName, lastName, fullName, countryId, country, entity, clientType, groupName, rateAmount, rateCurrency, rateText,
      pension, guestType, age, gender, adults, children, babies, isHolder, state, email, phone, raw, inHouse, firstSeenAt,
      lastSeenAt, checkedOutAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const b of bookings.filter((x) => x.state === 602 || (x.state === 606 && x.departure === today))) {
      b.guests.forEach((g, i) => {
        insG.run(g.id, b.lineId, b.no, b.room.room, b.room.type, b.arrival, b.departure, g.first, g.last,
          `${g.last.toUpperCase()}, ${g.first.toUpperCase()}`, b.countryId, b.country, b.entity, b.clientType, b.group,
          b.usd, "USD", `${b.usd.toFixed(2)} USD`, "AD", g.child ? "Niño" : "Adulto", g.age, g.gender, b.adults, b.children,
          0, i === 0 ? 1 : 0, b.state === 602 ? "Check-In" : "Check-Out", null, null,
          JSON.stringify({ demo: true, passportDoc: `DEMO${int(100000, 999999)}`, checkinUser: "recepcion@demo.local" }),
          b.state === 602 ? 1 : 0, now, now, b.state === 606 ? now : null);
      });
    }

    // Ocupación de hoy
    const arrToday = bookings.filter((b) => b.arrival === today);
    const depToday = bookings.filter((b) => b.departure === today);
    const occRooms = tonight.length;
    const clean = rooms.filter((r) => roomState.get(r.id).status === 664).length;
    const adr = r2(tonight.reduce((t, b) => t + b.usd * 3.75, 0) / Math.max(1, occRooms));
    const occRaw = { inactive: ooo.length, lunches: 0, dinners: 0, occupancyInventoryPercent: (occRooms / inventory) * 100, demo: true };
    db.prepare(`INSERT INTO occupancy (date, inventory, roomsAvailable, roomsOccupied, roomsVacant, occupancyPercent,
      arrivalsTotal, arrivalsDone, arrivalsPending, departuresTotal, departuresDone, departuresPending, adults, children,
      breakfasts, currency, adr, revpar, revenueRoom, cleanRooms, dirtyRooms, raw, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      today, inventory, inventory, occRooms, inventory - occRooms, (occRooms / inventory) * 100,
      arrToday.length, arrToday.filter((b) => b.state === 602).length, arrToday.filter((b) => b.state === 601).length,
      depToday.length, depToday.filter((b) => b.state === 606).length, depToday.filter((b) => b.state === 602).length,
      tonight.reduce((t, b) => t + b.adults, 0), tonight.reduce((t, b) => t + b.children, 0),
      tonight.reduce((t, b) => t + b.adults + b.children, 0), "PEN", adr, r2((adr * occRooms) / inventory),
      r2(adr * occRooms), clean, inventory - clean, JSON.stringify(occRaw), now);

    // Previsión 31 días
    const insF = db.prepare("INSERT INTO forecast (date, arrivals, departures, stayovers, dayUse, updatedAt) VALUES (?,?,?,?,0,?)");
    for (let i = 0; i < 31; i++) {
      const d = addDays(today, i);
      insF.run(d, bookings.filter((b) => b.arrival === d).length, bookings.filter((b) => b.departure === d).length,
        bookings.filter((b) => b.arrival < d && d < b.departure).length, now);
    }

    // Widgets del sumario
    const w = db.prepare("INSERT INTO widgets (key, date, data, updatedAt) VALUES (?,?,?,?)");
    w.run("bookingsroomtype", today, JSON.stringify(ROOM_TYPES.map(([name]) => {
      const total = rooms.filter((r) => r.type === name).length;
      const occupied = tonight.filter((b) => b.room.type === name).length;
      return { roomTypeName: name, totalRooms: total, totalBookings: occupied, vacants: total - occupied };
    })), now);
    w.run("bookingtypepercentage", today, JSON.stringify(Array.from({ length: 8 }, (_, i) => {
      const d = addDays(today, i);
      const on = bookings.filter((b) => covers(b, d));
      const grp = on.filter((b) => b.isGroup).length;
      const pct = (n) => r2((n / inventory) * 100);
      return { date: iso(d), occupancy: pct(on.length), occupancyIndividualBookings: pct(on.length - grp),
        occupancyGroupBookings: pct(grp), occupancyCompanyBookings: pct(on.length) };
    })), now);
    const nightsByCountry = new Map();
    for (const b of bookings.filter((x) => x.arrival >= addDays(today, -30) && x.arrival <= today))
      nightsByCountry.set(b.country, (nightsByCountry.get(b.country) || 0) + b.nights * (b.adults + b.children));
    const top = [...nightsByCountry.entries()].sort((a, z) => z[1] - a[1]);
    w.run("topnationalities", today, JSON.stringify([...top.slice(0, 4).map(([x, y]) => ({ x, y })),
      { x: "Otros", y: top.slice(4).reduce((t, [, y]) => t + y, 0) }]), now);
    const rsCount = (s) => rooms.filter((r) => roomState.get(r.id).status === s).length;
    w.run("roomstatus-totals", today, JSON.stringify({ clean: rsCount(664), dirty: rsCount(661), verify: rsCount(663),
      cleaning: rsCount(662), totalRooms: inventory }), now);

    // Planning (formato compacto)
    const pStart = addDays(today, -2);
    const pDates = Array.from({ length: 24 }, (_, i) => addDays(pStart, i));
    const stateDesc = { 601: "Reservada", 602: "Check-In", 606: "Check-Out" };
    const pb = (b) => ({ id: b.id, no: b.no, name: `${b.guests[0].last.toUpperCase()}, ${b.guests[0].first.toUpperCase()}`,
      company: b.entity, from: b.arrival, to: b.departure, arrival: b.arrival, departure: b.departure, state: b.state,
      stateDesc: stateDesc[b.state], nights: b.nights, paxs: `${b.adults}-${b.children}-0`, group: b.group,
      overbooked: !!b.overbooked, pending: false, roomType: b.room.code });
    w.run("roomplanning", today, JSON.stringify({
      workDate: today, from: pStart, to: pDates.at(-1), dates: pDates,
      availability: pDates.map((d) => ({ date: d, available: inventory - bookings.filter((b) => covers(b, d)).length,
        occupancy: r2((bookings.filter((b) => covers(b, d)).length / inventory) * 100) })),
      statuses: [{ key: 661, value: "Sucio" }, { key: 662, value: "En Limpieza" }, { key: 663, value: "Verificar" }, { key: 664, value: "Limpio" }],
      rooms: rooms.map((r) => ({ id: r.id, room: r.room, type: r.type, status: statusDesc[roomState.get(r.id).status],
        statusId: roomState.get(r.id).status, inactive: ooo.includes(r),
        bookings: bookings.filter((b) => b.room === r && b.assigned && b.departure > pStart && b.arrival < pDates.at(-1)).map(pb) })),
      unassigned: bookings.filter((b) => !b.assigned && b.arrival >= today).sort((a, z) => a.arrival.localeCompare(z.arrival))
        .map((b) => ({ id: b.id, no: b.no, name: `${b.guests[0].last.toUpperCase()}, ${b.guests[0].first.toUpperCase()}`,
          company: b.entity, arrival: b.arrival, departure: b.departure, nights: b.nights, paxs: `${b.adults} ${b.children} 0`,
          roomType: b.room.code, state: 601, group: b.group })),
    }), now);

    // Panel interactivo del día
    const insP = db.prepare(`INSERT INTO panel (kind, id, reservation, guest, room, roomTypeReserved, roomTypeOccupied, state,
      arrivalAt, departureAt, accountId, entity, groupName, paxs, pendingInvoice, totalExtras, raw, active, firstSeenAt, lastSeenAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
    const holder = (b) => `${b.guests[0].last.toUpperCase()}, ${b.guests[0].first.toUpperCase()}`;
    const accByBooking = new Map(accounts.map((a) => [a.b, a]));
    for (const b of arrToday.filter((x) => x.state === 601))
      insP.run("arrival", b.lineId, b.no, holder(b), b.room.room, b.room.type, b.room.type, "Reservada", iso(b.arrival, "15:00"),
        iso(b.departure, "12:00"), b.accountId, b.entity, b.group, `${b.adults} ${b.children} 0`, null, null, "{}", now, now);
    for (const b of depToday.filter((x) => x.state === 602)) {
      const a = accByBooking.get(b);
      const extras = a ? r2(a.folders.e1 + a.folders.e2 + a.folders.e3) : 0;
      insP.run("departure", b.lineId, b.no, holder(b), b.room.room, b.room.type, b.room.type, "Check-In", iso(b.arrival, "15:00"),
        iso(b.departure, "12:00"), b.accountId, b.entity, b.group, `${b.adults} ${b.children} 0`, a && a.total > 0 ? 1 : 0,
        extras || null, "{}", now, now);
    }
    for (const b of inHouse)
      insP.run("inhouse", b.lineId, b.no, holder(b), b.room.room, b.room.type, b.room.type, "Check-In", iso(b.arrival, "15:00"),
        iso(b.departure, "12:00"), b.accountId, b.entity, b.group, `${b.adults} ${b.children} 0`, null, null, "{}", now, now);

    // Cuentas corrientes
    const insA = db.prepare(`INSERT INTO accounts (accountId, occupationLineId, reservation, room, roomType, arrival, departure,
      term, paxs, company, groupName, holder, guest, remarks, masterAmount, extra1Amount, extra2Amount, extra3Amount,
      extra4Amount, extra5Amount, totalAmount, totalInvoiced, pendingInvoices, raw, active, firstSeenAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,1,?,?)`);
    const insM = db.prepare(`INSERT INTO accountMovements (id, accountId, date, time, registrationDate, service, description,
      folder, invoiceTo, units, net, tax, gross, total, paymentType, currency, raw, active, firstSeenAt, lastSeenAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
    for (const a of accounts) {
      const b = a.b;
      insA.run(b.accountId, b.lineId, b.no, b.room.room, b.room.type, b.arrival, b.departure, "AD", `${b.adults} ${b.children} 0`,
        b.entity, b.group, holder(b), holder(b), maskDemo(b.remarks), a.folders.master, a.folders.e1, a.folders.e2, a.folders.e3,
        a.total, 0, Math.max(0, a.total), "{}", now, now);
      for (const m of a.movements)
        insM.run(m.id, b.accountId, m.date, m.time, `${m.date}T${m.time}:00Z`, m.service, m.description, m.folder, m.invoiceTo,
          m.units, m.payment ? null : r2(m.total / 1.18), m.payment ? null : r2(m.total - m.total / 1.18), m.total, m.total,
          m.payment, "PEN", "{}", now, now);
    }

    // Habitaciones
    const insR = db.prepare(`INSERT INTO rooms (id, room, floor, roomType, status, statusDescription, occupancyStatus,
      maintenanceStatus, outOfOrder, inactivityType, inactivityStart, inactivityEnd, malfunction, mainGuest, attentions, raw, updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rooms) {
      const s = roomState.get(r.id);
      const out = ooo.includes(r);
      insR.run(r.id, r.room, r.floor, r.type, s.status, statusDesc[s.status], s.occ, null, out ? 1 : 0,
        out ? "Mantenimiento" : null, out ? today : null, out ? addDays(today, 2) : null,
        out ? pick(["Fuga en el baño", "Aire acondicionado sin funcionar"]) : null, s.guest || null, null, "{}", now);
    }

    // Reservas por llegar (hoy + 6 días)
    const insRes = db.prepare(`INSERT INTO reservations (id, reservation, guest, arrival, departure, arrivalTime, nights,
      adults, children, babies, roomTypeReserved, roomTypeOccupied, room, pension, priceRate, company, agency, segment,
      groupName, voucher, country, balance, depositRequired, confirmation, comments, accountId, raw, active, firstSeenAt, lastSeenAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);
    for (const b of bookings.filter((x) => x.state === 601 && x.arrival >= today && x.arrival <= addDays(today, 6)))
      insRes.run(b.lineId, b.no, holder(b), b.arrival, b.departure, pick(["14:00", "15:00", "15:00", "18:00", "22:30"]),
        b.nights, b.adults, b.children, 0, b.room.type, b.room.type, b.assigned ? b.room.room : null, "AD",
        `${b.usd.toFixed(2)} USD`, b.entity, null, pick(["FIT", "Corporativo", "Online", "Grupos"]), b.group, b.voucher,
        b.country, 0, chance(0.15) ? 1 : 0, pick(["Confirmado", "Confirmado", "Pendiente"]), maskDemo(b.remarks) || null,
        b.accountId, "{}", now, now);

    // Histórico de ocupación (últimos 14 días) y sincronizaciones de ejemplo
    const insD = db.prepare("INSERT INTO dailyStats (date, guests, rooms, adults, children, avgRate, updatedAt) VALUES (?,?,?,?,?,?,?)");
    for (let i = -13; i <= 0; i++) {
      const d = addDays(today, i);
      const on = bookings.filter((b) => covers(b, d));
      insD.run(d, on.reduce((t, b) => t + b.adults + b.children, 0), on.length, on.reduce((t, b) => t + b.adults, 0),
        on.reduce((t, b) => t + b.children, 0), r2(on.reduce((t, b) => t + b.usd, 0) / Math.max(1, on.length)), now);
    }
    const insS = db.prepare("INSERT INTO syncRuns (module, startedAt, finishedAt, status, fetched) VALUES (?,?,?,?,?)");
    for (const m of ["guests", "dashboard", "panel", "accounts", "operations"]) insS.run(m, now, now, "ok", 0);
  });

  return { today, rooms: inventory, bookings: bookings.length, inHouse: inHouse.length, accounts: accounts.length };
}

// Enmascarado (los comentarios de ejemplo incluyen una tarjeta de prueba)
import { maskPan } from "./pci.js";
const maskDemo = (s) => maskPan(s || "");

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = seedDemo();
  console.log(`Datos de prueba generados para ${DEMO_HOTEL} (${r.today}):`, r);
  console.log(`Usuario demo: ${DEMO_USER.email} / ${DEMO_USER.password}`);
}
