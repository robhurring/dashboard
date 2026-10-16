# Pi kiosk: setup and rebuild

The dashboard runs full-screen in Chromium on a Raspberry Pi with a touch display.
Everything the Pi needs lives in this repo under `pi/`, and `bin/pi setup` applies it.
This doc is the from-scratch path, written from what is actually on the Pi.

## Hardware

| Part | Detail |
|---|---|
| Board | Raspberry Pi 3 Model B+ |
| Display | Raspberry Pi Touch Display 2, 7", 720x1280 on DSI-1, rotated to landscape |
| Touch | Goodix capacitive touchscreen (`10-005d`), mapped to DSI-1 |
| Input | Touch only. No mouse, no keyboard. |
| Power | Needs a real 5V 2.5A supply with a short cable. See *Troubleshooting*. |

## Hosts

| ssh alias | Address | User | What |
|---|---|---|---|
| `kiosk` | `dashboard-kiosk.local` | `admin` | the Pi |
| `lab` | `192.168.1.10` | `root` | Dokku host that serves `dashboard.example.com` |

Both aliases are in `~/.ssh/config` on the Mac and use the `~/.ssh/homelab` key:

```
Host kiosk
  HostName = dashboard-kiosk.local
  IdentityFile = ~/.ssh/homelab
  User = admin
```

The Pi resolves `dashboard.example.com` to lab through a hosts override, not DNS.

## Rebuild from a blank SD card

### 1. Flash

Raspberry Pi Imager, **Raspberry Pi OS (64-bit) with desktop**, Bookworm or newer.
The desktop image is required: the kiosk runs inside the labwc Wayland session it ships with.

In the imager's customisation:

- Hostname `dashboard-kiosk`
- User `admin` with a password
- Wi-Fi credentials
- Enable SSH, public key auth, paste the public half of `~/.ssh/homelab`

Boot it and confirm `ssh kiosk` works.

### 2. Run setup

From the repo, with `DASHBOARD_HOST` (and optionally `DASHBOARD_IP`) set in `.env`:

```
bin/pi setup
```

This copies `pi/` to `~/dashboard-pi` on the Pi and runs `pi/setup.sh` there. The script is idempotent: every step checks before it acts and prints `already done` when there is nothing to do, so it is safe to re-run whenever anything drifts. It does:

1. Installs `chromium unclutter xserver-xorg x11-xserver-utils xinit lightdm` if missing.
2. If `DASHBOARD_IP` is set, adds `192.168.1.10   dashboard.example.com` (your values) to `/etc/hosts` **and** to `/etc/cloud/templates/hosts.debian.tmpl`. cloud-init regenerates `/etc/hosts` from that template on every boot, so an edit to `/etc/hosts` alone disappears after a reboot.
3. Turns on desktop autologin for `admin` via `raspi-config nonint do_boot_behaviour B4`.
4. Turns off screen blanking via `raspi-config nonint do_blanking 1`. The `xset` lines in the kiosk script only reach XWayland clients, and Chromium runs natively on Wayland, so this is the switch that matters.
5. Writes `~/.config/dashboard-kiosk.env` with the URL the kiosk opens, and installs the four kiosk files below into place.

Reboot after the first run:

```
ssh kiosk sudo reboot
```

### 3. Verify

Chromium should come up full-screen on `http://dashboard.example.com`. If the screen is portrait or touches land in the wrong place, see *Display rotation and touch* below.

## The kiosk files

All four are in `pi/` and are the source of truth. Edit them here, then `bin/pi push`.

| Repo file | Installed at | Purpose |
|---|---|---|
| `pi/kiosk.sh` | `~/kiosk.sh` | Launches Chromium in kiosk mode with the flags we need |
| `pi/kiosk.desktop` | `~/.config/autostart/kiosk.desktop` | Runs `kiosk.sh` when the desktop session starts |
| `pi/kanshi.config` | `~/.config/kanshi/config` | Output profile: DSI-1 at 720x1280, `transform 270` for landscape |
| `pi/labwc-rc.xml` | `~/.config/labwc/rc.xml` | Maps the Goodix touchscreen to DSI-1 so touch follows the rotation |

Chromium flags worth knowing in `kiosk.sh`:

- `--kiosk --incognito --noerrdialogs --disable-infobars` are the usual full-screen set.
- `--touch-events=enabled` makes Chromium treat the display as a touch device unambiguously.
- `--unsafely-treat-insecure-origin-as-secure=http://dashboard.example.com` because the site is plain HTTP on the LAN.
- `--password-store=basic` stops a keyring prompt on first launch.

## Make targets

| Target | What it does |
|---|---|
| `bin/pi setup` | Full idempotent setup described above. Re-run any time. |
| `bin/pi push` | Copies the four kiosk files to their live paths. Does not restart anything. |
| `bin/pi pull` | Copies the live files from the Pi back into `pi/`. Use after tweaking on the Pi directly. |
| `bin/pi restart` | Kills Chromium and relaunches `kiosk.sh` over ssh. No reboot needed. |

All commands use the `kiosk` ssh alias. Override with `PI_HOST=admin@192.168.1.20 bin/pi push` if mDNS is down.

## Display rotation and touch

The panel is natively portrait. Two files make it landscape:

- `kanshi.config` tells the compositor to rotate DSI-1 by 270 degrees.
- `labwc-rc.xml` maps the touchscreen to DSI-1 with `mouseEmulation="yes"`, so touch coordinates rotate with the display.

If you change the rotation, change both. `wlr-randr` on the Pi shows what the compositor currently thinks:

```
ssh kiosk 'WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/1000 wlr-randr'
```

## Troubleshooting

**No cursor.** Expected. labwc hides the pointer whenever input comes from a touch device, and there is no mouse attached. Nothing to fix.

**Touch feels laggy, or `.xsession-errors` says "event processing lagging behind … your system is too slow".** Check for throttling first:

```
ssh kiosk 'vcgencmd get_throttled; vcgencmd measure_clock arm; sudo dmesg | grep -i voltage | tail'
```

`throttled=0x50005` means under-voltage right now and the CPU is pinned at 600 MHz instead of 1400 MHz. That is the power supply or cable, not software. Also check `top` on the Pi: if Chromium's renderer sits at 100% CPU, the page is doing per-frame work and the compositor starves. The dashboard's old rotating panels did exactly this and were removed.

**`dashboard.example.com` stops resolving after a reboot.** The hosts override was only in `/etc/hosts`. Re-run `bin/pi setup`, which puts it in the cloud-init template too.

**Chromium did not start after login.** Check the autostart entry exists and the script is executable:

```
ssh kiosk 'cat ~/.config/autostart/kiosk.desktop; ls -l ~/kiosk.sh; tail -20 ~/.xsession-errors'
```

**Screen goes black after a while.** Blanking got re-enabled. `bin/pi setup` turns it off again.

## What is on the Pi that setup does not manage

- The OS, Wi-Fi, hostname, user and ssh key, all set at flash time.
- `/boot/firmware/config.txt` is stock apart from what the imager wrote. No overlays were added for the display; it auto-detects.
- The Dokku deploy of the app itself lives on lab and is unrelated to the Pi. See `docs/deploy/dokku.md` and `bin/deploy`.
