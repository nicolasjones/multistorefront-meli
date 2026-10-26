# Implementation Plan: Ventas y despacho · Ventas despacho y faltantes

**Branch**: `epic/MSF-135-ventas-y-despacho-ventas-despacho-y-falt` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md) | **Contratos**: [contracts/ventas-despacho-y-faltantes.md](./contracts/ventas-despacho-y-faltantes.md)

**Delivery scope**: `refine`, `supabase`

## Resumen

Cuatro historias sobre `dominio.comprobantes_venta` (MSF-159):

- **F-VTA-15**: `estado_despacho` + responsables, estado inicial al confirmar (disparador, sin tocar `confirmar_comprobante`), RPC `cambiar_estado_despacho` (descuenta reservas «A pedido» al entregar), acción `despachar`, tarjeta «Responsables» en el comprobante.
- **F-VTA-16**: `transporte_id`/`guia`/`fecha_envio`, RPC `guardar_envio_comprobante`, exigencia al entregar, bloque «Envío y transporte».
- **F-VTA-17**: RPC `listar_despacho` y pantalla `/ventas/despacho` (sin artboard).
- **F-VTA-18**: `dominio.faltantes_venta`, RPC de registro y listado, pantalla `/ventas/faltantes`, diálogo «Registrar faltantes».

## Contexto técnico

- Stack: Refine + MUI (`apps/web/src/pages/ventas/*`, `components/ventas/*`, `lib/ventas*`), Supabase self-hosted, pgTAP en `supabase/tests/database/`, Vitest.
- Base reutilizada (verificada en migraciones de `main`): `dominio.formas_envio` (`20261022120100`), `dominio.transportes`/`transportes_empresas` (`20261022120700`), `dominio.reservas_stock` y `public.descontar_reserva` (`20261023130100`, exige `stock` en `edicion`: Administrador y Depósito lo tienen), `private.rol_en_empresa` (`20261016140100`), `private.puede_accion`, `private.registrar_actividad`, `dominio.existencias_deposito` y la lectura de estados de stock por depósito (`20261023120400`).
- Base de MSF-159 (verificada en `origin/epic/MSF-159-…`, ya integrada en `origin/dokploy`): `comprobantes_venta` con `empresa_id`, `envio_id`, `confirmado_en`, `updated_at`; `comprobantes_venta_lineas` (`orden`, `producto_id`, `deposito_id`, `cantidad`, `a_pedido`); `confirmar_comprobante` (reserva «A pedido» con referencia `comprobante:<id>:linea:<orden>`); `private.nivel_ventas_en_empresa`; acción `editar_precio` (la migración de `despachar` **parte de las definiciones vigentes** de `puede_accion`/`matriz_acciones_iniciales` con `editar_precio` ya incluida).
- Las migraciones de esta épica llevan timestamps `20261214…` (bloque renumerado al liberar MSF-177; antes `20261207…`): deben ser **mayores que la última versión aplicada en `dokploy`** (`20261212120600`) porque `scripts/verificar-migraciones.mjs` rechaza una versión reusada o anterior.
- El grafo (`graphify-out/graph.json`) existe; el estado de tablas/RPC se confirmó contra las migraciones, no se actualizó el grafo.
- No hay `kestra`, `superset` ni `workers`.

## Constitución — verificación

| Principio | Cumplimiento |
|---|---|
| I. Aislamiento | `faltantes_venta` con RLS por organización, sección `ventas` y empresa accesible; sin escritura directa; las RPC fijan organización y actor desde la sesión; pgTAP de aislamiento. |
| II. Spec antes de código | Esta spec; cada tarea cita sus FR/SC. |
| III. Idempotencia y auditoría | Transiciones idempotentes, bloqueo optimista, entrega todo o nada, actividad `despacho.estado_cambiado` / `despacho.faltante_registrado`. |
| IV. Monorepo | Solo `apps/web` y `supabase/`. |
| V. Simplicidad | Una tabla nueva; el resto son columnas aditivas, disparadores y RPC. Sin infraestructura nueva. |
| VI. Panel operable | Navegación: grupo **Ventas** del menú, audiencia `organizacion`, sección `ventas`. «Despacho» (`/ventas/despacho`, icono `LocalShippingIcon`) y «Faltantes» (`/ventas/faltantes`, icono `ProductionQuantityLimitsIcon`); rutas canónicas nuevas, sin rutas anteriores. Patrones de carga/vacío/error/éxito del kit; teclado y 320/768/1440 px; sin ids técnicos visibles. |
| VII. Esquemas | Ver tabla; re-verificada en spec, plan, tareas, implementación y PR. |
| VIII. Contexto de empresa | Despacho y Faltantes usan `FiltroEmpresa` y la empresa activa; filas «Empresa activa» en la matriz; un test de cambio de empresa por pantalla/diálogo (SC-003, SC-005, SC-007, SC-009). |

