# Created by You — the UGC portfolio template

A one-page portfolio for UGC creators that you edit **in the browser** — no code, no terminal,
no rebuilding. Click text to rewrite it, click a photo or clip to swap it, drag sections into
the order you want. Every change publishes itself a couple of seconds later.

---

## Setting it up

**If you bought this**, the Deploy on Railway link on your purchase page does nearly everything:
it builds the site, attaches permanent storage for your uploads, and asks you for the one thing it
needs — the password that will unlock editing. When the deploy turns green:

1. **Get your address:** your service → **Settings → Networking → Generate Domain**. That free
   address works everywhere today. Your own domain (~£10/year) can be added in the same panel later.
2. **Set it up:** visit `your-address/admin`, sign in with your password, and the setup wizard
   takes it from there. The walkthrough video on your purchase page covers every click.

<details>
<summary>Setting it up by hand instead (without the template link)</summary>

1. Copy this repo (fork it, or use it as a template if that's offered).
2. On [railway.com](https://railway.com): **New Project → Deploy from GitHub repo**.
3. Service → **Variables** → add `ADMIN_PASS` — the password that unlocks editing.
4. Storage: on the project canvas press **⌘K** → **Create Volume**, attach it to the service, and
   set the mount path to exactly `/app/assets/user`. Without this, uploads vanish on restart.
5. Generate a domain and visit `/admin` as above.
</details>

---

## Using the editor

Visit `/admin` any time to switch editing on.

- **Text** — click it and type. Use the panel at the bottom to change a font or size.
- **Photos and clips** — hover any photo, gallery tile or work slot and press **⇄**. Work slots stay
  hidden from visitors until you put something in them, so an unfinished grid never shows.
- **Hero film** — the ⇄ button over the top film takes a video straight off your phone; the server
  cuts the first 8 seconds into the looping film for you. Until you add one, the page plays a
  generated gradient film in your colours.
- **Brand logos** — the row under About. Press **+** to add one, **×** to remove it.
- **Sections** — the Layout tab lists every section: drag or use the arrows to reorder, and tap the
  circle to show or hide one. Rates, Stats, Testimonials and Brand work start hidden — the setup wizard
  offers them, and the Layout tab changes your mind later.
- **Brand work** — six slots for real ads that play with sound. Upload a video, or press 🔗 to show a
  YouTube or Vimeo video instead.
- **Colours** — "Setup wizard" in the edit panel reopens the colour picker at any time.

Changes save themselves. The **✓ Done** button publishes immediately if you're impatient.

---

## Good to know

- **Back it up.** Press **Download backup** in the edit panel — it hands you one file containing
  everything on your site (photos, clips, settings). Worth doing after a big content session.
- **iPhone photos** (HEIC) and **iPhone videos** (HEVC) are converted for you on upload.
- **Cost.** Railway's Hobby plan is about $5 a month and includes far more storage than this needs.
- **Editing from a phone** works — the editor, uploads and section reordering are all touch-friendly.
- **Forgot your password?** It lives in Railway, not on the site: your service → **Variables** →
  `ADMIN_PASS`. Click the eye to see it, or edit it to set a new one — changing it signs out every
  device. The sign-in page has the same steps under "I've forgotten my password".

## Licence

You may use this template for **one** website of your own and change it however you like. You may
not resell or redistribute it, as a template or as part of another product.

Bundled fonts (Anton, Archivo, Libre Caslon Text, Pacifico, Young Serif) are licensed separately
under the SIL Open Font License — see `assets/fonts/OFL.txt`.
