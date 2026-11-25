import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { LARGO_MINIMO_CLAVE, escaparCopy, ocultarClave, validarLargoClave } from './copy-clave.mjs';

const claves = ['a\\b', 'a\tb', 'a\rb', 'a\nb', '\\.', 'x\n\\.\ny', `co"mi'llas`, 'ñandú-日本-😀', 'plana-123', 'mix\\\t\r\n\\.'];

// Desescape de COPY formato texto: lo que PostgreSQL reconstruiría desde la línea enviada.
const desescapar = (linea) => linea.replace(/\\([\\nrt])/g, (_, c) => ({ '\\': '\\', n: '\n', r: '\r', t: '\t' })[c]);

for (const clave of claves) {
  test(`escaparCopy(${JSON.stringify(clave)}) es una sola fila, una columna y no cierra el COPY`, () => {
    const linea = escaparCopy(clave);
    assert.ok(!/[\n\r\t]/.test(linea), 'sin saltos ni tabs crudos');
    assert.notEqual(linea, '\\.', 'no puede ser el terminador');
    assert.equal(desescapar(linea), clave, 'ida y vuelta idéntica');
  });

  test(`ocultarClave(${JSON.stringify(clave)}) no deja ni la forma cruda ni la escapada`, () => {
    const cruda = `falló: ${clave} fin`;
    const contexto = `CONTEXT:  COPY ia_clave_tmp, line 1: "${escaparCopy(clave)}"`;
    for (const mensaje of [cruda, contexto, `${cruda}\n${contexto}`]) {
      const salida = ocultarClave(mensaje, clave);
      assert.ok(!salida.includes(clave), 'sin forma cruda');
      assert.ok(!salida.includes(escaparCopy(clave)), 'sin forma escapada');
      assert.ok(salida.includes('[clave omitida]'));
    }
  });
}

test('ocultarClave deja intacto un mensaje sin la clave', () => {
  assert.equal(ocultarClave('error genérico', 'secreta'), 'error genérico');
});

const MENSAJE_CORTA = `IA_PROVEEDOR_CLAVE es demasiado corta: debe tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`;

test('validarLargoClave rechaza claves cortas con el mensaje exacto, sin eco de la clave', () => {
  for (const corta of ['', 'a', 'ab', 'abc', '1234567']) {
    assert.throws(() => validarLargoClave(corta), (error) => error.message === MENSAJE_CORTA);
  }
});

test('validarLargoClave acepta claves de 8 o más caracteres', () => {
  assert.doesNotThrow(() => validarLargoClave('12345678'));
  assert.doesNotThrow(() => validarLargoClave('sk-larga-de-verdad-123'));
});

test('el script rechaza una clave corta antes de tocar Docker y sin eco de la clave', () => {
  const script = fileURLToPath(new URL('./aprovisionar-proveedores.mjs', import.meta.url));
  for (const corta of ['', 'a', 'ab', 'abc', 'zq7', '1234567']) {
    const r = spawnSync(process.execPath, [script], {
      cwd: tmpdir(),
      env: { ...process.env, IA_PROVEEDOR_CODIGO: 'openai', IA_PROVEEDOR_CREDENCIAL: 'x', IA_PROVEEDOR_CLAVE: corta, SUPABASE_DB_CONTAINER: 'no-existe' },
      encoding: 'utf8',
    });
    assert.notEqual(r.status, 0);
    // La clave vacía ya la rechaza `requireEnvironment` (variable ausente); las demás, la validación de largo.
    const esperado = corta === '' ? 'Falta la variable de entorno requerida IA_PROVEEDOR_CLAVE.' : MENSAJE_CORTA;
    assert.ok(r.stderr.includes(esperado), `clave de ${corta.length} caracteres: ${r.stderr}`);
  }
});
