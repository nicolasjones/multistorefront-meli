# Bug Fix: MSF-782 — espera determinista en el test de la cuenta web del cliente

- **Slug**: msf-782
- **Fixed**: 2026-11-17
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El rojo del job `web` en `formulario-cuenta-web.test.tsx` era una carrera de tiempo: el mensaje «Cliente creado · no se pudo crear
la cuenta web en 2 tiendas» llega después del 1 s por defecto de `findByText` cuando el runner está saturado. Se sube el
presupuesto de espera de las consultas de ese archivo; no se toca el producto, el texto del aviso ni los datos.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx` | modified | Constante `ESPERA = { timeout: 5000 }` pasada a las 7 esperas del archivo (`findByText(texto, undefined, ESPERA)` y `waitFor(..., ESPERA)`) |

## Diff Highlights

```diff
+const ESPERA = { timeout: 5000 }
...
-    expect(await screen.findByText('Cliente creado · no se pudo crear la cuenta web en 2 tiendas')).toBeInTheDocument()
+    expect(await screen.findByText('Cliente creado · no se pudo crear la cuenta web en 2 tiendas', undefined, ESPERA)).toBeInTheDocument()
```

## Tests Added or Updated

- `apps/web/src/pages/clientes/formulario-cuenta-web.test.tsx::si una tienda falla, lo informa sin perder el cliente creado` — sigue
  asertando el texto exacto del aviso; ahora espera con presupuesto explícito.
- Los otros tres tests asíncronos del archivo («al guardar «Activa» crea la cuenta…», «sin la casilla de invitación…», «la edición
  parte del estado guardado…») usan la misma constante: tienen la misma carrera y quedaban expuestos al mismo flake.

## Local Verification

- `pnpm --filter @platform/web exec vitest run src/pages/clientes/formulario-cuenta-web.test.tsx` → 5/5 OK.
- Reproducción del bug: con el mock de la cuenta web respondiendo 1,5 s después, el archivo fallaba con
  `TestingLibraryElementError: Unable to find an element with the text: Cliente creado · no se pudo crear la cuenta web en 2 tiendas`
  (error exacto del CI). Con el cambio applied, el mismo escenario (mock con 4 s de retraso) pasa 5/5.
- `pnpm --filter @platform/web exec vitest run src/pages/clientes src/components/clientes` → 34 archivos, 372 tests OK.
- `pnpm --filter @platform/web lint` → sin errores (solo warnings preexistentes).
- `pnpm --filter @platform/web build` → OK.

## Deviations from Assessment

Ninguno. El cambio es el «preferred» propuesto: una constante de espera por archivo.

## Follow-ups

- Verificación definitiva: el job `web` del CI en verde de forma repetida sobre el commit del cambio.
- El mismo patrón (espera con presupuesto explícito) sirve para los demás archivos que esperen texto después de una cadena
  asíncrona; se aplica caso por caso, sin tocar los que ya tienen presupuesto.
