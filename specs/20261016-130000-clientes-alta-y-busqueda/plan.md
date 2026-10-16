# Implementation Plan: Clientes y proveedores · Clientes alta y búsqueda

**Branch**: `epic/MSF-180-clientes-y-proveedores-clientes-alta-y-b` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

## Summary

Se extiende el esqueleto `public.clientes` con migraciones aditivas (datos de contacto, número correlativo, tipo minorista/mayorista, Consumidor final, archivado), se migra su RLS al contrato `nivel_seccion('clientes')`, se agregan las RPC `buscar_clientes`, `exportar_clientes` y `escala_de_cliente`, y se reemplaza el CRUD mínimo de `pages/clientes` por listado con búsqueda/filtros/paginación en servidor, ficha, alta/edición, archivado/restauración y exportación a Excel (`.xlsx`). Sin tablas nuevas.

## Technical Context

**Language/Version**: TypeScript / React (Vite) en `apps/web`; SQL en `supabase/migrations`

**Dependencies**: Refine, MUI — ya presentes; una dependencia nueva para generar `.xlsx` en el navegador (p. ej. `write-excel-file`, MIT; alternativa `exceljs`, MIT), con licencia permisiva verificada en T014 y carga diferida (`import()` al pulsar «Exportar») para no pesar en el recorrido principal (Principio VI); actualizar `pnpm-lock.yaml`

**Storage**: Postgres self-hosted (Supabase). Tabla existente `public.clientes`

**Testing**: Vitest + Testing Library; pgTAP en `supabase/tests/database/`. E2E Playwright: depende de MSF-499; si no existe al implementar, se cubre con Vitest + pgTAP y la tarea se cierra con desvío trazado.

**Delivery scope**: `refine`, `supabase`

**Constraints**: migraciones aditivas; nunca service-role en el navegador; `anon` sin acceso; sin copiar HTML/CSS del prototipo; Supabase self-hosted (no Cloud).

## Constitution Check

- **I / VII**: `public.clientes` conserva RLS por organización **y ahora por sección** (`nivel_seccion`). Esquema re-verificado en spec, plan y tareas: `clientes` queda en `public` por **excepción documentada** (tabla preexistente y expuesta; moverla no es aditivo y rompe `clientes_identificadores_externos` y pruebas de catálogo); su traslado a `dominio` es un seguimiento trazado (T021). No se crean tablas nuevas. ✔ (con excepción declarada)
- **II**: spec con permisos, fallos, auditoría y datos. ✔
- **III**: archivar/restaurar idempotentes; eventos de actividad en la misma transacción; el número se asigna bajo bloqueo para soportar reintentos y concurrencia. ✔
- **VI**: sin cambio de navegación (ítem «Clientes», `/clientes`, rutas existentes; se agrega la ficha `/clientes/show/:id`); patrones compartidos de estados; teclado/lector/320-768-1440 px; sin UUID visible; peso inicial sin cambios (exportación y formulario se cargan al usarse). ✔
- **VIII**: `docs/clientes.md` y actualización de `docs/permisos-por-rol.md`. ✔
- Complexity Tracking: la excepción de esquema (arriba) es la única desviación.

## Diseño de datos

Migraciones en `supabase/migrations/`, todas aditivas y con reversión documentada en su encabezado.

### M1 · `<ts>_clientes_ficha_y_numeracion.sql`

