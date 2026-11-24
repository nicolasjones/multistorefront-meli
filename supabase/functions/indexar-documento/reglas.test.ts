import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { puedeGestionarDocumentos } from './reglas.ts'

describe('puedeGestionarDocumentos (igual que private.puede_gestionar_documentos)', () => {
  it('los roles escritores sí; Consulta, otros roles y sin contexto no', () => {
    for (const rol of ['administrador', 'operador', 'mostrador', 'deposito', 'administracion', 'tecnico']) assert.equal(puedeGestionarDocumentos({ rol_efectivo: rol, es_superadmin: false, organizacion_id: 'org-1' }), true, rol)
    for (const rol of ['consulta', 'miembro', null]) assert.equal(puedeGestionarDocumentos({ rol_efectivo: rol, es_superadmin: false, organizacion_id: 'org-1' }), false, String(rol))
    assert.equal(puedeGestionarDocumentos(null), false)
  })
  it('un superadmin solo gestiona con una organización activa', () => {
    assert.equal(puedeGestionarDocumentos({ rol_efectivo: null, es_superadmin: true, organizacion_id: 'org-1' }), true)
    assert.equal(puedeGestionarDocumentos({ rol_efectivo: null, es_superadmin: true, organizacion_id: null }), false)
    assert.equal(puedeGestionarDocumentos({ rol_efectivo: 'administrador', es_superadmin: true }), false)
  })
})
