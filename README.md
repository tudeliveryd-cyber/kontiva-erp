# KONTIVA ERP

**Gestión inteligente para tu empresa.**

Sistema integral de gestión empresarial multiempresa y multisectorial.
Producto comercial de **Araújo Tech Sistemas**.

> Repositorio privado. Código propietario. Todos los derechos reservados.

## Estado

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 | Cimientos: autenticación, multiempresa con RLS, permisos, auditoría, Panel Master | Lista · ver pendientes menores abajo |
| 1 | Operación central: productos, inventario, PDV, caja | Circuito central listo · ver pendientes abajo |
| 2 | Compras y finanzas | Lista |
| 3 | Facturación electrónica SIFEN | Factura y nota de crédito listas (ambiente de prueba) · ver abajo |
| 4 | RRHH, informes, dashboard, app del dueño | Lista |
| 5 | Verticales por rubro e integraciones | Lista · lotes y vencimientos, farmacia, restaurante, panadería y producción, tienda de ropa, distribuidora y ferretería |
| Cierre | Exportación de datos, documentación de la API, pruebas de pantallas y de carga | Lista |

### Fase 0 · hecho
- **Autenticación**: Argon2id, bloqueo progresivo tras 5 intentos, token de acceso de 15 min + renovación rotativa
  en cookie httpOnly con detección de reutilización, sesiones activas con cierre remoto inmediato,
  recuperación por enlace de un solo uso (30 min), invitaciones (7 días), una cuenta en varias empresas.
- **Multiempresa**: Row-Level Security forzado en PostgreSQL, rol de la API sin `BYPASSRLS`,
  empresa activa por `SET LOCAL`, claves foráneas compuestas.
- **Permisos**: recurso + acción + alcance (propia / sucursal / empresa), 11 perfiles de plantilla,
  concesiones y denegaciones individuales, bloqueo de escalada, recursos confidenciales separados,
  autorización en el momento con PIN de supervisor.
- **Auditoría**: solo inserción (trigger a nivel de sentencia, también contra el dueño del esquema),
  antes / después, IP y dispositivo, consulta con filtros.
- **Planes**: límites de usuarios y sucursales aplicados en el backend.
- **Web**: acceso, configuración inicial, usuarios, perfiles (matriz de permisos), sucursales, empresa,
  auditoría, mi cuenta (contraseña, PIN, sesiones, cambio de empresa).
- **Segundo factor (TOTP)**: opcional para todos, obligatorio para el Propietario en los planes que lo
  exigen (ENTERPRISE) y siempre en el Panel Master. Secreto cifrado con AES-256-GCM (clave fuera de la base),
  códigos no reutilizables, 10 códigos de respaldo de un solo uso.
- **Panel Master** (servicio separado, rol de base `kontiva_master`, secreto JWT propio): alta de empresas,
  planes y precios, cambio de plan, suscripciones con vencimiento y días de gracia, registro y anulación
  de pagos, suspensión automática por falta de pago y reactivación al pagar, auditoría propia.
  No lee datos de negocio: solo conteos y estado.
- **Producción**: imagen Docker única, `deploy/docker-compose.yml` con PostgreSQL, HTTPS automático (Caddy)
  y respaldo diario. Guía: [deploy/INSTALACION.md](deploy/INSTALACION.md).
- **Pruebas**: 145 pruebas contra PostgreSQL real, incluida una suite generada desde los decoradores
  que verifica 401 / 403 / 404 (otra empresa) en cada endpoint. El CI además construye la imagen y la arranca.

### Fase 0 · pendiente menor
- Monitoreo y alertas externas (depende del proveedor de hosting elegido).

### Fase 1 · hecho (circuito central)
- **Catálogo**: productos y servicios con variantes (talle, color, presentación), varios códigos de barras,
  SKU, categorías, IVA 10 % / 5 % / exento, unidad de venta (unidad, kg, metro…), costo confidencial.
- **Stock**: depósito por sucursal, saldo materializado + movimientos (fuente de verdad, solo inserción),
  carga de stock inicial y ajustes por conteo con motivo, historial por producto, opción de vender sin stock.
- **Cajas multimoneda**: cotización del día por sucursal (compra / venta), apertura con fondo en guaraníes,
  dólares y reales, retiros e ingresos con autorización, cierre con arqueo por moneda y medio, diferencias registradas.
