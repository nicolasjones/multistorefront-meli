# Implementation Plan: Ventas y despacho · Ventas listado, estados y anulación

**Spec**: [spec.md](./spec.md) · **Épica**: MSF-177 · **Rama**: `epic/MSF-177-ventas-y-despacho-ventas-listado-estados`
**Alcance de entrega**: `refine` + `supabase` + `kestra` + `workers`. Sin `superset`.

## Resumen

Tres historias sobre el documento de venta de MSF-159. **F-VTA-10** define los estados del panel como datos (tabla de transiciones por rol, cambio de estado auditado, historial por comprobante) y los muestra en el detalle. **F-VTA-09** agrega el listado `/ventas/comprobantes` (búsqueda, filtros, tienda, paginación) y la exportación CSV: hasta 10.000 filas desde el navegador, por encima con un worker lanzado por Kestra. **F-VTA-11** agrega la anulación (revierte stock y reservas) y la nota de crédito de tres tipos, con signo negativo en lo facturado. Cada historia trae **su propia migración aditiva** y sus pruebas.

## Contexto técnico

- **Frontend**: `apps/web/src/pages/ventas/` (`comprobantes.tsx` nueva; `comprobante.tsx` y `presupuestos.tsx` de MSF-159 se extienden), `components/ventas/` (historial, diálogos, tarjeta de nota), `lib/estadosComprobante.ts`, `lib/exportarComprobantes.ts` (reutiliza `exportarClientes.ts`), `FiltroEmpresa` para la tienda (`pnpm ui:empresas:check`).
- **Base**: tabla nueva `dominio.transiciones_estado_comprobante`; columnas aditivas en `dominio.comprobantes_venta`; RPC en `public` (lecturas `security invoker`, escrituras `security definer`, `set search_path = ''`, `revoke … from public, anon`, `grant execute … to authenticated`); funciones internas en `private` sin `grant` a `authenticated`. Contratos en [contracts/ventas-listado-estados-y-anulacion.md](./contracts/ventas-listado-estados-y-anulacion.md).
- **Worker + Kestra**: `workers/exportar-comprobantes` y `infra/kestra/flows/exportar-comprobantes.yaml`, siguiendo el patrón del importador del historial (`workers/historial-importador`, `iniciar_ejecucion_worker`, outbox) y `workers/CONTRATO.md`; archivo en el bucket privado `exportaciones-ventas`.
- **Estado actual verificado**: del repo `main` existen `dominio.comprobantes_venta` (F-CLI-08), el ranking de clientes que lee `private.comprobante_cuenta_como_facturado`, `exportarClientes.ts`/`exportarRanking.ts`, `iniciar_ejecucion_worker`, `historial-importador`, los roles `mostrador`, `deposito` y `administracion` (`docs/permisos-por-rol.md`), `private.registrar_actividad` y `permisos_rol_accion`. **Viven en la rama de MSF-159** (desplegada en DEV, a mergear antes de implementar): `empresa_id` y demás columnas de la cabecera, líneas, numeración, `confirmar_comprobante`, `listar_presupuestos`, las pantallas del comprobante y de presupuestos. **No existen**: listado de comprobantes, transiciones de estado, historial por comprobante, anulación, nota de crédito, exportación de ventas, worker y flow de exportación, bucket `exportaciones-ventas`. Todo lo nuevo se crea por migración o archivo; nada se asume.

## Revisión de la Constitución

| Principio | Cumplimiento |
|---|---|
| I Aislamiento | `transiciones_estado_comprobante` con RLS por organización; RPC con organización de la sesión; bucket por prefijo de organización; pgTAP con dos organizaciones (SC-001, SC-004, SC-006, SC-007). |
| II Spec primero | Esta spec; cada tarea cita FR/SC. |
| III Idempotencia/auditoría | `cambiar_estado`, `anular` y la exportación son idempotentes; eventos `comprobante.estado_cambiado`, `comprobante.anulado`, `comprobante.nota_credito_emitida`; el worker registra origen, actor, estado, timestamps y error. |
| IV Despliegues independientes | Worker y flow con ciclo propio; sin Compose raíz; `pnpm infra:config`. |
| V Simplicidad | Sin tablas de exportación ni de estados nuevas: ejecuciones existentes y una tabla de transiciones; la edición de la matriz queda en Etapa 2. |
| VI Panel operable | Entrada «Comprobantes» en el grupo Ventas con icono, ruta `/ventas/comprobantes`, «Acceso restringido», estados compartidos, teclado/lector, 320/768/1440 px; sin carga inicial pesada (el CSV se arma bajo demanda). |
| VII Esquemas | `transiciones_estado_comprobante` y columnas nuevas en `dominio`; permisos y actividad en `public` (sin cambio de esquema); bucket en Storage. Se re-verifica en cada tarea de migración y en el PR. |
| VIII Empresa activa | Listado y exportación respetan el selector (FR-004), recargan al cambiar y los diálogos se cierran con aviso; tests SC-002, SC-005, SC-008. |
| VIII Documentación | `docs/ventas-listado-estados.md`, `docs/permisos-por-rol.md`, roadmap y `pnpm docs:check` (cierre). |

## Decisiones de diseño

- **Estados como datos**: una fila por (organización, tipo, desde, hasta, rol); `cambiar_estado_comprobante` consulta la tabla con el rol del actor en la empresa del comprobante. Cobrado/Deuda tienen actor `sistema` y solo entran por `private.marcar_estado_cobro_comprobante` (MSF-195).
- **`confirmada` = «Pendiente»**: el catálogo del frontend traduce; no se altera `confirmar_comprobante` de MSF-159.
- **Nota de crédito**: documento `nota_credito` con valores positivos y signo derivado del tipo; acreditable = facturado − notas previas (por línea o por importe). El stock vuelve solo en «Devolución de productos».
- **Anulación**: reversión localizada por la `referencia` que dejó `confirmar_comprobante`, todo o nada, con bloqueo de fila en el comprobante.
- **Exportación**: `filas` del listado decide la vía; la inmediata arma el CSV en el navegador (permiso `exportar`), la diferida pasa por ejecuciones + worker.

## Riesgos y reversión

- **Matriz de roles a confirmar** (*Decisiones abiertas* 2): al ser datos, el cambio es una migración de datos; no bloquea.
- **Nombres de MSF-159**: columnas de totales, motor de stock y `registro_actividad` se verifican contra `main` al empezar cada historia; si difieren, se ajusta la tarea y se anota `Desvío:` con commit.
- **Descarga de la exportación grande desde Ejecuciones**: si el ciclo de ejecuciones existente no admite un enlace de archivo, se traza como `Desvío:` con Tarea `seguimiento` y se entrega el aviso con la ruta del archivo.
- **`private.comprobante_cuenta_como_facturado`** cambia de comportamiento (BREAKING interno): pgTAP del ranking (SC-007) protege que el conteo de comprobantes no sume la nota.
- **Reversión**: migraciones aditivas con reversión en el encabezado (soltar la tabla de transiciones, las columnas nulables, las funciones y las filas sembradas de `permisos_rol_accion`); el PR se revierte entero con `git revert -m 1`.
