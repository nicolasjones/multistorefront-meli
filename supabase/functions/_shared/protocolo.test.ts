import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { protocoloTienda } from './protocolo.ts'

describe('protocoloTienda (MSF-726)', () => {
  it('sin la variable explícita el esquema es https', () => {
    assert.equal(protocoloTienda(undefined), 'https')
    assert.equal(protocoloTienda(''), 'https')
  })
  it('SUPABASE_URL=http://kong:8000 ya no incide: el esquema sigue siendo https', () => {
    // La decisión no recibe SUPABASE_URL; en STG/PRD solo existe esa URL interna, sin ALLOW_HTTP_REDIRECT.
    assert.equal(protocoloTienda(undefined), 'https')
  })
  it('valores distintos de true no habilitan http', () => {
    for (const v of ['false', '0', 'yes', '1']) assert.equal(protocoloTienda(v), 'https')
  })
  it('ALLOW_HTTP_REDIRECT=true (desarrollo local) habilita http', () => {
    assert.equal(protocoloTienda('true'), 'http')
    assert.equal(protocoloTienda(' TRUE '), 'http')
  })
})
