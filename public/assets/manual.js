// Pedido por WhatsApp: cocina o master lo registran con lo mínimo y le mandan al cliente el enlace de pago
import { sb, api, $, $$, money, esc, hhmm, when, toast, waLink, localToISO, todayLocal } from "./common.js";
import { createMap } from "./mapa.js";

const SITE = "https://thebakeryside.com";
const QUICK = [
  ["/hola · Saludo y menú", "¡Hola! 🧁 Gracias por escribir a The Bakery Side. Este es nuestro menú: " + SITE + "\n\nCuéntame qué te gustaría y te tomo el pedido por aquí mismo."],
  ["/datos · Pedir datos", "¡Perfecto! Para tu pedido necesito:\n1️⃣ Tu nombre\n2️⃣ Tu ubicación (📎 → Ubicación → Enviar mi ubicación actual)\n3️⃣ Dirección y una referencia (ej.: Urdesa, Calle 5 #214, casa blanca)\n4️⃣ ¿Lo quieres ahora o para qué día y hora?\n5️⃣ ¿Es un regalo? Dime quién lo recibe y el mensaje para la tarjeta 💌"],
  ["/recibido · Pago recibido", "¡Recibimos tu pago, gracias! 🙌 Ya estamos con tu pedido."],
];

let st = null;

