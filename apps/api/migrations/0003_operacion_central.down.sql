-- Revierte 0003 (solo desarrollo: borra catálogo, stock, cajas y ventas).
DROP TABLE IF EXISTS venta_pago, venta_item, venta, arqueo, movimiento_caja, sesion_caja, caja, cotizacion,
  cliente, movimiento_stock, stock, deposito, precio, lista_precio, codigo_barras, variante, producto, marca, categoria;
