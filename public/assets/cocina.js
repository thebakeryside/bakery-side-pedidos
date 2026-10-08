import { sb, $, $$, money, esc, hhmm, when, toast, waLink, STATUS } from "./common.js";
import { requireLogin, loginHTML } from "./auth.js";

$("#loginSlot").innerHTML = loginHTML("Panel de cocina");

const S = { tab: "pedidos", orders: [], riders: [], products: [], cats: [], settings: null, sound: false, seen: new Set() };
const ACTIVE = ["por_confirmar", "confirmado", "preparando", "listo", "en_camino"];
const AGENDA_HOURS = 3; // los agendados aparecen en "Pedidos" desde 3 horas antes

// ---------- arranque ----------
requireLogin(async (user) => {
  const { data: prof } = await sb.from("profiles").select("role").eq("user_id", user.id).maybeSingle();
  if (prof?.role !== "admin") {
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

// ---------- motorizados ----------
function renderRiders() {
  $("#view").innerHTML = `
    <div class="panel">
      <h2 class="display" style="font-size:30px">Motorizados</h2>
      <p class="muted small">Cada motorizado entra en <b>${location.origin}/moto</b> con el correo que registres aquí.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Teléfono</th><th>Placa</th><th>Correo</th><th>Estado</th><th></th></tr></thead><tbody>
      ${S.riders.map((r) => `<tr><td>${esc(r.full_name)}</td><td>${esc(r.phone)}</td><td>${esc(r.plate || "")}</td><td>${esc(r.email || "")}</td>
        <td>${r.user_id ? "Ya entró" : "Aún no entra"} · ${r.active ? "Activo" : "Inactivo"}</td>
        <td><button class="btn small ghost" data-rider-toggle="${r.id}">${r.active ? "Desactivar" : "Activar"}</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Aún no hay motorizados.</td></tr>`}
      </tbody></table></div>
      <form id="riderForm" class="form-grid" style="margin-top:12px" novalidate>
        <div><label class="f" for="rfName">Nombre</label><input class="in" id="rfName" required></div>
        <div><label class="f" for="rfPhone">WhatsApp</label><input class="in" id="rfPhone" type="tel" required></div>
        <div><label class="f" for="rfPlate">Placa</label><input class="in" id="rfPlate"></div>
        <div><label class="f" for="rfEmail">Correo</label><input class="in" id="rfEmail" type="email" required></div>
        <div style="align-self:end;padding-top:14px"><button class="btn primary block">Agregar motorizado</button></div>
      </form>
    </div>`;
  $("#riderForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = { full_name: $("#rfName").value.trim(), phone: $("#rfPhone").value.trim(), plate: $("#rfPlate").value.trim() || null, email: $("#rfEmail").value.trim().toLowerCase() };
    if (!row.full_name || !row.phone || !row.email) return toast("Completa nombre, WhatsApp y correo.");
    const { error } = await sb.from("riders").insert(row);
    if (error) return toast("No se pudo agregar: " + error.message);
    toast("Motorizado agregado"); await loadRiders(); renderRiders();
  };
  $$("[data-rider-toggle]").forEach((b) => (b.onclick = async () => {
    const r = S.riders.find((x) => x.id === Number(b.dataset.riderToggle));
    const { error } = await sb.from("riders").update({ active: !r.active }).eq("id", r.id);
    if (error) return toast(error.message); await loadRiders(); renderRiders();
  }));
}

// ---------- menú ----------
function renderMenu() {
  const catOpts = (sel) => S.cats.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  $("#view").innerHTML = `
    <div class="panel">
      <h2 class="display" style="font-size:30px">Menú</h2>
      <p class="muted small">Los cambios se ven en la tienda al instante. «Anticipación» es cuántas horas antes hay que agendar ese producto (0 = se puede pedir para ya).</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Foto</th><th>Producto</th><th>Categoría</th><th>Precio $</th><th>Prep. min</th><th>Anticipación h</th><th>Visible</th><th></th></tr></thead><tbody>
      ${S.products.map((p) => `<tr data-pid="${p.id}">
        <td><label class="btn small ghost" style="cursor:pointer">${p.image_url ? "Cambiar" : "Subir"}<input type="file" accept="image/*" data-photo="${p.id}" hidden></label></td>
        <td><input class="in" data-f="name" value="${esc(p.name)}" style="min-width:160px"><input class="in" data-f="description" value="${esc(p.description)}" placeholder="Descripción" style="margin-top:4px;min-width:160px"></td>
        <td><select class="in" data-f="category_id">${catOpts(p.category_id)}</select></td>
        <td><input class="in" data-f="price" type="number" step="0.01" min="0" value="${p.price}" style="width:90px"></td>
        <td><input class="in" data-f="prep_minutes" type="number" min="0" value="${p.prep_minutes}" style="width:80px"></td>
        <td><input class="in" data-f="lead_hours" type="number" min="0" value="${p.lead_hours}" style="width:80px"></td>
        <td><input type="checkbox" data-f="active" ${p.active ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--tostado)"></td>
        <td><button class="btn small" data-save="${p.id}">Guardar</button></td></tr>`).join("")}
      </tbody></table></div>
      <form id="prodForm" class="form-grid" style="margin-top:12px" novalidate>
        <div><label class="f" for="pfName">Nuevo producto</label><input class="in" id="pfName" placeholder="Nombre"></div>
        <div><label class="f" for="pfCat">Categoría</label><select class="in" id="pfCat">${catOpts()}</select></div>
        <div><label class="f" for="pfPrice">Precio $</label><input class="in" id="pfPrice" type="number" step="0.01" min="0"></div>
        <div style="align-self:end;padding-top:14px"><button class="btn primary block">Agregar producto</button></div>
      </form>
    </div>`;
  $$("[data-save]").forEach((b) => (b.onclick = async () => {
    const tr = b.closest("tr"), v = (f) => tr.querySelector(`[data-f="${f}"]`);
    const patch = { name: v("name").value.trim(), description: v("description").value.trim(), category_id: Number(v("category_id").value), price: Number(v("price").value), prep_minutes: Number(v("prep_minutes").value), lead_hours: Number(v("lead_hours").value), active: v("active").checked };
    const { error } = await sb.from("products").update(patch).eq("id", Number(b.dataset.save));
    if (error) return toast(error.message); toast("Producto guardado"); await loadMenu();
  }));
  $$("[data-photo]").forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    const id = Number(inp.dataset.photo), path = `${id}-${Date.now()}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
    const { error } = await sb.storage.from("productos").upload(path, f, { contentType: f.type });
    if (error) return toast("No se pudo subir la foto: " + error.message);
    const url = sb.storage.from("productos").getPublicUrl(path).data.publicUrl;
    await sb.from("products").update({ image_url: url }).eq("id", id);
    toast("Foto actualizada"); await loadMenu(); renderMenu();
  }));
  $("#prodForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = { name: $("#pfName").value.trim(), category_id: Number($("#pfCat").value), price: Number($("#pfPrice").value), prep_minutes: 10 };
    if (!row.name || !(row.price >= 0)) return toast("Escribe nombre y precio.");
    const { error } = await sb.from("products").insert(row);
    if (error) return toast(error.message); toast("Producto agregado"); await loadMenu(); renderMenu();
  };
}

// ---------- ajustes ----------
function renderSettings() {
  const s = S.settings;
  const f = (id, label, val, type = "text", extra = "") => `<div><label class="f" for="${id}">${label}</label><input class="in" id="${id}" type="${type}" value="${esc(val ?? "")}" ${extra}></div>`;
  $("#view").innerHTML = `
    <form class="panel" id="setForm" novalidate>
      <h2 class="display" style="font-size:30px">Ajustes</h2>
      <label class="check"><input type="checkbox" id="sOpen" ${s.store_open ? "checked" : ""}> Tienda abierta (desmárcalo para pausar pedidos)</label>
      <div class="form-grid">
        ${f("sOpenT", "Abre a las", s.open_time.slice(0, 5), "time")}
        ${f("sCloseT", "Cierra a las", s.close_time.slice(0, 5), "time")}
        ${f("sSlotCap", "Pedidos máximos por franja de 30 min", s.slot_capacity, "number", 'min="1"')}
        ${f("sBase", "Envío base $", s.fee_base, "number", 'step="0.05" min="0"')}
        ${f("sIncl", "Km incluidos en la base", s.fee_included_km, "number", 'step="0.5" min="0"')}
        ${f("sPerKm", "Precio por km adicional $", s.fee_per_km, "number", 'step="0.05" min="0"')}
        ${f("sMaxKm", "Distancia máxima (km)", s.max_km, "number", 'step="1" min="1"')}
        ${f("sWa", "WhatsApp del negocio", s.whatsapp_number, "tel")}
      </div>
      <label class="f" for="sBank">Datos para transferencia <span class="hint">(se muestran al cliente)</span></label>
      <textarea class="in" id="sBank" placeholder="Banco, tipo y número de cuenta, nombre y cédula/RUC">${esc(s.bank_info ?? "")}</textarea>
      <p class="muted small">Ubicación de la cocina: ${esc(s.kitchen_address || "sin configurar")}. Mapa: ${s.map_provider === "google" ? "Google Maps" : "OpenStreetMap (gratis, distancia aproximada)"}.</p>
      <button class="btn primary" style="margin-top:8px">Guardar ajustes</button>
    </form>`;
  $("#setForm").onsubmit = async (e) => {
    e.preventDefault();
    const patch = {
      store_open: $("#sOpen").checked, open_time: $("#sOpenT").value, close_time: $("#sCloseT").value,
      slot_capacity: Number($("#sSlotCap").value), fee_base: Number($("#sBase").value), fee_included_km: Number($("#sIncl").value),
      fee_per_km: Number($("#sPerKm").value), max_km: Number($("#sMaxKm").value),
      whatsapp_number: $("#sWa").value.trim() || null, bank_info: $("#sBank").value.trim() || null, updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("settings").update(patch).eq("id", true);
    if (error) return toast("No se pudo guardar: " + error.message);
    toast("Ajustes guardados"); await loadSettings();
  };
}
