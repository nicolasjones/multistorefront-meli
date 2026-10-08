FROM linuxserver/openssh-server:latest

# Fixture local: Docker CLI para que el comando SSH del flow ejecute el worker
# en el daemon montado. No contiene claves ni credenciales.
RUN apk add --no-cache docker-cli

# Ver permitir-socket-docker.sh: las sesiones SSH de esta imagen no heredan
# el grupo "root" del socket montado.
COPY permitir-socket-docker.sh /custom-cont-init.d/10-permitir-socket-docker.sh
RUN chmod +x /custom-cont-init.d/10-permitir-socket-docker.sh
