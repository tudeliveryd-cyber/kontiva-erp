DROP FUNCTION IF EXISTS fe_empresas_con_cola();
ALTER TABLE venta DROP CONSTRAINT venta_comprobante_check;
ALTER TABLE venta ADD CONSTRAINT venta_comprobante_check CHECK (comprobante IN ('interno'));
DROP TABLE IF EXISTS documento_electronico, fe_numeracion, fe_configuracion;
DROP INDEX IF EXISTS caja_punto_expedicion;
ALTER TABLE caja DROP COLUMN IF EXISTS punto_expedicion;
ALTER TABLE sucursal DROP COLUMN IF EXISTS fe_numero_casa, DROP COLUMN IF EXISTS fe_departamento,
  DROP COLUMN IF EXISTS fe_distrito, DROP COLUMN IF EXISTS fe_ciudad, DROP COLUMN IF EXISTS fe_email;
