# Mapeo de inventario — Clientes (T025)

Fuente: `design/pantallas/Clientes.inventory.json` (generado con
`node scripts/prototipo-inventario.mjs`).

Criterio: cada ítem se mapea a un componente base/tema ya entregado, o queda
**fuera de alcance** por no tener dueño de datos (regla de la spec: no se
agregan features sin dueño). Lo que pertenece a la pantalla de Clientes de alta
fidelidad vive en la rama `dokploy` (PR #121, MSF-160) y no en esta rama, que
sale de `main`; se deja trazado.

## Tabla 1 — listado

| Ítem del prototipo | Mapeo | Estado |
|---|---|---|
| Columna de selección (checkbox) | `MuiCheckbox` (`.cb`, 18/5) desde tokens | Entregado (tema) |
| Cliente, Tipo, Contacto, Localidad, Expreso preferido | Columnas de la pantalla de Clientes | En `dokploy` (PR #121) |
| Tiendas, Cuenta web | Sin dueño de datos | Fuera de alcance |
| Columna de acciones (Ver ficha) | `ContenidoAdaptable.acciones` (`EditButton`) | Entregado (estructura) |

## Tabla 2 — resumen

| Ítem | Mapeo | Estado |
|---|---|---|
| #, Cliente, Comprobantes, Facturado, Participación | Resumen de la pantalla de Clientes | En `dokploy` (PR #121) |

## Campos

| Ítem | Mapeo | Estado |
|---|---|---|
| Buscar por nombre, CUIT o número | `MuiOutlinedInput` (`.fld .in`, 40/9) desde tokens | Entregado (tema) |
| Número, DNI/CUIT, Nombre o razón social, Tipo de cliente, Correo, Teléfono, Celular, Dirección, CP, Localidad, Provincia, Expreso preferido, Habilitado en, Cuenta web | Ficha de cliente | En `dokploy` (PR #121) |
| Desde, Hasta, Asunto, Mensaje | Correo masivo | Fuera de alcance (sin dueño) |

## Botones

| Ítem | Mapeo | Estado |
|---|---|---|
| Nuevo cliente, Guardar cliente, Eliminar cliente, Cancelar, Aplicar | `MuiButton` (38/9; `.sm` 32/8) desde tokens | Entregado (tema) |
| Ver ficha, Configurar tipos de cliente →, Enviar invitación por correo al crear la cuenta, Incluir en el correo masivo | Ficha / configuración de Clientes | En `dokploy` (PR #121) |
| Importar, Etiquetas, Exportar, Exportar a Excel, Descargar plantilla CSV, Importar 54 clientes | Sin dueño de datos | Fuera de alcance |

## Diálogos

| Ítem | Mapeo | Estado |
|---|---|---|
| Enviar correo a seleccionados | Correo masivo | Fuera de alcance (sin dueño) |
| Ficha (·) | Alta/edición de cliente | En `dokploy` (PR #121) |
| Eliminar cliente | Confirmación destructiva | Fuera de alcance |
| Importar clientes | Importación CSV | Fuera de alcance |
