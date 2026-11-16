// F-MIG-02 (MSF-313, FR-022): definición de la entidad «vínculos proveedor ↔ producto».
// Cada fila fija el proveedor de un producto del catálogo: el SKU identifica el
// producto (lo migra Catálogo; acá no se crea), el identificador del panel actual
// identifica al proveedor ya cargado y el código es el que el proveedor le da al
// producto. Un SKU inexistente o un proveedor no cargado es error de fila.
// La fila se identifica por SKU (un producto, un proveedor): se detecta repetido en
// el archivo igual que el servidor, sin distinguir mayúsculas.

import type { DefinicionEntidad } from '../../../lib/migracion'

export const ENTIDAD_VINCULOS: DefinicionEntidad = {
  id: 'vinculos_proveedor_producto',
  etiqueta: 'Vínculos proveedor ↔ producto',
  sustantivo: 'vínculo',
  sustantivoPlural: 'vínculos',
  descripcion: 'Vinculá cada producto del catálogo con su proveedor. Cargá antes los proveedores y el catálogo.',
  campos: [
    { clave: 'sku', etiqueta: 'SKU del producto', obligatorio: true, alias: ['sku', 'codigo de producto', 'producto'] },
    {
      clave: 'proveedor_id_externo',
      etiqueta: 'Identificador del proveedor en el panel actual',
      obligatorio: true,
      alias: ['id proveedor', 'proveedor', 'identificador proveedor', 'identificador del proveedor', 'id externo proveedor'],
    },
    {
      clave: 'codigo_proveedor',
      etiqueta: 'Código del proveedor',
      alias: ['codigo proveedor', 'codigo del proveedor', 'codigo en proveedor'],
    },
  ],
  rpcPrevisualizar: 'previsualizar_lote_vinculos_proveedor_producto',
  rpcAplicar: 'aplicar_lote_vinculos_proveedor_producto',
  archivoPlantilla: 'vinculos-proveedor-producto.csv',
  campoClave: 'sku',
  claveSinMayusculas: true,
}
