---
owner: tecnico
sources:
  - specs/20261022-120000-precios-e-iva
  - specs/20261104-103000-precios-masivos-y-promociones
  - specs/20270105-100000-configuracion-dolar-y-precio-propio
  - supabase/migrations/20270213200001_simulador_precio_propio.sql
  - supabase/functions/cotizacion-sugerida
---

# Precios, dólar e IVA (épica MSF-114 · spec `20261022-120000-precios-e-iva`)

Guía de la épica: cuatro historias entregadas (F-PRE-01, F-PRE-07, F-PRE-12, F-PRE-15). El detalle fino de cada una vive en [`iva-precio-final.md`](./iva-precio-final.md) y [`precios-escalas.md`](./precios-escalas.md); la fuente de requisitos es `specs/20261022-120000-precios-e-iva/spec.md`.

## Modelo (Principio VII)

| Objeto | Esquema | Naturaleza |
|---|---|---|
| `cotizacion_inicial` (dólar de arranque, uno por organización) | `dominio` | dato de negocio |
| `precios_empresa` (regla de precio + interruptor «Precios que ve el cliente» por empresa) | `dominio` | dato de negocio |
| `alicuotas_iva` (21 %, 10,5 %, Exento) y `alicuota_iva_id` en `categorias`/`productos` | `dominio` | dato de negocio |
| `producto_precios_escala` (x5, x10, x50; x1 es el precio de lista) | `dominio` | dato de negocio |
| `precios_propios_empresa` (precio neto fijado por producto y empresa, F-PRE-08) | `dominio` | dato de negocio |
| Vistas `productos_precio_costo`, `precios_empresa_neto`, `precios_empresa_final` y RPC de guardado | `public` | superficie de lectura/ejecución, sin datos propios (`security_invoker`) |
| `private.a_pesos`, `precio_central_ars`, `aplicar_regla_precio`, `precio_neto_empresa`, `alicuota_producto`, `aplicar_iva`, `precio_para` | `private` | cálculo |

Todas las tablas tienen RLS por organización (`private.organizacion_id()`), sin política `DELETE`, y `anon` sin privilegios.

## Fórmulas (una sola fuente: la base)

1. **Precio central en pesos** = `precio_lista` si la moneda es ARS; si es USD, `round(precio_lista × cotización, 2)`. USD sin cotización cargada da `null` (no se inventa un valor).
2. **Neto de la empresa** = central, o central × (1 + ajuste %) redondeado al **$ 10 más cercano** (base `central_ajuste`).
3. **Final** = neto × (1 + alícuota) al centavo (redondeo a 2 decimales, desde la migración `20270507180200_aplicar_iva_al_centavo.sql`); Exento ⇒ final = neto. La alícuota es la del producto o, si no tiene, la de su categoría.
4. **Margen** = (neto − costo en pesos) / neto, siempre sobre el neto (sin IVA). El interruptor de IVA no lo cambia. El formulario de producto lo aclara: **no incluye la comisión del canal** (la vista de Rentabilidad la resta, hoy con comisión 0).

El front solo espeja las fórmulas para textos de ejemplo (`lib/precios.ts`, `lib/iva.ts`); la autoridad es la base.

## Contrato `private.precio_para(producto, empresa, escala default 'x1')`

Devuelve `escala_usada`, `neto`, `alicuota_*` y `final` (detalle en [`precios-escalas.md`](./precios-escalas.md)). Escala sin precio cargado ⇒ usa la lista (`x1`); escala fuera de `x1/x5/x10/x50` ⇒ error `22023`.

**`tipos_cliente.escala_precio`**: `precio_para` **no consulta `tipos_cliente`**. Quien necesita el precio (Ventas, cuenta web) lee ese texto (p. ej. `x5` para «Mayorista») y lo pasa como `escala`. La pantalla Tipos de cliente es de Clientes y proveedores; mientras la tabla no exista el contrato se prueba con un tipo simulado (`precios_escala.test.sql`, `escalaDeTipoCliente`).

### Cálculo sin sesión de panel (MSF-176 B2, D-17)

`precio_para` y `private.precio_linea_venta` son **envoltorios**: validan la escala, aplican la compuerta y el aislamiento por organización de la sesión de panel (`private.precio_sesion_alcanza`) y delegan en `private.precio_para_calculo` y `private.precio_linea_venta_calculo`, que calculan **sin depender de la sesión**, acotadas por la organización de la empresa (alícuota por join; precio propio con `neto_precio_propio`). Las funciones de cálculo no tienen `execute` para la API: solo las llaman funciones `security definer` (el panel por sus envoltorios y, desde B2, la tienda con el tipo y el descuento del cliente de la cuenta). Una sola fórmula de precio en todo el producto. Detalle y pruebas en [`tienda-compra-y-cuentas.md`](./tienda-compra-y-cuentas.md) (B2, etapa 1).

## Permisos

- Lectura de precios: sección `productos` ≥ lectura. Guardar precio/escalas: `productos` = edición. Regla de precio por empresa: `empresas` = edición. Alícuotas: lectura para toda la organización; sin escritura desde la app en esta épica.
- **Costo y margen** solo con la sección `rentabilidad`: el costo vive en `producto_costos` y las vistas lo unen con `LEFT JOIN` bajo su RLS; sin esa sección llegan `null`. La Actividad (`producto.precio_actualizado`) no lleva importes.
- Toda RPC de `public` lleva `revoke … from public, anon` y `grant execute … to authenticated`.

