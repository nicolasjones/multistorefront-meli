import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { protocoloTienda } from './protocolo.ts'

// Entorno tal como llega a la función en STG/PRD: la URL interna del gateway (`http://kong:8000`) y nada de
// `ALLOW_HTTP_REDIRECT`. El esquema tiene que ser https (MSF-726).
const entornoStgPrd = {
  SUPABASE_URL: 'http://kong:8000',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  GOTRUE_API_HOST: 'http://kong:8000',
}

describe('protocoloTienda (MSF-726)', () => {
  it('en STG/PRD (SUPABASE_URL=http://kong:8000) el esquema sigue siendo https', () => {
    assert.equal(protocoloTienda(entornoStgPrd), 'https')
  })

  it('ningún host de SUPABASE_URL habilita http: el esquema ya no se deduce de la URL', () => {
    assert.equal(protocoloTienda({ SUPABASE_URL: 'http://localhost:54321' }), 'https')
    assert.equal(protocoloTienda({ SUPABASE_URL: 'http://127.0.0.1:8000' }), 'https')
    assert.equal(protocoloTienda({ SUPABASE_URL: 'http://host.docker.internal:8000' }), 'https')
    assert.equal(protocoloTienda({ SUPABASE_URL: 'http://kong:8000' }), 'https')
  })

  it('sin la variable explícita el esquema es https', () => {
    assert.equal(protocoloTienda({}), 'https')
    assert.equal(protocoloTienda({ ALLOW_HTTP_REDIRECT: undefined }), 'https')
    assert.equal(protocoloTienda({ ALLOW_HTTP_REDIRECT: '' }), 'https')
  })

  it('solo el valor true habilita http', () => {
    for (const valor of ['false', '0', '1', 'yes', 'no', 'http']) {
      assert.equal(protocoloTienda({ ALLOW_HTTP_REDIRECT: valor }), 'https', `valor: ${valor}`)
    }
  })

  it('ALLOW_HTTP_REDIRECT=true (desarrollo local) habilita http', () => {
    assert.equal(protocoloTienda({ ALLOW_HTTP_REDIRECT: 'true' }), 'http')
    assert.equal(protocoloTienda({ ALLOW_HTTP_REDIRECT: ' TRUE ' }), 'http')
    assert.equal(protocoloTienda({ ALLOW_HTTP_REDIRECT: 'True' }), 'http')
  })
})
