# MSF · Documentación

Documentación **de producto** y **técnica** de MSF (multistorefront), en un solo lugar y versionada con el código.

!!! info "Dos caminos, una misma verdad"
    - **Producto** → qué hace MSF, para quién, qué incluye y qué no.
    - **Técnico** → cómo está construido, datos, APIs, flujos, operación y decisiones.
    Las páginas técnicas citan el archivo/migración/commit que las respalda.

## ¿Por dónde empiezo?

| Si sos… | Empezá por | Para qué |
|---|---|---|
| Dueño/a del producto, operación o cliente | [Qué es MSF](producto/README.md) | Entender el alcance y las capacidades sin jerga técnica |
| Developer nuevo en el repo | [Empezar (técnico)](tecnico/README.md) | Levantar el proyecto, probar y entender la arquitectura |
| DevOps / soporte | [Operación](tecnico/operacion.md) | Deploy, CI, backups, ambientes y recuperación |
| Alguien que necesita un dato puntual | Buscador (arriba) o [Glosario](producto/glosario.md) | Encontrar un término o una pantalla |

## Qué hay en esta documentación

- **[Producto](producto/README.md)** — capacidades por módulo, roles, límites y glosario de negocio.
- **[Arquitectura](tecnico/arquitectura.md)** — componentes, integraciones y diagramas interactivos.
- **[Datos y DER](tecnico/datos.md)** — modelo de datos, tablas vivas vs. archivo y ERD interactivo.
- **[API y RPC](tecnico/api.md)** — contratos, RPCs y cómo descubrirlos.
- **[Flujos](tecnico/flujos.md)** — importaciones, estados, secuencias y diagramas.
- **[Operación](tecnico/operacion.md)** — deploy, CI, backups, Superset y e2e.
- **[Decisiones (ADR)](tecnico/adr.md)** — por qué se eligió cada cosa.
- **[Biblioteca](tecnico/biblioteca.md)** — los documentos existentes del repo, agrupados.
- **[Inventario](_generated/inventory.md)** — rutas, tablas y variables de entorno generadas desde el código.

## Cómo se mantiene fiel

- El **inventario** y los checks se generan desde el código (`pnpm docs:wiki:check`).
- Cada diagrama técnico es un **artefacto Archify** validado (HTML autocontenido) y linkeado desde su issue.
- Los cambios de código, datos o contratos que no actualicen su documentación **fallan el check** (o quedan marcados como deuda con dueño).
- El **commit verificado** de cada página queda en el `manifest` de documentación.

## Estado

MSF está en construcción por hitos (ver [capacidades](producto/capacidades.md)). Esta documentación cubre lo **construido y especificado**; lo que todavía no existe se marca explícitamente como **fuera de alcance** o **roadmap**, no se inventa.
