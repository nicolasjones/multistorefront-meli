# Fix: msf-697 — fallo de `permisos_actuales` ya no se presenta como «Acceso restringido»

- `context/PermisosPanel.tsx`: el `catch` guarda `permisos: null` y el contexto expone `error: boolean`
  (antes `[]`, indistinguible de «sin acceso»). `recargar()` ya existente reintenta y limpia el error.
- `hooks/useNivelSeccion.ts`: devuelve también `error` y `recargar`.
- `components/RequiereAccesoSeccion.tsx`: con `error` (y no superadmin) muestra `EstadoError`
  «No pudimos verificar tus permisos.» + Reintentar; no monta la sección ni ofrece «Solicitar acceso».
- `components/navegacion/SiderPanel.tsx`: con `error` muestra el mismo estado con Reintentar en vez del menú.
- `docs/permisos-por-rol.md`: documenta el comportamiento. Sin migraciones ni cambios de RLS.
- `assessment.md`: corregidas rutas/líneas y el riesgo de `permisos: null` (observaciones del Revisor).
