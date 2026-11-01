// Pruebas de `armarContexto` (MSF-725). Corre con `node --test` (`pnpm test:edge:preguntar-documentos`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { armarContexto } from './contexto.ts'

describe('preguntar-documentos: armarContexto', () => {
  it('incluye el texto de cada fragmento recuperado, separados, dentro del delimitador de contenido no confiable', () => {
    const contexto = armarContexto([{ texto: 'El plazo de entrega es de 5 días.' }, { texto: 'Se aceptan devoluciones.' }])
    assert.ok(contexto)
    assert.match(contexto, /El plazo de entrega es de 5 días\.\n\n---\n\nSe aceptan devoluciones\./)
    assert.match(contexto, /<datos-no-confiables nonce="[0-9a-f-]+">/)
  })

  it('devuelve null si ningún fragmento trae texto, para no pagar la generación con un contexto vacío', () => {
    assert.equal(armarContexto([{ texto: '' }, { texto: '   ' }, {}]), null)
  })

  it('ignora los fragmentos sin texto y conserva los demás', () => {
    const contexto = armarContexto([{ texto: '' }, { texto: 'dato útil' }])
    assert.match(contexto ?? '', /dato útil/)
    assert.doesNotMatch(contexto ?? '', /---/)
  })
})
