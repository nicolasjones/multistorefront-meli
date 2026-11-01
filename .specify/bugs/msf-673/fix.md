# Fix: msf-673

- **Causa**: `main.tsx` instalaba `seguirActividad` en todos los hosts; en una tienda, tras >12 h el primer clic ejecutaba logout + `assign('/login')` (404).
- **Cambio**: nueva `seguirActividadDelPanel(esTiendaPublica, alVencer)` en `apps/web/src/lib/vencimientoSesion.ts`; `main.tsx` calcula el host antes y la usa, de modo que la tienda no registra marca ni cierra sesión. El panel queda idéntico.
- **Archivos**: `apps/web/src/main.tsx`, `apps/web/src/lib/vencimientoSesion.ts`, `apps/web/src/lib/vencimientoSesion.test.ts`, `docs/tiendas-online.md`.
- **Pregunta abierta**: sesión de cliente de la tienda (épica MSF-237) no vence por inactividad; si se quiere, sería otra historia sin redirigir a `/login`.
