// Pruebas de `verificar-dominio-tienda` (F-TDA-05, SC-005) con DNS y TLS simulados: verifica A/CNAME/TXT,
// no comprueba el certificado con DNS incorrecto, respeta el límite de frecuencia, rechaza usuarios sin
// permiso y nunca consulta hosts que no salgan de la base. Corre con `node --test`
// (`pnpm test:edge:verificar-dominio-tienda`); el handler no importa nada de Deno.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clasificarFalloTls, manejar, type Certificado, type Deps, type Preparacion, type ResultadoRegistro } from './handler.ts'

const EMPRESA = 'e1000000-0000-4000-8000-000000000001'
const PREP: Preparacion = {
  dominio: 'mundojc.com.ar',
  redireccion: 'www.mundojc.com.ar',
  token: '8f31c2',
  ip_publica: '203.0.113.24',
  cname_destino: 'stores.plataforma.app',
  prefijo_txt: 'gc-verify',
}

type Opciones = {
  prep?: Preparacion
  rpcError?: { message: string; code?: string }
  a?: string[]
  txt?: string[]
  cname?: string[]
  dnsCaido?: boolean
  tls?: Certificado
  tlsLanza?: boolean
  falloRegistro?: boolean
}

function montar(opciones: Opciones = {}) {
  const estado = {
    rpc: [] as [string, Record<string, unknown>][],
    consultas: [] as string[],
    tls: [] as string[],
    registrados: [] as { empresaId: string; dominio: string; redireccion: string | null; resultados: ResultadoRegistro[]; certificado: Certificado }[],
  }
  const consultar = (clave: string, valores: string[] | undefined) => async (host: string) => {
    estado.consultas.push(`${clave} ${host}`)
    if (opciones.dnsCaido) throw new Error('servidor DNS caído')
    return valores ?? []
  }
  const deps: Deps = {
    verificarJwt: async (jwt) => (jwt === 'valido' ? { id: 'u-1' } : null),
    caller: () => ({
      rpc: async (nombre, args) => {
        estado.rpc.push([nombre, args])
        return opciones.rpcError ? { data: null, error: opciones.rpcError } : { data: opciones.prep ?? PREP, error: null }
      },
    }),
    admin: {
      registrar: async (empresaId, dominio, redireccion, resultados, certificado) => {
        estado.registrados.push({ empresaId, dominio, redireccion, resultados, certificado })
        return { error: opciones.falloRegistro ? { message: 'boom' } : null }
      },
    },
    dns: {
      resolverA: consultar('A', opciones.a),
      resolverTxt: consultar('TXT', opciones.txt),
      resolverCname: consultar('CNAME', opciones.cname),
    },
    tls: {
      comprobar: async (host, ip) => {
        estado.tls.push(`${host}@${ip}`)
        if (opciones.tlsLanza) throw new Error('socket')
        return opciones.tls ?? 'activo'
      },
    },
  }
  return { deps, estado }
}

const pedir = (deps: Deps, { jwt = 'valido', cuerpo = { empresa_id: EMPRESA } as unknown, metodo = 'POST' }: { jwt?: string | null; cuerpo?: unknown; metodo?: string } = {}) =>
  manejar(new Request('http://localhost/verificar-dominio-tienda', {
    method: metodo,
    headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {},
    body: metodo === 'POST' ? JSON.stringify(cuerpo) : undefined,
  }), deps)

const TODO_BIEN: Opciones = { a: ['203.0.113.24'], txt: ['gc-verify=8f31c2'], cname: ['stores.plataforma.app.'] }

