// The Bakery Side — API pública de la tienda
// Acciones: config, cotizar, crear, pagar, confirmar, subir, comprobante, perfil, guardar_perfil
// El seguimiento usa la función de base de datos track_order(token).
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const PAYPHONE_TOKEN = Deno.env.get("PAYPHONE_TOKEN") ?? "";
const PAYPHONE_STORE_ID = Deno.env.get("PAYPHONE_STORE_ID") ?? "";
const GOOGLE_SERVER_KEY = Deno.env.get("GOOGLE_MAPS_SERVER_KEY") ?? "";
const TZ_OFFSET_MIN = -5 * 60; // Ecuador continental, sin horario de verano

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
class UserError extends Error {}
const fail = (msg: string): never => { throw new UserError(msg); };

type Settings = {
  open_time: string; close_time: string; store_open: boolean;
  kitchen_lat: number; kitchen_lng: number; kitchen_address: string;
  fee_base: number; fee_included_km: number; fee_per_km: number; fee_round_to: number;
  max_km: number; slot_minutes: number; slot_capacity: number;
  whatsapp_number: string | null; bank_info: string | null;
  map_provider: "osm" | "google"; route_factor: number;
};

async function getSettings(): Promise<Settings> {
  const { data, error } = await db.from("settings").select("*").single();
  if (error) throw error;
  for (const k of ["fee_base", "fee_included_km", "fee_per_km", "fee_round_to", "max_km", "route_factor"]) {
    // numeric llega como string
    (data as Record<string, unknown>)[k] = Number((data as Record<string, unknown>)[k]);
  }
  return data as Settings;
}

// ---------- tiempo local (Guayaquil) ----------
const toLocal = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MIN * 60000); // campos UTC = hora local
const minutesOf = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
function localMinutes(d: Date) { const l = toLocal(d); return l.getUTCHours() * 60 + l.getUTCMinutes(); }
function isOpenAt(d: Date, s: Settings) {
  const m = localMinutes(d);
  return m >= minutesOf(s.open_time) && m <= minutesOf(s.close_time);
}

// ---------- distancia y envío ----------
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, r = (x: number) => x * Math.PI / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
async function routeKm(s: Settings, lat: number, lng: number): Promise<{ km: number; source: string }> {
  if (s.map_provider === "google" && GOOGLE_SERVER_KEY) {
    try {
      const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_SERVER_KEY, "X-Goog-FieldMask": "routes.distanceMeters" },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: s.kitchen_lat, longitude: s.kitchen_lng } } },
          destination: { location: { latLng: { latitude: lat, longitude: lng } } },
          travelMode: "TWO_WHEELER",
        }),
      });
      const j = await r.json();
      const m = j?.routes?.[0]?.distanceMeters;
      if (typeof m === "number") return { km: m / 1000, source: "google" };
    } catch (_) { /* respaldo abajo */ }
  }
  return { km: haversineKm(s.kitchen_lat, s.kitchen_lng, lat, lng) * s.route_factor, source: "linea_recta" };
}
function feeFor(km: number, s: Settings) {
  const raw = Math.max(s.fee_base, s.fee_base + s.fee_per_km * Math.max(km - s.fee_included_km, 0));
  return Math.round(Math.ceil(raw / s.fee_round_to - 1e-9) * s.fee_round_to * 100) / 100;
}
const travelMinutes = (km: number) => Math.max(8, Math.round(km / 25 * 60 + 5)); // 25 km/h en ciudad + 5 min de entrega

async function quote(s: Settings, lat: number, lng: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) fail("Marca tu ubicación en el mapa.");
  if (s.kitchen_lat == null) fail("La tienda aún no tiene configurada la ubicación de la cocina.");
  const { km, source } = await routeKm(s, lat, lng);
  if (km > s.max_km) {
    fail(`Tu ubicación está a ${km.toFixed(1)} km. Para entregas de más de ${s.max_km} km escríbenos por WhatsApp.`);
  }
  return { km: Math.round(km * 100) / 100, fee: feeFor(km, s), travel_min: travelMinutes(km), source };
}

// ---------- pedido ----------
type Item = { product_id: number; quantity: number };

