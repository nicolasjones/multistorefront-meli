import assert from 'node:assert/strict';
import test from 'node:test';
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

test('validarLargoClave rechaza claves cortas sin imprimir la clave', () => {
  for (const corta of ['', 'a', 'ab', 'abc', '1234567']) {
    assert.throws(
      () => validarLargoClave(corta),
      (error) => /demasiado corta/.test(error.message) && !(corta && error.message.includes(`${corta} `)) && error.message.includes(String(LARGO_MINIMO_CLAVE)),
    );
  }
});

test('validarLargoClave acepta claves de 8 o más caracteres', () => {
  assert.doesNotThrow(() => validarLargoClave('12345678'));
  assert.doesNotThrow(() => validarLargoClave('sk-larga-de-verdad-123'));
});

test('el script rechaza una clave corta antes de tocar Docker y sin eco de la clave', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['infra/ia/aprovisionar-proveedores.mjs'], {
    env: { ...process.env, IA_PROVEEDOR_CODIGO: 'openai', IA_PROVEEDOR_CREDENCIAL: 'x', IA_PROVEEDOR_CLAVE: 'zq7', SUPABASE_DB_CONTAINER: 'no-existe' },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /demasiado corta/);
  assert.ok(!r.stderr.includes('zq7'));
});
