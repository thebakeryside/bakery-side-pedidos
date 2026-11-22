// Pedido por WhatsApp: cocina o master lo registran con lo mínimo y le mandan al cliente el enlace de pago
import { sb, api, $, $$, money, esc, hhmm, when, toast, waLink, waAttrs, normPhoneEC, fold, localToISO, todayLocal, parseBank } from "./common.js";
import { createMap } from "./mapa.js";

const SITE = "https://thebakeryside.com";
const QUICK = [
  ["/hola · Saludo y menú", "¡Hola! 🧁 Gracias por escribir a The Bakery Side. Este es nuestro menú: " + SITE + "\n\nCuéntame qué te gustaría y te tomo el pedido por aquí mismo."],
  ["/datos · Pedir datos", "¡Perfecto! Para tu pedido necesito:\n1️⃣ Tu nombre\n2️⃣ Tu ubicación (📎 → Ubicación → Enviar mi ubicación actual)\n3️⃣ Dirección y una referencia (ej.: Urdesa, Calle 5 #214, casa blanca)\n4️⃣ ¿Lo quieres ahora o para qué día y hora?\n5️⃣ ¿Es un regalo? Dime quién lo recibe y el mensaje para la tarjeta 💌"],
  ["/recibido · Pago recibido", "¡Recibimos tu pago, gracias! 🙌 Ya estamos con tu pedido."],
];

let st = null;

// ---------- borradores de cotización (se guardan en este equipo) ----------
const DKEY = "tbs_borradores_whatsapp";
const loadDrafts = () => { try { return JSON.parse(localStorage.getItem(DKEY) || "[]"); } catch { return []; } };
const saveDrafts = (list) => { try { localStorage.setItem(DKEY, JSON.stringify(list.slice(0, 30))); return true; } catch { return false; } };
const radio = (name) => $(`input[name="${name}"]:checked`)?.value;
function collectDraft() {
  return {
    id: st.draftId || crypto.randomUUID?.() || String(Date.now()), at: Date.now(),
    name: $("#mName").value, phone: $("#mPhone").value, email: $("#mEmail").value,
    cart: [...st.cart], loc: st.loc, locLabel: st.locLabel, paste: $("#mPaste").value,
    addr: $("#mAddr").value, ref: $("#mRef").value, fee: $("#mFee").value,
    mode: radio("mMode"), when: radio("mWhen"), date: $("#mDate").value, time: $("#mTime").value,
    gift: $("#mGift").checked, rname: $("#mRName").value, rphone: $("#mRPhone").value, from: $("#mFrom").value, msg: $("#mMsg").value,
    pay: radio("mPay"), dep: $("#mDep").value, depManual: Boolean(st.depManual),
    total: subtotal() + (feeNow() || 0),
  };
}
function storeDraft() {
  const d = collectDraft();
  if (!d.name.trim() && !d.phone.trim() && !d.cart.length) { toast("No hay nada que guardar todavía."); return null; }
  const list = loadDrafts().filter((x) => x.id !== d.id);
  if (!saveDrafts([d, ...list])) { toast("No se pudo guardar el borrador en este equipo."); return null; }
  st.draftId = d.id;
  return d;
}
const dropDraft = (id) => saveDrafts(loadDrafts().filter((x) => x.id !== id));
function drawDrafts() {
  const box = $("#mDrafts"); if (!box) return;
  const list = loadDrafts().filter((d) => d.id !== st.draftId);
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "ahora" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
  box.innerHTML = list.length ? `<div class="panel mdrafts"><b>Borradores (${list.length})</b> <span class="muted small">— cotizaciones esperando respuesta del cliente</span>
    <div class="mdraft-list">${list.map((d) => `<div class="mdraft"><button type="button" class="btn small" data-dopen="${esc(d.id)}">${esc(d.name.trim() || d.phone || "Sin nombre")} · ${money(d.total || 0)}</button><span class="muted small">${d.cart.reduce((t, [, q]) => t + q, 0)} prod. · ${ago(d.at)}</span><button type="button" class="chip-x" data-ddel="${esc(d.id)}" aria-label="Borrar borrador">×</button></div>`).join("")}</div></div>` : "";
  box.onclick = (e) => {
    const o = e.target.closest("[data-dopen]"), x = e.target.closest("[data-ddel]");
    if (x) { dropDraft(x.dataset.ddel); drawDrafts(); toast("Borrador eliminado"); return; }
    if (!o) return;
    const d = loadDrafts().find((y) => y.id === o.dataset.dopen); if (!d) return drawDrafts();
    // lo que se estaba armando no se pierde: se guarda como borrador antes de abrir el otro
    if (st.cart.size || $("#mName").value.trim() || $("#mPhone").value.trim()) storeDraft();
    renderManual(st.view, d);
  };
}
function applyDraft(d) {
  st.draftId = d.id;
  const set = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  set("#mName", d.name); set("#mPhone", d.phone); set("#mEmail", d.email); set("#mPaste", d.paste);
  set("#mAddr", d.addr); set("#mRef", d.ref); set("#mFee", d.fee);
  set("#mRName", d.rname); set("#mRPhone", d.rphone); set("#mFrom", d.from); set("#mMsg", d.msg);
  st.cart = new Map((d.cart || []).filter(([k]) => st.prods.some((p) => p.id === Number(String(k).split(":")[0]))));
  const pick = (name, v) => { const r = v && $(`input[name="${name}"][value="${v}"]`); if (r && !r.disabled) { r.checked = true; r.dispatchEvent(new Event("change")); } };
  pick("mMode", d.mode); pick("mWhen", d.when);
  if (d.date && [...$("#mDate").options].some((o) => o.value === d.date)) { $("#mDate").value = d.date; fillTimes(); if (d.time) $("#mTime").value = d.time; }
  $("#mGift").checked = Boolean(d.gift); $("#mGiftBox").hidden = !d.gift;
  pick("mPay", d.pay); if (d.dep) { $("#mDep").value = d.dep; st.depManual = d.depManual; }
  if (d.loc) { st.loc = d.loc; st.locLabel = d.locLabel || ""; }
  drawProds(); quote();
}

