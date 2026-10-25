---
owner: producto
sources: []
---
# Migración inicial de datos

Importador de datos del panel actual hacia la base del producto (épica MSF-142).
Estado de esta pasada: **clientes** (F-MIG-01) y **proveedores + vínculos con productos** (F-MIG-02).
El informe de conciliación, el ensayo y el plan de corte están en [migracion-inicial-de-datos.md](migracion-inicial-de-datos.md) (F-MIG-04).

## Reglas de importación (contrato)

- **Identificador externo = identidad de la fila.** Se concilia por
  `clientes_identificadores_externos` con `sistema = 'panel_actual'`.
- **Si el identificador ya existe, el cliente se ACTUALIZA** (FR-005). Reenviar un
  identificador ya cargado en un lote anterior **no es un error**: es un upsert y sólo pisa
  las columnas que el archivo trae.
- **"Identificador repetido en el archivo"** aplica cuando el mismo identificador aparece
  **dos veces en el mismo archivo**, aunque caiga en otro lote (la primera fila aplicada
  gana; el servidor lo resuelve contra `migracion_filas` de la carga). También se marca en la
  vista previa (FR-004). Reenviar un identificador de una carga anterior sigue siendo upsert.
- **Idempotencia (FR-006):** volver a aplicar el mismo archivo no duplica clientes ni
  vínculos; una fila ya aplicada en la misma carga se omite, no se re-procesa.
- **Documento duplicado** (DNI/CUIT ya existente en la organización) **sí es error de fila**:
  no se importa y se informa con número de fila y motivo.

## Registro y cierre

Cada ejecución deja `migracion_cargas` (estado y contadores: nuevos / actualizados / con
error) y `migracion_filas` (resultado por fila). El informe de cierre (FR-007) cuadra con el
archivo: nuevas + actualizadas + con error = filas del archivo.

## Pruebas

`supabase/tests/database/migracion_clientes.test.sql` cubre FR-005, FR-006, FR-008 y FR-009.
Los lotes 1 y 2 usan la misma carga: el lote 2 **actualiza** P-001 y P-002 y sólo falla la
fila con documento repetido.

## Proveedores y vínculos con productos (F-MIG-02, MSF-313)

Reutilizan el asistente genérico (subir → mapear → vista previa con errores por fila → aplicar
por lotes → resultado y registro en `migracion_cargas`/`migracion_filas`). Rutas:
`/migracion/importar/proveedores` (botón «Importar» de Proveedores, solo Administrador) y
`/migracion/importar/vinculos-proveedor-producto` (se ofrece al terminar la carga de proveedores).
Orden de carga: **clientes → proveedores → vínculos** (los vínculos necesitan los proveedores ya
cargados y el catálogo de productos cargado por Catálogo).

### Proveedores (FR-020, FR-021)

- Plantilla `proveedores.csv`: Identificador del panel actual, Razón social, CUIT, Persona de
  contacto, Correo, Teléfono, Dirección, Observaciones.
- **Identidad de la fila = `dominio.proveedores.id_externo`** (columna nueva, nullable, única por
  organización cuando tiene valor): existe → se actualiza; no existe → se crea. Reaplicar no duplica.
- Mismas validaciones que el alta de Proveedores (MSF-205): razón social obligatoria, CUIT con dígito
  verificador (módulo 11) y único por organización (incluye inactivos), correo con formato, largos.
  Un CUIT ya usado por **otro** proveedor de la organización es error de fila («Ya existe un
  proveedor con ese CUIT»); no se fusiona con el existente.
- Las celdas vacías **no** borran datos existentes; las columnas no mapeadas tampoco.
- El mismo identificador dos veces en el archivo (aunque caiga en otro lote): gana la primera fila.

### Vínculos proveedor ↔ producto (FR-022)

- Plantilla `vinculos-proveedor-producto.csv`: SKU del producto, Identificador del proveedor en el
  panel actual, Código del proveedor (opcional).
- Fija `productos.proveedor_id` y `productos.codigo_proveedor`. El SKU se busca sin distinguir
  mayúsculas ni espacios extremos. **No crea productos ni proveedores**: SKU inexistente, proveedor
  no cargado o proveedor desactivado es error de fila.
- Un producto tiene un solo proveedor: el mismo SKU dos veces en el archivo → gana la primera fila.
  Si el producto ya tenía proveedor, la fila lo **actualiza**; con otro proveedor y código vacío, el
  código anterior se limpia (no corresponde al proveedor nuevo).

### Permisos, esquemas y pruebas

- Solo Administrador (`private.puede_escribir()`), organización de la sesión, `anon` sin ejecución.
  Cuatro RPC nuevas en `public` (`previsualizar_lote_*`, `aplicar_lote_*`), todas `security definer`
  con `search_path = ''`; `cerrar_carga_migracion` es la de F-MIG-01.
- Esquemas (Principio VII): `dominio.proveedores.id_externo` → `dominio` (entidad de negocio);
  las cargas/filas siguen en `public`. No se crean tablas nuevas.
- Migración `20261201110000_proveedores_id_externo.sql`: aditiva; reversión documentada en su
  encabezado (se hace en una migración posterior).
- Pruebas: `supabase/tests/database/migracion_proveedores.test.sql` (idempotencia, CUIT, SKU
  inexistente, aislamiento, rol, `anon`) y Vitest (`entidades/proveedores.test.ts`,
  `AsistenteProveedores.test.tsx`) con fixtures sintéticos de ~135 proveedores y sus vínculos.
- **Supuesto abierto (FR-024):** falta confirmar que el panel actual exporta proveedores y vínculos a
  CSV/Excel; hasta entonces las plantillas son el contrato del archivo.
- Empresa activa: no aplica filtrado por empresa (los proveedores son de la organización); la
  pantalla lo declara y el cambio de empresa no altera la carga (test de F-MIG-01).
