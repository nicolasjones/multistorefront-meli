// Normalización de fechas e importes de las planillas del panel anterior (FR-005).
// Reglas documentadas en docs/historial-ventas.md.

export function normalizarClave(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fechaValida(anio: number, mes: number, dia: number): string | null {
  if (anio < 1990 || anio > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Acepta `dd/mm/aaaa` (también con `-` o `.`), ISO `aaaa-mm-dd` (con hora opcional) y número de serie de Excel. */
export function normalizarFecha(valor: string): string | null {
  const v = valor.trim();
  if (v === '') return null;

  const dma = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T].*)?$/.exec(v);
  if (dma) return fechaValida(Number(dma[3]), Number(dma[2]), Number(dma[1]));

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(v);
  if (iso) return fechaValida(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  if (/^\d+(?:\.\d+)?$/.test(v)) {
    const serie = Math.floor(Number(v));
    // 1900-03-01 = 61 (Excel cuenta mal el bisiesto de 1900); 2100-12-31 ≈ 73415.
    if (serie >= 61 && serie <= 73415) {
      const f = new Date(Date.UTC(1899, 11, 30) + serie * 86_400_000);
      return fechaValida(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
    }
  }
  return null;
}

/**
 * Importes con coma o punto decimal. Si hay ambos, el último es el decimal. Si hay uno solo, es
 * decimal cuando lo siguen 1 o 2 dígitos; si lo siguen exactamente 3 (y el resto son grupos de 3),
 * es separador de miles (`412.300` = 412300). Solo se admite el signo `-` al inicio: no se
 * inventan reglas de signo. Devuelve el importe con dos decimales o null.
 */
export function normalizarImporte(valor: string): string | null {
  let v = valor.replace(/[\s$]/g, '').replace(/^ARS/i, '').replace(/^U\$S/i, '');
  if (v === '') return null;
  let negativo = false;
  if (v.startsWith('-')) {
    negativo = true;
    v = v.slice(1);
  }
  if (!/^[\d.,]+$/.test(v) || !/\d/.test(v)) return null;

  const ultimaComa = v.lastIndexOf(',');
  const ultimoPunto = v.lastIndexOf('.');
  let entera: string;
  let decimal = '';
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    const posDecimal = Math.max(ultimaComa, ultimoPunto);
    const sepMiles = ultimaComa > ultimoPunto ? '.' : ',';
    entera = v.slice(0, posDecimal);
    decimal = v.slice(posDecimal + 1);
    if (entera.split(sepMiles).join('').match(/[.,]/)) return null;
    entera = entera.split(sepMiles).join('');
  } else if (ultimaComa >= 0 || ultimoPunto >= 0) {
    const sep = ultimaComa >= 0 ? ',' : '.';
    const partes = v.split(sep);
    const ultima = partes[partes.length - 1] as string;
    const esMiles = partes.length > 2 || (ultima.length === 3 && /^[1-9]\d{0,2}$/.test(partes[0] as string));
    if (esMiles) {
      if (partes.slice(1).some((p) => p.length !== 3)) return null;
      entera = partes.join('');
    } else {
      entera = partes[0] as string;
      decimal = ultima;
    }
  } else {
    entera = v;
  }
  if (entera === '') entera = '0';
  if (!/^\d+$/.test(entera) || (decimal !== '' && !/^\d{1,2}$/.test(decimal))) return null;
  if (entera.replace(/^0+(?=\d)/, '').length > 12) return null;

  const normalizado = `${entera.replace(/^0+(?=\d)/, '')}.${decimal.padEnd(2, '0')}`;
  return negativo && Number(normalizado) !== 0 ? `-${normalizado}` : normalizado;
}
