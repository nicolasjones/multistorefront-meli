# Bug Fix: el board del tracker tenía duplicados sin unificar y el barrido que los debía ver mentía

- **Slug**: msf-908
- **Fixed**: 2026-11-21
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El reporte (H10, severidad Media) pedía unificar los ítems con título idéntico del board y cerrar el
duplicado con el mecanismo `cierre-administrativo` ya existente. La assessment ya mide que el «12»
del reporte **no se reproduce** con la normalización que el propio reporte documenta (quitar `[Bug]`,
minúsculas, sin signos): da **1 par real** (MSF-476/MSF-477). El 12 sale de borrar **cualquier**
etiqueta inicial, lo que funde ítems legítimos de épicas distintas (11 de los 12 grupos son falsos
positivos: un ítem de cierre por épica).

El fix hace las dos cosas: **unifica en el board los 3 pares de duplicado real** (MSF-476→MSF-477,
MSF-473→MSF-471, MSF-474→MSF-472) con el mecanismo completo —label `cierre-administrativo`, relación
`duplicates` al ítem que conserva la evidencia y comentario con el puntero, **sin borrar ni mover de
columna**— y **deja el barrido determinista en el repo** (`pnpm tracker:duplicados`) para que la
próxima auditoría dé el mismo número y no vuelva a reportar los falsos positivos.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/auditar-duplicados-tracker.mjs` | added | Barrido del board: normaliza **conservando la etiqueta inicial**; reporta A) títulos idénticos (duplicado real vs falsos positivos), B) familias por referencia (informativo), C) cerrados sin `cierre-administrativo` cuyo gemelo conserva la evidencia, D) marcado `duplicates` pero sin el mecanismo. Sin `ITSAPLAN_API_KEY` avisa y sale con 0. |
| `scripts/auditar-duplicados-tracker.test.mjs` | added tests | 21 casos: la normalización conserva la etiqueta; el gemelo de otro padre no es duplicado; compartir referencia no es motivo para cerrar; el cierre administrativo se detecta y se deja de reportar con el label puesto; la relación `duplicates`; sin credencial el barrido sale con 0. |
| `package.json` | modified | `tracker:duplicados` y `test:tracker:duplicados`; el suite entra en `pnpm test`. |
| `docs/tecnico/operacion.md` | modified | Sección «Higiene del board: duplicados y cierre administrativo (MSF-908)»: la regla de cierre administrativo y qué mira el barrido. |
| `docs/manifest.json` | regenerated | `node scripts/docs-manifest.mjs` (sólo cambia la entrada de `operacion.md`). |
| `.specify/bugs/msf-908/fix.md`, `.specify/bugs/msf-908/test.md` | added | Este reporte y la verificación. |
| *(fuera de git)* board MSF | datos | MSF-476, MSF-473 y MSF-474: label `cierre-administrativo` + relación `duplicates` al ítem que conserva la evidencia + comentario con el puntero. Sin borrados, sin cambio de columna y sin des-archivar nada. |

## Diff Highlights

```js
// La etiqueta inicial del título es parte de la identidad del ítem: quitarla al
// normalizar funde ítems legítimos de épicas distintas (los 11 falsos positivos).
export function normalizarTitulo(titulo) {
  return String(titulo ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
```

```js
// El gemelo que ya se cerró administrativamente es el duplicado: el otro es el que
// conserva la entrega y no se vuelve a marcar.
const gemelos = par.filter(
  (otro) =>
    otro.id !== item.id &&
    evidencia(otro) &&
    sinCierreAdministrativo(otro, idLabelCierre),
);
```

## Tests Added or Updated

- `scripts/auditar-duplicados-tracker.test.mjs::conserva la etiqueta inicial: dos épicas con el mismo texto NO se funden` — si la normalización vuelve a borrar `[...]`, el test falla.
- `…::no reporta como grupo a los ítems de épicas distintas (falsos positivos del barrido viejo)` — el «12» del reporte no puede volver a aparecer como grupo.
- `…::compartir referencia NO es motivo para cerrar: los ítems de una familia no se marcan por unificar` — las 8 referencias de `[Seguimiento MSF-205]` no se cierran en falso.
- `…::un item cerrado sin \`cierre-administrativo\` cuyo gemelo tiene evidencia se reporta` / `…::con el label aplicado ya no se reporta` — el mecanismo del cierre administrativo queda vigilado.
- `…::el ítem que conserva la entrega no se marca cuando su gemelo ya se cerró administrativamente` — no se re-marca al canónico.
- `…::un ítem que ya duplica a otro pero no tiene \`cierre-administrativo\` se reporta` — la relación `duplicates` sin mecanismo se ve.
- `…::el barrido avisa y sale con 0 (no rompe el CI)` — sin `ITSAPLAN_API_KEY` no rompe el CI.

**Los tests detectan la regla** (mutación deliberada, revertida): borrar la etiqueta inicial al
normalizar → 2 tests fallan; quitar la exclusión del gemelo ya cerrado → 1 test falla; tratar las
familias como duplicados → 1 test falla; dejar de contar la relación `duplicates` → 1 test falla.

## Local Verification

- Barrido sobre el board real (831 ítems), **antes** del arreglo:
  `C) MSF-476 (Review In DEV; labels: seguimiento) → gemelo con evidencia: MSF-477`
  → `Resumen: … 1 duplicado(s) real(es) · 5 familia(s) por referencia · 1 por unificar · 0 sin cierre administrativo.`
- Barrido sobre el board real, **después** del arreglo:
  `C) (ninguno)` / `D) (ninguno)`
  → `Resumen: 1 grupo(s) con título idéntico · 1 duplicado(s) real(es) (0 sin unificar) · 5 familia(s) por referencia · 0 por unificar · 0 sin cierre administrativo.`
- `node --test scripts/auditar-duplicados-tracker.test.mjs` → 21/21.
- `pnpm lint` → exit 0 (sólo los warnings preexistentes de `apps/web`, que esta historia no toca).
- `pnpm build` → `✓ built in 1.49s`.
- `pnpm docs:check` → `Documentación de cambios: OK` + `Migraciones OK: 771 archivo(s), 0 nuevo(s)` + `Documentación OK.`
- `node scripts/docs-drift.mjs` → mi página no aparece entre las 18 con fuente cambiada (son deuda previa de la base).

## Deviations from Assessment

- **El barrido no implementa «mismo tema» para los casi-duplicados.** La assessment pedía detectar
  «mismo padre + mismo tema»; «mismo tema» exige inferir intención de la prosa del título, que las
  reglas del repo prohíben (`no uses regex sobre prosa para inferir la intención de un texto`). En
  su lugar las familias por referencia se reportan como **informativas** (compartir referencia no es
  ser duplicado) y los casi-duplicados se detectan **estructuralmente** con la relación `duplicates`
  del board, que el propio barrido verifica contra el mecanismo de cierre (sección D).
- **El puntero al ítem que conserva la evidencia es una relación, no sólo un comentario.** La
  assessment decía «label + comentario»; se agrega además la relación `duplicates` (dup → original),
  que es el dato estructurado que permite al barrido y a la UI mostrar la unificación sin leer prosa.
- **No se cierran los 11 grupos de falsos positivos** ni se renombra ningún ítem: son cierres de
  épica legítimos y renombrarlos tocaría 31 ítems fuera de alcance.
- **El board cambió entre la assessment (2026-11-14) y este fix (2026-11-21)**: MSF-472 fue
  auto-archivado el 2026-11-19 y el flujo regularizó la evidencia de MSF-471/473/474 el 2026-11-17.
  Por eso **no se mueve ningún ítem de columna** (la regla del 2026-11-17 deja la deuda técnica en
  `Review In DEV` hasta la promoción a STG/PRD) ni se des-archiva nada: sólo se agrega el mecanismo
  de cierre y el puntero.
- **Criterio de «conserva la evidencia» por par**: se conserva el ítem con el registro y se cierra el
  otro. En (471, 473) se conserva **MSF-471** (primero, con `Implementation Report`) y en (472, 474)
  se conserva **MSF-472** (primero, con `Implementation Report`; está archivado, por eso el puntero
  del comentario apunta también a **MSF-470**, donde está la entrega consolidada). En (476, 477) se
  conserva **MSF-477** (tiene PR #30 y los cuatro informes de revisión).

## Follow-ups

- **El orquestador debe buscar antes de abrir un ítem** (paso 4 de la assessment): antes de crear
  uno, buscar en el board otro con la misma referencia/etiqueta y el mismo título normalizado, y
  sumar la evidencia al existente. Es la única forma de cortar la creación de duplicados en origen
  y vive fuera de este repo (orquestador), así que no se puede cerrar acá: queda trazado para el
  equipo del orquestador.
- **Las 5 familias por referencia** que siguen en el barrido son informativas y se deja así: bajo
  `[Seguimiento MSF-205]` hay 8 seguimientos distintos y bajo `[Seg. MSF-180]` hay 3 hallazgos
  distintos; cerrarlos en falso sería el mismo error que el del barrido viejo.
