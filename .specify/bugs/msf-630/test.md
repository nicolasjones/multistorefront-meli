# Verificación: MSF-630

| Chequeo | Resultado |
|---|---|
| `node --test tests/documentador-manual.test.js` (orquestador) | 4/4 pasan: detección de jerga, activación por marcador, guard antes del merge, prompt exige clave solo en técnico |
| Marcador `docs/producto/.manual-de-usuario` en `origin/main` | presente |
| `docs:capturas` / `demo:dataset` / `apps/web/e2e/capturas/` | ausentes: pendiente con spec propia (ver fix.md) |

E2E=no aplica (documentación y prompt; sin pantalla).
