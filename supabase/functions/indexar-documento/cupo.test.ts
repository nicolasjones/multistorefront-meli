// Pruebas del cableado del cupo de `indexar-documento`. Corre con `node --test` (`pnpm test:edge:indexar-documento`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { capturarLog, errorHostil } from '../_shared/capturar-log.ts'
import { crearConsumirCupo } from './cupo.ts'

// El entorno falso solo responde por la variable real: cualquier otro nombre devuelve undefined (una variable mal escrita en cupo.ts
// dejaría el defecto y el test de límites en rojo).
const entorno = (valor?: string) => (clave: string) => (clave === 'INDEXAR_DOCUMENTO_LIMITE_HORA' ? valor : undefined)

function admin(fila: Record<string, unknown>) {
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = []
  return { llamadas, cliente: { rpc: async (nombre: string, args: Record<string, unknown>) => { llamadas.push({ nombre, args }); return { data: [fila], error: null } } } }
}

describe('crearConsumirCupo (indexar-documento)', () => {
  it('sin ENV usa el defecto 20 y la funcionalidad indexar-documento; con cupo deja pasar', async () => {
    const { cliente, llamadas } = admin({ se_consumio: true, usos_actuales: 1, segundos_hasta_reinicio: 60 })
    assert.equal(await crearConsumirCupo(() => cliente, entorno())('u1'), null)
    assert.deepEqual(llamadas, [{ nombre: 'consumir_cupo_ia', args: { p_usuario: 'u1', p_funcionalidad: 'indexar-documento', p_limite: 20 } }])
  })

  // Fronteras del rango 1..1000 en UNA tabla (n-1 / n / n+1 en cada extremo); el valor no entero o no numérico vuelve al defecto 20.
  it('el ENV: 1..1000 cambia el tope; 0, 1001, decimal, negativo y no numérico vuelven a 20', async () => {
    const tabla: [string | undefined, number][] = [
      ['0', 20], ['1', 1], ['2', 2], ['999', 999], ['1000', 1000], ['1001', 20],
      ['2.5', 20], ['-3', 20], ['abc', 20], ['', 20], [undefined, 20],
    ]
    for (const [env, esperado] of tabla) {
      const { cliente, llamadas } = admin({ se_consumio: true })
      await crearConsumirCupo(() => cliente, entorno(env))('u1')
      assert.equal(llamadas[0].args.p_limite, esperado, String(env))
    }
  })

  it('cupo agotado: 429 con el texto literal y Retry-After en segundos', async () => {
    const { cliente } = admin({ se_consumio: false, usos_actuales: 20, segundos_hasta_reinicio: 90 })
    assert.deepEqual(await crearConsumirCupo(() => cliente, entorno())('u1'), { status: 429, error: 'Indexaste demasiados documentos en poco tiempo. Probá de nuevo más tarde.', retryAfter: 90 })
  })

  it('si falla crear el cliente admin: 503 literal sin llamar a la RPC y sin filtrar el error', async () => {
    const { resultado, lineas } = await capturarLog(() => crearConsumirCupo(() => { throw errorHostil() }, entorno())('u1'))
    assert.deepEqual(resultado, { status: 503, error: 'No se pudo verificar tu cuota de uso.' })
    assert.deepEqual(lineas, ['indexar-documento: no se pudo crear el cliente del cupo'])
  })

  it('si la RPC devuelve un error o lanza: 503 (falla cerrado) y el log no trae el mensaje', async () => {
    const conError = { rpc: async () => ({ data: null, error: { message: 'boom sk-secreta-0123456789', code: 'XX000' } }) }
    const a = await capturarLog(() => crearConsumirCupo(() => conError, entorno())('u1'))
    assert.deepEqual(a.resultado, { status: 503, error: 'No se pudo verificar tu cuota de uso.' })
    assert.doesNotMatch(a.lineas.join('\n'), /sk-secreta/)

    const lanza = { rpc: async () => { throw errorHostil() } }
    const b = await capturarLog(() => crearConsumirCupo(() => lanza, entorno())('u1'))
    assert.deepEqual(b.resultado, { status: 503, error: 'No se pudo verificar tu cuota de uso.' })
    assert.doesNotMatch(b.lineas.join('\n'), /sk-secreta|example\.com/)
  })
})
