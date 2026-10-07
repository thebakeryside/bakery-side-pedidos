import { sb, $ } from "./common.js";

// Muestra el formulario de ingreso por correo hasta que haya sesión; luego llama a onReady(user)
export async function requireLogin(onReady) {
  const box = $("#login"), app = $("#app");
  const show = async (session) => {
    if (session?.user) { box.hidden = true; app.hidden = false; $("#whoami").textContent = session.user.email; await onReady(session.user); }
    else { box.hidden = false; app.hidden = true; }
  };
  const { data } = await sb.auth.getSession();
  let started = false;
  sb.auth.onAuthStateChange((_e, session) => {
    if (session && !started) { started = true; show(session); }
    if (!session) { started = false; show(null); }
  });
  if (data.session) { started = true; await show(data.session); } else show(null);

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return ($("#loginMsg").textContent = "Escribe un correo válido.");
    $("#loginBtn").disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $("#loginBtn").disabled = false;
    $("#loginMsg").textContent = error
      ? `No pudimos enviar el enlace: ${error.message}`
      : `Te enviamos un enlace a ${email}. Ábrelo en este mismo celular o computadora para entrar.`;
  });
  $("#logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

export const loginHTML = (title) => `
  <section id="login" class="wrap" hidden style="padding-block:56px">
    <form id="loginForm" class="panel" style="max-width:420px;margin:0 auto;display:grid;gap:6px" novalidate>
      <h1 class="display" style="font-size:42px">${title}</h1>
      <p class="muted small">Entra con tu correo. Te enviamos un enlace de acceso, sin contraseña.</p>
      <label class="f" for="loginEmail">Correo</label>
      <input class="in" id="loginEmail" type="email" autocomplete="email" required>
      <button class="btn primary" id="loginBtn" style="margin-top:12px">Enviarme el enlace</button>
      <p class="muted small" id="loginMsg" role="status"></p>
    </form>
  </section>`;
