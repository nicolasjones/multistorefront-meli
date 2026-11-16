// Fixtures de importación de proveedores y vínculos (F-MIG-02, FR-024). Son
// inventados y se generan por código: ~135 proveedores (el volumen del panel
// actual) con razón social «Sintético», correos en dominios reservados (RFC 2606)
// y CUIT del rango 30-9xxxxxxx con dígito verificador calculado, para que pasen la
// validación sin parecerse a un dato real. La guarda `fixturesSinteticas.test.ts`
// lo verifica antes de que lleguen al repo.
//
// Supuesto ABIERTO (FR-024): falta confirmar que el panel actual exporta
// proveedores y vínculos a CSV/Excel. La plantilla es el contrato hasta entonces.

export type ProveedorSintetico = {
  id_externo: string
  razon_social: string
  cuit: string
  persona_contacto: string
  correo: string
  telefono: string
  direccion: string
  observaciones: string
}

export type VinculoSintetico = {
  sku: string
  proveedor_id_externo: string
  codigo_proveedor: string
}

export const CANTIDAD_PROVEEDORES_SINTETICOS = 135
export const VINCULOS_POR_PROVEEDOR = 2

// Dígito verificador módulo 11 (mismos pesos que private.cuit_valido y lib/cuit.ts).
function cuitConVerificador(base10: string): string {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = [...base10].reduce((total, digito, indice) => total + Number(digito) * pesos[indice], 0)
  const resto = suma % 11
  const digito = resto === 0 ? 0 : 11 - resto
  if (digito > 9) throw new Error(`Base de CUIT sin dígito verificador posible: ${base10}`)
  return `${base10}${digito}`
}

function generarCuit(numero: number): string {
  // Salta las bases cuyo verificador sería 10 (no existe como dígito).
  for (let candidato = numero; ; candidato += 1000) {
    try {
      return cuitConVerificador(`309${String(candidato).padStart(7, '0')}`)
    } catch {
      // siguiente candidato
    }
  }
}

const numeroDe = (n: number) => String(n).padStart(3, '0')

export const PROVEEDORES_SINTETICOS: readonly ProveedorSintetico[] = Array.from(
  { length: CANTIDAD_PROVEEDORES_SINTETICOS },
  (_, indice) => {
    const n = indice + 1
    return {
      id_externo: `SINT-PRV-${numeroDe(n)}`,
      razon_social: `Proveedor Sintético ${numeroDe(n)} S.R.L.`,
      cuit: generarCuit(n),
      persona_contacto: `Contacto de Ejemplo ${numeroDe(n)}`,
      correo: `proveedor.sintetico.${numeroDe(n)}@example.com`,
      telefono: `011-5555-${String(n).padStart(4, '0')}`,
      direccion: `Calle Inventada ${n}, Ciudad Ficticia`,
      observaciones: n % 10 === 0 ? 'Entrega, con coma y "comillas" de prueba' : '',
    }
  },
)

export const VINCULOS_SINTETICOS: readonly VinculoSintetico[] = PROVEEDORES_SINTETICOS.flatMap((proveedor, indice) =>
  Array.from({ length: VINCULOS_POR_PROVEEDOR }, (_, k) => ({
    sku: `SINT-SKU-${numeroDe(indice * VINCULOS_POR_PROVEEDOR + k + 1)}`,
    proveedor_id_externo: proveedor.id_externo,
    codigo_proveedor: `COD-${numeroDe(indice + 1)}-${k + 1}`,
  })),
)

export const ENCABEZADOS_PROVEEDORES = [
  'Identificador del panel actual',
  'Razón social',
  'CUIT',
  'Persona de contacto',
  'Correo',
  'Teléfono',
  'Dirección',
  'Observaciones',
] as const

export const ENCABEZADOS_VINCULOS = [
  'SKU del producto',
  'Identificador del proveedor en el panel actual',
  'Código del proveedor',
] as const

function celdaCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

export const CSV_PROVEEDORES_SINTETICOS = [
  ENCABEZADOS_PROVEEDORES.join(','),
  ...PROVEEDORES_SINTETICOS.map((proveedor) => [
    proveedor.id_externo,
    proveedor.razon_social,
    proveedor.cuit,
    proveedor.persona_contacto,
    proveedor.correo,
    proveedor.telefono,
    proveedor.direccion,
    proveedor.observaciones,
  ].map(celdaCsv).join(',')),
].join('\n') + '\n'

export const CSV_VINCULOS_SINTETICOS = [
  ENCABEZADOS_VINCULOS.join(','),
  ...VINCULOS_SINTETICOS.map((vinculo) => [
    vinculo.sku,
    vinculo.proveedor_id_externo,
    vinculo.codigo_proveedor,
  ].map(celdaCsv).join(',')),
].join('\n') + '\n'
