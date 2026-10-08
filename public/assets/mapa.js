// Mapa de entrega: Google Maps con buscador de direcciones; si Google no carga, mapa gratuito (OpenStreetMap).
// El pin queda fijo en el centro y el cliente mueve el mapa hasta su puerta.
import { GOOGLE_MAPS_BROWSER_KEY } from "./config.js";

const GYE = { lat: -2.17, lng: -79.9 };
const BOUNDS = { south: -2.35, west: -80.15, north: -1.85, east: -79.7 }; // Guayaquil, Samborondón, vía a la Costa y La Aurora
const BIAS = { center: { lat: -2.12, lng: -79.9 }, radius: 30000 };
// "Cdla. Alborada" → "Alborada": Google suele conocer la ciudadela por su nombre solo
const PREFIX = /^(cdla\.?|ciudadela|urb\.?|urbanizaci[oó]n|coop\.?|cooperativa|conjunto|mz\.?)\s+/i;

// Estilo sobrio, en tonos cálidos de la marca
const STYLE = [
  { elementType: "geometry", stylers: [{ color: "#f3efe4" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#554741" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f6f7de" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#dfe3c4" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#fbf3e3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#efd2ae" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9d6d8" }] },
];

function loadGoogle() {
  if (!GOOGLE_MAPS_BROWSER_KEY) return Promise.reject(new Error("sin clave"));
  if (window.google?.maps?.Map) return Promise.resolve();
  return new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error("tiempo agotado")), 12000);
    window.__tbsMapsReady = () => { clearTimeout(t); ok(); };
    window.gm_authFailure = () => window.__tbsMapsAuthFail?.();
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_BROWSER_KEY)}&v=weekly&libraries=places&language=es&region=EC&loading=async&callback=__tbsMapsReady`;
    s.async = true;
    s.onerror = () => { clearTimeout(t); fail(new Error("no cargó")); };
    document.head.append(s);
  });
}

/**
 * Crea el mapa en `el`. opts:
 *  start: {lat,lng}|null — ubicación guardada del cliente
 *  center: {lat,lng} — centro por defecto (la cocina)
 *  searchSlot: elemento donde va el buscador
 *  onPick(lat, lng, address|null) — el cliente fijó una ubicación
 */
const TOUCH = matchMedia("(pointer: coarse)").matches;

export async function createMap(el, opts) {
  let ctl;
  try {
    await loadGoogle();
    ctl = await googleMap(el, opts);
  } catch {
    ctl = leafletMap(el, opts);
  }
  if (TOUCH && ctl.kind !== "none") addTouchLock(el, ctl);
  return ctl;
}

// En el celular el mapa queda quieto mientras haces scroll; se mueve solo después de tocar "Ajustar ubicación"
function addTouchLock(el, ctl) {
  const wrap = el.parentElement;
  const lock = document.createElement("button");
  lock.type = "button"; lock.className = "map-lock";
  lock.innerHTML = `<span><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 11V5a2 2 0 1 1 4 0v5h1V7a2 2 0 1 1 4 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-2.3-4a1.6 1.6 0 0 1 2.6-1.8L9 14z"/></svg>Toca para ajustar tu ubicación</span>`;
  const done = document.createElement("button");
  done.type = "button"; done.className = "btn small primary map-done"; done.textContent = "Listo"; done.hidden = true;
  wrap.append(lock, done);
  const set = (locked) => { ctl.setLocked(locked); lock.hidden = !locked; done.hidden = locked; };
  lock.onclick = () => set(false);
  done.onclick = () => set(true);
  set(true);
}

