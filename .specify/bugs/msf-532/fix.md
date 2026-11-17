# Bug Fix: Verificación de salida del correo de «Solicitar acceso» sin verde falso (MSF-532)

- **Slug**: msf-532
- **Fixed**: 2026-11-14 · 2026-11-15 (segunda ronda) · 2026-11-16 (tercera ronda, devolución del Revisor) · 2026-11-16 (cuarta ronda, drift de la documentación)
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El guion de verificación de salida (`scripts/verificar-salida-correo.mjs`) no puede dar un **verde falso**:
en el servidor nunca termina con código `0` (el `0` significa «verificado por la máquina», que sólo es
posible contra Mailpit), la casilla de prueba es obligatoria sin `MAILPIT_URL` y **sólo cuenta como
verificación una corrida que envió el aviso**. Para que el guion pueda distinguir «esta corrida mandó el
correo» de «no mandó nada» (o «lo está mandando otra invocación»), la respuesta de `solicitar-acceso` ahora
incluye `enviado`. Además queda **registrada** la verificación externa con su estado real (pendiente) y su
dueño, en lugar de una tarea cerrada sin evidencia.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/verificar-salida-correo.mjs` | modified | Códigos de salida documentados; `CORREO_PRUEBA` obligatoria sin Mailpit; decide por el campo `enviado` del contrato `{resultado, nuevo, enviado}`: `0` exige además el mensaje en Mailpit y `3` sólo se afirma si **esta** corrida envió; en el servidor nunca `0`. |
| `scripts/verificar-salida-correo.test.mjs` | modified | 15 casos (`node --test`) que corren el guion real contra un servidor local que imita Auth, la Edge Function y Mailpit: ningún correo sale a internet. Casos nuevos: verde falso con `enviado: false` y mensaje en Mailpit, invocación concurrente, reintento de un envío fallido, contrato viejo sin `enviado`. |
| `supabase/functions/solicitar-acceso/handler.ts` | modified | La respuesta incluye `enviado`: `true` sólo si **esta** invocación envió el aviso y el SMTP lo aceptó; `false` si el aviso ya salió hoy o si otra invocación ganó el reclamo del envío. |
| `supabase/functions/solicitar-acceso/handler.test.ts` | modified | Las aserciones del contrato fijan `enviado` en los cuatro caminos (enviado, ya notificado, concurrente, sin administradores) y en el reintento. |
| `.github/workflows/validate.yml` | modified | Paso `test:correo:verificar-salida` en el job `application`: la guarda anti-verde-falso corre en el CI del PR y detecta cualquier cambio del contrato de la Edge Function. |
| `docs/verificacion-salida-correo.md` | modified | Registro de la verificación con los campos en «pendiente», el protocolo, los códigos de salida, el contrato `{resultado, nuevo, enviado}` y las variables con host self-hosted (nunca `*.supabase.co`). |
| `docs/README.md` | modified | Página en la tabla de funcionalidad y deuda trazada (MSF-532). |
| `docs/tecnico/operacion.md` | modified | El «Pendiente» difuso pasa a estado con dueño, seguimiento y enlace al registro. |
| `docs/tecnico/perfil-y-permisos.md` | modified | Verificación de salida (FR-012) con los códigos de salida y el enlace al registro. |
| `docs/solicitar-acceso.md` | modified | Límite «el envío depende del SMTP» con el estado real de la verificación. |
| `docs/deployment.md` | modified | Sección «Relay SMTP del servidor (MSF-532)»: relay + SPF/DKIM, estado y dueño. |
| `docs/tecnico/runbooks/*.md`, `docs/tecnico/sandbox.md` | modified | Nota fechada del cambio de CI (el paso `test:correo:verificar-salida` del job `application`), para que el paso en `validate.yml` no las vuelva «viejas» (`docs-drift.mjs`). |
| `specs/20261016-130000-perfil-y-permisos-avanzados/tasks/F-ROL-05.md` | modified | Nota `Desvío:` de T013 con el seguimiento **MSF-532** (el `tasks.md` de la épica no se tocó: sus marcas las escribe el runner). |
| `package.json` | modified | `test:correo:verificar-salida` y su entrada en la cadena `test`. |

## Diff Highlights

```js
// scripts/verificar-salida-correo.mjs (antes: verde falso)
if (avisoNuevo) { ... }         // `nuevo` no distingue «envió» de «lo envía otra» ni de «ya salió hoy»

// scripts/verificar-salida-correo.mjs (ahora)
if (typeof cuerpo.enviado !== 'boolean') { … process.exit(1) }   // contrato viejo: no adivina
if (!cuerpo.enviado) { … process.exit(1) }                       // esta corrida NO envió nada
// `0` exige `enviado: true` Y el mensaje en Mailpit; `3` sólo se afirma si envió esta corrida.
```

```ts
// supabase/functions/solicitar-acceso/handler.ts (ahora)
if (registro.correo_enviado) return response({ resultado: 'solicitud_enviada', nuevo: false, enviado: false })
if (!(await datos.reclamarEnvio(registro.id))) return response({ resultado: 'solicitud_enviada', nuevo: registro.nuevo, enviado: false })
return response({ resultado: 'solicitud_enviada', nuevo: registro.nuevo, enviado: true })
```

## Tests Added or Updated

- `scripts/verificar-salida-correo.test.mjs::la Edge Function sigue respondiendo el contrato {resultado, nuevo, enviado} que usa el guion` — el guion depende de ese contrato; se prueba contra el handler real (los dos caminos: ya notificado y enviado).
- `scripts/verificar-salida-correo.test.mjs::una función vieja que no informa `enviado` no se toma como verificación` — despliegue desactualizado: sale con `1`, nunca con `0`.
- `scripts/verificar-salida-correo.test.mjs::otra invocación que ganó el reclamo del envío no se toma como verificación` — `nuevo: true` + `enviado: false`: no se afirma que el SMTP lo aceptó.
- `scripts/verificar-salida-correo.test.mjs::el reintento de un envío fallido sí sale: no se informa un falso «no se envió»` — `nuevo: false` + `enviado: true`: sale con `3` y no manda a repetir con otra sección.
- `scripts/verificar-salida-correo.test.mjs::en local, un aviso en Mailpit que no salió de esta corrida no da verde` — reproducción del verde falso: hay mensaje en Mailpit pero `enviado: false`.
- `supabase/functions/solicitar-acceso/handler.test.ts::doble clic concurrente: quien pierde el reclamo no envía y lo dice` — `enviado: false` en la invocación que pierde el reclamo.
- `supabase/functions/solicitar-acceso/handler.test.ts::el reintento tras el fallo envía el correo` — `enviado: true` en el reintento de un envío que había fallado.

## Local Verification

- Commands run: `node --test scripts/verificar-salida-correo.test.mjs` → 15/15 en verde.
- Commands run: `node --test supabase/functions/solicitar-acceso/handler.test.ts` → 11/11 en verde.
- Comprobación de que los tests vigilan la regla (mutaciones a propósito, revertidas):
  - el guion ignora `enviado` → fallan 3 tests (idempotencia, invocación concurrente, Mailpit con `enviado: false`);
  - el guion acepta un contrato viejo (sin `enviado`) → falla el test del contrato viejo;
  - la invocación concurrente afirma `enviado: true` → falla el test del handler;
  - el camino de éxito afirma `enviado: false` → fallan el test del handler y el del contrato.
- Commands run: `pnpm lint` → ok (sólo warnings preexistentes del área web).
- Commands run: `pnpm build` → ok (incluye el type-check `tsc -b` de `@platform/web`).
- Commands run: `pnpm docs:check` → ok.
- Commands run: `node scripts/docs-drift.mjs` → 137 páginas «viejas»: 0 nuevas respecto de la base de la épica (143) y 6 arregladas; las que quedan son deuda de la línea base (el job `build` del workflow `docs` ya estaba rojo en el PR de la épica).
- Commands run: `pnpm calidad` → oxlint, knip, jscpd, dependency-cruiser y syncpack en verde; gitleaks no pudo arrancar (sin Docker en el entorno) y el diff no tiene secretos.
- Commands run: `pnpm test:docs:check`, `pnpm test:docs:importaciones`, `pnpm test:docs:pasos-manuales`, `pnpm test:openapi`, `pnpm test:ia:sincronizar-edge-functions` → todos en verde.
- Manual checks: la corrida real contra el SMTP del servidor self-hosted **no se ejecutó** (ver *Residual*).

## Deviations from Assessment

- **El contrato de la respuesta se cambió** (la primera ronda lo dejó como estaba): `{resultado, nuevo}` no
  distingue «esta corrida envió el aviso» de «ya salió hoy» ni de «otra invocación lo está mandando». Con
  sólo `nuevo` el guion afirmaba cosas que no sabía («el SMTP lo aceptó») o informaba un falso «no se envió»
  en el reintento de un envío fallido. Se agregó `enviado` a la respuesta de `solicitar-acceso`: es el dato
  mínimo que hace la verificación concluyente, y no cambia el comportamiento de la pantalla (la app web sólo
  lee `resultado`).
- **Se cambió el contrato de la Edge Function, así que no hay contrato OpenAPI que actualizar**: la función
  `solicitar-acceso` no está en `openapi/*.json` (ni antes ni después del cambio).
- **No se editó `specs/20261016-130000-perfil-y-permisos-avanzados/tasks.md`**: la consigna de la corrida
  indica que las marcas y notas las escribe el runner en `specs/<slug>/tasks/<CODE>.md`. La nota `Desvío:` de
  T013 (con el seguimiento **MSF-532**) queda en `specs/20261016-130000-perfil-y-permisos-avanzados/tasks/F-ROL-05.md`.
- **Se agregó un paso al CI** (`validate.yml`): la assessment daba las dos opciones para el hallazgo de
  seguridad («o se agrega el paso al CI, o se corrige la frase») y se hizo la primera, para que la guarda
  anti-verde-falso exista de verdad.

## Tercera ronda (devolución del Revisor)

| Hallazgo | Corrección |
|---|---|
| El contrato de códigos de salida está copiado en 4 lugares con redacción distinta. | `docs/verificacion-salida-correo.md` queda como **única** definición; el guion y `docs/tecnico/operacion.md`/`perfil-y-permisos.md` la apuntan. Un test nuevo falla si alguien vuelve a copiar la tabla o si falta un código. |
| `docs/README.md` afirma como hecho la existencia de la Tarea `seguimiento` en el tracker. | Se redacta como «a crear en el tracker» (el repo no da fe de que exista), igual que `docs/deployment.md` y el registro. |
| La página nueva exige regenerar `docs/_generated/inventory.*`. | Se regenera y se commitea el inventario (`pnpm docs:wiki:inventario`). |
| `tasks.md` T013 sigue `[x]` sin `Desvío:`. | No se edita `tasks.md` por la regla de la corrida (las marcas las escribe el runner en `specs/<slug>/tasks/<CODE>.md`); la nota `Desvío:` queda en `tasks/F-ROL-05.md`. Queda anotado como desvío consciente. |

## Cuarta ronda (drift de la documentación)

El paso agregado al CI (`validate.yml`) hace que las páginas que declaran `.github/workflows` como fuente
queden «viejas» para `scripts/docs-drift.mjs`. Sin tocarlas, la rama **agregaba** 6 páginas al rojo del job
`build` del workflow `docs`.

| Hallazgo | Corrección |
|---|---|
| El cambio en `validate.yml` dejaba viejas 6 páginas de CI (`docs/tecnico/runbooks/{ci-trabado,cola-eventos,db-restore,deploy-fallido,supabase-caido}.md` y `docs/tecnico/sandbox.md`). | Cada una lleva la nota fechada `> **CI (2026-11-16):** …` en su bloque de cambios de CI (la convención que ya usan esas páginas) y se regeneró `docs/manifest.json`. |
| El registro y el README afirmaban como hecho que el VPS «no tiene relay SMTP real ni SPF/DKIM» (la assessment lo había rated con confianza **media**: no es inspeccionable desde el repo — el mismo criterio que este bug denuncia para las afirmaciones sin respaldo). | Se reescribieron para decir lo que el repo sabe: «el repo registra el relay SMTP real y el SPF/DKIM del VPS como pendientes». El `CORREO_PRUEBA` concreto (`nicolas.m.jones@gmail.com`) quedó anotado en la tabla de variables, para que quien haga la corrida no tenga que buscarlo. |

Resultado: la rama pasa de 143 a **137** páginas viejas, **0 nuevas** respecto de la base de la épica (que
tengo 143) y arregla 6 que ya estaban viejas: `docs/deployment.md`, `docs/solicitar-acceso.md`,
`docs/tecnico/perfil-y-permisos.md` y las tres `docs/tecnico/tienda-*.md`. Las 137 que quedan son deuda de la
línea base (el `dokploy` tiene 161) y el job `build` del workflow `docs` ya estaba rojo en la épica (PR #977).

## Follow-ups

- **Tarea `seguimiento` (MSF-532, dueño: infraestructura/Nicolás)**: configurar el relay SMTP real en el VPS (secretos `GOTRUE_SMTP_*` y `SMTP_HOST`/`SMTP_PORT=465`/`SMTP_TLS=true`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`) y los registros DNS SPF/DKIM; **desplegar la Edge Function `solicitar-acceso` con el campo `enviado`**; correr `pnpm correo:verificar-salida` con `CORREO_PRUEBA`; adjuntar la salida del guion y la captura del correo recibido; completar el registro de `docs/verificacion-salida-correo.md`.
- Mientras tanto, FR-012(b) y SC-004 siguen **sin verificar**: el estado del repo lo dice en vez de darlo por hecho.
