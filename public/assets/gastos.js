// The Bakery Side · Gastos (solo master). 25 nov 2026.
// Claude los registra cada semana (Uber, fotos de facturas, correos); también se agregan a mano.
// Resultado = lo que entra de las ventas (después de comisiones y tarifas) + envíos cobrados − gastos.
import { sb, $, $$, money, esc, toast, tableSearch } from "./common.js";

export const CATS = [
  ["insumos", "Insumos (ingredientes)", "#C68A4E"],
  ["empaque", "Empaque y envases", "#8C6A2F"],
  ["delivery", "Delivery (Uber)", "#2F5C8C"],
  ["publicidad", "Publicidad y redes", "#D33A4C"],
  ["servicios", "Luz, agua, gas, internet", "#3B8C8C"],
  ["software", "Apps, web y suscripciones", "#7A5BA6"],
  ["equipos", "Equipos y utensilios", "#5E8C61"],
  ["personal", "Ayudantes y sueldos", "#B0703A"],
  ["impuestos", "Impuestos y trámites", "#5C5049"],
  ["otros", "Otros", "#9A8F87"],
];
const catName = (k) => (CATS.find((c) => c[0] === k) || CATS.at(-1))[1];
const catColor = (k) => (CATS.find((c) => c[0] === k) || CATS.at(-1))[2];
const PAY = [["", "—"], ["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["otro", "Otro"]];
const SRC = { manual: "a mano", claude: "Claude", foto: "foto" };
const PRESETS = [["semana", "Esta semana"], ["semana_pasada", "Semana pasada"], ["mes", "Este mes"], ["mes_pasado", "Mes pasado"], ["30d", "Últimos 30 días"], ["anio", "Este año"]];
const G = { preset: "mes", from: null, to: null, edit: null, showForm: false };
let H; // ayudantes de master.js (fechas y ventas)

const pill = (cur, prev, ok, lowerIsGood = false) => {
  if (!ok) return "";
  if (!prev) return `<span class="vpill">nuevo</span>`;
  const c = Math.round((cur / prev - 1) * 100);
  const good = lowerIsGood ? c < 0 : c > 0;
  return `<span class="vpill ${c === 0 ? "" : good ? "up" : "down"}">${c > 0 ? "▲" : c < 0 ? "▼" : "="} ${Math.abs(c)} %</span>`;
};
const kpi = (lbl, val, p, sub, cls = "") => `<div class="vkpi ${cls}"><div class="vkpi-top"><span class="muted small">${lbl}</span>${p}</div><b>${val}</b><span class="muted small">${sub}</span></div>`;
const fmtDay = (s) => new Date(s + "T12:00:00Z").toLocaleDateString("es-EC", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(/\./g, "");

async function loadExpenses(from, to) {
  const { data, error } = await sb.from("expenses").select("*").gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  return data;
}
// Lo que entra de las ventas: «Te queda» de Ventas sin restar el envío gratis, más el envío que pagó el cliente.
// Así el costo real de cada Uber va completo en Gastos → Delivery y no se resta dos veces.
const income = (rows) => rows.reduce((s, r) => s + r.kept + (r.gift || 0) + (r.ship || 0), 0);
const sold = (rows) => rows.reduce((s, r) => s + r.sold, 0);
const shipIn = (rows) => rows.reduce((s, r) => s + (r.ship || 0), 0);

export async function renderGastos(view, helpers) {
  H = helpers;
  const today = H.todayGye();
  if (G.preset !== "custom") [G.from, G.to] = H.presetRange(G.preset);
  if (G.to > today) G.to = today;
  if (G.from > G.to) G.from = G.to;
  const [pf, pt] = H.prevRange(G.from, G.to);
  view.innerHTML = `<p class="muted">Cargando…</p>`;
  let ex, pex, sales, psales, pending;
  try {
    [ex, pex, sales, psales, { data: pending }] = await Promise.all([
      loadExpenses(G.from, G.to), loadExpenses(pf, pt), H.loadSales(G.from, G.to), H.loadSales(pf, pt),
      sb.from("expenses").select("*").neq("status", "ok").order("spent_on", { ascending: false }),
    ]);
  } catch (e) {
    view.innerHTML = `<div class="panel"><p class="err">${esc(/expenses|relation|schema cache/i.test(e.message) ? "Falta activar la tabla de gastos en la base de datos." : e.message)}</p></div>`;
    return;
  }
  const cnt = $("#cntExp"); if (cnt) { cnt.hidden = !pending.length; cnt.textContent = pending.length; }
  const ok = ex.filter((e) => e.status === "ok"), pok = pex.filter((e) => e.status === "ok");
  const spent = ok.reduce((s, e) => s + Number(e.amount), 0), pSpent = pok.reduce((s, e) => s + Number(e.amount), 0);
  const inc = income(sales), pInc = income(psales), vend = sold(sales);
  const res = inc - spent, pRes = pInc - pSpent;
  const cmpOk = pex.length > 0 || psales.length >= 5;
  const prevLbl = H.rangeLabel(pf, pt);

  // por categoría
  const byCat = {}; ok.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount)));
  const pByCat = {}; pok.forEach((e) => (pByCat[e.category] = (pByCat[e.category] || 0) + Number(e.amount)));
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats[0]?.[1] || 1;
  const nDel = sales.filter((r) => (r.ship || 0) > 0 || (r.gift || 0) > 0).length;

  view.innerHTML = `<div id="groot">
    <div class="panel vhead">
      <div class="vhead-row">
        <h2 class="display" style="font-size:30px;margin:0">Gastos</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label class="btn small ghost" style="cursor:pointer">📷 Subir foto de factura<input type="file" id="gPhoto" accept="image/*,application/pdf" multiple hidden></label>
          <button class="btn small primary" type="button" id="gAdd">＋ Agregar gasto</button>
        </div>
      </div>
      <div class="ctabs vpresets">${PRESETS.map(([k, l]) => `<button type="button" class="chip-btn" data-gp="${k}" aria-pressed="${G.preset === k}">${l}</button>`).join("")}</div>
      <div class="vrange">
        <div><label class="f" for="gFrom" style="margin-top:0">Desde</label><input class="in" type="date" id="gFrom" value="${G.from}" max="${today}"></div>
        <div><label class="f" for="gTo" style="margin-top:0">Hasta</label><input class="in" type="date" id="gTo" value="${G.to}" max="${today}"></div>
      </div>
      <div class="vnav"><div><b>${esc(H.cap(H.rangeLabel(G.from, G.to)))}</b><span class="muted small">${cmpOk ? `comparado con ${esc(prevLbl)}` : "sin datos del periodo anterior para comparar"}</span></div></div>
      <div id="gForm"></div>
      <div class="vkpis">
        ${kpi("Gastaste", money(spent), pill(spent, pSpent, cmpOk, true), `${ok.length} gastos${cmpOk ? ` · antes ${money(pSpent)}` : ""}`, "vkpi-dark")}
        ${kpi("Entró de las ventas", money(inc), pill(inc, pInc, cmpOk), `vendido ${money(vend)} + envíos ${money(shipIn(sales))}, ya sin comisiones`)}
        ${kpi("Resultado", `<span style="color:${res < 0 ? "var(--st-error)" : "inherit"}">${res < 0 ? "−" : ""}${money(Math.abs(res))}</span>`, pill(res, pRes, cmpOk && pRes > 0), inc ? `te quedan ${Math.round(res / inc * 100)} ¢ de cada $1 que entra` : "")}
        ${kpi("Gasto por día", money(spent / H.nDays(G.from, G.to)), "", vend ? `${Math.round(spent / vend * 100)} % de lo vendido` : "")}
      </div>
    </div>

    ${pending.length ? `<div class="panel" style="border-left:5px solid var(--tostado)"><h3 class="group-title" style="margin-top:0">Por revisar <span class="count">${pending.length}</span></h3>
      <p class="muted small" style="margin-top:0">No cuentan en el resultado hasta confirmarlos. Las fotos las lee Claude en la revisión semanal.</p>
      <div class="tbl-wrap"><table class="tbl"><tbody>${pending.map((e) => rowHTML(e, true)).join("")}</tbody></table></div></div>` : ""}

    <div class="vgrid2" style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
      <div class="panel"><h3 class="group-title" style="margin-top:0">En qué se va</h3>
        ${cats.length ? `<div class="vprods">${cats.map(([k, v]) => `<div class="vprod"><span class="vprod-n"><span class="vdot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${catColor(k)};margin-right:6px"></span>${esc(catName(k))}</span><b class="tabnum">${money(v)}</b>
          <div class="vprod-bar"><span style="width:${(v / maxCat * 100).toFixed(1)}%;background:${catColor(k)}"></span></div>
          <span class="muted small">${Math.round(v / spent * 100)} % de los gastos${vend ? ` · ${Math.round(v / vend * 100)} % de lo vendido` : ""}${cmpOk && pByCat[k] ? ` · antes ${money(pByCat[k])}` : ""}${k === "delivery" && nDel ? ` · ${money(v / nDel)} por entrega (cobraste ${money(shipIn(sales) / nDel)})` : ""}</span></div>`).join("")}</div>`
          : `<p class="muted">Sin gastos en este periodo.</p>`}
      </div>
      <div class="panel"><h3 class="group-title" style="margin-top:0">Cómo se calcula</h3>
        <p class="small" style="margin-top:0"><b>Entró de las ventas</b> = lo vendido en todos los canales menos comisiones de las apps y la tarifa de Payphone, más el envío que pagaron los clientes.</p>
        <p class="small"><b>Gastos</b> = todo lo que salió: insumos, empaque, cada Uber completo, publicidad, etc. Las comisiones de PedidosYa no van aquí porque ya están restadas arriba.</p>
        <p class="small"><b>Resultado</b> = entró − gastos. Las compras de insumos cuentan el día que se compran, así que una semana con compra grande se ve más baja y la siguiente más alta: mira el mes.</p>
        <p class="muted small" style="margin-bottom:0">Claude registra cada semana los viajes de Uber y las fotos de facturas que subas aquí. Lo que pagues en efectivo sin factura, agrégalo a mano.</p>
      </div>
    </div>

    <div class="panel" id="gList"><h3 class="group-title" style="margin-top:0">Todos los gastos del periodo</h3>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Día</th><th>Categoría</th><th>Detalle</th><th>Monto</th><th></th></tr></thead>
      <tbody>${ex.filter((e) => e.status === "ok").map((e) => rowHTML(e)).join("") || `<tr><td colspan="5" class="muted">Sin gastos en este periodo.</td></tr>`}</tbody></table></div>
    </div>
  </div>`;

  $$("[data-gp]", view).forEach((b) => (b.onclick = () => { G.preset = b.dataset.gp; renderGastos(view, H); }));
  ["gFrom", "gTo"].forEach((id) => ($("#" + id).onchange = () => { G.preset = "custom"; G.from = $("#gFrom").value; G.to = $("#gTo").value; renderGastos(view, H); }));
  $("#gAdd").onclick = () => { G.edit = null; drawForm(view); };
  $("#gPhoto").onchange = (ev) => uploadPhotos([...ev.target.files], view);
  tableSearch($("#gList"), "Buscar gasto…");
  wireRows(view, [...ex, ...pending]);
  if (G.showForm) drawForm(view);
}

