// Mapa de entrega: Google Maps con buscador de direcciones; si Google no carga, mapa gratuito (OpenStreetMap).
// El pin queda fijo en el centro y el cliente mueve el mapa hasta su puerta.
import { GOOGLE_MAPS_BROWSER_KEY } from "./config.js";

const GYE = { lat: -2.17, lng: -79.9 };
const BOUNDS = { south: -2.35, west: -80.15, north: -1.95, east: -79.75 }; // Guayaquil y alrededores

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
export async function createMap(el, opts) {
  try {
    await loadGoogle();
    return await googleMap(el, opts);
  } catch {
    return leafletMap(el, opts);
  }
}

async function googleMap(el, { start, center, searchSlot, onPick }) {
  const g = window.google.maps;
  el.innerHTML = "";
  const map = new g.Map(el, {
    center: start || center || GYE, zoom: start ? 18 : 13,
    disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy", clickableIcons: false, styles: STYLE,
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

  // Buscador de direcciones (Places API New)
  if (searchSlot) {
    try {
      const { PlaceAutocompleteElement } = await g.importLibrary("places");
      const ac = new PlaceAutocompleteElement({ includedRegionCodes: ["ec"], locationRestriction: BOUNDS });
      ac.setAttribute("placeholder", "Busca tu dirección o un lugar cercano");
      ac.classList.add("gplace");
      searchSlot.replaceChildren(ac);
      const onSelect = async (ev) => {
        const pred = ev.placePrediction;
        const place = pred ? pred.toPlace() : ev.place;
        if (!place) return;
        await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });
        if (!place.location) return;
        touched = true; el.classList.add("touched");
        map.setZoom(18); map.panTo(place.location);
        const addr = (place.formattedAddress || place.displayName || "").replace(/, Ecuador$/, "");
        quiet = true; // el próximo "idle" no debe repetir la búsqueda inversa
        onPick(place.location.lat(), place.location.lng(), addr);
      };
      ac.addEventListener("gmp-select", onSelect);
      ac.addEventListener("gmp-placeselect", onSelect); // versiones anteriores
    } catch { /* sin buscador, el mapa igual sirve */ }
  }

  return {
    kind: "google",
    setView(lat, lng, zoom = 18) { touched = true; el.classList.add("touched"); map.setZoom(zoom); map.setCenter({ lat, lng }); },
    resize() { g.event.trigger(map, "resize"); },
  };
}

function leafletMap(el, { start, center, searchSlot, onPick }) {
  const L = window.L;
  if (!L) { el.innerHTML = `<p class="muted small" style="padding:12px">No pudimos cargar el mapa. Escribe tu dirección y referencia con detalle.</p>`; return { kind: "none", setView() {}, resize() {} }; }
  const c = start || center || GYE;
  const map = L.map(el, { zoomControl: true }).setView([c.lat, c.lng], start ? 18 : 13);
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
    searchSlot.innerHTML = `<input class="in" id="searchQ" type="search" placeholder="Busca: Urdesa, calle Guayacanes" aria-label="Buscar dirección"><button class="btn small" type="button" id="searchBtn">Buscar</button>`;
    const go = async () => {
      const q = searchSlot.querySelector("input").value.trim(); if (!q) return;
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ", Guayaquil")}&countrycodes=ec&limit=1&format=json&viewbox=-80.15,-1.95,-79.75,-2.35`);
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
    setView(lat, lng, zoom = 18) { touched = true; el.classList.add("touched"); map.setView([lat, lng], zoom); },
    resize() { map.invalidateSize(); },
  };
}
