# Bug Assessment: los avisos de acceso no siguen el mismo patrón («Solo lectura» en rojo y «Acceso restringido» fuera del patrón)

- **Slug**: msf-639 (provisto por el usuario, `slug=msf-639`)
- **Created**: 2026-11-01
- **Source**: tracker (It's a Plan) MSF-639 — «Avisos de acceso inconsistentes: «Solo lectura» como error rojo y «Acceso restringido» fuera del patrón (modo bug)». Decisión de negocio: Auditoría (H8). Familia de MSF-602.
- **Verdict**: valid (el comportamiento está groundingado en el código: las dos pantallas montaban `EstadoError`, que es un `Alert severity="error"` rojo)
- **Severity**: medium (presentación: no toca permisos, RLS ni datos)

## Report (verbatim or summarized)

> Avisos de acceso inconsistentes: «Solo lectura» se muestra como error rojo; «Acceso restringido» en `/empresas` y
> `/organizacion` no sigue el patrón «No tenés acceso a esta sección».

Sin pasos de reproducción ni capturas adjuntas: es un reporte de comportamiento con el texto exacto que se ve en
pantalla y las dos rutas donde aparece.

## Symptom

Dos pantallas del panel muestran un aviso de acceso con un patrón distinto al del resto:

1. `/empresas/edit/:id` (General): quien no puede escribir ve **«Solo lectura» pintado como error rojo** (el
   `EstadoError` compartido, `severity="error"`), cuando «Solo lectura» es una **información**: la pantalla se puede
   ver, solo que no se puede guardar. El prototipo (`design/pantallas/Historial.dc.html`) lo resuelve al revés: el
   rótulo «Solo lectura» es un chip neutro (`class="chip n"`) y el aviso informativo es el bloque azul
   `<div class="al i" role="note">`.
2. `/empresas` (listado) y `/organizacion`: quien no puede escribir ve un `EstadoError` rojo con el título
   **«Acceso restringido»**, en vez de la pantalla común del panel (`pages/acceso-restringido/AccesoRestringido.tsx`),
   que muestra el encabezado «No tenés acceso a esta sección» y el motivo «Tu rol (…) no incluye …». Esa pantalla ya la
   usan Rentabilidad, Listas y Motivos de movimiento.

El efecto: dos avisos de acceso con textos y tonos distintos para la misma situación (no tenés permiso), y un aviso
informativo pintado como si fuera un fallo.

## Reproduction

1. Iniciar sesión en el panel con una persona de rol **Operador** (o cualquier rol sin permiso de escritura en la
   organización; `private.puede_escribir()` es falso para todos los roles salvo `administrador`).
2. Entrar por URL directa a `/empresas`: aparece un recuadro **rojo** con el título «Acceso restringido» y la
   descripción «Solo los administradores pueden ver las empresas de la organización.» (no el encabezado «No tenés
   acceso a esta sección» del resto del panel).
3. Entrar por URL directa a `/organizacion`: mismo recuadro rojo, con «Solo los administradores pueden editar los
   datos de la organización.».
4. Entrar por URL directa a `/empresas/edit/:id` de una empresa de la organización: el formulario aparece con el
   aviso **«Solo lectura» en rojo** (tono de error), aunque la pantalla carga bien y solo no permite guardar.

## Suspected Code Paths

Estado previo a la corrección (base `dokploy`):

- `apps/web/src/pages/empresas/list.tsx:106-110` — **origen del aviso inconsistente**: `if (!puedeEscribir)` montaba
  `<EstadoError titulo="Acceso restringido" descripcion="Solo los administradores pueden ver las empresas de la organización." />`
  (rojo) en vez del componente común `AccesoRestringido`.
- `apps/web/src/pages/organizacion/edit.tsx:133-135` — mismo caso: `<EstadoError titulo="Acceso restringido" descripcion="Solo los administradores pueden editar los datos de la organización." />`.
- `apps/web/src/pages/empresas/edit.tsx:203` — `{soloLectura ? <EstadoError titulo="Solo lectura" descripcion="Solo los administradores pueden editar los datos de la empresa." /> : null}`: un
  `Alert severity="error"` (rojo) para un estado que no es un error.
- `apps/web/src/components/estados/EstadosPagina.tsx:24-26` — `EstadoError` es `EstadoInformativo` con
  `severidad="error"`: el tono rojo y el `role="alert"` de MUI vienen de ahí (todos los errores de la app se ven
  igual; por eso el aviso informativo tenía que dejar de usar este componente).
- `apps/web/src/pages/acceso-restringido/AccesoRestringido.tsx:26-77` — la pantalla común que ya usan
  `pages/rentabilidad/*`, `pages/configuracion/listas.tsx` y `pages/stock/motivos.tsx`: encabezado
  «No tenés acceso a esta sección» (`EncabezadoPagina` → `h1`) y el motivo «Tu rol (…) no incluye …».
- `apps/web/src/pages/empresas/precios.tsx:157` — caso hermano de la misma familia: «Solo lectura» con
  `EstadoVacio` (tono info), no un error: la incoherencia a corregir era la del `EstadoError`.
- `apps/web/src/components/consultas/DetalleConsulta.tsx:162` — criterio ya aplicado en el panel para «Solo lectura»:
  un texto informativo con `role="note"`, no una alerta de error.
- `design/pantallas/Historial.dc.html` — el prototipo: rótulo «Solo lectura» como chip neutro (`class="chip n"`) y
  aviso informativo `<div class="al i" role="note">`; `design/pantallas/SJ_StoreGeneral.dc.html` no muestra ningún
  aviso de error en la pantalla General.

## Root Cause Hypothesis

Cada pantalla de sección construyó su propio aviso de «no tenés permiso» en lugar de usar el componente compartido
`AccesoRestringido`, y el estado «no puedo editar, pero puedo ver» se pintó con el componente de error
(`EstadoError`) porque era el único texto disponible. La consecuencia es que el panel tiene dos vocabularios para el
mismo hecho y que un estado informativo hereda el tono de error. Confianza: **alta** (los dos textos y el tono rojo
estaban literalmente en el código citado); lo no confirmado es si hay otras pantallas fuera de `/empresas` y
`/organizacion` con el mismo desvío (el rastreo del código no encontró más `EstadoError` con «Acceso restringido»).

## Proposed Remediation

**Preferred**: usar el patrón común en las dos pantallas y bajar «Solo lectura» a aviso informativo, sin tocar
permisos, RLS ni migraciones.

1. `/empresas` y `/organizacion`: reemplazar el `EstadoError` «Acceso restringido» por
   `<AccesoRestringido rol="actual" seccion="Empresas" />` / `seccion="Mi organización"`, igual que Rentabilidad,
   Listas y Motivos.
2. `/empresas/edit/:id`: reemplazar el `EstadoError` «Solo lectura» por un `Alert severity="info" role="note"` con el
   mismo criterio de `DetalleConsulta` y del bloque `al i` del prototipo; el formulario sigue deshabilitado.
3. Tests: fijar el patrón completo (encabezado «No tenés acceso a esta sección» + motivo) en los Vitest de las dos
   pantallas y el aviso informativo (`role="note"`, sin `role="alert"`) en el detalle de la empresa.

**Alternatives**:
- *Dejar «Acceso restringido» pero sin rojo*: no resuelve la inconsistencia de textos con el resto del panel.
- *Cambiar `EstadoError` a tono info*: afectaría a todas las pantallas de error de la app (se perdería la
  diferenciación entre fallo y aviso).

**Files likely to change**:
- `apps/web/src/pages/empresas/list.tsx` y su test
- `apps/web/src/pages/organizacion/edit.tsx` y su test
- `apps/web/src/pages/empresas/edit.tsx` y su test
- `docs/empresas.md` (aviso de acceso de las dos pantallas)

**Tests to add or update**:
- `apps/web/src/pages/empresas/list.test.tsx`: encabezado «No tenés acceso a esta sección», motivo «Tu rol (actual) no
  incluye Empresas. …» y ausencia del «Acceso restringido» viejo y de cualquier alerta de tono error.
- `apps/web/src/pages/organizacion/edit.test.tsx`: lo mismo con «Mi organización».
- `apps/web/src/pages/empresas/edit.test.tsx`: el aviso «Solo lectura» con `role="note"` y sin `role="alert"`.
- E2E de evidencia (no corre en el CI público): `apps/web/e2e/avisos-acceso.e2e.ts` con los dos escenarios que pide
  la revisión de seguridad (acceso restringido en Empresas y Mi organización; «Solo lectura» en el detalle).

## Risks & Considerations

- **No es un cambio de autorización**: `usePuedeEscribir()` y RLS no se tocan; solo cambia lo que se ve. La pantalla
  restringida sigue sin montar la sección ni consultar datos (`useEmpresas({ habilitado: puedeEscribir === true })`).
- **Pérdida del botón «Volver al inicio» y del contexto de sección**: `AccesoRestringido` no recibe `seccionClave` en
  estas dos pantallas, así que no ofrece «Solicitar acceso» (eso es F-ROL-05, de otra historia). El encabezado pasa a
  ser «No tenés acceso a esta sección», igual que en el resto del panel.
- **Duplicidad de textos**: el motivo «Tu rol (actual) no incluye …» lo compone `AccesoRestringido`; no se puede
  ajustar por pantalla sin tocar el componente compartido.
- **El aviso informativo no debe anunciarse**: un `role="alert"` (el default de MUI) se anuncia a los lectores de
  pantalla; por eso el aviso de «Solo lectura» va con `role="note"` (criterio ya usado en `DetalleConsulta`).
- **Sin cambios de API ni de base de datos**: no hay migración ni contrato que actualizar.

## Open Questions

- [NEEDS CLARIFICATION: el rótulo «Solo lectura» del prototipo es un chip neutro en el encabezado del Historial; en
  el detalle de la empresa se optó por el aviso informativo azul (`al i` / `role="note"`), que es el mismo criterio que
  ya usa `DetalleConsulta`. Si se quiere el chip literal del prototipo, es un ajuste de una línea.]
- [NEEDS CLARIFICATION: «Solicitar acceso» (F-ROL-05) no se ofrece en `/empresas` ni `/organizacion` porque
  `AccesoRestringido` sin `seccionClave` no lo muestra; la gestión de la tienda sí lo ofrece (`seccionClave="empresas"`).
  Agregarlo es de la historia de F-ROL-05, no de esta.]