- **PDV**: pantalla completa operada con teclado y lector (F2 cobrar, F4 cliente, F8 descuento), cobro mixto en
  varias monedas y medios, vuelto en otra moneda, descuentos con PIN de supervisor, comprobante interno de 80 mm
  ("no válido como factura"), venta atómica con idempotencia, bloqueo de stock y numeración por caja.
- **Ventas**: listado del día, reimpresión, anulación con PIN (devuelve stock y dinero en la misma sesión).
- **Clientes**: alta rápida desde el PDV, RUC o cédula.
- **Importación desde Excel / CSV**: productos (con stock inicial o conteo) y clientes; modelo descargable,
  vista previa con errores por fila, todo o nada, actualización por código / SKU / nombre.
- **Transferencias entre depósitos**: envío en tránsito o directo, recepción solo en la sucursal de destino
  con registro de faltantes, cancelación que devuelve el stock al origen.
- **Devoluciones de ventas**: parciales o totales, también de ventas de cajas ya cerradas; reintegro
  proporcional al precio cobrado, en efectivo desde la caja abierta del cajero o por otro medio,
  con PIN de supervisor si el usuario no tiene el permiso; el stock vuelve al depósito de la caja.
- **Listas de precios**: listas adicionales (mayorista, revendedor…) asignadas a clientes, precio por sucursal,
  carga por porcentaje sobre el precio normal con redondeo; el PDV cobra la lista del cliente elegido
  y el servidor recalcula siempre el precio (si un producto no está en la lista, rige el normal).
- **Presupuestos y pedidos**: presupuesto con la lista de precios del cliente (o a alguien no registrado),
  validez, impresión A4 / PDF y envío por WhatsApp; al aceptarlo se genera el pedido con los precios
  cotizados. El pedido se marca preparado y se cobra en el PDV (F6): rigen sus precios y descuentos
  sin volver a pedir PIN, y queda entregado; si se anula la venta vuelve a pendiente.
- **Pruebas**: 382 en total (364 de API, 18 compartidas); incluye 20 cajas vendiendo el mismo producto
  a la vez con stock final exacto.

- **PDV sin conexión**: la caja guarda su catálogo (códigos de barras, precios de la sucursal, stock) y lo
  renueva cada 10 minutos. Si se corta internet (o el servidor no responde en 8 segundos) la venta al contado
  se guarda en el equipo con un comprobante provisorio (S/C-n) y se envía sola al volver la conexión, con la
  misma clave de idempotencia (sin duplicados). El servidor la registra con su momento real, la valida contra la
  sesión de caja (últimas 72 horas), respeta el precio cobrado solo si el precio cambió después de la venta y
  no la rechaza por stock (la mercadería ya salió). La caja no se cierra con ventas sin sincronizar; las
  rechazadas quedan a la vista para reintentar. Sin conexión no hay crédito, pedidos ni descuentos con PIN.
  Decisión: la numeración definitiva la asigna el servidor al sincronizar (no se reservan números en el
  equipo), y la cola no se cifra: no guarda credenciales y una clave en el mismo equipo no protegería.

- **Agente local del PDV** (`apps/agente`): imprime el ticket o KuDE en la impresora térmica con ESC/POS
  (red, USB compartida en Windows, CUPS o dispositivo), con tildes, QR nativo, corte de papel, y abre el cajón
  en las ventas con efectivo. Clave por equipo, solo 127.0.0.1, verificación de origen y de red privada de
  Chrome. Se configura en el PDV (botón Impresora); sin agente se usa la impresión del navegador.
  Se distribuye como un único `kontiva-agente.exe` (no requiere Node en la caja): `pnpm --filter
  @kontiva/agente empaquetar`; la CI lo genera en Windows y lo publica como artefacto con el instalador.

- **Balanza etiquetadora**: el PDV reconoce las etiquetas EAN-13 que comienzan con 2 (prefijo, PLU de 4 a 6
  dígitos, peso o importe, dígito verificador) y carga el producto con su cantidad, con y sin conexión.
  Se configura en Empresa, con prueba de lectura. El PLU se carga como código de barras del artículo.

### Fase 1 · pendiente
- Balanza conectada por puerto serie (las etiquetadoras ya funcionan sin el agente).

