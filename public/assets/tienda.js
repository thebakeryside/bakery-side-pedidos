import { sb, api, $, $$, money, esc, hhmm, hm, etaRange, dayLabel, localToISO, todayLocal, toast, mountSocial, ALLERGENS, allergenNames } from "./common.js";
import { openPayphone } from "./payphone.js";
import { createMap } from "./mapa.js";
import { captureRef, storedRef, currentUser, loadAccount, stampCard, stampsFor, googleButton, mountGoogle } from "./account.js";
import { loadRatings, reviewsPanel } from "./reviews.js";

captureRef();

// ---------- video de portada ----------
// Se cambia desde Master → Ajustes → «Video de portada» (storage productos/portada/*).
// La foto carga primero; el video se baja solo después, para no frenar la página.
async function heroVideo() {
  const img = document.querySelector(".hero-b .hb-media"); if (!img) return;
  const pub = (k) => sb.storage.from("productos").getPublicUrl(`portada/${k}`).data.publicUrl;
  let meta;
  try { const r = await fetch(`${pub("hero.json")}?t=${Date.now()}`, { cache: "no-store" }); if (!r.ok) return; meta = await r.json(); } catch { return; }
  if (!meta?.video) return;
  const v = encodeURIComponent(meta.v || "");
  const poster = meta.poster ? `${pub(meta.poster)}?v=${v}` : img.src;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;
  if (calm) { img.src = poster; return; } // sin movimiento ni datos extra: solo la portada del video
  // Video decorativo: sin controles, sin pantalla completa ni ventana flotante. Si el navegador
  // (p. ej. el de TikTok o Instagram) no deja reproducir solo, se queda quieto mostrando la portada.
  const vid = Object.assign(document.createElement("video"), { muted: true, loop: true, playsInline: true, autoplay: true, controls: false, preload: "auto", poster, className: img.className + " hb-video" });
  for (const a of ["muted", "playsinline", "webkit-playsinline", "disablepictureinpicture", "disableremoteplayback"]) vid.setAttribute(a, "");
  vid.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback noplaybackrate");
  vid.setAttribute("x-webkit-airplay", "deny"); vid.setAttribute("tabindex", "-1");
  vid.setAttribute("aria-label", meta.alt || img.alt);
  vid.src = `${pub(meta.video)}?v=${v}`;
  const tryPlay = () => vid.play().catch(() => {});
  vid.addEventListener("loadeddata", () => {
    img.replaceWith(vid); tryPlay();
    // si no arrancó solo, arranca con el primer toque o desplazamiento de la página
    const kick = () => { if (vid.paused) tryPlay(); };
    for (const ev of ["touchstart", "scroll", "click"]) addEventListener(ev, kick, { once: true, passive: true });
  }, { once: true });
  vid.addEventListener("webkitbeginfullscreen", () => vid.webkitExitFullscreen?.());
  vid.load();
}
if (document.readyState === "complete") heroVideo(); else addEventListener("load", heroVideo, { once: true });

const state = { cfg: null, cats: [], products: [], cart: new Map(), filter: "Todo", loc: null, quote: null, acct: null, guest: false };
const CART_KEY = "tbs_cart";
const PROFILE_KEY = "tbs_cliente";

// ---------- carga inicial ----------
async function init() {
  try {
    const [cfg, cats, prods, opts] = await Promise.all([
      api("config"),
      sb.from("categories").select("id,name,sort").eq("active", true).order("sort"),
      sb.from("products").select("*").eq("active", true).order("sort"),
      sb.from("product_option_groups").select("product_id, option_groups(id,name,required,sort,option_choices(id,name,price_delta,sort,active))"),
    ]);
    // opciones por producto (si la tabla aún no existe, no hay opciones)
    state.opts = {};
    for (const r of opts.error ? [] : opts.data || []) {
      const g = r.option_groups; if (!g) continue;
      g.option_choices = (g.option_choices || []).filter((c) => c.active).sort((a, b) => a.sort - b.sort);
      if (!g.option_choices.length) continue; // grupo sin opciones activas: no se muestra
      (state.opts[r.product_id] ||= []).push(g);
    }
    if (cats.error) throw cats.error;
    if (prods.error) throw prods.error;
    state.cfg = cfg; state.products = prods.data;
    // Las categorías sin productos activos no se muestran (vuelven solas al cargarles productos)
    state.cats = cats.data.filter((c) => prods.data.some((p) => p.category_id === c.id));
  } catch (e) {
    $("#menu").innerHTML = `<p class="err">No pudimos cargar el menú. ${esc(e.message)}</p>`;
    return;
  }
  const c = state.cfg;
  renderStatus(c);
  const wa = waLink(c.whatsapp, "Hola The Bakery Side, tengo una consulta 🙂");
  if (wa) { $("#waFab").href = wa; $("#waFab").hidden = false; }
  // pasos de la portada: costo mínimo de envío y desde cuándo se entrega
  if (c.fee?.base != null) $("#stFee").textContent = `desde $${Number(c.fee.base).toFixed(2).replace(".", ",")}`;
  mountSocial(c.whatsapp);
  try { JSON.parse(localStorage.getItem(CART_KEY) || "[]").forEach(([k, q]) => { k = String(k); if (state.products.some((p) => p.id === keyId(k)) && validKey(k)) state.cart.set(k, q); }); } catch {}
  renderCats(); renderMenu(); renderCart();
  // estrellas de cada producto (llegan después para no frenar el menú)
  loadRatings().then((r) => { state.ratings = r; state.products.forEach((p) => updateCard(p.id)); });
  await refreshAccount();
  if (new URLSearchParams(location.search).get("regalo") === "1") {
    try { sessionStorage.setItem("tbs_regalo", "1"); } catch {}
    history.replaceState(null, "", "/");
    toast("🎁 Elige el regalo: al pagar ya estará marcado para enviarlo con tu tarjeta.");
  }
  if (new URLSearchParams(location.search).get("carrito") === "1") { history.replaceState(null, "", "/"); if (state.cart.size) openCart(); }
  if (new URLSearchParams(location.search).get("checkout") === "1" && state.cart.size) {
    history.replaceState(null, "", "/"); openCheckout();
  }
}

