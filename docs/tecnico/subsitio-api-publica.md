---
owner: tecnico
sources: []
---

# Subsitio público de la API (`/api-publica/`)

El sitio de documentación completo está detrás de un acceso con contraseña (Traefik `basicAuth`) porque incluye
documentación técnica y de operación. Para que quien integra la API pueda leer la guía y la referencia **sin
credenciales**, se publica aparte un subsitio con **solo esas dos páginas**.

## Qué contiene (y qué no)

- La guía [Empezar con la API](../api/inicio-rapido.md) como portada y la [Referencia de la API](../api/referencia.md).
- Su propio buscador, que solo indexa esas dos páginas. Sin `repo_url`, sin enlaces al resto del sitio y sin la
  navegación del sitio completo: nada de la documentación interna entra ahí.
- Config: `mkdocs-api-publica.yml`. Armado: `scripts/docs-api-publica.sh`, que copia `docs/api/inicio-rapido.md`,
  `docs/api/referencia.md` y la hoja de marca a `docs-api-publica/` y compila con la misma imagen que
  `pnpm docs:wiki:site`.

## Construir y publicar

```bash
bash scripts/docs-api-publica.sh                                          # genera site-api-publica/
rsync -a --delete site-api-publica/ <hub>:/srv/docs-site/api-publica/     # publica el subsitio
```

Un router de Traefik (`docs-site-router-api-publica`, prioridad 1000, en `/etc/dokploy/traefik/dynamic/docs-site.yml`
del hub) deja pública **solo** la ruta `/api-publica`; el resto del sitio sigue con `basicAuth`.

!!! warning "Al republicar el sitio completo"
    Hay que excluir el subsitio, o el `--delete` lo borra:
    `rsync -a --delete --exclude=/api-publica/ site/ <hub>:/srv/docs-site/`.

## Cuando cambia el contrato de la API

1. En `dokploy`: `pnpm openapi:escribir` (regenera la referencia) y mergear.
2. En `main`: copiar `docs/api/*.md`, regenerar el manifest y mergear.
3. Volver a publicar el sitio completo (con `--exclude`) y el subsitio.

## Reversión

Para volver a cerrar la ruta, quitar el router `docs-site-router-api-publica` de `docs-site.yml` (el hub guarda una copia
previa como `docs-site.yml.respaldo-20261112`); Traefik recarga el archivo solo. Los archivos del subsitio pueden quedar:
sin el router, la ruta pide contraseña como el resto.
