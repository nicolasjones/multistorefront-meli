import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTIDAD_BASE, type IdentidadTienda } from '../../../lib/tiendaIdentidad'
import { violacionesAxe } from '../../../test/axe'

const mocks = vi.hoisted(() => ({
  leer: vi.fn(),
  guardar: vi.fn(),
  subir: vi.fn(),
  borrar: vi.fn(),
  advertir: vi.fn(),
}))

vi.mock('@refinedev/core', () => ({ useWarnAboutChange: () => ({ setWarnWhen: mocks.advertir }) }))
vi.mock('../../../lib/supabase', () => ({ supabaseClient: {} }))
vi.mock('../../../lib/tiendaIdentidad', async (original) => ({
  ...(await original<typeof import('../../../lib/tiendaIdentidad')>()),
  leerIdentidadDeEmpresa: mocks.leer,
  guardarIdentidad: mocks.guardar,
  subirImagen: mocks.subir,
  borrarImagenes: mocks.borrar,
  urlPublica: (ruta: string | null) => (ruta ? `https://cdn.test/${ruta}` : null),
}))

import PestanaIdentidad from './pestanas/identidad'

const MUNDO_JC: IdentidadTienda = {
  colorPrimario: '#A3111D',
  colorPrimarioOscuro: '#7A0A12',
  colorAcento: '#A3111D',
  colorFondo: '#FFFFFF',
  tipografiaTitulos: 'Barlow Condensed',
  tipografiaTexto: 'Barlow',
  logoRuta: 'org-1/e-1/logo-viejo.png',
  bannerRuta: 'org-1/e-1/banner-viejo.png',
  bannerMovilRuta: null,
}
const SAN_JAVUCHO: IdentidadTienda = { ...IDENTIDAD_BASE, colorPrimario: '#2E6B3F', tipografiaTitulos: 'Playfair Display', tipografiaTexto: 'Lato' }

const archivo = (nombre: string, tipo: string, contenido = 'x') => new File([contenido], nombre, { type: tipo })

function elegir(clave: 'logo' | 'banner' | 'bannerMovil', f: File) {
  fireEvent.change(screen.getByTestId(`archivo-${clave}`), { target: { files: [f] } })
}

async function abrir(identidad = MUNDO_JC) {
  mocks.leer.mockResolvedValue({ organizacionId: 'org-1', identidad })
  const vista = render(<PestanaIdentidad empresaId="e-1" empresaNombre="Mundo JC" />)
  await screen.findByRole('heading', { name: 'Colores' })
  return vista
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.borrar.mockResolvedValue(undefined)
})

