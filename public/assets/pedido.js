import { sb, api, $, money, esc, hhmm, when, dayLabel, orderRange, parseBank, STATUS } from "./common.js";
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
  else if (o.status === "por_confirmar") head = `<p class="eyebrow">Pedido ${esc(o.code)}</p><div class="big">Verificando tu transferencia</div><p class="muted">Recibimos tu comprobante. Te avisamos por correo apenas lo confirmemos.</p>`;
  else head = `<p class="eyebrow">Pedido ${esc(o.code)} · ${o.scheduled_for ? `Entrega agendada · ${dayLabel(o.scheduled_for)}` : "Llega entre"}</p><div class="big tabnum range">${orderRange(o, o.eta_window || 30)}</div>`;

  const showSteps = !unpaid && !["cancelado", "por_confirmar"].includes(o.status);
  $("#root").innerHTML = `
    <div class="panel">${head}
      ${unpaid ? `<div class="paybox">
        <div class="payseg" role="tablist" aria-label="Forma de pago">
          <button type="button" role="tab" id="segCard" aria-selected="${!wantAlt}">Tarjeta</button>
          <button type="button" role="tab" id="segAlt" aria-selected="${wantAlt}">Transferencia, PeiGo o DeUna</button>
        </div>
        <div id="altPay" ${wantAlt ? "" : "hidden"}>
          <ol class="paysteps">
            <li><span class="pn">1</span><div class="pbody"><b>Paga <span class="tabnum">${money(o.group_total ?? o.total)}</span></b>
              <div class="paytabs" id="payTabs" role="tablist"></div>
              <div id="payPane" class="paypane"><p class="muted small">Cargando…</p></div></div></li>
            <li><span class="pn">2</span><div class="pbody"><b>Sube la captura del pago</b>
              <label class="drop" id="drop" for="receipt">
                <input id="receipt" type="file" accept="image/*,application/pdf">
                <span class="drop-empty"><svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
                  <b>Toca aquí para elegir la captura</b><small>Foto o captura de pantalla del pago (también PDF)</small></span>
                <span class="drop-full" hidden><img id="rcPrev" alt=""><span><b id="rcName"></b><small>Toca para cambiarla</small></span></span>
              </label></div></li>
            <li><span class="pn">3</span><div class="pbody"><b>Envíala y listo</b>
              <button class="btn primary block" id="sendReceipt" disabled>Enviar comprobante</button>
              <p class="muted small" style="margin:6px 0 0">Te avisamos por correo apenas confirmemos el pago.</p></div></li>
          </ol>
        </div>
        <div id="cardPay" ${wantAlt ? "hidden" : ""}>
          <button class="btn primary block" id="payNow">Pagar ${money(o.group_total ?? o.total)} con tarjeta</button>
        </div>
        <p class="err" id="err" role="alert"></p></div>` : ""}
      ${o.delivery_pin ? `<div class="pinbox"><span class="lbl">Tu PIN de entrega</span><span class="pinnum tabnum" aria-label="PIN ${o.delivery_pin.split("").join(" ")}">${o.delivery_pin.split("").map((d) => `<i>${d}</i>`).join("")}</span>
        <small>${o.is_gift ? "Como es un regalo, compártelo con quien lo recibe. " : ""}Dáselo al motorizado solo cuando tengas el pedido en tus manos. Así confirmamos que llegó a ti.</small></div>` : ""}
      ${showSteps ? `<ol class="steps">${steps.map(([k, l, t, sub], i) => `<li class="${o.status === "entregado" || i < idx ? "done" : i === Math.ceil(idx) ? "now" : ""}"><span class="dot"></span><div><b>${l}</b><small>${esc(sub)}</small></div><span class="t">${t ? hhmm(t) : ""}</span></li>`).join("")}</ol>` : ""}
    </div>
    ${o.linked?.length ? `<div class="panel linked"><p class="eyebrow">Va en dos entregas · un solo pago</p>
      ${unpaid ? `<p class="small" style="margin:4px 0 8px">El pago de <b class="tabnum">${money(o.group_total)}</b> cubre las dos entregas.</p>` : ""}
      ${o.linked.map((l) => `<a class="link-row" href="/pedido?t=${l.tracking_token}"><span><b>Pedido ${esc(l.code)}</b><small>${l.scheduled_for ? `${dayLabel(l.scheduled_for)}, ${orderRange(l, o.eta_window || 30)}` : `Llega entre ${orderRange(l, o.eta_window || 30)}`}</small></span><span aria-hidden="true">›</span></a>`).join("")}</div>` : ""}
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
    let loaded = false;
    const seg = (alt) => {
      $("#segCard").setAttribute("aria-selected", !alt); $("#segAlt").setAttribute("aria-selected", alt);
      $("#altPay").hidden = !alt; $("#cardPay").hidden = alt; $("#err").textContent = "";
      if (alt && !loaded) { loaded = true; api("pago_info", { tracking_token: token }).then(renderPayOptions).catch((e) => { loaded = false; $("#payPane").innerHTML = `<p class="err">${esc(e.message)}</p>`; }); }
    };
    $("#segCard").onclick = () => seg(false);
    $("#segAlt").onclick = () => seg(true);
    if (wantAlt) seg(true);
    $("#receipt").onchange = () => {
      const f = $("#receipt").files[0];
      $(".drop-empty").hidden = !!f; $(".drop-full").hidden = !f; $("#drop").classList.toggle("has", !!f);
      $("#sendReceipt").disabled = !f; $("#err").textContent = "";
      if (!f) return;
      $("#rcName").textContent = f.name.length > 34 ? f.name.slice(0, 31) + "…" : f.name;
      const img = $("#rcPrev");
      if (f.type.startsWith("image/")) { img.src = URL.createObjectURL(f); img.hidden = false; } else img.hidden = true;
    };
    $("#sendReceipt").onclick = async () => {
      const f = $("#receipt").files[0];
      if (!f) return ($("#err").textContent = "Elige la foto del comprobante.");
      $("#sendReceipt").disabled = true; $("#sendReceipt").textContent = "Enviando…";
      try {
        const up = await api("subir", { tracking_token: token });
        const { error } = await sb.storage.from("comprobantes").uploadToSignedUrl(up.path, up.token, f, { contentType: f.type || "image/jpeg" });
        if (error) throw new Error("No pudimos subir la foto. Intenta de nuevo.");
        await api("comprobante", { tracking_token: token, path: up.path });
        history.replaceState(null, "", `/pedido?t=${token}`);
        load();
      } catch (e) { $("#err").textContent = e.message; $("#sendReceipt").disabled = false; $("#sendReceipt").textContent = "Enviar comprobante"; }
    };
  }
  clearTimeout(timer);
  if (!["entregado", "cancelado"].includes(o.status) && !unpaid) timer = setTimeout(load, 20000);
}

// Logos oficiales (tomados de los sitios de cada banco); si no hay logo, va la inicial con color
const BANK_LOGOS = [[/amazonas/i, "amazonas.png"], [/guayaquil/i, "guayaquil.svg"], [/machala/i, "machala.png", "#295135"], [/pac[ií]fico/i, "pacifico.svg"], [/pichincha/i, "pichincha.svg"]];
const BANK_COLORS = [[/amazonas/i, "#C8102E"], [/guayaquil/i, "#D2006E"], [/machala/i, "#295135"], [/pac[ií]fico/i, "#009FDF"], [/pichincha/i, "#FFDD00"], [/produbanco/i, "#00843D"], [/bolivariano/i, "#003B71"], [/internacional/i, "#E30613"]];
const bankLogo = (n) => (BANK_LOGOS.find(([re]) => re.test(n)) || [])[1];
const bankTile = (n) => (BANK_LOGOS.find(([re]) => re.test(n)) || [])[2];
const bankColor = (n) => (BANK_COLORS.find(([re]) => re.test(n)) || [0, "#C68A4E"])[1];
const bankInitial = (n) => (String(n).replace(/^banco\s+(del?\s+)?/i, "")[0] || "B").toUpperCase();
const bankSort = (n) => String(n).replace(/^banco\s+(del?\s+)?/i, "");

// Opciones para pagar sin tarjeta: transferencia, QR de PeiGo y QR de DeUna
function renderPayOptions(info) {
  const opts = [];
  const bank = parseBank(info.bank_info);
  if (bank && bank.accounts.length) opts.push(["banco", "Transferencia directa"]);
  if (info.qr?.peigo) opts.push(["peigo", "PeiGo"]);
  if (info.qr?.deuna) opts.push(["deuna", "DeUna"]);
  if (bank) bank.accounts.sort((a, b) => bankSort(a.bank).localeCompare(bankSort(b.bank), "es", { sensitivity: "base" }));
  if (!opts.length) { $("#payTabs").innerHTML = ""; $("#payPane").innerHTML = `<p class="muted small">Escríbenos por WhatsApp y te enviamos cómo pagar.</p>`; return; }
  const show = (k) => {
    $("#payTabs").querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.dataset.k === k));
    if (k === "banco") {
      // Transferencia dentro del mismo banco: solo nombre y correo (sin cédula)
      const copyBtn = (v, lbl) => `<button type="button" class="copy" data-copy="${esc(v)}" aria-label="Copiar ${esc(lbl)}">Copiar</button>`;
      $("#payPane").innerHTML = `<div class="bank">
        <div class="bank-who"><span class="lbl">A nombre de</span><b>${esc(bank.holder)}</b>${bank.email ? `<span class="row"><span>${esc(bank.email)}</span>${copyBtn(bank.email, "correo")}</span>` : ""}</div>
        <div class="bank-list">${bank.accounts.map((a) => `<div class="bank-acc" style="--bc:${bankColor(a.bank)}">
          ${bankLogo(a.bank) ? `<span class="dot logo" aria-hidden="true"${bankTile(a.bank) ? ` style="background:${bankTile(a.bank)}"` : ""}><img src="/assets/banks/${bankLogo(a.bank)}" alt="" width="28" height="28"></span>` : `<span class="dot" aria-hidden="true">${esc(bankInitial(a.bank))}</span>`}
          <span class="tx"><b>${esc(a.bank)}</b><small>Cuenta de ${esc(String(a.type || "ahorros").toLowerCase())}</small><span class="num tabnum">${esc(a.number)}</span></span>
          ${copyBtn(a.number, "número de cuenta")}</div>`).join("")}</div>
        <p class="bank-amt">Monto exacto <b class="tabnum">${money(info.total)}</b> · Referencia <b>${esc(info.code)}</b> ${copyBtn(info.code, "referencia")}</p>
      </div>`;
      $("#payPane").querySelectorAll("[data-copy]").forEach((b) => (b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "¡Copiado!"; setTimeout(() => (b.textContent = "Copiar"), 1500); })));
      return;
    }
    const url = info.qr[k], name = k === "deuna" ? "DeUna" : "PeiGo";
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
