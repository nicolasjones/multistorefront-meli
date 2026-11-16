# Bug Assessment: Pantalla 404 en inglés y sin estilo

- **Slug**: pantalla-404-propia
- **Source**: MSF-636 (Auditoría H5)
- **Verdict**: valid
- **Severity**: low

## Symptom

Una ruta inexistente del panel muestra el `ErrorComponent` de Refine («Sorry, the page you visited does not exist» / «Back Home»), en inglés y sin el estilo de la app.

## Suspected Code Paths

- `apps/web/src/App.tsx` — ruta `*` dentro del layout autenticado.

## Proposed Remediation

Pantalla propia en castellano con los patrones compartidos (`EncabezadoPagina`, `EstadoVacio`), sin tocar rutas ni lógica.