async function priceCart(items: Item[]) {
  if (!Array.isArray(items) || items.length === 0) fail("Tu carrito está vacío.");
  if (items.length > 30) fail("Demasiados productos distintos en un solo pedido.");
  const ids = items.map((i) => Number(i.product_id));
  const { data: prods, error } = await db.from("products").select("id,name,price,prep_minutes,lead_hours,active").in("id", ids);
  if (error) throw error;
  let subtotal = 0, prep = 0, lead = 0;
  const lines = items.map((i) => {
    const p = prods!.find((x) => x.id === Number(i.product_id));
    const q = Math.floor(Number(i.quantity));
    if (!p || !p.active) fail("Uno de los productos ya no está disponible. Actualiza la página.");
    if (!(q >= 1 && q <= 50)) fail("Revisa las cantidades del carrito.");
    const unit = Number(p!.price);
    const line = Math.round(unit * q * 100) / 100;
    subtotal += line;
    prep = Math.max(prep, p!.prep_minutes);
    lead = Math.max(lead, p!.lead_hours);
    return { product_id: p!.id, name: p!.name, unit_price: unit, quantity: q, line_total: line };
  });
  return { lines, subtotal: Math.round(subtotal * 100) / 100, prep, lead };
}

async function validateSchedule(s: Settings, scheduled: string | null, prep: number, lead: number, travel: number) {
  const now = new Date();
  if (!s.store_open) fail("La tienda está cerrada temporalmente. Vuelve pronto.");
  if (!scheduled) {
    if (lead > 0) fail("Uno de tus productos necesita pedirse con anticipación. Agenda la entrega.");
    if (!isOpenAt(now, s)) fail("Ahora estamos fuera del horario de pedidos (9:00 a 21:00). Agenda tu entrega.");
    return { scheduled_for: null, eta: new Date(now.getTime() + (5 + prep + travel) * 60000) };
  }
  const when = new Date(scheduled);
  if (isNaN(when.getTime())) fail("La hora de entrega no es válida.");
  const earliest = now.getTime() + Math.max((5 + prep + travel) * 60000, lead * 3600000);
  if (when.getTime() < earliest) fail("Esa hora ya no alcanza. Elige una franja más tarde.");
  if (when.getTime() > now.getTime() + 30 * 86400000) fail("Puedes agendar hasta 30 días antes.");
  if (!isOpenAt(when, s)) fail("Las entregas se agendan entre 9:00 y 21:00.");
  if (localMinutes(when) % s.slot_minutes !== 0) fail("Elige una de las franjas disponibles.");
  const { count, error } = await db.from("orders").select("id", { count: "exact", head: true })
    .eq("scheduled_for", when.toISOString()).neq("status", "cancelado")
    .or(`payment_status.in.(pagado,en_revision),created_at.gt."${new Date(now.getTime() - 30 * 60000).toISOString()}"`);
  if (error) throw error;
  if ((count ?? 0) >= s.slot_capacity) fail("Esa franja ya está llena. Elige otra hora.");
  return { scheduled_for: when.toISOString(), eta: when };
}

const clean = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
function normPhone(v: unknown) {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.startsWith("593")) d = "0" + d.slice(3);
  if (!/^0\d{9}$/.test(d)) fail("Escribe un número de WhatsApp de 10 dígitos, por ejemplo 0991234567.");
  return d;
}

async function orderByToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token))) fail("Pedido no encontrado.");
  const { data, error } = await db.from("orders").select("*").eq("tracking_token", token).maybeSingle();
  if (error) throw error;
  if (!data) fail("Pedido no encontrado.");
  return data!;
}

function payphoneParams(o: Record<string, any>, attempt: number) {
  if (!PAYPHONE_TOKEN || !PAYPHONE_STORE_ID) fail("El pago con tarjeta aún no está configurado. Elige transferencia o intenta más tarde.");
  const cents = Math.round(Number(o.total) * 100);
  return {
    token: PAYPHONE_TOKEN,
    storeId: PAYPHONE_STORE_ID,
    clientTransactionId: `${o.code}-${attempt}`,
    amount: cents,
    amountWithoutTax: cents,
    currency: "USD",
    reference: `The Bakery Side ${o.code}`,
    lang: "es",
    timeZone: -5,
    phoneNumber: "+593" + String(o.customer_phone).slice(1),
  };
}

// ---------- clientes con cuenta ----------
type User = { id: string; email?: string; user_metadata?: Record<string, any> } | null;
async function userFrom(req: Request): Promise<User> {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t || t.startsWith("sb_") || t.split(".").length !== 3) return null;
  const { data } = await db.auth.getUser(t);
  return data?.user ?? null;
}
const COOKIES = ["Midnight Cookies", "Snowlemon Cookies", "Snowchocolate Cookies", "Chocochip Cookies"];
const nowLocal = () => toLocal(new Date());

