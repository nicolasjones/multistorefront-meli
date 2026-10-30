---
owner: producto
sources: []
title: Inicio
hide:
  - navigation
  - toc
---

<div class="msf-hero" markdown>

<p class="msf-eyebrow">Documentación</p>

# MSF · multistorefront

Un panel para administrar varias tiendas desde un solo lugar: catálogo y stock compartidos, ventas, compras, service técnico y reportes. Versionada junto al código y dividida en dos partes, según quién la lea.

[Soy usuario/a de MSF :material-arrow-right:](producto/README.md){ .md-button .md-button--primary }
[Soy técnico/a :material-arrow-right:](tecnico/README.md){ .md-button }

</div>

## Elegí tu camino

<div class="grid cards" markdown>

-   :material-storefront-outline:{ .lg .middle } **Producto**

    ---

    Qué hace MSF, para quién, qué incluye y qué no. Sin jerga técnica: pensada para dueños, administración, mostrador, depósito y soporte.

    [:octicons-arrow-right-24: Qué es MSF](producto/README.md) · [Capacidades](producto/capacidades.md) · [Glosario](producto/glosario.md)

-   :material-code-braces:{ .lg .middle } **Técnico**

    ---

    Cómo está construido: arquitectura, datos y DER, API y RPC, flujos, operación y decisiones. Cada página cita el archivo, migración o commit que la respalda.

    [:octicons-arrow-right-24: Empezar](tecnico/README.md) · [Arquitectura](tecnico/arquitectura.md) · [Datos y DER](tecnico/datos.md)

</div>

## ¿Por dónde empiezo?

| Si sos… | Empezá por | Para qué |
|---|---|---|
| Dueño/a del producto, operación o cliente | [Qué es MSF](producto/README.md) | Entender el alcance y las capacidades sin jerga técnica |
| Developer nuevo en el repo | [Empezar (técnico)](tecnico/README.md) | Levantar el proyecto, probar y entender la arquitectura |
| DevOps / soporte | [Operación](tecnico/operacion.md) | Deploy, CI, backups, ambientes y recuperación |
| Alguien que necesita un dato puntual | Buscador (arriba) o [Glosario](producto/glosario.md) | Encontrar un término o una pantalla |

## Atajos

<div class="grid cards" markdown>

-   :material-view-grid-outline:{ .lg .middle } **Capacidades**

    ---

    Qué resuelve cada módulo y en qué estado está.

    [:octicons-arrow-right-24: Ver capacidades](producto/capacidades.md)

-   :material-sitemap-outline:{ .lg .middle } **Arquitectura**

    ---

    Componentes, integraciones y diagramas interactivos.

    [:octicons-arrow-right-24: Ver arquitectura](tecnico/arquitectura.md)

-   :material-database-outline:{ .lg .middle } **Datos y DER**

    ---

    Modelo de datos, tablas vivas vs. archivo y ERD interactivo.

    [:octicons-arrow-right-24: Ver datos](tecnico/datos.md)

-   :material-api:{ .lg .middle } **API y RPC**

    ---

    Contratos, RPCs y cómo descubrirlos.

    [:octicons-arrow-right-24: Ver API](tecnico/api.md)

-   :material-server-outline:{ .lg .middle } **Operación**

    ---

    Deploy, CI, backups, Superset y e2e.

    [:octicons-arrow-right-24: Ver operación](tecnico/operacion.md)

-   :material-scale-balance:{ .lg .middle } **Decisiones (ADR)**

    ---

    Por qué se eligió cada cosa.

    [:octicons-arrow-right-24: Ver decisiones](tecnico/adr.md)

</div>

## Cómo se mantiene fiel

- El **inventario** y los checks se generan desde el código (`pnpm docs:wiki:check`). Ver [Inventario](_generated/inventory.md).
- Cada diagrama técnico es un **artefacto Archify** validado (HTML autocontenido) y linkeado desde su issue.
- Los cambios de código, datos o contratos que no actualicen su documentación **fallan el check** (o quedan marcados como deuda con dueño).
- El **commit verificado** de cada página queda en el `manifest` de documentación.

!!! note "Estado"
    MSF está en construcción por hitos (ver [capacidades](producto/capacidades.md)). Esta documentación cubre lo **construido y especificado**; lo que todavía no existe se marca explícitamente como **fuera de alcance** o **roadmap**, no se inventa.
