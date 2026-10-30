# Frame TV

The home screen on The Frame in our living room. A web app for Samsung TVs (Tizen) that sits on top of Smart Hub and
shows what we're actually going to watch tonight. On screen in Norwegian or English.

Without anything else it's your apps, the weather and the clock. The rest is modules, each with its own switch:

- **Stasera:** what you're watching, new episodes, search, title pages and stats, from [Stasera](https://www.stasera.app)
- **YouTube:** your own playlist and what's new from your subscriptions
- **GitHub** and **Vercel:** commits, languages, projects and deploys
- **Home Assistant:** lights, electricity, laundry, the guest network and notifications
- **Spotify:** what's playing, on any device, with the controls
- **Art Mode:** the buttons to [Frame Art](https://github.com/eaugum/frame-art), which decides what's on the wall

## Get started

[Install Frame TV on your own TV](docs/install.md) goes through it step by step. In short:

1. On the TV: open Apps, type 1 2 3 4 5 on the remote, turn Developer mode on with the Mac's IP as Host PC IP, and
   restart the TV.
2. On the Mac, with Python 3 and Java 17 (`brew install python openjdk@17`):

   ```bash
   tizen/get-tools.sh             # once: the parts of Samsung's Tizen tools that signing needs
   tizen/make-certificate.sh      # once: your certificate, as the profile frametv
   python3 tools/setup.py         # a page with every setting
   ```

3. On that page, fill in `tv_ip`, choose `frametv` as `sign_profile` at the bottom, and press "Save, build and install".

Every other setting is optional: with nothing filled in, you get the home screen with your apps, the weather and the
clock. Stasera is on from the start, so Home offers to link it; turn it off if you don't use it. Then add the modules
you want, one at a time.

## Documentation

- [Install](docs/install.md): from nothing to the app on your TV
- [What's on the screen](docs/features.md): each tab and page
- [How it fits together](docs/overview.md): Frame TV, Frame Art, Home Assistant and Stasera, and who calls whom
- [Modules and settings](docs/modules.md): what each module needs, and every setting
- [Home Assistant](docs/home-assistant.md): the token, the tab, the package and the events
- [Troubleshooting](docs/troubleshooting.md): when something doesn't work
- [Development](docs/development.md): building, the certificate, the preview and the code
- [Frame Art](https://github.com/eaugum/frame-art): the add-on that runs Art Mode

## Origin

Frame TV started as a copy of [Free My TV](https://github.com/simbasjungles/free-my-tv) (MIT), and still builds on a lot
of its code. See `LICENSE`.
