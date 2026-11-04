# Fix MSF-637 — «Tu rol (actual) no incluye…» en /stock/motivos

**Causa raíz**: `MotivosMovimiento` (y `ListasConfigurables`) pasaban el literal `rol="actual"` a
`AccesoRestringido`, que lo interpola en «Tu rol (…) no incluye …». Nunca se resolvía el rol real.

**Cambio**
- `lib/rolActual.ts`: `resolverRolId` (consulta de `usuarios_organizacion` bajo RLS, extraída de
  `RequiereAccesoSeccion`) y `etiquetaDeRol` (nombre visible; genérico «actual» solo si se desconoce).
- `hooks/useNombreRolActual.ts`: hook que resuelve el nombre del rol solo cuando la pantalla deniega.
- `stock/motivos.tsx` y `configuracion/listas.tsx` usan el hook; `RequiereAccesoSeccion` reutiliza la lib.

**Fuera de alcance (decisión de negocio abierta)**: la matriz de permisos da `edicion`/`lectura` a otros
roles en /stock/motivos y /historial/importar, pero el código las deja solo para Administrador
(`usePuedeEscribir`). No se cambia el criterio de acceso sin decisión de negocio; queda anotado en el tracker.
Las demás pantallas con `rol="actual"` (Rentabilidad, Reportes, Servicio técnico) quedan para su propio bug.