// ---------- clientes anteriores (de los pedidos web y WhatsApp; los de PedidosYa no se guardan) ----------
const MAP_SEP = " · Ubicación del mapa: ";
const shortDay = (iso) => new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" }).replace(/\./g, "");
async function loadCustomers() {
  const rows = [];
  for (let from = 0; from < 6000; from += 1000) { // de 1000 en 1000 (límite de Supabase)
    const { data, error } = await sb.from("orders")
      .select("customer_name,customer_phone,customer_email,address,reference,lat,lng,fulfillment,status,created_at")
      .neq("status", "cancelado").order("created_at", { ascending: false }).range(from, from + 999);
    if (error) { console.warn("clientes", error.message); break; }
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const by = new Map();
  for (const o of rows) { // vienen del más nuevo al más viejo: lo primero que se ve es lo último que usó
    const phone = normPhoneEC(o.customer_phone || ""); if (phone.replace(/\D/g, "").length < 10) continue;
    let c = by.get(phone);
    if (!c) by.set(phone, (c = { phone, name: (o.customer_name || "").trim(), names: new Set(), email: null, loc: null, count: 0, last: o.created_at }));
    c.count++;
    if (o.customer_name) c.names.add(o.customer_name.trim());
    if (!c.email && o.customer_email) c.email = o.customer_email.trim();
    if (!c.loc && o.fulfillment !== "pickup" && o.lat != null && o.lng != null) {
      const [addr, label] = String(o.address || "").split(MAP_SEP);
      c.loc = { lat: Number(o.lat), lng: Number(o.lng), addr: (addr || "").trim(), label: (label || "").trim(), ref: o.reference || "", at: o.created_at };
    }
  }
  for (const c of by.values()) c.hay = fold([...c.names].join(" "));
  return [...by.values()];
}
function findCustomers(list, q, kind) {
  if (kind === "phone") {
    let d = q.replace(/\D/g, ""); if (d.startsWith("593")) d = "0" + d.slice(3);
    if (d.length < 4) return [];
    return list.filter((c) => c.phone.replace(/\D/g, "").includes(d)).slice(0, 6);
  }
  const words = fold(q.trim()).split(/\s+/).filter(Boolean);
  if (!words.length || q.trim().length < 2) return [];
  return list.filter((c) => words.every((w) => c.hay.includes(w)))
    .sort((a, b) => (Number(fold(b.name).startsWith(words[0])) - Number(fold(a.name).startsWith(words[0]))) || (b.count - a.count) || (b.last > a.last ? 1 : -1))
    .slice(0, 6);
}
function custAc(input, ul, kind) {
  let hits = [], sel = -1;
  const close = () => { ul.hidden = true; ul.innerHTML = ""; hits = []; sel = -1; input.setAttribute("aria-expanded", "false"); };
  const draw = () => {
    ul.innerHTML = hits.map((c, i) => `<li role="option" data-i="${i}" aria-selected="${i === sel}"><b>${esc(c.name)}</b><span>${esc(c.phone)} · ${c.count} pedido${c.count > 1 ? "s" : ""} · último ${esc(shortDay(c.last))}${c.loc?.addr ? ` · ${esc(c.loc.addr.slice(0, 50))}` : ""}</span></li>`).join("");
    ul.hidden = !hits.length; input.setAttribute("aria-expanded", String(Boolean(hits.length)));
  };
  input.addEventListener("input", async () => {
    const q = input.value, list = await st.custP;
    if (input.value !== q) return; // ya escribió otra cosa
    if (st.cust && kind === "name" && fold(q) !== fold(st.cust.name)) clearCustomer(false);
    hits = findCustomers(list, q, kind); sel = -1; draw();
  });
  input.addEventListener("keydown", (e) => {
    if (ul.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length; draw(); }
    else if (e.key === "Enter" && sel >= 0) { e.preventDefault(); const c = hits[sel]; close(); useCustomer(c); }
    else if (e.key === "Escape") close();
  });
  ul.addEventListener("mousedown", (e) => e.preventDefault()); // que no se cierre antes del clic
  ul.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (!li) return; const c = hits[+li.dataset.i]; close(); useCustomer(c); });
  input.addEventListener("blur", () => setTimeout(close, 150));
}
function useCustomer(c) {
  st.cust = c;
  $("#mName").value = c.name; $("#mPhone").value = c.phone;
  if (c.email) $("#mEmail").value = c.email;
  const l = c.loc;
  if (l) {
    $("#mAddr").value = l.addr.slice(0, 130); $("#mRef").value = l.ref; $("#mPaste").value = "";
    st.map?.setView(l.lat, l.lng, 18);
    st.loc = { lat: l.lat, lng: l.lng }; st.locLabel = l.label; st.locEditing = false; quote();
  }
  const note = $("#mCustNote");
  note.innerHTML = `✓ <b>Cliente anterior</b> · ${c.count} pedido${c.count > 1 ? "s" : ""}, el último el ${esc(shortDay(c.last))}.${l ? ` Se cargó su última ubicación (${esc(shortDay(l.at))}). Confírmela con el cliente; si ahora es otra, cámbiela en Entrega.` : " No tiene una ubicación guardada (solo retiró en la cocina)."} <button type="button" class="btn small ghost" id="mCustClear">Quitar</button>`;
  note.hidden = false;
  $("#mCustClear").onclick = () => clearCustomer(true);
  $("#mForm").dispatchEvent(new Event("input")); // actualiza el borrador si hay uno abierto
  toast(l ? "Cliente cargado con su última ubicación" : "Cliente cargado");
  drawSteps();
  if (!st.cart.size) setTimeout(() => goStep(2), 250); // siguiente: buscar los productos
}
function clearCustomer(wipe) {
  const c = st.cust; st.cust = null;
  $("#mCustNote").hidden = true;
  if (!wipe || !c) return;
  $("#mName").value = ""; $("#mPhone").value = "";
  if ($("#mEmail").value === c.email) $("#mEmail").value = "";
  if (c.loc && $("#mAddr").value === c.loc.addr.slice(0, 130)) { $("#mAddr").value = ""; $("#mRef").value = ""; st.loc = null; st.locLabel = ""; st.quote = null; st.locEditing = false; $("#mQuote").textContent = "Marca la ubicación para calcular el envío."; drawSum(); }
  $("#mName").focus();
}

