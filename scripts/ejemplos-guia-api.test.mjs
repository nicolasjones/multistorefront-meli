// Pruebas del código de verificación de firma que publica la guía (docs/api/inicio-rapido.md, F-API-01, MSF-233).
// Extrae las funciones de la PROPIA página y las ejecuta contra `firmar()` de `entregar-webhook`, así la guía no puede
// publicar un ejemplo que no funcione. Corre con `node --test`.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import { firmar } from '../supabase/functions/entregar-webhook/handler.ts'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
// El código de la guía vive dentro de pestañas (sangría de 4): se quita para poder ejecutarlo.
const guia = readFileSync(join(RAIZ, 'docs/api/inicio-rapido.md'), 'utf8')
  .split('\n')
  .map((linea) => linea.replace(/^ {4}/, ''))
  .join('\n')

const SECRETO = 'secreto-de-prueba-0123456789abcdef'
const CUERPO = JSON.stringify({ id: 'b8d1', tipo: 'stock.actualizado', datos: { cantidad: 3, nombre: 'Señal ñ' } })
const AHORA = 1_800_000_000
const casos = [
  { nombre: 'firma válida y reciente', cabecera: firmar(CUERPO, SECRETO, AHORA), cuerpo: CUERPO, ahora: AHORA, esperado: true },
  { nombre: 'cuerpo alterado', cabecera: firmar(CUERPO, SECRETO, AHORA), cuerpo: `${CUERPO} `, ahora: AHORA, esperado: false },
  { nombre: 'secreto ajeno', cabecera: firmar(CUERPO, 'otro-secreto', AHORA), cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 'aviso viejo (más de 300 s)', cabecera: firmar(CUERPO, SECRETO, AHORA - 301), cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 'cabecera ausente', cabecera: null, cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 'cabecera sin formato', cabecera: 'basura', cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 't que no es número', cabecera: 't=abc,v1=00', cuerpo: CUERPO, ahora: AHORA, esperado: false },
  // Durante la rotación de un secreto el aviso lleva dos firmas (nueva y anterior): el receptor, con el secreto que tenga, valida.
  { nombre: 'rotación: receptor con el secreto nuevo', cabecera: firmar(CUERPO, SECRETO, AHORA, 'secreto-viejo'), cuerpo: CUERPO, ahora: AHORA, esperado: true },
  { nombre: 'rotación: receptor que todavía tiene el secreto anterior', cabecera: firmar(CUERPO, SECRETO, AHORA, 'secreto-viejo'), cuerpo: CUERPO, ahora: AHORA, secreto: 'secreto-viejo', esperado: true },
  { nombre: 'rotación: receptor con un secreto ajeno', cabecera: firmar(CUERPO, SECRETO, AHORA, 'secreto-viejo'), cuerpo: CUERPO, ahora: AHORA, secreto: 'otro-secreto', esperado: false },
  { nombre: 'rotación: cuerpo alterado', cabecera: firmar(CUERPO, SECRETO, AHORA, 'secreto-viejo'), cuerpo: `${CUERPO} `, ahora: AHORA, esperado: false },
  { nombre: 'rotación: aviso viejo', cabecera: firmar(CUERPO, SECRETO, AHORA - 301, 'secreto-viejo'), cuerpo: CUERPO, ahora: AHORA, esperado: false },
  // Cabeceras malformadas con una `t` y una `v1` presentes: tienen que dar `false`, nunca un error del servidor.
  { nombre: 'una parte sin `=` después de las firmas', cabecera: `${firmar(CUERPO, SECRETO, AHORA)},basura`, cuerpo: CUERPO, ahora: AHORA, esperado: true },
  { nombre: 'una parte sin `=` y firma ajena', cabecera: `t=${AHORA},v1=00,basura`, cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 'coma final', cabecera: `t=${AHORA},v1=00,`, cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 'parte vacía en el medio', cabecera: `t=${AHORA},,v1=00`, cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 't con un `=` de más', cabecera: `t=${AHORA}=basura,v1=00`, cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 'v1 con un `=` de más no se trunca para coincidir', cabecera: `${firmar(CUERPO, SECRETO, AHORA)}=cd`, cuerpo: CUERPO, ahora: AHORA, esperado: false },
  { nombre: 'v1 con caracteres multibyte del mismo largo en caracteres', cabecera: `t=${AHORA},v1=${'é'.repeat(64)}`, cuerpo: CUERPO, ahora: AHORA, esperado: false },
]

describe('código de verificación de firma de la guía', () => {
  it('Node.js: valida la firma real y rechaza lo demás sin lanzar', () => {
    const codigo = guia.match(/function firmaValida[\s\S]*?\n}\n/)?.[0]
    assert.ok(codigo, 'no se encontró firmaValida en la guía')
    const firmaValida = new Function('crypto', 'SECRETO', 'TOLERANCIA_SEGUNDOS', `${codigo}\nreturn firmaValida`)(crypto, SECRETO, 300)
    for (const caso of casos) {
      assert.equal(firmaValida(caso.cabecera, caso.cuerpo, caso.secreto ?? SECRETO, caso.ahora), caso.esperado, caso.nombre)
    }
  })

  it('Python: valida la firma real y rechaza lo demás sin lanzar', (t) => {
    if (spawnSync('python3', ['--version']).status !== 0) return t.skip('no hay python3 en este entorno')
    const codigo = guia.match(/def firma_valida[\s\S]*?\n\n/)?.[0]
    assert.ok(codigo, 'no se encontró firma_valida en la guía')
    const programa = [
      'import hashlib, hmac, json, sys, time',
      `SECRETO = ${JSON.stringify(SECRETO)}.encode()`,
      'TOLERANCIA_SEGUNDOS = 300',
      codigo,
      'casos = json.load(sys.stdin)',
      'print(json.dumps([firma_valida(c["cabecera"], c["cuerpo"].encode(), c.get("secreto", SECRETO.decode()).encode(), c["ahora"]) for c in casos]))',
    ].join('\n')
    const salida = spawnSync('python3', ['-I', '-c', programa], { input: JSON.stringify(casos), encoding: 'utf8' })
    assert.equal(salida.status, 0, salida.stderr)
    assert.deepEqual(JSON.parse(salida.stdout), casos.map((caso) => caso.esperado))
  })
})
