# Decision: Tienda · compra online y cuentas de clientes

- **Slug**: tienda-compra-y-cuentas
- **Decided**: 2026-11-13 (propuesta del analista; la decisión es de Nicolás)
- **Verdict**: needs-clarification
- **Artifacts reviewed**: intake.md, research.md, problem.md, concept.md

## Scorecard

| Criterion | Rating | Justification |
|-----------|--------|---------------|
| Problem validity | adequate (cuentas) / unknown (compra online) | Falta historial/favoritos; para comprar en línea no hay evidencia de que el negocio lo quiera |
| Evidence strength | weak | Solo el tracker y el código; sin datos de consultas ni voz del cliente |
| Value vs. inaction | unknown | Costo actual de transcribir consultas no medido |
| Feasibility / appetite | strong para A y B1; weak para C | Se reutiliza cuenta web, bandeja, comprobantes; C exige pagos, envíos y fiscal inexistentes |
| Strategic fit | weak hoy | P3, «fuera» del alcance acordado |
| Risk posture | adequate (A, B1) / weak (B2, C) | RLS, datos personales y función pública que crea comprobantes; C suma pagos y fiscal |

## Verdict & Rationale

**needs-clarification** para MSF-176: no abrir `speckit-specify` todavía. Hay una vía clara y barata (A, luego B1) pero depende de respuestas de negocio que el tracker no tiene, y la parte de mayor valor aparente (F-TDA-26 completa) no tiene demanda confirmada ni alcance acordado. Propuestas concretas: (1) F-TDA-27 se funde en F-CLI-20 (MSF-452) y se cierra MSF-341 como duplicada; (2) F-TDA-26 completa queda como **kill por ahora** (se reabre con evidencia); (3) si hay demanda de pedir en línea, se abre una historia nueva «lista de pedido sin cobro» (B1) en vez de F-TDA-26. Revisitar en la etapa **intake/research** con datos de `dominio.consultas` y las respuestas siguientes.

## If needs-clarification

**Preguntas de negocio bloqueantes** (cada una con la recomendación del analista):

1. [NEEDS CLARIFICATION: ¿Los dueños quieren cobrar en línea o solo ordenar el pedido?] Recomendación: solo ordenar el pedido (B1) hasta ver demanda real.
2. [NEEDS CLARIFICATION: ¿Hay demanda confirmada de clientes? ¿cuántas consultas por semana y cuántas cierran en venta?] Recomendación: sacar el dato de `dominio.consultas` y pedir a cada tienda una estimación antes de planificar.
3. [NEEDS CLARIFICATION: Si se cobra en línea, ¿qué medio de pago y qué proveedor (tarjeta, transferencia, billetera) y cómo se concilia?] Recomendación: no decidir hasta que 1 sea «cobrar»; en ese caso, un solo medio y conciliación manual al inicio.
4. [NEEDS CLARIFICATION: ¿Quién paga las comisiones de la pasarela y hay tope de importe o solo minoristas?] Recomendación: solo si 1 es «cobrar»; empezar con solo minorista y monto tope.
5. [NEEDS CLARIFICATION: Envíos: ¿retiro por transporte con contrarreembolso como hoy (`transportes`, `contrarreembolsos`), costo fijo, o cotización automática?] Recomendación: mantener el esquema manual actual y no cotizar en línea.
6. [NEEDS CLARIFICATION: Facturación: ¿se necesita factura fiscal con ARCA al vender en línea, o alcanza el comprobante interno y se factura aparte?] Recomendación: mantener comprobante interno; ARCA solo como spec propia y si el cliente lo exige.
7. [NEEDS CLARIFICATION: Stock: ¿el pedido online reserva stock? ¿quién carga y libera reservas? (hoy solo productos «A pedido» y personal con permiso de stock)] Recomendación: no reservar en la tienda; el operador confirma disponibilidad al aceptar.
8. [NEEDS CLARIFICATION: ¿Cuentas obligatorias u opcionales para pedir?] Recomendación: opcionales para B1 (visitante con nombre y contacto); obligatorias para B2 (presupuesto a nombre del cliente) y para ver historial.
9. [NEEDS CLARIFICATION: ¿Auto-registro o siempre por invitación?] Recomendación: seguir por invitación (decisión D2 de cuenta web) hasta tener volumen.
10. [NEEDS CLARIFICATION: ¿Una cuenta por tienda o única para San Javucho y Mundo JC? (D1 de cuenta web: por tienda)] Recomendación: mantener por tienda, favoritos e historial por tienda.
11. [NEEDS CLARIFICATION: ¿El precio mostrado en la lista es firme o referencia?] Recomendación: referencia («precio de lista, se confirma al responder»).
12. [NEEDS CLARIFICATION: ¿Qué datos personales se guardan (dirección, DNI/CUIT) y qué política de privacidad/consentimiento aplica?] Recomendación: lo mínimo (nombre, contacto, ítems); reutilizar el consentimiento de `dominio.contactos`.
13. [NEEDS CLARIFICATION: ¿Quién atiende reclamos, devoluciones y arrepentimiento si hay venta a distancia?] Recomendación: solo relevante si 1 es «cobrar»; antes, consultar al contador/abogado del cliente.
14. [NEEDS CLARIFICATION: ¿Aprobás fusionar F-TDA-27 y F-CON-07 en F-CLI-20 (MSF-452) y cerrar MSF-341/MSF-284?] Recomendación: sí; evita tres historias iguales.
15. [NEEDS CLARIFICATION: ¿Cuántas cuentas web activas hay en producción?] Recomendación: medirlo; si son pocas, A puede esperar.

**Revisit stage**: research (con datos de consultas y cuentas) y luego define.

## If go — Handoff to `/speckit-specify`

No aplica (verdict ≠ go). Si 2, 8 y 14 se responden a favor de A: abrir una spec única `tienda-mi-cuenta-historial-y-favoritos` (F-CLI-20), delivery scope `supabase` + `refine`, sin pagos. Si 1 es «solo ordenar»: spec `tienda-lista-de-pedido` (B1).

## Orden recomendado y dependencias reales

1. (Ya hecho) `cuenta-web-del-cliente` (MSF-237), `tienda-catalogo-y-ficha` (MSF-167), `contactos-y-respuestas-rapidas` (MSF-144): ninguna bloquea; no hace falta cerrar nada más para empezar A o B1.
2. Spec 1: `tienda-mi-cuenta-historial-y-favoritos` (A).
3. Spec 2: `tienda-lista-de-pedido` (B1); opcional spec 3: «crear presupuesto desde la consulta» (panel).
4. Solo con evidencia: B2, y luego, si el negocio lo pide, specs separadas de pagos, envíos, facturación ARCA y pedidos (C).
5. Limpieza del tracker: resolver la dependencia circular F-TDA-27 ↔ F-CON-07 ↔ MSF-176 ↔ MSF-154.
