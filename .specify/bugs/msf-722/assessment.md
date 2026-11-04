# MSF-722 — búsqueda con tildes, SKU de 13 dígitos y marca «impreso»

Diagnóstico del tracker (lectura de código): `nombre.ilike` distingue tildes en `productosListado.ts`/`stock.ts`;
13 dígitos buscan solo por `codigo_barras`; el buscador de «Agregar producto» corta a 20 sin avisar;
`ImprimirComprobanteDialog` registra la impresión antes de `window.open` (bloqueado por el navegador).
