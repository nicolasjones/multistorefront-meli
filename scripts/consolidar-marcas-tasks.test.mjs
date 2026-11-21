import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  consolidarContenido,
  consolidarSpec,
  EVIDENCIA,
  marcasDeSideCars,
  leerTareas,
} from './consolidar-marcas-tasks.mjs';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'consolidar-marcas-'));
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

describe('consolidar-marcas-tasks', () => {
  it('vuelca al tasks.md la marca [x] del side-car y deja el texto de la línea', () => {
    const dirSpec = spec('demo', '- [ ] T001 [P] Migración `x.sql`: RPC.\n', {
      'F-DEM-01.md': '# Marcas de F-DEM-01\n\n- [x] T001\n',
    });
    const resultado = consolidarSpec(dirSpec);
    assert.equal(resultado.cerradas.length, 1);
    assert.equal(resultado.cerradas[0].id, 'T001');
    const tasks = fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8');
    assert.match(tasks, /^- \[x\] T001 \[P\] Migración `x\.sql`: RPC\./);
    assert.match(tasks, /Evidencia: marca de cierre en `tasks\/F-DEM-01\.md`\./);
  });

  it('vuelca la marca también cuando el id va en negrita (`- [ ] **T001**`)', () => {
    const dirSpec = spec('demo', '- [ ] **T001** Migración.\n', { 'F-DEM-01.md': '- [x] T001\n' });
    const resultado = consolidarSpec(dirSpec);
    assert.equal(resultado.cerradas.length, 1);
    const tasks = fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8');
    assert.match(tasks, /^- \[x\] \*\*T001\*\* Migración\./);
    assert.match(tasks, /Evidencia: marca de cierre en `tasks\/F-DEM-01\.md`\./);
  });

  it('no confunde una sub-tarea con su tarea madre (T022a no es T022)', () => {
    const dirSpec = spec('demo', '- [ ] T022 Madre.\n- [ ] T022a Sub-tarea.\n', {
      'F-DEM-01.md': '- [x] T022\n',
    });
    const resultado = consolidarSpec(dirSpec);
    assert.deepEqual(resultado.cerradas.map((c) => c.id), ['T022']);
    const tasks = fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8');
    assert.match(tasks, /^- \[x\] T022 Madre\./);
    assert.match(tasks, /^- \[ \] T022a Sub-tarea\./m);
  });

  it('lee el id de una sub-tarea completo (T022a ≠ T022)', () => {
    const tareas = leerTareas('- [ ] T022 Madre.\n- [ ] T022a Sub-tarea.\n');
    assert.deepEqual(tareas.map((t) => t.id), ['T022', 'T022A']);
  });

  it('no cierra una tarea que ningún side-car marcó', () => {
    const dirSpec = spec('demo', '- [ ] T001 Pendiente.\n', { 'F-DEM-01.md': '- [x] T002\n' });
    const resultado = consolidarSpec(dirSpec);
    assert.equal(resultado.cerradas.length, 0);
    assert.deepEqual(resultado.sinRespaldo, ['T001']);
    assert.equal(fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8'), '- [ ] T001 Pendiente.\n');
  });

  it('nunca vuelve [x] a [ ] ni toca una tarea ya cerrada', () => {
    const dirSpec = spec('demo', '- [x] T001 Hecha.\n', { 'F-DEM-01.md': '- [x] T001\n' });
    const resultado = consolidarSpec(dirSpec);
    assert.equal(resultado.cerradas.length, 0);
    assert.equal(fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8'), '- [x] T001 Hecha.\n');
  });

  it('es idempotente: la segunda corrida no cambia el archivo', () => {
    const dirSpec = spec('demo', '- [ ] T001 Pendiente.\n', { 'F-DEM-01.md': '- [x] T001\n' });
    consolidarSpec(dirSpec);
    const primera = fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8');
    const segunda = consolidarSpec(dirSpec);
    assert.equal(segunda.cerradas.length, 0);
    assert.equal(segunda.cambio, false);
    assert.equal(fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8'), primera);
  });

  it('no duplica la evidencia si la línea ya la tiene', () => {
    const contenido = `- [ ] T001 Hecha. Evidencia: marca de cierre en \`tasks/F-DEM-01.md\`.\n`;
    const { contenido: salida } = consolidarContenido(contenido, new Map([['T001', ['F-DEM-01.md']]]));
    assert.equal(salida.match(/Evidencia: marca de cierre/g).length, 1);
  });

  it('consolida todas las tareas marcadas en el side-car', () => {
    const dirSpec = spec('demo', '- [ ] T001 Uno.\n- [ ] T002 Dos.\n- [ ] T003 Tres.\n', {
      'F-DEM-01.md': '- [x] T001\n- [x] T002\n',
      'CIERRE.md': '- [x] T003\n',
    });
    const resultado = consolidarSpec(dirSpec);
    assert.equal(resultado.cerradas.length, 3);
    assert.deepEqual(
      resultado.cerradas.map((c) => c.id),
      ['T001', 'T002', 'T003'],
    );
    const tareas = leerTareas(fs.readFileSync(path.join(dirSpec, 'tasks.md'), 'utf8'));
    assert.deepEqual(
      tareas.map((t) => t.hecha),
      [true, true, true],
    );
  });

  it('lee las marcas de todos los side-car de la spec', () => {
    const dirSpec = spec('demo', '- [ ] T001 Uno.\n', {
      'F-DEM-01.md': '- [x] T001\n',
      'F-DEM-02.md': '- [ ] T002\n',
    });
    const marcas = marcasDeSideCars(path.join(dirSpec, 'tasks'));
    assert.deepEqual([...marcas.keys()], ['T001']);
    assert.deepEqual(marcas.get('T001'), ['F-DEM-01.md']);
  });

  it('reconoce la evidencia que dejó una consolidación anterior', () => {
    assert.ok(EVIDENCIA.test('- [x] T001 Hecha. Evidencia: marca de cierre en `tasks/F-DEM-01.md`.'));
    assert.equal(EVIDENCIA.test('- [x] T001 Hecha.'), false);
  });
});
