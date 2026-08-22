ARG DAYTONA_BASE_IMAGE=ubuntu:24.04
ARG FFF_NODE_VERSION=0.10.3
ARG DELTA_VERSION=0.19.2
ARG GH_VERSION=2.94.0
ARG TTYD_VERSION=1.7.7
ARG UV_VERSION=0.9.26

FROM ${DAYTONA_BASE_IMAGE}

ARG FFF_NODE_VERSION=0.10.3
ARG DELTA_VERSION=0.19.2
ARG GH_VERSION=2.94.0
ARG TTYD_VERSION=1.7.7
ARG UV_VERSION=0.9.26
ARG CUA_DRIVER_VERSION=0.21.0

USER root
SHELL ["/bin/bash", "-lc"]

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    AUTOPR_FFF_HOME=/opt/autopr/fff \
    AUTOPR_FFF_BIN=/opt/autopr/bin \
    FFF_FRECENCY_DB=/home/daytona/.cache/autopr/fff/frecency.mdb \
    FFF_HISTORY_DB=/home/daytona/.cache/autopr/fff/history.mdb

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      at-spi2-core \
      bat \
      build-essential \
      ca-certificates \
      curl \
      dbus-x11 \
      dnsutils \
      fd-find \
      ffmpeg \
      fzf \
      git-lfs \
      gnupg \
      htop \
      jq \
      less \
      libx11-6 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      lsof \
      nano \
      netcat-openbsd \
      nodejs \
      npm \
      novnc \
      procps \
      python3 \
      python3-pip \
      python3-venv \
      psmisc \
      ripgrep \
      sqlite3 \
      sudo \
      tini \
      tmux \
      tree \
      unzip \
      websockify \
      vim \
      wmctrl \
      x11-apps \
      x11-utils \
      x11-xserver-utils \
      x11vnc \
      xclip \
      xdg-utils \
      xfce4 \
      xfce4-terminal \
      xvfb \
      zip \
    && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
      install -m 0755 -d /etc/apt/keyrings; \
      curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /etc/apt/keyrings/google-linux.gpg; \
      chmod 0644 /etc/apt/keyrings/google-linux.gpg; \
      echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list; \
      apt-get update; \
      apt-get install -y --no-install-recommends google-chrome-stable; \
    else \
      echo "AutoPR's Chrome-only Daytona desktop requires linux/amd64." >&2; \
      exit 1; \
    fi \
    && rm -rf /var/lib/apt/lists/* \
    && existing_user="$(getent passwd 1000 | cut -d: -f1 || true)" \
    && existing_group="$(getent group 1000 | cut -d: -f1 || true)" \
    && if [ -n "$existing_group" ] && [ "$existing_group" != daytona ]; then groupmod --new-name daytona "$existing_group"; elif [ -z "$existing_group" ]; then groupadd --gid 1000 daytona; fi \
    && if [ -n "$existing_user" ] && [ "$existing_user" != daytona ]; then usermod --login daytona --home /home/daytona --move-home --shell /bin/bash --gid daytona "$existing_user"; elif [ -z "$existing_user" ]; then useradd --uid 1000 --gid daytona --create-home --shell /bin/bash daytona; fi \
    && install -d -m 0755 /etc/sudoers.d \
    && printf 'daytona ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/daytona \
    && chmod 0440 /etc/sudoers.d/daytona \
    && ln -sfn /usr/bin/fdfind /usr/local/bin/fd \
    && ln -sfn /usr/bin/batcat /usr/local/bin/bat \
    && architecture="$(dpkg --print-architecture)" \
    && case "$architecture" in \
      amd64) \
        delta_target="x86_64-unknown-linux-gnu"; \
        delta_checksum="8e695c5f586a8c53d6c3b01be0b4a422ed218bfed2a56191caebe373a1c18ab2"; \
        gh_arch="amd64"; \
        gh_checksum="a757f1ba6db18f4de8cbadb244843a5f89bc75b5e7c6fc127d2bd77fbd12ed62"; \
        ttyd_target="x86_64"; \
        ttyd_checksum="8a217c968aba172e0dbf3f34447218dc015bc4d5e59bf51db2f2cd12b7be4f55"; \
        ;; \
      arm64) \
        delta_target="aarch64-unknown-linux-gnu"; \
        delta_checksum="0bfce159a5cddd5feb3d6db4a616d883ff51253ce08ac7ec11cb1d208cfaab9e"; \
        gh_arch="arm64"; \
        gh_checksum="705a23b70b0f1b7ba4c302fdcef392ce3edaacfa7ce8e85e4d93d72ea800a538"; \
        ttyd_target="aarch64"; \
        ttyd_checksum="b38acadd89d1d396a0f5649aa52c539edbad07f4bc7348b27b4f4b7219dd4165"; \
        ;; \
      *) \
        echo "Unsupported architecture for pinned delta, gh, and ttyd binaries: $architecture" >&2; \
        exit 1; \
        ;; \
    esac \
    && tools_dir="$(mktemp -d)" \
    && delta_archive="delta-${DELTA_VERSION}-${delta_target}.tar.gz" \
    && curl -fsSL "https://github.com/dandavison/delta/releases/download/${DELTA_VERSION}/${delta_archive}" -o "${tools_dir}/${delta_archive}" \
    && echo "${delta_checksum}  ${tools_dir}/${delta_archive}" | sha256sum -c - \
    && tar -xzf "${tools_dir}/${delta_archive}" -C "$tools_dir" \
    && install -m 0755 "${tools_dir}/delta-${DELTA_VERSION}-${delta_target}/delta" /usr/local/bin/delta \
    && gh_archive="gh_${GH_VERSION}_linux_${gh_arch}.tar.gz" \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/${gh_archive}" -o "${tools_dir}/${gh_archive}" \
    && echo "${gh_checksum}  ${tools_dir}/${gh_archive}" | sha256sum -c - \
    && tar -xzf "${tools_dir}/${gh_archive}" -C "$tools_dir" \
    && install -m 0755 "${tools_dir}/gh_${GH_VERSION}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh \
    && ttyd_binary="ttyd.${ttyd_target}" \
    && curl -fsSL "https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/${ttyd_binary}" -o "${tools_dir}/${ttyd_binary}" \
    && echo "${ttyd_checksum}  ${tools_dir}/${ttyd_binary}" | sha256sum -c - \
    && install -m 0755 "${tools_dir}/${ttyd_binary}" /usr/local/bin/ttyd \
    && rm -rf "$tools_dir" \
    && python3 -m venv /opt/autopr/uv \
    && /opt/autopr/uv/bin/pip install --no-cache-dir "uv==${UV_VERSION}" \
    && ln -s /opt/autopr/uv/bin/uv /usr/local/bin/uv \
    && ln -s /opt/autopr/uv/bin/uvx /usr/local/bin/uvx \
    && git lfs install --system \
    && if [ -e /opt/google/chrome/chrome-sandbox ]; then chown root:root /opt/google/chrome/chrome-sandbox && chmod 4755 /opt/google/chrome/chrome-sandbox; fi \
    && for browser_package in firefox firefox-esr chromium chromium-browser; do ! dpkg-query -W -f='${db:Status-Abbrev}' "$browser_package" 2>/dev/null | grep -q '^ii'; done \
    && for executable in bash google-chrome-stable node npm uv rg fd fdfind fzf bat batcat delta flock gh lsof nc dig ps pstree sqlite3 tmux ttyd wmctrl xprop Xvfb x11vnc websockify startxfce4; do command -v "$executable" >/dev/null; done \
    && test "$(command -v tini)" = /usr/bin/tini \
    && test "$(getent passwd daytona | cut -d: -f7)" = /bin/bash

COPY cursor-theme/build_hidden_xcursor.py /tmp/autopr-build-hidden-xcursor.py

RUN set -euxo pipefail \
    && echo '==> Building the hidden Xcursor theme' \
    && command -v uv >/dev/null \
    && command -v xcursorgen >/dev/null \
    && python3 /tmp/autopr-build-hidden-xcursor.py --output /usr/share/icons/AutoPRHidden \
    && test -s /usr/share/icons/AutoPRHidden/cursors/left_ptr \
    && echo '==> Installing the isolated CUA Python 3.13 runtime' \
    && UV_PYTHON_INSTALL_DIR=/opt/autopr/python uv python install 3.13 \
    && UV_PYTHON_INSTALL_DIR=/opt/autopr/python uv venv /opt/autopr/cua --python 3.13 \
    && echo '==> Installing the official CUA Driver SDK' \
    && uv pip install --python /opt/autopr/cua/bin/python --no-cache "cua-driver==${CUA_DRIVER_VERSION}" \
    && CUA_EXPECTED_DRIVER_VERSION="$CUA_DRIVER_VERSION" /opt/autopr/cua/bin/python -c 'import os; from importlib.metadata import version; from cua_driver import CuaDriver, get_binary_path; from cua_driver._native_contract import ActionTarget, ClipboardReadInput, GetSessionInput; assert version("cua-driver") == os.environ["CUA_EXPECTED_DRIVER_VERSION"]; assert get_binary_path().is_file(); assert hasattr(CuaDriver, "get_desktop_state"); assert hasattr(CuaDriver, "clipboard_read"); assert ActionTarget.DESKTOP(display_id="primary").display_id == "primary"; assert ClipboardReadInput(include_text=True, session=None).session is None; assert GetSessionInput(session=None).session is None' \
    && rm -f /tmp/autopr-build-hidden-xcursor.py

RUN mkdir -p "$AUTOPR_FFF_HOME" "$AUTOPR_FFF_BIN" /home/daytona/.cache/autopr/fff /opt/autopr/terminal /opt/autopr/cua-gateway

COPY . /opt/autopr/source/

RUN if [ -f /usr/local/share/nvm/nvm.sh ]; then source /usr/local/share/nvm/nvm.sh && nvm use default >/dev/null; fi \
    && install -m 0644 /opt/autopr/source/fff-cli.mjs /opt/autopr/fff/cli.mjs \
    && install -m 0755 /opt/autopr/source/autopr-fff /opt/autopr/bin/autopr-fff \
    && install -m 0644 /opt/autopr/source/cua_gateway.py /opt/autopr/cua-gateway/cua_gateway.py \
    && install -m 0755 /opt/autopr/source/autopr-cua-gateway /opt/autopr/bin/autopr-cua-gateway \
    && /opt/autopr/cua/bin/python -m py_compile /opt/autopr/cua-gateway/cua_gateway.py \
    && install -d -m 0755 /etc/gitconfig.d \
    && install -m 0644 /opt/autopr/source/gitconfig /etc/gitconfig.d/autopr \
    && git config --system --add include.path /etc/gitconfig.d/autopr \
    && install -m 0644 /opt/autopr/source/tmux.conf /opt/autopr/terminal/tmux.conf \
    && rm -rf /opt/autopr/desktop \
    && cp -R /opt/autopr/source/desktop /opt/autopr/desktop \
    && node --version \
    && npm --version \
    && cd "$AUTOPR_FFF_HOME" \
    && npm init -y >/dev/null \
    && npm install --omit=dev --no-audit --no-fund "@ff-labs/fff-node@${FFF_NODE_VERSION}" \
    && chmod +x /opt/autopr/bin/autopr-fff /opt/autopr/bin/autopr-cua-gateway \
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
    && test -x /opt/autopr/bin/google-chrome \
    && test -f /usr/share/icons/hicolor/48x48/apps/org.xfce.terminal.png \
    && install -d /usr/share/backgrounds/autopr \
    && install -m 0644 /opt/autopr/desktop/assets/wallpaper.png /usr/share/backgrounds/autopr/wallpaper.png \
    && install -d -o daytona -g daytona \
      /home/daytona/.config \
      /home/daytona/.config/autostart \
      /home/daytona/.config/gtk-3.0 \
      /home/daytona/.config/Thunar \
      /home/daytona/.config/xfce4 \
      /home/daytona/.cache \
      /home/daytona/.local/share/applications \
    && install -m 0644 -o daytona -g daytona /opt/autopr/terminal/tmux.conf /home/daytona/.tmux.conf \
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
ENV HOME=/home/daytona \
    DISPLAY=:1 \
    VNC_RESOLUTION=1920x1080 \
    VNC_COL_DEPTH=24 \
    VNC_PORT=5901 \
    NO_VNC_PORT=6080 \
    NOVNC_PORT=6080 \
    VNC_USER=daytona \
    SHELL=/bin/bash \
    BROWSER=google-chrome \
    XCURSOR_THEME=Adwaita \
    XCURSOR_SIZE=32

EXPOSE 5901 6080 8765

USER daytona

RUN mkdir -p /home/daytona/.cache/autopr/fff \
    && test "$SHELL" = /bin/bash \
    && test -x /bin/bash \
    && ! command -v zsh >/dev/null

ENTRYPOINT ["/usr/bin/tini", "--", "sleep", "infinity"]
