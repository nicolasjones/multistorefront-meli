# Bug Assessment: código sin uso de avisos de consulta

- **Slug**: msf-853
- **Created**: 2026-11-13
- **Source**: pasted text (tracker MSF-853)
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim)

> ## Gate para Nicolás
>
> **Qué pasa hoy:** desde la migración 20261210130300 el aviso de una consulta nueva lo emite el trigger con `private.emitir_aviso`. La Edge Function `enviar-aviso-consulta` y la tabla `dominio.consultas_avisos` quedaron sin uso: no se envía correo SMTP de «nueva consulta» por esa vía (lo encontró la revisión de los E2E).
>
> **Decisión:** ¿se eliminan (migración con reversión + borrar la función y su despliegue) o se dejan documentados como histórico? Hay que confirmar antes que ningún flujo externo dependa de ellas.
>
> **Recomendación:** eliminarlas en una épica de limpieza, con migración aditiva/reversible, después de confirmar que ningún consumidor las usa.

## Symptom

Queda código muerto que dice lo contrario de lo que pasa: la Edge Function `enviar-aviso-consulta`, su flow de Kestra `avisos-consultas`, la tabla `dominio.consultas_avisos` y sus tres RPC (`avisos_consulta_pendientes`, `tomar_aviso_consulta`, `cerrar_aviso_consulta`) más el ayudante `private.correo_avisos_consulta`. Desde la migración `20261210130300` el alta de una consulta emite con `private.emitir_aviso` y el aviso sale por la cola de plataforma (`public.avisos_pendientes`), así que ese camino no vuelve a encolar nada: el barrido no encuentra nada y su E2E (`consultas-recorrido`) llama una función que no manda nada.

## Reproduction

1. Crear una consulta en `dominio.consultas`: el disparador `consultas_encolar_aviso` llama `private.encolar_aviso_consulta()`, que emite con `private.emitir_aviso` (`supabase/migrations/20261210130300_consultas_aviso_emitir.sql`).
2. `dominio.consultas_avisos` queda vacía: la tabla ya no recibe filas.
3. El flow `avisos-consultas` llama cada minuto a la Edge Function con `{"barrer": true}`; `public.avisos_consulta_pendientes` no devuelve nada → no sale ningún correo SMTP de «nueva consulta» por esa vía.4. El E2E `apps/web/e2e/consultas-recorrido.e2e.ts` depende de ese barrido: espera en Mailpit un correo con asunto «Nueva consulta · <empresa>» que ya no llega.

## Suspected Code Paths

- `supabase/functions/enviar-aviso-consulta/` — la Edge Function sin uso (barrido de la cola vieja).
- `infra/kestra/flows/avisos-consultas.yml` — el flow que la invoca cada minuto (único consumidor de la función).
- `supabase/migrations/20261205200100_consultas_avisos.sql` — creó `dominio.consultas_avisos` y las tres RPC.
- `supabase/migrations/20261205200200_consultas_avisos_reintentos.sql` — ajustó esas RPC.
- `supabase/migrations/20261205200000_consultas_configuracion.sql` — creó `private.correo_avisos_consulta(uuid)`, que solo usaban esas RPC.
- `supabase/migrations/20261210130300_consultas_aviso_emitir.sql` — el camino vigente (no se toca).
- `apps/web/e2e/consultas-recorrido.e2e.ts` — consumidor del camino viejo.
- `apps/web/src/pages/empresas/CorreoAvisosConsultas.tsx` — el texto al usuario promete que la dirección «completa el envío de los avisos que ya estaban encolados».

## Root Cause Hypothesis

Confianza **alta**: el camino directo (tabla + función + flow) quedó atrás cuando MSF-562 (migración `20261210130300`) movió el aviso a `private.emitir_aviso`, pero se dejó el código y su documentación porque la tabla seguía sirviendo para «terminar de enviar lo que ya estaba encolado». La revisión de los E2E comprobó que esa vía ya no manda nada.

## Proposed Remediation

**Preferred**: eliminar el camino muerto (la recomendación del tracker), con migración reversible y documentada:
borrar la tabla `dominio.consultas_avisos`, sus tres RPC y `private.correo_avisos_consulta`; borrar la Edge Function y su test, el flow de Kestra y su test estático; limpiar los scripts de `package.json` y las variables `AVISOS_CONSULTAS_*`; adaptar el pgTAP y el E2E al camino vigente; documentar el retiro en `docs/consultas.md` y `docs/avisos-por-correo.md`.

**Alternatives**:
- Dejarlo como histórico (solo documentación): no elimina el código muerto ni el E2E que depende de un camino que no manda nada; eltracker lo descarta como recomendado.
- Quitar también `dominio.consultas_configuracion` y el campo de la ficha de la empresa: fuera del alcance de esta historia (el tracker nombra la función y la tabla); queda como seguimiento.

**Files likely to change**:
- `supabase/migrations/20270305140001_avisos_consulta_camino_directo.sql` (nueva)
- `supabase/functions/enviar-aviso-consulta/` (borrada)
- `infra/kestra/flows/avisos-consultas.yml`, `infra/kestra/validar-avisos-consultas.test.mjs` (borrados)
- `infra/kestra/compose.yaml`, `infra/kestra/.env.example`, `supabase/functions/.env.example`, `.env.example`, `package.json`
- `supabase/tests/database/consultas_aviso.test.sql`, `supabase/tests/database/avisos_consulta_nueva.test.sql`
- `apps/web/e2e/consultas-recorrido.e2e.ts`
- `apps/web/src/pages/empresas/CorreoAvisosConsultas.tsx` (+ su test)
- `docs/consultas.md`, `docs/avisos-por-correo.md`

**Tests to add or update**:
- pgTAP: el camino directo no existe (tabla, RPC y ayudante) y el camino vigente sigue (disparador + `private.encolar_aviso_consulta`).
- pgTAP: la dirección de avisos por empresa conserva sus permisos y su bloqueo optimista.
- Vitest: el texto al usuario ya no promete el camino anterior.
- E2E: el aviso queda encolado en `public.avisos_pendientes` para la persona de la organización (sin función ni Mailpit).

## Risks & Considerations

- **Migración**: borrar una tabla es destructivo; la reversión queda escrita en el encabezado de la migración (recrear tabla, RPC y ayudante; reponer la función y el flow).
- **Exclusión de la exportación total**: `private.exclusiones_exportacion_total()` nombraba la tabla; la prueba de completitud exige que toda exclusión nombre una tabla que existe → hay que redefinir la función sin esa fila.
- **Avisos legados**: si quedaran avisos `pendiente` en la cola vieja, al borrar la tabla no se enviarían. La revisión de los E2E y el camino vigente (>6 meses en uso) hacen que no haya cola viva; conviene avisarlo en el PR.
- **RLS**: se borra una tabla con RLS; `rls_en_toda_tabla` recorre `public` + `dominio` y sigue verde.
- **Scope**: `dominio.consultas_configuracion` y su campo en la ficha quedan (no estaban en el alcance del tracker); su texto al usuario se corrige porque queda falso.

## Open Questions

- Ninguna bloqueante: la decisión del tracker (eliminar) y su recomendación son explícitas, y el consumo se verificó en el repo (solo el flow y el E2E, ambos retired en este cambio).
