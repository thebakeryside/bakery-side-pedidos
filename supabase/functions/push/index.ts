// The Bakery Side — avisos en el celular (Web Push) para cocina, moto y master, y correos al cliente en cada paso
// Acciones:
//   key     → llave pública para suscribirse (se crea la primera vez)
//   notify  → la base de datos avisa un evento de un pedido (requiere x-hook-secret)
//   test    → manda un aviso de prueba a los dispositivos del usuario que llama
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildPushPayload } from "npm:@block65/webcrypto-web-push@2.0.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SUBJECT = "mailto:pedidos@thebakeryside.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function secret(key: string) {
  const { data } = await db.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}
// Llaves VAPID: se generan una sola vez y se guardan en la base (nunca salen de aquí, salvo la pública)
async function vapid() {
  let pub = await secret("vapid_public"), priv = await secret("vapid_private");
  if (!pub || !priv) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    pub = b64url(await crypto.subtle.exportKey("raw", kp.publicKey));
    priv = (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!;
    const { error } = await db.from("app_secrets").insert([{ key: "vapid_public", value: pub }, { key: "vapid_private", value: priv }]);
    if (error) { // otra llamada las creó al mismo tiempo
      pub = await secret("vapid_public"); priv = await secret("vapid_private");
    }
  }
  return { subject: SUBJECT, publicKey: pub!, privateKey: priv! };
}

type Sub = { id: number; endpoint: string; p256dh: string; auth: string };
type Msg = { title: string; body: string; url: string; tag?: string };

async function send(subs: Sub[], msg: Msg) {
  if (!subs.length) return 0;
  const keys = await vapid();
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const payload = await buildPushPayload(
        { data: msg, options: { ttl: 3600, urgency: "high" } },
        { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
        keys,
      );
      const r = await fetch(s.endpoint, payload);
      if (r.status === 404 || r.status === 410) await db.from("push_subscriptions").delete().eq("id", s.id); // dispositivo ya no existe
      else if (r.ok) ok++;
      else console.error("push", r.status, await r.text());
    } catch (e) { console.error("push", e); }
  }));
  return ok;
}

// Dispositivos de cocina y master (solo si la persona sigue teniendo acceso)
async function staffSubs(includeKitchen: boolean) {
  const { data: profs } = await db.from("profiles").select("user_id,role,is_master");
  const masters = new Set((profs ?? []).filter((p) => p.is_master).map((p) => p.user_id));
  const kitchen = new Set((profs ?? []).filter((p) => p.role === "admin" || p.is_master).map((p) => p.user_id));
  const { data } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth,panel,user_id").in("panel", ["cocina", "master"]);
  return (data ?? []).filter((s) => (s.panel === "master" && masters.has(s.user_id)) || (includeKitchen && s.panel === "cocina" && kitchen.has(s.user_id)));
}
async function riderSubs(riderId: number | null) {
  if (!riderId) return [];
  const { data: r } = await db.from("riders").select("user_id,active,archived_at").eq("id", riderId).maybeSingle();
  if (!r?.user_id || r.archived_at) return [];
  const { data } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("panel", "moto").eq("user_id", r.user_id);
  return data ?? [];
}

