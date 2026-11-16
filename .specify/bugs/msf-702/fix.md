# Fix · MSF-702

**Bug**: en el asistente de migración, «Cancelar» tras un fallo de lote dejaba la carga `en_curso` para siempre; varias pantallas mostraban el `message` crudo de Postgres/PostgREST.

## Cambios
- `pages/migracion/AsistenteImportacion.tsx`: `reiniciar()` llama a `cerrar_carga_migracion` (best-effort) si hay `cargaId` y el paso es `aplicando`. El RPC recalcula desde `migracion_filas` y deja la carga `fallida` (o `aplicada` si las filas están completas). Sin migración nueva.
- `lib/mensajeErrorBase.ts` (nuevo): mapea por `code` (como `lib/proveedores.ts`), el detalle va solo a consola.
- Usado en `pages/usuarios/list.tsx` (carga y acciones; `23514` → «La organización debe conservar al menos un administrador.»), `pages/ejecuciones/list.tsx` y `components/ia/ChatIAPanel.tsx`.

## No tocado (con motivo)
- `pages/historial/importar.tsx`: `lib/historial.ts` ya sanea el mensaje (`mensajeDeErrorSolicitud`).
- `lib/vencimientoSesion.ts`: cubierto por MSF-686.
