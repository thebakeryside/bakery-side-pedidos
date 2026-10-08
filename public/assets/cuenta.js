import { sb, api, $, money, esc, when, toast, STATUS } from "./common.js";
import { captureRef, currentUser, loadAccount, setAccount, signOut, stampCard, googleButton, mountGoogle } from "./account.js";

captureRef();
const root = $("#root");

const TAB_KEY = "tbs_cuenta_tab";
let tab = (() => { try { return sessionStorage.getItem(TAB_KEY) || "inicio"; } catch { return "inicio"; } })();

async function render() {
  const u = await currentUser();
  if (!u) return renderGuest();
  let acc;
  try { acc = await loadAccount(true); }
  catch (e) { root.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; return; }
  const c = acc.customer;
  const { data: orders } = await sb.from("orders").select("code,status,total,created_at,scheduled_for,tracking_token,payment_status,order_items(product_id,name,quantity,line_total)")
    .eq("user_id", u.id).order("created_at", { ascending: false }).limit(50);
  const paid = (orders ?? []).filter((o) => ["pagado", "en_revision"].includes(o.payment_status) || o.status === "entregado");
  const first = (c.full_name || u.user_metadata?.name || "").split(" ")[0];

  root.innerHTML = `
    <div class="acct-top">
      <div><p class="eyebrow">Mi cuenta</p><h1 class="display">Hola${first ? ", " + esc(first) : ""}</h1></div>
      <button class="btn small ghost" id="out" type="button">Cerrar sesión</button>
    </div>
    <div class="mini-stats" style="margin-bottom:16px">
      <div><b class="tabnum">${Math.min(acc.stamps, 8)}/8</b><span>sellos</span></div>
      <div><b class="tabnum">${paid.length}</b><span>${paid.length === 1 ? "pedido" : "pedidos"}</span></div>
      <div><b class="tabnum">${acc.rewards_available || 0}</b><span>${acc.rewards_available === 1 ? "cookie de regalo" : "cookies de regalo"}</span></div>
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

function paneInicio(acc) {
  const c = acc.customer;
  const link = `${location.origin}/?ref=${c.referral_code}`;
  const monthName = (m) => new Date(2026, m - 1, 1).toLocaleDateString("es-EC", { month: "long" });
  $("#pane").innerHTML = `
    <div class="acct-grid">
      <div style="display:grid;gap:14px">${stampCard(acc.stamps)}
        <div class="perk ${acc.rewards_available ? "ready" : ""}"><div><b>${acc.rewards_available ? `Tienes ${acc.rewards_available === 1 ? "una cookie gratis" : acc.rewards_available + " cookies gratis"}` : "Cookie gratis"}</b>
          <span class="muted small">${acc.rewards_available ? "Elígela al pagar tu próximo pedido: Midnight, Snowlemon, Snowchocolate o Chocochip." : "Al completar los 8 sellos ganas una cookie a elección."}</span></div></div>
      </div>
      <div style="display:grid;gap:14px">
        <div class="perk ${acc.birthday_available ? "ready" : ""}"><div style="flex:1"><b>Regalo de cumpleaños: $4</b>
          <span class="muted small">${c.birthday ? (acc.birthday_available ? "¡Feliz cumpleaños! Úsalo en un pedido este mes." : `Lo tendrás disponible todo ${monthName(Number(c.birthday.slice(5, 7)))}.`) : "Agrega tu cumpleaños en «Mis datos» y recibe $4 de descuento durante todo tu mes."}</span>
        </div></div>
        <div class="panel" style="display:grid;gap:8px">
          <h2 class="display" style="font-size:26px">Invita a un amigo</h2>
          <p class="muted small" style="margin:0">Tu amigo empieza con 3 sellos y tú ganas 1 cuando paga su primer pedido.</p>
          <div class="reflink"><input class="in" id="refLink" value="${esc(link)}" readonly aria-label="Tu enlace de invitación">
            <button class="btn small" id="copyRef" type="button">Copiar</button></div>
          <a class="btn small primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Te regalo 3 sellos en The Bakery Side 🧁 Pide aquí: ${link}`)}">Compartir por WhatsApp</a>
        </div>
      </div>
    </div>`;
  $("#copyRef").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Enlace copiado"), () => { $("#refLink").select(); toast("Copia el enlace seleccionado"); });
}

function panePedidos(_acc, orders) {
  const shown = orders.filter((o) => o.status !== "pendiente_pago" || Date.now() - new Date(o.created_at) < 86400000);
  $("#pane").innerHTML = shown.length ? `<div style="display:grid;gap:10px">${shown.map((o) => {
    const items = o.order_items.filter((i) => Number(i.line_total) > 0 || !/regalo/i.test(i.name));
    return `<article class="order-card">
      <div class="row"><b>${esc(o.code)}</b><span class="st st-${o.status}">${STATUS[o.status]}</span></div>
      <div class="row"><span class="muted small">${when(o.scheduled_for || o.created_at)}</span><b class="tabnum">${money(o.total)}</b></div>
      <div class="items">${items.map((i) => `${i.quantity}× ${esc(i.name)}`).join(" · ")}</div>
      <div class="acts"><a class="btn small" href="/pedido?t=${o.tracking_token}">Ver detalle</a>
        <button class="btn small primary" type="button" data-again="${o.code}">Volver a pedir</button></div>
    </article>`; }).join("")}</div>`
    : `<div class="panel"><p class="muted" style="margin:0">Aún no tienes pedidos. Tu primer pedido de $10 o más ya suma sellos.</p><a class="btn primary" href="/" style="margin-top:12px">Ver el menú</a></div>`;
  $("#pane").querySelectorAll("[data-again]").forEach((b) => (b.onclick = () => {
    const o = orders.find((x) => x.code === b.dataset.again);
    const cart = new Map();
    for (const i of o.order_items) if (Number(i.line_total) > 0 && i.product_id) cart.set(i.product_id, (cart.get(i.product_id) || 0) + i.quantity);
    try { localStorage.setItem("tbs_cart", JSON.stringify([...cart])); } catch {}
    location.href = "/?carrito=1";
  }));
}

function paneDatos(acc) {
  const c = acc.customer;
  $("#pane").innerHTML = `
    <form class="panel" id="dataForm" novalidate style="max-width:640px">
      <h2 class="display" style="font-size:26px">Mis datos</h2>
      <p class="muted small" style="margin:4px 0 0">Los usamos para llenar tu próximo pedido más rápido.</p>
      <div class="form-grid2">
        <div><label class="f" for="dName">Nombre</label><input class="in" id="dName" value="${esc(c.full_name || "")}" autocomplete="name"></div>
        <div><label class="f" for="dPhone">WhatsApp</label><input class="in" id="dPhone" type="tel" inputmode="tel" value="${esc(c.phone || "")}" placeholder="0991234567" autocomplete="tel"></div>
      </div>
      <label class="f" for="dAddr">Dirección de entrega <span class="hint">(ciudadela, manzana y villa, o calle y número)</span></label>
      <input class="in" id="dAddr" value="${esc(String(c.address || "").split(" · Ubicación del mapa: ")[0])}" autocomplete="street-address">
      <label class="f" for="dRef">Referencia</label>
      <input class="in" id="dRef" value="${esc(c.reference || "")}" placeholder="Casa blanca frente al parque">
      <label class="f" for="dBday">Cumpleaños <span class="hint">${c.birthday ? "(ya registrado)" : "(solo se puede guardar una vez)"}</span></label>
      <input class="in" id="dBday" type="date" value="${esc(c.birthday || "")}" ${c.birthday ? "disabled" : ""} max="${new Date().toISOString().slice(0, 10)}" style="max-width:220px">
      <p class="muted small" style="margin:12px 0 0">Correo de tu cuenta: ${esc(c.email || "")}</p>
      <button class="btn primary" style="margin-top:14px">Guardar mis datos</button>
    </form>`;
  $("#dataForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = { full_name: $("#dName").value.trim(), phone: $("#dPhone").value.trim() || undefined, address: $("#dAddr").value.trim(), reference: $("#dRef").value.trim() };
    if (!c.birthday && $("#dBday").value) body.birthday = $("#dBday").value;
    try { setAccount(await api("guardar_perfil", body)); toast("Datos guardados"); render(); }
    catch (ex) { toast(ex.message); }
  };
}

function renderGuest() {
  root.innerHTML = `
    <div class="acct-grid">
      <div style="display:grid;gap:14px">
        <div><p class="eyebrow">Recompensas The Bakery Side</p><h1 class="display" style="font-size:clamp(40px,8vw,60px)">Empieza con 2 sellos de regalo</h1></div>
        <p class="muted">Crea tu cuenta con Google en un toque. Ganas 1 sello por cada $10, una cookie gratis al completar 8 sellos y $4 en tu mes de cumpleaños.</p>
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
