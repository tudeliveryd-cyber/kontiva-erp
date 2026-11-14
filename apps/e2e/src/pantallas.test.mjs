/**
 * Pruebas de pantallas con un navegador real (Chrome sin ventana) contra una instalación en marcha.
 *
 *   E2E_WEB=http://localhost:5173 E2E_EMAIL=... E2E_CONTRASENA=... CHROME_PATH=/usr/bin/google-chrome \
 *     pnpm --filter @kontiva/e2e pantallas
 *
 * La cuenta debe ser propietaria de una empresa (por ejemplo, creada con `cli empresa:crear --contrasena`).
 * Recorre todas las pantallas del menú (sin errores de la página ni del servidor, con el pie y sin emojis)
 * y hace una venta completa en la caja.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer-core';

const WEB = process.env.E2E_WEB ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? `${WEB}/api`;
const EMAIL = process.env.E2E_EMAIL;
const CONTRASENA = process.env.E2E_CONTRASENA;
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
if (!EMAIL || !CONTRASENA) throw new Error('Defina E2E_EMAIL y E2E_CONTRASENA');

const PIE = 'KONTIVA ERP · Desarrollado por Araújo Tech Sistemas';
const EMOJI = /\p{Extended_Pictographic}/u;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

let navegador;
let pagina;
let token = '';
const errores = [];
const datos = { cajaId: '', codigo: '', precio: 18500 };

async function api(ruta, metodo = 'GET', cuerpo) {
  const r = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { 'X-Kontiva': '1', ...(token && { Authorization: `Bearer ${token}` }), ...(cuerpo && { 'Content-Type': 'application/json' }) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${metodo} ${ruta}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : undefined;
}

before(async () => {
  // Datos para la venta, por la API: producto con código de barras y stock, caja abierta.
  token = (await api('/auth/login', 'POST', { email: EMAIL, contrasena: CONTRASENA })).accessToken;
  assert.ok(token, 'La cuenta de prueba debe ingresar sin segundo factor y con una sola empresa');
  const marca = Date.now().toString(36);
  datos.codigo = String(7840000000000 + Math.floor(Math.random() * 99999999));
  const producto = await api('/productos', 'POST', { nombre: `Yerba mate 1 kg ${marca}`, tasaIva: 10, variantes: [{ precio: datos.precio, costo: 12000, codigos: [datos.codigo] }] });
  // Una caja abierta por esta cuenta (la de una ejecución anterior) o una nueva.
  const propia = (await api('/cajas')).find((c) => c.sesion?.propia);
  let depositoId = propia?.deposito.id;
  if (propia) datos.cajaId = propia.id;
  else {
    const [deposito] = await api('/depositos');
    depositoId = deposito.id;
    const caja = await api('/cajas', 'POST', { nombre: `Caja E2E ${marca}`, sucursalId: deposito.sucursal.id, depositoId });
    datos.cajaId = caja.id;
    await api(`/cajas/${caja.id}/abrir`, 'POST', { fondos: [{ moneda: 'PYG', monto: 100000 }] });
  }
  await api('/stock/ajustes', 'POST', { depositoId, tipo: 'inicial', motivo: 'Prueba de pantallas', items: [{ varianteId: producto.variantes[0].id, cantidadNueva: 20 }] });

  navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1366, height: 900 });
  pagina.on('pageerror', (e) => errores.push(`Error en la página: ${e.message}`));
  pagina.on('response', (r) => {
    const url = r.url();
    // El 401 de renovar sesión antes de ingresar es esperado.
    if (r.status() >= 400 && url.includes('/api/') && !url.endsWith('/auth/renovar')) errores.push(`${r.status()} ${r.request().method()} ${url}`);
  });
});

after(async () => {
  await navegador?.close();
});

const sinErrores = (donde) => {
  const e = errores.splice(0);
  assert.deepEqual(e, [], `${donde}: ${e.join(' · ')}`);
};

test('ingreso con correo y contraseña', async () => {
  await pagina.goto(`${WEB}/ingresar`, { waitUntil: 'networkidle0' });
  await pagina.type('input[type=email]', EMAIL);
  await pagina.type('input[type=password]', CONTRASENA);
  await Promise.all([pagina.keyboard.press('Enter'), pagina.waitForSelector('.lateral nav a', { timeout: 15000 })]);
  await pagina.waitForNetworkIdle({ idleTime: 400 });
  assert.match(await pagina.$eval('.superior h1', (h) => h.textContent), /^Hola, /);
  sinErrores('Inicio');
});

test('todas las pantallas del menú cargan sin errores, con el pie y sin emojis', async () => {
  const enlaces = await pagina.$$eval('.lateral nav a', (as) => as.map((a) => ({ ruta: a.getAttribute('href'), texto: a.textContent.trim() })));
  assert.ok(enlaces.length >= 15, `El menú del propietario tiene ${enlaces.length} pantallas`);
  for (const { ruta, texto } of enlaces) {
    await pagina.click(`.lateral nav a[href="${ruta}"]`);
    await pagina.waitForNetworkIdle({ idleTime: 400, timeout: 15000 });
    // Pantallas de diseño propio (app móvil del dueño): sin errores ni emojis, y se vuelve al menú.
    if (!(await pagina.$('.lateral'))) {
      const t = await pagina.$eval('body', (b) => b.innerText);
      assert.ok(t.trim().length > 0, `${texto} (${ruta}) quedó en blanco`);
      assert.equal(t.match(EMOJI), null, `${texto} (${ruta}) tiene un emoji`);
      sinErrores(`${texto} (${ruta})`);
      await pagina.goto(`${WEB}/`, { waitUntil: 'networkidle0' });
      continue;
    }
    const h1 = await pagina.$eval('.superior h1', (h) => h.textContent.trim()).catch(() => null);
    assert.ok(h1, `${texto} (${ruta}) no muestra su título`);
    const texto2 = await pagina.$eval('body', (b) => b.innerText);
    assert.ok(texto2.includes(PIE), `${texto} (${ruta}) sin el pie`);
    const emoji = texto2.match(EMOJI);
    assert.equal(emoji, null, `${texto} (${ruta}) tiene un emoji: ${emoji?.[0]}`);
    sinErrores(`${texto} (${ruta})`);
  }
});

test('venta en la caja: código de barras, cobro en efectivo con vuelto y ticket', async () => {
  const efectivoDe = async () => Number((await api(`/cajas/${datos.cajaId}/sesion`)).esperado.find((x) => x.moneda === 'PYG' && x.medio === 'efectivo')?.monto ?? 0);
  const antes = await efectivoDe();
  const ventasAntes = await api(`/ventas?cajaId=${datos.cajaId}`);
  const idsAntes = new Set((Array.isArray(ventasAntes) ? ventasAntes : ventasAntes.items).map((v) => v.id));
  await pagina.goto(`${WEB}/pdv/${datos.cajaId}`, { waitUntil: 'networkidle0' });
  const buscador = '.pdv-buscar input';
  await pagina.waitForSelector(buscador);
  await pagina.type(buscador, datos.codigo);
  await pagina.keyboard.press('Enter');
  await pagina.waitForFunction(() => document.querySelectorAll('.pdv-lineas tbody tr, table tbody tr').length > 0, { timeout: 10000 });
  await pagina.type(buscador, datos.codigo);
  await pagina.keyboard.press('Enter');
  await pagina.waitForNetworkIdle({ idleTime: 300 });
  const total = await pagina.evaluate(() => document.body.innerText.match(/Total a cobrar\s*Gs\.\s*([\d.]+)/)?.[1]);
  assert.equal(total, '37.000', 'Dos unidades a 18.500');

  await pagina.keyboard.press('F2');
  await pagina.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Confirmar venta')), { timeout: 10000 });
  // Recibe 50.000: vuelto 13.000.
  const monto = await pagina.$('input[aria-label="Monto"], .pagos input.num');
  if (monto) {
    await monto.click({ clickCount: 3 });
    await monto.type('50000');
  }
  await pagina.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Confirmar venta')).click());
  await pagina.waitForFunction(() => /Venta N\.º\s*\d+|VENTA N\.º|Ticket/i.test(document.body.innerText), { timeout: 15000 });
  sinErrores('Venta en la caja');

  const ventas = await api(`/ventas?cajaId=${datos.cajaId}`);
  const lista = Array.isArray(ventas) ? ventas : ventas.items;
  assert.ok(!idsAntes.has(lista[0].id), 'La venta nueva es la primera de la caja');
  assert.equal(Number(lista[0].total), 37000);
  assert.equal(await efectivoDe(), antes + 37000, 'El efectivo de la caja sube lo vendido (el vuelto sale)');
});

test('interfaz en portugués: la elige cada usuario y los documentos siguen en español', async () => {
  await pagina.goto(`${WEB}/cuenta`, { waitUntil: 'networkidle0' });
  await Promise.all([pagina.waitForNavigation({ waitUntil: 'networkidle0' }), pagina.select('#idioma', 'pt')]);
  await pagina.waitForFunction(() => document.querySelector('.superior h1')?.textContent === 'Minha conta', { timeout: 10000 });
  assert.equal(await pagina.evaluate(() => document.documentElement.lang), 'pt-BR');
  const menu = await pagina.$$eval('.lateral nav a', (as) => as.map((a) => a.textContent.trim()));
  assert.ok(menu.includes('Vendas') && menu.includes('Estoque'), `Menú: ${menu.join(', ')}`);
  assert.ok((await pagina.$eval('body', (b) => b.innerText)).includes(PIE), 'El pie no se traduce');
  // La traducción no toca lo marcado como documento.
  const ticket = await pagina.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'ticket';
    d.textContent = 'Venta';
    document.body.append(d);
    return new Promise((r) => setTimeout(() => r(d.textContent), 100));
  });
  assert.equal(ticket, 'Venta');
  assert.equal((await api('/me')).usuario.idioma, 'pt', 'Queda guardado en la cuenta');
  // De vuelta al español: al recargar, la sesión trae el idioma de la cuenta.
  await api('/idioma', 'PUT', { idioma: 'es' });
  await pagina.reload({ waitUntil: 'networkidle0' });
  await pagina.waitForFunction(() => document.querySelector('.superior h1')?.textContent === 'Mi cuenta', { timeout: 15000 });
  sinErrores('Interfaz en portugués');
});

test('cerrar sesión vuelve a la pantalla de ingreso', async () => {
  await pagina.goto(`${WEB}/`, { waitUntil: 'networkidle0' });
  await pagina.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Cerrar sesión')).click());
  await pagina.waitForSelector('input[type=email]', { timeout: 10000 });
  assert.equal(await pagina.$('.lateral'), null, 'Sin sesión no se ve el menú');
  // Y la sesión ya no sirve: recargar no vuelve a entrar.
  await pagina.reload({ waitUntil: 'networkidle0' });
  assert.ok(await pagina.$('input[type=email]'));
  sinErrores('Cerrar sesión');
});
