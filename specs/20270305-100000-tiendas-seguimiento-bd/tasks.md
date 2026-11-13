# Tasks: Tiendas · Seguimiento MSF-846 parte A

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

- [x] T001 Diagnóstico de la búsqueda en dev (solo lectura) y migración `20270305100000` (FR-001). Evidencia: `q=cable` 2,4–3,8 s → ~0,3 s; mismos ids en páginas 1 y 2 de `cable` y `joystick` y mismo hash con filtros.
- [x] T002 Migración `20270305100100` con `imagen` por categoría en `vista_previa_tienda` (FR-002). Evidencia: pgTAP `tienda_vista_previa_categorias_imagen.test.sql`.
- [x] T003 Front: `leerVistaPrevia` conserva la foto de categoría (FR-002). Evidencia: Vitest `tiendaBorrador.vistaPrevia.test.ts`.
- [x] T004 Migración `20270305100200` de relacionados manuales (FR-003). Evidencia: pgTAP `tienda_relacionados.test.sql` (25 aserciones tras T009).
- [x] T005 Documentación: `docs/tiendas-online.md` y `docs/tienda-busqueda.md`. Evidencia: `verificar-documentacion-cambios`.
- [x] T006 Validación en dev dentro de transacción con rollback (migraciones y pgTAP). Desvío: los pgTAP se corrieron en la base dev (no con `supabase test db`); `promociones_precio` #2 y `tienda_busqueda_publica` #82 fallan también sin estos cambios (configuración de dev).
- [x] T007 Migración `20270305100300_precio_vigente_empresa_plpgsql.sql` (FR-004): `precio_vigente_empresa` en plpgsql. Evidencia (dev, `begin … rollback`): 4.578 pares producto/empresa, 600 con 0 diferencias (con y sin promoción), 1.500 con promociones vigentes/futuras simuladas y p_ahora desplazado: 0 diferencias; costo 4,7 → 0,34 ms por producto. Búsqueda `q=cable` (host demo-mundojc) con migraciones 100000 aplicadas: precio_max / precio_asc / precio_desc / solo_con_stock + precio: 2,1–2,9 s → 0,31–0,45 s; relevancia 0,18–0,35 s.
- [x] T008 pgTAP `tienda_busqueda_rapida.test.sql` (23 aserciones): equivalencia de `precio_vigente_empresa` con y sin promoción vigente (precio y precio_anterior, promoción futura, p_ahora, precio null, una fila, privilegios) y una prueba por rama de la búsqueda (precio_max, orden por precio con producto sin precio, solo_con_stock, página 2). Evidencia: 23/23 en dev dentro de `begin … rollback`.
- [x] T009 Desempate `pr.relacionado_id` en el corte de 4 manuales de `20270305100200` (reescrita en sitio) y pgTAP `tienda_relacionados.test.sql` (25 aserciones, caso «empate de orden»). Evidencia: 25/25 en dev.
- [x] T010 Documentación: fila de `busqueda_pagina_por_dominio` con tiempos reales por rama, vista previa con imagen, relacionados manuales primero (`tiendas-online.md`, `catalogo.md`, `tienda-busqueda.md`).
