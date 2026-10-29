import { describe, expect, it } from 'vitest'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import ProductionQuantityLimitsIcon from '@mui/icons-material/ProductionQuantityLimits'
import { panelFixtures } from '../../test/fixtures/panel'
import type { PermisoSeccion } from '../../lib/permisos'
import { SECCION_POR_RECURSO } from '../../lib/permisos'
import { DESTINOS_PANEL, SECCIONES_PANEL, destinoVisible } from './destinosPanel'

const sinAcciones = { eliminar: false, exportar: false, ver_costos: false }
const permisos = (...filas: [string, PermisoSeccion['nivel']][]): PermisoSeccion[] =>
  filas.map(([seccion, nivel]) => ({ seccion, nivel, ...sinAcciones }))

const destino = (id: string) => {
  const encontrado = DESTINOS_PANEL.find((d) => d.id === id)
  if (!encontrado) throw new Error(`destino ${id} no existe`)
  return encontrado
}

describe('destinoVisible con permisos por sección (F-ROL-01, FR-005)', () => {
  it('oculta del menú la sección sin acceso', () => {
    const p = permisos(['inicio', 'lectura'], ['clientes', 'ninguno'])
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, p)).toBe(false)
    expect(destinoVisible(destino('inicio'), panelFixtures.miembro, p)).toBe(true)
  })

  it('muestra la sección en solo lectura y en edición', () => {
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, permisos(['clientes', 'lectura']))).toBe(true)
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, permisos(['clientes', 'edicion']))).toBe(true)
  })

  it('una sección sin fila se trata como sin acceso (nunca acceso total por omisión)', () => {
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, [])).toBe(false)
  })

  it('un destino sin sección de la matriz (Empresas) no depende de los permisos', () => {
    expect(destinoVisible(destino('empresas'), panelFixtures.administrador, [])).toBe(true)
  })

  it('sin permisos cargados no filtra (compatibilidad sin PermisosPanelProvider)', () => {
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro)).toBe(true)
    expect(destinoVisible(destino('clientes'), panelFixtures.miembro, null)).toBe(true)
  })

  it('la audiencia sigue mandando: Miembros exige administrador aunque la matriz dé acceso', () => {
    const p = permisos(['usuarios_permisos', 'edicion'])
    expect(destinoVisible(destino('usuarios'), panelFixtures.miembro, p)).toBe(false)
    expect(destinoVisible(destino('usuarios'), panelFixtures.administrador, p)).toBe(true)
  })

  it('un administrador sin acceso a Usuarios y permisos no ve Miembros', () => {
    expect(destinoVisible(destino('usuarios'), panelFixtures.administrador, permisos(['usuarios_permisos', 'ninguno']))).toBe(false)
  })

  it('un superadmin sin organización activa no queda filtrado por la matriz', () => {
    expect(destinoVisible(destino('inicio'), panelFixtures.superadmin, [])).toBe(true)
  })
})

describe('destino Actividad por nivel de la sección (F-AUD-01, FR-005, FR-008)', () => {
  it('lo ven quienes tienen lectura o edición, también sin ser administradores', () => {
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'lectura']))).toBe(true)
    expect(destinoVisible(destino('actividad'), panelFixtures.administrador, permisos(['actividad', 'edicion']))).toBe(true)
  })

  it('no aparece en el menú con nivel ninguno ni sin fila en la matriz', () => {
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'ninguno']))).toBe(false)
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, [])).toBe(false)
  })

  it('sigue a la matriz: el mismo usuario lo gana o lo pierde sin tocar código', () => {
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'ninguno']))).toBe(false)
    expect(destinoVisible(destino('actividad'), panelFixtures.miembro, permisos(['actividad', 'lectura']))).toBe(true)
  })

  it('apunta a /actividad y la ruta del recurso usa la sección «actividad»', () => {
    expect(destino('actividad').ruta).toBe('/actividad')
    expect(SECCION_POR_RECURSO.actividad).toBe('actividad')
  })
})

