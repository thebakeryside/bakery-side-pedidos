// Cajita de Pagos de Payphone: https://docs.payphone.app/cajita-de-pagos-payphone
const CSS = "https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.css";
const JS = "https://cdn.payphonetodoesposible.com/box/v2.0/payphone-payment-box.js";
let loading;

function loadBox() {
  if (window.PPaymentButtonBox) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = CSS; document.head.append(l);
    const s = document.createElement("script"); s.type = "module"; s.src = JS;
    s.onerror = () => reject(new Error("No pudimos abrir el pago. Revisa tu conexión."));
    document.head.append(s);
    const t0 = Date.now();
    (function wait() {
      if (window.PPaymentButtonBox) return resolve();
      if (Date.now() - t0 > 15000) return reject(new Error("El pago tardó demasiado en abrir. Intenta de nuevo."));
      setTimeout(wait, 100);
    })();
  });
  return loading;
}

export async function openPayphone(params, info, trackingToken) {
  const modal = document.getElementById("payModal");
  document.getElementById("payInfo").textContent = info;
  const box = document.getElementById("pp-button");
  box.innerHTML = "<p>Abriendo el pago seguro…</p>";
  modal.hidden = false;
  document.getElementById("closePay").onclick = () => {
    modal.hidden = true;
    // El pedido queda guardado sin pagar; desde el seguimiento puede intentar de nuevo
    if (trackingToken) location.href = `/pedido?t=${trackingToken}`;
  };
  try {
    await loadBox();
    box.innerHTML = "";
    new window.PPaymentButtonBox(params).render("pp-button");
  } catch (e) {
    box.innerHTML = `<p style="color:#9b2c1d">${e.message}</p>`;
  }
}