function rowHTML(e, pending = false) {
  const amt = e.amount == null ? `<span class="muted">—</span>` : money(e.amount);
  const tag = e.status === "por_leer" ? `<span class="vtag">foto por leer</span>` : e.status === "revisar" ? `<span class="vtag">revisar</span>` : "";
  return `<tr data-id="${e.id}"><td class="small tabnum" style="white-space:nowrap">${fmtDay(e.spent_on)}</td>
    <td class="small"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${catColor(e.category)};margin-right:5px"></span>${esc(catName(e.category))}</td>
    <td class="small"><b>${esc(e.description || "(sin detalle)")}</b>${e.supplier ? ` · ${esc(e.supplier)}` : ""} ${tag}${e.repeat_monthly ? ` <span class="vtag">fijo mensual</span>` : ""}
      <br><span class="muted">${esc(SRC[e.source] || e.source)}${e.payment_method ? ` · ${esc(e.payment_method)}` : ""}${e.notes ? ` · ${esc(e.notes)}` : ""}</span></td>
    <td class="tabnum">${amt}</td>
    <td><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end">
      ${e.receipt_path ? `<button class="btn small ghost" data-photo="${e.id}" type="button">Ver foto</button>` : ""}
      ${pending && e.status === "revisar" ? `<button class="btn small primary" data-okx="${e.id}" type="button">Es del negocio</button>` : ""}
      <button class="btn small ghost" data-edit="${e.id}" type="button">Editar</button>
      <button class="btn small ghost" data-del="${e.id}" type="button">${pending && e.status === "revisar" ? "No es del negocio" : "Borrar"}</button></div></td></tr>`;
}

