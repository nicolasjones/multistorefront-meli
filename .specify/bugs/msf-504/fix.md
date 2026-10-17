# Fix: MSF-504 — [Seg. MSF-301] Hallazgos fuera de alcance (2)

**Sin cambio de código: absorbida por MSF-301 (decisión del CTO).** No es un bug de producto: el hallazgo era de secuencia («M1/T002 no existe; implementar F-CLI-01 antes de T003/T013») y su premisa ya está resuelta.

- Los «2 hallazgos» son el mismo texto duplicado (la US de seguimiento no deduplicó el hallazgo).
- F-CLI-01 (MSF-262) quedó en la épica (merge del PR #83, `d9a1b5f`): `supabase/migrations/20261016130000_clientes_ficha_y_numeracion.sql` (M1, T002 `[x]`) y `20261016130200_clientes_rls_por_seccion_y_actividad.sql` (M3).
- `feat/story-MSF-301` quedó desfasada de la épica (atrás 10 / adelante 7): sin M1/M3 y con T003 tildada sin la migración M2.
- Lo que resta (M2 = T003, pgTAP/Vitest, T013) es alcance de MSF-301, que sigue abierta; en la `tasks.md` de la épica siguen `[ ]` y MSF-504 no las toma (no se tildan acá).

## Acciones para el flujo
- Cerrar MSF-504 como absorbida por MSF-301.
- Actualizar `feat/story-MSF-301` desde la rama de la épica y retomar T003/T013; volver a tildarlas solo con evidencia (M2 + pgTAP/Vitest).
- Proceso: deduplicar y validar el hallazgo al crear la US `[Seg. …]` y no despachar el flujo de bug si no es de producto.

Reversión: nada que revertir (solo este informe).
