#!/usr/bin/env bash
# MSF-648 · Firewall del VPS: desde Internet solo entran 22, 80 y 443; el resto (Postgres 7634-7636, Studio 4301/4304/4305, Kong 9300-9302,
# Inbucket 4306/4307, Dokploy 3000, Kestra, Superset, Nango...) solo por loopback o por la interfaz de Tailscale.
#
# Por qué dos capas: `ufw` filtra el tráfico DEL HOST (cadena INPUT) pero NO el de los puertos que Docker publica (cadena FORWARD, tras el
# DNAT). Para esos, Docker deja la cadena DOCKER-USER, que se evalúa ANTES que sus propias reglas: ahí van las reglas de abajo. Se filtra por
# el puerto ORIGINAL de destino (`conntrack --ctorigdstport`), porque en DOCKER-USER el paquete ya trae el puerto del contenedor.
#
# SOLO IMPRIME por defecto (no toca nada). Con --aplicar:
#   1. guarda el estado actual (iptables-save) y el de ufw;
#   2. aplica las reglas, permitiendo ANTES el puerto 22 (no te encerrás);
#   3. arma un rollback automático: si en --rollback-segundos (120 por defecto) no existe el archivo de confirmación, restaura el estado previo.
#      Desde OTRA sesión SSH comprobá que entrás y confirmá con:  touch /run/firewall-docker-user.confirmado
# Persistencia tras un reinicio: docs/endurecimiento-infra.md, «Firewall del VPS».
#
# Uso: infra/vps/firewall-docker-user.sh [--aplicar] [--interfaz-externa eth0] [--interfaz-tailscale tailscale0]
#                                         [--puertos-publicos 22,80,443] [--rollback-segundos 120] [--sin-rollback]
# --sin-rollback (solo con --aplicar) es para la unidad systemd que reaplica las reglas al arrancar: sin rollback ni confirmación.
# Variables de prueba: IPTABLES, IPTABLES_SAVE, IPTABLES_RESTORE, UFW (rutas de los binarios), ARCHIVO_CONFIRMACION, DIR_RESPALDO.
set -euo pipefail

IPTABLES="${IPTABLES:-iptables}"
IPTABLES_SAVE="${IPTABLES_SAVE:-iptables-save}"
IPTABLES_RESTORE="${IPTABLES_RESTORE:-iptables-restore}"
UFW="${UFW:-ufw}"
ARCHIVO_CONFIRMACION="${ARCHIVO_CONFIRMACION:-/run/firewall-docker-user.confirmado}"
DIR_RESPALDO="${DIR_RESPALDO:-/root/respaldo-firewall}"

aplicar=0
externa=""
tailscale="tailscale0"
publicos="22,80,443"
rollback=120
sin_rollback=0

while [ $# -gt 0 ]; do
  case "$1" in
    --aplicar) aplicar=1; shift ;;
    --interfaz-externa) externa="${2:-}"; shift 2 ;;
    --interfaz-tailscale) tailscale="${2:-}"; shift 2 ;;
    --puertos-publicos) publicos="${2:-}"; shift 2 ;;
    --rollback-segundos) rollback="${2:-}"; shift 2 ;;
    --sin-rollback) sin_rollback=1; shift ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

error() { echo "Error: $*" >&2; exit 2; }

# Validación estricta: estos valores terminan en comandos de firewall.
case "$publicos" in ''|*[!0-9,]*|,*|*,|*,,*) error "--puertos-publicos debe ser una lista de números separada por comas" ;; esac
case "$rollback" in ''|*[!0-9]*) error "--rollback-segundos debe ser un número" ;; esac
[ "$rollback" -ge 30 ] && [ "$rollback" -le 3600 ] || error "--rollback-segundos entre 30 y 3600"
for nombre in "$tailscale" "$externa"; do
  case "$nombre" in ''|*[!A-Za-z0-9._-]*) [ -z "$nombre" ] || error "nombre de interfaz inválido" ;; esac
done
IFS=',' read -r -a lista_puertos <<< "$publicos"
tiene22=0
for p in "${lista_puertos[@]}"; do
  [ "$p" -ge 1 ] && [ "$p" -le 65535 ] || error "puerto fuera de rango: $p"
  [ "$p" = "22" ] && tiene22=1
