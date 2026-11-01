// Pruebas de `consultar-estado-reparacion` (F-SVC-22, SC-007): 404 uniforme, 429 con Retry-After, cabeceras,
// lista blanca, IP hasheada y nunca en claro. Corre con `node --test` (`pnpm test:edge:consultar-estado-reparacion`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LIMITE_CONSULTAS, VENTANA_SEG, ipDelPedido, manejar, type Deps, type Limite } from './handler.ts'

const TOKEN = 'A'.repeat(32)
const ESTADO = {
  codigo: 'R-0001', tienda: 'San Javucho', equipo: 'Nintendo Switch', modelo: 'Estándar',
  estado: { nombre: 'En reparación', descripcion: 'Estamos trabajando en tu equipo' },
  entrega_prevista: '2027-02-01',
  linea_de_tiempo: [{ estado: 'Recibido', fecha: '2027-01-20T10:00:00Z' }],
}

type Opciones = { limite?: Limite; estado?: unknown; falloLimite?: boolean; falloConsulta?: boolean; sal?: string | undefined }

function montar(o: Opciones = {}) {
  const estado = { registros: [] as [string, number, number][], consultas: [] as string[] }
  const deps: Deps = {
    sal: 'sal' in o ? o.sal : 'sal-de-prueba',
    datos: {
      registrarConsulta: async (ip, ventana, limite) => {
        estado.registros.push([ip, ventana, limite])
        return o.falloLimite ? { data: null, error: { message: 'caída' } }
          : { data: o.limite ?? { permitido: true, restantes: 29, reintentar_en: 500 }, error: null }
      },
      estadoPublico: async (token) => {
        estado.consultas.push(token)
        return o.falloConsulta ? { data: null, error: { message: 'caída' } } : { data: 'estado' in o ? o.estado : ESTADO, error: null }
      },
    },
  }
  return { deps, estado }
}

const pedir = (deps: Deps, { cuerpo = { token: TOKEN } as unknown, metodo = 'POST', headers = {} as Record<string, string> } = {}) =>
  manejar(new Request('http://localhost/consultar-estado-reparacion', {
    method: metodo, headers: { 'Content-Type': 'application/json', ...headers },
    body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
  }), deps)

const cabecerasOk = (res: Response) => {
  assert.equal(res.headers.get('Cache-Control'), 'no-store')
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer')
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex')
}

