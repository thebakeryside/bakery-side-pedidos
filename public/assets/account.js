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
// la última casilla es el postre sorpresa (un regalo con signo de pregunta).
const GIFT = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="20" width="32" height="20" rx="3" fill="#D9A06A" stroke="#1C1714" stroke-width="2.5"/><rect x="6" y="13" width="36" height="8" rx="2" fill="#C68A4E" stroke="#1C1714" stroke-width="2.5"/><path d="M24 13v27" stroke="#1C1714" stroke-width="2.5"/><path d="M24 13c-3-6-10-6-9-1s9 1 9 1zm0 0c3-6 10-6 9-1s-9 1-9 1z" fill="#F6F7DE" stroke="#1C1714" stroke-width="2.2" stroke-linejoin="round"/><text x="24" y="36" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="11" fill="#1C1714">?</text></svg>`;
export function stampCard(stamps, { compact = false } = {}) {
  const n = Math.max(0, Math.min(STAMPS_TOTAL, stamps));
  const left = STAMPS_TOTAL - n;
  const dots = Array.from({ length: STAMPS_TOTAL }, (_, i) => {
    const on = i < n, last = i === STAMPS_TOTAL - 1;
    if (last) return `<li class="stamp goal ${on ? "on" : ""}" style="--i:${i}" aria-hidden="true">${GIFT}<small>Sorpresa</small></li>`;
    return `<li class="stamp ${on ? "on" : ""}" style="--i:${i}" aria-hidden="true">${on ? `<img src="/assets/brand/s-tinta.svg" alt="">` : `<span>${i + 1}</span>`}</li>`;
  }).join("");
  const msg = left === 0 ? "¡Completaste tu tarjeta! Tu postre sorpresa te espera en el próximo pedido."
    : left === 1 ? "¡Solo te falta 1 sello para tu postre sorpresa!"
    : `Llevas <b>${n}</b> de ${STAMPS_TOTAL}. Te faltan ${left} sellos para tu postre sorpresa.`;
  return `<div class="stampcard ${compact ? "compact" : ""}" role="img" aria-label="Tarjeta de sellos: ${n} de ${STAMPS_TOTAL}. ${left ? `Faltan ${left} para un postre sorpresa` : "Completa"}">
    <div class="stampcard-head"><img class="sc-logo" src="/assets/brand/tbs-tinta.svg" alt=""><span class="sc-title">Tarjeta de sellos</span></div>
    <ol class="stamps">${dots}</ol>
    <div class="sc-bar" aria-hidden="true"><span style="width:${(n / STAMPS_TOTAL) * 100}%"></span></div>
    <p class="stampnote">${msg}</p>
    <ul class="sc-rules"><li><b>$10</b> en productos = 1 sello</li><li><b>8 sellos</b> = 1 postre sorpresa</li></ul>
  </div>`;
}

// Cuántos sellos da un pedido (1 por cada $10 en productos, sin envío)
export const stampsFor = (subtotal) => Math.floor(Math.max(0, subtotal) / 10);

// Botón oficial de Google: el ingreso ocurre en esta página, así Google muestra thebakeryside.com
export const googleButton = (theme = "filled_black") => `<div class="gsi-slot" data-gsi data-theme="${theme}"></div>`;

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
      window.google.accounts.id.renderButton(el, { theme: el.dataset.theme || "filled_black", size: "large", shape: "pill", text: "continue_with", locale: "es", width: Math.min(320, Math.max(220, el.clientWidth || 300)) });
    }
  } catch (e) {
    // Respaldo: el ingreso por redirección de siempre
    for (const el of slots) {
      el.innerHTML = `<button class="btn gbtn" type="button">Continuar con Google</button>`;
      el.querySelector("button").onclick = () => signInWithGoogle().catch(onError);
    }
  }
}