done
[ "$tiene22" = 1 ] || error "--puertos-publicos debe incluir 22 (si no, te quedás sin SSH)"

# Interfaz externa: la de la ruta por defecto, salvo que se indique.
if [ -z "$externa" ]; then
  externa="$(ip -o route show default 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -n1 || true)"
fi
[ -n "$externa" ] || error "no pude detectar la interfaz externa: indicala con --interfaz-externa"

# `paso` imprime el comando (modo plan) o lo ejecuta (--aplicar); `paso_tolerante` ignora el fallo (la cadena ya existe si Docker corre).
paso() { if [ "$aplicar" = 1 ]; then "$@"; else printf '%q ' "$@"; echo; fi; }
paso_tolerante() { if [ "$aplicar" = 1 ]; then "$@" 2>/dev/null || true; else printf '%q ' "$@"; echo; fi; }

plan() {
  # --- Capa 1: ufw (tráfico del host: SSH, Dokploy 3000 si no va por Traefik, etc.) ---
  paso "$UFW" default deny incoming
  paso "$UFW" default allow outgoing
  for p in "${lista_puertos[@]}"; do paso "$UFW" allow "$p/tcp"; done
  paso "$UFW" allow in on "$tailscale"
  paso "$UFW" --force enable

  # --- Capa 2: DOCKER-USER (puertos publicados por Docker: Postgres, Studio, Kong, Inbucket, Dokploy swarm...) ---
  paso_tolerante "$IPTABLES" -N DOCKER-USER
  paso "$IPTABLES" -F DOCKER-USER
  paso "$IPTABLES" -A DOCKER-USER -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  paso "$IPTABLES" -A DOCKER-USER -i lo -j RETURN
  paso "$IPTABLES" -A DOCKER-USER -i "$tailscale" -j RETURN
  for p in "${lista_puertos[@]}"; do
    paso "$IPTABLES" -A DOCKER-USER -i "$externa" -p tcp -m conntrack --ctorigdstport "$p" -j RETURN
  done
  paso "$IPTABLES" -A DOCKER-USER -i "$externa" -j DROP
  paso "$IPTABLES" -A DOCKER-USER -j RETURN
}

if [ "$aplicar" = 0 ]; then
  echo "# Plan (no se ejecutó nada). Interfaz externa: $externa · Tailscale: $tailscale · públicos: $publicos"
  plan
  echo "# Para aplicarlo con rollback automático: $0 --aplicar"
  exit 0
fi

[ "$(id -u)" = 0 ] || error "--aplicar necesita root"
mkdir -p "$DIR_RESPALDO"
chmod 700 "$DIR_RESPALDO"
marca="$(date +%Y%m%d-%H%M%S)"
respaldo_ipt="$DIR_RESPALDO/iptables-$marca.rules"
"$IPTABLES_SAVE" > "$respaldo_ipt"
ufw_estaba_activo=0
if "$UFW" status 2>/dev/null | grep -q "Status: active"; then ufw_estaba_activo=1; fi
rm -f "$ARCHIVO_CONFIRMACION"

if [ "$sin_rollback" = 0 ]; then
  # Rollback automático en segundo plano: si no se confirma, vuelve al estado previo.
  (
    sleep "$rollback"
    if [ ! -f "$ARCHIVO_CONFIRMACION" ]; then
      "$IPTABLES_RESTORE" < "$respaldo_ipt"
      [ "$ufw_estaba_activo" = 1 ] || "$UFW" --force disable
      echo "Rollback del firewall ejecutado (no se confirmó a tiempo)." >&2
    fi
  ) &
  echo "Rollback programado en ${rollback}s (pid $!). Respaldo: $respaldo_ipt"
fi

plan

if [ "$sin_rollback" = 0 ]; then echo "Reglas aplicadas. Desde OTRA sesión SSH comprobá el acceso y confirmá con: touch $ARCHIVO_CONFIRMACION"; else echo "Reglas aplicadas (sin rollback)."; fi
