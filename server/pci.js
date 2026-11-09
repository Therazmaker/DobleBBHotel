// Enmascarado de números de tarjeta (PCI DSS): nunca guardamos un PAN completo.
// El personal a veces escribe la tarjeta de garantía en observaciones/comentarios de NewHotel.
// Cualquier secuencia de 13-19 dígitos (con espacios o guiones) que pase Luhn se reduce a los 4 últimos.
// Bordes: no puede ir pegado a letras/dígitos ni unido con guion a ellos (evita UUIDs, códigos, etc.).
const CANDIDATE = /(?<![A-Za-z0-9])(?<![A-Za-z0-9]-)(?<!\d[.,])(?:\d[ -]?){12,18}\d(?![A-Za-z0-9])(?!-[A-Za-z0-9])/g;

function luhn(digits) {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function maskPan(text) {
  if (typeof text !== "string" || text.length < 13) return text;
  return text.replace(CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    return `•••• •••• •••• ${digits.slice(-4)}`;
  });
}

/** Aplica maskPan a todos los strings de un objeto (para el JSON crudo). */
export function scrub(value) {
  if (typeof value === "string") return maskPan(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v);
    return out;
  }
  return value;
}
