# Test: msf-697

- `PermisosPanel.test.tsx`: fallo → `error=true`, `permisos=null`, traza `console.error`; `recargar()` se recupera
  (reemplaza el test que fijaba «deniega ninguno»).
- `RequiereAccesoSeccion.test.tsx`: con error muestra «No pudimos verificar», Reintentar llama `recargar`,
  sin «Solicitar acceso»; el denegado real (`ninguno`) sigue igual.
- `SiderPanel.test.tsx`: con error muestra el estado con Reintentar y no el menú.
- E2E=no aplica (CI público no corre E2E; cubierto por Vitest).
