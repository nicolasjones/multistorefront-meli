# Bug Fix: el runner de evidencia deja de degradar en silencio los ítems sin descripción utilizable

- **Slug**: msf-907
- **Fixed**: 2026-11-20
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

El runner (manifiesto de cobertura, ensamblador de videos y reporte de cobertura por épica)
derivaba de cada ítem de `tasks.md` tres cosas —a qué historia pertenece, qué criterios de
aceptación tiene y cómo se describe— **sin validar nunca la descripción**: una descripción
casi vacía no fallaba, degradaba en silencio. Ahora la regla vive en un solo lugar
(`scripts/historia-item.mjs`), la usan los tres consumidores y **lo que no se puede derivar
queda explícito, con su motivo**: `items_sin_descripcion` en el manifiesto, columna propia en
el reporte por épica, y video publicado marcado «sin criterios».

## Changes

| File | Change | Notes |
|------|--------|-------|
| `scripts/historia-item.mjs` | added | Regla única: texto completo del ítem (incluye las líneas de continuación), código de historia en cualquier posición y **motivo** por el que la descripción no alcanza (`sin texto` / `sin historia`). Modo CLI (`--tasks` / `--stdin`) para que el script de Python no tenga su propia copia de la regla. |
| `scripts/cobertura-e2e.mjs` | modified | `leerItems` sale del módulo (vive en el helper compartido); el encabezado de historia se lee en los dos formatos del repo y con el código dentro del paréntesis (`(MSF-383 · F-PRV-04, P0, talla L)`); el manifiesto publica las dos claves aditivas `items_sin_descripcion` y `historias_ambiguas` y las cuenta en el resumen. |
| `scripts/e2e-cobertura-epicas.py` | modified | Lee los ítems con la regla compartida (de ahí sale la historia y el motivo), une las líneas de continuación y **deja de contar los ítems sin descripción como «sólo base de datos»**: van a su columna «Ítems pendientes sin descripción» (sólo los pendientes: a un ítem ya hecho no hay que escribirle nada). |
| `scripts/armar-video-evidencia.mjs` | modified | El ítem se une a su historia con la misma regla (el código puede venir detrás de `[P]`); si no hay descripción, la tarjeta muestra el id del ítem en vez de un subtítulo vacío; el video sin criterios se publica marcado «sin criterios». |
| `scripts/publicar-videos-e2e.mjs` | modified | La página del run lista los ítems sin descripción utilizable, con su motivo. |
| `scripts/historia-item.test.mjs` | added test | Fija la regla compartida: código en cualquier posición, texto con líneas de continuación, motivo de cada ítem, texto sin etiquetas. |
| `scripts/cobertura-e2e.test.mjs` | modified | Los dos formatos de encabezado de historia, la ambigüedad de un código repetido y la publicación de `items_sin_descripcion`. |
| `scripts/armar-video-evidencia.test.mjs` | modified | El código de historia detrás de `[P]`, el ítem sin descripción y el video marcado «sin criterios». |
| `scripts/e2e-cobertura-epicas.test.py` | added test | El reporte calcula la historia de cada ítem (también con `[P]` delante), marca los ítems sin descripción y **no** los cuenta como «sólo base de datos». |
| `scripts/publicar-videos-e2e.test.mjs` | modified | La página del run muestra los ítems sin descripción. |
| `docs/e2e-app.md` | modified | Documenta la regla de un ítem (qué es una descripción utilizable, qué hace el runner cuando no alcanza y qué claves nuevas publica el manifiesto). |
| `docs/manifest.json` | modified | Manifest regenerado (la página `docs/e2e-app.md` cambió y sus fuentes ahora incluyen el helper y el script de Python). |
| `package.json` | modified | `test:historia:item` y `test:e2e:cobertura:epicas` entran al `pnpm test`. |

## Diff Highlights

```js
// scripts/historia-item.mjs — la regla, en un solo lugar
export function motivoDescripcion(texto) {
  if (!textoSinEtiquetas(texto)) return 'sin texto';
  if (!codigoHistoria(texto)) return 'sin historia';
  return '';
}
```

```python
# scripts/e2e-cobertura-epicas.py — el ítem sin descripción tiene columna propia
base_hist = [c for c, ts_h in historias.items()
             if not all(t["hecha"] for t in ts_h)
             and c not in faltan_hist
             and not all(t["motivo"] for t in ts_h)          # ← ya no degrada a «sólo base»
             and not any((e, t["id"]) in rotulados for t in ts_h)]
sin_descripcion = [t for t in ts if t["motivo"] and not t["hecha"]]   # ← sólo lo pendiente
```

## Tests Added or Updated

