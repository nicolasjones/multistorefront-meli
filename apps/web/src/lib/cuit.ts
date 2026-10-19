// CUIT de proveedores (F-PRV-01, FR-002/FR-007). La autoridad es el disparador de
// dominio.proveedores (migración 20261018190001_proveedores_tabla.sql, `private.cuit_valido`);
// acá se espeja solo para avisar en el formulario antes de viajar. Mismos vectores en
// supabase/tests/database/proveedores.test.sql.

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const

// Acepta espacios, puntos y guiones al pegarlo; deja solo los dígitos.
export function normalizarCuit(texto: string): string {
  return texto.replace(/[\s.-]/g, '')
}

export type ResultadoCuit = { valido: true } | { valido: false; motivo: string }

export function validarCuit(texto: string): ResultadoCuit {
  const limpio = normalizarCuit(texto)
  if (limpio === '') {
    return { valido: false, motivo: 'Ingresá el CUIT.' }
  }
  if (!/^\d+$/.test(limpio)) {
    return { valido: false, motivo: 'El CUIT solo admite números (con o sin guiones).' }
  }
  if (limpio.length !== 11) {
    return { valido: false, motivo: 'El CUIT debe tener 11 dígitos.' }
  }
  const suma = PESOS.reduce((total, peso, i) => total + Number(limpio[i]) * peso, 0)
  const resto = suma % 11
  const digito = resto === 0 ? 0 : 11 - resto
  // Resto 1 daría el dígito 10: no existe como dígito, el CUIT es inválido.
  if (digito > 9 || digito !== Number(limpio[10])) {
    return { valido: false, motivo: 'El CUIT no es válido: revisá el dígito verificador.' }
  }
  return { valido: true }
}

// `XX-XXXXXXXX-X` para mostrar; si no tiene 11 dígitos se devuelve tal cual (sin inventar).
export function formatearCuit(texto: string | null | undefined): string {
  const limpio = normalizarCuit(texto ?? '')
  if (!/^\d{11}$/.test(limpio)) {
    return texto ?? ''
  }
  return `${limpio.slice(0, 2)}-${limpio.slice(2, 10)}-${limpio.slice(10)}`
}