1. **Pre-chequeo** documentado: `select count(*) from public.clientes` (volumen para estimar el backfill); no destruye nada.
2. `alter table public.clientes add column`: `numero integer`, `documento text`, `correo text`, `telefono text`, `celular text`, `direccion text`, `codigo_postal text`, `localidad text`, `provincia text`, `archivado_en timestamptz`, `updated_at timestamptz not null default now()`. Límites de largo con `check (length(...) <= N)` (nombre 200, resto 120/200).
3. **Backfill** de `numero` por organización ordenado por `created_at, id`; luego `alter column numero set not null` y `create unique index clientes_org_numero_uq on public.clientes (organizacion_id, numero)`.
4. Disparador `BEFORE INSERT` `private.asignar_numero_cliente()`: toma `pg_advisory_xact_lock(hashtext(organizacion_id::text))`, calcula `coalesce(max(numero),0)+1` por organización y lo asigna si viene nulo (cubre concurrencia e inserciones sin sesión, como la importación de MSF-142).
5. Disparador `BEFORE UPDATE` para `updated_at`, y recorte (`btrim`) + validación de `nombre` no vacío. El `nombre` NO es único. `documento` vacío o solo espacios se guarda como nulo (mismo disparador).
5b. **Unicidad de DNI/CUIT (FR-016)**: función inmutable `private.documento_normalizado(text)` (`regexp_replace(lower(btrim($1)),'[^0-9a-z]','','g')`, nulo si queda vacío) e índice `create unique index clientes_org_documento_uq on public.clientes (organizacion_id, private.documento_normalizado(documento)) where documento is not null` — incluye archivados; al ser columna nueva no hay backfill ni conflicto previo. La violación (SQLSTATE `23505`, índice `clientes_org_documento_uq`) la traduce la interfaz a «Ya existe un cliente con ese DNI/CUIT» en el campo.
6. Índices de búsqueda: `(organizacion_id, lower(nombre))` para orden por defecto; para la búsqueda parcial, `pg_trgm` + GIN sobre una expresión concatenada normalizada (`private.clientes_busqueda(c)`, inmutable) si la extensión está disponible en el Postgres self-hosted (habilitarla no requiere spec); si no lo está, se cae a btree y se documenta el volumen esperado. Se verifica con `EXPLAIN` en T019.

### M2 · `<ts>_clientes_tipo_y_consumidor_final.sql`

1. `add column tipo text not null default 'minorista' check (tipo in ('minorista','mayorista'))`, `es_consumidor_final boolean not null default false`.
2. `create unique index clientes_consumidor_final_uq on public.clientes (organizacion_id) where es_consumidor_final`.
3. **Backfill**: inserta «Consumidor final» (minorista) en cada organización existente que no lo tenga.
4. Disparador `AFTER INSERT` en `public.organizaciones` → crea el Consumidor final de la organización nueva (security definer, `search_path = ''`).
5. Disparador `BEFORE UPDATE OR DELETE` en `clientes`: si la fila es `es_consumidor_final`, rechaza editar, archivar y cambiar de tipo (permite solo la cascada de borrado de la organización: se valida con `pg_trigger_depth()`/contexto de cascada, probado en pgTAP). Impide marcar `es_consumidor_final` desde la aplicación (solo lo setean los disparadores/migración: la columna no es actualizable por `authenticated`, ver M3).
6. `public.escala_de_cliente(p_cliente_id uuid) returns text`, `language sql stable`, **security invoker** (respeta RLS: nulo si no es visible): `minorista → 'x1'`, `mayorista → 'por_cantidad'`. `revoke … from public, anon; grant execute … to authenticated`.

### M3 · `<ts>_clientes_rls_por_seccion_y_actividad.sql`

1. Reemplaza `clientes_select/insert/update` por políticas con `organizacion_id = (select private.organizacion_id())` y `(select private.nivel_seccion('clientes'))` (`in ('lectura','edicion')` para select; `'edicion'` para insert/update). Sin DELETE.
2. Grants: `select, insert, update` en `public.clientes` a `authenticated` con **grant por columna** para `update` (excluye `numero`, `es_consumidor_final`, `organizacion_id`); `revoke` a `anon`/`public`.
3. Disparador `AFTER INSERT OR UPDATE` `private.registrar_actividad_cliente()` (security definer): cuando hay sesión (`auth.uid()` no nulo) registra `cliente.creado`, `cliente.editado`, `cliente.archivado` (`archivado_en` pasa de nulo a valor) o `cliente.restaurado` con `private.registrar_actividad(tipo, detalle)`; el detalle usa «Nº <numero> · <nombre>» (sin contacto). No registra si no hay cambios reales ni sin sesión.
4. Cierra el «riesgo aceptado» de `docs/permisos-por-rol.md` (lectura REST con `ninguno`).

### M4 · `<ts>_clientes_buscar_y_exportar.sql`

1. `public.buscar_clientes(p_texto text default null, p_tipo text default null, p_archivados boolean default false, p_pagina integer default 1, p_tamano integer default 25) returns table (..., total bigint)`, **security invoker** (RLS del llamador), `search_path = ''`: escapa `\ % _`, busca `ilike` sobre la expresión de búsqueda (incluido `numero::text`), filtra `tipo` y `archivado_en is null/not null`, ordena por `lower(nombre), id`, `limit/offset` con tope de `p_tamano` (≤ 100) y total por `count(*) over()`.
2. `public.exportar_clientes(p_texto, p_tipo, p_archivados, p_despues_de uuid default null, p_limite integer default 1000)`: mismos filtros, paginación por **keyset** (`(lower(nombre), id)`), **security definer** con `set search_path = ''` que exige `private.puede_accion('clientes','exportar')` y `nivel_seccion('clientes')` de lectura o más, y la organización de `private.organizacion_id()`; error `42501` si no. Tope de lote 1000 y tope total documentado (50.000 filas; superado, se informa «Afiná la búsqueda»).
3. Ambas con `revoke … from public, anon; grant execute … to authenticated`.

