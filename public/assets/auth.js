import { sb, $, toast } from "./common.js";

// Muestra el ingreso (contraseña o enlace por correo) hasta que haya sesión; luego llama a onReady(user)
export async function requireLogin(onReady) {
  const box = $("#login"), app = $("#app");
  const show = async (session) => {
    if (session?.user) { box.hidden = true; app.hidden = false; $("#whoami").textContent = session.user.email; $("#setPass").hidden = false; await onReady(session.user); }
    else { box.hidden = false; app.hidden = true; $("#setPass").hidden = true; }
  };
  const { data } = await sb.auth.getSession();
  let started = false;
  sb.auth.onAuthStateChange((_e, session) => {
    if (session && !started) { started = true; show(session); }
    if (!session) { started = false; show(null); }
  });
  if (data.session) { started = true; await show(data.session); } else show(null);

  const msg = (t) => ($("#loginMsg").textContent = t);
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim(), password = $("#loginPass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Escribe un correo válido.");
    if (!password) return msg("Escribe tu contraseña, o usa «Enviarme un enlace» si aún no la creas.");
    $("#loginBtn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    $("#loginBtn").disabled = false;
    if (error) msg(/invalid/i.test(error.message) ? "Correo o contraseña incorrectos. Si aún no creaste tu contraseña, usa «Enviarme un enlace»." : error.message);
  });
  $("#magicBtn").addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Escribe un correo válido.");
    $("#magicBtn").disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $("#magicBtn").disabled = false;
    if (!error) return msg(`Te enviamos un enlace a ${email}. Ábrelo en este mismo navegador. Una vez dentro, crea tu contraseña con el botón «Contraseña».`);
    msg(/rate limit/i.test(error.message)
      ? "Se enviaron demasiados enlaces en poco tiempo. Espera unos minutos y vuelve a intentar, o entra con tu contraseña."
      : `No pudimos enviar el enlace: ${error.message}`);
  });
  $("#logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

  // Crear o cambiar la contraseña estando dentro
  $("#setPass").onclick = () => { $("#passBox").hidden = !$("#passBox").hidden; $("#newPass").focus(); };
  $("#passForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = $("#newPass").value, p2 = $("#newPass2").value;
    if (p1.length < 8) return toast("La contraseña debe tener al menos 8 caracteres.");
    if (p1 !== p2) return toast("Las dos contraseñas no coinciden.");
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) return toast("No se pudo guardar: " + error.message);
    $("#passForm").reset(); $("#passBox").hidden = true;
    toast("Contraseña guardada. La próxima vez entra con tu correo y contraseña.");
  });
}

export const loginHTML = (title) => `
  <section id="login" class="wrap" hidden style="padding-block:56px">
    <form id="loginForm" class="panel" style="max-width:420px;margin:0 auto;display:grid;gap:6px" novalidate>
      <h1 class="display" style="font-size:42px">${title}</h1>
      <label class="f" for="loginEmail">Correo</label>
      <input class="in" id="loginEmail" type="email" autocomplete="email" required>
      <label class="f" for="loginPass">Contraseña</label>
      <input class="in" id="loginPass" type="password" autocomplete="current-password">
      <button class="btn primary" id="loginBtn" style="margin-top:12px">Entrar</button>
      <button class="btn ghost" id="magicBtn" type="button">Primera vez u olvidé mi contraseña: enviarme un enlace</button>
      <p class="muted small" id="loginMsg" role="status"></p>
    </form>
  </section>
  <section id="passBox" class="wrap" hidden style="padding-top:16px">
    <form id="passForm" class="panel" style="max-width:420px;display:grid;gap:6px" novalidate>
      <h2 class="display" style="font-size:28px">Crear o cambiar contraseña</h2>
      <label class="f" for="newPass">Nueva contraseña <span class="hint">(mínimo 8 caracteres)</span></label>
      <input class="in" id="newPass" type="password" autocomplete="new-password">
      <label class="f" for="newPass2">Repite la contraseña</label>
      <input class="in" id="newPass2" type="password" autocomplete="new-password">
      <button class="btn primary" style="margin-top:10px">Guardar contraseña</button>
    </form>
  </section>`;
