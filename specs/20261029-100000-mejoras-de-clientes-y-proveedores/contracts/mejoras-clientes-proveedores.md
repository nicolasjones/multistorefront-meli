# Contratos · Mejoras de clientes y proveedores (MSF-445)

Todas las RPC viven en `public`, con `revoke execute … from public, anon` y `grant execute … to authenticated` explícitos. La organización sale de la sesión (`private.organizacion_id()`), nunca de un argumento.

## F-CLI-18 · Fusión (nuevas)

```ts
fusionar_clientes(p_conservar_id: uuid, p_descartar_id: uuid, p_cuenta_web_de: uuid | null = null): { documentos_reasignados: number; cuentas_reasignadas: number; campanas_reasignadas: number }
```
Solo Administrador. Atómica. `p_cuenta_web_de` = cliente (uno de los dos) cuya cuenta web se mantiene; obligatorio si ambos tienen cuenta web activa. Errores: permiso, mismo cliente, inexistente/otra organización, archivado, dos cuentas activas sin resolver. Registra `cliente.fusionado`.

```ts
vista_previa_fusion_clientes(p_conservar_id: uuid, p_descartar_id: uuid): { cliente_id: uuid; numero: number; nombre: string; documentos: number; cuentas_web_activas: number; cuentas_web_total: number }[]
```
Solo lectura; mismas validaciones.

## F-PRV-07 · Costos (nueva y cambio de comportamiento)

```ts
historial_costos_producto(p_producto_id: uuid, p_proveedor_id: uuid | null = null): { proveedor_id: uuid; proveedor_razon_social: string; ingreso_id: uuid; fecha: string; comprobante: string | null; costo_unitario_usd: number }[]
```
Exige `rentabilidad` y `proveedores` en lectura/edición. Excluye ingresos anulados y líneas sin costo.

`registrar_ingreso_mercaderia(p_empresa, p_proveedor, p_fecha, p_comprobante, p_lineas, p_actualizar_costo, p_clave_idempotencia)`: **misma firma**; cambio de comportamiento: `costo_unitario_usd` de cada línea de `p_lineas` pasa a ser opcional. No es BREAKING (relaja una validación; los llamadores actuales siguen funcionando).

## F-PRV-08 · Contactos (nuevas)

```ts
listar_contactos_proveedor(p_proveedor_id: uuid): { id: uuid; nombre: string; rol: string | null; correo: string | null; telefono: string | null; principal: boolean }[]
agregar_contacto_proveedor(p_proveedor_id: uuid, p_nombre: string, p_rol: string | null, p_correo: string | null, p_telefono: string | null, p_principal: boolean = false): uuid
marcar_contacto_principal(p_contacto_id: uuid): void
```
Escritura con `proveedores` en edición. `marcar_contacto_principal` copia nombre, correo y teléfono a `dominio.proveedores` (`persona_contacto`, `correo`, `telefono`).

## Eventos de actividad (nuevos)

`cliente.fusionado`, `proveedor.contacto_agregado`, `proveedor.contacto_principal_cambiado`.
