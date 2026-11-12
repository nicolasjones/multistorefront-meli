---
owner: tecnico
sources:
  - specs
  - supabase/migrations
  - apps/web/src
---

# Clientes: modelo, RPC y pantallas (MSF-180)

**Épica:** MSF-180 — Clientes y proveedores · Clientes alta y búsqueda.
**Historias:** F-CLI-01 (MSF-262), F-CLI-02 (MSF-282), F-CLI-03 (MSF-301), F-CLI-04 (MSF-318).
**Spec:** `specs/20261016-130000-clientes-alta-y-busqueda/` (`spec.md`, `plan.md`, `tasks.md`).
**Alcance de entrega:** `refine` (`apps/web`) y `supabase` (migraciones, RPC y pgTAP). Sin `kestra`,
`superset` ni `workers`.
**Guía de producto:** [Clientes](../clientes.md).

## Estado de entrega

La épica está **integrada en `main`**: las migraciones `20261016130000`–`20261016160000` y las
pantallas `/clientes` (listado, alta, edición y ficha) están en el árbol. Las historias se cerraron por
PR separados (`#83` F-CLI-01/MSF-262, `#81` F-CLI-02/MSF-282, `#82` F-CLI-03/MSF-301, `#80`
F-CLI-04/MSF-318). La columna «Expreso preferido» y la tabla fiel del prototipo llegaron después, en
`20261017120001_clientes_expreso_preferido.sql` (fuera de MSF-180).

Todo lo de abajo está verificado contra esas migraciones y contra el código de `apps/web`.

## Modelo de datos

**No hay tablas nuevas.** La épica extiende `public.clientes`, que ya existía como esqueleto del
template (`id`, `organizacion_id`, `nombre`, `created_at`; creada en
`20260908172920_fundacion_multitenant.sql`). La tabla queda en **`public`** por **excepción
documentada** al Principio VII: es preexistente y expuesta, y moverla a `dominio` no es aditivo ni
rompe `clientes_identificadores_externos` ni el control positivo de las pruebas de aislamiento. El
traslado a `dominio` quedó trazado como seguimiento: [MSF-505].

| Tabla / objeto | Estado | Cambio |
|---|---|---|
| `public.clientes` | **alterada** | Gana `numero integer not null` (correlativo por organización), `documento`, `correo`, `telefono`, `celular`, `direccion`, `codigo_postal`, `localidad`, `provincia`, `archivado_en timestamptz`, `updated_at timestamptz not null default now()`, `tipo text not null default 'minorista'` y `es_consumidor_final boolean not null default false`. |
| `public.organizaciones` | existente | Recibe el disparador `organizaciones_crear_consumidor_final`: cada organización nueva nace con su «Consumidor final». Sin cambios de esquema. |
| `public.registro_actividad` | existente | Recibe `cliente.creado`, `cliente.editado`, `cliente.archivado` y `cliente.restaurado`. Sin cambios de esquema. |
| `public.clientes_identificadores_externos` | existente | FK a `clientes(id)`; sin cambios. El mapeo de identificadores sigue válido (la numeración se asigna sola). |

```mermaid
erDiagram
  ORGANIZACIONES ||--o{ CLIENTES : "es dueña"
  ORGANIZACIONES ||--o{ REGISTRO_ACTIVIDAD : "es dueña"

  CLIENTES { uuid id PK
             uuid organizacion_id FK
             integer numero "nueva: correlativo por organización"
             text nombre "obligatorio, recortado, no único"
             text documento "nueva: DNI/CUIT único por organización"
             text correo "nueva"
             text telefono "nueva"
             text celular "nueva"
             text direccion "nueva"
             text codigo_postal "nueva"
             text localidad "nueva"
             text provincia "nueva"
             text tipo "nueva: minorista | mayorista"
             boolean es_consumidor_final "nueva: uno por organización"
             timestamptz archivado_en "nueva: archivar/restaurar"
             timestamptz updated_at "nueva: bloqueo optimista"
             timestamptz created_at }
  REGISTRO_ACTIVIDAD { uuid id PK
                        uuid organizacion_id FK
                        uuid actor_id FK
                        text tipo "cliente.creado | editado | archivado | restaurado"
                        text detalle "sin datos de contacto"
                        timestamptz creado_en }
```

Restricciones e índices sobre `public.clientes`:

| Objeto | Qué garantiza |
|---|---|
| `clientes_org_numero_uq` (único) | Un número por `(organizacion_id, numero)`. |
| `clientes_org_documento_uq` (único parcial) | Un DNI/CUIT por organización, comparado **solo por dígitos y letras** (`private.documento_normalizado`) e **incluyendo archivados**, para que restaurar nunca choque. |
| `clientes_consumidor_final_uq` (único parcial) | Un solo Consumidor final por organización. |
| `clientes_org_nombre_idx` | Orden por defecto `(organizacion_id, lower(nombre), id)`. |
| `clientes_busqueda_trgm_idx` (GIN trigram) | Búsqueda parcial sobre la expresión normalizada (nombre + documento + correo + teléfono + celular + localidad + número). |
| `clientes_largos_ck` | Topes de largo de los campos de la ficha; **creado `NOT VALID`** para no abortar el despliegue si un cliente heredado excede el tope. Validarlo es un paso aparte, tras auditar. |
| `clientes_tipo_ck` | `tipo in ('minorista','mayorista')`. |
| `clientes_consumidor_final_ck` | El Consumidor final es minorista y no está archivado. |