- `scripts/historia-item.test.mjs::lee el código de historia en cualquier posición del texto` — `[P] [F-EMP-03][US1] …` cuenta igual que `[F-EMP-03][US1] …`.
- `scripts/historia-item.test.mjs::el texto del ítem incluye las líneas de continuación` — el enunciado partido en dos líneas es un solo ítem.
- `scripts/historia-item.test.mjs::cada ítem dice si su descripción alcanza y por qué no` — `sin texto` / `sin historia`.
- `scripts/cobertura-e2e.test.mjs::lee los dos formatos de encabezado de historia del repo` — `### US1 — … (F-ORG-03, …)` y `### User Story 2 - … (MSF-383 · F-PRV-04, …)` dan criterios; un «Flujo» no.
- `scripts/cobertura-e2e.test.mjs::reporta la ambigüedad cuando dos historias declaran el mismo código`.
- `scripts/cobertura-e2e.test.mjs::publica los ítems sin descripción utilizable y las historias ambiguas`.
- `scripts/armar-video-evidencia.test.mjs::un ítem con el código de historia detrás de [P] cuelga de su historia`.
- `scripts/armar-video-evidencia.test.mjs::un ítem sin descripción muestra su id en vez de un subtítulo vacío`.
- `scripts/armar-video-evidencia.test.mjs::un video sin criterios se publica marcado como tal`.
- `scripts/e2e-cobertura-epicas.test.py::test_calcula_la_historia_de_cada_item_aunque_el_codigo_no_venga_primero`.
- `scripts/e2e-cobertura-epicas.test.py::test_cada_item_sabe_si_su_descripcion_alcanza_y_por_que_no`.
- `scripts/e2e-cobertura-epicas.test.py::test_un_item_sin_descripcion_no_cuenta_como_solo_base_de_datos`.
- `scripts/e2e-cobertura-epicas.test.py::test_un_item_ya_hecho_sin_descripcion_no_cuenta` — un `[CIERRE]` ya hecho no infla la cola.

## Local Verification

- `pnpm test:cobertura:e2e` → 11/11 en verde.
- `pnpm test:historia:item` → 5/5 en verde.
- `pnpm test:e2e:cobertura:epicas` → 5/5 en verde (`python3 scripts/e2e-cobertura-epicas.test.py`).
- `pnpm test:armar-video:e2e` → 10/10 en verde.
- `pnpm test:publicar-videos:e2e` → 2/2 en verde.
- `pnpm lint` → exit 0 (los avisos de `set-state-in-effect` son preexistentes de `apps/web`, que esta historia no toca).
- `pnpm build` → exit 0.
- `pnpm docs:check` → OK (documentación de cambios, migraciones y trampas conocidas).
- Reproducción contra el código previo (base `28ee63831`): 3 de 11 tests de `cobertura-e2e` fallan, 4 de 10 de `armar-video-evidencia`, 1 de 2 de `publicar-videos-e2e` y 5 de 5 de `e2e-cobertura-epicas` (el reporte salen `historias= 0 … base 0`). Ver `test.md`.
- Contraste de la regla sobre el repo: 221 encabezados de historia con código (la regla vieja derivaba 155) y 1953 ítems con historia (la regla vieja veía 1313): +66 historias y +640 ítems que el runner ya puede derivar. Los 1549 ítems que siguen sin código de historia quedan listados con su motivo, ya no como «sólo base de datos»: de ellos, **194 están pendientes** (la cola de trabajo que el reporte por épica cuenta) y 1355 ya están hechos (en su mayoría ítems de specs de plantilla o de cierre, que por diseño no llevan código de historia).

## Deviations from Assessment

- **El helper es un módulo aparte y no una función suelta**: el assessment pedía «un helper compartido por los tres scripts»; se implementó como módulo (`scripts/historia-item.mjs`) porque el reporte de cobertura por épica es Python y necesita la misma regla: se invoca al helper por CLI (`--stdin`) en vez de duplicar el parser en Python. Es la misma regla con una sola implementación.
- **No se hizo el gate con código de salida ≠ 0**: el assessment lo listó como alternativa («conviene como reporte + gate aparte, no como el comportamiento por defecto»). Con el repo lleno de specs viejas, un rojo por cada épica taparía el resto; la puerta visible es la lista explícita (`items_sin_descripcion` + columna propia del reporte).
- **El texto de la tarjeta no usa `textoSinEtiquetas`**: el ensamblador ya tenía su propio recorte de la primera frase (`textoItem`), que se conserva; cambiarlo sería rehacer el diseño de la tarjeta, fuera del alcance de esta historia.

## Follow-ups

- **En el tracker (fuera del repo)**: los 13 ítems con descripción corta viven en It's a Plan. El repo no puede completarlos —y no debe inventarles requisitos—: el arreglo los deja **visibles** (con el motivo), pero el texto sigue siendo trabajo de quien los creó (completar la descripción con la historia y los criterios, o cerrarlos como duplicado).
- **Consumidor del manifiesto**: `cobertura-e2e.json` lo lee el panel SDLC (repo vecino). Las dos claves nuevas (`items_sin_descripcion`, `historias_ambiguas`) son **aditivas** y el visor las ignora hasta que las consuma; hay que avisarlo al dueño del panel.
- **Rebaselinear el reporte por épica**: la primera corrida después del arreglo muestra cifras muy distintas (el reporte working tree antes salía siempre en cero). Conviene volver a levantar la línea de base de «historias SIN E2E» y «sólo base de datos».