const money = (n: unknown) => "$" + Number(n).toFixed(2);
const hhmm = (d: string) => new Date(d).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Guayaquil" });
const dayHm = (d: string) => new Date(d).toLocaleString("es-EC", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Guayaquil" });
const short = (t: string, n = 60) => (t.length > n ? t.slice(0, n - 1) + "…" : t);


// ---------- correos al cliente (Resend) ----------
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "The Bakery Side <pedidos@thebakeryside.com>";
const SITE = Deno.env.get("SITE_URL") ?? "https://thebakeryside.com";
const escH = (t: unknown) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function customerEmail(o: any) {
  if (o.customer_email) return String(o.customer_email);
  if (o.user_id) { const { data } = await db.auth.admin.getUserById(o.user_id); if (data?.user?.email) return data.user.email; }
  return o.invoice_email ? String(o.invoice_email) : null;
}
async function orderPin(id: string) {
  const { data } = await db.from("order_pins").select("pin").eq("order_id", id).maybeSingle();
  return data?.pin as string | undefined;
}

function mailHtml(o: any, m: { title: string; lead: string; pin?: string; step: number; extra?: string }) {
  const first = escH(String(o.customer_name).split(" ")[0]);
  const link = `${SITE}/pedido?t=${o.tracking_token}`;
  const steps = ["Pago confirmado", "En preparación", "Listo", "En camino", "Entregado"];
  const bar = m.step >= 0 ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr>${steps.map((st, i) => `<td align="center" width="20%" style="font-size:11px;color:${i <= m.step ? "#1C1714" : "#a39a90"};font-weight:${i === m.step ? "bold" : "normal"};padding:0 2px"><div style="height:6px;border-radius:3px;background:${i <= m.step ? "#C68A4E" : "#EDE8DA"};margin-bottom:6px"></div>${st}</td>`).join("")}</tr></table>` : "";
  const items = (o.order_items ?? []).map((i: any) => `<tr><td style="padding:4px 0;font-size:14px;color:#1C1714">${i.quantity} × ${escH(i.name)}</td><td align="right" style="padding:4px 0;font-size:14px;color:#554741">${money(i.line_total ?? 0)}</td></tr>`).join("");
  const when = o.scheduled_for ? `Entrega agendada: <b>${escH(dayHm(o.scheduled_for))}</b>` : o.eta ? `Llega aprox. a las <b>${escH(hhmm(o.eta))}</b>` : "";
  const pin = m.pin ? `<div style="margin:20px 0;border:2px solid #C68A4E;border-radius:14px;padding:16px;text-align:center;background:#FBF6EE">
      <div style="font-size:11px;letter-spacing:2px;color:#8a7f76;font-weight:bold">TU PIN DE ENTREGA</div>
      <div style="font-size:38px;letter-spacing:12px;font-weight:bold;color:#1C1714;margin:6px 0 4px;font-family:'Courier New',monospace">${escH(m.pin)}</div>
      <div style="font-size:13px;color:#554741;line-height:1.45">${o.recipient_name ? "Como es un regalo, compártelo con quien lo recibe. " : ""}Dáselo al motorizado solo cuando tengas el pedido en tus manos.</div></div>` : "";
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F4F1EA;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:18px;padding:28px 24px;border:1px solid #E6E1D3">
    <div style="font-size:12px;letter-spacing:3px;color:#C68A4E;font-weight:bold">THE BAKERY SIDE</div>
    <div style="font-size:13px;color:#8a7f76;margin-top:2px">Pedido ${escH(o.code)}</div>
    <h1 style="margin:14px 0 8px;font-size:26px;line-height:1.2;color:#1C1714">${escH(m.title)}</h1>
    <p style="margin:0;font-size:15px;line-height:1.55;color:#554741">Hola ${first}, ${m.lead}</p>
    ${bar}
    ${when && m.step >= 0 && m.step < 4 ? `<p style="margin:14px 0 0;font-size:15px;color:#1C1714">${when}</p>` : ""}
    ${pin}
    ${m.extra ?? ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-top:1px solid #EDE8DA;padding-top:10px">${items}
      <tr><td style="padding:4px 0;font-size:14px;color:#554741">Envío</td><td align="right" style="padding:4px 0;font-size:14px;color:#554741">${money(o.delivery_fee)}</td></tr>
      <tr><td style="padding:8px 0 0;font-size:16px;font-weight:bold;color:#1C1714">Total</td><td align="right" style="padding:8px 0 0;font-size:16px;font-weight:bold;color:#1C1714">${money(o.total)}</td></tr></table>
    <div style="text-align:center;margin-top:24px"><a href="${link}" style="display:inline-block;background:#1C1714;color:#FFFFFF;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:12px;font-size:15px">Ver mi pedido</a></div>
    <p style="margin:24px 0 0;font-size:12px;color:#a39a90;text-align:center">Dulces hechos con cariño · Guayaquil y Samborondón</p>
  </div></body></html>`;
}

async function mailCustomer(o: any, event: string) {
  if (!RESEND_KEY) return false; // sin clave de Resend, no se envían correos (los avisos push siguen igual)
  const to = await customerEmail(o);
  if (!to) return false;
  const rider = o.riders?.full_name ? escH(String(o.riders.full_name).split(" ")[0]) : null;
  let m: { subject: string; title: string; lead: string; pin?: string; step: number; extra?: string } | null = null;
  switch (event) {
    case "pagado": case "pago_confirmado":
      m = { subject: `Confirmamos tu pedido ${o.code} 🧁`, title: "¡Pedido confirmado!", lead: "recibimos tu pago y tu pedido ya está en nuestra cocina. Te escribiremos en cada paso.", pin: await orderPin(o.id), step: 0 }; break;
    case "preparando":
      m = { subject: `Estamos preparando tu pedido ${o.code}`, title: "Manos a la masa", lead: "ya estamos preparando tu pedido con todo el cariño.", step: 1 }; break;
    case "listo":
      m = { subject: `Tu pedido ${o.code} está listo`, title: "¡Está listo!", lead: `tu pedido está listo y ${rider ? `${rider} lo recoge` : "el motorizado lo recoge"} en unos minutos.`, step: 2 }; break;
    case "en_camino":
      m = { subject: `Tu pedido ${o.code} va en camino 🛵`, title: "Va en camino", lead: `${rider ? `${rider} salió` : "el motorizado salió"} con tu pedido. Ten a mano tu PIN: se lo darás cuando lo tengas en tus manos.`, pin: await orderPin(o.id), step: 3 }; break;
    case "entregado":
      m = { subject: `¡Entregado! Gracias por tu pedido ${o.code}`, title: "¡Que lo disfrutes!", lead: "tu pedido fue entregado. Gracias por elegirnos; nos encantaría saber qué tal te pareció.", step: 4,
        extra: o.user_id ? `<p style="margin:16px 0 0;font-size:14px;color:#554741">Este pedido suma sellos a tu tarjeta. Revísala en <a href="${SITE}/cuenta" style="color:#C68A4E">Mi cuenta</a>.</p>` : "" }; break;
    case "cancelado":
      m = { subject: `Tu pedido ${o.code} fue cancelado`, title: "Pedido cancelado", lead: `cancelamos tu pedido${o.cancel_reason ? ` (${escH(o.cancel_reason)})` : ""}. Si ya habías pagado, te devolvemos el dinero. Escríbenos si tienes dudas.`, step: -1 }; break;
  }
  if (!m) return false;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `${o.id}-${event}` },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject: m.subject, html: mailHtml(o, m), tags: [{ name: "evento", value: event }] }),
  });
  if (!r.ok) { console.error("correo", r.status, await r.text()); return false; }
  return true;
}

