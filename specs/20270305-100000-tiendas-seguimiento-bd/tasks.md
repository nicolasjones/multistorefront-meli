# Tasks: Tiendas · Seguimiento MSF-846 parte A

**Spec**: [`spec.md`](./spec.md) · **Plan**: [`plan.md`](./plan.md)

- [x] T001 Diagnóstico de la búsqueda en dev (solo lectura) y migración `20270305100000` (FR-001). Evidencia: `q=cable` 2,4–3,8 s → ~0,3 s; mismos ids en páginas 1 y 2 de `cable` y `joystick` y mismo hash con filtros.
- [x] T002 Migración `20270305100100` con `imagen` por categoría en `vista_previa_tienda` (FR-002). Evidencia: pgTAP `tienda_vista_previa_categorias_imagen.test.sql`.
- [x] T003 Front: `leerVistaPrevia` conserva la foto de categoría (FR-002). Evidencia: Vitest `tiendaBorrador.vistaPrevia.test.ts`.
- [x] T004 Migración `20270305100200` de relacionados manuales (FR-003). Evidencia: pgTAP `tienda_relacionados.test.sql` (24 aserciones).
- [x] T005 Documentación: `docs/tiendas-online.md` y `docs/tienda-busqueda.md`. Evidencia: `verificar-documentacion-cambios`.
- [x] T006 Validación en dev dentro de transacción con rollback (migraciones y pgTAP). Desvío: los pgTAP se corrieron en la base dev (no con `supabase test db`); `promociones_precio` #2 y `tienda_busqueda_publica` #82 fallan también sin estos cambios (configuración de dev).
