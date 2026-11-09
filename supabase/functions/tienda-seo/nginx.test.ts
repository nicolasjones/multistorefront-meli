// Prueba estática de `apps/web/nginx.conf` (MSF-149): protege contra volver a una configuración que mezcla tiendas o
// cuenta a todos los visitantes como uno solo. Solo mira el texto de la configuración; el comportamiento
// real (429, IP desde X-Forwarded-For, sin stale) lo prueba `sh scripts/probar-nginx-tienda-seo.sh` con nginx en docker. Corre con `pnpm test:edge:tienda-seo`.
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
    const rangos = [...conf.matchAll(/set_real_ip_from\s+(\S+);/g)].map((m) => m[1])
    assert.deepEqual(rangos, ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.1', 'fc00::/7'])
  })

  it('el límite usa dos zonas: IP + host (20 r/s, ráfaga 100) y solo IP (100 r/s, ráfaga 200)', () => {
    assert.ok(conf.includes('limit_req_zone $binary_remote_addr$http_host zone=tienda_seo_ip:10m rate=20r/s;'))
    assert.ok(conf.includes('limit_req_zone $binary_remote_addr zone=tienda_seo_global:10m rate=100r/s;'))
    assert.ok(conf.includes('limit_req zone=tienda_seo_ip burst=100 nodelay;'))
    assert.ok(conf.includes('limit_req zone=tienda_seo_global burst=200 nodelay;'))
    assert.match(conf, /limit_req_status\s+429;/)
  })

  it('la caché se separa por host y NO se sirve contenido viejo (sin proxy_cache_use_stale)', () => {
    assert.match(conf, /proxy_cache_key\s+\$http_host\$uri;/)
    assert.match(conf, /proxy_cache_valid\s+200\s+5m;/)
    assert.match(conf, /proxy_cache_lock\s+on;/)
    assert.doesNotMatch(conf, /proxy_cache_use_stale/)
  })
})
