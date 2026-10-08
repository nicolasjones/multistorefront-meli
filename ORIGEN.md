# Versión de origen

Este repositorio nace como copia sin historial de
[`nicolasjones/automation-platform-template`](https://github.com/nicolasjones/automation-platform-template),
partiendo del commit:

- **Commit:** `c6351259e7fbc3fcefcfae9600432fcefe45b3ff`
- **Fecha de la copia:** 2026-10-07
- **Rama de origen:** `main`

Se eligió copia sin historial (en vez de fork) para no arrastrar la
bitácora del template; la historia propia empieza en el commit inicial de
este repo. La identidad se renombró de `automation-platform-template` a
`multistorefront-meli` y los puertos de desarrollo a la serie 43xx/93xx
(WEB 4300, Supabase API 9300, Postgres 7634) para correr en paralelo con el
template y con estudio-contable-automation en la misma máquina.

## Traer mejoras del template

El remoto `upstream` apunta al template:

```
git fetch upstream
git merge upstream/main
```

Los archivos propios de plataforma (esquema `public`, mecanismos de
`apps/web`, `infra/`, `supabase/migrations` anteriores a este fork) siguen
evolucionando ahí. Lo específico de este producto vive en el esquema
`dominio`, en migraciones nuevas y en páginas/specs propias — mientras esa
frontera se respete, los merges de `upstream/main` no deberían chocar.

## Devolver algo al template

No se hace por `cherry-pick` directo: un cambio solo vuelve al template si
sirve a más de un dominio, reescrito ahí sin conceptos de este producto.
Con un solo producto derivado activo al inicio, es esperable que por ahora
casi nada califique.

Nota: `docs/roadmap-template.md` (si se trae por merge) y `specs/` quedan
como referencia heredada del template y no se editan desde este repo — evita
que cada `merge upstream/main` choque contra cambios propios ahí.

## Producto

Multistorefront Mercado Libre: una organización administra una o más
empresas con catálogo y stock únicos; cada empresa tiene su tienda online,
sus precios y sus cuentas de Mercado Libre. Alcance y roadmap (Hitos 1–4
hasta el 31/12/2026, Mercado Libre en Etapa 2 desde enero 2027) se
especifican con Spec Kit en este repo, una spec por épica.