// ---------- pasos arriba (saltar sin scrollear) y tarjeta de ubicación ----------
const stepOk = {
  1: () => Boolean($("#mName")?.value.trim()) && $("#mPhone").value.replace(/\D/g, "").length >= 10,
  2: () => st.cart.size > 0,
  3: () => {
    if (isDone()) return isPickup() || Boolean(st.loc && $("#mAddr").value.trim());
    const later = $('input[name="mWhen"][value="later"]')?.checked;
    if (later && !$("#mTime").value) return false;
    return isPickup() || Boolean(st.loc && st.quote && $("#mAddr").value.trim());
  },
};
function drawSteps() {
  const nav = $("#mSteps"); if (!nav) return;
  const units = [...st.cart.values()].reduce((a, q) => a + q, 0);
  const first = ($("#mName").value.trim().split(/\s+/)[0] || "").slice(0, 14);
  // nombre del paso + dato corto debajo (en el celular no entra en una sola línea)
  const label = {
    1: ["Cliente", stepOk[1]() ? first : ""],
    2: ["Productos", units ? `${units} u.` : ""],
    3: ["Entrega", isPickup() ? "Pick up" : st.quote ? money(feeNow() ?? st.quote.delivery_fee) : ""],
    4: ["Pago", st.cart.size ? money(subtotal() + (feeNow() || 0)) : ""],
  };
  for (const b of nav.querySelectorAll("[data-step]")) {
    const n = +b.dataset.step, ok = n < 4 ? stepOk[n]() : stepOk[1]() && stepOk[2]() && stepOk[3]();
    b.classList.toggle("done", ok);
    b.querySelector("i").textContent = ok ? "✓" : n;
    const [t, v] = label[n];
    b.querySelector("span").innerHTML = `${esc(t)}${v ? `<small>${esc(v)}</small>` : ""}`;
  }
}
function goStep(n) {
  const sec = $(`#mStep${n}`); if (!sec) return;
  sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  // el primer campo vacío del paso, para seguir escribiendo
  const target = n === 1 ? (!$("#mName").value.trim() ? $("#mName") : $("#mPhone").value.replace(/\D/g, "").length < 10 ? $("#mPhone") : null)
    : n === 2 ? $("#mSearch") : n === 3 && !isPickup() ? (!st.loc ? $("#mPaste") : !$("#mAddr").value.trim() ? $("#mAddr") : null) : null;
  if (target) setTimeout(() => target.focus({ preventScroll: true }), 350);
}
// alturas de la barra de arriba y de los pasos (cambian en el celular) y paso que se está viendo
let stepsWired = false;
function watchSteps() {
  const setVars = () => {
    const top = document.querySelector(".topbar")?.offsetHeight || 0, nav = $("#mSteps");
    document.documentElement.style.setProperty("--mtop", `${top}px`);
    if (nav) document.documentElement.style.setProperty("--msh", `${nav.offsetHeight}px`);
  };
  setVars(); setTimeout(setVars, 300);
  if (stepsWired) return;
  stepsWired = true;
  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const nav = $("#mSteps"); if (!nav) return;
      const line = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mtop")) || 0) + nav.offsetHeight + 40;
      const wide = matchMedia("(min-width: 980px)").matches;
      let cur = 1;
      for (let n = 1; n <= (wide ? 3 : 4); n++) { const s = $(`#mStep${n}`); if (s && s.getBoundingClientRect().top <= line) cur = n; }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = wide ? 3 : 4; // llegó al final
      nav.querySelectorAll("[data-step]").forEach((b) => b.classList.toggle("on", +b.dataset.step === cur));
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", () => { setVars(); onScroll(); });
  st.onScroll = onScroll;
}
// Con la ubicación ya puesta, el mapa se cambia por una tarjeta corta con "Cambiar"
function drawLoc() {
  const card = $("#mLocCard"), edit = $("#mLocEdit"); if (!card) return;
  const show = Boolean(st.loc) && !st.locEditing;
  card.hidden = !show; edit.hidden = show;
  $("#mQuote").hidden = show && Boolean(st.quote); // con la tarjeta, el envío ya se ve ahí
  $("#mLocDone").hidden = !st.loc;
  if (!show) return;
  const where = st.locLabel || $("#mAddr").value.trim() || "Punto marcado en el mapa";
  const q = st.quote, fee = feeNow();
  const ship = q ? `<span class="mloc-fee">Envío <b>${fee === 0 || freeShip() ? "gratis" : money(fee ?? q.delivery_fee)}</b> · ${q.distance_km.toFixed(1)} km</span>` : `<span class="mloc-fee muted">Calculando envío…</span>`;
  const isCust = st.cust?.loc && st.cust.loc.lat === st.loc.lat && st.cust.loc.lng === st.loc.lng;
  const sub = [isCust ? `Última ubicación del cliente (${shortDay(st.cust.loc.at)})` : "", q?.eta_if_now && !isDone() ? `Si sale ahora llega ${hhmm(q.eta_if_now)}` : ""].filter(Boolean).map(esc).join(" · ");
  card.innerHTML = `<span class="mloc-pin" aria-hidden="true">📍</span><div>${ship}<b>${esc(where)}</b>${sub ? `<span class="muted small">${sub}</span>` : ""}</div><button type="button" class="btn small" data-locedit>Cambiar</button>`;
}
function openLocEdit() {
  st.locEditing = true; drawLoc();
  st.map?.resize?.();
  if (st.loc) st.map?.setView(st.loc.lat, st.loc.lng, 18);
  $("#mPaste").focus({ preventScroll: true });
  $("#mLocEdit").scrollIntoView({ block: "nearest" });
}
function closeLocEdit() { st.locEditing = false; drawLoc(); drawSteps(); }

