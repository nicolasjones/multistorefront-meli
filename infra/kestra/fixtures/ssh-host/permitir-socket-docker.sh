#!/usr/bin/with-contenv bash
# Fixture local (spec 014): las sesiones SSH de linuxserver/openssh-server no
# heredan el grupo suplementario "root" (gid 0), aunque /etc/group liste al
# usuario ahi -- es un endurecimiento propio de la imagen. El socket de
# Docker montado pertenece a root:root con modo 660, asi que sin este ajuste
# el comando SSH del flow ve "permission denied" contra la API de Docker.
# Solo abre el socket a lectura/escritura para el propio contenedor fixture;
# no se aplica a un host real de organizacion.
if [ -S /var/run/docker.sock ]; then
  chmod 666 /var/run/docker.sock
fi
