---
owner: tecnico
sources:
  - specs/20270323-100000-service-ideas-futuras-v2
  - apps/web/src/lib/qr
  - apps/web/src/lib/etiquetaReparacion.ts
  - apps/web/src/components/service/EtiquetaReparacion.tsx
  - apps/web/src/pages/service-tecnico/etiqueta.tsx
---

# Service técnico · Etiqueta con código QR del equipo

Spec: `specs/20270323-100000-service-ideas-futuras-v2/` (F-SVC-32, MSF-190, épica MSF-118; FR-040 a FR-052, SC-005, SC-006; decisiones D-16 a D-20). Es solo front: **no hay migraciones, RPC ni dependencias nuevas**.

## Flujo

1. En el detalle de la reparación, junto a «Imprimir orden», aparece **«Imprimir etiqueta»** (ícono `QrCode2`, enlace a `/service-tecnico/reparaciones/:id/etiqueta`). Se ofrece con `lectura` o más en `service_tecnico` y solo si la reparación **no está anulada**.
2. La vista (`pages/service-tecnico/etiqueta.tsx`, ruta `lazy` con `RequiereAccesoSeccion seccion="service_tecnico"`, igual que `orden` y `remito`) carga la reparación con `useDocumentoReparacion` (solo `obtener_reparacion`, la tienda y el técnico accesorio) y arma la etiqueta en el navegador. Una reparación anulada responde «La reparación está anulada: no se imprime etiqueta.».
3. Se elige el tamaño y la cantidad y se pulsa **Imprimir**: `window.print()` con un `@page { size: <ancho>mm <alto>mm; margin: 0 }`, una etiqueta por página.
4. Quien escanea el QR con la cámara del celular abre `https://<panel>/service-tecnico/reparaciones/<uuid>`: sin sesión pasa por `/login?to=…` y vuelve (solo rutas internas, `destinoInternoSeguro`); sin `service_tecnico` ve la pantalla de acceso restringido; con una tienda no accesible, el mismo mensaje del detalle. **No se agregó ninguna ruta ni RPC** para esto (FR-050).

## Qué lleva y qué NO lleva

| El QR codifica | La etiqueta impresa muestra |
|---|---|
| Solo `<origen del panel>/service-tecnico/reparaciones/<uuid>` | El QR, el código grande (`R-0238`), la tienda, el equipo (modelo, hasta 2 líneas) e «Ingreso dd/mm/aaaa» |

**Nunca** lleva (ni el QR ni el texto): nombre, contacto, falla, número de serie, accesorios, técnico, importes ni el **token público de seguimiento** (`/seguimiento/<token>`, D-17: la etiqueta queda pegada a un objeto que pasa por muchas manos). La URL se arma en un único lugar, `urlEtiquetaReparacion` (`lib/etiquetaReparacion.ts`), con lista blanca de forma: el `id` debe ser un UUID y el origen `http(s)://host[:puerto]` en ASCII sin credenciales, ruta, query ni fragmento; y los textos salen de `textosDeEtiqueta`, que recibe solo código, tienda, equipo e ingreso. Hay tests que fijan el contenido exacto y fallan si cambia.

## Tamaños e impresión

| Tamaño | Medidas |
|---|---|
| Chica | 40 × 25 mm |
| Mediana (por defecto) | 50 × 30 mm |
| Grande | 70 × 40 mm |
| Personalizada | ancho 25–100 mm, alto 15–100 mm (enteros) |

- «Cantidad de etiquetas»: 1 a 10 iguales, una por página. La cantidad **no** se recuerda.
- El tamaño y las medidas personalizadas se guardan en **este navegador** (`localStorage['msf.service.etiqueta']`; es una preferencia del puesto de trabajo, D-19). El acceso va en `try/catch` y un valor inválido, corrupto o extremo cae al predeterminado o se recorta a los rangos.
- **Disposición**: horizontal (QR a la izquierda) si el ancho es al menos 1,25 veces el alto; si no, vertical. El QR ocupa el mayor cuadrado que entra con 1,5 mm de margen (sin pasar del 60 % de la dimensión que comparte con el texto) y lleva zona quieta de 4 módulos, negro sobre blanco y `shape-rendering="crispEdges"`.
- **Módulo mínimo**: si cada módulo midiera menos de **0,4 mm** se avisa «Con este tamaño el código QR queda demasiado chico para leerse. Probá con una etiqueta más grande.» y «Imprimir» queda deshabilitado. Si la dirección no entra en la versión 10 del generador (213 bytes): «La dirección del panel es demasiado larga para el código QR.» (nunca se trunca).
- En `localhost`, cualquier `*.localhost`, `127.0.0.1` o `::1` se avisa que el QR apunta a esa dirección y no va a funcionar en otros equipos. El origen puede ser un nombre o una IPv6 entre corchetes (`http://[::1]:4300`).
- **Navegadores**: verificado en **Chrome y Edge** (Chromium), que respetan `@page { size }` y salen del tamaño de la etiqueta (el E2E lo comprueba con el PDF de Chromium). **Firefox y Safari** pueden ignorar el tamaño de página del CSS o aplicar sus propios márgenes: no se probaron; en ellos hay que elegir a mano el tamaño de papel de la etiqueta en el cuadro de impresión (y escala 100 %, sin márgenes) y probar con una etiqueta antes de imprimir una tanda.
- **Impresión recomendada**: en el diálogo del navegador, impresora de etiquetas, **escala 100 %** y márgenes **«Ninguno»**. Se imprime con el diálogo del navegador (cualquier impresora con driver, térmica o láser); no hay ZPL ni ESC/POS directos (D-20).
- Lo marcado `.no-imprimir` (título, controles, avisos, menú y barra superior) se oculta al imprimir.