// Horario: aviso amable cuando no estamos abiertos
const WEEKDAY = (d) => new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { weekday: "long", timeZone: "America/Guayaquil" });
function whenLabel(n) { return !n ? null : n.in_days === 0 ? "hoy" : n.in_days === 1 ? "mañana" : `el ${WEEKDAY(n.day)}`; }
const hTxt = (t) => String(t || "").slice(0, 5).replace(/^0/, "").replace(":", "h"); // "09:00" → "9h00"
function renderStatus(c) {
  const n = c.next_open, today = c.days?.[0];
  const nextTxt = !n ? "pronto" : n.in_days <= 1 ? hTxt(n.time) : whenLabel(n);
  // Todo el estado de la tienda vive en la etiqueta de arriba (ya no hay barra de "descansando")
  $("#openTxt").innerHTML = c.open_now ? `Abierto<span class="long"> · hasta ${hTxt(c.close_time)}</span>`
    : !c.store_open || today?.closed ? "Hoy descansamos"
    : `Descansando<span class="long"> · abrimos ${nextTxt}</span>`;
  $("#openPill").classList.toggle("closed", !c.open_now);
  $("#openPill").classList.toggle("off", !c.open_now && (!c.store_open || !!today?.closed));
  $("#hoursTxt").textContent = c.open_now || today?.open ? `hoy de ${c.open_time} a ${c.close_time}` : "según el día";
}
// wa.me necesita el número internacional sin signos (0991234567 → 593991234567)
function waLink(num, text) {
  let d = String(num || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = "593" + d.slice(1);
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

async function refreshAccount() {
  try { state.acct = (await currentUser()) ? await loadAccount() : null; } catch { state.acct = null; }
  const b = $("#acctBtn");
  const first = (state.acct?.customer?.full_name || "").split(" ")[0];
  $("#acctTxt").textContent = first ? `Hola, ${first}` : "Mi cuenta";
  b.title = state.acct ? `Tu cuenta: ${state.acct.stamps} de 8 sellos` : "Entra a tu cuenta";
  // sellos siempre a la vista junto a «Mi cuenta» (🎁 si ya tiene un postre sorpresa)
  const chip = $("#acctStamps");
  if (chip) { chip.hidden = !state.acct; if (state.acct) chip.textContent = state.acct.rewards_available ? "🎁" : `${Math.min(8, state.acct.stamps)}/8`; }
  if (!$("#checkout").hidden) { renderAcctBox(); renderPerks(); renderSummary(); }
}

// ---------- menú ----------
// Las categorías quedan fijas arriba al bajar; tocar una lleva a su sección y la activa se marca sola
function renderCats() {
  $("#cats").innerHTML = state.cats.map((c, i) => `<button type="button" aria-pressed="${i === 0}" data-cat="${c.id}">${esc(c.name)}</button>`).join("");
}
const stickyTop = () => $(".topbar").offsetHeight + $("#cats").offsetHeight + 8;
$("#cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]"); if (!b) return;
  const sec = document.getElementById(`cat-${b.dataset.cat}`); if (!sec) return;
  spyLock = Date.now() + 700; setActiveCat(b.dataset.cat);
  scrollTo({ top: sec.getBoundingClientRect().top + scrollY - stickyTop(), behavior: "smooth" });
});
let spyLock = 0;
const setHdr = () => document.documentElement.style.setProperty("--hdr", `${$(".topbar").offsetHeight}px`);
setHdr(); addEventListener("resize", setHdr);
function setActiveCat(id) {
  $$("#cats [data-cat]").forEach((b) => {
    const on = b.dataset.cat === String(id);
    if (on && b.getAttribute("aria-pressed") !== "true") b.scrollIntoView({ inline: "center", block: "nearest" });
    b.setAttribute("aria-pressed", on);
  });
}
let spyRaf = 0;
addEventListener("scroll", () => {
  if (spyRaf || Date.now() < spyLock) return;
  spyRaf = requestAnimationFrame(() => {
    spyRaf = 0;
    const line = stickyTop() + 4;
    let cur = null;
    for (const h of $$("#menu .cat-title")) { if (h.getBoundingClientRect().top <= line) cur = h.id.slice(4); }
    setActiveCat(cur ?? state.cats[0]?.id);
  });
}, { passive: true });


// Porciones recomendadas (dulces enteros): van como etiqueta aparte, no en la descripción
const servChip = (p) => (p.servings ? `<span class="serv"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="9" r="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 19c.8-3 3.2-4.6 6-4.6s5.2 1.6 6 4.6M15 14.6c2.6-.3 4.9 1 5.8 3.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>${esc(p.servings)}</span>` : "");
// Stock del día: null = sin límite, 0 = agotado hoy, N = quedan N hoy
function leftToday(p) {
  const today = todayLocal();
  if (p.sold_out_day === today) return 0;
  if (p.stock_day === today && p.stock_left != null) return p.stock_left;
  return null;
}
// Tarjeta de producto: el botón para agregar va sobre la foto, como en las apps de delivery
const PLUS = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const MINUS = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
const TRASH = `<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
let expanded = null, expTimer = 0;
function photoCtrl(p, q, left, opts) {
  if (left === 0 && !q) return `<div class="pctrl"><span class="sold">Agotado hoy</span></div>`;
  const full = left != null && q >= left;
  if (opts && !q) return `<div class="pctrl"><button type="button" class="pc-plus" data-a="pick" data-id="${p.id}" aria-label="Agregar ${esc(p.name)}"${full ? " disabled" : ""}>${PLUS}</button></div>`;
  if (!q) return `<div class="pctrl"><button type="button" class="pc-plus" data-a="+" data-id="${p.id}" aria-label="Agregar ${esc(p.name)}"${full ? " disabled" : ""}>${PLUS}</button></div>`;
  if (expanded !== p.id) return `<div class="pctrl"><button type="button" class="pc-count" data-a="expand" data-id="${p.id}" aria-label="${q} en tu pedido. Cambiar cantidad">${q}</button></div>`;
  return `<div class="pctrl"><div class="pc-step"><button type="button" data-a="-" data-id="${p.id}" aria-label="${q === 1 ? "Quitar" : "Quitar uno"}">${q === 1 ? TRASH : MINUS}</button><b>${q}</b><button type="button" data-a="${opts ? "pick" : "+"}" data-id="${p.id}" aria-label="Agregar uno"${full ? " disabled" : ""}>${PLUS}</button></div></div>`;
}
// Mini íconos de alérgenos; al tocarlos se dice qué contiene
function algRow(p) {
  const list = ALLERGENS.filter(([k]) => (p.allergens || []).includes(k));
  if (!list.length) return "";
  const names = list.map(([, , n]) => n).join(", ");
  return `<button type="button" class="algs" data-a="alg" data-id="${p.id}" aria-label="Contiene: ${names}" title="Contiene: ${names}">${list.map(([k, i]) => `<span class="alg alg-${k}" aria-hidden="true">${i}</span>`).join("")}</button>`;
}
// Estrellas (solo reseñas comprobadas); al tocarlas se despliegan las reseñas debajo
function rateRow(p) {
  const r = state.ratings?.get(p.id);
  if (r?.n) return `<button type="button" class="rate" data-a="reviews" data-id="${p.id}" aria-expanded="false"><b>★ ${Number(r.avg_rating).toFixed(1).replace(".", ",")}</b><span>(${r.n})</span> <u>Ver reseñas</u></button>`;
  // Sin reseñas todavía: no mostramos nada (un "sé el primero" en todo el menú resta confianza)
  if (!r?.total) return "";
  return `<button type="button" class="rate empty" data-a="reviews" data-id="${p.id}" aria-expanded="false">☆ <u>Ver reseñas</u></button>`;
}
function itemCard(p) {
  const q = qtyOf(p.id), left = leftToday(p), opts = groupsOf(p.id).length > 0;
  const img = p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="can" aria-hidden="true">${esc(p.name.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>`;
  const lead = p.lead_hours ? `<span class="tag">Pedir con ${p.lead_hours} h de anticipación</span>` : "";
  const stock = left === 0 ? `<span class="tag">Agotado por hoy · vuelve mañana</span>` : left != null ? `<span class="tag">Quedan ${left} hoy</span>` : "";
  const hint = opts ? `<span class="optnote">Eliges ${groupsOf(p.id).map((g) => g.name.toLowerCase()).join(" y ")} al agregar</span>` : "";
  return `<article class="item${left === 0 ? " soldout" : ""}${q ? " incart-on" : ""}" data-pid="${p.id}"><div class="ph">${img}${photoCtrl(p, q, left, opts)}</div><div class="body"><h3>${esc(p.name)}</h3>${servChip(p)}<p>${esc(p.description)}</p>${rateRow(p)}${hint}${lead}${stock}<div class="foot"><span class="price">${money(p.price)}</span>${algRow(p)}</div></div></article>`;
}
// Orden del menú: dulces enteros de mayor a menor precio; el resto en orden alfabético (x2, x6, x12 en orden)
const byName = (a, b) => a.name.localeCompare(b.name, "es", { numeric: true, sensitivity: "base" });
const menuOrder = (c) => (/dulces enteros/i.test(c.name) ? (a, b) => Number(b.price) - Number(a.price) || byName(a, b) : byName);
// Al agregar o quitar solo se actualizan los botones de ese producto (las fotos no se recargan)
function updateCard(id) {
  const el = document.querySelector(`#menu [data-pid="${id}"]`); if (!el) return;
  const t = document.createElement("template"); t.innerHTML = itemCard(product(id)).trim();
  const fresh = t.content.firstElementChild;
  el.className = fresh.className;
  el.querySelector(".pctrl").replaceWith(fresh.querySelector(".pctrl"));
  el.querySelector(".foot").replaceWith(fresh.querySelector(".foot"));
  const rate = el.querySelector(".rate"), freshRate = fresh.querySelector(".rate");
  if (rate && freshRate && !el.querySelector(".rv")) rate.replaceWith(freshRate);
  else if (!rate && freshRate) el.querySelector(".body > p")?.after(freshRate);
}
function renderMenu() {
  const groups = state.cats
    .map((c) => ({ c, items: state.products.filter((p) => p.category_id === c.id).sort(menuOrder(c)) }));
  $("#menu").innerHTML = groups.length
    ? groups.map((g) => `<h3 class="cat-title" id="cat-${g.c.id}">${esc(g.c.name)}</h3>${g.items.length
        ? `<div class="menu-grid">${g.items.map(itemCard).join("")}</div>`
        : `<div class="soon"><span class="display">Próximamente</span><span class="muted small">Estamos preparando esta sección.</span></div>`}`).join("")
    : `<p class="muted">Pronto publicaremos el menú.</p>`;
  if (groups.length && state.products.some((p) => p.allergens?.length)) $("#menu").insertAdjacentHTML("beforeend", `<div class="alg-legend"><b>Alérgenos</b>${ALLERGENS.map(([k, i, n]) => `<span><span class="alg" aria-hidden="true">${i}</span>${n}</span>`).join("")}<small>Todo se prepara en la misma cocina: puede haber trazas. ¿Alergia severa? Escríbenos antes de pedir.</small></div>`);
}
$("#menu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const id = Number(b.dataset.id), a = b.dataset.a;
  if (a === "alg") { const p = state.products.find((x) => x.id === id); toast(`Contiene: ${allergenNames(p?.allergens).join(", ")}`, 3500); return; }
  if (a === "reviews") {
    const card = b.closest(".item"); let panel = card.querySelector(".rv");
    if (panel) { panel.remove(); b.setAttribute("aria-expanded", "false"); return; }
    panel = document.createElement("div"); panel.className = "rv";
    card.querySelector(".body").append(panel); b.setAttribute("aria-expanded", "true");
    return reviewsPanel(panel, product(id));
  }
  if (a === "pick") { if (expanded === id) { expanded = null; clearTimeout(expTimer); updateCard(id); } return openPicker(product(id)); }
  if (a === "expand") { setExpanded(id); return; }
  if (a === "+" && qtyOf(id) > 0) expanded = id; // sigue mostrando − y + mientras ajusta
  // con opciones (endulzante): el − quita la última que agregó de ese producto
  const key = a === "-" && groupsOf(id).length ? lastKeyOf(id) : String(id);
  if (a === "-" && groupsOf(id).length && new Set([...state.cart.keys()].filter((k) => keyId(k) === id)).size > 1) toast(`Quitamos 1 ${lineName(key)}`);
  changeQty(key, a === "+" ? 1 : -1);
  if (!qtyOf(id) && expanded === id) { expanded = null; updateCard(id); }
  if (expanded === id) bumpCollapse(id);
});
// el selector − 1 + se cierra solo a los 3 segundos sin tocarlo
function setExpanded(id) { const prev = expanded; expanded = id; if (prev && prev !== id) updateCard(prev); updateCard(id); bumpCollapse(id); }
function bumpCollapse(id) { clearTimeout(expTimer); expTimer = setTimeout(() => { if (expanded === id) { expanded = null; updateCard(id); } }, 3000); }
function changeQty(key, d) {
  const id = keyId(key);
  const q = (state.cart.get(key) || 0) + d;
  const left = leftToday(product(id));
  if (d > 0 && left != null && qtyOf(id) + d > left) { toast(left ? `Solo quedan ${left} hoy` : "Agotado por hoy"); return; }
  if (q <= 0) state.cart.delete(key); else state.cart.set(key, Math.min(q, 50));
  try { localStorage.setItem(CART_KEY, JSON.stringify([...state.cart])); } catch {}
  updateCard(id); renderCart(); if (state.loc) requestQuote();
}

