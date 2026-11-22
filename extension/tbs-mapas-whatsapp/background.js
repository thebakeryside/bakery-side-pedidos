// TBS · Mapas de WhatsApp
// La app de WhatsApp para computadora abre las ubicaciones en el navegador (Google Maps o Bing Maps).
// Esta extensión detecta esos mapas y, en su lugar, abre Cocina → "＋ Pedido WhatsApp" con la ubicación.
// Solo actúa en pestañas que abrió OTRA aplicación (sin pestaña de origen) (no en mapas que se abren desde una pestaña de Chrome,
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
      await chrome.tabs.remove(mapTabId);
      return;
    } catch { /* si Cocina no responde, se abre en la misma pestaña del mapa */ }
  }
  await chrome.tabs.update(mapTabId, { url: `${SITE}/cocina?ubicacion=${encodeURIComponent(text)}` });
}

async function handle(tabId, url, why) {
  const c = coordsFrom(url);
  chrome.storage.local.set({ last: { at: new Date().toLocaleString("es-EC"), url, why, coords: c } });
  if (!c || done.has(tabId)) return;
  done.set(tabId, url); setTimeout(() => done.delete(tabId), 30000); // antes de esperar: evita enviarlo dos veces
  let tab; try { tab = await chrome.tabs.get(tabId); } catch { return; }
  if (tab.openerTabId != null) return; // se abrió desde otra pestaña de Chrome: se deja el mapa normal
  if (!(await enabled())) return;
  await toCocina(tabId, c);
}
// Chrome puede avisar la navegación antes de avisar que creó la pestaña: se revisan los dos momentos
chrome.webNavigation.onBeforeNavigate.addListener((d) => { if (d.frameId === 0) handle(d.tabId, d.url, "navegacion"); });
chrome.tabs.onCreated.addListener((t) => { const u = t.pendingUrl || t.url; if (u && t.openerTabId == null) handle(t.id, u, "pestana nueva"); });

// ---------- clic en el ícono: pausar / activar ----------
async function paint() {
  const on = await enabled();
  chrome.action.setBadgeText({ text: on ? "" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#C68A4E" });
  const { last } = await chrome.storage.local.get("last");
  const tail = last ? `\nÚltimo mapa (${last.at}): ${last.coords ? "ubicación leída" : "sin coordenadas"}\n${String(last.url).slice(0, 180)}` : "";
  chrome.action.setTitle({ title: (on ? "TBS · Mapas de WhatsApp: activado (clic para pausar)" : "TBS · Mapas de WhatsApp: en pausa (clic para activar)") + tail });
}
chrome.action.onClicked.addListener(async () => { await chrome.storage.local.set({ off: await enabled() }); paint(); });
chrome.runtime.onStartup.addListener(paint);
chrome.runtime.onInstalled.addListener(paint);
chrome.storage.onChanged.addListener((ch) => { if (ch.last) paint(); });
