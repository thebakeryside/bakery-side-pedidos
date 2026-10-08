import { sb, $, $$, money, esc, toast } from "./common.js";
import { requireLogin, loginHTML } from "./auth.js";
import { renderManual } from "./manual.js";

$("#loginSlot").innerHTML = loginHTML("Panel master");
const S = { tab: "ventas", month: new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 7) };
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Guayaquil" }) : "";
const rpcErr = (e) => toast(/master/i.test(e.message) ? "Solo el master puede hacer esto." : e.message);

requireLogin(async (user) => {
  const { data: prof } = await sb.from("profiles").select("is_master").eq("user_id", user.id).maybeSingle();
  if (!prof?.is_master) {
    $(".tabs").hidden = true;
    $("#view").innerHTML = `<div class="panel"><h2 class="display" style="font-size:32px">Sin acceso</h2><p class="muted">Este panel es solo para la cuenta master. Si eres de cocina, entra en <a href="/cocina">/cocina</a>.</p></div>`;
    return;
  }
  render();
});
$$(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => { S.tab = b.dataset.tab; render(); }));

function render() {
  $$(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  ({ ventas, nuevo: () => renderManual($("#view")), motorizados, accesos, menu, clientes, horarios, ajustes })[S.tab]();
}

// Confirmación dentro de la página (el navegador no muestra ventanas de confirmar aquí)
function confirmRow(btn, text, onYes) {
  const row = btn.closest("tr, .confirm-host");
  const old = row.querySelector(".ask"); if (old) { old.remove(); return; }
  const box = document.createElement("div");
  box.className = "ask confirm-row"; box.style.marginTop = "8px";
  box.innerHTML = `<span class="small" style="flex:1;min-width:180px">${text}</span><button class="btn small primary" type="button">Sí, confirmar</button><button class="btn small ghost" type="button">Cancelar</button>`;
  const [yes, no] = box.querySelectorAll("button");
  yes.onclick = async () => { yes.disabled = true; await onYes(); };
  no.onclick = () => box.remove();
  (row.querySelector("td:last-child") || row).append(box);
}

// ---------- ventas ----------
async function ventas() {
  const [y, m] = S.month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1, 5)).toISOString(), to = new Date(Date.UTC(y, m, 1, 5)).toISOString();
  $("#view").innerHTML = `<p class="muted">Cargando…</p>`;
  const { data: orders, error } = await sb.from("orders")
    .select("id,subtotal,discount,delivery_fee,total,payment_method,rider_id,status,riders(full_name),order_items(name,quantity,line_total)")
    .eq("payment_status", "pagado").gte("paid_at", from).lt("paid_at", to);
  if (error) return ($("#view").innerHTML = `<p class="err">${esc(error.message)}</p>`);
  const sum = (f) => orders.reduce((s, o) => s + Number(f(o)), 0);
  const products = sum((o) => o.subtotal - o.discount), fees = sum((o) => o.delivery_fee), total = sum((o) => o.total);
  const card = orders.filter((o) => o.payment_method === "tarjeta");
  const cardFee = card.reduce((s, o) => s + Number(o.total), 0) * 0.0575;
  const riders = {}; orders.filter((o) => o.status === "entregado" && o.rider_id).forEach((o) => {
    const k = o.riders?.full_name || "Sin nombre"; riders[k] ||= { n: 0, fees: 0 }; riders[k].n++; riders[k].fees += Number(o.delivery_fee);
  });
  const prods = {}; orders.forEach((o) => o.order_items.forEach((i) => { if (Number(i.line_total) > 0) { prods[i.name] ||= { q: 0, v: 0 }; prods[i.name].q += i.quantity; prods[i.name].v += Number(i.line_total); } }));
  const top = Object.entries(prods).sort((a, b) => b[1].v - a[1].v).slice(0, 10);
  $("#view").innerHTML = `
    <div class="panel" style="display:grid;gap:14px">
      <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap;justify-content:space-between">
        <h2 class="display" style="font-size:30px">Ventas del mes</h2>
        <div><label class="f" for="month" style="margin-top:0">Mes</label><input class="in" type="month" id="month" value="${S.month}" style="width:auto"></div>
      </div>
      <div class="stats">
        <div><b>${orders.length}</b>pedidos pagados</div>
        <div><b>${money(products)}</b>ventas en productos</div>
        <div><b>${money(fees)}</b>envíos (para motorizados)</div>
        <div><b>${money(total)}</b>cobrado en total</div>
        <div><b>${money(cardFee)}</b>comisión Payphone aprox.</div>
      </div>
      <p class="muted small" style="margin:0">${card.length} con tarjeta · ${orders.length - card.length} por transferencia. La comisión es un estimado del 5,75% sobre lo cobrado con tarjeta.</p>
    </div>
    <div class="cards" style="margin-top:14px">
      <div class="panel"><h3 class="group-title" style="margin-top:0">Pago a motorizados</h3>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Motorizado</th><th>Entregas</th><th>Envíos a pagar</th></tr></thead><tbody>
        ${Object.entries(riders).map(([n, r]) => `<tr><td>${esc(n)}</td><td class="tabnum">${r.n}</td><td class="tabnum">${money(r.fees)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Sin entregas este mes.</td></tr>`}
        </tbody></table></div></div>
      <div class="panel"><h3 class="group-title" style="margin-top:0">Productos más vendidos</h3>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Producto</th><th>Unidades</th><th>Ventas</th></tr></thead><tbody>
        ${top.map(([n, p]) => `<tr><td>${esc(n)}</td><td class="tabnum">${p.q}</td><td class="tabnum">${money(p.v)}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">Sin ventas este mes.</td></tr>`}
        </tbody></table></div></div>
    </div>`;
  $("#month").onchange = (e) => { S.month = e.target.value || S.month; ventas(); };
}

// ---------- motorizados ----------
async function motorizados() {
  const [{ data: riders }, { data: counts }] = await Promise.all([
    sb.from("riders").select("*").order("archived_at", { nullsFirst: true }).order("full_name"),
    sb.from("orders").select("rider_id").not("rider_id", "is", null),
  ]);
  const n = {}; (counts || []).forEach((o) => (n[o.rider_id] = (n[o.rider_id] || 0) + 1));
  $("#view").innerHTML = `<div class="panel">
    <h2 class="display" style="font-size:30px">Motorizados</h2>
    <p class="muted small">Archivar quita el acceso al panel y lo oculta de cocina, pero el historial conserva quién entregó cada pedido. Solo se eliminan del todo los que nunca hicieron una entrega.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Contacto</th><th>Pedidos</th><th>Estado</th><th></th></tr></thead><tbody>
    ${(riders || []).map((r) => `<tr>
      <td><b>${esc(r.full_name)}</b><br><span class="muted small">${esc(r.plate || "")}</span></td>
      <td class="small">${esc(r.phone)}<br>${esc(r.email || "")}</td>
      <td class="tabnum">${n[r.id] || 0}</td>
      <td>${r.archived_at ? `<span class="st st-cancelado">Archivado</span><br><span class="muted small">${fmtDate(r.archived_at)}</span>` : r.active ? `<span class="st st-entregado">Activo</span>` : `<span class="st">Inactivo</span>`}</td>
      <td>${r.archived_at
        ? `<button class="btn small ghost" data-unarchive="${r.id}">Reactivar</button>`
        : `<div style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn small ghost" data-toggle-active="${r.id}" data-on="${r.active ? 1 : 0}">${r.active ? "Pausar" : "Activar"}</button><button class="btn small ghost" data-del="${r.id}" data-orders="${n[r.id] || 0}">${n[r.id] ? "Archivar" : "Eliminar"}</button></div>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No hay motorizados.</td></tr>`}
    </tbody></table></div>
    <h3 class="group-title">Agregar motorizado</h3>
    <form id="riderForm" class="form-grid" novalidate>
      <div><label class="f" for="rfName">Nombre</label><input class="in" id="rfName" required></div>
      <div><label class="f" for="rfPhone">WhatsApp</label><input class="in" id="rfPhone" type="tel" required></div>
      <div><label class="f" for="rfPlate">Placa</label><input class="in" id="rfPlate"></div>
      <div><label class="f" for="rfEmail">Correo para entrar</label><input class="in" id="rfEmail" type="email" required></div>
      <div style="align-self:end;padding-top:14px"><button class="btn primary block">Agregar</button></div>
    </form>
    <p class="muted small">El motorizado entra en <b>thebakeryside.com/moto</b> con ese correo. La primera vez pide un enlace y luego crea su contraseña.</p></div>`;
  $("#riderForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = { full_name: $("#rfName").value.trim(), phone: $("#rfPhone").value.trim(), plate: $("#rfPlate").value.trim() || null, email: $("#rfEmail").value.trim().toLowerCase() };
    if (!row.full_name || !row.phone || !/^\S+@\S+\.\S+$/.test(row.email)) return toast("Completa nombre, WhatsApp y un correo válido.");
    const { error } = await sb.from("riders").insert(row);
    if (error) return toast(/duplicate|unique/i.test(error.message) ? "Ese correo ya está registrado como motorizado." : error.message);
    toast("Motorizado agregado"); motorizados();
  };
  $$("[data-toggle-active]").forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from("riders").update({ active: b.dataset.on !== "1" }).eq("id", Number(b.dataset.toggleActive));
    if (error) return rpcErr(error);
    toast(b.dataset.on === "1" ? "Motorizado pausado" : "Motorizado activo"); motorizados();
  }));
  $$("[data-del]").forEach((b) => (b.onclick = () => {
    const has = Number(b.dataset.orders) > 0;
    confirmRow(b, has ? "Se archivará: no podrá entrar ni recibir pedidos. Su historial se conserva." : "Se eliminará del todo. No tiene entregas registradas.", async () => {
      const { data, error } = await sb.rpc("master_delete_rider", { p_rider: Number(b.dataset.del) });
      if (error) return rpcErr(error);
      toast(data === "eliminado" ? "Motorizado eliminado" : "Motorizado archivado"); motorizados();
    });
  }));
  $$("[data-unarchive]").forEach((b) => (b.onclick = async () => {
    const { error } = await sb.from("riders").update({ archived_at: null, active: true }).eq("id", Number(b.dataset.unarchive));
    if (error) return rpcErr(error);
    toast("Motorizado reactivado"); motorizados();
  }));
}

// ---------- accesos ----------
async function accesos() {
  const { data, error } = await sb.rpc("master_list_admins");
  if (error) return ($("#view").innerHTML = `<p class="err">${esc(error.message)}</p>`);
  $("#view").innerHTML = `<div class="panel">
    <h2 class="display" style="font-size:30px">Accesos a cocina</h2>
    <p class="muted small">Quien esté en esta lista puede entrar a <b>/cocina</b> con su correo: ver pedidos, confirmar pagos, asignar motorizados y editar el menú. Solo tú puedes dar o quitar este acceso.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Correo</th><th>Estado</th><th></th></tr></thead><tbody>
    ${data.map((a) => `<tr><td>${esc(a.email)}</td><td>${a.is_master ? `<span class="st st-confirmado">Master</span>` : a.registered ? "Ya entró" : "Aún no entra"}</td>
      <td>${a.is_master ? "" : `<button class="btn small ghost" data-rm="${esc(a.email)}">Quitar acceso</button>`}</td></tr>`).join("")}
    </tbody></table></div>
    <form id="addForm" class="reflink" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" novalidate>
      <input class="in" id="newAdmin" type="email" placeholder="correo@ejemplo.com" aria-label="Correo para dar acceso a cocina" style="flex:1;min-width:220px">
      <button class="btn primary">Dar acceso</button>
    </form></div>`;
  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#newAdmin").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return toast("Escribe un correo válido.");
    const { error } = await sb.rpc("master_add_admin", { p_email: email });
    if (error) return rpcErr(error);
    toast("Acceso dado. Ya puede entrar en /cocina con ese correo."); accesos();
  };
  $$("[data-rm]").forEach((b) => (b.onclick = () => confirmRow(b, `${esc(b.dataset.rm)} ya no podrá entrar a cocina.`, async () => {
    const { error } = await sb.rpc("master_remove_admin", { p_email: b.dataset.rm });
    if (error) return rpcErr(error);
    toast("Acceso quitado"); accesos();
  })));
}

// ---------- menú ----------
async function menu() {
  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from("categories").select("*").order("sort"), sb.from("products").select("*").order("sort"),
  ]);
  const catOpts = (sel) => (cats || []).map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  $("#view").innerHTML = `<div class="panel">
    <h2 class="display" style="font-size:30px">Menú</h2>
    <p class="muted small">Los cambios se ven en la tienda al instante. <b>Anticipación</b> = horas antes que hay que agendar ese producto (0 = se puede pedir para ya). <b>Visible</b> lo oculta o muestra en la tienda. Eliminar es definitivo; los pedidos anteriores conservan nombre y precio.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Foto</th><th>Producto</th><th>Categoría</th><th>Precio $</th><th>Prep. min</th><th>Anticip. h</th><th>Visible</th><th></th></tr></thead><tbody>
    ${(prods || []).map((p) => `<tr data-pid="${p.id}">
      <td>${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;margin-bottom:4px">` : ""}<label class="btn small ghost" style="cursor:pointer">${p.image_url ? "Cambiar" : "Subir"}<input type="file" accept="image/*" data-photo="${p.id}" hidden></label></td>
      <td><input class="in" data-f="name" value="${esc(p.name)}" style="min-width:170px" aria-label="Nombre"><input class="in" data-f="description" value="${esc(p.description)}" placeholder="Descripción" style="margin-top:4px;min-width:170px" aria-label="Descripción"></td>
      <td><select class="in" data-f="category_id" aria-label="Categoría">${catOpts(p.category_id)}</select></td>
      <td><input class="in" data-f="price" type="number" step="0.01" min="0" value="${p.price}" style="width:90px" aria-label="Precio"></td>
      <td><input class="in" data-f="prep_minutes" type="number" min="0" value="${p.prep_minutes}" style="width:76px" aria-label="Minutos de preparación"></td>
      <td><input class="in" data-f="lead_hours" type="number" min="0" value="${p.lead_hours}" style="width:76px" aria-label="Horas de anticipación"></td>
      <td><input type="checkbox" data-f="active" ${p.active ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--tostado)" aria-label="Visible"></td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn small" data-save="${p.id}">Guardar</button><button class="btn small ghost" data-delprod="${p.id}" data-name="${esc(p.name)}">Eliminar</button></div></td></tr>`).join("")}
    </tbody></table></div>
    <h3 class="group-title">Nuevo producto</h3>
    <form id="prodForm" class="form-grid" novalidate>
      <div><label class="f" for="pfName">Nombre</label><input class="in" id="pfName"></div>
      <div><label class="f" for="pfCat">Categoría</label><select class="in" id="pfCat">${catOpts()}</select></div>
      <div><label class="f" for="pfPrice">Precio $</label><input class="in" id="pfPrice" type="number" step="0.01" min="0"></div>
      <div style="align-self:end;padding-top:14px"><button class="btn primary block">Agregar producto</button></div>
    </form>
    <h3 class="group-title">Categorías</h3>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Orden</th><th></th></tr></thead><tbody>
    ${(cats || []).map((c) => `<tr><td><input class="in" data-cname="${c.id}" value="${esc(c.name)}" aria-label="Nombre de categoría"></td><td><input class="in" type="number" data-csort="${c.id}" value="${c.sort}" style="width:70px" aria-label="Orden"></td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap"><button class="btn small" data-csave="${c.id}">Guardar</button><button class="btn small ghost" data-delcat="${c.id}">Eliminar</button></div></td></tr>`).join("")}
    </tbody></table></div>
    <form id="catForm" class="reflink" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap" novalidate>
      <input class="in" id="newCat" placeholder="Nueva categoría" aria-label="Nueva categoría" style="flex:1;min-width:200px"><button class="btn">Agregar categoría</button>
    </form>
  </div>`;
  $$("[data-save]").forEach((b) => (b.onclick = async () => {
    const tr = b.closest("tr"), v = (f) => tr.querySelector(`[data-f="${f}"]`);
    const patch = { name: v("name").value.trim(), description: v("description").value.trim(), category_id: Number(v("category_id").value), price: Number(v("price").value), prep_minutes: Number(v("prep_minutes").value), lead_hours: Number(v("lead_hours").value), active: v("active").checked };
    if (!patch.name || !(patch.price >= 0)) return toast("Revisa nombre y precio.");
    const { error } = await sb.from("products").update(patch).eq("id", Number(b.dataset.save));
    if (error) return rpcErr(error); toast("Producto guardado");
  }));
  $$("[data-photo]").forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast("La foto pesa más de 5 MB. Usa una más liviana.");
    const id = Number(inp.dataset.photo), path = `${id}-${Date.now()}.${(f.name.split(".").pop() || "jpg").toLowerCase()}`;
    const { error } = await sb.storage.from("productos").upload(path, f, { contentType: f.type });
    if (error) return toast("No se pudo subir la foto: " + error.message);
    const url = sb.storage.from("productos").getPublicUrl(path).data.publicUrl;
    const { error: e2 } = await sb.from("products").update({ image_url: url }).eq("id", id);
    if (e2) return rpcErr(e2);
    toast("Foto actualizada"); menu();
  }));
  $$("[data-delprod]").forEach((b) => (b.onclick = () => confirmRow(b, `Eliminar «${b.dataset.name}» del menú para siempre.`, async () => {
    const { error } = await sb.from("products").delete().eq("id", Number(b.dataset.delprod));
    if (error) return rpcErr(error);
    toast("Producto eliminado"); menu();
  })));
  $("#prodForm").onsubmit = async (e) => {
    e.preventDefault();
    const row = { name: $("#pfName").value.trim(), category_id: Number($("#pfCat").value), price: Number($("#pfPrice").value), prep_minutes: 10 };
    if (!row.name || !($("#pfPrice").value !== "" && row.price >= 0)) return toast("Escribe nombre y precio.");
    const { error } = await sb.from("products").insert(row);
    if (error) return rpcErr(error); toast("Producto agregado"); menu();
  };
  $$("[data-csave]").forEach((b) => (b.onclick = async () => {
    const id = Number(b.dataset.csave);
    const { error } = await sb.from("categories").update({ name: $(`[data-cname="${id}"]`).value.trim(), sort: Number($(`[data-csort="${id}"]`).value) }).eq("id", id);
    if (error) return rpcErr(error); toast("Categoría guardada"); menu();
  }));
  $$("[data-delcat]").forEach((b) => (b.onclick = () => confirmRow(b, "Eliminar la categoría. Sus productos quedarán sin categoría y no se verán en la tienda hasta asignarles otra.", async () => {
    const { error } = await sb.from("categories").delete().eq("id", Number(b.dataset.delcat));
    if (error) return rpcErr(error);
    toast("Categoría eliminada"); menu();
  })));
  $("#catForm").onsubmit = async (e) => {
    e.preventDefault();
    const name = $("#newCat").value.trim(); if (!name) return toast("Escribe el nombre de la categoría.");
    const { error } = await sb.from("categories").insert({ name, sort: (cats?.length || 0) + 1 });
    if (error) return rpcErr(error); toast("Categoría agregada"); menu();
  };
}

// ---------- horarios: semana y días especiales ----------
const DAYS = [[1, "Lunes"], [2, "Martes"], [3, "Miércoles"], [4, "Jueves"], [5, "Viernes"], [6, "Sábado"], [0, "Domingo"]];
// Feriados nacionales y de Guayaquil próximos. El Gobierno a veces los traslada: revisa la fecha antes de guardar.
const HOLIDAYS = [
  ["2026-10-09", "Independencia de Guayaquil"], ["2026-11-02", "Día de Difuntos"], ["2026-11-03", "Independencia de Cuenca"],
  ["2026-12-24", "Nochebuena"], ["2026-12-25", "Navidad"], ["2026-12-31", "Fin de año"], ["2027-01-01", "Año Nuevo"],
  ["2027-02-08", "Carnaval"], ["2027-02-09", "Carnaval"], ["2027-03-26", "Viernes Santo"], ["2027-05-01", "Día del Trabajo"],
  ["2027-05-24", "Batalla de Pichincha"], ["2027-07-25", "Fundación de Guayaquil"], ["2027-08-10", "Primer Grito de Independencia"],
];
const hm5 = (t) => (t ? String(t).slice(0, 5) : "");
const longDay = (d) => new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Guayaquil" });

async function horarios() {
  const today = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
  const [{ data: s, error }, ex] = await Promise.all([
    sb.from("settings").select("*").single(),
    sb.from("store_exceptions").select("*").gte("day", today).order("day"),
  ]);
  if (error) return ($("#view").innerHTML = `<p class="err">${esc(error.message)}</p>`);
  const ready = "weekly_hours" in s && !ex.error;
  const week = s.weekly_hours || Object.fromEntries(DAYS.map(([d]) => [d, { open: hm5(s.open_time), close: hm5(s.close_time) }]));
  const excs = ex.data || [];
  const taken = new Set(excs.map((e) => e.day));
  const chips = HOLIDAYS.filter(([d]) => d >= today && !taken.has(d)).slice(0, 8);

  $("#view").innerHTML = `
    ${ready ? "" : `<div class="panel" style="border-color:var(--aviso);margin-bottom:14px"><b>Falta un paso en la base de datos.</b><p class="muted small" style="margin:4px 0 0">Corre el archivo 008_horarios_y_pausa.sql en Supabase para poder guardar horarios por día y feriados.</p></div>`}
    <form class="panel" id="weekForm" novalidate>
      <h2 class="display" style="font-size:30px">Horario de cada semana</h2>
      <p class="muted small" style="margin:4px 0 12px">Es el horario en que la tienda recibe pedidos para entregar al momento y las horas en que se pueden agendar entregas.</p>
      <div class="week">${DAYS.map(([d, name]) => { const h = week[d]; return `
        <div class="wk ${h ? "" : "off"}" data-dow="${d}">
          <b>${name}</b>
          <label class="check" style="margin:0"><input type="checkbox" data-on ${h ? "checked" : ""}> Abierto</label>
          <div class="times"><input class="in" type="time" data-open value="${h?.open || "09:00"}" aria-label="${name}: abre"><span class="muted">a</span><input class="in" type="time" data-close value="${h?.close || "21:00"}" aria-label="${name}: cierra"></div>
        </div>`; }).join("")}</div>
      <div class="row-btns" style="margin-top:12px"><button class="btn primary">Guardar horario</button><button class="btn ghost" type="button" id="copyMon">Copiar el lunes a todos los días abiertos</button></div>
    </form>

    <div class="panel" style="margin-top:14px">
      <h2 class="display" style="font-size:30px">Días especiales y feriados</h2>
      <p class="muted small" style="margin:4px 0 10px">Para un día puntual: cerrar todo el día o atender con otro horario. Manda sobre el horario de la semana.</p>
      ${chips.length ? `<p class="small" style="margin:0 0 6px">Feriados próximos <span class="muted">(toca uno para llenarlo; revisa la fecha por si la trasladan)</span></p>
        <div class="chips" style="margin-bottom:10px">${chips.map(([d, n]) => `<button class="chip" type="button" data-hol="${d}" data-name="${esc(n)}">${new Date(d + "T12:00:00-05:00").toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" })} · ${esc(n)}</button>`).join("")}</div>` : ""}
      <form id="excForm" novalidate>
        <div class="form-grid">
          <div><label class="f" for="eDay">Fecha</label><input class="in" id="eDay" type="date" min="${today}"></div>
          <div><label class="f" for="eNote">Motivo <span class="hint">(opcional)</span></label><input class="in" id="eNote" maxlength="60" placeholder="Feriado, vacaciones, evento"></div>
        </div>
        <div class="chips" style="margin-top:12px" role="radiogroup" aria-label="Tipo">
          <label class="chip"><input type="radio" name="eType" value="closed" checked> Cerrado todo el día</label>
          <label class="chip"><input type="radio" name="eType" value="hours"> Otro horario</label>
        </div>
        <div class="times" id="eTimes" hidden style="display:flex;gap:6px;align-items:center;margin-top:10px">
          <input class="in" type="time" id="eOpen" value="10:00" style="width:150px" aria-label="Abre"><span class="muted">a</span><input class="in" type="time" id="eClose" value="18:00" style="width:150px" aria-label="Cierra">
        </div>
        <button class="btn primary" style="margin-top:12px">Guardar día especial</button>
      </form>
      <div class="exc-list">${excs.map((e) => `
        <div class="exc confirm-host"><b>${esc(longDay(e.day))}</b>
          <span class="st ${e.closed ? "st-cancelado" : "st-confirmado"}">${e.closed ? "Cerrado" : `${hm5(e.open_time)} a ${hm5(e.close_time)}`}</span>
          <span class="muted small" style="flex:1">${esc(e.note || "")}</span>
          <button class="btn small ghost" type="button" data-delexc="${e.day}">Quitar</button></div>`).join("") || `<p class="muted small">No hay días especiales próximos.</p>`}</div>
    </div>`;

  // semana
  $$(".wk [data-on]").forEach((c) => c.addEventListener("change", () => c.closest(".wk").classList.toggle("off", !c.checked)));
  $("#copyMon").onclick = () => {
    const mon = $('.wk[data-dow="1"]'), o = mon.querySelector("[data-open]").value, c = mon.querySelector("[data-close]").value;
    $$(".wk").forEach((r) => { if (r.querySelector("[data-on]").checked) { r.querySelector("[data-open]").value = o; r.querySelector("[data-close]").value = c; } });
    toast("Copiado. Recuerda guardar.");
  };
  $("#weekForm").onsubmit = async (e) => {
    e.preventDefault();
    const wh = {};
    for (const r of $$(".wk")) {
      const on = r.querySelector("[data-on]").checked, o = r.querySelector("[data-open]").value, c = r.querySelector("[data-close]").value;
      if (on && (!o || !c || o >= c)) return toast(`${r.querySelector("b").textContent}: la apertura debe ser antes del cierre.`);
      wh[r.dataset.dow] = on ? { open: o, close: c } : null;
    }
    if (!Object.values(wh).some(Boolean)) return toast("Deja al menos un día abierto.");
    const { error } = await sb.from("settings").update({ weekly_hours: wh, updated_at: new Date().toISOString() }).eq("id", true);
    if (error) return /weekly_hours/.test(error.message) ? toast("Primero corre el archivo 008 en Supabase.") : rpcErr(error);
    toast("Horario de la semana guardado");
  };

  // días especiales
  const syncType = () => { $("#eTimes").hidden = document.querySelector('input[name="eType"]:checked').value !== "hours"; };
  $$('input[name="eType"]').forEach((r) => r.addEventListener("change", syncType));
  $$("[data-hol]").forEach((b) => (b.onclick = () => { $("#eDay").value = b.dataset.hol; $("#eNote").value = b.dataset.name; $("#eDay").focus(); }));
  $("#excForm").onsubmit = async (e) => {
    e.preventDefault();
    const day = $("#eDay").value, closed = document.querySelector('input[name="eType"]:checked').value === "closed";
    if (!day) return toast("Elige la fecha.");
    const row = { day, closed, note: $("#eNote").value.trim() || null, open_time: closed ? null : $("#eOpen").value, close_time: closed ? null : $("#eClose").value };
    if (!closed && (!row.open_time || !row.close_time || row.open_time >= row.close_time)) return toast("La apertura debe ser antes del cierre.");
    const { error } = await sb.from("store_exceptions").upsert(row);
    if (error) return /store_exceptions/.test(error.message) ? toast("Primero corre el archivo 008 en Supabase.") : rpcErr(error);
    toast("Día especial guardado"); horarios();
  };
  $$("[data-delexc]").forEach((b) => (b.onclick = () => confirmRow(b, "Ese día vuelve al horario normal de la semana.", async () => {
    const { error } = await sb.from("store_exceptions").delete().eq("day", b.dataset.delexc);
    if (error) return rpcErr(error);
    toast("Día especial quitado"); horarios();
  })));
}

// ---------- ajustes ----------
async function ajustes() {
  const { data: s, error } = await sb.from("settings").select("*").single();
  if (error) return ($("#view").innerHTML = `<p class="err">${esc(error.message)}</p>`);
  const f = (id, label, val, type = "text", extra = "") => `<div><label class="f" for="${id}">${label}</label><input class="in" id="${id}" type="${type}" value="${esc(val ?? "")}" ${extra}></div>`;
  $("#view").innerHTML = `
    <form class="panel" id="setForm" novalidate>
      <h2 class="display" style="font-size:30px">Ajustes del negocio</h2>
      <h3 class="group-title">Pedidos agendados</h3>
      <div class="form-grid">
        ${f("sSlotCap", "Pedidos máximos por franja de 30 min", s.slot_capacity, "number", 'min="1"')}
      </div>
      <p class="muted small">Los horarios por día y los feriados están en la pestaña «Horarios».</p>
      <h3 class="group-title">Envío</h3>
      <div class="form-grid">
        ${f("sBase", "Envío base $", s.fee_base, "number", 'step="0.05" min="0"')}
        ${f("sIncl", "Km incluidos en la base", s.fee_included_km, "number", 'step="0.5" min="0"')}
        ${f("sPerKm", "Precio por km adicional $", s.fee_per_km, "number", 'step="0.05" min="0"')}
        ${f("sMaxKm", "Distancia máxima (km)", s.max_km, "number", 'step="1" min="1"')}
      </div>
      <p class="muted small">Ejemplo con estos valores: 5 km = <b id="feeEx"></b>. La distancia se mide ${s.map_provider === "google" ? "por calles con Google" : "en línea recta × 1,4"} desde la cocina (${esc(s.kitchen_address || "sin ubicación")}).</p>
      <h3 class="group-title">Pagos y contacto</h3>
      ${f("sWa", "WhatsApp del negocio", s.whatsapp_number, "tel")}
      <label class="f">Códigos QR de cobro</label>
      <p class="muted small" style="margin:0 0 8px">Sube la imagen del QR de tu negocio en Deuna y en Peigo. El cliente lo ve solo después de hacer su pedido, y así no tienes que publicar tu cédula.</p>
      <div class="qr-admin" id="qrAdmin"><p class="muted small">Cargando…</p></div>
      <label class="f" for="sBank">Datos para transferencia bancaria <span class="hint">(opcional; solo los ve quien ya hizo un pedido)</span></label>
      <textarea class="in" id="sBank" placeholder="Déjalo vacío si prefieres cobrar solo por Deuna o Peigo">${esc(s.bank_info ?? "")}</textarea>
      <button class="btn primary" style="margin-top:14px">Guardar ajustes</button>
    </form>`;
  const ex = () => {
    const base = Number($("#sBase").value), inc = Number($("#sIncl").value), per = Number($("#sPerKm").value);
    const raw = Math.max(base, base + per * Math.max(5 - inc, 0));
    $("#feeEx").textContent = money(Math.ceil(raw / 0.25 - 1e-9) * 0.25);
  };
  ["#sBase", "#sIncl", "#sPerKm"].forEach((k) => $(k).addEventListener("input", ex)); ex();
  renderQrAdmin();
  $("#setForm").onsubmit = async (e) => {
    e.preventDefault();
    const patch = {
      slot_capacity: Number($("#sSlotCap").value), fee_base: Number($("#sBase").value), fee_included_km: Number($("#sIncl").value),
      fee_per_km: Number($("#sPerKm").value), max_km: Number($("#sMaxKm").value),
      whatsapp_number: $("#sWa").value.trim() || null, bank_info: $("#sBank").value.trim() || null, updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("settings").update(patch).eq("id", true);
    if (error) return rpcErr(error);
    toast("Ajustes guardados");
  };
}

// QR de Deuna y Peigo (storage público productos/pagos/deuna y productos/pagos/peigo)
async function renderQrAdmin() {
  const box = $("#qrAdmin"); if (!box) return;
  const { data } = await sb.storage.from("productos").list("pagos");
  const has = Object.fromEntries((data ?? []).map((f) => [f.name, f.updated_at || f.created_at]));
  const url = (k) => `${sb.storage.from("productos").getPublicUrl(`pagos/${k}`).data.publicUrl}?v=${encodeURIComponent(has[k] || "")}`;
  box.innerHTML = [["deuna", "Deuna"], ["peigo", "Peigo"]].map(([k, n]) => `
    <div class="qr-slot confirm-host">
      ${has[k] ? `<img src="${esc(url(k))}" alt="QR de ${n}">` : `<div class="qr-empty">Sin QR</div>`}
      <div style="display:grid;gap:6px"><b>${n}</b>
        <label class="btn small" style="cursor:pointer">${has[k] ? "Cambiar imagen" : "Subir imagen"}<input type="file" accept="image/*" data-qr="${k}" hidden></label>
        ${has[k] ? `<button class="btn small ghost" type="button" data-qrdel="${k}">Quitar</button>` : ""}</div>
    </div>`).join("");
  box.querySelectorAll("[data-qr]").forEach((inp) => (inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 4 * 1024 * 1024) return toast("La imagen pesa más de 4 MB.");
    const { error } = await sb.storage.from("productos").upload(`pagos/${inp.dataset.qr}`, f, { upsert: true, contentType: f.type || "image/png", cacheControl: "60" });
    if (error) return rpcErr(error);
    toast("QR guardado"); renderQrAdmin();
  }));
  box.querySelectorAll("[data-qrdel]").forEach((b) => (b.onclick = () => confirmRow(b, "El cliente ya no verá este QR para pagar.", async () => {
    const { error } = await sb.storage.from("productos").remove([`pagos/${b.dataset.qrdel}`]);
    if (error) return rpcErr(error);
    toast("QR quitado"); renderQrAdmin();
  })));
}

// ---------- clientes y sellos ----------
async function clientes() {
  const { data, error } = await sb.rpc("master_customers");
  if (error) return ($("#view").innerHTML = `<p class="err">${esc(error.message)}</p>`);
  $("#view").innerHTML = `<div class="panel">
    <h2 class="display" style="font-size:30px">Clientes y sellos</h2>
    <p class="muted small">Clientes con cuenta de Google. Puedes sumar o quitar sellos, por ejemplo para compensar un reclamo. Al llegar a 8 se crea su cookie gratis automáticamente.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Cliente</th><th>Pedidos</th><th>Gastado</th><th>Sellos</th><th>Cookies</th><th>Ajustar</th></tr></thead><tbody>
    ${data.map((c) => `<tr><td><b>${esc(c.full_name || "Sin nombre")}</b><br><span class="muted small">${esc(c.email || "")}${c.phone ? " · " + esc(c.phone) : ""}</span></td>
      <td class="tabnum">${c.orders}</td><td class="tabnum">${money(c.spent)}</td><td class="tabnum"><b>${c.stamps}/8</b></td><td class="tabnum">${c.rewards}</td>
      <td><div style="display:flex;gap:4px"><button class="btn small ghost" data-adj="-1" data-u="${c.user_id}" aria-label="Quitar un sello">−1</button><button class="btn small" data-adj="1" data-u="${c.user_id}" aria-label="Sumar un sello">+1</button></div></td></tr>`).join("")
      || `<tr><td colspan="6" class="muted">Aún no hay clientes con cuenta.</td></tr>`}
    </tbody></table></div></div>`;
  $$("[data-adj]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const { error } = await sb.rpc("master_adjust_stamps", { p_user: b.dataset.u, p_delta: Number(b.dataset.adj) });
    if (error) { b.disabled = false; return rpcErr(error); }
    toast(Number(b.dataset.adj) > 0 ? "Sello sumado" : "Sello quitado"); clientes();
  }));
}
