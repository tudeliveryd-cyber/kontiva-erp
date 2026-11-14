import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditoriaController } from '../src/auditoria/auditoria.controller';
import { AuthController, CuentaController } from '../src/auth/auth.controller';
import { META_PERMISO, META_PUBLICO } from '../src/comun/decoradores';
import { EmpresaController } from '../src/empresa/empresa.controller';
import { PerfilesController } from '../src/perfiles/perfiles.controller';
import { SaludController } from '../src/salud.controller';
import { SucursalesController } from '../src/sucursales/sucursales.controller';
import { UsuariosController } from '../src/usuarios/usuarios.controller';
import { CategoriasController, MarcasController, ProductosController } from '../src/catalogo/catalogo.controller';
import { ClientesController } from '../src/catalogo/clientes.controller';
import { ImportacionController } from '../src/catalogo/importacion.controller';
import { StockController } from '../src/catalogo/stock.controller';
import { CajasController, CotizacionesController } from '../src/operacion/cajas.controller';
import { PdvController, PdvPreciosController, VentasController } from '../src/operacion/ventas.controller';
import { ListasPrecioController } from '../src/catalogo/listas.controller';
import { PedidosController, PresupuestosController } from '../src/operacion/pedidos.controller';
import { FacturacionController } from '../src/sifen/facturacion.controller';
import { CobrosController, CuentasCobrarController } from '../src/finanzas/cobrar.controller';
import { CuentasBancariasController, MovimientosBancariosController } from '../src/finanzas/bancos.controller';
import { FlujoCajaController } from '../src/finanzas/flujo.controller';
import { ContabilidadController } from '../src/contabilidad/contabilidad.controller';
import { RecetarioController } from '../src/informes/recetario.controller';
import { CocinaController, CuentasController, SalonController } from '../src/restaurante/restaurante.controller';
import { ProduccionController, RecetasProduccionController } from '../src/produccion/produccion.controller';
import { MarcacionesController, NovedadesController, VacacionesController } from '../src/rrhh/asistencia.controller';
import { FuncionariosController, LiquidacionesController, RrhhConfiguracionController } from '../src/rrhh/rrhh.controller';
import { InformesController } from '../src/informes/informes.controller';
import { ComprasController, CuentasPagarController, OrdenesCompraController, PagosProveedorController, ProveedoresController } from '../src/compras/compras.controller';
import { DevolucionesController } from '../src/operacion/devoluciones.controller';
import { ValesController } from '../src/operacion/vales.controller';
import { RepartosController, RutasController } from '../src/distribucion/distribucion.controller';
import { TransferenciasController } from '../src/operacion/transferencias.controller';
import { prepararVenta } from './ayudas';
import { crearEmpresa, crearUsuario, http, iniciarApp, login, type EmpresaPrueba } from './ayudas';

/**
 * Suite generada desde los decoradores: no hace falta escribir una prueba por endpoint.
 * Cada endpoint nuevo queda cubierto en cuanto se registra en CONTROLADORES.
 */
const CONTROLADORES = [
  SaludController,
  AuthController,
  CuentaController,
  EmpresaController,
  SucursalesController,
  PerfilesController,
  UsuariosController,
  AuditoriaController,
  ProductosController,
  CategoriasController,
  MarcasController,
  StockController,
  ClientesController,
  ImportacionController,
  CajasController,
  CotizacionesController,
  PdvController,
  PdvPreciosController,
  ListasPrecioController,
  PresupuestosController,
  PedidosController,
  VentasController,
  TransferenciasController,
  DevolucionesController,
  ValesController,
  RutasController,
  RepartosController,
  FacturacionController,
  ProveedoresController,
  OrdenesCompraController,
  ComprasController,
  CuentasPagarController,
  PagosProveedorController,
  CuentasCobrarController,
  CobrosController,
  CuentasBancariasController,
  MovimientosBancariosController,
  FlujoCajaController,
  ContabilidadController,
  FuncionariosController,
  RrhhConfiguracionController,
  LiquidacionesController,
  NovedadesController,
  MarcacionesController,
  RecetarioController,
  SalonController,
  CuentasController,
  CocinaController,
  RecetasProduccionController,
  ProduccionController,
  VacacionesController,
  InformesController,
];

