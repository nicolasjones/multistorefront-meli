// Validación completa antes de escribir: todo o nada (FR-006). Los rechazos informan fila, columna
// y motivo, nunca el valor de la celda (puede ser un dato personal del cliente).
import { CAMPOS, normalizarClave, normalizarFecha, normalizarImporte, type Campo, type Tipo } from './campos.js';
import type { Celda, Matriz } from './lector.js';

export interface Rechazo {
  fila: number;
  columna: string;
  motivo: string;
}

export type FilaValida = Record<string, string | number | null>;

export interface Validacion {
  filas: FilaValida[];
  rechazos: Rechazo[];
  /** Hay más rechazos que los listados (se corta en `MAX_RECHAZOS`). */
  truncado: boolean;
}

export const MAX_RECHAZOS = 1000;

function vacia(celda: Celda): boolean {
  return celda === null || celda === undefined || (typeof celda === 'string' && celda.trim() === '');
}

function texto(celda: Celda): string | null {
  if (celda instanceof Date || typeof celda === 'boolean') return null;
  if (typeof celda === 'number') return Number.isFinite(celda) ? String(celda) : null;
  return typeof celda === 'string' ? celda.trim() : null;
}

function mapearColumnas(encabezado: Celda[], campos: Campo[]): Map<string, number> {
  const columnas = new Map<string, number>();
  encabezado.forEach((celda, indice) => {
    const clave = normalizarClave(celda);
    const campo = campos.find((c) => c.alias.includes(clave));
    if (campo && !columnas.has(campo.clave)) columnas.set(campo.clave, indice);
  });
  return columnas;
}

export function validarPlanilla(tipo: Tipo, matriz: Matriz, tiendas: Iterable<string>, maxFilas: number): Validacion {
  const campos = CAMPOS[tipo];
  const rechazos: Rechazo[] = [];
  const filas: FilaValida[] = [];
  let truncado = false;

  const rechazar = (fila: number, columna: string, motivo: string): void => {
    if (rechazos.length >= MAX_RECHAZOS) {
      truncado = true;
      return;
    }
    rechazos.push({ fila, columna, motivo });
  };

  if (matriz.length === 0 || matriz[0].every(vacia)) {
    rechazar(1, '(archivo)', 'El archivo está vacío o no tiene encabezados');
    return { filas, rechazos, truncado };
  }

  const columnas = mapearColumnas(matriz[0], campos);
  for (const campo of campos) {
    if (campo.obligatorio && !columnas.has(campo.clave)) rechazar(1, campo.etiqueta, 'Falta la columna obligatoria');
  }
  if (rechazos.length > 0) return { filas, rechazos, truncado };

  const datos = matriz.slice(1).filter((fila) => !fila.every(vacia));
  if (datos.length === 0) {
    rechazar(1, '(archivo)', 'El archivo no tiene filas de datos');
    return { filas, rechazos, truncado };
  }
  if (datos.length > maxFilas) {
    rechazar(1, '(archivo)', `El archivo supera el máximo de ${maxFilas} filas`);
    return { filas, rechazos, truncado };
  }

  // Clave normalizada → nombre exacto: la base compara el nombre, así que se envía el de la tienda.
  const tiendasConocidas = new Map([...tiendas].map((nombre) => [normalizarClave(nombre), nombre] as const));

  matriz.slice(1).forEach((celdas, indice) => {
    if (celdas.every(vacia)) return;
    const numeroFila = indice + 2; // 1 = encabezado; coincide con la numeración de Excel
    const fila: FilaValida = {};
    let valida = true;

    for (const campo of campos) {
      const columna = columnas.get(campo.clave);
      const celda = columna === undefined ? null : celdas[columna];
      if (vacia(celda)) {
        if (campo.obligatorio) {
          rechazar(numeroFila, campo.etiqueta, 'Valor obligatorio vacío');
          valida = false;
        } else {
          fila[campo.clave] = null;
        }
        continue;
      }
      if (campo.tipo === 'fecha') {
        const fecha = normalizarFecha(celda);
        if (fecha === null) {
          rechazar(numeroFila, campo.etiqueta, 'Fecha ilegible (se espera dd/mm/aaaa o aaaa-mm-dd)');
          valida = false;
        } else {
          fila[campo.clave] = fecha;
        }
      } else if (campo.tipo === 'importe') {
        const importe = normalizarImporte(celda, campo.decimales);
        if (importe === null) {
          rechazar(numeroFila, campo.etiqueta, 'Importe no numérico');
          valida = false;
        } else if (tipo === 'cotizaciones' && importe < 0) {
          rechazar(numeroFila, campo.etiqueta, 'La cotización no puede ser negativa');
          valida = false;
        } else {
          fila[campo.clave] = importe;
        }
      } else {
        const valor = texto(celda);
        if (valor === null || valor === '') {
          rechazar(numeroFila, campo.etiqueta, 'Texto ilegible');
          valida = false;
        } else if (campo.maximo !== undefined && valor.length > campo.maximo) {
          rechazar(numeroFila, campo.etiqueta, `Supera el largo máximo de ${campo.maximo} caracteres`);
          valida = false;
        } else if (campo.clave === 'tienda') {
          const tienda = tiendasConocidas.get(normalizarClave(valor));
          if (tienda === undefined) {
            rechazar(numeroFila, campo.etiqueta, 'La tienda no existe en la organización');
            valida = false;
          } else {
            fila[campo.clave] = tienda;
          }
        } else {
          fila[campo.clave] = valor;
        }
      }
    }
    if (valida) filas.push(fila);
  });

  return { filas, rechazos, truncado };
}
