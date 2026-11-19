# Bug Fix: fecha de vencimiento de los gates del tracker

- **Slug**: msf-909
- **Fixed**: 2026-11-19
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El board del tracker no tenía escrito el plazo de los gates: los ítems con
`gate`/`decision`/`escala-humano` esperaban decisión con `dueDate` vacío. Se agregó
`scripts/vencimientos-gates.mjs`, un barrido idempotente que les pone la fecha de
vencimiento del contrato de vitalidad (24 h desde que el ítem empezó a esperar, en
`America/Argentina`), con simulación por defecto y escritura sólo con `--aplicar`.
No se decidió el contenido de ningún gate: sólo la fecha.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/vencimientos-gates.mjs` | added | Selecciona gates sin fecha que esperan decisión, calcula `statusSince + 24 h` en `America/Argentina` y, con `--aplicar`, hace `PATCH /issues/{id}` con **sólo** `dueDate`. |
| `scripts/vencimientos-gates.test.mjs` | added | Fija la regla: qué es un gate, qué es esperar, el cálculo con borde de medianoche, idempotencia, PATCH sólo con `dueDate`, simulación sin escritura y error del board no silenciado. |
| `package.json` | modified | Nuevo `test:vencimientos:gates`, encadenado en `pnpm test`. |
| `.github/workflows/validate.yml` | modified | El job `chequeos` corre `test:vencimientos:gates` (Node puro, sin base ni red). |
| `docs/tecnico/gates-vitalidad.md` | added | La regla, cómo se aplica, cómo se verifica y cómo se revierte. |
| `docs/README.md` | modified | Índice de documentación técnica. |
| `mkdocs.yml` | modified | Nav del sitio. |

## Diff Highlights

```js
export function fechaVencimiento(desde, horas = HORAS_PLAZO, zona = ZONA) {
  const instante = new Date(desde)
  if (Number.isNaN(instante.getTime())) throw new Error(`Fecha inválida: ${desde}`)
  return fechaEnZona(new Date(instante.getTime() + horas * 3600 * 1000), zona)
}

export function seleccionarGates(items, { etiquetas, columnas }) {
  return items.filter(
    (item) => esGate(item, etiquetas) && esperaDecision(item, columnas) && !item.dueDate,
  )
}
```

El cliente PATCH manda sólo el campo `dueDate`; el test lo verifica porque mandar
`labelIds` en el mismo PATCH reemplazaría las etiquetas del ítem.

## Tests Added or Updated

- `scripts/vencimientos-gates.test.mjs::la fecha de vencimiento es el plazo del contrato contado desde que el ítem espera` — `statusSince + 24 h` en la zona del board, bordes de medianoche y fecha inválida.
- `…::un ítem es gate si lleva gate, decision o escala-humano` — la etiqueta `espera-dependencia` no es gate.
- `…::un ítem espera decisión mientras no está archivado ni en una columna terminal` — columnas `completed` y archivados quedan fuera.
- `…::se seleccionan los gates sin fecha que esperan decisión` — idempotencia (`dueDate` ya puesto no se toca).
- `…::el plan usa desde cuándo espera el ítem y, si falta, cuándo se creó` — fallback a `createdAt`.
- `…::el PATCH manda sólo la fecha: mandar etiquetas las reemplazaría` — cuerpo del PATCH.
- `…::el barrido simula sin escribir y aplica con un PATCH por ítem` — simulación vs `--aplicar`.
- `…::un error del board no se silencia` — el fallo se propaga con contexto.

## Local Verification

- Commands run: `pnpm test:vencimientos:gates` → 8 tests, 8 pass, 0 fail.
- Commands run: `node scripts/docs-check.mjs` → `Documentación OK.` (220 páginas, 2003 links, JSON de inventario y 15 diagramas).
- Commands run: `node -e "JSON.parse(...package.json...)"` → `package.json OK`.
- Board (sólo lectura, simulación): `node scripts/vencimientos-gates.mjs` → 19 gates sin fecha de 830 ítems.
- Board (aplicación): `node scripts/vencimientos-gates.mjs --aplicar` → `Fecha puesta en 19 ítem(s).`
- Board (verificación): `node scripts/vencimientos-gates.mjs` → **0 gates sin fecha**; `GET /issues/1145` (MSF-909) → `dueDate: "2026-11-15"`, `statusSince: "2026-11-14T18:52:03.189Z"` (24 h en `America/Argentina`, 2026-11-15).

## Deviations from Assessment

Ninguna. El assessment pedía una herramienta + test + documentación + CI, y eso es lo
que se hizo. La única precisión es que el step del workflow quedó en el job `chequeos`
(la CI de la base ya separó ahí las suites de Node puro), no en `application`.

## Follow-ups

- Que el gate **nazca** con `dueDate` es un cambio del flujo del orquestador
  (`ai-dev-orchestrator`, otro repo): esta herramienta es un barrido idempotente que se
  puede volver a correr. Queda anotado en `docs/tecnico/gates-vitalidad.md` y como
  seguimiento de MSF-909 en el tracker.
- Correr el barrido real con `--aplicar` cuando el entorno tenga `ITSAPLAN_API_KEY` y
  verificar con la simulación en 0.
