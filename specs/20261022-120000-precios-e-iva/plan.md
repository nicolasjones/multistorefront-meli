# Implementation Plan: Precios y dólar · Precios e IVA

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-114 · **Rama**: `epic/MSF-114-precios-y-dolar-precios-e-iva`
**Alcance de entrega**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers` (el cálculo es SQL; el recálculo masivo del dólar es MSF-116).

## Resumen

El precio se **calcula al leer**: lista (o precio de escala) → pesos con la cotización vigente → regla de la empresa (neto) → alícuota (final) → interruptor de la empresa (precio visible). No se guarda ningún importe en pesos. Cuatro historias, cada una con **su propia migración aditiva** y sus pruebas.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI, kit `EncabezadoPagina`/`ContenidoAdaptable`/estados compartidos); formularios de producto en `apps/web/src/pages/productos` y componentes en `apps/web/src/components/precios/` (nuevo); pestaña de empresa junto a `apps/web/src/pages/empresas`.
- **Base**: Supabase self-hosted, esquema `dominio` para tablas, `public` para RPC/vistas expuestas, `private` para cálculo. Todas las RPC `security invoker`, `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`.
- **Permisos**: `private.nivel_seccion('empresas'|'categorias'|'productos'|'rentabilidad')`. Costo y margen solo con `rentabilidad`.
- **Pruebas**: pgTAP (`supabase/tests/database/precios_*.test.sql`), Vitest, E2E de cierre (ver `docs/e2e-app.md`).
- **Estado actual verificado** (grafo/repo): existen `dominio.productos(moneda, precio_lista)`, `dominio.producto_costos`, `dominio.empresas`, `public.registro_actividad` (migración `20261016120000`), `private.nivel_seccion`. **No existen aún en esta rama**: `dominio.categorias` (llega con MSF-160, rama `epic/MSF-160-…`; hay que traer `main` antes de F-PRE-12), cotización, `tipos_cliente`, alícuotas. Todo lo nuevo se crea por migración; nada se asume.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por organización en las 4 tablas nuevas; FKs compuestas con `organizacion_id`; pgTAP de dos organizaciones. |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| V Simplicidad | Sin workers ni infraestructura nueva. |
| VI Panel operable | Pestaña de empresa y bloques de formulario con estados compartidos, teclado/lector, 320/768/1440 px; sin ids técnicos visibles. Navegación: la pestaña «Precios y moneda» cuelga de la ficha de Empresa; Categorías y Productos ya están en el menú. |
| VII Esquemas | Todo en `dominio` (ver tabla en spec). Se re-verifica en cada fase y en el PR. |
| VIII Empresa activa | Producto y Categorías: **no aplica** (datos de la organización). Pestaña de empresa: una empresa por ruta, con test de cambio de empresa (FR-014). |
| VIII Documentación | `docs/precios.md` + roadmap + `pnpm docs:check` (cierre). |

## Cálculo (contrato único)

```
central_ars  = lista (moneda ARS) | lista × cotización (USD)       -- sin IVA
neto         = central_ars                                          (base «central»)
             | round((central_ars × (1 + ajuste/100)) / 10) × 10    (base «central_ajuste»)
