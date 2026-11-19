import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';

const script = path.resolve('scripts/verificar-staging-exitoso.mjs');

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_TOKEN: '', GITHUB_REPOSITORY: '', GITHUB_API_URL: '', ...env },
    });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function withFakeGitHubApi(workflowRuns, handler, comparaciones = {}) {
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    const m = req.url.match(/\/compare\/([^./?]+)\.\.\.([^/?]+)/);
    if (m) {
      const cmp = comparaciones[`${m[1]}...${m[2]}`];
      res.statusCode = cmp ? 200 : 404;
      res.end(JSON.stringify(cmp ?? { message: 'Not Found' }));
      return;
    }
    res.end(JSON.stringify({ workflow_runs: workflowRuns }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await handler(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('rechaza sin --workflow antes de tocar la red', async () => {
  const result = await run(['--head-sha', 'abc123']);
  assert.notEqual(result.code, 0);
});

test('rechaza sin --head-sha antes de tocar la red', async () => {
  const result = await run(['--workflow', 'migraciones-cloud.yml']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /--head-sha/);
});

test('rechaza sin GITHUB_TOKEN antes de tocar la red', async () => {
  const result = await run(['--workflow', 'migraciones-cloud.yml', '--head-sha', 'abc123']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /GITHUB_TOKEN/);
});

test('aprueba cuando staging corrió exitosamente para el mismo head_sha', async () => {
  await withFakeGitHubApi(
    [{ head_sha: 'abc123', conclusion: 'success' }, { head_sha: 'otro', conclusion: 'success' }],
    async (apiUrl) => {
      const result = await run(
        ['--workflow', 'migraciones-cloud.yml', '--head-sha', 'abc123'],
        { GITHUB_TOKEN: 'token-de-prueba', GITHUB_REPOSITORY: 'org/repo', GITHUB_API_URL: apiUrl },
      );
      assert.equal(result.code, 0);
      assert.match(result.stdout, /autorizada/);
    },
  );
});

test('rechaza cuando staging nunca corrió exitosamente para ese head_sha', async () => {
  await withFakeGitHubApi(
    [{ head_sha: 'otro-commit', conclusion: 'success' }],
    async (apiUrl) => {
      const result = await run(
        ['--workflow', 'migraciones-cloud.yml', '--head-sha', 'abc123'],
        { GITHUB_TOKEN: 'token-de-prueba', GITHUB_REPOSITORY: 'org/repo', GITHUB_API_URL: apiUrl },
      );
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /no se puede promover a producción/);
    },
  );
});

test('rechaza cuando no hay ningún run exitoso de staging', async () => {
  await withFakeGitHubApi([], async (apiUrl) => {
    const result = await run(
      ['--workflow', 'migraciones-cloud.yml', '--head-sha', 'abc123'],
      { GITHUB_TOKEN: 'token-de-prueba', GITHUB_REPOSITORY: 'org/repo', GITHUB_API_URL: apiUrl },
    );
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /no se puede promover a producción/);
  });
});

// --- MSF-674: el gate valida lo que corresponde, no un run para cada SHA ---

import { archivosRelevantes, globARegex, pathsDeWorkflow } from './verificar-staging-exitoso.mjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const WORKFLOW = `name: x
on:
  push:
    branches: [main]
    paths:
      - "supabase/migrations/**"
      - "scripts/migrar-supabase-cloud.mjs"
      - ".github/workflows/migraciones-cloud.yml"
  workflow_dispatch: {}
`;

async function dirWorkflows() {
  const dir = await mkdtemp(path.join(tmpdir(), 'wf-'));
  await writeFile(path.join(dir, 'migraciones-cloud.yml'), WORKFLOW);
  return dir;
}

test('pathsDeWorkflow y globARegex leen on.push.paths y filtran como GitHub', () => {
  const paths = pathsDeWorkflow(WORKFLOW);
  assert.deepEqual(paths, ['supabase/migrations/**', 'scripts/migrar-supabase-cloud.mjs', '.github/workflows/migraciones-cloud.yml']);
  assert.ok(globARegex('supabase/migrations/**').test('supabase/migrations/2026_x.sql'));
  assert.ok(globARegex('supabase/migrations/**').test('supabase/migrations/sub/a.sql'));
  assert.ok(!globARegex('supabase/migrations/*').test('supabase/migrations/sub/a.sql'));
  assert.ok(!globARegex('scripts/a.mjs').test('scripts/aXmjs'));
  assert.deepEqual(archivosRelevantes(['apps/web/a.ts', 'supabase/migrations/1.sql'], paths), ['supabase/migrations/1.sql']);
});

test('MSF-674: sin run para el SHA pero sin cambios relevantes desde el último staging exitoso, autoriza', async () => {
  const dir = await dirWorkflows();
  await withFakeGitHubApi(
    [{ head_sha: 'viejo', conclusion: 'success', created_at: '2026-11-01T00:00:00Z' }],
    async (apiUrl) => {
      const result = await run(
        ['--workflow', 'migraciones-cloud.yml', '--head-sha', 'nuevo', '--workflows-dir', dir],
        { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'org/repo', GITHUB_API_URL: apiUrl },
      );
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /último estado relevante/);
    },
    { 'viejo...nuevo': { status: 'ahead', total_commits: 2, commits: [{}, {}], files: [{ filename: 'apps/web/src/a.tsx' }, { filename: 'docs/x.md' }] } },
  );
});

test('MSF-674: si hay cambios relevantes posteriores al último staging exitoso, rechaza y los nombra', async () => {
  const dir = await dirWorkflows();
  await withFakeGitHubApi(
    [{ head_sha: 'viejo', conclusion: 'success', created_at: '2026-11-01T00:00:00Z' }],
    async (apiUrl) => {
      const result = await run(
        ['--workflow', 'migraciones-cloud.yml', '--head-sha', 'nuevo', '--workflows-dir', dir],
        { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'org/repo', GITHUB_API_URL: apiUrl },
      );
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /staging no validó: supabase\/migrations\/9\.sql/);
      assert.match(result.stderr, /no se puede promover a producción/);
    },
    { 'viejo...nuevo': { status: 'ahead', total_commits: 1, commits: [{}], files: [{ filename: 'supabase/migrations/9.sql' }] } },
  );
});

test('MSF-674: un run que no es ancestro (diverged) no sirve de base; sin otro run, rechaza', async () => {
  const dir = await dirWorkflows();
  await withFakeGitHubApi(
    [{ head_sha: 'otra-rama', conclusion: 'success' }],
    async (apiUrl) => {
      const result = await run(
        ['--workflow', 'migraciones-cloud.yml', '--head-sha', 'nuevo', '--workflows-dir', dir],
        { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'org/repo', GITHUB_API_URL: apiUrl },
      );
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /ancestro/);
    },
    { 'otra-rama...nuevo': { status: 'diverged', files: [] } },
  );
});

test('MSF-674: una comparación truncada no se da por buena', async () => {
  const dir = await dirWorkflows();
  await withFakeGitHubApi(
    [{ head_sha: 'viejo', conclusion: 'success' }],
    async (apiUrl) => {
      const result = await run(
        ['--workflow', 'migraciones-cloud.yml', '--head-sha', 'nuevo', '--workflows-dir', dir],
        { GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'org/repo', GITHUB_API_URL: apiUrl },
      );
      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /demasiado grande/);
    },
    { 'viejo...nuevo': { status: 'ahead', total_commits: 250, commits: new Array(100).fill({}), files: [] } },
  );
});
