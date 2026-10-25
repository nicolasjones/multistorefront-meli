// Mapeo documentado de columnas por tipo de planilla (FR-005) y normalización de valores.
// Los encabezados se comparan sin mayúsculas, tildes, espacios ni signos: «Estado final»,
// «estado_final» y «ESTADO FINAL» son la misma columna. Columnas no reconocidas se ignoran.

export type Tipo = 'comprobantes' | 'cobros' | 'cotizaciones';

export const TIPOS: readonly Tipo[] = ['comprobantes', 'cobros', 'cotizaciones'];

export type TipoCampo = 'texto' | 'fecha' | 'importe';

export interface Campo {
  clave: string;
  etiqueta: string;
  alias: string[];
  obligatorio: boolean;
  tipo: TipoCampo;
  /** Largo máximo (texto) alineado con los check de la tabla. */
  maximo?: number;
  decimales?: number;
}

const TIENDA: Campo = {
  clave: 'tienda',
  etiqueta: 'Tienda',
  alias: ['tienda', 'empresa', 'sucursal', 'local'],
  obligatorio: true,
  tipo: 'texto',
  maximo: 200,
};
const FECHA: Campo = { clave: 'fecha', etiqueta: 'Fecha', alias: ['fecha'], obligatorio: true, tipo: 'fecha' };
const CLIENTE: Campo = {
  clave: 'cliente_nombre',
  etiqueta: 'Cliente',
  alias: ['cliente', 'nombrecliente', 'nombredelcliente', 'razonsocial'],
  obligatorio: true,
  tipo: 'texto',
  maximo: 300,
};
const NUMERO_CLIENTE: Campo = {
  clave: 'cliente_numero',
  etiqueta: 'Número de cliente',
  alias: ['numerodecliente', 'numerocliente', 'nrocliente', 'nrodecliente', 'ndecliente', 'codigocliente', 'clientenumero'],
  obligatorio: false,
  tipo: 'texto',
  maximo: 100,
};

export const CAMPOS: Record<Tipo, Campo[]> = {
  comprobantes: [
    TIENDA,
    { clave: 'tipo', etiqueta: 'Tipo', alias: ['tipo', 'tipocomprobante', 'tipodecomprobante'], obligatorio: false, tipo: 'texto', maximo: 100 },
    {
      clave: 'numero',
      etiqueta: 'Comprobante',
      alias: ['comprobante', 'numero', 'nro', 'numerocomprobante', 'numerodecomprobante', 'nrocomprobante'],
      obligatorio: true,
      tipo: 'texto',
      maximo: 100,
    },
    FECHA,
    CLIENTE,
    NUMERO_CLIENTE,
    { clave: 'operador', etiqueta: 'Operador', alias: ['operador', 'vendedor', 'usuario'], obligatorio: false, tipo: 'texto', maximo: 200 },
    { clave: 'estado_final', etiqueta: 'Estado final', alias: ['estadofinal', 'estado'], obligatorio: false, tipo: 'texto', maximo: 100 },
    { clave: 'total', etiqueta: 'Total', alias: ['total', 'importetotal'], obligatorio: true, tipo: 'importe', decimales: 2 },
  ],
  cobros: [
    TIENDA,
    FECHA,
    {
      clave: 'comprobante_numero',
      etiqueta: 'Comprobante',
      alias: ['comprobante', 'numerocomprobante', 'nrocomprobante', 'numerodecomprobante'],
      obligatorio: true,
      tipo: 'texto',
      maximo: 100,
    },
    CLIENTE,
    NUMERO_CLIENTE,
    { clave: 'cuenta_cobro', etiqueta: 'Cuenta de cobro', alias: ['cuentadecobro', 'cuentacobro', 'cuenta'], obligatorio: false, tipo: 'texto', maximo: 200 },
    { clave: 'aprobado_por', etiqueta: 'Aprobado por', alias: ['aprobadopor', 'aprobador'], obligatorio: false, tipo: 'texto', maximo: 200 },
    { clave: 'importe', etiqueta: 'Importe', alias: ['importe', 'monto'], obligatorio: true, tipo: 'importe', decimales: 2 },
  ],
  cotizaciones: [
    FECHA,
    {
      clave: 'dolar_comprador',
      etiqueta: 'Dólar comprador',
      alias: ['dolarcomprador', 'comprador', 'compra'],
      obligatorio: true,
      tipo: 'importe',
      decimales: 4,
    },
    {
      clave: 'dolar_vendedor',
      etiqueta: 'Dólar vendedor',
      alias: ['dolarvendedor', 'vendedor', 'venta'],
      obligatorio: true,
      tipo: 'importe',
      decimales: 4,
    },
    { clave: 'cargado_por', etiqueta: 'Cargó', alias: ['cargo', 'cargadopor', 'usuario'], obligatorio: false, tipo: 'texto', maximo: 200 },
  ],
};

