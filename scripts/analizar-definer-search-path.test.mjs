import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analizarFuncion, limpiar } from './analizar-definer-search-path.mjs';

const cat = {
  relaciones: new Set(['usuarios', 'superadmins']),
  funcionesApp: new Set(['hash_correo']),
  tipos: new Set(['vector']),
};
const f = (cuerpo, argnames = []) => ({ cuerpo, argnames });

describe('analizarFuncion', () => {
  it('segura: todo calificado o de pg_catalog', () => {
    const r = analizarFuncion(f('begin insert into public.usuarios(a) values (now()); return jsonb_build_object(); end'), cat);
    assert.equal(r.segura, true);
  });
  it('detecta una relación sin calificar', () => {
    const r = analizarFuncion(f('select 1 from superadmins where user_id = auth.uid()'), cat);
    assert.deepEqual(r.hallazgos.map((h) => h.nombre), ['superadmins']);
  });
  it('detecta función de la app sin calificar, tipo y operador de extensión', () => {
    assert.equal(analizarFuncion(f('select hash_correo(x)'), cat).segura, false);
    assert.equal(analizarFuncion(f('select x::vector'), cat).segura, false);
    assert.equal(analizarFuncion(f('select a <=> b'), cat).segura, false);
  });
  it('SQL dinámico nunca es seguro', () => {
    assert.equal(analizarFuncion(f("execute 'select 1'"), cat).segura, false);
  });
  it('ignora lo que está en comentarios y literales', () => {
    assert.equal(analizarFuncion(f("-- from superadmins\nselect 'from superadmins'"), cat).segura, true);
    assert.equal(limpiar("select 'a' -- x"), "select ''  ");
  });
  it('una CTE con el nombre de una tabla no cuenta', () => {
    assert.equal(analizarFuncion(f('with usuarios as (select 1) select * from usuarios'), cat).segura, true);
  });
});
