import { sb, api, $, $$, money, esc, hhmm, dayLabel, localToISO, todayLocal, toast } from "./common.js";
import { openPayphone } from "./payphone.js";
import { createMap } from "./mapa.js";
import { captureRef, storedRef, currentUser, loadAccount, stampCard, stampsFor, googleButton, mountGoogle } from "./account.js";

captureRef();

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
      (state.opts[r.product_id] ||= []).push(g);
    }
    if (cats.error) throw cats.error;
    if (prods.error) throw prods.error;
    state.cfg = cfg; state.cats = cats.data; state.products = prods.data;
  } catch (e) {
    $("#menu").innerHTML = `<p class="err">No pudimos cargar el menú. ${esc(e.message)}</p>`;
    return;
  }
  const c = state.cfg;
  renderStatus(c);
  const wa = waLink(c.whatsapp, "Hola The Bakery Side, tengo una consulta 🙂");
  if (wa) { $("#waFab").href = wa; $("#waFab").hidden = false; }
  try { JSON.parse(localStorage.getItem(CART_KEY) || "[]").forEach(([k, q]) => { k = String(k); if (state.products.some((p) => p.id === keyId(k)) && validKey(k)) state.cart.set(k, q); }); } catch {}
  renderCats(); renderMenu(); renderCart();
  await refreshAccount();
  if (new URLSearchParams(location.search).get("carrito") === "1") { history.replaceState(null, "", "/"); if (state.cart.size) openCart(); }
  if (new URLSearchParams(location.search).get("checkout") === "1" && state.cart.size) {
    history.replaceState(null, "", "/"); openCheckout();
  }
}

// Horario: aviso amable cuando no estamos abiertos
const WEEKDAY = (d) => new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { weekday: "long", timeZone: "America/Guayaquil" });
function whenLabel(n) { return !n ? null : n.in_days === 0 ? "hoy" : n.in_days === 1 ? "mañana" : `el ${WEEKDAY(n.day)}`; }
function renderStatus(c) {
  const n = c.next_open;
  // compatibilidad con la versión anterior del servidor
  const nextTxt = n ? `${whenLabel(n)} a las ${n.time}` : c.open_time ? `a las ${c.open_time}` : "pronto";
  $("#openTxt").innerHTML = c.open_now ? `Abierto<span class="long"> hasta ${c.close_time}</span>`
    : c.store_open ? `Cerrado<span class="long"> · abrimos ${nextTxt.replace(" a las ", " ")}</span>` : "Cerrado hoy";
  $("#openPill").classList.toggle("closed", !c.open_now);
  $("#closedCard").hidden = c.open_now;
  const today = c.days?.[0];
  $("#hoursTxt").textContent = c.open_now || today?.open ? `hoy de ${c.open_time} a ${c.close_time}` : "según el día";
  if (c.open_now) return;
  if (c.store_open) {
    $("#closedTitle").textContent = today?.closed && today.note ? `Hoy cerramos por ${today.note}` : "Estamos descansando";
    $("#closedText").innerHTML = `<span class="sub">Abrimos ${esc(nextTxt)}. Ya puedes agendar tu pedido.</span>`;
  } else {
    $("#closedTitle").textContent = "Hoy no recibimos pedidos";
    $("#closedText").innerHTML = `<span class="sub">Volvemos pronto. ¿Dudas? Escríbenos por WhatsApp.</span>`;
  }
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
  if (!$("#checkout").hidden) { renderAcctBox(); renderPerks(); renderSummary(); }
}

// ---------- menú ----------
function renderCats() {
  const names = ["Todo", ...state.cats.map((c) => c.name)];
  $("#cats").innerHTML = names.map((n) => `<button type="button" aria-pressed="${n === state.filter}" data-cat="${esc(n)}">${esc(n)}</button>`).join("");
}
$("#cats").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]"); if (!b) return;
  state.filter = b.dataset.cat; renderCats(); renderMenu();
});

