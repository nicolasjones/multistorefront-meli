---
owner: producto
sources:
  - specs
---

# Aislamiento por organización

Regla para toda tabla que guarda datos de una organización (spec
`20261012-140000-acceso-y-organizacion`, F-ORG-01, FR-011/FR-012). Se apoya en
el mecanismo del template (spec 003, `fundacion_multitenant`); no se reinventa.

## Regla para tablas de dominio

1. La tabla lleva `organizacion_id uuid not null references organizaciones(id)`.
2. `alter table ... enable row level security` en la **misma migración** que la
   crea. Sin RLS no hay tabla expuesta.
3. Políticas por organización con las funciones del template:
   - lectura: `using (organizacion_id = private.organizacion_id())`
   - escritura (`insert`/`update`/`delete`): además `and private.puede_escribir()`,
     tanto en `using` como en `with check`.
4. La migración declara el esquema de la tabla: plataforma o autenticación en
   `public`; datos del producto en `dominio` (ver Constitución VII). Ambos están
   expuestos por la API (`[api] schemas` en `supabase/config.toml`).
5. Nunca se usa la service-role key en el navegador; el aislamiento lo impone
   Postgres, no la interfaz.

`private.organizacion_id()` resuelve la única membresía del usuario, o la
organización que un superadmin entró; sin ninguna de las dos devuelve `null` y
la política no devuelve filas (fail-closed). Excluye a los usuarios
suspendidos (`usuarios_organizacion.estado`, migración `20261012140100`, F-ACC-01): ver
[`acceso-ingreso.md`](acceso-ingreso.md).

## Cómo se hace cumplir

- `supabase/tests/database/rls_en_toda_tabla.test.sql` recorre el catálogo
  (`pg_class`) de `public` y `dominio` y **falla si alguna tabla no tiene RLS
  activado**. Una tabla nueva sin RLS rompe `pnpm test:db` sin tocar la prueba.
  Se omiten las particiones hijas y las tablas que pertenecen a una extensión.
- `supabase/tests/database/aislamiento_organizaciones.test.sql` verifica con
  dos organizaciones que el administrador y el miembro de la organización 1, el
  administrador de la organización 2 y el superadmin (que entra a una
  organización a la vez) ven solo lo de su organización, y que un usuario sin
  membresía no ve nada. No hay miembro (no administrador) en la organización 2.
- Revisión del build (T019): las tablas creadas en `supabase/migrations`
  habilitan RLS; ninguna tabla expuesta queda sin él.

## Qué cubre y qué no

La prueba de catálogo exige RLS activado, no que la política sea correcta: una
política `using (true)` la satisface. Por eso cada tabla de dominio nueva debe
sumar sus casos a la prueba de aislamiento (dos organizaciones, sin membresía).

El control positivo de la prueba de catálogo fija `public.clientes`: un fork que
renombre o elimine esa tabla debe actualizar esa aserción.

`public.clientes` ahora filtra también por sección (`private.nivel_seccion('clientes')`, sin DELETE), y el
Consumidor final es una fila más de cada organización: la prueba `aislamiento_organizaciones` la cuenta, así una
fuga de RLS sobre él se detecta. Las RPC `buscar_clientes`/`escala_de_cliente` son `security invoker` (heredan
RLS) y `exportar_clientes` es `security definer` pero toma la organización de `private.organizacion_id()`, nunca
de un parámetro. Ver `docs/clientes.md`.

`dominio.producto_imagenes` (F-CAT-05) filtra por `organizacion_id` y por la sección `productos`, y su FK compuesta
`(producto_id, organizacion_id)` impide colgar una imagen de un producto ajeno. El bucket privado `productos-imagenes`
aísla por prefijo `<organizacion_id>/<producto_id>/` en `storage.objects`; el alta exige además que el producto sea de la
organización de la sesión. La prueba `catalogo_producto_imagenes` cubre tabla y Storage entre dos organizaciones. Ver
`docs/catalogo.md`.

`dominio.existencias`, `dominio.movimientos_stock` y `dominio.motivos_movimiento` (F-STK-02) filtran por
`organizacion_id` y por la sección `stock`; las FK compuestas `(producto_id, organizacion_id)` y
`(motivo_id, organizacion_id)` impiden cruzar organizaciones. `existencias` y `movimientos_stock` no tienen escritura
directa: solo `public.registrar_movimiento_stock` (security definer) las escribe, tomando organización y responsable de
la sesión, nunca de parámetros. La prueba `stock_movimientos` cubre el aislamiento entre dos organizaciones y el rechazo
de escritura directa. Ver `docs/stock.md`.

`public.migracion_cargas` / `public.migracion_filas` (plataforma, `public`) y
`dominio.archivo_ingresos_mercaderia` (dominio) de la migración inicial (F-MIG-01/03, épica MSF-142)
filtran por `organizacion_id` con RLS: las cargas se leen solo como Administrador y el archivo de
ingresos con `nivel_seccion('stock')`. Las RPC de importación y el informe de conciliación nunca
aceptan la organización del llamador: la toman de la sesión y otra organización recibe `P0002`,
aunque repita el identificador externo. Las pruebas `migracion_conciliacion` y `migracion_ensayo`
cubren el cruce entre dos organizaciones. Ver `docs/tecnico/migracion-inicial-de-datos.md`.
`dominio.ingresos_mercaderia` y `dominio.ingresos_mercaderia_lineas` (MSF-219) filtran por `organizacion_id` y
`nivel_seccion('stock')`, con FK compuestas a `proveedores` y `productos` que impiden cruzar organizaciones. Son de
solo lectura para `authenticated`: las escriben `public.registrar_ingreso_mercaderia` y
`public.anular_ingreso_mercaderia`, que toman organización y actor de la sesión (nunca de parámetros) y mueven el
stock por la RPC de MSF-136. Las pruebas `ingresos_mercaderia_base|registrar|historial|anular` cubren el aislamiento,
la escritura directa y el rechazo de `anon`. Ver `docs/tecnico/ingreso-de-mercaderia.md`.
