import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api, IS_STATIC, fmtDate, fmtDateTime, fmtMoney, fmtTime, nights, shiftDate } from "./api.js";
import { BarList, Columns, Donut, GroupedBars, LineChart, ProgressMeter } from "./charts.jsx";

// Menú con la misma estructura y nombres que el PMS, limitado a lo útil en contingencia.
// view = pantalla implementada; sin view = "Próximamente".
const MENU = [
  { id: "summary", label: "Sumario", icon: "M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z", view: "summary" },
  {
    label: "Reservas", icon: "M4 5h16v15H4zM4 9h16M8 3v4M16 3v4",
    items: [
      { id: "reservations", label: "Gestión Reservas", view: "reservations" },
      { id: "availability", label: "Disponibilidad", view: "availability" },
    ],
  },
  {
    label: "Recepción", icon: "M3 18h18M5 18a7 7 0 0 1 14 0M12 8V6M10 6h4",
    items: [
      { id: "movements", label: "Panel Interactivo", view: "movements" },
      { id: "roomplanning", label: "Planning Alojamientos", view: "planning" },
      { id: "guests", label: "Huéspedes", view: "guests" },
      { id: "roomsearch", label: "Habitaciones", view: "rooms" },
    ],
  },
  {
    label: "Movimientos", icon: "M4 6h16v12H4zM12 9v6M10 10.5a2 2 0 0 1 4 0",
    items: [{ id: "currentaccounts", label: "Cuentas Corrientes", view: "accounts" }],
  },
  {
    label: "Ama de Llaves", icon: "M6 21V9l6-5 6 5v12M10 21v-6h4v6",
    items: [{ id: "roomstatus", label: "Estado Habitación", view: "roomstatus" }],
  },
  {
    label: "Reportes", icon: "M7 3h10v18H7zM10 8h4M10 12h4M10 16h2",
    items: [{ id: "contingency", label: "Informe de contingencia", view: "contingency" }],
  },
  {
    label: "Respaldo", icon: "M20 11a8 8 0 0 0-14-5L4 8m0-4v4h4M4 13a8 8 0 0 0 14 5l2-2m0 4v-4h-4",
    items: [{ id: "sync", label: "Sincronización", view: "sync" }],
  },
];
const ALL_ITEMS = MENU.flatMap((m) => (m.items ? m.items.map((i) => ({ ...i, group: m.label })) : [{ ...m, group: null }]));
const findItem = (id) => ALL_ITEMS.find((i) => i.id === id);

