---
owner: producto
sources: []
---

# Manual de usuario de MSF

Bienvenido/a. Acá encontrás cómo usar el sistema de gestión de tus tiendas, paso a paso y con capturas de pantalla:
vender, cobrar, despachar, controlar el stock, cargar mercadería, atender el service técnico y administrar tus tiendas online.

## ¿Por dónde empiezo?

| Si querés… | Empezá por |
|---|---|
| Conocer el sistema y cómo está organizado | [Bienvenida](producto/README.md) |
| Ver todo lo que podés hacer | [Qué podés hacer con el sistema](producto/capacidades.md) |
| Ingresar por primera vez | [Ingresar y recuperar tu contraseña](producto/acceso-y-sesion.md) |
| Entender qué puede hacer cada persona de tu equipo | [Usuarios y roles](producto/usuarios-y-roles.md) |
| Hacer una venta | [Presupuestos y facturas](producto/ventas-comprobantes.md) |
| Registrar un cobro | [Cobros y conciliación](producto/ventas-cobros-y-conciliacion.md) |
| Cargar mercadería que llegó | [Ingreso de mercadería](producto/ingreso-de-mercaderia.md) |
| Revisar o mover el stock | [Stock: ver, mover y controlar](producto/stock-movimientos.md) |
| Cargar o cambiar precios | [Precios, escalas e IVA](producto/precios-e-iva.md) |
| Recibir un equipo para reparar | [Reparaciones, ítems e impresión](producto/service-listado-items-impresion.md) |
| Buscar el significado de una palabra | [Glosario](producto/glosario.md) |

También podés usar el buscador de arriba: escribí la palabra que buscás (por ejemplo «nota de crédito» o «traslado»).

## Secciones del manual

- **Primeros pasos:** ingreso, perfil, organización y empresas, usuarios y roles, actividad.
- **Catálogo y precios:** productos y categorías, cotización del dólar, precios, escalas e IVA, rentabilidad.
- **Stock y compras:** stock, depósitos, traslados y reservas, lotes e inventario, proveedores, ingreso de mercadería.
- **Ventas:** presupuestos y facturas, estados, cobros, despacho, devoluciones, impresión.
- **Clientes:** fichas de clientes y cuenta web.
- **Service técnico:** reparaciones y repuestos.
- **Tiendas online:** identidad, textos, consultas de los visitantes.
- **Configuración y datos:** avisos por correo, listas configurables y migración inicial de datos.

## Estado del sistema

MSF se sigue construyendo por etapas. Este manual describe lo que **ya podés usar hoy**; si algo todavía no se puede hacer, la guía correspondiente lo dice.

---

## Para el equipo técnico

La documentación de **desarrollo y operación** está en las secciones **Técnico** y **System design** del menú. Es independiente de este manual y no cambia con él.

- **[Arquitectura](tecnico/arquitectura.md)** — componentes, integraciones y diagramas interactivos.
- **[Datos y DER](tecnico/datos.md)** — modelo de datos, tablas vivas vs. archivo y ERD interactivo.
- **[API y RPC](tecnico/api.md)** — contratos, RPCs y cómo descubrirlos.
- **[Flujos](tecnico/flujos.md)** — importaciones, estados, secuencias y diagramas.
- **[Operación](tecnico/operacion.md)** — deploy, CI, backups, Superset y e2e.
- **[Decisiones (ADR)](tecnico/adr.md)** — por qué se eligió cada cosa.
- **[Biblioteca](tecnico/biblioteca.md)** — los documentos existentes del repo, agrupados.
- **[Inventario](_generated/inventory.md)** — rutas, tablas y variables de entorno generadas desde el código.
- **[Empezar (técnico)](tecnico/README.md)** — levantar el proyecto, probar y entender la arquitectura.

### Cómo se mantiene fiel

- El **inventario** y los checks se generan desde el código (`pnpm docs:wiki:check`).
- Cada diagrama técnico es un **artefacto Archify** validado (HTML autocontenido) y linkeado desde su issue.
- Los cambios de código, datos o contratos que no actualicen su documentación **fallan el check** (o quedan marcados como deuda con dueño).
- El **commit verificado** de cada página queda en el `manifest` de documentación.
