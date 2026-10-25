// F-MIG-03 (MSF-330, FR-030): definición de la entidad «ingresos anteriores»
// del asistente genérico. Carga `dominio.archivo_ingresos_mercaderia`, el
// archivo de solo lectura del historial del panel anterior: producto, proveedor
// y operador viajan como texto (los ~19 operadores históricos no son usuarios).
// La clave de conciliación es el identificador del panel actual (`id_externo`).
// Esta carga no mueve stock (FR-032).

import type { DefinicionEntidad } from '../../../lib/migracion'

export const ENTIDAD_INGRESOS: DefinicionEntidad = {
  id: 'ingresos_archivo',
  etiqueta: 'Ingresos anteriores',
  sustantivo: 'ingreso',
  sustantivoPlural: 'ingresos',
  descripcion:
    'Traé el historial de ingresos de mercadería del panel actual. Queda como archivo de solo consulta: no modifica el stock.',
  campos: [
    {
      clave: 'id_externo',
      etiqueta: 'Identificador del panel actual',
      obligatorio: true,
      alias: ['id', 'id externo', 'identificador', 'identificador externo', 'codigo', 'numero de ingreso'],
    },
    { clave: 'fecha', etiqueta: 'Fecha', obligatorio: true, alias: ['fecha de ingreso', 'fecha ingreso'] },
    { clave: 'producto', etiqueta: 'Producto', obligatorio: true, alias: ['articulo', 'descripcion', 'nombre del producto'] },
    { clave: 'cantidad', etiqueta: 'Cantidad', obligatorio: true, alias: ['cant', 'unidades'] },
    { clave: 'proveedor', etiqueta: 'Proveedor', alias: ['razon social', 'proveedor nombre'] },
    { clave: 'operador', etiqueta: 'Operador', alias: ['usuario', 'cargado por', 'responsable'] },
  ],
  rpcPrevisualizar: 'previsualizar_lote_archivo_ingresos',
  rpcAplicar: 'aplicar_lote_archivo_ingresos',
  archivoPlantilla: 'ingresos-anteriores.csv',
}