export async function renderManual(view, draft = null) {
  st = { cart: new Map(), loc: null, locLabel: "", quote: null, cfg: null, prods: [], cats: [], map: null, filter: "", view, draftId: null };
  view.innerHTML = `<p class="muted">Cargando…</p>`;
  const [cfg, cats, prods, opts, sets] = await Promise.all([
    api("config"),
    sb.from("categories").select("id,name,sort").eq("active", true).order("sort"),
    sb.from("products").select("*").eq("active", true).order("sort"),
    sb.from("product_option_groups").select("product_id, only_if, option_groups(id,name,required,sort,pick_total,option_choices(id,name,price_delta,sort,active))")
      .then((r) => r.error ? sb.from("product_option_groups").select("product_id, only_if, option_groups(id,name,required,sort,option_choices(id,name,price_delta,sort,active))") : r)
      .then((r) => r.error ? sb.from("product_option_groups").select("product_id, option_groups(id,name,required,sort,option_choices(id,name,price_delta,sort,active))") : r),
    sb.from("settings").select("bank_info").single(),
  ]);
  st.bank = parseBank(sets?.data?.bank_info);
  st.cfg = cfg; st.cats = cats.data || []; st.prods = prods.data || [];
  // opciones (endulzante, etc.): cada opción se muestra como su propia fila
  st.opts = {};
  for (const r of opts.error ? [] : opts.data || []) {
    const g = r.option_groups; if (!g) continue;
    g.option_choices = (g.option_choices || []).filter((c) => c.active).sort((a, b) => a.sort - b.sort);
    if (!g.option_choices.length) continue;
    if (Number(g.pick_total) > 0) (g.option_choices || []).forEach((c) => (c._pick = true));
    (st.opts[r.product_id] ||= []).push({ ...g, only_if: r.only_if?.length ? r.only_if.map(Number) : null });
  }
  // los grupos condicionales (ej.: endulzante según la bebida del combo) van después
  for (const gs of Object.values(st.opts)) gs.sort((a, b) => (a.only_if ? 1 : 0) - (b.only_if ? 1 : 0) || (a.sort || 0) - (b.sort || 0));

  view.innerHTML = `
    <details class="panel quick">
      <summary><b>Mensajes rápidos para WhatsApp</b> <span class="muted small">— cópialos y pégalos en el chat</span></summary>
      <div class="quick-list">${QUICK.map(([t, m], i) => `<div class="quick-item"><b>${esc(t)}</b><p>${esc(m).replace(/\n/g, "<br>")}</p><button class="btn small" type="button" data-copy="${i}">Copiar</button></div>`).join("")}</div>
      <p class="muted small" style="margin:10px 0 0">Guárdalos en WhatsApp Business como respuestas rápidas con estos atajos; la lista completa está en la guía de WhatsApp Business.</p>
    </details>

    <div id="mDrafts"></div>
    <nav class="msteps" id="mSteps" aria-label="Pasos del pedido">
      <button type="button" data-step="1"><i>1</i><span>Cliente</span></button>
      <button type="button" data-step="2"><i>2</i><span>Productos</span></button>
      <button type="button" data-step="3"><i>3</i><span>Entrega</span></button>
      <button type="button" data-step="4"><i>4</i><span>Pago</span></button>
    </nav>
    <form class="manual" id="mForm" novalidate>
      <div class="mmain">
      <section class="panel mstep" id="mStep1">
        <h2 class="mtitle"><span>1</span> Cliente</h2>
        <div class="form-grid">
          <div><label class="f" for="mName">Nombre <span class="hint">(si ya compró, elíjalo de la lista)</span></label><div class="ac"><input class="in" id="mName" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="mNameAc"><ul class="ac-list" id="mNameAc" role="listbox" hidden></ul></div></div>
          <div><label class="f" for="mPhone">WhatsApp</label><div class="ac"><input class="in" id="mPhone" type="tel" inputmode="tel" placeholder="0991234567" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="mPhoneAc"><ul class="ac-list" id="mPhoneAc" role="listbox" hidden></ul></div></div>
          <div><label class="f" for="mEmail">Correo <span class="hint">(opcional, para avisarle cada paso)</span></label><input class="in" id="mEmail" type="email" inputmode="email" autocomplete="off"></div>
        </div>
        <p class="muted small" id="mCustNote" hidden style="margin:8px 0 0"></p>
      </section>

      <section class="panel mstep" id="mStep2">
        <h2 class="mtitle"><span>2</span> Productos</h2>
        <input class="in" id="mSearch" type="search" placeholder="Buscar producto" style="margin:8px 0 10px">
        <div id="mProds" class="mprods"></div>
      </section>

      <section class="panel mstep" id="mStep3">
        <h2 class="mtitle"><span>3</span> Entrega</h2>
        <div class="chips" role="radiogroup" aria-label="Tipo de entrega" style="margin-bottom:10px">
          <label class="chip"><input type="radio" name="mMode" value="delivery" checked> Delivery a domicilio</label>
          <label class="chip"><input type="radio" name="mMode" value="pickup"> Retira en la cocina (pick up)</label>
        </div>
        <p class="muted small" id="mPickNote" hidden style="margin:0 0 8px">El cliente pasa a retirar: sin envío ni ubicación. Cuando esté listo, márcalo como entregado al retirarlo.</p>
        <div id="mDeliv">
        <div class="mloc" id="mLocCard" hidden></div>
        <div id="mLocEdit">
        <label class="f" for="mPaste">Ubicación que te mandó <span class="hint">(pega el enlace de Google Maps o la ubicación de WhatsApp)</span></label>
        <div class="row-btns"><input class="in" id="mPaste" placeholder="https://maps.app.goo.gl/… o -2.17, -79.90" style="flex:1;min-width:200px"><button class="btn" type="button" id="mFind">Ubicar</button></div>
        <p class="muted small" style="margin:8px 0">O busca la zona y mueve el mapa hasta el punto exacto.</p>
        <div class="search" id="mSearchSlot"></div>
        <div class="map-wrap" style="margin-top:8px"><div id="mMap" class="map"></div><div class="pin" aria-hidden="true"><span></span></div></div>
        <button type="button" class="btn small" id="mLocDone" hidden style="margin-top:8px">✓ Listo, usar esta ubicación</button>
        </div>
        <div id="mQuote" class="muted small" style="margin-top:8px">Marca la ubicación para calcular el envío.</div>
        <details class="mdep mfee" id="mFeeBox" style="margin-top:8px">
          <summary class="muted small">Cobrar otro valor de envío</summary>
          <label class="f" for="mFee">Envío a cobrar <span class="hint">(vacío = el calculado)</span></label>
          <div class="mdep-row"><span class="mdep-cur">$</span><input class="in" id="mFee" type="number" inputmode="decimal" min="0" max="100" step="0.25" placeholder="Calculado"><button type="button" class="btn small" id="mFeeReset" hidden>Usar el calculado</button></div>
          <p class="muted small" id="mFeeNote" hidden style="margin:6px 0 0"></p>
        </details>
        <div class="form-grid">
          <div><label class="f" for="mAddr">Dirección</label><input class="in" id="mAddr" placeholder="Ciudadela, manzana y villa o calle y número"></div>
          <div><label class="f" for="mRef">Referencia <span class="hint">(opcional)</span></label><input class="in" id="mRef"></div>
        </div>
        </div>
        <div class="chips" style="margin-top:12px" role="radiogroup" aria-label="Cuándo">
          <label class="chip"><input type="radio" name="mWhen" value="now" ${cfg.open_now ? "checked" : "disabled"}> Lo antes posible</label>
          <label class="chip"><input type="radio" name="mWhen" value="later" ${cfg.open_now ? "" : "checked"}> Agendar</label>
          <label class="chip"><input type="radio" name="mWhen" value="done"> Ya se entregó / venta de otro día (solo registrar)</label>
        </div>
        <div id="mPast" hidden style="margin-top:10px;padding:12px;border-radius:12px;background:var(--surface-2)">
          <div class="form-grid">
            <div><label class="f" for="mPastDate">¿Qué día fue la venta?</label><input class="in" type="date" id="mPastDate" value="${todayLocal()}" min="${todayLocal(-60)}" max="${todayLocal()}"></div>
            <div><label class="f" for="mPastTime">¿A qué hora, más o menos?</label><input class="in" type="time" id="mPastTime" value="${new Date(Date.now() - 5 * 3600000).toISOString().slice(11, 16)}"></div>
          </div>
          <p class="muted small" style="margin:6px 0 0">Se guarda como pagada y entregada en ese día, y aparece en Ventas en esa fecha. Usa los precios actuales del menú (el envío lo puede cambiar abajo). Si es de otro día, no descuenta el stock de hoy.</p>
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
      </div>

      <aside class="mside">
      <section class="panel mstep" id="mStep4">
        <h2 class="mtitle"><span>4</span> Pago</h2>
        <div class="chips" role="radiogroup" aria-label="Pago">
          <label class="chip"><input type="radio" name="mPay" value="link" checked> Mandarle el enlace de pago</label>
          <label class="chip"><input type="radio" name="mPay" value="paid"> Ya pagó (transferencia, PeiGo o DeUna)</label>
          <label class="chip"><input type="radio" name="mPay" value="deposit"> Evento · pagó el anticipo</label>
        </div>
        <div id="mDepBox" hidden class="mdep">
          <label class="f" for="mDep">Anticipo recibido <span class="hint">(75% sugerido · el saldo se cobra el día del evento, antes de entregar)</span></label>
          <div class="mdep-row"><span class="mdep-cur">$</span><input class="in" id="mDep" type="number" inputmode="decimal" min="0.01" step="0.01"><button type="button" class="btn small" id="mDep75">Usar 75%</button></div>
          <p class="muted small" id="mDepNote" style="margin:6px 0 0"></p>
        </div>
        <div id="mSum" class="msum"></div>
        <div id="mCopyBox" class="mcopy" hidden></div>
        <button class="btn primary big" id="mGo" style="margin-top:12px">Registrar pedido</button>
        <button class="btn" type="button" data-draft style="margin-top:8px">Guardar borrador y empezar otra</button>
        <p class="err" id="mErr" role="alert"></p>
      </section>
      </aside>
    </form>
    <div class="mbar" id="mBar" hidden><span class="tabnum" id="mBarTot"></span><button class="btn small" type="button" id="mBarCopy" hidden title="Copiar el resumen para WhatsApp">Copiar</button><button class="btn small" type="button" data-draft>Guardar</button><button class="btn small primary" type="button" id="mBarGo">Registrar</button></div>
    <div id="mDone"></div>`;
  $("#mBarGo").onclick = () => $("#mGo").click();
  $("#mBarCopy").onclick = () => copy(summaryText());
  $("#mSteps").onclick = (e) => { const b = e.target.closest("[data-step]"); if (b) goStep(+b.dataset.step); };
  $("#mLocCard").onclick = (e) => { if (e.target.closest("[data-locedit]")) openLocEdit(); };
  $("#mLocDone").onclick = () => closeLocEdit();
  watchSteps();
  $$("[data-draft]", view).forEach((b) => (b.onclick = () => {
    const d = storeDraft(); if (!d) return;
    toast(`Borrador guardado: ${d.name.trim() || d.phone || "sin nombre"}. Puede empezar otra cotización.`, 4000);
    renderManual(view);
  }));

  $$("[data-copy]", view).forEach((b) => (b.onclick = () => copy(QUICK[+b.dataset.copy][1])));
  // +593 99 123 4567 → 0991234567 apenas se pega o se escribe
  const fixPhone = () => { const el = $("#mPhone"), v = el.value; if (/\+/.test(v) || v.replace(/\D/g, "").length >= 12) { const n = normPhoneEC(v); if (n !== v) el.value = n; } };
  $("#mPhone").addEventListener("input", fixPhone);
  $("#mPhone").addEventListener("blur", () => { $("#mPhone").value = normPhoneEC($("#mPhone").value); });
  // clientes anteriores: sugerencias al escribir el nombre o el número
  st.custP = loadCustomers();
  custAc($("#mName"), $("#mNameAc"), "name");
  custAc($("#mPhone"), $("#mPhoneAc"), "phone");
  // buscador: sin tildes, todas las palabras, también por categoría, descripción y opciones; Enter agrega si hay un solo producto
  $("#mSearch").oninput = () => { st.filter = fold($("#mSearch").value.trim()); drawProds(); };
  $("#mSearch").onkeydown = (e) => {
    if (e.key === "Escape") { $("#mSearch").value = ""; st.filter = ""; drawProds(); return; }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const all = st.prods.filter(matches), named = all.filter(nameHit), solo = named.filter((p) => !isCombo(p));
    const hits = solo.length ? solo : named.length ? named : all; // Enter agrega el producto que se llama así, no el combo
    if (hits.length === 1 && !(st.opts[hits[0].id] || []).length) {
      const k = String(hits[0].id); st.cart.set(k, (st.cart.get(k) || 0) + 1);
      $("#mSearch").value = ""; st.filter = ""; drawProds(); quote(); toast(`+1 ${hits[0].name}`);
    } else if (hits.length) $("#mProds").querySelector("button, select")?.focus();
  };
  // armar un combo: muestra el endulzante solo si la bebida elegida lo lleva
  const buildLive = (box) => {
    if (box.classList.contains("mpick")) { // reparte N unidades entre los sabores
      const n = Number(box.dataset.n), ins = [...box.querySelectorAll("[data-pc]")];
      const sum = ins.reduce((a, i) => a + Math.max(0, Math.floor(Number(i.value) || 0)), 0);
      box.querySelector("[data-pleft]").textContent = sum === n ? "✓ Completo" : sum < n ? `Faltan ${n - sum}` : `Sobran ${sum - n}`;
      box.querySelector("[data-build]").disabled = sum !== n;
      return ins.flatMap((i) => Array(Math.max(0, Math.floor(Number(i.value) || 0))).fill(Number(i.dataset.pc)));
    }
    const gs = st.opts[box.dataset.pid] || [];
    const val = (g) => Number(box.querySelector(`[data-g="${g.id}"]`).value || 0);
    const base = gs.filter((g) => !g.only_if).map(val).filter(Boolean);
    const on = gs.filter((g) => !g.only_if || g.only_if.some((c) => base.includes(c)));
    gs.forEach((g) => { const sel = box.querySelector(`[data-g="${g.id}"]`); sel.hidden = !on.includes(g); if (sel.hidden) sel.value = ""; });
    box.querySelector("[data-build]").disabled = on.some((g) => g.required && !val(g));
    return on.map(val).filter(Boolean);
  };
  $("#mProds").onchange = $("#mProds").oninput = (e) => { const box = e.target.closest(".mbuild"); if (box) buildLive(box); };
  $("#mProds").onclick = (e) => {
    const nb = e.target.closest("[data-build]");
    if (nb) {
      const bx = nb.closest(".mbuild"), ids = buildLive(bx); if (nb.disabled) return;
      if (bx.classList.contains("mpick")) bx.querySelectorAll("[data-pc]").forEach((i) => (i.value = 0));
      const k = `${nb.dataset.build}:${ids.join(".")}`;
      st.cart.set(k, Math.min((st.cart.get(k) || 0) + 1, 50)); drawProds(); quote(); return;
    }
    const b = e.target.closest("[data-q]"); if (!b) return;
    const k = b.dataset.id, q = (st.cart.get(k) || 0) + Number(b.dataset.q);
    if (q <= 0) st.cart.delete(k); else st.cart.set(k, Math.min(q, 50));
    drawProds(); quote();
  };
  $$('input[name="mWhen"]').forEach((r) => (r.onchange = () => {
    $("#mSched").hidden = !$('input[name="mWhen"][value="later"]').checked;
    $("#mPast").hidden = !isDone();
    if (isDone()) { $('input[name="mPay"][value="paid"]').checked = true; $("#mDepBox").hidden = true; }
    drawSum();
  }));
  $("#mGift").onchange = () => ($("#mGiftBox").hidden = !$("#mGift").checked);
  $$('input[name="mMode"]').forEach((r) => (r.onchange = () => { const p = isPickup(); $("#mDeliv").hidden = p; $("#mPickNote").hidden = !p; if (!p) quote(); drawSum(); }));
  $$('input[name="mPay"]').forEach((r) => (r.onchange = () => {
    const dep = isDeposit(); $("#mDepBox").hidden = !dep;
    if (dep && !$("#mDep").value) setDep75();
    drawSum();
  }));
  $("#mDep").oninput = () => { st.depManual = true; drawSum(); };
  $("#mFee").oninput = () => drawSum();
  $("#mFeeReset").onclick = () => { $("#mFee").value = ""; drawSum(); };
  $("#mDep75").onclick = () => { st.depManual = false; setDep75(); drawSum(); };
  $("#mDate").onchange = fillTimes; $("#mTime").onchange = drawSum;
  $("#mPastDate").onchange = drawSum;
  $("#mFind").onclick = findPasted;
  $("#mPaste").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); findPasted(); } });
  $("#mForm").onsubmit = submit;
  // nombre, dirección, regalo…: también actualizan el borrador abierto
  $("#mForm").addEventListener("input", () => drawSteps());
  $("#mForm").addEventListener("input", () => { if (st.draftId) { clearTimeout(st.autoT); st.autoT = setTimeout(() => st.draftId && storeDraft(), 800); } });
  $("#mCopyBox").onclick = (e) => {
    const b = e.target.closest("[data-cp]"); if (!b) return;
    const k = b.dataset.cp;
    copy(k === "res" ? summaryText() : k === "banks" ? banksText() : st.bank.accounts[+k].number);
  };
  fillDates(); drawProds(); drawDrafts();
  if (draft) applyDraft(draft);

  const k = cfg.kitchen?.lat ? { lat: cfg.kitchen.lat, lng: cfg.kitchen.lng } : null;
  st.map = await createMap($("#mMap"), {
    start: draft?.loc || null, center: k, searchSlot: $("#mSearchSlot"),
    onPick: (lat, lng, addr) => {
      if (!st.locEditing && !$("#mLocEdit").hidden) st.locEditing = true; // moviendo el mapa: no esconderlo hasta que toque "Listo"
      st.loc = { lat, lng }; st.locLabel = addr || ""; quote();
    },
  });
  if (st.loc) closeLocEdit(); // borrador con ubicación: se ve la tarjeta
  drawSteps();
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast("Copiado. Pégalo en WhatsApp."), () => toast("No se pudo copiar. Selecciónalo a mano."));
}