async function googleMap(el, { start, center, searchSlot, onPick }) {
  const g = window.google.maps;
  el.innerHTML = "";
  const map = new g.Map(el, {
    center: start || center || GYE, zoom: start ? 18 : 13,
    disableDefaultUI: true, zoomControl: true, gestureHandling: TOUCH ? "none" : "cooperative", clickableIcons: false, styles: STYLE,
  });
  const geocoder = new g.Geocoder();
  let touched = Boolean(start), quiet = false;

  const reverse = (lat, lng) => new Promise((ok) => {
    geocoder.geocode({ location: { lat, lng } }, (res, status) => {
      if (status !== "OK" || !res?.length) return ok(null);
      const r = res.find((x) => x.types.includes("street_address") || x.types.includes("premise")) || res[0];
      ok(r.formatted_address.replace(/, Ecuador$/, "").replace(/, Guayaquil.*$/, ""));
    });
  });
  const pick = async (withAddress) => {
    const c = map.getCenter();
    onPick(c.lat(), c.lng(), withAddress ? await reverse(c.lat(), c.lng()) : null);
  };
  map.addListener("dragstart", () => { touched = true; el.classList.add("touched"); });
  map.addListener("idle", () => { if (touched && !quiet) pick(true); quiet = false; });
  if (start) el.classList.add("touched");

  // Si la clave es rechazada, pasamos al mapa gratuito
  window.__tbsMapsAuthFail = () => { el.innerHTML = ""; leafletMap(el, { start, center, searchSlot, onPick }); };

  // Buscador propio: sugerencias de Google Places + respaldo con el geocodificador,
  // para que también aparezcan ciudadelas, urbanizaciones y manzanas.
  if (searchSlot) {
    try { await mountSearch(g, searchSlot, geocoder, (lat, lng, addr) => {
      touched = true; el.classList.add("touched");
      map.setZoom(18); map.panTo({ lat, lng });
      quiet = true; // el próximo "idle" no debe repetir la búsqueda inversa
      onPick(lat, lng, addr);
    }); } catch { /* sin buscador, el mapa igual sirve */ }
  }

  return {
    kind: "google",
    setLocked(l) { map.setOptions({ gestureHandling: l ? "none" : "greedy", zoomControl: !l }); },
    setView(lat, lng, zoom = 18) { touched = true; el.classList.add("touched"); map.setZoom(zoom); map.setCenter({ lat, lng }); },
    resize() { g.event.trigger(map, "resize"); },
  };
}

function leafletMap(el, { start, center, searchSlot, onPick }) {
  const L = window.L;
  if (!L) { el.innerHTML = `<p class="muted small" style="padding:12px">No pudimos cargar el mapa. Escribe tu dirección y referencia con detalle.</p>`; return { kind: "none", setLocked() {}, setView() {}, resize() {} }; }
  const c = start || center || GYE;
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: false }).setView([c.lat, c.lng], start ? 18 : 13);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 20, subdomains: "abcd", attribution: "© OpenStreetMap · © CARTO",
  }).addTo(map);
  let touched = Boolean(start);
  if (start) el.classList.add("touched");
  const reverse = async (lat, lng) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&zoom=18&format=json&accept-language=es`);
      const a = (await r.json())?.address; if (!a) return null;
      return [a.road, a.house_number, a.neighbourhood || a.suburb].filter(Boolean).join(", ") || null;
    } catch { return null; }
  };
  map.on("dragstart", () => { touched = true; el.classList.add("touched"); });
  map.on("moveend", async () => { if (!touched) return; const p = map.getCenter(); onPick(p.lat, p.lng, await reverse(p.lat, p.lng)); });

  if (searchSlot) {
    searchSlot.innerHTML = `<input class="in" id="searchQ" type="search" placeholder="Busca tu ciudadela o calle" aria-label="Buscar dirección"><button class="btn small" type="button" id="searchBtn">Buscar</button>`;
    const go = async () => {
      const q = searchSlot.querySelector("input").value.trim(); if (!q) return;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q.replace(PREFIX, "") + ", Guayaquil")}&countrycodes=ec&limit=1&format=json&viewbox=-80.15,-1.85,-79.7,-2.35`);
        const j = await r.json(); if (!j?.length) return;
        touched = true; el.classList.add("touched"); map.setView([+j[0].lat, +j[0].lon], 18);
      } catch {}
    };
    searchSlot.querySelector("button").onclick = go;
    searchSlot.querySelector("input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  }
  setTimeout(() => map.invalidateSize(), 60);
  return {
    kind: "osm",
    setLocked(l) { for (const h of [map.dragging, map.touchZoom, map.doubleClickZoom]) l ? h.disable() : h.enable(); },
    setView(lat, lng, zoom = 18) { touched = true; el.classList.add("touched"); map.setView([lat, lng], zoom); },
    resize() { map.invalidateSize(); },
  };
}

