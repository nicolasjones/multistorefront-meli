import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('./supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }))

import {
  MAX_TECNICOS_REPARTO, aCentesimas, aDetalleComisiones, aEnvioDeReparto, aReparto, aResumenComisiones, comisionesDeTecnico,
  comisionesResumen, errorDeReparto, esMesValido, formatearPorcentaje, guardarReglaComision, guardarRepartoComision,
  listarReglasComision, mensajeDeErrorComisiones, mananaEnArgentina, mesActual, misComisiones, obtenerRepartoComision, rangoDelMes, sumaDeReparto,
} from './comisiones'

beforeEach(() => {
  mocks.rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('período del mes', () => {
  it.each([
    ['2026-11', '2026-11-01', '2026-11-30'],
    ['2026-12', '2026-12-01', '2026-12-31'],
    ['2026-02', '2026-02-01', '2026-02-28'],
    ['2028-02', '2028-02-01', '2028-02-29'],
    ['2100-02', '2100-02-01', '2100-02-28'],
    ['2000-02', '2000-02-01', '2000-02-29'],
    ['2026-01', '2026-01-01', '2026-01-31'],
  ])('rangoDelMes(%s)', (mes, desde, hasta) => {
    expect(rangoDelMes(mes)).toEqual({ desde, hasta })
  })

  it('rechaza meses que no son AAAA-MM', () => {
    for (const malo of ['', '2026-13', '2026-00', '2026-1', '26-11', '2026-11-01', 'noviembre']) {
      expect(esMesValido(malo), malo).toBe(false)
      expect(() => rangoDelMes(malo), malo).toThrow(RangeError)
    }
    expect(esMesValido('2026-01')).toBe(true)
    expect(esMesValido('2026-12')).toBe(true)
  })

  // UTC y Buenos Aires solo difieren de 00:00 a 03:00 UTC: por eso las pruebas usan instantes dentro de esa franja (un mutante a UTC solo
  // sobrevive con instantes fuera de ella; es equivalente ahí).
  it('el mes actual es el de Buenos Aires, no el de UTC', () => {
    // 2026-12-01 02:30 UTC = 2026-11-30 23:30 en Buenos Aires.
    expect(mesActual(new Date('2026-12-01T02:30:00Z'))).toBe('2026-11')
    expect(mesActual(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12')
  })
})

describe('mañana en Buenos Aires', () => {
  it.each([
    ['2026-11-26T12:00:00Z', '2026-11-27'],
    ['2026-11-30T12:00:00Z', '2026-12-01'],
    ['2026-12-31T12:00:00Z', '2027-01-01'],
    ['2028-02-28T12:00:00Z', '2028-02-29'],
    // 02:30 UTC todavía es el día anterior en Buenos Aires (UTC-3): mañana es el día UTC actual.
    ['2026-12-01T02:30:00Z', '2026-12-01'],
    ['2026-12-01T03:00:00Z', '2026-12-02'],
  ])('mananaEnArgentina(%s) = %s', (ahora, esperado) => {
    expect(mananaEnArgentina(new Date(ahora))).toBe(esperado)
  })
})

describe('porcentajes en centésimas', () => {
  it.each([
    ['100', 10000], ['33,34', 3334], ['33.34', 3334], [' 0,01 ', 1], ['5', 500], ['99,9', 9990], ['0', 0],
  ])('aCentesimas(%j) = %j', (texto, esperado) => {
    expect(aCentesimas(texto)).toBe(esperado)
  })

  it('rechaza lo que no es un número con hasta dos decimales', () => {
    for (const malo of ['', 'abc', '-1', '1,234', '1e2', '1.000', ',5', '5,', '1 0', '1234']) expect(aCentesimas(malo), malo).toBeNull()
  })

  it('la suma no arrastra errores de coma flotante (33,33 + 33,33 + 33,34 = 100)', () => {
    const lineas = [
      { tecnico_id: 'a', porcentaje: '33,33' }, { tecnico_id: 'b', porcentaje: '33,33' }, { tecnico_id: 'c', porcentaje: '33,34' },
    ]
    expect(sumaDeReparto(lineas)).toBe(100)
    expect(errorDeReparto(lineas)).toBeNull()
    expect(sumaDeReparto([{ tecnico_id: 'a', porcentaje: '0,1' }, { tecnico_id: 'b', porcentaje: '0,2' }])).toBe(0.3)
  })
})

describe('validación del reparto (espejo de la base)', () => {
  const linea = (tecnico_id: string, porcentaje: string) => ({ tecnico_id, porcentaje })
  const SUMA = 'Los porcentajes del reparto tienen que sumar 100 %'
  const PCT = 'Cada porcentaje tiene que ser mayor que 0, hasta 100 y con dos decimales como máximo'

  it('fronteras de la suma (n-1 / n / n+1) y de cada porcentaje', () => {
    expect(errorDeReparto([linea('a', '60'), linea('b', '39,99')])).toBe(SUMA)
    expect(errorDeReparto([linea('a', '60'), linea('b', '40')])).toBeNull()
    expect(errorDeReparto([linea('a', '60'), linea('b', '40,01')])).toBe(SUMA)
    expect(errorDeReparto([linea('a', '100')])).toBeNull()
    expect(errorDeReparto([linea('a', '100,01')])).toBe(PCT)
    expect(errorDeReparto([linea('a', '0,01'), linea('b', '99,99')])).toBeNull()
    expect(errorDeReparto([linea('a', '0'), linea('b', '100')])).toBe(PCT)
    expect(errorDeReparto([linea('a', '33,333'), linea('b', '66,667')])).toBe(PCT)
    expect(errorDeReparto([linea('a', 'x')])).toBe(PCT)
  })

  it('exige técnico en cada línea y sin repetirse', () => {
    expect(errorDeReparto([linea('', '100')])).toBe('Elegí un técnico en cada línea')
    expect(errorDeReparto([linea('a', '50'), linea('a', '50')])).toBe('Un técnico no puede repetirse en el reparto')
  })

  it('tope de técnicos: 10 sí, 11 no (frontera)', () => {
    const diez = Array.from({ length: MAX_TECNICOS_REPARTO }, (_, i) => linea(`t${i}`, '10'))
    expect(errorDeReparto(diez)).toBeNull()
    expect(errorDeReparto([...diez, linea('t10', '10')])).toBe('El reparto admite hasta 10 técnicos')
    expect(MAX_TECNICOS_REPARTO).toBe(10)
  })

  it('una lista vacía es válida (vuelve al reparto por defecto)', () => {
    expect(errorDeReparto([])).toBeNull()
  })

  it('arma el envío con números de dos decimales', () => {
    expect(aEnvioDeReparto([linea('a', '33,34'), linea('b', '66,66')])).toEqual([
      { tecnico_id: 'a', porcentaje: 33.34 }, { tecnico_id: 'b', porcentaje: 66.66 },
    ])
  })

  it('formatea porcentajes en es-AR', () => {
    expect(formatearPorcentaje(100)).toBe('100 %')
    expect(formatearPorcentaje(33.34)).toBe('33,34 %')
    expect(formatearPorcentaje(0.5)).toBe('0,5 %')
  })
})

describe('traducción de errores', () => {
  it('muestra el texto de validación y de duplicado de la base (castellano, sin nombres internos)', () => {
    expect(mensajeDeErrorComisiones({ code: '22023', message: 'El reparto admite hasta 10 técnicos' }, 'x')).toBe('El reparto admite hasta 10 técnicos')
    expect(mensajeDeErrorComisiones({ code: '23505', message: 'Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.' }, 'x'))
      .toBe('Ya hay una regla para ese alcance y esa fecha. Elegí otra fecha.')
  })

  it('traduce por código y nunca muestra el message crudo de otros errores', () => {
    expect(mensajeDeErrorComisiones({ code: 'PT404', message: 'secreto interno' }, 'x')).toBe('Esa reparación ya no existe. Volvé al listado.')
    expect(mensajeDeErrorComisiones({ code: 'P0002', message: 'secreto interno' }, 'x')).toBe('Esa reparación ya no existe. Volvé al listado.')
    expect(mensajeDeErrorComisiones({ code: '55000', message: 'secreto interno' }, 'x')).toBe('La reparación está anulada: no se puede cambiar el reparto.')
    expect(mensajeDeErrorComisiones({ code: 'PT409', message: 'secreto interno' }, 'x')).toBe('La reparación está anulada: no se puede cambiar el reparto.')
    expect(mensajeDeErrorComisiones({ code: '42501', message: 'secreto interno' }, 'x'))
      .toBe('No tenés permiso para esta acción. Puede que tu rol haya cambiado: recargá la página.')
    expect(mensajeDeErrorComisiones({ code: 'XX000', message: 'secreto interno' }, 'No pudimos')).toBe('No pudimos')
    expect(mensajeDeErrorComisiones(null, 'No pudimos')).toBe('No pudimos')
  })

  it('un 22023 sin mensaje cae al texto por defecto', () => {
    expect(mensajeDeErrorComisiones({ code: '22023', message: '' }, 'No pudimos')).toBe('No pudimos')
  })
})

describe('conversión de lo que devuelve la base', () => {
  it('detalle: números como números y regla nula conservada', () => {
    const d = aDetalleComisiones({
      desde: '2026-11-01', hasta: '2026-11-30', total: '3450.00', reparaciones: 3, sin_regla: 1, truncado: false,
      filas: [{ reparacion_id: 'r', codigo: 'R-0001', empresa: 'SJ', equipo: 'Switch Estándar', entrega_real: '2026-11-05', base: '15000.00', porcentaje_reparto: '100.00', porcentaje_regla: null, comision: '0' }],
    })
    expect(d.total).toBe(3450)
    expect(d.filas[0]).toMatchObject({ base: 15000, porcentaje_reparto: 100, porcentaje_regla: null, comision: 0 })
    expect(aDetalleComisiones(null)).toMatchObject({ total: 0, filas: [], truncado: false })
  })

  it('resumen y reparto', () => {
    const r = aResumenComisiones({ total: '5850', reparaciones: 4, sin_regla: 0, tecnicos: [{ tecnico_id: 'a', nombre: 'Ana', reparaciones: 2, base: '24000', comision: '2400', sin_regla: 0 }] })
    expect(r.tecnicos[0]).toMatchObject({ base: 24000, comision: 2400 })
    const p = aReparto({ reparacion_id: 'r', congelado: true, anulada: false, por_defecto: false, puede_editar: true, reparto: [{ tecnico_id: null, nombre: 'Técnico dado de baja', porcentaje: '40.00' }] })
    expect(p.reparto[0]).toEqual({ tecnico_id: null, nombre: 'Técnico dado de baja', porcentaje: 40 })
    expect(aReparto({}).puede_editar).toBe(false)
  })
})

describe('llamadas a la base', () => {
  it('pasan los parámetros con los nombres de la RPC y nunca un usuario', async () => {
    mocks.rpc.mockResolvedValue({ data: { filas: [] }, error: null })
    await misComisiones('2026-11-01', '2026-11-30')
    expect(mocks.rpc).toHaveBeenLastCalledWith('mis_comisiones', { p_desde: '2026-11-01', p_hasta: '2026-11-30' })
    await comisionesResumen('2026-11-01', '2026-11-30')
    expect(mocks.rpc).toHaveBeenLastCalledWith('comisiones_resumen', { p_desde: '2026-11-01', p_hasta: '2026-11-30' })
    await comisionesDeTecnico('t-1', '2026-11-01', '2026-11-30')
    expect(mocks.rpc).toHaveBeenLastCalledWith('comisiones_de_tecnico', { p_tecnico: 't-1', p_desde: '2026-11-01', p_hasta: '2026-11-30' })
    await guardarReglaComision(null, 12.5, '2026-11-26')
    expect(mocks.rpc).toHaveBeenLastCalledWith('guardar_regla_comision', { p_tecnico: null, p_porcentaje: 12.5, p_vigente_desde: '2026-11-26' })
    await obtenerRepartoComision('r-1')
    expect(mocks.rpc).toHaveBeenLastCalledWith('obtener_reparto_comision', { p_reparacion: 'r-1' })
    await guardarRepartoComision('r-1', [{ tecnico_id: 'a', porcentaje: 100 }], 'Ajuste')
    expect(mocks.rpc).toHaveBeenLastCalledWith('guardar_reparto_comision', { p_reparacion: 'r-1', p_reparto: [{ tecnico_id: 'a', porcentaje: 100 }], p_motivo: 'Ajuste' })
    mocks.rpc.mockResolvedValue({ data: [{ id: 'x', tecnico_id: null, tecnico: null, porcentaje: '10.00', vigente_desde: '2026-11-01', estado: 'vigente' }], error: null })
    expect(await listarReglasComision()).toEqual([{ id: 'x', tecnico_id: null, tecnico: null, porcentaje: 10, vigente_desde: '2026-11-01', estado: 'vigente' }])
    expect(mocks.rpc).toHaveBeenLastCalledWith('listar_reglas_comision')
  })

  it('lanzan el error de la base tal cual para que la pantalla lo traduzca', async () => {
    const falla = { code: '42501', message: 'Tu rol no puede ver comisiones' }
    mocks.rpc.mockResolvedValue({ data: null, error: falla })
    await expect(misComisiones('2026-11-01', '2026-11-30')).rejects.toBe(falla)
    await expect(comisionesResumen('2026-11-01', '2026-11-30')).rejects.toBe(falla)
    await expect(comisionesDeTecnico('t', '2026-11-01', '2026-11-30')).rejects.toBe(falla)
    await expect(listarReglasComision()).rejects.toBe(falla)
    await expect(guardarReglaComision(null, 1, '2026-11-01')).rejects.toBe(falla)
    await expect(obtenerRepartoComision('r')).rejects.toBe(falla)
    await expect(guardarRepartoComision('r', [], null)).rejects.toBe(falla)
  })
})
