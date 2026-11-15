# Test · MSF-702

- `AsistenteImportacion.test.tsx`: «[MSF-702] cancelar tras un fallo cierra la carga…» y «cancelar antes de importar no toca ninguna carga».
- `lib/mensajeErrorBase.test.ts`: nunca devuelve el `message` crudo; mapeo por código; tolera errores sin forma.
- `usuarios/list.test.tsx`: el error `23514` muestra el texto de negocio y no el de la restricción.

Ejecutado: `vitest` de migracion, usuarios, ejecuciones, historial, components/ia, lib/mensajeErrorBase → verde; `tsc --noEmit` y `pnpm lint` sin errores; `pnpm docs:check` OK.
E2E: no aplica (cambio cubierto por tests de componente).