interface Ruta {
  metodo: 'get' | 'post' | 'put' | 'patch' | 'delete';
  ruta: string;
  publico: boolean;
  permiso: string | undefined;
}

const METODOS: Partial<Record<RequestMethod, Ruta['metodo']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

function rutas(): Ruta[] {
  const out: Ruta[] = [];
  for (const C of CONTROLADORES) {
    const base = (Reflect.getMetadata(PATH_METADATA, C) as string) ?? '';
    const proto = C.prototype as unknown as Record<string, unknown>;
    for (const nombre of Object.getOwnPropertyNames(proto)) {
      const fn = proto[nombre];
      if (nombre === 'constructor' || typeof fn !== 'function') continue;
      const metodo = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
      if (metodo === undefined) continue;
      const sub = (Reflect.getMetadata(PATH_METADATA, fn) as string) ?? '';
      const ruta = '/api/' + [base, sub].filter((x) => x && x !== '/').join('/');
      out.push({
        metodo: METODOS[metodo]!,
        ruta: ruta.replace(/\/+/g, '/'),
        publico: Reflect.getMetadata(META_PUBLICO, fn) === true,
        permiso: Reflect.getMetadata(META_PERMISO, fn) as string | undefined,
      });
    }
  }
  return out;
}

const RUTAS = rutas();

