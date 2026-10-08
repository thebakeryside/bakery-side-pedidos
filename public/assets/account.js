// Cuenta del cliente (Google), tarjeta de sellos y referidos
import { sb, api, esc } from "./common.js";
import { GOOGLE_CLIENT_ID } from "./config.js";

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

// Tarjeta de sellos: como una tarjeta de cafetería. Cada sello ganado lleva la S de la marca;
// la última casilla es la cookie de regalo.
const COOKIE = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="19" fill="#D9A06A" stroke="#1C1714" stroke-width="2.5"/><circle cx="17" cy="18" r="3" fill="#1C1714"/><circle cx="29" cy="15" r="2.4" fill="#1C1714"/><circle cx="31" cy="27" r="3.2" fill="#1C1714"/><circle cx="19" cy="31" r="2.6" fill="#1C1714"/><circle cx="25" cy="23" r="1.8" fill="#1C1714"/></svg>`;
export function stampCard(stamps, { compact = false } = {}) {
  const n = Math.max(0, Math.min(STAMPS_TOTAL, stamps));
  const left = STAMPS_TOTAL - n;
  const dots = Array.from({ length: STAMPS_TOTAL }, (_, i) => {
    const on = i < n, last = i === STAMPS_TOTAL - 1;
    if (last) return `<li class="stamp goal ${on ? "on" : ""}" style="--i:${i}" aria-hidden="true">${COOKIE}<small>Gratis</small></li>`;
    return `<li class="stamp ${on ? "on" : ""}" style="--i:${i}" aria-hidden="true">${on ? `<img src="/assets/brand/s-crema.svg" alt="">` : `<span>${i + 1}</span>`}</li>`;
  }).join("");
  const msg = left === 0 ? "¡Completaste tu tarjeta! Tu cookie te espera en el próximo pedido."
    : left === 1 ? "¡Solo te falta 1 sello para tu cookie gratis!"
    : `Llevas <b>${n}</b> de ${STAMPS_TOTAL}. Te faltan ${left} sellos para tu cookie gratis.`;
  return `<div class="stampcard ${compact ? "compact" : ""}" role="img" aria-label="Tarjeta de sellos: ${n} de ${STAMPS_TOTAL}. ${left ? `Faltan ${left} para una cookie gratis` : "Completa"}">
    <div class="stampcard-head"><img class="sc-logo" src="/assets/brand/tbs-tinta.svg" alt=""><span class="sc-title">Tarjeta de sellos</span></div>
    <ol class="stamps">${dots}</ol>
    <div class="sc-bar" aria-hidden="true"><span style="width:${(n / STAMPS_TOTAL) * 100}%"></span></div>
    <p class="stampnote">${msg}</p>
    <ul class="sc-rules"><li><b>$10</b> en tu pedido = 1 sello</li><li><b>8 sellos</b> = 1 cookie gratis</li></ul>
  </div>`;
}

// Cuántos sellos da un pedido (1 por cada $10 en productos, sin envío)
export const stampsFor = (subtotal) => Math.floor(Math.max(0, subtotal) / 10);

// Botón oficial de Google: el ingreso ocurre en esta página, así Google muestra thebakeryside.com
export const googleButton = () => `<div class="gsi-slot" data-gsi></div>`;

let gsiLoading;
function loadGsi() {
  if (window.google?.accounts?.id) return Promise.resolve();
  gsiLoading ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = ok; s.onerror = () => fail(new Error("No pudimos cargar el ingreso con Google."));
    document.head.append(s);
  });
  return gsiLoading;
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Dibuja el botón dentro de cada [data-gsi] de `root` y llama onSignedIn() al entrar
export async function mountGoogle(root, onSignedIn, onError = () => {}) {
  const slots = [...root.querySelectorAll("[data-gsi]")];
  if (!slots.length) return;
  try {
    await loadGsi();
    const raw = crypto.randomUUID() + crypto.randomUUID();
    const hashed = await sha256Hex(raw);
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      nonce: hashed,
      use_fedcm_for_button: true,
      callback: async ({ credential }) => {
        const { error } = await sb.auth.signInWithIdToken({ provider: "google", token: credential, nonce: raw });
        if (error) return onError(new Error("No pudimos iniciar sesión con Google. Intenta de nuevo."));
        cache = null;
        onSignedIn();
      },
    });
    for (const el of slots) {
      el.innerHTML = "";
      window.google.accounts.id.renderButton(el, { theme: "filled_black", size: "large", shape: "pill", text: "continue_with", locale: "es", width: Math.min(320, Math.max(220, el.clientWidth || 300)) });
    }
  } catch (e) {
    // Respaldo: el ingreso por redirección de siempre
    for (const el of slots) {
      el.innerHTML = `<button class="btn gbtn" type="button">Continuar con Google</button>`;
      el.querySelector("button").onclick = () => signInWithGoogle().catch(onError);
    }
  }
}
