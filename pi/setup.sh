#!/bin/bash
# Idempotent kiosk setup for the dashboard Pi. Safe to re-run at any time.
#
# Runs ON the Pi as the kiosk user (admin) with passwordless sudo.
# Invoked by `bin/pi setup`, which first copies this directory to ~/dashboard-pi.
#
# Assumes Raspberry Pi OS Desktop (Bookworm or newer, labwc session) flashed with
# Raspberry Pi Imager, with hostname/user/ssh key already set. See docs/pi.md.
set -euo pipefail

# The dashboard's hostname, and optionally the LAN IP to pin it to (a hosts override, for when local DNS
# cannot be trusted). bin/pi passes both from your .env.
DASHBOARD_HOST="${DASHBOARD_HOST:?set DASHBOARD_HOST, e.g. dashboard.example.com}"
DASHBOARD_IP="${DASHBOARD_IP:-}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

step() { printf '\n==> %s\n' "$*"; }
skip() { printf '    already done: %s\n' "$*"; }

# 1. Packages ---------------------------------------------------------------
step "packages"
PKGS=(chromium unclutter xserver-xorg x11-xserver-utils xinit lightdm)
MISSING=()
for p in "${PKGS[@]}"; do
  dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p")
done
if [ ${#MISSING[@]} -eq 0 ]; then
  skip "all packages installed"
else
  sudo apt-get update
  sudo apt-get install -y "${MISSING[@]}"
fi

# 2. Hosts override ---------------------------------------------------------
# cloud-init regenerates /etc/hosts from this template on every boot, so the
# override has to live in the template. /etc/hosts is patched too so it takes
# effect without a reboot.
if [ -z "$DASHBOARD_IP" ]; then
  step "hosts override"
  skip "DASHBOARD_IP not set; $DASHBOARD_HOST resolves through DNS"
else
  step "hosts override: $DASHBOARD_HOST -> $DASHBOARD_IP"
  HOSTS_LINE="$DASHBOARD_IP   $DASHBOARD_HOST"
  for f in /etc/cloud/templates/hosts.debian.tmpl /etc/hosts; do
    if [ -f "$f" ]; then
      if grep -qE "^[0-9.]+[[:space:]]+$DASHBOARD_HOST(\s|$)" "$f"; then
        if grep -qE "^$DASHBOARD_IP[[:space:]]+$DASHBOARD_HOST(\s|$)" "$f"; then
          skip "$f"
        else
          sudo sed -i -E "s|^[0-9.]+[[:space:]]+$DASHBOARD_HOST(\s.*)?$|$HOSTS_LINE|" "$f"
          echo "    updated ip in $f"
        fi
      else
        echo "$HOSTS_LINE" | sudo tee -a "$f" >/dev/null
        echo "    appended to $f"
      fi
    fi
  done
fi

# Where kiosk.sh points the browser.
mkdir -p "$HOME/.config"
echo "DASHBOARD_URL=http://$DASHBOARD_HOST" > "$HOME/.config/dashboard-kiosk.env"

# 3. Desktop autologin ------------------------------------------------------
step "desktop autologin"
if grep -qE "^autologin-user=$USER$" /etc/lightdm/lightdm.conf 2>/dev/null; then
  skip "lightdm autologin for $USER"
else
  sudo raspi-config nonint do_boot_behaviour B4
fi

# 4. Screen blanking off ----------------------------------------------------
# xset in kiosk.sh only affects XWayland clients; this is the Wayland-wide switch.
step "screen blanking off"
if [ "$(sudo raspi-config nonint get_blanking)" = "1" ]; then
  skip "blanking disabled"
else
  sudo raspi-config nonint do_blanking 1
fi

# 5. Kiosk files ------------------------------------------------------------
step "kiosk files"
install_file() {
  local src="$1" dst="$2" mode="$3"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    skip "$dst"
  else
    mkdir -p "$(dirname "$dst")"
    install -m "$mode" "$src" "$dst"
    echo "    installed $dst"
  fi
}
install_file "$SRC_DIR/kiosk.sh"      "$HOME/kiosk.sh"                        0755
install_file "$SRC_DIR/kiosk.desktop" "$HOME/.config/autostart/kiosk.desktop" 0644
install_file "$SRC_DIR/kanshi.config" "$HOME/.config/kanshi/config"           0644
install_file "$SRC_DIR/labwc-rc.xml"  "$HOME/.config/labwc/rc.xml"            0644

step "done. reboot (or 'bin/pi restart') to apply."