describe('Identidad visual · carga y estado inicial', () => {
  it('muestra los colores, tipografías y el logo actual de la empresa (FR-020, FR-021)', async () => {
    await abrir()
    expect(screen.getByLabelText('Primario')).toHaveValue('#A3111D')
    expect(screen.getByLabelText('Primario oscuro')).toHaveValue('#7A0A12')
    expect(screen.getByLabelText('Acento')).toHaveValue('#A3111D')
    expect(screen.getByLabelText('Fondo')).toHaveValue('#FFFFFF')
    expect(screen.getByText('Logo actual de Mundo JC.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reemplazar logo/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Quitar logo/ })).toBeInTheDocument()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('muestra las medidas sugeridas de los banners (FR-025)', async () => {
    await abrir()
    expect(screen.getByRole('heading', { name: 'Banner principal (1440×440)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Banner móvil (390×300)' })).toBeInTheDocument()
  })

  it('si la carga falla ofrece reintentar y no deja el formulario a medias', async () => {
    mocks.leer.mockRejectedValueOnce(new Error('sin red'))
    render(<PestanaIdentidad empresaId="e-1" empresaNombre="Mundo JC" />)
    expect(await screen.findByText('No pudimos cargar la identidad visual.')).toBeInTheDocument()
    mocks.leer.mockResolvedValue({ organizacionId: 'org-1', identidad: MUNDO_JC })
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Colores' })).toBeInTheDocument()
  })
})

describe('Identidad visual · accesibilidad (Principio VI)', () => {
  it('no tiene violaciones axe con el formulario cargado y con un error de archivo', async () => {
    const { container } = await abrir()
    expect(await violacionesAxe(container)).toEqual([])
    elegir('logo', archivo('logo.gif', 'image/gif'))
    await screen.findByRole('alert')
    expect(await violacionesAxe(container)).toEqual([])
  })
})

describe('Identidad visual · colores y contraste (FR-022, FR-023)', () => {
  it('con contraste AA informa el valor; sin AA advierte y NO bloquea guardar', async () => {
    await abrir()
    expect(screen.getByText(/Contraste de texto blanco sobre el primario: \d,\d:1 \(AA\)\./)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Primario'), { target: { value: '#FFEB3B' } })
    expect(screen.getByText(/No cumple AA/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('un color inválido muestra el error del campo y Guardar no llama a la base', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Acento'), { target: { value: 'rojo' } })
    expect(screen.getByText('Usá el formato #RRGGBB, por ejemplo #A3111D.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Revisá los colores marcados: usá el formato #RRGGBB.')).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
    expect(mocks.subir).not.toHaveBeenCalled()
  })
})

describe('Identidad visual · archivos (FR-021, FR-025, FR-026)', () => {
  it('un formato no admitido muestra el error y conserva el logo actual', async () => {
    await abrir()
    elegir('logo', archivo('logo.gif', 'image/gif'))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('no es un formato admitido')
    expect(alerta).toHaveTextContent('Se conserva la imagen actual.')
    expect(screen.getByText('Logo actual de Mundo JC.')).toBeInTheDocument()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('un archivo demasiado grande se rechaza con el máximo y no cambia nada', async () => {
    await abrir()
    elegir('banner', archivo('b.png', 'image/png', 'x'.repeat(3 * 1024 * 1024 + 1)))
    expect(await screen.findByText(/supera el máximo de 3 MB\. Se conserva la imagen actual\./)).toBeInTheDocument()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('un SVG con script o eventos se rechaza (SC-005)', async () => {
    await abrir()
    elegir('logo', archivo('malo.svg', 'image/svg+xml', '<svg onload="alert(1)"></svg>'))
    expect(await screen.findByText(/contiene código/)).toBeInTheDocument()
    expect(mocks.subir).not.toHaveBeenCalled()
  })

  it('elegir un archivo válido solo marca cambios: no sube ni guarda hasta «Guardar»', async () => {
    await abrir()
    elegir('banner', archivo('nuevo.webp', 'image/webp'))
    expect(await screen.findByText('Hay cambios sin guardar.')).toBeInTheDocument()
    expect(mocks.subir).not.toHaveBeenCalled()
    expect(mocks.guardar).not.toHaveBeenCalled()
    expect(mocks.advertir).toHaveBeenLastCalledWith(true)
  })

  it('«Quitar» saca el logo y «Descartar» lo restaura', async () => {
    await abrir()
    fireEvent.click(screen.getByRole('button', { name: /Quitar logo/ }))
    expect(screen.queryByText('Logo actual de Mundo JC.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Subir logo/ })).toBeInTheDocument()
    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByText('Logo actual de Mundo JC.')).toBeInTheDocument()
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
  })
})

describe('Identidad visual · vista previa en vivo (FR-027)', () => {
  it('refleja los valores sin guardar y no escribe nada', async () => {
    await abrir()
    expect(screen.getByTestId('vista-previa-banner')).toHaveStyle({ backgroundColor: 'rgb(122, 10, 18)' })

    fireEvent.change(screen.getByLabelText('Primario oscuro'), { target: { value: '#0A7D32' } })
    expect(screen.getByTestId('vista-previa-banner')).toHaveStyle({ backgroundColor: 'rgb(10, 125, 50)' })
    expect(within(screen.getByTestId('vista-previa')).getAllByText('Producto de ejemplo')).toHaveLength(3)
    expect(screen.getByText('Se actualiza con tus cambios sin guardar.')).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
    expect(mocks.subir).not.toHaveBeenCalled()
  })

  it('cambiar la tipografía la muestra en la muestra y marca cambios', async () => {
    await abrir()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Títulos' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Lato' }))
    expect(screen.getByText('Todo para tu consola', { selector: 'p' })).toHaveStyle({ fontFamily: '"Lato", system-ui, sans-serif' })
    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument()
  })
})

describe('Identidad visual · Guardar y Descartar (FR-028)', () => {
  it('Guardar sube los archivos nuevos, llama a la RPC con colores en mayúsculas y limpia el logo reemplazado', async () => {
    mocks.subir.mockResolvedValue(undefined)
    mocks.guardar.mockImplementation(async (_empresa: string, identidad: IdentidadTienda) => identidad)
    await abrir()

    elegir('logo', archivo('nuevo.png', 'image/png'))
    fireEvent.change(screen.getByLabelText('Primario'), { target: { value: '#c8102e' } })
    await screen.findByText('Hay cambios sin guardar.')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Cambios guardados: la tienda ya los muestra.')).toBeInTheDocument()
    expect(mocks.subir).toHaveBeenCalledTimes(1)
    const rutaNueva = mocks.subir.mock.calls[0][0] as string
    expect(rutaNueva).toMatch(/^org-1\/e-1\/logo-[0-9a-f-]{36}\.png$/)
    expect(mocks.guardar).toHaveBeenCalledWith('e-1', expect.objectContaining({ colorPrimario: '#C8102E', logoRuta: rutaNueva, bannerRuta: 'org-1/e-1/banner-viejo.png' }))
    expect(mocks.borrar).toHaveBeenCalledWith(['org-1/e-1/logo-viejo.png'])
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })

  it('si falla la subida no guarda nada y conserva la imagen anterior (FR-026)', async () => {
    mocks.subir.mockRejectedValue(new Error('network'))
    await abrir()
    elegir('banner', archivo('nuevo.jpg', 'image/jpeg'))
    await screen.findByText('Hay cambios sin guardar.')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText(/No pudimos subir el banner principal\./)).toBeInTheDocument()
    expect(mocks.guardar).not.toHaveBeenCalled()
    expect(screen.queryByText('Cambios guardados: la tienda ya los muestra.')).not.toBeInTheDocument()
    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument()
  })

  it('si la RPC falla borra lo recién subido y muestra el motivo', async () => {
    mocks.subir.mockResolvedValue(undefined)
    mocks.guardar.mockRejectedValue(new Error('Tu rol no puede editar la identidad de la tienda'))
    await abrir()
    elegir('bannerMovil', archivo('m.png', 'image/png'))
    await screen.findByText('Hay cambios sin guardar.')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('No pudimos guardar los cambios: Tu rol no puede editar la identidad de la tienda')).toBeInTheDocument()
    expect(mocks.borrar).toHaveBeenCalledWith([expect.stringMatching(/^org-1\/e-1\/banner-movil-/)])
  })

  it('si la RPC guardó pero la respuesta se perdió, no borra lo que la base ya referencia', async () => {
    mocks.subir.mockResolvedValue(undefined)
    mocks.guardar.mockRejectedValue(new Error('Failed to fetch'))
    await abrir()
    elegir('bannerMovil', archivo('m.png', 'image/png'))
    await screen.findByText('Hay cambios sin guardar.')
    mocks.subir.mockImplementation(async (r: string) => {
      mocks.leer.mockResolvedValue({ organizacionId: 'org-1', identidad: { ...MUNDO_JC, bannerMovilRuta: r } })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('No pudimos guardar los cambios: Failed to fetch')).toBeInTheDocument()
    expect(mocks.borrar).toHaveBeenCalledWith([])
  })

  it('si la RPC falla y no se puede releer la identidad, conserva lo subido (un huérfano no rompe nada)', async () => {
    mocks.subir.mockResolvedValue(undefined)
    mocks.guardar.mockRejectedValue(new Error('Failed to fetch'))
    await abrir()
    mocks.leer.mockRejectedValue(new Error('sin red'))
    elegir('bannerMovil', archivo('m.png', 'image/png'))
    await screen.findByText('Hay cambios sin guardar.')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('No pudimos guardar los cambios: Failed to fetch')).toBeInTheDocument()
    expect(mocks.borrar).not.toHaveBeenCalled()
  })

  it('Descartar vuelve al último valor guardado', async () => {
    await abrir()
    fireEvent.change(screen.getByLabelText('Fondo'), { target: { value: '#000000' } })
    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByLabelText('Fondo')).toHaveValue('#FFFFFF')
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
  })
})

describe('Identidad visual · empresa activa (Principio VIII)', () => {
  it('al cambiar de empresa recarga y no deja valores de la anterior', async () => {
    mocks.leer.mockImplementation(async (id: string) => (id === 'e-1'
      ? { organizacionId: 'org-1', identidad: MUNDO_JC }
      : { organizacionId: 'org-1', identidad: SAN_JAVUCHO }))
    const { rerender } = render(<PestanaIdentidad empresaId="e-1" empresaNombre="Mundo JC" />)
    await screen.findByRole('heading', { name: 'Colores' })
    fireEvent.change(screen.getByLabelText('Acento'), { target: { value: '#000000' } })
    expect(screen.getByText('Hay cambios sin guardar.')).toBeInTheDocument()

    rerender(<PestanaIdentidad empresaId="e-2" empresaNombre="San Javucho" />)
    await waitFor(() => expect(mocks.leer).toHaveBeenCalledWith('e-2'))
    await waitFor(() => expect(screen.getByLabelText('Primario')).toHaveValue('#2E6B3F'))
    expect(screen.getByLabelText('Acento')).toHaveValue('#222222')
    expect(screen.queryByText('Hay cambios sin guardar.')).not.toBeInTheDocument()
    expect(screen.queryByText('Logo actual de Mundo JC.')).not.toBeInTheDocument()
  })
})
