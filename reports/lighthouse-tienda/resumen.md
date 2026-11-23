# Lighthouse de la tienda · LCP móvil («4G lento», CPU ×4)

Host: https://demo-mundojc.212-90-120-53.sslip.io:4477, https://demo-sanjavucho.212-90-120-53.sslip.io:4477 · corridas por pantalla: 3 · umbral: 3000 ms (mediana).
Build: servido en local desde apps/web/dist.

| Tienda | Pantalla | Corridas (ms) | Mediana (ms) | Elemento del LCP |
|---|---|---|---|---|
| demo-mundojc.212-90-120-53.sslip.io | / | 6370, 6094, 6077 | 6094 | <h1 class="MuiTypography-root MuiTypography-h1 css-k9rbth"> |
| demo-mundojc.212-90-120-53.sslip.io | /catalogo | 6167, 6326, 5843 | 6167 | <p class="MuiTypography-root MuiTypography-body2 css-1gjmfb0"> |
| demo-mundojc.212-90-120-53.sslip.io | /producto/bbd74674-9302-4694-a72e-3f47ec622841 | 8518, 8485, 8831 | 8518 | <img class="MuiBox-root css-1b2pway" src="https://supabase-dev.212-90-120-53.sslip.io/storage/v1/object/sign/product…" alt="ADAPTADOR DE ETHERNET SPX A RJ45 STARLINK (6510C)"> |
| demo-sanjavucho.212-90-120-53.sslip.io | / | 6274, 6133, 6354 | 6274 | <h1 class="MuiTypography-root MuiTypography-h1 css-1etyh5h"> |
| demo-sanjavucho.212-90-120-53.sslip.io | /catalogo | 6524, 6311, 6125 | 6311 | <p class="MuiTypography-root MuiTypography-body2 css-wkg21f"> |
| demo-sanjavucho.212-90-120-53.sslip.io | /producto/bbd74674-9302-4694-a72e-3f47ec622841 | 8524, 8601, 8837 | 8601 | <img class="MuiBox-root css-1b2pway" src="https://supabase-dev.212-90-120-53.sslip.io/storage/v1/object/sign/product…" alt="ADAPTADOR DE ETHERNET SPX A RJ45 STARLINK (6510C)"> |

Veredicto: FALLA — 6 pantalla(s) sin cumplir el umbral.
