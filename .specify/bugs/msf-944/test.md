# Bug Verification: Retención y supresión de consultas, ítems y presupuestos de la tienda (MSF-944)

- **Slug**: msf-944
- **Tested**: 2026-11-18
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

Las comprobaciones estáticas y de contrato pasan (lint, build, docs, DER, flow de Kestra) y el
pgTAP nuevo cubre la reproducción del assessment. La ejecución del pgTAP no fue posible en este
entorno (sin acceso al socket de Docker ni CLI de Supabase): queda pendiente de CI.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | Inspección de la migración `20270507200101` | pass | existen `private.purgar_consultas_tienda`, `private.suprimir_titular_tienda`, `consulta_id` con FK en cascada y `suprimido_en`; ya no hay camino sin purga ni supresión |
| New / updated tests | `supabase test db` (pgTAP) | not-run | sin Docker/CLI en el entorno; `consultas_retencion.test.sql` (`plan(72)`) y `tienda_presupuesto_cliente.test.sql` se ejecutan en el job `database` |
| Flow contract test | `pnpm test:kestra:purgar-consultas-tienda` | pass | 4/4 |
| Regression suite | `pnpm lint` | pass | solo warnings preexistentes de React |
| Build | `pnpm build` | pass | bundle OK |
| Docs / migraciones | `pnpm docs:check` | pass | 1 migración nueva contra `origin/dokploy` |
| DER | `pnpm der:check` | pass | `specs/…-retencion-y-supresion-consultas-tienda/spec.md: DER OK` |

## Output Excerpts

```
✔ purgar-consultas-tienda tiene un trigger Schedule diario
✔ la purga llama a la función de retención con el rol de servicio
✔ un fallo de la purga avisa y no se traga el error
✔ la variable de retención se declara en el Compose y en .env.example
ℹ pass 4  ℹ fail 0
```

```
Migraciones OK: 754 archivo(s), 1 nuevo(s) contra origin/dokploy.
DER OK (1 spec/s).
```

## Residual Risks

- El pgTAP no se ejecutó localmente; la primera corrida real será en CI.
- La purga borra datos sin vuelta atrás: solo se recuperan desde un backup (declarado en la
  migración y en la spec).

## Recommendation

Cerrar el bug cuando el CI deje en verde los jobs `database` (pgTAP, incluido
`consultas_retencion.test.sql`) y `validacion` (lint, build, docs, DER y contrato de Kestra). Hasta
entonces el estado es `partial` por la ejecución pendiente, no por una falla observada.
