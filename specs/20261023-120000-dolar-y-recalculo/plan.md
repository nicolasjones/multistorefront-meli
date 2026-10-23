# Implementation Plan: Precios y dólar · Dólar y recálculo

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-116 · **Rama**: `epic/MSF-116-precios-y-dolar-dolar-y-recalculo`
**Alcance de entrega**: `refine` + `supabase`. Sin `kestra`, `superset` ni `workers` (el recálculo es una transacción SQL; el vencimiento de 24 h se resuelve al consultar).

## Resumen

El precio se **calcula al leer** (MSF-114) con `private.a_pesos`. Esta épica cambia **de dónde sale la cotización**: de `cotizacion_inicial` a una `cotizacion_aplicada` que se mueve solo al confirmar una carga cuya variación alcanza el umbral. «Recalcular todos los precios de todas las empresas juntos» equivale a cambiar esa única fila por organización dentro de una transacción, junto con la fila del historial, los eventos de actividad y el conteo de precios afectados. Cuatro historias, cada una con **su propia migración aditiva**.

## Contexto técnico

- **Frontend**: `apps/web` (Refine + MUI, kit `EncabezadoPagina`/`ContenidoAdaptable`/estados compartidos). Pantalla en `apps/web/src/pages/cotizacion/`, componentes en `apps/web/src/components/cotizacion/` (nuevo), hooks en `apps/web/src/hooks/useCotizacion.ts`, formato en `apps/web/src/lib/cotizacion.ts`. Portada: `Home` en `apps/web/src/App.tsx`.
- **Base**: Supabase self-hosted. Tablas en `dominio`; RPC en `public` (`security invoker` salvo `confirmar_cotizacion`, ver abajo), `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`.
- **Permisos**: `private.nivel_seccion('cotizacion_dolar')` (el Jira lo llama `cotizacion`).
- **`confirmar_cotizacion` es `security definer`**: es el **único camino de escritura** a `cotizaciones` y `cotizacion_aplicada` (sin grants de insert/update para `authenticated`); verifica `edicion` y la organización de la sesión dentro de la función. Es la excepción acotada al estilo `security invoker` del repo, justificada por el historial append-only. Se revisa en FR-024.
- **Concurrencia**: `confirmar_cotizacion` toma `pg_advisory_xact_lock` por organización (o `select … for update` sobre la pendiente) para que una sola confirmación gane.
- **Fecha «hoy»**: `(now() at time zone 'America/Argentina/Buenos_Aires')::date`.
- **Estado actual verificado** (repo/grafo): existen `dominio.cotizacion_inicial` (migración `20261022120901`), `private.a_pesos` y `private.precio_central_ars` (`20261022121001`), `private.aplicar_regla_precio`/`private.precio_neto_empresa` (`20261022130200`), `public.registro_actividad` + `private.insertar_actividad` (`20261016120000`), `private.nivel_seccion`, sección `cotizacion_dolar` en `permisos_rol` y `apps/web/src/lib/permisos.ts`. **No existen**: `cotizacion_pendiente`, `cotizaciones`, `cotizacion_aplicada`, ninguna RPC de este módulo, la ruta `/cotizacion`. Se proponen en las migraciones de abajo; ninguna se asume.
- **Dependencia declarada**: MSF-114 (precios-e-iva) provee lo anterior; está en Review/DEV y libera esta épica.

## Migraciones (una por historia, aditivas, con reversión en el encabezado)

| Historia | Archivo | Contenido |
|---|---|---|
| F-PRE-02 | `supabase/migrations/20261023140000_cotizacion_tablas.sql` | `dominio.cotizacion_pendiente`, `dominio.cotizaciones` (DDL, RLS, grants de lectura) |
| F-PRE-02 | `supabase/migrations/20261023140100_cotizacion_cargar_estado.sql` | `public.cargar_cotizacion`, `public.estado_cotizacion` |
| F-PRE-03 | `supabase/migrations/20261023140200_cotizacion_previsualizar.sql` | `public.previsualizar_cotizacion` (y función privada de neto con cotización dada) |
| F-PRE-03 | `supabase/migrations/20261023140300_cotizacion_confirmar_recalculo.sql` | `dominio.cotizacion_aplicada`, redefinición de `private.a_pesos`, `public.confirmar_cotizacion`, `public.descartar_cotizacion`, eventos |
| F-PRE-04 | `supabase/migrations/20261023140400_cotizacion_historial.sql` | trigger de inmutabilidad, `public.listar_cotizaciones` |
| F-PRE-05 | `supabase/migrations/20261023140500_cotizacion_aviso.sql` | `public.cotizacion_del_dia` |

Reversión general (migración posterior, exportando datos antes): `drop function` de cada RPC, restaurar `private.a_pesos` a leer solo `cotizacion_inicial`, `drop table dominio.cotizacion_aplicada, dominio.cotizaciones, dominio.cotizacion_pendiente`.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | RLS por `organizacion_id` en las 3 tablas nuevas; pgTAP con dos organizaciones en cada historia. |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia y auditoría | `confirmar_cotizacion` idempotente y serializada; eventos `cotizacion.*`/`recalculo.*` con actor y detalle. |
| V Simplicidad | Sin workers ni infraestructura nueva; vencimiento al consultar. |
| VI Panel operable | Ruta `/cotizacion`, ítem «Cotización del dólar» en el grupo Administración del menú (icono de moneda), audiencia: secciones `cotizacion_dolar`≥`lectura`; estados de carga/vacío/error/éxito compartidos; teclado, lector y 320/768/1440 px; sin identificadores técnicos visibles; el diálogo se carga diferido. Sin rutas anteriores que mantener. |
| VII Esquemas | Todo en `dominio` (tabla en spec). Se re-verifica en cada fase y en el PR. |
| VIII Empresa activa | **No aplica**: la cotización es de la organización. Se declara en la matriz y se prueba que cambiar de empresa no altera la pantalla (SC-004). |
| VIII Documentación | `docs/dolar-y-recalculo.md` + roadmap + `pnpm docs:check` (cierre). |

## Contratos

Las RPC nuevas están declaradas en [contracts/dolar-y-recalculo.md](./contracts/dolar-y-recalculo.md). `private.a_pesos` mantiene su firma (cambia solo la fuente): no es BREAKING.

## Pruebas

pgTAP por historia (`supabase/tests/database/cotizacion_*.test.sql`), Vitest por historia, E2E de cierre (1050 con vigente 1000; 1005 sin recálculo), `rls_en_toda_tabla`. Validación por historia: `pnpm test:db`, `pnpm lint`, `pnpm build`, `pnpm test:web`.

## Riesgos

- **Acumulación bajo umbral** (Decisión abierta 3): cargas de <1 % sucesivas no recalculan.
- **`a_pesos` sin fila aplicada** vuelve a `cotizacion_inicial`: mientras no haya ninguna carga recalculada los precios siguen como hoy.
- **Rol `administracion` con edición** (Decisión abierta 6).
