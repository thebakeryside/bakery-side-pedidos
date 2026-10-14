// The Bakery Side · Costos y rentabilidad (solo master)
// Insumos (ingredientes y envases) → Recetas (cuánto rinden y qué llevan) → Cómo se vende (presentación + su envase + precio)
import { sb, $, $$, money, esc, toast, tableSearch } from "./common.js";

const C = { view: "resumen", recipe: null, data: null };
const UNITS = ["g", "ml", "uni"];
const pct = (x) => (isFinite(x) ? `${Math.round(x * 100)}%` : "—");
const num = (v) => Number(String(v ?? "").replace(",", ".")) || 0;

async function load() {
  const [st, items, recipes, ri, pres, pi, prods] = await Promise.all([
    sb.from("settings").select("cost_target_margin,iva_rate").single(),
    sb.from("cost_items").select("*").order("kind").order("name"),
    sb.from("cost_recipes").select("*").order("name"),
    sb.from("cost_recipe_items").select("*").order("id"),
    sb.from("cost_presentations").select("*").order("id"),
    sb.from("cost_presentation_items").select("*").order("id"),
    sb.from("products").select("id,name,price,active,categories(name,sort)").order("sort"),
  ]);
  const err = [st, items, recipes, ri, pres, pi, prods].find((r) => r.error);
  if (err) throw err.error;
  C.data = {
    target: Number(st.data.cost_target_margin ?? 0.65), iva: Number(st.data.iva_rate ?? 0.15),
    items: items.data, recipes: recipes.data, ri: ri.data, pres: pres.data, pi: pi.data,
    prods: prods.data.filter((p) => !/sorpresa/i.test(p.name)),
  };
}

// ---------- cálculos ----------
const D = () => C.data;
const item = (id) => D().items.find((i) => i.id === Number(id));
const unitCost = (it) => (it ? (Number(it.price) * (it.iva ? 1 + D().iva : 1)) / Number(it.pack_qty) : 0);
const recipeCost = (rows) => rows.reduce((s, r) => s + unitCost(item(r.item_id)) * num(r.qty), 0);
const presCost = (p, perUnit, packRows) => perUnit * num(p.units) + recipeCost(packRows);
const presPrice = (p) => (p.product_id ? Number(D().prods.find((x) => x.id === Number(p.product_id))?.price ?? 0) : num(p.price));
const margin = (price, cost) => (price > 0 ? (price - cost) / price : NaN);
const suggested = (cost) => cost / (1 - D().target);
function level(m) {
  const t = D().target;
  if (!isFinite(m)) return "";
  return m >= t ? "ok" : m >= t - 0.15 ? "warn" : "bad";
}
function allRows() {
  return D().pres.map((p) => {
    const r = D().recipes.find((x) => x.id === p.recipe_id);
    const per = recipeCost(D().ri.filter((x) => x.recipe_id === r.id)) / Number(r.yield_qty);
    const cost = presCost(p, per, D().pi.filter((x) => x.presentation_id === p.id));
    const price = presPrice(p);
    return { p, r, cost, price, m: margin(price, cost) };
  });
}

