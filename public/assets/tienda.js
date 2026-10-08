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
    const [cfg, cats, prods] = await Promise.all([
      api("config"),
      sb.from("categories").select("id,name,sort").eq("active", true).order("sort"),
      sb.from("products").select("id,category_id,name,description,price,prep_minutes,lead_hours,image_url,sort").eq("active", true).order("sort"),
    ]);
    if (cats.error) throw cats.error;
    if (prods.error) throw prods.error;
    state.cfg = cfg; state.cats = cats.data; state.products = prods.data;
  } catch (e) {
    $("#menu").innerHTML = `<p class="err">No pudimos cargar el menú. ${esc(e.message)}</p>`;
    return;
  }
  const c = state.cfg;
  $("#hoursTxt").textContent = `${c.open_time} a ${c.close_time}`;
  $("#openTxt").textContent = c.open_now ? "Abierto ahora" : (c.store_open ? "Fuera de horario · agenda tu pedido" : "Cerrado temporalmente");
  $("#openPill").classList.toggle("closed", !c.open_now);
  try { JSON.parse(localStorage.getItem(CART_KEY) || "[]").forEach(([id, q]) => state.products.some((p) => p.id === id) && state.cart.set(id, q)); } catch {}
  renderCats(); renderMenu(); renderCart();
  await refreshAccount();
  if (new URLSearchParams(location.search).get("checkout") === "1" && state.cart.size) {
    history.replaceState(null, "", "/"); openCheckout();
  }
}

async function refreshAccount() {
  try { state.acct = (await currentUser()) ? await loadAccount() : null; } catch { state.acct = null; }
  const b = $("#acctBtn");
  b.innerHTML = state.acct ? `Mis sellos <span class="mini tabnum">${state.acct.stamps}/8</span>` : "Mis sellos";
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

function itemCard(p) {
  const q = state.cart.get(p.id) || 0;
  const img = p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy">` : `<span class="can" aria-hidden="true">${esc(p.name.split(" ").map((w) => w[0]).join("").slice(0, 2))}</span>`;
  const ctrl = q
    ? `<div class="qty"><button type="button" data-a="-" data-id="${p.id}" aria-label="Quitar uno">−</button><span>${q}</span><button type="button" data-a="+" data-id="${p.id}" aria-label="Agregar uno">+</button></div>`
    : `<button class="btn small" type="button" data-a="+" data-id="${p.id}">Agregar</button>`;
  const lead = p.lead_hours ? `<span class="small" style="color:var(--aviso)">Pedir con ${p.lead_hours} h de anticipación</span>` : "";
  return `<article class="item"><div class="ph">${img}</div><div class="body"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p>${lead}<div class="foot"><span class="price">${money(p.price)}</span>${ctrl}</div></div></article>`;
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
  changeQty(Number(b.dataset.id), b.dataset.a === "+" ? 1 : -1);
});
function changeQty(id, d) {
  const q = (state.cart.get(id) || 0) + d;
  if (q <= 0) state.cart.delete(id); else state.cart.set(id, Math.min(q, 50));
  try { localStorage.setItem(CART_KEY, JSON.stringify([...state.cart])); } catch {}
  renderMenu(); renderCart(); if (state.loc) requestQuote();
}

// ---------- carrito ----------
const cartItems = () => [...state.cart].map(([product_id, quantity]) => ({ product_id, quantity }));
const product = (id) => state.products.find((p) => p.id === id);
const subtotal = () => [...state.cart].reduce((s, [id, q]) => s + Number(product(id).price) * q, 0);

function renderCart() {
  const lines = [...state.cart].map(([id, q]) => {
    const p = product(id);
    return `<div class="line"><span>${q} × ${esc(p.name)}</span><span class="tabnum">${money(p.price * q)}</span></div>`;
  });
  const n = [...state.cart.values()].reduce((a, b) => a + b, 0);
  $("#cartLines").innerHTML = lines.length
    ? lines.join("") + `<div class="line total"><span>Subtotal</span><span class="tabnum">${money(subtotal())}</span></div><p class="muted small">El envío se calcula con tu ubicación.</p>`
    : `<p class="muted">Agrega productos del menú para empezar.</p>`;
  $("#goCheckout").disabled = !n;
  $("#mbCount").textContent = n; $("#mbTotal").textContent = money(subtotal());
  $("#mobileBar").hidden = !n || !$("#checkout").hidden;
  renderSummary();
}
$("#mbOpen").onclick = () => $("#cart").classList.add("open");
$("#closeCart").onclick = () => $("#cart").classList.remove("open");
$("#goCheckout").onclick = openCheckout;
$("#backToMenu").onclick = () => {
  $("#checkout").hidden = true; $(".layout").hidden = false; $(".intro").hidden = false; renderCart(); scrollTo(0, 0);
};

// ---------- checkout ----------
let mapCtl = null;
function openCheckout() {
  $("#cart").classList.remove("open");
  $(".layout").hidden = true; $(".intro").hidden = true; $("#checkout").hidden = false; $("#mobileBar").hidden = true;
  scrollTo(0, 0);
  const c = state.cfg;
  // cuándo
  $("#whenNow").disabled = !c.open_now;
  $("#nowHint").textContent = c.open_now ? "Te mostramos la hora estimada" : `Ahora no: pedidos de ${c.open_time} a ${c.close_time}`;
  const needLead = [...state.cart.keys()].some((id) => product(id).lead_hours > 0);
  if (needLead) { $("#whenNow").disabled = true; $("#nowHint").textContent = "Tu pedido necesita agendarse"; }
  ($("#whenNow").disabled ? $("#whenLater") : $("#whenNow")).checked = true;
  syncWhen(); fillDates();
  // pago
  $("#payCard").disabled = !c.card_enabled;
  if (!c.card_enabled) $("#cardHint").textContent = "Disponible muy pronto";
  ($("#payCard").disabled ? $("#payTransfer") : $("#payCard")).checked = true;
  $("#bankInfo").textContent = c.bank_info || "Escríbenos por WhatsApp para recibir los datos de la cuenta.";
  syncPay();
  // datos guardados del cliente
  try { const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); for (const k of ["cName", "cPhone", "address", "reference"]) if (p[k] && !$("#" + k).value) $("#" + k).value = p[k]; if (p.lat && !state.loc) state.loc = { lat: p.lat, lng: p.lng }; } catch {}
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
    if (c.address && !$("#address").value) $("#address").value = c.address;
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

