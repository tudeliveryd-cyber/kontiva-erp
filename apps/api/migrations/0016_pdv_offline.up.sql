-- Ventas registradas en el PDV sin conexión y sincronizadas después: momento real de la venta.
ALTER TABLE venta ADD COLUMN registrada_offline_en timestamptz;
