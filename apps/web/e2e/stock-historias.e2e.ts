import { expect, test } from './fixture'
import { abrirContextoGrabado, cerrarContextoGrabado } from './fixture'
import type { BrowserContext, Page } from '@playwright/test'
import { hayStack, ingresar, sembrarStock, type Siembra } from './semillas'
import { clic, escribir, paso, prepararPaginaVisible } from './visible'

// Videos de prueba de la épica MSF-136 (Stock), uno por funcionalidad. Cada título lleva los
// escenarios de aceptación que cubre (`[F-STK-NN#n]`, numerados en specs/…stock-movimientos/spec.md)
// o la tarea (`[MSF-136:Txxx]`): `pnpm cobertura:e2e` los ata a la historia y `pnpm armar-video:e2e`
// arma el video. Lo que no tiene pantalla (RLS, concurrencia, escritura directa) va por pgTAP.
// Requieren el Supabase local; sin SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY se omiten.

test.describe('Stock · videos por funcionalidad (MSF-136)', () => {
  test.skip(!hayStack, 'Requiere el stack local de Supabase (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).')
  test.setTimeout(240000)

  let grabacion: { contexto: BrowserContext; page: Page } | undefined
  let siembra: Siembra | undefined

  // Playwright exige desestructurar el primer argumento aunque no se use ninguna fixture.
  // oxlint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, testInfo) => {
    if (grabacion) await cerrarContextoGrabado(grabacion.contexto, grabacion.page, testInfo)
    grabacion = undefined
    await siembra?.limpiar()
    siembra = undefined
  })

  // Sesión grabada propia: el rol entra por la pantalla de ingreso.
  async function entrar(browser: Parameters<typeof abrirContextoGrabado>[0], testInfo: Parameters<typeof abrirContextoGrabado>[1], rol: keyof Siembra['usuarios']) {
    grabacion = await abrirContextoGrabado(browser, testInfo)
    const { page } = grabacion
    await prepararPaginaVisible(page).catch(() => {})
    await paso(page, `Ingresa como ${rol}`, () => ingresar(page, siembra!.usuarios[rol].correo))
    return page
  }

  const fila = (page: Page, nombre: string) => page.getByRole('row', { name: new RegExp(nombre) })
  const cantidad = (page: Page, nombre: string) => fila(page, nombre).getByRole('cell').nth(1)

  test('[F-STK-02#1-4,8] el Operador registra entrada, salida y ajuste y ve el stock resultante antes de confirmar', async ({ browser }, testInfo) => {
    siembra = await sembrarStock('mov', ['operador'], ['Producto movimientos'])
    const nombre = siembra.productos[0].nombre
    const page = await entrar(browser, testInfo, 'operador')
    await page.goto('/stock')
    await paso(page, 'Un producto recién creado tiene stock 0', async () => {
      await expect(cantidad(page, nombre)).toHaveText('0')
    })
    const registrar = async (tipo: 'Entrada' | 'Salida' | 'Ajuste', valor: string, esperado: string) => {
      await clic(page, page.getByRole('button', { name: `Nuevo movimiento de ${nombre}` }))
      const dialogo = page.getByRole('dialog', { name: 'Registrar movimiento de stock' })
      await clic(page, dialogo.getByRole('button', { name: tipo, exact: true }))
      await escribir(page, dialogo.getByLabel(tipo === 'Ajuste' ? 'Stock contado' : 'Cantidad'), valor)
      await expect(dialogo.getByText('Stock resultante')).toBeVisible()
      await clic(page, dialogo.getByLabel('Motivo'))
      await clic(page, page.getByRole('option').first())
      await clic(page, dialogo.getByRole('button', { name: 'Registrar', exact: true }))
      await expect(dialogo.getByText('Movimiento registrado')).toBeVisible()
      await clic(page, dialogo.getByRole('button', { name: 'Cerrar', exact: true }).filter({ hasText: 'Cerrar' }))
      await expect(cantidad(page, nombre)).toHaveText(esperado)
    }
    await paso(page, 'Entrada de 10: el stock pasa a 10 y se ve el «Stock resultante» antes de confirmar', () => registrar('Entrada', '10', '10'))
    await paso(page, 'Salida de 4: el stock pasa a 6', () => registrar('Salida', '4', '6'))
    await paso(page, 'Ajuste con stock contado 3: el stock queda en 3', () => registrar('Ajuste', '3', '3'))
  })

  test('[MSF-136:T025] el Administrador agrega un motivo y queda disponible en el formulario', async ({ browser }, testInfo) => {
    siembra = await sembrarStock('motivos', ['administrador'], ['Producto motivos'])
    const page = await entrar(browser, testInfo, 'administrador')
    await page.goto('/stock')
    await paso(page, 'El Administrador abre los motivos de movimiento', async () => {
      await clic(page, page.getByRole('button', { name: 'Motivos de movimiento' }).or(page.getByRole('link', { name: 'Motivos de movimiento' })))
      await expect(page).toHaveURL(/\/stock\/motivos/)
    })
    await paso(page, 'Agrega el motivo «Muestra comercial» (aplica a todos los tipos)', async () => {
      await clic(page, page.getByRole('button', { name: 'Nuevo motivo' }))
      const dialogo = page.getByRole('dialog', { name: 'Nuevo motivo' })
      await escribir(page, dialogo.getByLabel('Nombre'), 'Muestra comercial')
      await clic(page, dialogo.getByRole('button', { name: 'Guardar' }))
      await expect(page.getByText('Muestra comercial', { exact: true })).toBeVisible()
    })
    await paso(page, 'El motivo nuevo aparece en el formulario de una salida', async () => {
      await page.goto('/stock')
      await clic(page, page.getByRole('button', { name: `Nuevo movimiento de ${siembra!.productos[0].nombre}` }))
      const dialogo = page.getByRole('dialog', { name: 'Registrar movimiento de stock' })
      await clic(page, dialogo.getByRole('button', { name: 'Salida', exact: true }))
      await clic(page, dialogo.getByLabel('Motivo'))
      await expect(page.getByRole('option', { name: 'Muestra comercial' })).toBeVisible()
    })
  })

  test('[MSF-136:T025] el Operador no puede administrar los motivos', async ({ browser }, testInfo) => {
    siembra = await sembrarStock('motivos-op', ['operador'], ['Producto motivos'])
    const page = await entrar(browser, testInfo, 'operador')
    await page.goto('/stock')
    await paso(page, 'El Operador puede registrar movimientos', async () => {
      await expect(page.getByRole('button', { name: 'Nuevo movimiento' }).first()).toBeVisible()
    })
    await paso(page, 'Pero no ve la administración de motivos', async () => {
      await expect(page.getByRole('link', { name: 'Motivos de movimiento' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Motivos de movimiento' })).toHaveCount(0)
    })
  })

  test('[F-STK-02#5] [F-STK-05#4] Consulta ve el stock sin poder registrar ni editar el mínimo', async ({ browser }, testInfo) => {
    siembra = await sembrarStock('consulta', ['operador', 'consulta'], ['Producto consulta'])
    const producto = siembra.productos[0]
    expect((await siembra.moverStock('operador', producto.id, 'entrada', 10)).ok).toBe(true)
    const page = await entrar(browser, testInfo, 'consulta')
    await page.goto('/stock')
    await paso(page, 'Consulta ve las cantidades del stock', async () => {
      await expect(cantidad(page, producto.nombre)).toHaveText('10')
    })
    await paso(page, 'No ve «Nuevo movimiento» ni «Editar mínimo»', async () => {
      await expect(page.getByRole('button', { name: /Nuevo movimiento/ })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /Editar mínimo/ })).toHaveCount(0)
    })
    await paso(page, 'Y una llamada directa a la base se rechaza sin cambiar el stock', async () => {
      const r = await siembra!.moverStock('consulta', producto.id, 'entrada', 5)
      expect(r.ok).toBe(false)
      await page.reload()
      await expect(cantidad(page, producto.nombre)).toHaveText('10')
    })
  })

  test('[F-STK-03#1-2,4] el historial lista los movimientos, se filtra por producto y muestra el estado vacío', async ({ browser }, testInfo) => {
    siembra = await sembrarStock('hist', ['operador'], ['Producto A', 'Producto B'])
    const [a, b] = siembra.productos
    const page = await entrar(browser, testInfo, 'operador')
    await page.goto('/stock/movimientos')
    await paso(page, 'Sin movimientos se ve el estado vacío', async () => {
      await expect(page.getByText('Todavía no hay movimientos de stock.')).toBeVisible()
    })
    for (const [p, tipo, n] of [[a, 'entrada', 10], [a, 'salida', 4], [b, 'entrada', 7]] as const) {
      expect((await siembra.moverStock('operador', p.id, tipo, n)).ok).toBe(true)
    }
    await paso(page, 'Con movimientos se listan del más reciente al más antiguo, con saldo y responsable', async () => {
      await page.reload()
      await expect(page.getByText('3 movimientos')).toBeVisible()
      await expect(page.getByRole('row', { name: new RegExp(b.nombre) }).first()).toBeVisible()
    })
    await paso(page, 'Filtra por «Producto A»: quedan solo sus dos movimientos', async () => {
      await clic(page, page.getByLabel('Filtrar por producto'))
      await clic(page, page.getByRole('option', { name: new RegExp(a.nombre) }))
      await expect(page.getByText('2 movimientos')).toBeVisible()
      await expect(page.getByRole('row', { name: new RegExp(b.nombre) })).toHaveCount(0)
    })
  })

  test('[F-STK-05#1-3,5] se define el mínimo, se calcula el estado y «Ver solo alertas» filtra', async ({ browser }, testInfo) => {
    siembra = await sembrarStock('minimo', ['operador'], ['Sin existencias', 'Pocas unidades', 'Muchas unidades'])
    const [sinStock, pocas, muchas] = siembra.productos
    expect((await siembra.moverStock('operador', pocas.id, 'entrada', 2)).ok).toBe(true)
    expect((await siembra.moverStock('operador', muchas.id, 'entrada', 20)).ok).toBe(true)
    const page = await entrar(browser, testInfo, 'operador')
    await page.goto('/stock')
    const definir = async (nombre: string, valor: string) => {
      await clic(page, page.getByRole('button', { name: `Editar mínimo de ${nombre}` }))
      const dialogo = page.getByRole('dialog', { name: 'Stock mínimo' })
      await escribir(page, dialogo.getByLabel('Cantidad mínima'), valor)
      await clic(page, dialogo.getByRole('button', { name: 'Guardar' }))
      return dialogo
    }
    await paso(page, 'Un valor inválido (negativo) se rechaza con un mensaje claro', async () => {
      const dialogo = await definir(pocas.nombre, '-1')
      await expect(dialogo.getByText('El mínimo debe ser un entero de cero o más.')).toBeVisible()
      await clic(page, dialogo.getByRole('button', { name: 'Cancelar' }))
    })
    await paso(page, 'Define el mínimo en 5 para «Pocas unidades»: pasa a «Stock bajo»', async () => {
      await definir(pocas.nombre, '5')
      await expect(fila(page, pocas.nombre).getByText('Stock bajo')).toBeVisible()
    })
    await paso(page, 'Define el mínimo en 5 para «Muchas unidades»: sigue «Disponible»', async () => {
      await definir(muchas.nombre, '5')
      await expect(fila(page, muchas.nombre).getByText('Disponible')).toBeVisible()
      await expect(fila(page, sinStock.nombre).getByText('Sin stock')).toBeVisible()
    })
    await paso(page, 'El resumen avisa 1 sin stock y 1 con stock bajo; «Ver solo alertas» deja solo esos', async () => {
      await expect(page.getByText(/1 producto sin stock y 1 con stock bajo/)).toBeVisible()
      await clic(page, page.getByRole('button', { name: 'Ver solo alertas' }))
      await expect(fila(page, muchas.nombre)).toHaveCount(0)
      await expect(fila(page, sinStock.nombre)).toBeVisible()
    })
  })

  test('[F-STK-06#1-2] una salida mayor al stock se rechaza con «No hay stock suficiente»', async ({ browser }, testInfo) => {
    siembra = await sembrarStock('negativo', ['operador'], ['Producto negativo'])
    const producto = siembra.productos[0]
    expect((await siembra.moverStock('operador', producto.id, 'entrada', 3)).ok).toBe(true)
    const page = await entrar(browser, testInfo, 'operador')
    await page.goto('/stock')
    await paso(page, 'Con stock 3, una salida de 5 avisa «No hay stock suficiente» y no se puede registrar', async () => {
      await clic(page, page.getByRole('button', { name: `Nuevo movimiento de ${producto.nombre}` }))
      const dialogo = page.getByRole('dialog', { name: 'Registrar movimiento de stock' })
      await clic(page, dialogo.getByRole('button', { name: 'Salida', exact: true }))
      await escribir(page, dialogo.getByLabel('Cantidad'), '5')
      await expect(dialogo.getByText('No hay stock suficiente')).toBeVisible()
      await expect(dialogo.getByRole('button', { name: 'Registrar', exact: true })).toBeDisabled()
      await clic(page, dialogo.getByRole('button', { name: 'Cancelar' }))
    })
    await paso(page, 'El stock sigue en 3 y no se creó ningún movimiento nuevo', async () => {
      await expect(cantidad(page, producto.nombre)).toHaveText('3')
      await page.goto('/stock/movimientos')
      await expect(page.getByText('1 movimiento')).toBeVisible()
    })
  })
})