### Fase 2 · hecho (compras y cuentas a pagar)
- **Proveedores** con RUC, contacto y plazo de pago; saldo a pagar por proveedor.
- **Órdenes de compra**: borrador, aprobación y envío (orden_compra.aprobar), impresión A4, recepción parcial
  o total, cancelación.
- **Compras**: carga de la factura del proveedor (preimpresa con timbrado, electrónica con CDC, remisión),
  la misma factura no entra dos veces; el stock ingresa al depósito, el costo pasa a ser el promedio
  ponderado y se genera la cuenta a pagar (vencimiento por el plazo del proveedor). Al contado, el pago se
  registra en el acto, también en efectivo desde la caja abierta. Anulación que revierte stock y orden.
- **Cuentas a pagar**: resumen (a pagar, vencido, próximos 7 días), cuentas manuales (fletes, alquiler),
  pagos parciales o de varias cuentas a la vez, en efectivo desde la caja o por otro medio, y anulación
  de pagos con reintegro a la caja si sigue abierta.

- **Ventas a crédito**: límite y plazo por cliente (credito_cliente.editar); en el PDV, todo o parte de la venta
  a la cuenta del cliente, sin pasar por la caja; superar el límite pide el PIN de un supervisor
  (credito_cliente.aprobar). Con factura electrónica: condición crédito a plazo con la entrega inicial.
- **Cuentas a cobrar**: resumen, atraso en días, estado de cuenta con saldo corrido, recordatorio por
  WhatsApp, cobros de una o varias cuentas (en efectivo entra a la caja y aparece en el arqueo), anulación
  de cobros. Una devolución de una venta a crédito descuenta primero de la deuda; anular una venta a crédito
  anula su cuenta si no tiene cobros.
- **Bancos**: cuentas con saldo inicial, extracto con saldo corrido, depósitos, extracciones, gastos e ingresos
  bancarios, transferencias entre cuentas y depósito del efectivo de la caja (sale de la caja, entra al banco).
  Pagos a proveedores y cobros por transferencia o cheque pueden registrarse en una cuenta; al anularlos se
  genera el movimiento inverso (nada se borra). Conciliación marcando los movimientos del extracto.
- **Flujo de caja** (flujo_caja.ver, confidencial): entradas y salidas reales del período por día y por
  concepto, exportación CSV, y proyección desde el saldo en bancos con lo que vence a cobrar y a pagar.

- **Contabilidad**: plan de cuentas sugerido para un comercio en Paraguay (ampliable: grupos y cuentas
  imputables), configuración de qué cuenta usa cada operación (también una cuenta propia por banco) y
  contabilización automática e idempotente de ventas (con IVA y costo de lo vendido sin IVA), devoluciones,
  compras, cuentas a pagar sin compra, pagos, cobros y movimientos bancarios; las anulaciones generan el
  asiento inverso. Los asientos se numeran en orden de fecha y la base de datos exige debe = haber.
  Asientos manuales (se anulan con el inverso), libro diario, libro mayor (también de un grupo), sumas y
  saldos, balance general y estado de resultados, con exportación CSV. Cierre de períodos: contabiliza lo
  pendiente y bloquea fechas cerradas; un documento atrasado pasa al primer día abierto. Reapertura con motivo.
  No se contabilizan solos (van por asiento manual): el stock inicial, los ajustes de stock, los ingresos y
  retiros manuales de caja y las diferencias de arqueo.

Fase 2 completa.

### Fase 3 · hecho (factura electrónica)
- **Configuración fiscal**: ambiente (prueba / producción), timbrado, actividad económica, CSC y certificado
  digital .p12 (validado contra el RUC de la empresa; certificado, contraseña y CSC cifrados con CIFRADO_CLAVE).
  Dirección fiscal de cada sucursal con la codificación de la DNIT y punto de expedición por caja.
- **Emisión**: cada venta en una caja con punto de expedición genera, en la misma transacción, el DE del
  Manual Técnico v150 (XML con `facturacionelectronicapy-xmlgen`), con numeración correlativa por
  establecimiento + punto + timbrado, firma XMLDSig RSA-SHA256 y QR con hash del CSC. Receptor según el
  documento del cliente: RUC (B2B), cédula o innominado.
