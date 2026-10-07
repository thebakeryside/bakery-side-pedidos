// Cuenta del cliente (Google), tarjeta de sellos y referidos
import { sb, api, esc } from "./common.js";

export const STAMPS_TOTAL = 8;
const REF_KEY = "tbs_ref";

// Guarda el código de quien invitó (?ref=ABC123) para usarlo al crear la cuenta
export function captureRef() {
  const r = new URLSearchParams(location.search).get("ref");
  if (r && /^[A-Za-z0-9]{6}$/.test(r)) try { localStorage.setItem(REF_KEY, r.toUpperCase()); } catch {}
}
export const storedRef = () => { try { return localStorage.getItem(REF_KEY) || undefined; } catch { return undefined; } };

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  const u = data.session?.user;
  // Solo las cuentas de Google son cuentas de cliente (cocina y motorizados entran con correo)
  const providers = u?.app_metadata?.providers ?? [u?.app_metadata?.provider];
  return u && providers.includes("google") ? u : null;
}

let cache = null;
export async function loadAccount(force = false) {
  const u = await currentUser();
  if (!u) return (cache = null);
  if (cache && !force) return cache;
  cache = await api("perfil", { ref: storedRef() });
  try { localStorage.removeItem(REF_KEY); } catch {}
  return cache;
}
export const setAccount = (a) => (cache = a);

export async function signInWithGoogle(returnTo = location.href) {
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: returnTo } });
  if (error) throw new Error("No pudimos abrir el ingreso con Google. Intenta de nuevo.");
}
export async function signOut() { await sb.auth.signOut(); cache = null; }

// Tarjeta de sellos: 8 círculos; los ganados se llenan con el monograma de la marca
export function stampCard(stamps, { compact = false } = {}) {
  const n = Math.max(0, Math.min(STAMPS_TOTAL, stamps));
  const dots = Array.from({ length: STAMPS_TOTAL }, (_, i) => {
    const on = i < n, last = i === STAMPS_TOTAL - 1;
    return `<li class="stamp ${on ? "on" : ""} ${last ? "goal" : ""}" style="--i:${i}" aria-hidden="true">${on ? "TBS" : last ? "Gratis" : i + 1}</li>`;
  }).join("");
  const left = STAMPS_TOTAL - n;
  return `<div class="stampcard ${compact ? "compact" : ""}" role="img" aria-label="Tarjeta de sellos: ${n} de ${STAMPS_TOTAL}">
    <div class="stampcard-head"><span class="display">Tarjeta de sellos</span><span class="stampcount tabnum">${n}/${STAMPS_TOTAL}</span></div>
    <ol class="stamps">${dots}</ol>
    <p class="stampnote">${left ? `Te ${left === 1 ? "falta 1 sello" : `faltan ${left} sellos`} para una cookie gratis. Ganas 1 sello por cada $10.` : "¡Completaste tu tarjeta!"}</p>
  </div>`;
}

// Cuántos sellos da un pedido (1 por cada $10 en productos, sin envío)
export const stampsFor = (subtotal) => Math.floor(Math.max(0, subtotal) / 10);

export function googleButton(label = "Continuar con Google") {
  return `<button class="btn gbtn" type="button" data-google>
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
    <span>${esc(label)}</span></button>`;
}
