import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { abrirContextoGrabado, cerrarContextoGrabado, expect, test } from './fixture'
import { clic, escribir, paso, prepararPaginaVisible, rotulo } from './visible'
import { UPSERT_FUSIONAR, altaUsuario, asignarEmpresasComoAdministrador, borrar, borrarUsuario, rest, serviceKey, url } from './soporte/fixtures'

// Tablero de Inicio con tres roles (F-INI-05 y F-INI-06): «Resumen por tienda», «Salidas por depósito», «Actividad reciente» y
// «Movimientos por producto» (búsqueda, vistas, orden y exportación). El Administrador ve ingresos y exporta; Consulta lee sin
// exportar; Operador no ve ingresos. Un bloque que falla se reintenta sin tocar al otro (error independiente por bloque).
// Mismo patrón que `inicio.e2e.ts`: requiere el stack local (`pnpm dev:supabase`) y la web servida; siembra con la API admin desde
// Node. Sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY el archivo se omite (no entra al CI público). Ver docs/e2e-app.md.

const password = 'Correcta-12345!'

async function ingresar(page: Page, correo: string) {
  await page.goto('/login')
  await escribir(page, page.getByLabel('Correo'), correo)
  await escribir(page, page.getByLabel('Contraseña'), password)
  await clic(page, page.getByRole('button', { name: 'Ingresar' }))
  await expect(page).not.toHaveURL(/\/login/)
}

type Sembrado = {
  orgId: string
  tienda: string
  skuAlerta: string
  nombreAlerta: string
  nombreSinStock: string
  nombreNormal: string
  correos: { administrador: string; operador: string; consulta: string }
  idsUsuario: string[]
}

// Lo creado se registra en `registro` a medida que se crea: si la siembra falla a mitad, `limpiar` borra lo que alcanzó a existir.
async function sembrar(sufijo: string, registro: Partial<Sembrado>): Promise<void> {
  registro.idsUsuario = []
  const [org] = await rest<{ id: string }>('organizaciones', { nombre: `E2E tablero ${sufijo}` })
  registro.orgId = org.id
  const [empresa] = await rest<{ id: string; nombre: string }>('empresas', [{ organizacion_id: org.id, nombre: `Tienda tablero ${sufijo}`, activa: true }], 'dominio')
  const correos = {
    administrador: `admin-tablero-${sufijo}@example.com`,
    operador: `operador-tablero-${sufijo}@example.com`,
    consulta: `consulta-tablero-${sufijo}@example.com`,
  } as const
  const ids: Record<string, string> = {}
  for (const [rol, correo] of Object.entries(correos)) {
    ids[rol] = await altaUsuario(correo)
    registro.idsUsuario.push(ids[rol])
  }
  await rest('usuarios_organizacion', [
    { user_id: ids.administrador, organizacion_id: org.id, rol_id: 'administrador' },
    { user_id: ids.operador, organizacion_id: org.id, rol_id: 'operador' },
    { user_id: ids.consulta, organizacion_id: org.id, rol_id: 'consulta' },
  ])
  await asignarEmpresasComoAdministrador(correos.administrador, ids.operador, [{ empresa_id: empresa.id, rol_id: 'operador' }])
  await asignarEmpresasComoAdministrador(correos.administrador, ids.consulta, [{ empresa_id: empresa.id, rol_id: 'consulta' }])
  await rest('usuario_empresa_activa', [{ user_id: ids.administrador, empresa_id: empresa.id }])

  const skuAlerta = `E2E-TB-B-${sufijo}`
  const nombreAlerta = `Producto con stock bajo ${sufijo}`
  const nombreSinStock = `Producto sin stock ${sufijo}`
  const nombreNormal = `Producto normal ${sufijo}`
  const productos = await rest<{ id: string }>(
    'productos',
    [
      { organizacion_id: org.id, nombre: nombreSinStock, sku: `E2E-TB-S-${sufijo}`, moneda: 'ARS', precio_lista: 100 },
      { organizacion_id: org.id, nombre: nombreAlerta, sku: skuAlerta, moneda: 'ARS', precio_lista: 100 },
      { organizacion_id: org.id, nombre: nombreNormal, sku: `E2E-TB-N-${sufijo}`, moneda: 'ARS', precio_lista: 100 },
    ],
    'dominio',
  )
  const [sinStock, stockBajo, normal] = productos
  // La RPC de movimientos exige la fila de `producto_empresa` cuando hay una empresa activa.
  await rest('producto_empresa', productos.map((p) => ({ producto_id: p.id, empresa_id: empresa.id, organizacion_id: org.id })), 'dominio')
  // El disparador `productos_crear_existencias` ya crea la fila de cada producto: se actualiza con upsert.
  await rest(
    'existencias?on_conflict=producto_id',
    [
      { producto_id: sinStock.id, organizacion_id: org.id, cantidad: 0, minimo: 0 },
      { producto_id: stockBajo.id, organizacion_id: org.id, cantidad: 3, minimo: 5 },
      { producto_id: normal.id, organizacion_id: org.id, cantidad: 10, minimo: 1 },
    ],
    'dominio',
    UPSERT_FUSIONAR,
  )
  Object.assign(registro, { tienda: empresa.nombre, skuAlerta, nombreAlerta, nombreSinStock, nombreNormal, correos })
}

