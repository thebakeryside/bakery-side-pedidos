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
  let head;
  if (o.status === "cancelado") head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Cancelado</div><p class="muted">Si tienes dudas, escríbenos por WhatsApp.</p>`;
  else if (o.status === "entregado") head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Entregado</div><p class="muted">${when(o.delivered_at)}</p>`;
  else if (unpaid) head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Falta el pago</div><p class="muted">${o.payment_status === "fallido" ? "El último intento de pago no se aprobó." : "Tu pedido está guardado, pero aún no recibimos el pago."} Lo preparamos apenas se confirme.</p>`;
  else if (o.status === "por_confirmar") head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Verificando tu transferencia</div><p class="muted">Recibimos tu comprobante. Te avisamos por WhatsApp apenas lo confirmemos.</p>`;
  else head = `<p class="eyebrow">Pedido ${esc(o.code)} · ${o.scheduled_for ? "Entrega agendada" : "Llega aprox."}</p><div class="big tabnum">${o.scheduled_for ? when(o.scheduled_for) : hhmm(o.eta)}</div>`;

  const showSteps = !unpaid && !["cancelado", "por_confirmar"].includes(o.status);
  $("#root").innerHTML = `
    <div class="panel">${head}
      ${unpaid ? `<div style="display:grid;gap:8px;margin-top:14px">
        <button class="btn primary" id="payNow">Pagar ${money(o.total)} con tarjeta</button>
        <p class="muted small">¿Prefieres transferencia? <a href="#" id="showUpload">Sube tu comprobante</a>.</p>
        <div id="uploadBox" hidden>
          <div class="note" id="bankInfo"></div>
          <label class="f" for="receipt">Foto del comprobante</label><input class="in" id="receipt" type="file" accept="image/*,application/pdf">
          <button class="btn" id="sendReceipt" style="margin-top:10px">Enviar comprobante</button>
        </div>
        <p class="err" id="err" role="alert"></p></div>` : ""}
      ${showSteps ? `<ol class="steps">${steps.map(([k, l, t, sub], i) => `<li class="${o.status === "entregado" || i < idx ? "done" : i === Math.ceil(idx) ? "now" : ""}"><span class="dot"></span><div><b>${l}</b><small>${esc(sub)}</small></div><span class="t">${t ? hhmm(t) : ""}</span></li>`).join("")}</ol>` : ""}
    </div>
    <div class="panel">
      <div class="lines">${o.items.map((i) => `<div class="line"><span>${i.quantity} × ${esc(i.name)}</span><span class="tabnum">${money(i.line_total)}</span></div>`).join("")}
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
    $("#showUpload").onclick = (e) => { e.preventDefault(); $("#uploadBox").hidden = false; $("#bankInfo").textContent = cfg?.bank_info || "Escríbenos por WhatsApp para recibir los datos de la cuenta."; };
    $("#sendReceipt").onclick = async () => {
      const f = $("#receipt").files[0];
      if (!f) return ($("#err").textContent = "Elige la foto del comprobante.");
      $("#sendReceipt").disabled = true;
      try {
        const up = await api("subir", { tracking_token: token });
        const { error } = await sb.storage.from("comprobantes").uploadToSignedUrl(up.path, up.token, f, { contentType: f.type || "image/jpeg" });
        if (error) throw new Error("No pudimos subir la foto. Intenta de nuevo.");
        await api("comprobante", { tracking_token: token, path: up.path });
        load();
      } catch (e) { $("#err").textContent = e.message; $("#sendReceipt").disabled = false; }
    };
  }
  clearTimeout(timer);
  if (!["entregado", "cancelado"].includes(o.status) && !unpaid) timer = setTimeout(load, 20000);
}

api("config").then((c) => (cfg = c)).catch(() => {}).finally(load);