function maxLeadHours() { return Math.max(0, ...[...state.cart.keys()].map((id) => product(id).lead_hours)); }
function fillDates() {
  const opts = [];
  for (let i = 0; i < 14; i++) {
    const d = todayLocal(i);
    if (timesFor(d).length) opts.push(`<option value="${d}">${i === 0 ? "Hoy" : i === 1 ? "Mañana" : new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "short", timeZone: "America/Guayaquil" })}</option>`);
  }
  $("#schedDate").innerHTML = opts.join("");
  fillTimes();
}
function timesFor(date) {
  const c = state.cfg, [oh, om] = c.open_time.split(":").map(Number), [ch, cm] = c.close_time.split(":").map(Number);
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
      // completamos la dirección solo si el cliente no la escribió a mano
      if (addr && (!$("#address").value.trim() || state.autoAddr)) { $("#address").value = addr; state.autoAddr = true; }
      requestQuote();
    },
  });
  if (state.loc) { mapCtl.setView(state.loc.lat, state.loc.lng, 18); requestQuote(); }
}
$("#address").addEventListener("input", () => (state.autoAddr = false));
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
      $("#quoteBox").innerHTML = `Envío <b>${money(q.delivery_fee)}</b> · ${q.distance_km.toFixed(1)} km${q.eta_if_now ? ` · si sale ahora, llega aprox. <b>${hhmm(q.eta_if_now)}</b>` : ""}`;
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
    [...state.cart].map(([id, q]) => `<div class="line"><span>${q} × ${esc(product(id).name)}</span><span class="tabnum">${money(product(id).price * q)}</span></div>`).join("") +
    (free ? `<div class="line"><span>1 × ${esc(free.name)} (regalo)</span><span class="tabnum">$0.00</span></div>` : "") +
    (disc ? `<div class="line"><span>Regalo de cumpleaños</span><span class="tabnum">−${money(disc)}</span></div>` : "") +
    `<div class="line"><span>Envío</span><span class="tabnum">${fee != null ? money(fee) : "—"}</span></div>` +
    `<div class="line total"><span>Total</span><span class="tabnum">${fee != null ? money(sub - disc + fee) : money(sub - disc) + " + envío"}</span></div>` +
    (whenTxt ? `<p class="muted small">${whenTxt}</p>` : "") +
    (state.acct ? `<p class="small" style="color:var(--tostado-2);margin:0">Este pedido te da ${stampsFor(sub - disc)} ${stampsFor(sub - disc) === 1 ? "sello" : "sellos"}.</p>` : "");
  $("#payBtn").textContent = fee != null ? `Pagar ${money(sub - disc + fee)}` : "Pagar";
}

// ---------- extras del formulario ----------
$("#isGift").onchange = (e) => ($("#giftBox").hidden = !e.target.checked);
$("#wantInvoice").onchange = (e) => ($("#invoiceBox").hidden = !e.target.checked);
function syncPay() { $("#transferBox").hidden = !$("#payTransfer").checked; }
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
  const file = $("#receipt").files[0];
  if (pay === "transferencia") {
    if (!file) return bad("Sube la foto del comprobante de tu transferencia.", $("#receipt"));
    if (file.size > 8 * 1024 * 1024) return bad("La foto pesa más de 8 MB. Envía una más liviana.", $("#receipt"));
  }

  const body = {
    items: cartItems(), lat: state.loc.lat, lng: state.loc.lng,
    address: $("#address").value, reference: $("#reference").value,
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
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ cName: body.customer_name, cPhone: body.customer_phone, address: body.address, reference: body.reference, ...state.loc })); } catch {}

  const btn = $("#payBtn"); btn.disabled = true; btn.textContent = "Creando tu pedido…";
  try {
    const res = await api("crear", body);
    try { localStorage.setItem("tbs_ultimo_pedido", res.tracking_token); localStorage.removeItem(CART_KEY); } catch {}
    if (pay === "tarjeta") {
      btn.textContent = `Pagar ${money(res.total)}`; btn.disabled = false;
      openPayphone(res.payphone, `Pedido ${res.code} · Total ${money(res.total)}`, res.tracking_token);
    } else {
      btn.textContent = "Enviando comprobante…";
      const { error } = await sb.storage.from("comprobantes").uploadToSignedUrl(res.upload.path, res.upload.token, file, { contentType: file.type || "image/jpeg" });
      if (error) throw new Error("No pudimos subir el comprobante. Tu pedido quedó guardado; súbelo desde el seguimiento.");
      await api("comprobante", { tracking_token: res.tracking_token, path: res.upload.path, reference: $("#receiptRef").value });
      location.href = `/pedido?t=${res.tracking_token}`;
    }
  } catch (ex) {
    btn.disabled = false; renderSummary(); err.textContent = ex.message;
  }
});

init();
