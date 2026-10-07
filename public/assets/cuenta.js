import { sb, api, $, money, esc, when, toast, STATUS } from "./common.js";
import { captureRef, currentUser, loadAccount, setAccount, signInWithGoogle, signOut, stampCard, googleButton } from "./account.js";

captureRef();
const root = $("#root");

async function render() {
  const u = await currentUser();
  if (!u) return renderGuest();
  let acc;
  try { acc = await loadAccount(true); }
  catch (e) { root.innerHTML = `<div class="panel"><p class="err">${esc(e.message)}</p></div>`; return; }
  const c = acc.customer;
  const { data: orders } = await sb.from("orders").select("code,status,total,created_at,tracking_token,order_items(name,quantity)")
    .eq("user_id", u.id).order("created_at", { ascending: false }).limit(30);
  const link = `${location.origin}/?ref=${c.referral_code}`;
  const first = (c.full_name || u.user_metadata?.name || "").split(" ")[0];
  const monthName = (m) => new Date(2026, m - 1, 1).toLocaleDateString("es-EC", { month: "long" });

  root.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:end;gap:12px;flex-wrap:wrap;margin-bottom:16px">
      <div><p class="eyebrow">Mi cuenta</p><h1 class="display" style="font-size:clamp(40px,8vw,60px)">Hola${first ? ", " + esc(first) : ""}</h1></div>
      <button class="btn small ghost" id="out" type="button">Cerrar sesión</button>
    </div>
    <div class="acct-grid">
      <div style="display:grid;gap:14px">
        ${stampCard(acc.stamps)}
        <div class="perk ${acc.rewards_available ? "ready" : ""}"><div><b>${acc.rewards_available ? `Tienes ${acc.rewards_available === 1 ? "una cookie gratis" : acc.rewards_available + " cookies gratis"}` : "Cookie gratis"}</b>
          <span class="muted small">${acc.rewards_available ? "Elígela al pagar tu próximo pedido: Midnight, Snowlemon, Snowchocolate o Chocochip." : "Al completar los 8 sellos ganas una cookie a elección."}</span></div></div>
        <div class="perk ${acc.birthday_available ? "ready" : ""}"><div style="flex:1"><b>Regalo de cumpleaños: $4</b>
          ${c.birthday
            ? `<span class="muted small">${acc.birthday_available ? "¡Feliz cumpleaños! Úsalo en un pedido este mes." : `Lo tendrás disponible todo ${monthName(Number(c.birthday.slice(5, 7)))}.`}</span>`
            : `<span class="muted small">Registra tu fecha y recibe $4 de descuento durante todo tu mes. Solo se puede guardar una vez.</span>
               <form id="bdayForm" class="reflink" style="margin-top:8px" novalidate><input class="in" type="date" id="bday" max="${new Date().toISOString().slice(0, 10)}" aria-label="Fecha de cumpleaños"><button class="btn small">Guardar</button></form>`}
        </div></div>
        <div class="panel" style="display:grid;gap:8px">
          <h2 class="display" style="font-size:26px">Invita a un amigo</h2>
          <p class="muted small" style="margin:0">Tu amigo empieza con 3 sellos y tú ganas 1 sello cuando paga su primer pedido.</p>
          <div class="reflink"><input class="in" id="refLink" value="${esc(link)}" readonly aria-label="Tu enlace de invitación">
            <button class="btn small" id="copyRef" type="button">Copiar</button>
            <a class="btn small primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`Te regalo 3 sellos en The Bakery Side 🧁 Pide aquí: ${link}`)}">Compartir por WhatsApp</a></div>
          <p class="muted small" style="margin:0">Tu código: <b class="tabnum">${esc(c.referral_code)}</b></p>
        </div>
      </div>
      <div class="panel">
        <h2 class="display" style="font-size:26px;margin-bottom:10px">Mis pedidos</h2>
        <div class="hist">${(orders ?? []).map((o) => `<a href="/pedido?t=${o.tracking_token}"><b>${esc(o.code)}</b><span class="st st-${o.status}">${STATUS[o.status]}</span>
          <span class="when">${when(o.created_at)} · ${o.order_items.map((i) => `${i.quantity}× ${esc(i.name)}`).join(", ")}</span><span class="tabnum">${money(o.total)}</span></a>`).join("")
          || `<p class="muted">Aún no tienes pedidos. Tu primer pedido de $10 o más ya suma sellos.</p>`}</div>
      </div>
    </div>`;

  $("#out").onclick = async () => { await signOut(); render(); };
  $("#copyRef").onclick = () => navigator.clipboard?.writeText(link).then(() => toast("Enlace copiado"), () => { $("#refLink").select(); toast("Copia el enlace seleccionado"); });
  const f = $("#bdayForm");
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const v = $("#bday").value;
    if (!v) return toast("Elige tu fecha de cumpleaños.");
    try { setAccount(await api("guardar_perfil", { birthday: v })); toast("Cumpleaños guardado"); render(); }
    catch (ex) { toast(ex.message); }
  };
}

function renderGuest() {
  root.innerHTML = `
    <div class="acct-grid">
      <div style="display:grid;gap:14px">
        <div><p class="eyebrow">Recompensas The Bakery Side</p><h1 class="display" style="font-size:clamp(40px,8vw,60px)">Empieza con 2 sellos de regalo</h1></div>
        <p class="muted">Crea tu cuenta con Google en un toque. Ganas 1 sello por cada $10, una cookie gratis al completar 8 sellos y $4 en tu mes de cumpleaños.</p>
        <div>${googleButton("Crear cuenta con Google")}</div>
        <p class="muted small">¿Prefieres no crear cuenta? Puedes <a href="/">pedir como invitado</a>, pero no acumularás sellos.</p>
      </div>
      ${stampCard(2)}
    </div>`;
  root.querySelector("[data-google]").onclick = () => signInWithGoogle(location.origin + "/cuenta").catch((e) => toast(e.message));
}

let started = false;
sb.auth.onAuthStateChange((ev) => {
  if (ev === "INITIAL_SESSION" || (ev === "SIGNED_IN" && started)) { started = true; render(); }
});