// Agotado hoy (lo marcó cocina o se acabaron las porciones del día)
const todayStr = () => todayLocal();
const localDayOf = (iso) => new Date(new Date(iso).getTime() - 5 * 3600000).toISOString().slice(0, 10);
const isOutToday = (p) => p && (p.sold_out_day === todayStr() || (p.stock_day === todayStr() && p.stock_left !== null && p.stock_left <= 0));
const outTag = (p) => (isOutToday(p) ? ` <span class="err small">· agotado hoy</span>` : "");
// ¿El producto coincide con lo buscado? Todas las palabras deben aparecer en el nombre, la categoría, la descripción o sus opciones
function matches(p) {
  const words = (st.filter || "").split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const cat = st.cats.find((c) => c.id === p.category_id)?.name || "";
  const opts = (st.opts[p.id] || []).flatMap((g) => g.option_choices.map((c) => c.name)).join(" ");
  const hay = fold(`${p.name} ${cat} ${p.description || ""} ${opts}`);
  return words.every((w) => hay.includes(w));
}
// ¿Lo buscado está en el NOMBRE del producto? Esos van primero (ej.: "brownie mint" muestra la lata antes que el combo que la incluye)
function nameHit(p) {
  const words = (st.filter || "").split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const n = fold(p.name);
  return words.every((w) => n.includes(w));
}
const isComboCat = (c) => Boolean(c) && fold(c.name).startsWith("combo");
const isCombo = (p) => isComboCat(st.cats.find((c) => c.id === p.category_id));
function drawProds() {
  const f = st.filter;
  // al buscar: primero las categorías con un producto que se llama así, y dentro de cada una, esos productos primero
  const rank = (p) => (nameHit(p) ? 0 : 1);
  // la categoría Combos siempre va al final al buscar (si busca "brownie mint" quiere la lata, no el combo)
  const cats = f ? st.cats.map((c, i) => ({ c, i, combo: isComboCat(c), hit: st.prods.some((p) => p.category_id === c.id && nameHit(p)) }))
    .sort((a, b) => (a.combo - b.combo) || (b.hit - a.hit) || (a.i - b.i)).map((x) => x.c) : st.cats;
  const html = cats.map((c) => {
    const items = st.prods.filter((p) => p.category_id === c.id && matches(p));
    if (f) items.sort((a, b) => rank(a) - rank(b));
    if (!items.length) return "";
    const row = (k, label, price) => {
      const q = st.cart.get(k) || 0;
      const p = st.prods.find((x) => x.id === kId(k));
      return `<div class="mprod ${q ? "on" : ""}"><span>${esc(label)} <span class="muted small">${money(price)}</span>${label.startsWith("↳") ? "" : outTag(p)}</span>
        <span class="qty"><button type="button" data-q="-1" data-id="${k}" aria-label="Quitar uno">−</button><b>${q}</b><button type="button" data-q="1" data-id="${k}" aria-label="Agregar uno">+</button></span></div>`;
    };
    return `<h3 class="mcat">${esc(c.name)}</h3>${items.map((p) => {
      const gs = st.opts[p.id] || [], g = gs[0];
      if (!g) return row(String(p.id), p.name, p.price);
      // por cantidad (ej.: 12 chocobombs): se escribe cuántas de cada sabor y deben sumar el total
      if (Number(g.pick_total) > 0) {
        const n = Number(g.pick_total), added = [...st.cart.keys()].filter((k) => kId(k) === p.id);
        return `<div class="mopt"><b>${esc(p.name)}</b>${outTag(p)} <span class="muted small">· reparte ${n} entre los sabores y toca Agregar</span></div>` +
          added.map((k) => row(k, `↳ ${optLabel(kOpts(k), choice).join(" · ")}`, lPrice(k))).join("") +
          `<div class="mbuild mpick" data-pid="${p.id}" data-n="${n}">${g.option_choices.map((c) => `<label class="small" style="display:inline-flex;align-items:center;gap:6px">${esc(String(c.name).split(" · ")[0])}<input class="in" type="number" inputmode="numeric" min="0" max="${n}" value="0" data-pc="${c.id}" style="width:64px"></label>`).join("")}<span class="muted small" data-pleft>Faltan ${n}</span><button type="button" class="btn small primary" data-build="${p.id}" disabled>Agregar</button></div>`;
      }
      // varias elecciones (combo: postre, bebida y endulzante si la bebida lo lleva): se arma con listas
      if (gs.length > 1 || g.only_if) {
        const added = [...st.cart.keys()].filter((k) => kId(k) === p.id);
        return `<div class="mopt"><b>${esc(p.name)}</b>${outTag(p)} <span class="muted small">· elige ${gs.filter((x) => !x.only_if).map((x) => x.name.toLowerCase()).join(" y ")} y toca Agregar</span></div>` +
          added.map((k) => row(k, `↳ ${kOpts(k).map((c) => choice(c)?.name).filter(Boolean).join(" · ")}`, lPrice(k))).join("") +
          `<div class="mbuild" data-pid="${p.id}">${gs.map((x) => `<select class="in" data-g="${x.id}"${x.only_if ? " hidden" : ""} aria-label="${esc(x.name)}"><option value="">${esc(x.name)}…</option>${x.option_choices.map((c) => `<option value="${c.id}">${esc(c.name)}${Number(c.price_delta) > 0 ? ` +${money(c.price_delta)}` : ""}</option>`).join("")}</select>`).join("")}<button type="button" class="btn small primary" data-build="${p.id}" disabled>Agregar</button></div>`;
      }
      return `<div class="mopt"><b>${esc(p.name)}</b>${outTag(p)} <span class="muted small">· ${esc(g.name.toLowerCase())}</span></div>` +
        g.option_choices.map((ch) => row(`${p.id}:${ch.id}`, `↳ ${ch.name}`, Number(p.price) + Number(ch.price_delta || 0))).join("");
    }).join("")}`;
  }).join("");
  $("#mProds").innerHTML = html || `<p class="muted small">No hay productos con ese nombre.</p>`;
  drawSum();
}

