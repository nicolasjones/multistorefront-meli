// Pruebas de `enviar-correo-proveedor` con clientes simulados. Corre con `node --test`
// (`pnpm test:edge:enviar-correo-proveedor`); el handler no importa nada de Deno ni de Supabase.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { manejar, type Deps } from './handler.ts'

const ID = '11111111-1111-4111-8111-111111111111'

type Opciones = {
  nivel?: string | null
  nivelError?: boolean
  proveedor?: { razon_social: string; correo: string | null; activo: boolean } | null
  proveedorError?: boolean
  falloSmtp?: boolean
  rechazoCupo?: { status: number; error: string; retryAfter?: number } | null
  falloRegistro?: boolean
}

function montar(opciones: Opciones = {}) {
  const enviados: { para: string[]; asunto: string; texto: string }[] = []
  const lecturas: string[] = []
  const cupos: string[] = []
  const eventos: unknown[] = []
  const deps: Deps = {
    getUser: async (jwt) => jwt === 'valido' ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: { message: 'x' } },
    caller: () => ({
      nivelProveedores: async () => opciones.nivelError ? { data: null, error: { message: 'fallo en postgres://u:clave-secreta@db/x' } } : { data: opciones.nivel === undefined ? 'edicion' : opciones.nivel, error: null },
      proveedor: async (id) => {
        lecturas.push(id)
        if (opciones.proveedorError) return { data: null, error: { message: 'fallo en postgres://u:clave-secreta@db/x' } }
        const sin = opciones.proveedor === null
        return { data: sin ? null : opciones.proveedor ?? { razon_social: 'Acme', correo: 'ventas@acme.com', activo: true }, error: null }
      },
    }),
    enviar: async (mensaje) => {
      if (opciones.falloSmtp) throw new Error('smtp caído')
      enviados.push(mensaje)
    },
    consumirCupo: async (usuarioId) => {
      cupos.push(usuarioId)
      return opciones.rechazoCupo ?? null
    },
    registrar: async (evento) => {
      if (opciones.falloRegistro) throw new Error('registro caído con clave sk-secreta')
      eventos.push(evento)
    },
  }
  return { deps, enviados, lecturas, cupos, eventos }
}

// Captura lo que la función escribe en `console.error` (cada argumento unido por espacio) para comprobar que el log no trae errores crudos.
function capturarErrores() {
  const original = console.error
  const textos: string[] = []
  console.error = (...args: unknown[]) => { textos.push(args.map(String).join(' ')) }
  return { textos, restaurar: () => { console.error = original } }
}

const pedir = (deps: Deps, body: unknown, jwt: string | null = 'valido', method = 'POST') =>
  manejar(new Request('http://x/', { method, headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined }), deps)
const valido = { proveedor_id: ID, asunto: 'Pedido', mensaje: 'Hola, necesitamos cotización.' }

