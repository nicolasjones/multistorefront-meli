// MSF-854: los cuatro pasos manuales de infraestructura de VPS2 quedan escritos y verificables
// en docs/pasos-manuales-vps2.md. El test fija los comandos exactos (que se ejecutan a mano
// en el VPS2) para que la página no se desvíe del procedimiento que pidió la historia, y
// exige que cada paso tenga verificación y reversión.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url), 'utf8');
const doc = leer('docs/pasos-manuales-vps2.md');

// El sitio de docs se arma desde `main` con `mkdocs build --strict`: un enlace a un
// archivo que no exista en `main` aborta el build y el sitio no se publica (el paso 1).
const hayMain = (() => {
  try {
    execFileSync('git', ['rev-parse', '--verify', 'origin/main'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const existeEnMain = (ruta) => {
  try {
    execFileSync('git', ['cat-file', '-e', `origin/main:${ruta}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

test('tiene los cuatro pasos de la historia', () => {
  for (const paso of [
    '## Paso 1 · Publicar el sitio de docs',
    '## Paso 2 · Orden de arranque de `tailnet-forwards`',
    '## Paso 3 · Recrear el stack Edge de dev',
    '## Paso 4 · Revocar la clave de API de prueba',
  ]) {
    assert.ok(doc.includes(paso), `falta la sección: ${paso}`);
  }
});

test('cada paso dice cómo se verifica y cómo se deshace', () => {
  const secciones = doc.split(/^## Paso /m).slice(1);
  assert.equal(secciones.length, 4, 'esperaba cuatro pasos');
  for (const seccion of secciones) {
    const titulo = seccion.split('\n')[0];
    assert.ok(seccion.includes('**Verificación:**'), `${titulo} no dice cómo verificar`);
    assert.ok(seccion.includes('**Reversión:**'), `${titulo} no dice cómo revertir`);
  }
});

test('el paso 1 respalda y publica el sitio de docs sin borrar el subsitio de la API', () => {
  assert.ok(doc.includes("cp -a /srv/docs-site /srv/docs-site.respaldo-"), 'falta el respaldo del sitio publicado');
  assert.ok(doc.includes('rsync -a --delete --exclude=/api-publica/'), 'falta la publicación con el subsitio excluido');
  assert.ok(doc.includes('squidfunk/mkdocs-material:9'), 'falta el comando de build del sitio');
  assert.ok(doc.includes('mkdocs build --strict'), 'falta el build estricto del sitio');
});

test('el paso 2 deja el tailnet-forwards esperando a Docker y a la base de producción', () => {
  assert.ok(doc.includes('/etc/systemd/system/tailnet-forwards.service.d/esperar-docker.conf'), 'falta el drop-in');
  assert.ok(doc.includes('After=docker.service'), 'falta After=docker.service');
  assert.ok(doc.includes('supabase_db_multistorefront-meli-supabase-prd'), 'falta la espera por la base de producción');
  assert.ok(doc.includes('systemctl daemon-reload'), 'falta el daemon-reload');
});

test('el paso 2 le da tiempo a la espera (systemd corta el arranque a los 90 s por defecto)', () => {
  assert.ok(doc.includes('TimeoutStartSec=600'), 'falta el TimeoutStartSec del drop-in');
});

test('el paso 3 dice cómo se recrea el stack Edge', () => {
  assert.ok(doc.includes('supabase stop'), 'falta el comando para recrear el stack');
  assert.ok(doc.includes('supabase start'), 'falta el comando para recrear el stack');
});

test('el paso 3 respalda el entorno del runtime antes de recrear y verifica las funciones', () => {
  assert.ok(doc.includes('docker inspect'), 'falta el respaldo del entorno del contenedor');
  assert.ok(doc.includes('supabase-dev.212-90-120-53.sslip.io/functions/v1/'), 'falta la URL de verificación de las funciones');
  assert.ok(doc.includes('api-v1/v1/openapi.json'), 'falta la comprobación del contrato de api-v1');
});

test('el paso 4 revoca la clave de prueba con la RPC y dice cómo se verifica', () => {
  assert.ok(doc.includes('PRUEBA-claude-2026-11-11'), 'falta el nombre de la clave');
  assert.ok(doc.includes("public.revocar_clave_api('74a567f2-d3d8-416c-bd20-084af9b6b417')"), 'falta la RPC de revocación');
  assert.ok(doc.includes('revocada_en'), 'falta la verificación de la revocación');
});

test('la página no lleva secretos', () => {
  assert.doesNotMatch(doc, /eyJ[A-Za-z0-9_-]{10,}/, 'la página parece llevar un JWT');
  assert.doesNotMatch(doc, /(clave|password|secret[a-z_]*)\s*[:=]\s*['"][^'"]{8,}/i, 'la página parece llevar una credencial');
});

test('los enlaces internos de la página existen en docs/ y también en main (origen del sitio)', () => {
  const destinos = [...doc.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((destino) => !/^(https?:|mailto:|#|\/)/.test(destino));
  assert.ok(destinos.length > 0, 'la página no enlaza nada');
  for (const destino of destinos) {
    assert.ok(existsSync(new URL(`../../docs/${destino}`, import.meta.url)), `enlace roto en docs/: ${destino}`);
    if (hayMain) {
      assert.ok(existeEnMain(`docs/${destino}`), `enlace roto en main: rompe el build estricto del sitio (${destino})`);
    }
  }
});

test('la página está indexada para que no quede huérfana', () => {
  assert.ok(leer('docs/README.md').includes('pasos-manuales-vps2.md'), 'falta el enlace en docs/README.md');
  assert.ok(leer('docs/operar-sistema.md').includes('pasos-manuales-vps2.md'), 'falta el enlace en docs/operar-sistema.md');
});
