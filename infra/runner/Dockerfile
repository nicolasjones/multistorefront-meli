FROM ubuntu:24.04

ARG RUNNER_VERSION=2.337.0
ARG SCOUT_VERSION=1.26.0
ARG SUPABASE_CLI_VERSION=2.116.0
# SHA256 de los binarios (los publica cada release; se recalculan al subir la versión). Un binario alterado NO entra a la imagen (MSF-712).
ARG SCOUT_SHA256=47daa9ac442816316c65389f516b847146bb9f45e8d6afdcbb9ce835c4e138bd
ARG SUPABASE_CLI_SHA256=5b3031cb297d51b25be4c284e4c852254460ec722ec221d3b81b07d55acfd158
ARG PLAYWRIGHT_VERSION=1.61.0
ARG RUNNER_UID=1001
ARG RUNNER_GID=1001
# MSF-703: el runner de GitHub y TODOS los jobs corren como el usuario `runner` (no root). El único proceso root es el entrypoint (PID 1), que lee
# el PAT de un archivo de secretos y arranca el listener ya sin privilegios (ver entrypoint.mjs / config-runner.mjs). No hay RUNNER_ALLOW_RUNASROOT.

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates jq git gnupg lsb-release \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
      > /etc/apt/sources.list.d/docker.list \
    && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get update && apt-get install -y --no-install-recommends \
      docker-ce docker-ce-cli containerd.io docker-compose-plugin docker-buildx-plugin nodejs \
      postgresql-client libtap-parser-sourcehandler-pgtap-perl \
      openssh-client procps iptables \
    && npm install -g pnpm@11.19.0 \
    && rm -rf /var/lib/apt/lists/*
# docker-ce (el daemon `dockerd`): el rol `pr` y el rol `deploy` usan su PROPIO daemon dentro del contenedor (runtime sysbox), nunca el del host
# (no se monta /var/run/docker.sock). Sin sysbox el entrypoint falla con un mensaje claro en vez de caer a un daemon inseguro.
# docker-buildx-plugin: worker-images.yml exige provenance y SBOM (docker buildx build --provenance=true --sbom=true).
# openssh-client: el deploy de infraestructura controla el Docker remoto del VPS vía DOCKER_HOST=ssh://usuario@host.
# pg_prove (del paquete pgtap) corre los tests pgTAP contra el Postgres que levanta el stack de Supabase del propio runner.

# Dependencias del SO de Chromium para Playwright, instaladas al construir la imagen: `playwright install-deps` necesita root y el job ya no lo es.
# Los workflows lo saltean cuando no corren como root (ver .github/workflows/validate.yml). Misma versión que apps/web/package.json.
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install-deps chromium && rm -rf /var/lib/apt/lists/* /root/.npm

# docker-scout-plugin no existe como paquete apt (confirmado 2026-10-05): tarball pineado por versión, en el directorio de plugins del SISTEMA
# (no en el HOME de nadie: el job puede cambiar DOCKER_CONFIG sin perderlo).
RUN curl -fsSL -o scout.tar.gz \
      "https://github.com/docker/scout-cli/releases/download/v${SCOUT_VERSION}/docker-scout_${SCOUT_VERSION}_linux_amd64.tar.gz" \
    && if [ -n "$SCOUT_SHA256" ]; then echo "$SCOUT_SHA256  scout.tar.gz" | sha256sum -c -; else echo "AVISO: SCOUT_SHA256 vacío, el plugin no se verifica (pasalo con --build-arg)" >&2; fi \
    && mkdir -p /usr/local/lib/docker/cli-plugins \
    && tar xzf scout.tar.gz --no-same-owner -C /usr/local/lib/docker/cli-plugins docker-scout \
    && chown root:root /usr/local/lib/docker/cli-plugins/docker-scout \
    && chmod 0755 /usr/local/lib/docker/cli-plugins/docker-scout \
    && rm -f scout.tar.gz
# Supabase CLI verificado por SHA256 (MSF-712) e instalado en un directorio que el usuario `runner` no puede modificar.
RUN curl -fsSL -o supabase.tar.gz \
      "https://github.com/supabase/cli/releases/download/v${SUPABASE_CLI_VERSION}/supabase_${SUPABASE_CLI_VERSION}_linux_amd64.tar.gz" \
    && echo "${SUPABASE_CLI_SHA256}  supabase.tar.gz" | sha256sum -c - \
    && tar xzf supabase.tar.gz --no-same-owner -C /usr/local/bin supabase \
    && chown root:root /usr/local/bin/supabase \
    && chmod 0755 /usr/local/bin/supabase \
    && rm -f supabase.tar.gz

RUN groupadd --gid "${RUNNER_GID}" runner \
    && useradd --create-home --uid "${RUNNER_UID}" --gid "${RUNNER_GID}" --shell /bin/bash runner

WORKDIR /home/runner
RUN curl -fsSL -o actions-runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz" \
    && tar xzf actions-runner.tar.gz && rm actions-runner.tar.gz \
    && ./bin/installdependencies.sh \
    && chown -R runner:runner /home/runner

# Los módulos del entrypoint van en `/` y de solo lectura: ni el usuario `runner` ni un job pueden alterarlos.
COPY entrypoint.mjs config-runner.mjs restaurar-bin.mjs /
RUN chmod 0555 /entrypoint.mjs /config-runner.mjs /restaurar-bin.mjs

ENTRYPOINT ["node", "/entrypoint.mjs"]