export async function renderManual(view) {
  st = { cart: new Map(), loc: null, locLabel: "", quote: null, cfg: null, prods: [], cats: [], map: null, filter: "" };
  view.innerHTML = `<p class="muted">Cargando…</p>`;
  const [cfg, cats, prods, opts] = await Promise.all([
    api("config"),
    sb.from("categories").select("id,name,sort").eq("active", true).order("sort"),
    sb.from("products").select("*").eq("active", true).order("sort"),
    sb.from("product_option_groups").select("product_id, option_groups(id,name,required,option_choices(id,name,price_delta,sort,active))"),
  ]);
  st.cfg = cfg; st.cats = cats.data || []; st.prods = prods.data || [];
  // opciones (endulzante, etc.): cada opción se muestra como su propia fila
  st.opts = {};
  for (const r of opts.error ? [] : opts.data || []) {
    const g = r.option_groups; if (!g) continue;
    g.option_choices = (g.option_choices || []).filter((c) => c.active).sort((a, b) => a.sort - b.sort);
    (st.opts[r.product_id] ||= []).push(g);
  }

  view.innerHTML = `
    <details class="panel quick">
      <summary><b>Mensajes rápidos para WhatsApp</b> <span class="muted small">— cópialos y pégalos en el chat</span></summary>
      <div class="quick-list">${QUICK.map(([t, m], i) => `<div class="quick-item"><b>${esc(t)}</b><p>${esc(m).replace(/\n/g, "<br>")}</p><button class="btn small" type="button" data-copy="${i}">Copiar</button></div>`).join("")}</div>
      <p class="muted small" style="margin:10px 0 0">Guárdalos en WhatsApp Business como respuestas rápidas con estos atajos; la lista completa está en la guía de WhatsApp Business.</p>
    </details>

    <form class="manual" id="mForm" novalidate>
      <section class="panel">
        <h2 class="mtitle"><span>1</span> Cliente</h2>
        <div class="form-grid">
          <div><label class="f" for="mName">Nombre</label><input class="in" id="mName" autocomplete="off"></div>
          <div><label class="f" for="mPhone">WhatsApp</label><input class="in" id="mPhone" type="tel" inputmode="tel" placeholder="0991234567" autocomplete="off"></div>
          <div><label class="f" for="mEmail">Correo <span class="hint">(opcional, para avisarle cada paso)</span></label><input class="in" id="mEmail" type="email" inputmode="email" autocomplete="off"></div>
        </div>
      </section>

      <section class="panel">
        <h2 class="mtitle"><span>2</span> Productos</h2>
        <input class="in" id="mSearch" type="search" placeholder="Buscar producto" style="margin:8px 0 10px">
        <div id="mProds" class="mprods"></div>
      </section>

      <section class="panel">
        <h2 class="mtitle"><span>3</span> Entrega</h2>
        <label class="f" for="mPaste">Ubicación que te mandó <span class="hint">(pega el enlace de Google Maps o la ubicación de WhatsApp)</span></label>
        <div class="row-btns"><input class="in" id="mPaste" placeholder="https://maps.app.goo.gl/… o -2.17, -79.90" style="flex:1;min-width:200px"><button class="btn" type="button" id="mFind">Ubicar</button></div>
        <p class="muted small" style="margin:8px 0">O busca la zona y mueve el mapa hasta el punto exacto.</p>
        <div class="search" id="mSearchSlot"></div>
        <div class="map-wrap" style="margin-top:8px"><div id="mMap" class="map"></div><div class="pin" aria-hidden="true"><span></span></div></div>
        <div id="mQuote" class="muted small" style="margin-top:8px">Marca la ubicación para calcular el envío.</div>
        <div class="form-grid">
          <div><label class="f" for="mAddr">Dirección</label><input class="in" id="mAddr" placeholder="Ciudadela, manzana y villa o calle y número"></div>
          <div><label class="f" for="mRef">Referencia <span class="hint">(opcional)</span></label><input class="in" id="mRef"></div>
        </div>
        <div class="chips" style="margin-top:12px" role="radiogroup" aria-label="Cuándo">
          <label class="chip"><input type="radio" name="mWhen" value="now" ${cfg.open_now ? "checked" : "disabled"}> Lo antes posible</label>
          <label class="chip"><input type="radio" name="mWhen" value="later" ${cfg.open_now ? "" : "checked"}> Agendar</label>
        </div>
        <div class="form-grid" id="mSched" ${cfg.open_now ? "hidden" : ""}>
          <div><label class="f" for="mDate">Día</label><select class="in" id="mDate"></select></div>
          <div><label class="f" for="mTime">Hora</label><select class="in" id="mTime"></select></div>
        </div>
        <label class="check"><input type="checkbox" id="mGift"> Es un regalo</label>
        <div id="mGiftBox" hidden class="form-grid">
          <div><label class="f" for="mRName">Quién recibe</label><input class="in" id="mRName"></div>
          <div><label class="f" for="mRPhone">Su teléfono <span class="hint">(opcional)</span></label><input class="in" id="mRPhone" type="tel"></div>
          <div><label class="f" for="mFrom">De parte de <span class="hint">(firma de la tarjeta)</span></label><input class="in" id="mFrom" maxlength="80" placeholder="Si se deja vacío, el nombre del cliente"></div>
          <div style="grid-column:1/-1"><label class="f" for="mMsg">Mensaje para la tarjeta <span class="hint">(opcional)</span></label><textarea class="in" id="mMsg" maxlength="300"></textarea></div>
        </div>
      </section>

      <section class="panel">
        <h2 class="mtitle"><span>4</span> Pago</h2>
        <div class="chips" role="radiogroup" aria-label="Pago">
          <label class="chip"><input type="radio" name="mPay" value="link" checked> Mandarle el enlace de pago</label>
          <label class="chip"><input type="radio" name="mPay" value="paid"> Ya pagó (Deuna, Peigo o transferencia)</label>
        </div>
        <div id="mSum" class="msum"></div>
        <button class="btn primary big" id="mGo" style="margin-top:12px">Registrar pedido</button>
        <p class="err" id="mErr" role="alert"></p>
      </section>
    </form>
    <div id="mDone"></div>`;

  $$("[data-copy]", view).forEach((b) => (b.onclick = () => copy(QUICK[+b.dataset.copy][1])));
  $("#mSearch").oninput = () => { st.filter = $("#mSearch").value.trim().toLowerCase(); drawProds(); };
  $("#mProds").onclick = (e) => {
    const b = e.target.closest("[data-q]"); if (!b) return;
    const k = b.dataset.id, q = (st.cart.get(k) || 0) + Number(b.dataset.q);
    if (q <= 0) st.cart.delete(k); else st.cart.set(k, Math.min(q, 50));
    drawProds(); quote();
  };
  $$('input[name="mWhen"]').forEach((r) => (r.onchange = () => { $("#mSched").hidden = !$('input[name="mWhen"][value="later"]').checked; drawSum(); }));
  $("#mGift").onchange = () => ($("#mGiftBox").hidden = !$("#mGift").checked);
  $$('input[name="mPay"]').forEach((r) => (r.onchange = drawSum));
  $("#mDate").onchange = fillTimes; $("#mTime").onchange = drawSum;
  $("#mFind").onclick = findPasted;
  $("#mPaste").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findPasted(); } });
  $("#mForm").onsubmit = submit;
  fillDates(); drawProds();

  const k = cfg.kitchen?.lat ? { lat: cfg.kitchen.lat, lng: cfg.kitchen.lng } : null;
  st.map = await createMap($("#mMap"), {
    start: null, center: k, searchSlot: $("#mSearchSlot"),
    onPick: (lat, lng, addr) => { st.loc = { lat, lng }; st.locLabel = addr || ""; quote(); },
  });
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast("Copiado. Pégalo en WhatsApp."), () => toast("No se pudo copiar. Selecciónalo a mano."));
}

