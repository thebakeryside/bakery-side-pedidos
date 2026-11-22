// TBS · Mapas de WhatsApp
// La app de WhatsApp para computadora abre las ubicaciones en el navegador (Google Maps o Bing Maps).
// Esta extensión detecta esos mapas y, en su lugar, abre Cocina → "＋ Pedido WhatsApp" con la ubicación.
// Solo actúa en pestañas que abrió OTRA aplicación (no en mapas que se abren desde una pestaña de Chrome,
// como el botón "Mapa" de Cocina) y solo con coordenadas de Ecuador.

const SITE = "https://thebakeryside.com";
const COCINA = [`${SITE}/cocina*`, "https://www.thebakeryside.com/cocina*"];
const startedAt = Date.now();
const fresh = new Map(); // pestañas recién creadas sin pestaña de origen → hora

chrome.tabs.onCreated.addListener((t) => { if (t.openerTabId == null) fresh.set(t.id, Date.now()); });
chrome.tabs.onRemoved.addListener((id) => fresh.delete(id));

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
  const cands = [p.get("q"), p.get("query"), p.get("ll"), p.get("center"), p.get("daddr"), p.get("destination"),
    p.get("cp")?.replace("~", ","), p.get("sp")?.replace(/^point\./, "").replace("_", ","), p.get("where1"),
    decodeURIComponent(u.pathname)];
  for (const c of cands) {
    const m = c && String(c).match(/(-?\d{1,2}\.\d{2,})\s*,\s*(-?\d{1,3}\.\d{2,})/);
    if (!m) continue;
    const lat = Number(m[1]), lng = Number(m[2]);
    if (inEcuador(lat, lng)) return { lat, lng };
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

chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const c = coordsFrom(d.url); if (!c) return;
  const t = fresh.get(d.tabId);
  const external = (t && Date.now() - t < 15000) || (!t && Date.now() - startedAt < 15000);
  if (!external) return;
  fresh.delete(d.tabId);
  let tab; try { tab = await chrome.tabs.get(d.tabId); } catch { return; }
  if (tab.openerTabId != null) return; // se abrió desde otra pestaña de Chrome: se deja el mapa normal
  if (!(await enabled())) return;
  await toCocina(d.tabId, c);
});

// ---------- clic en el ícono: pausar / activar ----------
async function paint() {
  const on = await enabled();
  chrome.action.setBadgeText({ text: on ? "" : "OFF" });
  chrome.action.setBadgeBackgroundColor({ color: "#C68A4E" });
  chrome.action.setTitle({ title: on ? "TBS · Mapas de WhatsApp: activado (clic para pausar)" : "TBS · Mapas de WhatsApp: en pausa (clic para activar)" });
}
chrome.action.onClicked.addListener(async () => { await chrome.storage.local.set({ off: await enabled() }); paint(); });
chrome.runtime.onStartup.addListener(paint);
chrome.runtime.onInstalled.addListener(paint);
