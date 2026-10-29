# Implementation Plan: Clientes y proveedores · Cuentas y compras a proveedores

**Spec**: `specs/20261029-100000-cuentas-y-compras-a-proveedores/spec.md` · **Épica**: MSF-450 · **Delivery scope**: ninguno (solo documentación).

## Resumen

La épica son ideas P3 condicionadas a validar demanda, sin requisitos ni pantallas. El plan no diseña código: registra las historias, sus dependencias y las decisiones abiertas, y deja cada historia lista para que su propia spec (con plan y tareas) se escriba cuando pase a un hito.

## Contexto técnico

- Sin cambios de base de datos: **no hay tablas nuevas ni alteradas** (Principio VII no aplica a esta rama). No se verificó el grafo por tablas porque no se propone ninguna.
- Sin RPC ni endpoints nuevos: no se crea `contracts/` (nada que declarar, sin `BREAKING`).
- Sin UI: Principios VI y VIII declarados «no aplica» en la matriz de la spec.
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
