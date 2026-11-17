// The Bakery Side · Cálculo de cotizaciones (sin pantalla: se puede probar aparte)
// Regla: el descuento por cantidad nunca deja el precio por debajo del PISO de margen.
//   precio piso = costo ÷ (1 − piso)         (ej.: piso 45 % → costo ÷ 0,55)
//   precio meta = costo ÷ (1 − meta)         (para lo que no está en el menú)
// Cada línea:
//   menu   → producto del menú (precio de lista = precio de la web; costo de Master → Costos)
//   receta → algo fuera del menú hecho con una receta de Costos (ej.: botella de 750 ml de rompope)
//   libre  → cualquier otra cosa (nombre, costo opcional y precio)

export const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const ceilTo = (n, step) => r2(Math.ceil(r2(n / step) - 1e-9) * step);
export const roundTo = (n, step) => r2(Math.round(r2(n / step)) * step);

// Descuento del tramo que corresponde a una cantidad
export function tierFor(qty, tiers) {
  let best = { min: 0, disc: 0 };
  for (const t of tiers || []) if (Number(qty) >= Number(t.min) && Number(t.disc) >= best.disc) best = { min: Number(t.min), disc: Number(t.disc) };
  return best;
}

// Siguiente tramo (para sugerir "con 6 más llega al 15 %")
export function nextTier(qty, tiers) {
  return [...(tiers || [])].map((t) => ({ min: Number(t.min), disc: Number(t.disc) }))
    .filter((t) => t.min > Number(qty)).sort((a, b) => a.min - b.min)[0] || null;
}

// Precio sugerido (meta de margen) para lo que no está en el menú, redondeado hacia arriba a $0,25
export const targetPrice = (cost, rules) => (cost > 0 ? ceilTo(cost / (1 - rules.target_margin), 0.25) : 0);
export const floorPrice = (cost, rules) => (cost > 0 ? ceilTo(cost / (1 - rules.floor_margin), rules.round_to || 0.05) : null);

/**
 * Calcula todas las líneas.
 * lines: [{ k, key, qty, list_price, cost (por unidad, null si no se sabe), cap (tope del producto o null),
 *           group (para sumar cantidades en el tramo), manual (bool), unit_price (si manual) }]
 */
export function priceLines(lines, rules) {
  const step = Number(rules.round_to) || 0.05;
  // la cantidad del tramo se suma por grupo (misma categoría del menú); recetas y libres cuentan solas
  const groupQty = {};
  for (const l of lines) if (l.group) groupQty[l.group] = (groupQty[l.group] || 0) + Number(l.qty || 0);
  return lines.map((l) => {
    const qty = Math.max(0, Number(l.qty) || 0);
    const list = r2(Number(l.list_price) || 0);
    const cost = l.cost == null || !(Number(l.cost) > 0) ? null : Number(l.cost);
    const tierQty = l.group ? groupQty[l.group] : qty;
    const tier = tierFor(tierQty, rules.tiers);
    const floor = cost != null ? floorPrice(cost, rules) : null;
    const floorDisc = floor != null && list > 0 ? Math.max(0, 1 - floor / list) : 0;      // lo más que se puede bajar sin pasar el piso
    const cap = l.cap == null ? 1 : Number(l.cap);                                          // tope del producto
    const maxDisc = cost == null ? 0 : Math.min(floorDisc, cap);                            // máximo recomendado
    const autoDisc = Math.min(tier.disc, maxDisc);
    const autoUnit = (() => {
      if (!(list > 0)) return 0;
      let u = autoDisc > 0 ? roundTo(list * (1 - autoDisc), step) : list;
      if (floor != null && u < floor && autoDisc > 0) u = Math.min(list, floor);            // el redondeo nunca baja del piso
      return r2(u);
    })();
    const maxUnit = list > 0 ? r2(Math.max(floor ?? 0, maxDisc > 0 ? ceilTo(list * (1 - maxDisc), step) : list)) : 0;
    const unit = l.manual ? r2(Math.max(0, Number(l.unit_price) || 0)) : autoUnit;
    const disc = list > 0 ? Math.max(0, 1 - unit / list) : 0;
    const margin = cost != null && unit > 0 ? (unit - cost) / unit : null;
    const status = cost == null ? "sin_costo"
      : unit < cost ? "perdida"
      : floor != null && unit < floor - 0.004 ? "bajo_piso"
      : disc > cap + 0.0005 ? "sobre_tope"
      : "ok";
    const nt = nextTier(tierQty, rules.tiers);
    return {
      ...l, qty, list_price: list, cost, unit_price: unit, disc, line_total: r2(unit * qty), line_list: r2(list * qty),
      line_cost: cost != null ? r2(cost * qty) : null, margin, floor, maxDisc, maxUnit, autoDisc, autoUnit,
      tier, tierQty, next: nt && cost != null && Math.min(nt.disc, maxDisc) > autoDisc + 0.0005 ? { ...nt, need: nt.min - tierQty, disc: Math.min(nt.disc, maxDisc) } : null,
      status,
    };
  });
}

export function totals(priced, { fee = 0, packaging = 0, deposit = 0.5 } = {}) {
  const subtotal_list = r2(priced.reduce((s, l) => s + l.line_list, 0));
  const subtotal = r2(priced.reduce((s, l) => s + l.line_total, 0));
  const known = priced.filter((l) => l.line_cost != null);
  const cost_items = r2(known.reduce((s, l) => s + l.line_cost, 0));
  const cost_total = r2(cost_items + (priced.length ? Number(packaging) || 0 : 0));
  const total = r2(subtotal + (Number(fee) || 0));
  const profit = r2(subtotal - cost_total);
  return {
    subtotal_list, subtotal, discount: r2(subtotal_list - subtotal), fee: r2(Number(fee) || 0), total,
    cost_total, profit, margin: subtotal > 0 ? profit / subtotal : null,
    uncosted: priced.filter((l) => l.cost == null).length,
    deposit: r2(total * deposit),
  };
}

// Costos desde las tablas de Master → Costos
export function costIndex({ items, recipes, ri, pres, pi, iva }) {
  const item = new Map(items.map((i) => [i.id, i]));
  const unitCost = (it) => (it ? (Number(it.price) * (it.iva ? 1 + iva : 1)) / Number(it.pack_qty) : 0);
  const rowsCost = (rows) => rows.reduce((s, r) => s + unitCost(item.get(Number(r.item_id))) * Number(r.qty || 0), 0);
  const recipe = new Map(recipes.map((r) => {
    const total = rowsCost(ri.filter((x) => x.recipe_id === r.id));
    return [r.id, { ...r, total, perUnit: total / Number(r.yield_qty || 1) }];
  }));
  // costo de cada producto del menú: si tiene varias presentaciones, la más cara (para ir a la segura)
  const product = new Map();
  for (const p of pres) {
    if (!p.product_id) continue;
    const r = recipe.get(p.recipe_id); if (!r) continue;
    const c = r.perUnit * Number(p.units) + rowsCost(pi.filter((x) => x.presentation_id === p.id));
    product.set(p.product_id, Math.max(product.get(p.product_id) || 0, c));
  }
  return { recipe, product, unitCost, item };
}