alicuota     = productos.alicuota_iva_id ?? categorias.alicuota_iva_id
final        = round(neto × (1 + alicuota/100))                     (Exento ⇒ final = neto)
visible      = mostrar_con_iva ? final : neto
margen       = (neto − costo_ars) / neto                            -- siempre sobre el neto
```

Ejemplo de verificación: neto 29.186 y 21 % ⇒ final 35.315. La escala (F-PRE-15) solo cambia el punto de partida (`precio de la escala` en lugar de `precio_lista`).

## Migraciones (todas aditivas; reversión explícita, en migración posterior)

| Historia | Archivo | Contenido | Reversión |
|---|---|---|---|
| F-PRE-01 | `20261022120901_precios_cotizacion_inicial.sql` | `dominio.cotizacion_inicial`, RLS, `fijar_cotizacion_inicial` | `drop function public.fijar_cotizacion_inicial; drop table dominio.cotizacion_inicial;` |
| F-PRE-01 | `20261022121001_precios_conversion_central.sql` | `private.a_pesos`, `private.precio_central_ars` | `drop function …` |
| F-PRE-01 | `20261022121100_precios_costo_margen.sql` | vista/función de costo en pesos y margen (gate `rentabilidad`) | `drop view/function …` |
| F-PRE-01 | `20261022121200_precios_actividad_producto.sql` | disparador `producto.precio_actualizado` | `drop trigger/function …` |
| F-PRE-07 | `20261022130000_precios_empresa.sql` | `dominio.precios_empresa`, RLS | `drop table dominio.precios_empresa;` |
| F-PRE-07 | `20261022130100_precios_empresa_rpc.sql` | `guardar_regla_precio_empresa` | `drop function …` |
| F-PRE-07 | `20261022130200_precios_empresa_calculo.sql` | `private.precio_neto_empresa`, `public.precios_empresa_neto`, `previsualizar_precios_empresa` | `drop view/function …` |
| F-PRE-12 | `20261022140000_alicuotas_iva.sql` | `dominio.alicuotas_iva`, siembra por organización (+ disparador al crear organización) | `drop table …; drop function …` |
| F-PRE-12 | `20261022140100_categorias_productos_alicuota.sql` | `categorias.alicuota_iva_id`, `productos.alicuota_iva_id`, `guardar_alicuota_categoria`, `private.alicuota_producto`, evento | `alter table … drop column alicuota_iva_id` (solo mientras no haya datos productivos; exportar antes) |
| F-PRE-12 | `20261022140200_precios_empresa_iva.sql` | `precios_empresa.mostrar_con_iva`, extensión de la RPC de regla, `public.precios_empresa_final` | `drop view …; alter table … drop column mostrar_con_iva` |
| F-PRE-15 | `20261022150000_producto_precios_escala.sql` | `dominio.producto_precios_escala`, RLS, `guardar_precios_escala` | `drop function …; drop table …` |
| F-PRE-15 | `20261022150100_precio_para.sql` | `private.precio_para` | `drop function private.precio_para` |

Cada historia trae SU migración y **no depende de una tarea de otra**: las dependencias entre historias son de *entrega* (objetos ya mergeados), declaradas en la tabla de ejecución de `tasks.md`. Los timestamps son distintos por historia; ninguna migración edita un archivo de otra.

## Decisiones de diseño

- **Cálculo en vistas/funciones, no en worker** (Decisiones abiertas 1): una sola fuente de verdad para pantalla, Ventas, cuenta web y rentabilidad; cero riesgo de precios desactualizados al cambiar el dólar.
- **Sin precio propio por empresa** (MSF-352): `precio_neto_empresa` queda con un único punto de extensión documentado.
- **Escala por parámetro** (Decisiones abiertas 2): `precio_para` no lee `tipos_cliente` (no existe aún); el contrato `escala_precio` se prueba con un tipo simulado.
- **Guardar categoría + IVA**: se agrega `guardar_alicuota_categoria`; el diálogo de Categorías (MSF-160) la llama junto a `guardar_categoria` en el mismo Guardar. Si el equipo de MSF-160 prefiere un parámetro adicional en su RPC, es un cambio local a la tarea T021.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| `dominio.categorias` aún no está en esta rama | Traer `main` antes de F-PRE-12 (nota en spec). |
| Doble lectura de la cotización cuando llegue MSF-116 | `private.a_pesos` es el único punto de lectura: MSF-116 cambia su fuente. |
| Costo visible a quien no corresponde | Vista y funciones respetan `rentabilidad` por RLS; pgTAP lo prueba. |
| Redondeo distinto entre SQL y pantalla | La pantalla no recalcula: lee la vista y la vista previa (RPC). |

## Estructura de archivos

```text
specs/20261022-120000-precios-e-iva/{spec,plan,tasks}.md
supabase/migrations/202610221{2,3,4,5}*.sql
supabase/tests/database/precios_*.test.sql
apps/web/src/components/precios/        # PrecioCostoBloque, MargenEstimado, EscalasPrecio, ReglaPrecioEmpresa
apps/web/src/lib/{precios,iva,escalas}.ts
apps/web/src/hooks/{usePreciosEmpresa,useAlicuotas}.ts
apps/web/src/pages/empresas/precios.tsx
docs/precios.md
```
