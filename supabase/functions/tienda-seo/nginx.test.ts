// Prueba estática de `apps/web/nginx.conf` (MSF-149): protege contra volver a una configuración que mezcla tiendas o
// cuenta a todos los visitantes como uno solo. Solo mira el texto de la configuración; el comportamiento del límite
// se verificó a mano con nginx en docker (ver docs/tiendas-online.md). Corre con `pnpm test:edge:tienda-seo`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const conf = readFileSync(new URL('../../../apps/web/nginx.conf', import.meta.url), 'utf8')
  .split('\n')
  .filter((linea) => !linea.trim().startsWith('#'))
  .join('\n')

describe('nginx.conf · robots.txt y sitemap.xml', () => {
  it('toma la IP real de X-Forwarded-For solo desde rangos privados (detrás de Traefik)', () => {
    assert.match(conf, /real_ip_header\s+X-Forwarded-For;/)
    assert.match(conf, /real_ip_recursive\s+on;/)
    for (const rango of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']) {
      assert.ok(conf.includes(`set_real_ip_from ${rango};`), rango)
    }
    assert.doesNotMatch(conf, /set_real_ip_from\s+(0\.0\.0\.0\/0|::\/0)/, 'nunca confiar en cualquier origen')
  })

  it('el límite de pedidos usa IP + host (un tenant no agota el cubo de los demás)', () => {
    const zona = conf.match(/limit_req_zone\s+(\S+)\s+zone=tienda_seo_ip:\d+m\s+rate=(\d+)r\/s;/)
    assert.ok(zona, 'falta limit_req_zone tienda_seo_ip')
    assert.match(zona[1], /\$binary_remote_addr/)
    assert.match(zona[1], /\$http_host/)
    assert.ok(Number(zona[2]) >= 10, 'el cubo debe ser holgado para crawlers legítimos')
    assert.match(conf, /limit_req\s+zone=tienda_seo_ip\s+burst=\d+/)
  })

  it('la caché se separa por host y el stale no incluye `updating`', () => {
    assert.match(conf, /proxy_cache_key\s+\$http_host\$uri;/)
    assert.match(conf, /proxy_cache_lock\s+on;/)
    const stale = conf.match(/proxy_cache_use_stale\s+([^;]+);/)
    assert.ok(stale)
    assert.doesNotMatch(stale[1], /updating/)
    assert.match(stale[1], /error/)
  })
})
