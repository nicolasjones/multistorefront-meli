# Decision: Consultas y ventas · clientes, pedidos y facturación

- **Slug**: clientes-pedidos-y-facturacion
- **Decided**: 2026-11-13 (propuesta del analista; la decisión es de Nicolás)
- **Verdict**: kill (como épica propia; el alcance se absorbe, no se descarta)
- **Artifacts reviewed**: intake.md, research.md, problem.md, concept.md

## Scorecard

| Criterion | Rating | Justification |
|-----------|--------|---------------|
| Problem validity | weak | La parte válida (cuenta, historial) es F-CLI-20; pedidos y facturación ya son de Ventas y despacho |
| Evidence strength | weak | Sin demanda ni requisitos |
| Value vs. inaction | weak | El único costo de no hacerla es tablero duplicado |
| Feasibility / appetite | strong | Cerrar y enlazar es trabajo de tablero |
| Strategic fit | weak | P3, fuera del alcance acordado |
| Risk posture | strong | Sin código no hay riesgo |

## Verdict & Rationale

**kill de MSF-154 como épica**, con absorción de F-CON-07 en F-CLI-20 (MSF-452). No queda alcance propio: pedidos y facturación fueron reemplazados por Ventas y despacho, las cuentas están en cuenta web, y el modelo de contactos (MSF-144) ya existe. Mantenerla genera una dependencia circular con MSF-176. Reversible: si el cliente pide trazabilidad consulta → entrega o cobro/ARCA, se abre una épica nueva con requisitos.

## Preguntas de negocio para Nicolás / el cliente

1. [NEEDS CLARIFICATION: ¿Aprobás cerrar MSF-154 y fusionar MSF-284 y MSF-341 en MSF-452?] Recomendación: sí.
2. [NEEDS CLARIFICATION: ¿El cliente necesita seguir un pedido desde la consulta hasta la entrega dentro del sistema?] Recomendación: preguntarlo junto con las de `tienda-compra-y-cuentas`; si sí, épica nueva (opción C).
3. [NEEDS CLARIFICATION: ¿ARCA con qué ERP y cuándo?] Recomendación: spec propia solo cuando el cliente lo exija; hoy los comprobantes son internos.
4. Las preguntas sobre pagos, envíos, stock y cuentas obligatorias son las de `.specify/assessments/tienda-compra-y-cuentas/decision.md`.

## If needs-clarification

No aplica.

## If go — Handoff to `/speckit-specify`

No aplica. La historia que sigue es F-CLI-20 (MSF-452) y su evaluación está en `.specify/assessments/tienda-compra-y-cuentas/`.

## Épicas a cerrar antes

Ninguna: MSF-144, MSF-167 y MSF-237 ya están terminadas en el flujo (Review In DEV). Pendiente de tablero: resolver la dependencia circular F-TDA-27 ↔ F-CON-07.
