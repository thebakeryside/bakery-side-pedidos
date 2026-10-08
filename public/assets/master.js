import { sb, $, $$, money, esc, toast } from "./common.js";
import { requireLogin, loginHTML } from "./auth.js";

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
  ({ ventas, motorizados, accesos, menu, clientes })[S.tab]();
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
        : `<button class="btn small ghost" data-del="${r.id}" data-orders="${n[r.id] || 0}">${n[r.id] ? "Archivar" : "Eliminar"}</button>`}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">No hay motorizados.</td></tr>`}
    </tbody></table></div></div>`;
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
    sb.from("categories").select("*").order("sort"), sb.from("products").select("id,name,price,active,category_id").order("sort"),
  ]);
  $("#view").innerHTML = `<div class="panel">
    <h2 class="display" style="font-size:30px">Eliminar del menú</h2>
    <p class="muted small">Cocina puede ocultar productos. Aquí se eliminan del todo; los pedidos anteriores conservan el nombre y el precio. Si una categoría se elimina, sus productos quedan sin categoría y no se muestran hasta que les asignes otra en cocina.</p>
    ${(cats || []).map((c) => `<div class="confirm-host" style="border-top:1px solid var(--cacao);padding-top:12px;margin-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 class="group-title" style="margin:0">${esc(c.name)}</h3>
      <button class="btn small ghost" data-delcat="${c.id}">Eliminar categoría</button></div>
      <div class="tbl-wrap"><table class="tbl"><tbody>
      ${(prods || []).filter((p) => p.category_id === c.id).map((p) => `<tr><td>${esc(p.name)}${p.active ? "" : ` <span class="muted small">(oculto)</span>`}</td><td class="tabnum">${money(p.price)}</td>
        <td style="text-align:right"><button class="btn small ghost" data-delprod="${p.id}" data-name="${esc(p.name)}">Eliminar</button></td></tr>`).join("") || `<tr><td class="muted">Sin productos.</td></tr>`}
      </tbody></table></div></div>`).join("")}
    ${(prods || []).some((p) => !p.category_id) ? `<p class="muted small" style="margin-top:12px">Hay productos sin categoría. Asígnales una en cocina → Menú.</p>` : ""}
  </div>`;
  $$("[data-delprod]").forEach((b) => (b.onclick = () => confirmRow(b, `Eliminar «${b.dataset.name}» del menú.`, async () => {
    const { error } = await sb.from("products").delete().eq("id", Number(b.dataset.delprod));
    if (error) return rpcErr(error);
    toast("Producto eliminado"); menu();
  })));
  $$("[data-delcat]").forEach((b) => (b.onclick = () => confirmRow(b, "Eliminar la categoría. Sus productos quedarán sin categoría.", async () => {
    const { error } = await sb.from("categories").delete().eq("id", Number(b.dataset.delcat));
    if (error) return rpcErr(error);
    toast("Categoría eliminada"); menu();
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
