# What's on the screen

What each tab and page does. What a module needs in order to show up is in [modules.md](modules.md).

- **The tab bar:** the gear for the settings (All Apps is there too) and a button for Art Mode, search (a magnifying
  glass, when the TV is linked to Stasera), Home, TV, YouTube, Stats, GitHub, Home Assistant and Spotify, and the day,
  the weather and the clock on the right. A tab for something that is off or not set up isn't shown. The TV starts on
  Home; up goes to the tab bar, left and right there switch tabs, and Back goes to the tab bar and then to Home.
- **Home:** the greeting from Stasera ("Ada Lovelace, up late?", the same as on Stasera's home page, already in the
  TV's language from Stasera; without Stasera "Good evening" with `name` from `config.properties`), "Continue
  Watching", new episodes, and at the bottom the first four of Stasera, YouTube, GitHub, Home Assistant, friends,
  Spotify and Art Mode that are on, with apps where there's room. The Spotify tile comes first while something is
  playing. The YouTube tile is one video: the last one added to the playlist, otherwise the newest from the
  subscriptions, and without Stasera it takes the big tile. OK on a show or movie opens the title page, otherwise OK
  opens the app or goes to the tab or the row in the TV tab; a long press on OK marks the episode as watched, and on a
  movie the movie. For 10 seconds after that, a long press anywhere takes it back.
- **TV:** a cinema screen (2.39:1) that rotates between what we're watching, new episodes and something from "Want to
  Start" or Movies, and the rows Watching, Want to Start (the same as "Haven't started" in Stasera), Movies (the movies
  from the watchlist that can be streamed in Norway; rent and buy don't count), Friends and Apps. OK on a title, also on
  the cinema screen, opens the title page. There a button marks the movie or the next episode as watched; on a movie
  it turns into "Watched ✓", and OK on that takes the mark back while the page is open (older marks are changed on
  stasera.app, so they keep their date). Without Stasera: the clock and the apps.
- **YouTube:** the same cinema screen and the rows for our own playlist "Frame TV" and "New from your subscriptions"
  (at most two per channel in the last two weeks, no Shorts). The TV signs in with Google from the gear → Connections → YouTube, with
  a code on google.com/device, and can only read. "Watch later" can't be read by apps (Google closed it in 2016), so
  what we want to watch on the TV is saved in "Frame TV"; another playlist can be picked under the gear. Shown with
  `youtube_client_id` and `youtube_client_secret` in `config.properties`.
- **Search:** shows and movies in Stasera, typed on a QWERTY keyboard with the remote (with Æ, Ø and Å in Norwegian).
  OK on a result opens the title page, and Back returns to the search with the same result selected.
- **The title page** (AUG-1485): the picture, year, seasons or runtime, the age rating, creator or director, the
  overview and where to watch it. For a show we're watching, the next episode is at the top ("S2 E5 · Name"), and
  "Watch on <app>" is the first button, so OK, OK starts it. Then "Trailer" (in the YouTube app) and "Add to Want to
  Start". Down scrolls to the seasons and the cast; OK on an actor opens the person page with picture, biography and
  what they're known for, and OK on a title there opens its title page. Back goes one step back. What an older Stasera
  doesn't provide isn't shown.
- **Stats:** the stats from [Stasera](https://stasera.app): time watched per month, most watched in the last 30 days,
  finished this year, progress, habits and channels. Shown when the TV is linked; the numbers arrive once Stats has been
  opened in the Stasera app.
- **GitHub:** commits over the last six months across our own repos, the languages they're written in, the newest
  projects and the latest deploys on Vercel. Two modules: GitHub (`github_token`) and Vercel (`vercel_token`); with
  only Vercel on the tab shows only the deploys, with only GitHub everything but them.
- **Home Assistant** (AUG-1437): light scenes (OK runs them), lights (OK turns them on and off; a dimmable light gets
  a dimmer where ← → changes the brightness by 10 %), the electricity price and grid fee, washer and dryer, and the QR
  code for the guest network. The Home tile shows the electricity price and the lights that are on. What's shown is
  picked on the TV (the gear → Connections → Home Assistant), from HA's own entities; what HA doesn't have or what is unavailable
  isn't shown. HA can send
  notifications to the TV (`frametv_notify`), and the TV tells HA what it's doing (`frametv_state`). The automations
  for that are in `homeassistant/packages/frame_tv.yaml`. Shown with `home_assistant_url` and `home_assistant_token`.
- **Spotify** (AUG-1470): what's playing, on any of our devices, with cover, time and device, and the buttons
  previous, play/pause, next, volume (OK, then ← → by 5 %), "Play on…" (this TV or another Spotify device; "This TV"
  opens the Spotify app and moves playback there; the app has to stay in front, since it stops playing when Frame TV comes back, and Spotify's Web Playback SDK
  doesn't work on Tizen) and "Open Spotify". The remote's play/pause controls Spotify everywhere in Frame TV. The Home
  tile shows the song and where it's playing. Signed in on the Mac with `python3 tools/spotify_login.py`, which writes
  `spotify_refresh_token` to `config.properties`; Spotify accepts the token for 6 months, then the tab says so (the
  same if the app has been removed from the TV, since Spotify can swap the token along the way and the newest one is
  only on the TV). Controlling playback needs Premium, and the app in development mode takes at most 5 users. Shown
  with `spotify_client_id` and `spotify_refresh_token`.
- **Art Mode** (`art_url`, `art_key`): the Frame Art add-on ([eaugum/frame-art](https://github.com/eaugum/frame-art))
  decides what hangs on the wall (AUG-1490); Frame TV only has the buttons. The tile on Home shows the picture's name
  and the mode; OK turns on Art Mode, hold OK for a new picture. When the screensaver starts, the TV goes into Art Mode (if the
  add-on doesn't answer, Frame TV's own screensaver starts instead). `art_key` is the key to the add-on's
  API, `api_key` in the add-on's options. HA controls the same as a device over MQTT.
- **Apps:** the Apps row on Home shows the apps picked on the TV (the gear → Apps), at first Apple TV, TV 2 Play,
  Viaplay, Netflix, YouTube, Max, Disney+, NRK TV, Prime Video and VG TV, those that are installed. All Apps (in the
  gear) has them first and then the rest; the gear → Apps also hides apps built into the TV.
