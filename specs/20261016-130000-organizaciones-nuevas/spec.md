# Feature Specification: Acceso, organización y permisos · Organizaciones nuevas

**Feature Branch**: `epic/MSF-162-acceso-organizacion-y-permisos-organizac`

**Jira Epic**: MSF-162 — Acceso, organización y permisos · Organizaciones nuevas (spec `organizaciones-nuevas`)

**Created**: 2026-10-16

**Status**: NEEDS_INFO — la épica no trae requisitos ni criterios de aceptación («se redactan cuando la épica pase a un hito») y deja abierta una decisión que cambia el modelo de datos. Esta spec traduce **solo** lo dado; los requisitos quedan como *a confirmar* (ver *Preguntas abiertas*). No se inventa alcance.

**Delivery scope**: `refine` (apps/web) y `supabase` (migraciones, RPC/Edge Function, pgTAP). Sin `kestra`, `superset` ni `workers`.

**Prioridad / Hito**: P3 · Backlog · alcance: fuera de diciembre · horas: a estimar al entrar en el plan (referencia XL ≈ 24 h; no se achica por el template).

**Dependencias**:
- Bloqueada por: MSF-119 (Acceso y organización): F-ORG-02 se apoya en la regla y las pruebas de aislamiento de F-ORG-01.
- Bloquea a: ninguna épica.
- Relacionada (sin bloqueo): al planificar hay que rehacer `usuarios_organizacion` (MSF-125) y `usuarios_empresas` / `usuario_empresa_activa` (MSF-121); se decide entonces si pasa a depender de ellas.

**Input**: Epic MSF-162. Objetivo (inferido en Jira): poder crear organizaciones nuevas con su propio administrador sobre el mismo modelo, para ofrecer la plataforma a otros clientes (multi-cliente).

**Prototipo**: la épica no tiene pantallas en el prototipo. La estética sale del sistema de diseño (MSF-117, `docs/sistema-de-diseno.md`).

## Historia prevista

| ID | Nombre | Prioridad | Talla |
|----|--------|-----------|-------|
| F-ORG-02 | Alta de nuevas organizaciones | P3 | XL |

## Modelo y supuestos (literales de la épica)

- Se habilita sobre F-ORG-01 **sin cambiar el modelo de datos** (supuesto de la épica). Tensión conocida: el supuesto siguiente exige cambiar una clave; se resuelve al planificar (Q1).
- `usuarios_organizacion.user_id` es clave primaria: un usuario que trabaje en dos organizaciones exige cambiar esa clave. Decisión al planificar la historia.
- **Lo que trae el template** (`automation-platform-template`): alta de organización por superadmin (Edge Function `crear-organizacion`, `pages/organizaciones/{list,create}`) y contexto de organización activa solo para superadmin (`entrar_a_organizacion`, `ContextoPanel`, `OrganizacionActivaBanner`). Ya presentes en este repo.
- **Lo que el template NO trae y esta épica debe construir**: (a) un usuario en varias organizaciones, (b) selector de organización para usuarios normales, (c) alta de la organización con su primer administrador y sus empresas, (d) la facturación propia del servicio. No se achica.

## Esquemas (Principio VII — verificación en spec)

| Tabla | Esquema | Justificación |
|-------|---------|---------------|
| `organizaciones` | `public` | Plataforma / transversal |
| `usuarios_organizacion` | `public` | Membresía: plataforma |
| `dominio.empresas` | `dominio` | Dominio del producto (ya existe; el alta de organización crea las primeras empresas) |
| `usuarios_empresas` / `usuario_empresa_activa` (MSF-121) | a confirmar al planificar | Se rehacen si se decide la multi-organización (Q2) |
| Facturación del servicio (tablas nuevas, si se confirma) | a confirmar | Un cobro del servicio a la organización es plataforma → `public`; no se asume (Q3) |

Toda tabla expuesta, nueva o alterada: RLS por organización (`private.organizacion_id()` / `private.puede_escribir()`), sin privilegios para `anon`, migración aditiva con reversión documentada. La prueba pgTAP de aislamiento recorre `public` + `dominio`.

## Requisitos (provisionales — a confirmar)

La épica **no los trae**. Se listan solo los que se desprenden literalmente de «lo que debe construir»; cada uno queda **a confirmar** y sin criterio de aceptación hasta que Nicolás los redacte.

- **FR-001** (F-ORG-02, a confirmar): Se puede dar de alta una organización nueva con su primer administrador y sus empresas.
- **FR-002** (F-ORG-02, a confirmar): Un mismo usuario puede pertenecer a más de una organización. Condicionado a la respuesta de Q1; implica cambiar la clave de `usuarios_organizacion`.
- **FR-003** (F-ORG-02, a confirmar): Un usuario normal con más de una organización dispone de un selector de organización. Depende de FR-002.
- **FR-004** (F-ORG-02, a confirmar): Facturación propia del servicio. Alcance no definido (Q3).
- **FR-005** (F-ORG-02, restricción dada): El aislamiento de F-ORG-01 se mantiene: ningún usuario ve datos de una organización a la que no pertenece; las pruebas de aislamiento cubren las organizaciones nuevas y la multi-pertenencia.
- **FR-006** (F-ORG-02, restricción dada): El cambio de clave de `usuarios_organizacion` (si se hace) actualiza políticas, `private.nivel_seccion` y las tablas de empresas por usuario sin romper lo ya entregado; migración aditiva con reversión explícita.

Criterios de éxito (SC): **no definidos por la épica** («Verificación: a definir cuando pase a un hito»). Se redactan tras la respuesta a las preguntas.

## Preguntas abiertas (NEEDS_INFO)

1. **¿Un mismo correo necesitará trabajar en dos organizaciones?** Hoy el modelo lo impide. Si sí → se cambia la clave de `usuarios_organizacion` y se construye el selector (FR-002/003/006). Si no → la épica se reduce a FR-001/004/005.
2. **¿F-ORG-02 pasa a depender de MSF-125 y MSF-121?** Hay que rehacer `usuarios_organizacion` y `usuarios_empresas` / `usuario_empresa_activa`; ¿se hace dentro de esta épica o se espera a esas épicas?
3. **Facturación propia del servicio:** ¿qué incluye (planes, cobros, estado de cuenta, bloqueo por falta de pago)? ¿Entra en esta épica o se traza como seguimiento?
4. **División del XL (≈24 h):** la épica pide dividir ninguna historia >8 h. ¿Se aprueba la división propuesta en `plan.md` (A: alta + primer admin + empresas; B: multi-organización + selector; C: facturación)?
5. **Requisitos y criterios de aceptación de F-ORG-02:** ¿quién da de alta (solo superadmin, como el template, o autoservicio)? ¿Qué datos mínimos lleva el alta (nombre, administrador, empresas iniciales)?

## Fuera de alcance

- Todo lo que no figura arriba. En particular: no se inventan pantallas, planes de precios ni flujos de autoservicio.
- No se cambia el modelo de datos más allá de lo que Q1/Q2 confirmen.
