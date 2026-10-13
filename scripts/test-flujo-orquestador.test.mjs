import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCUMENTO = path.join(RAIZ, 'docs', 'test-flujo-orquestador.md');
const LINEA = 'Prueba del flujo del orquestador (MSF-480) — borrar.';

function verificarDocumento(ruta) {
  assert.ok(existsSync(ruta), `falta el documento ${ruta}`);
  const lineas = readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea.trim() !== '');
  assert.equal(lineas.length, 1, 'el documento debe tener una única línea de texto no vacía');
  assert.equal(lineas[0], LINEA);
}

test('el documento de prueba existe y contiene la línea esperada', () => {
  verificarDocumento(DOCUMENTO);
});

test('la verificación falla si el documento falta o está vacío', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flujo-orquestador-'));
  try {
    const vacio = path.join(dir, 'vacio.md');
    writeFileSync(vacio, '\n');
    assert.throws(() => verificarDocumento(path.join(dir, 'ausente.md')), /falta el documento/);
    assert.throws(() => verificarDocumento(vacio), /única línea/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
