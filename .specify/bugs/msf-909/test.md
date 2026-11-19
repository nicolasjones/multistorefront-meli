# Bug Verification: fecha de vencimiento de los gates del tracker

- **Slug**: msf-909
- **Tested**: 2026-11-19
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

El síntoma ya no se reproduce: el barrido detecta los gates que esperan decisión,
les pone la fecha de vencimiento del contrato (24 h desde `statusSince` en
`America/Argentina`) y una segunda simulación da **0** gates sin fecha. La regla queda
fijada por tests y la documentación explica cómo aplicarla y revertirla.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (antes) | `node scripts/vencimientos-gates.mjs` | pass (síntoma reproducido) | 19 gates sin fecha de 830 ítems del board; el reporte hablaba de 23 medidos el 2026-11-13. |
| Corrección (aplicar) | `node scripts/vencimientos-gates.mjs --aplicar` | pass | `Fecha puesta en 19 ítem(s).` |
| Reproducción (después) | `node scripts/vencimientos-gates.mjs` | pass (0) | `Gates sin fecha de vencimiento en MSF: 0 de 830 ítems del board.` |
| Ítem puntual | `GET /issues/1145` | pass | MSF-909: `dueDate: "2026-11-15"`, `statusSince: "2026-11-14T18:52:03.189Z"`. |
| New / updated tests | `pnpm test:vencimientos:gates` | pass | 8 tests, 8 pass, 0 fail. |
| Documentación | `node scripts/docs-check.mjs` | pass | `Documentación OK.` |
| package.json | `node -e "JSON.parse(...)"` | pass | `package.json OK`. |
| Regression suite | `pnpm test` (suite completo) | not-run | Se corre en el PR/CI; local sólo las suites del área (Node puro, sin base). |
| Lint / type-check | `pnpm lint` / build | not-run | El cambio no toca `apps/web`; CI corre lint y build. |

## Output Excerpts

```
Gates sin fecha de vencimiento en MSF: 19 de 830 ítems del board.
  MSF-909  En curso  vence 2026-11-15  [Auditoría] 23 gates esperando decisión sin fecha de vencimi
...
Fecha puesta en 19 ítem(s).
```

```
Gates sin fecha de vencimiento en MSF: 0 de 830 ítems del board.
```

```
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

## Residual Risks

- Los gates que nacen después siguen sin fecha: la prevención en la creación vive en
  el orquestador (otro repo). La herramienta es idempotente y se puede re-correr.
- La fecha que se escribe es la de vencimiento del contrato (puede quedar en el pasado
  para gates ya vencidos): es lo que el reporte pide para que el board muestre que la
  decisión está vencida.
- La aplicación se hizo con la clave del entorno; la reversión documentada es
  `PATCH /issues/{id}` con `{"dueDate": null}`.

## Recommendation

Cerrar el bug: verificado sobre el board real (19 → 0) y con tests que fijan la regla.
