# Verificación: msf-682

- `node --test scripts/detectar-add-column.test.mjs`: 6/6 OK (una línea, multilínea, IF NOT EXISTS, varios ADD con línea correcta, comentarios/literales, sentencias separadas).
- `node scripts/verificar-migraciones.mjs --solo-idempotencia`: Migraciones OK.
- Resultado: bug resuelto.
