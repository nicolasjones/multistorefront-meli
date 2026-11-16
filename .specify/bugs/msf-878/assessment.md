# Bug Assessment: Lote L17 — higiene de código y tests desactualizados (4 hallazgos consolidados)

- **Slug**: msf-878
- **Created**: 2026-11-16T05:46:03Z
- **Source**: pasted text (ítem consolidado del tracker MSF-878, lote L17 de la épica MSF-515 «Deuda técnica y seguimientos de review»; underlying: MSF-584, MSF-745, MSF-631 y MSF-753)
- **Verdict**: valid (los cuatro)
- **Severity**: low (la revisión de origen los califica de «hallazgos menores, todos de impacto bajo»; no tocan datos, permisos ni migraciones)

## Report (verbatim o resumido)

El ítem consolida cuatro reportes de la revisión semanal del 2026-10-31 y de sus
seguimientos:

1. **MSF-584 — Revisión semanal: hallazgos menores.** `pnpm dlx knip` marcaba como sin
   uso `apps/web/src/hooks/useFeatureHabilitada.ts` y `apps/web/src/test/renderPanel.tsx`
   («código muerto probable; verificar antes de borrar»); los `index.ts` de
   `supabase/functions/**` y `_shared/ia/*` que knip listaba son entry points de Edge
   Functions (falso positivo de configuración: conviene declararlos en la config de
   knip); `@playwright/test` aparecía como dependencia no declarada en
   `scripts/armar-video-evidencia.mjs:147` y faltaban los binarios `pg_prove`, `graphify`,
   `ffmpeg` y `tailscale`; quedaban ~35 exports y 6 tipos exportados sin uso; y oxlint
   1.79.0 (`-D no-eval -D no-new-func`) no daba errores pero sí warnings
   `react(set-state-in-effect)` y `react-hooks(exhaustive-deps)`.
   **Propuesta**: configurar knip con los entry points reales, borrar el código muerto
   confirmado y …
2. **MSF-745 — código muerto en la invocación de IA.** Import sin uso de
   `sanitizarDato` en la Edge Function `chat-ia-responder`, función `abrirInvocacion` y
   tipo `InteraccionEnCurso` sin uso en `intentarRecuperarPaso.ts`.
3. **MSF-631 — dos tests desactualizados.** `scripts/migraciones-ventas-comprobantes.test.mjs:16`
   fijaba el conteo exacto (12) de migraciones `20261203*`/`20261204*` (hoy hay 17) y
   `supabase/tests/database/perfil_usuario.test.sql` (test 11) usaba
   `on conflict (bucket_id, name)`, que exige el índice único que Storage dropeó.
4. **MSF-753 — el espía de `console.error` de `mensajeErrorBase.test.ts` queda siempre
   bajo el `afterEach` que restaura los mocks.**

## Symptom

Cuatro defects de higiene, todos de impacto bajo y ninguno con efecto en el
comportamiento del producto: (a) herramientas de calidad que reportan código muerto o
falsos positivos porque la configuración no declara los entry points reales; (b) código
muerto en la capa de IA; (c) dos tests que affirms un detalle del entorno que cambió y
que por eso fallan cuando el entorno avanza; (d) un espía de `console.error` creado fuera
del bloque que restaura los mocks, que queda contaminando los archivos de test que
corren después en el mismo worker.

Esperado: `knip` sin hallazgos ni falsos positivos, sin código muerto, tests que no se
desactualizan con cada migración nueva y un espía que se restaura.

## Reproduction

Verificada contra `origin/dokploy` (base del PR) el 2026-11-16:

1. `pnpm dlx knip@6.44.1 --no-progress` → 0 hallazgos **con** la lista de ignorados actual.
   Sin la entrada `apps/web/src/test/renderPanel.tsx` → `Unused files (1) apps/web/src/test/renderPanel.tsx`.
   `grep -rn "renderPanel" apps packages workers scripts docs design infra supabase .github`
   → **ninguna referencia**: el archivo es código muerto confirmado, que la configuración
   de knip ocultaba en vez de borrar.
2. `pnpm dlx oxlint@1.79.0` en `apps/web` → 301 warnings (219 `set-state-in-effect`,
   39 `react(refs)`, 16 `exhaustive-deps`, 16 `only-export-components`, …), 0 errores.
3. `grep -n "sanitizarDato" supabase/functions/chat-ia-responder/index.ts` → sin
   resultados; `grep -n "abrirInvocacion\|InteraccionEnCurso" packages/ia-navegacion/src/intentarRecuperarPaso.ts`
   → sin resultados. **Ambos ya resueltos en `dokploy`.**
4. `node --test scripts/migraciones-ventas-comprobantes.test.mjs` → 4/4 en verde con el
   piso (`>= 12`). Con el conteo exacto anterior (`assert.equal(..., 12)`) el mismo test
   falla con `13 !== 12` en cuanto entra una migración nueva de la épica. El pgTAP de
   `perfil_usuario.test.sql` ya no usa `on conflict (bucket_id, name)`. **Ambos ya
   resueltos en `dokploy`.**
5. `apps/web/src/lib/mensajeErrorBase.test.ts` → el `describe('log sin PII')` está dentro
   del `describe` que tiene `afterEach(() => { vi.restoreAllMocks() })` y reutiliza el espía
   (`vi.mocked(console.error)`). **Ya resuelto en `dokploy`.**
