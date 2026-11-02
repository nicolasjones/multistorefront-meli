# Fix MSF-618
- Etiquetas con tildes para todos los tipos emitidos (`apps/web/src/lib/actividad.ts`).
- `formatearDetalleActividad` formatea importes (Cobro de N, `$ N`, `ARS|USD N`) al renderizar el detalle (`pages/actividad/list.tsx`).
- Sin cambios de base de datos. Reversión: revertir el commit.
- Fuera de alcance: descripción (MSF-604), filas de cambio de empresa activa.
