// Fixtures de importación de clientes (F-MIG-01, FR-012). Son inventados:
// correos en dominios reservados (RFC 2606) y documentos con un solo dígito
// repetido, para que ninguna coincidencia parezca un dato real. La guarda
// `fixturesSinteticas.test.ts` lo verifica antes de que lleguen al repo.

export type ClienteSintetico = {
  id_externo: string
  nombre: string
  documento: string
  tipo: 'Minorista' | 'Mayorista'
  correo: string
  telefono: string
  celular: string
  direccion: string
  codigo_postal: string
  localidad: string
  provincia: string
  expreso_preferido: string
}

export const CLIENTES_SINTETICOS: readonly ClienteSintetico[] = [
  {
    id_externo: 'SINT-001',
    nombre: 'Cliente Sintético Uno',
    documento: '11111111111',
    tipo: 'Mayorista',
    correo: 'cliente.sintetico.uno@example.com',
    telefono: '341-555-0001',
    celular: '341-555-1001',
    direccion: 'Calle Inventada 123',
    codigo_postal: '2000',
    localidad: 'Ciudad Ficticia',
    provincia: 'Santa Fe',
    expreso_preferido: 'Expreso de Prueba',
  },
  {
    id_externo: 'SINT-002',
    nombre: 'Cliente Sintético Dos, S.A.',
    documento: '99999999999',
    tipo: 'Minorista',
    correo: 'cliente.sintetico.dos@example.com',
    telefono: '341-555-0002',
    celular: '341-555-1002',
    direccion: 'Avenida de Ejemplo 742',
    codigo_postal: '1425',
    localidad: 'Localidad de Ejemplo',
    provincia: 'Buenos Aires',
    expreso_preferido: '',
  },
]

export const ENCABEZADOS_CLIENTES = [
  'Identificador del panel actual',
  'Nombre o razón social',
  'DNI / CUIT',
  'Tipo de cliente',
  'Correo',
  'Teléfono',
  'Celular',
  'Dirección',
  'CP',
  'Localidad',
  'Provincia',
  'Expreso preferido',
] as const

function celdaCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor
}

export const CSV_CLIENTES_SINTETICOS = [
  ENCABEZADOS_CLIENTES.join(','),
  ...CLIENTES_SINTETICOS.map((cliente) => [
    cliente.id_externo,
    cliente.nombre,
    cliente.documento,
    cliente.tipo,
    cliente.correo,
    cliente.telefono,
    cliente.celular,
    cliente.direccion,
    cliente.codigo_postal,
    cliente.localidad,
    cliente.provincia,
    cliente.expreso_preferido,
  ].map(celdaCsv).join(',')),
].join('\n') + '\n'
