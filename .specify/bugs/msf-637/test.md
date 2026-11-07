# Test MSF-637

- `hooks/useNombreRolActual.test.tsx`: devuelve «Operador» para `operador`; cae a «actual» si la consulta
  falla, se rechaza o el rol es desconocido; no consulta si no está activo.
- `pages/stock/motivos.test.tsx`: quien no es Administrador ve el nombre del rol, no el literal.
- `components/RequiereAccesoSeccion.test.tsx` y `pages/configuracion/listas.test.tsx`: sin regresión.

Resultado: 4 archivos, 37 tests OK (`vitest run`).
