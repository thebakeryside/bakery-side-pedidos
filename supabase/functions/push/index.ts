// The Bakery Side — avisos en el celular (Web Push) para cocina, moto y master
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

async function notify(orderId: string, event: string) {
  const { data: o } = await db.from("orders").select("*, order_items(name,quantity), riders(full_name)").eq("id", orderId).maybeSingle();
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
      await toStaff({ title: `🎉 ${o.code} entregado`, body: `${o.customer_name} · ${money(o.total)}`, tag: `o-${o.code}` }); break;
    case "cancelado":
      await toStaff({ title: `✖️ ${o.code} cancelado`, body: o.cancel_reason ? short(o.cancel_reason, 100) : `${o.customer_name} · ${money(o.total)}`, tag: `o-${o.code}` });
      await toRider({ title: `✖️ ${o.code} fue cancelado`, body: "Ya no tienes que entregarlo.", tag: `r-${o.code}` }); break;
  }
  return { sent };
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
