# Implementation Plan: Clientes y proveedores · Mejoras de clientes y proveedores

**Branch**: `epic/MSF-445-clientes-y-proveedores-mejoras-de-client` | **Date**: 2026-10-29 | **Spec**: `spec.md`
**Delivery scope**: `refine`, `supabase`. Sin `kestra`, `superset` ni `workers`.

## Resumen

Cuatro mejoras independientes sobre Clientes y Proveedores ya entregados: etiqueta imprimible (solo frontend), fusión de clientes (una RPC atómica + diálogo), evolución del costo por proveedor (costo de línea opcional + RPC de lectura + vista) y varios contactos por proveedor (tabla nueva + RPC + lista en la ficha). Todo con los componentes del template y sin tocar infraestructura.

## Contexto técnico (verificado en el repo)

- Frontend: `apps/web/src/pages/clientes/{list,show}.tsx`, `pages/proveedores/show.tsx`, `lib/clientes.ts`, `lib/proveedores.ts`, `components/{clientes,proveedores,stock}`. Referencia de impresión: `components/service/DocumentoA4.tsx` (`@page` + `window.print()`, `docs/service-impresion.md`).
- Base: `public.clientes` (con `numero`, `archivado_en`, `expreso_preferido`), `public.cuentas_cliente` (única por `(cliente_id, empresa_id)`), `dominio.comprobantes_venta` (FK compuesta `(cliente_id, organizacion_id)`), `dominio.proveedores`, `dominio.ingresos_mercaderia(_lineas)`, `public.registrar_ingreso_mercaderia(...)`, `public.compras_de_cliente(...)`, `private.registrar_actividad(...)`, `private.es_administrador_de(uuid)`, `private.nivel_seccion(text)`.
- Migraciones más recientes: `20270114130000`. Las nuevas usan `202701151xxxxx` (una serie por historia, sin encadenarse entre historias).
- Graphify: el grafo existe en `graphify-out/`; no se actualiza desde la spec. Todo objeto citado existe en una migración o en el código; lo nuevo se declara abajo y en `contracts/`.

## Constitution Check

| Principio | Cumplimiento |
|-----------|--------------|
| I Aislamiento | RLS por organización en `dominio.proveedores_contactos`; las RPC sacan la organización de `private.organizacion_id()`. Ningún secreto nuevo. |
| II Spec antes de implementar | Esta spec; cada tarea referencia FR/SC. |
| III Auditoría | `cliente.fusionado`, `proveedor.contacto_agregado`, `proveedor.contacto_principal_cambiado` en `registro_actividad`. La fusión es idempotente por estado (el descartado queda archivado: repetirla se rechaza). |
| IV Despliegues independientes | Sin Compose nuevo ni workers. |
| V Simplicidad | Etiqueta con `window.print()` en vez de un worker de PDF (Decisiones 5). |
| VI Panel operable | Rutas y accesibilidad abajo; carga diferida de la hoja de etiquetas. |
| VII Esquemas | Ver tabla del spec: única tabla nueva en `dominio`; re-verificar en cada tarea de migración y en la revisión del PR. |
| VIII Empresa activa | Listado de clientes: selección y consultas se reencuadran al cambiar de empresa (FR-004). Resto: no aplica (matriz). |

## Diseño por historia

### F-CLI-17 · Etiqueta (sin migración)
- `lib/etiquetasCliente.ts`: `armarEtiqueta(cliente)` y `faltantes(cliente)` puros (solo la dirección bloquea; datos vacíos se omiten).
- Lectura: `select` de las columnas necesarias de `public.clientes` por ids (RLS por organización y sección `clientes`; se verifica que `authenticated` tenga grant de `expreso_preferido`; si no, se agrega por migración aditiva en la propia historia).
- `components/clientes/HojaEtiquetas.tsx` (basada en `DocumentoA4`): una etiqueta por cliente, `@page`, `@media print` oculta menú/barra. Ruta lazy `/clientes/etiquetas?ids=…` dentro de `RequiereAccesoSeccion` (clientes lectura). Formato de la etiqueta: A4, grilla de etiquetas con nombre destacado; sin logotipo ni campos extra.
- Ficha: botones «Etiqueta» e «Imprimir etiqueta de envío». Listado: acción «Imprimir etiquetas» en la barra de selección (misma barra que el prototipo muestra para el correo a seleccionados, sin implementar el correo).
- Empresa activa: `useEmpresaActiva` invalida las consultas y limpia la selección al cambiar.