- **Envío**: emisor en segundo plano por lotes asíncronos de hasta 50 DE (TLS mutuo con el certificado),
  consulta de resultados, reintentos con espera creciente si SIFEN no responde; la red nunca se usa dentro de
  una transacción. Pantalla de documentos con estado, mensaje de la DNIT, XML y reenvío.
- **KuDE** en formato ticket de 80 mm con QR, CDC y leyendas.
- **Cancelación**: anular una venta con factura aprobada envía el evento de cancelación firmado (hasta 48 h).
- **Nota de crédito electrónica**: la devolución de una venta facturada emite la NC (motivo devolución)
  asociada al CDC de la factura, con los ítems y montos devueltos; KuDE de la NC en ticket.
- **Rechazos**: corregir y reenviar con el mismo número y CDC (como permite la DNIT) o inutilizar el número
  con el evento de inutilización.
- **Pruebas** contra un simulador de SIFEN que verifica la firma de cada documento.

- **KuDE en A4** (PDF) armado desde el XML firmado: emisor y timbrado, receptor, detalle por tasa de IVA,
  subtotales, liquidación del IVA, QR, CDC y leyendas de la DNIT; aviso de ambiente de prueba.
- **Envío por correo** del KuDE y el XML: manual desde el documento o la venta, y automático cuando SIFEN aprueba
  (opción de la configuración fiscal; hasta 3 intentos, con el error a la vista).

- **Consulta de RUC en la DNIT** al cargar clientes (servicio de SIFEN con el certificado de la empresa):
  completa la razón social y el dígito verificador, y muestra el estado y si es facturador electrónico.

### Fase 3 · pendiente
- Homologación con el ambiente de prueba real de la DNIT (requiere el certificado y el timbrado de la empresa).

### Fase 4 · hecho (RRHH y sueldos)
- **Funcionarios**: legajo (datos personales, cargo, sucursal, ingreso, remuneración mensual o por jornal,
  hijos para la bonificación familiar, IPS, cuenta para el sueldo), antigüedad y días de vacaciones por año
  (12, 18 o 30 según el Código del Trabajo), baja con motivo y reingreso. El salario solo lo ve y cambia
  quien tiene permiso de salarios (confidencial). Perfil nuevo: Recursos humanos.
- **Parámetros**: salario mínimo (Gs. 3.044.000 desde el 1/7/2026, Decreto 6225/2026), IPS 9 % obrero y
  16,5 % patronal, bonificación familiar (5 % del mínimo por hijo, hasta dos mínimos). Se pueden actualizar
  y cada planilla guarda los valores con que se generó.
- **Planilla mensual**: se genera con los funcionarios del mes (días proporcionales si entró o salió en el
  mes), horas extra al 50 % y al 100 %, comisiones y premios, bonificación familiar (fuera de la base del
  IPS), descuentos y adelantos; confirmación, pago del neto desde el banco o la caja, anulación si no está
  pagada. Recibos de salario para imprimir y archivos de la planilla y de los aportes al IPS.
- **Aguinaldo**: la doceava parte de lo cobrado en el año, sin IPS, ajustable antes de confirmar.
- **Contabilidad**: asiento de sueldos el último día del mes (sueldos, aporte patronal, IPS a pagar,
  anticipos y sueldos a pagar) y asiento del pago; los sueldos pagados entran al flujo de caja. Las
  empresas con el plan creado antes de RRHH agregan las cuentas que faltan con un botón.

### Fase 4 · hecho (tablero, informes y app del dueño)
- **Tablero** en la pantalla de inicio: ventas, tickets y ticket promedio con la variación contra el período
  anterior, margen bruto, efectivo en cajas abiertas, saldo en bancos, ventas por día u hora, productos más
  vendidos, medios de pago, sucursales, vendedores, cuentas a cobrar y a pagar, y alertas (stock bajo el
  mínimo, vencidos, anulaciones, devoluciones). Cada bloque depende de los permisos; con alcance de sucursal,
  solo sus sucursales. Se actualiza cada minuto.
- **Informes**: ventas agrupadas por día, mes, producto, categoría, marca, cliente, vendedor, sucursal o caja,
  con costo y margen para quien ve ganancias (permiso nuevo `informe_ventas`); stock por depósito con valor al
  costo y lo que está bajo el mínimo; compras por proveedor, producto o mes. Exportación CSV e impresión.