// ---------- carrito ----------
// Cada línea del carrito: "id" o "id:opción.opción" (por ejemplo "12:3" = Cold Brew con Stevia)
const keyId = (k) => Number(String(k).split(":")[0]);
const keyOpts = (k) => (String(k).split(":")[1] || "").split(".").filter(Boolean).map(Number);
const groupsOf = (id) => state.opts?.[id] || [];
const lastKeyOf = (id) => [...state.cart.keys()].filter((k) => keyId(k) === id).pop() ?? String(id);
const qtyOf = (id) => [...state.cart].reduce((s, [k, q]) => s + (keyId(k) === id ? q : 0), 0);
const choiceOf = (cid) => { for (const gs of Object.values(state.opts || {})) for (const g of gs) { const c = g.option_choices.find((x) => x.id === cid); if (c) return c; } return null; };
function validKey(k) {
  const gs = groupsOf(keyId(k)), opts = keyOpts(k);
  return gs.every((g) => !g.required || g.option_choices.some((c) => opts.includes(c.id)));
}
const lineName = (k) => { const n = keyOpts(k).map((c) => choiceOf(c)?.name).filter(Boolean); return product(keyId(k)).name + (n.length ? ` (${n.join(", ")})` : ""); };
const linePrice = (k) => Number(product(keyId(k)).price) + keyOpts(k).reduce((s, c) => s + Number(choiceOf(c)?.price_delta || 0), 0);
const cartItems = (keys = [...state.cart.keys()]) => keys.map((k) => ({ product_id: keyId(k), quantity: state.cart.get(k), options: keyOpts(k) }));
const product = (id) => state.products.find((p) => p.id === id);
const subtotal = () => [...state.cart].reduce((s, [k, q]) => s + linePrice(k) * q, 0);

// Productos con opciones (por ejemplo, el endulzante de las bebidas)
function openPicker(p) {
  const gs = groupsOf(p.id);
  const box = $("#optModal");
  box.querySelector(".opt-title").textContent = p.name;
  box.querySelector(".opt-body").innerHTML = gs.map((g) => `<fieldset class="optgroup"><legend>${esc(g.name)}${g.required ? "" : ' <span class="muted small">(opcional)</span>'}</legend>
    ${g.option_choices.map((c) => `<label class="optchoice"><input type="radio" name="g${g.id}" value="${c.id}"><span>${esc(c.name)}</span>${Number(c.price_delta) > 0 ? `<span class="muted small">+${money(c.price_delta)}</span>` : `<span class="free">${g.option_choices.some((x) => Number(x.price_delta) > 0) ? "Incluido" : "+$0.00"}</span>`}</label>`).join("")}
    ${g.option_choices.every((c) => !Number(c.price_delta)) ? `<p class="freenote">🎁 Cualquier opción, sin recargo adicional.</p>` : ""}</fieldset>`).join("");
  const add = box.querySelector(".opt-add");
  const sync = () => { add.disabled = gs.some((g) => g.required && !box.querySelector(`input[name="g${g.id}"]:checked`)); };
  box.querySelectorAll("input").forEach((i) => (i.onchange = sync)); sync();
  add.onclick = () => {
    const ids = gs.map((g) => Number(box.querySelector(`input[name="g${g.id}"]:checked`)?.value || 0)).filter(Boolean);
    box.hidden = true;
    changeQty(ids.length ? `${p.id}:${ids.join(".")}` : String(p.id), 1);
    toast(`${lineName(ids.length ? `${p.id}:${ids.join(".")}` : String(p.id))} agregado`);
  };
  box.querySelector(".opt-close").onclick = () => (box.hidden = true);
  box.hidden = false;
  box.querySelector("input")?.focus();
}

