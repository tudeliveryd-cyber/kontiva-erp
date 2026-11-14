import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditoriaController } from './auditoria/auditoria.controller';
import { CategoriasController, MarcasController, ProductosController } from './catalogo/catalogo.controller';
import { ClientesController } from './catalogo/clientes.controller';
import { ImportacionController } from './catalogo/importacion.controller';
import { StockController } from './catalogo/stock.controller';
import { CajasController, CotizacionesController } from './operacion/cajas.controller';
import { PdvController, PdvPreciosController, VentasController } from './operacion/ventas.controller';
import { ListasPrecioController } from './catalogo/listas.controller';
import { PedidosController, PresupuestosController } from './operacion/pedidos.controller';
import { FacturacionController } from './sifen/facturacion.controller';
import { CobrosController, CuentasCobrarController } from './finanzas/cobrar.controller';
import { CuentasBancariasController, MovimientosBancariosController } from './finanzas/bancos.controller';
import { FlujoCajaController } from './finanzas/flujo.controller';
import { ContabilidadController } from './contabilidad/contabilidad.controller';
import { RecetarioController } from './informes/recetario.controller';
import { CocinaController, CuentasController, SalonController } from './restaurante/restaurante.controller';
import { ProduccionController, RecetasProduccionController } from './produccion/produccion.controller';
import { MarcacionesController, NovedadesController, VacacionesController } from './rrhh/asistencia.controller';
import { FuncionariosController, LiquidacionesController, RrhhConfiguracionController } from './rrhh/rrhh.controller';
import { InformesController } from './informes/informes.controller';
import { ComprasController, CuentasPagarController, OrdenesCompraController, PagosProveedorController, ProveedoresController } from './compras/compras.controller';
import { EmisorSifen } from './sifen/emisor.service';
import { DevolucionesController } from './operacion/devoluciones.controller';
import { ValesController } from './operacion/vales.controller';
import { RepartosController, RutasController } from './distribucion/distribucion.controller';
import { TransferenciasController } from './operacion/transferencias.controller';
import { AuthController, CuentaController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { Tokens } from './auth/tokens';
import { Correo } from './comun/correo';
import { FiltroErrores } from './comun/errores';
import { config } from './config';
import { DbModule } from './db/db.module';
import { EmpresaController } from './empresa/empresa.controller';
import { ExportacionController } from './empresa/exportacion.controller';
import { PerfilesController } from './perfiles/perfiles.controller';
import { ProvisionService } from './provision/provision.service';
import { SaludController } from './salud.controller';
import { SucursalesController } from './sucursales/sucursales.controller';
import { UsuariosController } from './usuarios/usuarios.controller';

@Module({
  imports: [
    DbModule,
    ThrottlerModule.forRoot({
      // Límite general por IP; los endpoints de acceso tienen límites propios más bajos.
      throttlers: [{ name: 'default', ttl: 60000, limit: () => config().LIMITE_POR_MINUTO }],
      skipIf: () => config().NODE_ENV === 'test',
    }),
  ],
  controllers: [
    SaludController,
    AuthController,
    CuentaController,
    EmpresaController,
    ExportacionController,
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
    ValesController,
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
    VentasController,
    TransferenciasController,
    DevolucionesController,
    RutasController,
    RepartosController,
  ],
  providers: [
    // El despacho y la rendición de los repartos reutilizan la venta, el cobro y la devolución.
    VentasController,
    CobrosController,
    DevolucionesController,
    { provide: Tokens, useFactory: Tokens.empresas },
    Correo,
    AuthService,
    ProvisionService,
    EmisorSifen,
    // Orden: primero el límite de peticiones, después la autenticación y permisos.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: FiltroErrores },
  ],
})
export class AppModule {}
