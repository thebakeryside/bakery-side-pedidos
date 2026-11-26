// Página /mama: la mamá registra a quién le vende, qué y para qué día, y marca si ya le pagaron.
// Entra con un enlace secreto (/mama?k=<clave>); la clave se guarda en el celular para las siguientes veces.
// Todo pasa por las funciones seller_* de la base de datos (migración 048), que piden la clave.
import { sb } from "./common.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Number(n || 0).toFixed(2);
const KEY_NAME = "tbs_mama_key";

let key = new URLSearchParams(location.search).get("k");
try {
  if (key) { localStorage.setItem(KEY_NAME, key); history.replaceState(null, "", "/mama"); }
  else key = localStorage.getItem(KEY_NAME);
} catch {}

const S = { name: "", today: "", products: [], orders: [], day: null, form: null };

function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, { p_key: key, ...args });
  if (error) throw new Error(error.message || "No se pudo guardar. Revisa tu internet.");
  return data;
}

// ---------- fechas (AAAA-MM-DD, hora de Guayaquil) ----------
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function dayName(d) {
  if (d === S.today) return "Hoy";
  if (d === addDays(S.today, 1)) return "Mañana";
  if (d === addDays(S.today, -1)) return "Ayer";
  const x = new Date(d + "T12:00:00Z");
  const s = x.toLocaleDateString("es-EC", { weekday: "short", day: "numeric", timeZone: "UTC" }).replace(".", "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const longDay = (d) => { const x = new Date(d + "T12:00:00Z"); return x.toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }); };

// ---------- carga ----------
async function load() {
  const r = await rpc("seller_home", {});
  Object.assign(S, { name: r.name, today: r.today, products: r.products || [], orders: r.orders || [] });
  if (!S.day) {
    const next = S.orders.map((o) => o.day).filter((d) => d >= S.today).sort()[0];
    S.day = next || S.today;
  }
}

async function start() {
  if (!key) {
    $("#app").innerHTML = `<div class="nokey"><p><b>Abre el enlace que te mandaron por WhatsApp.</b></p><p class="muted">Este enlace es solo para ti. Si lo perdiste, pídelo otra vez.</p></div>`;
    return;
  }
  try { await load(); }
  catch (e) {
    $("#app").innerHTML = `<div class="nokey"><p><b>${esc(e.message)}</b></p><p class="muted">Revisa tu internet y vuelve a abrir el enlace.</p></div>`;
    return;
  }
  $("#hola").textContent = `Hola, ${S.name} 👋`;
  $("#nuevo").hidden = false;
  render();
  // se actualiza sola (por si cocina cambió algo) y al volver a la pantalla
  setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
}
async function refresh() { if (S.form) return; try { await load(); render(); } catch {} }

// ---------- lista ----------
const KITCHEN = { preparando: "👩‍🍳 Cocina lo está preparando", listo: "✅ Listo en cocina para retirar", entregado: "📦 Ya lo retiraste", en_camino: "📦 Ya lo retiraste" };

function render() {
  const days = [...new Set([S.today, addDays(S.today, 1), ...S.orders.map((o) => o.day)])].sort();
  const list = S.orders.filter((o) => o.day === S.day);
  const total = list.reduce((s, o) => s + Number(o.total), 0);
  const paid = list.filter((o) => o.paid).reduce((s, o) => s + Number(o.total), 0);
  const prep = {};
  list.forEach((o) => (o.items || []).forEach((i) => (prep[i.name] = (prep[i.name] || 0) + i.quantity)));
  const count = (d) => S.orders.filter((o) => o.day === d).length;

  $("#app").innerHTML = `
    <div class="days">${days.map((d) => `<button class="chip" data-day="${d}" aria-pressed="${d === S.day}">${dayName(d)}${count(d) ? ` <small>(${count(d)})</small>` : ""}</button>`).join("")}</div>
    ${list.length ? `
      <div class="sum"><div><b>${list.length}</b><span>pedidos</span></div><div><b>${money(total)}</b><span>total</span></div><div class="falta"><b>${money(total - paid)}</b><span>te falta cobrar</span></div></div>
      <details class="prep"><summary>Lo que llevas para ${esc(longDay(S.day))}</summary><ul>${Object.entries(prep).map(([n, q]) => `<li><b>${q}</b> ${esc(n)}</li>`).join("")}</ul></details>
      ${list.map(card).join("")}`
    : `<div class="empty">No tienes pedidos para ${esc(dayName(S.day).toLowerCase() === "hoy" ? "hoy" : longDay(S.day))}.<br>Toca <b>＋ Nuevo pedido</b> para anotar uno.</div>`}`;
}

function card(o) {
  const editable = ["confirmado", "pendiente_pago"].includes(o.status);
  return `<article class="card">
    ${KITCHEN[o.status] ? `<div class="kst">${KITCHEN[o.status]}</div>` : ""}
    <div class="row"><span class="name">${esc(o.customer)}</span><span class="tot">${money(o.total)}</span></div>
    <ul>${(o.items || []).map((i) => `<li><b>${i.quantity}×</b> ${esc(i.name)}</li>`).join("")}</ul>
    ${o.note ? `<p class="note">📝 ${esc(o.note)}</p>` : ""}
    <div class="acts">
      <button class="pay ${o.paid ? "si" : "no"}" data-pay="${o.id}">${o.paid ? "✅ Ya me pagó" : "⏳ No me ha pagado"}</button>
      ${editable ? `<button class="icon" data-edit="${o.id}" aria-label="Cambiar pedido">✏️</button>` : ""}
    </div>
  </article>`;
}

// ---------- formulario ----------
function openForm(o) {
  const items = {};
  (o?.items || []).forEach((i) => { if (i.product_id) items[i.product_id] = (items[i.product_id] || 0) + i.quantity; });
  S.form = { id: o?.id || null, customer: o?.customer || "", day: o?.day && o.day >= S.today ? o.day : (S.day >= S.today ? S.day : S.today), paid: !!o?.paid, note: o?.note || "", items, q: "" };
  drawForm();
  $("#sheet").hidden = false; document.body.style.overflow = "hidden";
  if (!o) setTimeout(() => $("#fName")?.focus(), 50);
}
function closeForm() { S.form = null; $("#sheet").hidden = true; $("#sheet").innerHTML = ""; document.body.style.overflow = ""; render(); }

const fold = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function prodList() {
  const f = S.form, q = fold(f.q);
  const shown = S.products.filter((p) => !q || fold(p.name).includes(q) || f.items[p.id]);
  // lo que ya eligió arriba, después por categoría
  const chosen = shown.filter((p) => f.items[p.id]);
  const rest = shown.filter((p) => !f.items[p.id]);
  const cats = {};
  rest.forEach((p) => (cats[p.cat || "Otros"] ||= []).push(p));
  const row = (p) => `<div class="prod${f.items[p.id] ? " on" : ""}"><span class="pn">${esc(p.name)}<small>${money(p.price)}</small></span>
    <span class="step">${f.items[p.id] ? `<button type="button" data-minus="${p.id}" aria-label="Quitar uno">−</button><output>${f.items[p.id]}</output>` : ""}<button type="button" class="plus" data-plus="${p.id}" aria-label="Agregar uno">＋</button></span></div>`;
  return (chosen.length ? `<div class="cat">Lo que pidió</div>${chosen.map(row).join("")}` : "")
    + Object.entries(cats).map(([c, ps]) => `<div class="cat">${esc(c)}</div>${ps.map(row).join("")}`).join("")
    + (!shown.length ? `<p class="muted">No encontramos «${esc(f.q)}».</p>` : "");
}
function formTotal() {
  return Object.entries(S.form.items).reduce((s, [id, q]) => s + q * Number(S.products.find((p) => p.id === Number(id))?.price || 0), 0);
}
function drawForm() {
  const f = S.form;
  const dayOpts = [S.today, addDays(S.today, 1), addDays(S.today, 2)];
  const other = !dayOpts.includes(f.day);
  $("#sheet").innerHTML = `
    <div class="head"><button type="button" data-close>✕ Cerrar</button><b>${f.id ? "Cambiar pedido" : "Nuevo pedido"}</b><span style="width:70px"></span></div>
    <div class="body">
      <label class="lbl" for="fName">¿Quién pidió?</label>
      <input class="in" id="fName" value="${esc(f.customer)}" placeholder="Nombre" autocomplete="off" autocapitalize="words" maxlength="80">

      <span class="lbl">¿Para qué día?</span>
      <div class="wrapchips" id="fDays">
        ${dayOpts.map((d) => `<button type="button" class="chip" data-fday="${d}" aria-pressed="${f.day === d}">${dayName(d)}</button>`).join("")}
        <button type="button" class="chip" data-fday="otro" aria-pressed="${other}">Otro día</button>
      </div>
      <input class="in" type="date" id="fDate" min="${S.today}" value="${f.day}" style="margin-top:8px" ${other ? "" : "hidden"}>

      <span class="lbl">¿Qué pidió?</span>
      <input class="in" id="fQ" type="search" placeholder="Buscar postre…" value="${esc(f.q)}" autocomplete="off">
      <div id="fProds">${prodList()}</div>

      <span class="lbl">¿Ya te pagó?</span>
      <div class="yn"><button type="button" class="si" data-fpaid="1" aria-pressed="${f.paid}">✅ Sí, ya me pagó</button><button type="button" class="no" data-fpaid="0" aria-pressed="${!f.paid}">⏳ Todavía no</button></div>

      <label class="lbl" for="fNote">Nota (opcional)</label>
      <input class="in" id="fNote" value="${esc(f.note)}" placeholder="Ej.: sin nueces, se lo llevo a la oficina" maxlength="200">
      <p class="err" id="fErr" role="alert"></p>
      ${f.id ? `<button type="button" class="del" data-fdel>🗑️ Borrar este pedido</button>` : ""}
    </div>
    <div class="bar"><div class="in2"><span class="t">Total<b id="fTot">${money(formTotal())}</b></span><button type="button" class="save" data-save>Guardar</button></div></div>`;
}
function redrawProds() { $("#fProds").innerHTML = prodList(); $("#fTot").textContent = money(formTotal()); }

async function save(btn) {
  const f = S.form;
  f.customer = $("#fName").value.trim(); f.note = $("#fNote").value.trim();
  const err = (m) => { $("#fErr").textContent = m; $("#fErr").scrollIntoView({ block: "center", behavior: "smooth" }); };
  if (!f.customer) { $("#fName").focus(); return err("Escribe el nombre de quien pidió."); }
  const items = Object.entries(f.items).filter(([, q]) => q > 0).map(([id, q]) => ({ product_id: Number(id), quantity: q }));
  if (!items.length) return err("Toca ＋ en al menos un postre.");
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    await rpc("seller_save", { p_order: f.id, p_customer: f.customer, p_day: f.day, p_items: items, p_paid: f.paid, p_note: f.note || null });
    S.day = f.day;
    toast(f.id ? "Pedido cambiado ✓" : `Pedido de ${f.customer} guardado ✓`);
    closeForm();
    await load(); render();
  } catch (e) { btn.disabled = false; btn.textContent = "Guardar"; err(e.message); }
}

// ---------- toques ----------
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const f = S.form;
  if (t.dataset.day) { S.day = t.dataset.day; render(); return; }
  if (t.id === "nuevo") return openForm(null);
  if (t.dataset.edit) return openForm(S.orders.find((o) => o.id === t.dataset.edit));
  if (t.dataset.pay) {
    const o = S.orders.find((x) => x.id === t.dataset.pay); if (!o) return;
    const now = !o.paid;
    o.paid = now; render(); // se ve al instante
    try { await rpc("seller_paid", { p_order: o.id, p_paid: now }); toast(now ? `${o.customer}: pagado ✓` : `${o.customer}: sin pagar`); }
    catch (ex) { o.paid = !now; render(); toast(ex.message); }
    return;
  }
  if (!f) return;
  if ("close" in t.dataset) return closeForm();
  if (t.dataset.plus) { f.items[t.dataset.plus] = (f.items[t.dataset.plus] || 0) + 1; return redrawProds(); }
  if (t.dataset.minus) { const id = t.dataset.minus; f.items[id] = (f.items[id] || 0) - 1; if (f.items[id] <= 0) delete f.items[id]; return redrawProds(); }
  if (t.dataset.fpaid) { f.paid = t.dataset.fpaid === "1"; document.querySelectorAll("[data-fpaid]").forEach((b) => b.setAttribute("aria-pressed", b === t)); return; }
  if (t.dataset.fday) {
    document.querySelectorAll("[data-fday]").forEach((b) => b.setAttribute("aria-pressed", b === t));
    const di = $("#fDate");
    if (t.dataset.fday === "otro") { di.hidden = false; di.showPicker?.(); }
    else { di.hidden = true; f.day = t.dataset.fday; di.value = f.day; }
    return;
  }
  if ("fdel" in t.dataset) {
    if (t.dataset.sure !== "1") { t.dataset.sure = "1"; t.textContent = "Toca otra vez para borrarlo"; return; }
    t.disabled = true;
    try { await rpc("seller_delete", { p_order: f.id }); toast("Pedido borrado"); closeForm(); await load(); render(); }
    catch (ex) { t.disabled = false; $("#fErr").textContent = ex.message; }
    return;
  }
  if ("save" in t.dataset) return save(t);
});
document.addEventListener("input", (e) => {
  const f = S.form; if (!f) return;
  if (e.target.id === "fQ") { f.q = e.target.value; redrawProds(); }
  if (e.target.id === "fName") f.customer = e.target.value;
  if (e.target.id === "fNote") f.note = e.target.value;
});
document.addEventListener("change", (e) => {
  if (e.target.id === "fDate" && S.form && e.target.value) S.form.day = e.target.value < S.today ? S.today : e.target.value;
});

start();
