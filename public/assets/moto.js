import { sb, $, $$, money, esc, hhmm, when, toast, waLink, STATUS } from "./common.js";
import { requireLogin, loginHTML } from "./auth.js";

$("#loginSlot").innerHTML = loginHTML("Mis entregas");
let rider = null, orders = [];

requireLogin(async (user) => {
  const { data } = await sb.from("riders").select("*").eq("user_id", user.id).maybeSingle();
  rider = data;
  if (!rider || !rider.active || rider.archived_at) {
    $("#view").innerHTML = `<div class="panel"><h2 class="display" style="font-size:32px">Sin entregas asignadas</h2><p class="muted">Tu correo ${esc(user.email)} no está registrado como motorizado activo. Pide a la cocina que te agregue con este correo.</p></div>`;
    return;
  }
  await load();
  sb.channel("moto").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, async (p) => {
    const was = orders.some((o) => o.id === p.new?.id);
    await load();
    if (p.new?.rider_id === rider.id && !was) toast(`Nueva entrega: ${p.new.code}`);
  }).subscribe();
  setInterval(render, 60000);
});

async function load() {
  const since = new Date(Date.now() - 12 * 3600000).toISOString();
  const { data, error } = await sb.from("orders").select("*, order_items(name,quantity)")
    .eq("rider_id", rider.id)
    .or(`status.in.(confirmado,preparando,listo,en_camino),delivered_at.gte."${since}"`)
    .order("eta");
  if (error) return toast("No pudimos cargar tus entregas.");
  orders = data; render();
}

function render() {
  // conserva el PIN que el motorizado está escribiendo si llega una actualización
  const typed = Object.fromEntries([...document.querySelectorAll(".pin-in")].map((i) => [i.dataset.pin, i.value]));
  const focused = document.activeElement?.dataset?.pin;
  draw();
  for (const [id, v] of Object.entries(typed)) { const i = document.querySelector(`[data-pin="${id}"]`); if (i) i.value = v; }
  if (focused) document.querySelector(`[data-pin="${focused}"]`)?.focus();
}
function draw() {
  const active = orders.filter((o) => o.status !== "entregado" && o.status !== "cancelado");
  const done = orders.filter((o) => o.status === "entregado");
  const earned = done.reduce((s, o) => s + Number(o.delivery_fee), 0);
  $("#view").innerHTML = `
    <div class="stats"><div><b>${active.length}</b>por entregar</div><div><b>${done.length}</b>entregadas hoy</div><div><b>${money(earned)}</b>ganado en envíos</div></div>
    ${active.length ? `<div class="cards">${active.map(card).join("")}</div>` : `<div class="panel"><p class="muted">No tienes entregas pendientes. Cuando cocina te asigne una, aparecerá aquí.</p></div>`}
    ${done.length ? `<h2 class="group-title">Entregadas</h2><div class="cards">${done.map(card).join("")}</div>` : ""}`;
}

