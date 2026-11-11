# Respaldo PMS · Panel de contingencia del hotel (PWA)

PWA propia que sincroniza datos de NewHotel Cloud PMS en una base de datos propia
y los muestra en un panel instalable (móvil y escritorio).

**Estado:** prototipo local. Backend Node + SQLite. La capa de datos tiene la misma
forma que tendrá en Convex.

## Probar la demo (datos inventados, sin NewHotel)

Requiere Node.js 22.12 o superior.

```bash
npm install
```

```bash
npm run demo
```

Abre http://localhost:3000 y entra con el usuario de prueba que aparece en la pantalla de login
(`demo@demo.local` / `demo-recepcion`).

El modo demo (`DEMO=1`) genera un hotel ficticio de 60 habitaciones: reservas, huéspedes, cuentas con cargos
y pagos, estado de habitaciones, planning y previsión, todo relativo a la fecha de hoy. No hace ninguna llamada
a NewHotel. Para regenerar los datos: `npm run seed`. Los datos se regeneran solos si cambia el día.

### Demo en GitHub Pages (versión estática)

`npm run build:static` genera en `dist-static/` una versión **sin servidor**: la misma app con los datos
inventados de la demo empaquetados en JSON y filtrados en el navegador. No incluye nada de la integración
con NewHotel ni datos reales.

El workflow `.github/workflows/pages.yml` la publica en GitHub Pages en cada push a `main` y una vez al día
(para que las fechas de la demo sean las de hoy). Para activarlo: **Settings → Pages → Source: GitHub Actions**.
En repos privados, GitHub Pages requiere un plan de pago, y el sitio publicado es público.

## Qué incluye

| Pantalla | Contenido |
|---|---|
| **Sumario** (misma distribución que el Sumario del PMS) | Check-In / Check-Out con progreso, ocupación, llegadas y salidas 7 días, % ocupación por tipo de reserva, ocupación por tipo de habitación, top nacionalidades, columna lateral con fecha de trabajo y cifras del día; debajo, previsión de 31 días y análisis de huéspedes en casa. |
| **Resumen (anterior)** | Huéspedes en casa, habitaciones ocupadas, llegadas y salidas de hoy, tarifa media, nacionalidades; salidas de los próximos 7 días; llegadas recientes; top de países, agencias y tipo de habitación (toca para filtrar). |
| **Huéspedes** | Lista con búsqueda (nombre, habitación, reserva, agencia), filtros por país y agencia, estado (en casa / salieron / todos), orden y ficha completa del huésped. |
| **Movimientos** | Llegadas y salidas de cualquier día, con estado pendiente / salió. |
| **Sincronización** | Estado del token, sincronizar ahora, pegar un token nuevo, historial de sincronizaciones. |

Fuentes de NewHotel que se sincronizan:

| Endpoint | Método | Tabla | Qué aporta |
|---|---|---|---|
| `guests/search` (`guestStatus: 602`) | POST | `guests` | Huéspedes en casa, con nombre |
| `dashboardpms/currentoccupancy` | GET | `occupancy` (1 fila/día) | Ocupación %, inventario (140), llegadas y salidas hechas/pendientes, ADR, RevPAR, habitaciones limpias |
| `dashboardpms/bookinginout` | GET | `forecast` (31 días) | Llegadas, salidas y estancias por día; ocupación prevista = (llegadas + estancias) / inventario |
| `dashboardpms/bookingsroomtype` | GET | `widgets` | Ocupación por tipo de habitación |
| `dashboardpms/bookingtypepercentage` | GET | `widgets` | % ocupación total / individuales / grupos, 8 días ("Entidades" = Total) |
| `dashboardpms/topnationalities` | GET | `widgets` | Top 4 de noches por nacionalidad del último mes |
| `interactivepanel/arrivals` | POST `{}` | `panel` (kind=arrival) | Llegadas pendientes del día de trabajo, con nombre, habitación asignada, tipo, agencia, `accountId` |
| `interactivepanel/departures` | POST `{}` | `panel` (kind=departure) | Salidas pendientes, con extras y si falta factura |
| `interactivepanel/guests` | POST `{}` | `panel` (kind=inhouse) | Habitaciones en casa (una línea por ocupación) |
| `reservations/account/search` (`reservationState: 602`) | POST | `accounts` | Cuentas corrientes de huéspedes en casa |
| `currentaccounts/currentaccountproperties?currentAccountId=` | GET | `accounts` | Saldo por carpeta (Master, Extra 1-5), total, facturado, pendiente, observaciones |
| `currentaccounts/search` | POST | `accountMovements` | Cargos y pagos de cada cuenta (solo cuentas con importe; pagos = importe negativo + medio de pago) |
| `reservations/search` (`reservationState: 601`, un día por llamada) | POST | `reservations` | Llegadas previstas con nombre de los próximos `RESERVATIONS_DAYS` días (7). Clave = id de línea: un grupo tiene varias |
| `roomplanning/calendar` | POST | `widgets` (`roomplanning`) | Planning de 24 días: habitaciones, reservas, disponibilidad y reservas sin asignar (versión compacta, ~300 KB) |
| `roomstatus/search` | POST | `rooms` + `widgets` (`roomstatus-totals`) | Estado de limpieza, ocupación, fuera de servicio y averías de cada habitación |

