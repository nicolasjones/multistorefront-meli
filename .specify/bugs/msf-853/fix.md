# Bug Fix: código sin uso de avisos de consulta (MSF-853)

- **Slug**: msf-853
- **Fixed**: 2026-11-13
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Se elimina el camino directo del aviso de consulta, que quedó sin uso desde MSF-562: la Edge Function
`enviar-aviso-consulta`, su flow de Kestra `avisos-consultas`, la tabla `dominio.consultas_avisos`, sus tres
RPC (`avisos_consulta_pendientes`, `tomar_aviso_consulta`, `cerrar_aviso_consulta`) y el ayudante
`private.correo_avisos_consulta`. El aviso vigente (el que emite `private.emitir_aviso` y manda el flow
`enviar-avisos`) queda intacto.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `supabase/migrations/20270306140000_avisos_consulta_camino_directo.sql` | added | Borra la tabla, las tres RPC y el ayudante; redefine `private.exclusiones_exportacion_total()` sin la fila de la tabla (la prueba de completitud exige que toda exclusión nombre una tabla que exista). Reversión escrita en el encabezado. Revisión (PR #914): la copia vuelve a ser idéntica a la de `20270224110206` (motivo de `public.migracion_cargas` restaurado) y la migración **aborta** si la cola vieja quedó con avisos `pendiente`/`fallido` (verificación previa, ver abajo). |
| `supabase/functions/enviar-aviso-consulta/` | removed | `index.ts`, `handler.ts`, `contenido.ts` y `handler.test.ts`. |
| `infra/kestra/flows/avisos-consultas.yml` | removed | Flow que barre la cola vieja. |
| `infra/kestra/validar-avisos-consultas.test.mjs` | removed | Test estático del flow. |
| `infra/kestra/desplegar-flow.mjs` | modified | Revisión (PR #914): agrega `--borrar` (borra un flow publicado) y `--retirar` (borra los flows del manifiesto). Antes solo publicaba (POST/PUT): nada en el repo borraba un flow retirado. |
| `infra/kestra/flows-retirados.txt` | added | Revisión (PR #914): manifiesto de flows que ya no están en el repo y hay que borrar de cada entorno (`platform.consultas/avisos-consultas`). |
| `infra/kestra/desplegar-flow.test.mjs` | modified | Revisión (PR #914): tests del retiro (borra, idempotencia ante 404, error de Kestra, manifiesto con comentarios y línea inválida). |
| `.github/workflows/publicar-flows-kestra.yml` | modified | Revisión (PR #914): después de publicar, borra los flows del manifiesto en el entorno (staging y producción). |
| `.github/workflows/validate.yml` | modified | Revisión (PR #914): el job de infraestructura corre `pnpm test:kestra:deploy-flow` (el retiro tiene test en el CI). |
| `infra/kestra/compose.yaml` | modified | Fuera `ENV_AVISOS_CONSULTAS_URL`, `ENV_AVISOS_CONSULTAS_APIKEY` y `SECRET_AVISOS_CONSULTAS_TOKEN`. |
| `infra/kestra/.env.example`, `supabase/functions/.env.example`, `.env.example` | modified | Fuera las variables `AVISOS_CONSULTAS_*` (se conserva `PANEL_URL`, que usa `enviar-resumen-reposicion`). Revisión (PR #914): «Alertas de Inicio» y «Avisos de faltantes» ya no remiten a «los avisos de consultas» (no existen). |
| `package.json` | modified | Fuera `test:edge:enviar-aviso-consulta` y `test:kestra:avisos-consultas` (y sus llamadas en `test` y `test:web`). Revisión (PR #914): `test:kestra:deploy-flow` entra en `test`. |
| `supabase/tests/database/consultas_aviso.test.sql` | modified | Queda la dirección de avisos por empresa (FR-009) y suma el gate: el camino directo no existe y el camino vigente sigue. Revisión (PR #914): assert de que la exclusión de `public.migracion_cargas` conserva su motivo (29 asserts). |
| `supabase/tests/database/avisos_consulta_nueva.test.sql` | modified | La aserción del camino directo pasa de «la tabla está vacía» a «la tabla no existe». |
| `apps/web/e2e/consultas-recorrido.e2e.ts` | modified | La base (PR #907, ya mergeada en `dokploy`) había pasado el E2E al camino vigente; este cambio actualiza los comentarios que nombraban la tabla y la función retiradas. Revisión (PR #914): «el enlace del aviso» → el aviso no lleva enlace, y la lista de tablas del `on delete cascade` sin el duplicado. |
| `apps/web/src/pages/empresas/CorreoAvisosConsultas.tsx` | modified | El texto al usuario ya no promete que la dirección «completa el envío de los avisos encolados». |
| `apps/web/src/pages/empresas/CorreoAvisosConsultas.test.tsx` | modified | Assert del texto actualizado. |
| `docs/consultas.md`, `docs/avisos-por-correo.md` | modified | Describen solo el camino vigente y el retiro del anterior (con su reversión). Revisión (PR #914): la intro ya no promete «un correo con enlace a la consulta» y el retiro en los entornos queda enlazado al runbook. |
| `docs/deployment.md` | modified | Revisión (PR #914): sección «Retiro de un flow y de su Edge Function» (borrar el flow, bajar la función y sus secretos, sacar las variables del `infra/kestra/.env` del entorno y el orden) y la verificación de la cola antes de aplicar una migración que la borra. |
| `docs/e2e-app.md` | modified | Revisión (PR #914): la fila de Consultas ya no dice «llega el aviso a Mailpit» ni «con la función servida». |

## Diff Highlights

```sql
-- supabase/migrations/20270306140000_avisos_consulta_camino_directo.sql
-- Verificación previa (revisión PR #914): la cola vieja no puede quedar con avisos sin enviar.
-- Va antes de los drop: si el aplicador no envuelve la migración en una transacción, aborta
-- sin haber borrado nada.
do $$
declare
  vivos integer;
begin
  if to_regclass('dominio.consultas_avisos') is not null then
    select count(*) into vivos from dominio.consultas_avisos where estado in ('pendiente', 'fallido');
    if vivos > 0 then
      raise exception 'MSF-853: la cola vieja tiene % aviso(s) sin enviar (pendiente/fallido); se aborta el retiro para no perderlos.', vivos;
    end if;
  end if;
end;
$$;

drop function if exists public.avisos_consulta_pendientes(integer, integer);
drop function if exists public.tomar_aviso_consulta(uuid, integer);
drop function if exists public.cerrar_aviso_consulta(uuid, boolean, text);
drop function if exists private.correo_avisos_consulta(uuid);

drop table if exists dominio.consultas_avisos;
```

```js
// infra/kestra/desplegar-flow.mjs (revisión PR #914): borrar un flow publicado
const response = await fetch(url, { method: 'DELETE', headers: { authorization }, signal: AbortSignal.timeout(60_000) });
if (response.status === 404) { console.log(`${flowNamespace}/${flow} no estaba publicado.`); return; }
if (!response.ok) throw new Error(`Kestra devolvió HTTP ${response.status}.`);
```

## Tests Added or Updated

- `supabase/tests/database/consultas_aviso.test.sql` — gate de MSF-853: la tabla, las tres RPC y
  `private.correo_avisos_consulta` ya no existen; el disparador `consultas_encolar_aviso` y
  `private.encolar_aviso_consulta()` siguen; la dirección de avisos por empresa conserva RLS, permisos
  (`42501`/`22023`/`40001`), idempotencia y registro de actividad; la exclusión de
  `public.migracion_cargas` conserva su motivo (la copia de la lista no puede cambiar filas ajenas).
- `supabase/tests/database/avisos_consulta_nueva.test.sql` — el aviso de consulta nueva sigue saliendo por
  `private.emitir_aviso` y la cola del camino directo ya no existe.
- `apps/web/src/pages/empresas/CorreoAvisosConsultas.test.tsx` — el texto al usuario advierte que la
  dirección ya no se usa (sin mencionar el camino anterior).
- `apps/web/e2e/consultas-recorrido.e2e.ts` — la consulta aparece en la bandeja en menos de 5 s, el aviso
  queda encolado para la persona de la organización y el detalle se abre desde el panel.
- `infra/kestra/desplegar-flow.test.mjs` — el retiro de flows: borra el flow pedido, tolera el que ya no
  está (404), falla si Kestra no puede borrarlo, borra todos los del manifiesto (saltando comentarios) y
  rechaza una línea inválida.

## Local Verification

- Commands run:
  - `pnpm lint` → ok (0 errores; solo warnings preexistentes de oxlint).
  - `pnpm build` → ok.
  - `pnpm --filter @platform/web exec vitest run src/pages/empresas/CorreoAvisosConsultas.test.tsx` → 10/10.
  - `pnpm test:kestra:deploy-flow` → 9/9 (incluye el retiro de flows: borrar, idempotencia, error, manifiesto).
  - `node --test infra/kestra/validar-*.test.mjs` → 73/73.
  - `pnpm test:db:guard-migraciones` → 30/30.
  - `pnpm docs:check` → `Documentación de cambios: OK` y `Migraciones OK: 639 archivo(s), 1 nuevo(s)`.
  - `pnpm infra:config:kestra` → ok.
  - `pnpm calidad` → oxlint, knip (código muerto), jscpd, dependency-cruiser y syncpack ok; gitleaks no se
    pudo correr (docker sin permisos en este entorno) y lo corre el CI.
  - `pnpm exec playwright test --list consultas-recorrido` → el E2E se collected (1 test).
  - `pnpm exec tsc --ignoreConfig --noEmit --strict … e2e/consultas-recorrido.e2e.ts` → 0 errores.
- Manual checks: el grep de todo el repo no deja referencias vivas a la función, al flow, a la tabla ni a
  las variables `AVISOS_CONSULTAS_*` (solo quedan las menciones históricas en `specs/` y las que explican el
  retiro en `docs/` y los tests); y la copia de `private.exclusiones_exportacion_total()` se comparó fila por
  fila con la de `20270224110206` (solo difiere en la fila de la tabla borrada).
- No corrido localmente: `pnpm test:db` (pgTAP) y el E2E, que necesitan el stack local de Supabase
  (`pnpm dev:supabase`); este entorno no tiene permisos de docker.
- No hecho por el PR (queda a mano en cada entorno): bajar la Edge Function `enviar-aviso-consulta` desplegada
  y sus secretos (`AVISOS_CONSULTAS_TOKEN`, `SECRET_AVISOS_CONSULTAS_TOKEN`) y sacar del `infra/kestra/.env`
  las variables `AVISOS_CONSULTAS_*` — el runbook está en `docs/deployment.md`.

## Deviations from Assessment

- El assessment proponía limpiar las variables `AVISOS_CONSULTAS_*`; se conserva `PANEL_URL` en
  `supabase/functions/.env.example` porque la usa `enviar-resumen-reposicion` (si se borraba, esa función
  perdía su enlace).
- La definición de `private.exclusiones_exportacion_total()` se copió de `20270224110206` (la última
  definición vigente) sin la fila de la tabla: el assessment lo mencionaba como riesgo y resultó obligatorio,
  no opcional, por el assert «toda exclusión nombra una tabla que existe» de `exportacion_total.test.sql`.
- El E2E de consultas **ya estaba** en el camino vigente: la base (`dokploy`, PR #907 «fix(e2e): actualizar
  specs envejecidos») lo había reescrito con la fixture compartida `crearConsulta` y la lectura de
  `public.avisos_pendientes`. Como la rama quedó atrás de la base, el merge trajo ese archivo y el cambio de
  MSF-853 sobre él se limita a los dos comentarios que nombraban la tabla y la función retiradas. No se
  reescribió el E2E de la base: ya cubría lo que pedía la historia.
- **Revisión PR #914 (devolución)**: la copia de `private.exclusiones_exportacion_total()` se había copiado
  con el motivo de `public.migracion_cargas` cambiado (ajeno a la historia): se restauró el de
  `20270224110206` y se agregó un assert que lo fija. El retiro en los entornos se automate con el manifiesto
  de flows retirados (`infra/kestra/flows-retirados.txt` + `desplegar-flow.mjs --retirar`, que corre el CI
  de publicación): antes nada en el repo borraba un flow retirado, así que el flow publicado seguía
  disparando y la Edge Function desplegada seguía viva con su secreto. La Edge Function y sus secretos se
  bajan a mano por entorno (runbook en `docs/deployment.md`): no hay CI que despliegue ni borre funciones.
- La migración se renumeró de `20270305140001` a `20270306110000` y, al colisionar con `20270306110000_inicio_tablero_hallazgos_finales` de `dokploy`, a `20270306140000` (PR de reemplazo de #914): la base (`origin/dokploy`) avanzó con
  `20270306100000` (PR #912) y el guard de migraciones exige que una migración nueva sea mayor que la máxima
  de la base. No se aplicó nunca (el PR no está mergeado), así que no se rompe la inmutabilidad de ninguna
  versión aplicada.
## Follow-ups

- **MSF-853 · decisión de producto (dueño: producto)**: `dominio.consultas_configuracion` y el campo
  «Correo para avisos de consultas» de la ficha de la empresa quedan sin ningún aviso que los use (el
  aviso sale por la cola de plataforma). Hay que decidir si se borra el campo (y su RPC
  `public.guardar_correo_avisos_consultas`) o si vuelve a tener un destinatario. Está fuera del alcance de
  esta historia: el tracker nombró solo la Edge Function y la tabla `dominio.consultas_avisos`, y quitar el
  campo de la pantalla es un cambio de producto (el prototipo manda). El texto al usuario ya lo advierte, así
  que no engaña a nadie mientras tanto. Tarea de seguimiento en el tracker: `seguimiento` MSF-853.
- **MSF-853 · retiro en los entornos (dueño: plataforma)**: el flow `platform.consultas/avisos-consultas`
  lo borra el CI de publicación (`infra/kestra/flows-retirados.txt`), pero la Edge Function
  `enviar-aviso-consulta` desplegada y sus secretos (`AVISOS_CONSULTAS_TOKEN`,
  `SECRET_AVISOS_CONSULTAS_TOKEN`) hay que bajarlos a mano, entorno por entorno, con el runbook de
  `docs/deployment.md`. Eso corre en el VPS y en los workdir del CLI de cada entorno: no lo puede hacer el
  PR.
- La tabla `dominio.consultas_avisos` se borra con sus filas (histórico de avisos ya cerrados). Si algún
  entorno tuviera avisos `pendiente` o `fallido` de esa cola, la migración **aborta** en vez de perderlos
  (verificación previa); hay que vaciar la cola antes de promover.
