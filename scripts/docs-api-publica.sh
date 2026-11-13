#!/usr/bin/env bash
# Construye el subsitio público de la API (mkdocs-api-publica.yml) en `site-api-publica/`.
# Arma `docs-api-publica/` con SOLO la guía, la referencia y la hoja de estilos de marca: nada más del sitio entra al
# subsitio público. Uso: bash scripts/docs-api-publica.sh   (necesita Docker; usa la misma imagen que `pnpm docs:wiki:site`).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf docs-api-publica site-api-publica
mkdir -p docs-api-publica/stylesheets
cp docs/api/inicio-rapido.md docs-api-publica/index.md   # la guía es la portada del subsitio
cp docs/api/referencia.md docs-api-publica/
cp docs/stylesheets/msf.css docs-api-publica/stylesheets/
docker run --rm --entrypoint sh -v "$PWD:/docs" -w /docs squidfunk/mkdocs-material:9 \
  -c "pip install -r requirements-docs.txt >/dev/null 2>&1 && mkdocs build --strict -f mkdocs-api-publica.yml"
rm -rf docs-api-publica
echo "Subsitio listo en site-api-publica/ (publicar como /api-publica/)."
