import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { violacionesAxe } from '../../../test/axe'
import type { DominioTienda } from '../../../lib/tiendaDominio'

const mocks = vi.hoisted(() => ({
  leer: vi.fn(),
  configurar: vi.fn(),
  verificar: vi.fn(),
  advertir: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ setWarnWhen: mocks.advertir }) }))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: {} }))
// Las secciones de F-TDA-06 que comparten la pestaña no son objeto de este archivo: se mockean (ver Publicacion.test.tsx).
vi.mock('../../../lib/tiendaBorrador', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaBorrador')>()),
  obtenerBorrador: vi.fn().mockReturnValue(new Promise(() => {})),
  leerVistaPrevia: vi.fn().mockReturnValue(new Promise(() => {})),
  listarVersiones: vi.fn().mockReturnValue(new Promise(() => {})),
}))
vi.mock('../../../lib/tiendaDominio', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaDominio')>()),
  leerDominioTienda: mocks.leer,
  configurarDominio: mocks.configurar,
  verificarDominio: mocks.verificar,
}))

import { ErrorConfigurarDominio, ErrorVerificarDominio } from '../../../lib/tiendaDominio'
import PestanaPublicacion from './pestanas/publicacion'

const haceHoras = (horas: number) => new Date(Date.now() - horas * 3_600_000).toISOString()

const VERIFICADO: DominioTienda = {
  dominioVigente: 'mundojc.com.ar',
  dominioPendiente: null,
  redireccion: 'www.mundojc.com.ar',
  dominioVerificado: true,
  certificado: 'activo',
  ultimaVerificacion: haceHoras(6),
  registros: [
    { tipo: 'A', nombre: '@', valor: '203.0.113.24', estado: 'correcto', encontrado: null },
    { tipo: 'CNAME', nombre: 'www', valor: 'stores.plataforma.app', estado: 'correcto', encontrado: null },
    { tipo: 'TXT', nombre: '_verif', valor: 'gc-verify=8f31c2', estado: 'correcto', encontrado: null },
  ],
}

const SIN_VERIFICAR: DominioTienda = {
  ...VERIFICADO,
  dominioVerificado: false,
  certificado: 'pendiente',
  ultimaVerificacion: null,
  registros: [
    { tipo: 'A', nombre: '@', valor: '203.0.113.24', estado: 'incorrecto', encontrado: '198.51.100.7' },
    { tipo: 'CNAME', nombre: 'www', valor: 'stores.plataforma.app', estado: 'pendiente', encontrado: null },
    { tipo: 'TXT', nombre: '_verif', valor: 'gc-verify=8f31c2', estado: 'pendiente', encontrado: null },
  ],
}

const SAN_JAVUCHO: DominioTienda = { ...VERIFICADO, dominioVigente: 'sanjavucho.com.ar', redireccion: null, registros: VERIFICADO.registros.filter((r) => r.tipo !== 'CNAME') }

const SIN_DOMINIO: DominioTienda = {
  dominioVigente: null, dominioPendiente: null, redireccion: null, dominioVerificado: false,
  certificado: 'pendiente', ultimaVerificacion: null, registros: [],
}

async function abrir(dominio: DominioTienda = VERIFICADO, alCambiarDominio?: () => void) {
  mocks.leer.mockResolvedValue(dominio)
  const vista = render(<MemoryRouter><PestanaPublicacion empresaId="e-1" empresaNombre="Mundo JC" alCambiarDominio={alCambiarDominio} /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Dominio' })
  await screen.findByLabelText('Dominio principal')
  return vista
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configurar.mockResolvedValue(undefined)
})