## Migraciones

| Migración | Qué agrega |
|---|---|
| `20261016130000_clientes_ficha_y_numeracion.sql` | Columnas de la ficha, backfill de `numero` y `set not null`, disparadores `clientes_asignar_numero` (advisory lock) y `clientes_normalizar`, `private.documento_normalizado` + índice único de documento, índices de orden y de búsqueda. |
| `20261016130200_clientes_rls_por_seccion_y_actividad.sql` | Reemplaza las políticas de `private.puede_escribir()` por `private.nivel_seccion('clientes')`, grants por columna, disparador `clientes_registrar_actividad`. |
| `20261016130300_clientes_tipo_y_consumidor_final.sql` | `tipo` y `es_consumidor_final`, índice único parcial, backfill del Consumidor final, disparador `organizaciones_crear_consumidor_final`, inmutabilidad (`clientes_proteger_consumidor_final`) y `public.escala_de_cliente`. |
| `20261016140000_clientes_buscar.sql` | `public.buscar_clientes` (M4, parte 1). |
| `20261016150000_clientes_exportar.sql` | `public.exportar_clientes` (M4, parte 2). |
| `20261016160000_clientes_habilitar_pg_trgm.sql` | Habilita `pg_trgm` en `extensions` y garantiza el índice GIN: **aborta con error si el índice no queda creado**, para que no haya un salto silencioso (en CI la extensión no estaba instalada y la migración de la ficha no creaba el índice). |

La orden es deliberada: M3 reinicia los grants por columna, por eso M2 (`tipo`) va después.

## RLS, grants y columnas protegidas

`20261016130200` y `20261016130300` dejan la tabla así:

- **`select`**: `organizacion_id = private.organizacion_id()` **y** `private.nivel_seccion('clientes')`
  en (`lectura`, `edicion`).
- **`insert` / `update`**: misma organización **y** `nivel_seccion('clientes') = 'edicion'`.
- **Sin `delete`**: no hay política ni grant de borrado para nadie. La única baja física es la cascada
  al borrar la organización. La columna `archivado_en` es el «eliminar lógico» (FR-003).
- **Grants por columna**: `authenticated` puede escribir `nombre`, `documento`, `correo`, `telefono`,
  `celular`, `direccion`, `codigo_postal`, `localidad`, `provincia`, `archivado_en` y `tipo`.
  **No** puede escribir `numero` (lo asigna la base), `es_consumidor_final` (solo los disparadores) ni
  `organizacion_id`.
- **`anon` y `public`**: sin ningún privilegio sobre la tabla ni ejecución de las RPC.

El contrato por rol y la matriz vigente están en [Permisos por rol](../permisos-por-rol.md); el
aislamiento, en [Aislamiento por organización](../aislamiento-por-organizacion.md).

Matriz inicial sembrada en `20261013130002_roles_basicos_permisos.sql` para la sección `clientes`
(`E` = edición, `L` = lectura, `N` = ninguno):

| Rol | Nivel | Acción `exportar` |
|---|---|---|
| Administrador | `edicion` | sí |
| Operador | `edicion` | sí |
| Administración | `edicion` | sí |
| Mostrador | `edicion` | no |
| Consulta | `lectura` | no |
| Miembro | `lectura` | no |
| Depósito | `ninguno` | no |

`exportar` se concede por rol en `permisos_rol_accion` (administrador, operador y administración). La
matriz es editable desde Usuarios y roles (MSF-125); esta épica no la cambia: el texto de la épica que
decía «Depósito solo lee» quedó **sin aplicar** (Decisión 1 de la spec) y la divergencia está anotada
en el PR de la historia.

## Número correlativo y unicidad de documento

- **Número**: `private.asignar_numero_cliente()` (`BEFORE INSERT`) toma
  `pg_advisory_xact_lock(hashtext(organizacion_id::text))` y asigna `coalesce(max(numero),0)+1` de su
  organización **solo si viene nulo**. Serializa las altas de la misma organización: no hay números
  duplicados bajo concurrencia, y las inserciones sin sesión (importación de MSF-142, API) también
  numeran. El backfill de `20261016130000` ordenó por `created_at, id`.
- **Documento**: `private.documento_normalizado(text)` quita puntos, guiones, espacios y mayúsculas
  (`regexp_replace(lower(btrim(x)),'[^0-9a-z]','','g')`); vacío → nulo. La unicidad la impone el
  índice parcial `clientes_org_documento_uq`, no la interfaz. La violación es `23505` y la interfaz la
  traduce a «Ya existe un cliente con ese DNI/CUIT» **en el campo**. Dos clientes con el mismo nombre
  sí pueden coexistir.
- **Normalización**: `private.normalizar_cliente()` (`BEFORE INSERT OR UPDATE`) recorta el nombre
  (error `23514` si queda vacío), deja en `null` los campos de contacto en blanco y refresca
  `updated_at`.

## Tipo de cliente y Consumidor final

- `tipo` es `minorista` (default) o `mayorista`, con `check` en base; **no hay tabla de tipos ni
  pantalla para crearlos** (el prototipo las tenía; quedan fuera de alcance).
