// The Bakery Side: sirve el sitio estático y, en las páginas públicas, escribe el menú dentro del HTML
// para que Google y los asistentes de IA (que no ejecutan JavaScript) vean los productos, precios y horario.
// Si algo falla, devuelve la página tal cual: nunca rompe la tienda.

const SUPABASE_URL = "https://btwuncihlkecnkjrgfhz.supabase.co";
const SUPABASE_KEY = "sb_publishable_gY5Dn9Xuw5TrhEkiL4Vtzg_nUOm1n7P"; // clave pública (la misma del navegador)
const SITE = "https://thebakeryside.com";
const TTL = 5 * 60 * 1000;

// Página → qué categorías muestra (null = todas)
const PAGES = {
  "/": null,
  "/postres-a-domicilio": null,
  "/tortas-enteras": /dulces enteros/i,
  "/regalos-dulces": /cans|antojos|dulces enteros/i,
};

let cache = { at: 0, data: null };

// ---------- fotos y video: /media/* ----------
// Sirve el bucket público «productos» de Supabase a través de la caché de Cloudflare.
// Supabase entrega cada archivo una sola vez; las siguientes visitas salen de Cloudflare,
// que no cobra transferencia. Así no se gasta el cupo de Supabase (5 GB/mes en el plan gratis).
const MEDIA_ORIGIN = `${SUPABASE_URL}/storage/v1/object/public/productos/`;
const YEAR = 31536000;
// Archivos que se reemplazan con el mismo nombre (hero.json y los QR de pago): caché corta.
const SHORT = /^(portada\/hero\.json|pagos\/)/;
const mediaURL = (u) => (typeof u === "string" && u.startsWith(MEDIA_ORIGIN) ? `${SITE}/media/${u.slice(MEDIA_ORIGIN.length)}` : u);

async function media(request, url, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  if (!key || key.includes("..")) return new Response("No encontrado", { status: 404 });
  const short = SHORT.test(key);
  // «t» solo sirve para saltarse la caché del navegador; no debe crear una copia nueva en Cloudflare
  const q = new URLSearchParams(url.search); q.delete("t");
  const qs = q.toString() ? `?${q}` : "";
  const keyUrl = `${url.origin}/media/${encodeURI(key)}${qs}`;
  const range = request.headers.get("range");
  const store = caches.default;
  const lookup = new Request(keyUrl, { headers: range ? { range } : {} });
  let hit = await store.match(lookup);
  if (!hit) {
    const up = await fetch(MEDIA_ORIGIN + encodeURI(key) + qs);
    if (!up.ok) return new Response(up.status === 404 || up.status === 400 ? "No encontrado" : "Error", { status: up.status === 400 ? 404 : up.status, headers: { "cache-control": "no-store" } });
    const body = await up.arrayBuffer();
    const h = new Headers({
      "content-type": up.headers.get("content-type") || "application/octet-stream",
      "content-length": String(body.byteLength),
      "cache-control": short ? "public, max-age=60" : `public, max-age=${YEAR}, immutable`,
      "accept-ranges": "bytes",
      "access-control-allow-origin": "*",
    });
    for (const k of ["etag", "last-modified"]) { const v = up.headers.get(k); if (v) h.set(k, v); }
    const full = new Response(body, { status: 200, headers: h });
    const put = store.put(new Request(keyUrl), full.clone());
    if (range) { await put; hit = await store.match(lookup); } else ctx.waitUntil(put);
    if (!hit) hit = full;
  }
  return request.method === "HEAD" ? new Response(null, hit) : hit;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => `$${Number(n).toFixed(2)}`;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function rest(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) throw new Error(`rest ${r.status}`);
  return r.json();
}

async function loadData() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  const [cats, prods, cfg] = await Promise.all([
    rest("categories?select=id,name,sort&order=sort"),
    rest("products?select=id,name,description,price,category_id,image_url,servings,lead_hours,sort&active=eq.true&order=sort"),
    fetch(`${SUPABASE_URL}/functions/v1/api`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ action: "config" }),
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const groups = cats
    .map((c) => ({ ...c, items: prods.filter((p) => p.category_id === c.id && p.name !== "Postre sorpresa") }))
    .filter((g) => g.items.length);
  cache = { at: Date.now(), data: { groups, cfg } };
  return cache.data;
}

// Horario semanal real (a partir de los próximos 7 días del sistema de pedidos)
function hoursSpec(cfg) {
  const days = (cfg?.days || []).slice(0, 7).filter((d) => !d.closed && d.open && d.close);
  return days.map((d) => ({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: DAYS[new Date(`${d.day}T12:00:00-05:00`).getUTCDay()],
    opens: d.open,
    closes: d.close,
  }));
}

