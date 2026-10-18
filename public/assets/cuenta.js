import { sb, api, $, money, esc, when, dayLabel, orderRange, toast, STATUS, mountSocial, isTodayLocal } from "./common.js";
import { captureRef, currentUser, loadAccount, setAccount, signOut, stampCard, googleButton, mountGoogle, STAMPS_TOTAL } from "./account.js";
import { createMap } from "./mapa.js";
import { reviewForm } from "./reviews.js";

captureRef();
const root = $("#root");

const TAB_KEY = "tbs_cuenta_tab";
let tab = new URLSearchParams(location.search).get("tab") || (() => { try { return sessionStorage.getItem(TAB_KEY) || "inicio"; } catch { return "inicio"; } })();

async function render() {
  const u = await currentUser();
  if (!u) return renderGuest();
  let acc;
  try { acc = await loadAccount(true); }
  catch (e) { root.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; return; }
  const c = acc.customer;
  const q = (cols) => sb.from("orders").select(`code,status,total,created_at,scheduled_for,eta,delivered_at,tracking_token,payment_status,order_items(${cols})`)
    .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
  let { data: orders, error: oe } = await q("product_id,name,quantity,line_total,options");
  if (oe) ({ data: orders } = await q("product_id,name,quantity,line_total"));
  const paid = (orders ?? []).filter((o) => ["pagado", "en_revision"].includes(o.payment_status) || o.status === "entregado");
  const first = (c.full_name || u.user_metadata?.name || "").split(" ")[0];

  root.innerHTML = `
    <div class="acct-top">
      <div><p class="eyebrow">Mi cuenta</p><h1 class="display">Hola${first ? ", " + esc(first) : ""}</h1></div>
      <button class="btn small ghost" id="out" type="button">Cerrar sesión</button>
    </div>
    <nav class="acct-tabs" role="tablist" aria-label="Secciones de tu cuenta">
      ${[["inicio", "Recompensas"], ["pedidos", "Mis pedidos"], ["datos", "Mis datos"]].map(([k, l]) => `<button role="tab" type="button" data-t="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}
    </nav>
    <section id="pane"></section>`;

  $("#out").onclick = async () => { await signOut(); render(); };
  root.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tab = b.dataset.t; try { sessionStorage.setItem(TAB_KEY, tab); } catch {} render(); }));
  const pane = { inicio: paneInicio, pedidos: panePedidos, datos: paneDatos }[tab] || paneInicio;
  pane(acc, orders ?? []);
}

// Cuenta regresiva al cumpleaños (fecha de Guayaquil)
function birthdayInfo(birthday, available, first) {
  if (!birthday) return null;
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Guayaquil" })); today.setHours(0, 0, 0, 0);
  const [, m, d] = birthday.split("-").map(Number);
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  const days = Math.round((next - today) / 86400000);
  const month = next.toLocaleDateString("es-EC", { month: "long" });
  const dayTxt = `${d} de ${month}`;
  const inMonth = today.getMonth() === m - 1;
  if (days === 0) return { big: "🎉", title: `¡Feliz cumpleaños${first ? ", " + first : ""}!`, text: available ? "Hoy tienes $4 de regalo en tu pedido. ¡Celébralo con algo rico!" : "Que tengas un día muy dulce." };
  if (inMonth && available) return { big: days === 1 ? "1 día" : `${days} días`, title: "¡Tu mes llegó! 🎂", text: `Tu regalo de $4 ya está disponible. Faltan ${days === 1 ? "1 día" : days + " días"} para tu cumpleaños.` };
  if (inMonth && !available) return { big: days === 1 ? "1 día" : `${days} días`, title: "Para tu cumpleaños", text: `El ${dayTxt}. Ya usaste tu regalo de este año.` };
  return { big: days === 1 ? "1 día" : `${days} días`, title: "Para tu cumpleaños", text: `El ${dayTxt}. Ese mes te esperan $4 de regalo.` };
}

function paneInicio(acc, orders = []) {
  const c = acc.customer;
  const first = (c.full_name || "").split(" ")[0];
  const link = `${location.origin}/?ref=${c.referral_code}`;
  const monthName = (m) => new Date(2026, m - 1, 1).toLocaleDateString("es-EC", { month: "long" });
  const n = Math.max(0, Math.min(STAMPS_TOTAL, acc.stamps)), left = STAMPS_TOTAL - n;
  // sellos ganados caen uno a uno; los que faltan se ven desvanecidos (para antojar); el regalo se mueve y brilla
  const S_IMG = `<img src="/assets/brand/s-tinta.svg" alt="">`;
  const dots = Array.from({ length: STAMPS_TOTAL }, (_, i) => i === STAMPS_TOTAL - 1 ? `<span class="g ${n >= STAMPS_TOTAL ? "on" : ""}" aria-hidden="true">🎁</span>`
    : i < n ? `<span class="on" style="--d:${0.3 + i * 0.32}s" aria-hidden="true">${S_IMG}</span>` : `<span class="ghost" aria-hidden="true">${S_IMG}</span>`).join("");
  const giftAt = 0.3 + Math.max(n, 1) * 0.32 + 0.4;
  const nRw = acc.rewards_available || 0;
  const title = nRw && n === 0 ? "Vamos por el siguiente: te faltan 8 sellos" : left === 1 ? "¡Te falta 1 sello para tu postre sorpresa!" : `Te faltan ${left} sellos para tu postre sorpresa`;
  // tarjeta llena: se ve como una cartilla completa, con su postre listo para usar
  const fullDots = Array.from({ length: STAMPS_TOTAL }, (_, i) => i === STAMPS_TOTAL - 1 ? `<span class="g on" aria-hidden="true">🎁</span>` : `<span class="on" aria-hidden="true">${S_IMG}</span>`).join("");
  const fullCard = nRw ? `<div class="rw-full" role="img" aria-label="Tarjeta completa: tienes ${nRw === 1 ? "un postre sorpresa" : `${nRw} postres sorpresa`} listo para usar">
      <span class="rw-full-badge">¡Completa!</span>
      <span class="rw-k">Tarjeta llena${nRw > 1 ? ` · tienes ${nRw}` : ""}</span>
      <b class="rw-full-t">¡Ganaste un postre sorpresa!</b>
      <div class="rw-dots full">${fullDots}</div>
      <p>Se agrega gratis a tu próximo pedido, con cualquier producto. Cocina elige algo especial para ti.</p>
      <em>Listo para usar</em>
    </div>` : "";
  const bd = birthdayInfo(c.birthday, acc.birthday_available, first);
  const bday = bd ? bd.text : "Agrega tu cumpleaños en «Mis datos»";
  $("#pane").innerHTML = `
    <div class="rw">
      ${liveCard(orders)}
      ${fullCard}
      <div class="rw-hero" role="img" aria-label="Tarjeta de sellos: ${n} de ${STAMPS_TOTAL}" style="--gift:${giftAt}s">
        <span class="rw-k">${nRw ? "Tu nueva tarjeta" : "Tu tarjeta de sellos"}</span>
        <b class="rw-t">${title}</b>
        <div class="rw-dots">${dots}</div>
        <div class="rw-bar"><i style="width:${(n / STAMPS_TOTAL) * 100}%"></i></div>
        <small>1 sello por cada $10 · un pedido de $20 te da 2</small>
      </div>
      ${orders.some((o) => o.status === "entregado" && isTodayLocal(o.delivered_at)) ? `<button type="button" class="rate-banner as-btn" id="goRate"><b>🎁 HOY: califica todo tu pedido y gana 1 sello</b><span>Califica lo que ya probaste en «Mis pedidos» ›</span></button>` : ""}
      <div class="rw-tiles">
        <div class="rw-tile ${acc.birthday_available ? "ready" : ""}"><span class="ic" aria-hidden="true">🎂</span>${bd ? `<span class="bd-count">${bd.big === "🎉" ? "🎉" : `<small>Faltan</small>${bd.big}`}</span>` : ""}<b>${bd?.title || "$4 en tu cumpleaños"}</b><span>${bday}</span>${c.birthday ? "" : `<button class="btn small" type="button" id="toDatos">Agregar</button>`}</div>
        <div class="rw-tile"><span class="ic" aria-hidden="true">💌</span><b>Invita a un amigo</b><span>Empieza con 3 sellos y tú ganas 1 cuando pague su primer pedido</span>
          <a class="btn small wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Te regalo 3 sellos en The Bakery Side 🧁 Pide aquí: ${link}`)}">Compartir</a>
          <button class="linkbtn" type="button" id="copyRef">Copiar enlace</button></div>
      </div>
      <section class="rw-sec" id="favBox" hidden></section>
      <section class="rw-sec" id="datesBox"></section>
      <details class="rw-sec rw-hist" id="histBox"><summary>Cómo ganaste tus sellos</summary><div class="hist-list"><p class="muted small">Cargando…</p></div></details>
    </div>`;
  // animación de la tarjeta: se repite mientras está a la vista
  const hero = $("#pane .rw-hero");
  if (hero && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let t; const play = () => { hero.classList.remove("play"); void hero.offsetWidth; hero.classList.add("play"); };
    new IntersectionObserver(([e]) => { clearInterval(t); if (e.isIntersecting && document.body.contains(hero)) { play(); t = setInterval(play, 8000); } }, { threshold: 0.5 }).observe(hero);
  }
  renderFavs(orders); renderDates(); $("#histBox").addEventListener("toggle", renderHist, { once: true });
  $("#copyRef").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Enlace copiado"), () => toast(link));
  $("#goRate")?.addEventListener("click", () => { tab = "pedidos"; try { sessionStorage.setItem(TAB_KEY, tab); } catch {} render(); });
  $("#toDatos")?.addEventListener("click", () => { tab = "datos"; try { sessionStorage.setItem(TAB_KEY, tab); } catch {} render(); });
}

// ---------- pedido en curso (arriba de todo) ----------
const ACTIVE = ["por_confirmar", "confirmado", "preparando", "listo", "en_camino"];
const STEP_OF = { por_confirmar: 0, confirmado: 0, preparando: 1, listo: 2, en_camino: 3 };
function liveCard(orders) {
  const o = orders.find((x) => ACTIVE.includes(x.status) && x.payment_status !== "fallido");
  if (!o) return "";
  const when = o.scheduled_for ? `${dayLabel(o.scheduled_for)} · entre ${orderRange(o)}` : `Hoy · llega entre ${orderRange(o)}`;
  const st = STEP_OF[o.status] ?? 0;
  return `<a class="live" href="/pedido?t=${o.tracking_token}">
    <span class="live-k"><i class="live-dot"></i>Tu pedido ${esc(o.code)}</span>
    <b>${esc(STATUS[o.status])}</b>
    <span class="live-when tabnum">${esc(when)}</span>
    <span class="live-bar" aria-hidden="true">${["Confirmado", "Preparando", "Listo", "En camino"].map((l, i) => `<i class="${i <= st ? "on" : ""}"></i>`).join("")}</span>
    <span class="live-go">Seguir pedido ›</span>
  </a>`;
}

// ---------- tus favoritos: lo que más pides, en un toque ----------
async function renderFavs(orders) {
  const box = $("#favBox"); if (!box) return;
  const count = new Map(); // clave del carrito (producto + opciones) → veces
  for (const o of orders) {
    if (!(["pagado", "en_revision"].includes(o.payment_status) || o.status === "entregado")) continue;
    for (const i of o.order_items) {
      if (!(Number(i.line_total) > 0 && i.product_id)) continue;
      const ids = (i.options || []).map((x) => x.choice_id).filter(Boolean);
      const k = ids.length ? `${i.product_id}:${ids.join(".")}` : String(i.product_id);
      const prev = count.get(k) || { k, id: i.product_id, name: i.name, n: 0 };
      prev.n += i.quantity; count.set(k, prev);
    }
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n);
  if (!top.length) return;
  const { data: prods } = await sb.from("products").select("id,name,price,image_url,active").in("id", [...new Set(top.map((t) => t.id))]);
  const pm = new Map((prods || []).filter((p) => p.active).map((p) => [p.id, p]));
  const seen = new Set();
  const favs = top.filter((t) => pm.has(t.id) && !seen.has(t.id) && seen.add(t.id)).slice(0, 3);
  if (!favs.length) return;
  box.hidden = false;
  box.innerHTML = `<div class="sec-h"><h2 class="display">Tus favoritos</h2><a class="linkbtn" href="/?carrito=1">Ver carrito ›</a></div>
    <div class="favs">${favs.map((f) => { const p = pm.get(f.id); return `<div class="fav">
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : `<span class="fav-ph">🧁</span>`}
      <div class="fav-t"><b>${esc(f.name)}</b><span class="tabnum">${money(p.price)}</span></div>
      <button class="fav-add" type="button" data-fav="${esc(f.k)}" aria-label="Agregar ${esc(f.name)} al carrito">+</button></div>`; }).join("")}</div>`;
  box.querySelectorAll("[data-fav]").forEach((b) => (b.onclick = () => {
    let cart = [];
    try { cart = JSON.parse(localStorage.getItem("tbs_cart") || "[]"); } catch {}
    const m = new Map(cart.map(([k, q]) => [String(k), q]));
    m.set(b.dataset.fav, (m.get(b.dataset.fav) || 0) + 1);
    try { localStorage.setItem("tbs_cart", JSON.stringify([...m])); } catch {}
    b.textContent = "✓"; b.classList.add("ok"); setTimeout(() => { b.textContent = "+"; b.classList.remove("ok"); }, 1400);
    toast("Agregado a tu carrito");
  }));
}

// ---------- fechas especiales: te avisamos 3 días antes ----------
const KINDS = { cumple: ["🎂", "Cumpleaños"], aniversario: ["💛", "Aniversario"], otro: ["📅", "Otra fecha"] };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
async function renderDates() {
  const box = $("#datesBox"); if (!box) return;
  const { data: rows, error } = await sb.from("customer_dates").select("id,label,kind,month,day").order("month").order("day");
  if (error) { box.hidden = true; return; }
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Guayaquil" })); today.setHours(0, 0, 0, 0);
  const daysTo = (r) => { let n = new Date(today.getFullYear(), r.month - 1, r.day); if (n < today) n = new Date(today.getFullYear() + 1, r.month - 1, r.day); return Math.round((n - today) / 86400000); };
  const list = (rows || []).map((r) => ({ ...r, left: daysTo(r) })).sort((a, b) => a.left - b.left);
  box.innerHTML = `<div class="sec-h"><h2 class="display">Fechas especiales</h2><button class="btn small" type="button" id="addDate">+ Agregar</button></div>
    <p class="muted small" style="margin:0 0 10px">Guarda los cumpleaños y aniversarios de quienes quieres. Te avisamos por correo 3 días antes para enviarles un detalle.</p>
    <form class="date-form" id="dateForm" hidden novalidate>
      <div class="df-row"><select class="in" id="dfKind" aria-label="Tipo">${Object.entries(KINDS).map(([k, [i, n]]) => `<option value="${k}">${i} ${n}</option>`).join("")}</select>
        <input class="in" id="dfLabel" maxlength="60" placeholder="¿De quién? Ej.: Mamá" aria-label="De quién o qué fecha"></div>
      <div class="df-row"><select class="in" id="dfDay" aria-label="Día">${Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select>
        <select class="in" id="dfMonth" aria-label="Mes">${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
        <button class="btn primary small" type="submit">Guardar</button></div>
    </form>
    ${list.length ? `<ul class="dates">${list.map((r) => `<li class="confirm-host"><span class="d-ic" aria-hidden="true">${KINDS[r.kind]?.[0] || "📅"}</span>
      <div><b>${esc(r.label)}</b><small>${r.day} de ${MONTHS[r.month - 1]} · ${r.left === 0 ? "¡es hoy!" : r.left === 1 ? "mañana" : `faltan ${r.left} días`}</small></div>
      ${r.left <= 7 ? `<a class="btn small primary" href="/?regalo=1">Enviar regalo</a>` : ""}
      <button class="linkbtn" type="button" data-deldate="${r.id}" aria-label="Quitar ${esc(r.label)}">Quitar</button></li>`).join("")}</ul>`
      : `<p class="dates-empty">🎁 Aún no tienes fechas guardadas.</p>`}`;
  $("#addDate").onclick = () => { const f = $("#dateForm"); f.hidden = !f.hidden; if (!f.hidden) $("#dfLabel").focus(); };
  $("#dateForm").onsubmit = async (e) => {
    e.preventDefault();
    const label = $("#dfLabel").value.trim();
    if (!label) { $("#dfLabel").focus(); return toast("Escribe de quién es la fecha."); }
    const month = Number($("#dfMonth").value), day = Number($("#dfDay").value);
    if (day > new Date(2024, month, 0).getDate()) return toast("Revisa el día: ese mes no tiene tantos días.");
    const u = await currentUser();
    const { error: e2 } = await sb.from("customer_dates").insert({ user_id: u.id, label, kind: $("#dfKind").value, month, day });
    if (e2) return toast(/20 fechas/.test(e2.message) ? "Puedes guardar hasta 20 fechas." : "No se pudo guardar. Intenta de nuevo.");
    toast("Fecha guardada · te avisaremos 3 días antes"); renderDates();
  };
  box.querySelectorAll("[data-deldate]").forEach((b) => (b.onclick = async () => {
    const { error: e3 } = await sb.from("customer_dates").delete().eq("id", Number(b.dataset.deldate));
    if (e3) return toast("No se pudo quitar.");
    renderDates();
  }));
}

// ---------- historial de sellos ----------
const REASON = { bienvenida: "Regalo de bienvenida", referido_nuevo: "Llegaste invitado por un amigo", referido_invita: "Tu amigo hizo su primer pedido", pedido: "Pedido", resena: "Calificaste tu pedido", premio: "Tarjeta llena → postre sorpresa", ajuste: "Ajuste de The Bakery Side" };
async function renderHist() {
  const box = $("#histBox .hist-list"); if (!box) return;
  const { data, error } = await sb.from("stamp_ledger").select("delta,reason,created_at,order_id").order("created_at", { ascending: false }).limit(60);
  if (error) { box.innerHTML = `<p class="muted small">No pudimos cargar tu historial.</p>`; return; }
  const ids = [...new Set((data || []).map((r) => r.order_id).filter(Boolean))];
  const { data: os } = ids.length ? await sb.from("orders").select("id,code").in("id", ids) : { data: [] };
  const code = new Map((os || []).map((o) => [o.id, o.code]));
  box.innerHTML = (data || []).length ? `<ul>${data.map((r) => `<li><span class="h-d ${r.delta > 0 ? "plus" : "minus"}">${r.delta > 0 ? "+" : ""}${r.delta}</span>
    <div><b>${esc(REASON[r.reason] || r.reason)}${r.reason === "pedido" && code.get(r.order_id) ? ` ${esc(code.get(r.order_id))}` : ""}</b><small>${new Date(r.created_at).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Guayaquil" })}</small></div></li>`).join("")}</ul>`
    : `<p class="muted small">Aún no tienes movimientos.</p>`;
}

const STATE_COLOR = { entregado: "ok", cancelado: "bad", pendiente_pago: "warn", por_confirmar: "warn" };
async function panePedidos(_acc, orders) {
  await cfgReady; // número de WhatsApp para «¿Ayuda?»
  const shown = orders.filter((o) => o.status !== "pendiente_pago" || Date.now() - new Date(o.created_at) < 86400000);
  if (!shown.length) {
    $("#pane").innerHTML = `<div class="panel"><p class="muted" style="margin:0">Aún no tienes pedidos. Tu primer pedido de $10 o más ya suma sellos.</p><a class="btn primary" href="/" style="margin-top:12px">Ver el menú</a></div>`;
    return;
  }
  // fotos de los productos para las miniaturas
  const ids = [...new Set(shown.flatMap((o) => o.order_items.map((i) => i.product_id)).filter(Boolean))];
  const { data: prods } = ids.length ? await sb.from("products").select("id,name,image_url").in("id", ids) : { data: [] };
  const img = new Map((prods || []).map((p) => [p.id, p]));
  // mis reseñas (si la tabla aún no existe, no se muestra la opción de calificar)
  const { data: myRevs, error: rvErr } = await sb.from("reviews").select("product_id,status");
  const rev = new Map((myRevs || []).map((r) => [r.product_id, r.status]));
  const { data: stampRows } = await sb.from("orders").select("code,review_stamp_at").not("review_stamp_at", "is", null);
  const stamped = new Set((stampRows || []).map((r) => r.code));
  const canRate = !rvErr;
  const today = (o) => o.status === "entregado" && isTodayLocal(o.delivered_at);
  const toRate = canRate ? [...new Set(shown.filter(today).flatMap((o) => o.order_items.filter((i) => i.product_id && Number(i.line_total) > 0).map((i) => i.product_id)))].filter((id) => !rev.has(id)) : [];
  const initials = (t) => t.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const active = (o) => !["entregado", "cancelado", "pendiente_pago"].includes(o.status);
  $("#pane").innerHTML = `<div class="ol">${toRate.length ? `<div class="rate-banner"><b>🎁 HOY: califica todo tu pedido y gana 1 sello</b><span>Solo hoy: califica cada producto del pedido que recibiste. Cuando publicamos todas sus reseñas, sumas 1 sello.</span></div>` : ""}${shown.map((o) => {
    const items = o.order_items.filter((i) => Number(i.line_total) > 0 || !/regalo/i.test(i.name));
    const nItems = items.reduce((t, i) => t + i.quantity, 0);
    const sub = active(o) ? (o.scheduled_for ? `${dayLabel(o.scheduled_for)} · entre ${orderRange(o)}` : `Hoy · llega entre ${orderRange(o)}`)
      : `${dayLabel(o.delivered_at || o.scheduled_for || o.created_at)} · ${nItems} ${nItems === 1 ? "producto" : "productos"}`;
    return `<article class="oc ${STATE_COLOR[o.status] || "go"}">
      <div class="top"><b>${esc(o.code)}</b><span class="st">${STATUS[o.status]}</span></div>
      <div class="d">${esc(sub)}</div>
      <div class="thumbs">${items.slice(0, 5).map((i) => { const p = img.get(i.product_id); return `<span title="${esc(i.name)}">${p?.image_url ? `<img src="${esc(p.image_url)}" alt="" loading="lazy">` : esc(initials(p?.name || i.name))}<i>${i.quantity}</i></span>`; }).join("")}${items.length > 5 ? `<span class="more">+${items.length - 5}</span>` : ""}</div>
      ${canRate && o.status === "entregado" ? `<div class="rate-row">${[...new Map(items.filter((i) => i.product_id && Number(i.line_total) > 0).map((i) => [i.product_id, i])).values()].map((i) => {
        const st = rev.get(i.product_id), nm = img.get(i.product_id)?.name || i.name;
        return st ? `<span class="rated">${st === "publicada" ? "✓ Calificado" : st === "oculta" ? "Calificado" : "⏳ En revisión"} · ${esc(nm)}</span>`
          : `<button type="button" class="chip-btn" data-rate="${i.product_id}" data-name="${esc(nm)}" data-today="${today(o) ? 1 : ""}">★ Calificar ${esc(nm)}</button>`; }).join("")}</div>${(() => { const ps = [...new Set(items.filter((i) => i.product_id && Number(i.line_total) > 0).map((i) => i.product_id))]; const done = ps.filter((id) => rev.has(id)).length;
        return stamped.has(o.code) ? `<p class="rate-prog ok">✓ Ganaste 1 sello por calificar este pedido</p>` : !today(o) ? "" : `<p class="rate-prog">Calificaste ${done} de ${ps.length} · ${done === ps.length ? "te sumamos el sello al publicar tus reseñas" : "completa todos hoy y gana 1 sello"}</p>`; })()}<div class="rate-box"></div>` : ""}
      <div class="bot"><b class="tabnum">${money(o.total)}</b><span class="acts">
        <a class="btn small ghost help" href="${waHelp(o.code)}" target="_blank" rel="noopener" aria-label="Ayuda con el pedido ${esc(o.code)}">¿Ayuda?</a>
        <a class="btn small ghost" href="/pedido?t=${o.tracking_token}">Ver</a>
        ${active(o) ? `<a class="btn small primary" href="/pedido?t=${o.tracking_token}">Seguir pedido</a>` : `<button class="btn small primary" type="button" data-again="${o.code}">Volver a pedir</button>`}</span></div>
    </article>`; }).join("")}<p class="muted small help-foot">¿Tienes dudas? Revisa las <a href="/#faq">preguntas frecuentes</a> o escríbenos por <a href="${waHelp("")}" target="_blank" rel="noopener">WhatsApp</a>.</p></div>`;
  $("#pane").querySelectorAll("[data-rate]").forEach((b) => (b.onclick = () => {
    reviewForm(b.closest(".oc").querySelector(".rate-box"), Number(b.dataset.rate), b.dataset.name, () => { b.outerHTML = `<span class="rated">⏳ En revisión · ${esc(b.dataset.name)}</span>`; }, Boolean(b.dataset.today));
  }));
  $("#pane").querySelectorAll("[data-again]").forEach((b) => (b.onclick = () => {
    const o = orders.find((x) => x.code === b.dataset.again);
    const cart = new Map();
    for (const i of o.order_items) {
      if (!(Number(i.line_total) > 0 && i.product_id)) continue;
      const ids = (i.options || []).map((x) => x.choice_id).filter(Boolean);
      const k = ids.length ? `${i.product_id}:${ids.join(".")}` : String(i.product_id);
      cart.set(k, (cart.get(k) || 0) + i.quantity);
    }
    try { localStorage.setItem("tbs_cart", JSON.stringify([...cart])); } catch {}
    location.href = "/?carrito=1";
  }));
}

// ---------- Mis datos: datos personales, varias direcciones y varios datos de factura ----------
const LOC_SEP = " · Ubicación del mapa: ";
async function paneDatos(acc) {
  const c = acc.customer;
  const u = await currentUser();
  const [{ data: addrs, error: ae }, { data: invs, error: ie }] = await Promise.all([
    sb.from("customer_addresses").select("*").order("is_default", { ascending: false }).order("created_at"),
    sb.from("customer_invoices").select("*").order("is_default", { ascending: false }).order("created_at"),
  ]);
  const ready = !ae && !ie; // las tablas existen
  $("#pane").innerHTML = `
    <div class="datos">
      <form class="panel" id="dataForm" novalidate>
        <h2 class="display" style="font-size:26px">Tus datos</h2>
        <div class="form-grid2">
          <div><label class="f" for="dName">Nombre</label><input class="in" id="dName" value="${esc(c.full_name || "")}" autocomplete="name"></div>
          <div><label class="f" for="dPhone">WhatsApp</label><input class="in" id="dPhone" type="tel" inputmode="tel" value="${esc(c.phone || "")}" placeholder="0991234567" autocomplete="tel"></div>
        </div>
        <label class="f" for="dBday">Cumpleaños <span class="hint">${c.birthday ? "(ya registrado)" : "(solo se puede guardar una vez)"}</span></label>
        <input class="in" id="dBday" type="date" value="${esc(c.birthday || "")}" ${c.birthday ? "disabled" : ""} max="${new Date().toISOString().slice(0, 10)}" style="max-width:220px">
        <p class="muted small" style="margin:12px 0 0">Correo de tu cuenta: ${esc(c.email || "")}</p>
        <label class="check" style="margin-top:10px"><input type="checkbox" id="dPromo" ${c.marketing_opt_in ? "checked" : ""}> Quiero recibir promociones y novedades por WhatsApp y correo</label>
        <button class="btn primary" style="margin-top:14px">Guardar</button>
      </form>
      ${ready ? `
      <section class="panel">
        <div class="sec-h"><h2 class="display" style="font-size:26px">Mis direcciones</h2><button class="btn small" type="button" id="addAddr">+ Agregar</button></div>
        <div class="saved-list">${(addrs || []).map((a) => savedCard(a.id, "addr", a.label, a.address, a.reference || a.loc_label || "", a.is_default)).join("") || `<p class="muted small" style="margin:0">Guarda tu casa, tu oficina o la de alguien a quien le envías regalos. Al pedir, la eliges con un toque.</p>`}</div>
        <div id="addrForm"></div>
      </section>
      <section class="panel" hidden><!-- facturación desactivada por ahora -->
        <div class="sec-h"><h2 class="display" style="font-size:26px">Datos de factura</h2><button class="btn small" type="button" id="addInv">+ Agregar</button></div>
        <div class="saved-list">${(invs || []).map((x) => savedCard(x.id, "inv", x.name, `${x.id_number.length === 13 ? "RUC" : "Cédula"} ${x.id_number}`, x.email, x.is_default)).join("") || `<p class="muted small" style="margin:0">Guarda a nombre de quién facturamos (tú, tu empresa…). Al pedir con factura, lo eliges con un toque.</p>`}</div>
        <div id="invForm"></div>
      </section>` : ""}
    </div>`;
  $("#dPromo").onchange = async (e) => {
    const { error } = await sb.rpc("set_marketing", { p_opt: e.target.checked });
    if (error) { e.target.checked = !e.target.checked; return toast("No se pudo guardar."); }
    toast(e.target.checked ? "¡Listo! Te avisaremos de las novedades" : "Ya no te enviaremos promociones");
  };
  $("#dataForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = { full_name: $("#dName").value.trim(), phone: $("#dPhone").value.trim() || undefined };
    if (!c.birthday && $("#dBday").value) body.birthday = $("#dBday").value;
    try { setAccount(await api("guardar_perfil", body)); toast("Datos guardados"); render(); }
    catch (ex) { toast(ex.message); }
  };
  if (!ready) return;
  const byId = (list, id) => list.find((x) => String(x.id) === String(id));
  $("#addAddr").onclick = () => addrForm(u, null, addrs.length === 0);
  $("#addInv").onclick = () => invForm(u, null, invs.length === 0);
  $("#pane").querySelectorAll("[data-k]").forEach((b) => (b.onclick = async () => {
    const { k, id, act } = b.dataset, table = k === "addr" ? "customer_addresses" : "customer_invoices", list = k === "addr" ? addrs : invs;
    if (act === "edit") return k === "addr" ? addrForm(u, byId(list, id)) : invForm(u, byId(list, id));
    if (act === "main") {
      await sb.from(table).update({ is_default: false }).eq("user_id", u.id);
      const { error } = await sb.from(table).update({ is_default: true }).eq("id", id);
      if (error) return toast("No se pudo guardar.");
      toast("Listo, quedó como principal"); return render();
    }
    if (act === "delask") { b.closest(".saved").querySelector(".del-row").hidden = false; return; }
    if (act === "del") {
      const { error } = await sb.from(table).delete().eq("id", id);
      if (error) return toast("No se pudo borrar.");
      toast("Borrado"); return render();
    }
  }));
}
function savedCard(id, k, title, line, sub, main) {
  return `<article class="saved ${main ? "main" : ""}">
    <div class="saved-ic" aria-hidden="true">${k === "addr" ? "📍" : "🧾"}</div>
    <div class="saved-tx"><b>${esc(title)}${main ? ` <span class="badge">Principal</span>` : ""}</b><span>${esc(line)}</span>${sub ? `<small>${esc(sub)}</small>` : ""}</div>
    <div class="saved-acts">
      <button class="btn small ghost" type="button" data-k="${k}" data-id="${id}" data-act="edit">Editar</button>
      ${main ? "" : `<button class="btn small ghost" type="button" data-k="${k}" data-id="${id}" data-act="main">Hacer principal</button>`}
      <button class="btn small ghost" type="button" data-k="${k}" data-id="${id}" data-act="delask">Borrar</button>
    </div>
    <div class="del-row confirm-row" hidden><span class="small">¿Borrar ${esc(title)}?</span><button class="btn small" type="button" data-k="${k}" data-id="${id}" data-act="del">Sí, borrar</button></div>
  </article>`;
}
let addrMap = null;
function addrForm(u, a, first = false) {
  const box = $("#addrForm");
  box.innerHTML = `<form class="subform" id="aForm" novalidate>
    <h3>${a ? "Editar dirección" : "Nueva dirección"}</h3>
    <label class="f" for="aLabel">Nombre <span class="hint">(Casa, Oficina, Mamá…)</span></label>
    <div class="label-chips">${["Casa", "Oficina", "Mamá", "Pareja"].map((l) => `<button type="button" class="chip-btn" data-l="${l}">${l}</button>`).join("")}</div>
    <input class="in" id="aLabel" maxlength="30" value="${esc(a?.label || "")}" placeholder="Casa">
    <label class="f">Ubicación en el mapa</label>
    <div class="map-tools"><div class="search" id="aSearch"></div></div>
    <div class="map-wrap"><div id="aMap" class="map" role="application" aria-label="Mapa para marcar la dirección"></div><div class="pin" aria-hidden="true"><span></span></div><div class="map-hint" aria-hidden="true">Mueve el mapa hasta la puerta</div></div>
    <p class="muted small" id="aLoc" style="margin:6px 0 0">${esc(a?.loc_label || "Mueve el mapa o busca la zona.")}</p>
    <label class="f" for="aAddr">Dirección <span class="hint">(ciudadela, manzana y villa, o calle y número)</span></label>
    <input class="in" id="aAddr" maxlength="200" value="${esc(a?.address || "")}">
    <label class="f" for="aRef">Referencia</label>
    <input class="in" id="aRef" maxlength="200" value="${esc(a?.reference || "")}" placeholder="Casa blanca, timbre 2">
    ${a ? "" : `<label class="check"><input type="checkbox" id="aMain" ${first ? "checked" : ""}> Usarla como principal</label>`}
    <p class="err" id="aErr" role="alert"></p>
    <div class="acts"><button class="btn primary">Guardar dirección</button><button class="btn ghost" type="button" id="aCancel">Cancelar</button></div>
  </form>`;
  let pos = a ? { lat: a.lat, lng: a.lng } : null, locLabel = a?.loc_label || null;
  box.querySelectorAll("[data-l]").forEach((b) => (b.onclick = () => { $("#aLabel").value = b.dataset.l; }));
  createMap($("#aMap"), { start: pos, center: { lat: -2.17, lng: -79.9 }, searchSlot: $("#aSearch"), onPick: (lat, lng, addr) => { pos = { lat, lng }; locLabel = addr || null; $("#aLoc").textContent = addr || "Ubicación marcada en el mapa"; } })
    .then((m) => { addrMap = m; if (pos) m.setView(pos.lat, pos.lng, 18); });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#aCancel").onclick = () => { box.innerHTML = ""; };
  $("#aForm").onsubmit = async (e) => {
    e.preventDefault();
    const err = (m) => ($("#aErr").textContent = m);
    const row = { label: $("#aLabel").value.trim(), address: $("#aAddr").value.trim(), reference: $("#aRef").value.trim() || null, loc_label: locLabel };
    if (!row.label) return err("Ponle un nombre, por ejemplo Casa.");
    if (!pos) return err("Marca la ubicación en el mapa.");
    if (!row.address) return err("Escribe la dirección.");
    Object.assign(row, pos);
    let error;
    if (a) ({ error } = await sb.from("customer_addresses").update(row).eq("id", a.id));
    else {
      if ($("#aMain")?.checked) await sb.from("customer_addresses").update({ is_default: false }).eq("user_id", u.id);
      ({ error } = await sb.from("customer_addresses").insert({ ...row, user_id: u.id, is_default: Boolean($("#aMain")?.checked) }));
    }
    if (error) return err("No se pudo guardar. Intenta de nuevo.");
    toast("Dirección guardada"); render();
  };
}
function invForm(u, x, first = false) {
  const box = $("#invForm");
  box.innerHTML = `<form class="subform" id="iForm" novalidate>
    <h3>${x ? "Editar datos de factura" : "Nuevos datos de factura"}</h3>
    <div class="form-grid2">
      <div><label class="f" for="iId">Cédula o RUC</label><input class="in" id="iId" inputmode="numeric" maxlength="13" value="${esc(x?.id_number || "")}"></div>
      <div><label class="f" for="iName">Nombre o razón social</label><input class="in" id="iName" maxlength="120" value="${esc(x?.name || "")}"></div>
    </div>
    <label class="f" for="iMail">Correo para la factura</label>
    <input class="in" id="iMail" type="email" maxlength="120" value="${esc(x?.email || "")}">
    ${x ? "" : `<label class="check"><input type="checkbox" id="iMain" ${first ? "checked" : ""}> Usarlos como principales</label>`}
    <p class="err" id="iErr" role="alert"></p>
    <div class="acts"><button class="btn primary">Guardar</button><button class="btn ghost" type="button" id="iCancel">Cancelar</button></div>
  </form>`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
  $("#iCancel").onclick = () => { box.innerHTML = ""; };
  $("#iForm").onsubmit = async (e) => {
    e.preventDefault();
    const err = (m) => ($("#iErr").textContent = m);
    const row = { id_number: $("#iId").value.replace(/\D/g, ""), name: $("#iName").value.trim(), email: $("#iMail").value.trim() };
    if (!/^\d{10}(\d{3})?$/.test(row.id_number)) return err("La cédula debe tener 10 dígitos o el RUC 13.");
    if (!row.name) return err("Escribe el nombre o la razón social.");
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(row.email)) return err("Revisa el correo.");
    let error;
    if (x) ({ error } = await sb.from("customer_invoices").update(row).eq("id", x.id));
    else {
      if ($("#iMain")?.checked) await sb.from("customer_invoices").update({ is_default: false }).eq("user_id", u.id);
      ({ error } = await sb.from("customer_invoices").insert({ ...row, user_id: u.id, is_default: Boolean($("#iMain")?.checked) }));
    }
    if (error) return err("No se pudo guardar. Intenta de nuevo.");
    toast("Datos de factura guardados"); render();
  };
}

// Sin sesión: invita a crear la cuenta (mismo lenguaje visual que la portada y el checkout)
const IC = {
  google: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>`,
  bag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/></svg>`,
  gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M3 7h18v3H3zM12 7v13M12 7c-1.5-3-5-3-4.5-.5S12 7 12 7zm0 0c1.5-3 5-3 4.5-.5S12 7 12 7z"/></svg>`,
};
function renderGuest() {
  root.innerHTML = `
    <div class="acct-grid guest-hero">
      <div class="gh-txt">
        <p class="eyebrow">Recompensas The Bakery Side</p>
        <h1 class="display">Gana un postre sorpresa</h1>
        <p class="lead">Entra con Google y te regalamos los <b>2 primeros sellos</b>.</p>
      </div>
      <div class="gh-card">${stampCard(2)}</div>
      <div class="gh-go">${googleButton()}<small>Gratis · en un toque · sin contraseñas</small></div>
    </div>
    <section class="g-steps" aria-label="Cómo funciona">
      <ol>
        <li><span class="st-ic"><i>1</i>${IC.google}</span><b>Entra</b><small>2 sellos de regalo</small></li>
        <li><span class="st-ic"><i>2</i>${IC.bag}</span><b>Pide</b><small>1 sello por cada $10</small></li>
        <li><span class="st-ic"><i>3</i>${IC.gift}</span><b>Disfruta</b><small>tu postre sorpresa</small></li>
      </ol>
    </section>
    <ul class="g-perks">
      <li><span aria-hidden="true">🎂</span><div><b>$4 de regalo</b><small>en tu mes de cumpleaños</small></div></li>
      <li><span aria-hidden="true">🤝</span><div><b>Invita a un amigo</b><small>y ambos ganan 1 sello</small></div></li>
    </ul>
    <p class="muted small g-guest">¿Prefieres no crear cuenta? Puedes <a href="/">pedir como invitado</a>, pero no acumularás sellos.</p>`;
  const note = root.querySelector(".stampnote");
  if (note) note.innerHTML = "Así empieza tu tarjeta: <b>2 sellos de regalo</b> al entrar.";
  mountGoogle(root, () => render(), (e) => toast(e.message));
  // los 2 sellos caen uno a uno y el regalo brilla; se repite mientras la tarjeta está a la vista
  const card = root.querySelector(".gh-card .stampcard");
  if (card && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let t; const play = () => { card.classList.remove("play"); void card.offsetWidth; card.classList.add("play"); };
    new IntersectionObserver(([e]) => { clearInterval(t); if (e.isIntersecting) { play(); t = setInterval(play, 7000); } }, { threshold: 0.5 }).observe(card);
  }
}

let started = false;
sb.auth.onAuthStateChange((ev) => {
  if (ev === "INITIAL_SESSION" || (ev === "SIGNED_IN" && started)) { started = true; render(); }
});

mountSocial();
let WA = "";
const cfgReady = api("config").then((c) => { WA = c.whatsapp || ""; mountSocial(c.whatsapp); }).catch(() => {});
const waHelp = (code) => { const d = String(WA).replace(/\D/g, "").replace(/^0/, "593"); return d ? `https://wa.me/${d}?text=${encodeURIComponent(code ? `Hola The Bakery Side, necesito ayuda con mi pedido ${code}` : "Hola The Bakery Side, tengo una consulta")}` : "/#faq"; };
