import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { historiaDe, revisarSpec, revisarTodo, tieneDesvio } from './verificar-tareas-cerradas.mjs';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verificar-tareas-'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const spec = (nombre, tasksMd, sideCars = {}) => {
  const dirSpec = path.join(dir, nombre);
  fs.mkdirSync(path.join(dirSpec, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(dirSpec, 'tasks.md'), tasksMd);
  for (const [archivo, contenido] of Object.entries(sideCars)) {
    fs.writeFileSync(path.join(dirSpec, 'tasks', archivo), contenido);
  }
  return dirSpec;
};

describe('verificar-tareas-cerradas', () => {
  it('falla cuando el side-car ya marcó la tarea y el tasks.md quedó atrás', () => {
    const dirSpec = spec('demo', '- [ ] T001 [F-DEM-01][US1] Migración.\n', {
      'F-DEM-01.md': '- [x] T001\n',
    });
    const resultado = revisarSpec(dirSpec);
    assert.equal(resultado.faltantes.length, 1);
    assert.equal(resultado.faltantes[0].id, 'T001');
    assert.match(resultado.faltantes[0].motivo, /falta consolidar/);
  });

  it('pasa cuando el tasks.md ya está consolidado', () => {
    const dirSpec = spec('demo', '- [x] T001 [F-DEM-01][US1] Migración.\n', {
      'F-DEM-01.md': '- [x] T001\n',
    });
    assert.deepEqual(revisarSpec(dirSpec).faltantes, []);
  });

  it('pasa con una nota de desvío (deuda trazada)', () => {
    const dirSpec = spec('demo', '- [ ] T001 [F-DEM-01][US1] Migración. Desvío: la hizo otra historia.\n', {
      'F-DEM-01.md': '- [x] T001\n',
    });
    assert.deepEqual(revisarSpec(dirSpec).faltantes, []);
  });

  it('no confunde una desviación citada dentro del texto con una nota de desvío', () => {
    const dirSpec = spec('demo', '- [ ] T001 [F-DEM-01][US1] Cerrar con `Desvío: <motivo>` si no hay tiempo.\n', {
      'F-DEM-01.md': '- [x] T001\n',
    });
    assert.equal(revisarSpec(dirSpec).faltantes.length, 1);
  });

  it('lee la nota de desvío de la línea de continuación', () => {
    const dirSpec = spec(
      'demo',
      '- [ ] T001 [F-DEM-01][US1] Migración.\n  Hecho en local. Desvío: el CI lo valida.\n',
      { 'F-DEM-01.md': '- [x] T001\n' },
    );
    assert.deepEqual(revisarSpec(dirSpec).faltantes, []);
  });

  it('pasa con una spec cuya historia todavía no se cerró', () => {
    const dirSpec = spec('demo', '- [ ] T001 [F-DEM-01][US1] Migración.\n');
    const resultado = revisarSpec(dirSpec);
    assert.deepEqual(resultado.faltantes, []);
    assert.equal(resultado.abiertas, 1);
  });

  it('falla cuando la historia se cerró y dejó una tarea sin marcar', () => {
    const dirSpec = spec('demo', '- [x] T001 [F-DEM-01][US1] Migración.\n- [ ] T002 [F-DEM-01][US1] Otra.\n', {
      'F-DEM-01.md': '- [x] T001\n',
    });
    const resultado = revisarSpec(dirSpec);
    assert.equal(resultado.faltantes.length, 1);
    assert.equal(resultado.faltantes[0].id, 'T002');
    assert.match(resultado.faltantes[0].motivo, /F-DEM-01/);
  });

  it('revisarTodo recorre todos los specs del directorio', () => {
    spec('a', '- [ ] T001 [F-A-01][US1] Una.\n', { 'F-A-01.md': '- [x] T001\n' });
    spec('b', '- [ ] T001 [F-B-01][US1] Una.\n');
    const specs = revisarTodo(dir);
    assert.equal(specs.length, 2);
    assert.equal(specs.filter((s) => s.faltantes.length > 0).length, 1);
  });

  it('reconoce la historia que posee la tarea', () => {
    assert.equal(historiaDe('- [ ] T001 [P] [F-DEM-01][US1] Migración.'), 'F-DEM-01');
    assert.equal(historiaDe('- [ ] T070 [CIERRE] Documentación.'), 'CIERRE');
    assert.equal(historiaDe('- [ ] T001 [US1] Sin historia.'), null);
  });

  it('detecta la nota de desvío fuera del código', () => {
    assert.equal(tieneDesvio('Hecho. Desvío: otra historia lo hizo.'), true);
    assert.equal(tieneDesvio('Cerrar con `Desvío: <motivo>` si no hay tiempo.'), false);
  });
});
