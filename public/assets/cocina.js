import { sb, $, $$, money, esc, hhmm, when, toast, waLink, STATUS, todayLocal } from "./common.js";
import { requireLogin, loginHTML } from "./auth.js";

$("#loginSlot").innerHTML = loginHTML("Panel de cocina");

const S = { tab: "pedidos", orders: [], riders: [], products: [], cats: [], settings: null, sound: false, seen: new Set() };
const ACTIVE = ["por_confirmar", "confirmado", "preparando", "listo", "en_camino"];
const AGENDA_HOURS = 3; // los agendados aparecen en "Pedidos" desde 3 horas antes

// ---------- arranque ----------
requireLogin(async (user) => {
  const { data: prof } = await sb.from("profiles").select("role,is_master").eq("user_id", user.id).maybeSingle();
  $("#toMaster").hidden = !prof?.is_master;
  if (prof?.role !== "admin" && !prof?.is_master) {
    $("#view").innerHTML = `<div class="panel"><h2 class="display" style="font-size:32px">Sin acceso a cocina</h2><p class="muted">Tu correo ${esc(user.email)} no está autorizado como administrador. Si eres motorizado, entra en <a href="/moto">/moto</a>.</p></div>`;
    $(".tabs").hidden = true; return;
  }
  await Promise.all([loadOrders(), loadRiders(), loadMenu(), loadSettings()]);
  render();
  sb.channel("cocina").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (p) => {
    await loadOrders();
    const o = p.new;
    if (o && ["por_confirmar", "confirmado"].includes(o.status) && !S.seen.has(o.id + o.status)) { beep(); toast(`Pedido ${o.code}: ${STATUS[o.status]}`); }
    render();
  }).subscribe();
  setInterval(() => { if (S.tab === "pedidos") render(); }, 60000); // refresca tiempos
});

$$(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.tab; render(); }));

// ---------- datos ----------
async function loadOrders() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data, error } = await sb.from("orders")
    .select("*, order_items(name,quantity,line_total), riders(full_name,phone)")
    .or(`status.in.(${ACTIVE.join(",")}),created_at.gte."${since}",scheduled_for.gte."${new Date().toISOString()}"`)
    .order("created_at", { ascending: false }).limit(300);
  if (error) return toast("No pudimos cargar los pedidos: " + error.message);
  S.orders = data;
  data.forEach((o) => S.seen.add(o.id + o.status));
}
async function loadRiders() { const { data } = await sb.from("riders").select("*").order("full_name"); S.riders = (data || []).filter((r) => !r.archived_at); }
async function loadMenu() {
  const [c, p] = await Promise.all([sb.from("categories").select("*").order("sort"), sb.from("products").select("*").order("sort")]);
  S.cats = c.data || []; S.products = p.data || [];
}
async function loadSettings() { const { data } = await sb.from("settings").select("*").single(); S.settings = data; }

// ---------- sonido ----------
let ctx;
$("#sound").onclick = () => { ctx ||= new AudioContext(); S.sound = true; $("#sound").textContent = "Sonido activo"; beep(); };
function beep() {
  if (!S.sound || !ctx) return;
  [0, 0.25].forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15); });
}

