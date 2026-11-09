import { staticApi } from "./static-api.js";
async function req(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/login")) window.dispatchEvent(new Event("auth-required"));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  publicConfig: () => fetch("/api/public-config").then((r) => r.json()).catch(() => ({})),
  me: () => req("/api/me"),
  login: (email, password) => req("/api/login", { method: "POST", body: { email, password } }),
  logout: () => req("/api/logout", { method: "POST" }),
  status: () => req("/api/status"),
  summary: () => req("/api/summary"),
  guests: (params) => req(`/api/guests?${new URLSearchParams(params)}`),
  guest: (id) => req(`/api/guests/${encodeURIComponent(id)}`),
  movements: (date) => req(`/api/movements?date=${date}`),
  panel: () => req("/api/panel"),
  rooms: () => req("/api/rooms"),
  reservations: (params) => req(`/api/reservations?${new URLSearchParams(params)}`),
  planning: () => req("/api/planning"),
  accounts: (params) => req(`/api/accounts?${new URLSearchParams(params)}`),
  account: (id) => req(`/api/accounts/${encodeURIComponent(id)}`),
  contingency: () => req("/api/contingency"),
  sync: () => req("/api/sync", { method: "POST" }),
  setToken: (token) => req("/api/token", { method: "POST", body: { token } }),
};

export const fmtDate = (iso, opts = { day: "2-digit", month: "short" }) =>
  iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("es-PE", { timeZone: "UTC", ...opts }) : "—";

export const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("es-PE", {
        timeZone: "America/Lima",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const SYMBOL = { USD: "US$", PEN: "S/ ", EUR: "€" };
export const fmtMoney = (n, cur = "USD") =>
  n == null ? "—" : `${SYMBOL[cur] ?? cur + " "}${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const nights = (a, d) =>
  a && d ? Math.round((new Date(d) - new Date(a)) / 86_400_000) : null;

export const shiftDate = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("es-PE", { timeZone: "UTC", hour: "2-digit", minute: "2-digit" }) : "";

// Versión estática (GitHub Pages): sin servidor, datos de demo empaquetados.
export const IS_STATIC = import.meta.env.MODE === "static";
if (IS_STATIC) Object.assign(api, staticApi);
