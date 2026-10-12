// Reseñas de productos: estrellas, lista publicada y formulario para opinar
import { sb, esc, toast } from "./common.js";
import { currentUser } from "./account.js";

export const stars = (n) => `<span class="stars" aria-label="${n} de 5 estrellas">${"★".repeat(Math.round(n))}<span>${"★".repeat(5 - Math.round(n))}</span></span>`;
export const STAMP_PROMO = "🎁 Califica todo tu pedido y gana 1 sello";

// Promedio por producto (solo reseñas comprobadas); si la tabla aún no existe, no hay estrellas
export async function loadRatings() {
  const { data, error } = await sb.rpc("product_ratings");
  return error ? new Map() : new Map((data || []).map((r) => [r.product_id, r]));
}

// Formulario: 5 estrellas + comentario. onDone(estado) al enviar.
export function reviewForm(box, productId, productName, onDone) {
  let rating = 0;
  box.innerHTML = `<form class="rv-form" novalidate>
    <b>¿Qué tal estuvo ${esc(productName)}?</b>
    <div class="rv-pick" role="radiogroup" aria-label="Calificación">${[1, 2, 3, 4, 5].map((i) => `<button type="button" role="radio" aria-checked="false" data-r="${i}" aria-label="${i} ${i === 1 ? "estrella" : "estrellas"}">★</button>`).join("")}</div>
    <textarea class="in" maxlength="500" rows="3" placeholder="Cuéntanos qué te pareció (opcional)"></textarea>
    <p class="muted small" style="margin:0">La revisamos antes de publicarla. Si calificas todos los productos de tu pedido, ganas 1 sello.</p>
    <p class="err small" role="alert" style="margin:0"></p>
    <div class="rv-acts"><button class="btn small primary">Enviar reseña</button><button class="btn small ghost" type="button" data-x>Cancelar</button></div>
  </form>`;
  const f = box.querySelector("form"), picks = [...box.querySelectorAll("[data-r]")];
  const paint = () => picks.forEach((b) => { const on = Number(b.dataset.r) <= rating; b.classList.toggle("on", on); b.setAttribute("aria-checked", Number(b.dataset.r) === rating); });
  picks.forEach((b) => (b.onclick = () => { rating = Number(b.dataset.r); paint(); }));
  box.querySelector("[data-x]").onclick = () => { box.innerHTML = ""; };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const err = f.querySelector(".err");
    if (!rating) return (err.textContent = "Toca las estrellas para calificar.");
    const btn = f.querySelector(".primary"); btn.disabled = true;
    const { data, error } = await sb.rpc("submit_review", { p_product: productId, p_rating: rating, p_comment: f.querySelector("textarea").value });
    if (error) { btn.disabled = false; err.textContent = /sesión/i.test(error.message) ? "Inicia sesión para opinar." : "No pudimos enviar tu reseña. Intenta de nuevo."; return; }
    box.innerHTML = `<p class="rv-thanks">${data === "comprobada" ? "¡Gracias! La revisamos antes de publicarla. Califica todos los productos de tu pedido para ganar tu sello 🎁" : "¡Gracias por tu opinión! La revisamos antes de publicarla."}</p>`;
    toast("¡Gracias por tu reseña!");
    onDone?.(data);
  };
}

// Panel que se despliega debajo del producto: reseñas publicadas + botón para opinar
export async function reviewsPanel(box, product) {
  box.innerHTML = `<p class="muted small" style="margin:0">Cargando reseñas…</p>`;
  const { data } = await sb.rpc("product_reviews", { p_product: product.id });
  const list = data || [];
  box.innerHTML = `${list.length ? list.map((r) => `<div class="rv-item">
      <div class="rv-top">${stars(r.rating)}<b>${esc(r.author || "Cliente")}</b>${r.verified ? `<span class="rv-ok">✓ Compra comprobada</span>` : `<span class="rv-no">Sin compra comprobada</span>`}</div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}</div>`).join("") : `<p class="muted small" style="margin:0">Aún no hay reseñas de este producto.</p>`}
    <div class="rv-write"><button type="button" class="linkbtn" data-write>Escribir una reseña</button><span class="rv-promo">${STAMP_PROMO}</span></div>
    <div class="rv-formbox"></div>`;
  box.querySelector("[data-write]").onclick = async () => {
    const fb = box.querySelector(".rv-formbox");
    if (!(await currentUser())) { fb.innerHTML = `<p class="small" style="margin:0">Para opinar necesitas tu cuenta. <a href="/cuenta">Entrar con Google</a></p>`; return; }
    reviewForm(fb, product.id, product.name);
  };
}
