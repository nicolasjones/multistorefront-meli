# Precios, dólar e IVA (épica MSF-114 · spec `20261022-120000-precios-e-iva`)

Guía de la épica: cuatro historias entregadas (F-PRE-01, F-PRE-07, F-PRE-12, F-PRE-15). El detalle fino de cada una vive en [`iva-precio-final.md`](./iva-precio-final.md) y [`precios-escalas.md`](./precios-escalas.md); la fuente de requisitos es [`spec.md`](../specs/20261022-120000-precios-e-iva/spec.md).

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
3. **Final** = neto × (1 + alícuota) al peso entero; Exento ⇒ final = neto. La alícuota es la del producto o, si no tiene, la de su categoría.
4. **Margen** = (neto − costo en pesos) / neto, siempre sobre el neto (sin IVA). El interruptor de IVA no lo cambia.

El front solo espeja las fórmulas para textos de ejemplo (`lib/precios.ts`, `lib/iva.ts`); la autoridad es la base.

## Contrato `private.precio_para(producto, empresa, escala default 'x1')`

Devuelve `escala_usada`, `neto`, `alicuota_*` y `final` (detalle en [`precios-escalas.md`](./precios-escalas.md)). Escala sin precio cargado ⇒ usa la lista (`x1`); escala fuera de `x1/x5/x10/x50` ⇒ error `22023`.

**`tipos_cliente.escala_precio`**: `precio_para` **no consulta `tipos_cliente`**. Quien necesita el precio (Ventas, cuenta web) lee ese texto (p. ej. `x5` para «Mayorista») y lo pasa como `escala`. La pantalla Tipos de cliente es de Clientes y proveedores; mientras la tabla no exista el contrato se prueba con un tipo simulado (`precios_escala.test.sql`, `escalaDeTipoCliente`).

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

Spec: [`20270105-100000-configuracion-dolar-y-precio-propio`](../specs/20270105-100000-configuracion-dolar-y-precio-propio/spec.md) (FR-012…FR-020).

- **Dato**: `dominio.precios_propios_empresa` (PK `producto_id + empresa_id`; `moneda` ARS|USD; `importe > 0`, hasta 2 decimales). FK compuestas a `productos` y `empresas` (no cruza organizaciones), RLS por organización, `select` con `productos` ≥ lectura, **sin escritura directa**: se escribe solo con las RPC.
- **RPC** (`public`, `anon` sin ejecución): `fijar_precio_propio(producto, empresa, moneda, importe)` (`productos` = edición; idempotente; actividad `producto.precio_propio_fijado` **sin importes**), `quitar_precio_propio(producto, empresa)` (idempotente; `producto.precio_propio_quitado`) y `leer_precios_propios(producto)`. Errores: `42501` sin permiso, `P0002` producto o empresa ajenos, `22023` moneda inválida o importe vacío, `23514` importe ≤ 0 o con más de 2 decimales, `22003` demasiado grande.
- **Cálculo**: con precio propio el **neto** es ese precio (reemplaza a «central + ajuste», sin redondeo de la regla) y el IVA de la empresa se aplica encima como siempre. Lo leen `private.precio_neto_empresa`, `public.precios_empresa_neto` (nueva columna `precio_propio boolean`, al final) y, por lo tanto, `precios_empresa_final`; `private.precio_visible_desde_central` y la vista previa `previsualizar_cotizacion` (hoy / nuevo) pasan por `private.precio_visible_con_cotizacion`. Un precio propio en **USD** se convierte con `private.cotizacion_para(organización, empresa)` (la de la empresa con alcance «una por empresa», la general con «sistema»); sin cotización el neto es `null` (no se inventa ni se cae a la regla). Al confirmar un dólar los precios se recalculan solos porque se calculan al leer; `private.precios_usd_por_empresa` cuenta también los precios propios en USD.
- **Ficha del producto** (`pages/productos/edit.tsx`): bloque «Precio propio por empresa» (`components/precios/PrecioPropioEmpresas.tsx`), una fila por empresa a la que se vende (`Moneda`, `Precio propio`, «Guardar», «Quitar»), marca «Precio propio» y neto de ejemplo; solo lectura para Consulta. En el **alta** (`create.tsx`) el producto todavía no existe: el precio propio se fija desde la edición.
- **Fuera de alcance**: el listado de productos no tiene columna de precio por empresa, así que la marca «Precio propio» no se muestra allí (Decisión abierta 4). `private.precio_para` (escalas x5/x10/x50) **no** lee el precio propio todavía. Los precios propios no van a Mercado Libre (Etapa 2, FR-020: sin cola ni columna ML).
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
