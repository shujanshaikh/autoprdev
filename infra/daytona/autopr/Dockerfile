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
      fish \
      git-lfs \
      gnupg \
      htop \
      jq \
      less \
      nano \
      tmux \
      tree \
      unzip \
      vim \
      x11-apps \
      x11-xserver-utils \
      xdg-utils \
      xterm \
      zip \
      zsh \
    && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      install -m 0755 -d /etc/apt/keyrings; \
      curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-linux.gpg; \
      chmod 0644 /etc/apt/keyrings/google-linux.gpg; \
      echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list; \
      apt-get update; \
      apt-get install -y --no-install-recommends google-chrome-stable; \
    else \
      echo "Google Chrome stable is only published for amd64; leaving the base browser stack unchanged."; \
    fi \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install --system \
    && if [ -e /opt/google/chrome/chrome-sandbox ]; then chown root:root /opt/google/chrome/chrome-sandbox && chmod 4755 /opt/google/chrome/chrome-sandbox; fi \
    && curl -fsSL https://starship.rs/install.sh | sh -s -- --yes --bin-dir /usr/local/bin \
    && chsh -s "$(command -v zsh)" daytona

RUN mkdir -p "$AUTOPR_FFF_HOME" "$AUTOPR_FFF_BIN" /home/daytona/.cache/autopr/fff /opt/autopr/terminal

COPY . /opt/autopr/source/

