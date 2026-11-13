# Idea Research: Consultas y ventas · clientes, pedidos y facturación

- **Slug**: clientes-pedidos-y-facturacion
- **Created**: 2026-11-13
- **Evidence confidence (overall)**: medium (código verificado); low en demanda

El mapa completo de lo existente (cuenta web, consultas, comprobantes, cobros, stock, favoritos inexistentes, ARCA y pagos inexistentes) está en `.specify/assessments/tienda-compra-y-cuentas/research.md`; esta evaluación comparte esa evidencia. Se resume lo específico de MSF-154.

## Users & Demand

- Sin demanda documentada: «esta épica solo se retoma si el cliente confirma demanda» — [source: tracker MSF-154] (high que la condición existe; demanda: ASSUMPTION).
- Usuarios afectados: clientes con cuenta web; operadores de Consultas y Ventas.

## Prior Art

- **«De la consulta a la entrega» ya existe por partes, manual y conectado por personas**: consulta (`dominio.consultas`, `supabase/migrations/20261205100000_consultas.sql:22`; bandeja `apps/web/src/pages/consultas/list.tsx`) → contacto/cliente (`dominio.contactos` `20270201100000_contactos.sql:23`, `public.clientes`) → presupuesto/factura (`public.crear_comprobante` `20261203100400_comprobantes_rpc.sql:101`, `aceptar_presupuesto` `20261204150000_aceptar_presupuesto.sql:37`, `confirmar_comprobante` `20261204140000_confirmar_comprobante.sql:37`) → cobro (`dominio.cobros_comprobante` `20270114100000_cobros_comprobante.sql:48`) → despacho/entrega (`apps/web/src/pages/ventas/despacho.tsx`, `docs/ventas-despacho.md`, `dominio.contrarreembolsos` `20270114120000_contrarreembolsos.sql:50`). No hay vínculo automático consulta → comprobante.
- **Pedidos y facturación reemplazados** por Ventas y despacho: MSF-159 comprobantes, MSF-135 despacho y faltantes, MSF-177 listado, estados y anulación, MSF-195 cobros y conciliación (`specs/20261023-100000-ventas-comprobantes/`, `specs/20261024-130000-ventas-despacho-y-faltantes/`, `specs/20261024-150000-ventas-cobros-y-conciliacion/`).
- **Cuentas de clientes**: construidas en la épica MSF-237 (`specs/20261024-051500-cuenta-web-del-cliente/`); el resto (historial y favoritos) tiene su historia propia **F-CLI-20 / MSF-452**, que declara equivaler a F-CON-07 y F-TDA-27 (`specs/20261029-100000-cuentas-y-compras-a-proveedores/tasks.md`, T002).
- **Modelo de clientes registrados con libreta de contactos** (el bloqueo MSF-144): hecho (`dominio.contactos`, `dominio.respuestas_rapidas` `20270201200000_respuestas_rapidas.sql:20`); MSF-144 en «Review In DEV».
- **Facturación fiscal (ARCA)**: inexistente; comprobantes internos (`specs/20261024-130000-ventas-despacho-y-faltantes/spec.md:33`).

## Market & Context

- Alternativa actual: coordinación manual por WhatsApp/correo/local; ERP externo para fiscal (supuesto del tracker: ARCA es «punto natural de integración con un ERP»; cuál ERP: [NEEDS CLARIFICATION]).

## Data & Constraints

- Estado de bloqueantes: MSF-144 Review In DEV (resuelto), MSF-176 Ready For Spec (**sigue sin hacerse**, sin requisitos).
- La dependencia que importa es de F-CON-07 con F-TDA-26 («requiere la compra online»), que la evaluación de MSF-176 recomienda **no** encarar ahora.

## Evidence Against the Idea

- F-CON-07 es un duplicado explícito de F-CLI-20 y F-TDA-27; el alcance propio de MSF-154 quedó en cero.
- Su objetivo menciona «emitir comprobantes y cobrar en línea», que es F-TDA-26/C, no cuentas.
- Dependencia circular: F-TDA-27 está bloqueada por F-CON-07, F-CON-07 por la épica MSF-176 que contiene a F-TDA-27.
- Sin demanda y sin requisitos.

## Gaps & Open Questions

- [NEEDS CLARIFICATION: ¿hay un requisito de «seguimiento del pedido de la consulta a la entrega» que el cliente quiera, distinto del historial?]

## Sources

- tracker plan.agenmatica.com: MSF-154, MSF-284, MSF-176, MSF-144, MSF-452
- Código y specs del repo en `origin/dokploy`