Los endpoints `interactivepanel/*` siempre devuelven el **día de trabajo actual** del PMS:
no aceptan fecha. En `panel`, `active = 0` + `goneAt` indica cuándo se hizo el check-in o el check-out.

### Contingencia

La pestaña **Contingencia** junta en una sola vista lo necesario para operar si NewHotel no responde:
llegadas pendientes, salidas pendientes con extras, habitaciones ocupadas con huéspedes y tarifa, y la ocupación.
Se imprime o se guarda en PDF (A4 horizontal). Avisa si la copia tiene más de 30 minutos.
Cada dispositivo con la app abierta refresca esa copia cada 5 minutos en la caché del service worker,
para poder abrirla sin conexión.

La sincronización corre cada 10 min (`SYNC_INTERVAL_MIN`):

1. Llama a `guests/search` con `guestStatus: 602` (en casa), 200 por página.
2. Hace upsert por `id`.
3. Marca como "salió" a quien ya no aparece.
4. Guarda una foto diaria en `dailyStats`.

Cada respuesta de NewHotel trae un token renovado en la cabecera `Authorization`.
Se guarda, así la sesión no caduca mientras la sincronización siga corriendo.

## Instalar en el servidor del hotel (Windows Server)

Guía paso a paso: [docs/INSTALACION-WINDOWS.md](docs/INSTALACION-WINDOWS.md). En resumen: instalar
Node.js LTS y ejecutar `scripts\windows\instalar.ps1` como administrador. Queda como tarea programada que
arranca con Windows, se reinicia si falla, sincroniza cada 10 minutos y hace una copia diaria de la base.
Hoja para recepción: [docs/CONTINGENCIA.md](docs/CONTINGENCIA.md).

## Arrancar (desarrollo)

Requiere Node ≥ 22.12 (usa el SQLite integrado).

```bash
npm install
```

```bash
npm run build
```

```bash
NEWHOTEL_TOKEN="eyJ..." npm run server
```

Abre http://localhost:3000. También puedes pegar el token desde la pantalla Sincronización.
Detrás de un proxy corporativo, añade `NODE_USE_ENV_PROXY=1`.

Para desarrollo con recarga en caliente: `npm run server` en una terminal y `npm run dev` en otra
(Vite en :5173, redirige `/api` a :3000).

| Variable | Por defecto | Para qué |
|---|---|---|
| `NEWHOTEL_TOKEN` | — | Token inicial (luego se renueva solo) |
| `NEWHOTEL_EMAIL` / `NEWHOTEL_PASSWORD` | — | Login automático (ver abajo) |
| `SYNC_INTERVAL_MIN` | `10` | Minutos entre sincronizaciones |
| `HOTEL_TZ` | `America/Lima` | Zona horaria para "hoy" |
| `PORT` | `3000` | Puerto |
| `DB_PATH` | `data/hotel.db` | Archivo SQLite |
| `AUTH_MODE` | — | `open` = sin login, entra cualquiera desde `ALLOWED_NETWORKS` |
| `ALLOWED_NETWORKS` | — | IPs/redes IPv4 (CIDR) que pueden abrir la app. En modo `open`, vacío = las redes del servidor |
| `BACKUP_DIR` / `BACKUP_KEEP_DAYS` | `data/backups` / `30` | Copia diaria de la base (`npm run backup` para una ahora) |
| `COOKIE_SECURE` | — | `1` si se sirve por HTTPS |

## Datos personales

La base de datos guarda nombres, documentos, emails y teléfonos de huéspedes.

- No subas `data/` a git (ya está en `.gitignore`).
- No publiques la app en internet. Sin login (`AUTH_MODE=open`) solo dentro de la red del hotel y
  con `ALLOWED_NETWORKS` limitado a los PCs de recepción si la wifi de huéspedes comparte red.
- El service worker cachea las últimas respuestas para uso sin conexión en el dispositivo.

### Acceso del personal

Con `AUTH_MODE=open` no hay login (instalación del hotel). Sin él, cada trabajador entra con **su usuario y contraseña de NewHotel**:

| Situación | Qué pasa |
|---|---|
| NewHotel funciona | Se valida contra NewHotel (`auth/html`). Si es correcto, se guarda una **huella scrypt** de la contraseña (nunca la contraseña). Sesión "NewHotel". |
| NewHotel caído (sin respuesta, timeout o 5xx) | Se valida contra la huella guardada. Sesión "Sin NewHotel". Solo para quien haya entrado con NewHotel funcionando en los últimos `AUTH_OFFLINE_DAYS` días (30 por defecto). |
| Contraseña incorrecta (NewHotel responde 401) | Se rechaza. |
| Usuario con doble factor en NewHotel | No puede entrar por aquí: necesita un acceso local. |