describe('Dominio · estado y tabla de registros (FR-001, FR-004, FR-005, FR-007)', () => {
  it('muestra los campos, los avisos de estado, la última verificación y la tabla Tipo/Nombre/Valor/Estado', async () => {
    await abrir()

    expect(screen.getByLabelText('Dominio principal')).toHaveValue('mundojc.com.ar')
    expect(screen.getByLabelText('Redirigir también')).toHaveValue('www.mundojc.com.ar')
    expect(screen.getByText('Dominio verificado')).toBeInTheDocument()
    expect(screen.getByText('Certificado SSL activo')).toBeInTheDocument()
    expect(screen.getByText('Última verificación hace 6 h')).toBeInTheDocument()
    const tabla = screen.getByRole('table', { name: 'Registros DNS a cargar' })
    expect(within(tabla).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['Tipo', 'Nombre', 'Valor', 'Estado'])
    expect(within(tabla).getAllByText('Correcto')).toHaveLength(3)
    expect(within(tabla).getByText('gc-verify=8f31c2')).toBeInTheDocument()
    expect(within(tabla).getByText('www')).toBeInTheDocument()
  })

  it('con registros sin cargar muestra Incorrecto con lo encontrado y Pendiente, y los avisos negativos (FR-005, FR-016)', async () => {
    await abrir(SIN_VERIFICAR)

    expect(screen.getByText('Dominio sin verificar')).toBeInTheDocument()
    expect(screen.getByText('Certificado pendiente')).toBeInTheDocument()
    expect(screen.getByText('Nunca verificado')).toBeInTheDocument()
    expect(screen.getByText('Incorrecto')).toBeInTheDocument()
    expect(screen.getByText('Encontramos: 198.51.100.7')).toBeInTheDocument()
    expect(screen.getAllByText('Pendiente')).toHaveLength(2)
  })

  it('un certificado con error se informa como tal', async () => {
    await abrir({ ...VERIFICADO, certificado: 'error' })
    expect(screen.getByText('Certificado con error')).toBeInTheDocument()
  })

  it('un dominio principal nuevo se ve como pendiente y aclara que la tienda sigue en el vigente (FR-003)', async () => {
    await abrir({ ...SIN_VERIFICAR, dominioPendiente: 'nuevo.mundojc.com.ar' })

    expect(screen.getByLabelText('Dominio principal')).toHaveValue('nuevo.mundojc.com.ar')
    expect(screen.getByText('Pendiente de verificación. Hoy la tienda responde en mundojc.com.ar.')).toBeInTheDocument()
  })

  it('sin tienda ni dominio muestra el estado vacío con el campo para cargarlo (FR-015)', async () => {
    await abrir(SIN_DOMINIO)

    expect(screen.getByText('Esta empresa todavía no tiene dominio')).toBeInTheDocument()
    expect(screen.getByLabelText('Dominio principal')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Verificar ahora' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('un error al cargar ofrece reintentar y no muestra datos', async () => {
    mocks.leer.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(VERIFICADO)
    render(<MemoryRouter><PestanaPublicacion empresaId="e-1" empresaNombre="Mundo JC" /></MemoryRouter>)

    expect(await screen.findByText('No pudimos cargar el dominio de la tienda.')).toBeInTheDocument()
    const seccion = within(screen.getByRole('region', { name: 'Dominio' }))
    fireEvent.click(seccion.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText('Dominio principal')).toHaveValue('mundojc.com.ar')
  })

  it('mientras carga muestra el estado de carga del kit', () => {
    mocks.leer.mockReturnValue(new Promise(() => {}))
    render(<MemoryRouter><PestanaPublicacion empresaId="e-1" empresaNombre="Mundo JC" /></MemoryRouter>)
    expect(screen.getAllByRole('status', { name: 'Cargando contenido' }).length).toBeGreaterThan(0)
  })
})

describe('Dominio · «Verificar ahora» (FR-006, FR-010, FR-011)', () => {
  it('muestra «Verificando registros DNS…» (rol alerta, botón deshabilitado) y luego «DNS verificado correctamente»', async () => {
    let terminar: (resultado: { dominioVerificado: boolean; certificado: 'activo' }) => void = () => {}
    mocks.verificar.mockReturnValue(new Promise((resolver) => { terminar = resolver }))
    const alCambiar = vi.fn()
    await abrir(SIN_VERIFICAR, alCambiar)

    fireEvent.click(screen.getByRole('button', { name: 'Verificar ahora' }))

    const seccion = within(screen.getByRole('region', { name: 'Dominio' }))
    expect(await seccion.findByRole('alert')).toHaveTextContent('Verificando registros DNS…')
    expect(screen.getByRole('button', { name: 'Verificar ahora' })).toBeDisabled()
    expect(mocks.verificar).toHaveBeenCalledWith('e-1')

    mocks.leer.mockResolvedValue(VERIFICADO)
    terminar({ dominioVerificado: true, certificado: 'activo' })

    expect(await screen.findByText('DNS verificado correctamente')).toBeInTheDocument()
    expect(await screen.findByText('Dominio verificado')).toBeInTheDocument()
    expect(screen.getByText('Certificado SSL activo')).toBeInTheDocument()
    expect(screen.queryByText('Verificando registros DNS…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verificar ahora' })).toBeEnabled()
    expect(alCambiar).toHaveBeenCalled()
  })

  it('con registros que no coinciden muestra el motivo y deja el dominio sin verificar', async () => {
    mocks.verificar.mockResolvedValue({ dominioVerificado: false, certificado: 'pendiente' })
    await abrir(SIN_VERIFICAR)

    fireEvent.click(screen.getByRole('button', { name: 'Verificar ahora' }))

    expect(await screen.findByText('El DNS todavía no coincide: revisá los registros marcados e intentá de nuevo.')).toBeInTheDocument()
    expect(screen.getByText('Dominio sin verificar')).toBeInTheDocument()
    expect(screen.queryByText('DNS verificado correctamente')).not.toBeInTheDocument()
  })

  it.each([
    ['demasiado_pronto', 'Esperá unos segundos antes de verificar de nuevo.'],
    ['dns_no_disponible', 'No se pudo verificar ahora, probá de nuevo.'],
    ['sin_permiso', 'No tenés permiso para verificar el dominio de esta tienda.'],
    ['otro', 'No pudimos verificar el dominio. Intentá de nuevo.'],
  ] as const)('si la verificación falla por «%s» lo informa y permite reintentar', async (motivo, texto) => {
    mocks.verificar.mockRejectedValue(new ErrorVerificarDominio(motivo))
    await abrir()

    fireEvent.click(screen.getByRole('button', { name: 'Verificar ahora' }))

    expect(await screen.findByText(texto)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verificar ahora' })).toBeEnabled()
  })

  it('con cambios sin guardar no se puede verificar (la verificación es del dominio guardado)', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Dominio principal'), { target: { value: 'otro.com.ar' } })
    expect(screen.getByRole('button', { name: 'Verificar ahora' })).toBeDisabled()
  })
})