// Pedido que ya se entregó y solo se registra: queda pagado y entregado, sin revisar horarios
const isDone = () => Boolean($('input[name="mWhen"][value="done"]')?.checked);
const pastDay = () => $("#mPastDate")?.value || "";
const dayShort = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "");
const isDeposit = () => Boolean($('input[name="mPay"][value="deposit"]')?.checked);
const totalNow = () => subtotal() + (feeNow() || 0);
const setDep75 = () => { const t = totalNow(); $("#mDep").value = t ? (Math.round(t * 75) / 100).toFixed(2) : ""; };
const depNow = () => Math.round(Number($("#mDep")?.value || 0) * 100) / 100;
const isPickup = () => Boolean($('input[name="mMode"][value="pickup"]')?.checked);
// Envío gratis desde el monto de Ajustes (hasta los km cubiertos; más lejos, solo la diferencia). Igual que en el servidor.
// Envío escrito a mano por cocina (null = el calculado)
const feeOverride = () => { const v = $("#mFee")?.value.trim(); if (!v || isPickup()) return null; const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) && n >= 0 ? n : null; };
const freeShip = () => { const m = Number(st.cfg?.free_ship?.min || 0); return !isPickup() && feeOverride() == null && st.quote && m > 0 && subtotal() >= m - 1e-9; };
const autoFee = () => (st.quote ? (freeShip() ? Number(st.quote.promo_fee ?? 0) : st.quote.delivery_fee) : undefined);
const feeNow = () => (isPickup() ? 0 : feeOverride() != null ? (st.quote ? feeOverride() : undefined) : autoFee());
const kId = (k) => Number(String(k).split(":")[0]);
const kOpts = (k) => (String(k).split(":")[1] || "").split(".").filter(Boolean).map(Number);
const choice = (cid) => { for (const gs of Object.values(st.opts)) for (const g of gs) { const c = g.option_choices.find((x) => x.id === cid); if (c) return c; } return null; };
// cuenta las unidades de cada opción ("5 Classic Christmas, 4 Oreo Road") cuando el grupo es por cantidad (pick_total)
const optLabel = (ids, find) => { const m = new Map(); ids.forEach((c) => m.set(c, (m.get(c) || 0) + 1)); return [...m].map(([c, q]) => { const ch = find(c); if (!ch) return null; const nm = String(ch.name).split(" · ")[0]; return q > 1 || ch._pick ? `${q} ${nm}` : nm; }).filter(Boolean); };
const lName = (k) => { const n = optLabel(kOpts(k), choice); return st.prods.find((p) => p.id === kId(k)).name + (n.length ? ` (${n.join(", ")})` : ""); };
const lPrice = (k) => Number(st.prods.find((p) => p.id === kId(k))?.price || 0) + kOpts(k).reduce((s, c) => s + Number(choice(c)?.price_delta || 0), 0);
const subtotal = () => [...st.cart].reduce((s, [k, q]) => s + lPrice(k) * q, 0);
const items = () => [...st.cart].map(([k, quantity]) => ({ product_id: kId(k), quantity, options: kOpts(k) }));