- **Antes de una caída**, cada trabajador debe entrar al menos una vez con NewHotel funcionando.
- **Accesos de emergencia** (no dependen de NewHotel): `npm run add-user -- correo@hotel.com "Nombre"`.
  La contraseña se pide por teclado (mínimo 12 caracteres).
- Sesión en cookie `HttpOnly` + `SameSite=Strict` (y `Secure` con `COOKIE_SECURE=1`), de `AUTH_SESSION_HOURS` horas (12 por defecto).
- Bloqueo de 10 minutos tras 8 intentos fallidos por usuario o por IP.
- Si cambias la contraseña en NewHotel, la huella se actualiza en el siguiente acceso con NewHotel funcionando.
  Mientras NewHotel esté caído, seguiría valiendo la contraseña anterior.
- Al cerrar sesión se borra la copia de datos guardada en el dispositivo.

### Números de tarjeta (PCI DSS)

El personal a veces escribe la tarjeta de garantía completa en las observaciones de la reserva en NewHotel.
**Esta app nunca guarda un número de tarjeta completo.** `server/pci.js` enmascara, antes de guardar,
cualquier secuencia de 13 a 19 dígitos que pase la validación de Luhn: deja solo los 4 últimos (`•••• •••• •••• 8694`).
El **CVV** (`CVV`, `CVC`, `CID`, `código de seguridad` seguido de 3–4 dígitos) se quita entero (`CVV •••`):
PCI DSS prohíbe guardarlo. Los campos de identificadores internos (`…Id`, `reservationSerieNumber`) no se
enmascaran, porque un número largo puede pasar Luhn por casualidad.
Se aplica a las observaciones, a las descripciones y a todo el JSON crudo. Al arrancar, el servidor
limpia también los datos ya guardados y compacta la base de datos (`VACUUM`).

Conviene además pedir al personal que **no escriba tarjetas en las observaciones de NewHotel**:
allí siguen visibles para cualquiera con acceso al PMS.

## Paso a Convex (siguiente fase)

| Local (ahora) | Convex |
|---|---|
| `server/db.js` (tablas `guests`, `syncRuns`, `dailyStats`, `settings`) | `convex/schema.ts` con las mismas tablas e índices `by_inHouse`, `by_arrival`, `by_departure` |
| `server/newhotel.js` (`fetch` + token) | `convex/newhotel.ts`: `internalAction` con `fetch` (en Convex no hay CORS) |
| `server/sync.js` (`normalizeGuest` + upsert) | misma función `normalizeGuest`; `internalMutation upsertGuests` |
| `setInterval` | `convex/crons.ts`: `crons.interval("sync guests", { minutes: 10 }, ...)` |
| rutas `GET /api/*` | `query` (`summary`, `guests`, `movements`, `status`) |
| `fetch('/api/...')` en `src/api.js` | `useQuery(api.guests.summary)`, con datos en tiempo real sin refrescar |
| token en tabla `settings` | tabla `settings` + variables de entorno de Convex para credenciales |
| login con NewHotel + huella local (`server/auth.js`) | Convex Auth con un proveedor de credenciales propio que haga la misma validación |

### Login automático

Si defines `NEWHOTEL_EMAIL` y `NEWHOTEL_PASSWORD`, el servidor inicia sesión solo, igual que la web:

1. `POST auth/html` con `{ userEmail, password }` devuelve `content.token`, un token de usuario sin hotel.
2. `POST getcontext/101` con `{ applicationId: 101, hotelId, languageId: 3082, logOperation: true }`
   y el token de usuario devuelve `content.context.token`, el token del hotel.

El login se lanza antes de sincronizar si el token caduca en menos de 5 minutos, y también
si NewHotel responde 401/403 (en ese caso reintenta una vez).
Si el usuario tiene doble factor (2FA), el login automático no es posible.

| Variable | Por defecto |
|---|---|
| `NEWHOTEL_EMAIL` / `NEWHOTEL_PASSWORD` | — (sin ellas solo se usa el token pegado) |
| `NEWHOTEL_HOTEL_ID` | el del token actual, o el primer hotel de la cuenta |
| `NEWHOTEL_APP_ID` | `101` (Cloud PMS) |
| `NEWHOTEL_LANGUAGE_ID` | `3082` (español) |

Las credenciales van en variables de entorno (en Convex, en las variables del
deployment), nunca en el código ni en la base de datos.

## Siguientes módulos

- Modo contingencia: registrar check-ins, check-outs, cargos y pagos, con una cola de conciliación para cuando vuelva NewHotel.

- Estadísticas ya calculadas: `topnationalities`, `bookingsroomtype`, `bookingtypepercentage`, `searchgroupbydate`.
- Housekeeping (app 116): pendiente de capturar sus endpoints.