describe('Dominio · guardar (FR-002, FR-003)', () => {
  it('valida el formato por campo antes de pedir nada', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Dominio principal'), { target: { value: 'no es un dominio' } })
    fireEvent.change(screen.getByLabelText('Redirigir también'), { target: { value: 'mundojc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dominio' }))

    expect(screen.getByLabelText('Dominio principal')).toBeInvalid()
    expect(screen.getByText('Ingresá un dominio válido, por ejemplo mitienda.com.ar.')).toBeInTheDocument()
    expect(screen.getByLabelText('Redirigir también')).toBeInvalid()
    expect(mocks.configurar).not.toHaveBeenCalled()
  })

  it('la redirección igual al principal se rechaza en el campo de redirección', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Redirigir también'), { target: { value: 'MundoJC.com.ar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dominio' }))

    expect(screen.getByLabelText('Redirigir también')).toBeInvalid()
    expect(mocks.configurar).not.toHaveBeenCalled()
  })

  it('un dominio de otra tienda muestra el error en el campo y no cambia nada', async () => {
    mocks.configurar.mockRejectedValue(new ErrorConfigurarDominio('Ese dominio ya lo usa otra tienda.', 'dominio'))
    await abrir()
    fireEvent.change(screen.getByLabelText('Dominio principal'), { target: { value: 'sanjavucho.com.ar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dominio' }))

    expect(await screen.findByText('Ese dominio ya lo usa otra tienda.')).toBeInTheDocument()
    expect(screen.getByLabelText('Dominio principal')).toBeInvalid()
    expect(screen.getByText('Dominio verificado')).toBeInTheDocument()
  })

  it('guarda un dominio nuevo, avisa que queda pendiente y refresca el encabezado', async () => {
    const alCambiar = vi.fn()
    await abrir(VERIFICADO, alCambiar)
    fireEvent.change(screen.getByLabelText('Dominio principal'), { target: { value: 'Nuevo.MundoJC.com.ar' } })
    mocks.leer.mockResolvedValue({ ...SIN_VERIFICAR, dominioPendiente: 'nuevo.mundojc.com.ar' })

    fireEvent.click(screen.getByRole('button', { name: 'Guardar dominio' }))

    await waitFor(() => expect(mocks.configurar).toHaveBeenCalledWith('e-1', 'Nuevo.MundoJC.com.ar', 'www.mundojc.com.ar'))
    expect(await screen.findByText('El dominio nuevo queda pendiente de verificación: la tienda sigue respondiendo en mundojc.com.ar hasta que se verifique.')).toBeInTheDocument()
    expect(alCambiar).toHaveBeenCalled()
    expect(screen.getByLabelText('Dominio principal')).toHaveValue('nuevo.mundojc.com.ar')
    expect(screen.getByText('Dominio sin verificar')).toBeInTheDocument()
  })

  it('la primera carga crea la tienda y muestra la tabla de registros', async () => {
    await abrir(SIN_DOMINIO)
    fireEvent.change(screen.getByLabelText('Dominio principal'), { target: { value: 'mundojc.com.ar' } })
    mocks.leer.mockResolvedValue({ ...SIN_VERIFICAR, redireccion: null, registros: SIN_VERIFICAR.registros.filter((r) => r.tipo !== 'CNAME') })

    fireEvent.click(screen.getByRole('button', { name: 'Guardar dominio' }))

    expect(await screen.findByText('Dominio guardado.')).toBeInTheDocument()
    expect(mocks.configurar).toHaveBeenCalledWith('e-1', 'mundojc.com.ar', '')
    expect(screen.getByRole('table', { name: 'Registros DNS a cargar' })).toBeInTheDocument()
  })

  it('un fallo inesperado al guardar lo informa sin perder lo escrito', async () => {
    mocks.configurar.mockRejectedValue(new Error('boom'))
    await abrir()
    fireEvent.change(screen.getByLabelText('Dominio principal'), { target: { value: 'otro.com.ar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar dominio' }))

    expect(await screen.findByText('No pudimos guardar el dominio. Intentá de nuevo.')).toBeInTheDocument()
    expect(screen.getByLabelText('Dominio principal')).toHaveValue('otro.com.ar')
  })

  it('sin cambios «Guardar dominio» está deshabilitado y con cambios avisa a la gestión (Principio VIII)', async () => {
    await abrir()
    expect(screen.getByRole('button', { name: 'Guardar dominio' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Redirigir también'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Guardar dominio' })).toBeEnabled()
    expect(mocks.advertir).toHaveBeenLastCalledWith(true)
  })
})

