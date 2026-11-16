# Implementation Plan: Tiendas públicas · Carga infinita (MSF-845)

**Spec**: [`spec.md`](./spec.md) · **Alcance de entrega**: `refine`.

## Enfoque técnico

- `lib/tiendaListado.ts`: `FiltrosCatalogo` pierde `pagina`; `parsearFiltros` ignora `?pagina=`, `serializarFiltros` no lo escribe, `conCambio` devuelve filtros nuevos. `leerPaginaCatalogo(host, filtros, pagina = 1)` y `leerPaginaBusqueda(host, q, filtros, pagina = 1)` reciben el número de tanda aparte.
- `hooks/useCatalogoPublico.ts`: estado acumulado por clave `(host, filtros, q, intento)`; la primera tanda se pide al cambiar la clave (reinicio) y `cargarMas` suma la siguiente (de a una a la vez, deduplicando por id, firmando las imágenes de cada tanda). Expone `hayMas`, `cargandoMas`, `errorMas`; una tanda vacía con total mayor corta la carga.
- `secciones-catalogo/ListadoProductos.tsx`: se quita la redirección a la última página y `Paginacion`; el pie es `CargaInfinita` (compartido del panel).
- Se elimina `catalogo/Paginacion.tsx`.
- Sin migraciones ni cambios de RPC. Reversión: revertir el commit (la base no cambia).

## Riesgos

- Una lista muy larga acumula tarjetas en el DOM (sin virtualización): aceptable con catálogos de cientos de productos (techo de diseño documentado en `docs/tiendas-online.md`).
- Las URLs firmadas de imágenes vencen a la hora (comportamiento previo, sin cambio).