## Revisión de seguridad de cierre (FR-029, T042)

| Control | Resultado |
|---|---|
| RLS en las 4 tablas (`cotizacion_inicial`, `precios_empresa`, `alicuotas_iva`, `producto_precios_escala`) | `enable row level security` en cada migración; `rls_en_toda_tabla` recorre `public` + `dominio` |
| `revoke all … from public, anon, authenticated` y `grant` mínimo por tabla | grants por columna en `cotizacion_inicial`, `precios_empresa` y `producto_precios_escala`; `alicuotas_iva` solo `select` |
| RPC: `revoke … from public, anon` + `grant execute … to authenticated` | las 6 RPC públicas (`fijar_cotizacion_inicial`, `guardar_regla_precio_empresa`, `guardar_alicuota_categoria`, `asignar_alicuota_producto`, `previsualizar_precios_empresa`, `guardar_precios_escala`); los disparadores de `private` sin `execute` para nadie |
| Vistas `security_invoker` con `revoke all` + `grant select to authenticated` | las 3 vistas heredan la RLS de las tablas base |
| Costo solo con `rentabilidad` | `productos_precio_costo` une `producto_costos` por RLS; `precio_para` y las vistas de empresa no exponen costo |
| Esquema de cada tabla vs Principio VII | las 4 son dominio del producto ⇒ `dominio`; las vistas/RPC no almacenan datos ⇒ `public` |
| Service-role en el navegador | no se usa; el E2E la usa solo desde Node contra un Supabase local |

Sin hallazgos que corregir. Las pruebas pgTAP que lo sostienen: `precios_cotizacion_conversion`, `precios_empresa`, `precios_iva`, `precios_escala` y `rls_en_toda_tabla`.

## Precio propio de un producto en una empresa (F-PRE-08, MSF-423 · épica MSF-352)

Spec: `20270105-100000-configuracion-dolar-y-precio-propio` (`specs/20270105-100000-configuracion-dolar-y-precio-propio/spec.md`) (FR-012…FR-020).

- **Dato**: `dominio.precios_propios_empresa` (PK `producto_id + empresa_id`; `moneda` ARS|USD; `importe > 0`, hasta 2 decimales). FK compuestas a `productos` y `empresas` (no cruza organizaciones), RLS por organización, `select` con `productos` ≥ lectura, **sin escritura directa**: se escribe solo con las RPC.
- **RPC** (`public`, `anon` sin ejecución): `fijar_precio_propio(producto, empresa, moneda, importe)` (`productos` = edición; idempotente; actividad `producto.precio_propio_fijado` **sin importes**), `quitar_precio_propio(producto, empresa)` (idempotente; `producto.precio_propio_quitado`) y `leer_precios_propios(producto)`. Errores: `42501` sin permiso, `P0002` producto o empresa ajenos, `22023` moneda inválida o importe vacío, `23514` importe ≤ 0 o con más de 2 decimales, `22003` demasiado grande.
- **Cálculo**: con precio propio el **neto** es ese precio (reemplaza a «central + ajuste», sin redondeo de la regla) y el IVA de la empresa se aplica encima como siempre. Lo leen `private.precio_neto_empresa`, `public.precios_empresa_neto` (nueva columna `precio_propio boolean`, al final) y, por lo tanto, `precios_empresa_final`; `private.precio_visible_desde_central` y la vista previa `previsualizar_cotizacion` (hoy / nuevo) pasan por `private.precio_visible_con_cotizacion`. Un precio propio en **USD** se convierte con `private.cotizacion_para(organización, empresa)` (la de la empresa con alcance «una por empresa», la general con «sistema»); sin cotización el neto es `null` (no se inventa ni se cae a la regla). Al confirmar un dólar los precios se recalculan solos porque se calculan al leer; `private.precios_usd_por_empresa` cuenta también los precios propios en USD.
- **Ficha del producto** (`pages/productos/edit.tsx`): bloque «Precio propio por empresa» (`components/precios/PrecioPropioEmpresas.tsx`), una fila por empresa a la que se vende (`Moneda`, `Precio propio`, «Guardar», «Quitar»), marca «Precio propio» y neto de ejemplo; solo lectura para Consulta. En el **alta** (`create.tsx`) el producto todavía no existe: el precio propio se fija desde la edición.
- **Fuera de alcance**: el listado de productos no tiene columna de precio por empresa, así que la marca «Precio propio» no se muestra allí (Decisión abierta 4). `private.precio_para` y la tienda pública también lo leen desde `20270213200002` (ver «Precio propio en todos los caminos de lectura»); un precio de escala x5/x10/x50 cargado a mano gana sobre el precio propio. Los precios propios no van a Mercado Libre (Etapa 2, FR-020: sin cola ni columna ML).
- **Reversión** (migraciones `20270205110201` y `20270205110202`): ver el encabezado de cada una; exportar los precios propios antes de borrar la tabla.
- **Alerta de dólar** (`20270205110203`): restaura en `recalcular_alertas_inicio` el chequeo de «Aviso en Inicio» y alcance (F-PRE-06) que `20270201200138` había pisado por orden de versiones; reversión: recrear la función con el cuerpo de `20270201200138`.

