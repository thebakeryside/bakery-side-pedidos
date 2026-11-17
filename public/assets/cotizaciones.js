// The Bakery Side · Cotizaciones (Cocina → Cotizaciones y Master → Cotizaciones; solo master)
// Arma una cotización con productos del menú, cosas fuera del menú (desde una receta de Costos) o libres.
// Aplica descuentos por cantidad automáticamente sin bajar nunca del piso de margen, y la manda por
// WhatsApp con un enlace donde el cliente la ve y la descarga en PDF.
import { sb, $, $$, money, esc, toast, openWa, normPhoneEC, fold, todayLocal } from "./common.js";
import { priceLines, totals, targetPrice, costIndex, r2 } from "./quote-calc.js";

const SITE = "https://thebakeryside.com";
const STATUS_Q = { borrador: "Borrador", enviada: "Enviada", aceptada: "Aceptada", rechazada: "Rechazada", vencida: "Vencida" };
const pct = (x, d = 0) => (x == null || !isFinite(x) ? "—" : `${(x * 100).toFixed(d)} %`);
const num = (v) => Number(String(v ?? "").replace(",", ".")) || 0;
const uid = () => crypto.randomUUID?.() || String(Date.now() + Math.random());

const Q = { view: "lista", rules: null, cost: null, prods: [], cats: [], list: [], cur: null, iva: 0.15, root: null, filter: "" };

// ---------- datos ----------
async function load() {
  const [rules, st, items, recipes, ri, pres, pi, prods, list] = await Promise.all([
    sb.from("quote_rules").select("*").single(),
    sb.from("settings").select("iva_rate").single(),
    sb.from("cost_items").select("*"),
    sb.from("cost_recipes").select("*").order("name"),
    sb.from("cost_recipe_items").select("*"),
    sb.from("cost_presentations").select("*"),
    sb.from("cost_presentation_items").select("*"),
    sb.from("products").select("id,name,price,active,seasonal,quote_max_disc,sort,categories(id,name,sort)").order("sort"),
    sb.from("quotes").select("*").order("created_at", { ascending: false }).limit(60),
  ]);
  const err = [rules, st, items, recipes, ri, pres, pi, prods, list].find((r) => r.error);
  if (err) throw err.error;
  Q.rules = normRules(rules.data);
  Q.iva = Number(st.data.iva_rate ?? 0.15);
  Q.cost = costIndex({ items: items.data, recipes: recipes.data, ri: ri.data, pres: pres.data, pi: pi.data, iva: Q.iva });
  Q.prods = prods.data.filter((p) => Number(p.price) > 0 && !/sorpresa/i.test(p.name))
    .sort((a, b) => (a.categories?.sort ?? 99) - (b.categories?.sort ?? 99) || (a.sort ?? 0) - (b.sort ?? 0));
  Q.list = list.data;
}
function normRules(r) {
  return {
    ...r, target_margin: Number(r.target_margin), floor_margin: Number(r.floor_margin), round_to: Number(r.round_to),
    packaging_cost: Number(r.packaging_cost), deposit_pct: Number(r.deposit_pct), valid_days: Number(r.valid_days),
    tiers: (Array.isArray(r.tiers) ? r.tiers : []).map((t) => ({ min: Number(t.min), disc: Number(t.disc) })).sort((a, b) => a.min - b.min),
  };
}
const prod = (id) => Q.prods.find((p) => p.id === Number(id));
const prodCost = (id) => (Q.cost.product.has(Number(id)) ? r2(Q.cost.product.get(Number(id))) : null);