function drawProds() {
  const f = st.filter;
  const html = st.cats.map((c) => {
    const items = st.prods.filter((p) => p.category_id === c.id && (!f || p.name.toLowerCase().includes(f)));
    if (!items.length) return "";
    const row = (k, label, price) => {
      const q = st.cart.get(k) || 0;
      return `<div class="mprod ${q ? "on" : ""}"><span>${esc(label)} <span class="muted small">${money(price)}</span></span>
        <span class="qty"><button type="button" data-q="-1" data-id="${k}" aria-label="Quitar uno">−</button><b>${q}</b><button type="button" data-q="1" data-id="${k}" aria-label="Agregar uno">+</button></span></div>`;
    };
    return `<h3 class="mcat">${esc(c.name)}</h3>${items.map((p) => {
      const g = (st.opts[p.id] || [])[0];
      if (!g) return row(String(p.id), p.name, p.price);
      return `<div class="mopt"><b>${esc(p.name)}</b> <span class="muted small">· ${esc(g.name.toLowerCase())}</span></div>` +
        g.option_choices.map((ch) => row(`${p.id}:${ch.id}`, `↳ ${ch.name}`, Number(p.price) + Number(ch.price_delta || 0))).join("");
    }).join("")}`;
  }).join("");
  $("#mProds").innerHTML = html || `<p class="muted small">No hay productos con ese nombre.</p>`;
  drawSum();
}

const kId = (k) => Number(String(k).split(":")[0]);
const kOpts = (k) => (String(k).split(":")[1] || "").split(".").filter(Boolean).map(Number);
const choice = (cid) => { for (const gs of Object.values(st.opts)) for (const g of gs) { const c = g.option_choices.find((x) => x.id === cid); if (c) return c; } return null; };
const lName = (k) => { const n = kOpts(k).map((c) => choice(c)?.name).filter(Boolean); return st.prods.find((p) => p.id === kId(k)).name + (n.length ? ` (${n.join(", ")})` : ""); };
const lPrice = (k) => Number(st.prods.find((p) => p.id === kId(k))?.price || 0) + kOpts(k).reduce((s, c) => s + Number(choice(c)?.price_delta || 0), 0);
const subtotal = () => [...st.cart].reduce((s, [k, q]) => s + lPrice(k) * q, 0);
const items = () => [...st.cart].map(([k, quantity]) => ({ product_id: kId(k), quantity, options: kOpts(k) }));

