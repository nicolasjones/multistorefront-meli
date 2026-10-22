// Validación completa antes de escribir (FR-006, todo o nada): convierte la tabla leída en filas
// para la base y reúne TODOS los rechazos (fila, columna, motivo). Los motivos son textos fijos:
// nunca repiten el valor de la celda, así el reporte no arrastra datos sensibles.
import type { Tabla } from './csv.js';
import { MAPEO, type CampoDef, type TipoHistorial } from './mapeo.js';
import { normalizarClave, normalizarFecha, normalizarImporte } from './normalizar.js';

export interface Empresa {
  id: string;
  nombre: string;
}

export interface Rechazo {
  /** Número de fila tal como se ve en la planilla (la cabecera es la 1). */
  fila: number;
  columna: string;
  motivo: string;
}

export type FilaImportable = Record<string, string | null>;

export interface ResultadoValidacion {
  filas: FilaImportable[];
  rechazos: Rechazo[];
  totalRechazos: number;
}

/** Tope de rechazos que se informan (el total real viaja aparte). */
const MAX_RECHAZOS_INFORMADOS = 200;
const MAX_FILAS = 200_000;

export function validarTabla(tipo: TipoHistorial, tabla: Tabla, empresas: readonly Empresa[]): ResultadoValidacion {
  const rechazos: Rechazo[] = [];
  let totalRechazos = 0;
  const rechazar = (r: Rechazo) => {
    totalRechazos += 1;
    if (rechazos.length < MAX_RECHAZOS_INFORMADOS) rechazos.push(r);
  };

  const indiceCabecera = tabla.findIndex((f) => f.some((c) => c.trim() !== ''));
  if (indiceCabecera < 0) {
    rechazar({ fila: 1, columna: '—', motivo: 'El archivo está vacío' });
    return { filas: [], rechazos, totalRechazos };
  }

  const cabecera = (tabla[indiceCabecera] as string[]).map(normalizarClave);
  const definiciones = MAPEO[tipo];
  const columnaDeCampo = new Map<string, number>();
  for (const def of definiciones) {
    const idx = cabecera.findIndex((c) => def.alias.includes(c));
    if (idx >= 0) columnaDeCampo.set(def.campo, idx);
    else if (def.obligatorio) rechazar({ fila: indiceCabecera + 1, columna: def.columna, motivo: 'Falta la columna obligatoria' });
  }
  if (totalRechazos > 0) return { filas: [], rechazos, totalRechazos };

  const empresasPorNombre = new Map(empresas.map((e) => [normalizarClave(e.nombre), e.id]));
  const cuerpo = tabla.slice(indiceCabecera + 1);
  if (cuerpo.length > MAX_FILAS) {
    rechazar({ fila: indiceCabecera + 2, columna: '—', motivo: `El archivo supera el máximo de ${MAX_FILAS} filas` });
    return { filas: [], rechazos, totalRechazos };
  }

  const filas: FilaImportable[] = [];
  cuerpo.forEach((celdas, i) => {
    if (celdas.every((c) => c.trim() === '')) return;
    const numeroFila = indiceCabecera + 2 + i;
    const fila: FilaImportable = {};
    let valida = true;
    for (const def of definiciones) {
      const idx = columnaDeCampo.get(def.campo);
      const crudo = idx === undefined ? '' : (celdas[idx] ?? '').trim();
      const resultado = convertir(def, crudo, empresasPorNombre);
      if (resultado.error) {
        rechazar({ fila: numeroFila, columna: def.columna, motivo: resultado.error });
        valida = false;
      } else {
        fila[def.campo] = resultado.valor ?? null;
      }
    }
    if (valida) filas.push(fila);
  });

  if (totalRechazos === 0 && filas.length === 0) {
    rechazar({ fila: indiceCabecera + 2, columna: '—', motivo: 'El archivo no tiene filas para importar' });
  }
  return { filas: totalRechazos > 0 ? [] : filas, rechazos, totalRechazos };
}

function convertir(
  def: CampoDef,
  crudo: string,
  empresasPorNombre: ReadonlyMap<string, string>,
): { valor: string | null; error?: undefined } | { valor?: undefined; error: string } {
  if (crudo === '') {
    if (def.obligatorio) return { error: 'Valor obligatorio vacío' };
    return { valor: def.campo === 'cliente_numero' ? null : '' };
  }
  switch (def.tipo) {
    case 'fecha': {
      const f = normalizarFecha(crudo);
      return f ? { valor: f } : { error: 'Fecha ilegible (se espera dd/mm/aaaa o aaaa-mm-dd)' };
    }
    case 'importe': {
      const n = normalizarImporte(crudo);
      return n ? { valor: n } : { error: 'Importe no numérico' };
    }
    case 'tienda': {
      const id = empresasPorNombre.get(normalizarClave(crudo));
      return id ? { valor: id } : { error: 'La tienda no existe en la organización' };
    }
    default:
      if (def.max !== undefined && crudo.length > def.max) return { error: `Texto demasiado largo (máximo ${def.max} caracteres)` };
      return { valor: crudo };
  }
}
