import { sb, api, $, money, esc, hhmm, when, STATUS } from "./common.js";
import { openPayphone } from "./payphone.js";

const token = new URLSearchParams(location.search).get("t") || localStorage.getItem("tbs_ultimo_pedido");
let cfg = null, timer;

async function load() {
  if (!token) { $("#root").innerHTML = `<p>No encontramos tu pedido. <a href="/">Volver a la tienda</a></p>`; return; }
  const { data, error } = await sb.rpc("track_order", { p_token: token });
  if (error || !data?.length) { $("#root").innerHTML = `<p>No encontramos este pedido. <a href="/">Volver a la tienda</a></p>`; return; }
  render(data[0]);
}

function render(o) {
  const order = ["confirmado", "preparando", "en_camino", "entregado"];
  const idx = o.status === "listo" ? 1.5 : order.indexOf(o.status);
  const steps = [
    ["confirmado", "Pago confirmado", o.paid_at, "Tu pedido entró a cocina"],
    ["preparando", "En preparación", o.prep_started_at, "Lo estamos preparando"],
    ["en_camino", "En camino", o.picked_at, o.rider_name ? `${o.rider_name}${o.rider_plate ? " · placa " + o.rider_plate : ""}` : "Asignando motorizado"],
    ["entregado", "Entregado", o.delivered_at, "¡Que lo disfrutes!"],
  ];
  const unpaid = o.status === "pendiente_pago";
  const wantAlt = new URLSearchParams(location.search).get("pagar") === "1";
  let head;
  if (o.status === "cancelado") head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Cancelado</div><p class="muted">Si tienes dudas, escríbenos por WhatsApp.</p>`;
  else if (o.status === "entregado") head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Entregado</div><p class="muted">${when(o.delivered_at)}</p>`;
  else if (unpaid) head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Falta el pago</div><p class="muted">${o.payment_status === "fallido" ? "El último intento de pago no se aprobó." : "Tu pedido está guardado, pero aún no recibimos el pago."} Lo preparamos apenas se confirme.</p>`;
  else if (o.status === "por_confirmar") head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Verificando tu transferencia</div><p class="muted">Recibimos tu comprobante. Te avisamos por WhatsApp apenas lo confirmemos.</p>`;
  else head = `<p class="eyebrow">Pedido ${esc(o.code)} · ${o.scheduled_for ? "Entrega agendada" : "Llega aprox."}</p><div class="big tabnum">${o.scheduled_for ? when(o.scheduled_for) : hhmm(o.eta)}</div>`;

  const showSteps = !unpaid && !["cancelado", "por_confirmar"].includes(o.status);
  $("#root").innerHTML = `
    <div class="panel">${head}
      ${unpaid ? `<div style="display:grid;gap:10px;margin-top:14px">
        <div id="altPay" ${wantAlt ? "" : "hidden"}>
          <p class="small" style="margin:0 0 8px">Paga <b class="tabnum">${money(o.total)}</b> con:</p>
          <div class="paytabs" id="payTabs" role="tablist"></div>
          <div id="payPane" class="paypane"><p class="muted small">Cargando…</p></div>
          <label class="f" for="receipt">Captura o foto del pago</label><input class="in" id="receipt" type="file" accept="image/*,application/pdf">
          <button class="btn primary block" id="sendReceipt" style="margin-top:10px">Enviar comprobante</button>
          <p class="muted small" style="margin:8px 0 0">¿Prefieres tarjeta? <a href="#" id="toCard">Paga con tarjeta</a>.</p>
        </div>
        <div id="cardPay" ${wantAlt ? "hidden" : ""}>
          <button class="btn primary block" id="payNow">Pagar ${money(o.total)} con tarjeta</button>
          <p class="muted small" style="margin:8px 0 0">¿Prefieres Deuna, Peigo o transferencia? <a href="#" id="showUpload">Ver cómo pagar</a>.</p>
        </div>
        <p class="err" id="err" role="alert"></p></div>` : ""}
      ${showSteps ? `<ol class="steps">${steps.map(([k, l, t, sub], i) => `<li class="${o.status === "entregado" || i < idx ? "done" : i === Math.ceil(idx) ? "now" : ""}"><span class="dot"></span><div><b>${l}</b><small>${esc(sub)}</small></div><span class="t">${t ? hhmm(t) : ""}</span></li>`).join("")}</ol>` : ""}
    </div>
    <div class="panel">
      <div class="lines">${o.items.map((i) => `<div class="line"><span>${i.quantity} × ${esc(i.name)}</span><span class="tabnum">${money(i.line_total)}</span></div>`).join("")}
      ${Number(o.subtotal) + Number(o.delivery_fee) - Number(o.total) > 0.004 ? `<div class="line"><span>Regalo de cumpleaños</span><span class="tabnum">−${money(Number(o.subtotal) + Number(o.delivery_fee) - Number(o.total))}</span></div>` : ""}
      <div class="line"><span>Envío</span><span class="tabnum">${money(o.delivery_fee)}</span></div>
      <div class="line total"><span>Total</span><span class="tabnum">${money(o.total)}</span></div></div>
      ${cfg?.whatsapp ? `<a class="btn block" href="https://wa.me/${cfg.whatsapp.replace(/\D/g, "").replace(/^0/, "593")}?text=${encodeURIComponent("Hola, consulto por mi pedido " + o.code)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ""}
    </div>`;

  if (unpaid) {
    $("#payNow").onclick = async () => {
      $("#err").textContent = "";
      try { const r = await api("pagar", { tracking_token: token }); openPayphone(r.payphone, `Pedido ${r.code} · Total ${money(r.total)}`, token); }
      catch (e) { $("#err").textContent = e.message; }
    };
    const showAlt = async () => {
      $("#altPay").hidden = false; $("#cardPay").hidden = true;
      try { renderPayOptions(await api("pago_info", { tracking_token: token })); }
      catch (e) { $("#payPane").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };
    $("#showUpload").onclick = (e) => { e.preventDefault(); showAlt(); };
    $("#toCard").onclick = (e) => { e.preventDefault(); $("#altPay").hidden = true; $("#cardPay").hidden = false; };
    if (wantAlt) showAlt();
    $("#sendReceipt").onclick = async () => {
      const f = $("#receipt").files[0];
      if (!f) return ($("#err").textContent = "Elige la foto del comprobante.");
      $("#sendReceipt").disabled = true;
      try {
        const up = await api("subir", { tracking_token: token });
        const { error } = await sb.storage.from("comprobantes").uploadToSignedUrl(up.path, up.token, f, { contentType: f.type || "image/jpeg" });
        if (error) throw new Error("No pudimos subir la foto. Intenta de nuevo.");
        await api("comprobante", { tracking_token: token, path: up.path });
        history.replaceState(null, "", `/pedido?t=${token}`);
        load();
      } catch (e) { $("#err").textContent = e.message; $("#sendReceipt").disabled = false; }
    };
  }
  clearTimeout(timer);
  if (!["entregado", "cancelado"].includes(o.status) && !unpaid) timer = setTimeout(load, 20000);
}

// Opciones para pagar sin tarjeta: QR de Deuna, QR de Peigo y transferencia
function renderPayOptions(info) {
  const opts = [];
  if (info.qr?.deuna) opts.push(["deuna", "Deuna"]);
  if (info.qr?.peigo) opts.push(["peigo", "Peigo"]);
  if (info.bank_info) opts.push(["banco", "Transferencia"]);
  if (!opts.length) { $("#payTabs").innerHTML = ""; $("#payPane").innerHTML = `<p class="muted small">Escríbenos por WhatsApp y te enviamos cómo pagar.</p>`; return; }
  const show = (k) => {
    $("#payTabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === k));
    if (k === "banco") { $("#payPane").innerHTML = `<div class="note" style="white-space:pre-line">${esc(info.bank_info)}</div><p class="muted small" style="margin:8px 0 0">Monto exacto: <b class="tabnum">${money(info.total)}</b> · Referencia: ${esc(info.code)}</p>`; return; }
    const url = info.qr[k], name = k === "deuna" ? "Deuna" : "Peigo";
    $("#payPane").innerHTML = `<div class="qrbox"><img src="${esc(url)}" alt="Código QR de ${name} de The Bakery Side" width="220" height="220">
      <div><p class="small" style="margin:0"><b>Desde otro celular:</b> abre ${name} y escanea el código.</p>
      <p class="small" style="margin:6px 0 0"><b>Desde este celular:</b> guarda la imagen y en ${name} elige escanear desde tu galería.</p>
      <a class="btn small" href="${esc(url)}" download="TBS-${name}.png" target="_blank" rel="noopener" style="margin-top:8px">Guardar QR</a>
      <p class="muted small" style="margin:8px 0 0">Escribe el monto exacto: <b class="tabnum">${money(info.total)}</b>.</p></div></div>`;
  };
  $("#payTabs").innerHTML = opts.map(([k, l]) => `<button type="button" role="tab" data-k="${k}">${l}</button>`).join("");
  $("#payTabs").querySelectorAll("button").forEach((b) => (b.onclick = () => show(b.dataset.k)));
  show(opts[0][0]);
}

api("config").then((c) => (cfg = c)).catch(() => {}).finally(load);