function wireRows(view, all) {
  const byId = (id) => all.find((e) => e.id === Number(id));
  $$("[data-edit]", view).forEach((b) => (b.onclick = () => { G.edit = byId(b.dataset.edit); drawForm(view); }));
  $$("[data-photo]", view).forEach((b) => (b.onclick = async () => {
    const { data, error } = await sb.storage.from("gastos").createSignedUrl(byId(b.dataset.photo).receipt_path, 600);
    if (error) return toast(error.message);
    window.open(data.signedUrl, "_blank", "noopener");
  }));
  $$("[data-okx]", view).forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from("expenses").update({ status: "ok", updated_at: new Date().toISOString() }).eq("id", b.dataset.okx);
    if (error) return toast(error.message);
    toast("Gasto confirmado"); renderGastos(view, H);
  }));
  $$("[data-del]", view).forEach((b) => (b.onclick = () => {
    const tr = b.closest("tr"); if (tr.nextElementSibling?.classList.contains("gask")) { tr.nextElementSibling.remove(); return; }
    const e = byId(b.dataset.del);
    const ask = document.createElement("tr"); ask.className = "gask";
    ask.innerHTML = `<td colspan="5"><div class="confirm-row"><span class="small" style="flex:1">¿Borrar «${esc(e.description || "gasto")}»${e.amount != null ? ` de ${money(e.amount)}` : ""}? No se puede deshacer.</span><button class="btn small primary" type="button">Sí, borrar</button><button class="btn small ghost" type="button">Cancelar</button></div></td>`;
    const [yes, no] = ask.querySelectorAll("button");
    no.onclick = () => ask.remove();
    yes.onclick = async () => {
      yes.disabled = true;
      // Un Uber marcado como personal se guarda como nota para que Claude no lo vuelva a registrar
      if (e.source_ref && e.status === "revisar") {
        const { error } = await sb.from("expenses").update({ status: "ok", amount: 0, category: "otros", description: "Personal (no es del negocio)", notes: `${e.description || ""} ${e.amount != null ? money(e.amount) : ""}`.trim(), updated_at: new Date().toISOString() }).eq("id", e.id);
        if (error) { yes.disabled = false; return toast(error.message); }
      } else {
        const { error } = await sb.from("expenses").delete().eq("id", e.id);
        if (error) { yes.disabled = false; return toast(error.message); }
        if (e.receipt_path) await sb.storage.from("gastos").remove([e.receipt_path]);
      }
      toast("Listo"); renderGastos(view, H);
    };
    tr.after(ask);
  }));
}