### Esquemas (Principio VII)

| Objeto | Esquema | Naturaleza |
|---|---|---|
| `comprobantes_venta` (alter aditiva) | `dominio` | Documento de venta |
| `faltantes_venta` (nueva) | `dominio` | Registro de negocio |
| `permisos_rol_accion` (dato + `check`) | `public` | Plataforma (permisos) |

## Estructura de archivos (prevista)

```text
supabase/migrations/
  20261214100100_despacho_columnas.sql          # F-VTA-15
  20261214100200_despacho_accion_permiso.sql    # F-VTA-15
  20261214100300_despacho_estado_inicial.sql    # F-VTA-15
  20261214100400_despacho_responsables.sql      # F-VTA-15
  20261214100500_despacho_cambiar_estado.sql    # F-VTA-15
  20261214110100_envio_columnas.sql             # F-VTA-16
  20261214110200_envio_guardar.sql              # F-VTA-16
  20261214110300_envio_exige_al_entregar.sql    # F-VTA-16
  20261214120100_despacho_listar.sql            # F-VTA-17
  20261214130100_faltantes_tabla.sql            # F-VTA-18
  20261214130200_faltantes_registrar.sql        # F-VTA-18
  20261214130300_faltantes_listar.sql           # F-VTA-18
supabase/tests/database/  despacho_*.test.sql, envio_*.test.sql, faltantes_*.test.sql
apps/web/src/lib/ventasDespacho.ts  ventasEnvio.ts  ventasDespachoLista.ts  ventasFaltantes.ts
apps/web/src/components/ventas/ResponsablesDespacho.tsx  EnvioTransporte.tsx  RegistrarFaltantesDialog.tsx
apps/web/src/pages/ventas/despacho.tsx  faltantes.tsx   (+ ajustes en comprobante.tsx, App.tsx, destinosPanel.ts)
docs/ventas-despacho.md  docs/ventas-faltantes.md
```

## Reversión (migraciones aditivas)

- Columnas de `comprobantes_venta`: `drop` de las columnas, checks e índices en migración posterior (exportar antes si ya hay despachos).
- `faltantes_venta`: `drop table` en migración posterior (se lleva los faltantes cargados: dato nuevo de esta épica).
- Acción `despachar`: restaurar el `check` y las funciones de MSF-159; borrar primero las filas `accion = 'despachar'`.
- Cada migración repite su reversión en el encabezado; ninguna destruye algo creado en el mismo PR.

## Riesgos

- **MSF-159 sin mergear en `main`**: las migraciones de esta épica no aplican hasta que llegue; las historias esperan. **Resuelto al liberar MSF-177**: `origin/dokploy` ya trae los objetos de MSF-159 (`20261203100100_comprobantes_cabecera.sql`) y esta historia los integrate (`origin/dokploy` en la rama de la épica).
- **Espera de MSF-177** (CTO, AGE-1084): **liberada** — MSF-177 está Dev Deployed (PR #343, `dokploy` `5d1406c8`). Cumplido: se integró `origin/dokploy`, las migraciones de la épica se renumeraron al bloque `20261214…` (posterior a la última de MSF-177, `20261212120600`) sin cambiar su contenido, y se re-verificó `comprobantes.estado` contra `estado_despacho`.
- **Re-verificación `estado` vs `estado_despacho` (regla 2 y 5 de *Espera de MSF-177*)**: MSF-177 (F-VTA-10) mantiene su `estado` documental con la matriz `dominio.transiciones_estado_comprobante` (que incluye `armando` e `incompleto` para Depósito) y **no** usa `estado_despacho`. Se conserva la Decisión abierta 1: **dos campos** (`estado` documental / `estado_despacho` de despacho), con nombres compartidos `armando` e `incompleto` en columnas distintas. La duplicación de nombres **persiste** (es la que la Decisión abierta 1 asume): la pantalla muestra el chip de cada eje y el combined chip es de MSF-177. Se escala al CTO en el PR de F-VTA-15 con la evidencia; no se cambia el alcance ni se recorta.
- **`descontar_reserva` exige `stock` en `edicion`**: si se habilita entregar a un rol sin ese nivel, usar una variante `private` interna (re-verificar en T005).
