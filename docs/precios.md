---
owner: producto
sources: [specs]
---
# Precios, dólar e IVA (épica MSF-114 · spec `20261022-120000-precios-e-iva`)

Guía de la épica: cuatro historias entregadas (F-PRE-01, F-PRE-07, F-PRE-12, F-PRE-15). El detalle fino de cada una vive en [`iva-precio-final.md`](./iva-precio-final.md) y [`precios-escalas.md`](./precios-escalas.md); la fuente de requisitos es [`spec.md`](../specs/20261022-120000-precios-e-iva/spec.md).

## Modelo (Principio VII)

| Objeto | Esquema | Naturaleza |
|---|---|---|
| `cotizacion_inicial` (dólar de arranque, uno por organización) | `dominio` | dato de negocio |
| `precios_empresa` (regla de precio + interruptor «Precios que ve el cliente» por empresa) | `dominio` | dato de negocio |
| `alicuotas_iva` (21 %, 10,5 %, Exento) y `alicuota_iva_id` en `categorias`/`productos` | `dominio` | dato de negocio |
| `producto_precios_escala` (x5, x10, x50; x1 es el precio de lista) | `dominio` | dato de negocio |
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