function renderCart() {
  const n = [...state.cart.values()].reduce((a, b) => a + b, 0);
  const lines = [...state.cart].map(([k, q]) => {
    const p = product(keyId(k)), left = leftToday(p), nm = lineName(k);
    return `<div class="cline"><span class="nm">${esc(nm)}</span><span class="tabnum">${money(linePrice(k) * q)}</span>
      <div class="qty"><button type="button" data-c="-" data-id="${k}" aria-label="Quitar uno de ${esc(nm)}">−</button><span>${q}</span><button type="button" data-c="+" data-id="${k}" aria-label="Agregar uno de ${esc(nm)}"${left != null && qtyOf(p.id) >= left ? " disabled" : ""}>+</button></div>
      <button class="rm" type="button" data-c="x" data-id="${k}">Quitar</button></div>`;
  });
  $("#cartLines").innerHTML = lines.length
    ? lines.join("") + (state.acct?.rewards_available ? `<p class="reward-note">🎁 Tienes un postre sorpresa: actívalo al pagar si lo quieres en este pedido.</p>` : "")
    : `<div class="cart-empty"><b>Tu pedido está vacío</b><span class="muted small">Agrega algo rico del menú para empezar.</span></div>`;
  // Subtotal fuera de la lista: siempre a la vista junto al botón, aunque haya muchos productos
  $("#cartSum").innerHTML = lines.length
    ? `<div class="line total"><span>Subtotal</span><span class="tabnum">${money(subtotal())}</span></div><p class="muted small" style="margin:0">El envío se calcula con tu ubicación.</p>` : "";
  $("#goCheckout").disabled = !n;
  $("#goCheckout").textContent = n ? `Continuar · ${money(subtotal())}` : "Continuar";
  $("#mbCount").textContent = n; $("#mbTotal").textContent = money(subtotal());
  $("#cartCount").textContent = n; $("#cartCount").hidden = !n;
  $("#mobileBar").hidden = !n || !$("#checkout").hidden;
  renderUpsell();
  renderSummary();
}

// ---------- sugerencia en el carrito ("¿Le sumas…?") ----------
// Regla simple por ahora (y elección al azar dentro del grupo) para ir aprendiendo:
// sin bebida → una bebida; con bebida pero sin antojo → un antojo; con ambos → una lata.
// Cada sugerencia mostrada y cada una agregada se guarda en upsell_events.
const UPSELL_RULES = [["sin_bebida", /bebida/i], ["sin_antojo", /antojo/i], ["sin_can", /^cans?$/i]];
const upsellSeen = new Set();
let upsellPick = null; // { rule, id }
function visitorId() {
  try { let v = localStorage.getItem("tbs_vid"); if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("tbs_vid", v); } return v; }
  catch { return "anon"; }
}
function logUpsell(action, pick) {
  const cart = [...new Set([...state.cart.keys()].map(keyId))];
  sb.from("upsell_events").insert({ visitor: visitorId(), action, suggested_id: pick.id, rule: pick.rule, cart }).then(() => {}, () => {});
}
function chooseUpsell() {
  const ids = new Set([...state.cart.keys()].map(keyId));
  const catOf = (p) => state.cats.find((c) => c.id === p.category_id)?.name || "";
  const inCart = [...ids].map(product).filter(Boolean);
  for (const [rule, re] of UPSELL_RULES) {
    if (inCart.some((p) => re.test(catOf(p)))) continue;
    const pool = state.products.filter((p) => re.test(catOf(p)) && !ids.has(p.id) && Number(p.price) > 0 && !p.lead_hours && leftToday(p) !== 0);
    if (!pool.length) continue;
    if (upsellPick?.rule === rule && pool.some((p) => p.id === upsellPick.id)) return upsellPick;
    return (upsellPick = { rule, id: pool[Math.floor(Math.random() * pool.length)].id });
  }
  return null;
}
function renderUpsell() {
  const box = $("#upsell"); if (!box) return;
  const pick = state.cart.size ? chooseUpsell() : null;
  if (!pick) { box.innerHTML = ""; return; }
  const p = product(pick.id);
  box.innerHTML = `<div class="upsell"><span class="up-k">¿Le sumas?</span><div class="up-row">${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : ""}<div class="up-tx"><b>${esc(p.name)}</b><span class="tabnum">${money(p.price)}</span></div><button type="button" class="btn small" data-up="${p.id}">+ Agregar</button></div></div>`;
  const key = `${pick.rule}:${pick.id}`;
  if (!upsellSeen.has(key)) { upsellSeen.add(key); logUpsell("shown", pick); }
}
$("#upsell")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-up]"); if (!b || !upsellPick) return;
  const id = Number(b.dataset.up); logUpsell("added", upsellPick);
  if (groupsOf(id).length) openPicker(product(id)); else changeQty(String(id), 1);
});
$("#cartLines").addEventListener("click", (e) => {
  const b = e.target.closest("[data-c]"); if (!b) return;
  const k = b.dataset.id;
  changeQty(k, b.dataset.c === "+" ? 1 : b.dataset.c === "-" ? -1 : -(state.cart.get(k) || 0));
});
const isMobile = () => matchMedia("(max-width: 899px)").matches;
function openCart() {
  if (!$("#checkout").hidden) backToMenu();
  if (isMobile()) { $("#cart").classList.add("open"); $("#cartScrim").hidden = false; }
  else { $("#cart").scrollIntoView({ behavior: "smooth", block: "start" }); $("#cart").animate([{ boxShadow: "0 0 0 4px rgb(198 138 78 / .5)" }, { boxShadow: "0 0 0 0 transparent" }], 900); }
}
function closeCart() { $("#cart").classList.remove("open"); $("#cartScrim").hidden = true; }
function backToMenu() {
  $("#checkout").hidden = true; $(".layout").hidden = false; $(".intro").hidden = false; document.body.classList.remove("in-checkout"); renderCart(); scrollTo(0, 0);
}
$("#mobileBar").onclick = openCart;
$("#cartBtn").onclick = openCart;
$("#closeCart").onclick = closeCart;
$("#cartScrim").onclick = closeCart;
$("#goCheckout").onclick = () => { closeCart(); openCheckout(); };
$("#backToMenu").onclick = backToMenu;