async function notify(orderId: string, event: string) {
  const { data: o } = await db.from("orders").select("*, order_items(name,quantity,line_total), riders(full_name)").eq("id", orderId).maybeSingle();
  if (!o) return { sent: 0 };
  const when = o.scheduled_for ? `para ${dayHm(o.scheduled_for)}` : `llega aprox. ${hhmm(o.eta)}`;
  const items = (o.order_items ?? []).map((i: any) => `${i.quantity}× ${i.name}`).join(", ");
  const addr = short(String(o.address ?? "").split(" · Ubicación del mapa: ")[0]);
  const kitchenUrl = "/cocina";
  let sent = 0;
  const toStaff = async (m: Omit<Msg, "url">, includeKitchen = true) => {
    const subs = await staffSubs(includeKitchen);
    // cocina abre el panel de cocina; master también (ahí ve los pedidos en vivo)
    sent += await send(subs, { ...m, url: kitchenUrl });
  };
  const toRider = async (m: Omit<Msg, "url">) => { sent += await send(await riderSubs(o.rider_id), { ...m, url: "/moto" }); };

  switch (event) {
    case "pagado":
      await toStaff({ title: `🧁 Nuevo pedido ${o.code} · ${money(o.total)}`, body: `${short(items, 90)} — ${when}`, tag: `o-${o.code}` }); break;
    case "comprobante":
      await toStaff({ title: `🧾 Comprobante por revisar · ${o.code}`, body: `${o.customer_name} subió su transferencia de ${money(o.total)}. Confírmala para empezar.`, tag: `o-${o.code}` }); break;
    case "asignado":
      await toRider({ title: `🛵 Nueva entrega ${o.code}`, body: `${addr} — ${when}`, tag: `r-${o.code}` }); break;
    case "listo":
      await toRider({ title: `✅ ${o.code} está listo para retirar`, body: `Pasa por la cocina. Destino: ${addr}`, tag: `r-${o.code}` }); break;
    case "en_camino":
      await toStaff({ title: `🛵 ${o.code} va en camino`, body: `${o.riders?.full_name ?? "El motorizado"} salió hacia ${addr}`, tag: `o-${o.code}` }, false); break;
    case "entregado":
      await toStaff({ title: `🎉 ${o.code} entregado`, body: `${o.customer_name} · ${money(o.total)}${o.delivered_by === "moto" ? " · confirmado con PIN" : o.delivered_by === "cocina" ? " · marcado por cocina" : ""}`, tag: `o-${o.code}` }); break;
    case "cancelado":
      await toStaff({ title: `✖️ ${o.code} cancelado`, body: o.cancel_reason ? short(o.cancel_reason, 100) : `${o.customer_name} · ${money(o.total)}`, tag: `o-${o.code}` });
      await toRider({ title: `✖️ ${o.code} fue cancelado`, body: "Ya no tienes que entregarlo.", tag: `r-${o.code}` }); break;
  }
  let mailed = false;
  try { mailed = await mailCustomer(o, event); } catch (e) { console.error("correo", e); }
  return { sent, mailed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    if (b.action === "key") return json({ publicKey: (await vapid()).publicKey });

    if (b.action === "notify") {
      const hook = await secret("push_hook");
      if (!hook || req.headers.get("x-hook-secret") !== hook) return json({ error: "No autorizado" }, 401);
      return json(await notify(String(b.order_id), String(b.event)));
    }

    if (b.action === "test") {
      const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data } = t ? await db.auth.getUser(t) : { data: { user: null } };
      if (!data?.user) return json({ error: "Inicia sesión." }, 401);
      const { data: subs } = await db.from("push_subscriptions").select("id,endpoint,p256dh,auth,panel").eq("user_id", data.user.id);
      const panel = ["cocina", "moto", "master"].includes(b.panel) ? b.panel : "cocina";
      const sent = await send(subs ?? [], { title: "🔔 Avisos activados", body: "Así te llegarán los pedidos de The Bakery Side.", url: `/${panel}`, tag: "test" });
      return json({ sent });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "Tuvimos un problema con los avisos." }, 500);
  }
});
