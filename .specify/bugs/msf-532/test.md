# Bug Verification: Verificación de salida del correo de «Solicitar acceso» sin verde falso (MSF-532)

- **Slug**: msf-532
- **Tested**: 2026-11-14 · 2026-11-15 (segunda ronda) · 2026-11-16 (tercera ronda, tras la devolución del Revisor) · 2026-11-16 (cuarta ronda, drift de la documentación)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

El **defecto de instrumental** (el guion podía terminar con código `0` sin que la corrida hubiera enviado
nada, y además afirmaba que «el SMTP lo aceptó» cuando el aviso lo había enviado otra invocación) queda
reproducido y corregido: hay tests que fallan con el guion viejo y pasan con el nuevo. La **verificación
externa** en sí (que el correo salga del servidor self-hosted y llegue a una casilla externa real) **no se
ejecutó** y no puede ejecutarse desde esta sesión: falta el relay SMTP real en el VPS, que es
infraestructura de Nicolás. El estado queda registrado como pendiente, con dueño y seguimiento, en vez de
cerrado como si hubiera pasado.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | `node --test scripts/verificar-salida-correo.test.mjs` | pass | 14/14; el guion sale con `1`/`2`/`3` en los casos que antes salían con `0`. |
| New / updated tests | `node --test supabase/functions/solicitar-acceso/handler.test.ts` | pass | 11/11; el contrato `{resultado, nuevo, enviado}` queda fijado en los cuatro caminos. |
| Test que vigila la regla (mutación) | el guion ignora `enviado` | pass (detecta) | Fallan 3 tests: idempotencia, invocación concurrente y «un aviso en Mailpit que no salió de esta corrida no da verde». |
| Test que vigila la regla (mutación) | el guion acepta un contrato viejo (sin `enviado`) | pass (detecta) | Falla el test «una función vieja que no informa `enviado` no se toma como verificación». |
| Test que vigila la regla (mutación) | la invocación concurrente afirma `enviado: true` | pass (detecta) | Falla el test del handler «doble clic concurrente: quien pierde el reclamo no envía y lo dice». |
| Test que vigila la regla (mutación) | el camino de éxito afirma `enviado: false` | pass (detecta) | Fallan el test del handler y el test del contrato del guion. |
| Regression suite (docs) | `pnpm docs:check` | pass | «Documentación de cambios: OK» y «Migraciones OK» (sin migraciones en este cambio). |
| Regression suite (docs) | `pnpm test:docs:check` · `pnpm test:docs:importaciones` · `pnpm test:docs:pasos-manuales` | pass | 4/4, 3/3 y 15/15. |
| Regression suite (contratos) | `pnpm test:openapi` · `pnpm test:ia:sincronizar-edge-functions` | pass | `solicitar-acceso` no tiene contrato OpenAPI (no hay nada que actualizar). |
| Lint / type-check | `pnpm lint` | pass | `oxlint` del área web: sin cambios en `apps/web`, igual que en la base (sólo warnings preexistentes). |
| Build | `pnpm build` | pass | Vite build de `@platform/web` en verde. |
| Verificación externa (servidor self-hosted) | `pnpm correo:verificar-salida` contra stg/prd | not-run | Requiere el relay SMTP real en el VPS (no existe todavía), la Edge Function desplegada con `enviado` y una casilla externa real. Es la parte de FR-012(b) que sigue **sin verificar**. |

## Output Excerpts