// ---------- checkout ----------
let mapCtl = null;
function openCheckout() {
  // llegó desde el recordatorio de una fecha especial: el pedido ya va como regalo
  try { if (sessionStorage.getItem("tbs_regalo") === "1") { sessionStorage.removeItem("tbs_regalo"); if (!$("#isGift").checked) { $("#isGift").checked = true; $("#isGift").dispatchEvent(new Event("change")); } } } catch {}
  $("#cart").classList.remove("open");
  $(".layout").hidden = true; $(".intro").hidden = true; $("#checkout").hidden = false; $("#mobileBar").hidden = true;
  document.body.classList.add("in-checkout");
  scrollTo(0, 0);
  const c = state.cfg;
  // cuándo
  $("#whenNow").disabled = !c.open_now;
  $("#nowHint").textContent = c.open_now ? "Te mostramos la hora estimada" : (c.next_open ? `Ahora no: abrimos ${whenLabel(c.next_open)} a las ${c.next_open.time}` : "Ahora no estamos atendiendo");
  const leadNames = [...new Set([...state.cart.keys()].filter((k) => product(keyId(k)).lead_hours > 0).map((k) => product(keyId(k)).name))];
  const hasQuick = [...state.cart.keys()].some((k) => !product(keyId(k)).lead_hours);
  // Dulce entero (24 h) junto a cosas para ahora: se puede pedir en dos entregas
  const canSplit = leadNames.length > 0 && hasQuick && c.open_now && !c.next_day_only;
  $("#splitChoice").hidden = !canSplit;
  if (leadNames.length) {
    $("#whenNow").disabled = true;
    $("#nowHint").textContent = `${listNames(leadNames)} se pide con 24 h de anticipación`;
    $("#laterHint").textContent = "Todo junto, el día y hora que elijas";
    $("#splitHint").textContent = `Lo demás ahora y ${listNames(leadNames)} el día que elijas · 2 envíos`;
  } else { $("#laterHint").textContent = "Elige día y hora de entrega"; }
  // Por ahora (sin motorizado propio) solo se agenda desde el día siguiente
  if (c.next_day_only) {
    $("#whenNow").disabled = true;
    $("#nowHint").textContent = "Por ahora recibimos pedidos con un día de anticipación";
    $("#laterHint").textContent = "Elige el día (desde mañana) y la hora de entrega";
  }
  // Por qué la espera: todo se prepara al momento (y lo horneado, recién salido del horno)
  const slow = [...new Set([...state.cart.keys()].map((k) => product(keyId(k))).filter((p) => p && !p.lead_hours && p.prep_minutes >= 120).map((p) => p.name.replace(/\s+x\d+$/i, "").trim()))];
  $("#freshTxt").textContent = slow.length
    ? (() => { const pl = slow.length > 1 || /^rollos/i.test(slow[0]); return `Preparamos tu pedido al momento: ${listNames(slow)} ${pl ? "salen recién hechos" : "sale recién hecho"} para ti.`; })()
    : "Preparamos tu pedido al momento, recién hecho para ti.";
  // «Lo antes posible»: solo si alcanzamos a prepararlo y entregarlo antes de cerrar
  if (!$("#whenNow").disabled) {
    const need = needMinutes(), today = hoursFor(todayLocal(0));
    const [ch, cm] = (today?.close || "00:00").split(":").map(Number);
    const left = (new Date(localToISO(todayLocal(0), `${String(ch).padStart(2, "0")}:${String(cm).padStart(2, "0")}`)).getTime() - Date.now()) / 60000;
    if (left < need) { $("#whenNow").disabled = true; $("#nowHint").textContent = "Hoy ya no alcanzamos a prepararlo a tiempo"; }
    else $("#nowHint").textContent = `Llega hoy entre ${etaRange(new Date(Date.now() + need * 60000).toISOString(), { window: Number(c.eta_window || 30) })}`;
  }
  ($("#whenNow").disabled ? $("#whenLater") : $("#whenNow")).checked = true;
  // Si «Lo antes posible» no aplica, no se muestra: solo agendar, sin opciones que elegir
  $("#nowChoice").hidden = $("#whenNow").disabled;
  const onlyLater = $("#whenNow").disabled && $("#splitChoice").hidden;
  $("#whenChoices").hidden = onlyLater;
  $("#whenTitle").textContent = onlyLater ? "Agenda tu entrega" : "¿Cuándo lo quieres?";
  $("#schedLead").hidden = !onlyLater;
  $("#schedLead").textContent = c.next_day_only ? "Elige el día y la hora en que quieres recibirlo. Entregamos desde mañana."
    : leadNames.length ? `${listNames(leadNames)} se pide con 24 h de anticipación. Elige el día y la hora.` : "Elige el día y la hora en que quieres recibirlo.";
  syncWhen(); fillDates();
  // pago
  $("#payCard").disabled = !c.card_enabled;
  if (!c.card_enabled) $("#cardHint").textContent = "Disponible muy pronto";
  ($("#payCard").disabled ? $("#payTransfer") : $("#payCard")).checked = true;
  syncPay();
  // datos guardados del cliente
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); for (const k of ["cName", "cPhone", "cEmail", "address", "reference"]) if (p[k] && !$("#" + k).value) $("#" + k).value = k === "address" ? splitAddr(p[k]) : p[k]; if (p.locLabel && !state.locLabel) setLocLabel(p.locLabel); if (p.lat && !state.loc) state.loc = { lat: p.lat, lng: p.lng }; } catch {}
  setupMap();
  renderAcctBox(); renderPerks(); loadSaved();
  $("#promoBox").hidden = !state.acct || Boolean(state.acct.customer?.marketing_opt_in);
  renderSummary();
}

function renderAcctBox() {
  const box = $("#acctBox"), a = state.acct;
  $("#emailRow").hidden = false;
  if (a) {
    const c = a.customer;
    if (c.full_name && !$("#cName").value) $("#cName").value = c.full_name;
    if (c.phone && !$("#cPhone").value) $("#cPhone").value = c.phone;
    if (c.address && !$("#address").value) { const [dir, loc] = String(c.address).split(LOC_SEP); $("#address").value = dir; if (loc && !state.locLabel) setLocLabel(loc); }
    if (c.reference && !$("#reference").value) $("#reference").value = c.reference;
    if (c.lat && !state.loc) { state.loc = { lat: c.lat, lng: c.lng }; if (mapCtl) mapCtl.setView(c.lat, c.lng, 18); else requestQuote(); }
    box.innerHTML = `<p class="muted small" style="margin:6px 0 0">Pedido con tu cuenta de Google (${esc(c.email || "")}). Este pedido suma sellos a tu tarjeta y te avisamos cada paso a ese correo.</p>`;
    $("#emailRow").hidden = true;
    return;
  }
  if (state.guest) {
    box.innerHTML = `<p class="muted small" style="margin:6px 0 0">Pedido sin cuenta. <a href="#" id="wantGoogle">Crear cuenta y ganar un postre sorpresa</a></p>`;
    $("#wantGoogle").onclick = (e) => { e.preventDefault(); state.guest = false; renderAcctBox(); };
    return;
  }
  // Invitación compacta a crear cuenta: no le quita protagonismo a pedir sin cuenta
  const dots = Array.from({ length: 8 }, (_, i) => i < 2 ? `<span class="on"><img src="/assets/brand/s-tinta.svg" alt=""></span>` : i === 7 ? `<span class="goal" aria-label="Postre sorpresa">🎁</span>` : `<span>${i + 1}</span>`).join("");
  box.innerHTML = `<div class="join-mini">
      <div class="join-dots" aria-hidden="true">${dots}</div>
      <p class="jm-t"><b>Gana un postre sorpresa.</b> <span>Entra con Google y te regalamos los 2 primeros sellos.</span></p>
      <div class="jm-go">${googleButton("outline")}</div>
    </div>
    <p class="muted small jm-or">O pide sin cuenta, solo con estos datos:</p>`;
  try { localStorage.setItem(CART_KEY, JSON.stringify([...state.cart])); } catch {}
  mountGoogle(box, async () => { await refreshAccount(); toast("¡Listo! Ya sumas sellos con este pedido."); }, (e) => toast(e.message));
  stampAnim(box.querySelector(".join-mini"));
}
// Los 2 sellos de regalo "se ponen" uno tras otro cuando la tarjeta se ve, y se repite cada cierto tiempo
let stampTimer = null, stampObs = null;
function stampAnim(card) {
  if (!card || matchMedia("(prefers-reduced-motion: reduce)").matches) { card?.classList.add("play"); return; }
  clearInterval(stampTimer); stampObs?.disconnect();
  const play = () => { card.classList.remove("play"); void card.offsetWidth; card.classList.add("play"); };
  stampObs = new IntersectionObserver(([e]) => {
    clearInterval(stampTimer);
    if (e.isIntersecting && document.body.contains(card)) { play(); stampTimer = setInterval(play, 7000); }
  }, { threshold: 0.6 });
  stampObs.observe(card);
}