function jsonLd(groups, cfg) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Bakery",
    "@id": `${SITE}/#bakery`,
    name: "The Bakery Side",
    url: `${SITE}/`,
    hasMenu: {
      "@type": "Menu",
      name: "Menú de The Bakery Side",
      url: `${SITE}/`,
      hasMenuSection: groups.map((g) => ({
        "@type": "MenuSection",
        name: g.name,
        hasMenuItem: g.items.map((p) => ({
          "@type": "MenuItem",
          name: p.name,
          description: p.description || undefined,
          image: mediaURL(p.image_url) || undefined,
          offers: { "@type": "Offer", price: Number(p.price).toFixed(2), priceCurrency: "USD", availability: "https://schema.org/InStock" },
        })),
      })),
    },
  };
  const hours = hoursSpec(cfg);
  if (hours.length) data.openingHoursSpecification = hours;
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

// Lista sencilla para la tienda: se ve un instante mientras carga la tienda interactiva (que la reemplaza)
function menuList(groups) {
  return `<div class="ssr-menu">${groups.map((g) => `<h3 class="cat-title">${esc(g.name)}</h3><ul class="ssr-list">${g.items.map((p) =>
    `<li><span><b>${esc(p.name)}</b>${p.description ? ` <small>${esc(p.description)}</small>` : ""}</span><span class="tabnum">${money(p.price)}</span></li>`).join("")}</ul>`).join("")}</div>`;
}

// Tarjetas con foto para las páginas de búsqueda
function menuCards(groups) {
  return groups.map((g) => `<h2 class="lp-cat">${esc(g.name)}</h2><div class="lp-grid">${g.items.map((p) => `<a class="lp-card" href="/#cat-${g.id}">
    ${p.image_url ? `<img src="${esc(mediaURL(p.image_url))}" alt="${esc(p.name)} de The Bakery Side" loading="lazy" width="400" height="400">` : ""}
    <span class="lp-body"><b>${esc(p.name)}</b>${p.servings ? `<small>Porciones: ${esc(p.servings)}</small>` : ""}${p.description ? `<small>${esc(p.description)}</small>` : ""}
    <span class="lp-price">${money(p.price)}${p.lead_hours ? ` · pedir con ${p.lead_hours} h` : ""}</span></span></a>`).join("")}</div>`).join("");
}

function hoursText(cfg) {
  const days = (cfg?.days || []).slice(0, 7);
  const names = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return days.map((d) => `${names[new Date(`${d.day}T12:00:00-05:00`).getUTCDay()]}: ${d.closed ? "cerrado" : `${d.open} a ${d.close}`}`).join("; ");
}

async function llms(asset) {
  const base = await asset.text();
  const { groups, cfg } = await loadData();
  const menu = groups.map((g) => `## ${g.name}\n${g.items.map((p) => `- ${p.name} (${money(p.price)})${p.servings ? `, porciones: ${p.servings}` : ""}${p.lead_hours ? `, pedir con ${p.lead_hours} h de anticipación` : ""}${p.description ? `: ${p.description}` : ""}`).join("\n")}`).join("\n\n");
  const hrs = hoursText(cfg);
  return new Response(`${base.trim()}\n\n# Horario de esta semana\n${hrs || "Consulta en la tienda"}\n\n# Menú actual (precios en USD)\n\n${menu}\n`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/media/")) {
      try { return await media(request, url, ctx); } catch { return Response.redirect(MEDIA_ORIGIN + url.pathname.slice(7) + url.search, 302); }
    }
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const asset = await env.ASSETS.fetch(request);
    if (request.method !== "GET" || !asset.ok) return asset;
    try {
      if (path === "/llms.txt") return await llms(asset);
      if (!(path in PAGES) || !(asset.headers.get("content-type") || "").includes("text/html")) return asset;
      const { groups: all, cfg } = await loadData();
      const re = PAGES[path];
      const groups = re ? all.filter((g) => re.test(g.name)) : all;
      const rw = new HTMLRewriter().on("head", { element: (e) => e.append(jsonLd(all, cfg), { html: true }) });
      if (path === "/") rw.on("#menu", { element: (e) => e.setInnerContent(menuList(groups), { html: true }) });
      else rw.on("#ssr-products", { element: (e) => e.setInnerContent(menuCards(groups), { html: true }) });
      rw.on("[data-hours]", { element: (e) => { const t = hoursText(cfg); if (t) e.setInnerContent(esc(`Nuestro horario esta semana: ${t}.`)); } });
      const res = rw.transform(asset);
      const out = new Response(res.body, res);
      out.headers.set("cache-control", "public, max-age=0, must-revalidate");
      return out;
    } catch {
      return asset;
    }
  },
};
