import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY, API_URL } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export async function api(action, body = {}) {
  let r;
  const { data } = await sb.auth.getSession();
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  try {
    r = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new Error("Sin conexión. Revisa tu internet e inténtalo de nuevo.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "Tuvimos un problema. Intenta de nuevo.");
  return j;
}

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const money = (n) => "$" + Number(n).toFixed(2);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TZ = "America/Guayaquil";
export const hhmm = (d) => new Date(d).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
export const dayLabel = (d) => {
  const f = (x) => new Date(x).toLocaleDateString("es-EC", { timeZone: TZ });
  const now = Date.now();
  if (f(d) === f(now)) return "Hoy";
  if (f(d) === f(now + 86400000)) return "Mañana";
  return new Date(d).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "short", timeZone: TZ });
};
export const when = (d) => `${dayLabel(d)} ${hhmm(d)}`;
// Rango de entrega que ve el cliente: "10h15 – 10h45".
// Para "lo antes posible" el inicio se redondea hacia arriba a los 15 min; para agendados es la franja elegida.
export const hm = (d) => hhmm(d).replace(":", "h");
export function etaRange(iso, { window = 30, exact = false } = {}) {
  const t = new Date(iso).getTime(), start = exact ? t : Math.ceil(t / 900000) * 900000;
  return `${hm(start)} – ${hm(start + window * 60000)}`;
}
export const orderRange = (o, window = 30) => o.scheduled_for ? etaRange(o.scheduled_for, { window, exact: true }) : o.eta ? etaRange(o.eta, { window }) : "";

// Fecha y hora de Guayaquil (UTC−5, sin horario de verano) → ISO UTC
export function localToISO(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00-05:00`).toISOString();
}
export function todayLocal(offsetDays = 0) {
  const d = new Date(Date.now() - 5 * 3600000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}

export function toast(msg, ms = 2800) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.append(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

export const waLink = (phone, text) => {
  const p = String(phone || "").replace(/\D/g, "").replace(/^0/, "593");
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
};

export const STATUS = {
  pendiente_pago: "Esperando pago",
  por_confirmar: "Verificando transferencia",
  confirmado: "Confirmado",
  preparando: "En preparación",
  listo: "Listo para salir",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

// Datos de "Transferencia directa": se guardan como JSON en settings.bank_info
// { holder, email, accounts: [{ bank, type, number }] }. Si hay texto antiguo, se interpreta.
export function parseBank(raw) {
  const t = String(raw || "").trim();
  if (!t) return null;
  if (t.startsWith("{")) { try { const j = JSON.parse(t); return { holder: j.holder || "", email: j.email || "", accounts: Array.isArray(j.accounts) ? j.accounts : [] }; } catch {} }
  const lines = t.split("\n").map((l) => l.trim()).filter((l) => l && l !== ".");
  const out = { holder: "", email: "", accounts: [] };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^[^\p{L}\p{N}]+/u, "");
    if (/@/.test(l)) out.email = l;
    else if (/^banco/i.test(l)) { const m = (lines[i + 1] || "").match(/(ahorros|corriente)[^\d]*([\d-]+)/i); out.accounts.push({ bank: l, type: m ? (m[1].toLowerCase() === "corriente" ? "Corriente" : "Ahorros") : "Ahorros", number: m ? m[2] : "" }); if (m) i++; }
    else if (!out.holder && !/^\d+$/.test(l)) out.holder = l;
  }
  return out;
}

// Redes sociales: íconos con enlace (pie de página, pedido entregado y Mi cuenta)
export const SOCIAL = { instagram: "https://www.instagram.com/thebakeryside", tiktok: "https://www.tiktok.com/@thebakeryside", handle: "@thebakeryside" };
const ICONS = {
  instagram: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg>`,
  tiktok: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M14 2.5h3.1a4.6 4.6 0 0 0 4.1 4.1v3.1a7.7 7.7 0 0 1-4.1-1.3v6.6a6.3 6.3 0 1 1-6.3-6.3h.6v3.2h-.6a3.1 3.1 0 1 0 3.2 3.1z"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.8-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2s.2-1.1.1-1.2l-.5-.3z"/></svg>`,
};
export function socialLinks(whatsapp) {
  const items = [["instagram", "Instagram", SOCIAL.instagram], ["tiktok", "TikTok", SOCIAL.tiktok]];
  if (whatsapp) items.push(["whatsapp", "WhatsApp", waLink(whatsapp, "Hola The Bakery Side, tengo una consulta 🙂")]);
  return items.map(([k, label, href]) => `<a class="soc soc-${k}" href="${href}" target="_blank" rel="noopener" aria-label="${label} de The Bakery Side">${ICONS[k]}<span>${label}</span></a>`).join("");
}
// Llena cada [data-social] de la página
export function mountSocial(whatsapp) {
  document.querySelectorAll("[data-social]").forEach((el) => (el.innerHTML = socialLinks(whatsapp)));
}