describe('enviar-correo-proveedor', () => {
  it('envía al correo guardado del proveedor, no al que mande el cliente', async () => {
    const { deps, enviados } = montar()
    const res = await pedir(deps, { ...valido, para: 'atacante@evil.com' })
    assert.equal(res.status, 200)
    assert.deepEqual(enviados, [{ para: ['ventas@acme.com'], asunto: 'Pedido', texto: 'Hola, necesitamos cotización.' }])
  })

  it('rechaza sin sesión y con token inválido', async () => {
    const { deps, enviados } = montar()
    assert.equal((await pedir(deps, valido, null)).status, 403)
    assert.equal((await pedir(deps, valido, 'malo')).status, 403)
    assert.equal(enviados.length, 0)
  })

  it('rechaza método distinto de POST', async () => {
    assert.equal((await pedir(montar().deps, null, 'valido', 'GET')).status, 405)
  })

  it('exige edición en proveedores (lectura y ninguno no envían)', async () => {
    for (const nivel of ['lectura', 'ninguno', null]) {
      const { deps, enviados, lecturas } = montar({ nivel })
      assert.equal((await pedir(deps, valido)).status, 403)
      assert.equal(enviados.length, 0)
      assert.equal(lecturas.length, 0)
    }
  })

  it('proveedor de otra organización o inexistente: 404 sin enviar', async () => {
    const { deps, enviados } = montar({ proveedor: null })
    assert.equal((await pedir(deps, valido)).status, 404)
    assert.equal(enviados.length, 0)
  })

  it('proveedor sin correo: 422', async () => {
    const { deps, enviados } = montar({ proveedor: { razon_social: 'Acme', correo: null, activo: true } })
    assert.equal((await pedir(deps, valido)).status, 422)
    assert.equal(enviados.length, 0)
  })

  it('rechaza un proveedor inactivo y un correo cargado que no es una dirección válida', async () => {
    const inactivo = montar({ proveedor: { razon_social: 'Acme', correo: 'ventas@acme.com', activo: false } })
    assert.equal((await pedir(inactivo.deps, valido)).status, 422)
    assert.equal(inactivo.enviados.length, 0)
    for (const correo of ['sin-arroba', 'a@b', 'a@b.com, c@d.com', 'a@b.com\nBcc: x@y.com', 'a b@c.com', `${'a'.repeat(250)}@b.com`]) {
      const m = montar({ proveedor: { razon_social: 'Acme', correo, activo: true } })
      assert.equal((await pedir(m.deps, valido)).status, 422, correo)
      assert.equal(m.enviados.length, 0, correo)
    }
  })

  it('cupo agotado: 429 con Retry-After, sin enviar ni registrar', async () => {
    const { deps, enviados, cupos, eventos } = montar({ rechazoCupo: { status: 429, error: 'Demasiados correos', retryAfter: 1234 } })
    const res = await pedir(deps, valido)
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('Retry-After'), '1234')
    assert.deepEqual(await res.json(), { error: 'Demasiados correos' })
    assert.deepEqual(cupos, ['u1'])
    assert.equal(enviados.length, 0)
    assert.equal(eventos.length, 0)
  })

  it('cupo no verificable (falla cerrado): 503 sin Retry-After, sin enviar', async () => {
    const { deps, enviados } = montar({ rechazoCupo: { status: 503, error: 'No se pudo verificar tu cuota de uso.' } })
    const res = await pedir(deps, valido)
    assert.equal(res.status, 503)
    assert.equal(res.headers.get('Retry-After'), null)
    assert.equal(enviados.length, 0)
  })

  it('el cupo se consume una vez por pedido válido y solo después de validar todo', async () => {
    const ok = montar()
    assert.equal((await pedir(ok.deps, valido)).status, 200)
    assert.deepEqual(ok.cupos, ['u1'])
    const rechazados = [
      montar({ nivel: 'lectura' }), montar({ proveedor: null }), montar({ proveedor: { razon_social: 'A', correo: null, activo: true } }),
      montar({ proveedor: { razon_social: 'A', correo: 'ventas@acme.com', activo: false } }), montar({ proveedor: { razon_social: 'A', correo: 'sin-arroba', activo: true } }),
    ]
    for (const m of rechazados) {
      await pedir(m.deps, valido)
      assert.equal(m.cupos.length, 0)
    }
    const invalido = montar()
    await pedir(invalido.deps, { ...valido, asunto: '' })
    assert.equal(invalido.cupos.length, 0)
  })

  it('registra cada envío (usuario, proveedor y resultado) sin asunto ni cuerpo', async () => {
    const ok = montar()
    await pedir(ok.deps, valido)
    const roto = montar({ falloSmtp: true })
    await pedir(roto.deps, valido)
    assert.deepEqual(ok.eventos, [{ usuarioId: 'u1', proveedorId: ID, resultado: 'enviado' }])
    assert.deepEqual(roto.eventos, [{ usuarioId: 'u1', proveedorId: ID, resultado: 'fallido' }])
  })

  it('si falla el registro el correo igual sale (200) y el log no trae el error crudo', async () => {
    const { deps, enviados } = montar({ falloRegistro: true })
    const lineas = capturarErrores()
    try {
      const res = await pedir(deps, valido)
      assert.equal(res.status, 200)
      assert.equal(enviados.length, 1)
    } finally {
      lineas.restaurar()
    }
    assert.ok(lineas.textos.some((t) => t.includes('no se pudo registrar el envío')))
    assert.doesNotMatch(lineas.textos.join('\n'), /sk-secreta|registro caído/)
  })

  it('si falla el registro tras un fallo de SMTP la respuesta sigue siendo 502', async () => {
    const { deps } = montar({ falloSmtp: true, falloRegistro: true })
    const lineas = capturarErrores()
    try {
      assert.equal((await pedir(deps, valido)).status, 502)
    } finally {
      lineas.restaurar()
    }
  })

  it('valida proveedor_id, asunto y mensaje (vacíos, largos, tipos)', async () => {
    const largo = (n: number) => 'a'.repeat(n)
    for (const body of [
      { ...valido, proveedor_id: 'no-uuid' }, { ...valido, proveedor_id: undefined },
      { ...valido, asunto: '  ' }, { ...valido, asunto: largo(201) }, { ...valido, asunto: 5 },
      { ...valido, mensaje: '' }, { ...valido, mensaje: largo(5001) }, null,
    ]) {
      const { deps, enviados } = montar()
      assert.equal((await pedir(deps, body)).status, 400, JSON.stringify(body)?.slice(0, 60))
      assert.equal(enviados.length, 0)
    }
  })

  it('fronteras de longitud (n-1, n, n+1): asunto 200, mensaje 5000 y correo 254', async () => {
    const correoDe = (largo: number) => `${'a'.repeat(largo - '@acme.com'.length)}@acme.com`
    const casos: { nombre: string; cuerpo: Record<string, unknown>; correo?: string; esperado: number }[] = [
      ...[[199, 200], [200, 200], [201, 400]].map(([n, esperado]) => ({ nombre: `asunto de ${n}`, cuerpo: { ...valido, asunto: 'a'.repeat(n) }, esperado })),
      ...[[4999, 200], [5000, 200], [5001, 400]].map(([n, esperado]) => ({ nombre: `mensaje de ${n}`, cuerpo: { ...valido, mensaje: 'a'.repeat(n) }, esperado })),
      ...[[253, 200], [254, 200], [255, 422]].map(([n, esperado]) => ({ nombre: `correo de ${n}`, cuerpo: valido, correo: correoDe(n), esperado })),
    ]
    for (const { nombre, cuerpo, correo, esperado } of casos) {
      const { deps } = montar(correo ? { proveedor: { razon_social: 'Acme', correo, activo: true } } : {})
      assert.equal((await pedir(deps, cuerpo)).status, esperado, nombre)
    }
  })

  it('pasa el asunto tal cual al envío (el saneo de saltos de línea lo hace enviarPorSmtp/lineaSegura)', async () => {
    const { deps, enviados } = montar()
    await pedir(deps, { ...valido, asunto: 'Hola\r\nBcc: x@y.com' })
    assert.equal(enviados.length, 1)
    assert.equal(enviados[0].para.length, 1)
  })

  it('falla de SMTP: 502 con mensaje controlado, sin filtrar el error ni a la respuesta ni al log', async () => {
    const { deps } = montar({ falloSmtp: true })
    const lineas = capturarErrores()
    let res: Response
    try {
      res = await pedir(deps, valido)
    } finally {
      lineas.restaurar()
    }
    assert.equal(res.status, 502)
    assert.doesNotMatch(JSON.stringify(await res.json()), /smtp caído/)
    assert.deepEqual(lineas.textos, ['enviar-correo-proveedor: falló el envío Error'])
  })


  it('error al resolver permiso o proveedor: 502, y el log redacta URLs y credenciales de la base', async () => {
    const lineas = capturarErrores()
    try {
      assert.equal((await pedir(montar({ nivelError: true }).deps, valido)).status, 502)
      assert.equal((await pedir(montar({ proveedorError: true }).deps, valido)).status, 502)
    } finally {
      lineas.restaurar()
    }
    assert.equal(lineas.textos.length, 2)
    assert.match(lineas.textos[0], /no se pudo resolver el permiso/)
    assert.match(lineas.textos[1], /no se pudo leer el proveedor/)
    assert.doesNotMatch(lineas.textos.join('\n'), /postgres:\/\/|clave-secreta/)
  })
})
