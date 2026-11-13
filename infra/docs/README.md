# Documentación (sitio)

Sitio MkDocs Material generado desde `docs/`.

```bash
pnpm docs:wiki:site     # build estático en site/
pnpm docs:wiki:serve    # servidor local en http://localhost:8000
pnpm docs:wiki:check    # links, nav e inventario
```

Imagen para Dokploy:

```bash
docker build -f infra/docs/Dockerfile -t msf-docs:local .
```

El `Dockerfile` compila el sitio y lo sirve con Nginx. En Dokploy, crear una app con ese Dockerfile y el dominio correspondiente.
