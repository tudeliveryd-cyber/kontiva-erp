CREATE OR REPLACE FUNCTION fe_empresas_con_cola() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT empresa_id FROM documento_electronico
    WHERE estado IN ('pendiente', 'enviado') AND proximo_intento <= now()
$$;
DROP FUNCTION IF EXISTS fe_correo_receptor(documento_electronico);
ALTER TABLE documento_electronico DROP COLUMN IF EXISTS correo_enviado_a, DROP COLUMN IF EXISTS correo_enviado_en, DROP COLUMN IF EXISTS correo_intentos, DROP COLUMN IF EXISTS correo_error;
ALTER TABLE fe_configuracion DROP COLUMN IF EXISTS envio_correo;
