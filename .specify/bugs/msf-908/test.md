# Bug Verification: el board del tracker tenía duplicados sin unificar y el barrido que los debía ver mentía

- **Slug**: msf-908
- **Tested**: 2026-11-21 (cierre) · 2026-11-22 (devolución del Revisor: cobertura del barrido)
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma del reporte (12 pares de ítems con título idéntico que se trabajan dos veces) **no se
reproduce** con la normalización que el reporte documenta: hay **1 par real** (MSF-476/MSF-477) y 2
pares de casi-duplicado con otra redacción (MSF-471/MSF-473 y MSF-472/MSF-474). Los tres quedaron
unificados en el board con el mecanismo `cierre-administrativo` + relación `duplicates` + comentario
con el puntero, sin borrar nada. El barrido determinista quedó en el repo: antes de la unificación
reportaba 1 ítem por unificar; ahora el board da 0 y el reporte es reproducible.

**Devolución del Revisor (2026-11-22).** El barrido tampoco cubría todo el board: leía por `typeId`
(los 6 ítems sin tipo quedaban fuera) y pedía el detalle de un subconjunto (la sección D no veía el
resto de las relaciones `duplicates`). Con la cobertura corregida aparecieron dos casos reales que
el barrido no veía y que se unificaron en el board: **MSF-859 → MSF-931** (el re-reporte sin padre:
el duplicado que el reporte pedía eliminar) y **MSF-606** (ya marcado `duplicates` → MSF-597 pero sin
el label del mecanismo). El board queda con `C) (ninguno)` y `D) (ninguno)`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (antes del fix) | `node scripts/auditar-duplicados-tracker.mjs` sobre el board real (831 ítems) | pass | El síntoma se ve: `C) MSF-476 (Review In DEV; labels: seguimiento) → gemelo con evidencia: MSF-477`; 1 por unificar |
| Reproducción (después del fix) | el mismo comando | pass | `C) (ninguno)`, `D) (ninguno)`; `1 duplicado(s) real(es) (0 sin unificar)`; el par aparece como `ya unificado (MSF-476 → MSF-477)` |
| Unificación en el board | `GET /issues/{643,641,642}` y `GET /issues/{644,639,640}` | pass | MSF-476 labels `[649, 585]` → MSF-477 · MSF-473 labels `[645, 649, 585]` → MSF-471 · MSF-474 labels `[649, 585]` → MSF-472. Ningún ítem borrado, ninguno movido de columna, MSF-472 sigue archivado |
| *(devolución)* Cobertura del board | el mismo comando, con la cobertura corregida (840 ítems) | pass | El encabezado informa `840 ítems leídos (789 activos + 51 archivados)`: los 6 ítems sin tipo (MSF-859/MSF-931 entre ellos) ya entran |
| *(devolución)* Caso que faltaba | el mismo comando, antes de unificar | pass | `A) CANDIDATO A DUPLICADO (mismo título; MSF-931 sin padre): MSF-859, MSF-931 — revisar si es duplicado` y `D) · MSF-606 → MSF-597` |
| *(devolución)* Unificación de los dos casos | `GET /issues/1093` y `GET /issues/790` | pass | MSF-859 labels `[918, 585]` + `duplicates/outward/MSF-931` + comentario con el puntero · MSF-606 labels `[585]` + `duplicates/outward/MSF-597` (relación que ya estaba) + comentario. Ninguno borrado, ninguno movido de columna, ninguno des-archivado |
| *(devolución)* Barrido después de unificar | `node scripts/auditar-duplicados-tracker.mjs` | pass | `C) (ninguno)` · `D) (ninguno)`; el par sale como `ya unificado (MSF-859 → MSF-931)`; `Resumen: 2 grupo(s) con título idéntico · 1 duplicado(s) real(es) (0 sin unificar) · 1 candidato(s) sin padre · 7 familia(s) por referencia · 0 por unificar · 0 sin cierre administrativo.` |
| New / updated tests | `node --test scripts/auditar-duplicados-tracker.test.mjs` | pass | 30/30 |
| New / updated tests (suite que corre el CI) | `pnpm test:tooling` | pass | El archivo nuevo está en la lista explícita de `test:tooling`, que es la que corre el job `chequeos` |
| Los tests detectan la regla | mutación deliberada del script y reversión | pass | Borrar la etiqueta inicial al normalizar → 2 tests fallan; quitar la exclusión del gemelo ya cerrado → 1; tratar las familias como duplicados → 1; dejar de contar la relación `duplicates` → 1; volver a filtrar el board por `typeId` → 1; pedir el detalle de un subconjunto → 1; volver a contar todo Implementation Report como evidencia → 2 |
| Regression suite (tooling) | `node --test scripts/*.test.mjs` | pass | El glob toma el archivo nuevo |
| Lint | `pnpm lint` (oxlint sobre `apps/web`) | pass | exit 0; sólo los warnings preexistentes de `apps/web`, que esta historia no toca |
| Build | `pnpm build` | pass | exit 0 |
| Documentación | `pnpm docs:check` | pass | `Documentación de cambios: OK` + `Migraciones OK` + `Documentación OK.` |
| Drift de documentación | `node scripts/docs-drift.mjs` | pass | `docs/tecnico/operacion.md` no aparece entre las páginas con fuente cambiada (deuda previa de la base) |
| Sin credencial | `ITSAPLAN_API_KEY` ausente | pass | El barrido avisa y sale con 0 (no rompe el CI) |

