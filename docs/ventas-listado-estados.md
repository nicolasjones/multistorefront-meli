---
owner: producto
sources:
  - specs
---

# Ventas · Listado, estados y anulación (épica MSF-177)

Guía de entrada de la épica. Spec: `specs/20261024-130000-ventas-listado-estados-y-anulacion/` (FR-001…FR-048,
SC-001…SC-009). Cada historia tiene su guía de detalle; acá se resume lo que une a las tres.

| Historia | Qué entrega | Guía de detalle |
|----------|-------------|-----------------|
| F-VTA-10 (MSF-365) | Catálogo de estados, matriz de transiciones por rol, historial y estado de cobro | [ventas-estados-comprobante.md](ventas-estados-comprobante.md) |
| F-VTA-09 | Listado con filtros y exportación (inmediata y diferida) | [ventas-listado-comprobantes.md](ventas-listado-comprobantes.md) |
| F-VTA-11 | Anulación con reversión de stock y notas de crédito | [ventas-estados-comprobante.md](ventas-estados-comprobante.md#anulación-y-nota-de-crédito-f-vta-11) |

## Listado y filtros

`public.listar_comprobantes` pagina en la base y respeta la empresa activa (Principio VIII: al cambiar de empresa
se recarga todo y se reencuadra la página). Filtros: búsqueda sin tildes/mayúsculas/espacios, tipo, estado, empresa,
operador (opciones de `operadores_de_comprobantes`) y rango de fechas. El filtro de empresa usa `FiltroEmpresa`.

## Exportación grande

Hasta 10.000 filas el navegador arma el CSV (`exportar_comprobantes`); por encima, `solicitar_exportacion_comprobantes`
encola una ejecución que toma Kestra (`infra/kestra/flows/exportar-comprobantes.yml`) y corre el worker
`workers/exportar-comprobantes`, que deja el CSV en el bucket privado `exportaciones-ventas`. La descarga firma una
URL de 60 s. Una exportación simultánea por usuario (`YA_EN_CURSO`). Detalle en la guía del listado.

## Matriz de estados y roles

La matriz vive en `dominio.transiciones_estado_comprobante` (sembrada por organización, sin escritura directa) y la
aplica `public.cambiar_estado_comprobante`. Cobrado/Deuda solo los fija el sistema
(`private.marcar_estado_cobro_comprobante`). Los valores son una **propuesta a confirmar con el cliente**; corregirlos
es una migración de datos.

## Anulación vs. nota de crédito

| | Anular | Nota de crédito |
|---|--------|-----------------|
| Cuándo | Factura confirmada, sin notas y no cobrada | Sobre una factura emitida |
| Efecto | La factura pasa a `anulada`, revierte stock y libera reservas, el número no se reutiliza | Emite un comprobante `nota_credito` con numeración propia; resta de lo facturado |
| Stock | Vuelve todo, por depósito | Solo en «Devolución de productos» |
| Permiso | acción `anular` (Administrador, Administración) | acción `emitir_nota_credito` (Administrador, Administración) |

Las dos validan el permiso en la RPC, no solo en la UI, y toman la factura `for update` (sin doble reversión ni
notas que excedan lo acreditable).

## Reversión

Todas las migraciones `20261212*` son aditivas (renumeradas desde `20261207*` para quedar por encima de `origin/dokploy`; ninguna migración de dokploy toca estas funciones). El camino de vuelta de cada historia está en su guía de detalle; los
datos ya generados (estados, anulaciones, notas, CSV) no se deshacen solos.

## Revisión de seguridad del conjunto (T039, SC-009)

Alcance: migraciones `20261212*`, worker, flow de Kestra y bucket. Lentes `authz-security`, `crypto-secrets`, `infra-security`.

| Tema | Resultado |
|------|-----------|
| RPC de `public` | Las 11 RPC nuevas de `public` llevan `revoke … from public, anon` y `grant execute … to authenticated` explícitos; `ranking_clientes` y `compras_de_cliente` conservan los suyos (`20261021160300`/`100200`/`150000`) porque se redefinen con `create or replace`. El pgTAP de `anon` sigue vigente. |
| `security definer` | Todas con `set search_path = ''`; las de datos filtran por `private.organizacion_id()` y por `puede_accion*` en la RPC. Los ayudantes de `private` no se otorgan a `authenticated`, salvo los que se usan como política o desde RPC `invoker`. |
| Pendiente menor | `private.comprobante_cuenta_como_facturado` y `private.matriz_acciones_iniciales` son puras (`immutable`, sin lectura de tablas) y no tienen `revoke` explícito. Sin impacto: no exponen datos ni están en un esquema expuesto. No se toca para no agregar una migración sin valor. |
| Concurrencia de stock | Factura y existencias `for update` en anulación, nota y reversión; bloqueo optimista por `updated_at` (`40001`); `pg_advisory_xact_lock` por usuario en la exportación. |
| Bucket | `exportaciones-ventas` privado, solo `text/csv`, tope 100 MB; lectura limitada a `<org>/<usuario>/…` del propio usuario con `exportar`. |
| Worker / secretos | La `SUPABASE_SERVICE_ROLE_KEY` solo existe en el servidor (entorno del contenedor lanzado por Kestra); nunca llega al navegador ni a Git. Las funciones de datos del worker (`datos_exportacion_comprobantes`, `filas_exportacion_comprobantes`) se otorgan solo a `workers_orquestacion`. |
| Flow / Compose | Red de egress validada contra `worker-egress-historial-ventas` antes de lanzar; secretos por `secret()`/`envs`; el Compose solo suma la variable de imagen. |
| Pendiente de negocio | Los valores de la matriz de estados y de las acciones `anular`/`emitir_nota_credito` son propuestos y esperan confirmación del cliente (documentado; se corrigen con una migración de datos o con F-ROL-02). |

Sin hallazgos que exijan cambio de código.
