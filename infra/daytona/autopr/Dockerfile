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

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      zsh \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://starship.rs/install.sh | sh -s -- --yes --bin-dir /usr/local/bin \
    && chsh -s "$(command -v zsh)" daytona

RUN mkdir -p "$AUTOPR_FFF_HOME" "$AUTOPR_FFF_BIN" /home/daytona/.cache/autopr/fff /opt/autopr/terminal

COPY fff-cli.mjs /opt/autopr/fff/cli.mjs
COPY autopr-fff /opt/autopr/bin/autopr-fff
COPY starship.toml /opt/autopr/terminal/starship.toml
COPY zshrc /opt/autopr/terminal/zshrc

RUN if [ -f /usr/local/share/nvm/nvm.sh ]; then source /usr/local/share/nvm/nvm.sh && nvm use default >/dev/null; fi \
    && node --version \
    && npm --version \
    && cd "$AUTOPR_FFF_HOME" \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund "@ff-labs/fff-node@${FFF_NODE_VERSION}" \
    && chmod +x /opt/autopr/bin/autopr-fff \
    && install -d -o daytona -g daytona /home/daytona/.config /home/daytona/.cache/starship /home/daytona/.cache/zsh \
    && install -m 0644 -o daytona -g daytona /opt/autopr/terminal/starship.toml /home/daytona/.config/starship.toml \
    && install -m 0644 -o daytona -g daytona /opt/autopr/terminal/zshrc /home/daytona/.zshrc \
    && chown -R daytona:daytona /opt/autopr /home/daytona/.cache/autopr

ENV PATH=/opt/autopr/bin:${PATH}
ENV SHELL=/usr/bin/zsh \
    STARSHIP_CONFIG=/home/daytona/.config/starship.toml \
    STARSHIP_CACHE=/home/daytona/.cache/starship

USER daytona

RUN mkdir -p /home/daytona/.cache/autopr/fff /home/daytona/.cache/starship /home/daytona/.cache/zsh

ENTRYPOINT ["sleep", "infinity"]