async function mountSearch(g, slot, geocoder, go) {
  const places = await g.importLibrary("places");
  const AS = places.AutocompleteSuggestion;
  slot.innerHTML = `<div class="ac"><input class="in" type="search" placeholder="Busca tu ciudadela, calle o un lugar" aria-label="Buscar ubicación" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="acList"><ul class="ac-list" id="acList" role="listbox" hidden></ul></div>`;
  const input = slot.querySelector("input"), list = slot.querySelector("ul");
  let token = AS ? new places.AutocompleteSessionToken() : null, seq = 0, items = [], active = -1;

  const clean = (t) => String(t || "").replace(/, Ecuador$/, "");
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; };
  const draw = () => {
    list.innerHTML = items.map((it, i) => `<li role="option" id="ac${i}" data-i="${i}" aria-selected="${i === active}"><b>${esc(it.main)}</b>${it.sub ? `<span>${esc(it.sub)}</span>` : ""}</li>`).join("")
      || `<li class="none">No encontramos ese lugar. Prueba con la ciudadela o una calle cercana, o mueve el mapa.</li>`;
    list.hidden = false; input.setAttribute("aria-expanded", "true");
  };

  async function suggest(q) {
    const out = [], seen = new Set();
    const add = (it) => { const k = it.main + "|" + it.sub; if (!seen.has(k)) { seen.add(k); out.push(it); } };
    if (AS) {
      const variants = [q]; const bare = q.replace(PREFIX, ""); if (bare !== q && bare.length > 2) variants.push(bare);
      for (const v of variants) {
        try {
          const { suggestions } = await AS.fetchAutocompleteSuggestions({ input: v, sessionToken: token, includedRegionCodes: ["ec"], locationBias: BIAS, language: "es", region: "ec" });
          for (const sg of suggestions || []) {
            const pp = sg.placePrediction; if (!pp) continue;
            add({ main: pp.mainText?.toString() || pp.text.toString(), sub: clean(pp.secondaryText?.toString()), pred: pp });
          }
        } catch {}
        if (out.length >= 5) break;
      }
    }
    // Respaldo: el geocodificador conoce zonas que el autocompletado a veces no muestra
    if (out.length < 3) {
      try {
        const { results } = await geocoder.geocode({ address: `${q}, Guayaquil`, bounds: BOUNDS, componentRestrictions: { country: "EC" }, language: "es" });
        for (const r of (results || []).slice(0, 3)) {
          const [main, ...rest] = clean(r.formatted_address).split(", ");
          add({ main, sub: rest.join(", "), lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), addr: clean(r.formatted_address) });
        }
      } catch {}
    }
    return out.slice(0, 6);
  }

  async function choose(it) {
    close(); input.blur();
    if (it.pred) {
      const place = it.pred.toPlace();
      await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });
      token = new places.AutocompleteSessionToken();
      if (!place.location) return;
      input.value = it.main;
      return go(place.location.lat(), place.location.lng(), [it.main, it.sub].filter(Boolean).join(", "));
    }
    input.value = it.main;
    go(it.lat, it.lng, it.addr);
  }

  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return close();
    timer = setTimeout(async () => { const my = ++seq; const r = await suggest(q); if (my !== seq) return; items = r; active = -1; draw(); }, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden || !items.length) { if (e.key === "Enter") e.preventDefault(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; draw(); input.setAttribute("aria-activedescendant", "ac" + active); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[Math.max(0, active)]); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("mousedown", (e) => { const li = e.target.closest("[data-i]"); if (li) { e.preventDefault(); choose(items[+li.dataset.i]); } });
  input.addEventListener("blur", () => setTimeout(close, 150));
}

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
