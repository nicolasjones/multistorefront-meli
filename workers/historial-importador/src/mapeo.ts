// Mapeo de columnas por tipo (FR-005). Los nombres reales de las exportaciones del panel anterior
// se confirman con una muestra real (spec, Decisiones abiertas 8): si difieren, se ajusta esta
// tabla de alias, no el modelo. Las cabeceras se comparan sin mayúsculas, tildes ni signos.

export type TipoHistorial = 'comprobantes' | 'cobros' | 'cotizaciones';

export const TIPOS: readonly TipoHistorial[] = ['comprobantes', 'cobros', 'cotizaciones'];

type TipoValor = 'texto' | 'fecha' | 'importe' | 'tienda';

export interface CampoDef {
  /** Nombre del campo en el lote que recibe la base. */
  campo: string;
  /** Nombre visible de la columna (se usa en los motivos de rechazo). */
  columna: string;
  alias: readonly string[];
  tipo: TipoValor;
  obligatorio: boolean;
  /** Largo máximo permitido por la tabla (texto). */
  max?: number;
}

const cliente: CampoDef[] = [
  { campo: 'cliente_nombre', columna: 'Cliente', alias: ['cliente', 'nombre del cliente', 'nombre cliente', 'razon social'], tipo: 'texto', obligatorio: true, max: 200 },
  { campo: 'cliente_numero', columna: 'N.º de cliente', alias: ['numero de cliente', 'nro de cliente', 'nro cliente', 'n de cliente', 'n cliente', 'cliente numero', 'cliente nro', 'id cliente', 'codigo de cliente'], tipo: 'texto', obligatorio: false, max: 40 },
];

export const MAPEO: Record<TipoHistorial, readonly CampoDef[]> = {
  comprobantes: [
    { campo: 'numero', columna: 'Comprobante', alias: ['comprobante', 'numero', 'nro', 'numero de comprobante', 'nro de comprobante', 'nro comprobante'], tipo: 'texto', obligatorio: true, max: 40 },
    { campo: 'empresa_id', columna: 'Tienda', alias: ['tienda', 'empresa', 'local', 'sucursal'], tipo: 'tienda', obligatorio: true },
    { campo: 'fecha', columna: 'Fecha', alias: ['fecha', 'fecha de emision', 'fecha emision'], tipo: 'fecha', obligatorio: true },
    ...cliente,
    { campo: 'operador', columna: 'Operador', alias: ['operador', 'vendedor', 'usuario'], tipo: 'texto', obligatorio: false, max: 120 },
    { campo: 'estado_final', columna: 'Estado final', alias: ['estado final', 'estado'], tipo: 'texto', obligatorio: true, max: 60 },
    { campo: 'total', columna: 'Total', alias: ['total', 'importe total', 'monto total'], tipo: 'importe', obligatorio: true },
  ],
  cobros: [
    { campo: 'fecha', columna: 'Fecha', alias: ['fecha', 'fecha de cobro', 'fecha cobro'], tipo: 'fecha', obligatorio: true },
    { campo: 'comprobante_numero', columna: 'Comprobante', alias: ['comprobante', 'numero de comprobante', 'nro de comprobante', 'nro comprobante', 'numero'], tipo: 'texto', obligatorio: true, max: 40 },
    { campo: 'empresa_id', columna: 'Tienda', alias: ['tienda', 'empresa', 'local', 'sucursal'], tipo: 'tienda', obligatorio: true },
    ...cliente,
    { campo: 'cuenta_cobro', columna: 'Cuenta de cobro', alias: ['cuenta de cobro', 'cuenta cobro', 'cuenta'], tipo: 'texto', obligatorio: true, max: 120 },
    { campo: 'aprobado_por', columna: 'Aprobado por', alias: ['aprobado por', 'aprobo', 'aprobador'], tipo: 'texto', obligatorio: false, max: 120 },
    { campo: 'importe', columna: 'Importe', alias: ['importe', 'monto'], tipo: 'importe', obligatorio: true },
  ],
  cotizaciones: [
    { campo: 'fecha', columna: 'Fecha', alias: ['fecha'], tipo: 'fecha', obligatorio: true },
    { campo: 'dolar_comprador', columna: 'Dólar comprador', alias: ['dolar comprador', 'comprador', 'compra', 'dolar compra'], tipo: 'importe', obligatorio: true },
    { campo: 'dolar_vendedor', columna: 'Dólar vendedor', alias: ['dolar vendedor', 'vendedor', 'venta', 'dolar venta'], tipo: 'importe', obligatorio: true },
    { campo: 'cargo', columna: 'Cargó', alias: ['cargo', 'cargado por', 'usuario'], tipo: 'texto', obligatorio: false, max: 120 },
  ],
};
