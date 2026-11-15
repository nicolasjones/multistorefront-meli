# Plan: Visor por componente, épica e historia

**Feature Branch**: `feat/023-visor-componentes` · **Spec**: `spec.md`

## Enfoque

1. **Componente como dato del spec, no del test.** El componente es una
   propiedad de la historia (una épica entera vive en un componente), así que se
   declara una vez en `spec.md` y `scripts/cobertura-e2e.mjs` lo propaga a cada
   evidencia y a cada ítem sin cubrir. Alternativa descartada: ponerlo en el
   título del test (`[COMPONENTE:EPICA:TASK]`) porque obliga a repetirlo en cada
   test y rompe los títulos ya mergeados.
2. **Progreso honesto.** `cubiertos / (cubiertos + sin_cubrir)`. Contar sólo los
   ítems citados daría 100% a historias a medio cubrir. Los ítems omitidos por
   falta de stack no suman como cubiertos.
3. **Miniatura sin descargar el video.** El elemento `<video>` usa
   `preload="metadata"` y el fragmento `#t=0.1`: el navegador pide metadata y
   pinta el primer cuadro. El archivo completo sólo se descarga al pulsar "Ver
   video". No se agrega ffmpeg al CI.
4. **Respaldo local.** `apps/web/public/cobertura-e2e.json` permite ver el visor
   sin bucket; la insignia de origen evita confundir una demo con la corrida real.

## Archivos

| Archivo | Cambio |
| --- | --- |
| `scripts/cobertura-e2e.mjs` | Parsea `**Componente**`, lo propaga a `evidencias[]` y `sin_cubrir[]` |
| `scripts/cobertura-e2e.test.mjs` | Fixture con componente + aserciones |
| `apps/web/src/pages/cobertura-e2e/tipos.ts` | `componente`, `ComponenteResumen`, `EstadoFiltro` |
| `apps/web/src/pages/cobertura-e2e/list.tsx` | Agrupado, progreso, búsqueda, filtro, respaldo local |
| `apps/web/src/pages/cobertura-e2e/show.tsx` | Componente, progreso, miniatura |
| `apps/web/src/pages/cobertura-e2e/list.test.tsx` | Agrupado, búsqueda, filtro, respaldo local, vacío |
| `specs/*/spec.md` | `**Componente**` en las 3 specs con E2E |
| `docs/e2e-app.md` | Convención y navegación |

Sin migraciones ni cambios de esquema: el manifiesto es un archivo en Storage.

## Verificación

- `pnpm test:web` (Vitest del visor y del generador).
- `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm matriz:check`.
- Manifiesto generado por el job E2E del CI: Acceso → {MSF-119, MSF-121} y
  Stock → {MSF-136}.
