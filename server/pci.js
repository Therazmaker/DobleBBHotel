// Enmascarado de números de tarjeta (PCI DSS): nunca guardamos un PAN completo ni el CVV.
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

// Código de seguridad (CVV/CVC/CID): PCI DSS prohíbe guardarlo, ni siquiera cifrado. Se quita entero.
const CVV = /\b(CVV2?|CVC2?|CID|CSC|C[OÓ]D(?:IGO)?\.?\s*(?:DE\s+)?SEG(?:URIDAD)?\.?|SECURITY\s+CODE)(\s*[:#.=-]?\s*)\d{3,4}(?!\d)/gi;

export function maskPan(text) {
  if (typeof text !== "string" || text.length < 6) return text;
  let out = text.replace(CVV, (_m, label, sep) => `${label}${sep}•••`);
  if (out.length < 13) return out;
  return out.replace(CANDIDATE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19 || !luhn(digits)) return m;
    return `•••• •••• •••• ${digits.slice(-4)}`;
  });
}

// Campos que son identificadores internos de NewHotel, nunca tarjetas. Un número largo puede
// pasar Luhn por casualidad (1 de cada 10), así que en estos campos no se enmascara.
const ID_KEY = /(?:^id|Id|ID|Uuid|SerieNumber)$/;

/** Aplica maskPan a todos los strings de un objeto (para el JSON crudo). */
export function scrub(value) {
  if (typeof value === "string") return maskPan(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = ID_KEY.test(k) && typeof v === "string" ? v : scrub(v);
    return out;
  }
  return value;
}