**Reversión** (en una migración posterior, no en el mismo PR): `drop function public.exportar_clientes(...)`, `public.buscar_clientes(...)`, `public.escala_de_cliente(uuid)`; `drop trigger`/`drop function` de numeración, actividad, Consumidor final e inmutabilidad; restaurar las políticas de `20260908172920_fundacion_multitenant.sql` (`puede_escribir()`); `drop index` de búsqueda y de unicidad; las **columnas no se borran** en el mismo PR que las crea (un `drop column` posterior solo con los datos exportados). Los clientes creados no se pierden al revertir el PR (`git revert -m 1`): quedan columnas e índices huérfanos hasta esa migración.

## Diseño de frontend

- `lib/permisos.ts`: quitar `clientes` de `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR`; `SECCION_POR_RECURSO.clientes` ya existe. Hook `usePuedeAccion('exportar')` sobre el contrato de permisos existente (`PermisosPanel`).
- `pages/clientes/list.tsx`: reescrito con `EncabezadoPagina`, buscador con espera (≈300 ms), chips Todos/Minorista/Mayorista, selector Activos/Archivados, tabla (`ContenidoAdaptable`: tarjetas en angosto) paginada en servidor vía `buscar_clientes` (hook `useBuscarClientes` con `useCustom`/`supabaseClient.rpc` y `keepPreviousData`), estados vacío/sin resultados/error compartidos, botones «Nuevo cliente» y «Exportar» según permisos.
- `pages/clientes/form` (componente `FormularioCliente`) compartido por `create.tsx` y `edit.tsx`; `pages/clientes/show.tsx` (ficha: datos, tipo, estado, historial resumido opcional fuera de alcance). Selector de tipo con la explicación del prototipo. El Consumidor final se muestra sin «Editar»/«Archivar».
- Formulario: el error `23505` de `clientes_org_documento_uq` se muestra en el campo DNI/CUIT; el nombre repetido no genera aviso.
- Archivar/restaurar: diálogo de confirmación del patrón compartido; escribe `archivado_en` por el data provider (update), sin RPC.
- `lib/exportarClientes.ts`: itera `exportar_clientes` por lotes (keyset), arma el `.xlsx` (hoja «Clientes», encabezados en la primera fila, todas las celdas de dato como texto, neutralización de `= + - @`), descarga con `Blob`; progreso y cancelación. Tope documentado: 100.000 filas por exportación (el límite de `.xlsx` es 1.048.576).
- Navegación/rutas: se agrega solo `show` al recurso `clientes` en `App.tsx`; el menú y `destinosPanel.ts` no cambian.

## Seguridad y concurrencia

Revisión `authz-security` y `database-reviewer`: RLS por organización **y** sección (no solo UI); `exportar_clientes` es `security definer` con organización en servidor, acción verificada y `search_path` vacío; `buscar_clientes`/`escala_de_cliente` son `security invoker` (heredan RLS); grants por columna; `anon` revocado; Consumidor final inmutable en la base; sin DELETE. Concurrencia: número correlativo con advisory lock por organización y `unique (organizacion_id, numero)`; archivado idempotente; Consumidor final con índice único parcial. Sin service-role en el navegador. Neutralización de fórmulas en el `.xlsx`; la librería se revisa en `supply-chain-security` (licencia, mantenimiento, árbol de dependencias).

## Pruebas

