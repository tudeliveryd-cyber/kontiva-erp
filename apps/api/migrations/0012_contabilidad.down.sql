DROP TABLE IF EXISTS asiento_linea, asiento, cierre_contable, cuenta_concepto;
ALTER TABLE cuenta_bancaria DROP COLUMN IF EXISTS cuenta_contable_id;
DROP TABLE IF EXISTS cuenta_contable;
DROP FUNCTION IF EXISTS asiento_periodo_abierto(), asiento_balanceado(), contabilidad_cerrado_hasta(uuid);
