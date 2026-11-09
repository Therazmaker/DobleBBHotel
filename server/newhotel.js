// Cliente de la API de NewHotel.
// - Envía el token Bearer guardado en settings (o NEWHOTEL_TOKEN).
// - Cada respuesta trae un token renovado en la cabecera Authorization: lo guardamos,
//   así la sesión se mantiene viva mientras la sincronización siga corriendo.
import { getSetting, setSetting } from "./db.js";

export const BASE_URL =
  process.env.NEWHOTEL_BASE_URL || "https://api-am.newhotelcloud.com/html5-api-am/api";

export class NewHotelError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function getToken() {
  return getSetting("token") || process.env.NEWHOTEL_TOKEN || null;
}

export function saveToken(token) {
  const clean = token.trim().replace(/^Bearer\s+/i, "");
  setSetting("token", clean);
  return clean;
}

/** Decodifica el JWT (sin verificar firma) para mostrar hotel, usuario y caducidad. */
export function tokenInfo(token = getToken()) {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return {
      hotelId: payload.app_hotel_id,
      hotelName: payload.app_hotelname,
      city: payload.app_hotelcity,
      country: payload.app_hotelcountry,
      userName: payload.app_username,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

// ---------- Login automático (2 pasos, igual que la web) ----------
// 1) POST auth/html {userEmail, password}            -> content.token (token de usuario, sin hotel)
// 2) POST getcontext/{app} {applicationId, hotelId…} -> content.context.token (token del hotel)
// Credenciales SOLO por variables de entorno (en Convex: variables de entorno del deployment).
const APP_ID = Number(process.env.NEWHOTEL_APP_ID || 101); // NewHotel Cloud PMS
const LANGUAGE_ID = Number(process.env.NEWHOTEL_LANGUAGE_ID || 3082); // español

export const canAutoLogin = () =>
  Boolean(process.env.NEWHOTEL_EMAIL && process.env.NEWHOTEL_PASSWORD);

let loggingIn = null;
export function login() {
  if (!loggingIn) loggingIn = doLogin().finally(() => (loggingIn = null));
  return loggingIn;
}

async function rawPost(path, payload, token) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/${path}`, { method: "POST", headers, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body.code && body.code !== 200)) {
    const why = body?.content?.errors?.[0]?.message || body?.content?.errors?.[0] || `HTTP ${res.status}`;
    throw new NewHotelError(`Login NewHotel falló en ${path}: ${typeof why === "string" ? why : JSON.stringify(why)}`, res.status);
  }
  return body;
}

async function doLogin() {
  if (!canAutoLogin()) throw new NewHotelError("Sin credenciales (NEWHOTEL_EMAIL / NEWHOTEL_PASSWORD).", 401);
  const step1 = await rawPost("auth/html", {
    userEmail: process.env.NEWHOTEL_EMAIL,
    password: process.env.NEWHOTEL_PASSWORD,
  });
  const c1 = step1.content || {};
  if (c1.twoFactorRequired) throw new NewHotelError("El usuario tiene 2FA: el login automático no es posible.", 401);
  if (!c1.token) throw new NewHotelError("auth/html no devolvió token.", 401);

  const hotels = Object.values(c1.hotels || {}).flat();
  const hotelId =
    process.env.NEWHOTEL_HOTEL_ID || tokenInfo()?.hotelId || hotels.find((h) => !h.disabled)?.id;
  if (!hotelId) throw new NewHotelError("No se pudo determinar el hotel (NEWHOTEL_HOTEL_ID).", 400);

  const step2 = await rawPost(
    `getcontext/${APP_ID}`,
    { applicationId: APP_ID, hotelId, languageId: LANGUAGE_ID, logOperation: true },
    c1.token
  );
  const token = step2.content?.context?.token || step2.content?.token;
  if (!token) throw new NewHotelError("getcontext no devolvió token.", 401);
  return saveToken(token);
}

/** Si el token caduca en menos de 5 min (o no hay) y hay credenciales, inicia sesión. */
export async function ensureFreshToken() {
  if (!canAutoLogin()) return;
  const exp = tokenInfo()?.expiresAt;
  if (!getToken() || !exp || new Date(exp) - Date.now() < 5 * 60_000) await login();
}

export const get = (path) => request("GET", path);
export const post = (path, payload) => request("POST", path, payload);

async function request(method, path, payload, retried = false) {
  const token = getToken();
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : JSON.stringify(payload),
  });

  const renewed = res.headers.get("authorization");
  if (renewed && /^Bearer\s+\S+\.\S+\.\S+/i.test(renewed)) saveToken(renewed);

  if ((res.status === 401 || res.status === 403) && !retried && canAutoLogin()) {
    await login();
    return request(method, path, payload, true);
  }
  if (res.status === 401 || res.status === 403) {
    throw new NewHotelError("Token inválido o caducado. Pega uno nuevo en Sincronización.", res.status);
  }
  if (!res.ok) throw new NewHotelError(`NewHotel respondió HTTP ${res.status}`, res.status);

  const body = await res.json();
  if (body.code && body.code !== 200) {
    throw new NewHotelError(`NewHotel devolvió code ${body.code}`, body.code);
  }
  return body;
}

/** Pide todas las páginas hasta recibir una incompleta. */
export async function fetchAll(path, payload, pageSize = 200, maxPages = 50) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await post(path, { ...payload, page, pageSize });
    const data = body?.content?.data ?? [];
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

// Payload capturado de la web: huéspedes con estado 602 (Check-In = en casa).
export const IN_HOUSE_GUESTS_PAYLOAD = {
  sortColumn: null,
  sortDirection: 1,
  allowMarketing: null,
  arrivalGuestComparator: 2221,
  arrivalGuestDateFrom: null,
  arrivalReservationComparator: 2221,
  arrivalReservationDateFrom: null,
  clientType: null,
  companyDescription: null,
  companyId: null,
  contractId: null,
  currentAccountId: null,
  departureGuestComparator: 2221,
  departureGuestDateFrom: null,
  departureReservationComparator: 2221,
  departureReservationDateFrom: null,
  description: null,
  emailAddress: null,
  firstName: null,
  fiscalNumber: null,
  gender: null,
  groupDescription: null,
  groupName: null,
  guestCountry: null,
  guestRegion: null,
  guestRegisterNumber: null,
  guestStatus: 602,
  hasTotal: false,
  isHolder: false,
  isOccupancy: false,
  lastName: null,
  loyaltyCard: null,
  loyaltyCardTypeId: null,
  number: null,
  occupationLineId: null,
  operationSegmentId: null,
  regionId: null,
  reservationStatus: null,
  roomId: null,
  serie: null,
  voucher: null,
};