- **Stock mínimo** por variante en la ficha del producto.
- **App del dueño** (`/movil`): versión para el celular con lo esencial del negocio, instalable en la pantalla
  de inicio (manifiesto, íconos y service worker que nunca guarda datos de la API).

### Fase 4 · hecho (asistencia, vacaciones y liquidación final)
- **Asistencia**: planilla del mes por funcionario y día con ausencias, ausencias justificadas, reposo,
  permisos, llegadas tardías y horas extra (50 % o 100 %). Las ausencias, el reposo y las horas extra pasan
  solos a la planilla de sueldos (y se pueden volver a tomar en un borrador); un mes liquidado ya no se
  modifica. Permiso nuevo `asistencia` (perfiles Recursos humanos, Gerente y Supervisor).
- **Vacaciones**: saldo por año de servicio cumplido (12, 18 o 30 días hábiles, art. 218), goce con fechas
  dentro del saldo y sin superposición, ajustes para el saldo inicial, anulación con motivo.
- **Liquidación final** por renuncia, despido con o sin causa, mutuo acuerdo o fin de contrato: días
  trabajados no liquidados, aguinaldo proporcional, vacaciones causadas y proporcionales; en el despido sin
  causa, preaviso (30/45/60/90 días, art. 87, descontando el ya otorgado) e indemnización (15 días por año o
  fracción de seis meses, art. 91, doble con 10 años o más), sobre el promedio de los últimos seis meses.
  IPS por concepto (el criterio para vacaciones y preaviso es configurable en cada liquidación). Al confirmarla,
  el legajo queda con la fecha y el motivo de egreso; se paga, contabiliza y anula como las demás planillas, y
  el funcionario ya no entra en las planillas mensuales ni en el aguinaldo siguientes. Recibo para firmar.

- **Reloj de asistencia**: cada legajo tiene su horario (con salida distinta los sábados) y su código en el
  reloj. Se importa el `attlog.dat` de los relojes ZKTeco o la exportación CSV/TXT del programa del reloj
  (asignación por código o cédula; reimportar no duplica), y se pueden cargar o quitar marcaciones a mano.
  Al comparar con el horario se proponen ausencias, llegadas tardías (más de 10 minutos) y horas extra (por
  media hora, al 100 % en domingos); la empresa revisa y registra las que correspondan.

### Fase 5 · hecho (lotes y vencimientos)
- **Control por lote** opcional por producto. La compra pide el lote o el vencimiento de cada línea (sin código
  queda `VTO-AAAAMMDD`); el mismo lote no admite dos vencimientos.
- **FEFO**: la venta y la transferencia toman primero el lote que vence antes y nunca uno vencido (la venta se
  rechaza con `LOTE_VENCIDO` si solo queda vencido); la venta sin conexión ya hecha se registra igual.
- **Reversiones al mismo lote**: anulación de venta, devoluciones parciales sucesivas, recepción y cancelación de
  transferencias, anulación de compra (rechazada si el lote ya no tiene lo comprado).
- **Conteo por lote**, alta de lotes encontrados y baja de vencidos; lo que entra sin lote va a "S/L". Al activar el
  control en un producto con stock, el saldo existente pasa a "S/L" de cada depósito.
- **Vencimientos**: informe de lotes vencidos y por vencer con valor al costo, y alertas en el tablero.

### Fase 5 · hecho (farmacia)
- **Medicamentos**: principio activo, concentración, forma, registro sanitario (DNVS) y condición de venta: libre,
  bajo receta o bajo receta archivada (psicotrópicos y estupefacientes).
- **PDV**: busca también por principio activo; marca los productos bajo receta; antes de cobrar pide médico,
  registro profesional, paciente y fecha de la receta (con conexión o sin ella); la receta archivada exige la
  cédula del paciente y que la receta quede retenida. Equivalentes con el mismo principio activo y concentración
  (primero los que tienen stock), también desde el aviso de "sin stock".
- **Libro recetario** (permiso `receta`, en el menú de las empresas del rubro farmacia): ventas bajo receta con los
  datos de la receta, medicamentos y lotes; filtros por fecha, sucursal, paciente, médico y solo archivadas;
  CSV e impresión. El detalle de cada venta muestra la receta y los lotes vendidos.