```
✔ la Edge Function sigue respondiendo el contrato {resultado, nuevo, enviado} que usa el guion
✔ una función vieja que no informa `enviado` no se toma como verificación
✔ el pedido del día ya notificado no se toma como verificación (idempotencia)
✔ otra invocación que ganó el reclamo del envío no se toma como verificación
✔ el reintento de un envío fallido sí sale: no se informa un falso «no se envió»
✔ en local, con el aviso en Mailpit, la salida queda verificada
✔ en local, un aviso en Mailpit que no salió de esta corrida no da verde
✔ en local, sin aviso en Mailpit, no hay verde
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

Con la mutación «el guion ignora `enviado`» (el verde falso):

```
✖ el pedido del día ya notificado no se toma como verificación (idempotencia)
✖ otra invocación que ganó el reclamo del envío no se toma como verificación
✖ en local, un aviso en Mailpit que no salió de esta corrida no da verde
ℹ pass 11
ℹ fail 3
```

## Residual Risks

- **FR-012(b) y SC-004 siguen sin verificar**: nobody corrió el flujo contra el SMTP real del servidor ni
  confirmó la recepción en una casilla externa. El registro `docs/verificacion-salida-correo.md` queda en
  «pendiente» y el seguimiento es la Tarea `seguimiento` de MSF-532 (dueño: infraestructura/Nicolás).
- **La corrida real necesita la Edge Function desplegada con `enviado`**: contra un despliegue viejo el
  guion sale con `1` y lo dice (no adivina). Es intencional: sin ese campo no hay forma de distinguir una
  corrida que envió de una que no.
- **El `0` del guion significa «verificado por Mailpit»**: desde el servidor nunca hay `0`, así que la
  corrida real hay que cerrarla con la confirmación manual (código `3` + captura). Si alguien busca un
  «verde» en el servidor, no lo va a encontrar: es a propósito.
- **La idempotencia por día sigue vigente**: si el pedido del día ya estaba notificado, la corrida no vuelve
  a avisar (`enviado: false`) y el guion sale con `1` diciéndolo. El reintento de un envío que había fallado
  sí es una corrida válida (`enviado: true`).
- El resto de funciones que comparten el SMTP (avisos de faltantes, resúmenes, correo a proveedor) siguen
  dependiendo del mismo relay: que no esté configurado no es un problema sólo de «Solicitar acceso».

## Tercera ronda (devolución del Revisor)

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Suite del guion | `pnpm test:correo:verificar-salida` | pass | 15/15; incluye el test que vigila que los códigos de salida tengan un solo dueño. |
| Contrato del handler | `node --test supabase/functions/solicitar-acceso/handler.test.ts` | pass | 11/11. |
| Documentación del cambio | `pnpm docs:check` | fail (línea base) | «Migraciones: versión `20270323100100` MODIFICADA» por estar la rama 319 commits detrás de `origin/dokploy`; esta historia no toca `supabase/migrations` (`git diff origin/dokploy...HEAD -- supabase/migrations` vacío). El job `application` del PR (que corre `docs:check`) pasó en el merge-ref con la base al día. |
| Lint | `pnpm lint` | pass | Sólo warnings preexistentes del área web. |
| Build | `pnpm build` | pass | Vite build de `@platform/web` en verde. |
| Inventario de docs | `node scripts/docs-inventario.mjs` | pass | Regenerado y commiteado (`inventory.json`/`.md`). `docs-manifest.mjs` sigue fallando por 99 páginas sin `owner`/`sources` de la línea base (deuda del Documentador, ajena a esta historia). |

## Cuarta ronda (drift de la documentación y estado del CI)

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Suite del guion | `node --test scripts/verificar-salida-correo.test.mjs` | pass | 15/15. |
| Contrato del handler | `node --test supabase/functions/solicitar-acceso/handler.test.ts` | pass | 11/11. |
| Documentación del cambio | `pnpm docs:check` | pass | «Documentación de cambios: OK» y «Migraciones OK: 675 archivo(s), 0 nuevo(s) contra origin/dokploy»: ya no hay ninguna versión MODIFICADA (la ronda anterior la había marcado como línea base; la rama integró la base). |
| Drift de la documentación | `node scripts/docs-drift.mjs` | fail (línea base) | 137 páginas «viejas»: **0 nuevas** respecto de la base de la épica (143) y 6 arregladas (`deployment.md`, `solicitar-acceso.md`, `perfil-y-permisos.md` y las tres `tecnico/tienda-*.md`). El job `build` del workflow `docs` ya estaba rojo en el PR de la épica (#977) y en `dokploy` (161): es deuda de la línea base, no de esta historia. |
| Lint | `pnpm lint` | pass | exit 0; sólo warnings preexistentes del área web (esta historia no toca `apps/web`). |
| Build | `pnpm build` | pass | exit 0. |
| Calidad determinista | `pnpm calidad` | pass (best-effort) | oxlint, knip (código muerto), jscpd, dependency-cruiser y syncpack en verde. El único «hallazgo» es gitleaks, que no pudo arrancar (sin Docker en este entorno: `permission denied … /var/run/docker.sock`); el diff no tiene secretos (sólo nombres de variables y una clave de fixture en el test). |
| Verificación externa (servidor self-hosted) | `pnpm correo:verificar-salida` contra stg/prd | not-run | Los ambientes responden (HTTP 200 en `stg`/`prd.212-90-120-53.sslip.io`), pero desde esta sesión no hay credenciales de una persona **sin** acceso (`ACCESO_EMAIL`/`ACCESO_PASSWORD`) ni la clave del ambiente, la Edge Function desplegada no tiene el campo `enviado` y el relay SMTP del VPS sigue sin configurar (así lo registra el repo). La evidencia pedida —captura del correo recibido en una casilla externa— es humana por definición. |

## Recommendation

**Cerrar el bug como `partial`**: el defecto de instrumental está corregido y guardado con tests (y la
guarda ahora corre en el CI del PR), y la verificación externa quedó **trazada** con dueño y estado real (no
como «hecho»). La historia se da por resuelta en el repo cuando la Tarea `seguimiento` de MSF-532 despliegue
la Edge Function, corra el guion contra el relay del VPS y complete el registro con la salida y la captura;
hasta entonces, FR-012(b) sigue abierta por infraestructura.