/** Minúsculas, sin tildes y solo letras/dígitos: base de la comparación de encabezados y tiendas. */
export function normalizarClave(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function esFechaReal(anio: number, mes: number, dia: number): boolean {
  if (anio < 1900 || anio > 2100 || mes < 1 || mes > 12 || dia < 1) return false;
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

function aIso(anio: number, mes: number, dia: number): string {
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** `dd/mm/aaaa` (también con `-` o `.`), `aaaa-mm-dd` o una celda de fecha de Excel. Devuelve `aaaa-mm-dd` o nulo. */
export function normalizarFecha(valor: unknown): string | null {
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    const [a, m, d] = [valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate()];
    return esFechaReal(a, m, d) ? aIso(a, m, d) : null;
  }
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(texto);
  if (iso) {
    const [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return esFechaReal(a, m, d) ? aIso(a, m, d) : null;
  }
  const latina = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})(?:\s.*)?$/.exec(texto);
  if (latina) {
    const [d, m, a] = [Number(latina[1]), Number(latina[2]), Number(latina[3])];
    return esFechaReal(a, m, d) ? aIso(a, m, d) : null;
  }
  return null;
}

/**
 * Importes con coma o punto decimal. Con ambos separadores, el último es el decimal; con uno solo,
 * una coma es siempre decimal y un punto es de miles solo si lo siguen grupos de exactamente tres
 * dígitos (`1.234` = 1234). No se interpretan signos más allá del `-` inicial.
 */
export function normalizarImporte(valor: unknown, decimales = 2): number | null {
  let numero: number;
  if (typeof valor === 'number') {
    numero = valor;
  } else if (typeof valor === 'string') {
    const limpio = valor.replace(/[\s$]|ARS|U\$S|USD/gi, '');
    if (!/^-?[\d.,]+$/.test(limpio) || !/\d/.test(limpio)) return null;
    const negativo = limpio.startsWith('-');
    const cuerpo = negativo ? limpio.slice(1) : limpio;
    const ultimaComa = cuerpo.lastIndexOf(',');
    const ultimoPunto = cuerpo.lastIndexOf('.');
    let entero: string;
    let fraccion = '';
    if (ultimaComa >= 0 && ultimoPunto >= 0) {
      const sep = Math.max(ultimaComa, ultimoPunto);
      entero = cuerpo.slice(0, sep).replace(/[.,]/g, '');
      fraccion = cuerpo.slice(sep + 1);
    } else if (ultimaComa >= 0) {
      if (cuerpo.indexOf(',') !== ultimaComa) {
        if (!/^\d{1,3}(,\d{3})+$/.test(cuerpo)) return null;
        entero = cuerpo.replace(/,/g, '');
      } else {
        entero = cuerpo.slice(0, ultimaComa);
        fraccion = cuerpo.slice(ultimaComa + 1);
      }
    } else if (ultimoPunto >= 0) {
      if (/^\d{1,3}(\.\d{3})+$/.test(cuerpo)) {
        entero = cuerpo.replace(/\./g, '');
      } else if (cuerpo.indexOf('.') === ultimoPunto) {
        entero = cuerpo.slice(0, ultimoPunto);
        fraccion = cuerpo.slice(ultimoPunto + 1);
      } else {
        return null;
      }
    } else {
      entero = cuerpo;
    }
    if (!/^\d*$/.test(entero) || !/^\d*$/.test(fraccion) || (entero === '' && fraccion === '')) return null;
    numero = Number(`${entero || '0'}.${fraccion || '0'}`);
    if (negativo) numero = -numero;
  } else {
    return null;
  }
  if (!Number.isFinite(numero) || Math.abs(numero) >= 1e12) return null;
  const factor = 10 ** decimales;
  return Math.round(numero * factor) / factor;
}