function drawSum() {
  const lines = [...st.cart].map(([k, q]) => `<div class="line"><span>${q} × ${esc(lName(k))}</span><span class="tabnum">${money(lPrice(k) * q)}</span></div>`);
  const fee = feeNow();
  const ov = feeOverride();
  if ($("#mFeeBox") && ov != null) $("#mFeeBox").open = true;
  if ($("#mFeeReset")) {
    $("#mFeeReset").hidden = ov == null;
    $("#mFeeNote").hidden = ov == null || !st.quote;
    if (ov != null && st.quote) $("#mFeeNote").innerHTML = `Se cobrará <b>${money(ov)}</b> de envío en vez de ${money(autoFee())}. El motorizado sigue ganando ${money(st.quote.delivery_fee)}.`;
  }
  $("#mSum").innerHTML = lines.length
    ? `${lines.join("")}<div class="line"><span>${isPickup() ? "Retira en la cocina" : ov != null ? "Envío (editado)" : freeShip() ? `Envío gratis (desde ${money(st.cfg.free_ship.min)})` : "Envío"}</span><span class="tabnum">${fee != null ? (freeShip() ? `<s class="muted">${money(st.quote.delivery_fee)}</s> ${money(fee)}` : money(fee)) : "—"}</span></div><div class="line total"><span>Total</span><span class="tabnum">${money(subtotal() + (fee || 0))}</span></div>`
    : `<p class="muted small" style="margin:10px 0 0">Agrega productos.</p>`;
  const paid = $('input[name="mPay"][value="paid"]')?.checked;
  const t = subtotal() + (fee || 0);
  if (isDeposit()) {
    if (!st.depManual) setDep75(); // sigue al 75% del total hasta que cocina escriba otro valor
    const d = depNow();
    $("#mDepNote").innerHTML = t ? `${t <= 50 ? `<span class="err">Ojo: los eventos son pedidos de más de $50. </span>` : ""}Saldo por cobrar el día del evento: <b>${money(Math.max(t - d, 0))}</b>` : "";
  }
  drawCopy();
  // un borrador abierto se va actualizando solo mientras se edita
  if (st.draftId && !st.saving) { clearTimeout(st.autoT); st.autoT = setTimeout(() => { if (st.draftId && $("#mForm") && !$("#mForm").hidden) storeDraft(); }, 800); }
  if ($("#mBarCopy")) $("#mBarCopy").hidden = !(st.cart.size && fee != null);
  if ($("#mBar")) { $("#mBar").hidden = !lines.length; $("#mBarTot").innerHTML = `<em>Total</em> <b>${money(t)}</b>${isDeposit() ? `<em> · anticipo ${money(depNow())}</em>` : ""}`; }
  drawSteps(); drawLoc();
  $("#mGo").textContent = lines.length && fee != null ? (isDone() ? (pastDay() && pastDay() !== todayStr() ? `Registrar venta del ${dayShort(pastDay())} · ${money(t)}` : `Registrar como entregado · ${money(t)}`) : isDeposit() ? `Registrar evento · anticipo ${money(depNow())}` : paid ? `Registrar pedido pagado · ${money(t)}` : `Registrar y crear enlace · ${money(t)}`) : "Registrar pedido";
}

