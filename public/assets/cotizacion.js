// The Bakery Side · Página pública de una cotización (/cotizacion?t=…). Se imprime o guarda como PDF.
import { sb, $, money, esc, waLink, parseBank, todayLocal } from "./common.js";

const t = new URLSearchParams(location.search).get("t");
const doc = $("#doc");
const fmt = (d, opts = { day: "numeric", month: "long", year: "numeric" }) => new Date(String(d).length <= 10 ? d + "T12:00:00" : d).toLocaleDateString("es-EC", { ...opts, timeZone: "America/Guayaquil" });

async function main() {
  if (!t || !/^[0-9a-f-]{36}$/i.test(t)) return fail();
  const { data: q, error } = await sb.rpc("quote_public", { t });
  if (error || !q) return fail();
  document.title = `Cotización ${q.code} · The Bakery Side`;
  const expired = q.valid_until && q.valid_until < todayLocal() && q.status !== "aceptada";
  const disc = Number(q.discount) > 0.004;
  const dep = Math.round(Number(q.total) * Number(q.deposit_pct) * 100) / 100;
  const bank = parseBank(q.bank_info);
  // Con pago total (100 %) o sin anticipo, no tiene sentido hablar de anticipo ni de saldo: se quitan esas frases de las condiciones.
  const pctDep = Number(q.deposit_pct);
  const terms = (pctDep >= 1 || pctDep <= 0)
    ? String(q.terms || "").split(/(?<=\.)\s+/).filter((s) => !/anticipo|saldo/i.test(s)).join(" ").trim()
    : q.terms;
  const wa = q.whatsapp ? waLink(q.whatsapp, `¡Hola! Quiero confirmar la cotización ${q.code} de The Bakery Side.`) : null;
  const del = q.delivery === "domicilio" ? money(q.delivery_fee) : q.delivery === "retiro" ? "Retiro en local" : "Por confirmar";
  doc.innerHTML = `
    <article class="sheet">
      <header class="hd">
        <div><img src="/assets/brand/tbs-tinta.svg" alt="The Bakery Side" width="110" height="59"><div class="tag" style="margin-top:10px">¡Qué dulce!</div></div>
        <div class="meta"><h1>Cotización</h1><div><b>${esc(q.code)}</b></div><div>${esc(fmt(q.created_at))}</div>
          ${q.status === "aceptada" ? `<span class="badge ok">Aceptada</span>` : expired ? `<span class="badge old">Vencida</span>` : q.valid_until ? `<div>Válida hasta el <b>${esc(fmt(q.valid_until))}</b></div>` : ""}</div>
      </header>
      <section class="who">
        <div><span>Para</span><b>${esc(q.customer_name || "Cliente")}</b></div>
        ${q.event_date ? `<div><span>Fecha del evento</span><b>${esc(fmt(q.event_date, { weekday: "long", day: "numeric", month: "long" }))}</b></div>` : ""}
        <div><span>Entrega</span><b>${q.delivery === "domicilio" ? "A domicilio" : q.delivery === "retiro" ? "Retiro en local" : "Por confirmar"}</b></div>
      </section>
      <table class="items">
        <thead><tr><th>Producto</th><th class="n">Cant.</th><th class="n lp">Precio normal</th><th class="n">Precio c/u</th><th class="n">Total</th></tr></thead>
        <tbody>${q.items.map((i) => {
          const off = Number(i.list_price) > Number(i.unit_price) + 0.004;
          return `<tr><td><b>${esc(i.name)}</b>${i.detail ? `<small>${esc(i.detail)}</small>` : ""}${off ? `<small style="color:var(--ok)">−${Math.round((1 - i.unit_price / i.list_price) * 100)} % por cantidad</small>` : ""}</td>
            <td class="n">${Number(i.qty)}</td><td class="n lp">${off ? `<s>${money(i.list_price)}</s>` : money(i.list_price)}</td><td class="n">${money(i.unit_price)}</td><td class="n"><b>${money(i.line_total)}</b></td></tr>`;
        }).join("")}</tbody>
      </table>
      <div class="tot">
        ${disc ? `<div><span>Precio normal</span><span>${money(q.subtotal_list)}</span></div><div class="save"><span>Descuento por cantidad</span><span>−${money(q.discount)}</span></div>` : ""}
        <div><span>Productos</span><span>${money(q.subtotal)}</span></div>
        <div><span>Envío</span><span>${esc(del)}</span></div>
        <div class="grand"><span>Total</span><span>${money(q.total)}</span></div>
      </div>
      ${q.notes ? `<div class="box"><p>${esc(q.notes).replace(/\n/g, "<br>")}</p></div>` : ""}
      ${Number(q.deposit_pct) > 0 ? `<div class="box"><h3>Para reservar</h3>
        <p>${Number(q.deposit_pct) < 1 ? `Anticipo de <b>${money(dep)}</b> (${Math.round(q.deposit_pct * 100)} %) y el saldo de <b>${money(Math.round((q.total - dep) * 100) / 100)}</b> antes de la entrega.` : `Pago total de <b>${money(q.total)}</b> para confirmar.`}</p>
        ${bank && bank.accounts.length ? `<p style="margin-top:8px"><b>Transferencia</b>${bank.holder ? ` a nombre de ${esc(bank.holder)}` : ""}:</p>${bank.accounts.map((a) => `<p>${esc(a.bank)} · ${esc(a.type)} · <b>${esc(a.number)}</b></p>`).join("")}${bank.email ? `<p>Comprobante a ${esc(bank.email)}</p>` : ""}` : ""}
      </div>` : ""}
      ${terms ? `<p class="terms">${esc(terms)}</p>` : ""}
      <footer class="ft"><b>The Bakery Side</b><span>thebakeryside.com · @thebakeryside${q.whatsapp ? ` · WhatsApp ${esc(q.whatsapp)}` : ""}</span></footer>
    </article>
    <div class="acts">
      <button class="btn primary" type="button" id="pdf">Descargar PDF</button>
      ${wa && !expired && q.status !== "aceptada" ? `<a class="btn" href="${esc(wa)}" target="_blank" rel="noopener">Confirmar por WhatsApp</a>` : ""}
    </div>
    <p class="muted small noprint" style="text-align:center;margin-top:10px">En «Descargar PDF», elija «Guardar como PDF» como impresora.</p>`;
  $("#pdf").onclick = () => window.print();
}
function fail() {
  doc.innerHTML = `<div class="sheet" style="text-align:center"><img src="/assets/brand/tbs-tinta.svg" alt="The Bakery Side" width="110" height="59" style="margin:0 auto 14px"><h1 class="display" style="font-size:36px">Cotización no encontrada</h1><p class="muted">El enlace no es válido o la cotización ya no está disponible. Escríbanos por WhatsApp y con gusto le ayudamos.</p><a class="btn primary" href="/">Ir a la tienda</a></div>`;
}
main();