function drawSum() {
  const lines = [...st.cart].map(([k, q]) => `<div class="line"><span>${q} × ${esc(lName(k))}</span><span class="tabnum">${money(lPrice(k) * q)}</span></div>`);
  const fee = st.quote?.delivery_fee;
  $("#mSum").innerHTML = lines.length
    ? `${lines.join("")}<div class="line"><span>Envío</span><span class="tabnum">${fee != null ? money(fee) : "—"}</span></div><div class="line total"><span>Total</span><span class="tabnum">${money(subtotal() + (fee || 0))}</span></div>`
    : `<p class="muted small" style="margin:10px 0 0">Agrega productos.</p>`;
  const paid = $('input[name="mPay"][value="paid"]')?.checked;
  $("#mGo").textContent = lines.length && fee != null ? `${paid ? "Registrar pedido pagado" : "Registrar y crear enlace"} · ${money(subtotal() + fee)}` : "Registrar pedido";
}

let qTimer;
function quote() {
  clearTimeout(qTimer);
  if (!st.loc) return drawSum();
  qTimer = setTimeout(async () => {
    $("#mQuote").textContent = "Calculando envío…";
    try {
      st.quote = await api("cotizar", { lat: st.loc.lat, lng: st.loc.lng, items: st.cart.size ? items() : undefined });
      $("#mQuote").innerHTML = `${st.locLabel ? `<b>${esc(st.locLabel)}</b> · ` : ""}Envío <b>${money(st.quote.delivery_fee)}</b> · ${st.quote.distance_km.toFixed(1)} km${st.quote.eta_if_now ? ` · si sale ahora llega aprox. ${hhmm(st.quote.eta_if_now)}` : ""}`;
    } catch (e) { st.quote = null; $("#mQuote").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    drawSum();
  }, 300);
}

async function findPasted() {
  const v = $("#mPaste").value.trim(); if (!v) return;
  $("#mFind").disabled = true;
  try {
    const { lat, lng } = await api("ubicar", { url: v });
    st.map?.setView(lat, lng, 18);
    st.loc = { lat, lng }; quote();
    toast("Ubicación encontrada. Ajusta el mapa si hace falta.");
  } catch (e) { toast(e.message); }
  $("#mFind").disabled = false;
}

// Días y horas para agendar (según el horario de cada día)
function hoursFor(date) {
  const d = st.cfg.days?.find((x) => x.day === date);
  if (d) return d.closed ? null : d;
  return st.cfg.open_time ? { open: st.cfg.open_time, close: st.cfg.close_time } : null;
}
function timesFor(date) {
  const h = hoursFor(date); if (!h) return [];
  const [oh, om] = h.open.split(":").map(Number), [ch, cm] = h.close.split(":").map(Number);
  const out = [], earliest = Date.now() + 45 * 60000;
  for (let m = oh * 60 + om; m <= ch * 60 + cm; m += st.cfg.slot_minutes) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const at = new Date(localToISO(date, t)).getTime();
    if (at >= earliest && at <= Date.now() + 30 * 86400000 - 5 * 60000) out.push(t);
  }
  return out;
}
function fillDates() {
  const opts = [];
  for (let i = 0; i <= 30; i++) { // se puede agendar hasta un mes antes
    const d = todayLocal(i);
    if (timesFor(d).length) opts.push(`<option value="${d}">${i === 0 ? "Hoy" : i === 1 ? "Mañana" : new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "short", timeZone: "America/Guayaquil" })}</option>`);
  }
  $("#mDate").innerHTML = opts.join("");
  fillTimes();
}
function fillTimes() { $("#mTime").innerHTML = timesFor($("#mDate").value).map((t) => `<option>${t}</option>`).join(""); }