6. `grep -rn "test:tooling" .github/workflows/` → sin resultados: la suite de tooling (que
   incluye el test corregido de MSF-631) **no corría en ningún job del CI**; el arreglo de
   MSF-631 sólo era verificable en local.

## Suspected Code Paths

- `apps/web/src/test/renderPanel.tsx` — helper de render sin ninguna referencia en el repo.
- `knip.json` — lista de ignorados: `ignore` (entry points), `ignoreBinaries`,
  `ignoreDependencies`.
- `supabase/functions/chat-ia-responder/index.ts` — import de `sanitizarDato`.
- `packages/ia-navegacion/src/intentarRecuperarPaso.ts` — `abrirInvocacion` /
  `InteraccionEnCurso`.
- `scripts/migraciones-ventas-comprobantes.test.mjs:16` — conteo de migraciones de la épica.
- `supabase/tests/database/perfil_usuario.test.sql` — test 11 (upsert de la foto de perfil).
- `apps/web/src/lib/mensajeErrorBase.test.ts` — espía de `console.error`.
- `.github/workflows/validate.yml` — job `application`: pasos de test deterministas.

## Root Cause Hypothesis

Los cuatro son la misma clase de debt: **supuestos del repo que nadie vuelve a mirar**
—qué archivos están vivos, qué cuenta el entorno, qué versión de Storage hay— y herramientas
de calidad que los reportan una vez y quedan sin actuar. Confianza: alta (verificado con
`knip`, `oxlint` y los tests sobre el árbol de `origin/dokploy`).

## Proposed Remediation

**Preferred**:

1. **MSF-584**: borrar el código muerto confirmado (`apps/web/src/test/renderPanel.tsx`) y
   sacar su entrada de la lista de ignorados de `knip.json` — el archivo no se esconde, se
   borra; `knip` queda en 0 hallazgos sin máscaras. Verificar que
   `apps/web/src/hooks/useFeatureHabilitada.ts` está en uso (lo está: lo consume
   `components/service/RequiereServiceTecnico.tsx`) y que `knip.json` declara los entry
   points reales (Edge Functions, fixtures), los binarios de la plataforma
   (`pg_prove`, `graphify`, `ffmpeg`, `tailscale`) y `@playwright/test`.
2. **MSF-745 / MSF-631 / MSF-753**: ya resueltos en `dokploy` (commits `b9a246cf`,
   `802ceb3f`, `d4578a31` + `fe1898c0` + `5266c863`); esta historia los consolida, los
   verifica y **los vigila** con un guardián que falla si alguno se deshace.
3. **Hueco de verificación**: la suite `pnpm test:tooling` no corría en el CI. Cablearla
   al job `application` (Node puro, sin base, ~4 s) para que el test corregido de MSF-631
   y el guardián se ejecuten en cada PR.

**Alternatives** (opcional):

- Dejar `renderPanel.tsx` y mantenerlo en la lista de ignorados de knip: conserva el
  helper por si un test futuro lo usa, pero deja código muerto oculto y contradice la
  propuesta del ítem («borrar el código muerto confirmado»). Descartado.
- Arreglar los 219 warnings `react(set-state-in-effect)` y los 16 `exhaustive-deps`:
  el repo ya los dispositionó el 2026-11-15 (ver `docs/calidad.md`): reinician
  formularios o recargan datos al abrir diálogos o cambiar de empresa, y quitar el efecto
  o una dependencia cambia el comportamiento de la pantalla. Descartado acá: es un lote
  aparte con su propia revisión visual.

**Files likely to change**:

- `apps/web/src/test/renderPanel.tsx` (borrado), `knip.json`
- `scripts/higiene-codigo.test.mjs` (nuevo), `package.json` (`test:tooling`)
- `.github/workflows/validate.yml` (job `application`)
- `docs/calidad.md`
- `.specify/bugs/msf-878/{assessment,fix,test}.md`

**Tests to add or update**:

- `scripts/higiene-codigo.test.mjs` — guardián de los cuatro hallazgos: configuración de
  knip y ausencia del helper borrado; hook en uso; import y tipo sin uso que no vuelven;
  el test de migraciones con una migración nueva de la épica (fallaría con el conteo
  exacto); el pgTAP sin `on conflict (bucket_id, name)`; el espía de `console.error`
  creado una sola vez y dentro del bloque que restaura los mocks.

## Risks & Considerations

- No se tocan migraciones, RLS, esquemas, secretos ni dependencias: el diff es de
  higiene, configuración de lint y CI.
- Borrar `renderPanel.tsx` no rompe nada: no hay referencias (grep sobre `apps`,
  `packages`, `workers`, `scripts`, `docs`, `design`, `infra`, `supabase` y `.github`).
- Agregar un paso al CI aumenta el tiempo del job `application` en ~4 s (Node puro, sin
  base ni Docker) y hace visible una suite que hasta ahora sólo corría en local.
- Los warnings de oxlint (`set-state-in-effect`, `refs`, `exhaustive-deps`) **no** se tocan:
  su disposición documentada está en `docs/calidad.md` y cambiarlos altera el
  comportamiento de las pantallas.

## Open Questions

- Ninguna bloqueante. Queda como seguimiento, con dueño, el pago de los warnings de
  efectos que el repo ya dispositionó (`docs/calidad.md`): no entra en este lote.
