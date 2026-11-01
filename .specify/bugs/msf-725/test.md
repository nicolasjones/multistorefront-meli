# Verificación: msf-725

- `node --test supabase/functions/preguntar-documentos/contexto.test.ts` → 3 pass, 0 fail.
  - Contexto incluye el texto de los fragmentos separados por `---` dentro del delimitador no confiable (reproduce el bug: antes salía vacío).
  - Fragmentos sin texto → `null` (no se paga la generación).
  - Mezcla de vacíos y con texto conserva solo los útiles.
- Pendiente de CI: lint/build/docs:check. No se probó contra un proveedor real.
