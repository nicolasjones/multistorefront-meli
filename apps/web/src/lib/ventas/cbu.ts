// CBU/CVU de las cuentas de cobro (F-VTA-03, FR-011). La autoridad es el disparador de
// dominio.cuentas_cobro (migración 20261020120100_cuentas_cobro_validacion.sql, `private.cbu_valido`);
// acá se espeja solo para avisar en el formulario antes de viajar. Mismos vectores en
// supabase/tests/database/cuentas_cobro.test.sql.

const PESOS_BLOQUE_1 = [7, 1, 3, 9, 7, 1, 3] as const
const PESOS_BLOQUE_2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const

// Acepta espacios, puntos y guiones al pegarlo; deja solo los dígitos.
export function normalizarCbu(texto: string): string {
  return texto.replace(/[\s.-]/g, '')
}

export type ResultadoCbu = { valido: true } | { valido: false; motivo: string }

// Dígito verificador de un bloque: (10 − suma mod 10) mod 10.
function verificador(digitos: string, pesos: readonly number[]): number {
  const suma = pesos.reduce((total, peso, i) => total + Number(digitos[i]) * peso, 0)
  return (10 - (suma % 10)) % 10
}

export function validarCbu(texto: string): ResultadoCbu {
  const limpio = normalizarCbu(texto)
  if (limpio === '') {
    return { valido: false, motivo: 'Ingresá el CBU o CVU.' }
  }
  if (!/^\d+$/.test(limpio)) {
    return { valido: false, motivo: 'El CBU / CVU solo admite números.' }
  }
  if (limpio.length !== 22) {
    return { valido: false, motivo: 'El CBU / CVU debe tener 22 dígitos.' }
  }
  const bloque1 = limpio.slice(0, 8)
  const bloque2 = limpio.slice(8)
  if (
    verificador(bloque1, PESOS_BLOQUE_1) !== Number(bloque1[7]) ||
    verificador(bloque2, PESOS_BLOQUE_2) !== Number(bloque2[13])
  ) {
    return { valido: false, motivo: 'El CBU / CVU no es válido: revisá los dígitos verificadores.' }
  }
  return { valido: true }
}