function card(o) {
  const t = o.status === "entregado" ? `Entregado ${hhmm(o.delivered_at)}` : (o.scheduled_for ? when(o.scheduled_for) : hhmm(o.eta));
  const to = o.recipient_name || o.customer_name, phone = o.recipient_phone || o.customer_phone;
  let act = "";
  if (!o.rider_accepted_at && o.status !== "entregado") act = `<button class="btn primary" data-a="aceptar" data-id="${o.id}">Aceptar entrega</button><button class="btn ghost" data-a="rechazar" data-id="${o.id}">No puedo</button>`;
  else if (["confirmado", "preparando"].includes(o.status)) act = `<span class="muted small">Cocina lo está preparando. Te avisamos cuando esté listo.</span>`;
  else if (o.status === "listo") act = `<button class="btn primary block" data-a="recoger" data-id="${o.id}">Recogí el pedido · salir</button>`;
  else if (o.status === "en_camino") act = `<div class="pin-ask">
      <label class="f" for="pin-${o.id}">PIN del cliente</label>
      <p class="muted small" style="margin:0 0 8px">Pídele a ${esc(to.split(" ")[0])} los 4 números de su PIN. ${o.recipient_name ? "Es un regalo: si no lo tiene, que se lo pida a quien hizo el pedido." : "Está en su correo y en su seguimiento del pedido."}</p>
      <div class="pin-row"><input class="in pin-in" id="pin-${o.id}" data-pin="${o.id}" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="one-time-code" placeholder="••••" aria-label="PIN de 4 dígitos">
      <button class="btn primary" data-a="entregar" data-id="${o.id}">Confirmar entrega</button></div>
      <p class="err small" data-pinerr="${o.id}" role="alert"></p></div>`;
  return `<article class="ocard" data-s="${o.status}">
    <div class="ohead"><span class="oid">${esc(o.code)}</span><span class="st st-${o.status}">${STATUS[o.status]}</span></div>
    <div class="dest">
      <span class="lbl">Entregar a ${esc(to)}</span>
      <span class="addr">${esc(o.address)}</span>
      <span>${esc(o.reference || "Sin referencia")}</span>
      <span class="lbl" style="margin-top:6px">${o.status === "entregado" ? "" : o.scheduled_for ? "Entrega agendada" : "Debe llegar a las"}</span>
      <span class="time tabnum">${esc(t)}</span>
      <span class="small">${Number(o.distance_km).toFixed(1)} km · ganas ${money(o.delivery_fee)} · ya está pagado, no cobres nada</span>
    </div>
    <div class="navs">
      <a class="btn small" href="https://www.google.com/maps/dir/?api=1&destination=${o.lat},${o.lng}" target="_blank" rel="noopener">Google Maps</a>
      <a class="btn small" href="https://waze.com/ul?ll=${o.lat},${o.lng}&navigate=yes" target="_blank" rel="noopener">Waze</a>
      <a class="btn small" href="${waLink(phone, `Hola ${to.split(" ")[0]}, soy ${rider.full_name.split(" ")[0]} de The Bakery Side. Voy con tu pedido ${o.code}.`)}" target="_blank" rel="noopener">WhatsApp</a>
      <a class="btn small" href="tel:${esc(phone)}">Llamar</a>
    </div>
    <ul class="items">${o.order_items.map((i) => `<li>${i.quantity} × ${esc(i.name)}</li>`).join("")}</ul>
    ${o.gift_message ? `<div class="gift"><b>Es un regalo.</b> Tarjeta: “${esc(o.gift_message)}”</div>` : ""}
    ${act ? `<div class="acts">${act}</div>` : ""}
  </article>`;
}

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const pinIn = b.dataset.a === "entregar" ? $(`[data-pin="${b.dataset.id}"]`) : null;
  const pin = pinIn ? pinIn.value.replace(/\D/g, "") : null;
  if (pinIn && pin.length !== 4) { $(`[data-pinerr="${b.dataset.id}"]`).textContent = "Escribe los 4 números del PIN."; pinIn.focus(); return; }
  b.disabled = true;
  const call = () => sb.rpc("rider_action", { p_order: b.dataset.id, p_action: b.dataset.a, ...(pinIn ? { p_pin: pin } : {}) });
  let { data, error } = await call();
  // Si la sesión venció (por ejemplo, con cocina abierta en otra pestaña), la renovamos y reintentamos una vez
  if (error && /permission denied|motorizado activo|JWT/i.test(error.message)) {
    const { error: re } = await sb.auth.refreshSession();
    if (!re) ({ data, error } = await call());
  }
  if (error) {
    b.disabled = false;
    if (/motorizado activo|permission denied|JWT/i.test(error.message)) return toast("Tu sesión venció. Toca «Salir» y vuelve a entrar.");
    if (/no asignado/i.test(error.message)) { await load(); return toast("Este pedido ya no está asignado a ti."); }
    if (/estado actual/i.test(error.message)) { await load(); return toast("El pedido cambió de estado. Revisa la tarjeta."); }
    return toast("No se pudo guardar. Revisa tu conexión e intenta de nuevo.");
  }
  // PIN equivocado o bloqueado: el servidor responde con el mensaje (el intento sí cuenta)
  if (typeof data === "string" && data !== "ok") {
    b.disabled = false;
    $(`[data-pinerr="${b.dataset.id}"]`).textContent = data;
    if (pinIn) { pinIn.value = ""; pinIn.focus(); }
    return;
  }
  toast({ aceptar: "Entrega aceptada", rechazar: "Avisamos a cocina", recoger: "¡Buen viaje!", entregar: "Entrega registrada" }[b.dataset.a]);
  await load();
});
