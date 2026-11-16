// Fixtures de importación del archivo de ingresos (F-MIG-03, FR-030). Todo es
// inventado: productos, proveedores y operadores llevan «Sintético» para que
// ninguna coincidencia parezca un dato real. La guarda `fixturesSinteticas.test.ts`
// recorre este archivo igual que el resto.

export type IngresoArchivoSintetico = {
  id_externo: string
  fecha: string
  producto: string
  cantidad: string
  proveedor: string
  operador: string
}

export const INGRESOS_ARCHIVO_SINTETICOS: readonly IngresoArchivoSintetico[] = [
  { id_externo: 'ING-SINT-001', fecha: '2025-03-14', producto: 'Producto Sintético Uno', cantidad: '12', proveedor: 'Proveedor Sintético A', operador: 'Operador Sintético 01' },
  { id_externo: 'ING-SINT-002', fecha: '15/03/2025', producto: 'Producto Sintético Dos', cantidad: '3', proveedor: 'Proveedor Sintético B', operador: 'Operador Sintético 02' },
  { id_externo: 'ING-SINT-003', fecha: '2025-04-02', producto: 'Producto Sintético Tres', cantidad: '40', proveedor: '', operador: 'Operador Sintético 01' },
]

export const ENCABEZADOS_INGRESOS_ARCHIVO = [
  'Identificador del panel actual',
  'Fecha',
  'Producto',
  'Cantidad',
  'Proveedor',
  'Operador',
] as const

export const CSV_INGRESOS_ARCHIVO_SINTETICOS = [
  ENCABEZADOS_INGRESOS_ARCHIVO.join(','),
  ...INGRESOS_ARCHIVO_SINTETICOS.map((ingreso) => [
    ingreso.id_externo,
    ingreso.fecha,
    ingreso.producto,
    ingreso.cantidad,
    ingreso.proveedor,
    ingreso.operador,
  ].join(',')),
].join('\n') + '\n'
