#!/usr/bin/env node
/**
 * Prueba de carga contra una instalación en marcha. Cada cajero (E2E_CAJEROS) vende sin pausa en su propia
 * caja, todos los mismos productos (así compiten por el stock), mientras CARGA_USUARIOS usuarios consultan
 * a la vez (búsqueda en la caja, stock, ventas, tablero). Al final verifica que los números cierran:
 * cada venta confirmada descontó su stock y sumó su efectivo, sin duplicados ni pérdidas.
 *
 *   E2E_API=http://localhost:3000/api E2E_EMAIL=dueno@... E2E_CONTRASENA=... \
 *   E2E_CAJEROS=caja1@...,caja2@... E2E_CONTRASENA_CAJEROS=... \
 *   CARGA_SEGUNDOS=60 CARGA_USUARIOS=20 pnpm --filter @kontiva/e2e carga
 *
 * Los cajeros se crean con `cli usuario:crear --perfil cajero` (solo fuera de producción). Sin cajeros,
 * vende el propietario en una caja. El límite por IP (LIMITE_POR_MINUTO) debe estar alto: todo sale de una IP.
 *
 * Umbrales (falla si no se cumplen): 0 errores, p95 de consultas < CARGA_P95_CONSULTA ms (800),
 * p95 de ventas < CARGA_P95_VENTA ms (1500).
 */
import { performance } from 'node:perf_hooks';

const API = process.env.E2E_API ?? 'http://localhost:3000/api';
const EMAIL = process.env.E2E_EMAIL;
const CONTRASENA = process.env.E2E_CONTRASENA;
const SEGUNDOS = Number(process.env.CARGA_SEGUNDOS ?? 30);
const USUARIOS = Number(process.env.CARGA_USUARIOS ?? 20);
const CAJEROS = (process.env.E2E_CAJEROS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const CONTRASENA_CAJEROS = process.env.E2E_CONTRASENA_CAJEROS ?? CONTRASENA;
const P95_CONSULTA = Number(process.env.CARGA_P95_CONSULTA ?? 800);
const P95_VENTA = Number(process.env.CARGA_P95_VENTA ?? 1500);
if (!EMAIL || !CONTRASENA) throw new Error('Defina E2E_EMAIL y E2E_CONTRASENA');

let token = '';
async function api(ruta, metodo = 'GET', cuerpo, con = token) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'X-Kontiva': '1', ...(con && { Authorization: `Bearer ${con}` }), ...(cuerpo && { 'Content-Type': 'application/json' }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const t = await r.text();
  return { ok: r.ok, estado: r.status, cuerpo: t ? JSON.parse(t) : undefined };
}
const exigir = async (ruta, metodo, cuerpo, con) => {
  const r = await api(ruta, metodo, cuerpo, con);
  if (!r.ok) throw new Error(`${metodo ?? 'GET'} ${ruta}: ${r.estado} ${JSON.stringify(r.cuerpo)}`);
  return r.cuerpo;
};

// ── Preparación ──────────────────────────────────────────────────────────────
token = (await exigir('/auth/login', 'POST', { email: EMAIL, contrasena: CONTRASENA })).accessToken;
const marca = Date.now().toString(36);
const productos = [];
for (let i = 0; i < 8; i++) {
  const p = await exigir('/productos', 'POST', { nombre: `Carga ${marca} ${['Arroz', 'Fideos', 'Aceite', 'Azúcar', 'Leche', 'Yerba', 'Café', 'Harina'][i]}`, tasaIva: i % 3 === 0 ? 5 : 10, variantes: [{ precio: 5000 + i * 1500, costo: 3000 + i * 900, codigos: [String(7841000000000 + Math.floor(Math.random() * 9e8))] }] });
  productos.push({ varianteId: p.variantes[0].id, precio: 5000 + i * 1500, codigo: p.variantes[0].codigos[0] });
}
// Una caja por cajero (o la del propietario), todas del mismo depósito: compiten por el mismo stock.
const [deposito] = await exigir('/depositos');
const depositoId = deposito.id;
const cajas = [];
const existentes = await exigir('/cajas');
if (CAJEROS.length) {
  for (const [i, email] of CAJEROS.entries()) {
    const t = (await exigir('/auth/login', 'POST', { email, contrasena: CONTRASENA_CAJEROS }, '')).accessToken;
    let c = (await exigir('/cajas', 'GET', undefined, t)).find((x) => x.sesion?.propia);
    if (!c) {
      c = await exigir('/cajas', 'POST', { nombre: `Caja carga ${marca} ${i + 1}`, sucursalId: deposito.sucursal.id, depositoId });
      await exigir(`/cajas/${c.id}/abrir`, 'POST', { fondos: [{ moneda: 'PYG', monto: 200000 }] }, t);
    }
    cajas.push({ id: c.id, token: t, nombre: email });
  }
} else {
  let c = existentes.find((x) => x.sesion?.propia);
  if (!c) {
    c = await exigir('/cajas', 'POST', { nombre: `Caja carga ${marca}`, sucursalId: deposito.sucursal.id, depositoId });
    await exigir(`/cajas/${c.id}/abrir`, 'POST', { fondos: [{ moneda: 'PYG', monto: 500000 }] });
  }
  cajas.push({ id: c.id, token, nombre: EMAIL });
}
const caja = cajas[0];
await exigir('/stock/ajustes', 'POST', { depositoId, tipo: 'inicial', motivo: 'Prueba de carga', items: productos.map((p) => ({ varianteId: p.varianteId, cantidadNueva: 100000 })) });
const efectivoDe = async (c) => Number((await exigir(`/cajas/${c.id}/sesion`)).esperado.find((x) => x.moneda === 'PYG' && x.medio === 'efectivo')?.monto ?? 0);
const efectivo = async () => (await Promise.all(cajas.map(efectivoDe))).reduce((a, x) => a + x, 0);
const stockDe = async () => {
  const filas = await exigir(`/stock?depositoId=${depositoId}&q=${encodeURIComponent(`Carga ${marca}`)}`);
  const lista = Array.isArray(filas) ? filas : filas.items;
  return new Map(lista.map((f) => [f.varianteId, Number(f.cantidad)]));
};
const efectivoAntes = await efectivo();
const stockAntes = await stockDe();
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date());

