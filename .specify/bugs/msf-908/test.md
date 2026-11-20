# Bug Verification: el board del tracker tenía duplicados sin unificar y el barrido que los debía ver mentía

- **Slug**: msf-908
- **Tested**: 2026-11-21
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

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (antes del fix) | `node scripts/auditar-duplicados-tracker.mjs` sobre el board real (831 ítems) | pass | El síntoma se ve: `C) MSF-476 (Review In DEV; labels: seguimiento) → gemelo con evidencia: MSF-477`; 1 por unificar |
| Reproducción (después del fix) | el mismo comando | pass | `C) (ninguno)`, `D) (ninguno)`; `1 duplicado(s) real(es) (0 sin unificar)`; el par aparece como `ya unificado (MSF-476 → MSF-477)` |
| Unificación en el board | `GET /issues/{643,641,642}` y `GET /issues/{644,639,640}` | pass | MSF-476 labels `[649, 585]` → MSF-477 · MSF-473 labels `[645, 649, 585]` → MSF-471 · MSF-474 labels `[649, 585]` → MSF-472. Ningún ítem borrado, ninguno movido de columna, MSF-472 sigue archivado |
| New / updated tests | `node --test scripts/auditar-duplicados-tracker.test.mjs` | pass | 21/21 |
| New / updated tests (suite que corre el CI) | `pnpm test:tooling` | pass | 77 casos: el archivo nuevo está en la lista explícita de `test:tooling`, que es la que corre el job `chequeos` |
| Los tests detectan la regla | mutación deliberada del script (4 cambios) y reversión | pass | 2 tests fallan al borrar la etiqueta inicial al normalizar; 1 falla al quitar la exclusión del gemelo ya cerrado; 1 falla al tratar las familias como duplicados; 1 falla al dejar de contar la relación `duplicates` |
| Regression suite (tooling) | `node --test scripts/*.test.mjs` | pass | 619 casos: 618 pasan, 0 fallan, 1 omitido (skip previo de la base). El glob toma el archivo nuevo |
| Lint | `pnpm lint` (oxlint sobre `apps/web`) | pass | exit 0; sólo los warnings preexistentes de `apps/web`, que esta historia no toca |
| Build | `pnpm build` | pass | `✓ built in 1.49s` |
| Documentación | `pnpm docs:check` | pass | `Documentación de cambios: OK` + `Migraciones OK: 771 archivo(s), 0 nuevo(s)` + `Documentación OK.` |
| Drift de documentación | `node scripts/docs-drift.mjs` | pass | `docs/tecnico/operacion.md` no aparece entre las 18 páginas con fuente cambiada (deuda previa de la base) |
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
   · [seg. msf-470] + MSF-119: MSF-472, MSF-473 (duplica a MSF-471), MSF-471, MSF-474 (duplica a MSF-472)

C) Cerrados sin `cierre-administrativo` con un gemelo que sí tiene evidencia
   (ninguno)

D) Marcado como duplico (`duplicates`) pero sin `cierre-administrativo`
   (ninguno)

Resumen: 1 grupo(s) con título idéntico · 1 duplicado(s) real(es) (0 sin unificar) · 5 familia(s) por referencia · 0 por unificar · 0 sin cierre administrativo.
```

Suite nueva:

```
ℹ tests 21
ℹ pass 21
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
- **Los conteos del board bajaron en 3 ítems cerrados administrativamente**: si alguna épica usaba el
  número de ítems cerrados como condición de cierre, hay que revisarlo (riesgo que ya había
  anotado la assessment).

## Recommendation

Cerrar el bug — verificado end-to-end sobre el board real: los 3 pares de duplicado quedaron
unificados con el mecanismo existente (label `cierre-administrativo`, relación `duplicates` y
comentario con el puntero), el barrido determinista quedó en el repo con 21 tests que vigilan la
normalización y el criterio de duplicado, y la documentación describe la regla.