// Stock del día: null = sin límite, 0 = agotado hoy, N = quedan N hoy
function leftToday(p) {
  const today = todayLocal();
  if (p.sold_out_day === today) return 0;
  if (p.stock_day === today && p.stock_left != null) return p.stock_left;
  return null;
}
function itemCard(p) {
  const q = qtyOf(p.id);
  if (groupsOf(p.id).length) return itemCardOpts(p, q);
  const left = leftToday(p);
  const img = p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="can" aria-hidden="true">${esc(p.name.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>`;
  const ctrl = left === 0 && !q
    ? `<button class="btn small" type="button" disabled>Agotado hoy</button>`
    : q
    ? `<div class="qty"><button type="button" data-a="-" data-id="${p.id}" aria-label="Quitar uno">−</button><span>${q}</span><button type="button" data-a="+" data-id="${p.id}" aria-label="Agregar uno"${left != null && q >= left ? " disabled" : ""}>+</button></div>`
    : `<button class="btn small" type="button" data-a="+" data-id="${p.id}">Agregar</button>`;
  const lead = p.lead_hours ? `<span class="tag">Pedir con ${p.lead_hours} h de anticipación</span>` : "";
  const stock = left === 0 ? `<span class="tag">Agotado por hoy · vuelve mañana</span>`
    : left != null ? `<span class="tag">Quedan ${left} hoy</span>` : "";
  return `<article class="item${left === 0 ? " soldout" : ""}"><div class="ph">${img}</div><div class="body"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>${lead}${stock}<div class="foot"><span class="price">${money(p.price)}</span>${ctrl}</div></div></article>`;
}
function renderMenu() {
  const groups = state.cats
    .filter((c) => state.filter === "Todo" || c.name === state.filter)
    .map((c) => ({ c, items: state.products.filter((p) => p.category_id === c.id) }));
  $("#menu").innerHTML = groups.length
    ? groups.map((g) => `<h3 class="cat-title">${esc(g.c.name)}</h3>${g.items.length
        ? `<div class="menu-grid">${g.items.map(itemCard).join("")}</div>`
        : `<div class="soon"><span class="display">Próximamente</span><span class="muted small">Estamos preparando esta sección.</span></div>`}`).join("")
    : `<p class="muted">Pronto publicaremos el menú.</p>`;
}
$("#menu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  const id = Number(b.dataset.id);
  if (b.dataset.a === "pick") return openPicker(product(id));
  changeQty(String(id), b.dataset.a === "+" ? 1 : -1);
});
function changeQty(key, d) {
  const id = keyId(key);
  const q = (state.cart.get(key) || 0) + d;
  const left = leftToday(product(id));
  if (d > 0 && left != null && qtyOf(id) + d > left) { toast(left ? `Solo quedan ${left} hoy` : "Agotado por hoy"); return; }
  if (q <= 0) state.cart.delete(key); else state.cart.set(key, Math.min(q, 50));
  try { localStorage.setItem(CART_KEY, JSON.stringify([...state.cart])); } catch {}
  renderMenu(); renderCart(); if (state.loc) requestQuote();
}

// ---------- carrito ----------
// Cada línea del carrito: "id" o "id:opción.opción" (por ejemplo "12:3" = Cold Brew con Stevia)
const keyId = (k) => Number(String(k).split(":")[0]);
const keyOpts = (k) => (String(k).split(":")[1] || "").split(".").filter(Boolean).map(Number);
const groupsOf = (id) => state.opts?.[id] || [];
const qtyOf = (id) => [...state.cart].reduce((s, [k, q]) => s + (keyId(k) === id ? q : 0), 0);
const choiceOf = (cid) => { for (const gs of Object.values(state.opts || {})) for (const g of gs) { const c = g.option_choices.find((x) => x.id === cid); if (c) return c; } return null; };
function validKey(k) {
  const gs = groupsOf(keyId(k)), opts = keyOpts(k);
  return gs.every((g) => !g.required || g.option_choices.some((c) => opts.includes(c.id)));
}
const lineName = (k) => { const n = keyOpts(k).map((c) => choiceOf(c)?.name).filter(Boolean); return product(keyId(k)).name + (n.length ? ` (${n.join(", ")})` : ""); };
const linePrice = (k) => Number(product(keyId(k)).price) + keyOpts(k).reduce((s, c) => s + Number(choiceOf(c)?.price_delta || 0), 0);
const cartItems = () => [...state.cart].map(([k, quantity]) => ({ product_id: keyId(k), quantity, options: keyOpts(k) }));
const product = (id) => state.products.find((p) => p.id === id);
const subtotal = () => [...state.cart].reduce((s, [k, q]) => s + linePrice(k) * q, 0);

// Productos con opciones (por ejemplo, el endulzante de las bebidas)
function itemCardOpts(p, q) {
  const left = leftToday(p);
  const img = p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="can" aria-hidden="true">${esc(p.name.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>`;
  const ctrl = left === 0 && !q ? `<button class="btn small" type="button" disabled>Agotado hoy</button>`
    : `<button class="btn small" type="button" data-a="pick" data-id="${p.id}"${left != null && q >= left ? " disabled" : ""}>${q ? `Agregar otra <span class="incart">${q}</span>` : "Agregar"}</button>`;
  const stock = left === 0 ? `<span class="tag">Agotado por hoy · vuelve mañana</span>` : left != null ? `<span class="tag">Quedan ${left} hoy</span>` : "";
  const hint = `<span class="optnote">Eliges ${groupsOf(p.id).map((g) => g.name.toLowerCase()).join(" y ")} al agregar</span>`;
  return `<article class="item${left === 0 ? " soldout" : ""}"><div class="ph">${img}</div><div class="body"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>${hint}${stock}<div class="foot"><span class="price">${money(p.price)}</span>${ctrl}</div></div></article>`;
}
function openPicker(p) {
  const gs = groupsOf(p.id);
  const box = $("#optModal");
  box.querySelector(".opt-title").textContent = p.name;
  box.querySelector(".opt-body").innerHTML = gs.map((g) => `<fieldset class="optgroup"><legend>${esc(g.name)}${g.required ? "" : ' <span class="muted small">(opcional)</span>'}</legend>
    ${g.option_choices.map((c) => `<label class="optchoice"><input type="radio" name="g${g.id}" value="${c.id}"><span>${esc(c.name)}</span>${Number(c.price_delta) > 0 ? `<span class="muted small">+${money(c.price_delta)}</span>` : `<span class="free">+$0.00</span>`}</label>`).join("")}
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
    ? lines.join("") + `<div class="line total"><span>Subtotal</span><span class="tabnum">${money(subtotal())}</span></div><p class="muted small" style="margin:0">El envío se calcula con tu ubicación.</p>`
    : `<div class="cart-empty"><b>Tu pedido está vacío</b><span class="muted small">Agrega algo rico del menú para empezar.</span></div>`;
  $("#goCheckout").disabled = !n;
  $("#mbCount").textContent = n; $("#mbWord").textContent = n === 1 ? "producto" : "productos"; $("#mbTotal").textContent = money(subtotal());
  $("#cartCount").textContent = n; $("#cartCount").hidden = !n;
  $("#mobileBar").hidden = !n || !$("#checkout").hidden;
  renderSummary();
}
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
$("#mbOpen").onclick = openCart;
$("#cartBtn").onclick = openCart;
$("#closeCart").onclick = closeCart;
$("#cartScrim").onclick = closeCart;
$("#goCheckout").onclick = () => { closeCart(); openCheckout(); };
$("#backToMenu").onclick = backToMenu;

// ---------- checkout ----------
let mapCtl = null;
function openCheckout() {
  $("#cart").classList.remove("open");
  $(".layout").hidden = true; $(".intro").hidden = true; $("#checkout").hidden = false; $("#mobileBar").hidden = true;
  document.body.classList.add("in-checkout");
  scrollTo(0, 0);
  const c = state.cfg;
  // cuándo
  $("#whenNow").disabled = !c.open_now;
  $("#nowHint").textContent = c.open_now ? "Te mostramos la hora estimada" : (c.next_open ? `Ahora no: abrimos ${whenLabel(c.next_open)} a las ${c.next_open.time}` : "Ahora no estamos atendiendo");
  const needLead = [...state.cart.keys()].some((k) => product(keyId(k)).lead_hours > 0);
  if (needLead) { $("#whenNow").disabled = true; $("#nowHint").textContent = "Tu pedido necesita agendarse"; }
  ($("#whenNow").disabled ? $("#whenLater") : $("#whenNow")).checked = true;
  syncWhen(); fillDates();
  // pago
  $("#payCard").disabled = !c.card_enabled;
  if (!c.card_enabled) $("#cardHint").textContent = "Disponible muy pronto";
  ($("#payCard").disabled ? $("#payTransfer") : $("#payCard")).checked = true;
  syncPay();
  // datos guardados del cliente
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); for (const k of ["cName", "cPhone", "address", "reference"]) if (p[k] && !$("#" + k).value) $("#" + k).value = k === "address" ? splitAddr(p[k]) : p[k]; if (p.locLabel && !state.locLabel) setLocLabel(p.locLabel); if (p.lat && !state.loc) state.loc = { lat: p.lat, lng: p.lng }; } catch {}
  setupMap();
  renderAcctBox(); renderPerks();
  renderSummary();
}

function renderAcctBox() {
  const box = $("#acctBox"), a = state.acct;
  if (a) {
    const c = a.customer;
    if (c.full_name && !$("#cName").value) $("#cName").value = c.full_name;
    if (c.phone && !$("#cPhone").value) $("#cPhone").value = c.phone;
    if (c.address && !$("#address").value) { const [dir, loc] = String(c.address).split(LOC_SEP); $("#address").value = dir; if (loc && !state.locLabel) setLocLabel(loc); }
    if (c.reference && !$("#reference").value) $("#reference").value = c.reference;
    if (c.lat && !state.loc) { state.loc = { lat: c.lat, lng: c.lng }; if (mapCtl) mapCtl.setView(c.lat, c.lng, 18); else requestQuote(); }
    box.innerHTML = `<p class="muted small" style="margin:6px 0 0">Pedido con tu cuenta de Google (${esc(c.email || "")}). Este pedido suma sellos a tu tarjeta.</p>`;
    return;
  }
  if (state.guest) {
    box.innerHTML = `<p class="muted small" style="margin:6px 0 0">Pedido como invitado. <a href="#" id="wantGoogle">Entrar con Google y sumar sellos</a></p>`;
    $("#wantGoogle").onclick = (e) => { e.preventDefault(); state.guest = false; renderAcctBox(); };
    return;
  }
  box.innerHTML = `<div class="guest-or">
      <p><b>Entra con Google y empieza con 2 sellos de regalo.</b> <span class="muted small">Ganas 1 sello por cada $10, una cookie gratis al llegar a 8, y guardamos tus datos para la próxima.</span></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${googleButton()}<button class="btn ghost" type="button" id="asGuest">Seguir como invitado</button></div>
    </div>`;
  try { localStorage.setItem(CART_KEY, JSON.stringify([...state.cart])); } catch {}
  mountGoogle(box, async () => { await refreshAccount(); toast("¡Listo! Ya sumas sellos con este pedido."); }, (e) => toast(e.message));
  $("#asGuest").onclick = () => { state.guest = true; renderAcctBox(); renderPerks(); };
}

function renderPerks() {
  const box = $("#perksBox"), a = state.acct;
  if (!a) { box.innerHTML = ""; return; }
  const cookies = state.products.filter((p) => a.cookies.includes(p.name));
  let h = `<div style="margin-top:14px">${stampCard(a.stamps, { compact: true })}</div>`;
  if (a.rewards_available && cookies.length) {
    h += `<div class="perk ready" style="margin-top:10px"><div style="flex:1"><b>Tienes una cookie gratis</b>
      <label class="f" for="rewardPick" style="margin-top:6px">Elige tu cookie <span class="hint">(opcional)</span></label>
      <select class="in" id="rewardPick"><option value="">Guardarla para otro pedido</option>${cookies.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div></div>`;
  }
  if (a.birthday_available) {
    h += `<label class="perk ready check" style="margin-top:10px"><input type="checkbox" id="useBday"><div><b>Usar mi regalo de cumpleaños: −$4</b><span class="muted small">Disponible una vez durante tu mes.</span></div></label>`;
  }
  box.innerHTML = h;
  $("#rewardPick")?.addEventListener("change", renderSummary);
  $("#useBday")?.addEventListener("change", renderSummary);
}

function syncWhen() { $("#scheduleBox").hidden = !$("#whenLater").checked; renderSummary(); }
$$('input[name="when"]').forEach((r) => r.addEventListener("change", syncWhen));

function maxLeadHours() { return Math.max(0, ...[...state.cart.keys()].map((k) => product(keyId(k)).lead_hours)); }
function fillDates() {
  const opts = [];
  for (let i = 0; i < 14; i++) {
    const d = todayLocal(i);
    if (timesFor(d).length) opts.push(`<option value="${d}">${i === 0 ? "Hoy" : i === 1 ? "Mañana" : new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "short", timeZone: "America/Guayaquil" })}</option>`);
  }
  $("#schedDate").innerHTML = opts.join("");
  fillTimes();
}
function hoursFor(date) {
  const c = state.cfg, d = c.days?.find((x) => x.day === date);
  if (d) return d.closed ? null : d;
  return c.open_time ? { open: c.open_time, close: c.close_time } : null;
}
function timesFor(date) {
  const c = state.cfg, h = hoursFor(date);
  if (!h) return [];
  const [oh, om] = h.open.split(":").map(Number), [ch, cm] = h.close.split(":").map(Number);
  const earliest = Date.now() + Math.max(60 * 60000, maxLeadHours() * 3600000);
  const out = [];
  for (let m = oh * 60 + om; m <= ch * 60 + cm; m += c.slot_minutes) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (new Date(localToISO(date, t)).getTime() >= earliest) out.push(t);
  }
  return out;
}
function fillTimes() {
  const ts = timesFor($("#schedDate").value);
  $("#schedTime").innerHTML = ts.map((t) => `<option value="${t}">${t}</option>`).join("");
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
      requestQuote();
    },
  });
  if (state.loc) { mapCtl.setView(state.loc.lat, state.loc.lng, 18); requestQuote(); }
}
const LOC_SEP = " · Ubicación del mapa: ";
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
      const q = await api("cotizar", { lat: state.loc.lat, lng: state.loc.lng, items: cartItems() });
      if (my !== quoteSeq) return;
      state.quote = q;
      $("#quoteBox").innerHTML = `Envío <b>${money(q.delivery_fee)}</b> · ${q.distance_km.toFixed(1)} km${q.eta_if_now ? ` · si sale ahora, llega aprox. <b>${hhmm(q.eta_if_now)}</b>` : ""}${state.cfg.busy_extra && q.eta_if_now ? `<br>Hoy tenemos muchos pedidos, por eso la entrega toma un poco más.` : ""}`;
    } catch (e) {
      if (my !== quoteSeq) return;
      state.quote = null; $("#quoteBox").innerHTML = `<span class="err">${esc(e.message)}</span>`;
    }
    renderSummary();
  }, 350);
}

// ---------- resumen ----------
function renderSummary() {
  if (!state.cfg) return;
  const fee = state.quote?.delivery_fee;
  const sub = subtotal();
  const disc = $("#useBday")?.checked ? Math.min(4, sub) : 0;
  const freeId = Number($("#rewardPick")?.value || 0);
  const free = freeId ? product(freeId) : null;
  let whenTxt = "";
  if ($("#whenLater").checked && $("#schedTime").value) whenTxt = `Entrega ${dayLabel(localToISO($("#schedDate").value, $("#schedTime").value))} a las ${$("#schedTime").value}`;
  else if (state.quote?.eta_if_now) whenTxt = `Llega aprox. a las ${hhmm(state.quote.eta_if_now)}`;
  $("#summary").innerHTML =
    [...state.cart].map(([k, q]) => `<div class="line"><span>${q} × ${esc(lineName(k))}</span><span class="tabnum">${money(linePrice(k) * q)}</span></div>`).join("") +
    (free ? `<div class="line"><span>1 × ${esc(free.name)} (regalo)</span><span class="tabnum">$0.00</span></div>` : "") +
    (disc ? `<div class="line"><span>Regalo de cumpleaños</span><span class="tabnum">−${money(disc)}</span></div>` : "") +
    `<div class="line"><span>Envío</span><span class="tabnum">${fee != null ? money(fee) : "—"}</span></div>` +
    `<div class="line total"><span>Total</span><span class="tabnum">${fee != null ? money(sub - disc + fee) : money(sub - disc) + " + envío"}</span></div>` +
    (whenTxt ? `<p class="muted small">${whenTxt}</p>` : "") +
    (state.acct ? `<p class="small" style="color:var(--accent-ink);margin:0;font-weight:600">Este pedido te da ${stampsFor(sub - disc)} ${stampsFor(sub - disc) === 1 ? "sello" : "sellos"}.</p>` : "");
  const card = $("#payCard").checked;
  $("#payBtn").textContent = fee != null ? `${card ? "Pagar" : "Confirmar pedido de"} ${money(sub - disc + fee)}` : card ? "Pagar" : "Confirmar pedido";
}

// ---------- extras del formulario ----------
$("#isGift").onchange = (e) => ($("#giftBox").hidden = !e.target.checked);
$("#wantInvoice").onchange = (e) => ($("#invoiceBox").hidden = !e.target.checked);
function syncPay() { $("#transferBox").hidden = !$("#payTransfer").checked; renderSummary(); }
$$('input[name="pay"]').forEach((r) => r.addEventListener("change", syncPay));

// ---------- enviar ----------
$("#orderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#formErr"); err.textContent = "";
  const bad = (msg, el) => { err.textContent = msg; el?.focus(); };
  if (!state.cart.size) return bad("Tu carrito está vacío.");
  const later = $("#whenLater").checked;
  if (later && !$("#schedTime").value) return bad("Elige un día y una hora de entrega.", $("#schedDate"));
  if (!state.loc) return bad("Marca tu ubicación en el mapa.", $("#locateMe"));
  if (!state.quote) return bad("Aún no tenemos el costo de envío para esa ubicación.");
  if (!$("#address").value.trim()) return bad("Escribe la dirección de entrega.", $("#address"));
  if (!$("#cName").value.trim()) return bad("Escribe tu nombre.", $("#cName"));
  if ($("#cPhone").value.replace(/\D/g, "").length < 10) return bad("Escribe tu WhatsApp de 10 dígitos.", $("#cPhone"));
  const pay = $("#payCard").checked ? "tarjeta" : "transferencia";

  const body = {
    items: cartItems(), lat: state.loc.lat, lng: state.loc.lng,
    address: fullAddress(), reference: $("#reference").value,
    scheduled_for: later ? localToISO($("#schedDate").value, $("#schedTime").value) : null,
    customer_name: $("#cName").value, customer_phone: $("#cPhone").value,
    recipient_name: $("#isGift").checked ? $("#rName").value : null,
    recipient_phone: $("#isGift").checked && $("#rPhone").value ? $("#rPhone").value : null,
    gift_message: $("#isGift").checked ? $("#giftMsg").value : null,
    invoice_type: $("#wantInvoice").checked ? "con_datos" : "consumidor_final",
    invoice_id_number: $("#invId").value, invoice_name: $("#invName").value, invoice_email: $("#invEmail").value,
    payment_method: pay,
    use_birthday: Boolean($("#useBday")?.checked),
    reward_product_id: Number($("#rewardPick")?.value || 0) || null,
    ref: storedRef(),
  };
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ cName: body.customer_name, cPhone: body.customer_phone, address: $("#address").value.trim(), locLabel: state.locLabel, reference: body.reference, ...state.loc })); } catch {}

  const btn = $("#payBtn"); btn.disabled = true; btn.textContent = "Creando tu pedido…";
  try {
    const res = await api("crear", body);
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
