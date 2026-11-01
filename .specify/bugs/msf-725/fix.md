# Fix: msf-725

- **Fecha**: 2026-11-01
- **Causa**: `sanitizarDato({ texto }, CONTRATO.datosPermitidos)` descartaba `texto` (no estaba en `['pregunta','organizacion_id']`), así que `contexto` quedaba como solo separadores.

## Cambios
- `supabase/functions/preguntar-documentos/contexto.ts` (nuevo): `armarContexto` sanea con la lista propia `['texto']`, descarta textos vacíos, envuelve el resultado con `marcarContenidoNoConfiable` y devuelve `null` si no queda texto.
- `supabase/functions/preguntar-documentos/index.ts`: usa `armarContexto`; si devuelve `null` responde «no encontré información» sin llamar al proveedor de generación. Se quitó el import de `sanitizarDato`.
- `package.json`: script `test:edge:preguntar-documentos` y alta en `test:web`.
- `specs/20261005-document-rag-mechanism/spec.md`: FR-005 documenta el corte por contexto vacío y el saneo propio.

## Desvío respecto de la evaluación
No se agregó `texto` a `datosPermitidos` del contrato (eso ampliaría lo que `prepararInvocacion` deja pasar de la entrada del usuario); se usa una lista propia. No se extrajo un `handler.ts` completo: se extrajo solo la lógica pura del contexto para acotar el alcance.

## Reversión
Revertir el commit; sin migraciones ni cambios de datos.