- El **Consumidor final** es un cliente más, de tipo minorista, que existe en todas las
  organizaciones: por backfill en las existentes y por el disparador `organizaciones_crear_consumidor_final`
  en las nuevas. Recibe el siguiente número de su organización (es el 1 solo en organizaciones nuevas).
- Es **inmutable en la base**: `clientes_proteger_consumidor_final` (`BEFORE UPDATE OR DELETE`) rechaza
  editarlo, archivarlo, cambiarle el tipo o borrarlo, incluso para `postgres`/`service_role`. Solo se
  permite el borrado en cascada al eliminar la organización. `es_consumidor_final` no se concede a
  `authenticated`: nadie puede convertir a otro cliente en Consumidor final.

## Descuento por cliente (MSF-193 · F-VTA-32)

La columna `descuento` la agrega la épica **MSF-193** (*Ventas y despacho · Ventas mejoras*, spec
`specs/20261027-100000-ventas-mejoras`), historia **F-VTA-32** (Jira **MSF-340**). Migración
`20270201200102_clientes_descuento.sql`, en la rama `epic/MSF-193-ventas-mejoras` y `dokploy`, pendiente
de merge a `main`; reversión en el encabezado de la migración y en
[Precios especiales por cliente (técnico)](ventas-precios-especiales.md#reversión).

| Objeto | Estado | Cambio |
|---|---|---|
| `public.clientes` | **alterada** | Gana `descuento numeric(5,2)`: porcentaje de 0 a 100 con dos decimales, `null` = sin descuento. `check (descuento is null or (descuento >= 0 and descuento <= 100))` (`clientes_descuento_ck`). |
| `public.permisos_rol_accion` | existente | Sin cambio: el descuento no es una acción de la matriz; lo gatea el rol efectivo de Administrador. |

- **Permiso**: `grant update (descuento) on public.clientes to authenticated` — el permiso es **por
  columna**. **No se concede en `INSERT`**: un cliente nace sin descuento.
- **Solo el Administrador** lo cambia: el disparador `clientes_descuento_solo_admin`
  (`before update of descuento`) responde `42501` («Solo un administrador puede cambiar el descuento del
  cliente», `hint = 'descuento'`) si el descuento cambia y la sesión no es de un Administrador de la
  organización. Las cargas **sin sesión** (importación, API de servicio) no pasan por el disparador
  (`auth.uid()` es `null`).
- **Auditoría**: el disparador `clientes_descuento_registrar_actividad` (`after update of descuento`)
  registra el evento **`cliente.descuento_editado`** en la **misma transacción**. El detalle lleva «Nº
  <número> · <nombre>» y **no** incluye el valor del descuento.
- **Cómo lo usa Ventas**: `public.guardar_lineas_comprobante` lo lee **en el servidor**
  (`select cl.tipo, coalesce(cl.descuento, 0) … from public.clientes`) y lo resta **sobre el neto de
  escala, antes del IVA**. El `payload` de la RPC **no puede imponer** un descuento. Un `precio_manual`
  no se toca.
- **Frontend**: el campo **«Descuento (%)»** del formulario solo se renderiza para el Administrador
  (`useEsAdministrador`); los demás roles no lo ven y no lo envían. La validación es «Ingresá un
  porcentaje entre 0 y 100, con hasta 2 decimales.». En la ficha, el valor se lee como `5 %` (o `—`).

## Contratos RPC

| RPC | Qué hace | Seguridad |
|---|---|---|
| `public.buscar_clientes(p_texto text, p_tipo text, p_archivados boolean, p_pagina integer, p_tamano integer)` | Listado paginado con total: `id`, `numero`, `nombre`, `documento`, `correo`, `telefono`, `celular`, `localidad`, `expreso_preferido`, `tipo`, `es_consumidor_final`, `archivado_en` y `total`. Búsqueda parcial e insensible a mayúsculas en nombre, documento, correo, teléfono, celular, localidad y número; escapa `\`, `%` y `_`; filtra por tipo y por activos/archivados; ordena por `lower(nombre), id`. Página de 25 por defecto, tope 100. | `security invoker` (hereda RLS); `search_path = ''`; `revoke` a `public, anon`; `grant` a `authenticated`. |
| `public.exportar_clientes(p_texto text, p_tipo text, p_archivados boolean, p_despues_de uuid, p_limite integer)` | Mismas filas que la búsqueda, en **lotes por keyset** `(lower(nombre), id)`: devuelve `id`, `numero`, `nombre`, `documento`, `tipo`, `correo`, `telefono`, `celular`, `direccion`, `codigo_postal`, `localidad`, `provincia`, `expreso_preferido`, `archivado_en` y `total`. Tope de lote 1000; tope total 50.000 filas. | `security definer`, `search_path = ''`; exige `private.puede_accion('clientes','exportar')`; organización de `private.organizacion_id()`, nunca de un parámetro; `42501` sin permiso, `54000` si supera el tope, `40001` si el cursor ya no existe. |
| `public.escala_de_cliente(p_cliente_id uuid)` | Escala de precios del cliente: `x1` para minorista, `por_cantidad` para mayorista; `null` si el cliente no existe o no es visible. | `security invoker` (hereda RLS); `revoke` a `public, anon`; `grant` a `authenticated`. |

**Regla de `escala_de_cliente`:** es un contrato **provisorio** hasta que Precios decida si la escala la
fija el tipo o la cantidad. Si cambia, cambia solo el cuerpo de la función; Ventas y Service técnico no
se enteran.

Detalle de las RPC en [API y RPC](api.md#clientes-msf-180).

## Búsqueda: índices y plan

- La expresión de búsqueda es la **misma** del índice GIN `clientes_busqueda_trgm_idx`, para que el
  planificador lo use.
- La búsqueda es insensible a mayúsculas pero **no ignora tildes**: «ñ» no coincide con «n». No hay
  `unaccent` en el índice.
- La pantalla espera **≈300 ms** antes de consultar (no busca en cada tecla) y vuelve a la primera
  tanda cuando cambia el texto.
- El navegador **nunca** carga la lista completa: la paginación, el total y los filtros se resuelven en
  el servidor. La pantalla **acumula** las tandas (25 por vez) con un **«Cargar más»** al pie, en vez de
  paginar numerada; ver [Listados: carga infinita e imagen de producto](listados.md).
- Evidencia de plan: `supabase/tests/database/clientes_plan_indices.test.sql` (T019) siembra ~5.000
  clientes con tilde y corre `EXPLAIN` con `enable_seqscan = off`; **falla** si la búsqueda no usa
  `clientes_busqueda_trgm_idx` o la paginación no usa `clientes_org_nombre_idx`. Es un test de
  *usabilidad* del índice, no de elección por costos. El script manual es
  `supabase/verificacion/clientes_explain.sql` (`EXPLAIN ANALYZE`, solo base local).

## Exportación a Excel (F-CLI-04)

- **Quién:** solo quien tiene la acción `exportar` en Clientes
  (`private.puede_accion('clientes','exportar')`; por defecto Administrador, Administración y Operador).
  La UI oculta «Exportar» sin el permiso y la RPC lo vuelve a exigir en el servidor (`42501`).
- **Cómo:** `apps/web/src/lib/exportarClientes.ts` itera `exportar_clientes` con el cursor
  (`p_despues_de`) hasta agotar las filas. El total se cuenta **solo en el primer lote** (los
  siguientes devuelven 0); un cursor inexistente falla con `40001` («reintentá»), nunca con un archivo
  truncado. Tope de lote 1000; tope total 50.000 filas (`54000` → «Afiná la búsqueda»).
- **Archivo:** `.xlsx` real, hoja «Clientes», generado en el navegador con **`write-excel-file`** (MIT;
  `fflate` MIT), cargado con `import()` diferido al pulsar «Exportar» para no pesar en el recorrido
  principal. Encabezados en la primera fila, una columna por campo, celdas de datos escritas **como
  texto** (`type: String`).
- **Fórmulas:** todo valor que empieza con `=`, `+`, `-`, `@`, tab o retorno lleva un apóstrofo
  delante (`neutralizarFormula`). Es el costo aceptado de la defensa: el apóstrofo queda visible (un
  teléfono «+54…» se ve «'+54…»).
- **UX** (`apps/web/src/components/clientes/ExportarClientes.tsx`): confirmación con el total,
  progreso, cancelación y error con «Reintentar».

## Etiqueta impresa y fusión de clientes (MSF-445)

La épica **MSF-445** ([detalle](mejoras-de-clientes-y-proveedores.md), PR #695; aún sin merge a `main`)
suma dos capacidades sobre esta base:

- **Etiqueta impresa del cliente (F-CLI-17, MSF-446):** sin RPC y sin escrituras. La hoja
  (`apps/web/src/lib/etiquetasCliente.ts` + `apps/web/src/components/clientes/HojaEtiquetas.tsx`, ruta
  `/clientes/etiquetas`) lee `public.clientes` con las columnas `id, nombre, direccion, codigo_postal,
  localidad, provincia, telefono, expreso_preferido` y arma una etiqueta por cliente. **Solo la dirección
  bloquea** (CA-CLI-17-1); los demás datos vacíos se omiten. La impresión usa `@page` (A4) y `@media
  print` para ocultar menú y barra superior.
- **Fusión de clientes duplicados (F-CLI-18, MSF-447):** `public.fusionar_clientes(p_conservar_id,
  p_descartar_id, p_cuenta_web_de)` (solo Administrador, todo en una transacción) reasigna los documentos
  de venta (`dominio.comprobantes_venta`) y la cuenta web (`public.cuentas_cliente`) al conservado, da de
  baja la cuenta no elegida, **archiva** al descartado (`archivado_en`) y registra `cliente.fusionado`.
  `public.vista_previa_fusion_clientes` da la vista previa sin escribir.

## Cuenta corriente y saldo del cliente (F-CLI-19, MSF-451 · épica MSF-450)

- **Pantalla:** la ficha `/clientes/show/:id` suma a la tarjeta **«Resumen comercial»** el **«Saldo deudor»**
  (lo que el cliente debe, **con IVA**) y agrega la tarjeta **«Cuenta corriente»**: los comprobantes con saldo
  pendiente (Comprobante, Fecha, Estado, Total, Cobrado, Saldo y, solo si algún comprobante tiene notas de crédito, «Notas de crédito»; del más reciente al más antiguo). Si el cliente no
  debe nada, la cuenta corriente muestra el vacío («Este cliente no tiene comprobantes con saldo») y el saldo es `$ 0`.
  Si la base no responde, el bloque muestra el error con **«Reintentar»** y el «Saldo deudor» queda en «—»: el error
  no se come el resto de la ficha. Los números de comprobante son texto: el enlace al comprobante es de Ventas.
  El «Saldo deudor» se pinta como el prototipo —ámbar con deuda, verde cuando el cliente no debe— y la etiqueta
  «Deuda» de la cuenta corriente va en ámbar. El saldo no depende de las compras: si la sección «Compras» falla, el
  «Saldo deudor» se sigue viendo (el «Facturado en el año» queda en «—»).
- **Función:** `public.cuenta_corriente_cliente(p_cliente_id uuid)` (migración
  `20270222100000_cuenta_corriente_cliente.sql`, **sin tablas nuevas**; recreada después por `20270227110000` y
  `20270227140000`, que le agregan la columna `notas_credito`, después de `cobrado`): `security definer`, `search_path = ''`,
  organización de `private.organizacion_id()`, exige Clientes en `lectura`/`edicion` (si no, `42501`); cliente de otra
  organización o inexistente → saldo `0` y sin documentos (no revela si existe); el encabezado (`saldo_total`,
  `comprobantes`) viaja en cada fila y, sin documentos abiertos, vuelve solo la fila de encabezado. Cada fila trae el
  **`id`** del comprobante: el correlativo es por organización, empresa y tipo, así que el número se repite entre
  tiendas y el `id` es lo que identifica la fila. Las columnas de cada fila son `id`, `numero`, `fecha`, `tipo`,
  `estado`, `total_con_iva`, `cobrado`, `notas_credito` y `saldo`.
  `revoke … from public, anon` y `grant execute … to authenticated`.
- **Cómo se calcula el saldo:** el total, lo cobrado, las notas de crédito y el saldo de cada comprobante los trae
  `private.saldo_comprobante` (F-VTA-12, que desde la migración `20270227140000` resta las notas de crédito):
  saldo = `max(total − cobrado − notas de crédito, 0)`. Es el mismo cálculo que ven el detalle del comprobante, el tope
  al registrar un cobro y el contrarreembolso (ver [Ventas · cobros y conciliación](ventas-cobros-y-conciliacion.md)). El estado
  «Deuda» no se consulta (una factura en «Deuda» no tiene cobros y debe su total completo). Cuentan las **facturas**
  que no están en `borrador`, `anulada` ni `cobrado`: una «Cobrada» está saldada aunque su cobro no esté en el libro
  (cobrada en mostrador o anterior al libro de cobros de MSF-195); los presupuestos no son deuda. El saldo total es la
  suma de los saldos listados.
- **Alcance:** es la deuda del cliente en **todas las tiendas a las que la persona accede**
  (`private.empresas_accesibles()`, como `public.saldo_comprobante`; el administrador accede a todas): no ve deuda de
  tiendas ajenas. No depende de la empresa activa (Principio VIII). Lo que sí depende de la empresa activa en la ficha —el bloque «Cuenta web»— ya se reencuadra.
- **Base de las cifras:** el «Saldo deudor» y la cuenta corriente son **con IVA**; el «Facturado en el año» que ya
  estaba en la ficha es **sin IVA** (criterio del ranking). Cada número dice su base.
- **Notas de crédito:** **restan** de la deuda de la factura de la que cuelgan (decisión de Nicolás, 2026-11-11, migración
  `20270227110000_cuenta_corriente_notas_de_credito.sql`): saldo = `max(total − cobrado − notas de crédito, 0)` por factura, con las
  notas emitidas (no `borrador` ni `anulada`). La nota que genera la **anulación** de una factura no se descuenta dos veces: esa
  factura ya no figura. La tabla suma la columna «Notas de crédito». Sigue sin haber **saldo a favor**: si cobros y notas superan
  el total, la factura queda en $ 0 y no aparece: una factura de 1.000 con 800 cobrados y una nota de 400 desaparece
  aunque el cliente, en rigor, tendría 200 a favor (ese excedente no se acredita en ningún lado). Los importes se
  redondean a 2 decimales. Qué estados de la nota restan lo decide `private.comprobante_cuenta_como_facturado`
  (la misma regla que el ranking y el facturado neto; hoy: ni `borrador` ni `anulada`), vía la migración
  `20270227130000_cuenta_corriente_estados_nc_compartidos.sql`. La columna «Notas de crédito» se muestra solo si algún
  comprobante de la lista las tiene.
- **Tiendas sin acceso o desactivadas:** una persona sin tiendas asignadas ve saldo $ 0, y la deuda de una tienda
  desactivada no suma (ni para el administrador). La sección «Compras» de la misma ficha sigue siendo de toda la
  organización: diferencia conocida.
- **Importes:** con centavos cuando los hay (`$ 1.210,50`, `$ 0,40`) y sin decimales cuando son enteros (`$ 220.000`);
  el ranking de clientes sigue en pesos enteros.
- **Estados:** cuentan los siete estados vivos que no son borrador, anulada ni cobrado (`confirmada`, `pendiente`,
  `aceptado`, `en_proceso`, `deuda`, `armando`, `incompleto`); un pgTAP los fija uno por uno.
- **Permiso:** quien tiene `clientes` en lectura ve total, cobrado, notas de crédito y saldo aunque no acceda a Ventas (es el mismo dato
  que la sección «Compras»).
- **Costo:** tres lecturas por cada factura del cliente que no sea borrador, anulada ni cobrado (aunque ya esté saldada), dentro de `private.saldo_comprobante`: el comprobante, sus cobros y la suma de sus notas de crédito (cubierta por el índice `comprobantes_venta_origen_idx`), y sin paginar; son pocas por cliente. Si un cliente real acumulara
  cientos, se pagina con carga infinita.
- **Decisiones** (la historia no tenía requisitos; esta definición la tomó el desarrollo y se puede cambiar). Confirmadas por Nicolás el 2026-11-12: la factura «Cobrada» no es deuda, el saldo respeta las tiendas accesibles (`private.empresas_accesibles()`) y el permiso de lectura de Clientes alcanza para ver el saldo. Siguen pendientes: qué estados cuentan como deuda (en especial «Pendiente») y si el saldo
  a favor se muestra. (Cerrado el 2026-11-11: el saldo del
  comprobante y el tope al cobrar también restan las notas de crédito; antes una factura de 1.000 con una nota de 300
  mostraba 700 en la ficha del cliente y 1.000 en el comprobante, y dejaba cobrar 1.000.)
- **Efecto cruzado de `20270227150000`:** el disparador escribe, además de la lectura: pasa la factura a «Cobrado» cuando
  lo cobrado más las notas cubren el total (solo si hay cobros y la matriz de la organización permite la transición
  para el actor `sistema`) y ajusta el importe de los contrarreembolsos pendientes al saldo neto. Anular una nota
  después de «Cobrado» no devuelve la factura a «Deuda». Detalle en [Ventas · cobros y conciliación](ventas-cobros-y-conciliacion.md).
- **Reversión (migración posterior):** revertir la ampliación implica **cuatro** migraciones, no una, en este orden:
  1. `20270227150000`: `drop trigger comprobantes_venta_nota_credito_efectos on dominio.comprobantes_venta; drop
     function private.trg_nota_credito_efectos(); drop function private.sincronizar_efectos_nota_credito(uuid);`
     (no deshace los estados ni los importes de contrarreembolso que ya escribió).
  2. `20270227140000`: volver a las definiciones de `20270114100100_saldo_y_lectura_cobros.sql` (`drop function` +
     `create` de las dos `saldo_comprobante`, sin la columna `notas_credito`) y
     `revoke execute on function private.comprobante_cuenta_como_facturado(text, text) from authenticated`. Esto
     también devuelve a Ventas (detalle del comprobante, tope de cobro, contrarreembolso) a `total − cobros`. **Revertir `20270227140000` exige revertir también `20270228200000` y `20270228200100` (Pagos: `listar_pagos` y `resumen_pagos`) en el mismo cambio**; si no, Pagos queda neto de notas y el comprobante bruto.
  3. `20270227110000` y `20270227130000`: volver `public.cuenta_corriente_cliente` a la definición de
     `20270222100000_cuenta_corriente_cliente.sql` (sin notas de crédito) con `drop function` + `create`; **no** basta con
     `drop function`, que dejaría la pantalla sin cuenta corriente (y la ficha espera la forma de respuesta de cada
     versión: ajustar el hook en el mismo cambio).
  No se destruye ninguna tabla: la cuenta corriente es una lectura de los documentos y los cobros.
- **Cómo probarlo:**
  - *Prerrequisitos:* stack local (`pnpm dev:supabase`) con el seed; una persona con Clientes en `lectura` o `edicion`;
    un cliente con una factura confirmada de $1.000 y una tienda activa a la que la persona accede.
  - *Pasos:* (1) abrí `/clientes/show/:id` del cliente: el «Saldo deudor» muestra $ 1.000 y la tabla «Cuenta
    corriente» la factura con Total $ 1.000, Cobrado $ 0 y Saldo $ 1.000. (2) Registrá un cobro de $ 600 en el
    comprobante: el saldo baja a $ 400. (3) Emití una nota de crédito de $ 100 sobre esa factura: aparece la columna «Notas
    de crédito» y el saldo queda en $ 300; el detalle del comprobante muestra el mismo saldo. (4) Emití otra nota de
    $ 300: el saldo neto es $ 0, la factura pasa a «Cobrado» y sale de la lista; el «Saldo deudor» queda en `$ 0`.
  - *Resultado esperado:* los tres lugares (ficha, detalle del comprobante y tope al cobrar) coinciden con
    `total − cobrado − notas de crédito`, nunca negativo, a 2 decimales; con la base caída el bloque muestra el error con
    «Reintentar».
  - *Cómo automatizarlo:* pgTAP `supabase/tests/database/cuenta_corriente_cliente.test.sql` (46 aserciones; corre en
    el job `database` del CI), Vitest `ComprasCliente.test.tsx` y `useCuentaCorrienteCliente.test.tsx`, y el E2E
    `apps/web/e2e/cuenta-corriente-cliente.e2e.ts` (`pnpm --filter @platform/web test:e2e` con el stack local; **no corre
    en el CI**).
- **Pruebas:** pgTAP `cuenta_corriente_cliente.test.sql` (cada fila sale de `private.saldo_comprobante`; las notas de crédito, con centavos, tienda inaccesible, nota sola mayor que el total,
  factura cobrada, nota de otro cliente y mezcla emitida + anulada); Vitest `ComprasCliente.test.tsx` (carga, vacío, error + reintento, colores del
  prototipo y axe a 320/768/1440 px) y `useCuentaCorrienteCliente.test.tsx`; E2E `cuenta-corriente-cliente.e2e.ts`
  (rótulo `[MSF-451:T001]`; **no corre en el CI**, se corre a mano con el stack local: ver la guía de E2E del repositorio (`docs/e2e-app.md` (en `dokploy`) en `dokploy`)).
- **Prototipo:** la tarjeta «Cuenta corriente» la dibuja esta historia en `design/pantallas/ClienteFicha.dc.html`
  (y su copia en `design/pantallas/ClienteFicha/`); los inventarios se regeneran con `pnpm prototipo:inventario`.

## Actividad

`private.registrar_actividad_cliente()` (`AFTER INSERT OR UPDATE`, `security definer`,
`search_path = ''`) registra en la **misma transacción**:

| Evento | Cuándo |
|---|---|
| `cliente.creado` | `INSERT`. |
| `cliente.archivado` | `archivado_en` pasa de `null` a un valor. |
| `cliente.restaurado` | `archivado_en` pasa de un valor a `null`. |
| `cliente.editado` | Cualquier otro cambio real (se compara la fila sin `updated_at`). |

El detalle lleva «Nº <número> · <nombre>» y **nada de contacto**. No se registra sin sesión (importación,
API) ni ante un cambio que no cambió nada (archivar un cliente ya archivado no duplica el evento).
Catálogo completo: [Actividad e historial](../actividad.md).

## Frontend

| Pieza | Archivo |
|---|---|
| Listado (búsqueda con espera, filtros de tipo y estado, carga por tandas en servidor con «Cargar más», estados compartidos, vista adaptable) | `apps/web/src/pages/clientes/list.tsx` |
| Hook de búsqueda («última petición gana»; conserva filas mientras llega la siguiente) | `apps/web/src/hooks/useBuscarClientes.ts` |
| Formulario compartido por alta y edición (validación en el campo, error `23505` en «DNI/CUIT», selector de tipo con explicación y aviso de cambio) | `apps/web/src/components/clientes/FormularioCliente.tsx` |
| Ficha (datos, estado, «Editar» y «Archivar»/«Restaurar» con confirmación; sin «Eliminar») | `apps/web/src/pages/clientes/show.tsx` |
| Pestañas de la ficha: «Datos» (el contenido previo, sin cambios) y «Reparaciones» (MSF-232); la segunda se carga diferida y no aparece sin acceso a Service técnico | `apps/web/src/pages/clientes/show.tsx`, `apps/web/src/components/clientes/ReparacionesDeCliente.tsx`, `apps/web/src/lib/reparacionesDeCliente.ts` |
| Botón «Exportar» (confirmación, progreso, cancelación, reintento) | `apps/web/src/components/clientes/ExportarClientes.tsx` |
| Armado del `.xlsx` por lotes | `apps/web/src/lib/exportarClientes.ts` |
| Rutas | `apps/web/src/App.tsx`: `/clientes`, `/clientes/create`, `/clientes/edit/:id`, `/clientes/show/:id` |

Puntos de contrato con la base:

- El tipo de cliente del formulario es `minorista`/`mayorista`, con la explicación de cada uno
  (`apps/web/src/lib/clientes.ts`: «Compra al precio de lista (escala x1).» / «Compra con precio por
  cantidad.»). Al cambiarlo en una edición se muestra el aviso `AVISO_CAMBIO_TIPO`: «Al cambiar el
  tipo, las próximas ventas usarán la escala de precios del nuevo tipo. Lo ya vendido no cambia.»
- El error `23505` de `clientes_org_documento_uq` se muestra **en el campo «DNI/CUIT»**, no como un
  error genérico de la pantalla.
- `lib/permisos.ts` ya no lista `clientes` en `RECURSOS_ESCRITURA_SOLO_ADMINISTRADOR`: la escritura la
  gobierna `nivel_seccion('clientes')`, igual que la RLS.
- La pantalla del listado **muestra** columnas que hoy no tienen backend (`Tiendas`, `Cuenta web`) como
  «—»: esas capacidades son de MSF-237.

## Pruebas

**pgTAP** (`supabase/tests/database/`):

| Archivo | Qué cubre |
|---|---|
| `clientes_alta_y_edicion.test.sql` (43 aserciones) | Permisos por sección (editan / leen / `ninguno`), aislamiento entre organizaciones, archivar y restaurar con evento (y sin evento sin sesión), número correlativo, columnas protegidas, unicidad de DNI/CUIT (otro formato, contra archivados) y nombre repetido aceptado, mismo documento en otra organización aceptado, sin `DELETE`, `anon` sin acceso. |
| `clientes_busqueda_exportacion.test.sql` (44) | Búsqueda parcial por cada campo, escape de `%`/`_`, filtros de tipo y archivados, paginación con total y tope, aislamiento, `anon` sin acceso; `exportar_clientes` solo con permiso, keyset sin repetidos ni omisiones y tope de lote. |
| `clientes_tipo_y_consumidor_final.test.sql` (31) | Un Consumidor final por organización (existente y nueva), inmutable incluso para `postgres`, `tipo` restringido y `escala_de_cliente` con RLS y sin `anon`. |
| `clientes_plan_indices.test.sql` (5) | Seed de ~5.000 clientes y `EXPLAIN` sobre los índices de búsqueda y de orden. |

**Vitest**: `apps/web/src/pages/clientes/list.test.tsx`, `edit.test.tsx`, `show.test.tsx`,
`apps/web/src/hooks/useBuscarClientes.test.tsx`,
`apps/web/src/components/clientes/FormularioCliente.test.tsx`,
`apps/web/src/components/clientes/ExportarClientes.test.tsx`,
`apps/web/src/lib/exportarClientes.test.ts`.

**E2E**: la suite de la app existe (`apps/web/e2e/`), pero el caso «alta, búsqueda y exportación» de
clientes está **pendiente** por falta de fixtures por rol (seguimiento [MSF-499]); hoy lo cubren Vitest
y pgTAP. Ver [E2E de la app](../e2e-app.md).

## Reversión

Todas las migraciones de la épica son **aditivas** y traen la reversión escrita en el encabezado. El
patrón es: una migración posterior hace el `drop` de funciones, disparadores, políticas e índices, y
**las columnas no se borran** en el mismo PR que las crea (para eso hace falta haber exportado los
datos). Un `git revert -m 1` del PR deja columnas e índices huérfanos hasta esa migración.

Reversión por migración:

- `20261016130000`: `drop trigger clientes_normalizar`, `drop trigger clientes_asignar_numero`, `drop function private.normalizar_cliente()`, `private.asignar_numero_cliente()`, `private.documento_normalizado(text)`; `drop index clientes_org_documento_uq`, `clientes_org_numero_uq`, `clientes_org_nombre_idx`, `clientes_busqueda_trgm_idx`.
- `20261016130200`: `drop trigger clientes_registrar_actividad`, `drop function private.registrar_actividad_cliente()`, `drop policy clientes_select|insert|update` y restaurar las políticas de `20260908172920_fundacion_multitenant.sql` (`private.puede_escribir()`), con sus grants.
- `20261016130300`: `drop function public.escala_de_cliente(uuid)`, `drop trigger organizaciones_crear_consumidor_final`, `drop function private.crear_consumidor_final()`, `drop trigger clientes_proteger_consumidor_final`, `drop function private.proteger_consumidor_final()`, `drop index clientes_consumidor_final_uq`, `drop constraint clientes_consumidor_final_ck`, `clientes_tipo_ck`, y `revoke insert (tipo), update (tipo)`.
- `20261016140000` / `20261016150000`: `drop function public.buscar_clientes(text,text,boolean,integer,integer)` y `public.exportar_clientes(text,text,boolean,uuid,integer)`.
- `20261016160000`: `drop index if exists public.clientes_busqueda_trgm_idx` y `drop extension if exists pg_trgm` (sin `cascade`, y solo si ningún otro índice trigram la usa).

## Deuda trazada

| Deuda | Seguimiento |
|---|---|
| Trasladar `public.clientes` al esquema `dominio` (Principio VII) | [MSF-505] |
| Registrar la exportación de clientes en la actividad (la RPC es `stable`; registrarlo exige `volatile` o un registro desde el cliente) | [MSF-508] |
| E2E de alta, búsqueda y exportación | [MSF-499] |
| Test de concurrencia con dos conexiones (número correlativo y DNI/CUIT simultáneos): el pgTAP corre en una sola sesión, así que no la ejercita; la garantía es el advisory lock + el índice único | Desvío anotado en T007 de la spec; **sin Jira asociado todavía** |

## Ver también

- [Clientes](../clientes.md) — guía de producto: qué resuelve, para quién y qué no hace.
- [Cuentas y compras a proveedores (MSF-450)](cuentas-y-compras-a-proveedores.md) — la cuenta corriente
  y el saldo deudor de la ficha (F-CLI-19, MSF-451) y las ideas de la épica que siguen sin código.
- [Mejoras de clientes y proveedores (MSF-445)](mejoras-de-clientes-y-proveedores.md) — etiqueta impresa,
  fusión de clientes, costo por línea, evolución del costo y contactos de proveedor.
- [Service técnico: cobro, avisos y ficha del cliente](service-cobro-y-avisos.md) — la RPC
  `reparaciones_de_cliente` y la pestaña «Reparaciones» de la ficha (MSF-232).
- [Permisos por rol](../permisos-por-rol.md) — contrato `nivel_seccion` / `puede_accion`.
- [Aislamiento por organización](../aislamiento-por-organizacion.md) — control positivo sobre `public.clientes`.
- [Actividad e historial](../actividad.md) — eventos `cliente.*`.
- [Datos y DER](datos.md#clientes-msf-180) — el modelo dentro del panorama.
- [API y RPC](api.md#clientes-msf-180) — los contratos resumidos.
