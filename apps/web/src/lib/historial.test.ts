import { describe, expect, it, vi } from 'vitest'
import {
  MAX_BYTES_HISTORIAL,
  type ClienteHistorial,
  type EjecucionHistorial,
  leerDetalle,
  mensajeDeErrorSolicitud,
  resumenDeEjecucion,
  rutaArchivoHistorial,
  solicitarImportacionHistorial,
  validarArchivoHistorial,
} from './historial'

const archivo = (nombre: string, tipo = 'text/csv', tamano = 10) => {
  const f = new File(['x'], nombre, { type: tipo })
  Object.defineProperty(f, 'size', { value: tamano })
  return f
}

const clienteCon = (upload: ReturnType<typeof vi.fn>, rpc: ReturnType<typeof vi.fn>, remove = vi.fn()) => ({
  storage: { from: () => ({ upload, remove }) },
  rpc,
  from: vi.fn(),
}) as unknown as ClienteHistorial

const ejecucion = (parcial: Partial<EjecucionHistorial>): EjecucionHistorial => ({
  id: 'ej-1',
  estado: 'exitosa',
  motivo_sanitizado: null,
  detalle: {},
  iniciada_en: '2026-10-20T12:00:00Z',
  finalizada_en: '2026-10-20T12:01:00Z',
  ...parcial,
})

describe('validarArchivoHistorial', () => {
  it('acepta CSV y XLSX dentro del tope', () => {
    expect(validarArchivoHistorial(archivo('comprobantes.csv'))).toBeNull()
    expect(validarArchivoHistorial(archivo('cobros.XLSX', 'application/vnd.ms-excel'))).toBeNull()
    expect(validarArchivoHistorial(archivo('cotizaciones.csv', 'text/csv', MAX_BYTES_HISTORIAL))).toBeNull()
  })

  it('rechaza otros formatos con un mensaje claro', () => {
    expect(validarArchivoHistorial(archivo('historial.pdf', 'application/pdf'))).toBe('«historial.pdf» no es un archivo .csv o .xlsx.')
    expect(validarArchivoHistorial(archivo('historial'))).toContain('no es un archivo .csv o .xlsx')
  })

  it('rechaza un archivo vacío y uno mayor a 50 MB', () => {
    expect(validarArchivoHistorial(archivo('vacio.csv', 'text/csv', 0))).toBe('«vacio.csv» está vacío.')
    expect(validarArchivoHistorial(archivo('grande.csv', 'text/csv', MAX_BYTES_HISTORIAL + 1))).toBe('«grande.csv» pesa más de 50 MB.')
  })
})

describe('rutaArchivoHistorial', () => {
  it('cuelga del prefijo de la organización y conserva la extensión', () => {
    expect(rutaArchivoHistorial('org-1', archivo('planilla.csv'))).toMatch(/^org-1\/[0-9a-f-]{36}\.csv$/)
    expect(rutaArchivoHistorial('org-1', archivo('planilla.xlsx'))).toMatch(/\.xlsx$/)
  })
})

describe('mensajeDeErrorSolicitud', () => {
  it('traduce los códigos de la RPC y deja un mensaje seguro para el resto', () => {
    expect(mensajeDeErrorSolicitud('NO_AUTORIZADO: solo quien puede escribir')).toContain('Tu rol no puede importar')
    expect(mensajeDeErrorSolicitud('TIPO_INVALIDO: tipo')).toContain('tipo de importación válido')
    expect(mensajeDeErrorSolicitud('ARCHIVO_INVALIDO: falta')).toContain('Volvé a subirla')
    expect(mensajeDeErrorSolicitud('SIN_CONEXION_HISTORIAL: no hay')).toContain('no tiene habilitada')
    expect(mensajeDeErrorSolicitud('YA_EN_CURSO: ya hay')).toContain('Ya hay una importación')
    expect(mensajeDeErrorSolicitud('algo raro del servidor')).toBe('No pudimos iniciar la importación. Intentá de nuevo en unos minutos.')
    expect(mensajeDeErrorSolicitud(null)).toBe('No pudimos iniciar la importación. Intentá de nuevo en unos minutos.')
  })
})

