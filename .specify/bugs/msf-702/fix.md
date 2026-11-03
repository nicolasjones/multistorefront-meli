# Fix · MSF-702

**Bug**: en el asistente de migración, «Cancelar» tras un fallo de lote dejaba la carga `en_curso` para siempre; varias pantallas mostraban el `message` crudo de Postgres/PostgREST.

## Cambios
- `pages/migracion/AsistenteImportacion.tsx`: `reiniciar()` llama a `cerrar_carga_migracion` (best-effort) si hay `cargaId` y el paso es `aplicando`. El RPC recalcula desde `migracion_filas` y deja la carga `fallida` (o `aplicada` si las filas están completas). Sin migración nueva.
- `lib/mensajeErrorBase.ts` (nuevo): mapea por `code` (como `lib/proveedores.ts`), el detalle va solo a consola.
- Usado en `pages/usuarios/list.tsx` (carga y acciones; `23514` → «La organización debe conservar al menos un administrador.»), `pages/ejecuciones/list.tsx` y `components/ia/ChatIAPanel.tsx`.

## No tocado (con motivo)
- `pages/historial/importar.tsx`: `lib/historial.ts` ya sanea el mensaje (`mensajeDeErrorSolicitud`).
- `lib/vencimientoSesion.ts`: cubierto por MSF-686.

## Devolución del Revisor (PR #643)

- `asignarEmpresasUsuario` ya no envuelve `error.message` en un `Error`: relanza el error de base y `pages/usuarios/list.tsx` lo mapea por `code` con `mensajeDeErrorBase` (antes se veía el texto crudo al fallar la asignación de empresas).
- `pages/historial/importar.tsx` no cambia: `lib/historial.ts` ya lanza textos fijos en castellano (`mensajeDeErrorSolicitud` mapea por código).