## Simulador «Así quedan los precios» con precio propio (F-PRE-09, MSF-427 · épica MSF-352)

Spec: `specs/20270105-100000-configuracion-dolar-y-precio-propio/` (US3, FR-021…FR-026). La tabla de la pestaña «Precios y moneda» de la empresa (`pages/empresas/precios.tsx`, `components/precios/TablaAsiQuedan.tsx`) se recalcula en el servidor con cada cambio de la regla (`Base`, `Ajuste`, `Precios que ve el cliente`) **antes de guardar**, y no escribe nada: guardar sigue siendo `guardar_regla_precio_empresa` y salir sin guardar descarta el cambio.

- **Base** (`supabase/migrations/20270213200001_simulador_precio_propio.sql`): `public.previsualizar_precios_empresa(empresa, base, ajuste, muestra)` conserva su firma de entrada y suma la columna `precio_propio boolean`. Es de solo lectura (`security invoker`, `search_path` vacío, `42501` sin acceso a Empresas, `anon` sin ejecución). Una fila con precio propio muestra **ese valor** (ya en pesos; en USD, × la cotización de la empresa) y no se mueve con el ajuste; sin precio propio rige la regla de siempre.
- **Cotización de la empresa**: el precio central de la muestra se convierte con la cotización de **la empresa** cuando tiene una propia (F-PRE-06), igual que `public.precios_empresa_neto`. Antes usaba la de la organización y el simulador podía mostrar un central distinto del que cobra la tienda. Un pgTAP compara el simulador con el precio real.
- **Marca por fila**: «Precio propio» (tono propio) / «Ajustado» (la regla en pantalla mueve el precio) / «Central». El significado va en el texto de la marca, no solo en el color; la columna tiene un encabezado para lectores de pantalla («Origen del precio»).
- **Textos**: la nota «Los productos con **precio propio** en esta empresa ignoran el ajuste…» vive junto a la regla y el bloque «Cómo se calcula» (`components/precios/ComoSeCalcula.tsx`) muestra los cuatro pasos del prototipo; el paso 3 es el del precio propio.
- **Una empresa por ruta**: al abrir otra (`Cambiar a … ↔`) se reinician regla, formulario, simulación, avisos y marcas.
- **Pruebas**: pgTAP `supabase/tests/database/simulador_precio_propio.test.sql`; Vitest `components/precios/TablaAsiQuedan.test.tsx`, `ComoSeCalcula.test.tsx` (con axe a 320 / 768 / 1440 px) y `pages/empresas/precios.test.tsx` (marca, valor fijo al mover el ajuste, nada se guarda, cambio de empresa); E2E `apps/web/e2e/configuracion-dolar-precio-propio.e2e.ts`.
- **Reversión** (migración posterior): restaurar `previsualizar_precios_empresa` a su cuerpo de `20261022140200` (sin `precio_propio` y con el central de la organización).

## Reversión

Todas las migraciones son aditivas (`20261022120000`…`20261022150100`); cada una trae su reversión en el encabezado. Orden inverso: `precio_para` → `producto_precios_escala` → interruptor/vista final (`140200`) → alícuotas (`140100`, `140000`) → regla por empresa (`130200`…`130000`) → costo/margen y conversión (`120300`…`120000`). Las que borran columna o tabla piden **exportar los datos antes** y van en una migración posterior, nunca en el PR que las creó.

## Preguntas abiertas

- Selección automática de escala por **cantidad** de la línea: la define Ventas (F-VTA-06); hoy cada tipo de cliente usa su escala.
- Valor inicial del interruptor de IVA por empresa («Sin IVA» hasta que el administrador lo cambie): pregunta abierta del relevamiento.
- Carga y recálculo masivo del dólar y «precio propio por empresa»: fuera de alcance (MSF-116 y MSF-352); recargo de Mercado Libre, Etapa 2.

## Verificación

E2E de cierre (SC-009): `apps/web/e2e/precios-iva.e2e.ts` (ver [`e2e-app.md`](./e2e-app.md)).

## Precio público en la tienda online

El catálogo y la ficha de la tienda muestran el precio final de la empresa con el mismo interruptor de IVA («Precios que ve el cliente»); sin precio calculable, no muestran precio. Detalle en [`tiendas-online.md`](./tiendas-online.md) («Catálogo con filtros y orden» y «Cierre de la épica MSF-167»).

## Imagen en «Así quedan los precios»

Cada producto de la muestra de «Así quedan los precios» muestra su imagen principal como miniatura con zoom al pasar el mouse (sin cambiar el ancho de la fila).

### Precio propio en todos los caminos de lectura (corrección de la revisión retroactiva de MSF-423)

