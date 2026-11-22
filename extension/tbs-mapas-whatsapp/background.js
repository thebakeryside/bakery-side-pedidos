// TBS · Mapas de WhatsApp
// La app de WhatsApp para computadora abre las ubicaciones en el navegador (Google Maps o Bing Maps).
// Esta extensión detecta esos mapas y, en su lugar, abre Cocina → "＋ Pedido WhatsApp" con la ubicación.
// Solo actúa en mapas que abrió OTRA aplicación (la petición no viene de una página) (no en mapas que se abren desde una pestaña de Chrome,
// como el botón "Mapa" de Cocina) y solo con coordenadas de Ecuador.

const SITE = "https://thebakeryside.com";
const COCINA = [`${SITE}/cocina*`, "https://www.thebakeryside.com/cocina*"];
const done = new Map(); // pestaña → enlace ya enviado (evita repetir con las redirecciones de Google)

// ---------- coordenadas dentro del enlace ----------
const inEcuador = (lat, lng) => lat > -5.2 && lat < 1.6 && lng > -81.3 && lng < -75;
function coordsFrom(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, "");
  const google = /(^|\.)google\.[a-z.]+$/.test(host) && (host.startsWith("maps.") || u.pathname.startsWith("/maps"));
  const bing = /(^|\.)bing\.com$/.test(host) && u.pathname.startsWith("/maps");
  const apple = host === "maps.apple.com";
  if (!google && !bing && !apple) return null;
  const p = u.searchParams;
  const path = (() => { try { return decodeURIComponent(u.pathname.replace(/\+/g, " ")); } catch { return u.pathname; } })();
  const placeish = /^\/maps\/(place|search|dir)\//.test(path) || apple;
  const cands = [p.get("q"), p.get("query"), p.get("ll"), p.get("center"), p.get("daddr"), p.get("destination"),
    p.get("cp")?.replace("~", ","), p.get("sp")?.replace(/^point\./, "").replace("_", ","), p.get("where1"),
    placeish ? path : null];
  for (const c of cands) {
    if (!c) continue;
    const t = String(c);
    const m = t.match(/(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})/);
    if (m) { const lat = Number(m[1]), lng = Number(m[2]); if (inEcuador(lat, lng)) return { lat, lng }; }
    // 2°09'03.9"S 79°53'40.6"W
    const d = t.match(/(\d{1,2})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([NS])[\s,]*(\d{1,3})°\s*(\d{1,2})['′]\s*([\d.]+)["″]?\s*([EWO])/i);
    if (d) {
      const lat = (+d[1] + d[2] / 60 + d[3] / 3600) * (/s/i.test(d[4]) ? -1 : 1);
      const lng = (+d[5] + d[6] / 60 + d[7] / 3600) * (/[wo]/i.test(d[8]) ? -1 : 1);
      if (inEcuador(lat, lng)) return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) };
    }
  }
  return null;
}

// ---------- abrir en Cocina ----------
async function enabled() { const { off } = await chrome.storage.local.get("off"); return !off; }

async function toCocina(mapTabId, c) {
  const text = `${c.lat}, ${c.lng}`;
  const [tab] = await chrome.tabs.query({ url: COCINA });
  if (tab) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: (u) => window.dispatchEvent(new CustomEvent("tbs-ubicacion", { detail: u })), args: [text],
      });
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.remove(mapTabId).catch(() => {});
      return "enviado a la pestaña de Cocina";
    } catch { /* si Cocina no responde, se abre en la misma pestaña del mapa */ }
  }
  await chrome.tabs.update(mapTabId, { url: `${SITE}/cocina?ubicacion=${encodeURIComponent(text)}`, active: true });
  return "Cocina abierta en la pestaña del mapa";
}

const log = (last) => chrome.storage.local.set({ last: { at: new Date().toLocaleString("es-EC"), ...last } });

// Se decide con la petición de la página: si la abrió una página (ej.: el botón "Mapa" de Cocina) trae "initiator";
// si llegó desde otra aplicación (WhatsApp) no lo trae.
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0) return;
  const c = coordsFrom(d.url);
  if (!c) return;
  if (d.initiator) { log({ url: d.url, coords: c, result: `abierto desde ${d.initiator}: se deja el mapa` }); return; }
  if (done.has(d.tabId)) return;
  done.set(d.tabId, d.url); setTimeout(() => done.delete(d.tabId), 30000); // las redirecciones de Google no lo repiten
  (async () => {
    if (!(await enabled())) return log({ url: d.url, coords: c, result: "en pausa" });
    try { const how = await toCocina(d.tabId, c); log({ url: d.url, coords: c, result: how }); }
    catch (e) { log({ url: d.url, coords: c, result: "error: " + (e?.message || e) }); }
  })();
}, { urls: ["*://*.google.com/*", "*://*.google.com.ec/*", "*://*.bing.com/*", "*://maps.apple.com/*"], types: ["main_frame"] });

// ---------- clic en el ícono: pausar / activar ----------
async function paint() {
  const on = await enabled();
  chrome.action.setBadgeText({ text: on ? "" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#C68A4E" });
  const { last } = await chrome.storage.local.get("last");
  const tail = last ? `\nÚltimo mapa (${last.at}): ${last.result || (last.coords ? "ubicación leída" : "sin coordenadas")}\n${String(last.url).slice(0, 180)}` : "";
  chrome.action.setTitle({ title: (on ? "TBS · Mapas de WhatsApp: activado (clic para pausar)" : "TBS · Mapas de WhatsApp: en pausa (clic para activar)") + tail });
}
chrome.action.onClicked.addListener(async () => { await chrome.storage.local.set({ off: await enabled() }); paint(); });
chrome.runtime.onStartup.addListener(paint);
chrome.runtime.onInstalled.addListener(paint);
chrome.storage.onChanged.addListener((ch) => { if (ch.last) paint(); });