// ── Carga ────────────────────────────────────────────────────────────────────
const tiempos = { consulta: [], venta: [] };
const porRuta = new Map();
const errores = [];
const vendidas = [];
const azar = (n) => Math.floor(Math.random() * n);

const CONSULTAS = [
  () => `/pdv/buscar?cajaId=${caja.id}&q=${encodeURIComponent(['arroz', 'carga', 'leche', 'caf', 'yer'][azar(5)])}`,
  () => `/pdv/buscar?cajaId=${caja.id}&q=${productos[azar(productos.length)].codigo}`,
  () => `/stock?depositoId=${depositoId}&q=carga`,
  () => `/ventas?cajaId=${caja.id}`,
  () => `/tablero?desde=${hoy}&hasta=${hoy}`,
  () => '/productos?q=carga',
  () => '/clientes?q=a',
];

const medir = (tipo, ruta, ms, r) => {
  tiempos[tipo].push(ms);
  porRuta.set(ruta, [...(porRuta.get(ruta) ?? []), ms]);
  if (!r.ok) errores.push(`${ruta}: ${r.estado} ${r.cuerpo?.codigo ?? ''} ${r.cuerpo?.mensaje ?? ''}`);
};

/** Un cajero: ventas de 1 a 4 productos, una tras otra, en su caja. */
async function vender(c) {
  const lineas = Array.from({ length: 1 + azar(4) }, () => ({ ...productos[azar(productos.length)], cantidad: 1 + azar(3) }));
  const total = lineas.reduce((a, l) => a + l.precio * l.cantidad, 0);
  const t0 = performance.now();
  const r = await api('/ventas', 'POST', { claveIdempotencia: `carga-${marca}-${Math.random().toString(36).slice(2)}`, cajaId: c.id, items: lineas.map((l) => ({ varianteId: l.varianteId, cantidad: l.cantidad })), pagos: [{ medio: 'efectivo', moneda: 'PYG', monto: total }] }, c.token);
  medir('venta', 'POST /ventas', performance.now() - t0, r);
  if (r.ok) vendidas.push({ id: r.cuerpo.id, caja: c.id, total, lineas });
}

/** Consultas de los demás usuarios (otras cajas buscando, administración, tablero). */
async function consultar() {
  const camino = CONSULTAS[azar(CONSULTAS.length)]();
  const t0 = performance.now();
  const r = await api(camino);
  medir('consulta', `GET ${camino.split('?')[0]}`, performance.now() - t0, r);
}

