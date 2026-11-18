import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { correrControles, evaluar } from './verificar-higiene-base.mjs';

describe('verificar-higiene-base.evaluar', () => {
  it('marca falla cuando un control que debe ser 0 no lo es', () => {
    const r = evaluar([{ control: 'fk_sin_indice', cantidad: 3, detalle: 'x' }]);
    assert.equal(r[0].ok, false);
  });
  it('acepta el valor esperado y los controles informativos', () => {
    const r = evaluar([
      { control: 'vistas_definer_permitidas', cantidad: 1, detalle: '' },
      { control: 'migraciones_registradas', cantidad: 753, detalle: '' },
    ]);
    assert.deepEqual(r.map((x) => x.ok), [true, true]);
  });
  it('una vista definer de más rompe el control', () => {
    assert.equal(evaluar([{ control: 'vistas_definer_permitidas', cantidad: 2, detalle: '' }])[0].ok, false);
  });
});

describe('verificar-higiene-base.correrControles', () => {
  const base = ['SET', 'fk_sin_indice|0|', 'tablas_sin_pk|0|'];
  it('sin el esquema supabase_migrations no corre los controles del registro y conserva los demás', () => {
    const llamadas = [];
    const consultar = (sql) => {
      llamadas.push(sql);
      if (sql.includes('to_regclass')) return ['f'];
      if (sql === 'BASE') return base;
      throw new Error('no debe consultar el registro de migraciones');
    };
    const { filas, hayRegistro } = correrControles(consultar, 'BASE', 'MIGRACIONES');
    assert.equal(hayRegistro, false);
    assert.deepEqual(filas.map((f) => f.control), ['fk_sin_indice', 'tablas_sin_pk']);
    assert.equal(llamadas.includes('MIGRACIONES'), false);
  });
  it('con el esquema presente suma los controles del registro', () => {
    const consultar = (sql) => {
      if (sql.includes('to_regclass')) return ['t'];
      if (sql === 'BASE') return [...base];
      return ['migraciones_registradas|759|', 'migraciones_nombre_vacio|0|'];
    };
    const { filas, hayRegistro } = correrControles(consultar, 'BASE', 'MIGRACIONES');
    assert.equal(hayRegistro, true);
    assert.equal(filas.length, 4);
    assert.equal(evaluar(filas).every((f) => f.ok), true);
  });
  it('el control de CREATE sobre public falla si anon o authenticated lo tienen', () => {
    assert.equal(evaluar([{ control: 'anon_authenticated_create_en_public', cantidad: 1, detalle: '' }])[0].ok, false);
  });
});
