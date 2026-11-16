# Feature Specification: Tiendas · Hallazgos de la pasada de pruebas en dev (MSF-846, parte C)

**Épica**: MSF-846 (MSF-841/MSF-845) · **Spec**: `tiendas-hallazgos-qa` · **Prioridad**: P2
**Alcance de entrega**: `refine` y `supabase` (una migración que reemplaza una RPC; sin tablas).
**Fuente**: hallazgos verificados en dev con Playwright + axe. Esta spec traduce; no agrega alcance de negocio.

## Objetivo

1. Sin violaciones axe `heading-order` en el listado de la tienda en celular.
2. Sin violaciones axe `region` por la barra superior.
3. Sin consultas `empresas?id=eq.` vacías (400) en el panel de tienda.
4. La vista previa del panel cuenta y selecciona categorías igual que la tienda pública.

## Requirements

- **FR-001**: el listado antepone un `h2` oculto visualmente («Productos» / «Resultados») a las tarjetas `h3`.
- **FR-002**: `BarraSuperior` se renderiza dentro del `<header>` del layout.
- **FR-003**: `useEmpresa(undefined)` no consulta, queda cargando y sus mutaciones rechazan sin tocar la base.
- **FR-004**: `public.vista_previa_tienda` devuelve `productos` como total del árbol y omite categorías vacías, con la visibilidad del borrador.
- **SC-001**: Vitest y pgTAP (a mano en dev dentro de `begin…rollback`) verdes.

## Matriz pantalla↔criterios

Prototipos: `design/pantallas/MJC_Home`, `MJC_Catalogo`, `SJ_Home` (`*.inventory.json`). No se agrega ni quita ningún elemento visible.

| Ítem del prototipo / elemento | Pantalla | Dueño |
|---|---|---|
| Tarjetas de producto (nombre, precio, imagen) | Catálogo / Categoría / Búsqueda | FR-001 (solo cambia el encabezado oculto para lectores) |
| Barra superior (eslogan, WhatsApp, correo) | Todas las páginas | FR-002 (mismo aspecto, dentro del `<header>`) |
| Tarjetas de categoría con «N productos» | Vista previa del panel / Home | FR-004 |
| Pestañas de `/empresas/:id/tienda/*` | Panel | FR-003 (sin cambio visible) |

## Decisiones

- La regla de «categorías principales» (`lib/tiendaCategorias.ts`) ya la usaban la tienda y la vista previa; la divergencia estaba en los datos de la RPC, por eso el arreglo es de base.
- La migración es idempotente (`create or replace`); reversión: restituir el cuerpo de `20270305100100_tienda_vista_previa_categorias_imagen.sql`.
