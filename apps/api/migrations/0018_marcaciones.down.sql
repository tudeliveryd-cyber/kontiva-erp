DROP TABLE marcacion;
DROP INDEX funcionario_codigo_reloj;
ALTER TABLE funcionario DROP CONSTRAINT funcionario_horario,
  DROP COLUMN codigo_reloj, DROP COLUMN horario_entrada, DROP COLUMN horario_salida, DROP COLUMN trabaja_sabado, DROP COLUMN sabado_salida;
