// Paneles como app instalable + avisos en el celular (cocina, moto y master)
import { sb, toast } from "./common.js";
import { API_URL, SUPABASE_KEY } from "./config.js";

const PUSH_URL = API_URL.replace(/\/api\/?$/, "/push");
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushOK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const b64ToBytes = (s) => {
  const b = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function call(action, body = {}, auth = false) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_KEY };
  if (auth) { const { data } = await sb.auth.getSession(); if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`; }
  const r = await fetch(PUSH_URL, { method: "POST", headers, body: JSON.stringify({ action, ...body }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "No pudimos conectar con los avisos.");
  return j;
}

let started = false;
export async function setupApp(panel, user) {
  if (started) return; started = true;
  const who = document.querySelector(".who");
  const logout = document.getElementById("logout");
  const mk = (id, txt) => { const b = document.createElement("button"); b.type = "button"; b.id = id; b.className = "btn small ghost"; b.textContent = txt; who.insertBefore(b, logout); return b; };
  const installBtn = mk("installApp", "Instalar app"); installBtn.hidden = true;
  const bell = mk("bell", "Activar avisos");

  let reg = null;
  if ("serviceWorker" in navigator) {
    try { reg = await navigator.serviceWorker.register("/sw.js"); } catch { /* sin service worker */ }
  }

  // Instalar como app (Android / computadora). En iPhone se hace desde Compartir.
  let deferred = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; installBtn.hidden = false; });
  addEventListener("appinstalled", () => { installBtn.hidden = true; toast("App instalada. Ábrela desde tu pantalla de inicio."); });
  installBtn.onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; installBtn.hidden = true; };
  if (isIOS && !standalone) { installBtn.hidden = false; installBtn.onclick = () => help(); }

  const help = () => toast(isIOS
    ? "En iPhone: toca Compartir ⬆️ → «Agregar a pantalla de inicio». Abre la app desde ahí y activa los avisos."
    : "Instala la app desde el menú del navegador (⋮ → Instalar app) y luego activa los avisos.", 7000);

  async function current() { return reg ? await reg.pushManager.getSubscription() : null; }
  async function paint() {
    if (!pushOK || !reg) { bell.textContent = "Avisos"; bell.dataset.state = "help"; return; }
    if (Notification.permission === "denied") { bell.textContent = "Avisos bloqueados"; bell.dataset.state = "denied"; return; }
    const sub = await current();
    bell.textContent = sub && Notification.permission === "granted" ? "🔔 Avisos activos" : "🔔 Activar avisos";
    bell.dataset.state = sub ? "on" : "off";
  }

  async function subscribe() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { await paint(); return toast("Sin permiso no podemos avisarte. Puedes activarlo en los ajustes del navegador."); }
    const { publicKey } = await call("key");
    let sub = await current();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    const k = sub.toJSON().keys;
    const { error } = await sb.from("push_subscriptions").upsert({
      user_id: user.id, panel, endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth, user_agent: navigator.userAgent.slice(0, 200),
    }, { onConflict: "endpoint" });
    if (error) throw new Error(/push_subscriptions/.test(error.message) ? "Falta activar los avisos en la base de datos (009). Avísale al master." : error.message);
    await paint();
    await call("test", { panel }, true).catch(() => {});
    toast("Listo. Te llegará un aviso de prueba.");
  }

  bell.onclick = async () => {
    const st = bell.dataset.state;
    if (st === "help") return help();
    if (st === "denied") return toast("Los avisos están bloqueados. Actívalos en los ajustes del navegador para este sitio.", 6000);
    bell.disabled = true;
    try {
      if (st === "on") { const r = await call("test", { panel }, true); toast(r.sent ? "Aviso de prueba enviado." : "No encontramos este dispositivo. Toca de nuevo para activarlo."); if (!r.sent) { await (await current())?.unsubscribe(); } }
      else await subscribe();
    } catch (e) { toast(e.message); }
    bell.disabled = false; await paint();
  };
  await paint();
  // si ya estaba suscrito, refresca a quién pertenece este dispositivo
  const sub = await current();
  if (sub && Notification.permission === "granted") {
    const k = sub.toJSON().keys;
    sb.from("push_subscriptions").upsert({ user_id: user.id, panel, endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: "endpoint" }).then(() => {});
  }
}
