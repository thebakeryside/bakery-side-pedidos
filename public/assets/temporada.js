// The Bakery Side · Temporada navideña ("Taller navideño")
// Viste las páginas del cliente entre dos fechas y se apaga sola. No toca precios ni pedidos.
//
// Se activa por fecha (hora de Guayaquil). Las fechas y el interruptor se cambian en
// Master → Ajustes → Temporada navideña, que guarda storage productos/temporada/navidad.json.
// Si ese archivo no existe, se usan las fechas de abajo.
//
// Vista previa sin esperar la fecha:   /?navidad=1   (y /?navidad=0 para verla normal)
// Ver un acto en particular:            /?navidad=1&acto=adviento | fiestas | reyes
//
// Tres actos: adviento (hasta el 24 dic) · fiestas (25 al 31 dic) · reyes (1 ene hasta el fin).
// Los textos viven aquí (COPY). tienda.js y pedido.js los piden con TBS_SEASON.t(clave, texto_normal).
(function () {
  "use strict";
  var DEFAULTS = { on: true, from: "2026-11-09", to: "2027-01-06", xmas_deadline: "2026-12-22", ny_deadline: "2026-12-29" };
  var CACHE = "tbs_temporada", PREVIEW = "tbs_temporada_vista";
  var root = document.documentElement;

  // ---------- fecha de Guayaquil (UTC−5, sin horario de verano) ----------
  var today = function () { return new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10); };
  var days = function (a, b) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); };
  var MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  var WEEK = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  var longDate = function (d) { var t = new Date(d + "T12:00:00Z"); return WEEK[t.getUTCDay()] + " " + t.getUTCDate() + " de " + MONTHS[t.getUTCMonth()]; };

  var read = function (k, store) { try { return JSON.parse((store || localStorage).getItem(k) || "null"); } catch (e) { return null; } };
  var write = function (k, v, store) { try { (store || localStorage).setItem(k, JSON.stringify(v)); } catch (e) {} };
  var valid = function (c) { return c && typeof c === "object" && /^\d{4}-\d{2}-\d{2}$/.test(c.from || "") && /^\d{4}-\d{2}-\d{2}$/.test(c.to || ""); };
  var merge = function (c) { var o = {}, k; for (k in DEFAULTS) o[k] = DEFAULTS[k]; if (valid(c)) for (k in c) if (c[k] != null && c[k] !== "") o[k] = c[k]; return o; };

  // ---------- vista previa por enlace ----------
  var qs = new URLSearchParams(location.search), preview = read(PREVIEW, sessionStorage);
  if (qs.has("navidad")) {
    preview = qs.get("navidad") === "0" ? { force: false } : { force: true, act: qs.get("acto") || null };
    write(PREVIEW, preview, sessionStorage);
  }

  function decide(cfg) {
    var d = today(), x = cfg.from.slice(0, 4) + "-12-25";
    var on = cfg.on !== false && d >= cfg.from && d <= cfg.to;
    if (preview && preview.force === false) on = false;
    if (preview && preview.force === true) on = true;
    var act = d < x ? "adviento" : d <= x.slice(0, 4) + "-12-31" ? "fiestas" : "reyes";
    if (preview && preview.force && /^(adviento|fiestas|reyes)$/.test(preview.act || "")) act = preview.act;
    if (d < cfg.from && preview && preview.force && !preview.act) act = "adviento";
    return { on: on, act: act, day: d, xmas: x, ny: (Number(x.slice(0, 4)) + 1) + "-01-01" };
  }

  var cfg = merge(read(CACHE));
  var st = decide(cfg);

  // ---------- textos ----------
  var km = function (v) { return v.km ? " hasta " + v.km + " km" : ""; };
  var COPY = {
    // barra de primer envío gratis
    welcome_guest: "Tu regalo: envío GRATIS",
    welcome_member: "Tu primer envío va de regalo 🎁",
    welcome_title: "Tu primer regalo de Navidad",
    welcome_toast_first: function (v) { return "¡Listo, baker! Ya estás en la lista de los buenos 🎅 Tu primer envío es gratis en pedidos desde " + v.min + " 🎁"; },
    welcome_toast: "¡Listo, baker! Ya estás en la lista de los buenos 🎅",
    // avance hacia el envío gratis
    hint_ok: function (v) { return "🛷 ¡El trineo va gratis" + km(v) + "!"; },
    hint_first_ok: function (v) { return "🎁 Tu primer trineo va gratis" + km(v) + "."; },
    hint_first_left: function (v) { return "Te faltan <b>" + v.left + "</b> para que tu primer trineo vaya gratis 🛷"; },
    hint_left: function (v) { return "Te faltan <b>" + v.left + "</b> para que el trineo vaya gratis 🛷"; },
    // carrito
    cart_empty: '<div class="cart-empty xmas-empty"><span class="xe-ic" aria-hidden="true">🧦</span><b>Tu bota está vacía… todavía</b><span class="muted small">Llénala con algo rico del menú.</span></div>',
    added: function (v) { return v.name + " va a tu bota 🧦"; },
    // estado de la tienda (etiqueta de arriba)
    open_now: function (v) { return "Taller abierto<span class=\"long\"> · hasta " + v.until + "</span>"; },
    closed_today: "Hoy los duendes descansan",
    closed_next: function (v) { return "Los duendes descansan<span class=\"long\"> · abrimos " + v.next + "</span>"; },
    // WhatsApp y regalos
    wa_msg: "Hola The Bakery Side 🎄, tengo una consulta",
    gift_toast: "🎁 Elige el regalo: al pagar ya estará marcado para enviarlo con tu tarjeta navideña.",
    // seguimiento del pedido
    st_paid: ["Pago confirmado", "Tu pedido entró al taller"],
    st_prep: ["En el taller", "Los bakers lo están preparando"],
    st_way: ["Salió en el trineo 🛷", null],
    st_done: ["Entregado bajo el árbol", "¡Que lo disfrutes, baker! 🎄"],
    st_done_big: "¡Entregado! 🎄",
    st_way_sub: "Con nuestro trineo de entrega",
  };
  // Portada según el acto
  function hero(s) {
    var n;
    if (s.act === "adviento") {
      n = days(s.day, s.xmas);
      return {
        eyebrow: n > 1 && n <= 60 ? n + " días para Navidad" : n === 1 ? "¡Hoy es Nochebuena!" : "Temporada navideña",
        h1: "Navidad hecha a mano, directo a ti",
        lead: "Regalos dulces, hechos en Guayaquil.",
      };
    }
    if (s.act === "fiestas") {
      n = days(s.day, s.ny);
      return {
        eyebrow: s.day === s.xmas ? "¡Feliz Navidad, bakers!" : n === 1 ? "¡Hoy es fin de año!" : n + " días para el Año Nuevo",
        h1: "Recibe el año con algo dulce",
        lead: "Para compartir en familia, hecho a mano en Guayaquil.",
      };
    }
    return {
      eyebrow: s.day === s.ny ? "¡Feliz Año Nuevo, bakers!" : "Día de Reyes · 6 de enero",
      h1: "Los últimos regalos de la temporada",
      lead: "Los Reyes llegan en camello; los nuestros, en moto 🛵",
    };
  }
  // Fecha límite para pedir (Nochebuena y Fin de año)
  function deadline(s, c) {
    if (s.act === "adviento") {
      if (s.day <= c.xmas_deadline) return "🎅 Pedidos para Nochebuena hasta el <b>" + longDate(c.xmas_deadline) + "</b>";
      if (s.day <= c.ny_deadline) return "🎅 Nochebuena ya está completa. Para Fin de año, pide hasta el <b>" + longDate(c.ny_deadline) + "</b>";
    }
    if (s.act === "fiestas" && s.day <= c.ny_deadline) return "🥂 Pedidos para Fin de año hasta el <b>" + longDate(c.ny_deadline) + "</b>";
    return "";
  }

  var api = {
    get on() { return st.on; },
    get act() { return st.act; },
    copy: COPY,
    // texto de temporada (o el normal si la temporada no está activa)
    t: function (key, normal, vars) {
      if (!st.on || !(key in COPY) || COPY[key] == null) return normal;
      var c = COPY[key];
      return typeof c === "function" ? c(vars || {}) : c;
    },
  };
  window.TBS_SEASON = api;

  // ---------- lo que pasa antes de pintar: clase y favicon ----------
  function applyRoot() {
    root.classList.toggle("xmas", st.on);
    ["adviento", "fiestas", "reyes"].forEach(function (a) { root.classList.toggle("xmas-" + a, st.on && st.act === a); });
    var ic = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
    if (ic) { if (!ic.dataset.normal) ic.dataset.normal = ic.getAttribute("href"); ic.setAttribute("href", st.on ? "/favicon-navidad.svg" : ic.dataset.normal); }
  }
  applyRoot();
  if (!st.on) return check(); // fuera de temporada: solo revisa si Boris la cambió desde Master

  // ---------- decoración ----------
  // gorro de Santa sobre la S del logo
  var HAT = '<svg viewBox="0 0 40 34" aria-hidden="true">' +
    '<path d="M5 25 C7 14 13 6 21 4.5 C28 3.5 33.5 7.5 35.5 14.5 C32.8 12.2 29 12 26.8 14.2 C29 17.5 30.8 21.2 31.5 25 Z" fill="#C0272D"/>' +
    '<path d="M21 4.5 C16 7 12 13 10.5 22" stroke="#E2474C" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>' +
    '<path d="M26.8 14.2 C29 17.5 30.8 21.2 31.5 25 L28 25 C27.5 21 26.5 17.5 24.8 15 Z" fill="#9E1D24" opacity=".55"/>' +
    '<rect x="2" y="23" width="32" height="8.5" rx="4.25" fill="#fff" stroke="#E4DED3" stroke-width="1"/>' +
    '<circle cx="35.5" cy="15.5" r="4" fill="#fff" stroke="#E4DED3" stroke-width="1"/></svg>';
  var BOW = '<svg viewBox="0 0 64 44" aria-hidden="true"><g stroke="#8E1D24" stroke-width="1.2" stroke-linejoin="round">' +
    '<path d="M32 20C22 4 6 4 6 15c0 9 14 9 26 5z" fill="#B3262E"/><path d="M32 20C42 4 58 4 58 15c0 9-14 9-26 5z" fill="#B3262E"/>' +
    '<path d="M30 22L18 42l7-2 3 4 5-20zM34 22l12 20-7-2-3 4-5-20z" fill="#9E2129"/><rect x="27" y="15" width="10" height="10" rx="3" fill="#C9333B"/></g>' +
    '<path d="M14 11c4-3 9-2 13 3" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
  var STOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3h8v3H8z"/><path d="M8.5 6v6.5l-4.2 3.2a3 3 0 0 0 3.6 4.8L14.5 16a2 2 0 0 0 .9-1.7V6"/><path d="M8.5 9h7"/></svg>';
  var SLED = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17h15.5a2.5 2.5 0 0 0 2.5-2.5"/><path d="M6 17v-4M14 17v-4"/><path d="M4 13h13l1.5-6H8.5"/><path d="M10 7V5l3-1.5"/></svg>';
  var TREE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l3 4.5h-1.5L17 12h-2l3.5 5h-13L9 12H7l3.5-4.5H9z"/><path d="M12 17v4"/></svg>';

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var setT = function (s, txt) { var el = $(s); if (el && txt != null) el.textContent = txt; return el; };
  var setH = function (s, html) { var el = $(s); if (el && html != null) el.innerHTML = html; return el; };

  function decorate() {
    root.classList.add("xmas-ready");
    // logo: gorro de Santa sobre la S
    document.querySelectorAll(".brand.logo").forEach(function (a) {
      if (a.querySelector(".xmas-sprig")) return;
      var s = document.createElement("span"); s.className = "xmas-sprig xmas-hat"; s.innerHTML = HAT; a.appendChild(s);
    });
    // guirnalda de luces bajo la barra de arriba
    var tb = $(".topbar");
    if (tb && !tb.querySelector(".xmas-garland")) { var g = document.createElement("div"); g.className = "xmas-garland"; g.setAttribute("aria-hidden", "true"); tb.appendChild(g); }

    // ----- tienda -----
    var h = $(".hero-b");
    if (h) {
      var copy = hero(st);
      setT(".hero-b .eyebrow", copy.eyebrow);
      setT(".hero-b h1", copy.h1);
      setT(".hero-b .lead", copy.lead);
      if (location.pathname === "/" || location.pathname === "/index.html") document.title = "Postres y regalos navideños a domicilio en Guayaquil y Samborondón | The Bakery Side";
      // moño sobre la foto o video de portada
      var m = $(".hb-media", h);
      if (m && !$(".xmas-frame", h)) {
        var w = document.createElement("span"); w.className = "xmas-frame";
        m.parentNode.insertBefore(w, m); w.appendChild(m);
        w.insertAdjacentHTML("beforeend", '<span class="xmas-bow">' + BOW + '</span><span class="xmas-tag">Edición navideña</span>');
      }
      snow(h);
    }
    var steps = document.querySelectorAll(".steps li");
    if (steps.length === 3) {
      var set = function (li, b, s, ic) { var bb = $("b", li), ss = $("small", li); if (bb) bb.textContent = b; if (s && ss) ss.textContent = s; var svg = $(".st-ic svg", li); if (ic && svg) svg.outerHTML = ic; };
      set(steps[0], "Elige", "tus regalos", STOCK);
      set(steps[1], "Trineo", null, SLED);
      set(steps[2], "Recibe", "bajo el árbol", TREE);
    }
    setH("#shipStrip > b", "🛷 Envío gratis");
    var strip = $("#shipStrip"), dl = deadline(st, cfg);
    if (dl && !$(".xmas-deadline")) {
      var p = document.createElement("p"); p.className = "xmas-deadline"; p.innerHTML = dl;
      if (strip) strip.parentNode.insertBefore(p, strip.nextSibling); else if ($(".steps")) $(".steps").after(p);
    }
    setT("#cartTitle", "Tu bota navideña");
    setT("#mobileBar .cf-t", "Ver mi bota");
    setT(".wa-fab span", "¿Dudas? Escríbele al taller");
    setT("#welcomeTitle", COPY.welcome_title);
    setH("#demandBar p", "🎅 <b>Bakers, ¡el taller está a reventar!</b> Hoy nos superó la demanda, así que todos los pedidos se entregan mañana. Agende el suyo ahora y lo preparamos con todo el amor 🍪✨");
    var gift = $("#isGift");
    if (gift && gift.nextSibling) gift.nextSibling.textContent = " Es un regalo para otra persona 🎁";
    var gm = $("#giftMsg"); if (gm) gm.placeholder = "¡Feliz Navidad! Con cariño, Ana";
    var gf = $("#giftFrom"); if (gf) gf.placeholder = "Ej.: Tus amigos secretos";
    // pregunta frecuente de temporada, arriba de todas
    var faq = $(".faq-list");
    if (faq && st.act !== "reyes" && !$(".xmas-faq", faq) && st.day <= cfg.ny_deadline) {
      faq.insertAdjacentHTML("afterbegin", '<details class="xmas-faq" open><summary>¿Hasta cuándo puedo pedir para Navidad y Fin de año?</summary><p>Para Nochebuena y Navidad, hasta el ' +
        longDate(cfg.xmas_deadline) + '. Para Fin de año, hasta el ' + longDate(cfg.ny_deadline) + '. Puedes agendar hoy tu pedido para el día que quieras, hasta con 30 días de anticipación, y lo preparamos recién hecho para esa fecha.</p></details>');
    }
    // pie de página
    var ft = $("footer.wrap") || $("footer");
    if (ft && !$(".xmas-foot", ft)) ft.insertAdjacentHTML("afterbegin", '<p class="xmas-foot"><span>TBS</span> ¡Qué dulce Navidad! <span aria-hidden="true">🎄</span></p>');
    // página 404
    setT("[data-xmas-404-title]", "Santa no encontró esta página");
    setT("[data-xmas-404-text]", "La buscó por todo el Polo Norte y nada. Pero el menú sí está donde siempre.");
  }

  // ---------- "nieve" de azúcar glas y grageas, solo en la portada ----------
  function snow(zone) {
    var calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    var cv = document.createElement("canvas"); cv.className = "xmas-snow"; cv.setAttribute("aria-hidden", "true");
    var box = zone.parentNode; // main.shop
    box.insertBefore(cv, box.firstChild);
    var ctx = cv.getContext("2d"); if (!ctx) return;
    var W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1), parts = [], last = 0, running = false, visible = true;
    var COLORS = ["#B3262E", "#2F6B4F", "#C68A4E", "#D9A06A"];
    function size() {
      var end = $(".ship-strip:not([hidden])") || $(".steps") || zone;
      W = box.clientWidth; H = Math.max(200, end.getBoundingClientRect().bottom - box.getBoundingClientRect().top + 24);
      cv.style.height = H + "px"; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(46, Math.max(24, W * H / 11000)));
      while (parts.length < n) parts.push(make(true));
      parts.length = n;
    }
    function make(any) {
      var sprinkle = Math.random() < 0.55;
      return { x: Math.random() * W, y: any ? Math.random() * H : -10, s: sprinkle, r: sprinkle ? 1.6 : 1.6 + Math.random() * 1.8,
        v: 10 + Math.random() * 22, sway: 6 + Math.random() * 14, ph: Math.random() * 6.28, rot: Math.random() * 6.28, spin: (Math.random() - .5) * 2,
        c: sprinkle ? COLORS[(Math.random() * COLORS.length) | 0] : "#FFFFFF" };
    }
    function draw(t) {
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i], x = p.x + Math.sin(t / 1000 + p.ph) * p.sway;
        var fade = p.y > H - 60 ? Math.max(0, (H - p.y) / 60) : 1;
        ctx.globalAlpha = (p.s ? .85 : .95) * fade;
        if (p.s) {
          ctx.save(); ctx.translate(x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
          ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-1.4, -4, 2.8, 8, 1.4); else ctx.rect(-1.4, -4, 2.8, 8); ctx.fill(); ctx.restore();
        } else {
          ctx.fillStyle = p.c; ctx.strokeStyle = "rgba(198,138,78,.45)"; ctx.lineWidth = .8;
          ctx.beginPath(); ctx.arc(x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    function step(t) {
      if (!running) return;
      var dt = Math.min(.05, (t - (last || t)) / 1000); last = t;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i]; p.y += p.v * dt; p.rot += p.spin * dt;
        if (p.y > H + 10) parts[i] = make(false);
      }
      draw(t);
      requestAnimationFrame(step);
    }
    function play() { var go = visible && !document.hidden && !calm; if (go && !running) { running = true; last = 0; requestAnimationFrame(step); } else if (!go) running = false; }
    size(); draw(0);
    addEventListener("resize", function () { size(); draw(performance.now()); });
    if (calm) return;
    document.addEventListener("visibilitychange", play);
    if ("IntersectionObserver" in window) new IntersectionObserver(function (e) { visible = e[0].isIntersecting; play(); }).observe(cv);
    // el alto cambia cuando cargan la barra de envío gratis y el video
    setTimeout(size, 1500); setTimeout(size, 4000);
    play();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", decorate); else decorate();
  check();

  // ---------- ¿Boris cambió la temporada desde Master? ----------
  function check() {
    // una revisión por visita (cada 10 min como máximo), para no pedir el archivo en cada página
    var seen = read("tbs_temporada_chk", sessionStorage);
    if (seen && Date.now() - seen < 600000 && !qs.has("navidad")) return;
    write("tbs_temporada_chk", Date.now(), sessionStorage);
    var url = "/media/temporada/navidad.json?t=" + Math.floor(Date.now() / 60000);
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) url = "https://btwuncihlkecnkjrgfhz.supabase.co/storage/v1/object/public/productos/temporada/navidad.json?t=" + Date.now();
    fetch(url, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var prev = JSON.stringify(read(CACHE));
      if (valid(j)) write(CACHE, j); else { try { localStorage.removeItem(CACHE); } catch (e) {} }
      var next = decide(merge(valid(j) ? j : null));
      // si cambió el encendido o el acto, se recarga una sola vez al entrar (no en medio de un pedido)
      if ((next.on !== st.on || next.act !== st.act) && performance.now() < 6000 && JSON.stringify(read(CACHE)) !== prev && !read("tbs_temporada_rl", sessionStorage)) {
        write("tbs_temporada_rl", 1, sessionStorage);
        if (!/checkout|pagar/.test(location.search) && !document.querySelector("body.in-checkout")) location.reload();
      }
    }).catch(function () {});
  }
})();
