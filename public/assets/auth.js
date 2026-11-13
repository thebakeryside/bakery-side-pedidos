import { sb, $, toast } from "./common.js";

// Muestra el ingreso (contraseña o código por correo) hasta que haya sesión; luego llama a onReady(user)
// Reloj en vivo (hora de Guayaquil) en la barra superior de los paneles
export function mountClock() {
  const who = document.querySelector(".who");
  if (!who || who.querySelector(".clock")) return;
  const el = document.createElement("span");
  el.className = "clock tabnum"; el.setAttribute("aria-label", "Hora actual");
  who.prepend(el);
  const fmt = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const tick = () => (el.textContent = fmt.format(new Date()).replace(",", " ·"));
  tick(); setInterval(tick, 1000);
}

export async function requireLogin(onReady) {
  mountClock();
  const box = $("#login"), app = $("#app");
  const show = async (session) => {
    if (session?.user) { box.hidden = true; app.hidden = false; $("#whoami").textContent = session.user.email; $("#setPass").hidden = false; await onReady(session.user);
      const panel = location.pathname.replace(/^\//, "").split(/[/.]/)[0];
      if (["cocina", "moto", "master"].includes(panel)) import("./push.js").then((m) => m.setupApp(panel, session.user)).catch(() => {}); }
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
    if (!password) return msg("Escribe tu contraseña, o usa «Olvidé mi contraseña» para recibir un código.");
    $("#loginBtn").disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    $("#loginBtn").disabled = false;
    if (error) msg(/invalid/i.test(error.message) ? "Correo o contraseña incorrectos. Si la olvidaste, usa «Olvidé mi contraseña»." : error.message);
  });
  // Primera vez u olvidé mi contraseña: código de 6 dígitos por correo (se escribe aquí mismo,
  // sirve también dentro de la app instalada). El enlace del correo sigue funcionando.
  const NEED = "tbs_need_pass";
  const sendCode = async () => {
    const email = $("#loginEmail").value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return msg("Escribe tu correo arriba y vuelve a tocar el botón.");
    $("#magicBtn").disabled = true; $("#resendCode").disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    $("#magicBtn").disabled = false; $("#resendCode").disabled = false;
    if (error) return msg(/rate limit|seconds/i.test(error.message)
      ? "Se enviaron demasiados códigos en poco tiempo. Espera un minuto y vuelve a intentar."
      : `No pudimos enviar el código: ${error.message}`);
    try { localStorage.setItem(NEED, "1"); } catch {}
    $("#codeBox").hidden = false; $("#loginCode").value = ""; $("#loginCode").focus();
    msg(`Te enviamos un código a ${email}. Escríbelo aquí (revisa también Spam).`);
  };
  $("#magicBtn").addEventListener("click", sendCode);
  $("#resendCode").addEventListener("click", sendCode);
  $("#loginCode").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 10); });
  $("#codeBtn").addEventListener("click", async () => {
    const email = $("#loginEmail").value.trim(), token = $("#loginCode").value.trim();
    if (!/^\d{6,10}$/.test(token)) return msg("Escribe el código de 6 dígitos que llegó a tu correo.");
    $("#codeBtn").disabled = true;
    const { error } = await sb.auth.verifyOtp({ email, token, type: "email" });
    $("#codeBtn").disabled = false;
    if (error) msg(/expired|invalid/i.test(error.message) ? "Código incorrecto o vencido. Revisa el último correo o pide uno nuevo." : error.message);
  });
  // Si entró con código o enlace, abrir de una vez «Crear o cambiar contraseña»
  const askPass = () => {
    let need = false; try { need = localStorage.getItem(NEED) === "1"; } catch {}
    if (!need) return;
    try { localStorage.removeItem(NEED); } catch {}
    $("#passBox").hidden = false; $("#passBox").scrollIntoView({ block: "start" }); $("#newPass").focus();
    toast("¡Listo! Ahora crea tu nueva contraseña.");
  };
  sb.auth.onAuthStateChange((e) => { if (e === "SIGNED_IN" || e === "PASSWORD_RECOVERY") setTimeout(askPass, 300); });
  if (data.session) setTimeout(askPass, 300);

  $("#logout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

  // Mostrar u ocultar lo que se escribe en los campos de contraseña
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-toggle]"); if (!b) return;
    const inp = document.getElementById(b.dataset.toggle);
    const show = inp.type === "password";
    inp.type = show ? "text" : "password";
    b.textContent = show ? "Ocultar" : "Mostrar";
    b.setAttribute("aria-pressed", String(show));
    b.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
  });

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
    for (const id of ["newPass", "newPass2"]) $("#" + id).type = "password";
    document.querySelectorAll('#passForm [data-toggle]').forEach((b) => { b.textContent = "Mostrar"; b.setAttribute("aria-pressed", "false"); });
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
      <div class="pwd"><input class="in" id="loginPass" type="password" autocomplete="current-password"><button class="pwd-toggle" type="button" data-toggle="loginPass" aria-label="Mostrar contraseña" aria-pressed="false">Mostrar</button></div>
      <button class="btn primary" id="loginBtn" style="margin-top:12px">Entrar</button>
      <button class="btn ghost" id="magicBtn" type="button">Primera vez u olvidé mi contraseña: enviarme un código</button>
      <div id="codeBox" hidden style="display:grid;gap:6px;margin-top:8px">
        <label class="f" for="loginCode">Código del correo</label>
        <input class="in tabnum" id="loginCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456" style="font-size:24px;letter-spacing:6px;text-align:center">
        <button class="btn primary" id="codeBtn" type="button">Entrar con el código</button>
        <button class="btn ghost small" id="resendCode" type="button">Enviar otro código</button>
      </div>
      <p class="muted small" id="loginMsg" role="status"></p>
    </form>
  </section>
  <section id="passBox" class="wrap" hidden style="padding-top:16px">
    <form id="passForm" class="panel" style="max-width:420px;display:grid;gap:6px" novalidate>
      <h2 class="display" style="font-size:28px">Crear o cambiar contraseña</h2>
      <label class="f" for="newPass">Nueva contraseña <span class="hint">(mínimo 8 caracteres)</span></label>
      <div class="pwd"><input class="in" id="newPass" type="password" autocomplete="new-password"><button class="pwd-toggle" type="button" data-toggle="newPass" aria-label="Mostrar contraseña" aria-pressed="false">Mostrar</button></div>
      <label class="f" for="newPass2">Repite la contraseña</label>
      <div class="pwd"><input class="in" id="newPass2" type="password" autocomplete="new-password"><button class="pwd-toggle" type="button" data-toggle="newPass2" aria-label="Mostrar contraseña" aria-pressed="false">Mostrar</button></div>
      <button class="btn primary" style="margin-top:10px">Guardar contraseña</button>
    </form>
  </section>`;
