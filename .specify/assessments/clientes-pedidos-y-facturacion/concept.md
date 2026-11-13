# Concept: Consultas y ventas · clientes, pedidos y facturación

- **Slug**: clientes-pedidos-y-facturacion
- **Created**: 2026-11-13
- **Recommended option**: B (absorber en F-CLI-20 y cerrar la épica)

Las opciones de alcance de las funciones de tienda (A, B1, B2, C) están en `.specify/assessments/tienda-compra-y-cuentas/concept.md`. Para MSF-154 las alternativas son de gestión del alcance:

## Options

### Option A — Mantener la épica en Backlog tal como está
- **Sketch**: no se toca; se retoma «cuando el cliente confirme demanda».
- **Appetite**: small (cero ahora).
- **Trade-offs**: sin costo, pero deja la duplicación y la dependencia circular; el tablero engaña.
- **Rabbit holes**: alguien especifica F-CON-07 por su lado y rehace la cuenta.

### Option B — Absorber F-CON-07 en F-CLI-20 y cerrar MSF-154
- **Sketch**: F-CLI-20 (MSF-452) es la única historia de cuenta, historial y favoritos; MSF-284 y MSF-341 se cierran como duplicadas (se enlazan a MSF-452); MSF-154 se cierra con nota «alcance absorbido por Ventas y despacho (pedidos, facturación) y cuenta web (cuentas)». Pagos y ARCA quedan como ideas separadas dentro de lo que MSF-176 decida.
- **Appetite**: small (trabajo de tablero, sin código).
- **Trade-offs**: limpia el tablero y elimina la circularidad; sacrifica la «épica de pedidos de la consulta a la entrega» como idea (si el cliente la quiere se reabre con requisitos).
- **Rabbit holes**: discutir si «de la consulta a la entrega» es una necesidad real y no un título.

### Option C — Convertirla en una épica real de trazabilidad (consulta → presupuesto → entrega)
- **Sketch**: vincular `dominio.consultas` con comprobantes (columna de origen), botón «Crear presupuesto» en la bandeja y un historial unificado.
- **Appetite**: medium.
- **Trade-offs**: valor concreto para operadores; no está pedido por nadie en el tracker.
- **Rabbit holes**: tocar tablas de dos épicas entregadas (consultas y comprobantes).

## Recommendation

Opción B. Si en las respuestas del cliente aparece la necesidad de trazabilidad, abrir la C como épica nueva con requisitos, y no reciclar MSF-154.

## Out of Scope (for the recommended option)

- Cualquier código; pagos; ARCA; pedidos online.

## Assumptions to Validate

- Nicolás acepta cerrar MSF-284 y MSF-341 como duplicadas de MSF-452.
- El cliente no tiene un pedido adicional sobre el seguimiento de pedidos.
