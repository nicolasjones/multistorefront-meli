# Ventas · Transportes y terminales de retiro (F-VTA-04)

Historia MSF-251 de la épica MSF-139 (spec `specs/20261020-100000-ventas-catalogos-de-cobro-y-envio/`, FR-016…FR-019, SC-007/SC-008).
La guía general de la épica es `docs/ventas-catalogos.md`; esta nota documenta solo lo que entrega esta historia.

## Modelo (esquema `dominio`, Principio VII)

| Tabla | Esquema | Por qué |
|---|---|---|
| `dominio.transportes` | `dominio` | Catálogo del negocio de ventas y despacho; el transporte es de la **organización**, no de una tienda |
| `dominio.transportes_empresas` | `dominio` | «Empresas donde se usa» (N:M con `dominio.empresas`); sin filas = «sin disponibilidad» |

- Campos de `transportes`: nombre (único por organización, sin distinguir mayúsculas ni espacios), tipo (`expreso`, `correo`, `moto_propia`), CUIT opcional, terminal de retiro, localidad, teléfono, correo, persona de contacto, dirección de la oficina, cobra contrarreembolso, comisión % (0–100, dos decimales), plazo de rendición en días (0–3650), orden y activa.
- El CUIT, si viene, se normaliza (acepta guiones) y se valida con `private.cuit_valido` en el disparador `transportes_normalizar`; la base es la autoridad, el formulario solo lo espeja (`apps/web/src/lib/ventas/transportes.ts`).
- **Comisión y plazo son datos del catálogo**: su uso al rendir un contrarreembolso es de despacho (fuera de esta épica).

## Permisos

- **Lectura**: quien tiene la sección `ventas` en `lectura` o `edicion` (RLS por organización y `private.nivel_seccion('ventas')`).
- **Escritura**: solo el Administrador (`private.es_administrador_de`); el resto ve la pantalla sin `Nueva empresa` ni `Editar`, y la base rechaza igual cualquier escritura directa (`42501`).
- **Sin DELETE** en `transportes`: se desactiva (`Activa` apagado), no se borra. `transportes_empresas` admite DELETE del Administrador porque la RPC reemplaza el conjunto de empresas.
- `anon` sin privilegios sobre las tablas ni ejecución de las RPC.

## RPC (`public`, `security invoker`, `grant execute … to authenticated`)

- `crear_transporte(...)`, `actualizar_transporte(...)` (bloqueo optimista por `updated_at`, `40001` ante conflicto; un cambio solo de empresas también avanza `updated_at`) y `cambiar_estado_transporte(id, activa)` (idempotente).
- `listar_transportes(p_empresa_id, p_pagina, p_tamano)`: paginado, con las empresas de cada fila, filtro por tienda y los totales `total_filas` (N) y `total_organizacion` (M) para «N de M empresas de transporte». Los totales viajan en cada fila: una página fuera de rango devuelve 0 filas sin totales y el cliente vuelve a la página 1.

## Pantalla

- Ruta `/ventas/transportes`, grupo **Ventas** del menú (icono de reparto), acceso por la sección `ventas` («Acceso restringido» sin permiso).
- Desde F-VTA-14 (MSF-410) la pantalla se llama **«Transportes y contrarreembolsos»** y tiene dos sub-pestañas: **Contrarreembolsos** (la que abre por defecto; ver [contrarreembolsos-transporte.md](contrarreembolsos-transporte.md)) y **Terminales de retiro**, donde vive el catálogo de esta historia sin cambios (título, filtro `Tienda`, tabla `Empresa de transporte`/`Terminal de retiro`/`Localidad`/`Teléfono`/`Contacto`, recuento, `Nueva empresa` y el diálogo con todos los campos). Fuera de alcance (despacho): motos, columna «Envíos del mes», `Exportar` y las pestañas de otras épicas (ver matriz de la spec).

## Reversión

Migraciones aditivas `20261020130000_transportes.sql` y `20261020130100_transportes_rpc.sql`; el camino de reversión (drop de funciones, disparadores y tablas, en una migración posterior) está en el encabezado de cada una. El drop de las tablas se lleva los transportes cargados: exportar antes.

## Pruebas

- pgTAP: `supabase/tests/database/transportes.test.sql` (RLS, Administrador, CUIT, rangos, unicidad, empresas ajenas, conflicto, estado idempotente, sin DELETE, `anon`).
- Vitest: `apps/web/src/pages/ventas/transportes/list.test.tsx` (abre la sub-pestaña «Terminales de retiro» antes de mirar la tabla), `apps/web/src/pages/ventas/transportes/contrarreembolsos.test.tsx` (título, subtítulo, filtro y sub-pestañas de F-VTA-14) y `apps/web/src/components/ventas/TransporteDialog.test.tsx`.