### Fase 5 · hecho (restaurante)
- **Salón**: salones y mesas en un plano (cuadradas, redondas, rectangulares) que se arma tocando la grilla; cada
  mesa muestra su cuenta, comensales, tiempo y si tiene platos listos o sin enviar. Pedidos para llevar (mostrador).
- **Cuenta y comandas**: carta por categoría con el precio de la sucursal, aclaraciones por plato ("sin cebolla"),
  envío a cocina por comandas; lo que no tiene estación queda listo para servir. Quitar lo no enviado; anular lo
  enviado requiere permiso y motivo. Cambiar de mesa, cerrar una cuenta vacía, pre-cuenta para imprimir.
- **Cocina y bar** (estación del producto): comandas en orden de llegada con el tiempo (aviso a los 15 y 25 minutos),
  aclaraciones resaltadas, preparando / listo por plato o "todo listo", aviso sonoro de comanda nueva.
- **Cobro en el PDV** ("Cobrar mesa", F7): la cuenta entera o los ítems elegidos (cuenta dividida, con factura para
  cada uno; separar una unidad de un ítem), con los precios con que se cargó. La propina entra a la caja aparte de
  la venta. La cuenta se cierra sola al cobrar todo; anular una de esas ventas la reabre.
- Permisos `salon` y `cocina`; perfiles Mozo y Cocina. En el menú de los rubros restaurante y panadería.

### Fase 5 · hecho (panadería y producción)
- **Recetas**: qué insumos lleva una tanda y cuánto rinde, con tiempo y procedimiento. Costo por tanda y por unidad
  con el costo actual de cada insumo, y margen contra el precio de la sucursal (solo con permiso de ver costos).
- **Órdenes de producción**: se planifican (insumos teóricos = receta × cantidad / rendimiento) y se terminan con lo
  realmente usado y producido. Al terminar se descuentan los insumos (por lote, primero lo que vence antes), entra
  lo producido al costo real y se actualiza el costo promedio; con control de lote se crea el lote `OP-N.º` o el
  indicado. Hoja de producción para imprimir. Anular devuelve los insumos y saca lo producido.
- **Para pedidos**: de los pedidos pendientes con fecha de entrega, cuánto producir de cada producto con receta
  (pedido − stock − ya planificado) y qué insumos faltan; las órdenes se planifican con un clic.
- **Mermas**: sobrante del día, vencido o roto sale del stock con su valor al costo y queda el listado del período.
- Permiso `produccion`; perfil Producción. En el menú de los rubros panadería, restaurante y supermercado.

### Fase 5 · hecho (tienda de ropa)
- **Grade talle × color**: en la ficha del producto se elige la curva (letras, internacional, números, calzado,
  infantil) o se escriben talles, y los colores; se arman todas las variantes con SKU sugerido, precio y costo.
  Las celdas existentes se conservan; las que se quitan dejan de venderse sin perder su historia.
- **Stock en grade**: colores × talles con totales, por depósito o la suma de todos.
- **Caja**: buscar "remera" muestra el producto una vez y abre la grade con el stock de cada talle y color;
  el código de barras de la etiqueta agrega la celda directo.
- **Cambio sin devolver dinero** ("Cambio de mercadería", F9): se busca la venta por su número, se elige lo que
  devuelve el cliente y queda un **vale de cambio** (no sale dinero de la caja; con factura se emite la nota de
  crédito). El vale se usa en esa misma venta o se imprime con su código para otra compra; también se emite
  desde la devolución en Ventas.
- **Vales**: se pagan en el cobro con el código (sin vuelto; lo que sobra queda en el vale), anular la venta
  repone el saldo, vencen a los días que defina la empresa. Listado con saldo vigente y el historial de cada uno.
  En la factura electrónica el pago figura como vale; en contabilidad es un pasivo ("Vales de cambio a canjear").

### Fase 5 · hecho (distribuidora y ferretería)
- **Rutas**: zonas de reparto con días de visita y sus clientes en el orden de visita (un cliente, una ruta).
- **Repartos**: se arman con los pedidos pendientes de clientes registrados (por fecha de entrega y ruta, en el
  orden de visita), con repartidor, vehículo y la caja que factura. Hoja de ruta y hoja de carga (productos
  sumados) para imprimir. Un pedido no puede estar en dos repartos abiertos.
