// Pruebas del cableado del cupo de `enviar-correo-proveedor`. Corre con `node --test` (`pnpm test:edge:enviar-correo-proveedor`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearConsumirCupo } from './cupo.ts'

// El entorno falso solo responde por la variable real: otro nombre devuelve undefined.
const entorno = (valor?: string) => (clave: string) => (clave === 'CORREO_PROVEEDOR_LIMITE_HORA' ? valor : undefined)

function admin(fila: Record<string, unknown>) {
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = []
  return { llamadas, cliente: { rpc: async (nombre: string, args: Record<string, unknown>) => { llamadas.push({ nombre, args }); return { data: [fila], error: null } } } }
}

describe('crearConsumirCupo', () => {
  it('sin ENV usa el defecto 20 y la funcionalidad correo-proveedor; con cupo deja pasar', async () => {
    const { cliente, llamadas } = admin({ se_consumio: true, usos_actuales: 1, segundos_hasta_reinicio: 60 })
    assert.equal(await crearConsumirCupo(() => cliente, entorno())('u1'), null)
    assert.deepEqual(llamadas, [{ nombre: 'consumir_cupo_ia', args: { p_usuario: 'u1', p_funcionalidad: 'correo-proveedor', p_limite: 20 } }])
  })

  it('el ENV válido (1..1000) cambia el tope; uno inválido vuelve a 20', async () => {
    for (const [env, esperado] of [['1', 1], ['1000', 1000], ['1001', 20], ['0', 20], ['abc', 20]] as const) {
      const { cliente, llamadas } = admin({ se_consumio: true })
      await crearConsumirCupo(() => cliente, entorno(env))('u1')
      assert.equal(llamadas[0].args.p_limite, esperado, env)
    }
  })

  it('cupo agotado: 429 con el texto propio y Retry-After', async () => {
    const { cliente } = admin({ se_consumio: false, usos_actuales: 20, segundos_hasta_reinicio: 90 })
    assert.deepEqual(await crearConsumirCupo(() => cliente, entorno())('u1'), { status: 429, error: 'Enviaste demasiados correos en poco tiempo. Probá de nuevo más tarde.', retryAfter: 90 })
  })

  it('si falla crear el cliente admin: 503 sin llamar a la RPC y sin filtrar el error', async () => {
    const original = console.error
    const lineas: string[] = []
    console.error = (...a: unknown[]) => { lineas.push(a.map(String).join(' ')) }
    try {
      const r = await crearConsumirCupo(() => { throw new Error('supabaseKey is required: sk-secreta') }, entorno())('u1')
      assert.deepEqual(r, { status: 503, error: 'No se pudo verificar tu cuota de uso.' })
    } finally {
      console.error = original
    }
    assert.deepEqual(lineas, ['enviar-correo-proveedor: no se pudo crear el cliente del cupo'])
  })

  it('si la RPC falla: 503 (falla cerrado)', async () => {
    const cliente = { rpc: async () => ({ data: null, error: { message: 'boom', code: 'XX000' } }) }
    const original = console.error
    console.error = () => undefined
    try {
      assert.equal((await crearConsumirCupo(() => cliente, entorno())('u1'))?.status, 503)
    } finally {
      console.error = original
    }
  })
})
