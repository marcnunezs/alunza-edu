FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
COPY --chmod=0555 bridge.cjs worker.cjs /opt/alunza/
RUN test -x /usr/bin/setpriv && node --version | grep -x v24.21.0
WORKDIR /tmp
ENTRYPOINT ["node", "/opt/alunza/bridge.cjs"]