// `borrar()` y `borrarUsuario()` ya avisan con `console.warn` cuando la API responde con error HTTP (no lanzan): lo que acá se captura
// es lo que sí lanza (p. ej. un corte de red), para que los borrados siguientes igual corran. El resumen final cubre solo esos casos.
async function limpiar(datos: Partial<Sembrado>) {
  const fallos: string[] = []
  const intentar = async (nombre: string, accion: () => Promise<unknown>) => {
    try {
      await accion()
    } catch (error) {
      fallos.push(`${nombre}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const ids = datos.idsUsuario ?? []
  if (datos.orgId) {
    const org = datos.orgId
    if (ids.length > 0) await intentar('usuario_empresa_activa', () => borrar(`usuario_empresa_activa?user_id=in.(${ids.join(',')})`))
    await intentar('usuarios_organizacion', () => borrar(`usuarios_organizacion?organizacion_id=eq.${org}`))
    await intentar('producto_empresa', () => borrar(`producto_empresa?organizacion_id=eq.${org}`, 'dominio'))
    await intentar('existencias', () => borrar(`existencias?organizacion_id=eq.${org}`, 'dominio'))
    await intentar('productos', () => borrar(`productos?organizacion_id=eq.${org}`, 'dominio'))
    await intentar('empresas', () => borrar(`empresas?organizacion_id=eq.${org}`, 'dominio'))
    await intentar('organizaciones', () => borrar(`organizaciones?id=eq.${org}`))
  }
  for (const id of ids) await intentar(`usuario ${id}`, () => borrarUsuario(id))
  if (fallos.length > 0) console.warn(`Limpieza incompleta de inicio-tablero:\n${fallos.join('\n')}`)
}

const resumenTiendas = (page: Page) => page.getByRole('list', { name: 'Resumen por tienda' })
const avisoDeError = (page: Page) => page.getByRole('alert').filter({ hasText: 'No pudimos cargar este dato' })

test.describe('Inicio · tablero de gestión con tres roles', () => {
  test.skip(!url || !serviceKey, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  // En serie y con UNA siembra para los tres tests: en paralelo, tres contextos con video 1920x1080 y tres siembras (altas de usuario,
  // logins de asignación) agotaban los 5 min del test en el job de sesión (MSF-881).
  test.describe.configure({ mode: 'serial' })
  const datos: Partial<Sembrado> = {}

  test.beforeAll(async () => {
    test.setTimeout(240_000)
    await sembrar(randomUUID().slice(0, 8), datos)
  })

  test.afterAll(async () => {
    await limpiar(datos)
  })

  test('el Administrador ve los bloques con ingresos, filtra, ordena y exporta «Movimientos por producto»', async ({ browser }, testInfo) => {
    // El recorrido visible (cursor, rótulos, tipeo a 90 ms por letra) es lento a propósito: con ~15 acciones el Administrador rozaba los 300 s.
    test.setTimeout(600_000)
    const siembra = datos as Sembrado
    const admin = await abrirContextoGrabado(browser, testInfo, 'administrador')
    try {
      await prepararPaginaVisible(admin.page)
      const { page } = admin
      await ingresar(page, siembra.correos.administrador)
      await paso(page, 'Abre Inicio y ve «Resumen por tienda» con ingresos', async () => {
        await page.goto('/')
        await expect(page.getByRole('heading', { name: 'Resumen por tienda', exact: true })).toBeVisible()
        await expect(resumenTiendas(page).getByText(siembra.tienda)).toBeVisible()
        await expect(resumenTiendas(page).getByText(/Ingresos \(con IVA\)/)).toBeVisible()
      })
      await paso(page, 'Ve «Salidas por depósito» y «Actividad reciente»', async () => {
        await expect(page.getByRole('heading', { name: 'Salidas por depósito', exact: true })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Actividad reciente', exact: true })).toBeVisible()
      })
      await paso(page, 'En «Movimientos por producto» ve los tres productos sembrados', async () => {
        await expect(page.getByRole('heading', { name: 'Movimientos por producto', exact: true })).toBeVisible()
        await expect(page.getByText('Mostrando 3 de 3 productos')).toBeVisible()
        await expect(page.getByText(siembra.nombreAlerta).first()).toBeVisible()
        await expect(page.getByText(siembra.nombreSinStock).first()).toBeVisible()
      })
      await paso(page, 'Busca por SKU y queda solo el producto buscado', async () => {
        await escribir(page, page.getByLabel('Buscar producto o SKU'), siembra.skuAlerta)
        await expect(page.getByText('Mostrando 1 de 1 producto')).toBeVisible()
        await expect(page.getByText(siembra.nombreSinStock)).toHaveCount(0)
      })
      await paso(page, 'Una búsqueda sin resultados muestra el estado vacío y «Limpiar filtros» lo revierte', async () => {
        await escribir(page, page.getByLabel('Buscar producto o SKU'), `no-existe-${siembra.orgId}`)
        await expect(page.getByText('Sin movimientos para estos filtros')).toBeVisible()
        await clic(page, page.getByRole('button', { name: 'Limpiar filtros' }))
        await expect(page.getByText('Mostrando 3 de 3 productos')).toBeVisible()
      })
      await paso(page, 'La vista «En alerta» deja los dos productos en alerta y saca al normal', async () => {
        await clic(page, page.getByRole('group', { name: 'Vistas rápidas' }).getByRole('button', { name: 'En alerta' }))
        await expect(page.getByText('Mostrando 2 de 2 productos')).toBeVisible()
        await expect(page.getByText(siembra.nombreAlerta).first()).toBeVisible()
        await expect(page.getByText(siembra.nombreNormal)).toHaveCount(0)
        await clic(page, page.getByRole('group', { name: 'Vistas rápidas' }).getByRole('button', { name: 'Todos' }))
        await expect(page.getByText('Mostrando 3 de 3 productos')).toBeVisible()
      })
      await paso(page, 'Cambia el sentido del orden', async () => {
        await clic(page, page.getByRole('button', { name: '↑ Ascendente' }))
        await expect(page.getByRole('button', { name: '↓ Descendente' })).toBeVisible()
        await expect(page.getByText('Mostrando 3 de 3 productos')).toBeVisible()
      })
      await paso(page, 'Exporta lo que ve a un CSV con fecha en el nombre', async () => {
        const descarga = page.waitForEvent('download')
        await clic(page, page.getByRole('button', { name: 'Exportar' }))
        expect((await descarga).suggestedFilename()).toMatch(/^movimientos-por-producto-\d{4}-\d{2}-\d{2}\.csv$/)
      })
      await rotulo(page, 'El Administrador ve ingresos y exporta')
    } finally {
      await cerrarContextoGrabado(admin.contexto, admin.page, testInfo)
    }
  })

  test('Consulta lee sin exportar y Operador no ve ingresos', async ({ browser }, testInfo) => {
    test.setTimeout(600_000)
    const siembra = datos as Sembrado

    const consulta = await abrirContextoGrabado(browser, testInfo, 'consulta')
    try {
      await prepararPaginaVisible(consulta.page)
      const { page } = consulta
      await ingresar(page, siembra.correos.consulta)
      await paso(page, 'Consulta ve «Movimientos por producto» pero sin el botón «Exportar»', async () => {
        await page.goto('/')
        await expect(page.getByRole('heading', { name: 'Movimientos por producto', exact: true })).toBeVisible()
        await expect(page.getByText('Mostrando 3 de 3 productos')).toBeVisible()
        await expect(page.getByText(siembra.nombreAlerta).first()).toBeVisible()
        await expect(page.getByLabel('Buscar producto o SKU')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Exportar' })).toHaveCount(0)
      })
      await rotulo(page, 'Consulta lee los movimientos pero no exporta')
    } finally {
      await cerrarContextoGrabado(consulta.contexto, consulta.page, testInfo)
    }

    const operador = await abrirContextoGrabado(browser, testInfo, 'operador')
    try {
      await prepararPaginaVisible(operador.page)
      const { page } = operador
      await ingresar(page, siembra.correos.operador)
      await paso(page, 'Operador ve el resumen por tienda sin ingresos', async () => {
        await page.goto('/')
        await expect(page.getByRole('heading', { name: 'Resumen por tienda', exact: true })).toBeVisible()
        await expect(resumenTiendas(page).getByText(siembra.tienda)).toBeVisible()
        await expect(page.getByText(/Ingresos \(con IVA\)/)).toHaveCount(0)
      })
      await rotulo(page, 'Operador no ve ingresos')
    } finally {
      await cerrarContextoGrabado(operador.contexto, operador.page, testInfo)
    }
  })

  test('si falla «Resumen por tienda», el error y el reintento son solo de ese bloque', async ({ browser }, testInfo) => {
    test.setTimeout(600_000)
    const siembra = datos as Sembrado
    const admin = await abrirContextoGrabado(browser, testInfo, 'administrador')
    try {
      await prepararPaginaVisible(admin.page)
      const { page } = admin
      // Falla solo la lectura de «Resumen por tienda» (la RPC recibe `p_seccion`); «Salidas por depósito» pasa.
      let fallar = true
      await page.route('**/rest/v1/rpc/resumen_inicio_bloques', async (ruta) => {
        const cuerpo = ruta.request().postDataJSON() as { p_seccion?: string } | null
        if (fallar && cuerpo?.p_seccion === 'por_tienda') {
          await ruta.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'falla simulada' }) })
          return
        }
        await ruta.continue()
      })
      await ingresar(page, siembra.correos.administrador)
      await paso(page, 'Solo «Resumen por tienda» muestra el error con «Reintentar»', async () => {
        await page.goto('/')
        await expect(avisoDeError(page)).toHaveCount(1)
        await expect(avisoDeError(page).getByRole('button', { name: 'Reintentar' })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Salidas por depósito', exact: true })).toBeVisible()
        await expect(page.getByText('Mostrando 3 de 3 productos')).toBeVisible()
      })
      await paso(page, 'Al reintentar, el bloque se recupera y no queda ningún error', async () => {
        fallar = false
        await clic(page, avisoDeError(page).getByRole('button', { name: 'Reintentar' }))
        await expect(resumenTiendas(page).getByText(siembra.tienda)).toBeVisible()
        await expect(avisoDeError(page)).toHaveCount(0)
      })
      await rotulo(page, 'El error y el reintento son independientes por bloque')
    } finally {
      await cerrarContextoGrabado(admin.contexto, admin.page, testInfo)
    }
  })
})
