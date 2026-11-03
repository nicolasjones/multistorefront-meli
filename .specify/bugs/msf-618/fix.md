# Fix MSF-618
- Etiquetas con tildes para todos los tipos emitidos (`apps/web/src/lib/actividad.ts`).
- `formatearDetalleActividad` formatea importes (Cobro de N, `$ N`, `ARS|USD N`) al renderizar el detalle (`pages/actividad/list.tsx`).
- Sin cambios de base de datos. Reversión: revertir el commit.
- Fuera de alcance: descripción (MSF-604), filas de cambio de empresa activa.

## Devolución del Revisor (PR #638)
- Limitación conocida: el texto de «Cobro de N» se arma en SQL (`registrar_cobro_interno`) sin moneda, así que el detalle lo muestra siempre como `$ N` (pesos). No se puede distinguir un cobro en USD sin una migración que agregue la moneda al texto; queda como seguimiento, no se cambia en este fix.
- Filas «Cambio de empresa activa»: fuera de alcance de MSF-618; requieren decidir con Nicolás si se dejan de registrar (cambio en el origen del evento). Pendiente de seguimiento con dueño.
