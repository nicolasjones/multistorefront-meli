# Feature Specification: Acceso, organización y permisos · Organizaciones nuevas

**Feature Branch**: `epic/MSF-162-acceso-organizacion-y-permisos-organizac`

**Jira Epic**: MSF-162 — Acceso, organización y permisos · Organizaciones nuevas (spec `organizaciones-nuevas`)

**Created**: 2026-10-16

**Status**: Draft — alcance fijado por la instrucción de Nicolás (2026-10-16): se usa lo que el template ya trae; no se rehace nada.

**Delivery scope**: `refine` (apps/web, solo verificación/documentación) y `supabase` (pruebas pgTAP). Sin `kestra`, `superset` ni `workers`. Sin migraciones nuevas.

**Prioridad / Hito**: P3 · Backlog · fuera de diciembre. **Horas**: no se contabilizan para esta épica (decisión de Nicolás, por cómo trabajan).

**Dependencias**:
- Bloqueada por: MSF-119 (Acceso y organización, F-ORG-01; ya en `main`).
- Bloquea a: ninguna épica.
- MSF-125 y MSF-121: no se rehacen aquí; no hay dependencia.

**Input**: Epic MSF-162. Objetivo: poder crear organizaciones nuevas con su propio administrador sobre el mismo modelo, para ofrecer la plataforma a otros clientes.

**Prototipo**: la épica no tiene pantallas. La estética sale del sistema de diseño (MSF-117).

## Decisión de alcance (Nicolás, 2026-10-16)

- **Se usa lo que ya está hoy.** El alta de organizaciones del template cubre el objetivo: Edge Function `crear-organizacion`, `pages/organizaciones/{list,create}` y contexto de organización activa para superadmin (`entrar_a_organizacion`, `ContextoPanel`, `OrganizacionActivaBanner`). Todo presente en este repo.
- **No se rehace nada.** Se mantiene `usuarios_organizacion` con `user_id` como clave primaria (un usuario, una organización).
- **Quién da de alta: solo superadmin** (como hoy). Sin autoservicio.
- **No entra**: un usuario en varias organizaciones, selector de organización para usuarios normales, cambio de clave de `usuarios_organizacion`, facturación propia del servicio.
- **Horas**: no se cuentan para la épica.

## Historia

| ID | Nombre | Prioridad |
|----|--------|-----------|
| F-ORG-02 | Alta de nuevas organizaciones | P3 |

### US1 — Alta de organización por superadmin (F-ORG-02)

Un superadmin crea una organización nueva desde `/organizaciones`; el fundador recibe invitación por correo y queda como administrador de esa organización, aislada de las demás.

**Escenarios de aceptación**

1. **Dado** un superadmin, **cuando** crea una organización con nombre y correo del fundador, **entonces** existe la organización y el fundador queda invitado como `administrador` de ella.
2. **Dado** un usuario que no es superadmin, **cuando** intenta crear una organización, **entonces** se rechaza (403) y no se crea nada.
3. **Dado** una invitación que falla (p. ej. el correo ya tiene cuenta), **cuando** se intenta el alta, **entonces** la organización creada se revierte y se informa el motivo.
4. **Dado** la organización nueva, **cuando** su administrador entra, **entonces** no ve datos de ninguna otra organización y las demás no ven los suyos.

## Esquemas (Principio VII — verificación en spec)

Sin tablas nuevas ni alteradas. Tablas involucradas, ya existentes:

| Tabla | Esquema | Justificación |
|-------|---------|---------------|
| `organizaciones` | `public` | Plataforma / transversal |
| `usuarios_organizacion` | `public` | Membresía: plataforma |
| `superadmins` | `public` | Plataforma |

Todas con RLS por organización; la prueba pgTAP de aislamiento recorre `public` + `dominio`.

## Requisitos

- **FR-001** (US1): El alta de una organización nueva la realiza solo un superadmin mediante `crear-organizacion` y `pages/organizaciones/create`, sin cambios de comportamiento respecto del template.
- **FR-002** (US1): El fundador queda invitado como administrador de la organización; si la invitación o la membresía fallan, la organización se revierte.
- **FR-003** (US1): El aislamiento de F-ORG-01 se mantiene con organizaciones nuevas: ningún usuario ve datos de una organización a la que no pertenece.

Criterios de éxito:
- **SC-001**: Los escenarios 1–4 quedan cubiertos por pgTAP o pruebas existentes/ampliadas, con `pnpm lint`, `pnpm build` y `pnpm test` en verde.
- **SC-002**: La documentación funcional describe el alta de organizaciones y sus límites (un usuario, una organización).

## Fuera de alcance

- Un mismo correo en varias organizaciones, selector de organización, cambio de clave de `usuarios_organizacion`, `usuarios_empresas` / `usuario_empresa_activa` (MSF-121/MSF-125).
- Facturación propia del servicio, planes de precios, autoservicio.
- Pantallas nuevas y cambios de modelo de datos. Las empresas de la organización nueva las da de alta su administrador con la pantalla de Empresas existente.
