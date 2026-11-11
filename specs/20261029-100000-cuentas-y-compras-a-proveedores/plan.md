# Implementation Plan: Clientes y proveedores · Cuentas y compras a proveedores

**Spec**: `specs/20261029-100000-cuentas-y-compras-a-proveedores/spec.md` · **Épica**: MSF-450 · **Delivery scope**: solo documentación para esta épica; F-CLI-19 se entregó con `supabase` y `refine` bajo su propia spec (MSF-451).

## Resumen

La épica son ideas P3 condicionadas a validar demanda, sin requisitos del cliente. El plan no diseña código: registra las historias, sus dependencias y las decisiones abiertas, y deja cada historia lista para que su propia spec (con plan y tareas) se escriba cuando pase a un hito. La excepción es F-CLI-19, que el SDLC construyó con su propia spec (`specs/20261109-100000-cuenta-corriente-y-saldo-cliente/`) como definición provisoria.

## Contexto técnico

- Sin tablas nuevas ni alteradas (Principio VII no aplica a esta spec). F-CLI-19 agregó una migración aditiva (`20270222100000_cuenta_corriente_cliente.sql`, solo la RPC `public.cuenta_corriente_cliente`); su esquema se declara en su propia spec.
- Sin `contracts/` en esta spec: la RPC de F-CLI-19 es de lectura y su contrato vive en la spec de MSF-451.
- UI: solo la de F-CLI-19 (tarjeta «Saldo deudor» y tabla «Cuenta corriente» en la ficha del cliente), mapeada en su spec; las otras tres historias no tienen pantalla.
- Dependencias a reutilizar cuando pasen a un hito (no se rehacen): cuenta web (`cuentas_cliente`), cobros/conciliación de Ventas, avisos de reposición de Stock, Proveedores y productos.

## Verificación de la constitución

| Principio | Resultado |
|---|---|
| I. Aislamiento | Sin tablas: nada que aislar ahora. |
| II. Spec antes de implementar | Cumple: se especifica (parcialmente) antes de todo código. |
| VII. Esquemas | Sin tablas; cada historia declarará el suyo. |
| VIII (empresa activa) | No aplica: sin pantallas. |
| Documentación | Se actualiza `docs/` y el roadmap en el cierre. |

## Documentación y cierre

- `docs/cuentas-y-compras-a-proveedores.md`: registro de las cuatro ideas, dependencias y preguntas abiertas.
- `docs/roadmap-template.md`: actualizar la fila de MSF-450 al mergear (paso manual con criterio).

## Riesgos

- Que se interprete esta spec como autorización para construir: no lo es; cada historia necesita su spec con requisitos.
- Choque F-CLI-21 / F-PRE-14 sin resolver; F-PRE-14 no existe en el repo.