- **Despacho**: cada pedido se factura a la cuenta del cliente (la factura viaja con la mercadería; contra
  entrega si el cliente no tiene crédito, a su plazo si lo tiene) y la mercadería sale del depósito de la caja.
  Si un pedido falla, los demás quedan facturados y se reintenta.
- **Rendición**: por pedido, entregado, parcial (lo que volvió entra al stock con nota de crédito) o no
  entregado (vuelve todo; el pedido se reprograma o se cancela). Lo cobrado (efectivo, transferencia, cheque)
  entra a la caja como cobro de la cuenta; lo no cobrado queda en la cuenta corriente. Se registra el efectivo
  que entrega el repartidor y la diferencia. Cada pedido se registra una sola vez: un error se corrige y se reenvía.
- **Presentaciones** (ferretería, mayorista): caja x 100, rollo de 50 m, pack x 6, con precio y código de barras
  propios. Se venden en la caja (el código de la caja agrega la presentación; se cambia en la línea) y se
  compran por presentación; el stock y el costo siguen en la unidad. Sin precio propio: factor × precio unitario.
- Permiso `entrega` (rutas, repartos y rendición). Menú Repartos en los rubros distribuidora y general.

### Cierre · hecho
- **Exportación de datos** (Empresa → "Descargar todos los datos", solo el propietario): ZIP con un CSV por tabla
  (UTF-8 con BOM para Excel), `manifiesto.json` y `LEEME.txt`. Lee con el aislamiento por empresa activo; no
  incluye contraseñas, PIN, segundos factores, certificados ni claves (ni cifrados). Queda en la auditoría.
- **Documentación de la API**: [docs/api](docs/api/README.md) (guía por módulo con el permiso de cada ruta) y
  [openapi.json](docs/api/openapi.json) (OpenAPI 3.1, válido; se importa en Postman o Insomnia). Se genera del
  código con `pnpm docs:api` y la CI falla si no está al día.
- **Pruebas de pantallas** (`apps/e2e`, Chrome sin ventana): ingreso, todas las pantallas del menú (sin errores
  de la página ni del servidor, con el pie y sin emojis), una venta completa en la caja con vuelto, y cierre de sesión.
- **Prueba de carga** (`apps/e2e`): cada cajero vende sin pausa en su caja (mismos productos, compiten por el
  stock) mientras 20 usuarios consultan; al final verifica que el efectivo y el stock cierran exactos con las
  ventas confirmadas. Umbrales: 0 errores, p95 de consultas < 800 ms, p95 de ventas < 1500 ms.
  Resultado en un solo equipo (API, PostgreSQL y generador de carga juntos), 60 s, 3 cajas + 20 usuarios:
  ~120 pedidos/s, 0 errores, p95 consultas 572 ms, p95 ventas 669 ms, integridad exacta.
- La carga encontró y se corrigió: el listado de productos hacía una consulta por producto (de 1.140 ms a
  143 ms de mediana; también el de transferencias); el límite por IP (300/min) era bajo para varias cajas detrás
  de una misma conexión (`LIMITE_POR_MINUTO`, 1.200 por omisión) y el pool de conexiones era fijo
  (`DB_CONEXIONES`, 20 por omisión).
- CI: además de tipos, pruebas de la API, build e imagen, un trabajo levanta API y web con datos de prueba
  (`cli usuario:crear`, solo fuera de producción) y corre pantallas y carga.

### Interfaz en portugués · hecho
- Cada usuario elige Español o Português en "Mi cuenta"; se guarda en la cuenta (`PUT /idioma`, auditado) y lo
  sigue en cualquier equipo y empresa. Las facturas, el KuDE, los tickets y vales se emiten siempre en español
  (valor fiscal en Paraguay); lo que la persona escribe (nombres, productos, notas) no se traduce.
- La pantalla se escribe en español y se traduce al dibujarse (`apps/web/src/i18n`): diccionario revisado
  `pt.ts` (unos 2.800 textos, incluidos los mensajes de error de la API) y frases con datos por patrón
  ("Venta N.º {0}" → "Venda N.º {0}"). No se traduce lo marcado `translate="no"`, `.ticket` ni `.doc-a4`.