### F-CLI-18 · Fusión
- Migración `20270115100000_fusion_clientes.sql`: `public.fusionar_clientes(p_conservar_id, p_descartar_id, p_cuenta_web_de)` `security definer`, `search_path = ''`: verifica `private.es_administrador_de(org)`; `select … for update` de ambas filas ordenadas por id; valida; `update dominio.comprobantes_venta set cliente_id` y `update public.cuentas_cliente set cliente_id` (colisión por tienda: prevalece la cuenta elegida, la otra se elimina); reasigna campañas si la tabla existe (Decisiones 3); archiva al descartado; registra `cliente.fusionado`. `revoke … from public, anon`; `grant execute … to authenticated`.
- `public.vista_previa_fusion_clientes(...)` `stable`, solo lectura, mismas validaciones de permiso y organización.
- UI: `components/clientes/DialogoFusionarClientes.tsx` (búsqueda con la RPC `buscar_clientes` existente, radio «Conservar esta ficha», vista previa lado a lado, selector de cuenta web solo si ambas activas); acción en la ficha visible solo con `es administrador`.
- Reversión: no hay deshacer (fuera de alcance). La migración es aditiva (`drop function` de las dos RPC la revierte; los datos fusionados no se restauran sin respaldo).

### F-PRV-07 · Historial de costos
- Migración `20270115110000_costo_ingreso_opcional.sql`: `alter table dominio.ingresos_mercaderia_lineas alter column costo_unitario_usd drop not null` (el `check >= 0` admite `NULL`); `create or replace` de `registrar_ingreso_mercaderia` (misma firma) aceptando costo ausente y, con `p_actualizar_costo`, saltando las líneas sin costo. Reversión: `set not null` solo si no hay filas `NULL`; y restaurar la versión de `20261021180100`.
- Migración `20270115110100_historial_costos_producto.sql`: `public.historial_costos_producto(p_producto_id, p_proveedor_id default null)` `security invoker` o `definer` con chequeo explícito de `rentabilidad` y `proveedores`; une `ingresos_mercaderia` (estado `registrado`) y líneas con costo no nulo; ordena por fecha. Índice existente `ingresos_mercaderia_lineas_org_producto_idx` alcanza.
- UI: formulario de ingreso acepta costo vacío; `components/proveedores/DialogoEvolucionCosto.tsx` (tabla por fecha y serie por proveedor, vacío/carga/error) abierto desde la fila de producto de la ficha del proveedor, solo con permisos.

### F-PRV-08 · Contactos
- Migración `20270115120000_proveedores_contactos.sql`: tabla `dominio.proveedores_contactos` (`id`, `organizacion_id default private.organizacion_id()`, `proveedor_id`, `nombre` obligatorio, `rol`, `correo`, `telefono`, `principal boolean default false`, `creado_en`, `updated_at`; FK compuesta; `unique (proveedor_id) where principal`); RLS select por `nivel_seccion('proveedores')` lectura/edición; sin grants de escritura directos; índice por `(organizacion_id, proveedor_id)`.
- Migración `20270115120100_proveedores_contactos_rpc.sql`: `listar_contactos_proveedor`, `agregar_contacto_proveedor`, `marcar_contacto_principal` (desmarca el anterior y copia nombre/correo/teléfono a `dominio.proveedores` en una transacción; lock del proveedor para concurrencia).
- Migración `20270115120200_proveedores_contactos_actividad.sql`: eventos de FR-024.
- UI: `components/proveedores/ListaContactos.tsx` en la ficha; en «Editar proveedor» los tres campos de solo lectura con principal.
- Reversión: `drop` de RPC y tabla en una migración posterior (exportar antes los datos); no se destruye nada en el mismo PR.

## Plan de pruebas (`pruebas-plataforma`)

pgTAP: fusión (SC-003…005), historial (SC-007, 008), contactos (SC-010, 011), RLS en todos los esquemas expuestos. Vitest: helpers de etiqueta, hoja, diálogos, lista de contactos, evolución (SC-001, 002, 006, 009, 012). E2E Playwright de `CA-CLI-17-1` (SC-001) con `playwright-best-practices`.

## Documentación (FR-027)

`docs/clientes.md` (etiqueta, fusión, qué campañas), `docs/proveedores.md` (contactos, evolución), `docs/ingreso-de-mercaderia.md` (costo opcional), `docs/actividad.md` (3 eventos), `docs/permisos-por-rol.md`, `docs/roadmap-template.md`, `contracts/mejoras-clientes-proveedores.md`.
