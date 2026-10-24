# Implementation Plan: Clientes y proveedores · Migración inicial de datos

**Spec**: [spec.md](spec.md) · **Contratos**: [contracts/migracion.md](contracts/migracion.md) · **Rama**: `epic/MSF-142-clientes-y-proveedores-migracion-inicial`

## Resumen técnico

Asistente genérico en `apps/web/src/pages/migracion/` (subir CSV → mapear → vista previa → aplicar → informe). El CSV se parsea en el navegador (sin dependencia nueva, D2) y se envía por lotes a RPC `security definer` por entidad; cada lote es atómico y hace upsert por identificador externo (idempotente). Sin workers, Kestra ni Superset.

## Estado actual verificado (repo)

- `public.clientes` + `clientes_identificadores_externos (cliente_id, sistema text, identificador_externo; unique(sistema, identificador_externo))`; `clientes_empresas` habilita clientes nuevos en todas las tiendas por defecto.
- `dominio.proveedores` (unique `(organizacion_id, cuit)`, sin `id_externo`) → se agrega la columna.
- `dominio.productos.sku`, `proveedor_id`, `codigo_proveedor` existen (MSF-205/160).
- Historial de ingresos: `apps/web/src/pages/stock/ingresos.tsx` + `PestanasStock.tsx`.
- NO existe `clientes.id_externo`; no se agrega (D1). T001 verifica si `sistema` del mapeo exige fila en `sistemas_externos` (el comentario de la tabla dice texto libre; si la exige, se agrega la fila en la misma migración).
- Si el botón «Importar» de Clientes no existe todavía en `list.tsx`, T006 lo agrega.

## Esquemas (Principio VII — re-verificar en tareas, implementación y PR)

`migracion_cargas`, `migracion_filas` → `public` (plataforma); `archivo_ingresos_mercaderia` y `proveedores.id_externo` → `dominio`. RLS por organización con `private.organizacion_id()`; el archivo, solo `select`.

## Migraciones (aditivas, con reversión)

| Historia | Migración | Reversión |
|---|---|---|
| F-MIG-01 | `20261201100000_migracion_cargas.sql` (cargas, filas, RPC iniciar/cerrar, `aplicar_lote_clientes`) | `drop function ...; drop table public.migracion_filas, public.migracion_cargas;` |
| F-MIG-02 | `20261201110000_proveedores_id_externo.sql` (+ columna, índice único parcial, RPC proveedores y vínculos) | `drop function ...; alter table dominio.proveedores drop column id_externo;` (en un PR posterior al que la crea) |
| F-MIG-03 | `20261201120000_archivo_ingresos_mercaderia.sql` (tabla, RLS select, RPC de carga) | `drop function ...; drop table dominio.archivo_ingresos_mercaderia;` |
| F-MIG-04 | `20261201130000_migracion_conciliacion.sql` (`informe_conciliacion_migracion`) | `drop function ...;` |

Cada historia trae su propia migración; no se encadenan entre sí.

## Estructura

```text
apps/web/src/pages/migracion/      # asistente, definiciones por entidad (clientes.ts, proveedores.ts, ingresos.ts), informe
apps/web/src/pages/stock/          # pestaña «Archivo anterior al sistema»
supabase/migrations/ , supabase/tests/database/migracion_*.test.sql
docs/migracion-inicial-de-datos.md
```

## Pruebas

pgTAP: RLS/aislamiento entre organizaciones, `anon` sin acceso, solo Administrador, idempotencia, archivo sin escritura y stock intacto. Vitest: parseo CSV, mapeo, vista previa con errores por fila, cambio de empresa. Fixtures sintéticos únicamente.

## Constitución

I RLS y sin service-role ✔ · II spec primero ✔ · III idempotente y auditable (cargas/filas) ✔ · V sin infraestructura nueva ✔ · VI navegación/estados/320-1440 ✔ · VII esquemas declarados ✔ · VIII empresa activa declarada «no aplica» con motivo y test ✔ · Documentación: `docs/migracion-inicial-de-datos.md`, `docs/clientes.md`, `docs/proveedores.md`, `docs/ingreso-de-mercaderia.md`, `docs/permisos-por-rol.md`, `docs/roadmap-template.md` al cierre.
