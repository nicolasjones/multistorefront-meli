# Bug Verification: las filas «Cambio de empresa activa» no ocupan la lista de Actividad

- **Slug**: msf-985
- **Tested**: 2026-11-19
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El evento `usuario.empresa_activa_cambiada` se sigue escribiendo en el historial, pero ya no ocupa la lista de
Actividad ni el CSV salvo que se pida ese tipo con el filtro **Tipo**. La regla vive en
`private.tipos_de_contexto_actividad()` y la aplican `public.listar_actividad` y `public.exportar_actividad`, así que
el contador, el listado y el archivo cuentan lo mismo. No se encontraron regresiones en las verificaciones locales.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | pgTAP `actividad_eventos_contexto.test.sql` (13 aserciones; corrida registrada en `fix.md`) | pass | El evento se registra; la lista y el CSV no lo muestran; con `p_tipo` aparece. |
| New / updated tests | `node /tmp/opencode/pgtest/pgtap.mjs supabase/tests/database/actividad_eventos_contexto` (sesión del fix) | pass | 13/13. No se re-ejecutó en esta sesión: no hay Docker ni Postgres en este entorno. |
| Test que vigila la regla | Recrear `listar_actividad`/`exportar_actividad` sin el filtro (sesión del fix) | pass (detecta) | Sin la línea de contexto fallan 5 de las 13 aserciones; con la migración pasan las 13. |
| Regression suite (migraciones aditivas) | `pnpm test:db:validar-aditivas` | pass | 21 tests en verde. |
| Documentación y guard de migraciones | `pnpm docs:check` | pass | «Documentación de cambios: OK. Migraciones OK: 772 archivo(s), 1 nuevo(s) contra origin/dokploy. Trampas conocidas: OK.» |
| Lint | `pnpm lint` | pass | Exit 0; solo warnings preexistentes. |
| Build | `pnpm build` | pass | `✓ built in 2.81s`. |
| pgTAP completo | `pnpm test:db` | not-run | Sin Docker/Supabase local (ver `docs/api-publica.md`): corre en el CI. |
| E2E | — | not-applicable | La historia no agrega criterios de pantalla nuevos: no cambia la UI (el filtro **Tipo** ya existía); la regla es del listado en la base y la cubre el pgTAP. El E2E `actividad-filtros` sigue vigente. |

## Output Excerpts

```
Documentación de cambios: OK (4255 archivos comparados contra 54ea7b1bad793d5968ffe2d1f629128c40f3bee3).
Migraciones OK: 772 archivo(s), 1 nuevo(s) contra origin/dokploy.
Trampas conocidas: OK (1 migración(es), 1 prueba(s) pgTAP y 0 E2E revisados contra origin/dokploy).

ℹ tests 21
ℹ pass 21
ℹ fail 0                       (pnpm test:db:validar-aditivas)

✓ built in 2.81s               (pnpm build)
```

## Residual Risks

- **pgTAP no re-ejecutado localmente**: este entorno no tiene Docker ni Postgres. El test quedó en la suite y el job
  `database` del CI es el que lo corre sobre una base limpia. La corrida local previa (registrada en `fix.md`) ya daba
  13/13 y fallaba sin la migración.
- **Filas históricas**: las filas de contexto ya guardadas no se borran (el registro es inalterable); dejan de
  aparecer en la lista por defecto y siguen visibles pidiendo ese tipo.
- **Descubribilidad**: el tipo sigue en las opciones del filtro **Tipo** porque se derivan del historial.

## Recommendation

Cerrar el bug: la decisión de producto quedó implementada (se conserva el evento y se oculta de la lista y del CSV),
con un pgTAP que falla si la regla se rompe. El único chequeo pendiente es el pgTAP en el CI, por falta de Docker en
este entorno.
