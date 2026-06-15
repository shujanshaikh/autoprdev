ARG DAYTONA_BASE_IMAGE=daytonaio/sandbox:0.8.0
ARG FFF_NODE_VERSION=0.9.4

FROM ${DAYTONA_BASE_IMAGE}

ARG FFF_NODE_VERSION=0.9.4

USER root
SHELL ["/bin/bash", "-lc"]

ENV AUTOPR_FFF_HOME=/opt/autopr/fff \
    AUTOPR_FFF_BIN=/opt/autopr/bin \
    FFF_FRECENCY_DB=/home/daytona/.cache/autopr/fff/frecency.mdb \
    FFF_HISTORY_DB=/home/daytona/.cache/autopr/fff/history.mdb

RUN mkdir -p "$AUTOPR_FFF_HOME" "$AUTOPR_FFF_BIN" /home/daytona/.cache/autopr/fff

COPY fff-cli.mjs /opt/autopr/fff/cli.mjs
COPY autopr-fff /opt/autopr/bin/autopr-fff

RUN if [ -f /usr/local/share/nvm/nvm.sh ]; then source /usr/local/share/nvm/nvm.sh && nvm use default >/dev/null; fi \
    && node --version \
    && npm --version \
    && cd "$AUTOPR_FFF_HOME" \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund "@ff-labs/fff-node@${FFF_NODE_VERSION}" \
    && chmod +x /opt/autopr/bin/autopr-fff \
    && chown -R daytona:daytona /opt/autopr /home/daytona/.cache/autopr

ENV PATH=/opt/autopr/bin:${PATH}

USER daytona

RUN mkdir -p /home/daytona/.cache/autopr/fff

ENTRYPOINT ["sleep", "infinity"]
