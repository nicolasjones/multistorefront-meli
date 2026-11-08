# Configuración del dólar y precio propio (épica MSF-352)

Spec: `specs/20270105-100000-configuracion-dolar-y-precio-propio/`. Alcance de entrega: `refine` y `supabase`. Tres historias sobre la cotización del dólar y los precios por empresa:

| Historia | Qué hace | Detalle |
|---|---|---|
| F-PRE-06 (MSF-419) | Configuración de la cotización: alcance (sistema o por empresa), redondeo, umbral para recalcular, confirmación y aviso en Inicio | `dolar-y-recalculo.md` |
| F-PRE-08 (MSF-423) | Precio propio de un producto en una empresa, en pesos o en dólares | `precios.md`, sección «Precio propio de un producto en una empresa» |
| F-PRE-09 (MSF-427) | Simulador «Así quedan los precios» con marca de precio propio | `precios.md`, sección «Simulador…» |

## Piezas de base de datos

Todas son aditivas. Las versiones se asignaron al integrar la épica con `dokploy` (las originales quedaban por debajo del máximo).

| Migración | Contenido | Esquema |
|---|---|---|
| `20270213100001_cotizacion_configuracion.sql` | `dominio.cotizacion_configuracion`, `obtener_configuracion_cotizacion`, `guardar_configuracion_cotizacion` | tabla en **`dominio`**, RPC en `public` |
| `20270213100002_cotizacion_alcance_empresa.sql` | `empresa_id` en cotizaciones, `private.cotizacion_para`, sobrecarga de `a_pesos` con empresa | `dominio` / `private` |
| `20270213100003_cotizacion_cambio_alcance.sql` | `previsualizar_cambio_alcance`, `cambiar_alcance_cotizacion` | `public` |
| `20270213100004_cotizacion_usa_configuracion.sql` | previsualizar, confirmar y descartar leen la configuración y reciben la empresa | `public` |
| `20270213100005_precios_propios_empresa.sql` | `dominio.precios_propios_empresa`, `fijar_precio_propio`, `quitar_precio_propio` | tabla en **`dominio`**, RPC en `public` |
| `20270213100006_precios_propios_calculo.sql` | el precio propio rige en `precio_neto_empresa`, `precios_empresa_neto` y las vistas previas | `private` / `public` |
| `20270213100007_alertas_inicio_respeta_aviso.sql` | `recalcular_alertas_inicio` respeta el aviso configurado | `public` (solo `service_role`) |
| `20270213200001_simulador_precio_propio.sql` | `previsualizar_precios_empresa` suma `precio_propio` | `public` |
| `20270216400000_confirmar_comprobante_cotizacion_por_empresa.sql` | `confirmar_comprobante` guarda costo y cotización de cada línea con la cotización de la empresa del comprobante (`private.cotizacion_para`) | `public` |

## Revisión de seguridad de la épica (T039, FR-028)

- **RLS**: `dominio.cotizacion_configuracion` y `dominio.precios_propios_empresa` con RLS por organización y por sección (`cotizacion_dolar` / `empresas`); `select` para `authenticated`, **sin escritura directa**; sin privilegios para `anon`.
- **Claves foráneas compuestas** con la organización (`(empresa_id, organizacion_id)`, `(producto_id, organizacion_id)`): una empresa o un producto de otra organización no puede tener precio propio ni cotización.
- **RPC**: todas con `revoke … from public, anon` y `grant … to authenticated`; las `security definer` fijan `search_path = ''`, sacan organización y rol de la sesión (nunca de un parámetro) y devuelven `42501` sin el permiso. `recalcular_alertas_inicio` solo la ejecuta `service_role`.
- **Funciones `private.*` con grant a `authenticated`** (`cotizacion_config`, `precio_propio_empresa`, `cotizacion_para`, `a_pesos`): son `security definer` o `invoker` según el caso y acotan por la organización de la sesión; el esquema `private` no está expuesto por la API, así que solo se alcanzan desde otras funciones, vistas y políticas.
- **Actividad**: fijar y quitar un precio propio, y guardar la configuración, quedan en el historial **sin importes**.
- **Mercado Libre**: el precio propio no genera cola ni columna propia (FR-020).
- **Hallazgo corregido**: la vista previa del simulador convertía el precio central con la cotización de la **organización** aunque la empresa tuviera una propia, así que podía mostrar un central distinto del que cobra la tienda. Ahora usa la de la empresa, igual que `precios_empresa_neto`.
- **Verificación**: pgTAP `cotizacion_configuracion`, `cotizacion_alcance`, `precios_propios_empresa` y `simulador_precio_propio`, más `rls_en_toda_tabla` y los tests de `anon`, que corren en el job `database` del CI.

## Auditoría de lectores de `cotizacion_aplicada` (hallazgo bloqueante de la revisión)

`dominio.cotizacion_aplicada` pasó a una fila por empresa (20270213100002). Un lector que la consulta solo por organización puede devolver varias filas (error 21000 en una subconsulta escalar) o la cotización equivocada. Revisados todos los lectores de `cotizacion_aplicada`, `cotizacion_inicial` y `a_pesos` en `supabase/`, `workers/` y `apps/web/src`:

| Lector | Resultado |
|---|---|
| `public.confirmar_comprobante` (20270202201006) | **Arreglado** en 20270216400000: la subconsulta sin `empresa_id` fallaba con alcance «empresa» y el costo usaba la cotización general. Ahora `private.cotizacion_para(org, empresa)` y `private.a_pesos` de 4 argumentos con la empresa del comprobante. |
| `private.cotizacion_para`, `private.cotizacion_vigente_para`, `cotizacion_estado` (20270213100002/100004) | No aplica: filtran por `empresa_id` (igual o nulo) y por alcance. |
| `previsualizar_cambio_alcance`, `cambiar_alcance_cotizacion`, `confirmar_cotizacion` (20270213100003/100004) | No aplica: insertan o borran con `empresa_id` explícito; las lecturas pasan por `cotizacion_para`. |
| `private.a_pesos` de 3 argumentos y sus usuarios (`productos_precio_costo`, `analitica.a_pesos`, inventario valorizado) | No fallan (leen solo la fila general, `empresa_id is null`, una por organización): valorizan con la cotización general. Limitación declarada: con alcance «empresa» ignoran la cotización propia, porque no tienen empresa. |
| Joins a `cotizacion_inicial` (vistas de margen y `productos_precio_costo`) | No aplica: es una fila por organización, no duplica filas. |
| Workers, funciones de borde y `apps/web/src` | No leen `cotizacion_aplicada`: la web solo lee `cotizacion_inicial` (una fila). |