// ---------- vista principal ----------
export async function costos() {
  const view = $("#view");
  view.innerHTML = `<p class="muted">Cargando…</p>`;
  try { await load(); } catch (e) { view.innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  draw();
}
function draw() {
  const view = $("#view");
  const tabs = [["resumen", "Rentabilidad"], ["recetas", "Recetas"], ["insumos", "Insumos y envases"]];
  view.innerHTML = `<div class="panel">
    <div class="ctabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" class="chip-btn" data-cv="${k}" aria-pressed="${C.view === k && !C.recipe}">${l}</button>`).join("")}</div>
    <div id="cBody"></div></div>`;
  $$("[data-cv]", view).forEach((b) => (b.onclick = () => { C.view = b.dataset.cv; C.recipe = null; draw(); }));
  if (C.recipe) return drawRecipe();
  ({ resumen: drawSummary, recetas: drawRecipes, insumos: drawItems })[C.view]();
}

// ---------- rentabilidad ----------
function drawSummary() {
  const rows = allRows().sort((a, b) => (isFinite(a.m) ? a.m : -9) - (isFinite(b.m) ? b.m : -9));
  const valid = rows.filter((x) => isFinite(x.m));
  const avg = valid.length ? valid.reduce((s, x) => s + x.m, 0) / valid.length : NaN;
  const costed = new Set(D().pres.map((p) => p.product_id).filter(Boolean));
  const missing = D().prods.filter((p) => p.active && !costed.has(p.id));
  $("#cBody").innerHTML = `
    <div class="cset">
      <label>Meta de margen <input class="in" id="cTarget" type="number" min="0" max="95" step="1" value="${Math.round(D().target * 100)}"> %</label>
      <label>IVA de compra <input class="in" id="cIva" type="number" min="0" max="30" step="1" value="${Math.round(D().iva * 100)}"> %</label>
      <button class="btn small" id="cSaveSet" type="button">Guardar</button>
    </div>
    <div class="stats" style="margin:12px 0">
      <div><b class="${level(avg)}">${pct(avg)}</b>margen promedio</div>
      <div><b>${pct(D().target)}</b>meta</div>
      <div><b>${valid.filter((x) => x.m >= D().target).length} / ${valid.length}</b>productos en la meta</div>
    </div>
    <p class="muted small" style="margin:0 0 8px">Ordenado del menos al más rentable. <b>Costo</b> = ingredientes (con IVA) de las unidades que lleva + su envase. <b>Precio sugerido</b> = el precio para llegar a la meta.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Receta</th><th>Costo</th><th>Precio</th><th>Ganancia</th><th>Margen</th><th>Precio sugerido</th></tr></thead><tbody>
      ${rows.map(({ p, r, cost, price, m }) => `<tr>
        <td><b>${esc(p.name)}</b>${p.product_id ? ` <span class="muted small">· menú</span>` : ""}</td>
        <td><button type="button" class="linkbtn" data-open="${r.id}">${esc(r.name)}</button></td>
        <td class="tabnum">${money(cost)}</td><td class="tabnum">${price ? money(price) : "—"}</td>
        <td class="tabnum">${price ? money(price - cost) : "—"}</td>
        <td class="tabnum"><span class="mchip ${level(m)}">${pct(m)}</span></td>
        <td class="tabnum">${money(suggested(cost))}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Aún no hay recetas con presentaciones.</td></tr>`}
    </tbody></table></div>
    ${missing.length ? `<p class="muted small" style="margin-top:12px"><b>Sin costear todavía (${missing.length}):</b> ${missing.map((p) => esc(p.name)).join(" · ")}</p>` : ""}`;
  tableSearch($("#cBody"), "Buscar producto o receta…");
  $$("[data-open]").forEach((b) => (b.onclick = () => openRecipe(Number(b.dataset.open))));
  $("#cSaveSet").onclick = async () => {
    const t = num($("#cTarget").value) / 100, iva = num($("#cIva").value) / 100;
    if (!(t > 0 && t < 0.96)) return toast("Revisa la meta de margen.");
    const { error } = await sb.from("settings").update({ cost_target_margin: t, iva_rate: iva }).eq("id", true);
    if (error) return toast(error.message);
    D().target = t; D().iva = iva; toast("Guardado"); draw();
  };
}

// ---------- lista de recetas ----------
function drawRecipes() {
  $("#cBody").innerHTML = `
    <p class="muted small">Cada receta dice cuánto rinde (porciones, alfajores, 1 torta…). Dentro de cada una defines <b>cómo se vende</b>: por porción, por caja de 6, entera… cada presentación con su envase y su precio.</p>
    <div class="ccards">${D().recipes.map((r) => {
      const total = recipeCost(D().ri.filter((x) => x.recipe_id === r.id));
      const n = D().pres.filter((p) => p.recipe_id === r.id).length;
      return `<button type="button" class="ccard" data-open="${r.id}"><b>${esc(r.name)}</b>
        <span>Rinde ${Number(r.yield_qty)} ${esc(r.yield_unit)}</span>
        <span>Receta ${money(total)} · ${money(total / Number(r.yield_qty))} c/u</span>
        <span class="muted small">${n} ${n === 1 ? "presentación" : "presentaciones"}</span></button>`;
    }).join("")}
      <button type="button" class="ccard add" id="cNew">＋ Nueva receta</button></div>`;
  $$("[data-open]").forEach((b) => (b.onclick = () => openRecipe(Number(b.dataset.open))));
  $("#cNew").onclick = () => openRecipe(null);
}

// ---------- editor de receta (todo en memoria hasta Guardar) ----------
function openRecipe(id) {
  const r = id ? D().recipes.find((x) => x.id === id) : { id: null, name: "", yield_qty: 1, yield_unit: "porciones" };
  C.recipe = {
    id: r.id, name: r.name, yield_qty: Number(r.yield_qty), yield_unit: r.yield_unit,
    rows: D().ri.filter((x) => x.recipe_id === id).map((x) => ({ item_id: x.item_id, qty: Number(x.qty) })),
    pres: D().pres.filter((p) => p.recipe_id === id).map((p) => ({
      name: p.name, product_id: p.product_id, units: Number(p.units), price: p.price,
      pack: D().pi.filter((x) => x.presentation_id === p.id).map((x) => ({ item_id: x.item_id, qty: Number(x.qty) })),
    })),
  };
  if (!id) C.recipe.rows.push({ item_id: "", qty: 0 });
  draw();
}
function itemOpts(sel, kind) {
  const list = D().items.filter((i) => !kind || i.kind === kind);
  return `<option value="">Elegir…</option>` + list.map((i) => `<option value="${i.id}" ${Number(sel) === i.id ? "selected" : ""}>${esc(i.name)} (${i.unit})</option>`).join("");
}
function prodOpts(sel) {
  return `<option value="">— No está en el menú (precio manual) —</option>` +
    D().prods.map((p) => `<option value="${p.id}" ${Number(sel) === p.id ? "selected" : ""}>${esc(p.name)} · ${money(p.price)}</option>`).join("");
}
function drawRecipe() {
  const R = C.recipe;
  const total = recipeCost(R.rows), per = R.yield_qty > 0 ? total / R.yield_qty : 0;
  $("#cBody").innerHTML = `
    <button type="button" class="btn small ghost" id="cBack">← Volver</button>
    <div class="form-grid" style="margin-top:10px">
      <div><label class="f" for="rName">Receta</label><input class="in" id="rName" value="${esc(R.name)}" placeholder="Ej.: Alfajores de brownie"></div>
      <div><label class="f" for="rYield">Rinde</label><div class="mdep-row"><input class="in" id="rYield" type="number" min="0.01" step="any" value="${R.yield_qty}" style="max-width:100px"><input class="in" id="rUnit" value="${esc(R.yield_unit)}" placeholder="porciones, alfajores, torta…"></div></div>
    </div>

    <h3 class="group-title">Ingredientes</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Insumo</th><th>Cantidad</th><th>Costo</th><th></th></tr></thead><tbody>
      ${R.rows.map((x, k) => `<tr><td><select class="in" data-ri="${k}" data-f="item_id" style="min-width:200px">${itemOpts(x.item_id)}</select></td>
        <td><div class="mdep-row"><input class="in" data-ri="${k}" data-f="qty" type="number" min="0" step="any" value="${x.qty}" style="max-width:110px"><span class="muted small">${esc(item(x.item_id)?.unit || "")}</span></div></td>
        <td class="tabnum">${money(unitCost(item(x.item_id)) * num(x.qty))}</td>
        <td><button type="button" class="btn small ghost" data-rdel="${k}" aria-label="Quitar">✕</button></td></tr>`).join("")}
    </tbody></table></div>
    <button type="button" class="btn small" id="rAdd" style="margin-top:8px">＋ Ingrediente</button>
    <div class="ctotal"><span>Costo de la receta <b>${money(total)}</b></span><span>Por ${esc(singular(R.yield_unit))} <b>${money(per)}</b></span></div>

    <h3 class="group-title">Cómo se vende</h3>
    <p class="muted small" style="margin-top:0">Cada presentación usa una cantidad de ${esc(R.yield_unit || "unidades")} de esta receta y su propio envase. Si está en el menú, toma el precio real de la tienda.</p>
    <div class="cpres">${R.pres.map((p, k) => {
      const cost = per * num(p.units) + recipeCost(p.pack), price = p.product_id ? presPrice(p) : num(p.price), m = margin(price, cost);
      return `<div class="cp">
        <div class="form-grid">
          <div><label class="f">Nombre</label><input class="in" data-pk="${k}" data-f="name" value="${esc(p.name)}" placeholder="Ej.: Caja x6"></div>
          <div><label class="f">Producto del menú</label><select class="in" data-pk="${k}" data-f="product_id">${prodOpts(p.product_id)}</select></div>
          <div><label class="f">Lleva (${esc(R.yield_unit || "unidades")})</label><input class="in" data-pk="${k}" data-f="units" type="number" min="0.01" step="any" value="${p.units}"></div>
          <div><label class="f">Precio de venta $</label><input class="in" data-pk="${k}" data-f="price" type="number" min="0" step="0.01" value="${p.product_id ? presPrice(p) : p.price ?? ""}" ${p.product_id ? "disabled title=\"Se cambia en Menú\"" : ""}></div>
        </div>
        <div class="cpack">${p.pack.map((x, j) => `<div class="mdep-row"><select class="in" data-pk="${k}" data-pj="${j}" data-f="item_id">${itemOpts(x.item_id, "envase")}</select><input class="in" data-pk="${k}" data-pj="${j}" data-f="qty" type="number" min="0" step="any" value="${x.qty}" style="max-width:80px" aria-label="Cantidad"><span class="tabnum small">${money(unitCost(item(x.item_id)) * num(x.qty))}</span><button type="button" class="btn small ghost" data-pkdel="${k}" data-pj="${j}" aria-label="Quitar">✕</button></div>`).join("")}
          <button type="button" class="btn small ghost" data-pkadd="${k}">＋ Envase / sticker</button></div>
        <div class="ctotal"><span>Costo <b>${money(cost)}</b></span><span>Precio <b>${price ? money(price) : "—"}</b></span><span>Margen <span class="mchip ${level(m)}">${pct(m)}</span></span><span>Sugerido <b>${money(suggested(cost))}</b></span>
          <button type="button" class="btn small ghost" data-pdel="${k}">Quitar presentación</button></div>
      </div>`;
    }).join("")}</div>
    <button type="button" class="btn small" id="pAdd" style="margin-top:8px">＋ Presentación</button>

    <div class="row-btns" style="margin-top:18px">
      <button type="button" class="btn primary" id="rSave">Guardar receta</button>
      ${R.id ? `<span class="confirm-host"><button type="button" class="btn ghost" id="rDel">Eliminar receta</button></span>` : ""}
    </div>`;

  const body = $("#cBody");
  $("#cBack").onclick = () => { C.recipe = null; C.view = "recetas"; draw(); };
  $("#rName").oninput = (e) => (R.name = e.target.value);
  $("#rUnit").onchange = (e) => { R.yield_unit = e.target.value; drawRecipe(); };
  $("#rYield").onchange = (e) => { R.yield_qty = num(e.target.value); drawRecipe(); };
  $$("[data-ri]", body).forEach((el) => (el.onchange = () => { R.rows[el.dataset.ri][el.dataset.f] = el.dataset.f === "qty" ? num(el.value) : el.value; drawRecipe(); }));
  $$("[data-rdel]", body).forEach((b) => (b.onclick = () => { R.rows.splice(b.dataset.rdel, 1); drawRecipe(); }));
  $("#rAdd").onclick = () => { R.rows.push({ item_id: "", qty: 0 }); drawRecipe(); };
  $$("[data-pk]", body).forEach((el) => (el.onchange = () => {
    const p = R.pres[el.dataset.pk];
    if (el.dataset.pj != null) p.pack[el.dataset.pj][el.dataset.f] = el.dataset.f === "qty" ? num(el.value) : el.value;
    else p[el.dataset.f] = ["units", "price"].includes(el.dataset.f) ? num(el.value) : el.dataset.f === "product_id" ? (el.value ? Number(el.value) : null) : el.value;
    if (el.dataset.f === "product_id" && el.value && !p.name) p.name = D().prods.find((x) => x.id === Number(el.value))?.name || "";
    drawRecipe();
  }));
  $$("[data-pkadd]", body).forEach((b) => (b.onclick = () => { R.pres[b.dataset.pkadd].pack.push({ item_id: "", qty: 1 }); drawRecipe(); }));
  $$("[data-pkdel]", body).forEach((b) => (b.onclick = () => { R.pres[b.dataset.pkdel].pack.splice(b.dataset.pj, 1); drawRecipe(); }));
  $$("[data-pdel]", body).forEach((b) => (b.onclick = () => { R.pres.splice(b.dataset.pdel, 1); drawRecipe(); }));
  $("#pAdd").onclick = () => { R.pres.push({ name: "", product_id: null, units: 1, price: null, pack: [] }); drawRecipe(); };
  $("#rSave").onclick = saveRecipe;
  $("#rDel")?.addEventListener("click", (e) => confirmInline(e.target, `¿Eliminar la receta «${esc(R.name)}» y sus presentaciones?`, async () => {
    const { error } = await sb.from("cost_recipes").delete().eq("id", R.id);
    if (error) return toast(error.message);
    toast("Receta eliminada"); C.recipe = null; C.view = "recetas"; await load(); draw();
  }));
}
const singular = (u) => String(u || "unidad").replace(/es$/, "").replace(/s$/, "") || "unidad";

async function saveRecipe() {
  const R = C.recipe;
  const btn = $("#rSave");
  if (!R.name.trim()) return toast("Escribe el nombre de la receta.");
  if (!(R.yield_qty > 0)) return toast("Indica cuánto rinde la receta.");
  const rows = R.rows.filter((x) => x.item_id && num(x.qty) > 0);
  const pres = R.pres.filter((p) => p.name.trim() || p.product_id);
  if (pres.some((p) => !(num(p.units) > 0))) return toast("Cada presentación debe llevar una cantidad mayor a 0.");
  btn.disabled = true; btn.textContent = "Guardando…";
  try {
    const head = { name: R.name.trim(), yield_qty: R.yield_qty, yield_unit: R.yield_unit.trim() || "porciones", updated_at: new Date().toISOString() };
    let id = R.id;
    if (id) { const { error } = await sb.from("cost_recipes").update(head).eq("id", id); if (error) throw error; }
    else { const { data, error } = await sb.from("cost_recipes").insert(head).select("id").single(); if (error) throw error; id = data.id; }
    // se reemplazan ingredientes y presentaciones de esta receta
    let r = await sb.from("cost_recipe_items").delete().eq("recipe_id", id); if (r.error) throw r.error;
    r = await sb.from("cost_presentations").delete().eq("recipe_id", id); if (r.error) throw r.error;
    if (rows.length) { r = await sb.from("cost_recipe_items").insert(rows.map((x) => ({ recipe_id: id, item_id: Number(x.item_id), qty: num(x.qty) }))); if (r.error) throw r.error; }
    for (const p of pres) {
      const { data, error } = await sb.from("cost_presentations").insert({
        recipe_id: id, name: (p.name || "").trim() || D().prods.find((x) => x.id === p.product_id)?.name || "Presentación",
        product_id: p.product_id || null, units: num(p.units), price: p.product_id ? null : (p.price != null && p.price !== "" ? num(p.price) : null),
      }).select("id").single();
      if (error) throw error;
      const pack = p.pack.filter((x) => x.item_id && num(x.qty) > 0);
      if (pack.length) { const e2 = await sb.from("cost_presentation_items").insert(pack.map((x) => ({ presentation_id: data.id, item_id: Number(x.item_id), qty: num(x.qty) }))); if (e2.error) throw e2.error; }
    }
    toast("Receta guardada");
    await load(); openRecipe(id);
  } catch (e) { toast("No se pudo guardar: " + e.message); btn.disabled = false; btn.textContent = "Guardar receta"; }
}

// ---------- insumos y envases ----------
function drawItems() {
  const used = new Set([...D().ri.map((x) => x.item_id), ...D().pi.map((x) => x.item_id)]);
  const row = (i) => `<tr data-iid="${i.id}">
    <td><input class="in" data-f="name" value="${esc(i.name)}" style="min-width:170px" aria-label="Nombre"></td>
    <td><select class="in" data-f="kind" aria-label="Tipo"><option value="ingrediente" ${i.kind === "ingrediente" ? "selected" : ""}>Ingrediente</option><option value="envase" ${i.kind === "envase" ? "selected" : ""}>Envase / sticker</option></select></td>
    <td><input class="in" data-f="price" type="number" min="0" step="0.01" value="${Number(i.price)}" style="width:90px" aria-label="Precio sin IVA"></td>
    <td><label class="small"><input type="checkbox" data-f="iva" ${i.iva ? "checked" : ""}> Sí</label></td>
    <td><div class="mdep-row"><input class="in" data-f="pack_qty" type="number" min="0.001" step="any" value="${Number(i.pack_qty)}" style="width:90px" aria-label="Contenido del paquete"><select class="in" data-f="unit" style="width:76px" aria-label="Unidad">${UNITS.map((u) => `<option ${u === i.unit ? "selected" : ""}>${u}</option>`).join("")}</select></div></td>
    <td class="tabnum">${money(unitCost(i))}<span class="muted small"> / ${i.unit}</span></td>
    <td><div style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn small" data-isave="${i.id}" type="button">Guardar</button>${used.has(i.id) ? "" : `<button class="btn small ghost" data-idel="${i.id}" type="button">Eliminar</button>`}</div></td></tr>`;
  const head = `<thead><tr><th>Nombre</th><th>Tipo</th><th>Precio sin IVA $</th><th>Paga IVA</th><th>Contenido del paquete</th><th>Costo por unidad</th><th></th></tr></thead>`;
  $("#cBody").innerHTML = `
    <p class="muted small">Cambia el precio aquí y se actualiza en todas las recetas. El precio es <b>sin IVA</b>; marca "Paga IVA" si al comprarlo te cobran IVA (${Math.round(D().iva * 100)}%). Los insumos que ya se usan en una receta no se pueden eliminar.</p>
    <h3 class="group-title">Ingredientes</h3>
    <div class="tbl-wrap"><table class="tbl">${head}<tbody>${D().items.filter((i) => i.kind === "ingrediente").map(row).join("")}</tbody></table></div>
    <h3 class="group-title">Envases y stickers</h3>
    <div class="tbl-wrap"><table class="tbl">${head}<tbody>${D().items.filter((i) => i.kind === "envase").map(row).join("")}</tbody></table></div>
    <h3 class="group-title">Nuevo insumo</h3>
    <form id="iForm" class="form-grid" novalidate>
      <div><label class="f" for="iName">Nombre</label><input class="in" id="iName" placeholder="Ej.: Caja x6 kraft"></div>
      <div><label class="f" for="iKind">Tipo</label><select class="in" id="iKind"><option value="ingrediente">Ingrediente</option><option value="envase">Envase / sticker</option></select></div>
      <div><label class="f" for="iPrice">Precio sin IVA $</label><input class="in" id="iPrice" type="number" min="0" step="0.01"></div>
      <div><label class="f" for="iQty">Contenido del paquete</label><div class="mdep-row"><input class="in" id="iQty" type="number" min="0.001" step="any" placeholder="Ej.: 1000"><select class="in" id="iUnit" style="width:80px">${UNITS.map((u) => `<option>${u}</option>`).join("")}</select></div></div>
      <div><label class="check"><input type="checkbox" id="iIva" checked> Paga IVA</label></div>
      <div style="align-self:end"><button class="btn primary block">Agregar</button></div>
    </form>`;
  tableSearch($("#cBody"), "Buscar insumo…");
  $$("[data-isave]").forEach((b) => (b.onclick = async () => {
    const tr = b.closest("tr"), f = (k) => tr.querySelector(`[data-f="${k}"]`);
    const patch = { name: f("name").value.trim(), kind: f("kind").value, price: num(f("price").value), iva: f("iva").checked, pack_qty: num(f("pack_qty").value), unit: f("unit").value, updated_at: new Date().toISOString() };
    if (!patch.name || !(patch.pack_qty > 0)) return toast("Revisa el nombre y el contenido del paquete.");
    const { error } = await sb.from("cost_items").update(patch).eq("id", Number(b.dataset.isave));
    if (error) return toast(error.message);
    Object.assign(item(b.dataset.isave), patch); toast("Guardado"); drawItems();
  }));
  $$("[data-idel]").forEach((b) => (b.onclick = () => confirmInline(b, "¿Eliminar este insumo?", async () => {
    const { error } = await sb.from("cost_items").delete().eq("id", Number(b.dataset.idel));
    if (error) return toast(/foreign key/i.test(error.message) ? "Se usa en una receta; quítalo primero de la receta." : error.message);
    toast("Eliminado"); await load(); drawItems();
  })));
  $("#iForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = { name: $("#iName").value.trim(), kind: $("#iKind").value, price: num($("#iPrice").value), pack_qty: num($("#iQty").value), unit: $("#iUnit").value, iva: $("#iIva").checked };
    if (!row.name || !(row.pack_qty > 0)) return toast("Escribe el nombre y el contenido del paquete.");
    const { error } = await sb.from("cost_items").insert(row);
    if (error) return toast(error.message);
    toast("Insumo agregado"); await load(); drawItems();
  };
}

// Confirmación en la página (sin ventanas del navegador)
function confirmInline(btn, text, onYes) {
  const host = btn.closest("tr, .confirm-host") || btn.parentElement;
  const old = host.querySelector(".ask"); if (old) { old.remove(); return; }
  const box = document.createElement("div");
  box.className = "ask confirm-row"; box.style.marginTop = "8px";
  box.innerHTML = `<span class="small" style="flex:1;min-width:180px">${text}</span><button class="btn small primary" type="button">Sí, eliminar</button><button class="btn small ghost" type="button">Cancelar</button>`;
  const [yes, no] = box.querySelectorAll("button");
  yes.onclick = async () => { yes.disabled = true; await onYes(); };
  no.onclick = () => box.remove();
  (host.querySelector("td:last-child") || host).append(box);
}
