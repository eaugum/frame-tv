# Install Frame TV on your own TV

Frame TV isn't in Samsung's app store. You install it from a Mac with the TV in Developer Mode, signed with a
certificate of your own. This takes about half an hour, and nothing here needs a Samsung account.

## What you need

- A Samsung TV with Tizen 3 or newer (2017 or later). Art Mode only exists on The Frame; the rest works on any of them.
- A Mac on the same network as the TV, Intel or Apple silicon.
- [Homebrew](https://brew.sh), and with it Python 3 and Java 17:

  ```bash
  brew install python openjdk@17
  ```

## 1. Get the code

```bash
git clone https://github.com/eaugum/frame-tv.git
cd frame-tv
```

## 2. Turn on Developer Mode on the TV

1. Find the Mac's IP address: `ipconfig getifaddr en0`. If that's empty, look under System Settings → Network.
2. On the TV, open Apps and type 1 2 3 4 5 on the remote. With a remote without digits, use the digits on screen.
3. Turn Developer mode **On**, and enter the Mac's IP address as Host PC IP.
4. Restart the TV: hold the power button until it turns off and comes back on.

Note the TV's own address too, under Settings → General → Network → Network Status → IP Settings.

## 3. Get Samsung's Tizen tools

```bash
tizen/get-tools.sh
```

It fetches the parts of the tools that signing needs from Samsung, into `tizen-studio/` in this folder. You don't need
Tizen Studio itself. If you have it already, `tizen/build.py` finds it in `~/tizen-studio`, but the two certificate
scripts below only use the folder here.

## 4. Make your certificate

```bash
tizen/make-certificate.sh
```

It asks for your name and a password, and makes the profile `frametv`.

**Keep `tizen-studio-data/keystore/author/frametv.p12` and the password safe**, in a password manager for instance.
Every update has to be signed with the same certificate. Without it, the app has to be removed first, and everything set
on the TV goes with it.

## 5. Build and install

```bash
python3 tools/setup.py
```

This opens a page with every setting. At the bottom, fill in `tv_ip` with the TV's address, choose `frametv` as
`sign_profile`, and press "Save, build and install". The app opens on the TV when it's done.

Without the page:

```bash
python3 tizen/build.py --sign frametv
python3 tizen/install.py <the TV's IP>
```

With nothing else filled in, you get the home screen with your apps, the weather and the clock. Stasera is on from the
start, so Home offers to link it; turn it off if you don't use it. The other modules are one at a time, in
[Modules and settings](modules.md).

## Afterwards

- **Update:** `git pull`, then "Save, build and install" again, with the same certificate.
- **Make it the first thing you see:** see "The Home button opens Smart Hub" in
  [Troubleshooting](troubleshooting.md#on-the-tv): without root, Autorun Last App; with root, the Home button itself.
- **If the Mac gets a new address,** or the TV stops answering after one of its own updates, go through step 2 again.
- **Back up what's set on the TV** with [Upload config](modules.md#upload-config).

If something stops, [Troubleshooting](troubleshooting.md#building-and-installing) has what each message means.