El precio propio reemplaza al calculado **en todo lugar que entregue un precio**, no solo en Precios: la tienda pública (`private.precio_final_publico` y `precio_final_publico_escala`), las líneas de presupuestos y comprobantes (`private.precio_para`), el margen actual de Rentabilidad (`analitica.margen_producto_canal`, y con él la alerta `margen_negativo`) y el simulador. Migraciones `20270213200001` (simulador), `20270213200002` (tienda y líneas) y `20270213200003` (margen). Reglas: la conversión de USD usa la cotización de la **empresa** (la de la organización en el margen, como el resto de esa vista); un **precio de escala por cantidad** (x5/x10/x50) cargado a mano sigue mandando sobre el precio propio, que reemplaza al precio base (la escala x1 es el precio base: ahí manda el precio propio, en la tienda y en las líneas de comprobante por igual); la tienda lee el precio propio **sin depender de la sesión** (anónimos y clientes sin membresía ven lo mismo que el panel); el margen «Historia» no cambia porque el precio propio no tiene historial. Una empresa con precio propio guardado sigue visible en la ficha aunque ya no se venda el producto ahí, para poder quitarlo.

### Historial de precios propios y conversión del dólar (revisión de MSF-352)

- Cada `fijar_precio_propio`/`quitar_precio_propio` que cambia algo deja una fila en `dominio.precios_propios_historial` (valor anterior y nuevo, moneda, empresa, producto, actor y fecha; append-only e inalterable; lectura con `productos`). La Actividad sigue sin importes.
- La cotización que rige un precio sale siempre de `private.cotizacion_para(org, empresa)`, que lee el alcance con `private.cotizacion_alcance` (no depende de quién mira la tienda). Rentabilidad usa la misma cotización por empresa (`analitica.cotizacion_para`).
- Detalle y limitaciones: `docs/configuracion-dolar-y-precio-propio.md`.

## Masivos y promociones

Dos capacidades del administrador sobre el precio, en la misma épica (MSF-363):

