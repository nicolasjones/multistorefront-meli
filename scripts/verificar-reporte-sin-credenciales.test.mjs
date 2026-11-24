// El control que frena la subida del reporte de la medición si lleva una credencial: tiene que fallar con ellas,
// pasar con los resúmenes legítimos y no imprimir nunca lo que encontró.
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { motivos, revisar } from './verificar-reporte-sin-credenciales.mjs';

const script = path.join(import.meta.dirname, 'verificar-reporte-sin-credenciales.mjs');
const legitimo = `| Mundo JC · catálogo | http://mundojc.localhost:4312/catalogo | 3 | 10866 ms | 9304 ms | 0.215 | 223 ms | 42 | 100 |
catalogo relevancia -> mediana 19 ms · corridas {26,19,19,20,19} · productos en la pagina 24 · total 500`;

function archivo(contenido) {
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'rep-')), 'resumen.md');
  writeFileSync(f, contenido);
  return f;
}

describe('control de credenciales del reporte de la medición', () => {
  it('un resumen legítimo no da falso positivo', () => {
    assert.deepEqual(motivos(legitimo), []);
    assert.deepEqual(revisar([archivo(legitimo)]), []);
  });

  for (const [caso, texto] of [
    ['un JWT', 'eyJhbGciOiJIUzI1NiJ9.AAAAAAAAAAAA.BBBBBBBBBBBB'],
    ['un token firmado en una URL', 'https://x/storage/v1/object/sign/a.png?token=abc'],
    ['una cabecera Authorization', 'Authorization: algo'],
    ['apiKey en otra capitalización', 'apiKey=123'],
    ['una clave sb_secret_', 'sb_secret_abc'],
    ['una firma de URL', 'X-Amz-Signature=abc'],
    ['la palabra password', 'password: x'],
  ]) {
    it(`falla con ${caso}`, () => {
      assert.ok(motivos(texto).length > 0, caso);
      assert.equal(revisar([archivo(`${legitimo}\n${texto}`)]).length, 1);
    });
  }

  it('ignora un archivo que no existe', () => {
    assert.deepEqual(revisar(['/no/existe/resumen.md']), []);
  });

  it('el proceso sale 1 con una credencial y no la imprime', () => {
    const secreto = 'eyJhbGciOiJIUzI1NiJ9.AAAAAAAAAAAA.BBBBBBBBBBBB';
    const r = spawnSync('node', [script, archivo(secreto)], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.ok(!(r.stdout + r.stderr).includes(secreto), 'no tiene que dejar la credencial en el log');
    assert.match(r.stderr, /JWT/);
  });

  it('el proceso sale 0 con un reporte limpio', () => {
    assert.equal(spawnSync('node', [script, archivo(legitimo)]).status, 0);
  });
});
