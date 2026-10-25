# Implementation Plan: Ventas y despacho · Ventas catálogos de cobro y envío

**Branch**: `epic/MSF-139-ventas-y-despacho-ventas-catalogos-de-co` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md)

## Summary

Cuatro catálogos de Ventas: formas de pago y de envío por empresa (pantalla Configuración de ventas, F-VTA-01/02), cuentas de cobro de la organización habilitadas por empresa con CBU y CUIT validados (F-VTA-03) y transportes con terminal de retiro (F-VTA-04). Lee quien tiene `ventas`; edita solo el Administrador. Se reutiliza el patrón CRUD de `pages/clientes`/`pages/proveedores` (RPC `security invoker`, bloqueo optimista, diálogo + lista) y `private.cuit_valido` / `apps/web/src/lib/cuit.ts`. Todo lo no pedido (RMA, contrarreembolsos, estados, tableros de despacho) queda fuera según la matriz de `spec.md`. Sin Kestra, Superset ni workers.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`.
**Primary Dependencies**: Refine + Material UI (componentes y tokens del sistema de diseño, `docs/sistema-de-diseno.md`); Supabase self-hosted (sin Cloud). Sin dependencias nuevas.
**Storage**: Postgres, esquema `dominio`: `formas_pago`, `formas_envio`, `cuentas_cobro`, `cuentas_cobro_empresas`, `transportes`, `transportes_empresas` (todas nuevas).
**Testing**: pgTAP (`supabase/tests/database/`, `pnpm test:db`), Vitest (`pnpm test:web`), `pnpm lint`, `pnpm build`, `pnpm docs:check`, `pnpm prototipo:check`, `pnpm matriz:check`.
**Target Platform**: panel web de Refine (`apps/web`) y Supabase.
**Constraints**: RLS en toda tabla expuesta; la base es la autoridad (CBU, CUIT, unicidad, aislamiento, rol Administrador); migraciones aditivas con reversión; RPC de `public` con `revoke … from public, anon` y `grant execute … to authenticated`.
**Scale/Scope**: ~70 cuentas y ~30 transportes por organización; pocos ítems por empresa en pago y envío; paginación en servidor en cuentas y transportes.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I. Aislamiento multi-tenant | RLS por `private.organizacion_id()`, `private.empresas_accesibles()` y sección `ventas`; escritura con `private.es_administrador_de`; pgTAP recorre `public` + `dominio`. |
| II. Especificar antes de implementar | Spec con matriz pantalla↔criterios, flujos y trazabilidad. |
| III. Idempotencia y auditoría | Cambio de estado idempotente; eventos `cuenta_cobro.*` en `registro_actividad` (datos bancarios). |
| IV. Despliegues independientes | Solo `refine` + `supabase`; no se toca Compose. |
| V. Simplicidad | Seis tablas, RPC mínimas por catálogo, sin infraestructura nueva. |
| VI. Panel operable | Grupo **Ventas** del menú con icono (Configuración de ventas, Cuentas de cobro, Transportes); rutas `/ventas/configuracion`, `/ventas/cuentas-cobro`, `/ventas/transportes`; audiencia: lectura `ventas`, edición Administrador; empresa activa para pago/envío; estados compartidos; 320/768/1440 px; teclado y lector; sin identificadores técnicos. Sin peso fuera del recorrido principal (carga por pestaña). |
| VII. Esquemas | Las seis tablas → `dominio` (negocio de Ventas). Re-verificar en tareas, implementación y revisión (T034). |
| VIII. Documentación | `docs/ventas-catalogos.md`, `permisos-por-rol.md`, roadmap (T033, T035). |

## Project Structure

```text
supabase/migrations/
  20261020100000_formas_pago.sql               # F-VTA-01 tabla + RLS
  20261020100100_formas_pago_rpc.sql           # F-VTA-01 RPC
  20261020110000_formas_envio.sql              # F-VTA-02
  20261020110100_formas_envio_rpc.sql
  20261020120000_cuentas_cobro.sql             # F-VTA-03 tablas + RLS
  20261020120100_cuentas_cobro_validacion.sql  # CBU/CVU + CUIT
  20261020120200_cuentas_cobro_rpc.sql
  20261020120300_cuentas_cobro_actividad.sql
  20261020130000_transportes.sql               # F-VTA-04
  20261020130100_transportes_rpc.sql
supabase/tests/database/                       # un .test.sql por historia
apps/web/src/lib/ventas/                       # tipos + llamadas RPC por catálogo, cbu.ts
apps/web/src/pages/ventas/configuracion/       # shell + FormasPagoTab + FormasEnvioTab
apps/web/src/pages/ventas/cuentas-cobro/
apps/web/src/pages/ventas/transportes/
apps/web/src/components/ventas/                # diálogos por catálogo
docs/ventas-catalogos.md
```

## Decisiones de diseño

- **Cada historia es autosuficiente**: tiene su migración (timestamp propio), sus RPC, sus tests y sus componentes; no hay helper SQL compartido nuevo (cada migración usa los helpers existentes). Único punto compartido: la pantalla Configuración de ventas, creada por F-VTA-01 con su selector de empresa y pestañas; F-VTA-02 agrega su pestaña, por eso F-VTA-02 se ejecuta después de F-VTA-01 (dependencia real de archivos, declarada en la tabla del plan de ejecución).
- **Permisos**: lectura = `private.nivel_seccion('ventas')` ∈ {`lectura`,`edicion`}; escritura = `private.es_administrador_de(organizacion_id)`; la UI oculta acciones según el rol pero la base manda.
- **Alta multiempresa** (pago/envío): la RPC recibe la lista de empresas y crea un ítem independiente por cada una, validando que sean de la organización y accesibles.
- **CBU/CVU**: 22 dígitos con dígitos verificadores de bloque (algoritmo estándar BCRA, ponderadores 7-1-3-9-7-1-3), en SQL (disparador) y en `lib/ventas/cbu.ts` con los mismos vectores.
- **Actividad**: solo cuentas de cobro; el detalle nunca incluye el CBU completo.

## Reversión

Cada migración declara en su encabezado su `drop` (tablas y funciones en orden inverso). No se altera ninguna tabla existente.

## Complexity Tracking

Sin violaciones de la constitución.
