---
owner: producto
sources: []
title: Inicio
hide:
  - toc
---

<p style="margin:0 0 .4rem;font-size:.75rem;font-weight:600;color:var(--md-typeset-a-color)">Documentación de producto</p>

# ¿Qué querés hacer hoy en MSF?

Elegí tu rol y vas directo a lo que necesitás, sin jerga técnica. MSF es el panel para administrar varias tiendas desde un solo lugar.

<div class="msf-roles" markdown>

<div class="msf-role msf-c1" markdown>
**[Administración](producto/usuarios-y-roles.md)**

Organización, usuarios, roles, permisos y empresas.
</div>

<div class="msf-role msf-c2" markdown>
**[Mostrador y ventas](producto/ventas-comprobantes.md)**

Comprobantes, cobros, devoluciones e impresión.
</div>

<div class="msf-role msf-c3" markdown>
**[Depósito](producto/stock-depositos-y-reservas.md)**

Stock, ingresos, lotes, reservas e inventario.
</div>

<div class="msf-role msf-c4" markdown>
**[Service técnico](producto/service-alta-estados-y-permisos.md)**

Reparaciones, estados, repuestos y entregas.
</div>

<div class="msf-role msf-c5" markdown>
**[Catálogo y precios](producto/catalogo-alta-y-edicion.md)**

Productos, categorías, IVA y cotización del dólar.
</div>

<div class="msf-role msf-c6" markdown>
**[Tiendas online](producto/tiendas-online.md)**

Dominio, identidad, vidriera y cuenta del cliente.
</div>

</div>

<div class="msf-duo" markdown>

<div class="msf-tech" markdown>
Para quien mantiene el sistema

Documentación técnica

Arquitectura, datos y DER, API y RPC, flujos y operación.

[Ir a Técnico →](tecnico/README.md)
</div>

<div class="msf-role msf-c1" markdown>
**[Glosario de negocio](producto/glosario.md)**

Los nombres que usa el equipo, explicados.
</div>

</div>

## ¿Por dónde empiezo?

| Si sos… | Empezá por | Para qué |
|---|---|---|
| Dueño/a del producto, operación o cliente | [Qué es MSF](producto/README.md) | Entender el alcance y las capacidades sin jerga técnica |
| Developer nuevo en el repo | [Empezar (técnico)](tecnico/README.md) | Levantar el proyecto, probar y entender la arquitectura |
| DevOps / soporte | [Operación](tecnico/operacion.md) | Deploy, CI, backups, ambientes y recuperación |
| Alguien que necesita un dato puntual | Buscador (arriba) o [Glosario](producto/glosario.md) | Encontrar un término o una pantalla |

## Cómo se mantiene fiel

- El **inventario** y los checks se generan desde el código (`pnpm docs:wiki:check`). Ver [Inventario](_generated/inventory.md).
- Cada diagrama técnico es un **artefacto Archify** validado (HTML autocontenido) y linkeado desde su issue.
- Los cambios de código, datos o contratos que no actualicen su documentación **fallan el check** (o quedan marcados como deuda con dueño).
- El **commit verificado** de cada página queda en el `manifest` de documentación.

!!! note "Estado"
    MSF está en construcción por hitos (ver [capacidades](producto/capacidades.md)). Esta documentación cubre lo **construido y especificado**; lo que todavía no existe se marca explícitamente como **fuera de alcance** o **roadmap**, no se inventa.
