# Proveedores

Épica MSF-205 (spec `specs/20261018-190000-proveedores-y-productos/`). Este documento describe lo entregado
por **F-PRV-01 · Alta y edición de proveedor con CUIT** (MSF-336); el listado (F-PRV-02), la relación con
productos (F-PRV-03, ver su sección) y el cierre completo de la documentación se agregan con sus historias.

## Modelo

- Tabla `dominio.proveedores` (Principio VII: entidad de negocio del producto → esquema `dominio`).
  Columnas: `razon_social`, `cuit`, `persona_contacto`, `correo`, `telefono`, `direccion`, `observaciones`,
  `activo`, `creado_en`, `updated_at`. El proveedor pertenece a la **organización** (la sección es compartida
  entre empresas).
- Migraciones: `20261018190000_proveedores_tabla.sql` (tabla, CUIT, RLS, grants),
  `20261018190100_proveedores_rpc.sql` (RPC) y `20261018190200_proveedores_actividad.sql` (actividad).

## CUIT

La base lo normaliza y valida con el disparador `private.normalizar_proveedor` (no solo el formulario):
acepta guiones, puntos y espacios, se guarda **solo con dígitos**, exige 11 dígitos con dígito verificador
módulo 11 (resto 1 = inválido) y es **único por organización, también entre desactivados**
(`unique (organizacion_id, cuit)`). En pantalla se muestra `XX-XXXXXXXX-X`. El espejo del frontend es
`apps/web/src/lib/cuit.ts`; ambos comparten vectores (`cuit.test.ts` y `supabase/tests/database/proveedores.test.sql`).

## Permisos

Sección `proveedores` de la matriz de roles: **Administrador** y **Administración** editan; con `lectura` se ve
la ficha sin acciones; el resto (Depósito, Operador, Mostrador, Consulta) tiene `ninguno` y la base no les
entrega filas (CUIT ni contacto). Sin política ni grant `DELETE`: **se desactiva, no se borra**. `anon` no
tiene privilegios. El llamador no fija `organizacion_id` (sale de la sesión), `creado_en` ni `updated_at`.

## RPC (`security invoker`, rige RLS)

| RPC | Qué hace |
|-----|----------|
| `public.crear_proveedor(...)` | Alta; exige `edicion`; devuelve el proveedor. |
| `public.actualizar_proveedor(p_id, p_actualizado_en, ...)` | Edición con **bloqueo optimista** por `updated_at`: si cambió, error `40001` y no se pisa nada. |
| `public.cambiar_estado_proveedor(p_id, p_activo)` | Desactiva/reactiva; idempotente. |

Errores que reconoce la app: `23505` (CUIT repetido), `40001` (conflicto de edición), `42501` (sin permiso),
`P0002` (no existe o es de otra organización), `22023` (dato inválido).

## Pantallas

- Ficha `/proveedores/show/:id` (`apps/web/src/pages/proveedores/show.tsx`): datos, estado,
  **Editar** y **Desactivar/Reactivar** con confirmación; acciones ocultas sin `edicion`. El botón «Proveedores» (volver al listado) llega con F-PRV-02 (T014).
- Diálogo Nuevo/Editar (`apps/web/src/components/proveedores/ProveedorFormDialog.tsx`), reutilizado por el
  listado de F-PRV-02 para «Nuevo proveedor».
- El prototipo muestra «Eliminar proveedor»: el documento manda y se implementa **Desactivar/Reactivar**.
  Condiciones de compra, «Compra para» y «Enviar correo» quedan fuera de alcance (ver la matriz de la spec).

## Relación con los productos (F-PRV-03, MSF-367)

- `dominio.productos` gana `proveedor_id` (FK compuesta `(proveedor_id, organizacion_id)`, `on delete restrict`) y
  `codigo_proveedor` (hasta 80); no hay código sin proveedor, y quitar el proveedor borra el código. Un proveedor
  **nuevo** asignado debe estar activo; si se desactiva después, la asignación se conserva
  (`20261018190400_productos_proveedor.sql`).
- Vista `public.proveedores_basico` (`id`, `razon_social`, `activo`) para el selector: **no es `security_invoker`
  a propósito** (el Operador no lee la tabla) y filtra por organización y nivel; no expone CUIT ni contacto
  (`20261018190500_proveedores_basico.sql`).
- **Cambio de contrato** (`20261018190600_productos_proveedor_rpc.sql`): `crear_producto` y `actualizar_producto`
  reciben `p_proveedor_id` y `p_codigo_proveedor` opcionales al final. En `actualizar_producto` el proveedor se
  **reemplaza siempre** (nulo = sin proveedor): el formulario reenvía el vigente. El cambio avanza `updated_at` y
  deja `producto.editado`. Contrato para MSF-219 y reposición: `productos.proveedor_id` / `codigo_proveedor`.
- `public.productos_de_proveedor(p_proveedor_id, p_pagina, p_tamano)` (`20261018190700_…`): exige `proveedores` y
  `productos`; orden por nombre, tope 100, `total_filas`. La ficha lo muestra en la sección **Productos**
  (`ProductosDelProveedor.tsx`), con carga y error aislados; «Ver producto» abre la edición del producto.
- Reversión: restaurar las RPC de `20261017120200`/`20261017120400`, luego `drop function productos_de_proveedor`,
  `drop view proveedores_basico` y quitar las dos columnas (migración posterior, exportando antes los datos).

## Actividad

`proveedor.creado|editado|desactivado|reactivado` en `public.registro_actividad` (ver `docs/actividad.md`).

## Reversión

Migraciones aditivas. Para volver atrás, en una migración **posterior** (no en el mismo PR; exportar antes los
datos): quitar los disparadores de actividad y `proveedores_normalizar`, las tres RPC, las funciones
`private.registrar_actividad_proveedor*`, `private.normalizar_proveedor` y `private.cuit_valido`, y la tabla
`dominio.proveedores`. El encabezado de cada migración lista los pasos exactos.