## Output Excerpts

Barrido **antes** de unificar (el síntoma):

```
C) Cerrados sin `cierre-administrativo` con un gemelo que sí tiene evidencia
   · MSF-476 (Review In DEV; labels: seguimiento) → gemelo con evidencia: MSF-477

Resumen: 1 grupo(s) con título idéntico · 1 duplicado(s) real(es) · 5 familia(s) por referencia · 1 por unificar · 0 sin cierre administrativo.
```

Barrido **después** de unificar:

```
A) Títulos idénticos (la etiqueta inicial se conserva)
   · [MSF-470] Bloqueo de acceso server-side (Auth Hook de verificación de contraseña)
     MSF-476 (Review In DEV, padre MSF-119) · MSF-477 (Review In DEV, padre MSF-119)
     DUPLICADO REAL (mismo padre): MSF-476, MSF-477 — ya unificado (MSF-476 → MSF-477)

B) Familias por referencia + mismo padre (informativo: compartir referencia no es ser duplicado)
   · [seg. msf-470] + MSF-119: MSF-472, MSF-473 (duplica a MSF-471), MSF-474 (duplica a MSF-472), MSF-472

C) Cerrados sin `cierre-administrativo` con un gemelo que sí tiene evidencia
   (ninguno)

D) Marcado como duplico (`duplicates`) pero sin `cierre-administrativo`
   (ninguno)

Resumen: 1 grupo(s) con título idéntico · 1 duplicado(s) real(es) (0 sin unificar) · 5 familia(s) por referencia · 0 por unificar · 0 sin cierre administrativo.
```

Barrido con la **cobertura corregida** (devolución), antes de unificar los dos casos que aparecieron:

```
Barrido de duplicados · proyecto MSF · 840 ítems leídos (789 activos + 51 archivados)

A) Títulos idénticos (la etiqueta inicial se conserva)
   · Seguimiento CI: pasar el job e2e-tienda a requerido
     MSF-859 (Review In DEV, padre MSF-647) · MSF-931 (Review In DEV, padre sin padre)
     CANDIDATO A DUPLICADO (mismo título; MSF-931 sin padre): MSF-859, MSF-931 — revisar si es duplicado

D) Marcado como duplico (`duplicates`) pero sin `cierre-administrativo`
   · MSF-606 → MSF-597
```

Barrido con la cobertura corregida, **después** de unificarlos:

```
A) Títulos idénticos (la etiqueta inicial se conserva)
   · Seguimiento CI: pasar el job e2e-tienda a requerido
     MSF-859 (Review In DEV, padre MSF-647) · MSF-931 (Review In DEV, padre sin padre)
     CANDIDATO A DUPLICADO (mismo título; MSF-931 sin padre): MSF-859, MSF-931 — ya unificado (MSF-859 → MSF-931)

C) Cerrados sin `cierre-administrativo` con un gemelo que sí tiene evidencia
   (ninguno)

D) Marcado como duplico (`duplicates`) pero sin `cierre-administrativo`
   (ninguno)

Resumen: 2 grupo(s) con título idéntico · 1 duplicado(s) real(es) (0 sin unificar) · 1 candidato(s) sin padre · 7 familia(s) por referencia · 0 por unificar · 0 sin cierre administrativo.
```

Suite nueva:

```
ℹ tests 30
ℹ pass 30
ℹ fail 0
```

## Residual Risks

- **El número «12» del reporte queda desmentido, no reproducido**: con la normalización que el
  propio reporte documenta hay 1 par real. Si la próxima auditoría usa otra normalización (borrar
  cualquier etiqueta inicial) vuelve a obtener 12; por eso la normalización quedó versionada y con
  test, y la regla está escrita en `docs/tecnico/operacion.md`.
- **El origen del problema no está cerrado**: el orquestador sigue abriendo un ítem por reporte sin
  buscar el que ya existe. Eso vive fuera de este repo (paso 4 de la assessment) y queda trazado
  como seguimiento.
- **El barrido lee el board, no lo escribe**: la unificación se hizo con la API del tracker y quedó
  registrada en el feed de cada ítem; no hay script en el repo que la aplique (es una operación de
  datos, no una funcionalidad).
- **Los conteos del board bajaron en ítems cerrados administrativamente**: si alguna épica usaba el
  número de ítems cerrados como condición de cierre, hay que revisarlo (riesgo que ya había
  anotado la assessment).
- **MSF-606 y MSF-597 no tienen el mismo título**: son dos ítems del mismo alcance (el rol Técnico
  sin empresa/tienda asignable) y el board ya los había enlazado con `duplicates`. Se completó el
  mecanismo (label + comentario) sin borrar nada; el PR #634 de MSF-606 quedó mergeado en `dokploy`
  y así lo dice el comentario.

## Recommendation

Cerrar el bug — verificado end-to-end sobre el board real: los 4 pares de duplicado quedaron
unificados con el mecanismo existente (label `cierre-administrativo`, relación `duplicates` y
comentario con el puntero), el barrido determinista quedó en el repo con 30 tests que vigilan la
normalización, el criterio de duplicado, la cobertura del board y la definición de evidencia, y la
documentación describe la regla.
