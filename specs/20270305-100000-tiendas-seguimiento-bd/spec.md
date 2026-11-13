# Feature Specification: Tiendas · Seguimiento MSF-846, parte A (base de datos)

**Seguimiento**: MSF-846 · **Spec**: `tiendas-seguimiento-bd` · **Prioridad**: P1 (búsqueda con timeout)
**Alcance de entrega**: `supabase` (tres migraciones, solo funciones) y `refine` (un cambio mínimo en el panel).
**Fuente**: hallazgos de la verificación en dev de las tiendas públicas. Esta spec **traduce**; no agrega alcance de negocio.

## Modelo y supuestos

- **Esquemas (Principio VII)**: no se crea ni altera ninguna tabla ni índice. Las tres funciones ya existen: dos en `publico` (lectura anónima, `publico` sigue sin tablas) y una en `public` (RPC del panel).
- Migraciones aditivas e idempotentes (`create or replace`), `security definer`, `search_path` vacío y grants iguales a los vigentes. Reversión de cada una en su encabezado.

## User Scenarios & Testing

### User Story 1 - La búsqueda de la tienda responde dentro del timeout (P1)
`/catalogo?q=cable` daba error 57014 (2,4–3,6 s con 2.204 productos; catálogo sin búsqueda ~130 ms): la función calculaba precio vigente y disponibilidad de todos los productos antes de filtrar por texto.
**Aceptación**: 1. `q=cable` responde en ~0,3 s en dev. 2. Mismos ids en la página 1 y 2 para `cable` y `joystick`, mismo orden «relevancia», mismas claves, mismo límite de pedidos y `espera_segundos`. 3. Con precio máximo u orden por precio el resultado es idéntico al anterior.
4. Con precio máximo u orden por precio la búsqueda también responde en ~0,3–0,45 s (antes 2,0–2,9 s): `private.precio_vigente_empresa` pasa a plpgsql con el mismo contrato.
Migraciones `20270305100000_tienda_busqueda_pagina_rapida.sql` y `20270305100300_precio_vigente_empresa_plpgsql.sql`.

### User Story 2 - La vista previa del panel muestra la foto de cada categoría (P2)
`public.vista_previa_tienda` suma `imagen` por categoría con la regla de `publico.categorias_por_dominio` (`20270303400000`) y el panel la muestra (`lib/tiendaBorrador.ts`: antes fijaba `imagen: null`).
**Aceptación**: 1. La categoría usa la imagen principal de un producto efectivo suyo o de sus subcategorías; `null` si no hay. 2. Un producto inactivo no aporta foto. 3. Sin otras claves nuevas ni cambio de grants.
Migración `20270305100100_tienda_vista_previa_categorias_imagen.sql`.

### User Story 3 - La ficha pública usa los relacionados manuales (P2)
Los «Productos relacionados» cargados en el panel (F-CAT-18) no los usaba la ficha.
**Aceptación**: 1. Si hay manuales, salen primero, en su orden, hasta 4 y solo los visibles en esa tienda. 2. Si faltan, se completa con la regla por categoría hasta 4, sin repetir. 3. Mismo contrato de salida; nada de otras organizaciones ni de productos no visibles. 4. Sin manuales, comportamiento anterior. 5. El corte de 4 entre manuales con el mismo `orden` desempata por id (determinista).
Migración `20270305100200_tienda_relacionados_manuales.sql`.

## Requirements

- **FR-001**: búsqueda: coincidencias materializadas una vez; precio solo donde filtro u orden lo exigen y para la página (US1).
- **FR-002**: `vista_previa_tienda` devuelve `imagen` por categoría (US2).
- **FR-004**: `private.precio_vigente_empresa` en plpgsql: misma firma, columnas, nulls y grants; mismo precio y `precio_anterior` con y sin promoción vigente (US1). También la usan `sugerencias_por_dominio` y `catalogo_pagina_por_dominio`, sin cambio de contrato.
- **FR-003**: `relacionados_por_dominio` prioriza manuales visibles y completa por categoría (US3).
- **SC-001**: pgTAP actualizado (`tienda_relacionados.test.sql`, nuevo `tienda_busqueda_rapida.test.sql`, `tienda_vista_previa_categorias_imagen.test.sql`) y Vitest `tiendaBorrador.vistaPrevia.test.ts`.

## Matriz pantalla↔criterios

Prototipos: `design/pantallas/*Tienda*` (vista previa de la home de la tienda). El cambio visible es solo que la tarjeta de categoría de la vista previa muestra su foto con el mismo componente que la home pública (`CategoriasInicio`); no se agrega ni cambia ningún elemento del prototipo.

| Ítem del prototipo / elemento | Pantalla | Criterio |
|---|---|---|
| Foto de categoría en la home | Vista previa de la tienda (panel) | US2 criterios 1 y 2 |
| Bloque «Productos relacionados» (texto del panel) | Alta/edición de producto | **Fuera de alcance**: el texto actual ya dice que se muestran en la ficha pública; no cambia |