function renderPerks() {
  const box = $("#perksBox"), a = state.acct;
  if (!a) { box.innerHTML = ""; return; }
  let h = `<div style="margin-top:14px">${stampCard(a.stamps, { compact: true })}</div>`;
  if (a.rewards_available) {
    h += `<label class="perk ready check" style="margin-top:10px"><input type="checkbox" id="useReward"><div><b>Usar mi postre sorpresa 🎁</b><span class="muted small">Márcalo y cocina agrega gratis un postre especial elegido para ti. Si no lo marcas, lo guardas para otro pedido.${a.rewards_available > 1 ? ` Tienes ${a.rewards_available}: se usa uno por pedido.` : ""}</span></div></label>`;
  }
  if (a.birthday_available) {
    h += `<label class="perk ready check" style="margin-top:10px"><input type="checkbox" id="useBday"><div><b>Usar mi regalo de cumpleaños: −$4</b><span class="muted small">Disponible una vez durante tu mes.</span></div></label>`;
  }
  box.innerHTML = h;
  $("#useReward")?.addEventListener("change", renderSummary);
  $("#useBday")?.addEventListener("change", renderSummary);
}

const listNames = (ns) => ns.length > 1 ? ns.slice(0, -1).join(", ") + " y " + ns.at(-1) : ns[0];
const isSplit = () => $("#whenSplit").checked && !$("#splitChoice").hidden;
const leadKeys = () => [...state.cart.keys()].filter((k) => product(keyId(k)).lead_hours > 0);
const quickKeys = () => [...state.cart.keys()].filter((k) => !product(keyId(k)).lead_hours);
function syncWhen() {
  const later = $("#whenLater").checked, split = isSplit();
  $("#scheduleBox").hidden = !(later || split);
  $("#schedTimeLbl").textContent = split ? `Hora de entrega de ${listNames([...new Set(leadKeys().map((k) => product(keyId(k)).name))])}` : "Hora de entrega";
  $("#splitNote").hidden = !split;
  // la segunda entrega puede ir a otra dirección guardada (por ejemplo, la torta a casa de mamá)
  const addrs = state.saved?.addrs || [];
  $("#splitAddrBox").hidden = !split || !addrs.length;
  if (split && addrs.length) {
    const cur = $("#splitAddr").value;
    $("#splitAddrLbl").textContent = `¿Dónde entregamos ${listNames([...new Set(leadKeys().map((k) => product(keyId(k)).name))])}?`;
    $("#splitAddr").innerHTML = `<option value="">En la misma dirección del pedido</option>` + addrs.map((a) => `<option value="${a.id}">${esc(a.label)} · ${esc(a.address)}</option>`).join("");
    $("#splitAddr").value = cur;
  }
  if (split) $("#splitNote").textContent = "Pagas todo junto una sola vez. Cada entrega tiene su envío y su seguimiento.";
  fillDates(); if (state.loc) requestQuote(); else renderSummary();
}
$$('input[name="when"]').forEach((r) => r.addEventListener("change", syncWhen));

const secondAddr = () => isSplit() ? (state.saved?.addrs || []).find((a) => String(a.id) === $("#splitAddr").value) : null;
$("#splitAddr").addEventListener("change", async () => {
  const a = secondAddr(); state.quote2 = null; renderSummary();
  if (a) { try { state.quote2 = await api("cotizar", { lat: a.lat, lng: a.lng }); } catch (e) { toast(e.message); } renderSummary(); }
});
function maxLeadHours() { return Math.max(0, ...[...state.cart.keys()].map((k) => product(keyId(k)).lead_hours)); }
// Minutos para confirmar una transferencia (se suman a la hora de llegada)
const payExtra = () => ($("#payTransfer")?.checked ? Number(state.cfg.transfer_extra || 0) : 0);
// Lo que se agenda: todo el pedido, o en dos entregas solo el dulce entero
const schedKeys = () => (isSplit() ? leadKeys() : undefined);
function fillDates() {
  const opts = [], cur = $("#schedDate").value;
  for (let i = state.cfg.next_day_only ? 1 : 0; i <= 30; i++) { // se puede agendar hasta un mes antes
    const d = todayLocal(i);
    if (timesFor(d, schedKeys()).length) opts.push(`<option value="${d}">${i === 0 ? "Hoy" : i === 1 ? "Mañana" : new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "short", timeZone: "America/Guayaquil" })}</option>`);
  }
  $("#schedDate").innerHTML = opts.join("");
  if (cur && opts.some((o) => o.includes(`"${cur}"`))) $("#schedDate").value = cur;
  fillTimes();
}
function hoursFor(date) {
  const c = state.cfg, d = c.days?.find((x) => x.day === date);
  if (d) return d.closed ? null : d;
  return c.open_time ? { open: c.open_time, close: c.close_time } : null;
}
// Minutos desde que empezamos hasta que llega: preparación del producto más lento
// (congelado 50 / al momento 120) + trayecto del motorizado (+ 5 de margen y extras)
function needMinutes(keys = [...state.cart.keys()]) {
  const prep = Math.max(0, ...keys.map((k) => Number(product(keyId(k))?.prep_minutes) || 0));
  const travel = state.quote?.travel_min ?? 20; // sin ubicación aún: estimado
  const trx = $("#payTransfer")?.checked ? Number(state.cfg.transfer_extra || 0) : 0;
  return 5 + prep + travel + Number(state.cfg.busy_extra || 0) + trx;
}
function timesFor(date, keys) {
  const c = state.cfg, h = hoursFor(date);
  if (!h) return [];
  const [oh, om] = h.open.split(":").map(Number), [ch, cm] = h.close.split(":").map(Number);
  const need = needMinutes(keys);
  const lead = Math.max(0, ...(keys || [...state.cart.keys()]).map((k) => product(keyId(k))?.lead_hours || 0));
  const earliest = Date.now() + Math.max(need * 60000, lead * 3600000);
  // se prepara al momento: ningún día se entrega antes de abrir + preparación + trayecto
  const first = oh * 60 + om + need;
  const out = [];
  for (let m = Math.ceil(first / c.slot_minutes) * c.slot_minutes; m <= ch * 60 + cm; m += c.slot_minutes) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const at = new Date(localToISO(date, t)).getTime();
    if (at >= earliest && at <= Date.now() + 30 * 86400000 - 5 * 60000) out.push(t);
  }
  return out;
}
function fillTimes() {
  const cur = $("#schedTime").value;
  const ts = timesFor($("#schedDate").value, schedKeys());
  const win = Number(state.cfg.eta_window || 30);
  $("#schedTime").innerHTML = ts.map((t) => `<option value="${t}">${etaRange(localToISO($("#schedDate").value, t), { window: win, exact: true })}</option>`).join("");
  if (cur && ts.includes(cur)) $("#schedTime").value = cur;
  renderSummary();
}
$("#schedDate").addEventListener("change", fillTimes);
$("#schedTime").addEventListener("change", renderSummary);