- Textos nuevos: `node scripts/extraer-textos.mjs --faltantes` lista los que faltan en `pt.ts`; la CI falla si
  falta alguno. Terminología: caja → caixa, sucursal → filial, stock → estoque, cobro → recebimento,
  retiro/ingreso → sangria/suprimento, reparto → entrega, rendición → prestação de contas.

## Estructura

```
apps/api         API NestJS + Kysely + PostgreSQL (migrations/ = SQL versionado)
                 src/main.ts = ERP (puerto 3000) · src/main-master.ts = Panel Master (puerto 3001)
apps/web         Web React + Vite: index.html = ERP · master.html = Panel Master
deploy/          docker-compose de producción, Caddy (HTTPS), guía de instalación
packages/shared  Catálogo de permisos, perfiles de plantilla y esquemas Zod (API y web)
scripts/         Roles de base de datos
```

## Probar por enlace (GitHub Codespaces)

Abra https://codespaces.new/tudeliveryd-cyber/kontiva-erp?ref=fase-1-operacion y elija **Create codespace**.
En unos 5 minutos queda todo listo (PostgreSQL, migraciones, empresa de prueba y Panel Master) y se abre
el ERP en un enlace `https://<nombre>-5173.app.github.dev`. Los datos de acceso quedan en
`.devcontainer/ACCESO.txt`; las instrucciones, en `.devcontainer/PROBAR.md`.

## Desarrollo local

Requisitos: Node 22, pnpm 10, Docker (o PostgreSQL 16 local).

```bash
docker compose up -d                 # PostgreSQL 16 + Redis, crea roles y base
cp .env.example .env                 # y cambie JWT_SECRET
pnpm install
pnpm build
pnpm db:migrate
pnpm --filter @kontiva/api cli master:crear --email usted@correo.com --nombre "Su nombre"
pnpm dev:api                         # ERP: http://localhost:3000/api
pnpm --filter @kontiva/api exec node --watch dist/main-master.js   # Master: :3001
pnpm dev:web                         # ERP: http://localhost:5173 · Master: http://localhost:5173/master.html
# Alta de empresas desde el Panel Master, o por CLI:
pnpm --filter @kontiva/api cli empresa:crear --razon "Mi Empresa S.A." --plan BUSINESS --email dueno@correo.com --nombre "Nombre"
# Sin SMTP, los correos (invitaciones, recuperación) se escriben en el log.
```

Pruebas: `pnpm test` (recrea la base `kontiva_test` en cada ejecución).

Pantallas y carga, con la API y la web en marcha:

```bash
pnpm --filter @kontiva/api cli empresa:crear --razon "Pruebas" --plan BUSINESS --email dueno@prueba.test --nombre "Dueño" --contrasena "Dueno-2026!"
pnpm --filter @kontiva/api cli usuario:crear --empresa <id> --email cajero1@prueba.test --nombre "Cajero 1" --perfil cajero --contrasena "Cajero-2026!"
E2E_EMAIL=dueno@prueba.test E2E_CONTRASENA=Dueno-2026! CHROME_PATH=/usr/bin/google-chrome pnpm e2e:pantallas
LIMITE_POR_MINUTO=100000 pnpm dev:api   # la carga sale de una sola IP
E2E_EMAIL=... E2E_CONTRASENA=... E2E_CAJEROS=cajero1@prueba.test E2E_CONTRASENA_CAJEROS=Cajero-2026! pnpm e2e:carga
```

## Decisiones técnicas respecto del documento de arquitectura

- **Kysely + migraciones SQL en lugar de Prisma.** El aislamiento depende de RLS, políticas,
  claves compuestas y `SET LOCAL` por transacción: todo eso es SQL que Prisma no modela.
  Kysely da consultas tipadas con control explícito de la transacción, y las migraciones
  son archivos `.up.sql` / `.down.sql` con checksum.
- **El RUC no es único entre empresas**: una persona física puede tener dos negocios con el mismo
  RUC, y un índice global revelaría a una empresa que otra usa ese RUC.
- **Permisos sin caché**: se cargan de la base en cada petición (3 consultas por clave primaria),
  así un cambio rige de inmediato y no hay caché que invalidar entre instancias.

Desarrollado por Araújo Tech Sistemas.
