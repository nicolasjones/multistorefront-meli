# Bug Verification: Ingreso de mercadería trunca a 500 productos y proveedores sin aviso

- **Slug**: msf-693
- **Tested**: 2026-11-01
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial (el síntoma queda cubierto por pruebas automáticas; la reproducción contra
  una base real con más de 500 productos no se ejecutó en este entorno)

## Summary

El truncado silencioso ya no puede darse: los selectores de «Nuevo ingreso» (Proveedor y Producto)
y los filtros Proveedor/Producto del historial buscan en el servidor, así que cualquier registro
activo se puede elegir escribiendo, y cuando el catálogo no entra en el tope la pantalla avisa
(«Hay más de 500 productos: escribí para buscar el que necesitás.») y el aviso sigue visible
después de elegir. No hay regresiones en el área de Stock (229/229 en verde).

Lo que **no** se pudo hacer en este entorno: correr la reproducción contra una base real con más de
500 productos (no hay stack de Supabase ni daemon de Docker). El recorrido E2E quedó escrito
(`apps/web/e2e/ingresos-mercaderia-catalogo.e2e.ts`) para esa verificación.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproducción (post-fix), a nivel de componente | `pnpm vitest run src/components/stock/IngresoMercaderiaForm.test.tsx src/components/stock/HistorialIngresos.test.tsx src/hooks/useBuscadorCatalogo.test.tsx` | pass | 28/28. Con 501 filas devueltas se muestra el aviso y sigue visible tras elegir; escribiendo se consulta el servidor y se puede elegir un registro fuera de los primeros 500. |
| Pruebas nuevas / actualizadas | mismo comando | pass | Hook nuevo (filtro, aviso, carga diferida, carrera, error) + formulario + historial. |
| Regresión del área | `pnpm vitest run src/components/stock src/hooks/useBuscadorCatalogo.test.tsx src/pages/stock` | pass | 229/229 en 19 archivos. |
| Lint | `pnpm lint` | pass | Sin errores; solo los avisos previos de `set-state-in-effect` (los mismos que ya había). |
| Type-check / build | `pnpm build` (incluye `tsc -b`) | pass | Además, el E2E nuevo se typechequea aparte (no entra en `tsc -b`). |
| Documentación | `pnpm docs:check` | pass | `docs/ingreso-de-mercaderia.md` y `docs/e2e-app.md` actualizados en el mismo cambio. |
| Calidad determinista | `pnpm calidad` | pass | oxlint, knip (código muerto), jscpd (duplicación), dependency-cruiser y syncpack en «ok». gitleaks quedó como «hallazgos» por falta de permisos de Docker en este entorno: no escaneó; el gate real es el CI. |
| Reproducción contra base real (>500 productos) | `pnpm --filter @platform/web test:e2e ingresos-mercaderia-catalogo` | not-run | Sin stack local (`pnpm dev:supabase`) ni daemon de Docker en este entorno. El E2E está escrito y se omite sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`. |

## Output Excerpts

```
Test Files  3 passed (3)
     Tests  28 passed (28)

Test Files  19 passed (19)
     Tests  229 passed (229)

---- RESUMEN ----
  hallazgos  gitleaks (secretos)
  ok         oxlint (SAST)
  ok         knip (código muerto)
  ok         jscpd (duplicación)
  ok         dependency-cruiser (arquitectura)
  ok         syncpack (versiones)
```

## Residual Risks

- **La búsqueda real contra Postgres no se probó en este entorno.** El filtro `or` con `ilike` y el
  comodín `%` es el mismo que ya usa el listado de productos (`lib/productosListado.ts`, pantalla
  Catálogo en producción) y el filtro de stock (`lib/stock.ts`); el texto tipeado se sanea igual
  (se quitan `,()"\*` y se escapan `%`/`_`). Aun así, la comprobación de que el filtro devuelve el
  producto #501 con datos reales queda para el E2E con stack local.
- **El E2E nuevo no se ejecutó**: si el siembra de 501 productos o el rótulo de alguna aserción no
  estiveran bien, se vería al correr `pnpm dev:supabase` + `pnpm --filter @platform/web test:e2e
  ingresos-mercaderia-catalogo`.
- La búsqueda por SKU usa `ilike` (parcial, sin distinguir mayúsculas): buscar `Z_1` también puede
  devolver `Z-1`. Es el mismo criterio del listado de productos.

## Recommendation

Cerrar el bug con la evidencia de Vitest (28/28) y del área de Stock (229/229), y correr el E2E
`ingresos-mercaderia-catalogo` a mano con el stack local antes del merge (queda anotado en
`docs/e2e-app.md`, como los demás recorridos con sesión). Con ese E2E en verde, el resultado pasa
de `partial` a `verified`.
