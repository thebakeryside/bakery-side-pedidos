import { sb, api, $, $$, money, esc, hhmm, when, dayLabel, orderRange, toast, waLink, waAttrs, waMode, setWaMode, waAuto, setWaAuto, openWa, fold, STATUS, todayLocal , tableSearch } from "./common.js";
import { requireLogin, loginHTML } from "./auth.js";
import { renderManual } from "./manual.js";

$("#loginSlot").innerHTML = loginHTML("Panel de cocina");

const S = { tab: "pedidos", orders: [], riders: [], products: [], cats: [], settings: null, sound: false, seen: new Set(), pins: new Map(), uberAlerted: new Map() };
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
    const o = p.new;
    const fresh = o && ["por_confirmar", "confirmado"].includes(o.status) && !S.seen.has(o.id + o.status); // antes de recargar la lista
    await loadOrders();
    if (fresh) { startRing(o); flashTitle(`🔔 Pedido ${o.code}`); toast(`Pedido ${o.code}: ${STATUS[o.status]}`); }
    render();
  }).subscribe();
  uberAlerts();
  setInterval(() => { uberAlerts(); if (S.tab === "pedidos") render(); }, 30000); // refresca tiempos y avisa cuándo pedir el Uber
});

$$(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.tab; S.editing = null; render(); }));

// ---------- datos ----------
async function loadOrders() {
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  // added_at marca lo agregado después (Editar pedido); si la columna aún no existe, se carga sin ella
  const q = (items) => sb.from("orders")
    .select(`*, order_items(${items}), riders(full_name,phone)`)
    .or(`status.in.(${ACTIVE.join(",")}),created_at.gte."${since}",scheduled_for.gte."${new Date().toISOString()}"`)
    .order("created_at", { ascending: false }).limit(300);
  let { data, error } = await q("id,name,quantity,line_total,options,added_at");
  if (error && /added_at/.test(error.message)) ({ data, error } = await q("id,name,quantity,line_total,options"));
  if (error) return toast("No pudimos cargar los pedidos: " + error.message);
  S.orders = data;
  data.forEach((o) => S.seen.add(o.id + o.status));
  // PIN de entrega de los pedidos en curso (solo cocina y master pueden leerlos)
  const live = data.filter((o) => ACTIVE.includes(o.status)).map((o) => o.id);
  if (live.length) {
    const { data: pins } = await sb.from("order_pins").select("order_id,pin,attempts").in("order_id", live);
    S.pins = new Map((pins || []).map((p) => [p.order_id, p]));
  }
}
async function loadRiders() { const { data } = await sb.from("riders").select("*").order("full_name"); S.riders = (data || []).filter((r) => !r.archived_at); }
async function loadMenu() {
  const [c, p] = await Promise.all([sb.from("categories").select("*").order("sort"), sb.from("products").select("*").order("sort")]);
  S.cats = c.data || []; S.products = p.data || [];
}
async function loadSettings() { const { data } = await sb.from("settings").select("*").single(); S.settings = data; }

// ---------- sonido ----------
// Siempre activo salvo que alguien lo apague (se recuerda en este equipo).
// El navegador solo deja sonar después del primer toque/clic en la página:
// el audio se desbloquea solo con cualquier interacción, sin botón especial.
let ctx;
const sndKey = "tbs-cocina-sonido";
try { S.sound = localStorage.getItem(sndKey) !== "off"; } catch { S.sound = true; }
function audioReady() { return ctx && ctx.state === "running"; }
function unlockAudio() {
  if (!S.sound) return;
  try { ctx ||= new AudioContext(); if (ctx.state === "suspended") ctx.resume().then(() => { soundLabel(); uberAlerts(); }, () => {}); } catch {}
  soundLabel();
}
function soundLabel() {
  const b = $("#sound"); if (!b) return;
  const blocked = S.sound && !audioReady();
  b.textContent = !S.sound ? "🔇 Sonido apagado" : blocked ? "🔔 Toca para activar sonido" : "🔔 Sonido activo";
  b.classList.toggle("primary", blocked);
  b.classList.toggle("ghost", !blocked);
}
["pointerdown", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, unlockAudio, { passive: true }));
unlockAudio(); // si el navegador ya lo permite (app instalada), queda listo sin tocar nada
setTimeout(soundLabel, 300);
$("#sound").onclick = () => {
  if (S.sound && audioReady()) { S.sound = false; }
  else { S.sound = true; unlockAudio(); setTimeout(beep, 50); }
  try { localStorage.setItem(sndKey, S.sound ? "on" : "off"); } catch {}
  soundLabel(); render();
};
let titleTimer;
function flashTitle(msg) {
  if (!document.hidden) return;
  const base = document.title; let on = false;
  clearInterval(titleTimer);
  titleTimer = setInterval(() => { document.title = (on = !on) ? msg : base; }, 1000);
  document.addEventListener("visibilitychange", () => { clearInterval(titleTimer); document.title = base; }, { once: true });
}
// Aviso de Uber: distinto al de pedido nuevo (bocina grave de dos tonos, tres veces)
function beepUber() {
  if (!S.sound) return false;
  if (!audioReady()) { unlockAudio(); if (!audioReady()) return false; }
  [[0, 523], [0.22, 392], [0.6, 523], [0.82, 392], [1.2, 523], [1.42, 392]].forEach(([t, f]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = f; g.gain.value = 0.07;
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
  });
  return true;
}
// Timbre de pedido nuevo: suena 5 segundos por pedido (si llegan varios, en fila) y se calla solo.
const RING_SECONDS = 5;
function chime() {
  if (!S.sound) return false;
  if (!audioReady()) { unlockAudio(); if (!audioReady()) return false; }
  [[0, 784], [0.18, 988], [0.36, 1175], [0.7, 784], [0.88, 988], [1.06, 1175]].forEach(([t, f]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.17);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
  });
  return true;
}
const ring = { until: 0 };
function startRing() {
  const now = Date.now(), from = Math.max(now, ring.until);
  ring.until = from + RING_SECONDS * 1000;
  for (let t = 0; t < RING_SECONDS * 1000; t += 1250) setTimeout(chime, from - now + t);
}
function beep() {
  if (!S.sound) return;
  if (!audioReady()) { unlockAudio(); if (!audioReady()) return; }
  [0, 0.25].forEach((t) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.15); });
}

