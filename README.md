# Cezar Mobile

Cezar is a helper that runs on a computer far away (a server). It has little
robot workers, called agents, that do jobs for you.

**Cezar Mobile is an app for your phone that lets you watch those robots.**

It tells you two things, fast:

1. What are the robots doing right now?
2. Is a robot waiting for me?

If a robot needs you, your phone buzzes, like a message from a friend. You tap
it, and the app shows you what the robot wants.

> Want every detail? The long, grown-up guide is in
> [`OLD_README.md`](OLD_README.md).

## How to use it

### Put the app on your phone

You need one thing first: the **secret link** to your Cezar. It looks like
`https://<your-host>/?key=…`. Ask the person who runs Cezar for it.
`<your-host>` is the name of your Cezar server.

1. Open `https://<your-host>/m/` in **Safari** (iPhone) or **Chrome** (Android).
2. Put it on your home screen:
   - iPhone: tap **Share**, then **Add to Home Screen**.
   - Android: tap the menu (⋮), then **Install app**.
3. Close the browser. Tap the new **Cezar** icon on your home screen.
4. The app asks you to connect. Paste the whole secret link and tap **Connect**.

That's it. You see your robots.

### Let it buzz you

1. In the app, go to **Settings → Notifications**.
2. Tap **Turn on notifications** and say **Allow**.
3. Tap **Send a test notification**. Your phone should buzz.

On an iPhone this only works from the home screen icon, on iOS 16.4 or newer.

### What the app shows you

- **The list**: all the robot jobs. Jobs that need you are at the top.
- **A job**: tap it to read what the robot said and did.
- **Answer or act**: when a robot is waiting, you can reply to it from the app.
- **New job**: you can give the robots a new job, too.

## How to install it (for the person who runs the server)

This part is for the grown-up who looks after the Cezar server. You do it
once. Cezar must already be running on that server.

The app must live on **the same server as Cezar**, at `/m/`. Cezar does not
talk to apps that live anywhere else.

Think of it like building with blocks. Put them in this order:

| Step | What you do | Where |
| --- | --- | --- |
| 1 | Download the code and build it | your computer |
| 2 | Download the code again | the server |
| 3 | Tell the web server (nginx) about `/m/` | the server |
| 4 | Start the buzzer helper (`cezar-push`) | the server |
| 5 | Make `/m/` come back if Cezar is reinstalled | the server |
| 6 | Send the app to the server | your computer |
| 7 | Check that it all works | the server |

The short version, with `<your-host>` and `<your-vhost>` swapped for your own
names:

```bash
# 1. On your computer
git clone https://github.com/cieyhomelab/cezar-pwa.git
cd cezar-pwa
npm ci
npm run build

# 2. On the server, as the user Cezar runs as
git clone https://github.com/cieyhomelab/cezar-pwa.git ~/cezar-pwa
cd ~/cezar-pwa
npm ci
sudo install -d -o "$USER" -g "$USER" -m 755 /var/www/cezar-mobile

# 3. On the server
sudo deploy/nginx/install.sh /etc/nginx/sites-available/<your-vhost>

# 4. On the server (not as root)
PUBLIC_ORIGIN=https://<your-host> deploy/push/install.sh
sudo loginctl enable-linger "$USER"

# 5. On the server: see step 5 in OLD_README.md (a few commands, done once)

# 6. On your computer: put DEPLOY_HOST=user@<your-host> in .env.local, then
DEPLOY_DRY_RUN=1 npm run deploy   # a practice run, changes nothing
npm run deploy                    # the real one
```

**7. Check it.** Open `https://<your-host>/m/` in a browser. You should see the
app. Then put it on your phone, like in [How to use it](#how-to-use-it).

Each step has a **Check** line in [`OLD_README.md`](OLD_README.md#installation).
If something goes wrong, look at its
[Troubleshooting](OLD_README.md#troubleshooting) part.

## Where to learn more

- [`OLD_README.md`](OLD_README.md): the full guide. How it all fits together,
  every setting, every install step, updating, and fixing problems.
- [`CLAUDE.md`](CLAUDE.md): the rules for changing the code.
- [`docs/CEZAR_API.md`](docs/CEZAR_API.md): how the app talks to Cezar.

## License

[MIT](LICENSE). You may use it, change it and share it.