describe('solicitarImportacionHistorial', () => {
  it('sube la planilla y devuelve la ejecución creada', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({ data: 'ej-1', error: null })
    const cliente = clienteCon(upload, rpc)
    const planilla = archivo('comprobantes.csv')

    const resultado = await solicitarImportacionHistorial(cliente, {
      organizacionId: 'org-1',
      tipo: 'comprobantes',
      archivo: planilla,
    })

    expect(resultado).toEqual({ ejecucionId: 'ej-1', ruta: resultado.ruta })
    expect(resultado.ruta).toMatch(/^org-1\/[0-9a-f-]{36}\.csv$/)
    expect(upload).toHaveBeenCalledWith(resultado.ruta, planilla, { contentType: 'text/csv', upsert: false })
    expect(rpc).toHaveBeenCalledWith('solicitar_importacion_historial', { p_tipo: 'comprobantes', p_archivo: resultado.ruta })
  })

  it('si la RPC falla, borra el archivo subido y muestra el motivo', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const remove = vi.fn().mockResolvedValue({ error: null })
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'YA_EN_CURSO: ya hay una ejecución' } })
    const cliente = clienteCon(upload, rpc, remove)

    await expect(solicitarImportacionHistorial(cliente, {
      organizacionId: 'org-1',
      tipo: 'cobros',
      archivo: archivo('cobros.csv'),
    })).rejects.toThrow('Ya hay una importación de este tipo en curso.')

    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('si la subida falla, no crea la ejecución', async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: 'bucket caído' } })
    const rpc = vi.fn()
    const cliente = clienteCon(upload, rpc)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(solicitarImportacionHistorial(cliente, {
      organizacionId: 'org-1',
      tipo: 'cotizaciones',
      archivo: archivo('cotizaciones.xlsx'),
    })).rejects.toThrow('No pudimos subir la planilla.')

    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('leerDetalle y resumenDeEjecucion', () => {
  it('descarta un detalle con forma inválida sin romper la pantalla', () => {
    expect(leerDetalle(null)).toEqual({})
    expect(leerDetalle({ nuevas: 'muchas', rechazos: [{ fila: 'dos', columna: 1, motivo: null }, { fila: 2, columna: 'fecha', motivo: 'Inválida' }] })).toEqual({
      tipo: undefined,
      total_filas: undefined,
      nuevas: undefined,
      existentes: undefined,
      total_rechazos: undefined,
      rechazos_truncados: undefined,
      rechazos: [{ fila: 2, columna: 'fecha', motivo: 'Inválida' }],
    })
  })

  it('resume una importación exitosa con nuevos y existentes', () => {
    const resumen = resumenDeEjecucion(ejecucion({ detalle: { nuevas: 12, existentes: 3 } }))
    expect(resumen.severidad).toBe('success')
    expect(resumen.titulo).toBe('Importación completada')
    expect(resumen.descripcion).toBe('Se importaron 12 registros nuevos. 3 ya existían y no se duplicaron.')
  })

  it('resume una importación fallida con total y filas rechazadas', () => {
    const resumen = resumenDeEjecucion(ejecucion({
      estado: 'fallida',
      detalle: { total_rechazos: 37, rechazos_truncados: true, rechazos: [{ fila: 2, columna: 'fecha', motivo: 'Fecha inválida' }] },
    }))
    expect(resumen.severidad).toBe('error')
    expect(resumen.titulo).toBe('La importación no se aplicó')
    expect(resumen.descripcion).toContain('37 filas rechazadas')
    expect(resumen.rechazos).toHaveLength(1)
    expect(resumen.rechazosTruncados).toBe(true)
  })

  it('distingue en curso, timeout y una falla sin detalle', () => {
    expect(resumenDeEjecucion(ejecucion({ estado: 'en_curso', finalizada_en: null })).titulo).toBe('Importación en curso')
    expect(resumenDeEjecucion(ejecucion({ estado: 'timeout' })).titulo).toBe('La importación no terminó a tiempo')
    expect(resumenDeEjecucion(ejecucion({ estado: 'fallida', detalle: {} })).descripcion).toContain('Revisá el detalle en Ejecuciones')
  })
})