// ---------- vista ----------
function render(force = false) {
  // mientras se edita un pedido no se redibuja la lista (se perdería lo que se está escribiendo)
  if (S.editing && !force && ["pedidos", "agenda", "historial"].includes(S.tab)) { S.pendingRender = true; return; }
  $$(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  const soon = Date.now() + AGENDA_HOURS * 3600000;
  const isAgenda = (o) => o.scheduled_for && new Date(o.scheduled_for).getTime() > soon && ["confirmado", "por_confirmar"].includes(o.status);
  const active = S.orders.filter((o) => ACTIVE.includes(o.status) && !isAgenda(o));
  const agenda = S.orders.filter((o) => isAgenda(o) || (o.scheduled_for && o.status === "pendiente_pago" && new Date(o.scheduled_for) > new Date()));
  const ca = $("#cntActive"); ca.hidden = !active.length; ca.textContent = active.length;
  const cg = $("#cntAgenda"); const agPaid = agenda.filter((o) => o.status !== "pendiente_pago").length; cg.hidden = !agPaid; cg.textContent = agPaid;

  const v = $("#view");
  // el formulario de pedido por WhatsApp no se redibuja con cada actualización
  if (S.tab === "nuevo") { if (v.dataset.on !== "nuevo") { v.dataset.on = "nuevo"; renderManual(v); } return; }
  v.dataset.on = S.tab;
  if (S.tab === "pedidos") {
    const today = new Date().toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" });
    const isToday = (d) => d && new Date(d).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" }) === today;
    const done = S.orders.filter((o) => o.status === "entregado" && isToday(o.delivered_at));
    const sales = S.orders.filter((o) => o.payment_status === "pagado" && o.status !== "cancelado" && isToday(o.paid_at)).reduce((s, o) => s + Number(o.subtotal), 0);
    const unpaid = S.orders.filter((o) => o.status === "pendiente_pago" && !o.scheduled_for && Date.now() - new Date(o.created_at) < 2 * 3600000);
    const by = (st) => active.filter((o) => st.includes(o.status)).sort((a, b) => new Date(a.eta) - new Date(b.eta));
    v.innerHTML = `
      <div class="stats"><div><b>${active.length}</b>en curso</div><div><b>${done.length}</b>entregados hoy</div><div><b>${money(sales)}</b>vendido hoy en productos</div></div>
      ${group("Por confirmar pago", by(["por_confirmar"]))}
      ${group("Confirmados · por preparar", by(["confirmado"]))}
      ${group("En preparación", by(["preparando"]))}
      ${group("Listos y en camino", by(["listo", "en_camino"]))}
      ${!active.length ? `<div class="panel"><p class="muted">No hay pedidos en curso. Cuando entre uno, aparecerá aquí ${S.sound ? "y sonará" : "(el sonido está apagado; tócalo arriba para encenderlo)"}.</p></div>` : ""}
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
  const pin = S.pins.get(o.id)?.pin;
  const msgs = {
    pendiente_pago: `Hola ${first}, vimos tu pedido ${o.code} en The Bakery Side pero aún no se completó el pago. Puedes pagarlo aquí: ${link}`,
    por_confirmar: `Hola ${first}, recibimos tu comprobante del pedido ${o.code}. Lo estamos verificando. Seguimiento: ${link}`,
    confirmado: `Hola ${first}, ¡confirmamos tu pedido ${o.code}! ${o.scheduled_for ? `Lo entregamos ${dayLabel(o.scheduled_for).toLowerCase()} entre ${orderRange(o, win())}.` : `Llega entre ${orderRange(o, win())}.`} Seguimiento: ${link}`,
    preparando: `Hola ${first}, tu pedido ${o.code} ya se está preparando. Seguimiento: ${link}`,
    listo: o.fulfillment === "pickup" ? `Hola ${first}, tu pedido ${o.code} ya está listo para retirar en nuestra cocina. Seguimiento: ${link}` : `Hola ${first}, tu pedido ${o.code} está listo y sale en minutos. Seguimiento: ${link}`,
    en_camino: `Hola ${first}, tu pedido ${o.code} va en camino${r ? ` con ${r}` : ""}. Seguimiento: ${link}`,
    entregado: `Hola ${first}, gracias por tu pedido ${o.code}. ¡Que lo disfrutes!`,
    cancelado: `Hola ${first}, tu pedido ${o.code} fue cancelado. Escríbenos si tienes dudas.`,
  };
  return msgs[o.status];
}

// Tarjeta de pedido: arriba lo que cocina necesita (hora, productos, regalo, acción); los datos del cliente van plegados
const ICON = {
  moto: `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18.5" cy="17" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 17h6l2-6h-4M14 6h3l1.5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  pay: `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/></svg>`,
  pin: `<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>`,
  gift: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7S10.5 3 8 3.6 7.6 7 12 7zm0 0s1.5-4 4-3.4S16.4 7 12 7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
};
const linkedCodes = (o) => S.orders.filter((x) => x.group_id === o.group_id && x.id !== o.id).map((x) => `${esc(x.code)}${x.scheduled_for ? ` (${dayLabel(x.scheduled_for)})` : " (ahora)"}`).join(", ") || "otro pedido";
function relTime(o) {
  if (["entregado", "cancelado", "pendiente_pago"].includes(o.status)) return "";
  const at = new Date(o.scheduled_for || o.eta).getTime(), m = Math.round((at - Date.now()) / 60000);
  if (m < -1) return `<span class="rel late">${-m} min tarde</span>`;
  if (m <= 1) return `<span class="rel late">ahora</span>`;
  if (m < 90) return `<span class="rel ${m <= 15 ? "soon" : ""}">en ${m} min</span>`;
  return "";
}
const balancePending = (o) => Number(o.balance_due) > 0 && !o.balance_paid_at && o.status !== "cancelado";
const extraDue = (o) => (o.status === "cancelado" ? 0 : Math.round(Number(o.extra_due || 0) * 100) / 100);
function payChip(o) {
  const ex = extraDue(o);
  const base = payChipBase(o);
  if (ex > 0) return base + `<span class="chip bad">${ICON.pay}Falta cobrar diferencia ${money(ex)}</span>`;
  if (ex < 0) return base + `<span class="chip warn">${ICON.pay}Devolver ${money(-ex)} al cliente</span>`;
  return base;
}
function payChipBase(o) {
  if (o.payment_status === "pagado" && balancePending(o)) return `<span class="chip warn">${ICON.pay}Anticipo ${money(o.deposit)} · falta ${money(o.balance_due)}</span>`;
  if (o.payment_status === "pagado") return `<span class="chip ok">${ICON.pay}Pagado${Number(o.balance_due) > 0 ? " (saldo cobrado)" : ""}</span>`;
  if (o.payment_status === "en_revision") return `<span class="chip warn">${ICON.pay}Transferencia por verificar</span>`;
  return `<span class="chip warn">${ICON.pay}${o.payment_status === "fallido" ? "Pago fallido" : "Sin pagar"}</span>`;
}
function riderChip(o) {
  if (!["confirmado", "preparando", "listo", "en_camino", "entregado"].includes(o.status)) return "";
  if (!o.riders) return `<span class="chip warn">${ICON.moto}Sin motorizado</span>`;
  return `<span class="chip">${ICON.moto}${esc(o.riders.full_name.split(" ")[0])}${o.rider_accepted_at || o.status === "entregado" ? "" : " · sin aceptar"}</span>`;
}
function itemLine(i) {
  // lo agregado después (Editar pedido) va con un fondo apenas distinto
  if (i.added_at) return itemLineBase(i).replace("<li>", `<li class="added" title="Agregado después · ${hhmm(i.added_at)}">`);
  return itemLineBase(i);
}
function itemLineBase(i) {
  const m = String(i.name).match(/^(.*?) \(([^()]*)\)$/); // "Cold Brew (11oz) (Stevia)" → opción aparte
  // con las elecciones guardadas: una línea por cada una (Postre, Bebida, Endulzante…)
  if (m && Array.isArray(i.options) && i.options.length)
    return `<li><b class="q">${i.quantity}</b><span>${esc(m[1])}${i.options.map((o) => `<em><small>${esc(o.group)}:</small> ${esc(o.choice)}</em>`).join("")}</span></li>`;
  return m ? `<li><b class="q">${i.quantity}</b><span>${esc(m[1])}<em>${esc(m[2])}</em></span></li>` : `<li><b class="q">${i.quantity}</b><span>${esc(i.name)}</span></li>`;
}
const win = () => Number(S.settings?.eta_window_minutes || 30);
const travelMin = (km) => Math.max(8, Math.round(Number(km) / 25 * 60 + 5)); // igual que el servidor
// ---------- Uber ----------
// Cuándo pedir el Uber: inicio de la franja de entrega − trayecto hasta el cliente − lo que tarda el Uber en llegar a la cocina
const uberWait = () => Number(S.settings?.uber_wait_minutes ?? 15);
const needsUber = (o) => o.fulfillment !== "pickup" && ["confirmado", "preparando", "listo"].includes(o.status) && o.lat != null && !o.rider_id;
function arriveAt(o) {
  if (o.scheduled_for) return new Date(o.scheduled_for).getTime();
  return Math.ceil(new Date(o.eta).getTime() / 900000) * 900000; // mismo inicio de franja que ve el cliente
}
const uberAt = (o) => arriveAt(o) - (travelMin(o.distance_km) + uberWait()) * 60000;
const uberMinLeft = (o) => Math.round((uberAt(o) - Date.now()) / 60000);
function uberChip(o) {
  if (!needsUber(o)) return "";
  if (o.uber_requested_at) {
    const llega = new Date(o.uber_requested_at).getTime() + uberWait() * 60000;
    return `<span class="chip ok">${ICON.moto}Uber pedido ${hhmm(o.uber_requested_at)} · llega ~${hhmm(llega)}<button type="button" class="chip-x" data-act="uberUndo" data-id="${o.id}" aria-label="Desmarcar Uber pedido">×</button></span>`;
  }
  const m = uberMinLeft(o);
  if (m <= 0) return `<span class="chip bad uber-now">${ICON.moto}¡Pide el Uber ya!${m < -2 ? ` · ${-m} min tarde` : ""}</span>`;
  if (m <= 10) return `<span class="chip warn">${ICON.moto}Pide el Uber a las ${hhmm(uberAt(o))} · en ${m} min</span>`;
  return `<span class="chip">${ICON.moto}Pide el Uber a las ${hhmm(uberAt(o))}${m < 120 ? ` · en ${m} min` : ""}</span>`;
}
// Abre la app de Uber con la cocina como recogida y el pin exacto del cliente como entrega
function uberLink(o) {
  const st = S.settings || {}, who = o.recipient_name || o.customer_name;
  const q = new URLSearchParams({
    action: "setPickup",
    "pickup[latitude]": st.kitchen_lat, "pickup[longitude]": st.kitchen_lng, "pickup[nickname]": "The Bakery Side",
    "dropoff[latitude]": o.lat, "dropoff[longitude]": o.lng, "dropoff[nickname]": `${who} · ${o.code}`,
    "dropoff[formatted_address]": o.address || "",
  });
  return q.toString();
}
// Android: abre la app de Uber directo (intent) sin pasar por una pestaña en blanco; iPhone: esquema uber://; computadora: enlace web
// Computadora: la web de Uber ya no lee el enlace antiguo (/ul/); este formato abre el viaje con la recogida y la entrega puestas
function uberWebLink(o) {
  const st = S.settings || {}, who = o.recipient_name || o.customer_name;
  const pickup = { latitude: Number(st.kitchen_lat), longitude: Number(st.kitchen_lng), addressLine1: "The Bakery Side" };
  const drop = { latitude: Number(o.lat), longitude: Number(o.lng), addressLine1: `${who} · ${o.code}`, addressLine2: String(o.address || "").split(" · Ubicación del mapa: ")[0].slice(0, 120) };
  const v = uberVehicle();
  return `https://m.uber.com/go/product-selection?pickup=${encodeURIComponent(JSON.stringify(pickup))}&drop%5B0%5D=${encodeURIComponent(JSON.stringify(drop))}${v ? `&vehicle=${v}` : ""}`;
}
// Tipo de Uber que queda elegido en la web (códigos de Uber en Guayaquil, nov 2026). Se cambia en Cocina → Tienda.
const UBER_TYPES = { courier: ["20006119", "Courier (auto)"], bikes: ["20036101", "Courier Bikes"], none: ["", "Elegir en Uber"] };
const uberType = () => { try { return localStorage.getItem("tbs_uber_type") || "courier"; } catch { return "courier"; } };
const uberVehicle = () => (UBER_TYPES[uberType()] || UBER_TYPES.courier)[0];
function openUber(o) {
  const q = uberLink(o), web = uberWebLink(o), ua = navigator.userAgent;
  // nombre, teléfono y referencia quedan copiados para pegarlos en las instrucciones del envío
  navigator.clipboard?.writeText(uberText(o)).then(() => toast("Datos del cliente copiados: péguelos en las instrucciones del Uber", 5000), () => {});
  if (/Android/i.test(ua)) { location.href = `intent://?${q}#Intent;scheme=uber;package=com.ubercab;S.browser_fallback_url=${encodeURIComponent(web)};end`; return; }
  if (/iPhone|iPad|iPod/i.test(ua)) { location.href = "uber://?" + q; return; }
  window.open(web, "_blank", "noopener");
}
// Texto para pegar en las instrucciones del envío: solo nombre, teléfono y referencia (la ubicación ya va en el Uber)
function uberText(o) {
  const name = o.recipient_name || o.customer_name, phone = (o.recipient_name && o.recipient_phone) || o.customer_phone;
  return `${name} · ${phone}${o.reference ? `\nRef: ${o.reference}` : ""}`;
}
// Aviso cuando llega la hora de pedir el Uber; se repite cada 3 min hasta tocar "Ya lo pedí".
// Si el navegador aún no deja sonar (falta tocar la pantalla), queda pendiente y suena al primer toque.
function uberAlerts() {
  const due = S.orders.filter((o) => needsUber(o) && !o.uber_requested_at && uberMinLeft(o) <= 1);
  const now = Date.now();
  const pending = due.filter((o) => now - (S.uberAlerted.get(o.id) || 0) >= 3 * 60000);
  if (!pending.length) return;
  const codes = pending.map((o) => o.code).join(", ");
  if (!S.uberToasted?.has(codes)) { toast(`${codes}: es hora de pedir el Uber`, 6000); flashTitle(`🛵 Pide el Uber · ${codes}`); (S.uberToasted ||= new Set()).add(codes); }
  if (beepUber() || !S.sound) pending.forEach((o) => S.uberAlerted.set(o.id, now));
}
// La hora de entrega (eta) es la que pidió el cliente al hacer el pedido: cocina nunca la cambia.
function card(o) {
  const pick = o.fulfillment === "pickup";
  const t = o.scheduled_for ? `${dayLabel(o.scheduled_for)} · ${orderRange(o, win())}` : `Entre ${orderRange(o, win())}`;
  const riderOpts = `<option value="">Asignar motorizado…</option>` + S.riders.filter((r) => r.active).map((r) => `<option value="${r.id}" ${o.rider_id === r.id ? "selected" : ""}>${esc(r.full_name)}</option>`).join("");
  const pin = S.pins.get(o.id);
  // acción principal según el estado (una sola, grande)
  let main = "";
  if (o.status === "por_confirmar") main = `<button class="btn small" data-act="receipt" data-id="${o.id}">Ver comprobante</button><button class="btn primary" data-act="confirmPay" data-id="${o.id}">Confirmar pago</button>`;
  else if (o.status === "pendiente_pago") main = `<button class="btn primary" data-act="manualPayAsk" data-id="${o.id}">Marcar pagado</button>`;
  else if (o.status === "confirmado") main = `<button class="btn primary" data-act="prep" data-id="${o.id}">Empezar a preparar</button>`;
  else if (o.status === "preparando") main = `<button class="btn primary" data-act="ready" data-id="${o.id}">${pick ? "Listo · para que lo retire" : "Listo · pedir el Uber"}</button>`;
  else if (o.status === "listo" && pick) main = `<button class="btn primary" data-act="pickedUp" data-id="${o.id}">Entregado · ya lo retiró</button>`;
  else if (o.status === "listo") main = `<button class="btn primary" data-act="${o.uber_requested_at ? "sent" : "sentAsk"}" data-id="${o.id}">${ICON.moto}Salió con el Uber · en camino</button>`;
  else if (o.status === "en_camino") main = `<button class="btn primary" data-act="delivered" data-id="${o.id}">Entregado</button>`;
  const assign = !pick && S.riders.some((r) => r.active) && ["confirmado", "preparando", "listo"].includes(o.status) ? `<select class="in" data-act="assign" data-id="${o.id}" aria-label="Motorizado">${riderOpts}</select>` : "";
  const canCancel = !["entregado", "cancelado"].includes(o.status);
  const canForce = ["listo", "en_camino"].includes(o.status);
  const delivered = o.status === "entregado" ? `<span>Entregado ${hhmm(o.delivered_at)}${o.delivered_by === "moto" ? " · confirmado por el motorizado" : ""}${o.delivery_note ? ` (${esc(o.delivery_note)})` : ""}</span>` : "";
  return `<article class="ocard" data-s="${o.status}">
    <div class="ohead"><span class="oid">${esc(o.code)}${o.channel === "whatsapp" || /WhatsApp/.test(o.payment_ref || "") ? ` <span class="wa-tag">WhatsApp</span>` : ""}</span><span class="st st-${o.status}">${STATUS[o.status]}</span></div>
    <div class="owhen tabnum">${esc(t)} ${relTime(o)}</div>
    <div class="oname">${o.recipient_name ? `Para: <b>${esc(o.recipient_name)}</b><span>regalo de ${esc(o.gift_from || o.customer_name)}</span>` : `<b>${esc(o.customer_name)}</b>`}</div>
    <ul class="kitems">${[...o.order_items].sort((a, b) => (a.added_at ? 1 : 0) - (b.added_at ? 1 : 0) || (a.id || 0) - (b.id || 0)).map(itemLine).join("")}</ul>
    ${o.gift_message || o.recipient_name ? `<div class="gift">${ICON.gift}<div><b>Regalo${o.recipient_name ? ` para ${esc(o.recipient_name)}` : ""}</b><span class="from">De parte de: <b>${esc(o.gift_from || o.customer_name)}</b></span>${o.gift_message ? `<span>Tarjeta: “${esc(o.gift_message)}”</span>` : `<span>Sin mensaje: solo la firma.</span>`}</div></div>` : ""}
    ${o.payment_status === "pagado" && balancePending(o) ? `<div class="balnote"><div>🎉 <b>Evento:</b> cobrar el saldo de <b>${money(o.balance_due)}</b> antes de entregar.</div><button class="btn small" data-act="balanceAsk" data-id="${o.id}">Saldo cobrado</button></div>
    <div class="confirm-row" data-bal="${o.id}" hidden><p class="small" style="margin:0;flex:1">¿Confirmas que el cliente ya pagó los ${money(o.balance_due)}?</p><button class="btn small primary" data-act="balancePaid" data-id="${o.id}">Sí, ya pagó</button></div>` : ""}
    ${extraDue(o) ? `<div class="balnote"><div>${extraDue(o) > 0 ? `➕ <b>Pedido editado:</b> cobrar la diferencia de <b>${money(extraDue(o))}</b> antes de entregar.` : `↩️ <b>Pedido editado:</b> devolverle <b>${money(-extraDue(o))}</b> al cliente.`}</div><button class="btn small" data-act="extraAsk" data-id="${o.id}">${extraDue(o) > 0 ? "Diferencia cobrada" : "Ya le devolví"}</button></div>
    <div class="confirm-row" data-extra="${o.id}" hidden><p class="small" style="margin:0;width:100%">${extraDue(o) > 0 ? `¿Confirmas que el cliente ya pagó los <b>${money(extraDue(o))}</b> de diferencia? Revisa que el dinero ya esté en la cuenta.` : `¿Confirmas que ya le devolviste <b>${money(-extraDue(o))}</b>?`}</p><input class="in" placeholder="Referencia o banco (opcional)" data-extraref="${o.id}" style="flex:1;min-width:160px"><button class="btn small primary" data-act="extraPaid" data-id="${o.id}">Sí, confirmado</button></div>` : ""}
    ${S.editing?.id === o.id ? `<div class="editbox" data-edit="${o.id}"></div>` : ""}
    ${o.group_id ? `<div class="linknote">🔗 Pago junto con ${linkedCodes(o)} (dos entregas)</div>` : ""}
    ${o.order_items.some((i) => /^Postre sorpresa/.test(i.name)) ? `<div class="linknote">🎁 Incluye postre sorpresa de regalo: elige uno de hasta ${money(S.settings?.reward_max_value ?? 4)}</div>` : ""}
    <div class="chips">${payChip(o)}${pick ? `<span class="chip ok">🛍️ Retira en la cocina</span>` : `${S.riders.some((r) => r.active) ? riderChip(o) : ""}<span class="chip">${ICON.pin}${Number(o.distance_km).toFixed(1)} km</span>${uberChip(o)}`}</div>
    ${needsUber(o) ? `<div class="acts uber-acts"><button class="btn small${o.uber_requested_at || uberMinLeft(o) <= 10 ? " primary" : ""}" data-act="uber" data-id="${o.id}">${ICON.moto}Pedir Uber</button>${o.uber_requested_at ? "" : `<button class="btn small" data-act="uberMark" data-id="${o.id}">✓ Ya lo pedí</button>`}<button class="btn small ghost" data-act="uberCopy" data-id="${o.id}">Copiar datos para el Uber</button></div>` : ""}
    ${main || assign ? `<div class="acts main">${main}${assign}</div>` : ""}
    ${o.status === "listo" && !pick && !o.uber_requested_at ? `<div class="confirm-row" data-sent="${o.id}" hidden><p class="small" style="margin:0;flex:1">Todavía no marcas el Uber como pedido. ¿Ya salió el pedido?</p><button class="btn small primary" data-act="sent" data-id="${o.id}">Sí, ya salió</button></div>` : ""}
    <details class="more">
      <summary>Datos del cliente y entrega</summary>
      <div class="meta">
        <span><b>${esc(o.customer_name)}</b> · <a href="tel:${esc(o.customer_phone)}">${esc(o.customer_phone)}</a></span>
        ${o.recipient_name ? `<span>Recibe: <b>${esc(o.recipient_name)}</b>${o.recipient_phone ? " · " + esc(o.recipient_phone) : ""}</span>` : ""}
        <span>${esc(o.address)}${o.reference ? " · " + esc(o.reference) : ""}</span>
        ${Number(o.deposit) > 0 ? `<span>Evento · anticipo ${money(o.deposit)} · saldo ${money(o.balance_due)}${o.balance_paid_at ? ` cobrado ${hhmm(o.balance_paid_at)}` : " por cobrar"}</span>` : ""}
        <span>Total <b>${money(o.total)}</b> · envío ${money(o.delivery_fee)}${o.fee_edited ? " (editado)" : ""} · ${o.payment_method === "tarjeta" ? "tarjeta" : "transferencia"}</span>
        ${Number(o.extra_paid) ? `<span>${Number(o.extra_paid) > 0 ? `Diferencia cobrada: ${money(o.extra_paid)}` : `Devuelto al cliente: ${money(-Number(o.extra_paid))}`}${o.extra_paid_at ? ` · ${hhmm(o.extra_paid_at)}` : ""}${o.extra_ref ? ` · ${esc(o.extra_ref)}` : ""}</span>` : ""}
        ${Number(o.discount) > 0 ? `<span>Regalo de cumpleaños: −${money(o.discount)}</span>` : ""}
        ${o.user_id ? `<span>Cliente con cuenta (suma sellos)</span>` : ""}
        ${o.invoice_type === "con_datos" ? `<span>Factura: ${esc(o.invoice_name)} · ${esc(o.invoice_id_number)} · ${esc(o.invoice_email)}</span>` : ""}
        ${delivered}
        ${o.cancel_reason ? `<span>Motivo: ${esc(o.cancel_reason)}</span>` : ""}
      </div>
    </details>
    <div class="acts">
      <a class="btn small ghost" ${waAttrs(o.customer_phone, waText(o))}>WhatsApp</a>
      <a class="btn small ghost" href="https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}" target="_blank" rel="noopener">Mapa</a>
      ${canForce && o.status === "listo" ? `<button class="btn small ghost" data-act="forceAsk" data-id="${o.id}">Marcar entregado</button>` : ""}
      ${o.status !== "cancelado" && S.editing?.id !== o.id ? `<button class="btn small ghost" data-act="editOpen" data-id="${o.id}">✏️ Editar pedido</button>` : ""}
      ${canCancel ? `<button class="btn small ghost" data-act="cancelAsk" data-id="${o.id}">Cancelar</button>` : ""}
    </div>
    ${o.status === "pendiente_pago" ? `<div class="confirm-row" data-mpay="${o.id}" hidden>
      <p class="small" style="margin:0;width:100%">¿Cómo pagó los <b>${money(o.total)}</b>? Revisa que el dinero ya esté en la cuenta o en Payphone.</p>
      <select class="in" data-mpaym="${o.id}" aria-label="Forma de pago"><option value="link">Link de pago Payphone</option><option value="transferencia">Transferencia</option></select>
      <input class="in" placeholder="Referencia o nombre de quien pagó (opcional)" data-mpayr="${o.id}" style="flex:1;min-width:160px">
      <button class="btn small primary" data-act="manualPay" data-id="${o.id}">Sí, ya pagó</button>
    </div>` : ""}
    <div class="confirm-row" data-force="${o.id}" hidden>
      <p class="small" style="margin:0;width:100%">¿Quién lo recibió o qué pasó? (opcional)</p>
      <input class="in" placeholder="Ej.: lo recibió el guardia" data-freason="${o.id}" style="flex:1;min-width:160px">
      <button class="btn small" data-act="force" data-id="${o.id}">Confirmar entregado</button>
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
  if (error) { toast("No se pudo guardar: " + error.message); return false; }
  toast(msg); await loadOrders(); render();
  return true;
}
// Después de cambiar el estado: abre el chat del cliente con el mensaje de ese paso (si está encendido en Tienda)
function tell(o, status) {
  if (!waAuto() || !o?.customer_phone) return;
  const text = waText({ ...o, status });
  if (text) openWa(o.customer_phone, text);
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const id = b.dataset.id, o = S.orders.find((x) => x.id === id), now = new Date().toISOString();
  switch (b.dataset.act) {
    case "receipt": {
      const { data, error } = await sb.storage.from("comprobantes").createSignedUrl(o.transfer_receipt_path, 600);
      if (error) return toast("No pudimos abrir el comprobante.");
      return showReceipt(o, data.signedUrl);
    }
    case "confirmPay": {
      // la hora de llegada se cuenta desde que se confirma el pago; si son dos entregas, se confirman ambas
      const patch = { payment_status: "pagado", status: "confirmado", paid_at: now };
      if (!o.group_id) { if (await upd(id, patch, `${o.code}: pago confirmado`)) tell(o, "confirmado"); return; }
      for (const g of S.orders.filter((x) => x.group_id === o.group_id && x.status !== "cancelado")) {
        const { error } = await sb.from("orders").update(patch).eq("id", g.id);
        if (error) return toast("No se pudo guardar: " + error.message);
      }
      toast(`${o.code}: pago confirmado (las dos entregas)`); await loadOrders(); render(); tell(o, "confirmado"); return;
    }
    // Pago fuera de la tienda (link de pago o transferencia por WhatsApp): cocina lo marca a mano
    case "manualPayAsk": $(`[data-mpay="${id}"]`).hidden = false; break;
    case "manualPay": {
      const link = $(`[data-mpaym="${id}"]`).value === "link";
      const note = $(`[data-mpayr="${id}"]`).value.trim().slice(0, 120);
      const ref = `${link ? "Link de pago Payphone" : "Transferencia"} · marcado en cocina${note ? " · " + note : ""}`;
      const patch = { payment_status: "pagado", status: "confirmado", paid_at: now, payment_method: link ? "tarjeta" : "transferencia", payment_ref: ref };
      const group = o.group_id ? S.orders.filter((x) => x.group_id === o.group_id && x.status !== "cancelado") : [o];
      for (const g of group) {
        const { error } = await sb.from("orders").update(patch).eq("id", g.id);
        if (error) return toast("No se pudo guardar: " + error.message);
      }
      toast(`${o.code}: marcado como pagado${group.length > 1 ? " (las dos entregas)" : ""}`); await loadOrders(); render(); tell(o, "confirmado"); return;
    }
    case "uber": openUber(o); return; // solo abre Uber; el pedido no se marca hasta tocar "Ya lo pedí"
    case "uberMark": return upd(id, { uber_requested_at: now }, `${o.code}: Uber pedido`);
    case "uberUndo": return upd(id, { uber_requested_at: null }, `${o.code}: Uber sin pedir`);
    case "uberCopy": {
      try { await navigator.clipboard.writeText(uberText(o)); toast("Datos copiados. Pégalos en las instrucciones del Uber."); }
      catch { window.prompt("Copia estos datos:", uberText(o)); }
      return;
    }
    case "prep": if (await upd(id, { status: "preparando", prep_started_at: now }, `${o.code} en preparación`)) tell(o, "preparando"); return;
    case "ready": if (await upd(id, { status: "listo", ready_at: now }, `${o.code} listo`)) tell(o, "listo"); return;
    case "balanceAsk": $(`[data-bal="${id}"]`).hidden = false; break;
    case "extraAsk": $(`[data-extra="${id}"]`).hidden = false; break;
    case "extraPaid": {
      b.disabled = true;
      try {
        const r = await api("cobrar_diferencia", { order_id: id, ref: $(`[data-extraref="${id}"]`).value.trim() });
        toast((r.amount > 0 ? `${o.code}: diferencia de ${money(r.amount)} cobrada` : `${o.code}: devolución registrada`) + (r.stamps ? ` · +${r.stamps} sello${r.stamps > 1 ? "s" : ""} para el cliente` : ""), 5000);
      } catch (ex) { b.disabled = false; return toast(ex.message); }
      await loadOrders(); render(); return;
    }
    case "editOpen": return openEditor(o);
    case "edClose": S.editing = null; render(); return;
    case "edAdd": return edAdd();
    case "edDel": S.editing.add.splice(Number(b.dataset.i), 1); edDrawList(); return;
    case "edSave": return edSave(b);
    case "balancePaid": return upd(id, { balance_paid_at: now }, `Saldo de ${o.code} cobrado`);
    case "pickedUp": if (await upd(id, { status: "entregado", delivered_at: now, picked_at: o.picked_at || now, delivered_by: "cocina", delivery_note: "Retiró en la cocina" }, `${o.code} entregado`)) tell(o, "entregado"); return;
    case "forceAsk": $(`[data-force="${id}"]`).hidden = false; $(`[data-freason="${id}"]`).focus(); break;
    case "force": {
      const reason = $(`[data-freason="${id}"]`).value.trim();
      if (await upd(id, { status: "entregado", delivered_at: now, picked_at: o.picked_at || now, delivered_by: "cocina", delivery_note: reason.slice(0, 200) || null }, `${o.code} entregado`)) tell(o, "entregado");
      return;
    }
    // Entregas con Uber Courier: cocina marca la salida y la entrega
    case "sentAsk": $(`[data-sent="${id}"]`).hidden = false; break;
    case "sent": if (await upd(id, { status: "en_camino", picked_at: now }, `${o.code} en camino`)) tell(o, "en_camino"); return;
    case "delivered": if (await upd(id, { status: "entregado", delivered_at: now, picked_at: o.picked_at || now, delivered_by: "cocina", delivery_note: "Uber" }, `${o.code} entregado`)) tell(o, "entregado"); return;
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

// ---------- editar un pedido ya hecho: agregar productos y cambiar el envío ----------
async function loadOpts() {
  if (S.opts) return;
  let r = await sb.from("product_option_groups").select("product_id, only_if, option_groups(id,name,required,sort,option_choices(id,name,price_delta,sort,active))");
  if (r.error) r = await sb.from("product_option_groups").select("product_id, option_groups(id,name,required,sort,option_choices(id,name,price_delta,sort,active))");
  const m = {};
  for (const x of r.data || []) {
    const g = x.option_groups; if (!g) continue;
    const ch = (g.option_choices || []).filter((c) => c.active).sort((a, b) => a.sort - b.sort);
    if (!ch.length) continue;
    (m[x.product_id] ||= []).push({ ...g, option_choices: ch, only_if: x.only_if?.length ? x.only_if.map(Number) : null });
  }
  for (const gs of Object.values(m)) gs.sort((a, b) => (a.only_if ? 1 : 0) - (b.only_if ? 1 : 0) || (a.sort || 0) - (b.sort || 0));
  S.opts = m;
}
const edOrder = () => S.orders.find((x) => x.id === S.editing?.id);
const edChoice = (cid) => { for (const gs of Object.values(S.opts || {})) for (const g of gs) { const c = g.option_choices.find((x) => x.id === cid); if (c) return c; } return null; };
const edLinePrice = (l) => Number(S.products.find((p) => p.id === l.product_id)?.price || 0) + l.options.reduce((t, c) => t + Number(edChoice(c)?.price_delta || 0), 0);
const edLineName = (l) => { const p = S.products.find((x) => x.id === l.product_id); const n = l.options.map((c) => edChoice(c)?.name).filter(Boolean); return (p?.name || "Producto") + (n.length ? ` (${n.join(", ")})` : ""); };

async function openEditor(o) {
  await loadOpts();
  S.editing = { id: o.id, add: [] };
  render(true);
  const box = $(`[data-edit="${o.id}"]`); if (!box) return;
  const pick = o.fulfillment === "pickup";
  const cats = S.cats.filter((c) => c.active !== false);
  const prods = S.products.filter((p) => p.active && !/^Postre sorpresa/.test(p.name));
  const optsHtml = cats.map((c) => { const ps = prods.filter((p) => p.category_id === c.id); return ps.length ? `<optgroup label="${esc(c.name)}">${ps.map((p) => `<option value="${p.id}">${esc(p.name)} · ${money(p.price)}</option>`).join("")}</optgroup>` : ""; }).join("")
    + (() => { const rest = prods.filter((p) => !cats.some((c) => c.id === p.category_id)); return rest.length ? `<optgroup label="Otros">${rest.map((p) => `<option value="${p.id}">${esc(p.name)} · ${money(p.price)}</option>`).join("")}</optgroup>` : ""; })();
  box.innerHTML = `
    <div class="edhead"><b>✏️ Editar ${esc(o.code)}</b><button class="btn small ghost" data-act="edClose" type="button">Cerrar</button></div>
    <label class="f">Agregar productos</label>
    <input class="in" data-edsearch type="search" placeholder="Buscar producto (ej.: hibiscus, mini, lata)" autocomplete="off">
    <div class="edrow"><select class="in" data-edp style="flex:1;min-width:180px"><option value="">Elige un producto…</option>${optsHtml}</select>
      <input class="in" data-edq type="number" inputmode="numeric" min="1" max="50" value="1" style="width:70px" aria-label="Cantidad">
      <button class="btn small" data-act="edAdd" type="button">Agregar</button></div>
    <div class="edrow" data-edopts></div>
    <div data-edlist></div>
    ${pick ? "" : `<label class="f" style="margin-top:8px">Envío a cobrar</label>
    <div class="edrow"><span class="mdep-cur">$</span><input class="in" data-edfee type="number" inputmode="decimal" min="0" max="100" step="0.25" value="${Number(o.delivery_fee).toFixed(2)}" style="width:110px">
      <span class="muted small">Antes ${money(o.delivery_fee)}${Number(o.rider_fee) ? ` · el motorizado sigue ganando ${money(o.rider_fee)}` : ""}</span></div>`}
    <div data-edsum></div>
    <p class="err" data-ederr role="alert"></p>
    <div class="edrow"><button class="btn primary" data-act="edSave" type="button">Guardar cambios</button></div>`;
  $("[data-edp]", box).onchange = edDrawOpts;
  // buscador: filtra la lista (sin tildes, todas las palabras) y elige solo si queda un producto
  const edSel = $("[data-edp]", box);
  const catName = (p) => S.cats.find((c) => c.id === p.category_id)?.name || "";
  $("[data-edsearch]", box).oninput = (e) => {
    const words = fold(e.target.value).split(/\s+/).filter(Boolean);
    let hits = 0, last = null;
    $$("option[value]", edSel).forEach((op) => {
      if (!op.value) return;
      const p = S.products.find((x) => String(x.id) === op.value);
      const hay = fold(`${p?.name} ${catName(p)} ${p?.description || ""}`);
      const ok = words.every((w) => hay.includes(w));
      op.hidden = !ok; op.disabled = !ok;
      if (ok) { hits++; last = op.value; }
    });
    $$("optgroup", edSel).forEach((g) => (g.hidden = ![...g.children].some((op) => !op.hidden)));
    if (hits === 1 && edSel.value !== last) { edSel.value = last; edDrawOpts(); }
    else if (edSel.selectedOptions[0]?.hidden) { edSel.value = ""; edDrawOpts(); }
  };
  $("[data-edsearch]", box).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); if (edSel.value) edAdd(); } };
  $("[data-edfee]", box)?.addEventListener("input", edDrawSum);
  box.addEventListener("change", (e) => { if (e.target.matches("[data-edg]")) edDrawOpts(true); if (e.target.matches("input[name=edpay]")) edDrawSum(); });
  edDrawList();
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}
// Opciones del producto elegido (endulzante, bebida del combo…); las condicionales solo si aplican
function edDrawOpts(keep = false) {
  const box = $(`[data-edit="${S.editing.id}"]`), slot = $("[data-edopts]", box);
  const pid = Number($("[data-edp]", box).value), gs = S.opts[pid] || [];
  const prev = keep === true ? Object.fromEntries($$("[data-edg]", slot).map((x) => [x.dataset.edg, x.value])) : {};
  const base = gs.filter((g) => !g.only_if).map((g) => Number(prev[g.id] || 0)).filter(Boolean);
  slot.innerHTML = gs.filter((g) => !g.only_if || g.only_if.some((c) => base.includes(c))).map((g) => `<select class="in" data-edg="${g.id}" aria-label="${esc(g.name)}"><option value="">${esc(g.name)}${g.required ? "" : " (opcional)"}…</option>${g.option_choices.map((c) => `<option value="${c.id}" ${String(prev[g.id]) === String(c.id) ? "selected" : ""}>${esc(c.name)}${Number(c.price_delta) > 0 ? ` +${money(c.price_delta)}` : ""}</option>`).join("")}</select>`).join("");
}
function edAdd() {
  const box = $(`[data-edit="${S.editing.id}"]`), err = $("[data-ederr]", box); err.textContent = "";
  const pid = Number($("[data-edp]", box).value);
  if (!pid) { err.textContent = "Elige el producto que quiere agregar."; return; }
  const q = Math.floor(Number($("[data-edq]", box).value));
  if (!(q >= 1 && q <= 50)) { err.textContent = "Revisa la cantidad."; return; }
  const sels = $$("[data-edg]", box);
  const miss = sels.find((x) => !x.value && (S.opts[pid] || []).find((g) => String(g.id) === x.dataset.edg)?.required);
  if (miss) { err.textContent = `Elige ${miss.getAttribute("aria-label").toLowerCase()}.`; miss.focus(); return; }
  S.editing.add.push({ product_id: pid, quantity: q, options: sels.map((x) => Number(x.value)).filter(Boolean) });
  $("[data-edp]", box).value = ""; $("[data-edq]", box).value = 1; $("[data-edopts]", box).innerHTML = "";
  const sr = $("[data-edsearch]", box); if (sr) { sr.value = ""; sr.dispatchEvent(new Event("input")); sr.focus(); }
  edDrawList();
}
function edDrawList() {
  const box = $(`[data-edit="${S.editing.id}"]`); if (!box) return;
  $("[data-edlist]", box).innerHTML = S.editing.add.length ? `<ul class="edlist">${S.editing.add.map((l, i) => `<li><span><b>+${l.quantity}</b> ${esc(edLineName(l))}</span><span class="tabnum">${money(edLinePrice(l) * l.quantity)} <button class="chip-x" type="button" data-act="edDel" data-i="${i}" aria-label="Quitar">×</button></span></li>`).join("")}</ul>` : "";
  edDrawSum();
}
function edCalc() {
  const o = edOrder(), box = $(`[data-edit="${o.id}"]`);
  const added = S.editing.add.reduce((t, l) => t + edLinePrice(l) * l.quantity, 0);
  const feeIn = $("[data-edfee]", box);
  const fee = feeIn ? Math.round(Number(feeIn.value || 0) * 100) / 100 : Number(o.delivery_fee);
  const total = Math.round((Number(o.subtotal) + added - Number(o.discount || 0) + fee) * 100) / 100;
  return { o, box, added, fee, total, diff: Math.round((total - Number(o.total)) * 100) / 100, paidLike: ["pagado", "en_revision"].includes(o.payment_status) };
}
function edDrawSum() {
  const { o, box, added, fee, total, diff, paidLike } = edCalc();
  const mode = $("input[name=edpay]:checked", box)?.value || "due";
  const pend = Math.round((extraDue(o) + diff) * 100) / 100; // lo que quedaría por cobrar en total
  let pay = "";
  if (diff && paidLike) {
    pay = diff > 0
      ? `<div class="chips" role="radiogroup" style="margin-top:8px"><label class="chip"><input type="radio" name="edpay" value="due" ${mode === "due" ? "checked" : ""}> Queda por cobrar ${money(pend)}</label><label class="chip"><input type="radio" name="edpay" value="paid" ${mode === "paid" ? "checked" : ""}> Ya me pagó la diferencia</label></div>`
      : `<div class="chips" role="radiogroup" style="margin-top:8px"><label class="chip"><input type="radio" name="edpay" value="due" ${mode === "due" ? "checked" : ""}> Queda por devolver ${money(-pend)}</label><label class="chip"><input type="radio" name="edpay" value="paid" ${mode === "paid" ? "checked" : ""}> Ya le devolví</label></div>`;
    if (mode === "paid") pay += `<input class="in" data-edref placeholder="Referencia o banco de la transferencia (opcional)" value="${esc(S.editing.ref || "")}" style="margin-top:6px;width:100%">`;
  }
  const feeTxt = Math.abs(fee - Number(o.delivery_fee)) > 0.001 ? `<div class="line"><span>Envío</span><span class="tabnum"><s class="muted">${money(o.delivery_fee)}</s> ${money(fee)}</span></div>` : "";
  $("[data-edsum]", box).innerHTML = `<div class="msum" style="margin-top:10px">
      ${added ? `<div class="line"><span>Productos agregados</span><span class="tabnum">+${money(added)}</span></div>` : ""}${feeTxt}
      <div class="line"><span>Total antes</span><span class="tabnum">${money(o.total)}</span></div>
      <div class="line total"><span>Nuevo total</span><span class="tabnum">${money(total)}</span></div>
      ${diff ? `<div class="line"><span>${diff > 0 ? "Diferencia a cobrar" : "Diferencia a devolver"}</span><span class="tabnum"><b>${money(Math.abs(diff))}</b></span></div>` : ""}
    </div>
    ${diff && !paidLike ? `<p class="muted small" style="margin:6px 0 0">El pedido aún no está pagado: el cliente pagará el nuevo total de ${money(total)}${o.payment_method === "tarjeta" ? ". Si ya abrió el pago con tarjeta, mándele de nuevo el enlace del pedido" : ""}.</p>` : ""}
    ${pay}`;
  $("[data-edref]", box)?.addEventListener("input", (e) => { S.editing.ref = e.target.value; });
}
async function edSave(btn) {
  const { o, box, fee, diff, paidLike } = edCalc();
  const err = $("[data-ederr]", box); err.textContent = "";
  const feeIn = $("[data-edfee]", box);
  if (feeIn && !(fee >= 0 && fee <= 100 && feeIn.value !== "")) { err.textContent = "Revisa el valor del envío (entre $0 y $100)."; feeIn.focus(); return; }
  const feeChanged = feeIn && Math.abs(fee - Number(o.delivery_fee)) > 0.001;
  if (!S.editing.add.length && !feeChanged) { err.textContent = "No hay cambios: agrega un producto o cambia el envío."; return; }
  const paidNow = paidLike && diff && $("input[name=edpay]:checked", box)?.value === "paid";
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    const r = await api("editar_pedido", {
      order_id: o.id, items: S.editing.add, ...(feeChanged ? { delivery_fee: fee } : {}),
      extra_paid: Boolean(paidNow), extra_ref: paidNow ? ($("[data-edref]", box)?.value.trim() || "") : "",
    });
    S.editing = null;
    toast(r.paid && r.extra_due > 0 ? `${r.code}: nuevo total ${money(r.total)} · falta cobrar ${money(r.extra_due)}` : r.paid && r.extra_due < 0 ? `${r.code}: nuevo total ${money(r.total)} · devolver ${money(-r.extra_due)}` : `${r.code}: nuevo total ${money(r.total)}${r.stamps ? ` · +${r.stamps} sello${r.stamps > 1 ? "s" : ""} para el cliente` : ""}`, 5000);
    await loadOrders(); render();
  } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = "Guardar cambios"; }
}

// ---------- motorizados (solo consulta) ----------
function renderRiders() {
  const active = S.riders.filter((r) => r.active);
  $("#view").innerHTML = `
    <div class="panel">
      <h2 class="display" style="font-size:30px">Motorizados</h2>
      <p class="muted small">${active.length} ${active.length === 1 ? "motorizado activo" : "motorizados activos"}. Para agregar o quitar motorizados, habla con el master.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>WhatsApp</th><th>Placa</th><th>Estado</th></tr></thead><tbody>
      ${S.riders.map((r) => `<tr><td>${esc(r.full_name)}</td><td><a ${waAttrs(r.phone, "")}>${esc(r.phone)}</a></td><td>${esc(r.plate || "")}</td>
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
  tableSearch($("#view .panel"), "Buscar producto…");
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
  if (s.weekly_hours) return w ? (w.break_from ? `Hoy de ${w.open} a ${w.break_from} y de ${w.break_to} a ${w.close}` : `Hoy de ${w.open} a ${w.close}`) : "Hoy es día de descanso";
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
    </div>
    <div class="panel">
      <h2 class="mtitle" style="margin:0 0 4px">WhatsApp en este equipo</h2>
      <p class="muted small" style="margin:0 0 10px">Cómo se abren los botones de WhatsApp de los pedidos. Con la app instalada se abre directo el chat, sin pestaña nueva.</p>
      <div class="chips" role="radiogroup" aria-label="Abrir WhatsApp con">
        <label class="chip"><input type="radio" name="waMode" value="app" ${waMode() === "app" ? "checked" : ""}> App de WhatsApp instalada</label>
        <label class="chip"><input type="radio" name="waMode" value="web" ${waMode() === "web" ? "checked" : ""}> WhatsApp Web (navegador)</label>
      </div>
      <p class="muted small" style="margin:12px 0 6px">Al tocar <b>Pedir Uber</b> en la computadora, dejar elegido:</p>
      <div class="chips" role="radiogroup" aria-label="Tipo de Uber">${Object.entries(UBER_TYPES).map(([k, [, n]]) => `<label class="chip"><input type="radio" name="uberType" value="${k}" ${uberType() === k ? "checked" : ""}> ${n}</label>`).join("")}</div>
      <label class="check" style="margin-top:10px"><input type="checkbox" id="waAuto" ${waAuto() ? "checked" : ""}> Al tocar <b>Confirmar pago</b>, <b>Empezar a preparar</b>, <b>Listo</b>, <b>Salió</b> o <b>Entregado</b>, abrir el chat del cliente con el mensaje ya escrito (solo falta Enviar)</label>
    </div>`;
  $$('input[name="uberType"]').forEach((r) => (r.onchange = () => { try { localStorage.setItem("tbs_uber_type", r.value); } catch {} toast(`Pedir Uber abrirá con: ${UBER_TYPES[r.value][1]}`); }));
  $("#waAuto").onchange = (e) => { setWaAuto(e.target.checked); toast(e.target.checked ? "Se abrirá el chat del cliente en cada paso" : "Ya no se abrirá el chat en cada paso"); };
  $$('input[name="waMode"]').forEach((r) => (r.onchange = () => { setWaMode(r.value); toast(r.value === "app" ? "WhatsApp se abrirá en la app" : "WhatsApp se abrirá en WhatsApp Web"); }));

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

// ---------- comprobante en ventana emergente ----------
// Se cierra con la ×, tocando fuera o con Esc; si el pago está por confirmar, se puede confirmar ahí mismo
function showReceipt(o, url) {
  let d = $("#receiptDlg");
  if (!d) {
    d = document.createElement("dialog"); d.id = "receiptDlg"; d.className = "rcpt";
    d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-rclose]") || e.target.closest("[data-act]")) d.close(); });
    document.body.append(d);
  }
  const pdf = /\.pdf($|\?)/i.test(o.transfer_receipt_path || "");
  d.innerHTML = `<div class="rcpt-box">
    <div class="rcpt-head"><b>Comprobante · ${esc(o.code)}</b><span>${money(o.total)}</span><button type="button" class="rcpt-x" data-rclose aria-label="Cerrar">×</button></div>
    <div class="rcpt-body">${pdf ? `<iframe src="${esc(url)}" title="Comprobante"></iframe>` : `<img src="${esc(url)}" alt="Comprobante de ${esc(o.code)}" data-rimg>`}</div>
    <div class="rcpt-foot">${o.status === "por_confirmar" ? `<button class="btn primary" data-act="confirmPay" data-id="${o.id}">Confirmar pago</button>` : ""}<button type="button" class="btn ghost" data-rclose>Cerrar</button></div>
  </div>`;
  // sin extensión no se sabe si es foto o PDF: si la imagen no carga, se muestra como documento
  const img = d.querySelector("[data-rimg]");
  if (img) img.onerror = () => { img.outerHTML = `<iframe src="${esc(url)}" title="Comprobante"></iframe>`; };
  if (!d.open) d.showModal();
}
