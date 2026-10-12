import { sb, api, $, money, esc, when, dayLabel, orderRange, toast, STATUS } from "./common.js";
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
  const dots = Array.from({ length: STAMPS_TOTAL }, (_, i) => i === STAMPS_TOTAL - 1 ? `<span class="g ${n >= STAMPS_TOTAL ? "on" : ""}" aria-hidden="true">🎁</span>` : i < n ? `<span class="on" aria-hidden="true"><img src="/assets/brand/s-tinta.svg" alt=""></span>` : `<span aria-hidden="true">${i + 1}</span>`).join("");
  const title = left === 0 ? "¡Completaste tu tarjeta!" : left === 1 ? "¡Te falta 1 sello para tu postre sorpresa!" : `Te faltan ${left} sellos para tu postre sorpresa`;
  const bd = birthdayInfo(c.birthday, acc.birthday_available, first);
  const bday = bd ? bd.text : "Agrega tu cumpleaños en «Mis datos»";
  $("#pane").innerHTML = `
    <div class="rw">
      <div class="rw-hero" role="img" aria-label="Tarjeta de sellos: ${n} de ${STAMPS_TOTAL}">
        <span class="rw-k">Tu tarjeta de sellos</span>
        <b class="rw-t">${title}</b>
        <div class="rw-dots">${dots}</div>
        <div class="rw-bar"><i style="width:${(n / STAMPS_TOTAL) * 100}%"></i></div>
        <small>1 sello por cada $10 · un pedido de $20 te da 2</small>
      </div>
      ${orders.some((o) => o.status === "entregado") ? `<button type="button" class="rate-banner as-btn" id="goRate"><b>🎁 HOY: gana 1 sello por cada reseña</b><span>Califica lo que ya probaste en «Mis pedidos» ›</span></button>` : ""}
      ${acc.rewards_available ? Array.from({ length: Math.min(3, acc.rewards_available) }, () => `<div class="rw-ticket"><div class="l" aria-hidden="true">🎁</div><div class="r"><b>Postre sorpresa</b><span>Se agrega gratis con tu próximo pedido (con cualquier producto). Cocina elige algo especial para ti.</span><em>Listo para usar</em></div></div>`).join("") : ""}
      <div class="rw-tiles">
        <div class="rw-tile ${acc.birthday_available ? "ready" : ""}"><span class="ic" aria-hidden="true">🎂</span>${bd ? `<span class="bd-count">${bd.big === "🎉" ? "🎉" : `<small>Faltan</small>${bd.big}`}</span>` : ""}<b>${bd?.title || "$4 en tu cumpleaños"}</b><span>${bday}</span>${c.birthday ? "" : `<button class="btn small" type="button" id="toDatos">Agregar</button>`}</div>
        <div class="rw-tile"><span class="ic" aria-hidden="true">💌</span><b>Invita a un amigo</b><span>Empieza con 3 sellos y tú ganas 1 cuando pague su primer pedido</span>
          <a class="btn small wa" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Te regalo 3 sellos en The Bakery Side 🧁 Pide aquí: ${link}`)}">Compartir</a>
          <button class="linkbtn" type="button" id="copyRef">Copiar enlace</button></div>
      </div>
    </div>`;
  $("#copyRef").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Enlace copiado"), () => toast(link));
  $("#goRate")?.addEventListener("click", () => { tab = "pedidos"; try { sessionStorage.setItem(TAB_KEY, tab); } catch {} render(); });
  $("#toDatos")?.addEventListener("click", () => { tab = "datos"; try { sessionStorage.setItem(TAB_KEY, tab); } catch {} render(); });
}

const STATE_COLOR = { entregado: "ok", cancelado: "bad", pendiente_pago: "warn", por_confirmar: "warn" };
async function panePedidos(_acc, orders) {
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
  const canRate = !rvErr;
  const toRate = canRate ? [...new Set(shown.filter((o) => o.status === "entregado").flatMap((o) => o.order_items.filter((i) => i.product_id && Number(i.line_total) > 0).map((i) => i.product_id)))].filter((id) => !rev.has(id)) : [];
  const initials = (t) => t.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const active = (o) => !["entregado", "cancelado", "pendiente_pago"].includes(o.status);
  $("#pane").innerHTML = `<div class="ol">${toRate.length ? `<div class="rate-banner"><b>🎁 HOY: califica lo que compraste y gana 1 sello por cada reseña</b><span>Toca «Calificar» en tus pedidos entregados. Sumamos el sello cuando la publicamos.</span></div>` : ""}${shown.map((o) => {
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
          : `<button type="button" class="chip-btn" data-rate="${i.product_id}" data-name="${esc(nm)}">★ Calificar ${esc(nm)}</button>`; }).join("")}</div><div class="rate-box"></div>` : ""}
      <div class="bot"><b class="tabnum">${money(o.total)}</b><span class="acts">
        <a class="btn small ghost" href="/pedido?t=${o.tracking_token}">Ver</a>
        ${active(o) ? `<a class="btn small primary" href="/pedido?t=${o.tracking_token}">Seguir pedido</a>` : `<button class="btn small primary" type="button" data-again="${o.code}">Volver a pedir</button>`}</span></div>
    </article>`; }).join("")}</div>`;
  $("#pane").querySelectorAll("[data-rate]").forEach((b) => (b.onclick = () => {
    reviewForm(b.closest(".oc").querySelector(".rate-box"), Number(b.dataset.rate), b.dataset.name, () => { b.outerHTML = `<span class="rated">⏳ En revisión · ${esc(b.dataset.name)}</span>`; });
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
      <section class="panel">
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

function renderGuest() {
  root.innerHTML = `
    <div class="acct-grid">
      <div style="display:grid;gap:14px">
        <div><p class="eyebrow">Recompensas The Bakery Side</p><h1 class="display" style="font-size:clamp(40px,8vw,60px)">Empieza con 2 sellos de regalo</h1></div>
        <p class="muted">Crea tu cuenta con Google en un toque. Te regalamos 2 sellos al empezar, ganas 1 sello por cada $10, un postre sorpresa al completar 8 y $4 en tu mes de cumpleaños.</p>
        <div>${googleButton()}</div>
        <p class="muted small">¿Prefieres no crear cuenta? Puedes <a href="/">pedir como invitado</a>, pero no acumularás sellos.</p>
      </div>
      ${stampCard(2)}
    </div>`;
  mountGoogle(root, () => render(), (e) => toast(e.message));
}

let started = false;
sb.auth.onAuthStateChange((ev) => {
  if (ev === "INITIAL_SESSION" || (ev === "SIGNED_IN" && started)) { started = true; render(); }
});