// ---------- vista ----------
function render() {
  $$(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  const soon = Date.now() + AGENDA_HOURS * 3600000;
  const isAgenda = (o) => o.scheduled_for && new Date(o.scheduled_for).getTime() > soon && ["confirmado", "por_confirmar"].includes(o.status);
  const active = S.orders.filter((o) => ACTIVE.includes(o.status) && !isAgenda(o));
  const agenda = S.orders.filter((o) => isAgenda(o) || (o.scheduled_for && o.status === "pendiente_pago" && new Date(o.scheduled_for) > new Date()));
  const ca = $("#cntActive"); ca.hidden = !active.length; ca.textContent = active.length;
  const cg = $("#cntAgenda"); const agPaid = agenda.filter((o) => o.status !== "pendiente_pago").length; cg.hidden = !agPaid; cg.textContent = agPaid;

  const v = $("#view");
  if (S.tab === "pedidos") {
    const today = new Date().toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" });
    const isToday = (d) => d && new Date(d).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" }) === today;
    const done = S.orders.filter((o) => o.status === "entregado" && isToday(o.delivered_at));
    const sales = S.orders.filter((o) => o.payment_status === "pagado" && isToday(o.paid_at)).reduce((s, o) => s + Number(o.subtotal), 0);
    const unpaid = S.orders.filter((o) => o.status === "pendiente_pago" && !o.scheduled_for && Date.now() - new Date(o.created_at) < 2 * 3600000);
    const by = (st) => active.filter((o) => st.includes(o.status)).sort((a, b) => new Date(a.eta) - new Date(b.eta));
    v.innerHTML = `
      <div class="stats"><div><b>${active.length}</b>en curso</div><div><b>${done.length}</b>entregados hoy</div><div><b>${money(sales)}</b>vendido hoy en productos</div></div>
      ${group("Por confirmar pago", by(["por_confirmar"]))}
      ${group("Confirmados · por preparar", by(["confirmado"]))}
      ${group("En preparación", by(["preparando"]))}
      ${group("Listos y en camino", by(["listo", "en_camino"]))}
      ${!active.length ? `<div class="panel"><p class="muted">No hay pedidos en curso. Cuando entre uno, aparecerá aquí ${S.sound ? "y sonará" : "(toca «Activar sonido» para escuchar la alerta)"}.</p></div>` : ""}
      ${unpaid.length ? `<details style="margin-top:18px"><summary class="muted">Pedidos sin pagar en las últimas 2 horas (${unpaid.length})</summary><div class="cards" style="margin-top:10px">${unpaid.map(card).join("")}</div></details>` : ""}`;
  } else if (S.tab === "agenda") {
    const list = agenda.sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
    const days = {};
    list.forEach((o) => { const k = new Date(o.scheduled_for).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Guayaquil" }); (days[k] ||= []).push(o); });
    v.innerHTML = Object.keys(days).length
      ? Object.entries(days).map(([d, os]) => group(d, os)).join("")
      : `<div class="panel"><p class="muted">No hay entregas agendadas para más adelante. Los pedidos agendados pasan a «Pedidos» ${AGENDA_HOURS} horas antes de su hora.</p></div>`;
  } else if (S.tab === "historial") {
    const list = S.orders.filter((o) => ["entregado", "cancelado"].includes(o.status));
    v.innerHTML = list.length ? `<div class="cards">${list.map(card).join("")}</div>` : `<div class="panel"><p class="muted">Aquí verás los pedidos entregados y cancelados de los últimos 3 días.</p></div>`;
  } else if (S.tab === "motorizados") renderRiders();
  else if (S.tab === "menu") renderMenu();
  else if (S.tab === "ajustes") renderSettings();
}
const group = (title, list) => list.length ? `<h2 class="group-title">${esc(title)}</h2><div class="cards">${list.map(card).join("")}</div>` : "";

function waText(o) {
  const link = `${location.origin}/pedido?t=${o.tracking_token}`;
  const first = o.customer_name.split(" ")[0];
  const r = o.riders?.full_name?.split(" ")[0];
  const msgs = {
    pendiente_pago: `Hola ${first}, vimos tu pedido ${o.code} en The Bakery Side pero aún no se completó el pago. Puedes pagarlo aquí: ${link}`,
    por_confirmar: `Hola ${first}, recibimos tu comprobante del pedido ${o.code}. Lo estamos verificando. Seguimiento: ${link}`,
    confirmado: `Hola ${first}, ¡confirmamos tu pedido ${o.code}! ${o.scheduled_for ? `Lo entregamos ${when(o.scheduled_for)}.` : `Llega aprox. a las ${hhmm(o.eta)}.`} Seguimiento: ${link}`,
    preparando: `Hola ${first}, tu pedido ${o.code} ya se está preparando. Seguimiento: ${link}`,
    listo: `Hola ${first}, tu pedido ${o.code} está listo y sale en minutos. Seguimiento: ${link}`,
    en_camino: `Hola ${first}, tu pedido ${o.code} va en camino${r ? ` con ${r}` : ""}. Seguimiento: ${link}`,
    entregado: `Hola ${first}, gracias por tu pedido ${o.code}. ¡Que lo disfrutes!`,
    cancelado: `Hola ${first}, tu pedido ${o.code} fue cancelado. Escríbenos si tienes dudas.`,
  };
  return msgs[o.status];
}

function card(o) {
  const t = o.scheduled_for ? when(o.scheduled_for) : `Llega ${hhmm(o.eta)}`;
  const payTxt = o.payment_method === "tarjeta"
    ? `Tarjeta · ${o.payment_status === "pagado" ? "pagado" : o.payment_status}`
    : `Transferencia · ${o.payment_status === "pagado" ? "confirmada" : o.payment_status === "en_revision" ? "por verificar" : o.payment_status}`;
  const riderOpts = `<option value="">Asignar motorizado…</option>` + S.riders.filter((r) => r.active).map((r) => `<option value="${r.id}" ${o.rider_id === r.id ? "selected" : ""}>${esc(r.full_name)}</option>`).join("");
  let acts = "";
  if (o.status === "por_confirmar") acts += `<button class="btn small" data-act="receipt" data-id="${o.id}">Ver comprobante</button><button class="btn small primary" data-act="confirmPay" data-id="${o.id}">Confirmar pago</button>`;
  if (o.status === "confirmado") acts += `<button class="btn small primary" data-act="prep" data-id="${o.id}">Empezar a preparar</button>`;
  if (o.status === "preparando") acts += `<button class="btn small primary" data-act="ready" data-id="${o.id}">Marcar listo</button>`;
  if (["confirmado", "preparando", "listo"].includes(o.status)) acts += `<select class="in" data-act="assign" data-id="${o.id}" aria-label="Motorizado">${riderOpts}</select>`;
  if (o.status === "listo") acts += `<button class="btn small" data-act="pick" data-id="${o.id}">Salió con el motorizado</button>`;
  if (o.status === "en_camino") acts += `<button class="btn small" data-act="deliver" data-id="${o.id}">Marcar entregado</button>`;
  const canCancel = !["entregado", "cancelado"].includes(o.status);
  return `<article class="ocard" data-s="${o.status}">
    <div class="ohead"><span class="oid">${esc(o.code)}</span><span class="st st-${o.status}">${STATUS[o.status]}</span></div>
    <div class="owhen tabnum">${esc(t)}</div>
    <div class="meta">
      <span><b>${esc(o.customer_name)}</b> · ${esc(o.customer_phone)}</span>
      ${o.recipient_name ? `<span>Recibe: <b>${esc(o.recipient_name)}</b>${o.recipient_phone ? " · " + esc(o.recipient_phone) : ""}</span>` : ""}
      <span>${esc(o.address)}${o.reference ? " · " + esc(o.reference) : ""}</span>
      <span>${Number(o.distance_km).toFixed(1)} km · envío ${money(o.delivery_fee)} · total <b>${money(o.total)}</b></span>
      <span>${esc(payTxt)}</span>
      ${Number(o.discount) > 0 ? `<span>Regalo de cumpleaños: −${money(o.discount)}</span>` : ""}
      ${o.user_id ? `<span>Cliente con cuenta (suma sellos)</span>` : ""}
      ${o.invoice_type === "con_datos" ? `<span>Factura: ${esc(o.invoice_name)} · ${esc(o.invoice_id_number)} · ${esc(o.invoice_email)}</span>` : ""}
      ${o.riders ? `<span>Motorizado: <b>${esc(o.riders.full_name)}</b>${o.rider_accepted_at ? " (aceptó)" : ""}</span>` : ""}
      ${o.cancel_reason ? `<span>Motivo: ${esc(o.cancel_reason)}</span>` : ""}
    </div>
    <ul class="items">${o.order_items.map((i) => `<li>${i.quantity} × ${esc(i.name)}</li>`).join("")}</ul>
    ${o.gift_message ? `<div class="gift"><b>Tarjeta de regalo:</b> “${esc(o.gift_message)}”</div>` : ""}
    ${acts ? `<div class="acts">${acts}</div>` : ""}
    <div class="acts">
      <a class="btn small ghost" href="${waLink(o.customer_phone, waText(o))}" target="_blank" rel="noopener">Avisar por WhatsApp</a>
      <a class="btn small ghost" href="https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}" target="_blank" rel="noopener">Mapa</a>
      ${canCancel ? `<button class="btn small ghost" data-act="cancelAsk" data-id="${o.id}">Cancelar</button>` : ""}
    </div>
    <div class="confirm-row" data-cancel="${o.id}" hidden>
      <input class="in" placeholder="Motivo de la cancelación" data-reason="${o.id}" style="flex:1;min-width:160px">
      <button class="btn small" data-act="cancel" data-id="${o.id}">Confirmar cancelación</button>
    </div>
  </article>`;
}

// ---------- acciones de pedidos ----------
async function upd(id, patch, msg) {
  const { error } = await sb.from("orders").update(patch).eq("id", id);
  if (error) return toast("No se pudo guardar: " + error.message);
  toast(msg); await loadOrders(); render();
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const id = b.dataset.id, o = S.orders.find((x) => x.id === id), now = new Date().toISOString();
  switch (b.dataset.act) {
    case "receipt": {
      const { data, error } = await sb.storage.from("comprobantes").createSignedUrl(o.transfer_receipt_path, 600);
      if (error) return toast("No pudimos abrir el comprobante.");
      window.open(data.signedUrl, "_blank", "noopener"); break;
    }
    case "confirmPay": return upd(id, { payment_status: "pagado", status: "confirmado", paid_at: now }, `${o.code}: pago confirmado`);
    case "prep": return upd(id, { status: "preparando", prep_started_at: now, eta: o.scheduled_for || new Date(Date.now() + (o.prep_minutes + 15) * 60000).toISOString() }, `${o.code} en preparación`);
    case "ready": return upd(id, { status: "listo", ready_at: now }, `${o.code} listo`);
    case "pick": return upd(id, { status: "en_camino", picked_at: now }, `${o.code} en camino`);
    case "deliver": return upd(id, { status: "entregado", delivered_at: now }, `${o.code} entregado`);
    case "cancelAsk": $(`[data-cancel="${id}"]`).hidden = false; $(`[data-reason="${id}"]`).focus(); break;
    case "cancel": {
      const reason = $(`[data-reason="${id}"]`).value.trim();
      if (!reason) return toast("Escribe el motivo para cancelar.");
      const refund = o.payment_status === "pagado" && o.payment_method === "tarjeta" ? " Recuerda hacer el reverso en Payphone." : o.payment_status === "pagado" ? " Recuerda devolver la transferencia." : "";
      return upd(id, { status: "cancelado", cancelled_at: now, cancel_reason: reason }, `${o.code} cancelado.${refund}`);
    }
  }
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("select[data-act=assign]"); if (!s) return;
  const o = S.orders.find((x) => x.id === s.dataset.id);
  upd(o.id, { rider_id: s.value ? Number(s.value) : null, rider_accepted_at: null }, s.value ? `${o.code} asignado` : `${o.code} sin motorizado`);
});

// ---------- motorizados (solo consulta) ----------
function renderRiders() {
  const active = S.riders.filter((r) => r.active);
  $("#view").innerHTML = `
    <div class="panel">
      <h2 class="display" style="font-size:30px">Motorizados</h2>
      <p class="muted small">${active.length} ${active.length === 1 ? "motorizado activo" : "motorizados activos"}. Para agregar o quitar motorizados, habla con el master.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>WhatsApp</th><th>Placa</th><th>Estado</th></tr></thead><tbody>
      ${S.riders.map((r) => `<tr><td>${esc(r.full_name)}</td><td><a href="${waLink(r.phone, "")}" target="_blank" rel="noopener">${esc(r.phone)}</a></td><td>${esc(r.plate || "")}</td>
        <td>${r.active ? `<span class="st st-entregado">Activo</span>` : `<span class="st">Inactivo</span>`}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Aún no hay motorizados.</td></tr>`}
      </tbody></table></div>
    </div>`;
}

// ---------- stock del día ----------
function renderMenu() {
  const today = todayLocal();
  const isOut = (p) => p.sold_out_day === today || (p.stock_day === today && p.stock_left === 0);
  const left = (p) => (p.stock_day === today && p.stock_left !== null ? p.stock_left : "");
  const groups = S.cats.map((c) => ({ c, items: S.products.filter((p) => p.category_id === c.id && p.active) })).filter((g) => g.items.length);
  $("#view").innerHTML = `
    <div class="panel">
      <h2 class="display" style="font-size:30px">Stock de hoy</h2>
      <p class="muted small">Marca lo que se agotó o cuántas porciones quedan hoy. Mañana todo vuelve a estar disponible solo. Las porciones se descuentan con cada pedido. Para cambiar precios o productos, habla con el master.</p>
      ${groups.map((g) => `<h3 class="group-title">${esc(g.c.name)}</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Porciones hoy</th><th>Estado</th></tr></thead><tbody>
      ${g.items.map((p) => `<tr data-pid="${p.id}">
        <td><b>${esc(p.name)}</b></td>
        <td><div style="display:flex;gap:6px;align-items:center"><input class="in" type="number" min="0" inputmode="numeric" data-stock="${p.id}" value="${left(p)}" placeholder="Sin límite" style="width:110px" aria-label="Porciones que quedan hoy de ${esc(p.name)}">
          <button class="btn small" data-savestock="${p.id}">Guardar</button></div></td>
        <td><button class="btn small ${isOut(p) ? "primary" : "ghost"}" data-out="${p.id}" aria-pressed="${isOut(p)}">${isOut(p) ? "Agotado hoy · reactivar" : "Marcar agotado"}</button></td></tr>`).join("")}
      </tbody></table></div>`).join("") || `<p class="muted">No hay productos visibles en el menú.</p>`}
    </div>`;
  $$("[data-savestock]").forEach((b) => (b.onclick = async () => {
    const id = Number(b.dataset.savestock), v = $(`[data-stock="${id}"]`).value.trim();
    const patch = v === "" ? { stock_left: null, stock_day: null } : { stock_left: Math.max(0, Math.floor(Number(v))), stock_day: today };
    if (v !== "" && !Number.isFinite(Number(v))) return toast("Escribe un número de porciones.");
    const { error } = await sb.from("products").update(patch).eq("id", id);
    if (error) return toast(error.message);
    toast(v === "" ? "Sin límite de porciones hoy" : `Quedan ${patch.stock_left} hoy`); await loadMenu(); renderMenu();
  }));
  $$("[data-out]").forEach((b) => (b.onclick = async () => {
    const p = S.products.find((x) => x.id === Number(b.dataset.out));
    const out = isOut(p);
    const patch = out ? { sold_out_day: null, ...(p.stock_day === today && p.stock_left === 0 ? { stock_left: null, stock_day: null } : {}) } : { sold_out_day: today };
    const { error } = await sb.from("products").update(patch).eq("id", p.id);
    if (error) return toast(error.message);
    toast(out ? `${p.name} disponible de nuevo` : `${p.name} marcado agotado por hoy`); await loadMenu(); renderMenu();
  }));
}

// ---------- tienda: abrir/cerrar y "más tiempo de entrega" ----------
// El horario por día y los feriados los define el master; aquí solo se opera el día.
let busyTimer = null;
const hm = (t) => (t ? String(t).slice(0, 5) : "");
async function todayHoursText() {
  const s = S.settings, day = todayLocal();
  const { data: ex } = await sb.from("store_exceptions").select("*").eq("day", day).maybeSingle().then((r) => r, () => ({ data: null }));
  if (ex) return ex.closed ? `Hoy cerrado${ex.note ? ` (${ex.note})` : ""}` : `Hoy de ${hm(ex.open_time)} a ${hm(ex.close_time)}${ex.note ? ` (${ex.note})` : ""}`;
  const w = s.weekly_hours?.[String(new Date(day + "T12:00:00Z").getUTCDay())];
  if (s.weekly_hours) return w ? `Hoy de ${w.open} a ${w.close}` : "Hoy es día de descanso";
  return `Hoy de ${hm(s.open_time)} a ${hm(s.close_time)}`;
}
async function renderSettings() {
  clearInterval(busyTimer);
  const s = S.settings;
  const busyLeft = () => (s.busy_until ? new Date(s.busy_until).getTime() - Date.now() : 0);
  const busy = busyLeft() > 0;
  const extra = s.busy_extra_minutes ?? 30;
  $("#view").innerHTML = `
    <div class="panel store-state ${s.store_open ? "is-open" : "is-closed"}">
      <div class="ss-row">
        <span class="ss-dot" aria-hidden="true"></span>
        <div style="flex:1;min-width:200px">
          <b class="ss-title">${s.store_open ? "Recibiendo pedidos" : "Tienda cerrada"}</b>
          <span class="muted small" id="todayHours">…</span>
        </div>
        <button class="btn ${s.store_open ? "ghost danger" : "primary"}" type="button" id="toggleOpen">${s.store_open ? "Cerrar la tienda" : "Abrir la tienda"}</button>
      </div>
      <div id="openAsk"></div>
      <p class="muted small" style="margin:10px 0 0">Los horarios de cada día y los feriados los configura el master.</p>
    </div>

    <div class="panel busy ${busy ? "on" : ""}" style="margin-top:14px">
      <h2 class="display" style="font-size:28px">Más tiempo de entrega</h2>
      ${busy ? `
        <p class="busy-now"><b>Entregas +${extra} min</b> · termina en <span class="tabnum" id="busyLeft"></span></p>
        <p class="muted small" style="margin:0 0 12px">Se siguen recibiendo pedidos; a los nuevos les mostramos una hora de llegada ${extra} minutos más tarde.</p>
        <div class="row-btns"><button class="btn primary" type="button" id="busyStop">Reanudar ritmo normal</button><button class="btn" type="button" id="busyMore">30 min más</button></div>`
      : `
        <p class="muted small" style="margin:6px 0 12px">¿Mucho trabajo? Durante 30 minutos, los pedidos nuevos se siguen recibiendo, pero con una hora de llegada más tarde.</p>
        <div class="chips" role="radiogroup" aria-label="Minutos extra">${[15, 30, 45].map((m) => `<label class="chip"><input type="radio" name="extra" value="${m}" ${m === extra ? "checked" : ""}> +${m} min</label>`).join("")}</div>
        <button class="btn primary" type="button" id="busyGo" style="margin-top:12px">Activar por 30 minutos</button>`}
    </div>`;

  todayHoursText().then((t) => { const el = $("#todayHours"); if (el) el.textContent = t; });

  $("#toggleOpen").onclick = () => {
    const box = $("#openAsk");
    if (box.innerHTML) { box.innerHTML = ""; return; }
    const closing = s.store_open;
    box.innerHTML = `<div class="confirm-row" style="margin-top:12px"><span class="small" style="flex:1;min-width:200px">${closing
      ? "¿Cerrar la tienda? Nadie podrá hacer pedidos, ni siquiera agendados, hasta que la vuelvas a abrir. Los pedidos en curso no cambian."
      : "¿Abrir la tienda? Los clientes podrán volver a hacer pedidos dentro del horario."}</span>
      <button class="btn small primary" type="button" id="openYes">${closing ? "Sí, cerrar" : "Sí, abrir"}</button><button class="btn small ghost" type="button" id="openNo">Cancelar</button></div>`;
    $("#openNo").onclick = () => (box.innerHTML = "");
    $("#openYes").onclick = async () => {
      $("#openYes").disabled = true;
      await saveSettings({ store_open: !closing }, closing ? "Tienda cerrada" : "Tienda abierta");
    };
  };

  if (busy) {
    const tick = () => {
      const ms = busyLeft();
      if (ms <= 0) { clearInterval(busyTimer); return renderSettings(); }
      const el = $("#busyLeft"); if (!el) return clearInterval(busyTimer);
      el.textContent = `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
    };
    tick(); busyTimer = setInterval(tick, 1000);
    $("#busyStop").onclick = () => saveSettings({ busy_until: null }, "Ritmo normal de nuevo");
    $("#busyMore").onclick = () => saveSettings({ busy_until: new Date(Math.max(Date.now(), new Date(s.busy_until).getTime()) + 30 * 60000).toISOString() }, "30 minutos más");
  } else {
    $("#busyGo").onclick = () => {
      const m = Number(document.querySelector('input[name="extra"]:checked')?.value || 30);
      saveSettings({ busy_until: new Date(Date.now() + 30 * 60000).toISOString(), busy_extra_minutes: m }, `Entregas +${m} min durante 30 minutos`);
    };
  }
}
async function saveSettings(patch, msg) {
  const { error } = await sb.from("settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) return toast(/busy_/.test(error.message) ? "Falta actualizar la base de datos (008). Avísale al master." : "No se pudo guardar: " + error.message);
  toast(msg); await loadSettings(); renderSettings();
}
