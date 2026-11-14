-- Idioma de la interfaz por cuenta (los documentos fiscales siguen en español).
ALTER TABLE cuenta ADD COLUMN idioma text NOT NULL DEFAULT 'es' CHECK (idioma IN ('es', 'pt'));