describe('verificar-dominio-tienda', () => {
  it('con los tres registros correctos verifica el dominio, comprueba el certificado y lo registra (FR-011, FR-012)', async () => {
    const { deps, estado } = montar(TODO_BIEN)
    const res = await pedir(deps)
    assert.equal(res.status, 200)
    const cuerpo = await res.json()
    assert.equal(cuerpo.dominio_verificado, true)
    assert.equal(cuerpo.certificado, 'activo')
    assert.deepEqual(cuerpo.registros, [
      { tipo: 'A', nombre: '@', estado: 'correcto' },
      { tipo: 'TXT', nombre: '_verif', estado: 'correcto' },
      { tipo: 'CNAME', nombre: 'www', estado: 'correcto' },
    ])
    assert.deepEqual(estado.tls, ['mundojc.com.ar@203.0.113.24'])
    assert.equal(estado.registrados[0].dominio, 'mundojc.com.ar')
    assert.equal(estado.registrados.length, 1)
    assert.equal(estado.registrados[0].empresaId, EMPRESA)
    assert.equal(estado.registrados[0].certificado, 'activo')
  })

  it('consulta solo los hostnames guardados de la tienda, nunca algo del request (FR-009)', async () => {
    const { deps, estado } = montar({ ...TODO_BIEN })
    await pedir(deps, { cuerpo: { empresa_id: EMPRESA, dominio: 'otro.com', host: '10.0.0.1' } })
    assert.deepEqual(estado.consultas.sort(), ['A mundojc.com.ar', 'CNAME www.mundojc.com.ar', 'TXT _verif.mundojc.com.ar'])
    assert.deepEqual(estado.rpc, [['preparar_verificacion_tienda', { p_empresa_id: EMPRESA }]])
  })

  it('un A con otra IP queda «Incorrecto» y el certificado no se comprueba (FR-012, anti-SSRF)', async () => {
    const { deps, estado } = montar({ ...TODO_BIEN, a: ['198.51.100.7'] })
    const cuerpo = await (await pedir(deps)).json()
    assert.equal(cuerpo.dominio_verificado, false)
    assert.equal(cuerpo.certificado, 'pendiente')
    assert.equal(cuerpo.registros[0].estado, 'incorrecto')
    assert.deepEqual(estado.tls, [])
    assert.equal(estado.registrados[0].resultados[0].valor_encontrado, '198.51.100.7')
  })

  it('registros inexistentes quedan «Pendiente» y el dominio sin verificar', async () => {
    const { deps, estado } = montar({})
    const cuerpo = await (await pedir(deps)).json()
    assert.equal(cuerpo.dominio_verificado, false)
    assert.deepEqual(cuerpo.registros.map((r: { estado: string }) => r.estado), ['pendiente', 'pendiente', 'pendiente'])
    assert.deepEqual(estado.tls, [])
  })

  it('un TXT con el prefijo pero otro token es «Incorrecto»; un TXT ajeno no cuenta', async () => {
    const mal = montar({ ...TODO_BIEN, txt: ['gc-verify=otro'] })
    assert.equal((await (await pedir(mal.deps)).json()).registros[1].estado, 'incorrecto')
    const ajeno = montar({ ...TODO_BIEN, txt: ['v=spf1 -all'] })
    assert.equal((await (await pedir(ajeno.deps)).json()).registros[1].estado, 'pendiente')
  })

  it('sin «Redirigir también» no consulta ni exige el CNAME', async () => {
    const { deps, estado } = montar({ ...TODO_BIEN, prep: { ...PREP, redireccion: null } })
    const cuerpo = await (await pedir(deps)).json()
    assert.equal(cuerpo.dominio_verificado, true)
    assert.equal(cuerpo.registros.length, 2)
    assert.ok(!estado.consultas.some((c) => c.startsWith('CNAME')))
  })

  it('con el dominio verificado y el certificado aún sin emitir informa «pendiente» y si falla la conexión también', async () => {
    assert.equal((await (await pedir(montar({ ...TODO_BIEN, tls: 'pendiente' }).deps)).json()).certificado, 'pendiente')
    assert.equal((await (await pedir(montar({ ...TODO_BIEN, tls: 'error' }).deps)).json()).certificado, 'error')
    const { deps } = montar({ ...TODO_BIEN, tlsLanza: true })
    const res = await pedir(deps)
    assert.equal(res.status, 200)
    assert.equal((await res.json()).certificado, 'pendiente')
  })

  it('un DNS caído responde 502 sin registrar nada (no cambia ningún estado guardado)', async () => {
    const { deps, estado } = montar({ dnsCaido: true })
    const res = await pedir(deps)
    assert.equal(res.status, 502)
    assert.deepEqual(await res.json(), { error: 'dns_no_disponible' })
    assert.deepEqual(estado.registrados, [])
  })

  it('el límite de 10 s responde 429 sin consultar DNS (FR-010)', async () => {
    const { deps, estado } = montar({ rpcError: { message: 'demasiado_pronto', code: '55000' } })
    const res = await pedir(deps)
    assert.equal(res.status, 429)
    assert.deepEqual(await res.json(), { error: 'demasiado_pronto' })
    assert.deepEqual(estado.consultas, [])
    assert.deepEqual(estado.registrados, [])
  })

  it('sin permiso de edición responde 403 sin consultar DNS (FR-009)', async () => {
    const { deps, estado } = montar({ rpcError: { message: 'sin_permiso', code: '42501' } })
    const res = await pedir(deps)
    assert.equal(res.status, 403)
    assert.deepEqual(await res.json(), { error: 'sin_permiso' })
    assert.deepEqual(estado.consultas, [])
  })

  it('una empresa de otra organización (inexistente para la sesión) responde 403', async () => {
    const { deps } = montar({ rpcError: { message: 'La empresa no existe', code: 'P0002' } })
    assert.equal((await pedir(deps)).status, 403)
  })

  it('una tienda sin dominio responde 400 sin_dominio', async () => {
    const { deps } = montar({ rpcError: { message: 'sin_dominio', code: '22023' } })
    const res = await pedir(deps)
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'sin_dominio' })
  })

  it('sin token o con token inválido responde 401', async () => {
    const { deps, estado } = montar(TODO_BIEN)
    assert.equal((await pedir(deps, { jwt: null })).status, 401)
    assert.equal((await pedir(deps, { jwt: 'vencido' })).status, 401)
    assert.deepEqual(estado.rpc, [])
  })

  it('un cuerpo sin empresa_id válido responde 400 y un método distinto de POST 405', async () => {
    const { deps, estado } = montar(TODO_BIEN)
    assert.equal((await pedir(deps, { cuerpo: {} })).status, 400)
    assert.equal((await pedir(deps, { cuerpo: { empresa_id: 'no-es-uuid' } })).status, 400)
    assert.equal((await pedir(deps, { metodo: 'GET' })).status, 405)
    assert.deepEqual(estado.rpc, [])
  })

  it('si no se puede guardar el resultado responde 400 sin afirmar éxito', async () => {
    const { deps } = montar({ ...TODO_BIEN, falloRegistro: true })
    assert.equal((await pedir(deps)).status, 400)
  })
})

describe('clasificarFalloTls', () => {
  it('un certificado inválido o vencido es «error» y un puerto sin respuesta es «pendiente»', () => {
    assert.equal(clasificarFalloTls('InvalidData invalid peer certificate: UnknownIssuer'), 'error')
    assert.equal(clasificarFalloTls('Error certificate expired'), 'error')
    assert.equal(clasificarFalloTls('ConnectionRefused connection refused'), 'pendiente')
    assert.equal(clasificarFalloTls('Error timeout'), 'pendiente')
  })
})
