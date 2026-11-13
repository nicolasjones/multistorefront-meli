# Sitio de documentación (MkDocs Material) — build estático + Nginx.
FROM squidfunk/mkdocs-material:9 AS build
WORKDIR /docs
COPY requirements-docs.txt mkdocs.yml ./
COPY docs ./docs
RUN pip install --no-cache-dir -r requirements-docs.txt && mkdocs build --strict

FROM nginx:1.27-alpine
COPY --from=build /docs/site /usr/share/nginx/html