function drawForm(view) {
  G.showForm = true;
  const e = G.edit || {}, today = H.todayGye();
  const box = $("#gForm", view);
  box.innerHTML = `<div class="panel" style="background:var(--surface-2);margin:0">
    <h3 class="group-title" style="margin-top:0">${e.id ? "Editar gasto" : "Nuevo gasto"}</h3>
    <div class="form-grid">
      <div><label class="f" for="fDay">Día</label><input class="in" type="date" id="fDay" value="${e.spent_on || today}" max="${today}"></div>
      <div><label class="f" for="fAmt">Monto pagado ($)</label><input class="in" type="number" id="fAmt" step="0.01" min="0" inputmode="decimal" value="${e.amount ?? ""}" placeholder="0,00"></div>
      <div><label class="f" for="fCat">Categoría</label><select class="in" id="fCat">${CATS.map(([k, l]) => `<option value="${k}" ${(e.category || "insumos") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div><label class="f" for="fPay">Forma de pago</label><select class="in" id="fPay">${PAY.map(([k, l]) => `<option value="${k}" ${(e.payment_method || "") === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div style="grid-column:1/-1"><label class="f" for="fDesc">Qué se compró</label><input class="in" id="fDesc" maxlength="160" value="${esc(e.description || "")}" placeholder="Ej.: 2 kg de mantequilla, 1 Nutella 3 kg"></div>
      <div><label class="f" for="fSup">Dónde / a quién <span class="hint">(opcional)</span></label><input class="in" id="fSup" maxlength="80" value="${esc(e.supplier || "")}" placeholder="Ej.: Supermaxi, Mi Comisariato"></div>
      <div><label class="f" for="fNotes">Nota <span class="hint">(opcional)</span></label><input class="in" id="fNotes" maxlength="200" value="${esc(e.notes || "")}"></div>
      <div><label class="f" for="fFile">Foto de la factura <span class="hint">(opcional)</span></label><input class="in" type="file" id="fFile" accept="image/*,application/pdf"></div>
    </div>
    <label class="check" style="margin:10px 0"><input type="checkbox" id="fRep" ${e.repeat_monthly ? "checked" : ""}> <span>Gasto fijo: se repite cada mes <span class="muted small">(Claude lo vuelve a poner el mismo día de cada mes)</span></span></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" id="fSave">${e.id ? "Guardar cambios" : "Agregar gasto"}</button><button class="btn ghost" type="button" id="fCancel">Cancelar</button></div>
  </div>`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  $("#fCancel").onclick = () => { G.showForm = false; G.edit = null; box.innerHTML = ""; };
  $("#fSave").onclick = async () => {
    const amount = Number(String($("#fAmt").value).replace(",", "."));
    const description = $("#fDesc").value.trim();
    if (!(amount >= 0) || $("#fAmt").value === "") return toast("Pon el monto.");
    if (!description) return toast("Escribe qué se compró.");
    const btn = $("#fSave"); btn.disabled = true;
    const row = { spent_on: $("#fDay").value || today, amount, category: $("#fCat").value, payment_method: $("#fPay").value || null, description,
      supplier: $("#fSup").value.trim() || null, notes: $("#fNotes").value.trim() || null, repeat_monthly: $("#fRep").checked, updated_at: new Date().toISOString() };
    if (e.status === "por_leer" || e.status === "revisar") row.status = "ok";
    const file = $("#fFile").files[0];
    if (file) { const p = await uploadFile(file); if (!p) { btn.disabled = false; return; } row.receipt_path = p; }
    const q = e.id ? sb.from("expenses").update(row).eq("id", e.id) : sb.from("expenses").insert({ ...row, source: "manual" });
    const { error } = await q;
    if (error) { btn.disabled = false; return toast(error.message); }
    if (file && e.receipt_path && e.receipt_path !== row.receipt_path) await sb.storage.from("gastos").remove([e.receipt_path]);
    toast(e.id ? "Gasto actualizado" : "Gasto agregado");
    G.showForm = false; G.edit = null;
    renderGastos(view, H);
  };
}

async function shrink(file, max = 1600) {
  if (!/^image\//.test(file.type) || /heic/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const b = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return b && b.size < file.size ? b : file;
  } catch { return file; }
}
async function uploadFile(file) {
  const b = await shrink(file);
  const ext = b.type === "application/pdf" ? "pdf" : b.type === "image/png" ? "png" : b.type === "image/webp" ? "webp" : /heic/i.test(b.type) ? "heic" : "jpg";
  const path = `${H.todayGye().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from("gastos").upload(path, b, { contentType: b.type || "image/jpeg" });
  if (error) { toast(error.message); return null; }
  return path;
}
async function uploadPhotos(files, view) {
  if (!files.length) return;
  let n = 0;
  for (const f of files) {
    toast(`Subiendo ${n + 1} de ${files.length}…`);
    const path = await uploadFile(f); if (!path) continue;
    const { error } = await sb.from("expenses").insert({ status: "por_leer", source: "foto", receipt_path: path, category: "otros", description: "Foto de factura por leer", spent_on: H.todayGye() });
    if (error) { toast(error.message); continue; }
    n++;
  }
  if (n) toast(n === 1 ? "Foto subida. Claude la lee en la revisión semanal." : `${n} fotos subidas. Claude las lee en la revisión semanal.`, 4000);
  renderGastos(view, H);
}
