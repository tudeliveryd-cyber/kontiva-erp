# KONTIVA ERP · API de empresas

> Generado por `node scripts/documentar-api.mjs` a partir del código. No editar a mano.

277 rutas · OpenAPI 3.1 en [openapi.json](./openapi.json) (se importa en Postman o Insomnia).

## Cómo se usa

1. `POST /api/auth/login` con `{ "email", "contrasena" }` → `{ accessToken }` (15 minutos) y una cookie de sesión.
   Si el usuario tiene segundo factor, la respuesta pide el código (`POST /api/auth/2fa/verificar`). Con varias empresas, se indica `empresaId`.
2. Cada petición lleva `Authorization: Bearer <accessToken>` y `X-Kontiva: 1`.
3. Al vencer el token (401), `POST /api/auth/renovar` con la cookie devuelve uno nuevo.
4. Errores: HTTP 4xx con `{ "codigo": "STOCK_INSUFICIENTE", "mensaje": "...", "detalles": ... }`.
5. Importes en guaraníes como texto decimal (`"11000.00"`); cantidades con 4 decimales; fechas ISO 8601.
6. Las ventas llevan `claveIdempotencia`: reenviar la misma venta no la duplica (caja sin conexión).

Acceso: **permiso** = el perfil del usuario debe tenerlo (el propietario tiene todos) · **sesión** = cualquier usuario con sesión · **público** = sin sesión.

## Módulos

