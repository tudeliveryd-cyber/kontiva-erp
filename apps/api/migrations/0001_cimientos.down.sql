-- Revierte 0001. Destruye todos los datos de Fase 0: solo para desarrollo.
DROP FUNCTION IF EXISTS auth_estado_sesion(uuid);
DROP FUNCTION IF EXISTS auth_membresias(uuid);
DROP TABLE IF EXISTS auditoria;
DROP FUNCTION IF EXISTS auditoria_inmutable();
DROP TABLE IF EXISTS intento_acceso, token_cuenta, sesion, usuario_sucursal, usuario_permiso, usuario,
  perfil_permiso, perfil, cuenta, sucursal, empresa, permiso, plan;
DROP FUNCTION IF EXISTS tocar_actualizado_en();
DROP FUNCTION IF EXISTS uuid_v7();
DROP FUNCTION IF EXISTS app_empresa_id();