describe('consultar-estado-reparacion', () => {
  it('devuelve 200 con la lista blanca y las cabeceras de seguridad', async () => {
    const { deps, estado } = montar()
    const res = await pedir(deps)
    assert.equal(res.status, 200)
    cabecerasOk(res)
    assert.deepEqual(await res.json(), ESTADO)
    assert.deepEqual(estado.consultas, [TOKEN])
  })

  it('no deja salir campos fuera de la lista blanca aunque la base los devuelva', async () => {
    const { deps } = montar({ estado: { ...ESTADO, cliente: 'Ana', contacto: '11-5555', numero_serie: 'SN1', falla: 'x', tecnico: 't',
      id: 'uuid', estado: { ...ESTADO.estado, id: 'u' }, linea_de_tiempo: [{ estado: 'Recibido', fecha: 'f', nota: 'privada', usuario: 'u' }] } })
    const cuerpo = await (await pedir(deps)).json()
    assert.deepEqual(Object.keys(cuerpo).sort(), ['codigo', 'entrega_prevista', 'equipo', 'estado', 'linea_de_tiempo', 'modelo', 'tienda'])
    assert.deepEqual(Object.keys(cuerpo.estado).sort(), ['descripcion', 'nombre'])
    assert.deepEqual(Object.keys(cuerpo.linea_de_tiempo[0]).sort(), ['estado', 'fecha'])
  })

  it('token desconocido y token mal formado dan el mismo 404 uniforme', async () => {
    const desconocido = await pedir(montar({ estado: null }).deps)
    const { deps, estado } = montar()
    const malFormado = await pedir(deps, { cuerpo: { token: 'corto' } })
    const sinCuerpo = await pedir(deps, { cuerpo: {} })
    for (const res of [desconocido, malFormado, sinCuerpo]) {
      assert.equal(res.status, 404)
      cabecerasOk(res)
      assert.deepEqual(await res.json(), { error: 'no_encontrada' })
    }
    assert.deepEqual(estado.consultas, [], 'un token mal formado no llega a la base de reparaciones')
  })

  it('al exceder el límite responde 429 con Retry-After sin consultar reparaciones', async () => {
    const { deps, estado } = montar({ limite: { permitido: false, restantes: 0, reintentar_en: 123 } })
    const res = await pedir(deps)
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), '123')
    cabecerasOk(res)
    assert.deepEqual(await res.json(), { error: 'demasiadas_consultas' })
    assert.deepEqual(estado.consultas, [])
  })

  it('cuenta toda consulta, también la de un token inválido, con la ventana y el límite acordados', async () => {
    const { deps, estado } = montar()
    await pedir(deps, { cuerpo: { token: 'x' } })
    assert.equal(estado.registros.length, 1)
    assert.equal(estado.registros[0][1], VENTANA_SEG)
    assert.equal(estado.registros[0][2], LIMITE_CONSULTAS)
    assert.equal(VENTANA_SEG, 600)
    assert.equal(LIMITE_CONSULTAS, 30)
  })

  it('hashea la IP con la sal: no se guarda ni se loguea en claro', async () => {
    const logs: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => { logs.push(args) }
    try {
      const { deps, estado } = montar({ falloConsulta: true })
      await pedir(deps, { headers: { 'x-real-ip': '203.0.113.9' } })
      assert.match(estado.registros[0][0], /^[0-9a-f]{64}$/)
      assert.ok(!estado.registros[0][0].includes('203.0.113.9'))
      assert.ok(!JSON.stringify(logs).includes('203.0.113.9'))
      const otra = montar()
      await pedir({ ...otra.deps, sal: 'otra-sal' }, { headers: { 'x-real-ip': '203.0.113.9' } })
      assert.notEqual(otra.estado.registros[0][0], estado.registros[0][0], 'la sal cambia el hash')
    } finally { console.error = original }
  })

  it('toma la IP de x-real-ip, o del último salto de x-forwarded-for, o un valor fijo', () => {
    const req = (headers: Record<string, string>) => new Request('http://x', { headers })
    assert.equal(ipDelPedido(req({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9, 2.2.2.2' })), '1.1.1.1')
    assert.equal(ipDelPedido(req({ 'x-forwarded-for': '9.9.9.9, 2.2.2.2' })), '2.2.2.2')
    assert.equal(ipDelPedido(req({})), 'sin-ip')
  })

  it('sin sal de servidor no atiende; si falla el contador o la consulta responde 500 sin datos', async () => {
    const original = console.error
    console.error = () => {}
    try {
      const sinSal = await pedir(montar({ sal: undefined }).deps)
      assert.equal(sinSal.status, 500)
      const falloLimite = montar({ falloLimite: true })
      assert.equal((await pedir(falloLimite.deps)).status, 500)
      assert.deepEqual(falloLimite.estado.consultas, [])
      const falloConsulta = await pedir(montar({ falloConsulta: true }).deps)
      assert.equal(falloConsulta.status, 500)
      cabecerasOk(falloConsulta)
    } finally { console.error = original }
  })

  it('responde OPTIONS y rechaza otros métodos con las cabeceras de seguridad', async () => {
    const { deps } = montar()
    const opciones = await pedir(deps, { metodo: 'OPTIONS' })
    assert.equal(opciones.status, 200)
    cabecerasOk(opciones)
    const get = await pedir(deps, { metodo: 'GET' })
    assert.equal(get.status, 405)
    cabecerasOk(get)
  })
})