async function ensureCustomer(u: NonNullable<User>, ref?: string) {
  const { data: c } = await db.from("customers").select("*").eq("user_id", u.id).maybeSingle();
  if (c) return c;
  let referred_by: string | null = null;
  const code = String(ref ?? "").trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(code)) {
    const { data: r } = await db.from("customers").select("user_id").eq("referral_code", code).maybeSingle();
    if (r && r.user_id !== u.id) referred_by = r.user_id;
  }
  for (let i = 0; i < 5; i++) {
    const referral_code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    const { data, error } = await db.from("customers").insert({
      user_id: u.id, email: u.email ?? null, referral_code, referred_by,
      full_name: String(u.user_metadata?.full_name ?? u.user_metadata?.name ?? "").slice(0, 80),
    }).select().single();
    if (error?.code === "23505") {
      const { data: again } = await db.from("customers").select("*").eq("user_id", u.id).maybeSingle();
      if (again) return again; // otra pestaña la creó al mismo tiempo
      continue; // código repetido: probar otro
    }
    if (error) throw error;
    const welcome = [{ user_id: u.id, delta: 2, reason: "bienvenida" }];
    if (referred_by) welcome.push({ user_id: u.id, delta: 1, reason: "referido_nuevo" });
    await db.from("stamp_ledger").insert(welcome);
    return data;
  }
  throw new Error("No se pudo crear el código de referido");
}
async function birthdayEligible(c: Record<string, any>) {
  if (!c.birthday) return false;
  const l = nowLocal();
  if (Number(String(c.birthday).slice(5, 7)) !== l.getUTCMonth() + 1) return false;
  const yearStart = new Date(Date.UTC(l.getUTCFullYear(), 0, 1, 5)).toISOString();
  const { count } = await db.from("orders").select("id", { count: "exact", head: true })
    .eq("user_id", c.user_id).eq("birthday_discount", true).in("payment_status", ["pagado", "en_revision"]).gte("created_at", yearStart);
  return (count ?? 0) === 0;
}
async function availableReward(uid: string) {
  const { data } = await db.from("rewards").select("id,status,order_id, orders:order_id(payment_status,status)")
    .eq("user_id", uid).in("status", ["disponible", "reservado"]).order("id");
  return (data ?? []).find((r: any) => r.status === "disponible" || (r.orders && r.orders.payment_status !== "pagado")) ?? null;
}
async function accountSummary(c: Record<string, any>) {
  const [{ data: led }, reward, bday, { count: rewardsCount }] = await Promise.all([
    db.from("stamp_ledger").select("delta").eq("user_id", c.user_id),
    availableReward(c.user_id),
    birthdayEligible(c),
    db.from("rewards").select("id", { count: "exact", head: true }).eq("user_id", c.user_id).in("status", ["disponible", "reservado"]),
  ]);
  return {
    customer: c,
    stamps: (led ?? []).reduce((s: number, r: any) => s + r.delta, 0),
    rewards_available: reward ? (rewardsCount ?? 1) : 0,
    birthday_available: bday,
    cookies: COOKIES,
  };
}

