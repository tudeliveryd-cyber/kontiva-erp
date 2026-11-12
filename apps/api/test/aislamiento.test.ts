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
import { StockController } from '../src/catalogo/stock.controller';
import { CajasController, CotizacionesController } from '../src/operacion/cajas.controller';
import { PdvController, VentasController } from '../src/operacion/ventas.controller';
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
  CajasController,
  CotizacionesController,
  PdvController,
  VentasController,
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
        const ruta = r.ruta.replace(':id', idsDeB[prefijo!]!);
        // Cuerpos válidos para que la validación no responda 400 antes de buscar el registro.
        const porRuta: Record<string, object> = {
          'PATCH /api/productos/:id': { nombre: 'Intento ajeno', variantes: [{ precio: 1, codigos: [] }] },
          'POST /api/cajas/:id/movimientos': { tipo: 'ingreso', moneda: 'PYG', monto: 1, motivo: 'Intento ajeno' },
          'POST /api/cajas/:id/cerrar': { contado: [] },
          'POST /api/ventas/:id/anular': { motivo: 'Intento ajeno' },
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
    for (const ruta of ['/api/usuarios', '/api/perfiles', '/api/sucursales', '/api/clientes', '/api/cajas', '/api/productos', '/api/ventas']) {
      const r = await http(app).get(ruta).set('Authorization', `Bearer ${a.propietario.token}`).expect(200);
      const ids = (Array.isArray(r.body) ? r.body : r.body.items).map((x: { id: string }) => x.id);
      for (const id of Object.values(idsDeB)) expect(ids).not.toContain(id);
    }
    const aud = await http(app).get('/api/auditoria').set('Authorization', `Bearer ${a.propietario.token}`).expect(200);
    expect(aud.body.items.every((x: { entidadId: string }) => !Object.values(idsDeB).includes(x.entidadId))).toBe(true);
  });
});