## Cambio de dominio del panel

La URL del QR lleva el dominio **con el que estaba abierto el panel al imprimir**. Si el panel cambia de dominio, las etiquetas ya pegadas siguen apuntando al viejo: hay que **reimprimirlas** o **mantener la redirección** del dominio viejo al nuevo. Antes de pegar una etiqueta, conviene escanear una y comprobar que la dirección empiece con el dominio del panel (un QR falso pegado encima de uno verdadero solo podría llevar a un sitio ajeno; el código también está impreso en texto para contrastar).

## El generador de QR y cómo se verificó

`apps/web/src/lib/qr/` es un generador **propio y mínimo, sin dependencias** (D-18): solo modo byte (UTF-8), corrección de errores **M**, versiones 1 a 10 (hasta 213 bytes), 8 máscaras con las cuatro reglas de penalización de ISO/IEC 18004 y `qrASvgPath` (un único `<path>` de SVG con coordenadas enteras). Son funciones puras: sin DOM, red, `eval` ni `Function` (un test lo verifica sobre el código fuente). Un texto de más de 213 bytes lanza `QrDemasiadoLargo`.

| Archivo | Contenido |
|---|---|
| `galois.ts` | GF(256) con el polinomio 0x11D, generadores y resto de Reed-Solomon |
| `plantillas.ts` | Tablas de bloques, palabras de datos/corrección y alineación de las versiones 1 a 10 (M) |
| `qr.ts` | `generarQr`: datos, entrelazado, patrones fijos, zigzag, máscaras y penalización, formato (BCH 15,5) y versión (BCH 18,6) |
| `svg.ts` | `qrASvgPath` / `qrASvg` |

**Verificación en tres capas** (FR-041):

1. **Vectores dorados** (`qr.dorados.test.ts` + `fixtures/qr-dorados.json`): 25 matrices (URLs de 14 a 213 bytes que cubren las diez versiones y cada salto de versión; una con acentos) generadas **una sola vez** con la implementación de referencia `qrcode` 1.5.4 en un contenedor descartable (nunca en el repo ni en el lockfile; el comando y la versión están en el propio archivo) y comparadas módulo a módulo con la máscara de la referencia. Como contraste, `qrcode-generator` 2.0.4 coincide con el generador propio con alguna de las 8 máscaras en 425 de 425 textos. Además, el test comprueba contra tablas **publicadas** la información de formato (nivel M, máscaras 0 a 7) y de versión (7 a 10), el generador de Reed-Solomon de grado 7 del anexo del estándar y dos ejemplos conocidos de palabras de corrección.
2. **Ida y vuelta** (`qr.test.ts` con `qr.lector.test-util.ts`): un lector escrito solo para tests lee formato y máscara de la matriz, deshace la máscara, recorre el zigzag, desentrelaza, comprueba que los **síndromes de Reed-Solomon de cada bloque sean cero** y reconstruye el texto; 200 textos con semilla fija (1 a 213 bytes, ASCII y UTF-8, las diez versiones), las diez versiones con las 8 máscaras, y falla si se invierte un módulo de datos, de formato o de versión. El lector no está en el bundle.
3. **Escaneo real** con decodificadores independientes (ver el PR): `zbarimg`, OpenCV y zxing-cpp sobre PNG rasterizados desde el mismo `<path>` que se imprime. **Escaneo con un celular real: no verificado** (queda para la revisión QA con una impresora).

Nota de la elección de máscara: en una de las 25 matrices doradas la referencia `qrcode` elige otra máscara válida que la del generador propio (su N4 redondea con `ceil`; el texto de ISO/IEC 18004 usa `floor`). La elección propia sigue el estándar y la revisión independiente la verificó además contra zxing en 3424 casos. Cualquiera de las máscaras produce un símbolo legible y la prueba de ida y vuelta lo comprueba.

### Criterio de abandono (D-18)

Si los vectores dorados, la ida y vuelta o el escaneo real dejaran de cerrar, se descarta el generador propio y se usa, detrás de la misma interfaz `generarQr`, una librería de QR **sin dependencias transitivas**, fijada a **versión exacta con más de 14 días** (política del repo) y auditada con `supply-chain-security`. **Decisión de F-SVC-32: generador propio confirmado** (los tres decodificadores independientes leen las 13 etiquetas de prueba).

## E2E

`apps/web/e2e/service-etiqueta-qr.e2e.ts` (único E2E de Service que corre en el CI) abre la etiqueta de una reparación real, decodifica el QR desde el `<path>` del DOM y comprueba que es **exactamente** la ruta de la reparación, que la etiqueta no muestra datos personales y que, abierto sin sesión, el QR pasa por el ingreso y vuelve. Corre en el job `e2e-tienda` del CI (se agregó a su filtro `e2e/tienda- e2e/service-etiqueta-qr`; ese job corre en todo PR a `dokploy` que toque la web y, con `E2E_TIENDA_BLOQUEA=true`, es requerido); `pnpm e2e:omitidos:check apps/web/resultado-e2e.json --max=1` falla si el spec se omite.

## Reversión

Es solo front y aditivo: revertir el merge del PR quita el botón, la ruta y el generador sin tocar la base. Las etiquetas ya impresas siguen abriendo la ruta del detalle, que no cambia.