describe('coherencia menú ↔ rutas (F-ROL-01)', () => {
  it('cada recurso de SECCION_POR_RECURSO con destino de menú usa la misma sección', () => {
    for (const [recurso, seccion] of Object.entries(SECCION_POR_RECURSO)) {
      // Los recursos de Service técnico cuelgan de /service-tecnico/<pantalla>.
      // Los de Ventas, de /ventas/<pantalla> (F-VTA-05), con el destino «Ventas».
      const ruta = recurso.startsWith('service-tecnico-')
        ? `/service-tecnico/${recurso.replace('service-tecnico-', '')}`
        : recurso.startsWith('ventas-')
          ? '/ventas/comprobantes'
          : `/${recurso}`
      const d = DESTINOS_PANEL.find((x) => x.ruta === ruta)
      expect(d, `destino para ${recurso}`).toBeDefined()
      expect(d?.seccionPermiso).toBe(seccion)
    }
  })
})

describe('destino «Correo masivo» (F-CLI-11)', () => {
  it('cuelga de Contactos, apunta a /clientes/correo-masivo y sigue la sección clientes de la matriz', () => {
    const correo = destino('correo-masivo')
    expect(correo.ruta).toBe('/clientes/correo-masivo')
    expect(correo.seccionPermiso).toBe('clientes')
    expect(seccionDe('correo-masivo')).toBe('contactos')
    expect(destinoVisible(correo, panelFixtures.miembro, permisos(['clientes', 'edicion']))).toBe(true)
    expect(destinoVisible(correo, panelFixtures.miembro, permisos(['clientes', 'ninguno']))).toBe(false)
  })
})

describe('destino «Productos» (F-CAT-02)', () => {
  it('apunta a /productos, pertenece a la sección productos y respeta la matriz', () => {
    const productos = destino('productos')
    expect(productos.ruta).toBe('/productos')
    expect(productos.seccionPermiso).toBe('productos')
    expect(SECCION_POR_RECURSO.productos).toBe('productos')
    expect(destinoVisible(productos, panelFixtures.miembro, permisos(['productos', 'edicion']))).toBe(true)
    expect(destinoVisible(productos, panelFixtures.miembro, permisos(['productos', 'ninguno']))).toBe(false)
    expect(destinoVisible(productos, panelFixtures.miembro, [])).toBe(false)
  })
})

describe('destino «Proveedores» (F-PRV-02, FR-012)', () => {
  it('apunta a /proveedores, usa la sección proveedores y respeta la matriz', () => {
    const proveedores = destino('proveedores')
    expect(proveedores.ruta).toBe('/proveedores')
    expect(proveedores.seccionPermiso).toBe('proveedores')
    expect(SECCION_POR_RECURSO.proveedores).toBe('proveedores')
    expect(destinoVisible(proveedores, panelFixtures.miembro, permisos(['proveedores', 'lectura']))).toBe(true)
    expect(destinoVisible(proveedores, panelFixtures.miembro, permisos(['proveedores', 'edicion']))).toBe(true)
    expect(destinoVisible(proveedores, panelFixtures.miembro, permisos(['proveedores', 'ninguno']))).toBe(false)
    expect(destinoVisible(proveedores, panelFixtures.miembro, [])).toBe(false)
  })
})


describe('destino «Consultas» (F-CON-01, FR-005)', () => {
  it('es el primer destino de Canales y apunta a /consultas', () => {
    const consultas = destino('consultas')
    expect(consultas.ruta).toBe('/consultas')
    expect(consultas.seccionPermiso).toBe('consultas')
    expect(SECCION_POR_RECURSO.consultas).toBe('consultas')
    const canales = SECCIONES_PANEL.find((seccion) => seccion.id === 'canales')
    expect(canales?.destinos[0]?.id).toBe('consultas')
    expect(canales?.destinos.map((d) => d.id)).toContain('empresas')
  })

  it('lleva el contador de nuevas y queda visible con lectura o edición, nunca sin permiso', () => {
    const consultas = destino('consultas')
    expect(consultas.insignia).toBe('consultas_nuevas')
    expect(destinoVisible(consultas, panelFixtures.miembro, permisos(['consultas', 'lectura']))).toBe(true)
    expect(destinoVisible(consultas, panelFixtures.miembro, permisos(['consultas', 'edicion']))).toBe(true)
    expect(destinoVisible(consultas, panelFixtures.miembro, permisos(['consultas', 'ninguno']))).toBe(false)
    expect(destinoVisible(consultas, panelFixtures.miembro, [])).toBe(false)
  })
})

