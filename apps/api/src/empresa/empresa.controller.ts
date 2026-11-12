import { Body, Controller, Get, Patch } from '@nestjs/common';
import { empresaEditar } from '@kontiva/shared';
import { auditar } from '../comun/auditoria';
import { Contexto, OrigenPeticion, type Ctx, type Origen } from '../comun/contexto';
import { Requiere } from '../comun/decoradores';
import { validar } from '../comun/validar';
import { Db, type Tx } from '../db/database';

async function leerEmpresa(tx: Tx) {
  const e = await tx
    .selectFrom('empresa as e')
    .innerJoin('plan as p', 'p.id', 'e.plan_id')
    .select([
      'e.id', 'e.razon_social', 'e.nombre_fantasia', 'e.ruc', 'e.rubro', 'e.estado', 'e.telefono', 'e.email',
      'e.direccion', 'e.moneda_base', 'e.zona_horaria', 'e.creado_en',
      'p.codigo as plan_codigo', 'p.max_usuarios', 'p.max_sucursales', 'p.max_cajas',
    ])
    .executeTakeFirstOrThrow();
  const [usuarios, sucursales] = await Promise.all([
    tx.selectFrom('usuario').select((eb) => eb.fn.countAll<string>().as('n')).where('activo', '=', true).executeTakeFirstOrThrow(),
    tx.selectFrom('sucursal').select((eb) => eb.fn.countAll<string>().as('n')).where('activa', '=', true).executeTakeFirstOrThrow(),
  ]);
  return {
    id: e.id,
    razonSocial: e.razon_social,
    nombreFantasia: e.nombre_fantasia,
    ruc: e.ruc,
    rubro: e.rubro,
    estado: e.estado,
    telefono: e.telefono,
    email: e.email,
    direccion: e.direccion,
    monedaBase: e.moneda_base,
    zonaHoraria: e.zona_horaria,
    creadoEn: e.creado_en,
    plan: {
      codigo: e.plan_codigo,
      limites: { usuarios: e.max_usuarios, sucursales: e.max_sucursales, cajas: e.max_cajas },
      uso: { usuarios: Number(usuarios.n), sucursales: Number(sucursales.n) },
    },
  };
}

@Controller('empresa')
export class EmpresaController {
  constructor(private readonly db: Db) {}

  @Requiere('empresa', 'ver')
  @Get()
  ver(@Contexto() ctx: Ctx) {
    return this.db.enEmpresa(ctx.empresaId, leerEmpresa);
  }

  @Requiere('empresa', 'editar')
  @Patch()
  editar(@Contexto() ctx: Ctx, @Body() body: unknown, @OrigenPeticion() o: Origen) {
    const d = validar(empresaEditar, body);
    return this.db.enEmpresa(ctx.empresaId, async (tx) => {
      const antes = await leerEmpresa(tx);
      await tx
        .updateTable('empresa')
        .set({
          ...(d.razonSocial !== undefined && { razon_social: d.razonSocial }),
          ...(d.nombreFantasia !== undefined && { nombre_fantasia: d.nombreFantasia || null }),
          ...(d.ruc !== undefined && { ruc: d.ruc }),
          ...(d.telefono !== undefined && { telefono: d.telefono || null }),
          ...(d.direccion !== undefined && { direccion: d.direccion || null }),
          ...(d.email !== undefined && { email: d.email || null }),
        })
        .where('id', '=', ctx.empresaId)
        .execute();
      const despues = await leerEmpresa(tx);
      await auditar(tx, { ...ctx, ...o }, { accion: 'editar', entidad: 'empresa', entidadId: ctx.empresaId, antes, despues });
      return despues;
    });
  }
}