- **Actualización masiva de costos y precios** (F-PRE-10, MSF-436): subir o bajar costos y precios de lista en bloque, por porcentaje o por planilla CSV, con vista previa antes de confirmar y aplicación todo-o-nada. Ruta `/productos/precios-masivos`, botón «Actualizar precios» en Productos. Guía: [`precios-masivos.md`](./precios-masivos.md).
- **Precios promocionales por empresa** (F-PRE-11, MSF-439): precio promocional con fecha de inicio y fin por empresa; la tienda muestra el precio anterior tachado mientras dura y vuelve sola al normal al vencer (el estado se deriva por fecha, sin tarea programada). Ruta `/productos/promociones`. Guía: [`promociones-precio.md`](./promociones-precio.md). Desde MSF-816 (Decisión 6 implementada) el mostrador y los comprobantes también **cobran** el precio promocional de la tienda del comprobante (gana el más bajo, sin acumular; precio manual manda) con la misma bandera `promociones_precio`; el margen «actual» (`analitica.margen_producto_canal`) sigue con el precio normal y la rentabilidad realizada refleja lo cobrado. Detalle y seguimientos S1…S7 (MSF-932…MSF-938): [`ventas-comprobantes.md`](./ventas-comprobantes.md#comportamiento-conocido-y-seguimientos-msf-816-f-4).

Especificación: `specs/20261104-103000-precios-masivos-y-promociones/spec.md`.

### Correcciones posteriores a la revisión (MSF-363)

- **Permisos de promociones por tienda** (aprobado retroactivamente por Nicolás el 2026-11-12, igual que la tienda desactivada y la vista previa con carga infinita; `20270223200000`): programar o anular una promoción exige `productos` en **edición en la tienda de la promoción** (`private.nivel_productos_en_empresa`, gemela de la de `ventas`), no el nivel global más alto; antes quien editaba productos en la tienda A podía programar o anular promociones de la B. La lectura directa de `dominio.promociones_precio` respeta la misma regla (sin acceso a la tienda no se leen). Persona de la organización **sin tiendas asignadas**: no ve promociones (como el resto de los datos por tienda). Tampoco se leen ni se anulan las promociones de una **tienda desactivada**, ni siendo administrador (el acceso por tienda exige que esté activa). El permiso en la tienda se comprueba antes de bloquear la promoción (`20270225100000`): sin permiso siempre responde `42501`.
- **Vista previa de costos** (`20270223200100`): cambiar costos (modo «ambos», «costo» o una planilla con costo) exige `rentabilidad` en edición **también en la vista previa**, igual que aplicar; antes con lectura la vista previa respondía y aplicar daba `42501`. Con solo lectura se sigue viendo el costo en una vista previa que cambia únicamente el precio de lista.
- **Precios masivos por tienda y bandera de apagado** (`20270228300000`…`20270228300300`, decisiones 14 y 15 aprobadas el 2026-11-12): «Actualizar precios» exige `productos` en edición en todas las tiendas activas de la organización (el precio de lista es de la organización) y las promociones y «Actualizar precios» tienen una bandera por entorno, apagada por defecto (`public.banderas_plataforma`; encender con `update … set activa = true`). Detalle y reversión en [`precios-masivos.md`](./precios-masivos.md) y [`promociones-precio.md`](./promociones-precio.md). Apagada, la tienda muestra el precio normal.
  - **Impacto de despliegue:** como las banderas nacen apagadas, al desplegar estas migraciones la tienda pública pierde el precio tachado y la pantalla Promociones (solo-anular) y «Actualizar precios» quedan deshabilitadas en cada entorno hasta que alguien con acceso a la base (el equipo técnico o Nicolás; NO una migración) ejecute `update public.banderas_plataforma set activa = true where clave in ('promociones_precio','precios_masivos');`. Verificar luego en la tienda de ese entorno. El procedimiento de despliegue está en [`deployment.md`](./deployment.md), sección «Banderas de plataforma».
- **Vista previa con carga infinita**: la tabla muestra de a 25 filas con «Cargar más» y el contador «Mostrando N de M» (antes `TablePagination`); el tope de 5.000 filas o productos por vez sigue en el servidor (`54000`) y tiene pruebas.

### Revisión de seguridad integral de MSF-363 (T023)

La épica tiene 9 migraciones (`20270221100001`…`20270221100009`) más 3 de seguimiento (`20270223200000`, `20270223200100` y `20270225100000`; ver «Correcciones posteriores a la revisión»). La auditoría original cubrió las 8 primeras (`20270221100001`…`20270221100008`); la `…09` solo suma las dos tablas a la exportación total. Lo que sigue describe la política original por organización; **la lectura y escritura de promociones pasó a ser por tienda** y rige la sección de correcciones:

- **RLS**: `dominio.promociones_precio` (lectura por organización y **por tienda**, desde `20270223200000`) y `dominio.actualizaciones_precio` (por organización) tienen RLS activada, política de solo lectura, `revoke all` a `public`/`anon`/`authenticated` y `grant select` solo a `authenticated`. No hay política de escritura: se escribe únicamente por las RPC.
- **`anon`**: ninguna RPC nueva de `public` (`guardar_promocion_precio`, `anular_promocion_precio`, `previsualizar_actualizacion_precios`, `aplicar_actualizacion_precios`) es ejecutable por `anon`; los helpers de `private` no son ejecutables por `anon` ni `authenticated` (salvo `precios_promocion_sesion`, solo `authenticated`). Las únicas superficies para `anon` son las de la tienda pública (`publico.*_por_dominio`), con lista blanca de campos.
- **`security definer`**: todas las funciones definer fijan `set search_path = ''` y usan nombres calificados; la justificación de cada una (escribir tablas que `authenticated` solo lee, y validar permisos adentro) está en el encabezado de su migración. La vista `promociones_precio_estado` es `security_invoker`, así rige la RLS de la tabla.
- **Tienda pública**: `catalogo_pagina_por_dominio` y `producto_por_dominio` se redefinen con la misma firma (los `grant` previos se conservan; la migración `20270228300400` (rendimiento de la tienda, MSF-825) volvió a redefinir `catalogo_pagina_por_dominio`, pero calcula el precio con `private.promocion_vigente`, así que la bandera `promociones_precio` y el precio anterior siguen rigiendo; `producto_por_dominio` no se redefinió desde entonces). El precio anterior solo se devuelve durante una promoción vigente.
- **Sin importes de costo en Actividad**: el detalle de `precios.actualizacion_masiva` y de los eventos `promocion_precio.*` no lleva costos; quien no tiene `rentabilidad` no ve costos ni en la vista previa.
- **Secretos, compose, dependencias**: la épica no agrega dependencias, variables de entorno ni cambios de compose.
- **Pruebas**: `precios_masivos.test.sql` y `promociones_precio.test.sql` cubren aislamiento entre organizaciones, permisos y `anon` sin ejecución (corren en el job `database` del CI). **Desvío**: la tarea T023 nombraba `aislamiento_rls.test.sql`; ese archivo no existe: el recorrido de `public` + `dominio` lo hace `rls_en_toda_tabla.test.sql` y el aislamiento de las dos tablas nuevas está en sus pgTAP propios. Los E2E de la épica se omiten sin Supabase local y no corren en el CI público.

## Cotización sugerida (F-PRE-13, MSF-373)

Al abrir «Cargar dólar del día» el diálogo muestra «Sugerida: $ X por USD · fuente» con el botón «Usar este valor», que **solo completa el campo**: no carga ni cambia precios, y la carga y confirmación siguen siendo las de F-PRE-02/03. Si la fuente no responde, el diálogo avisa «No pudimos consultar la cotización sugerida. Cargá el valor a mano.» y se carga a mano como siempre (FR-002).

- **Edge Function `cotizacion-sugerida`** (`supabase/functions/cotizacion-sugerida`): exige sesión y nivel `edicion` en `cotizacion_dolar` (quien puede cargar el dólar), consulta `https://dolarapi.com/v1/dolares/oficial` desde el servidor (URL fija en el código: el navegador no manda nada a la consulta, sin SSRF), con tiempo máximo de 5 s, sin redirecciones y validando la respuesta (`venta` numérica, mayor que 0 y menor que 1.000.000). El valor se **redondea a 2 decimales** y se valida **después** de redondear (un valor que redondea a 0 se rechaza); si la fuente trae `fechaActualizacion` válida la función la devuelve (`fecha`, ISO) y el diálogo la muestra, y si falta o es inválida devuelve `fecha: null`. Una respuesta de la fuente que no cumple esas reglas da **502** («La fuente devolvió un valor que no se puede usar»), igual que una fuente caída; sin sesión o sin nivel `edicion` da 403. Sin service-role, sin secretos y sin escribir en la base. Pruebas: `pnpm test:edge:cotizacion-sugerida`.
- **Decisión confirmada por Nicolás el 2026-11-12:** la fuente es DolarApi y el valor es el **dólar oficial, precio de venta**. Si el negocio prefiere blue, MEP u otra fuente, cambia una constante (`FUENTE_URL`). La sugerencia se pide cada vez que se abre el diálogo (sin guardarla ni programarla), así que no hay worker ni Kestra.
- **Despliegue:** una función nueva no queda registrada en el runtime de dev hasta recrear el stack (`Function not found`); el servidor necesita salida a internet hacia `dolarapi.com`.
- **F-PRE-14 (listas mayoristas) se había descartado (decisión de Nicolás, 2026-11-12) y se retomó y entregó desde el 2026-11-15** (ver «Listas de precios» más abajo). Se había descartado porque chocaba con F-PRE-15 (escalas por producto x5/x10/x50, ya implementadas), que cubre la necesidad. Hoy el tipo de cliente es minorista/mayorista (fijos) y Ventas elige la escala de cada línea con `private.escala_para_linea` (mayorista por cantidad: x5 desde 5, x10 desde 10, x50 desde 50); la pantalla y la tabla «Tipos de cliente» (`tipos_cliente.escala_precio`) **no existen** todavía. Las listas de F-PRE-14 conviven con las escalas con una precedencia propia, que rige desde las Fases 3 y 4 (con la bandera `listas_precios` encendida).

- **Contrato de la función:** solo `POST` (otro método: 405); sin sesión válida o sin nivel `edicion`: 403; si no se puede verificar el permiso: 502. Respuesta correcta: `{ "valor": number, "fuente": string, "fecha": string | null }` (`fecha` es `null` si la fuente no trae `fechaActualizacion` o no es una fecha válida; `fuente` es «DolarApi (dólar oficial, venta)»). Si la fuente no responde en 5 s o devuelve un valor fuera de `0 < venta < 1.000.000`, responde 502 con «No pudimos consultar la cotización sugerida. Podés cargar el valor a mano.» o «La fuente devolvió un valor que no se puede usar. Podés cargar el valor a mano.».

### Cómo probarlo

1. **Prerrequisitos:** una persona con nivel `edicion` en «Cotización del dólar», la función desplegada y el servidor con salida a `dolarapi.com`.
2. Entrá a «Cotización del dólar» y tocá «Cargar cotización»: debe aparecer «Sugerida: $ X por USD · fuente».
3. Tocá «Usar este valor»: solo se completa el campo; no se carga nada hasta continuar y confirmar como siempre.
4. Con una persona con lectura, o sin salida a internet, el diálogo avisa «No pudimos consultar la cotización sugerida. Cargá el valor a mano.» y la carga manual funciona igual.
5. **Automatizado:** `pnpm test:edge:cotizacion-sugerida` (función) y `DialogoCargarDolar.test.tsx` / `useCotizacionSugerida.test.tsx` (diálogo). [MSF-373:T001-T003]

## Listas de precios (F-PRE-14 y F-CLI-21)

Una **lista de precios** es un **porcentaje de ajuste sobre el precio central** (por ejemplo «Revendedores -20 %»), definido por un administrador y asignado a un cliente desde su ficha (decisión de Nicolás, 2026-11-15; spec `specs/20270327-100000-listas-de-precios-por-cliente/`). No hay precios fijos por producto dentro de una lista.

> **Estado: con la bandera `listas_precios` APAGADA nada cambia; ENCENDIDA, la lista SÍ cambia lo que se cobra.** Las Fases 1 y 2 crean las listas y su asignación al cliente. Las Fases 3 y 4 (migraciones `20270348000000` a `20270348000300`) hacen que el motor de precio las aplique en el mostrador, en los comprobantes y en la tienda con cuenta web. **Por defecto la bandera está apagada en todo entorno y el resultado es idéntico, bit a bit, al de antes** (pgTAP de paridad `precio_lista_cliente.test.sql`). **Cómo se enciende:** `update public.banderas_plataforma set activa = true where clave = 'listas_precios';` (por SQL, el equipo técnico, en el orden dev → stg → prd; para apagarla al instante, la misma sentencia con `false`, sin migrar).

### Cómo se calcula el precio con una lista (Fases 3 y 4)

Un único lugar de la base decide el precio de una línea: `private.precio_para_calculo` (neto de una escala) y `private.precio_linea_venta(_calculo)` (precio de la línea con descuento personal y promoción). Los usan el mostrador, los comprobantes, el presupuesto de la tienda y, para «Tu precio», `private.precio_final_publico_escala`; todos preguntan a `private.lista_precios_cliente(cliente, organización)`, que **no devuelve nada** si la bandera está apagada, el cliente es el Consumidor final, no tiene lista o la lista está archivada.

Precedencia de la línea, **de la regla más específica a la más general** (la primera que aplica gana):

1. **Precio manual** de la línea (acción `editar_precio`): manda siempre y no lleva lista.
2. **Escala x5/x10/x50 cargada** en el producto, cuando el cliente mayorista compra esa cantidad: la lista no la pisa.
3. **Precio propio** del producto en la tienda: la lista no lo pisa.
4. **Lista del cliente**: `precio central en pesos × (1 + ajuste/100)`, **redondeado con el redondeo de la tienda** (múltiplos de 10), **sin IVA** (el IVA se suma después, como siempre). **Reemplaza el ajuste de la tienda, no se suma a él**: con una lista del 0 % el cliente paga el central puro, sin el +30 % que tenga la tienda. Un producto en dólares se convierte con la cotización de la tienda antes de aplicar el porcentaje (sin cotización, el precio es nulo como hoy).
5. **Regla de la tienda** (el ajuste de la tienda sobre el central, como hasta ahora).

Sobre ese precio normal:

- **Descuento personal del cliente** (F-VTA-32): **no se acumula con la lista**. Si el precio de la línea lo fijó la lista (paso 4), el descuento personal no se aplica; en las líneas con precio propio o escala el descuento personal sigue como siempre. La ficha del cliente lo avisa.
- **Promoción** (MSF-816): **gana el precio más bajo, sin acumular**. La promoción se compara con el precio normal **que ya incluye la lista** y gana solo si es **estrictamente menor**; en ese caso la línea conserva como `precio_referencia` el precio de la lista.

**Qué se guarda en la venta (snapshot).** Cada línea guarda `lista_precio_id` y `lista_ajuste_pct` (columnas de `dominio.comprobantes_venta_lineas`, migración `20270348000000`) cuando la lista fijó su precio normal (también si después ganó una promoción: explica la referencia). Cambiar el porcentaje de la lista o reasignar al cliente **no cambia lo ya vendido**; un borrador se recalcula cada vez que se guardan sus líneas. Las **notas de crédito** heredan el snapshot de la línea original (la devolución es al precio cobrado) y la **copia de un presupuesto** vuelve a calcular con la lista vigente. La guarda de precios desactualizados de la confirmación (`private.lineas_con_promocion_desactualizada`) vigila las promociones **y la lista**: si entre guardar y confirmar cambió el porcentaje de la lista, se reasignó o quitó la lista al cliente, se le asignó una a un cliente que no la tenía o se apagó la bandera, la confirmación responde `40001` (hint `precios_cambiaron`, con `detail = 'lista_precios'` para que la pantalla diga «El precio de la lista cambió: revisá el total y confirmá de nuevo») y hay que guardar las líneas de nuevo (D12 protege lo ya confirmado, no un borrador). **Al encender la bandera:** los borradores guardados antes de encenderla reciben ese `40001` en su primera confirmación **solo si el cliente tiene una lista asignada** (la línea no guardó lista y ahora rige una); volver a guardar las líneas lo resuelve. Conviene avisar al equipo de ventas o encender fuera del horario de mostrador. **No** detecta otros cambios del precio normal (ajuste de la tienda, escalas, costo): limitación conocida y previa. Seguimiento: MSF-970.

**Producto muy barato con descuento fuerte.** Si la lista lleva el precio de una línea a $0 (por ejemplo -90 % sobre un producto de menos de $5 con redondeo a 10), `guardar_lineas_comprobante` y `copiar_presupuesto` rechazan la línea (`22023`), igual que la tienda marca `sin_precio`; con precio manual sí se puede cobrar.

**Lista de pedido de la tienda (MSF-969, resuelto).** La lista de pedido («Enviar consulta», `private.precio_referencia_pedido`) y el precio de referencia que guarda cada consulta usan la lista del cliente con cuenta activa: el mismo número que «Tu precio» (pgTAP `tienda_lista_pedido_lista_precios.test.sql`). Sigue sin cobrar y sin el descuento de la ficha; con una promoción vigente gana el más bajo, sin acumular. Visitante, cuenta suspendida o no habilitada, cliente sin lista y bandera apagada ven el precio público de siempre. Las consultas ya enviadas conservan el precio con el que se guardaron.

**Pantallas.** En el comprobante en edición y en el mostrador, la línea que fijó una lista muestra la marca «Lista: Revendedores −20 %» (con el porcentaje congelado al cobrar). Sin lista no aparece nada nuevo.

**Tienda con cuenta web (Fase 4).** «Tu precio» de la ficha de producto (`publico.precios_cliente_por_dominio`), los favoritos de la cuenta y el presupuesto armado desde la tienda (`private.motor_presupuesto_tienda`) usan **la misma lista y la misma precedencia que el mostrador**: lo que se ve es lo que se cobra (pgTAP `precio_lista_tienda_paridad.test.sql`). Las **tarjetas del catálogo no cambian** (precio público x1) y el visitante, la cuenta suspendida o no habilitada no ven listas; la respuesta pública no agrega ninguna clave (no revela la lista ni su porcentaje). La lista de pedido de la tienda («Enviar consulta») usa la misma lista desde MSF-969 (ver arriba), sin cobrar.

**Mercado Libre** queda fuera: las listas no generan precios en publicaciones.

- **Tabla** `dominio.listas_precios` (migración `20270340000000_listas_precios.sql`; esquema `dominio` por ser una regla comercial, Principio VII): `nombre` (1 a 80 caracteres, único por organización sin distinguir mayúsculas ni espacios de más), `descripcion` (hasta 300), `ajuste_pct numeric(5,2)` de **-90,00 a +100,00** (2 decimales), `archivada_en` y `updated_at` como bloqueo optimista. Una lista **no se borra: se archiva**, y **no se puede archivar con clientes asignados** (la base responde con la cantidad). La exportación total de la organización la incluye. El mensaje de la base al archivar con clientes asignados va en singular o plural («1 cliente usa esta lista» / «N clientes usan esta lista»; migración `20270346000000_archivar_lista_precios_mensaje_plural.sql`, reversión: volver a aplicar el cuerpo de `archivar_lista_precios` de `20270340000000`). **Ventana de migraciones:** la ventana reservada de listas de precios es ahora `>= 20270340000210` (usadas hasta ahora: `…0000`, `…0100`, `…0200`, `…0210` y `…0220`; las Fases 3 y 4 arrancan en `…0300`); se renumera al integrar si otra rama la ocupó.
- **Asignación** `dominio.clientes.lista_precio_id` (migración `20270340000200_clientes_lista_precio.sql`): a lo sumo una lista por cliente; el **Consumidor final no admite lista**; una lista archivada o de otra organización no se asigna. La columna no tiene `grant update`: solo la escribe la RPC `asignar_lista_precios_cliente`. Archivar un cliente conserva su lista; **fusionar** clientes conserva la del cliente que queda y descarta la del absorbido (`20270340000210_fusion_clientes_lista_precio.sql`).
- **Quién:** solo el rol **Administrador** crea, edita, archiva, restaura y asigna (`42501` para los demás). Leen las listas los roles con `clientes` o `ventas` en lectura. La organización y el rol salen de la sesión, nunca de un parámetro.
- **RPC** (`security definer`, `search_path` vacío, `grant execute … to authenticated`, `revoke … from public, anon`): `guardar_lista_precios`, `archivar_lista_precios`, `restaurar_lista_precios`, `asignar_lista_precios_cliente`; vista `public.listas_precios_resumen` (`security_invoker`, con la cantidad de clientes). Errores: `42501`, `P0002`, `22023`, `23505` (nombre repetido), `23514`/`22003` (porcentaje fuera de rango o con más de 2 decimales), `23503` (archivar con clientes), `40001` (cambió mientras editabas), `55000` (bandera apagada).
- **Bandera `listas_precios`** (`public.banderas_plataforma`, **apagada por defecto** en cada entorno): apagada, guardar una lista y asignarla responden `55000`; archivar, restaurar y **quitar** la lista siguen permitidos. Encender: `update public.banderas_plataforma set activa = true where clave = 'listas_precios';` (por SQL, el equipo técnico).
- **Pantallas:** Catálogo → **Listas de precios** (`/productos/listas-de-precios`, solo administradores en el menú; tabla con carga infinita, crear, editar, archivar y restaurar; el diálogo muestra un ejemplo ilustrativo y avisa que la lista reemplaza el ajuste de la tienda) y el campo **«Lista de precios»** en la ficha del cliente (selector de listas activas, solo lectura para quien no es administrador, con el aviso de que no se acumula con el descuento personal). «Empresa activa: no aplica»: las listas son de toda la organización.
- **Actividad:** `lista_precios.creada`, `lista_precios.editada` (porcentaje anterior y nuevo), `lista_precios.archivada`, `lista_precios.restaurada` y `cliente.lista_precio_asignada` (lista anterior y nueva, sin datos de contacto).
- **Pruebas:** pgTAP `listas_precios.test.sql`, `listas_precios_bandera.test.sql` y `clientes_lista_precios.test.sql`; `exportacion_total.test.sql` extendido; Vitest `listas-de-precios.test.tsx` y `FormularioCliente.test.tsx`. Fases 3 y 4: pgTAP `precio_lista_cliente.test.sql` (paridad con la bandera apagada y con clientes sin lista contra una copia del cálculo anterior, y cada regla de precedencia), `ventas_lista_precios.test.sql` (guardar líneas, copiar presupuesto, notas de crédito, snapshot, validación de la confirmación) y `precio_lista_tienda_paridad.test.sql` (mostrador↔tienda, estados de cuenta, lista blanca); Vitest `LineasComprobante.test.tsx`, `ventasLineas.test.ts`, `ficha-precios-cliente.test.tsx` y `TarjetaProducto.test.tsx`.
- **Reversión inmediata, sin migrar:** apagar la bandera. De cada fase: `git revert -m 1` de su merge; la tabla y la columna quedan inertes (aditivas).

## Listado de Productos: Margen y Cotización

La columna «Margen» del listado de Productos ((precio − costo) / precio, en pesos) solo existe con acceso a Rentabilidad, igual que «Costo». El botón «Cotización →» del bloque de precio abre la pantalla de Cotización en una pestaña nueva. «Stock bajo» y «Sin vincular a ML» siguen deshabilitados hasta que existan sus datos.

El margen del listado es una **estimación**: (precio de lista − costo) / precio de lista, en pesos, con el costo en la moneda del producto (en USD se convierte con la misma cotización con que la base convirtió el precio). No incluye impuestos, descuentos ni la comisión del canal, y puede diferir del margen de Rentabilidad; la celda lo aclara en un tooltip. El enlace «Cotización →» solo se ofrece a quien tiene la sección `cotizacion_dolar`, respeta el basename del router y abre en pestaña nueva. La cotización se muestra con **hasta 4 decimales** (los que guarda `numeric(14,4)`; `formatearCotizacion` en `lib/cotizacion.ts`): en las pantallas de Cotización y de Inicio, en la pestaña «Cotizaciones» del Historial de ventas, en el bloque de precio del formulario de producto («Con dólar …») y en «Dólar vigente» de la pestaña «Precios y moneda».

