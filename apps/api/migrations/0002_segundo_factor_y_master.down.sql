-- Revierte 0002 (solo desarrollo: borra el Panel Master y los segundos factores).
DROP SCHEMA master CASCADE;
DROP POLICY IF EXISTS lectura_auth ON sesion;
DROP POLICY IF EXISTS lectura_auth ON sucursal;
DROP POLICY IF EXISTS lectura_auth ON perfil;
DROP FUNCTION IF EXISTS auth_requiere_2fa(uuid);
DROP TABLE IF EXISTS codigo_respaldo;
ALTER TABLE plan DROP COLUMN exige_2fa_propietario, DROP COLUMN precio_mensual, DROP COLUMN precio_anual;
ALTER TABLE cuenta DROP COLUMN totp_activo, DROP COLUMN totp_pendiente, DROP COLUMN totp_ultimo_paso;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kontiva_master;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM kontiva_master;
REVOKE USAGE ON SCHEMA public FROM kontiva_master;