// ---------- entrada ----------
export async function renderQuotes(view) {
  Q.root = view;
  view.innerHTML = `<p class="muted">Cargando cotizaciones…</p>`;
  try { await load(); } catch (e) {
    view.innerHTML = `<div class="panel"><p class="err">No se pudieron cargar las cotizaciones: ${esc(e.message)}</p><p class="muted small">Las cotizaciones usan los costos de Master → Costos, así que solo las ve la cuenta master.</p></div>`;
    return;
  }
  draw();
}
function draw() {
  const tabs = [["lista", "Cotizaciones"], ["nueva", "＋ Nueva"], ["reglas", "Reglas de descuento"]];
  const on = Q.view === "editar" ? (Q.cur?.id ? "" : "nueva") : Q.view;
  Q.root.innerHTML = `<div class="ctabs qtabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="chip-btn" data-qv="${k}" aria-pressed="${on === k}">${l}</button>`).join("")}</div><div id="qBody"></div>`;
  $$("[data-qv]", Q.root).forEach((b) => (b.onclick = () => {
    if (b.dataset.qv === "nueva") return openEditor(null);
    Q.view = b.dataset.qv; draw();
  }));
  if (Q.view === "lista") drawList();
  else if (Q.view === "reglas") drawRules();
  else drawEditor();
}

// ---------- lista ----------
function drawList() {
  const box = $("#qBody");
  const f = fold(Q.filter);
  const rows = Q.list.filter((q) => !f || fold(`${q.code} ${q.customer_name} ${q.customer_phone}`).includes(f));
  const open = Q.list.filter((q) => ["borrador", "enviada"].includes(q.status));
  const won = Q.list.filter((q) => q.status === "aceptada");
  box.innerHTML = `
    <div class="stats" style="margin-top:14px"><div><b>${open.length}</b>abiertas</div><div><b>${money(open.reduce((s, q) => s + Number(q.total), 0))}</b>por cerrar</div><div><b>${won.length}</b>aceptadas</div><div><b>${money(won.reduce((s, q) => s + Number(q.total), 0))}</b>vendido en cotizaciones</div></div>
    <input class="in" id="qSearch" type="search" placeholder="Buscar por cliente, teléfono o código…" value="${esc(Q.filter)}" style="margin-bottom:12px">
    ${rows.length ? `<div class="qlist">${rows.map(qCard).join("")}</div>` : `<div class="panel"><p class="muted">${Q.list.length ? "Ninguna cotización coincide." : "Aún no hay cotizaciones. Toque «＋ Nueva» para armar la primera."}</p></div>`}`;
  const s = $("#qSearch");
  s.oninput = () => { Q.filter = s.value; const pos = s.selectionStart; drawList(); const n = $("#qSearch"); n.focus(); n.setSelectionRange(pos, pos); };
  box.onclick = async (e) => {
    const b = e.target.closest("[data-qa]"); if (!b) return;
    const q = Q.list.find((x) => x.id === Number(b.dataset.id)); if (!q) return;
    if (b.dataset.qa === "open") openEditor(q);
    else if (b.dataset.qa === "dup") openEditor({ ...q, id: null, code: null, public_token: null, status: "borrador", sent_at: null, created_at: null, valid_until: null });
    else if (b.dataset.qa === "wa") sendWa(q);
  };
  box.onchange = async (e) => {
    const sel = e.target.closest("[data-qstatus]"); if (!sel) return;
    const { error } = await sb.from("quotes").update({ status: sel.value, updated_at: new Date().toISOString() }).eq("id", Number(sel.dataset.qstatus));
    if (error) return toast("No se pudo cambiar el estado: " + error.message);
    const q = Q.list.find((x) => x.id === Number(sel.dataset.qstatus)); if (q) q.status = sel.value;
    toast(`Cotización ${STATUS_Q[sel.value].toLowerCase()}`); drawList();
  };
}
function qCard(q) {
  const expired = q.valid_until && q.valid_until < todayLocal() && ["borrador", "enviada"].includes(q.status);
  const m = Number(q.total) > 0 ? (Number(q.subtotal) - Number(q.cost_total)) / Number(q.subtotal || 1) : null;
  const n = (q.items || []).reduce((s, i) => s + Number(i.qty || 0), 0);
  return `<div class="panel qcard">
    <div class="qcard-top"><div><b>${esc(q.code)}</b> · ${esc(q.customer_name || "Sin nombre")}${q.event_date ? ` <span class="muted small">· evento ${esc(fmtDate(q.event_date))}</span>` : ""}</div><b class="tabnum">${money(q.total)}</b></div>
    <div class="muted small">${n} unidades · ${(q.items || []).length} productos${Number(q.discount) > 0 ? ` · descuento ${money(q.discount)}` : ""} · margen <span class="mchip ${mLevel(m)}">${pct(m)}</span>${expired ? ` · <span class="bad">vencida el ${esc(fmtDate(q.valid_until))}</span>` : q.valid_until ? ` · válida hasta ${esc(fmtDate(q.valid_until))}` : ""}</div>
    <div class="row-btns" style="margin-top:10px">
      <button type="button" class="btn small primary" data-qa="open" data-id="${q.id}">Abrir</button>
      <button type="button" class="btn small" data-qa="wa" data-id="${q.id}"${q.customer_phone ? "" : " disabled"}>WhatsApp</button>
      <a class="btn small" href="/cotizacion?t=${esc(q.public_token)}" target="_blank" rel="noopener">Ver / PDF</a>
      <button type="button" class="btn small ghost" data-qa="dup" data-id="${q.id}">Duplicar</button>
      <select class="in qstatus" data-qstatus="${q.id}" aria-label="Estado">${Object.entries(STATUS_Q).map(([k, l]) => `<option value="${k}"${q.status === k ? " selected" : ""}>${l}</option>`).join("")}</select>
    </div></div>`;
}
const mLevel = (m) => (m == null ? "" : m >= Q.rules.target_margin - 0.0005 ? "ok" : m >= Q.rules.floor_margin - 0.0005 ? "warn" : "bad");
const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" });
const addDays = (n) => { const d = new Date(todayLocal() + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// ---------- editor ----------
function openEditor(q) {
  Q.cur = q ? {
    ...q, items: (q.items || []).map((i) => ({ ...i, key: uid() })),
    deposit_pct: Number(q.deposit_pct ?? Q.rules.deposit_pct), delivery_fee: Number(q.delivery_fee || 0),
    valid_until: q.valid_until || addDays(Q.rules.valid_days),
  } : {
    id: null, status: "borrador", customer_name: "", customer_phone: "", customer_email: "", event_date: null,
    delivery: "por_definir", delivery_address: "", delivery_fee: 0, items: [], notes: "", internal_notes: "",
    deposit_pct: Q.rules.deposit_pct, valid_until: addDays(Q.rules.valid_days), terms: Q.rules.terms,
  };
  Q.view = "editar"; Q.prodSearch = ""; draw();
}
// líneas listas para calcular (los costos del menú se leen siempre al día desde Costos)
function calcInput() {
  return Q.cur.items.map((i) => {
    if (i.k === "menu") {
      const p = prod(i.product_id);
      return { ...i, list_price: p ? Number(p.price) : Number(i.list_price), cost: p ? prodCost(p.id) : i.cost, cap: p?.quote_max_disc == null ? null : Number(p.quote_max_disc), group: p?.categories?.name || "menu" };
    }
    if (i.k === "receta") {
      const r = Q.cost.recipe.get(Number(i.recipe_id));
      const cost = r ? r2(r.perUnit * num(i.amount) + num(i.extra)) : i.cost;
      return { ...i, cost, list_price: i.list_manual ? num(i.list_price) : targetPrice(cost, Q.rules), cap: null, group: null };
    }
    return { ...i, cost: i.cost === "" || i.cost == null ? null : num(i.cost), list_price: num(i.list_price), cap: null, group: null };
  });
}
function calc() {
  const priced = priceLines(calcInput(), Q.rules);
  const t = totals(priced, { fee: Q.cur.delivery === "domicilio" ? Q.cur.delivery_fee : 0, packaging: Q.rules.packaging_cost, deposit: Q.cur.deposit_pct });
  return { priced, t };
}

function drawEditor() {
  const c = Q.cur;
  const isNew = !c.id;
  $("#qBody").innerHTML = `
    <div class="qed">
      <div class="panel">
        <h2 class="mtitle"><span>1</span>${isNew ? "Nueva cotización" : `Cotización ${esc(c.code)}`}</h2>
        <div class="form-grid">
          <div><label class="f" for="qName">Cliente</label><input class="in" id="qName" value="${esc(c.customer_name)}" autocomplete="off"></div>
          <div><label class="f" for="qPhone">WhatsApp</label><input class="in" id="qPhone" type="tel" inputmode="tel" placeholder="0991234567" value="${esc(c.customer_phone)}" autocomplete="off"></div>
          <div><label class="f" for="qEmail">Correo <span class="hint">(opcional)</span></label><input class="in" id="qEmail" type="email" value="${esc(c.customer_email)}" autocomplete="off"></div>
          <div><label class="f" for="qEvent">Fecha del evento</label><input class="in" id="qEvent" type="date" value="${esc(c.event_date || "")}"></div>
        </div>
        <label class="f">Entrega</label>
        <div class="chips">${[["por_definir", "Por definir"], ["domicilio", "A domicilio"], ["retiro", "Retira en local"]].map(([k, l]) => `<label class="chip"><input type="radio" name="qDel" value="${k}"${c.delivery === k ? " checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="form-grid" id="qDelBox" ${c.delivery === "domicilio" ? "" : "hidden"} style="margin-top:8px">
          <div><label class="f" for="qAddr">Dirección o sector</label><input class="in" id="qAddr" value="${esc(c.delivery_address || "")}"></div>
          <div><label class="f" for="qFee">Envío a cobrar ($)</label><input class="in" id="qFee" inputmode="decimal" value="${c.delivery_fee || ""}" placeholder="0.00"></div>
        </div>
      </div>

      <div class="panel">
        <h2 class="mtitle"><span>2</span>Productos</h2>
        <input class="in" id="qProdSearch" type="search" placeholder="Buscar en el menú (ej.: rollos, alfajor, cocoa)…" value="${esc(Q.prodSearch || "")}" autocomplete="off">
        <div class="qprods" id="qProds"></div>
        <div class="row-btns" style="margin-top:10px">
          <button type="button" class="btn small" id="qAddRecipe">＋ Fuera del menú (desde una receta)</button>
          <button type="button" class="btn small" id="qAddFree">＋ Otro producto o servicio</button>
        </div>
        <div id="qLines" style="margin-top:14px"></div>
        <p class="muted small qrule">Descuento automático por cantidad: ${Q.rules.tiers.map((t) => `${t.min}+ → ${pct(t.disc)}`).join(" · ")}. Se suma la cantidad de productos de la misma categoría. Ninguno baja del piso de margen (${pct(Q.rules.floor_margin)}) ni del tope de su producto.</p>
      </div>

      <div class="panel">
        <h2 class="mtitle"><span>3</span>Resumen</h2>
        <div id="qSum"></div>
        <div class="form-grid" style="margin-top:10px">
          <div><label class="f" for="qValid">Válida hasta</label><input class="in" id="qValid" type="date" value="${esc(c.valid_until || "")}"></div>
          <div><label class="f" for="qDep">Anticipo para reservar (%)</label><input class="in" id="qDep" inputmode="numeric" value="${Math.round(c.deposit_pct * 100)}"></div>
        </div>
        <label class="f" for="qNotes">Nota para el cliente <span class="hint">(sale en la cotización)</span></label>
        <textarea class="in" id="qNotes" rows="2" placeholder="Ej.: Incluye cajitas individuales con sticker TBS.">${esc(c.notes || "")}</textarea>
        <label class="f" for="qInternal">Nota interna <span class="hint">(solo la ve usted)</span></label>
        <textarea class="in" id="qInternal" rows="2">${esc(c.internal_notes || "")}</textarea>
        <details style="margin-top:8px"><summary class="muted small">Condiciones que ve el cliente</summary><textarea class="in" id="qTerms" rows="3" style="margin-top:6px">${esc(c.terms ?? Q.rules.terms)}</textarea></details>
        <p class="err" id="qErr"></p>
        <div class="acts main row-btns" style="margin-top:12px">
          <button type="button" class="btn primary" id="qSaveWa">Guardar y enviar por WhatsApp</button>
          <button type="button" class="btn" id="qSave">Guardar</button>
          <button type="button" class="btn" id="qView" ${c.public_token ? "" : "hidden"}>Ver / PDF</button>
          <button type="button" class="btn" id="qCopy">Copiar texto</button>
        </div>
      </div>
    </div>`;
  wireEditor();
  drawProds(); drawLines();
}

function wireEditor() {
  const c = Q.cur;
  const bind = (id, key, fn = (v) => v) => { const el = $(id); el.oninput = () => { c[key] = fn(el.value); if (["delivery_fee", "deposit_pct"].includes(key)) drawSum(); }; };
  bind("#qName", "customer_name"); bind("#qPhone", "customer_phone"); bind("#qEmail", "customer_email");
  bind("#qEvent", "event_date", (v) => v || null); bind("#qAddr", "delivery_address"); bind("#qFee", "delivery_fee", num);
  bind("#qValid", "valid_until", (v) => v || null); bind("#qDep", "deposit_pct", (v) => Math.min(1, Math.max(0, num(v) / 100)));
  bind("#qNotes", "notes"); bind("#qInternal", "internal_notes"); bind("#qTerms", "terms");
  $$('input[name="qDel"]').forEach((r) => (r.onchange = () => { c.delivery = r.value; $("#qDelBox").hidden = r.value !== "domicilio"; drawSum(); }));
  const ps = $("#qProdSearch"); ps.oninput = () => { Q.prodSearch = ps.value; drawProds(); };
  $("#qAddRecipe").onclick = () => {
    const r = [...Q.cost.recipe.values()].sort((a, b) => a.name.localeCompare(b.name, "es"))[0];
    if (!r) return toast("No hay recetas en Master → Costos.");
    c.items.push({ key: uid(), k: "receta", recipe_id: r.id, name: r.name, detail: "", amount: 1, extra: 0, qty: 1, manual: false, list_manual: false });
    drawLines();
  };
  $("#qAddFree").onclick = () => { c.items.push({ key: uid(), k: "libre", name: "", detail: "", qty: 1, cost: "", list_price: 0, manual: false }); drawLines(); };
  $("#qSave").onclick = () => save(false);
  $("#qSaveWa").onclick = () => save(true);
  $("#qView").onclick = () => window.open(`/cotizacion?t=${c.public_token}`, "_blank", "noopener");
  $("#qCopy").onclick = async () => {
    const text = waMessage(snapshot());
    try { await navigator.clipboard.writeText(text); toast("Texto copiado"); } catch { prompt("Copie el texto:", text); }
  };
}

function drawProds() {
  const f = fold(Q.prodSearch || "");
  const box = $("#qProds");
  if (!f) { box.innerHTML = ""; return; }
  const list = Q.prods.filter((p) => fold(`${p.name} ${p.categories?.name || ""}`).includes(f)).slice(0, 12);
  box.innerHTML = list.length ? list.map((p) => {
    const cost = prodCost(p.id);
    return `<button type="button" class="qprod" data-add="${p.id}"><span><b>${esc(p.name)}</b>${p.active ? "" : ` <span class="muted small">(oculto en la tienda)</span>`}<br><span class="muted small">${esc(p.categories?.name || "")}${cost == null ? " · sin costo en Costos" : ` · costo ${money(cost)}`}</span></span><span class="tabnum">${money(p.price)}</span></button>`;
  }).join("") : `<p class="muted small">No hay productos con ese nombre. Use «Fuera del menú» u «Otro producto».</p>`;
  box.onclick = (e) => {
    const b = e.target.closest("[data-add]"); if (!b) return;
    const p = prod(b.dataset.add);
    const ex = Q.cur.items.find((i) => i.k === "menu" && i.product_id === p.id);
    if (ex) { toast(`${p.name} ya está en la lista: cambie la cantidad`); }
    else Q.cur.items.push({ key: uid(), k: "menu", product_id: p.id, name: p.name, detail: "", qty: 1, manual: false });
    Q.prodSearch = ""; $("#qProdSearch").value = ""; drawProds(); drawLines();
    const last = $(`[data-line="${(ex || Q.cur.items.at(-1)).key}"] [data-f="qty"]`); if (last) { last.focus(); last.select(); }
  };
}

const STATUS_TXT = {
  sin_costo: ["warn", "Sin costo en Master → Costos: no hay descuento automático. Si da uno, hágalo a mano y con cuidado."],
  perdida: ["bad", "¡Pierde dinero! El precio está por debajo del costo."],
  bajo_piso: ["bad", "Por debajo del piso de margen."],
  sobre_tope: ["warn", "Pasa el tope de descuento de este producto."],
};
function lineHtml(l) {
  const recipes = [...Q.cost.recipe.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  const r = l.k === "receta" ? Q.cost.recipe.get(Number(l.recipe_id)) : null;
  const tierTxt = l.manual ? `Precio a mano`
    : l.autoDisc > 0 ? `−${pct(l.disc, l.disc * 100 % 1 ? 1 : 0)} por ${l.tierQty} u.${l.autoDisc < l.tier.disc - 0.0005 ? ` (el tramo da ${pct(l.tier.disc)}, se limita por ${l.cap != null && l.cap <= l.maxDisc + 0.0005 ? "el tope del producto" : "el piso de margen"})` : ""}`
    : l.tier.disc > 0 && l.cost == null ? `Tramo ${pct(l.tier.disc)} sin aplicar (sin costo)`
    : "Precio normal";
  const [lvl, msg] = STATUS_TXT[l.status] || ["", ""];
  return `<div class="qline" data-line="${l.key}">
    <div class="qline-head">
      ${l.k === "menu" ? `<b>${esc(l.name)}</b>` : l.k === "receta"
        ? `<input class="in qname" data-f="name" value="${esc(l.name)}" placeholder="Nombre en la cotización (ej.: Rompope · botella 750 ml)">`
        : `<input class="in qname" data-f="name" value="${esc(l.name)}" placeholder="Producto o servicio (ej.: Torta de 2 pisos)">`}
      <button type="button" class="chip-x" data-del aria-label="Quitar">×</button>
    </div>
    ${l.k === "receta" ? `<div class="qrecipe">
        <label class="f">Receta <select class="in" data-f="recipe_id">${recipes.map((x) => `<option value="${x.id}"${x.id === Number(l.recipe_id) ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
        <label class="f">Cada unidad lleva <span class="qinline"><input class="in" data-f="amount" inputmode="decimal" value="${esc(l.amount)}"> <span class="muted small">${esc(r?.yield_unit || "")}</span></span></label>
        <label class="f">Envase y extras por unidad ($) <input class="in" data-f="extra" inputmode="decimal" value="${esc(l.extra || "")}" placeholder="Ej.: botella + sticker 3.00"></label>
        <p class="muted small" style="grid-column:1/-1;margin:0">1 receta = ${esc(r ? `${Number(r.yield_qty)} ${r.yield_unit}` : "—")} · costo de la receta ${money(r?.total || 0)} (${money(r?.perUnit || 0)} por cada 1 de «${esc(r?.yield_unit || "unidad")}»). Costo por unidad: <b>${money(l.cost || 0)}</b>. Precio con ${pct(Q.rules.target_margin)} de margen: <b>${money(targetPrice(l.cost || 0, Q.rules))}</b>.</p>
      </div>` : ""}
    <div class="qline-grid">
      <label class="f">Cantidad <input class="in" data-f="qty" inputmode="numeric" value="${l.qty}"></label>
      ${l.k === "menu"
        ? `<label class="f">Precio web <input class="in" value="${money(l.list_price)}" disabled></label>`
        : `<label class="f">Precio normal <input class="in" data-f="list_price" inputmode="decimal" value="${l.list_price || ""}" placeholder="0.00"></label>`}
      ${l.k === "libre" ? `<label class="f">Costo c/u <span class="hint">(opcional)</span><input class="in" data-f="cost" inputmode="decimal" value="${l.cost ?? ""}" placeholder="—"></label>` : ""}
      <label class="f">Precio cotizado c/u <input class="in ${lvl}" data-f="unit_price" inputmode="decimal" value="${l.unit_price.toFixed(2)}"></label>
      <div class="qline-total"><span class="muted small">Total</span><b class="tabnum">${money(l.line_total)}</b>${l.disc > 0.0005 ? `<s class="muted small tabnum">${money(l.line_list)}</s>` : ""}</div>
    </div>
    <label class="f qdetail">Detalle para el cliente <span class="hint">(opcional)</span><input class="in" data-f="detail" value="${esc(l.detail || "")}" placeholder="Ej.: en cajitas individuales, sabor vainilla"></label>
    <div class="qline-info">
      <span class="chip ${l.manual ? "" : l.autoDisc > 0 ? "ok" : ""}">${esc(tierTxt)}</span>
      ${l.cost != null ? `<span class="muted small">Costo ${money(l.cost)} · margen <span class="mchip ${mLevel(l.margin)}">${pct(l.margin)}</span> · gana ${money(l.line_total - l.cost * l.qty)}</span>` : ""}
      ${l.cost != null && l.maxDisc > 0 ? `<span class="muted small">Máximo seguro: −${pct(l.maxDisc)} (${money(l.maxUnit)} c/u)</span>` : ""}
      ${l.next ? `<span class="muted small">💡 Con ${l.next.need} más${l.group ? ` de ${esc(l.group)}` : ""} llega a −${pct(l.next.disc)}</span>` : ""}
    </div>
    ${msg ? `<p class="small ${lvl}" style="margin:6px 0 0">${msg}${l.floor ? ` Piso: ${money(l.floor)} c/u.` : ""}</p>` : ""}
    <div class="row-btns" style="margin-top:8px">
      ${l.cost != null && l.maxDisc > 0 ? `<button type="button" class="btn small" data-max>Dar el máximo seguro</button>` : ""}
      ${l.manual ? `<button type="button" class="btn small" data-auto>Volver al automático</button>` : ""}
      ${l.k === "receta" && l.list_manual ? `<button type="button" class="btn small ghost" data-target>Usar precio con ${pct(Q.rules.target_margin)}</button>` : ""}
    </div>
  </div>`;
}

let lastPriced = [];
function drawLines() {
  const { priced } = calc();
  lastPriced = priced;
  const box = $("#qLines");
  box.innerHTML = priced.length ? priced.map(lineHtml).join("") : `<p class="muted small">Busque un producto arriba para agregarlo.</p>`;
  drawSum();
  // la lista se redibuja al salir del campo; mientras escribe solo se actualizan los números
  box.oninput = (e) => {
    const el = e.target.closest("[data-f]"); if (!el) return;
    const key = el.closest("[data-line]").dataset.line;
    const it = Q.cur.items.find((i) => i.key === key); if (!it) return;
    const f = el.dataset.f;
    if (f === "unit_price") { it.manual = true; it.unit_price = num(el.value); }
    else if (f === "list_price") { it.list_price = num(el.value); if (it.k === "receta") it.list_manual = true; }
    else if (f === "qty") it.qty = Math.max(0, Math.round(num(el.value)));
    else if (f === "name" || f === "detail") it[f] = el.value;
    else if (f === "cost") it.cost = el.value.trim() === "" ? "" : num(el.value);
    else it[f] = el.value;
    if (["name", "detail"].includes(f)) return;
    drawSum();
  };
  box.onchange = (e) => {
    const el = e.target.closest("[data-f]"); if (!el) return;
    const it = Q.cur.items.find((i) => i.key === el.closest("[data-line]").dataset.line); if (!it) return;
    if (el.dataset.f === "recipe_id") { it.recipe_id = Number(el.value); const r = Q.cost.recipe.get(it.recipe_id); if (r && (!it.name || [...Q.cost.recipe.values()].some((x) => x.name === it.name))) it.name = r.name; it.list_manual = false; }
    if (["name", "detail"].includes(el.dataset.f)) return;
    redrawKeepFocus();
  };
  box.onclick = (e) => {
    const line = e.target.closest("[data-line]"); if (!line) return;
    const it = Q.cur.items.find((i) => i.key === line.dataset.line); if (!it) return;
    const p = lastPriced.find((x) => x.key === it.key);
    if (e.target.closest("[data-del]")) Q.cur.items = Q.cur.items.filter((i) => i !== it);
    else if (e.target.closest("[data-max]")) { it.manual = true; it.unit_price = p.maxUnit; }
    else if (e.target.closest("[data-auto]")) { it.manual = false; delete it.unit_price; }
    else if (e.target.closest("[data-target]")) { it.list_manual = false; it.manual = false; }
    else return;
    drawLines();
  };
}
function redrawKeepFocus() {
  const a = document.activeElement;
  const key = a?.closest?.("[data-line]")?.dataset.line, f = a?.dataset?.f;
  drawLines();
  if (key && f) { const el = $(`[data-line="${key}"] [data-f="${f}"]`); if (el) el.focus(); }
}

function drawSum() {
  const { priced, t } = calc();
  // los números de cada línea se actualizan sin redibujar los campos
  priced.forEach((l) => {
    const box = $(`[data-line="${l.key}"]`); if (!box) return;
    const tot = box.querySelector(".qline-total b"); if (tot) tot.textContent = money(l.line_total);
    const up = box.querySelector('[data-f="unit_price"]'); if (up && document.activeElement !== up) up.value = l.unit_price.toFixed(2);
  });
  const bad = priced.filter((l) => ["perdida", "bajo_piso"].includes(l.status));
  $("#qSum").innerHTML = `<div class="msum">
      <div class="line"><span>Precio normal</span><span class="tabnum">${money(t.subtotal_list)}</span></div>
      ${t.discount > 0 ? `<div class="line"><span>Descuento por cantidad (${pct(t.subtotal_list ? t.discount / t.subtotal_list : 0, 1)})</span><span class="tabnum">−${money(t.discount)}</span></div>` : ""}
      <div class="line"><span>Productos</span><span class="tabnum">${money(t.subtotal)}</span></div>
      <div class="line"><span>Envío</span><span class="tabnum">${Q.cur.delivery === "domicilio" ? money(t.fee) : Q.cur.delivery === "retiro" ? "Retira" : "Por definir"}</span></div>
      <div class="line total"><span>Total</span><span class="tabnum">${money(t.total)}</span></div>
      <div class="line"><span class="muted">Anticipo (${pct(Q.cur.deposit_pct)})</span><span class="tabnum muted">${money(t.deposit)}</span></div>
    </div>
    <div class="qprofit">
      <div><span class="muted small">Costo + empaque</span><b class="tabnum">${money(t.cost_total)}</b></div>
      <div><span class="muted small">Ganancia</span><b class="tabnum ${t.profit < 0 ? "bad" : ""}">${money(t.profit)}</b></div>
      <div><span class="muted small">Margen</span><b><span class="mchip ${mLevel(t.margin)}">${pct(t.margin)}</span></b></div>
    </div>
    ${t.uncosted ? `<p class="small warn" style="margin:8px 0 0">⚠️ ${t.uncosted} producto${t.uncosted > 1 ? "s" : ""} sin costo: la ganancia real es menor a la que se muestra.</p>` : ""}
    ${bad.length ? `<p class="small bad" style="margin:8px 0 0">⛔ ${bad.map((l) => esc(l.name || "Producto")).join(", ")} ${bad.length > 1 ? "están" : "está"} por debajo del piso de ${pct(Q.rules.floor_margin)}. Para guardar así tendrá que confirmarlo.</p>` : ""}`;
}

// ---------- guardar y enviar ----------
function snapshot() {
  const { priced, t } = calc();
  const c = Q.cur;
  const items = priced.filter((l) => l.qty > 0).map((l) => {
    const base = { k: l.k, name: (l.name || "").trim() || (l.k === "libre" ? "Producto" : ""), detail: (l.detail || "").trim(), qty: l.qty,
      list_price: l.list_price, unit_price: l.unit_price, line_total: l.line_total, cost: l.cost, manual: !!l.manual, disc: r2(l.disc * 10000) / 10000 };
    if (l.k === "menu") return { ...base, product_id: l.product_id };
    if (l.k === "receta") return { ...base, recipe_id: Number(l.recipe_id), amount: num(l.amount), extra: num(l.extra), list_manual: !!l.list_manual };
    return base;
  });
  return { ...c, items, ...t, priced };
}
async function save(sendWhatsApp) {
  const s = snapshot();
  const err = $("#qErr"); err.textContent = "";
  if (!s.items.length) { err.textContent = "Agregue al menos un producto con cantidad."; return; }
  if (s.items.some((i) => !i.name)) { err.textContent = "Ponga nombre a todos los productos fuera del menú."; return; }
  if (s.items.some((i) => !(i.unit_price > 0))) { err.textContent = "Hay productos con precio $0."; return; }
  const bad = s.priced.filter((l) => l.qty > 0 && ["perdida", "bajo_piso"].includes(l.status));
  if (bad.length && !confirm(`${bad.map((l) => l.name).join(", ")} ${bad.length > 1 ? "quedan" : "queda"} por debajo del piso de margen (${pct(Q.rules.floor_margin)}). ¿Guardar igual?`)) return;
  const phone = s.customer_phone ? normPhoneEC(s.customer_phone) || s.customer_phone.trim() : null;
  if (sendWhatsApp && !phone) { err.textContent = "Escriba el WhatsApp del cliente para enviarla."; $("#qPhone").focus(); return; }
  const row = {
    customer_name: s.customer_name?.trim() || null, customer_phone: phone, customer_email: s.customer_email?.trim() || null,
    event_date: s.event_date || null, delivery: s.delivery, delivery_address: s.delivery_address?.trim() || null,
    delivery_fee: s.delivery === "domicilio" ? s.fee : 0, items: s.items, notes: s.notes?.trim() || null, internal_notes: s.internal_notes?.trim() || null,
    subtotal_list: s.subtotal_list, discount: s.discount, subtotal: s.subtotal, total: s.total, cost_total: s.cost_total,
    deposit_pct: s.deposit_pct, valid_until: s.valid_until || null, terms: s.terms?.trim() || null,
    updated_at: new Date().toISOString(),
    ...(sendWhatsApp ? { status: ["aceptada", "rechazada"].includes(s.status) ? s.status : "enviada", sent_at: new Date().toISOString() } : {}),
  };
  const btns = $$("#qSave, #qSaveWa"); btns.forEach((b) => (b.disabled = true));
  const res = s.id ? await sb.from("quotes").update(row).eq("id", s.id).select().single() : await sb.from("quotes").insert(row).select().single();
  btns.forEach((b) => (b.disabled = false));
  if (res.error) { err.textContent = "No se pudo guardar: " + res.error.message; return; }
  const q = res.data;
  Q.list = [q, ...Q.list.filter((x) => x.id !== q.id)];
  Q.cur = { ...Q.cur, id: q.id, code: q.code, public_token: q.public_token, status: q.status };
  toast(`${q.code} guardada`);
  if (sendWhatsApp) sendWa(q);
  drawEditor();
}

function waMessage(q) {
  const first = (q.customer_name || "").trim().split(/\s+/)[0];
  const lines = (q.items || []).map((i) => {
    const disc = Number(i.list_price) > Number(i.unit_price) + 0.004;
    return `• ${i.qty} × ${i.name}${i.detail ? ` (${i.detail})` : ""}: ${money(i.unit_price)} c/u${disc ? ` (normal ${money(i.list_price)})` : ""} = ${money(i.line_total)}`;
  });
  const fee = Number(q.delivery_fee ?? q.fee ?? 0);
  const del = q.delivery === "domicilio" ? `Envío: ${money(fee)}` : q.delivery === "retiro" ? "Retiro en nuestro local" : "Envío: por confirmar según la dirección";
  const dep = r2(Number(q.total) * Number(q.deposit_pct));
  return [
    `¡Hola${first ? `, ${first}` : ""}! 🤍 Le comparto su cotización${q.code ? ` ${q.code}` : ""} de The Bakery Side${q.event_date ? ` para el ${fmtDate(q.event_date)}` : ""}:`,
    "",
    ...lines,
    "",
    Number(q.discount) > 0 ? `Productos: ${money(q.subtotal)} (ahorra ${money(q.discount)} por cantidad)` : `Productos: ${money(q.subtotal)}`,
    del,
    `*Total: ${money(q.total)}*`,
    Number(q.deposit_pct) > 0 && Number(q.deposit_pct) < 1 ? `Para reservar la fecha: anticipo de ${money(dep)} (${Math.round(Number(q.deposit_pct) * 100)} %).` : "",
    q.valid_until ? `Precios válidos hasta el ${fmtDate(q.valid_until)}.` : "",
    q.notes ? `\n${q.notes}` : "",
    q.public_token ? `\nPuede verla y descargarla en PDF aquí: ${SITE}/cotizacion?t=${q.public_token}` : "",
    "",
    "Indíqueme si desea confirmarla. ¡Qué dulce! 🎁",
  ].filter((x, i, a) => x !== "" || (a[i - 1] !== "" && i > 0)).join("\n").replace(/\n{3,}/g, "\n\n");
}
function sendWa(q) {
  if (!q.customer_phone) return toast("La cotización no tiene WhatsApp del cliente.");
  openWa(q.customer_phone, waMessage(q));
}

// ---------- reglas ----------
function drawRules() {
  const R = Q.rules;
  const rows = Q.prods.filter((p) => p.active).map((p) => {
    const cost = prodCost(p.id);
    const floor = cost != null ? cost / (1 - R.floor_margin) : null;
    const floorDisc = floor != null ? Math.max(0, 1 - floor / Number(p.price)) : null;
    const cap = p.quote_max_disc == null ? null : Number(p.quote_max_disc);
    const eff = floorDisc == null ? 0 : cap == null ? floorDisc : Math.min(cap, floorDisc);
    return { p, cost, floor, floorDisc, cap, eff };
  });
  $("#qBody").innerHTML = `
    <div class="panel" style="margin-top:14px">
      <h2 class="mtitle">Márgenes</h2>
      <div class="cset">
        <label>Meta <input class="in" id="rTarget" inputmode="numeric" value="${Math.round(R.target_margin * 100)}"> %</label>
        <label>Piso <input class="in" id="rFloor" inputmode="numeric" value="${Math.round(R.floor_margin * 100)}"> %</label>
        <label>Anticipo <input class="in" id="rDep" inputmode="numeric" value="${Math.round(R.deposit_pct * 100)}"> %</label>
        <label>Válida <input class="in" id="rDays" inputmode="numeric" value="${R.valid_days}"> días</label>
        <label>Empaque por pedido $<input class="in" id="rPack" inputmode="decimal" value="${R.packaging_cost.toFixed(2)}"></label>
        <label>Redondear precios a $<input class="in" id="rRound" inputmode="decimal" value="${R.round_to.toFixed(2)}"></label>
      </div>
      <p class="muted small" style="margin:10px 0 0"><b>Meta</b>: el margen para poner precio a lo que no está en el menú (ej.: una botella de rompope). <b>Piso</b>: ningún descuento automático deja menos que esto; si lo baja a mano, le avisa en rojo.</p>
      <h2 class="mtitle" style="margin-top:18px">Descuento por cantidad</h2>
      <div id="rTiers" class="rtiers">${R.tiers.map((t, i) => tierRow(t, i)).join("")}</div>
      <button type="button" class="btn small" id="rAddTier" style="margin-top:8px">＋ Agregar tramo</button>
      <label class="f" for="rTerms" style="margin-top:14px">Condiciones que salen en cada cotización</label>
      <textarea class="in" id="rTerms" rows="3">${esc(R.terms)}</textarea>
      <div class="row-btns" style="margin-top:12px"><button type="button" class="btn primary" id="rSave">Guardar reglas</button></div>
      <p class="err" id="rErr"></p>
    </div>
    <div class="panel">
      <h2 class="mtitle">Tope por producto</h2>
      <p class="muted small" style="margin:0 0 10px">El descuento automático es el menor entre el tramo, el tope del producto y lo que permite el piso. Deje el tope vacío para que solo mande el piso. Ej.: Coconut Water con 10 % de tope nunca pasa de −10 %, aunque pidan 200.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Precio</th><th>Costo</th><th>Piso c/u</th><th>Máx. por piso</th><th>Tope</th><th>Máx. real</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td><b>${esc(x.p.name)}</b><br><span class="muted small">${esc(x.p.categories?.name || "")}</span></td>
        <td class="tabnum">${money(x.p.price)}</td>
        <td class="tabnum">${x.cost == null ? `<span class="warn small">sin costo</span>` : money(x.cost)}</td>
        <td class="tabnum">${x.floor == null ? "—" : money(x.floor)}</td>
        <td class="tabnum">${x.floorDisc == null ? "—" : pct(x.floorDisc)}</td>
        <td><input class="in rcap" data-cap="${x.p.id}" inputmode="numeric" value="${x.cap == null ? "" : Math.round(x.cap * 100)}" placeholder="—" aria-label="Tope de ${esc(x.p.name)} en %"></td>
        <td class="tabnum"><span class="mchip ${x.cost == null ? "" : x.eff >= 0.15 ? "ok" : x.eff > 0 ? "warn" : "bad"}">${x.cost == null ? "0 %" : pct(x.eff)}</span></td></tr>`).join("")}
      </tbody></table></div>
    </div>`;
  $("#rAddTier").onclick = () => { const last = R.tiers.at(-1) || { min: 0, disc: 0 }; R.tiers.push({ min: last.min ? last.min * 2 : 12, disc: Math.min(0.9, last.disc + 0.05) }); drawRules(); };
  $("#rTiers").onclick = (e) => { const b = e.target.closest("[data-rtdel]"); if (!b) return; R.tiers.splice(Number(b.dataset.rtdel), 1); drawRules(); };
  $("#rTiers").oninput = (e) => { const el = e.target.closest("[data-rt]"); if (!el) return; const [i, k] = el.dataset.rt.split(":"); R.tiers[i][k] = k === "disc" ? num(el.value) / 100 : Math.round(num(el.value)); };
  $("#rSave").onclick = saveRules;
  $$("[data-cap]").forEach((inp) => (inp.onchange = async () => {
    const v = inp.value.trim() === "" ? null : Math.min(90, Math.max(0, num(inp.value))) / 100;
    const { error } = await sb.from("products").update({ quote_max_disc: v }).eq("id", Number(inp.dataset.cap));
    if (error) return toast("No se pudo guardar el tope: " + error.message);
    const p = prod(inp.dataset.cap); if (p) p.quote_max_disc = v;
    toast(v == null ? `${p?.name}: sin tope` : `${p?.name}: tope ${Math.round(v * 100)} %`); drawRules();
  }));
}
const tierRow = (t, i) => `<div class="rtier"><label>Desde <input class="in" data-rt="${i}:min" inputmode="numeric" value="${t.min}"> u.</label><label>→ <input class="in" data-rt="${i}:disc" inputmode="decimal" value="${r2(t.disc * 100)}"> %</label><button type="button" class="chip-x" data-rtdel="${i}" aria-label="Quitar tramo">×</button></div>`;
async function saveRules() {
  const R = Q.rules;
  const target = num($("#rTarget").value) / 100, floor = num($("#rFloor").value) / 100;
  const err = $("#rErr"); err.textContent = "";
  if (!(floor > 0 && floor < 0.95 && target > 0 && target < 0.95)) { err.textContent = "Meta y piso deben estar entre 1 y 94 %."; return; }
  if (floor > target) { err.textContent = "El piso no puede ser mayor que la meta."; return; }
  const tiers = R.tiers.filter((t) => t.min > 0 && t.disc > 0).map((t) => ({ min: t.min, disc: Math.min(0.9, r2(t.disc * 10000) / 10000) })).sort((a, b) => a.min - b.min);
  const patch = {
    target_margin: target, floor_margin: floor, deposit_pct: Math.min(1, num($("#rDep").value) / 100),
    valid_days: Math.max(1, Math.round(num($("#rDays").value))), packaging_cost: num($("#rPack").value),
    round_to: num($("#rRound").value) || 0.05, tiers, terms: $("#rTerms").value.trim() || R.terms, updated_at: new Date().toISOString(),
  };
  const { data, error } = await sb.from("quote_rules").update(patch).eq("id", true).select().single();
  if (error) { err.textContent = "No se pudo guardar: " + error.message; return; }
  Q.rules = normRules(data); toast("Reglas guardadas"); drawRules();
}