// ---------- mapa ----------
async function setupMap() {
  if (mapCtl) { mapCtl.resize(); return; }
  const k = state.cfg.kitchen?.lat ? { lat: state.cfg.kitchen.lat, lng: state.cfg.kitchen.lng } : null;
  mapCtl = await createMap($("#map"), {
    start: state.loc, center: k, searchSlot: $("#searchSlot"),
    onPick: (lat, lng, addr) => {
      state.loc = { lat, lng };
      // La ubicación del mapa va en su propio campo; la dirección la escribe el cliente
      setLocLabel(addr || "Ubicación marcada en el mapa");
      if (state.addrPicked && state.addrPicked !== "new") { const a = state.saved?.addrs.find((x) => String(x.id) === state.addrPicked); if (a && (Math.abs(a.lat - lat) > 1e-5 || Math.abs(a.lng - lng) > 1e-5)) { state.addrPicked = "new"; $$("#savedAddr [data-addr]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.addr === "new")); $("#saveAddrBox").hidden = !state.acct; } }
      requestQuote();
    },
  });
  if (state.loc) { mapCtl.setView(state.loc.lat, state.loc.lng, 18); requestQuote(); }
}
const LOC_SEP = " · Ubicación del mapa: ";
// Direcciones y datos de factura guardados en la cuenta: se eligen con un toque
async function loadSaved() {
  state.saved = { addrs: [], invs: [] };
  if (state.acct) {
    const [a, i] = await Promise.all([
      sb.from("customer_addresses").select("*").order("is_default", { ascending: false }).order("created_at"),
      sb.from("customer_invoices").select("*").order("is_default", { ascending: false }).order("created_at"),
    ]);
    state.saved = { addrs: a.error ? [] : a.data, invs: i.error ? [] : i.data };
  }
  const { addrs, invs } = state.saved;
  const box = $("#savedAddr");
  box.hidden = !addrs.length;
  box.innerHTML = addrs.length ? `<span class="sc-lbl">Tus direcciones</span>` + addrs.map((a) => `<button type="button" class="chip-btn" data-addr="${a.id}">📍 ${esc(a.label)}</button>`).join("") + `<button type="button" class="chip-btn" data-addr="new">＋ Otra</button>` : "";
  box.querySelectorAll("[data-addr]").forEach((b) => (b.onclick = () => pickAddr(b.dataset.addr)));
  $("#saveAddrBox").hidden = !state.acct;
  if (addrs.length && !state.addrPicked) pickAddr(String(addrs[0].id)); // la principal, ya lista
  const ib = $("#savedInv");
  ib.hidden = !invs.length;
  ib.innerHTML = invs.length ? `<span class="sc-lbl">A nombre de</span>` + invs.map((x) => `<button type="button" class="chip-btn" data-inv="${x.id}">🧾 ${esc(x.name.split(" ").slice(0, 2).join(" "))}</button>`).join("") + `<button type="button" class="chip-btn" data-inv="new">＋ Otro</button>` : "";
  ib.querySelectorAll("[data-inv]").forEach((b) => (b.onclick = () => pickInv(b.dataset.inv)));
  $("#saveInvBox").hidden = !state.acct || invs.length > 0;
  if (invs.length) pickInv(String(invs[0].id));
  if (isSplit()) syncWhen();
}
function pickAddr(id) {
  state.addrPicked = id;
  $$("#savedAddr [data-addr]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.addr === id));
  const a = state.saved.addrs.find((x) => String(x.id) === id);
  $("#saveAddrBox").hidden = Boolean(a) || !state.acct;
  if (!a) { $("#address").value = ""; $("#reference").value = ""; $("#address").focus(); return; }
  $("#address").value = a.address; $("#reference").value = a.reference || "";
  setLocLabel(a.loc_label || `${a.label} (guardada)`);
  state.loc = { lat: a.lat, lng: a.lng };
  if (mapCtl) mapCtl.setView(a.lat, a.lng, 18);
  requestQuote();
}
function pickInv(id) {
  $$("#savedInv [data-inv]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.inv === id));
  const x = state.saved.invs.find((v) => String(v.id) === id);
  $("#invId").value = x?.id_number || ""; $("#invName").value = x?.name || ""; $("#invEmail").value = x?.email || "";
  $("#saveInvBox").hidden = Boolean(x) || !state.acct;
}
$("#saveAddr").onchange = (e) => { $("#saveAddrLabel").hidden = !e.target.checked; if (e.target.checked) $("#saveAddrLabel").focus(); };
// después de crear el pedido: guarda la dirección o la factura nueva si el cliente lo pidió
async function saveNewOnes(body) {
  const u = await currentUser(); if (!u) return;
  const jobs = [];
  if ($("#saveAddr").checked && !$("#saveAddrBox").hidden && state.loc) {
    jobs.push(sb.from("customer_addresses").insert({ user_id: u.id, label: ($("#saveAddrLabel").value.trim() || "Casa").slice(0, 30), address: $("#address").value.trim().slice(0, 200), reference: $("#reference").value.trim() || null, loc_label: state.locLabel, lat: state.loc.lat, lng: state.loc.lng, is_default: !state.saved.addrs.length }));
  }
  if ($("#saveInv").checked && !$("#saveInvBox").hidden && body.invoice_type === "con_datos") {
    jobs.push(sb.from("customer_invoices").insert({ user_id: u.id, id_number: body.invoice_id_number, name: body.invoice_name, email: body.invoice_email, is_default: !state.saved.invs.length }));
  }
  await Promise.all(jobs).catch(() => {});
}
function setLocLabel(t) { state.locLabel = t; $("#locLabel").textContent = t; $("#locLabel").classList.add("set"); }
// Al servidor va todo junto para que cocina y motorizado vean ambas cosas
function fullAddress() {
  const dir = $("#address").value.trim().slice(0, 130);
  const loc = state.locLabel && state.locLabel !== "Ubicación marcada en el mapa" ? state.locLabel : "";
  return loc ? (dir + LOC_SEP + loc).slice(0, 200) : dir;
}
const splitAddr = (a) => String(a || "").split(LOC_SEP)[0];
$("#locateMe").onclick = () => {
  if (!navigator.geolocation) return toast("Tu navegador no permite compartir ubicación. Busca tu dirección o mueve el mapa.");
  $("#locateMe").disabled = true;
  navigator.geolocation.getCurrentPosition(
    (p) => { $("#locateMe").disabled = false; mapCtl?.setView(p.coords.latitude, p.coords.longitude, 18); toast("Ajusta el mapa para que el pin quede en tu puerta."); },
    () => { $("#locateMe").disabled = false; toast("No pudimos obtener tu ubicación. Busca tu dirección o mueve el mapa."); },
    { enableHighAccuracy: true, timeout: 12000 },
  );
};

let quoteSeq = 0, quoteTimer;
function requestQuote() {
  clearTimeout(quoteTimer);
  $("#quoteBox").textContent = "Calculando envío…";
  quoteTimer = setTimeout(async () => {
    const my = ++quoteSeq;
    try {
      const q = await api("cotizar", { lat: state.loc.lat, lng: state.loc.lng, items: isSplit() ? cartItems(quickKeys()) : cartItems() });
      if (my !== quoteSeq) return;
      state.quote = q;
      renderQuote(); fillDates(); // las franjas dependen del trayecto real
    } catch (e) {
      if (my !== quoteSeq) return;
      state.quote = null; $("#quoteBox").innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
    renderSummary();
  }, 350);
}

// Envío y, solo si el pedido es para ahora con la tienda abierta, el rango de llegada
function renderQuote() {
  const q = state.quote; if (!q) return;
  if (!$("#whenNow").disabled && state.cfg.open_now && q.eta_if_now) $("#nowHint").textContent = `Llega hoy entre ${nowRange()}`;
  const now = ($("#whenNow").checked || isSplit()) && state.cfg.open_now && q.eta_if_now;
  $("#quoteBox").innerHTML = `Envío <b>${money(q.delivery_fee)}</b>${isSplit() ? " por entrega" : ""} · ${q.distance_km.toFixed(1).replace(".", ",")} km${now ? ` · ${isSplit() ? "lo de ahora " : ""}llega entre <b>${nowRange()}</b>` : ""}${state.cfg.busy_extra && now ? `<br>Hoy tenemos muchos pedidos, por eso la entrega toma un poco más.` : ""}`;
}
const nowRange = () => etaRange(new Date(new Date(state.quote.eta_if_now).getTime() + payExtra() * 60000).toISOString(), { window: Number(state.cfg.eta_window || 30) });
function laterRange() {
  if (!$("#schedTime").value) return "";
  const iso = localToISO($("#schedDate").value, $("#schedTime").value);
  const d = dayLabel(iso);
  return `${/^(Hoy|Mañana)$/.test(d) ? d.toLowerCase() : "el " + d}, ${etaRange(iso, { window: Number(state.cfg.eta_window || 30), exact: true })}`;
}

// ---------- resumen ----------
function renderSummary() {
  if (!state.cfg) return;
  const fee = state.quote?.delivery_fee;
  const split = isSplit();
  const fee2 = split && secondAddr() ? state.quote2?.delivery_fee : fee; // la segunda entrega puede ir a otra dirección
  const fees = fee != null && (!split || fee2 != null) ? fee + (split ? fee2 : 0) : null; // dos entregas = dos envíos completos
  const sub = subtotal();
  const disc = $("#useBday")?.checked ? Math.min(4, sub) : 0;
  const reward = $("#useReward")?.checked;
  const line = (k, q) => `<div class="line"><span>${q} × ${esc(lineName(k))}</span><span class="tabnum">${money(linePrice(k) * q)}</span></div>`;
  const now = state.quote?.eta_if_now && state.cfg.open_now ? `Llega entre ${nowRange()}` : "";
  let body;
  if (split) {
    body = `<p class="sum-h">Entrega 1 · ahora${now ? ` <span>${now.replace("Llega entre", "")}</span>` : ""}</p>` + quickKeys().map((k) => line(k, state.cart.get(k))).join("") +
      (reward ? `<div class="line"><span>1 × Postre sorpresa (regalo)</span><span class="tabnum">$0.00</span></div>` : "") +
      `<div class="line"><span>Envío</span><span class="tabnum">${fee != null ? money(fee) : "—"}</span></div>` +
      `<p class="sum-h">Entrega 2${laterRange() ? ` <span>${laterRange()}</span>` : ""}</p>` + leadKeys().map((k) => line(k, state.cart.get(k))).join("") +
      `<div class="line"><span>Envío${secondAddr() ? ` a ${esc(secondAddr().label)}` : ""}</span><span class="tabnum">${fee2 != null ? money(fee2) : "—"}</span></div>`;
  } else {
    body = [...state.cart].map(([k, q]) => line(k, q)).join("") +
      (reward ? `<div class="line"><span>1 × Postre sorpresa (regalo)</span><span class="tabnum">$0.00</span></div>` : "") +
      `<div class="line"><span>Envío</span><span class="tabnum">${fee != null ? money(fee) : "—"}</span></div>`;
  }
  const whenTxt = split ? "" : $("#whenLater").checked ? (laterRange() ? `Entrega ${laterRange()}` : "") : now;
  $("#summary").innerHTML = body +
    (disc ? `<div class="line"><span>Regalo de cumpleaños</span><span class="tabnum">−${money(disc)}</span></div>` : "") +
    `<div class="line total"><span>Total</span><span class="tabnum">${fees != null ? money(sub - disc + fees) : money(sub - disc) + " + envío"}</span></div>` +
    (whenTxt ? `<p class="muted small">${whenTxt}</p>` : "") +
    (state.acct ? `<p class="small" style="color:var(--accent-ink);margin:0;font-weight:600">Este pedido te da ${stampsFor(sub - disc)} ${stampsFor(sub - disc) === 1 ? "sello" : "sellos"}.</p>` : "");
  const card = $("#payCard").checked;
  $("#payBtn").textContent = fees != null ? `${card ? "Pagar" : "Confirmar pedido de"} ${money(sub - disc + fees)}` : card ? "Pagar" : "Confirmar pedido";
}

// ---------- extras del formulario ----------
$("#isGift").onchange = (e) => {
  $("#giftBox").hidden = !e.target.checked;
  if (e.target.checked && !$("#giftFrom").value) $("#giftFrom").value = $("#cName").value.trim(); // por defecto, quien compra
};
$("#wantInvoice").onchange = (e) => ($("#invoiceBox").hidden = !e.target.checked);
function syncPay() { $("#transferBox").hidden = !$("#payTransfer").checked; renderQuote(); if (state.cfg) fillDates(); renderSummary(); }
$$('input[name="pay"]').forEach((r) => r.addEventListener("change", syncPay));

// ---------- enviar ----------
$("#orderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#formErr"); err.textContent = "";
  const bad = (msg, el) => { err.textContent = msg; el?.focus(); };
  if (!state.cart.size) return bad("Tu carrito está vacío.");
  const later = $("#whenLater").checked, split = isSplit();
  if ((later || split) && !$("#schedTime").value) return bad("Elige un día y una hora de entrega.", $("#schedDate"));
  if (!state.loc) return bad("Marca tu ubicación en el mapa.", $("#locateMe"));
  if (!state.quote) return bad("Aún no tenemos el costo de envío para esa ubicación.");
  if (!$("#address").value.trim()) return bad("Escribe la dirección de entrega.", $("#address"));
  if (!$("#cName").value.trim()) return bad("Escribe tu nombre.", $("#cName"));
  if ($("#cPhone").value.replace(/\D/g, "").length < 10) return bad("Escribe tu WhatsApp de 10 dígitos.", $("#cPhone"));
  const mail = $("#cEmail").value.trim();
  if (!state.acct && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) return bad("Escribe tu correo para avisarte cómo va tu pedido.", $("#cEmail"));
  const pay = $("#payCard").checked ? "tarjeta" : "transferencia";

  const body = {
    items: split ? cartItems(quickKeys()) : cartItems(), lat: state.loc.lat, lng: state.loc.lng,
    address: fullAddress(), reference: $("#reference").value,
    scheduled_for: later ? localToISO($("#schedDate").value, $("#schedTime").value) : null,
    // dos entregas: el dulce entero va agendado como segundo pedido del mismo pago
    split: split ? { items: cartItems(leadKeys()), scheduled_for: localToISO($("#schedDate").value, $("#schedTime").value),
      ...(secondAddr() ? { lat: secondAddr().lat, lng: secondAddr().lng, address: secondAddr().address, reference: secondAddr().reference || "" } : {}) } : null,
    customer_name: $("#cName").value, customer_phone: $("#cPhone").value,
    customer_email: state.acct ? null : $("#cEmail").value.trim(),
    recipient_name: $("#isGift").checked ? $("#rName").value : null,
    recipient_phone: $("#isGift").checked && $("#rPhone").value ? $("#rPhone").value : null,
    gift_message: $("#isGift").checked ? $("#giftMsg").value : null,
    gift_from: $("#isGift").checked ? ($("#giftFrom").value.trim() || $("#cName").value.trim()) : null,
    invoice_type: $("#wantInvoice").checked ? "con_datos" : "consumidor_final",
    invoice_id_number: $("#invId").value, invoice_name: $("#invName").value, invoice_email: $("#invEmail").value,
    payment_method: pay,
    use_birthday: Boolean($("#useBday")?.checked),
    use_reward: Boolean($("#useReward")?.checked),
    ref: storedRef(),
  };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ cName: body.customer_name, cPhone: body.customer_phone, cEmail: $("#cEmail").value.trim(), address: $("#address").value.trim(), locLabel: state.locLabel, reference: body.reference, ...state.loc })); } catch {}

  const btn = $("#payBtn"); btn.disabled = true; btn.textContent = "Creando tu pedido…";
  try {
    const res = await api("crear", body);
    await saveNewOnes(body);
    if ($("#wantPromo").checked && !$("#promoBox").hidden) { try { await sb.rpc("set_marketing", { p_opt: true }); } catch {} }
    try { localStorage.setItem("tbs_ultimo_pedido", res.tracking_token); localStorage.removeItem(CART_KEY); } catch {}
    if (pay === "tarjeta") {
      btn.textContent = `Pagar ${money(res.total)}`; btn.disabled = false;
      openPayphone(res.payphone, `Pedido ${res.code} · Total ${money(res.total)}`, res.tracking_token);
    } else {
      // Los datos para pagar (QR o cuenta) solo se muestran a quien ya tiene un pedido
      location.href = `/pedido?t=${res.tracking_token}&pagar=1`;
    }
  } catch (ex) {
    btn.disabled = false; renderSummary(); err.textContent = ex.message;
  }
});

init();