describe('destino «Despacho» (F-VTA-17, FR-032)', () => {
  it('está en el grupo Ventas, apunta a /ventas/despacho y usa el icono de camión', () => {
    const despacho = destino('ventas-despacho')
    expect(despacho.ruta).toBe('/ventas/despacho')
    expect(despacho.etiqueta).toBe('Despacho')
    expect(despacho.seccionPermiso).toBe('ventas')
    expect(despacho.icono).toBe(LocalShippingIcon)
    const ventas = SECCIONES_PANEL.find((seccion) => seccion.id === 'ventas')
    expect(ventas?.destinos.map((d) => d.id)).toContain('ventas-despacho')
  })

  it('lo ven quienes tienen Ventas en lectura o edición, nunca sin acceso', () => {
    const despacho = destino('ventas-despacho')
    expect(destinoVisible(despacho, panelFixtures.miembro, permisos(['ventas', 'lectura']))).toBe(true)
    expect(destinoVisible(despacho, panelFixtures.miembro, permisos(['ventas', 'edicion']))).toBe(true)
    expect(destinoVisible(despacho, panelFixtures.miembro, permisos(['ventas', 'ninguno']))).toBe(false)
    expect(destinoVisible(despacho, panelFixtures.miembro, [])).toBe(false)
  })
})

describe('destino «Faltantes» (F-VTA-18, FR-045)', () => {
  it('está en el grupo Ventas, apunta a /ventas/faltantes y usa el icono de producción', () => {
    const faltantes = destino('ventas-faltantes')
    expect(faltantes.ruta).toBe('/ventas/faltantes')
    expect(faltantes.etiqueta).toBe('Faltantes')
    expect(faltantes.seccionPermiso).toBe('ventas')
    expect(faltantes.icono).toBe(ProductionQuantityLimitsIcon)
    const ventas = SECCIONES_PANEL.find((seccion) => seccion.id === 'ventas')
    expect(ventas?.destinos.map((d) => d.id)).toContain('ventas-faltantes')
  })

  it('lo ven quienes tienen Ventas en lectura o edición, nunca sin acceso', () => {
    const faltantes = destino('ventas-faltantes')
    expect(destinoVisible(faltantes, panelFixtures.miembro, permisos(['ventas', 'lectura']))).toBe(true)
    expect(destinoVisible(faltantes, panelFixtures.miembro, permisos(['ventas', 'edicion']))).toBe(true)
    expect(destinoVisible(faltantes, panelFixtures.miembro, permisos(['ventas', 'ninguno']))).toBe(false)
    expect(destinoVisible(faltantes, panelFixtures.miembro, [])).toBe(false)
  })
})

describe('navegación por secciones (decisión 2026-10-21)', () => {
  const seccionDe = (id: string) => SECCIONES_PANEL.find((seccion) => seccion.destinos.some((d) => d.id === id))?.id

  it('agrupa Clientes y Proveedores en Contactos', () => {
    expect(seccionDe('clientes')).toBe('contactos')
    expect(seccionDe('proveedores')).toBe('contactos')
  })

  it('agrupa Empresas en Canales', () => {
    expect(seccionDe('empresas')).toBe('canales')
  })

  it('agrupa Reparaciones, Modelos y Estados de reparación en Servicio técnico', () => {
    expect(seccionDe('service-tecnico-reparaciones')).toBe('service')
    expect(seccionDe('service-tecnico-modelos')).toBe('service')
    expect(seccionDe('service-tecnico-estados')).toBe('service')
    expect(SECCIONES_PANEL.find((s) => s.id === 'service')?.etiqueta).toBe('Servicio técnico')
  })

  it('mueve Actividad a Administración', () => {
    expect(seccionDe('actividad')).toBe('administracion')
  })

  it('agrega Movimientos, Ingreso de mercadería y Depósitos de mercadería dentro de Stock', () => {
    expect(seccionDe('stock-movimientos')).toBe('stock')
    expect(seccionDe('stock-ingresos')).toBe('stock')
    expect(seccionDe('stock-depositos')).toBe('stock')
  })

  it('oculta del menú Ejecuciones, Analítica, Chat, Documentos y Conexiones sin quitar sus destinos de la app', () => {
    const ids = DESTINOS_PANEL.map((destino) => destino.id)
    for (const oculto of ['ejecuciones', 'analitica', 'analitica-administrar', 'chat-ia', 'documentos', 'conexiones', 'conexiones-oauth']) {
      expect(ids).not.toContain(oculto)
    }
  })
})