// ---------- acciones ----------
const actions: Record<string, (b: any, user: User) => Promise<unknown>> = {
  async config() {
    const s = await getSettings();
    return {
      open_time: s.open_time.slice(0, 5), close_time: s.close_time.slice(0, 5), store_open: s.store_open,
      slot_minutes: s.slot_minutes, kitchen: { lat: s.kitchen_lat, lng: s.kitchen_lng },
      fee: { base: s.fee_base, included_km: s.fee_included_km, per_km: s.fee_per_km },
      max_km: s.max_km, whatsapp: s.whatsapp_number, bank_info: s.bank_info,
      card_enabled: Boolean(PAYPHONE_TOKEN && PAYPHONE_STORE_ID), map_provider: s.map_provider,
      open_now: s.store_open && isOpenAt(new Date(), s),
    };
  },

  async cotizar(b) {
    const s = await getSettings();
    const q = await quote(s, Number(b.lat), Number(b.lng));
    let eta = null;
    if (Array.isArray(b.items) && b.items.length) {
      const c = await priceCart(b.items);
      eta = new Date(Date.now() + (5 + c.prep + q.travel_min) * 60000).toISOString();
    }
    return { distance_km: q.km, delivery_fee: q.fee, travel_min: q.travel_min, eta_if_now: eta };
  },

  async crear(b, user) {
    const s = await getSettings();
    const cart = await priceCart(b.items);
    const cust = user ? await ensureCustomer(user, b.ref) : null;
    let discount = 0, useBday = false, reward: any = null;
    if (cust && b.use_birthday) {
      if (!(await birthdayEligible(cust))) fail("El regalo de cumpleaños no está disponible en este pedido.");
      useBday = true; discount = Math.min(4, cart.subtotal);
    }
    if (cust && b.reward_product_id) {
      reward = await availableReward(cust.user_id);
      if (!reward) fail("No tienes una cookie de regalo disponible.");
      const { data: ck } = await db.from("products").select("id,name,active").eq("id", Number(b.reward_product_id)).maybeSingle();
      if (!ck || !ck.active || !COOKIES.includes(ck.name)) fail("Elige una de las cookies de regalo.");
      cart.lines.push({ product_id: ck!.id, name: `${ck!.name} (regalo de tu tarjeta)`, unit_price: 0, quantity: 1, line_total: 0 });
    }
    const q = await quote(s, Number(b.lat), Number(b.lng));
    const sched = await validateSchedule(s, b.scheduled_for || null, cart.prep, cart.lead, q.travel_min);
    const method = b.payment_method === "tarjeta" ? "tarjeta" : b.payment_method === "transferencia" ? "transferencia" : fail("Elige cómo pagar.");
    const name = clean(b.customer_name, 80) || fail("Escribe tu nombre.");
    const address = clean(b.address, 200) || fail("Escribe la dirección de entrega.");
    const invoiceWith = b.invoice_type === "con_datos";
    if (invoiceWith && !/^\d{10}(\d{3})?$/.test(clean(b.invoice_id_number, 13))) fail("La cédula debe tener 10 dígitos o el RUC 13.");
    const total = Math.round((cart.subtotal - discount + q.fee) * 100) / 100;

    const { data: o, error } = await db.from("orders").insert({
      user_id: cust?.user_id ?? null, discount, birthday_discount: useBday, reward_id: reward?.id ?? null,
      customer_name: name,
      customer_phone: normPhone(b.customer_phone),
      recipient_name: clean(b.recipient_name, 80) || null,
      recipient_phone: b.recipient_phone ? normPhone(b.recipient_phone) : null,
      gift_message: clean(b.gift_message, 300) || null,
      address, reference: clean(b.reference, 200) || null,
      lat: Number(b.lat), lng: Number(b.lng), distance_km: q.km,
      scheduled_for: sched.scheduled_for, eta: sched.eta.toISOString(), prep_minutes: cart.prep,
      subtotal: cart.subtotal, delivery_fee: q.fee, total,
      payment_method: method, payment_status: "pendiente", status: "pendiente_pago",
      invoice_type: invoiceWith ? "con_datos" : "consumidor_final",
      invoice_id_number: invoiceWith ? clean(b.invoice_id_number, 13) : null,
      invoice_name: invoiceWith ? clean(b.invoice_name, 120) : null,
      invoice_email: invoiceWith ? clean(b.invoice_email, 120) : null,
    }).select().single();
    if (error) throw error;
    const { error: e2 } = await db.from("order_items").insert(cart.lines.map((l) => ({ ...l, order_id: o.id })));
    if (e2) { await db.from("orders").delete().eq("id", o.id); throw e2; }
    if (reward) {
      // si estaba apartado en un pedido anterior que nunca se pagó, pasa a este pedido
      if (reward.order_id) await db.from("orders").update({ reward_id: null }).eq("id", reward.order_id).neq("payment_status", "pagado");
      await db.from("rewards").update({ status: "reservado", order_id: o.id }).eq("id", reward.id);
    }
    if (cust) {
      await db.from("customers").update({
        phone: o.customer_phone, address: o.address, reference: o.reference, lat: o.lat, lng: o.lng,
        full_name: cust.full_name || o.customer_name,
      }).eq("user_id", cust.user_id);
    }

    const out: Record<string, unknown> = { code: o.code, tracking_token: o.tracking_token, total, delivery_fee: q.fee, subtotal: cart.subtotal, discount };
    if (method === "tarjeta") {
      const pp = payphoneParams(o, 1);
      await db.from("orders").update({ payment_ref: pp.clientTransactionId }).eq("id", o.id);
      out.payphone = pp;
    } else {
      const path = `${o.id}/${crypto.randomUUID()}`;
      const { data: up, error: e3 } = await db.storage.from("comprobantes").createSignedUploadUrl(path);
      if (e3) throw e3;
      out.upload = { path, token: up.token };
      out.bank_info = s.bank_info;
    }
    return out;
  },

  // Cuenta del cliente: la crea la primera vez (con sellos de bienvenida) y devuelve su tarjeta
  async perfil(b, user) {
    if (!user) fail("Inicia sesión con Google para ver tu cuenta.");
    const c = await ensureCustomer(user!, b.ref);
    return await accountSummary(c);
  },

  async guardar_perfil(b, user) {
    if (!user) fail("Inicia sesión con Google.");
    const c = await ensureCustomer(user!);
    const patch: Record<string, unknown> = {};
    if (b.full_name !== undefined) patch.full_name = clean(b.full_name, 80);
    if (b.phone) patch.phone = normPhone(b.phone);
    if (b.birthday) {
      if (c.birthday) fail("Tu fecha de cumpleaños ya está registrada. Si hay un error, escríbenos.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.birthday) || isNaN(Date.parse(b.birthday))) fail("Revisa la fecha de cumpleaños.");
      patch.birthday = b.birthday;
    }
    if (Object.keys(patch).length) await db.from("customers").update(patch).eq("user_id", user!.id);
    const { data } = await db.from("customers").select("*").eq("user_id", user!.id).single();
    return await accountSummary(data!);
  },

  // Nuevo intento de pago con tarjeta para un pedido no pagado
  async pagar(b) {
    const o = await orderByToken(b.tracking_token);
    if (o.payment_status === "pagado") fail("Este pedido ya está pagado.");
    if (o.status === "cancelado") fail("Este pedido fue cancelado.");
    const n = Number(String(o.payment_ref ?? "").split("-").pop()) || 0;
    const pp = payphoneParams(o, n + 1);
    await db.from("orders").update({ payment_method: "tarjeta", payment_ref: pp.clientTransactionId, payment_status: "pendiente" }).eq("id", o.id);
    return { code: o.code, tracking_token: o.tracking_token, total: Number(o.total), payphone: pp };
  },

  // Payphone redirige a /pago?id=...&clientTransactionId=...
  async confirmar(b) {
    const id = Number(b.id), clientTxId = clean(b.clientTransactionId, 50);
    if (!id || !clientTxId) fail("Faltan datos del pago.");
    if (!/^BS-\d+-\d+$/.test(clientTxId)) fail("Pago no válido.");
    const { data: o } = await db.from("orders").select("*")
      .or(`payment_ref.eq.${clientTxId},payment_ref.like."${clientTxId} |*"`).maybeSingle();
    if (!o) fail("No encontramos el pedido de este pago.");
    if (o.payment_status === "pagado") return { ok: true, code: o.code, tracking_token: o.tracking_token };

    const r = await fetch("https://paymentbox.payphonetodoesposible.com/api/confirm", {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYPHONE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, clientTxId }),
    });
    const p = await r.json().catch(() => ({}));
    const approved = p?.statusCode === 3 && Number(p?.amount) === Math.round(Number(o.total) * 100);
    if (approved) {
      await db.from("orders").update({
        payment_status: "pagado", status: "confirmado", paid_at: new Date().toISOString(),
        payment_ref: `${clientTxId} | Payphone ${p.transactionId} | ${p.cardBrand ?? ""} ${p.lastDigits ?? ""}`.trim(),
      }).eq("id", o.id);
      return { ok: true, code: o.code, tracking_token: o.tracking_token };
    }
    await db.from("orders").update({ payment_status: "fallido" }).eq("id", o.id);
    return { ok: false, code: o.code, tracking_token: o.tracking_token, message: p?.message || "El pago no fue aprobado." };
  },

  // Permiso para subir un comprobante a un pedido aún no pagado
  async subir(b) {
    const o = await orderByToken(b.tracking_token);
    if (o.payment_status === "pagado" || o.status === "cancelado") fail("Este pedido ya no necesita comprobante.");
    const path = `${o.id}/${crypto.randomUUID()}`;
    const { data: up, error } = await db.storage.from("comprobantes").createSignedUploadUrl(path);
    if (error) throw error;
    return { path, token: up.token };
  },

  // El cliente subió la foto del comprobante de transferencia
  async comprobante(b) {
    const o = await orderByToken(b.tracking_token);
    const path = clean(b.path, 200);
    if (!path.startsWith(`${o.id}/`)) fail("Comprobante no válido.");
    const { data: files } = await db.storage.from("comprobantes").list(o.id);
    if (!files?.some((f) => `${o.id}/${f.name}` === path)) fail("No recibimos la foto del comprobante. Inténtalo de nuevo.");
    if (o.payment_status === "pagado" || o.status === "cancelado") fail("Este pedido ya no necesita comprobante.");
    await db.from("orders").update({
      transfer_receipt_path: path, payment_ref: clean(b.reference, 60) || null, payment_method: "transferencia",
      payment_status: "en_revision", status: "por_confirmar",
    }).eq("id", o.id);
    return { ok: true, code: o.code, tracking_token: o.tracking_token };
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const fn = actions[String(body.action)];
    if (!fn) return json({ error: "Acción desconocida" }, 400);
    return json(await fn(body, await userFrom(req)));
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Tuvimos un problema. Intenta de nuevo en un momento." }, 500);
  }
});
