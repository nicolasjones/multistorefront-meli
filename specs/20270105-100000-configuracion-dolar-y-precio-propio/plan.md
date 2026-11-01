# Implementation Plan: Precios y dólar · Configuración dólar y precio propio

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-352 · **Rama**: `epic/MSF-352-precios-y-dolar-configuracion-dolar-y-pr`
**Alcance de entrega**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Los valores fijos de MSF-116 (umbral 1 %, confirmación 15 %, redondeo $ 10, aviso siempre activo, alcance único) pasan a una fila de configuración por organización; el alcance «una por empresa» suma `empresa_id` a las tablas de cotización con `private.cotizacion_para` como único punto de lectura; el precio propio se agrega dentro de `private.precio_neto_empresa` (el punto de extensión de MSF-114) y el simulador existente suma la marca. Tres historias, cada una con **su propia migración aditiva**.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI). Cotización: `apps/web/src/pages/cotizacion/`, `apps/web/src/components/cotizacion/` (existen `TarjetaVigente`, `DialogoCargarDolar`, `BloqueQueVaACambiar`, `TablaHistorial`, `AvisoCotizacion`), `apps/web/src/lib/cotizacion.ts`. Pestaña de precios: `apps/web/src/pages/empresas/precios.tsx`, `apps/web/src/components/precios/` (`ReglaPrecioEmpresa`, `TablaAsiQuedan`). Ficha de producto: `apps/web/src/pages/productos/edit.tsx` / `create.tsx`.
- **Base**: Supabase self-hosted. Tablas en `dominio`; RPC en `public` (`security invoker` salvo donde MSF-116 ya usa `definer`), `set search_path = ''`.
- **Estado actual verificado en el repo**: existen las tablas y RPC de MSF-116 (`20261023140000`…`140500`) y de MSF-114 (`20261022130000`…`130200`); `private.precio_neto_empresa` documenta el punto de extensión de MSF-352. **No existen**: `cotizacion_configuracion`, `empresa_id` en las tablas de cotización, `precios_propios_empresa`, `cotizacion_para`, `fijar_precio_propio`, `quitar_precio_propio`. Se proponen en las migraciones de abajo. Antes de escribir cada migración se relee la vigente (p. ej. `20261023140300`, `20261023140200`) porque se redefinen funciones.
- **Numeración**: las migraciones nuevas arrancan en `20270122100000` (posterior a la última del repo, `20270121121300`); si al implementar existe una posterior se renumera sin colisión.
- **Fecha «hoy»**: sigue `America/Argentina/Buenos_Aires` (MSF-116).

## Migraciones (una por historia, aditivas, con reversión en el encabezado)

| Historia | Archivo | Contenido |
|---|---|---|
| F-PRE-06 | `20270122100000_cotizacion_configuracion.sql` | `dominio.cotizacion_configuracion`, `obtener_`/`guardar_configuracion_cotizacion` |
| F-PRE-06 | `20270122100100_cotizacion_alcance_empresa.sql` | `empresa_id` en `cotizacion_pendiente`/`cotizaciones`/`cotizacion_aplicada`, índices únicos, `private.cotizacion_para` |
| F-PRE-06 | `20270122100150_cotizacion_cambio_alcance.sql` | `previsualizar_cambio_alcance`, `cambiar_alcance_cotizacion` |
| F-PRE-06 | `20270122100200_cotizacion_usa_configuracion.sql` | `previsualizar`/`confirmar`/`descartar_cotizacion` y `cotizacion_del_dia` leen la configuración y `p_empresa` |
| F-PRE-08 | `20270122110000_precios_propios_empresa.sql` | `dominio.precios_propios_empresa`, `fijar_`/`quitar_`/`leer_precios_propios` |
| F-PRE-08 | `20270122110100_precios_propios_calculo.sql` | `precio_neto_empresa`, `precios_empresa_neto`, `precio_visible_desde_central` con precio propio |
| F-PRE-09 | `20270122120000_simulador_precio_propio.sql` | `previsualizar_precios_empresa` con `precio_propio` |

Reversión general (migración posterior, exportando datos antes): `drop function` de cada RPC nueva; restaurar las funciones redefinidas a su versión previa; `alter table … drop column empresa_id` solo en una migración posterior a haber consolidado datos; `drop table dominio.precios_propios_empresa, dominio.cotizacion_configuracion`. Nunca en el mismo PR que las crea.

## Decisiones de diseño

- **Unicidad con `empresa_id` nulo**: índice único sobre `(organizacion_id, coalesce(empresa_id, '00000000-…'))` en lugar de cambiar la PK vigente; las filas actuales quedan válidas.
- **Una sola puerta de lectura**: `private.cotizacion_para(org, empresa)` decide por alcance; `private.a_pesos` mantiene su firma de tres argumentos (alcance «sistema») y se agrega la sobrecarga con empresa usada por `precio_neto_empresa`.
- **Precio propio dentro del cálculo, no en pantallas**: `precio_neto_empresa`, `precios_empresa_neto` y `precio_visible_desde_central` se redefinen en una sola migración (`110100`) para que ningún camino de lectura quede sin el precio propio (SC-006).
- **Redondeo**: el de la configuración rige el recálculo; el de la empresa (F-PRE-07) no se toca (Decisión abierta 1).

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización en `cotizacion_configuracion` y `precios_propios_empresa`; FK compuestas contra empresas/productos ajenos; pgTAP con dos organizaciones en cada historia. |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia y auditoría | RPC idempotentes; eventos en `registro_actividad` (`cotizacion.configuracion_guardada`, cambio de alcance, precio propio fijado/quitado) con actor. |
| V Simplicidad | Sin workers ni infraestructura; el simulador reutiliza `previsualizar_precios_empresa`. |
| VI Panel operable | Sin rutas nuevas: tarjeta en `/cotizacion` (Administración, sección `cotizacion_dolar`), pestaña existente `/empresas/edit/:id/precios` y bloque en la ficha de producto; estados compartidos; teclado, lector y 320/768/1440 px; sin identificadores técnicos visibles; vista previa de alcance con carga diferida. |
| VII Esquemas | Todo en `dominio` (tabla en spec); se re-verifica en cada fase y en el PR. |
| VIII Empresa activa | Cotización: aplica con alcance «por empresa» (sigue la barra superior, SC-004); precios: una empresa por ruta (SC-011); ficha: no depende de la activa (SC-008). |
| VIII Documentación | `docs/configuracion-dolar-y-precio-propio.md` + `docs/precios.md` + `docs/dolar-y-recalculo.md` + roadmap + `pnpm docs:check` (cierre). |

## Contratos

Declarados en [contracts/configuracion-dolar-y-precio-propio.md](./contracts/configuracion-dolar-y-precio-propio.md). Las firmas existentes ganan `p_empresa` opcional (compatible; anotado como `BREAKING:` condicional en el contrato para que el guard lo revise).

## Pruebas

pgTAP por historia (`supabase/tests/database/`), Vitest por historia, E2E de cierre (cambio de alcance con vista previa; precio propio en el simulador), `rls_en_toda_tabla`. Validación por historia: `pnpm test:db`, `pnpm lint`, `pnpm build`, `pnpm test:web`.

## Riesgos

- **Redefinir funciones de MSF-116/114** (umbral, preview, neto): con valores por defecto el resultado debe ser idéntico; los pgTAP existentes de `cotizacion_*` y `precios_*` deben seguir verdes.
- **Alcance por empresa** toca tres tablas con historial inmutable: la migración no puede modificar filas del historial (el trigger lo rechaza); solo agrega columna y índices.
- **Interpretaciones abiertas** 1–3 y 5 de la spec.
