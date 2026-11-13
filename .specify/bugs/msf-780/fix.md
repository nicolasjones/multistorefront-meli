# Fix MSF-780

Causa: el E2E de cierre de MSF-232 (T032) estaba rotulado con la historia (`[MSF-576:T032]`) y no con la épica; sin `[MSF-232:` en `apps/web/e2e/` el poller no limpia `e2e-falta` y `cobertura:e2e` lo deja como épica desconocida. Tampoco usaba el fixture de evidencia.

Cambios:
- `apps/web/e2e/service-cobro-avisos.e2e.ts`: rótulo `[MSF-232:T032]`; `test`/`expect` y contexto grabado desde `./fixture` (video 1920x1080). `HOSTS_LOCALES` intacto.
- `docs/e2e-app.md`: fila del recorrido (cómo se corre y desvío).
- `specs/20261028-100000-service-cobro-y-avisos/tasks.md`: T032 `[x]` con `Desvío:` (sin daemon de Docker ni CLI de Supabase en el nodo); deuda en MSF-499.