describe('Cobertura de seguridad generada desde los decoradores', () => {
  let app: INestApplication;
  let a: EmpresaPrueba;
  let b: EmpresaPrueba;
  let sinPermisos: string;
  /** id de un registro de la empresa B por prefijo de ruta */
  const idsDeB: Record<string, string> = {};

  beforeAll(async () => {
    app = await iniciarApp();
    a = await crearEmpresa(app, 'ENTERPRISE');
    b = await crearEmpresa(app, 'ENTERPRISE');

    // Usuario de A con un perfil vacío: autenticado pero sin ningún permiso.
    const perfil = await http(app)
      .post('/api/perfiles')
      .set('Authorization', `Bearer ${a.propietario.token}`)
      .send({ nombre: 'Sin permisos', alcance: 'propia', permisos: [] })
      .expect(201);
    const u = await crearUsuario(app, a, 'cajero');
    await http(app).patch(`/api/usuarios/${u.id}`).set('Authorization', `Bearer ${a.propietario.token}`).send({ perfilId: perfil.body.id }).expect(200);
    sinPermisos = (await login(app, u.email)).token;

    const cajeroB = await crearUsuario(app, b, 'cajero');
    const perfilesB = await http(app).get('/api/perfiles').set('Authorization', `Bearer ${b.propietario.token}`).expect(200);
    const sesionesB = await http(app).get('/api/auth/sesiones').set('Authorization', `Bearer ${b.propietario.token}`).expect(200);
    idsDeB['/api/sucursales'] = b.sucursalId;
    idsDeB['/api/usuarios'] = cajeroB.id;
    idsDeB['/api/perfiles'] = perfilesB.body.find((p: { clave: string }) => p.clave === 'cajero').id;
    idsDeB['/api/auth/sesiones'] = sesionesB.body[0].id;
    // Catálogo, caja y una venta real en B.
    const vb = await prepararVenta(app, b);
    idsDeB['/api/productos'] = vb.productoId;
    idsDeB['/api/cajas'] = vb.cajaId;
    idsDeB['/api/ventas'] = vb.ventaId;
    const cl = await http(app).post('/api/clientes').set('Authorization', `Bearer ${b.propietario.token}`).send({ nombre: 'Cliente de B' }).expect(201);
    idsDeB['/api/clientes'] = cl.body.id;
    // Transferencia en tránsito y devolución en B.
    const hB = { Authorization: `Bearer ${b.propietario.token}` };
    const suc2 = await http(app).post('/api/sucursales').set(hB).send({ nombre: 'Segunda B', codigo: '002' }).expect(201);
    const deps = await http(app).get('/api/depositos').set(hB).expect(200);
    const destino = deps.body.find((d: { sucursal: { id: string } }) => d.sucursal.id === suc2.body.id).id;
    const tr = await http(app).post('/api/transferencias').set(hB).send({ origenId: vb.depositoId, destinoId: destino, items: [{ varianteId: vb.varianteId, cantidad: 1 }] }).expect(201);
    idsDeB['/api/transferencias'] = tr.body.id;
    const dv = await http(app).post('/api/devoluciones').set(hB).send({ ventaId: vb.ventaId, cajaId: vb.cajaId, medio: 'vale', motivo: 'Prueba B', items: [{ linea: 1, cantidad: 1 }] }).expect(201);
    idsDeB['/api/devoluciones'] = dv.body.id;
    idsDeB['/api/vales'] = dv.body.vale.id;
    const lp = await http(app).post('/api/listas-precio').set(hB).send({ nombre: 'Mayorista B' }).expect(201);
    idsDeB['/api/listas-precio'] = lp.body.id;
    const pr = await http(app).post('/api/presupuestos').set(hB).send({ sucursalId: b.sucursalId, items: [{ varianteId: vb.varianteId, cantidad: 1 }] }).expect(201);
    idsDeB['/api/presupuestos'] = pr.body.id;
    const pe = await http(app).post('/api/pedidos').set(hB).send({ sucursalId: b.sucursalId, clienteNombre: 'Cliente B', items: [{ varianteId: vb.varianteId, cantidad: 1 }] }).expect(201);
    idsDeB['/api/pedidos'] = pe.body.id;
    // Distribución en B: ruta y reparto con un pedido de cliente registrado.
    const ruB = await http(app).post('/api/rutas').set(hB).send({ sucursalId: b.sucursalId, nombre: 'Ruta B', dias: [1] }).expect(201);
    idsDeB['/api/rutas'] = ruB.body.id;
    const clB = await http(app).post('/api/clientes').set(hB).send({ nombre: 'Almacén B' }).expect(201);
    const peB = await http(app).post('/api/pedidos').set(hB).send({ sucursalId: b.sucursalId, clienteId: clB.body.id, items: [{ varianteId: vb.varianteId, cantidad: 1 }] }).expect(201);
    const reB = await http(app).post('/api/repartos').set(hB).send({ cajaId: vb.cajaId, fecha: '2026-11-14', repartidor: 'Chofer B', pedidoIds: [peB.body.id] }).expect(201);
    idsDeB['/api/repartos'] = reB.body.id;
    // Facturación: registros de B (la empresa A nunca los ve).
    idsDeB['/api/facturacion/establecimientos'] = b.sucursalId;
    idsDeB['/api/facturacion/puntos'] = vb.cajaId;
    idsDeB['/api/facturacion/documentos'] = vb.ventaId;
    // Compras en B.
    const pvB = await http(app).post('/api/proveedores').set(hB).send({ nombre: 'Proveedor de B' }).expect(201);
    idsDeB['/api/proveedores'] = pvB.body.id;
    const ocB = await http(app).post('/api/ordenes-compra').set(hB).send({ proveedorId: pvB.body.id, depositoId: vb.depositoId, items: [{ varianteId: vb.varianteId, cantidad: 1, costoUnitario: 1000 }] }).expect(201);
    idsDeB['/api/ordenes-compra'] = ocB.body.id;
    const coB = await http(app).post('/api/compras').set(hB).send({ proveedorId: pvB.body.id, depositoId: vb.depositoId, documentoTipo: 'remision', fechaDocumento: '2026-11-12', condicion: 'credito', items: [{ varianteId: vb.varianteId, cantidad: 1, costoUnitario: 1000 }] }).expect(201);
    idsDeB['/api/compras'] = coB.body.id;
    idsDeB['/api/cuentas-pagar'] = coB.body.cuenta.id;
    const pgB = await http(app).post('/api/pagos-proveedor').set(hB).send({ proveedorId: pvB.body.id, fecha: '2026-11-12', medio: 'transferencia', aplicaciones: [{ cuentaId: coB.body.cuenta.id, monto: 100 }] }).expect(201);
    idsDeB['/api/pagos-proveedor'] = pgB.body.id;
    // Crédito en B: venta fiada y un cobro.
    await http(app).patch(`/api/clientes/${cl.body.id}`).set(hB).send({ nombre: 'Cliente de B', limiteCredito: 1000000 }).expect(200);
    const vcB = await http(app).post('/api/ventas').set(hB).send({ claveIdempotencia: `cr-${Date.now()}`, cajaId: vb.cajaId, clienteId: cl.body.id, items: [{ varianteId: vb.varianteId, cantidad: 1 }], pagos: [], credito: 11000 }).expect(201);
    idsDeB['/api/cuentas-cobrar'] = cl.body.id;
    const kB = await http(app).post('/api/cobros').set(hB).send({ clienteId: cl.body.id, fecha: '2026-11-12', medio: 'transferencia', aplicaciones: [{ cuentaId: vcB.body.cuentaCobrar.id, monto: 1000 }] }).expect(201);
    idsDeB['/api/cobros'] = kB.body.id;
    const cbB = await http(app).post('/api/cuentas-bancarias').set(hB).send({ banco: 'Banco de B', nombre: 'Cuenta corriente', saldoInicial: 0, fechaSaldoInicial: '2026-11-01' }).expect(201);
    idsDeB['/api/cuentas-bancarias'] = cbB.body.id;
    await http(app).post('/api/contabilidad/cuentas/plan-sugerido').set(hB).expect(201);
    const planB = await http(app).get('/api/contabilidad/cuentas').set(hB).expect(200);
    const cajaB = planB.body.cuentas.find((c: { codigo: string }) => c.codigo === '1.1.01').id;
    const capitalB = planB.body.cuentas.find((c: { codigo: string }) => c.codigo === '3.1.01').id;
    idsDeB['/api/contabilidad/cuentas'] = cajaB;
    const asB = await http(app)
      .post('/api/contabilidad/asientos')
      .set(hB)
      .send({ fecha: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion' }).format(new Date()), descripcion: 'Aporte de capital', lineas: [{ cuentaId: cajaB, debe: 1000 }, { cuentaId: capitalB, haber: 1000 }] })
      .expect(201);
    idsDeB['/api/contabilidad/asientos'] = asB.body.id;
    const fB = await http(app)
      .post('/api/funcionarios')
      .set(hB)
      .send({ sucursalId: b.sucursalId, nombre: 'Funcionario de B', documento: '9998887', cargo: 'Vendedor', fechaIngreso: '2026-01-05', remuneracion: 'mensual', salario: 3044000 })
      .expect(201);
    idsDeB['/api/funcionarios'] = fB.body.id;
    const lB = await http(app).post('/api/liquidaciones').set(hB).send({ tipo: 'mensual', periodo: '2026-10' }).expect(201);
    idsDeB['/api/liquidaciones'] = lB.body.id;
    const nB = await http(app).post('/api/rrhh/novedades').set(hB).send({ funcionarioId: fB.body.id, fecha: '2026-10-06', tipo: 'ausencia' }).expect(201);
    idsDeB['/api/rrhh/novedades'] = nB.body.ids[0];
    const vB = await http(app).post('/api/rrhh/vacaciones/ajuste').set(hB).send({ funcionarioId: fB.body.id, dias: 5, observacion: 'Saldo inicial de B' }).expect(201);
    idsDeB['/api/rrhh/vacaciones'] = vB.body.id;
    const mB = await http(app).post('/api/rrhh/marcaciones').set(hB).send({ funcionarioId: fB.body.id, fecha: '2026-10-06', hora: '08:00' }).expect(201);
    idsDeB['/api/rrhh/marcaciones'] = mB.body.id;
    const slB = await http(app).post('/api/restaurante/salones').set(hB).send({ sucursalId: b.sucursalId, nombre: 'Salón de B' }).expect(201);
    idsDeB['/api/restaurante/salones'] = slB.body.id;
    const msB = await http(app).post('/api/restaurante/mesas').set(hB).send({ salonId: slB.body.id, nombre: '1' }).expect(201);
    idsDeB['/api/restaurante/mesas'] = msB.body.id;
    const ctB = await http(app).post('/api/restaurante/cuentas').set(hB).send({ mesaId: msB.body.id }).expect(201);
    idsDeB['/api/restaurante/cuentas'] = ctB.body.id;
    const insB = await http(app).post('/api/productos').set(hB).send({ nombre: 'Harina de B', tasaIva: 10, variantes: [{ precio: 1, costo: 1, codigos: [] }] }).expect(201);
    const rcB = await http(app).post('/api/produccion/recetas').set(hB).send({ varianteId: vb.varianteId, rendimiento: 10, insumos: [{ varianteId: insB.body.variantes[0].id, cantidad: 1 }] }).expect(201);
    idsDeB['/api/produccion/recetas'] = rcB.body.id;
    const opB = await http(app).post('/api/produccion/ordenes').set(hB).send({ varianteId: vb.varianteId, depositoId: vb.depositoId, cantidad: 10, fecha: '2026-11-13' }).expect(201);
    idsDeB['/api/produccion/ordenes'] = opB.body.id;
  });
  afterAll(() => app.close());

  it('encuentra los endpoints a verificar', () => {
    expect(RUTAS.length).toBeGreaterThan(25);
  });

  it('todo endpoint es público o declara @Requiere / @SoloSesion', () => {
    const sinDeclarar = RUTAS.filter((r) => !r.publico && !r.permiso).map((r) => `${r.metodo.toUpperCase()} ${r.ruta}`);
    expect(sinDeclarar).toEqual([]);
  });

  it('solo los endpoints esperados son públicos', () => {
    const publicos = RUTAS.filter((r) => r.publico).map((r) => `${r.metodo.toUpperCase()} ${r.ruta}`).sort();
    expect(publicos).toEqual(
      [
        'GET /api/salud',
        'POST /api/auth/cerrar',
        'POST /api/auth/empresa',
        'POST /api/auth/login',
        'POST /api/auth/recuperar',
        'POST /api/auth/renovar',
        'POST /api/auth/restablecer',
        'POST /api/auth/2fa/verificar',
        'POST /api/auth/2fa/enrolar',
        'POST /api/auth/2fa/enrolar/confirmar',
      ].sort(),
    );
  });

  describe('sin sesión → 401', () => {
    for (const r of RUTAS.filter((x) => !x.publico)) {
      it(`${r.metodo.toUpperCase()} ${r.ruta}`, async () => {
        const ruta = r.ruta.replace(':id', '00000000-0000-7000-8000-000000000000');
        await http(app)[r.metodo](ruta).send({}).expect(401);
      });
    }
  });

  describe('usuario sin el permiso → 403', () => {
    for (const r of RUTAS.filter((x) => x.permiso && x.permiso !== '__sesion__')) {
      it(`${r.metodo.toUpperCase()} ${r.ruta} exige ${r.permiso}`, async () => {
        const ruta = r.ruta.replace(':id', '00000000-0000-7000-8000-000000000000');
        const res = await http(app)[r.metodo](ruta).set('Authorization', `Bearer ${sinPermisos}`).send({});
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('SIN_PERMISO');
      });
    }
  });

  describe('registro de otra empresa → 404 (aunque el usuario tenga todos los permisos)', () => {
    for (const r of RUTAS.filter((x) => x.ruta.includes(':id'))) {
      it(`${r.metodo.toUpperCase()} ${r.ruta}`, async () => {
        const prefijo = Object.keys(idsDeB).find((p) => r.ruta.startsWith(p + '/'));
        expect(prefijo, `sin id de prueba para ${r.ruta}`).toBeDefined();
        // Un segundo parámetro (por ejemplo, :item) va con un id cualquiera: el primero ya es ajeno.
        const ruta = r.ruta.replace(':id', idsDeB[prefijo!]!).replace(/:[a-z]+/g, '00000000-0000-7000-8000-000000000000');
        // Cuerpos válidos para que la validación no responda 400 antes de buscar el registro.
        const porRuta: Record<string, object> = {
          'PATCH /api/productos/:id': { nombre: 'Intento ajeno', variantes: [{ precio: 1, codigos: [] }] },
          'POST /api/cajas/:id/movimientos': { tipo: 'ingreso', moneda: 'PYG', monto: 1, motivo: 'Intento ajeno' },
          'POST /api/cajas/:id/cerrar': { contado: [] },
          'POST /api/ventas/:id/anular': { motivo: 'Intento ajeno' },
          'POST /api/transferencias/:id/cancelar': { motivo: 'Intento ajeno' },
          'PATCH /api/listas-precio/:id': { nombre: 'Intento ajeno' },
          'PUT /api/listas-precio/:id/precios': { items: [{ varianteId: '00000000-0000-7000-8000-000000000000', precio: 1 }] },
          'POST /api/listas-precio/:id/ajuste': { porcentaje: -10 },
          'PATCH /api/presupuestos/:id': { sucursalId: '00000000-0000-7000-8000-000000000000', items: [{ varianteId: '00000000-0000-7000-8000-000000000000', cantidad: 1 }] },
          'PATCH /api/pedidos/:id': { sucursalId: '00000000-0000-7000-8000-000000000000', clienteNombre: 'X', items: [{ varianteId: '00000000-0000-7000-8000-000000000000', cantidad: 1 }] },
          'POST /api/presupuestos/:id/rechazar': { motivo: 'Intento ajeno' },
          'POST /api/presupuestos/:id/anular': { motivo: 'Intento ajeno' },
          'POST /api/pedidos/:id/cancelar': { motivo: 'Intento ajeno' },
          'POST /api/pedidos/:id/estado': { estado: 'preparado' },
          'PUT /api/facturacion/establecimientos/:id': { direccion: 'Calle ajena', departamento: 11, distrito: 145, ciudad: 3432, telefono: '061500000' },
          'PUT /api/facturacion/puntos/:id': { punto: '009' },
          'POST /api/facturacion/documentos/:id/inutilizar': { motivo: 'Intento ajeno' },
          'PATCH /api/proveedores/:id': { nombre: 'Intento ajeno' },
          'PATCH /api/ordenes-compra/:id': { proveedorId: '00000000-0000-7000-8000-000000000000', depositoId: '00000000-0000-7000-8000-000000000000', items: [{ varianteId: '00000000-0000-7000-8000-000000000000', cantidad: 1, costoUnitario: 1 }] },
          'POST /api/ordenes-compra/:id/cancelar': { motivo: 'Intento ajeno' },
          'POST /api/compras/:id/anular': { motivo: 'Intento ajeno' },
          'POST /api/pagos-proveedor/:id/anular': { motivo: 'Intento ajeno' },
          'POST /api/cobros/:id/anular': { motivo: 'Intento ajeno' },
          'PATCH /api/funcionarios/:id': { sucursalId: '00000000-0000-7000-8000-000000000000', nombre: 'Intento ajeno', documento: '1112223', cargo: 'Cargo', fechaIngreso: '2026-01-01', remuneracion: 'mensual' },
          'POST /api/funcionarios/:id/baja': { fechaEgreso: '2026-11-01', motivo: 'Intento ajeno' },
          'POST /api/funcionarios/:id/reingreso': { fechaIngreso: '2026-11-01' },
          'PATCH /api/liquidaciones/:id/items': { funcionarioId: '00000000-0000-7000-8000-000000000000', dias: 10 },
          'POST /api/liquidaciones/:id/quitar': { funcionarioId: '00000000-0000-7000-8000-000000000000' },
          'POST /api/liquidaciones/:id/pagar': { fecha: '2026-11-01', medio: 'banco', cuentaBancariaId: '00000000-0000-7000-8000-000000000000' },
          'POST /api/liquidaciones/:id/anular': { motivo: 'Intento ajeno' },
          'POST /api/rrhh/vacaciones/:id/anular': { motivo: 'Intento ajeno' },
          'POST /api/restaurante/mesas': { salonId: '00000000-0000-7000-8000-000000000000', nombre: '9' },
          'POST /api/restaurante/cuentas/:id/items': { items: [{ varianteId: '00000000-0000-7000-8000-000000000000', cantidad: 1 }] },
          'POST /api/restaurante/cuentas/:id/items/:item/anular': { motivo: 'Intento ajeno' },
          'POST /api/restaurante/cuentas/:id/items/:item/dividir': { cantidad: 1 },
          'POST /api/restaurante/cuentas/:id/mover': { mesaId: '00000000-0000-7000-8000-000000000000' },
          'PUT /api/produccion/recetas/:id': { varianteId: '00000000-0000-7000-8000-000000000000', rendimiento: 1, insumos: [{ varianteId: '00000000-0000-7000-8000-000000000001', cantidad: 1 }] },
          'POST /api/produccion/ordenes/:id/terminar': { cantidadProducida: 1 },
          'PUT /api/rutas/:id': { sucursalId: '00000000-0000-7000-8000-000000000000', nombre: 'Intento ajeno' },
          'PUT /api/rutas/:id/clientes': { clienteIds: [] },
          'PUT /api/repartos/:id': { cajaId: '00000000-0000-7000-8000-000000000000', fecha: '2026-11-14', repartidor: 'Intento ajeno', pedidoIds: ['00000000-0000-7000-8000-000000000000'] },
          'POST /api/repartos/:id/anular': { motivo: 'Intento ajeno' },
          'POST /api/repartos/:id/rendir': { entregas: [{ pedidoId: '00000000-0000-7000-8000-000000000000', estado: 'entregado' }], efectivoEntregado: 0 },
          'POST /api/produccion/ordenes/:id/anular': { motivo: 'Intento ajeno' },
          'PATCH /api/contabilidad/cuentas/:id': { codigo: '1.1.01', nombre: 'Intento ajeno', imputable: true },
          'POST /api/contabilidad/asientos/:id/anular': { motivo: 'Intento ajeno' },
          'PATCH /api/cuentas-bancarias/:id': { banco: 'Banco ajeno', nombre: 'Intento ajeno', fechaSaldoInicial: '2026-11-01' },
          'POST /api/cuentas-bancarias/:id/movimientos': { tipo: 'deposito', fecha: '2026-11-12', monto: 1, descripcion: 'Intento ajeno' },
          'POST /api/cuentas-bancarias/:id/transferencia': { destinoId: '00000000-0000-7000-8000-000000000000', fecha: '2026-11-12', monto: 1 },
          'POST /api/cuentas-bancarias/:id/deposito-caja': { cajaId: '00000000-0000-7000-8000-000000000000', fecha: '2026-11-12', monto: 1 },
        };
        const cuerpos: Record<string, object> = { patch: { nombre: 'Intento ajeno' }, put: { permisos: [] } };
        const cuerpo = porRuta[`${r.metodo.toUpperCase()} ${r.ruta}`] ?? cuerpos[r.metodo] ?? {};
        const res = await http(app)[r.metodo](ruta).set('Authorization', `Bearer ${a.propietario.token}`).send(cuerpo);
        expect(res.status).toBe(404);
      });
    }
  });

  it('y el registro de B sigue intacto', async () => {
    const r = await http(app).get(`/api/sucursales/${b.sucursalId}`).set('Authorization', `Bearer ${b.propietario.token}`).expect(200);
    expect(r.body.nombre).toBe('Casa matriz');
    const s = await http(app).get('/api/auth/sesiones').set('Authorization', `Bearer ${b.propietario.token}`).expect(200);
    expect(s.body.some((x: { id: string }) => x.id === idsDeB['/api/auth/sesiones'])).toBe(true);
  });

  it('las listas de A no contienen nada de B', async () => {
    for (const ruta of ['/api/usuarios', '/api/perfiles', '/api/sucursales', '/api/clientes', '/api/cajas', '/api/productos', '/api/ventas', '/api/transferencias', '/api/devoluciones']) {
      const r = await http(app).get(ruta).set('Authorization', `Bearer ${a.propietario.token}`).expect(200);
      const ids = (Array.isArray(r.body) ? r.body : r.body.items).map((x: { id: string }) => x.id);
      for (const id of Object.values(idsDeB)) expect(ids).not.toContain(id);
    }
    const aud = await http(app).get('/api/auditoria').set('Authorization', `Bearer ${a.propietario.token}`).expect(200);
    expect(aud.body.items.every((x: { entidadId: string }) => !Object.values(idsDeB).includes(x.entidadId))).toBe(true);
  });
});
