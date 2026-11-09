// Gráficos ligeros en HTML/CSS: una sola serie por gráfico (un solo color),
// tooltip al pasar el ratón / tocar, y valor visible en cada barra.
import React, { useEffect, useRef, useState } from "react";

function useWidth(fallback = 600) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function BarList({ data, total, onSelect }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const sum = total ?? data.reduce((a, d) => a + d.value, 0);
  return (
    <ul className="barlist">
      {data.map((d) => (
        <li key={d.label}>
          <button
            type="button"
            className="barlist-row"
            onClick={onSelect ? () => onSelect(d.label) : undefined}
            disabled={!onSelect}
            title={`${d.label}: ${d.value} (${Math.round((d.value / sum) * 100)}%)`}
          >
            <span className="barlist-label">{d.label}</span>
            <span className="barlist-track">
              <span className="barlist-fill" style={{ width: `${(d.value / max) * 100}%` }} />
            </span>
            <span className="barlist-value">{d.value}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Columns({ data, labelFor, highlight, caption, format = (v) => v, tip, compact = false, refLine }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, refLine ?? 0, ...data.map((d) => d.value));
  return (
    <div className={`columns${compact ? " is-compact" : ""}`} role="img" aria-label={caption}>
      <div className="columns-plot">
        {refLine != null && (
          <div className="columns-ref" style={{ bottom: `${(refLine / max) * 100}%` }}>
            <span>{format(refLine)}</span>
          </div>
        )}
        {data.map((d, i) => (
          <div
            key={d.date}
            className="columns-slot"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}
          >
            {hover === i && (
              <div className="tooltip">
                <strong>{format(d.value)}</strong> · {labelFor(d.date, true)}
                {tip && <div className="tooltip-sub">{tip(d)}</div>}
              </div>
            )}
            {!compact && <span className="columns-value">{d.value ? format(d.value) : ""}</span>}
            <div
              className={`columns-bar${refLine != null && d.value > refLine ? " is-over" : ""}${highlight === d.date ? " is-hl" : ""}${hover === i ? " is-hover" : ""}`}
              style={{ height: `${(d.value / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="columns-axis">
        {data.map((d, i) => (
          <span key={d.date} className={highlight === d.date ? "is-hl" : ""}>
            {!compact || i % 7 === 0 ? labelFor(d.date) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ data, field }) {
  if (data.length < 2) return null;
  const vals = data.map((d) => d[field] ?? 0);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  const w = 100;
  const h = 28;
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / Math.max(1, max - min)) * (h - 4) - 2}`)
    .join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ------------------------- Componentes del Sumario ------------------------- */

/** Barra de progreso con marcador del valor hecho (Check-In / Check-Out). */
export function ProgressMeter({ done, total, tone = "a" }) {
  const pct = total ? (done / total) * 100 : 0;
  return (
    <div className={`meter meter-${tone}`}>
      <div className="meter-marker" style={{ left: `clamp(14px, ${pct}%, calc(100% - 14px))` }}>{done}</div>
      <div className="meter-track" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
        <div className="meter-fill" style={{ width: `${pct}%` }} />
        <span className="meter-label">{pct.toFixed(2)}%</span>
      </div>
    </div>
  );
}

/** Anillo de ocupación. */
export function Donut({ percent, label }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <svg className="donut" viewBox="0 0 100 100" role="img" aria-label={`${label}: ${Math.round(percent)}%`}>
      <circle cx="50" cy="50" r={r} className="donut-track" />
      <circle cx="50" cy="50" r={r} className="donut-value" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="49" className="donut-num">{Math.round(percent)}%</text>
      <text x="50" y="63" className="donut-label">{label}</text>
    </svg>
  );
}

function Legend({ series }) {
  return (
    <div className="legend">
      {series.map((s) => (
        <span key={s.key}><i style={{ background: `var(${s.color})` }} />{s.label}</span>
      ))}
    </div>
  );
}

/** Barras agrupadas (p. ej. llegadas vs salidas por día), con valor sobre cada barra. */
export function GroupedBars({ data, series, labelFor, height = 210 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0)));
  return (
    <div className="gbars">
      <Legend series={series} />
      <div className="gbars-plot" style={{ height }}>
        {data.map((d, i) => (
          <div key={d.date} className={`gbars-group${hover === i ? " is-hover" : ""}`}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(hover === i ? null : i)}>
            {hover === i && (
              <div className="tooltip">
                <strong>{labelFor(d.date, true)}</strong>
                {series.map((s) => <div key={s.key} className="tooltip-sub">{s.label}: {d[s.key]}</div>)}
              </div>
            )}
            {series.map((s) => (
              <div key={s.key} className="gbars-col">
                <span className="gbars-val">{d[s.key]}</span>
                <div className="gbars-bar" style={{ height: `${((d[s.key] ?? 0) / max) * 100}%`, background: `var(${s.color})` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="gbars-axis">
        {data.map((d) => <span key={d.date}>{labelFor(d.date)}</span>)}
      </div>
    </div>
  );
}

/** Líneas (%), con cruz + tooltip al pasar y etiqueta directa al final de cada línea. */
export function LineChart({ data, series, labelFor, axisLabel = labelFor, height = 210, yMax = 100, unit = "%" }) {
  const [hover, setHover] = useState(null);
  const [wrapRef, W] = useWidth();
  const H = height;
  const pad = { l: 30, r: W < 420 ? 96 : 124, t: 10, b: 26 };
  const top = Math.max(yMax, ...data.flatMap((d) => series.map((s) => d[s.key] ?? 0)));
  const x = (i) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, data.length - 1);
  const y = (v) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = [0, 50, 100].filter((t) => t <= top);

  // Etiquetas al final sin solaparse
  const ends = series
    .map((s) => ({ s, v: data.at(-1)?.[s.key] ?? 0 }))
    .sort((a, b) => b.v - a.v)
    .reduce((acc, e) => {
      const yy = y(e.v);
      const prev = acc.at(-1)?.yy;
      acc.push({ ...e, yy: prev != null && yy - prev < 14 ? prev + 14 : yy });
      return acc;
    }, []);

  return (
    <div className="linechart">
      <Legend series={series} />
      <div className="linechart-wrap" ref={wrapRef}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="linechart-svg"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (data.length - 1));
            setHover(Math.max(0, Math.min(data.length - 1, i)));
          }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 100 ? "grid grid-ref" : "grid"} />
              <text x={pad.l - 6} y={y(t) + 4} className="axis-text" textAnchor="end">{t}</text>
            </g>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="crosshair" />}
          {series.map((s) => (
            <polyline key={s.key} fill="none" stroke={`var(${s.color})`} strokeWidth="2"
              strokeLinejoin="round" points={data.map((d, i) => `${x(i)},${y(d[s.key] ?? 0)}`).join(" ")} />
          ))}
          {hover != null && series.map((s) => (
            <circle key={s.key} cx={x(hover)} cy={y(data[hover][s.key] ?? 0)} r="4.5" fill={`var(${s.color})`} className="dot" />
          ))}
          {data.map((d, i) => (
            <text key={d.date} x={x(i)} y={H - 6} className="axis-text" textAnchor="middle">{axisLabel(d.date)}</text>
          ))}
          {ends.map((e) => (
            <text key={e.s.key} x={W - pad.r + 6} y={e.yy + 4} className="end-label">{e.s.label} {Math.round(e.v)}{unit}</text>
          ))}
        </svg>
        {hover != null && (
          <div className="tooltip linechart-tip" style={{ left: Math.min(Math.max(x(hover), 90), W - 90) }}>
            <strong>{labelFor(data[hover].date, true)}</strong>
            {series.map((s) => <div key={s.key} className="tooltip-sub">{s.label}: {(data[hover][s.key] ?? 0).toFixed(2)}{unit}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