RUN if [ -f /usr/local/share/nvm/nvm.sh ]; then source /usr/local/share/nvm/nvm.sh && nvm use default >/dev/null; fi \
    && install -m 0644 /opt/autopr/source/fff-cli.mjs /opt/autopr/fff/cli.mjs \
    && install -m 0755 /opt/autopr/source/autopr-fff /opt/autopr/bin/autopr-fff \
    && install -m 0644 /opt/autopr/source/starship.toml /opt/autopr/terminal/starship.toml \
    && install -m 0644 /opt/autopr/source/zshrc /opt/autopr/terminal/zshrc \
    && rm -rf /opt/autopr/desktop \
    && cp -R /opt/autopr/source/desktop /opt/autopr/desktop \
    && node --version \
    && npm --version \
    && cd "$AUTOPR_FFF_HOME" \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund "@ff-labs/fff-node@${FFF_NODE_VERSION}" \
    && chmod +x /opt/autopr/bin/autopr-fff \
    && chmod +x /opt/autopr/desktop/autopr-desktop-session \
    && chmod +x /opt/autopr/desktop/startxfce4-autopr \
    && if [ -x /usr/bin/startxfce4 ] && [ ! -e /usr/bin/startxfce4.autopr-original ]; then mv /usr/bin/startxfce4 /usr/bin/startxfce4.autopr-original; fi \
    && install -m 0755 /opt/autopr/desktop/startxfce4-autopr /usr/bin/startxfce4 \
    && if [ -x /usr/bin/google-chrome-stable ]; then \
      install -m 0755 /opt/autopr/desktop/browser-launcher /opt/autopr/bin/google-chrome; \
      ln -sf /opt/autopr/bin/google-chrome /opt/autopr/bin/google-chrome-stable; \
      ln -sf /opt/autopr/bin/google-chrome /opt/autopr/bin/chromium; \
      ln -sf /opt/autopr/bin/google-chrome /opt/autopr/bin/chromium-browser; \
      install -d /usr/share/applications /usr/share/xfce4/helpers; \
      install -m 0644 /opt/autopr/desktop/applications/google-chrome.desktop /usr/share/applications/google-chrome.desktop; \
      install -m 0644 /opt/autopr/desktop/applications/exo-web-browser.desktop /usr/share/applications/exo-web-browser.desktop; \
      install -m 0644 /opt/autopr/desktop/xfce4/helpers/google-chrome.desktop /usr/share/xfce4/helpers/google-chrome.desktop; \
      for desktop_file in chromium.desktop chromium-browser.desktop x11vnc.desktop; do \
        if [ -f "/usr/share/applications/${desktop_file}" ]; then \
          printf '\nNoDisplay=true\nHidden=true\n' >> "/usr/share/applications/${desktop_file}"; \
        fi; \
      done; \
      update-alternatives --install /usr/bin/x-www-browser x-www-browser /opt/autopr/bin/google-chrome 200; \
      update-alternatives --install /usr/bin/gnome-www-browser gnome-www-browser /opt/autopr/bin/google-chrome 200; \
      install -d /etc/opt/chrome/policies/managed; \
      printf '%s\n' \
        '{' \
        '  "BrowserSignin": 0,' \
        '  "DefaultBrowserSettingEnabled": false,' \
        '  "HomepageIsNewTabPage": true,' \
        '  "PasswordManagerEnabled": false,' \
        '  "PromotionalTabsEnabled": false,' \
        '  "RestoreOnStartup": 5' \
        '}' > /etc/opt/chrome/policies/managed/autopr.json; \
    fi \
    && install -d /usr/share/backgrounds/autopr \
    && install -m 0644 /opt/autopr/desktop/assets/wallpaper.png /usr/share/backgrounds/autopr/wallpaper.png \
    && install -d -o daytona -g daytona \
      /home/daytona/.config \
      /home/daytona/.config/autostart \
      /home/daytona/.config/gtk-3.0 \
      /home/daytona/.config/Thunar \
      /home/daytona/.config/xfce4 \
      /home/daytona/.cache \
      /home/daytona/.cache/starship \
      /home/daytona/.cache/zsh \
      /home/daytona/.local/share/applications \
    && install -m 0644 -o daytona -g daytona /opt/autopr/terminal/starship.toml /home/daytona/.config/starship.toml \
    && install -m 0644 -o daytona -g daytona /opt/autopr/terminal/zshrc /home/daytona/.zshrc \
    && cp -R /opt/autopr/desktop/autostart/. /home/daytona/.config/autostart/ \
    && cp -R /opt/autopr/desktop/gtk-3.0/. /home/daytona/.config/gtk-3.0/ \
    && cp -R /opt/autopr/desktop/gtk-2.0 /home/daytona/.gtk-2.0 \
    && cp -R /opt/autopr/desktop/Thunar/. /home/daytona/.config/Thunar/ \
    && cp -R /opt/autopr/desktop/xfce4/. /home/daytona/.config/xfce4/ \
    && install -m 0644 /opt/autopr/desktop/mimeapps.list /home/daytona/.config/mimeapps.list \
    && install -m 0644 /opt/autopr/desktop/user-dirs.dirs /home/daytona/.config/user-dirs.dirs \
    && install -m 0644 /opt/autopr/desktop/user-dirs.conf /home/daytona/.config/user-dirs.conf \
    && rm -rf /home/daytona/Desktop /home/daytona/Documents /home/daytona/Downloads /home/daytona/Music /home/daytona/Pictures /home/daytona/Public /home/daytona/Templates /home/daytona/Videos \
    && chgrp daytona /home \
    && chmod 0775 /home \
    && chown -R daytona:daytona /opt/autopr /home/daytona/.cache \
    && chown -R daytona:daytona /home/daytona/.config /home/daytona/.gtk-2.0 /home/daytona/.local

ENV PATH=/opt/autopr/bin:${PATH}
ENV DISPLAY=:1 \
    VNC_RESOLUTION=1920x1080 \
    VNC_PORT=5901 \
    NO_VNC_PORT=6080 \
    VNC_USER=daytona \
    SHELL=/usr/bin/zsh \
    BROWSER=google-chrome \
    STARSHIP_CONFIG=/home/daytona/.config/starship.toml \
    STARSHIP_CACHE=/home/daytona/.cache/starship \
    XCURSOR_THEME=Adwaita \
    XCURSOR_SIZE=24

USER daytona

RUN mkdir -p /home/daytona/.cache/autopr/fff /home/daytona/.cache/starship /home/daytona/.cache/zsh

ENTRYPOINT ["sleep", "infinity"]