// Textos para mandarle al cliente por WhatsApp (siempre de "usted")
const payAmount = () => (isDeposit() ? depNow() : subtotal() + (feeNow() || 0));
function summaryText() {
  const fee = feeNow();
  const lines = [...st.cart].map(([k, q]) => `${q} × ${lName(k)} · ${money(lPrice(k) * q)}`).join("\n");
  const ship = isPickup() ? "Retira en nuestra cocina" : freeShip() || (feeOverride() === 0) ? "Envío: ¡gratis! 🎁" : `Envío: ${money(fee || 0)}`;
  const dep = isDeposit() ? `\nAnticipo para reservar: ${money(depNow())}\nSaldo el día del evento: ${money(Math.max(subtotal() + (fee || 0) - depNow(), 0))}` : "";
  return `Este es el detalle de su pedido en The Bakery Side 🧁\n\n${lines}\n\nSubtotal: ${money(subtotal())}\n${ship}\nTotal: ${money(subtotal() + (fee || 0))}${dep}`;
}
function banksText() {
  const b = st.bank;
  const bank = (n) => (/^banco/i.test(n) ? n : `Banco ${n}`);
  const accs = b.accounts.map((a) => `${bank(a.bank)}\nCuenta de ${String(a.type || "ahorros").toLowerCase()} (${a.number})`).join("\n.\n");
  return `Transferencia Directa\n👤 ${b.holder}${b.email ? `\n📩 ${b.email}` : ""}\n.\n${accs}`;
}
function drawCopy() {
  const box = $("#mCopyBox"); if (!box) return;
  const ready = st.cart.size && feeNow() != null;
  box.hidden = !ready; if (!ready) return;
  const hasBank = st.bank && st.bank.accounts.length;
  box.innerHTML = `
    <p class="mcopy-t">Para mandarle al cliente <span class="muted small">— copie y pegue en WhatsApp</span></p>
    <div class="row-btns">
      <button class="btn small" type="button" data-cp="res">Copiar resumen</button>
      ${hasBank ? `<button class="btn small" type="button" data-cp="banks">Copiar cuentas</button>` : ""}
    </div>
    ${hasBank ? `<details class="mcopy-more"><summary class="muted small">Copiar solo un número de cuenta</summary>
      <div class="mcopy-nums">${st.bank.accounts.map((a, i) => `<button class="btn small ghost" type="button" data-cp="${i}">${esc(a.bank.replace(/^banco\s+(del?\s+)?/i, ""))} · ${esc(a.number)}</button>`).join("")}</div>
    </details>` : `<p class="muted small">No hay cuentas guardadas. Agréguelas en Master → Ajustes → Transferencia directa.</p>`}`;
  const more = box.querySelector(".mcopy-more");
  if (more) { more.open = Boolean(st.copyOpen); more.ontoggle = () => { st.copyOpen = more.open; }; }
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
    st.loc = { lat, lng }; st.locLabel = ""; quote(); closeLocEdit();
    toast("Ubicación encontrada. Si no es el punto exacto, toque Cambiar.");
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
    if (h.break_from && h.break_to && t > h.break_from && t < h.break_to) continue; // pausa del día
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
  const bad = (m, el) => { err.textContent = m; toast(m, 3500); if (el) { if (el.closest("[hidden]")) el = null; } if (el) { el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); } else err.scrollIntoView({ block: "center" }); };
  if (!$("#mName").value.trim()) return bad("Escribe el nombre del cliente.", $("#mName"));
  if ($("#mPhone").value.replace(/\D/g, "").length < 10) return bad("Escribe el WhatsApp de 10 dígitos.", $("#mPhone"));
  if ($("#mEmail").value.trim() && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test($("#mEmail").value.trim())) return bad("Revisa el correo o déjalo vacío.", $("#mEmail"));
  if (!st.cart.size) return bad("Agrega al menos un producto.", $("#mSearch"));
  const pickup = isPickup();
  if (!pickup && !st.loc) { openLocEdit(); return bad("Marca la ubicación de entrega.", $("#mPaste")); }
  if (!pickup && !st.quote) return bad("Aún no tenemos el costo de envío para esa ubicación.");
  if (!pickup && $("#mFee").value.trim() && (feeOverride() == null || feeOverride() > 100)) return bad("Revisa el valor del envío (entre $0 y $100) o déjalo vacío.", $("#mFee"));
  if (!pickup && !$("#mAddr").value.trim()) return bad("Escribe la dirección.", $("#mAddr"));
  const later = $('input[name="mWhen"][value="later"]').checked;
  if (later && !$("#mTime").value) return bad("Elige día y hora.", $("#mDate"));
  // Productos agotados hoy: se puede registrar igual, pero hay que confirmarlo con un segundo toque
  if (!isDone() && (!later || $("#mDate").value === todayStr())) {
    const outs = [...new Set([...st.cart.keys()].map(kId))].map((id) => st.prods.find((p) => p.id === id)).filter(isOutToday).map((p) => p.name);
    const sig = outs.join("|") + "#" + [...st.cart].join(",");
    if (outs.length && st.outOk !== sig) {
      st.outOk = sig;
      err.innerHTML = `<b>${esc(outs.join(", "))}</b> ${outs.length > 1 ? "están agotados" : "está agotado"} hoy. ¿Seguro que lo tienen? Toca <b>Registrar</b> otra vez para confirmar.`;
      return;
    }
  }
  const delivered = isDone();
  let soldAt = null;
  if (delivered) {
    const d = pastDay(), tm = $("#mPastTime").value || "12:00";
    if (!d) return bad("Elige el día de la venta.", $("#mPastDate"));
    soldAt = localToISO(d, tm);
    if (new Date(soldAt) > new Date(Date.now() + 5 * 60000)) return bad("La venta no puede ser en el futuro: revisa el día y la hora.", $("#mPastTime"));
    if (d < todayLocal(-60)) return bad("Solo se pueden registrar ventas de los últimos 60 días.", $("#mPastDate"));
  }
  const paid = delivered || $('input[name="mPay"][value="paid"]').checked;
  const deposit = !delivered && isDeposit() ? depNow() : null;
  if (deposit != null && !(deposit > 0 && deposit < subtotal() + (feeNow() || 0))) return bad("El anticipo debe ser mayor a $0 y menor al total.", $("#mDep"));
  const gift = $("#mGift").checked;
  const addr = $("#mAddr").value.trim().slice(0, 130);
  const body = {
    items: items(), pickup,
    ...(pickup ? {} : { lat: st.loc.lat, lng: st.loc.lng }),
    address: pickup ? "" : st.locLabel ? `${addr} · Ubicación del mapa: ${st.locLabel}`.slice(0, 200) : addr,
    reference: $("#mRef").value,
    scheduled_for: later && !delivered ? localToISO($("#mDate").value, $("#mTime").value) : null,
    ...(delivered ? { already_delivered: true } : {}),
    customer_name: $("#mName").value.trim(), customer_phone: $("#mPhone").value,
    customer_email: $("#mEmail").value.trim() || null,
    recipient_name: gift ? $("#mRName").value : null, recipient_phone: gift && $("#mRPhone").value ? $("#mRPhone").value : null,
    gift_message: gift ? $("#mMsg").value : null,
    gift_from: gift ? ($("#mFrom").value.trim() || $("#mName").value.trim()) : null,
    paid, ...(deposit != null ? { deposit } : {}),
    ...(!pickup && feeOverride() != null ? { delivery_fee_override: feeOverride() } : {}),
  };
  const btn = $("#mGo"); btn.disabled = true; btn.textContent = "Registrando…";
  try {
    const res = await api("crear_manual", body);
    // venta de otro día (o de otra hora): se deja en su fecha real para que Ventas la cuente ese día
    if (soldAt && Math.abs(new Date(soldAt).getTime() - Date.now()) > 10 * 60000) {
      const { error: be } = await sb.rpc("backdate_manual_order", { p_code: res.code, p_sold_at: soldAt });
      if (be) toast(`La venta ${res.code} quedó registrada con la fecha de hoy: no se pudo cambiar la fecha (${be.message}).`);
      else body.sold_at = soldAt;
    }
    if (st.draftId) { clearTimeout(st.autoT); dropDraft(st.draftId); st.draftId = null; }
    done(res, body, paid || deposit != null, delivered);
  } catch (ex) { err.textContent = ex.message; btn.disabled = false; drawSum(); }
}

function done(res, body, paid, delivered = false) {
  const link = `${SITE}/pedido?t=${res.tracking_token}`;
  const first = body.customer_name.split(" ")[0];
  const lines = [...st.cart].map(([k, q]) => `${q}× ${lName(k)}`).join("\n");
  const k = st.cfg.kitchen;
  const pickTxt = k?.lat ? `Retiras en nuestra cocina: https://maps.google.com/?q=${k.lat},${k.lng}` : "Retiras en nuestra cocina";
  const whenTxt = body.pickup ? (body.scheduled_for ? `Retiro: ${when(body.scheduled_for)}\n${pickTxt}` : pickTxt)
    : body.scheduled_for ? `Entrega: ${when(body.scheduled_for)}` : st.quote?.eta_if_now ? `Llega aprox. a las ${hhmm(st.quote.eta_if_now)}` : "";
  const msg = `¡Hola ${first}! 🧁 Tu pedido ${res.code} en The Bakery Side:\n${lines}\n${body.pickup ? "" : `Envío: ${res.delivery_promo && !Number(res.delivery_fee) ? "¡gratis! 🎁" : money(res.delivery_fee)}\n`}Total: ${money(res.total)}\n${whenTxt}\n\n` +
    (res.deposit != null ? `Recibimos tu anticipo de ${money(res.deposit)}, ¡gracias! 🎉 El saldo de ${money(res.balance_due)} se paga el día del evento, antes de la entrega.\nSigue tu pedido aquí: ${link}`
      : paid ? `¡Pago recibido, gracias! Sigue tu pedido aquí: ${link}` : `Paga aquí con tarjeta, transferencia, PeiGo o DeUna y sigue tu pedido: ${link}`);
  $("#mForm").hidden = true;
  if ($("#mBar")) $("#mBar").remove();
  $("#mDone").innerHTML = `
    <div class="panel mdone">
      <p class="eyebrow">Pedido registrado</p>
      <h2 class="display" style="font-size:44px">${esc(res.code)} · ${money(res.total)}</h2>
      <p class="muted">${res.deposit != null ? `Anticipo ${money(res.deposit)} registrado; ya está en Pedidos de cocina. Saldo por cobrar el día del evento: <b>${money(res.balance_due)}</b>.` : delivered ? `Quedó guardado como pagado y entregado${body.sold_at && localDayOf(body.sold_at) !== todayStr() ? ` el ${dayShort(localDayOf(body.sold_at))}` : ""}. Lo ves en Historial y en Master → Ventas.` : paid ? "Quedó pagado y ya está en Pedidos de cocina." : "Queda «Esperando pago». Pasa a cocina apenas el cliente pague con el enlace."}</p>
      <pre class="msg">${esc(msg)}</pre>
      <div class="row-btns">
        <a class="btn primary" ${waAttrs(body.customer_phone, msg)}>Enviar por WhatsApp</a>
        <button class="btn" type="button" id="mCopy">Copiar mensaje</button>
        <button class="btn ghost" type="button" id="mNew">Nuevo pedido</button>
      </div>
    </div>`;
  $("#mCopy").onclick = () => copy(msg);
  $("#mNew").onclick = () => { $("#mDone").innerHTML = ""; renderManual($("#mDone").parentElement); };
  scrollTo(0, 0);
}