- [Acceso y sesión](#acceso-y-sesion) (23)
- [Auditoría](#auditoria) (1)
- [Caja y ventas](#caja-y-ventas) (48)
- [Catálogo y stock](#catalogo-y-stock) (29)
- [Compras](#compras) (24)
- [Contabilidad](#contabilidad) (16)
- [Distribución](#distribucion) (13)
- [Empresa](#empresa) (8)
- [Estado del servicio](#estado-del-servicio) (1)
- [Facturación electrónica (SIFEN)](#facturacion-electronica-sifen) (17)
- [Finanzas](#finanzas) (15)
- [Informes](#informes) (5)
- [Personal (RRHH)](#personal-rrhh) (32)
- [Producción](#produccion) (13)
- [Restaurante](#restaurante) (20)
- [Usuarios y perfiles](#usuarios-y-perfiles) (12)

## Acceso y sesión

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| POST | `/api/auth/login` | publico | cuerpo: `loginEntrada` |  |
| POST | `/api/auth/2fa/verificar` | publico | cuerpo: en el controlador |  |
| POST | `/api/auth/2fa/enrolar` | publico | cuerpo: en el controlador |  |
| POST | `/api/auth/2fa/enrolar/confirmar` | publico | cuerpo: en el controlador |  |
| GET | `/api/auth/2fa` | sesion | — |  |
| POST | `/api/auth/2fa/iniciar` | sesion | cuerpo: en el controlador |  |
| POST | `/api/auth/2fa/activar` | sesion | cuerpo: en el controlador |  |
| POST | `/api/auth/2fa/desactivar` | sesion | cuerpo: en el controlador |  |
| POST | `/api/auth/2fa/codigos` | sesion | cuerpo: en el controlador |  |
| POST | `/api/auth/empresa` | publico | cuerpo: `elegirEmpresaEntrada` |  |
| POST | `/api/auth/renovar` | publico | — |  |
| POST | `/api/auth/cerrar` | publico | — |  |
| POST | `/api/auth/recuperar` | publico | cuerpo: `recuperarEntrada` |  |
| POST | `/api/auth/restablecer` | publico | cuerpo: `restablecerEntrada` |  |
| GET | `/api/auth/sesiones` | sesion | — |  |
| DELETE | `/api/auth/sesiones/:id` | sesion | — |  |
| POST | `/api/auth/cambiar-empresa` | sesion | cuerpo: `cambiarEmpresaEntrada` |  |
| POST | `/api/auth/contrasena` | sesion | cuerpo: `cambiarContrasenaEntrada` |  |
| PUT | `/api/auth/pin` | sesion | cuerpo: `pinEntrada…` |  |
| GET | `/api/me` | sesion | — | Quién soy: usuario, empresa, permisos efectivos y empresas a las que puedo cambiar. |
| GET | `/api/permisos` | sesion | — | Catálogo de permisos (para la pantalla de perfiles). |
| GET | `/api/autorizadores` | sesion | — | Quiénes pueden autorizar una acción con su PIN (solo nombres), para el diálogo del PDV. |
| POST | `/api/autorizaciones` | sesion | cuerpo: `autorizarEntrada` |  |

## Auditoría

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/auditoria` | `auditoria.ver` | filtros: `auditoriaFiltro` | Registro de auditoría, del más reciente al más antiguo, paginado por cursor (id). |

## Caja y ventas

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/cajas` | `caja.ver` | — |  |
| POST | `/api/cajas` | `caja.editar` | cuerpo: `cajaEntrada` |  |
| PATCH | `/api/cajas/:id` | `caja.editar` | cuerpo: `cajaEntrada…` |  |
| POST | `/api/cajas/:id/abrir` | `caja.crear` | cuerpo: `aperturaCajaEntrada` |  |
| GET | `/api/cajas/:id/sesion` | `caja.ver` | — |  |
| POST | `/api/cajas/:id/movimientos` | `caja.crear` | cuerpo: `movimientoCajaEntrada` | Retiro (sangría) o ingreso de efectivo. Requiere caja.aprobar o la autorización con PIN de un supervisor. |
| POST | `/api/cajas/:id/cerrar` | `arqueo.crear` | cuerpo: `cierreCajaEntrada` | Cierre con arqueo: lo contado contra lo esperado, por moneda y medio. La diferencia queda registrada. |
| GET | `/api/cajas/:id/sesiones` | `arqueo.ver` | — |  |
| GET | `/api/cotizaciones` | `caja.ver` | filtros: en el controlador |  |
| POST | `/api/cotizaciones` | `caja.editar` | cuerpo: `cotizacionEntrada` |  |
| GET | `/api/devoluciones` | `venta.ver` | filtros: en el controlador |  |
| GET | `/api/devoluciones/:id` | `venta.ver` | — |  |
| POST | `/api/devoluciones` | `venta.crear` | cuerpo: `devolucionEntrada` | Devolución parcial o total de una venta (de esta caja o de una ya cerrada). El dinero sale de la caja abierta de quien atiende y la mercadería vuelve al depósito de esa caja. Requiere devolucion.crear o el PIN de un supervisor (devolucion.aprobar). |
| GET | `/api/presupuestos` | `presupuesto.ver` | filtros: en el controlador |  |
| GET | `/api/presupuestos/productos` | `presupuesto.crear` | filtros: en el controlador |  |
| GET | `/api/presupuestos/:id` | `presupuesto.ver` | — |  |
| POST | `/api/presupuestos` | `presupuesto.crear` | cuerpo: `pedidoEntrada` |  |
| PATCH | `/api/presupuestos/:id` | `presupuesto.editar` | cuerpo: `pedidoEntrada` |  |
| POST | `/api/presupuestos/:id/aceptar` | `pedido.crear` | cuerpo: en el controlador | El cliente aceptó: se genera el pedido con los mismos precios cotizados. |
| POST | `/api/presupuestos/:id/rechazar` | `presupuesto.editar` | cuerpo: `cerrarPedidoEntrada` |  |
| POST | `/api/presupuestos/:id/anular` | `presupuesto.editar` | cuerpo: `cerrarPedidoEntrada` |  |
| GET | `/api/pedidos` | `pedido.ver` | filtros: en el controlador |  |
| GET | `/api/pedidos/productos` | `pedido.crear` | filtros: en el controlador |  |
| GET | `/api/pedidos/:id` | `pedido.ver` | — |  |
| POST | `/api/pedidos` | `pedido.crear` | cuerpo: `pedidoEntrada` |  |
| PATCH | `/api/pedidos/:id` | `pedido.editar` | cuerpo: `pedidoEntrada` |  |
| POST | `/api/pedidos/:id/estado` | `pedido.editar` | cuerpo: `estadoPedidoEntrada` | Pendiente ↔ preparado (armado y listo para entregar). |
| POST | `/api/pedidos/:id/cancelar` | `pedido.cancelar` | cuerpo: `cerrarPedidoEntrada` |  |
| GET | `/api/transferencias` | `transferencia.ver` | filtros: en el controlador |  |
| GET | `/api/transferencias/:id` | `transferencia.ver` | — |  |
| POST | `/api/transferencias` | `transferencia.crear` | cuerpo: `transferenciaEntrada` | Sale del origen en el acto. Directa: entra al destino en la misma transacción. |
| POST | `/api/transferencias/:id/recibir` | `transferencia.aprobar` | cuerpo: `recepcionEntrada` | El destino confirma lo que llegó. Lo que falte queda registrado como faltante. |
| POST | `/api/transferencias/:id/cancelar` | `transferencia.cancelar` | cuerpo: `cancelarEntrada` | Cancelar una transferencia en tránsito: la mercadería vuelve al origen. |
| GET | `/api/vales` | `venta.ver` | filtros: en el controlador |  |
| GET | `/api/vales/codigo/:codigo` | `venta.crear` | — | Consulta desde la caja: saldo disponible del vale para usarlo como pago. |
| GET | `/api/vales/:id` | `venta.ver` | — |  |
| GET | `/api/pdv/contexto` | `venta.crear` | filtros: en el controlador | Lo que el PDV necesita al abrir: caja, sesión propia, cotizaciones y configuración. |
| GET | `/api/pdv/catalogo` | `venta.crear` | filtros: en el controlador | Catálogo completo de la caja para vender sin conexión: productos activos con sus códigos de barras, el precio de la sucursal (lista general) y el stock del depósito. La caja lo guarda y lo renueva. |
| GET | `/api/pdv/buscar` | `venta.crear` | filtros: en el controlador | Búsqueda para la caja: código de barras exacto primero (lector), luego SKU y nombre. Devuelve precio de la sucursal y stock del depósito de la caja. |
| GET | `/api/pdv/venta-cambio` | `venta.crear` | filtros: en el controlador | Cambio desde la caja: ventas confirmadas de la sucursal de la caja con ese número (una por caja), con lo que todavía se puede devolver. El cajero puede cambiar lo vendido por otro. |
| GET | `/api/pdv/grade` | `venta.crear` | filtros: en el controlador | Grade de un producto (talle × color) con precio y stock del depósito de la caja, para elegir la variante. |
| GET | `/api/pdv/equivalentes` | `venta.crear` | filtros: en el controlador | Productos con el mismo principio activo (y concentración, si la tiene): alternativas para ofrecer. |
| POST | `/api/pdv/precios` | `venta.crear` | cuerpo: en el controlador | Precios de las líneas del carrito al elegir o quitar el cliente (su lista de precios). |
| GET | `/api/pdv/pedidos` | `venta.crear` | filtros: en el controlador | Pedidos abiertos de la sucursal de la caja, para cargarlos en el carrito y cobrarlos. |
| POST | `/api/ventas` | `venta.crear` | cuerpo: `ventaEntrada` | Venta atómica: todo o nada en una transacción. 1. Idempotencia: la misma clave devuelve la misma venta (reintentos por cortes de red). 2. Caja bloqueada (numeración) y sesión abierta del propio cajero. 3. Precios desde la base; descuentos y cambios de precio solo con permiso o PIN de supervisor. 4. Stock bloqueado en orden de id (sin interbloqueos) y validado. 5. Venta, ítems, pagos, movimientos de stock y de caja, auditoría. |
| GET | `/api/ventas` | `venta.ver` | filtros: en el controlador |  |
| GET | `/api/ventas/:id` | `venta.ver` | — |  |
| POST | `/api/ventas/:id/anular` | `venta.crear` | cuerpo: `anularVentaEntrada` | Anulación en la misma sesión de caja: devuelve el stock y registra la salida de dinero. Requiere venta.cancelar o el PIN de un supervisor (X-Autorizacion). |

## Catálogo y stock

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/productos` | `producto.ver` | filtros: en el controlador |  |
| GET | `/api/productos/:id` | `producto.ver` | — |  |
| POST | `/api/productos` | `producto.crear` | cuerpo: `productoEntrada` |  |
| PATCH | `/api/productos/:id` | `producto.editar` | cuerpo: `productoEntrada` |  |
| DELETE | `/api/productos/:id` | `producto.eliminar` | — | Los productos con historia no se borran: se desactivan. |
| GET | `/api/categorias` | `producto.ver` | — |  |
| POST | `/api/categorias` | `producto.crear` | cuerpo: `nombreSimple` |  |
| GET | `/api/marcas` | `producto.ver` | — |  |
| POST | `/api/marcas` | `producto.crear` | cuerpo: `nombreSimple` |  |
| GET | `/api/clientes` | `cliente.ver` | filtros: en el controlador |  |
| GET | `/api/clientes/:id` | `cliente.ver` | — |  |
| POST | `/api/clientes` | `cliente.crear` | cuerpo: `clienteEntrada` |  |
| PATCH | `/api/clientes/:id` | `cliente.editar` | cuerpo: `clienteEntrada` |  |
| DELETE | `/api/clientes/:id` | `cliente.eliminar` | — |  |
| POST | `/api/importaciones/productos` | `producto.crear` | cuerpo: en el controlador | Productos (con variantes, códigos, precio, costo y stock) desde una planilla. Empareja por código de barras, luego SKU, luego nombre + variante: reimportar la misma planilla actualiza en lugar de duplicar. Con simular=true no escribe nada. Con simular=false escribe todo en una transacción, o nada si alguna fila tiene errores. |
| POST | `/api/importaciones/clientes` | `cliente.crear` | cuerpo: en el controlador | Clientes: empareja por RUC o cédula, luego por nombre exacto. |
| GET | `/api/listas-precio` | `precio.ver` | — |  |
| POST | `/api/listas-precio` | `precio.editar` | cuerpo: `listaPrecioEntrada` |  |
| PATCH | `/api/listas-precio/:id` | `precio.editar` | cuerpo: `listaPrecioEntrada` |  |
| GET | `/api/listas-precio/:id/precios` | `precio.ver` | filtros: en el controlador | Productos con el precio normal y el de esta lista (en general o para una sucursal). |
| PUT | `/api/listas-precio/:id/precios` | `precio.editar` | cuerpo: `preciosListaEntrada` |  |
| POST | `/api/listas-precio/:id/ajuste` | `precio.editar` | cuerpo: `ajusteListaEntrada` | Carga la lista a partir del precio normal con un porcentaje y redondeo (p. ej. mayorista -10 %). |
| GET | `/api/depositos` | `stock.ver` | — |  |
| GET | `/api/stock/grade` | `stock.ver` | filtros: en el controlador | Grade de un producto: stock de cada talle × color en cada depósito al que el usuario tiene acceso. |
| GET | `/api/stock` | `stock.ver` | filtros: en el controlador | Stock de un depósito: todas las variantes que controlan stock, con su saldo (0 si nunca se movió). |
| POST | `/api/stock/ajustes` | `stock.editar` | cuerpo: `ajusteStockEntrada` | Fija el saldo contado de cada variante. Cada diferencia queda como movimiento con motivo. |
| GET | `/api/stock/lotes` | `stock.ver` | filtros: en el controlador | Lotes de una variante con su saldo en cada depósito visible. |
| GET | `/api/stock/vencimientos` | `stock.ver` | filtros: en el controlador | Lotes con stock vencidos o que vencen dentro de los próximos días, del que vence antes al que vence después. |
| GET | `/api/stock/movimientos` | `stock.ver` | filtros: en el controlador |  |

## Compras

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/proveedores` | `proveedor.ver` | filtros: en el controlador |  |
| GET | `/api/proveedores/:id` | `proveedor.ver` | — |  |
| POST | `/api/proveedores` | `proveedor.crear` | cuerpo: `proveedorEntrada` |  |
| PATCH | `/api/proveedores/:id` | `proveedor.editar` | cuerpo: `proveedorEntrada` |  |
| DELETE | `/api/proveedores/:id` | `proveedor.eliminar` | — |  |
| GET | `/api/ordenes-compra` | `orden_compra.ver` | filtros: en el controlador |  |
| GET | `/api/ordenes-compra/productos` | `orden_compra.crear` | filtros: en el controlador |  |
| GET | `/api/ordenes-compra/:id` | `orden_compra.ver` | — |  |
| POST | `/api/ordenes-compra` | `orden_compra.crear` | cuerpo: `ordenCompraEntrada` |  |
| PATCH | `/api/ordenes-compra/:id` | `orden_compra.editar` | cuerpo: `ordenCompraEntrada` |  |
| POST | `/api/ordenes-compra/:id/enviar` | `orden_compra.aprobar` | — | Aprobada y enviada al proveedor: ya se puede recibir. |
| POST | `/api/ordenes-compra/:id/cancelar` | `orden_compra.cancelar` | cuerpo: en el controlador |  |
| GET | `/api/compras` | `recepcion.ver` | filtros: en el controlador |  |
| GET | `/api/compras/productos` | `recepcion.crear` | filtros: en el controlador |  |
| GET | `/api/compras/:id` | `recepcion.ver` | — |  |
| POST | `/api/compras` | `recepcion.crear` | cuerpo: `compraEntrada` | Compra confirmada en una transacción: stock al depósito, costo promedio ponderado, avance de la orden de compra, cuenta a pagar y, si fue al contado, el pago. |
| POST | `/api/compras/:id/anular` | `recepcion.cancelar` | cuerpo: en el controlador | Anula una compra sin pagos: revierte el stock (si alcanza) y la orden; la cuenta queda anulada. |
| GET | `/api/cuentas-pagar` | `cuenta_pagar.ver` | filtros: en el controlador |  |
| GET | `/api/cuentas-pagar/resumen` | `cuenta_pagar.ver` | — | Totales para el tablero: abierto, vencido y a vencer en 7 días. |
| POST | `/api/cuentas-pagar` | `cuenta_pagar.crear` | cuerpo: `cuentaPagarEntrada` | Cuenta manual (servicios, alquiler, fletes…) a un proveedor. |
| POST | `/api/cuentas-pagar/:id/anular` | `cuenta_pagar.cancelar` | — | Anula una cuenta manual sin pagos. |
| GET | `/api/pagos-proveedor` | `cuenta_pagar.ver` | filtros: en el controlador |  |
| POST | `/api/pagos-proveedor` | `cuenta_pagar.aprobar` | cuerpo: `pagoProveedorEntrada` |  |
| POST | `/api/pagos-proveedor/:id/anular` | `cuenta_pagar.cancelar` | cuerpo: en el controlador | Anula un pago: devuelve el saldo a las cuentas y, si salió de una caja todavía abierta, el efectivo. |

## Contabilidad

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/contabilidad/cuentas` | `contabilidad.ver` | — |  |
| POST | `/api/contabilidad/cuentas/plan-sugerido` | `contabilidad.aprobar` | — |  |
| POST | `/api/contabilidad/cuentas/completar-sugerido` | `contabilidad.aprobar` | — | Agrega al plan las cuentas sugeridas que falten (por ejemplo, las de sueldos) y asigna los conceptos sin cuenta. No cambia lo existente. |
| POST | `/api/contabilidad/cuentas` | `contabilidad.aprobar` | cuerpo: `cuentaContableEntrada` |  |
| PATCH | `/api/contabilidad/cuentas/:id` | `contabilidad.aprobar` | cuerpo: `cuentaContableEntrada` |  |
| PUT | `/api/contabilidad/conceptos` | `contabilidad.aprobar` | cuerpo: `conceptosContablesEntrada` |  |
| GET | `/api/contabilidad/estado` | `contabilidad.ver` | — |  |
| POST | `/api/contabilidad/contabilizar` | `contabilidad.crear` | cuerpo: en el controlador |  |
| POST | `/api/contabilidad/cierre` | `contabilidad.aprobar` | cuerpo: `cierreContableEntrada` |  |
| POST | `/api/contabilidad/cierre/reabrir` | `contabilidad.aprobar` | cuerpo: en el controlador |  |
| GET | `/api/contabilidad/asientos` | `contabilidad.ver` | filtros: en el controlador | Libro diario. |
| GET | `/api/contabilidad/asientos/:id` | `contabilidad.ver` | — |  |
| POST | `/api/contabilidad/asientos` | `contabilidad.crear` | cuerpo: `asientoManualEntrada` |  |
| POST | `/api/contabilidad/asientos/:id/anular` | `contabilidad.crear` | cuerpo: en el controlador | Solo los asientos manuales se anulan: se registra el asiento inverso. Los automáticos siguen a su documento. |
| GET | `/api/contabilidad/mayor` | `contabilidad.ver` | filtros: en el controlador | Libro mayor de una cuenta (si es un grupo, incluye todas sus subcuentas). |
| GET | `/api/contabilidad/balance` | `contabilidad.ver` | filtros: en el controlador | Balance de sumas y saldos del período, con los grupos acumulados. Saldo = debe − haber (positivo deudor, negativo acreedor). Sirve también para el balance general (activo, pasivo, patrimonio al cierre) y el estado de resultados (ingresos y egresos del período). |

## Distribución

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/rutas` | `entrega.ver` | — |  |
| POST | `/api/rutas` | `entrega.editar` | cuerpo: `rutaEntrada` |  |
| PUT | `/api/rutas/:id` | `entrega.editar` | cuerpo: `rutaEntrada` |  |
| GET | `/api/rutas/:id/clientes` | `entrega.ver` | — | Clientes de la ruta en el orden de visita, y los clientes sin ruta para agregar. |
| PUT | `/api/rutas/:id/clientes` | `entrega.editar` | cuerpo: `rutaClientesEntrada` |  |
| GET | `/api/repartos` | `entrega.ver` | filtros: en el controlador |  |
| GET | `/api/repartos/pedidos` | `entrega.ver` | filtros: en el controlador | Pedidos para armar un reparto: por fecha de entrega y ruta del cliente, en el orden de visita. |
| GET | `/api/repartos/:id` | `entrega.ver` | — |  |
| POST | `/api/repartos` | `entrega.crear` | cuerpo: `repartoEntrada` |  |
| PUT | `/api/repartos/:id` | `entrega.crear` | cuerpo: `repartoEntrada` | Mientras se prepara: cambiar datos, pedidos y su orden. |
| POST | `/api/repartos/:id/anular` | `entrega.cancelar` | cuerpo: en el controlador |  |
| POST | `/api/repartos/:id/despachar` | `entrega.crear` | — | Despacho: cada pedido se factura (la factura viaja con la mercadería) a la cuenta del cliente y la mercadería sale del depósito de la caja. Si un pedido falla, los demás quedan facturados y se puede reintentar. |
| POST | `/api/repartos/:id/rendir` | `entrega.editar` | cuerpo: `rendicionEntrada…` | Rendición: por cada pedido, lo entregado, lo que volvió (nota de crédito) y lo cobrado (entra a la caja del reparto; lo no cobrado queda en la cuenta del cliente). Se compara el efectivo entregado con el cobrado. Cada pedido se registra una sola vez: si algo falla, se corrige y se vuelve a enviar. |

## Empresa

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/empresa` | `empresa.ver` | — |  |
| PATCH | `/api/empresa` | `empresa.editar` | cuerpo: `empresaEditar` |  |
| GET | `/api/empresa/exportar` | sesion | — | Exporta todos los datos de la empresa en un ZIP de CSV (portabilidad: la empresa es dueña de sus datos). Solo el propietario. Cada tabla se lee con el aislamiento por empresa activo. |
| GET | `/api/sucursales` | `sucursal.ver` | — |  |
| GET | `/api/sucursales/:id` | `sucursal.ver` | — |  |
| POST | `/api/sucursales` | `sucursal.crear` | cuerpo: `sucursalCrear` |  |
| PATCH | `/api/sucursales/:id` | `sucursal.editar` | cuerpo: `sucursalEditar` |  |
| DELETE | `/api/sucursales/:id` | `sucursal.eliminar` | — | No se borran sucursales (tienen historia): se desactivan. |

## Estado del servicio

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/salud` | publico | — |  |

## Facturación electrónica (SIFEN)

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/facturacion/configuracion` | `config_fiscal.ver` | — |  |
| PUT | `/api/facturacion/configuracion` | `config_fiscal.editar` | cuerpo: `feConfiguracionEntrada` |  |
| POST | `/api/facturacion/certificado` | `config_fiscal.editar` | cuerpo: `feCertificadoEntrada` |  |
| POST | `/api/facturacion/activar` | `config_fiscal.editar` | cuerpo: en el controlador |  |
| PUT | `/api/facturacion/establecimientos/:id` | `config_fiscal.editar` | cuerpo: `feEstablecimientoEntrada` |  |
| PUT | `/api/facturacion/puntos/:id` | `config_fiscal.editar` | cuerpo: `fePuntoEntrada` |  |
| GET | `/api/facturacion/geografia` | `config_fiscal.ver` | filtros: en el controlador | Departamentos, distritos y ciudades según la codificación de la DNIT. |
| GET | `/api/facturacion/documentos` | `documento_fiscal.ver` | filtros: en el controlador |  |
| GET | `/api/facturacion/documentos/:id` | `documento_fiscal.ver` | — |  |
| GET | `/api/facturacion/ruc/:ruc` | `cliente.crear` | — | Consulta un RUC en la DNIT (servicio de SIFEN, con el certificado de la empresa) para cargar clientes. |
| GET | `/api/facturacion/documentos/:id/kude` | `documento_fiscal.ver` | — | KuDE en hoja A4 (PDF), armado desde el XML firmado. |
| GET | `/api/facturacion/documentos/:id/xml` | `documento_fiscal.ver` | — | El XML firmado tal como se envió a SIFEN. |
| POST | `/api/facturacion/documentos/:id/correo` | `documento_fiscal.crear` | cuerpo: en el controlador | Envía el KuDE (PDF) y el XML por correo. Sin dirección, usa el correo del cliente. |
| POST | `/api/facturacion/documentos/:id/reenviar` | `documento_fiscal.crear` | — | Vuelve a poner en cola un documento pendiente o rechazado (mismo XML, mismo CDC). |
| POST | `/api/facturacion/documentos/:id/regenerar` | `documento_fiscal.crear` | — | Corrige un documento rechazado: lo vuelve a generar con los datos actuales (por ejemplo, el RUC del cliente corregido) manteniendo número, código de seguridad y CDC, como permite la DNIT, y lo pone en cola. |
| POST | `/api/facturacion/documentos/:id/inutilizar` | `documento_fiscal.cancelar` | cuerpo: en el controlador | Inutiliza ante SIFEN el número de un documento rechazado que no se va a corregir. |
| POST | `/api/facturacion/procesar` | `documento_fiscal.crear` | — | Procesa ya la cola de la empresa (enviar pendientes y consultar lotes), sin esperar al ciclo. |

## Finanzas

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/cuentas-bancarias` | `banco.ver` | — |  |
| POST | `/api/cuentas-bancarias` | `banco.crear` | cuerpo: `cuentaBancariaEntrada` |  |
| PATCH | `/api/cuentas-bancarias/:id` | `banco.editar` | cuerpo: `cuentaBancariaEntrada` |  |
| GET | `/api/cuentas-bancarias/:id/movimientos` | `banco.ver` | filtros: en el controlador | Extracto: movimientos del período con saldo corrido. |
| POST | `/api/cuentas-bancarias/:id/movimientos` | `banco.crear` | cuerpo: `movimientoBancarioEntrada` | Movimiento manual: depósito, extracción, gasto bancario (comisiones, impuestos) o ingreso (intereses). |
| POST | `/api/cuentas-bancarias/:id/transferencia` | `banco.crear` | cuerpo: `transferenciaBancariaEntrada` |  |
| POST | `/api/cuentas-bancarias/:id/deposito-caja` | `banco.crear` | cuerpo: `depositoCajaEntrada` | Depósito del efectivo de una caja abierta (propia) en la cuenta: sale de la caja y entra al banco. |
| POST | `/api/movimientos-bancarios/conciliar` | `banco.editar` | cuerpo: en el controlador | Marca o desmarca movimientos como conciliados con el extracto del banco. |
| GET | `/api/cuentas-cobrar` | `cuenta_cobrar.ver` | filtros: en el controlador |  |
| GET | `/api/cuentas-cobrar/resumen` | `cuenta_cobrar.ver` | — |  |
| GET | `/api/cuentas-cobrar/cliente/:id` | `cuenta_cobrar.ver` | — | Estado de cuenta del cliente: crédito, deuda, cuentas y movimientos (ventas a crédito, cobros, devoluciones). |
| GET | `/api/cobros` | `cuenta_cobrar.ver` | filtros: en el controlador |  |
| POST | `/api/cobros` | `cuenta_cobrar.crear` | cuerpo: `cobroEntrada` | Cobro de una o varias cuentas del cliente. En caja: el dinero entra a la sesión abierta del cajero. |
| POST | `/api/cobros/:id/anular` | `cuenta_cobrar.cancelar` | cuerpo: en el controlador | Anula un cobro: devuelve la deuda a las cuentas y, si entró a una caja todavía abierta, saca el dinero. |
| GET | `/api/finanzas/flujo` | `flujo_caja.ver` | filtros: en el controlador |  |

## Informes

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/tablero` | sesion | filtros: en el controlador | Tablero del dueño: cada bloque aparece solo si el usuario tiene el permiso correspondiente. Con alcance de sucursal, solo sus sucursales. |
| GET | `/api/informes/ventas` | `informe_ventas.ver` | filtros: en el controlador | Ventas agrupadas. Costo y margen solo con informe_ganancias.ver. |
| GET | `/api/informes/stock` | `stock.ver` | filtros: en el controlador | Existencias por depósito, con valor al costo (si lo puede ver) y alerta de stock mínimo. |
| GET | `/api/informes/compras` | `recepcion.ver` | filtros: en el controlador | Compras agrupadas por proveedor, producto o mes (confirmadas). |
| GET | `/api/recetas` | `receta.ver` | filtros: en el controlador |  |

## Personal (RRHH)

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/rrhh/novedades` | `asistencia.ver` | filtros: en el controlador | Planilla de asistencia de un rango (hasta 62 días): funcionarios vigentes, novedades y vacaciones gozadas. |
| POST | `/api/rrhh/novedades` | `asistencia.editar` | cuerpo: `novedadEntrada` | Registra la novedad de un día o de cada día de un rango (por ejemplo, un reposo). |
| POST | `/api/rrhh/novedades/lote` | `asistencia.editar` | cuerpo: en el controlador | Registra varias novedades (las propuestas por el reloj); las que no se pueden registrar se informan. |
| DELETE | `/api/rrhh/novedades/:id` | `asistencia.editar` | — |  |
| GET | `/api/rrhh/vacaciones/resumen` | `asistencia.ver` | — | Saldo de cada funcionario vigente. |
| GET | `/api/rrhh/vacaciones` | `asistencia.ver` | filtros: en el controlador |  |
| POST | `/api/rrhh/vacaciones/goce` | `asistencia.editar` | cuerpo: `vacacionGoceEntrada` | Goce de vacaciones: días hábiles tomados, dentro del saldo. |
| POST | `/api/rrhh/vacaciones/ajuste` | `asistencia.editar` | cuerpo: `vacacionAjusteEntrada` | Ajuste del saldo: saldo inicial al empezar a usar el sistema, días ya gozados antes, períodos acordados. |
| POST | `/api/rrhh/vacaciones/:id/anular` | `asistencia.editar` | cuerpo: en el controlador |  |
| POST | `/api/rrhh/marcaciones/importar` | `asistencia.editar` | cuerpo: en el controlador | Importa el archivo del reloj. Cada línea se asigna al funcionario cuyo código del reloj (o cédula) aparece antes de la fecha; las marcaciones repetidas se ignoran, así el mismo archivo se puede importar de nuevo. |
| POST | `/api/rrhh/marcaciones` | `asistencia.editar` | cuerpo: `marcacionManualEntrada` | Marcación cargada a mano (olvido del funcionario, reloj fuera de servicio). |
| DELETE | `/api/rrhh/marcaciones/:id` | `asistencia.editar` | — |  |
| GET | `/api/rrhh/marcaciones/propuestas` | `asistencia.ver` | filtros: en el controlador | Compara las marcaciones con el horario de cada funcionario y propone novedades: ausencia si un día laborable no tiene marcaciones, llegada tardía pasados 10 minutos de tolerancia, y horas extra por cada media hora cumplida después de la salida (al 100 % los domingos). No registra nada: la empresa revisa y confirma, porque el reloj no sabe de feriados ni de permisos. |
| GET | `/api/funcionarios` | `funcionario.ver` | filtros: en el controlador |  |
| GET | `/api/funcionarios/:id` | `funcionario.ver` | — |  |
| POST | `/api/funcionarios` | `funcionario.crear` | cuerpo: `funcionarioEntrada` |  |
| PATCH | `/api/funcionarios/:id` | `funcionario.editar` | cuerpo: `funcionarioEntrada` |  |
| POST | `/api/funcionarios/:id/baja` | `funcionario.editar` | cuerpo: `bajaFuncionarioEntrada` | Baja: el legajo no se borra; queda con fecha y motivo de egreso. |
| POST | `/api/funcionarios/:id/reingreso` | `funcionario.editar` | cuerpo: en el controlador |  |
| GET | `/api/rrhh/configuracion` | `salario.ver` | — |  |
| PUT | `/api/rrhh/configuracion` | `salario.editar` | cuerpo: `rrhhConfiguracionEntrada` |  |
| GET | `/api/liquidaciones` | `salario.ver` | — |  |
| GET | `/api/liquidaciones/:id` | `salario.ver` | — |  |
| POST | `/api/liquidaciones` | `salario.editar` | cuerpo: `liquidacionNuevaEntrada` | Genera la planilla en borrador con los funcionarios del período. |
| POST | `/api/liquidaciones/:id/novedades` | `salario.editar` | — | Vuelve a tomar los días y las horas extra de las novedades de asistencia (planilla mensual en borrador). |
| POST | `/api/liquidaciones/final` | `salario.editar` | cuerpo: `liquidacionFinalEntrada` | Liquidación final (finiquito) de un funcionario. Queda en borrador con los valores calculados; al confirmarla, el legajo queda con su fecha y motivo de egreso. |
| PATCH | `/api/liquidaciones/:id/final` | `salario.editar` | cuerpo: `opcionesFiniquitoEntrada…` | Ajusta las opciones de una liquidación final en borrador (días, preaviso dado, vacaciones, IPS, otros ingresos, descuentos). |
| PATCH | `/api/liquidaciones/:id/items` | `salario.editar` | cuerpo: `liquidacionItemEntrada…` | Ajusta la línea de un funcionario en una planilla en borrador (días, horas extra, otros ingresos, descuentos). |
| POST | `/api/liquidaciones/:id/quitar` | `salario.editar` | cuerpo: en el controlador |  |
| POST | `/api/liquidaciones/:id/confirmar` | `salario.editar` | — |  |
| POST | `/api/liquidaciones/:id/pagar` | `salario.editar` | cuerpo: `pagoLiquidacionEntrada` | Pago del neto: transferencia desde una cuenta bancaria o efectivo de la caja abierta del usuario. |
| POST | `/api/liquidaciones/:id/anular` | `salario.editar` | cuerpo: en el controlador | Un borrador se descarta; una planilla confirmada y sin pagar se anula (su asiento se revierte). |

## Producción

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/produccion/recetas` | `produccion.ver` | filtros: en el controlador |  |
| GET | `/api/produccion/recetas/:id` | `produccion.ver` | filtros: en el controlador |  |
| POST | `/api/produccion/recetas` | `produccion.editar` | cuerpo: `recetaProduccionEntrada` |  |
| PUT | `/api/produccion/recetas/:id` | `produccion.editar` | cuerpo: `recetaProduccionEntrada` |  |
| GET | `/api/produccion/ordenes` | `produccion.ver` | filtros: en el controlador |  |
| GET | `/api/produccion/ordenes/:id` | `produccion.ver` | — |  |
| POST | `/api/produccion/ordenes` | `produccion.crear` | cuerpo: `ordenProduccionEntrada` | Planifica una orden: los insumos teóricos salen de la receta en proporción a la cantidad. |
| POST | `/api/produccion/ordenes/:id/terminar` | `produccion.crear` | cuerpo: `terminarProduccionEntrada` | Termina la orden: descuenta los insumos realmente usados, ingresa lo producido al costo real (insumos / unidades producidas) y actualiza el costo promedio del producto. |
| POST | `/api/produccion/ordenes/:id/anular` | `produccion.cancelar` | cuerpo: en el controlador | Anula una orden planificada o, si está terminada, revierte el stock (los insumos vuelven a sus lotes). |
| GET | `/api/produccion/necesidades` | `produccion.ver` | filtros: en el controlador | Qué producir para los pedidos (encargos) pendientes con entrega en el rango: lo pedido de cada producto con receta, menos el stock de la sucursal y lo ya planificado; y los insumos que hacen falta para eso. |
| POST | `/api/produccion/ordenes/lote` | `produccion.crear` | cuerpo: en el controlador | Crea de una vez las órdenes sugeridas para los pedidos. |
| POST | `/api/produccion/mermas` | `produccion.crear` | cuerpo: `mermaEntrada` | Mermas: producto vencido, roto o que no se vendió en el día; sale del stock con su costo. |
| GET | `/api/produccion/mermas` | `produccion.ver` | filtros: en el controlador |  |

## Restaurante

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/restaurante/plano` | `salon.ver` | filtros: en el controlador | Plano de la sucursal: salones con sus mesas y la cuenta abierta de cada una; cuentas de mostrador. |
| GET | `/api/restaurante/carta` | `salon.ver` | filtros: en el controlador | Carta: productos activos con el precio de la sucursal, por categoría (sin los de venta bajo receta). |
| POST | `/api/restaurante/salones` | `salon.editar` | cuerpo: `salonEntrada` |  |
| PATCH | `/api/restaurante/salones/:id` | `salon.editar` | cuerpo: en el controlador |  |
| POST | `/api/restaurante/mesas` | `salon.editar` | cuerpo: `mesaEntrada` |  |
| PATCH | `/api/restaurante/mesas/:id` | `salon.editar` | cuerpo: `mesaEntrada…` |  |
| GET | `/api/restaurante/cuentas` | `salon.ver` | filtros: en el controlador | Cuentas abiertas de una sucursal (el PDV las lista para cobrar). |
| GET | `/api/restaurante/cuentas/:id` | `salon.ver` | — |  |
| POST | `/api/restaurante/cuentas` | `salon.crear` | cuerpo: `cuentaAbrirEntrada` | Abre la cuenta de una mesa libre o una de mostrador (para llevar). |
| PATCH | `/api/restaurante/cuentas/:id` | `salon.crear` | cuerpo: en el controlador |  |
| POST | `/api/restaurante/cuentas/:id/items` | `salon.crear` | cuerpo: `cuentaItemsEntrada` | Agrega productos a la cuenta, con el precio vigente de la sucursal. Quedan por enviar a cocina. |
| DELETE | `/api/restaurante/cuentas/:id/items/:item` | `salon.crear` | — | Quita un ítem todavía no enviado a cocina. |
| POST | `/api/restaurante/cuentas/:id/items/:item/anular` | `salon.cancelar` | cuerpo: en el controlador | Anula un ítem ya enviado (devuelto, error de carga): requiere permiso y motivo. |
| POST | `/api/restaurante/cuentas/:id/items/:item/dividir` | `salon.crear` | cuerpo: en el controlador | Separa parte de un ítem (por ejemplo, 1 de 3 cervezas) para cobrarla aparte. |
| POST | `/api/restaurante/cuentas/:id/enviar` | `salon.crear` | — | Envía a cocina y bar lo pendiente, como una comanda. Lo que no tiene estación queda listo para servir. |
| POST | `/api/restaurante/cuentas/:id/servido` | `salon.crear` | cuerpo: en el controlador | El mozo sirvió lo que estaba listo. |
| POST | `/api/restaurante/cuentas/:id/mover` | `salon.crear` | cuerpo: en el controlador | Pasa la cuenta a otra mesa libre de la misma sucursal. |
| POST | `/api/restaurante/cuentas/:id/anular` | `salon.crear` | cuerpo: en el controlador | Cierra sin cobrar: una cuenta vacía (la mesa se libera) o, con permiso de anulación y motivo, una con productos enviados. Lo ya cobrado no se toca: si hay cobros, se anulan las ventas. |
| GET | `/api/cocina` | `cocina.ver` | filtros: en el controlador | Comandas de una estación: lo pendiente y en preparación, y lo listo de los últimos 15 minutos. |
| POST | `/api/cocina/items` | `cocina.editar` | cuerpo: en el controlador | Cambia el estado de ítems de la estación: en preparación, listo, o vuelve a pendiente. |

## Usuarios y perfiles

| Método | Ruta | Acceso | Cuerpo / filtros | Descripción |
|---|---|---|---|---|
| GET | `/api/perfiles` | `perfil.ver` | — |  |
| GET | `/api/perfiles/:id` | `perfil.ver` | — |  |
| POST | `/api/perfiles` | `perfil.crear` | cuerpo: `perfilCrear` |  |
| PATCH | `/api/perfiles/:id` | `perfil.editar` | cuerpo: `perfilEditar` |  |
| DELETE | `/api/perfiles/:id` | `perfil.eliminar` | — |  |
| GET | `/api/usuarios` | `usuario.ver` | — |  |
| GET | `/api/usuarios/:id` | `usuario.ver` | — |  |
| POST | `/api/usuarios` | `usuario.crear` | cuerpo: `usuarioCrear` |  |
| PATCH | `/api/usuarios/:id` | `usuario.editar` | cuerpo: `usuarioEditar` |  |
| DELETE | `/api/usuarios/:id` | `usuario.eliminar` | — | No se borran usuarios (firman operaciones): se desactivan y se cierran sus sesiones. |
| PUT | `/api/usuarios/:id/permisos` | `usuario.editar` | cuerpo: `usuarioPermisosEntrada` | Reemplaza las concesiones y restricciones individuales del usuario. |
| POST | `/api/usuarios/:id/invitacion` | `usuario.crear` | — | Reenvía la invitación a quien todavía no creó su contraseña. |

## Permisos

| Permiso | Nombre |
|---|---|
| `arqueo.crear` | arqueo.crear |
| `arqueo.ver` | arqueo.ver |
| `asistencia.editar` | asistencia.editar |
| `asistencia.ver` | asistencia.ver |
| `auditoria.ver` | auditoria.ver |
| `banco.crear` | banco.crear |
| `banco.editar` | banco.editar |
| `banco.ver` | banco.ver |
| `caja.crear` | caja.crear |
| `caja.editar` | caja.editar |
| `caja.ver` | caja.ver |
| `cliente.crear` | cliente.crear |
| `cliente.editar` | cliente.editar |
| `cliente.eliminar` | cliente.eliminar |
| `cliente.ver` | cliente.ver |
| `cocina.editar` | cocina.editar |
| `cocina.ver` | cocina.ver |
| `config_fiscal.editar` | config_fiscal.editar |
| `config_fiscal.ver` | config_fiscal.ver |
| `contabilidad.aprobar` | contabilidad.aprobar |
| `contabilidad.crear` | contabilidad.crear |
| `contabilidad.ver` | contabilidad.ver |
| `cuenta_cobrar.cancelar` | cuenta_cobrar.cancelar |
| `cuenta_cobrar.crear` | cuenta_cobrar.crear |
| `cuenta_cobrar.ver` | cuenta_cobrar.ver |
| `cuenta_pagar.aprobar` | cuenta_pagar.aprobar |
| `cuenta_pagar.cancelar` | cuenta_pagar.cancelar |
| `cuenta_pagar.crear` | cuenta_pagar.crear |
| `cuenta_pagar.ver` | cuenta_pagar.ver |
| `documento_fiscal.cancelar` | documento_fiscal.cancelar |
| `documento_fiscal.crear` | documento_fiscal.crear |
| `documento_fiscal.ver` | documento_fiscal.ver |
| `empresa.editar` | empresa.editar |
| `empresa.ver` | empresa.ver |
| `entrega.cancelar` | entrega.cancelar |
| `entrega.crear` | entrega.crear |
| `entrega.editar` | entrega.editar |
| `entrega.ver` | entrega.ver |
| `flujo_caja.ver` | flujo_caja.ver |
| `funcionario.crear` | funcionario.crear |
| `funcionario.editar` | funcionario.editar |
| `funcionario.ver` | funcionario.ver |
| `informe_ventas.ver` | informe_ventas.ver |
| `orden_compra.aprobar` | orden_compra.aprobar |
| `orden_compra.cancelar` | orden_compra.cancelar |
| `orden_compra.crear` | orden_compra.crear |
| `orden_compra.editar` | orden_compra.editar |
| `orden_compra.ver` | orden_compra.ver |
| `pedido.cancelar` | pedido.cancelar |
| `pedido.crear` | pedido.crear |
| `pedido.editar` | pedido.editar |
| `pedido.ver` | pedido.ver |
| `perfil.crear` | perfil.crear |
| `perfil.editar` | perfil.editar |
| `perfil.eliminar` | perfil.eliminar |
| `perfil.ver` | perfil.ver |
| `precio.editar` | precio.editar |
| `precio.ver` | precio.ver |
| `presupuesto.crear` | presupuesto.crear |
| `presupuesto.editar` | presupuesto.editar |
| `presupuesto.ver` | presupuesto.ver |
| `produccion.cancelar` | produccion.cancelar |
| `produccion.crear` | produccion.crear |
| `produccion.editar` | produccion.editar |
| `produccion.ver` | produccion.ver |
| `producto.crear` | producto.crear |
| `producto.editar` | producto.editar |
| `producto.eliminar` | producto.eliminar |
| `producto.ver` | producto.ver |
| `proveedor.crear` | proveedor.crear |
| `proveedor.editar` | proveedor.editar |
| `proveedor.eliminar` | proveedor.eliminar |
| `proveedor.ver` | proveedor.ver |
| `recepcion.cancelar` | recepcion.cancelar |
| `recepcion.crear` | recepcion.crear |
| `recepcion.ver` | recepcion.ver |
| `receta.ver` | receta.ver |
| `salario.editar` | salario.editar |
| `salario.ver` | salario.ver |
| `salon.cancelar` | salon.cancelar |
| `salon.crear` | salon.crear |
| `salon.editar` | salon.editar |
| `salon.ver` | salon.ver |
| `stock.editar` | stock.editar |
| `stock.ver` | stock.ver |
| `sucursal.crear` | sucursal.crear |
| `sucursal.editar` | sucursal.editar |
| `sucursal.eliminar` | sucursal.eliminar |
| `sucursal.ver` | sucursal.ver |
| `transferencia.aprobar` | transferencia.aprobar |
| `transferencia.cancelar` | transferencia.cancelar |
| `transferencia.crear` | transferencia.crear |
| `transferencia.ver` | transferencia.ver |
| `usuario.crear` | usuario.crear |
| `usuario.editar` | usuario.editar |
| `usuario.eliminar` | usuario.eliminar |
| `usuario.ver` | usuario.ver |
| `venta.crear` | venta.crear |
| `venta.ver` | venta.ver |

---
KONTIVA ERP · Desarrollado por Araújo Tech Sistemas
