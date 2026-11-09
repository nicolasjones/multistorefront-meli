# Ayuda dentro del panel (MSF-385 · F-CFG-02)

El botón **Ayuda** (icono de signo de pregunta) de la barra superior, a la derecha de la campanita de notificaciones, abre un
panel lateral con una explicación breve de la pantalla en la que está la persona: el nombre de la pantalla, para qué sirve y los
pasos o consejos principales. Se cierra con «Cerrar» o con Escape y devuelve el foco al botón.

**La ayuda es contenido versionado en el repo.** No hay tabla, ni consultas, ni red: abrirla no lee datos de la empresa y no
depende de la empresa activa. Se revisa en el PR como cualquier otro texto.

## Piezas

| Pieza | Dónde |
|---|---|
| Botón y panel lateral | `apps/web/src/components/navegacion/PanelAyuda.tsx` (usado en `EncabezadoPanel`) |
| Textos, un módulo por sección del menú | `apps/web/src/ayuda/contenidos/` |
| Tipos y topes de longitud | `apps/web/src/ayuda/tipos.ts` |
| Resolución ruta → ayuda | `apps/web/src/ayuda/resolverAyuda.ts` |
| Criterio de coincidencia de rutas (compartido con las migas de pan) | `coincideRuta` en `apps/web/src/components/navegacion/destinosPanel.ts` |
| Tests | `ayuda/resolverAyuda.test.ts`, `ayuda/ayuda-contenidos.test.ts`, `ayuda/ayuda-cobertura.test.ts`, `PanelAyuda.test.tsx`, `coincideRuta.test.ts` |
| E2E | `apps/web/e2e/ayuda.e2e.ts` |

## Cómo se elige la ayuda de una pantalla

1. Se buscan los destinos de `SECCIONES_PANEL` cuya ruta coincide con la ubicación (exacta, o por prefijo para subrutas como
   fichas y formularios; la raíz `/` solo coincide exacta).
2. Si coinciden varios (p. ej. `/stock` y `/stock/movimientos`) gana el **más específico** (la ruta más larga). Las migas de pan
   se quedan con el primero del menú y no cambiaron; para la ayuda sería engañoso mostrar la de «Stock» en «Movimientos».
3. Si la ruta no coincide con ningún destino, el panel dice «Esta pantalla todavía no tiene ayuda».

**Limitación heredada de las migas de pan:** la coincidencia por prefijo no exige separador, así que una ruta futura como
`/stockx` coincidiría con `/stock`. Hoy ninguna ruta real colisiona (`/organizacion` y `/organizaciones` se resuelven por
«gana la más larga»). Si se endurece, hacerlo en `coincideRuta`, un solo lugar, y revisar las migas.

## Cómo agregar la ayuda de una pantalla nueva

1. Agregá el destino a `SECCIONES_PANEL` (`destinosPanel.ts`) con su `id`.
2. En el módulo de su sección (`apps/web/src/ayuda/contenidos/<seccion>.ts`) agregá una entrada **con la clave igual al `id`**:
   `titulo` (igual a la etiqueta del menú), `resumen` y, si ayuda, `pasos`.
3. Escribí en castellano rioplatense (voseo), sin términos técnicos, y **solo lo que la pantalla hace hoy**: cada botón, pestaña
   o filtro que nombres tiene que existir con ese nombre. Si el permiso condiciona una acción, decilo.
4. Corré `pnpm --filter @platform/web test`.

## La regla de cobertura

`ayuda-cobertura.test.ts` falla si a un destino del menú le falta su ayuda o si hay una entrada sin destino. Así el CI impide
dejar una pantalla sin ayuda y evita textos huérfanos tras renombrar un destino.

## Brevedad

`ayuda-contenidos.test.ts` verifica: el título coincide con la etiqueta del menú, el resumen y los pasos respetan los topes de
longitud (sin pasos repetidos) y que no aparezcan términos técnicos (RPC, API, RLS, etc.). Los topes viven **solo** en
`tipos.ts` (`AYUDA_MAX_*`): ahí se ajustan.

## Accesibilidad

El panel es un diálogo con nombre accesible (el título de la pantalla), se opera por teclado, tiene botón «Cerrar», cierra con
Escape y devuelve el foco al botón. `PanelAyuda.test.tsx` verifica el diálogo, el foco y axe; el ancho (320, 768 y 1440 px: el botón
y el panel caben en la pantalla y la página no desborda) lo verifica **solo el E2E** `ayuda.e2e.ts`, porque jsdom no tiene layout.

## Empresa activa: no aplica

La ayuda es la misma para todas las empresas y no consulta datos.

## Reversión

Quitar `<PanelAyuda />` de `EncabezadoPanel` oculta la función. No hay migraciones ni datos que revertir.

## Verificación de los textos

Los 44 textos se contrastaron contra el código de cada pantalla (botones, pestañas, filtros, permisos) con una verificación
independiente; las afirmaciones no respaldadas se corrigieron antes del PR. Si cambia una pantalla, revisá su ayuda.