describe('Dominio · empresa activa (FR-018, SC-006)', () => {
  it('al cambiar de empresa recarga todo y no queda nada de la anterior, ni lo escrito sin guardar', async () => {
    const { rerender } = await abrir()
    fireEvent.change(screen.getByLabelText('Dominio principal'), { target: { value: 'sin-guardar.com.ar' } })

    mocks.leer.mockResolvedValue(SAN_JAVUCHO)
    rerender(<MemoryRouter><PestanaPublicacion empresaId="e-2" empresaNombre="San Javucho" /></MemoryRouter>)

    await waitFor(() => expect(screen.getByLabelText('Dominio principal')).toHaveValue('sanjavucho.com.ar'))
    expect(mocks.leer).toHaveBeenLastCalledWith('e-2')
    expect(screen.queryByDisplayValue('sin-guardar.com.ar')).not.toBeInTheDocument()
    expect(screen.queryByText('www.mundojc.com.ar')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Redirigir también')).toHaveValue('')
    expect(screen.getAllByText(/San Javucho/).length).toBeGreaterThan(0)
  })

  it('una respuesta tardía de la empresa anterior no pisa la actual', async () => {
    let tardia: (dominio: DominioTienda) => void = () => {}
    mocks.leer.mockReturnValueOnce(new Promise<DominioTienda>((resolver) => { tardia = resolver }))
    const { rerender } = render(<MemoryRouter><PestanaPublicacion empresaId="e-1" empresaNombre="Mundo JC" /></MemoryRouter>)

    mocks.leer.mockResolvedValueOnce(SAN_JAVUCHO)
    rerender(<MemoryRouter><PestanaPublicacion empresaId="e-2" empresaNombre="San Javucho" /></MemoryRouter>)
    await waitFor(() => expect(screen.getByLabelText('Dominio principal')).toHaveValue('sanjavucho.com.ar'))

    tardia(VERIFICADO)
    await Promise.resolve()
    expect(screen.getByLabelText('Dominio principal')).toHaveValue('sanjavucho.com.ar')
  })
})

describe.each([320, 768, 1440])('accesibilidad a %i px (FR-017, SC-011)', (ancho) => {
  it('no tiene violaciones de axe con el dominio cargado', async () => {
    window.innerWidth = ancho
    const { container } = await abrir()
    expect(await violacionesAxe(container)).toEqual([])
  })

  it('no tiene violaciones de axe en los estados negativos y vacío', async () => {
    window.innerWidth = ancho
    const { container, unmount } = await abrir(SIN_VERIFICAR)
    expect(await violacionesAxe(container)).toEqual([])
    unmount()
    const vacio = await abrir(SIN_DOMINIO)
    expect(await violacionesAxe(vacio.container)).toEqual([])
  })
})
