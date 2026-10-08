# Reusa la imagen oficial de Playwright solo por sus dependencias de SO ya
# instaladas (fuentes, libs de Chromium) — el binario del navegador en sí lo
# instala patchright-core más abajo, parchado para sacar señales de
# automatización que sistemas anti-bot chequean (navigator.webdriver, leak
# de Runtime.enable, marcador HeadlessChrome). Beneficia a cualquier worker
# que se conecte a este servicio compartido, no solo a uno en particular.
# Versión pinneada igual a la de playwright-core en workers/xubio/package.json
# — cliente y servidor deben coincidir para el protocolo de conexión remota.
FROM mcr.microsoft.com/playwright:v1.61.0-noble

USER root
WORKDIR /home/pwuser
RUN npm install patchright-core@1.61.0 \
    && npx patchright-core install chromium --with-deps
USER pwuser
