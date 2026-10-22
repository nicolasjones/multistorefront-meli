import { describe, expect, it } from 'vitest'
import { extensionPermitida, mensajeDeErrorImportacion, rutaDeSubida, TAMANO_MAXIMO_ARCHIVO, validarArchivo } from './historial'

describe('historial', () => {
  it('solo admite .csv y .xlsx', () => {
    expect(extensionPermitida('Ventas 2023.CSV')).toBe('csv')
    expect(extensionPermitida('x.xlsx')).toBe('xlsx')
    expect(extensionPermitida('x.xls')).toBeNull()
    expect(extensionPermitida('sin-extension')).toBeNull()
  })

  it('valida extensión, vacío y tamaño máximo', () => {
    expect(validarArchivo({ name: 'a.csv', size: 10 })).toBeNull()
    expect(validarArchivo({ name: 'a.pdf', size: 10 })).toMatch(/\.csv o \.xlsx/)
    expect(validarArchivo({ name: 'a.csv', size: 0 })).toMatch(/vacío/)
    expect(validarArchivo({ name: 'a.csv', size: TAMANO_MAXIMO_ARCHIVO + 1 })).toMatch(/50 MB/)
  })

  it('arma la ruta en la carpeta de la organización y sanea el nombre', () => {
    const ruta = rutaDeSubida('org-1', 'cobros', '../Cobros ñandú (2023).xlsx', new Date('2026-10-22T10:20:30.000Z'))
    expect(ruta).toBe('org-1/cobros/20261022T102030-Cobros-nandu-2023.xlsx')
    expect(ruta).not.toContain('..')
  })

  it('traduce los errores de la RPC a mensajes claros', () => {
    expect(mensajeDeErrorImportacion({ message: 'YA_EN_CURSO: ya hay una importación' })).toMatch(/en curso/)
    expect(mensajeDeErrorImportacion({ message: 'NO_AUTORIZADO: x' })).toMatch(/permiso/)
  })
})
