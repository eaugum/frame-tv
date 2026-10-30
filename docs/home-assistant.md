# Home Assistant

Frame TV talks to Home Assistant over its WebSocket API. There are two separate things to set up: the **module** on the
TV, and the optional **package** in Home Assistant that gives you the automations. Art Mode is a third thing, and it
goes through the Frame Art add-on: see [modules.md](modules.md#art-mode).

## The module

**What it gives:** the Home Assistant tab and a tile on Home, notifications from Home Assistant on the TV, and the TV
telling Home Assistant what it's doing.

| Setting | What | Where it comes from |
|---|---|---|
| `home_assistant` | The switch | `true` |
| `home_assistant_url` | The address, for example `http://192.168.1.10:8123` | Your Home Assistant. It has to be reachable from the TV |
| `home_assistant_token` | A long-lived access token | Your profile in Home Assistant → Security → Long-lived access tokens |

**Getting it working:**

1. In Home Assistant, pick the user for the TV (see below). Under the user's profile → Security, make a long-lived
   access token.
2. Put the address and the token in the settings, set `home_assistant=true`, build and install.
3. On the TV, go to the gear → Connections → Home Assistant, and pick what the tab shows.

### Which user the token belongs to

The token ends up in the app on the TV, so a user of its own is a good idea. Whether that user is an admin decides what
works, since Home Assistant only lets admins listen to custom events and fire events:

| | Admin | Not admin |
|---|---|---|
| The tab and the tile: lights, scenes, electricity, laundry, guest network | Yes | Yes |
| Notifications on the TV (`frametv_notify`) | Yes | **No** |
| What the TV is doing (`frametv_state`, `sensor.frame_tv`, the cinema automation) | Yes | **No** |

Without admin, nothing on the TV says that these two are missing. Home Assistant's log says "Refusing to allow … to
subscribe to event frametv_notify".

### What the tab shows

What's shown is picked on the TV, from Home Assistant's own entities. What Home Assistant doesn't have, or what is
unavailable, isn't shown.

| Group | Setting | Entities that can be picked | What it shows |
|---|---|---|---|
| Light scenes | `home_assistant_scenes` | `script`, `scene` | OK runs it |
| Lights | `home_assistant_lights` | `light`, `switch` | OK turns it on and off; a dimmable light gets a dimmer, where ← → changes it by 10 % |
| Electricity | `home_assistant_power` | `sensor` | The first is the big number, with the day's range if it has the attributes `min_price` and `max_price` (and `avg_price`). Up to three more are plain lines |
| Washer and dryer | `home_assistant_laundry` | `binary_sensor`, `switch`, `input_boolean`, `sensor` | Running only when the state is `on`, so a `sensor` needs a template that says `on`. Also how long ago it changed. At most four |
| Guest network | `home_assistant_guest_wifi` | `image`, `switch` | The QR code from the `image`; a `switch` that is off says the network is off |

The Home tile shows the first electricity entity, how many lights are on, and what's running.

In `config.properties` these are comma-separated, and `entity:Name` overrides the name:
`home_assistant_lights=light.sofa:Sofa,light.hall`.

### When it's missing or wrong

- Without the address or the token: the module stays off.
- "Home Assistant didn't accept the token (home_assistant_token).": the token is wrong, or it has been deleted. Make a
  new one.
- "Can't reach Home Assistant.": the TV doesn't get through to the address. It keeps trying by itself. Note that the
  address must work from the TV, so `https://` with a certificate the TV doesn't trust won't do.
- "Nothing of this kind in Home Assistant.": there are no entities of that kind to pick.
- "No QR code from Home Assistant yet.": the guest network has no `image` entity picked, or it has no picture.

## The package

`homeassistant/packages/frame_tv.yaml` adds the sensor, the automations and the scripts. The automations and scripts
are written for our house: **change the names of the entities before you use them**.

Put the file in `/config/packages/`, and have this in `configuration.yaml` once:

```yaml
homeassistant:
  packages: !include_dir_named packages
```

Check it under Developer tools → YAML → Check configuration, and restart Home Assistant.

| What | Id | What it does | What you have to change |
|---|---|---|---|
| Sensor | `sensor.frame_tv` | Follows `frametv_state`; see below | Nothing |
| Automation | `frame_tv_vask_ferdig` | A notification when the washer is done | `input_boolean.vaskemaskin` |
| Automation | `frame_tv_tork_ferdig` | A notification when the dryer is done | `input_boolean.torketrommel` |
| Automation | `frame_tv_pollen` | A notification with the pollen forecast when it comes | `input_text.pollenmelding` |
| Automation | `frame_tv_kino` | Dims the lights when Frame TV opens a show or movie after sunset | `script.lys_stue_dimmer_min` |
| Scripts | `frame_art_nytt_bilde`, `_kunstmodus`, `_morgenbildet`, `_kveldens_serie` | Press Frame Art's buttons, for dashboards | Nothing, but they need Frame Art's device over MQTT |

Delete what you don't need. The text is in Norwegian, as in our Home Assistant.

## Events

Both need a token from an admin user.

### To the TV: `frametv_notify`

Fire it from any automation, and Frame TV shows it at the top of the screen. Only while Frame TV is open, since the
app isn't running behind other apps. `seconds` is optional; the default is 6.

```yaml
actions:
  - event: frametv_notify
    event_data:
      title: The washer is done
      message: Time to hang it up.
      seconds: 15
```

### From the TV: `frametv_state`

| Field | What |
|---|---|
| `state` | `home`: Frame TV is on the screen. `app`: it has opened an app. `hidden`: something else (the Home button, the TV off) |
| `app`, `app_id` | The app it opened |
| `title` | The show or movie, when it opened one |
| `kind` | What it opened, such as `show` or `movie` |

`sensor.frame_tv` has the state as its value and the rest as attributes. An automation can also listen to the event
directly: `frame_tv_kino` in the package is an example.

## Art Mode from Home Assistant

Frame Art is a device of its own in Home Assistant over MQTT, with buttons, switches and sensors. See
[Frame Art's documentation](https://github.com/eaugum/frame-art/blob/main/frame_art/DOCS.md#in-home-assistant-mqtt).
