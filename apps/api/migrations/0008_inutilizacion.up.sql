-- Números de documentos rechazados que no se reutilizan: se inutilizan ante SIFEN (evento).
ALTER TABLE documento_electronico DROP CONSTRAINT documento_electronico_estado_check;
ALTER TABLE documento_electronico ADD CONSTRAINT documento_electronico_estado_check
  CHECK (estado IN ('pendiente', 'enviado', 'aprobado', 'aprobado_obs', 'rechazado', 'cancelado', 'inutilizado'));
