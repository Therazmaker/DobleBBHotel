// API de la versión estática (GitHub Pages): sin servidor. Lee los JSON exportados de la demo
// (datos inventados) y aplica en el navegador los mismos filtros que haría el servidor.
const BASE = `${import.meta.env.BASE_URL}demo-data/`;
const cache = new Map();
const load = (name) => {
  if (!cache.has(name)) cache.set(name, fetch(`${BASE}${name}.json`).then((r) => {
    if (!r.ok) throw new Error(`No se pudo cargar ${name}`);
    return r.json();
  }));
  return cache.get(name);
};
const like = (q, ...vals) => {
  const s = q.toLowerCase();
  return vals.some((v) => (v || "").toString().toLowerCase().includes(s));
};
const roomNum = (r) => Number.parseInt(r, 10) || 0;

const DEMO_USER = { email: "demo@demo.local", name: "Recepción (demo)", mode: "local", source: "local", role: "admin" };

export const staticApi = {
  publicConfig: async () => ({ demo: true, static: true, demoUser: { email: DEMO_USER.email, password: "demo-recepcion" } }),
  me: async () => DEMO_USER,
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
  status: () => load("status"),
  summary: () => load("summary"),
  panel: () => load("panel"),
  contingency: () => load("contingency"),
  rooms: () => load("rooms"),
  planning: () => load("planning"),
  sync: async () => ({ ok: false, error: "Versión estática de la demo: no hay servidor ni conexión con NewHotel." }),
  setToken: async () => {
    throw new Error("Versión estática de la demo: no se puede cambiar el token.");
  },

  async guests({ q = "", country = "", entity = "", status = "inhouse", sort = "room" } = {}) {
    const all = await load("guests");
    const byStatus = all.filter((g) => status === "all" || (status === "departed" ? !g.inHouse : g.inHouse));
    let rows = byStatus.filter((g) => (!country || g.country === country) && (!entity || g.entity === entity) &&
      (!q || like(q, g.fullName, g.roomNumber, g.reservation, g.entity, g.groupName)));
    const sorters = {
      room: (a, b) => roomNum(a.roomNumber) - roomNum(b.roomNumber) || (a.fullName || "").localeCompare(b.fullName || ""),
      name: (a, b) => (a.lastName || "").localeCompare(b.lastName || ""),
      arrival: (a, b) => (b.arrival || "").localeCompare(a.arrival || "") || roomNum(a.roomNumber) - roomNum(b.roomNumber),
      departure: (a, b) => (a.departure || "").localeCompare(b.departure || "") || roomNum(a.roomNumber) - roomNum(b.roomNumber),
    };
    rows = [...rows].sort(sorters[sort] || sorters.room);
    const facet = (col) => {
      const m = new Map();
      for (const g of byStatus) if (g[col]) m.set(g[col], (m.get(g[col]) || 0) + 1);
      return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    };
    return { rows, facets: { country: facet("country"), entity: facet("entity") } };
  },
  guest: async (id) => (await load("guest-detail"))[id] || Promise.reject(new Error("No encontrado")),

  async movements(date) {
    const all = await load("movements");
    return all[date] || { date, arrivals: [], departures: [], pms: null };
  },

  async accounts({ q = "", balance = "" } = {}) {
    const data = await load("accounts");
    const rows = data.rows.filter((a) => (balance !== "1" || Math.abs(a.totalAmount) > 0.005) &&
      (!q || like(q, a.guest, a.holder, a.room, a.reservation, a.company)));
    return { ...data, rows };
  },
  account: async (id) => (await load("account-detail"))[id] || Promise.reject(new Error("Cuenta no encontrada")),

  async reservations({ date = "", q = "" } = {}) {
    const data = await load("reservations");
    const rows = data.rows.filter((r) => (!/^\d{4}-\d{2}-\d{2}$/.test(date) || r.arrival === date) &&
      (!q || like(q, r.guest, r.reservation, r.company, r.voucher, r.groupName)));
    return { rows: /^\d{4}-\d{2}-\d{2}$/.test(date) || q ? rows : [], byDay: data.byDay };
  },
};