async function submit(e) {
  e.preventDefault();
  const err = $("#mErr"); err.textContent = "";
  const bad = (m, el) => { err.textContent = m; el?.focus(); };
  if (!$("#mName").value.trim()) return bad("Escribe el nombre del cliente.", $("#mName"));
  if ($("#mPhone").value.replace(/\D/g, "").length < 10) return bad("Escribe el WhatsApp de 10 dígitos.", $("#mPhone"));
  if ($("#mEmail").value.trim() && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test($("#mEmail").value.trim())) return bad("Revisa el correo o déjalo vacío.", $("#mEmail"));
  if (!st.cart.size) return bad("Agrega al menos un producto.", $("#mSearch"));
  if (!st.loc) return bad("Marca la ubicación de entrega.", $("#mPaste"));
  if (!st.quote) return bad("Aún no tenemos el costo de envío para esa ubicación.");
  if (!$("#mAddr").value.trim()) return bad("Escribe la dirección.", $("#mAddr"));
  const later = $('input[name="mWhen"][value="later"]').checked;
  if (later && !$("#mTime").value) return bad("Elige día y hora.", $("#mDate"));
  const paid = $('input[name="mPay"][value="paid"]').checked;
  const gift = $("#mGift").checked;
  const addr = $("#mAddr").value.trim().slice(0, 130);
  const body = {
    items: items(), lat: st.loc.lat, lng: st.loc.lng,
    address: st.locLabel ? `${addr} · Ubicación del mapa: ${st.locLabel}`.slice(0, 200) : addr,
    reference: $("#mRef").value,
    scheduled_for: later ? localToISO($("#mDate").value, $("#mTime").value) : null,
    customer_name: $("#mName").value.trim(), customer_phone: $("#mPhone").value,
    customer_email: $("#mEmail").value.trim() || null,
    recipient_name: gift ? $("#mRName").value : null, recipient_phone: gift && $("#mRPhone").value ? $("#mRPhone").value : null,
    gift_message: gift ? $("#mMsg").value : null,
    gift_from: gift ? ($("#mFrom").value.trim() || $("#mName").value.trim()) : null,
    paid,
  };
  const btn = $("#mGo"); btn.disabled = true; btn.textContent = "Registrando…";
  try {
    const res = await api("crear_manual", body);
    done(res, body, paid);
  } catch (ex) { err.textContent = ex.message; btn.disabled = false; drawSum(); }
}

function done(res, body, paid) {
  const link = `${SITE}/pedido?t=${res.tracking_token}`;
  const first = body.customer_name.split(" ")[0];
  const lines = [...st.cart].map(([k, q]) => `${q}× ${lName(k)}`).join("\n");
  const whenTxt = body.scheduled_for ? `Entrega: ${when(body.scheduled_for)}` : st.quote?.eta_if_now ? `Llega aprox. a las ${hhmm(st.quote.eta_if_now)}` : "";
  const msg = `¡Hola ${first}! 🧁 Tu pedido ${res.code} en The Bakery Side:\n${lines}\nEnvío: ${money(res.delivery_fee)}\nTotal: ${money(res.total)}\n${whenTxt}\n\n` +
    (paid ? `¡Pago recibido, gracias! Sigue tu pedido aquí: ${link}` : `Paga aquí con tarjeta, Deuna o Peigo y sigue tu pedido: ${link}`);
  $("#mForm").hidden = true;
  $("#mDone").innerHTML = `
    <div class="panel mdone">
      <p class="eyebrow">Pedido registrado</p>
      <h2 class="display" style="font-size:44px">${esc(res.code)} · ${money(res.total)}</h2>
      <p class="muted">${paid ? "Quedó pagado y ya está en Pedidos de cocina." : "Queda «Esperando pago». Pasa a cocina apenas el cliente pague con el enlace."}</p>
      <pre class="msg">${esc(msg)}</pre>
      <div class="row-btns">
        <a class="btn primary" href="${esc(waLink(body.customer_phone, msg))}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        <button class="btn" type="button" id="mCopy">Copiar mensaje</button>
        <button class="btn ghost" type="button" id="mNew">Nuevo pedido</button>
      </div>
    </div>`;
  $("#mCopy").onclick = () => copy(msg);
  $("#mNew").onclick = () => { $("#mDone").innerHTML = ""; renderManual($("#mDone").parentElement); };
  scrollTo(0, 0);
}
