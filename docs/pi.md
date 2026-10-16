# Raspberry Pi kiosk

How to turn a Raspberry Pi and a touch display into a wall screen that boots straight into the
dashboard, full-screen, with no keyboard or mouse. Everything the Pi needs lives in `pi/`, and
`bin/pi` applies it over ssh from your computer. Setup is idempotent: run it again any time and it
only changes what has drifted.

The dashboard itself runs elsewhere (a server, a homelab box, a Dokku host); the Pi only shows it.

## What you need

| Part | Tested with | Notes |
|---|---|---|
| Board | Raspberry Pi 3 Model B+ | Any Pi that runs the desktop image works; a Pi 4 or 5 is snappier. |
| Display | Raspberry Pi Touch Display 2, 7" | A portrait panel (720x1280 on `DSI-1`) turned landscape. Other displays: see [Other displays](#other-displays). |
| Power | the official 5V 2.5A supply | A weak supply or long cable throttles the CPU and makes touch laggy. |
| SD card | 16 GB or more | |

No keyboard or mouse is needed once it's set up.

## 1. Flash the SD card

Use Raspberry Pi Imager and pick **Raspberry Pi OS (64-bit) with desktop**, Bookworm or newer. The
desktop image matters: the kiosk runs inside the labwc Wayland session it ships with.

In the imager's settings, before writing:

- **Hostname**, for example `dashboard-kiosk`
- **User and password**, for example `admin`
- **Wi-Fi**, unless the Pi is on Ethernet
- **SSH** on, with public-key authentication and your public key pasted in

Put the card in, power on, and give it a few minutes for the first boot.

## 2. Reach it over ssh

`bin/pi` connects to whatever ssh host `PI_HOST` names: `admin@dashboard-kiosk.local` works, or an
alias in `~/.ssh/config` on your computer. The examples here use an alias called `pi`:

```
Host pi
  HostName dashboard-kiosk.local
  User admin
  IdentityFile ~/.ssh/id_ed25519
```

Check it with `ssh pi hostname`. If `.local` names are unreliable on your network, put the Pi's IP
address in `HostName` instead (a DHCP reservation keeps it stable).

## 3. Tell it what to open

In the repo's `.env`:

```sh
DASHBOARD_HOST=dashboard.example.com   # the address the kiosk opens, as http://<host>
DASHBOARD_IP=192.168.1.10              # optional: pin that name to this IP in the Pi's /etc/hosts
PI_HOST=pi                             # the Pi's ssh host: an alias, or user@host
```

`DASHBOARD_IP` is for when your local DNS doesn't know the dashboard's name, or knows only its
public address. With it set, the Pi always reaches the dashboard directly on your network.

## 4. Run setup

```sh
bin/pi setup
ssh pi sudo reboot
```

Setup copies `pi/` to the Pi and runs `pi/setup.sh` there. It:

1. installs Chromium and the few packages the kiosk uses, if missing;
2. pins `DASHBOARD_HOST` to `DASHBOARD_IP`, when set, in `/etc/hosts` and in cloud-init's template
   for it (cloud-init rewrites `/etc/hosts` on every boot, so the template is what makes it stick);
3. turns on desktop autologin for the Pi's user;
4. turns off screen blanking;
5. writes `~/.config/dashboard-kiosk.env` with the URL to open, and installs the kiosk files below.

After the reboot, Chromium should come up full-screen on the dashboard. If the picture is sideways or
touches land in the wrong place, see [Other displays](#other-displays).

## Day to day

| Command | Does |
|---|---|
| `bin/pi setup` | the full setup above; safe to re-run |
| `bin/pi push` | copies the kiosk files to the Pi without restarting anything |
| `bin/pi restart` | relaunches the kiosk browser, no reboot |
| `bin/pi pull` | copies the files from the Pi back into `pi/`, after tweaking them on the Pi |

New dashboard builds need nothing on the Pi: every open screen reloads itself when a new version
ships.

## The kiosk files

The files in `pi/` are the source of truth. Edit them in the repo, then `bin/pi push`.

| Repo file | Installed at | Purpose |
|---|---|---|
| `pi/kiosk.sh` | `~/kiosk.sh` | launches Chromium in kiosk mode on `DASHBOARD_URL` |
| `pi/kiosk.desktop` | `~/.config/autostart/kiosk.desktop` | runs `kiosk.sh` when the desktop session starts |
| `pi/kanshi.config` | `~/.config/kanshi/config` | display layout: which output, its mode and its rotation |
| `pi/labwc-rc.xml` | `~/.config/labwc/rc.xml` | maps the touchscreen to the display, so touch follows the rotation |

Chromium flags in `kiosk.sh` worth knowing:

- `--kiosk --incognito --noerrdialogs --disable-infobars`: full-screen, no prompts or restore bars.
- `--touch-events=enabled`: treat the display as a touch device.
- `--unsafely-treat-insecure-origin-as-secure=<url>`: the dashboard is usually plain HTTP on the
  LAN, and this keeps browser features working that would otherwise need HTTPS.
- `--password-store=basic`: no keyring prompt on first launch.

## Other displays

The shipped `kanshi.config` and `labwc-rc.xml` are for the Touch Display 2: a portrait panel on
`DSI-1`, rotated 270 degrees, with its Goodix touch controller mapped to it. For another display,
find its output name, mode and touch device on the Pi:

```sh
ssh pi 'WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) wlr-randr'
ssh pi 'libinput list-devices | grep -A1 -i touch'
```

Then set the output, mode and `transform` (0, 90, 180 or 270) in `pi/kanshi.config`, and the touch
device's name and output in `pi/labwc-rc.xml`. Change rotation in both files together, or touches land
in the wrong place. `bin/pi push && bin/pi restart` applies them; a reboot makes sure.

An HDMI monitor in landscape usually needs neither file: delete the profile from `kanshi.config` and
the touch mapping from `labwc-rc.xml`.

## Troubleshooting

**No mouse pointer.** Expected: labwc hides the pointer when input comes from a touchscreen.

**Touch feels laggy.** Check for power throttling first:

```sh
ssh pi 'vcgencmd get_throttled; vcgencmd measure_clock arm'
```

Anything other than `throttled=0x0` means the supply or cable can't keep up, and the CPU slows down to
compensate. A better supply fixes it; no software change will.

**The dashboard's name stops resolving after a reboot.** The hosts entry was only in `/etc/hosts`.
Re-run `bin/pi setup`, which also writes it to cloud-init's template.

**Chromium doesn't start after login.**

```sh
ssh pi 'cat ~/.config/autostart/kiosk.desktop; cat ~/.config/dashboard-kiosk.env; tail -20 ~/.xsession-errors'
```

A missing `dashboard-kiosk.env` means setup hasn't run since the kiosk files changed: run `bin/pi setup`.

**The screen goes black after a while.** Blanking got switched back on. `bin/pi setup` turns it off
again.

**`bin/pi` can't connect, but the Pi is up.** `.local` name lookups can come and go. Use the Pi's IP in
your ssh config's `HostName`.

## What setup doesn't manage

The OS, Wi-Fi, hostname, user and ssh key are set when you flash the card. `/boot/firmware/config.txt`
stays as the imager wrote it; the Touch Display 2 is detected without extra overlays.