- pgTAP `clientes_alta_y_edicion.test.sql`: roles administrador/administración/mostrador/operador crean y editan; consulta/depósito/`ninguno` rechazados (insert, update y select según nivel); otra organización aislada; archivar/restaurar con evento de actividad (y sin evento sin sesión); número correlativo, sin duplicados en dos sesiones; columnas protegidas (`numero`, `es_consumidor_final`); documento repetido rechazado (también con distinto formato, también contra archivados, y en dos sesiones), mismo nombre aceptado, mismo documento en otra organización aceptado, documento vacío múltiple aceptado; sin DELETE; `anon` sin acceso.
- pgTAP `clientes_busqueda_exportacion.test.sql`: `buscar_clientes` (parcial, tildes, escape de `%`/`_`, tipo, archivados, paginación, total); `exportar_clientes` (solo con `exportar`, keyset sin repetidos/omisiones, tope); `escala_de_cliente` (minorista, mayorista, Consumidor final, ajeno → nulo).
- pgTAP Consumidor final: uno por organización (existente y nueva), inmutable, no archivable, cascada de organización permitida.
- Regresión: `permisos_por_rol` (ajustar la aserción de clientes que fijaba `puede_escribir()`), `rls_en_toda_tabla`, `aislamiento_organizaciones`, `mapeo_identificadores_clientes` y el test de `anon`.
- Vitest: listado (buscar con espera, filtros, paginación, vacío, error, permisos de botones), formulario (validación, tipo, errores, doble envío), archivar/restaurar, Consumidor final sin acciones, exportación (lotes, `.xlsx` válido que se reabre con sus columnas, fórmulas neutralizadas, progreso, error), a11y básica.
- E2E: ver Testing.
- Datos de prueba: seed local de ~5.000 clientes mixtos para verificar paginación y plan de consulta (T019).

## Documentación

`docs/clientes.md` (modelo, permisos, Consumidor final, `escala_de_cliente` como contrato para Ventas/Service técnico, búsqueda, exportación, reversión) y actualización de `docs/permisos-por-rol.md` (clientes migra a `nivel_seccion`; se retira el riesgo aceptado; Depósito no cambia), `docs/aislamiento-por-organizacion.md` (control positivo sigue en `public.clientes`). Fila de `docs/roadmap-template.md` al cierre (paso manual).

## Inventario de consumidores de `public.clientes` y verificación de esquema (T001)

Re-verificación del Principio VII en el cierre (MSF-502): la épica **no crea tablas**; solo altera `public.clientes`,
que queda en `public` por la excepción documentada arriba (traslado a `dominio` trazado en MSF-505).

| Consumidor | Uso de `clientes` | Estado |
| --- | --- | --- |
| `clientes_identificadores_externos` (`20260930140000`) | FK a `clientes(id)` | Sin cambios; `mapeo_identificadores_clientes.test.sql` sigue válido (inserta con `organizacion_id`+`nombre`, la numeración se asigna sola) |
| pgTAP `rls_en_toda_tabla`, `aislamiento_organizaciones` | Control positivo y conteo de filas (incluye Consumidor final) | Vigentes |
| pgTAP `permisos_por_rol`, `editar_matriz_permisos` | Matriz de `clientes` por rol | `permisos_por_rol` ajustado en T009 |
| `proveedor_elegible_por_capacidad` (`20261005120000`) | Menciona `clientes` | Sin dependencia de columnas nuevas |
| `apps/web/src/App.tsx` | Recurso `clientes` con `list/create/edit/show` | `show` agregado en F-CLI-01 |
| `apps/web/src/lib/permisos.ts` | `SECCION_POR_RECURSO.clientes`; `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR` vacío | Migrado a `nivel_seccion` |
| `recursosDependientesDeOrganizacion.ts`, `RequiereOrganizacionActiva` | `clientes` depende de la organización activa | Sin cambios |

Esquemas por tabla (todas ya existentes): `public.clientes` → `public` (excepción), `public.clientes_identificadores_externos` → `public`
(plataforma, mapeo genérico), `public.registro_actividad` → `public` (plataforma). Ninguna tabla de esta épica cae en `dominio`.

## Revisión de seguridad de cierre (T020)

Lectura de migraciones M1–M4 (MSF-502), criterios `authz-security` y `database-reviewer`: sin hallazgos bloqueantes.
RLS por organización y sección en select/insert/update, sin DELETE; grants por columna (`numero`, `es_consumidor_final`, `organizacion_id` fuera);
`anon` y `public` revocados en tabla y RPC; funciones `security definer` (`exportar_clientes`, disparadores de actividad y Consumidor final)
con `search_path = ''`, organización tomada de `private.organizacion_id()` y los disparadores sin `execute` para `authenticated`;
`buscar_clientes`/`escala_de_cliente` heredan RLS. Los pgTAP (`clientes_alta_y_edicion`, `clientes_busqueda_exportacion`, `clientes_tipo_y_consumidor_final`)
cubren depósito/consulta/otra organización. Los pgTAP no se corrieron en local en esta historia (requieren `pnpm dev:supabase`): los corre el CI.