console.log(`Carga: ${cajas.length} ${cajas.length === 1 ? 'caja vendiendo' : 'cajas vendiendo'} sin pausa + ${USUARIOS} usuarios consultando, durante ${SEGUNDOS} s contra ${API} …`);
const fin = Date.now() + SEGUNDOS * 1000;
const t0 = performance.now();
const bucle = (f) => async () => {
  while (Date.now() < fin) {
    try {
      await f();
    } catch (e) {
      errores.push(`red: ${e.message}`);
    }
  }
};
await Promise.all([...cajas.map((c) => bucle(() => vender(c))()), ...Array.from({ length: USUARIOS }, () => bucle(consultar)())]);
const duracion = (performance.now() - t0) / 1000;

// ── Resultado ────────────────────────────────────────────────────────────────
const pct = (xs, p) => {
  if (!xs.length) return 0;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};
const fila = (nombre, xs) => `${nombre.padEnd(30)} ${String(xs.length).padStart(7)} ${pct(xs, 50).toFixed(0).padStart(7)} ${pct(xs, 95).toFixed(0).padStart(7)} ${pct(xs, 99).toFixed(0).padStart(7)} ${Math.max(0, ...xs).toFixed(0).padStart(7)}`;
const total = tiempos.consulta.length + tiempos.venta.length;
console.log('');
console.log(`${'Ruta'.padEnd(30)} ${'pedidos'.padStart(7)} ${'p50 ms'.padStart(7)} ${'p95 ms'.padStart(7)} ${'p99 ms'.padStart(7)} ${'máx ms'.padStart(7)}`);
for (const [r, xs] of [...porRuta].sort()) console.log(fila(r, xs));
console.log(fila('— Consultas', tiempos.consulta));
console.log(fila('— Ventas', tiempos.venta));
console.log('');
console.log(`${total} pedidos en ${duracion.toFixed(1)} s · ${(total / duracion).toFixed(1)} por segundo · ${vendidas.length} ventas en ${cajas.length} ${cajas.length === 1 ? 'caja' : 'cajas'} (${(vendidas.length / duracion).toFixed(1)} por segundo) · ${errores.length} errores`);

// Los números cierran: stock y efectivo exactos.
const fallas = [];
const efectivoDespues = await efectivo();
const vendido = vendidas.reduce((a, v) => a + v.total, 0);
if (efectivoDespues - efectivoAntes !== vendido) fallas.push(`Efectivo: subió ${efectivoDespues - efectivoAntes}, se vendió ${vendido}`);
const stockDespues = await stockDe();
for (const p of productos) {
  const salida = vendidas.reduce((a, v) => a + v.lineas.filter((l) => l.varianteId === p.varianteId).reduce((b, l) => b + l.cantidad, 0), 0);
  const real = (stockAntes.get(p.varianteId) ?? 0) - (stockDespues.get(p.varianteId) ?? 0);
  if (real !== salida) fallas.push(`Stock de ${p.varianteId}: bajó ${real}, se vendieron ${salida}`);
}
for (const c of cajas) {
  const propias = vendidas.filter((v) => v.caja === c.id);
  const enCaja = await exigir(`/ventas?cajaId=${c.id}&limite=200`);
  const ids = new Set((Array.isArray(enCaja) ? enCaja : enCaja.items).map((v) => v.id));
  const recientes = propias.slice(-Math.min(propias.length, 100));
  if (recientes.some((v) => !ids.has(v.id))) fallas.push(`Hay ventas confirmadas que no aparecen en ${c.nombre}`);
}
console.log(fallas.length ? `Integridad: FALLA\n- ${fallas.join('\n- ')}` : `Integridad: el efectivo (+${vendido}) y el stock cierran exactos con las ${vendidas.length} ventas`);

if (errores.length) console.log(`Errores (primeros 10):\n- ${[...new Set(errores)].slice(0, 10).join('\n- ')}`);
const p95c = pct(tiempos.consulta, 95);
const p95v = pct(tiempos.venta, 95);
const umbral = [];
if (errores.length) umbral.push(`${errores.length} errores`);
if (p95c > P95_CONSULTA) umbral.push(`p95 de consultas ${p95c.toFixed(0)} ms > ${P95_CONSULTA}`);
if (p95v > P95_VENTA) umbral.push(`p95 de ventas ${p95v.toFixed(0)} ms > ${P95_VENTA}`);
if (umbral.length || fallas.length) {
  console.log(`\nNO PASA: ${[...umbral, ...fallas].join(' · ')}`);
  process.exit(1);
}
console.log(`\nPASA: 0 errores · p95 consultas ${p95c.toFixed(0)} ms (máx. ${P95_CONSULTA}) · p95 ventas ${p95v.toFixed(0)} ms (máx. ${P95_VENTA})`);