function Icon({ d, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function useLoad(fn, deps) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    set((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => set({ data, error: null, loading: false }))
      .catch((error) => set((s) => ({ ...s, error, loading: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(load, [load]);
  return { ...state, reload: load };
}

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = comprobando, null = sin sesión
  useEffect(() => {
    api.me().then(setMe).catch(() => setMe(null));
    const onAuth = () => setMe(null);
    addEventListener("auth-required", onAuth);
    return () => removeEventListener("auth-required", onAuth);
  }, []);
  if (me === undefined) return <div className="login-wrap"><div className="skeleton-line" style={{ width: 200 }} /></div>;
  if (!me) return <Login onDone={() => api.me().then(setMe)} />;
  return <Shell me={me} onLogout={async () => {
    await api.logout().catch(() => {});
    navigator.serviceWorker?.controller?.postMessage("clear-data");
    setMe(null);
  }} />;
}

function Login({ onDone }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [cfg, setCfg] = useState({});
  useEffect(() => { api.publicConfig().then(setCfg); }, []);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.login(email, password);
      setPassword("");
      onDone();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit}>
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="48" height="48" />
        <h1>Respaldo PMS</h1>
        <p className="muted">Entra con tu usuario y contraseña de NewHotel.</p>
        <label>Usuario (email)
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Contraseña
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {err && <p className="msg err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? "Comprobando…" : "Entrar"}</button>
        {cfg.demo ? (
          <div className="demo-hint">
            <strong>Modo demo</strong> · datos inventados<br />
            Usuario: <code>{cfg.demoUser.email}</code><br />Clave: <code>{cfg.demoUser.password}</code>
            <button type="button" className="link" onClick={() => { setEmail(cfg.demoUser.email); setPassword(cfg.demoUser.password); }}>
              Rellenar
            </button>
          </div>
        ) : (
          <p className="muted small">
            Si NewHotel no responde, podrás entrar igualmente si ya iniciaste sesión aquí antes con NewHotel funcionando.
          </p>
        )}
      </form>
    </div>
  );
}

function Shell({ me, onLogout }) {
  const [tab, setTab] = useState(() => (findItem(location.hash.slice(1)) ? location.hash.slice(1) : "summary"));
  const [menuOpen, setMenuOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState(() => new Set([findItem(location.hash.slice(1))?.group].filter(Boolean)));
  const [guestFilter, setGuestFilter] = useState({});
  const [stamp, setStamp] = useState(0); // fuerza recarga tras sincronizar
  const status = useLoad(api.status, [stamp]);

  useEffect(() => {
    history.replaceState(null, "", `#${tab}`);
    const g = findItem(tab)?.group;
    if (g) setOpenGroups((s) => (s.has(g) ? s : new Set([...s, g])));
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const t = location.hash.slice(1);
      if (findItem(t)) setTab(t);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Mantiene una copia local del informe de contingencia (caché del service worker),
  // para poder abrirlo sin conexión en cualquier dispositivo que tenga la app abierta.
  useEffect(() => {
    const warm = () => api.contingency().catch(() => {});
    warm();
    const t = setInterval(warm, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  // Refresco automático cada minuto
  useEffect(() => {
    const t = setInterval(() => setStamp((s) => s + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const goGuests = (filter) => {
    setGuestFilter(filter);
    setTab("guests");
  };

  const hotel = status.data?.token?.hotelName || "Hotel";
  const current = findItem(tab);
  const ageMin = status.data?.lastSyncAt ? Math.round((Date.now() - new Date(status.data.lastSyncAt)) / 60000) : null;
  const toggleGroup = (g) => setOpenGroups((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; });

  return (
    <div className={`shell${menuOpen ? " menu-open" : ""}`}>
      <aside className="sidenav" aria-label="Menú principal">
        <div className="sidenav-brand">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="30" height="30" />
          <span>Respaldo PMS</span>
        </div>
        <nav>
          {MENU.map((m) =>
            m.items ? (
              <div key={m.label} className={`nav-group${openGroups.has(m.label) ? " is-open" : ""}`}>
                <button className="nav-item" onClick={() => toggleGroup(m.label)} aria-expanded={openGroups.has(m.label)}>
                  <Icon d={m.icon} /><span>{m.label}</span><span className="chev">›</span>
                </button>
                {openGroups.has(m.label) && (
                  <div className="nav-sub">
                    {m.items.map((i) => (
                      <button key={i.id} className={`nav-subitem${tab === i.id ? " is-active" : ""}${i.view ? "" : " is-soon"}`}
                        onClick={() => setTab(i.id)}>
                        {i.label}{!i.view && <em>Próximamente</em>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button key={m.id} className={`nav-item${tab === m.id ? " is-active" : ""}`} onClick={() => setTab(m.id)}>
                <Icon d={m.icon} /><span>{m.label}</span>
              </button>
            )
          )}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setMenuOpen(false)} />

      <div className="main-col">
        {status.data?.demo ? (
          <div className="backup-strip is-demo" role="status">MODO DEMO · datos inventados · no es NewHotel{IS_STATIC ? ` · versión estática (datos generados el ${fmtDate(status.data?.workDate, { day: "2-digit", month: "2-digit" })})` : ""}</div>
        ) : (
          <div className={`backup-strip${ageMin != null && ageMin > 30 ? " is-stale" : ""}`} role="status">
            COPIA DE RESPALDO · no es NewHotel · datos de las {status.data?.lastSyncAt ? fmtDateTime(status.data.lastSyncAt).split(", ").pop() : "—"}
            {ageMin != null && ageMin > 30 && ` (hace ${ageMin} min)`}
          </div>
        )}
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label="Abrir menú">☰</button>
          <div className="topbar-title">
            <div className="crumb">{current?.group ? `${current.group} ›` : ""}</div>
            <h1>{current?.label}</h1>
          </div>
          <div className="topbar-user">
            <span className={`mode mode-${status.data?.demo ? "demo" : me.mode}`} title={{ online: "Validado con NewHotel", offline: "NewHotel no respondía: validado con la copia local", local: "Acceso de emergencia", open: "Acceso directo desde la red del hotel" }[me.mode]}>
              {status.data?.demo ? "Demo" : { online: "NewHotel", offline: "Sin NewHotel", local: "Emergencia", open: "Red del hotel" }[me.mode]}
            </span>
            <span className="user-name">{me.name || me.email}</span>
            {me.mode !== "open" && <button className="link" onClick={onLogout}>Salir</button>}
          </div>
          <div className="topbar-hotel">
            {status.data?.workDate && <strong>{fmtDate(status.data.workDate, { day: "2-digit", month: "2-digit", year: "numeric" })}</strong>}
            <span>{hotel}</span>
          </div>
        </header>

        <main className="content">
          {current?.view === "summary" && <Summary stamp={stamp} onFilter={goGuests} onGo={setTab} />}
          {current?.view === "availability" && <Availability stamp={stamp} />}
          {current?.view === "guests" && <Guests stamp={stamp} initial={guestFilter} />}
          {current?.view === "movements" && <Movements stamp={stamp} today={status.data?.today} />}
          {current?.view === "accounts" && <Accounts stamp={stamp} />}
          {current?.view === "reservations" && <Reservations stamp={stamp} today={status.data?.workDate || status.data?.today} />}
          {current?.view === "planning" && <Planning stamp={stamp} />}
          {current?.view === "rooms" && <Rooms stamp={stamp} />}
          {current?.view === "roomstatus" && <RoomStatus stamp={stamp} />}
          {current?.view === "contingency" && <Contingency stamp={stamp} />}
          {current?.view === "sync" && <Sync status={status} onSynced={() => setStamp((s) => s + 1)} />}
          {current && !current.view && (
            <Empty title={`${current.label}: próximamente`}
              text="Esta pantalla se añadirá cuando capturemos su endpoint en NewHotel y lo incluyamos en el respaldo." />
          )}
        </main>
      </div>
    </div>
  );
}

/* ----------------------------- Cuentas Corrientes ---------------------------- */

const pen = (n) => fmtMoney(n, "PEN");

function Accounts({ stamp }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [onlyBalance, setOnlyBalance] = useState(true);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error } = useLoad(() => api.accounts({ q: debounced, balance: onlyBalance ? "1" : "" }), [stamp, debounced, onlyBalance]);
  const rows = data?.rows ?? [];

  return (
    <div className={`accounts${selected ? " has-detail" : ""}`}>
      <section className="card acc-list">
        <div className="acc-list-head">
          <input className="search" type="search" placeholder="Habitación, reserva, huésped, entidad…" value={q}
            onChange={(e) => setQ(e.target.value)} aria-label="Buscar cuenta" />
          <div className="seg" role="group" aria-label="Filtro">
            <button className={onlyBalance ? "is-active" : ""} onClick={() => setOnlyBalance(true)}>Con saldo</button>
            <button className={!onlyBalance ? "is-active" : ""} onClick={() => setOnlyBalance(false)}>Todas</button>
          </div>
          <p className="muted small">
            {error ? error.message : data && `${rows.length} cuentas · ${data.totals.withBalance} con saldo · total ${pen(data.totals.total)}`}
            {data?.syncedAt && ` · copia ${fmtDateTime(data.syncedAt).split(", ").pop()}`}
          </p>
        </div>
        <ul className="acc-items">
          {rows.map((a) => (
            <li key={a.accountId}>
              <button className={`acc-item${selected === a.accountId ? " is-active" : ""}`} onClick={() => setSelected(a.accountId)}>
                <span className="room">{a.room || "—"}</span>
                <span className="grow">
                  <span className="name">{a.guest || a.holder || a.reservation}</span>
                  <span className="muted small">{a.reservation} · {a.company || "Particular"} · sale {fmtDate(a.departure)}</span>
                </span>
                <span className={`acc-balance${a.totalAmount < 0 ? " is-credit" : ""}`}>{pen(a.totalAmount)}</span>
              </button>
            </li>
          ))}
        </ul>
        {data && !rows.length && <Empty title="Sin cuentas" text="No hay cuentas que coincidan." />}
      </section>
      <section className="acc-detail">
        {selected ? <AccountDetail id={selected} onBack={() => setSelected(null)} stamp={stamp} /> : (
          <div className="card"><Empty title="Elige una cuenta" text="Verás sus cargos, pagos y el saldo pendiente." /></div>
        )}
      </section>
    </div>
  );
}

function AccountDetail({ id, onBack, stamp }) {
  const { data, error } = useLoad(() => api.account(id), [id, stamp]);
  if (error) return <div className="card"><Empty title="No se pudo cargar" text={error.message} /></div>;
  if (!data) return <div className="card"><div className="skeleton-line" /></div>;
  const charges = data.movements.filter((m) => !m.paymentType);
  const payments = data.movements.filter((m) => m.paymentType);
  const sum = (arr) => arr.reduce((t, m) => t + (m.total ?? 0), 0);
  const folders = [
    ["Master", data.masterAmount], ["Extra 1", data.extra1Amount], ["Extra 2", data.extra2Amount],
    ["Extra 3", data.extra3Amount], ["Extra 4", data.extra4Amount], ["Extra 5", data.extra5Amount],
  ].filter(([, v]) => Math.abs(v ?? 0) > 0.005);

  return (
    <div className="card folio">
      <header className="folio-head">
        <button className="icon-btn back-btn no-print" onClick={onBack} aria-label="Volver">‹</button>
        <div className="grow">
          <div className="muted small">Cuenta corriente · reserva {data.reservation}</div>
          <h2>Hab. {data.room} · {data.guest || data.holder}</h2>
          <div className="muted small">
            {data.roomType} · {fmtDate(data.arrival)} → {fmtDate(data.departure)} · {data.term} · pax {(data.paxs || "").split(" ")[0]}
            {data.company && ` · ${data.company}`}{data.groupName && ` · grupo ${data.groupName}`}
          </div>
        </div>
        <button className="btn no-print print-btn" onClick={() => window.print()}>Imprimir</button>
      </header>

      {data.remarks && <div className="remarks"><strong>Observaciones:</strong> {data.remarks}</div>}

      <div className="folders">
        {folders.map(([k, v]) => <span key={k}><em>{k}</em>{pen(v)}</span>)}
        <span className="folders-total"><em>Saldo</em>{pen(data.totalAmount)}</span>
      </div>

      <div className="table-wrap">
        <table className="table compact folio-table">
          <thead>
            <tr><th>Fecha</th><th>Descripción</th><th className="hide-sm">Carpeta</th><th className="hide-sm">Facturar a</th>
              <th className="num hide-sm">Uds.</th><th className="num">Cargo</th><th className="num">Pago</th></tr>
          </thead>
          <tbody>
            {data.movements.map((m) => (
              <tr key={m.id} className={m.paymentType ? "is-payment" : ""}>
                <td className="nowrap">{fmtDate(m.date)} <span className="muted small">{m.time}</span></td>
                <td>{m.paymentType ? `Pago · ${m.paymentType}` : m.description || m.service}</td>
                <td className="nowrap hide-sm">{m.folder}</td>
                <td className="hide-sm">{m.invoiceTo}</td>
                <td className="num hide-sm">{m.paymentType ? "" : m.units ?? ""}</td>
                <td className="num">{m.paymentType ? "" : pen(m.total)}</td>
                <td className="num">{m.paymentType ? pen(-m.total) : ""}</td>
              </tr>
            ))}
            {!data.movements.length && (
              <tr><td colSpan={7} className="muted">Sin movimientos pendientes en la última copia.</td></tr>
            )}
          </tbody>

        </table>
      </div>
      <div className="folio-totals">
        <span><em>Cargos</em>{pen(sum(charges))}</span>
        <span><em>Pagos</em>{pen(Math.abs(sum(payments)))}</span>
        <span className="folio-saldo"><em>Saldo pendiente</em>{pen(data.totalAmount)}</span>
      </div>
      <p className="muted small">
        Facturado previamente: {pen(data.totalInvoiced)} · pendiente de facturar: {pen(data.pendingInvoices)} ·
        datos de la copia de las {fmtDateTime(data.updatedAt).split(", ").pop()}
      </p>
    </div>
  );
}

/* ------------------------------ Gestión Reservas ----------------------------- */

function Reservations({ stamp, today }) {
  const [date, setDate] = useState(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const days = useLoad(() => api.reservations({ date: "0000-00-00" }), [stamp]);
  const firstDay = days.data?.byDay?.find((d) => d.date >= (today || ""))?.date || days.data?.byDay?.[0]?.date;
  const active = date || firstDay;
  const { data } = useLoad(
    () => (active || debounced ? api.reservations(debounced ? { q: debounced } : { date: active }) : Promise.resolve({ rows: [] })),
    [stamp, active, debounced]
  );
  const rows = data?.rows ?? [];
  return (
    <div className="stack">
      <div className="filters no-print">
        <input className="search" type="search" placeholder="Buscar huésped, reserva, entidad, voucher, grupo…"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar reserva" />
        <button className="btn print-btn" onClick={() => window.print()}>Imprimir</button>
      </div>
      {!debounced && (
        <div className="daychips no-print" role="group" aria-label="Día de llegada">
          {days.data?.byDay?.map((d) => (
            <button key={d.date} className={active === d.date ? "is-active" : ""} onClick={() => setDate(d.date)}>
              <span className="dc-day">{d.date === today ? "Hoy" : fmtDate(d.date, { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
              <span className="dc-n">{d.n}</span>
              {d.unassigned > 0 && <span className="dc-sub">{d.unassigned} sin hab.</span>}
            </button>
          ))}
        </div>
      )}
      <Card title={debounced ? `Resultados para «${debounced}»` : `Llegadas previstas · ${active ? fmtDate(active, { weekday: "long", day: "numeric", month: "long" }) : "—"}`}
        sub={`${rows.length} líneas de reserva · estado Reservada (aún sin check-in)`}>
        <div className="table-wrap">
          <table className="table compact res-table">
            <thead>
              <tr><th>Hab.</th><th>Huésped</th><th>Reserva</th><th>Llegada</th><th>Salida</th><th className="num">Pax</th>
                <th className="hide-sm">Tipo</th><th className="hide-sm">Rég.</th><th className="hide-sm">Tarifa</th>
                <th className="hide-sm">Entidad</th><th className="num hide-sm">Saldo</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.room ? <span className="room">{r.room}</span> : <span className="pill pill-pending">s/a</span>}</td>
                  <td>
                    <div className="name">{r.guest}</div>
                    <div className="muted small">
                      {[r.groupName && `Grupo ${r.groupName}`, r.country, r.confirmation, r.depositRequired ? "Requiere depósito" : null].filter(Boolean).join(" · ")}
                    </div>
                    {r.comments && <div className="res-comment" title={r.comments}>{r.comments}</div>}
                  </td>
                  <td className="nowrap">{r.reservation}<div className="muted small">{r.voucher}</div></td>
                  <td className="nowrap">{fmtDate(r.arrival)} <span className="muted small">{r.arrivalTime}</span></td>
                  <td className="nowrap">{fmtDate(r.departure)} <span className="muted small">({r.nights}n)</span></td>
                  <td className="num">{r.adults}{r.children ? `+${r.children}` : ""}</td>
                  <td className="hide-sm">{r.roomTypeReserved}{r.roomTypeOccupied && r.roomTypeOccupied !== r.roomTypeReserved ? ` → ${r.roomTypeOccupied}` : ""}</td>
                  <td className="hide-sm">{r.pension}</td>
                  <td className="hide-sm nowrap">{r.priceRate}</td>
                  <td className="hide-sm">{r.company || r.agency}</td>
                  <td className="num hide-sm">{r.balance ? pen(r.balance) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && !rows.length && <Empty title="Sin reservas" text="No hay reservas pendientes de llegada para este filtro." />}
      </Card>
    </div>
  );
}

/* ---------------------------- Planning Alojamientos --------------------------- */

const STATE_CLASS = { 601: "st-reserved", 602: "st-checkin", 606: "st-checkout" };
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86_400_000);

function Planning({ stamp }) {
  const { data, error } = useLoad(api.planning, [stamp]);
  const [sel, setSel] = useState(null);
  const [type, setType] = useState("");
  if (error) return <Empty title="Sin planning" text={error.message} />;
  if (!data) return <Skeleton />;
  const N = Math.min(14, data.dates.length);
  const dates = data.dates.slice(0, N);
  const from = dates[0];
  const types = [...new Set(data.rooms.map((r) => r.type))].filter(Boolean);
  const rooms = data.rooms.filter((r) => !type || r.type === type);
  const avail = new Map(data.availability.map((a) => [a.date, a]));
  const unassigned = data.unassigned.filter((u) => u.arrival >= data.workDate);

  return (
    <div className="stack">
      <div className="filters no-print">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de habitación">
          <option value="">Todos los tipos ({data.rooms.length} hab.)</option>
          {types.map((t) => <option key={t} value={t}>{t} ({data.rooms.filter((r) => r.type === t).length})</option>)}
        </select>
        <div className="legend plan-legend">
          <span><i className="st-checkin" />Check-in</span>
          <span><i className="st-reserved" />Reservada</span>
          <span><i className="st-checkout" />Check-out</span>
          <span><i className="st-over" />Overbooking</span>
        </div>
      </div>
      <section className="card plan-card">
        <div className="plan-scroll">
          <div className="plan" style={{ "--days": N }}>
            <div className="plan-head plan-corner">Hab.</div>
            {dates.map((d) => (
              <div key={d} className={`plan-head${d === data.workDate ? " is-today" : ""}`}>
                <span>{fmtDate(d, { weekday: "short" })}</span>
                <strong>{fmtDate(d, { day: "2-digit", month: "2-digit" })}</strong>
                <em title="Habitaciones libres" className={avail.get(d)?.available < 0 ? "is-over" : ""}>{avail.get(d)?.available ?? ""}</em>
              </div>
            ))}
            {rooms.map((r) => (
              <React.Fragment key={r.id}>
                <div className={`plan-room status-${r.statusId}`} title={`${r.type} · ${r.status}`}>
                  <strong>{r.room}</strong><span>{r.type}</span>
                </div>
                <div className="plan-row" style={{ gridColumn: `2 / span ${N}` }}>
                  {dates.map((d) => <div key={d} className={`plan-cell${d === data.workDate ? " is-today" : ""}`} />)}
                  {r.bookings.map((b) => {
                    const s = daysBetween(from, b.arrival);
                    const e = daysBetween(from, b.departure);
                    if (e <= 0 || s >= N) return null;
                    const left = Math.max(s, -0.5) + 0.5;
                    const right = Math.min(e, N - 0.5) + 0.5;
                    return (
                      <button key={b.id + b.arrival} className={`plan-bar ${b.overbooked ? "st-over" : STATE_CLASS[b.state] || "st-other"}${sel?.id === b.id ? " is-sel" : ""}`}
                        style={{ left: `calc(${left} * var(--cw))`, width: `calc(${right - left} * var(--cw) - 3px)` }}
                        title={`${b.name} · ${b.no} · ${fmtDate(b.arrival)} → ${fmtDate(b.departure)}`}
                        onClick={() => setSel({ ...b, room: r.room, type: r.type })}>
                        {b.name}
                      </button>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      </section>
      {sel && (
        <Card title={`Hab. ${sel.room} · ${sel.name}`} sub={`${sel.no} · ${sel.stateDesc || ""}`}>
          <dl className="dl">
            <dt>Estancia</dt><dd>{fmtDate(sel.arrival)} → {fmtDate(sel.departure)} ({sel.nights} noches)</dd>
            <dt>Pax</dt><dd>{(sel.paxs || "").replace(/-/g, " · ")}</dd>
            <dt>Entidad</dt><dd>{sel.company || "—"}</dd>
            {sel.group && <><dt>Grupo</dt><dd>{sel.group}</dd></>}
            <dt>Tipo reservado</dt><dd>{sel.roomType} (ocupa {sel.type})</dd>
            {sel.pending && <><dt>Pendiente</dt><dd>Tiene importe pendiente</dd></>}
          </dl>
        </Card>
      )}
      <Card title={`Reservas sin habitación asignada · ${unassigned.length}`} sub="Desde la fecha de trabajo">
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Llegada</th><th>Salida</th><th>Reserva</th><th>Huésped</th><th>Tipo</th><th className="num">Pax</th><th className="hide-sm">Entidad</th></tr></thead>
            <tbody>
              {unassigned.slice(0, 200).map((u) => (
                <tr key={u.id}>
                  <td className="nowrap">{fmtDate(u.arrival)}</td><td className="nowrap">{fmtDate(u.departure)}</td>
                  <td className="nowrap">{u.no}</td><td>{u.name}</td><td>{u.roomType}</td>
                  <td className="num">{(u.paxs || "").split(" ")[0]}</td><td className="hide-sm">{u.company}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unassigned.length > 200 && <p className="muted small">Se muestran las 200 primeras.</p>}
      </Card>
      <p className="muted small">Planning de la copia de las {fmtDateTime(data.syncedAt).split(", ").pop()} · {N} días desde {fmtDate(from)}.</p>
    </div>
  );
}

/* ------------------------- Habitaciones / Estado Habitación ------------------------- */

const STATUS_CLASS = { 661: "rs-dirty", 662: "rs-cleaning", 663: "rs-verify", 664: "rs-clean" };

function useRooms(stamp) {
  return useLoad(api.rooms, [stamp]);
}

function RoomStatus({ stamp }) {
  const { data } = useRooms(stamp);
  const [filter, setFilter] = useState("");
  if (!data) return <Skeleton />;
  const t = data.totals || {};
  const rows = data.rows.filter((r) => !filter || String(r.status) === filter || (filter === "ooo" && r.outOfOrder));
  const floors = [...new Set(rows.map((r) => r.floor))];
  const chips = [
    ["", "Todas", t.totalRooms ?? data.rows.length],
    ["664", "Limpias", t.clean], ["661", "Sucias", t.dirty], ["662", "En limpieza", t.cleaning], ["663", "Verificar", t.verify],
    ["ooo", "Fuera de servicio", data.rows.filter((r) => r.outOfOrder).length],
  ];
  return (
    <div className="stack">
      <div className="daychips no-print">
        {chips.map(([k, l, n]) => (
          <button key={k} className={`${filter === k ? "is-active " : ""}${STATUS_CLASS[k] || ""}`} onClick={() => setFilter(k)}>
            <span className="dc-day">{l}</span><span className="dc-n">{n ?? 0}</span>
          </button>
        ))}
        <button className="btn print-btn" onClick={() => window.print()}>Imprimir</button>
      </div>
      {floors.map((f) => (
        <Card key={f} title={`Piso ${f}`}>
          <div className="rs-grid">
            {rows.filter((r) => r.floor === f).map((r) => (
              <div key={r.id} className={`rs-tile ${STATUS_CLASS[r.status] || ""}${r.outOfOrder ? " is-ooo" : ""}`}
                title={[r.roomType, r.statusDescription, r.occupancyStatus, r.malfunction, r.inactivityType].filter(Boolean).join(" · ")}>
                <strong>{r.room}</strong>
                <span className="rs-status">{r.statusDescription}</span>
                <span className="rs-occ">{r.occupancyStatus}</span>
                {(r.outOfOrder || r.malfunction) && <span className="rs-warn">⚠ {r.inactivityType || r.malfunction || "Fuera de servicio"}</span>}
              </div>
            ))}
          </div>
        </Card>
      ))}
      <p className="muted small">Estado de la copia de las {fmtDateTime(data.syncedAt).split(", ").pop()}.</p>
    </div>
  );
}

function Rooms({ stamp }) {
  const { data } = useRooms(stamp);
  const [q, setQ] = useState("");
  const [occ, setOcc] = useState("");
  if (!data) return <Skeleton />;
  const occs = [...new Set(data.rows.map((r) => r.occupancyStatus).filter(Boolean))].sort();
  const rows = data.rows.filter((r) =>
    (!occ || r.occupancyStatus === occ) &&
    (!q || [r.room, r.roomType, r.mainGuest].some((v) => (v || "").toLowerCase().includes(q.toLowerCase())))
  );
  return (
    <div className="stack">
      <div className="filters no-print">
        <input className="search" type="search" placeholder="Habitación, tipo o huésped…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar habitación" />
        <select value={occ} onChange={(e) => setOcc(e.target.value)} aria-label="Ocupación">
          <option value="">Toda ocupación</option>
          {occs.map((o) => <option key={o} value={o}>{o} ({data.rows.filter((r) => r.occupancyStatus === o).length})</option>)}
        </select>
      </div>
      <Card title={`Habitaciones · ${rows.length}`}>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Hab.</th><th>Piso</th><th>Tipo</th><th>Limpieza</th><th>Ocupación</th><th className="hide-sm">Huésped</th><th className="hide-sm">Incidencias</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="room">{r.room}</span></td><td>{r.floor}</td><td>{r.roomType}</td>
                  <td><span className={`rs-pill ${STATUS_CLASS[r.status] || ""}`}>{r.statusDescription}</span></td>
                  <td>{r.occupancyStatus}</td>
                  <td className="hide-sm">{r.mainGuest || "—"}</td>
                  <td className="hide-sm">{[r.outOfOrder ? `Fuera de servicio${r.inactivityType ? ` (${r.inactivityType})` : ""}` : null, r.malfunction, r.attentions].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------- Disponibilidad ------------------------------ */

function Availability({ stamp }) {
  const { data } = useLoad(api.summary, [stamp]);
  if (!data) return <Skeleton />;
  const inv = data.occupancy?.inventory;
  if (!data.forecast.length) return <Empty title="Sin datos de disponibilidad" text="Sincroniza primero." />;
  return (
    <div className="stack">
      <Card title="Disponibilidad por día" sub={`Habitaciones · inventario ${inv ?? "—"} · próximos ${data.forecast.length} días`}>
        <div className="table-wrap">
          <table className="table compact avail">
            <thead>
              <tr><th>Día</th><th className="num">Llegadas</th><th className="num">Salidas</th><th className="num">Estancias</th>
                <th className="num">Ocupadas</th><th className="num">Libres</th><th>Ocupación</th></tr>
            </thead>
            <tbody>
              {data.forecast.map((f) => {
                const free = inv != null ? inv - f.rooms : null;
                return (
                  <tr key={f.date} className={f.date === data.today ? "is-today" : ""}>
                    <td className="nowrap">{fmtDate(f.date, { weekday: "short", day: "2-digit", month: "2-digit" })}</td>
                    <td className="num">{f.arrivals}</td><td className="num">{f.departures}</td><td className="num">{f.stayovers}</td>
                    <td className="num"><strong>{f.rooms}</strong></td>
                    <td className={`num${free != null && free < 0 ? " over" : ""}`}>{free ?? "—"}</td>
                    <td className="rt-pct">
                      <span>{f.occupancyPercent != null ? `${f.occupancyPercent.toFixed(1)}%` : "—"}</span>
                      <span className="rt-track"><span className={f.occupancyPercent > 100 ? "is-over" : ""} style={{ width: `${Math.min(100, f.occupancyPercent ?? 0)}%` }} /></span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="legend-note">Libres negativas = sobreventa (más habitaciones vendidas que disponibles).</p>
      </Card>
    </div>
  );
}

/* ---------------------------------- Resumen --------------------------------- */

function Kpi({ label, value, sub, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`kpi${onClick ? " is-link" : ""}`} onClick={onClick}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value ?? "—"}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </Tag>
  );
}

function Card({ title, sub, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      <header className="card-head">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </header>
      {children}
    </section>
  );
}

function Summary({ stamp, onFilter, onGo }) {
  const { data, error, loading } = useLoad(api.summary, [stamp]);
  if (error) return <Empty title="No se pudo cargar el sumario" text={error.message} />;
  if (!data) return <Skeleton />;
  const k = data.kpis;
  const o = data.occupancy;
  const raw = data.occupancyRaw || {};
  if (!o && !k.guests && !loading)
    return <Empty title="Todavía no hay datos" text="Ve a Sincronización, pega el token y pulsa «Sincronizar ahora»." />;

  const shortDay = (iso, long) =>
    long
      ? fmtDate(iso, { weekday: "long", day: "numeric", month: "long" })
      : fmtDate(iso, { weekday: "short", day: "2-digit", month: "2-digit" }).replace(",", "");
  const dayLabel = (iso, long) =>
    iso === data.today ? "Hoy" : fmtDate(iso, long ? { weekday: "long", day: "numeric", month: "short" } : { weekday: "short", day: "numeric" });
  const week = data.forecast.slice(0, 7);

  return (
    <div className="sumario">
      <div className="sumario-main">
        {o && (
          <div className="grid-3">
            <section className="card stat-card">
              <header className="stat-head">
                <h2>Check-In</h2>
                <button className="stat-badge tone-a" onClick={() => onGo("movements")} title="Ver llegadas">
                  <Icon d="M2 20h20M5 15l14-5-1-3-5 2-5-6-2 1 3 6-4 1-2-2-1 1z" size={16} />{o.arrivalsTotal}
                </button>
              </header>
              <ProgressMeter done={o.arrivalsDone} total={o.arrivalsTotal} tone="a" />
              <p className="stat-foot">{o.arrivalsDone} llegaron · {o.arrivalsPending} pendientes</p>
            </section>
            <section className="card stat-card">
              <header className="stat-head">
                <h2>Check-Out</h2>
                <button className="stat-badge tone-b" onClick={() => onGo("movements")} title="Ver salidas">
                  <Icon d="M2 20h20M3 9l14 5 4-1-1-2-15-6-2 1z" size={16} />{o.departuresTotal}
                </button>
              </header>
              <ProgressMeter done={o.departuresDone} total={o.departuresTotal} tone="b" />
              <p className="stat-foot">{o.departuresDone} salieron · {o.departuresPending} pendientes</p>
            </section>
            <section className="card stat-card">
              <header className="stat-head">
                <h2>Ocupación</h2>
                <span className="stat-badge tone-c">
                  <Icon d="M15 7a4 4 0 1 1-4 4M11 11l-8 8M6 16l2 2" size={16} />{o.roomsOccupied}
                </span>
              </header>
              <div className="donut-wrap"><Donut percent={o.occupancyPercent} label="Ocupación" /></div>
            </section>
          </div>
        )}

        <div className="grid-2">
          {week.length > 0 && (
            <Card title="Llegadas y salidas" sub="Habitaciones · próximos 7 días">
              <GroupedBars
                data={week}
                series={[{ key: "arrivals", label: "Llegadas", color: "--series" }, { key: "departures", label: "Salidas", color: "--series-2" }]}
                labelFor={shortDay}
              />
            </Card>
          )}
          {data.occupancyByType.length > 0 && (
            <Card title="% Ocupación por tipo de reserva" sub="Próximos días">
              <LineChart
                data={data.occupancyByType}
                series={[
                  { key: "total", label: "Total", color: "--series" },
                  { key: "individual", label: "Individuales", color: "--series-2" },
                  { key: "group", label: "Grupos", color: "--series-3" },
                ]}
                labelFor={shortDay}
                axisLabel={(iso) => fmtDate(iso, { day: "2-digit", month: "2-digit" })}
              />
            </Card>
          )}
        </div>

        <div className="grid-2">
          {data.roomTypes.length > 0 && (
            <Card title="Ocupación por tipo de habitación">
              <table className="table compact rt-table">
                <thead><tr><th>Tipo de habitación</th><th className="num">Ocupado</th><th className="num">Libre</th><th>Ocupación</th></tr></thead>
                <tbody>
                  {data.roomTypes.map((r) => (
                    <tr key={r.name}>
                      <td>{r.name}</td><td className="num">{r.occupied}</td><td className="num">{r.vacant}</td>
                      <td className="rt-pct">
                        <span>{r.percent.toFixed(2)}%</span>
                        <span className="rt-track"><span style={{ width: `${Math.min(100, r.percent)}%` }} /></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {data.topNationalities.length > 0 && (
            <Card title="Top 4 · noches por nacionalidad" sub="Último mes, según PMS">
              <BarList data={data.topNationalities} />
            </Card>
          )}
        </div>

        {data.forecast.length > 0 && (
          <Card title="Previsión de ocupación" sub={`Próximos ${data.forecast.length} días · habitaciones ocupadas sobre ${o?.inventory ?? "—"} · toca una barra para ver el detalle`}>
            <Columns
              compact
              data={data.forecast.map((f) => ({ ...f, value: f.occupancyPercent ?? f.rooms }))}
              format={(v) => (o ? `${Math.round(v)}%` : v)}
              tip={(f) => `${f.rooms} hab. · ${f.arrivals} llegadas · ${f.departures} salidas`}
              labelFor={dayLabel}
              highlight={data.today}
              caption="Previsión de ocupación por día"
              refLine={o ? 100 : undefined}
            />
            {data.forecast.some((f) => f.occupancyPercent > 100) && (
              <p className="legend-note">
                <span className="swatch swatch-over" /> Por encima de 100 %: más habitaciones vendidas que disponibles
                ({data.forecast.filter((f) => f.occupancyPercent > 100).map((f) => fmtDate(f.date)).join(", ")}).
              </p>
            )}
          </Card>
        )}

        <div className="grid-2">
          <Card title="Huéspedes en casa por nacionalidad" sub={`${k.guests} huéspedes · toca para filtrar`}>
            <BarList data={data.byCountry} total={k.guests} onSelect={(country) => onFilter({ country })} />
          </Card>
          <Card title="Huéspedes en casa por agencia" sub="Top 8 · toca para filtrar">
            <BarList data={data.byEntity} total={k.guests} onSelect={(entity) => onFilter({ entity })} />
          </Card>
        </div>
      </div>

      {o && (
        <aside className="sumario-side">
          <div className="side-block side-primary">
            <div className="side-workdate">
              <div className="side-caption">Fecha de trabajo</div>
              <div className="side-date">{fmtDate(o.date, { day: "2-digit", month: "2-digit", year: "numeric" })}</div>
              <div className="side-weekday">{fmtDate(o.date, { weekday: "long" })}</div>
            </div>
            <SideStat value={o.roomsVacant} label="Habitaciones disponibles" />
            <SideStat value={o.roomsOccupied} label="Habitaciones ocupadas" />
            <SideStat value={o.departuresPending} label="Check-out pendientes" onClick={() => onGo("movements")} />
            <SideStat value={o.arrivalsPending} label="Check-in pendientes" onClick={() => onGo("movements")} />
            <SideStat
              value={`${o.occupancyPercent.toFixed(2)}% | ${(raw.occupancyInventoryPercent ?? o.occupancyPercent).toFixed(2)}%`}
              label="Ocupación actual | Ocupación"
            />
            <SideStat value={`${o.adults ?? 0} | ${o.children ?? 0}`} label="Adultos | Niños" />
            <SideStat value={`${o.breakfasts ?? 0} | ${raw.lunches ?? 0} | ${raw.dinners ?? 0}`} label="Desayunos | Almuerzos | Cenas" />
            <SideStat value={fmtMoney(o.adr, o.currency)} label="Precio medio diario" />
          </div>
          <div className="side-block side-muted">
            <SideStat value={raw.inactive ?? 0} label="Habitaciones inactivas" />
            <SideStat value={`${o.cleanRooms} | ${o.dirtyRooms}`} label="Limpias | Sucias" />
          </div>
        </aside>
      )}
    </div>
  );
}

function SideStat({ value, label, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag className={`side-stat${onClick ? " is-link" : ""}`} onClick={onClick}>
      <div className="side-value">{value}</div>
      <div className="side-label">{label}</div>
    </Tag>
  );
}

/* --------------------------------- Huéspedes -------------------------------- */

function Guests({ stamp, initial }) {
  const [q, setQ] = useState("");
  const [country, setCountry] = useState(initial.country || "");
  const [entity, setEntity] = useState(initial.entity || "");
  const [status, setStatus] = useState("inhouse");
  const [sort, setSort] = useState("room");
  const [debounced, setDebounced] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const params = { q: debounced, country, entity, status, sort };
  const { data, error } = useLoad(() => api.guests(params), [stamp, debounced, country, entity, status, sort]);
  const rows = data?.rows ?? [];

  return (
    <div className="stack">
      <div className="filters">
        <input className="search" type="search" placeholder="Buscar nombre, habitación, reserva, agencia…"
          value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
        <div className="seg" role="group" aria-label="Estado">
          {[["inhouse", "En casa"], ["departed", "Salieron"], ["all", "Todos"]].map(([v, l]) => (
            <button key={v} className={status === v ? "is-active" : ""} onClick={() => setStatus(v)}>{l}</button>
          ))}
        </div>
        <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="País">
          <option value="">Todos los países</option>
          {data?.facets.country.map((f) => <option key={f.label} value={f.label}>{f.label} ({f.n})</option>)}
        </select>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Agencia">
          <option value="">Todas las agencias</option>
          {data?.facets.entity.map((f) => <option key={f.label} value={f.label}>{f.label} ({f.n})</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="room">Ordenar: habitación</option>
          <option value="name">Ordenar: apellido</option>
          <option value="arrival">Ordenar: llegada</option>
          <option value="departure">Ordenar: salida</option>
        </select>
      </div>

      <div className="result-count">
        {error ? error.message : `${rows.length} huésped${rows.length === 1 ? "" : "es"}`}
        {(country || entity) && (
          <button className="link" onClick={() => (setCountry(""), setEntity(""))}>Quitar filtros</button>
        )}
      </div>

      <div className="table-wrap card">
        <table className="table">
          <thead>
            <tr>
              <th>Hab.</th><th>Huésped</th><th className="hide-sm">País</th><th className="hide-sm">Llegada</th><th>Salida</th>
              <th className="hide-sm">Agencia</th><th className="hide-sm">Tipo hab.</th><th className="num hide-sm">Tarifa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} onClick={() => setSelected(g.id)} tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelected(g.id)}>
                <td><span className="room">{g.roomNumber || "—"}</span></td>
                <td>
                  <div className="name">{g.fullName}</div>
                  <div className="muted small">
                    <span className="show-sm">{g.country} · </span>{g.reservation} · {g.guestType}{g.isHolder ? " · titular" : ""}
                    {!g.inHouse && <span className="badge">Salió</span>}
                  </div>
                </td>
                <td className="hide-sm">{g.country || "—"}</td>
                <td className="hide-sm">{fmtDate(g.arrival)}</td>
                <td>{fmtDate(g.departure)} <span className="muted small">({nights(g.arrival, g.departure)}n)</span></td>
                <td className="hide-sm">{g.entity}</td>
                <td className="hide-sm">{g.roomType}</td>
                <td className="num hide-sm">{g.rateAmount != null ? fmtMoney(g.rateAmount, g.rateCurrency) : g.rateText}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && data && <Empty title="Sin resultados" text="Prueba con otra búsqueda o quita filtros." />}
      </div>

      {selected && <GuestDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function GuestDrawer({ id, onClose }) {
  const { data } = useLoad(() => api.guest(id), [id]);
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const r = data?.raw || {};
  const rows = data && [
    ["Habitación", `${data.roomNumber} · ${data.roomType}`],
    ["Reserva", data.reservation],
    ["Estancia", `${fmtDate(data.arrival)} → ${fmtDate(data.departure)} (${nights(data.arrival, data.departure)} noches)`],
    ["Pax reserva", `${data.adults} adultos · ${data.children} niños · ${data.babies} bebés`],
    ["Tipo huésped", `${data.guestType}${data.isHolder ? " (titular)" : ""}`],
    ["País", data.country],
    ["Edad / género", [data.age, data.gender].filter(Boolean).join(" · ") || "—"],
    ["Agencia / cliente", data.entity],
    ["Tipo cliente", data.clientType],
    ["Grupo", data.groupName],
    ["Tarifa", data.rateText],
    ["Régimen", data.pension],
    ["Estado", data.inHouse ? data.state : `Salió · ${fmtDateTime(data.checkedOutAt)}`],
    ["Email", data.email],
    ["Teléfono", data.phone],
    ["Pasaporte", r.passportDoc],
    ["Doc. identidad", r.identityDoc],
    ["Check-in por", r.checkinUser],
    ["Visto por 1ª vez", fmtDateTime(data.firstSeenAt)],
  ];
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="Ficha del huésped">
        <header>
          <div>
            <div className="muted small">Ficha del huésped</div>
            <h2>{data?.fullName || "…"}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>
        {rows && (
          <dl className="dl">
            {rows.filter(([, v]) => v).map(([k, v]) => (
              <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
            ))}
          </dl>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------- Movimientos -------------------------------- */

function Movements({ stamp, today }) {
  const [date, setDate] = useState(today || new Date().toISOString().slice(0, 10));
  useEffect(() => { if (today) setDate(today); }, [today]);
  const { data } = useLoad(() => api.movements(date), [stamp, date]);
  const panel = useLoad(api.panel, [stamp]);
  const isToday = today && date === today;
  const pending = data?.departures.filter((g) => g.inHouse).length ?? 0;

  return (
    <div className="stack">
      <div className="datebar">
        <button className="icon-btn" onClick={() => setDate(shiftDate(date, -1))} aria-label="Día anterior">‹</button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="icon-btn" onClick={() => setDate(shiftDate(date, 1))} aria-label="Día siguiente">›</button>
        {today && date !== today && <button className="link" onClick={() => setDate(today)}>Hoy</button>}
        <span className="muted">{fmtDate(date, { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>
      {data?.pms && (
        <div className="pms-banner">
          <strong>Según el PMS ({fmtDate(date)}):</strong> {data.pms.arrivals} habitaciones llegan ·{" "}
          {data.pms.departures} salen · {data.pms.stayovers} continúan
        </div>
      )}
      {isToday && panel.data && (
        <div className="grid-2">
          <PanelList title="Llegadas pendientes (PMS)" rows={panel.data.arrivals} kind="arrival" />
          <PanelList title="Salidas pendientes (PMS)" rows={panel.data.departures} kind="departure" />
        </div>
      )}
      <div className="grid-2">
        <MoveList title="Llegadas" sub={`${data?.arrivals.length ?? 0} huéspedes`} rows={data?.arrivals} />
        <MoveList title="Salidas" sub={`${data?.departures.length ?? 0} huéspedes · ${pending} pendientes`} rows={data?.departures} showStatus />
      </div>
      <p className="muted small">
        Las listas muestran huéspedes que han estado en casa en alguna sincronización (con nombre).
        Los totales del PMS cuentan habitaciones e incluyen reservas que aún no han hecho check-in.
      </p>
    </div>
  );
}

function PanelList({ title, rows, kind }) {
  return (
    <Card title={title} sub={`${rows.length} ${kind === "arrival" ? "reservas por llegar hoy" : "habitaciones por salir hoy"}`}>
      {!rows.length ? (
        <p className="muted">{kind === "arrival" ? "No quedan llegadas pendientes." : "No quedan salidas pendientes."}</p>
      ) : (
        <ul className="moves">
          {rows.map((r) => (
            <li key={r.id}>
              <span className="room">{r.room || "s/a"}</span>
              <div className="grow">
                <div className="name">{r.guest}</div>
                <div className="muted small">
                  {r.reservation} · {r.roomTypeReserved}
                  {r.roomTypeOccupied && r.roomTypeOccupied !== r.roomTypeReserved ? ` → ${r.roomTypeOccupied}` : ""} ·{" "}
                  {r.entity}
                </div>
              </div>
              {kind === "departure" ? (
                <div className="right">
                  {r.totalExtras ? <div className="num small">Extras {fmtMoney(r.totalExtras, "PEN")}</div> : null}
                  {r.pendingInvoice ? <span className="pill pill-pending">Factura pendiente</span> : null}
                </div>
              ) : (
                <span className="muted small nowrap">{fmtDate(r.departureAt)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function MoveList({ title, sub, rows, showStatus }) {
  return (
    <Card title={title} sub={sub}>
      {!rows ? <div className="skeleton-line" /> : !rows.length ? (
        <p className="muted">Nadie este día.</p>
      ) : (
        <ul className="moves">
          {rows.map((g) => (
            <li key={g.id}>
              <span className="room">{g.roomNumber}</span>
              <div className="grow">
                <div className="name">{g.fullName}</div>
                <div className="muted small">{g.country} · {g.entity} · {g.roomType}</div>
              </div>
              {showStatus && (
                <span className={`pill ${g.inHouse ? "pill-pending" : "pill-done"}`}>
                  {g.inHouse ? "Pendiente" : "Salió"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------ Sincronización ------------------------------ */

function Sync({ status, onSynced }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const s = status.data;
  const t = s?.token;
  const minsLeft = useMemo(
    () => (t?.expiresAt ? Math.round((new Date(t.expiresAt) - Date.now()) / 60000) : null),
    [t?.expiresAt, s]
  );

  const run = async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r.ok === false ? { err: r.error } : { ok: ok(r) });
      onSynced();
    } catch (e) {
      setMsg({ err: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack narrow">
      <Card title="Conexión con NewHotel">
        <dl className="dl">
          <dt>Hotel</dt><dd>{t?.hotelName || "—"}</dd>
          <dt>Usuario</dt><dd>{t?.userName || "—"}</dd>
          <dt>Token</dt>
          <dd>
            {!t ? "Sin token" : minsLeft > 0 ? `Válido · caduca en ${minsLeft} min (se renueva en cada sincronización)` : "Caducado"}
          </dd>
          <dt>Login automático</dt>
          <dd>{s?.autoLogin ? "Activo: si el token caduca, inicia sesión solo" : "No configurado (faltan NEWHOTEL_EMAIL / NEWHOTEL_PASSWORD)"}</dd>
          <dt>Última sincronización</dt><dd>{fmtDateTime(s?.lastSyncAt)}</dd>
          <dt>Frecuencia</dt><dd>Cada {s?.syncIntervalMinutes} min</dd>
          <dt>Registros guardados</dt><dd>{s?.totals.total ?? 0} huéspedes ({s?.totals.inHouse ?? 0} en casa)</dd>
          {s?.backup && <>
            <dt>Copia de seguridad</dt>
            <dd>
              {s.backup.last?.ok ? `${fmtDateTime(s.backup.last.at)} · ${(s.backup.last.bytes / 1048576).toFixed(1)} MB` : "Todavía ninguna"}
              {s.backup.last?.lastError && <span className="msg err"> · falló la última: {s.backup.last.lastError.error}</span>}
              <br /><small className="muted">{s.backup.dir}</small>
            </dd>
          </>}
          {s?.access && <>
            <dt>Acceso</dt>
            <dd>{s.access.mode === "open" ? "Sin login" : "Con usuario de NewHotel"} · desde {s.access.networks.join(", ")}</dd>
          </>}
        </dl>
        <div className="actions">
          <button className="btn primary" disabled={busy}
            onClick={() => run(api.sync, (r) => `${r.guests.fetched} huéspedes · ${r.panel.arrival} llegadas y ${r.panel.departure} salidas pendientes · ${r.accounts.accounts} cuentas (${r.accounts.movements} movimientos) · ${r.operations.rooms} habitaciones · ${r.operations.reservations} reservas próximas · previsión de ${r.dashboard.forecastDays} días`)}>
            {busy ? "Sincronizando…" : "Sincronizar ahora"}
          </button>
        </div>
        {msg && <p className={msg.err ? "msg err" : "msg ok"}>{msg.err || msg.ok}</p>}
      </Card>

      <Card title="Pegar token nuevo" sub="Solo si la sincronización falla por token caducado.">
        <form className="token-form" onSubmit={(e) => (e.preventDefault(), run(() => api.setToken(token), () => (setToken(""), "Token guardado")))}>
          <textarea rows={3} placeholder="Bearer eyJhbGciOi…" value={token} onChange={(e) => setToken(e.target.value)}
            autoComplete="off" spellCheck={false} />
          <button className="btn" disabled={busy || !token}>Guardar token</button>
        </form>
      </Card>

      <Card title="Historial de sincronizaciones">
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Inicio</th><th>Módulo</th><th>Estado</th><th className="num">Recibidos</th><th className="num">Nuevos</th><th className="num">Salidas</th></tr></thead>
            <tbody>
              {s?.runs.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.startedAt)}</td>
                  <td>{{ guests: "Huéspedes", dashboard: "Ocupación", panel: "Llegadas/salidas", accounts: "Cuentas", operations: "Hab./reservas/planning" }[r.module] || r.module}</td>
                  <td>{r.status === "ok" ? "✓ OK" : r.status === "running" ? "En curso" : <span title={r.error}>✕ {r.error}</span>}</td>
                  <td className="num">{r.fetched}</td><td className="num">{r.inserted}</td><td className="num">{r.departed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------- Contingencia ------------------------------- */

function Contingency({ stamp }) {
  const { data, error } = useLoad(api.contingency, [stamp]);
  if (error && !data) return <Empty title="Sin copia disponible" text={error.message} />;
  if (!data) return <Skeleton />;
  const o = data.occupancy;
  const ageMin = data.dataAsOf ? Math.round((Date.now() - new Date(data.dataAsOf)) / 60000) : null;
  const stale = ageMin == null || ageMin > 30;

  return (
    <div className="stack report">
      <div className="report-head">
        <div>
          <h1>Informe de contingencia</h1>
          <p className="muted">
            Datos de NewHotel a las {fmtDateTime(data.dataAsOf)}
            {ageMin != null && ` (hace ${ageMin} min)`} · generado {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <button className="btn primary no-print print-btn" onClick={() => window.print()}>Imprimir / PDF</button>
      </div>

      {stale && (
        <div className="alert">
          ⚠ La última copia tiene más de 30 minutos. Si NewHotel está caído, estos son los últimos datos guardados:
          revisa con la habitación antes de cobrar o asignar.
        </div>
      )}

      {o && (
        <div className="report-kpis">
          <span><strong>{o.occupancyPercent.toFixed(1)}%</strong> ocupación</span>
          <span><strong>{o.roomsOccupied}</strong>/{o.inventory} hab.</span>
          <span><strong>{data.arrivals.length}</strong> llegadas pendientes</span>
          <span><strong>{data.departures.length}</strong> salidas pendientes</span>
          <span><strong>{o.cleanRooms}</strong> limpias</span>
        </div>
      )}

      <section className="card">
        <header className="card-head"><h2>Llegadas pendientes · {data.arrivals.length}</h2></header>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Hab.</th><th>Huésped</th><th>Reserva</th><th>Tipo</th><th>Salida</th><th>Pax</th><th>Agencia</th></tr></thead>
            <tbody>
              {data.arrivals.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.room || "s/a"}</strong></td><td>{r.guest}</td><td>{r.reservation}</td>
                  <td>{r.roomTypeReserved}</td><td>{fmtDate(r.departureAt)}</td><td>{(r.paxs || "").split(" ")[0]}</td><td>{r.entity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h2>Salidas pendientes · {data.departures.length}</h2></header>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Hab.</th><th>Huésped</th><th>Reserva</th><th>Llegó</th><th>Agencia</th><th className="num">Extras</th><th className="num">Saldo</th><th>Factura</th></tr></thead>
            <tbody>
              {data.departures.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.room}</strong></td><td>{r.guest}</td><td>{r.reservation}</td>
                  <td>{fmtDate(r.arrivalAt)}</td><td>{r.entity}</td>
                  <td className="num">{r.totalExtras ? fmtMoney(r.totalExtras, "PEN") : "—"}</td>
                  <td className="num">{r.balance != null ? fmtMoney(r.balance, "PEN") : "—"}</td>
                  <td>{r.pendingInvoice ? "Pendiente" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <header className="card-head"><h2>Habitaciones ocupadas · {data.inHouse.length}</h2></header>
        <div className="table-wrap">
          <table className="table compact">
            <thead><tr><th>Hab.</th><th>Huéspedes</th><th>Reserva</th><th>Llegada</th><th>Salida</th><th>Agencia</th><th>Tarifa</th><th>Rég.</th></tr></thead>
            <tbody>
              {data.inHouse.map((r) => (
                <tr key={`${r.roomNumber}-${r.reservation}`}>
                  <td><strong>{r.roomNumber}</strong></td><td>{r.names}</td><td>{r.reservation}</td>
                  <td>{fmtDate(r.arrival)}</td><td>{fmtDate(r.departure)}</td><td>{r.entity}</td>
                  <td className="nowrap">{r.rateText}</td><td>{r.pension}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {data.balances?.length > 0 && (
        <section className="card">
          <header className="card-head"><h2>Saldos pendientes · {data.balances.length} cuentas</h2></header>
          <div className="table-wrap">
            <table className="table compact">
              <thead><tr><th>Hab.</th><th>Huésped</th><th>Reserva</th><th>Sale</th><th>Entidad</th><th className="num">Master</th><th className="num">Extras</th><th className="num">Saldo</th></tr></thead>
              <tbody>
                {data.balances.map((b) => (
                  <tr key={`${b.room}-${b.reservation}`}>
                    <td><strong>{b.room}</strong></td><td>{b.guest || b.holder}</td><td>{b.reservation}</td>
                    <td>{fmtDate(b.departure)}</td><td>{b.company}</td>
                    <td className="num">{fmtMoney(b.masterAmount, "PEN")}</td><td className="num">{fmtMoney(b.extrasAmount, "PEN")}</td>
                    <td className="num"><strong>{fmtMoney(b.totalAmount, "PEN")}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">El detalle de cargos y pagos de cada cuenta está en Movimientos › Cuentas Corrientes.</p>
        </section>
      )}
    </div>
  );
}

/* --------------------------------- Comunes ---------------------------------- */

function Empty({ title, text }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p className="muted">{text}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="kpis">
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="kpi skeleton" />)}
    </div>
  );
}
