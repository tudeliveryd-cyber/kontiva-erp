-- Envío del documento electrónico (KuDE en PDF + XML) por correo al cliente.
ALTER TABLE fe_configuracion ADD COLUMN envio_correo boolean NOT NULL DEFAULT false;
ALTER TABLE documento_electronico
  ADD COLUMN correo_enviado_a text,
  ADD COLUMN correo_enviado_en timestamptz,
  ADD COLUMN correo_intentos integer NOT NULL DEFAULT 0,
  ADD COLUMN correo_error text;

-- Correo del receptor de un documento (cliente de la venta o de la venta devuelta).
CREATE FUNCTION fe_correo_receptor(d documento_electronico) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(trim(c.email), '') FROM cliente c
  WHERE c.id = (SELECT v.cliente_id FROM venta v WHERE v.id = coalesce(d.venta_id, (SELECT dv.venta_id FROM devolucion dv WHERE dv.id = d.devolucion_id)))
$$;

-- La cola incluye también las empresas con documentos aprobados cuyo correo automático falta enviar.
CREATE OR REPLACE FUNCTION fe_empresas_con_cola() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT DISTINCT empresa_id FROM documento_electronico
    WHERE estado IN ('pendiente', 'enviado') AND proximo_intento <= now()
    UNION
    SELECT DISTINCT d.empresa_id FROM documento_electronico d JOIN fe_configuracion f ON f.empresa_id = d.empresa_id AND f.envio_correo
    WHERE d.estado IN ('aprobado', 'aprobado_obs') AND d.correo_enviado_en IS NULL AND d.correo_intentos < 3
      AND d.procesado_en > now() - interval '7 days' AND fe_correo_receptor(d) IS NOT NULL
$$;
GRANT EXECUTE ON FUNCTION fe_correo_receptor(documento_electronico) TO kontiva_app;
