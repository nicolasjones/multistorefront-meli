---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Inicio y alertas: pantalla, recálculo y búsqueda global

**Épica:** MSF-156 · **Spec:** `specs/20261030-100000-inicio-y-alertas/` (`spec.md`, `plan.md`, `tasks.md`, `contracts/inicio-y-alertas.md`) · **Rama:** `epic/MSF-156-inicio-rentabilidad-y-reportes-inicio-y-` · **Historias:** F-INI-01 (MSF-344, PR #521), F-INI-02 (MSF-361, PR #523), F-INI-03 (MSF-374, PR #520), E2E de cierre (MSF-578, PR #561).

> Detalle de implementación, tablas de origen y variables: `docs/inicio-y-alertas.md` y `docs/busqueda-global.md` (viven en la rama de la épica; este documento no los duplica, resume lo que hay que saber para operar y probar). Producto: [Inicio, alertas y búsqueda](../producto/inicio-y-alertas.md).

## Decisiones

- **D-3:** Inicio es una pantalla de Refine con consultas en vivo, no un tablero de Superset (la fila del roadmap quedó alineada).
- **D-1:** «estado de las empresas» = nombre de cada empresa accesible y marca de la activa.
- **D-2:** el recálculo de alertas corre cada 15 minutos.
- **D-4:** la búsqueda global cubre solo productos (nombre o SKU).
- **Regla única de permisos:** un elemento de Inicio, una alerta o un resultado aparece solo con lectura sobre su sección de origen; un acceso directo exige edición. La autorización real es RLS / `private.nivel_seccion`.

## Frontend (`apps/web/src/`)

| Pieza | Archivo |
|---|---|
| Pantalla (ruta `/`, reemplaza la portada del template) | `pages/inicio/index.tsx`, lecturas en `lib/inicio.ts` |
| Tarjetas | `pages/inicio/TarjetaEmpresas.tsx`, `TarjetaStock.tsx`, `TarjetaConsultas.tsx`, `TarjetaDolar.tsx` |
| Accesos y alertas | `pages/inicio/AccesosDirectos.tsx`, `AlertasInicio.tsx` |
| Búsqueda global | `BusquedaGlobal` dentro de `EncabezadoPanel` (barra superior) |

Fuentes de las tarjetas: `perfiles_usuario`, `empresas_para_selector()`, `public.stock_estados`, `public.consultas_bandeja` (estado `nueva`, empresa activa), `estado_cotizacion()` y `cotizacion_del_dia()`. Carga y error son por tarjeta. Al cambiar de empresa Inicio se remonta y recarga todo (Principio VIII). Sin tarjetas de Mercado Libre hasta que existan esas épicas (FR-009, FR-027).

## Datos (migraciones aditivas `20270121120000`–`20270121120300`)

| Objeto | Esquema | Función | Reversión |
|---|---|---|---|
| `alertas_inicio` | `dominio` | una fila por alerta; RLS por organización, sección ≥ lectura y empresa accesible; sin escritura desde la app | `drop table` (migración posterior) |
| `alertas_inicio_calculos` | `dominio` | último cálculo por organización (`calculada_en`, cantidad) | `drop table` |
| `recalcular_alertas_inicio(uuid)` | `public` | reemplaza el conjunto de la organización bajo `pg_advisory_xact_lock`; solo `service_role` | `drop function` |
| `alertas_inicio_visibles` | `public` | vista `security_invoker` que lee la app | `drop view` |
| `alertas_inicio_calculo` | `public` | fecha del último cálculo (aviso de demora) | `drop view` |
| `buscar_productos_global(p_q text, p_limite int default 8)` | `public` | `security invoker`; mínimo 2 caracteres (`22023`), tope 20; `pg_trgm` para el nombre | `drop function public.buscar_productos_global(text, integer)` |

Tipos de alerta (lista cerrada por `check`): `sin_stock`, `stock_bajo`, `consultas_sin_atender`, `dolar_sin_cargar`, `margen_negativo` (este último solo si existe `analitica.margen_producto_canal`). El enlace sale de un mapa fijo por tipo, nunca de texto libre (FR-025). `pg_trgm` se habilita en la migración de la búsqueda (T017).

## Recálculo

`infra/kestra/flows/alertas-inicio.yml` (cada 15 minutos) → Edge Function `supabase/functions/recalcular-alertas-inicio` (`POST {"barrer": true}`, cabecera `x-aviso-token`) → `recalcular_alertas_inicio` por organización. Idempotente; si una organización falla, la función sigue con las demás y responde 502 para que Kestra reintente.

Variables (solo ejemplos en `.env.example`): `ALERTAS_INICIO_URL`, `ALERTAS_INICIO_APIKEY`, `SECRET_ALERTAS_INICIO_TOKEN` (base64, en `infra/kestra/.env`) y `ALERTAS_INICIO_TOKEN` (decodificado, secretos de la función).

## Guía de prueba

**Prerrequisitos:** stack local (`pnpm dev:supabase`) y web servida, o DEV; una organización con dos empresas, datos de `pnpm demo:dataset`, y usuarios con rol Administrador, Consulta y Mostrador.

**A mano:**
1. Entrá como Administrador a `/`: se ven saludo, accesos, Tus empresas, Stock hoy, Consultas nuevas, Dólar y «Qué hacer hoy».
2. Entrá como Consulta: sin accesos directos. Como Mostrador: sin la tarjeta de Consultas.
3. Cambiá la empresa activa en la barra superior: todas las tarjetas y alertas recargan, sin datos de la anterior.
4. Sin cotización de hoy: la tarjeta Dólar avisa y ofrece «Cargar ahora» solo con edición.
5. Con `calculada_en` de hace más de una hora, la tarjeta de alertas muestra el aviso de demora.
6. En la barra superior escribí 1 letra (no busca), luego 2 o más: aparecen productos; elegir uno abre `/productos/:id/edit`; un texto sin coincidencias muestra «No encontramos productos».

**Base de datos:** `supabase/tests/database/alertas_inicio.test.sql` (RLS, idempotencia, filtrado por rol, `anon` sin acceso, sin alertas de Mercado Libre) y `busqueda_global.test.sql` (por rol, `anon` sin ejecución, límites).

**Automatizado:** Vitest en `apps/web/src/pages/inicio/__tests__/` y `components/navegacion/busqueda-global.test.tsx`; `pnpm test:edge:recalcular-alertas-inicio`; `pnpm test:kestra:alertas-inicio`; E2E `apps/web/e2e/inicio.e2e.ts` con los rótulos `[MSF-578:T024]` (tres roles; cambio de empresa que recarga Inicio). Cubren SC-001, SC-002 y SC-003.

## Fuera de alcance y pendientes

| Tema | Estado / dueño |
|---|---|
| Tarjetas y alertas de Mercado Libre / precios en revisión | Fuera de alcance: se programan con las épicas de Mercado Libre. |
| Alerta `margen_negativo` | Se activa cuando exista la vista de rentabilidad (MSF-120). |
| Gráficos de ventas en Inicio | Fuera de alcance (F-REP-05). |
| Capturas del manual de usuario | TODO (dueño: Documentador): no hay guion en `apps/web/e2e/capturas/` para Inicio ni la búsqueda; generarlo y correr `pnpm docs:capturas`. |
| Documentos `docs/inicio-y-alertas.md` y `docs/busqueda-global.md` | Llegan a `main` con el merge de la rama de la épica; enlazarlos al nav entonces. |

## Reversión

Migración posterior que quite las tablas, vistas y funciones de la tabla de datos (exportar antes `alertas_inicio_calculos` si se quiere conservar el historial); en frontend, volver la ruta `/` a la portada del template y quitar `BusquedaGlobal`; desactivar el flow de Kestra. El cierre es un merge commit: `git revert -m 1 <hash>` deshace la épica completa.
