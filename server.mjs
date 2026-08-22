import http from 'node:http';
import { createReadStream, createWriteStream, existsSync, statSync, writeFileSync, readFileSync, unlinkSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { timingSafeEqual, createHmac } from 'node:crypto';

const root = normalize(join(fileURLToPath(import.meta.url), '..'));
const types = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

/* Admin auth.
   With ADMIN_PASS set (how it runs on a host), the editor needs that password.
   With it unset, editing is allowed ONLY from this machine — running without a
   password on a public host would hand the editor to every visitor. */
/* Pasting a password into a hosting dashboard picks up stray spaces and sometimes
   wrapping quotes. Neither was ever meant to be part of the password. */
const ADMIN_PASS = (process.env.ADMIN_PASS || '').trim().replace(/^(["'])(.*)\1$/, '$2');
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 90);
const attempts = new Map();   /* address -> failed sign-in attempts, for rate limiting */

function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function sameSecret(given, known) {
  const a = Buffer.from(String(given)), b = Buffer.from(String(known));
  return a.length === b.length && timingSafeEqual(a, b);
}
/* Sign-in survives in a cookie rather than the browser's basic-auth prompt. Two reasons:
   the prompt asks for a username that means nothing, and iOS Safari drops those
   credentials across a redirect — which is exactly what /admin does, so signing in
   could bounce straight back to the prompt forever.
   The cookie is an expiry signed with the password itself, so it needs no stored state
   and changing the password signs every device out. */
function makeSession() {
  const exp = String(Date.now() + SESSION_DAYS * 86400000);
  return exp + '.' + createHmac('sha256', ADMIN_PASS).update(exp).digest('hex');
}
function validSession(token) {
  if (!ADMIN_PASS || !token) return false;
  const dot = String(token).indexOf('.');
  if (dot < 1) return false;
  const exp = token.slice(0, dot), sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return sameSecret(sig, createHmac('sha256', ADMIN_PASS).update(exp).digest('hex'));
}
function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}
function authed(req) {
  if (!ADMIN_PASS) return isLoopback(req);
  if (validSession(cookieValue(req, 'site_session'))) return true;
  /* basic auth still accepted, so anything scripted against the old scheme keeps working */
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  try {
    const dec = Buffer.from(h.slice(6), 'base64').toString();
    return sameSecret(dec.slice(dec.indexOf(':') + 1), ADMIN_PASS);
  } catch { return false }
}
/* A browser attaches basic-auth credentials to cross-site form posts automatically,
   so a page on another domain could otherwise drive these endpoints while the owner
   is logged in. Browsers always send Origin on POST; anything else (curl) has no
   ambient credentials to abuse. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host } catch { return false }
}
/* The sign-in screen. It borrows the site's own colours from baked.json, so the owner
   arrives somewhere that looks like their site rather than a browser dialog. */
function siteTheme() {
  try {
    const b = JSON.parse(readFileSync(join(root, 'assets', 'user', 'baked.json'), 'utf8'));
    const t = b.theme || {};
    return {
      ground: t.ground || '#f8ece2', accent: t.accent || '#dd9b6c', dark: t.dark || '#3d2418',
      name: (b.setup && b.setup.name) || ''
    };
  } catch { return { ground: '#f8ece2', accent: '#dd9b6c', dark: '#3d2418', name: '' } }
}
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function loginPage(opts = {}) {
  const t = siteTheme();
  const who = t.name ? esc(t.name) + "'s site" : 'your site';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
<link rel="stylesheet" href="/assets/fonts.css">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;
    background:${t.ground};color:${t.dark};font-family:'Archivo',system-ui,sans-serif}
  .card{width:min(380px,100%);text-align:center}
  .mark{width:54px;height:54px;margin:0 auto 22px;border-radius:50%;background:${t.dark};
    display:grid;place-items:center}
  .mark span{width:22px;height:22px;border-radius:50%;background:${t.ground}}
  h1{font-family:'Yellowtail',cursive;font-weight:400;font-size:2.6rem;line-height:1.1;margin:0 0 6px}
  p.sub{font-family:'Libre Caslon Text',serif;font-style:italic;opacity:.7;margin:0 0 26px;font-size:1rem}
  form{display:flex;flex-direction:column;gap:12px}
  input{width:100%;font-family:inherit;font-size:17px;padding:15px 16px;border-radius:13px;
    border:1.5px solid rgba(0,0,0,.14);background:#fff;color:inherit;text-align:center}
  input:focus{outline:2px solid ${t.dark};outline-offset:1px}
  button{font-family:inherit;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
    padding:16px;border:none;border-radius:999px;background:${t.dark};color:${t.ground};cursor:pointer}
  button:hover{opacity:.92}
  .err{background:rgba(201,65,46,.12);color:#a8341f;border-radius:11px;padding:11px 14px;
    font-size:14px;font-weight:700;margin:0 0 14px}
  .hint{margin-top:22px;font-size:13px;opacity:.6;line-height:1.5}
  .forgot{margin-top:26px;text-align:left;font-size:13.5px;line-height:1.6}
  .forgot summary{cursor:pointer;text-align:center;font-weight:700;opacity:.65;list-style:none}
  .forgot summary::-webkit-details-marker{display:none}
  .forgot summary:hover{opacity:1;text-decoration:underline}
  .forgot[open] summary{opacity:1;margin-bottom:12px}
  .forgot div{background:rgba(0,0,0,.045);border-radius:13px;padding:16px 18px}
  .forgot ol{margin:10px 0 0;padding-left:20px}
  .forgot li{margin:7px 0}
  .forgot p{margin:0 0 8px}
  .forgot p:last-child{margin:12px 0 0;opacity:.75;font-size:12.5px}
</style></head>
<body>
  <div class="card">
    <div class="mark"><span></span></div>
    <h1>Welcome back</h1>
    <p class="sub">Sign in to edit ${who}.</p>
    ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ''}
    <form method="POST" action="/login">
      <input type="password" name="password" placeholder="Your password" autocomplete="current-password"
             autofocus required aria-label="Password">
      <button type="submit">Sign in</button>
    </form>
    <p class="hint">${opts.hint || 'This is the password set on your hosting dashboard. You&rsquo;ll stay signed in on this device.'}</p>
    <details class="forgot">
      <summary>I've forgotten my password</summary>
      <div>
        <p>No stress — the password isn't stored on this site. It lives in your hosting
        dashboard (Railway) as a setting called <b>ADMIN_PASS</b>, so you can look at it
        or pick a new one whenever you like:</p>
        <ol>
          <li>Go to <b>railway.com</b> and sign in — the same login you used to put the site online.</li>
          <li>Open your project, click your service, then the <b>Variables</b> tab.</li>
          <li>Find <b>ADMIN_PASS</b>. Click the eye to see the current password, or edit the value to set a new one.</li>
          <li>If you changed it, Railway restarts the site — give it a minute, then sign in here with the new password.</li>
        </ol>
        <p>Changing the password signs out every device, including any you've lost — so it doubles as a security reset.</p>
      </div>
    </details>
  </div>
</body></html>`;
}
function sendLogin(res, status, opts) {
  const body = loginPage(opts || {});
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/* challenge=true triggers the browser's login dialog — ONLY for /admin.
   Background checks and API calls must 401 quietly or every visitor gets a popup. */
function deny(res, challenge) {
  if (!ADMIN_PASS) {
    /* nothing to log in with — say so instead of prompting for a password that doesn't exist */
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('This site has no editor password set. Add an ADMIN_PASS variable in your hosting dashboard, redeploy, then reload /admin.');
    return;
  }
  const headers = challenge ? { 'WWW-Authenticate': 'Basic realm="site admin"' } : {};
  res.writeHead(401, headers);
  res.end('login required');
}

/* transcoder: bundled/system ffmpeg preferred (web-sized output); macOS avconvert as fallback */
const ffmpegLocal = join(root, '.claude', 'bin', 'ffmpeg');
const FFMPEG = process.env.FFMPEG || (existsSync(ffmpegLocal) ? ffmpegLocal : 'ffmpeg');
function transcode(src, out, cb) {
  execFile(FFMPEG,
    ['-y', '-v', 'error', '-i', src, '-vf', "scale=-2:'min(1280,ih)'", '-c:v', 'libx264', '-crf', '27', '-preset', 'medium', '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '96k', out],
    { timeout: 600000 },
    (err) => {
      if (!err && existsSync(out)) return cb(null);
      execFile('/usr/bin/avconvert',
        ['--preset', 'Preset1920x1080', '--source', src, '--output', out, '--replace'],
        { timeout: 600000 },
        (err2) => cb(err2 || (existsSync(out) ? null : new Error('no output'))));
    });
}

/* Upload ceiling. Phone clips are big, but nothing legitimate here approaches this —
   it exists so a stuck upload can't quietly eat the volume the site lives on. */
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD || 500) * 1024 * 1024;
/* collect a request body, refusing anything past the ceiling */
function readBody(req, res, cb) {
  const chunks = [];
  let size = 0, done = false;
  req.on('data', c => {
    if (done) return;
    size += c.length;
    if (size > MAX_UPLOAD) {
      done = true;
      res.writeHead(413, { 'content-type': 'text/plain' });
      res.end('That file is too big — keep uploads under ' + Math.round(MAX_UPLOAD / 1048576) + 'MB.');
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => { if (!done) cb(Buffer.concat(chunks)) });
}

/* hero film: 8s at 24fps ≈ 190 frames ≈ 15MB — enough to read as a film, small enough to preload */
const HERO_FPS = Number(process.env.HERO_FPS || 24);
const HERO_SECONDS = Number(process.env.HERO_SECONDS || 8);

const PORT = Number(process.env.PORT || 8750);
const HOST = process.env.HOST || '127.0.0.1';

http.createServer((req, res) => {
  if (req.url === '/auth-check') {
    if (authed(req)) { res.writeHead(200); res.end('ok') } else deny(res, false);
    return;
  }
  if (req.url === '/admin' || req.url === '/admin/') {
    if (authed(req)) { res.writeHead(302, { Location: '/?edit=1' }); res.end(); return }
    if (!ADMIN_PASS) { deny(res, false); return }   /* explains the missing variable */
    sendLogin(res, 200);
    return;
  }
  if (req.url === '/logout') {
    res.writeHead(302, { Location: '/', 'set-cookie': 'site_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
    res.end();
    return;
  }
  if (req.url === '/backup') {
    /* the owner's whole site — uploads, hero frames, settings — as one archive.
       One click in the editor beats asking anyone to go spelunking in a hosting
       dashboard, and a creator who has this file can rebuild anywhere. */
    if (!authed(req)) { deny(res, false); return }
    const stamp = new Date().toISOString().slice(0, 10);
    const tar = spawn('tar', ['-cz', '-C', root, 'assets/user'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let started = false;
    tar.stdout.once('data', () => { started = true });
    tar.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('backup tool unavailable on this server') } });
    tar.on('close', (code) => {
      if (!started && code !== 0 && !res.headersSent) { res.writeHead(500); res.end('backup failed') }
    });
    res.writeHead(200, {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="site-backup-${stamp}.tar.gz"`,
      'cache-control': 'no-store'
    });
    tar.stdout.pipe(res);
    req.on('close', () => { try { tar.kill() } catch {} });
    return;
  }
  if (req.method === 'POST' && req.url === '/login') {
    if (!ADMIN_PASS) { deny(res, false); return }
    if (!sameOrigin(req)) { res.writeHead(403); res.end('cross-site request refused'); return }
    /* a public password form invites guessing; slow it down per address.
       Behind a host's proxy every request shares one socket address, so trust the
       proxy's forwarded header first — otherwise one stranger's guesses would lock
       the owner out of their own site. */
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const who = fwd || req.socket.remoteAddress || 'unknown';
    if (attempts.size > 500) attempts.clear();   /* bots churn addresses; don't hoard them */
    const now = Date.now();
    const gate = attempts.get(who) || { n: 0, until: 0 };
    if (gate.until > now) {
      sendLogin(res, 429, { error: 'Too many tries. Wait a minute and try again.' });
      return;
    }
    readBody(req, res, (buf) => {
      const params = new URLSearchParams(buf.toString());
      const given = (params.get('password') || '').trim();
      if (given && sameSecret(given, ADMIN_PASS)) {
        attempts.delete(who);
        const secure = (req.headers['x-forwarded-proto'] || '').includes('https') ? ' Secure;' : '';
        res.writeHead(302, {
          Location: '/?edit=1',
          'set-cookie': `site_session=${makeSession()}; Path=/; Max-Age=${SESSION_DAYS * 86400};${secure} HttpOnly; SameSite=Lax`
        });
        res.end();
        return;
      }
      gate.n += 1;
      if (gate.n >= 8) { gate.n = 0; gate.until = now + 60000 }
      attempts.set(who, gate);
      sendLogin(res, 401, { error: 'That password didn\'t match. Check for a stray space at the end.' });
    });
    return;
  }
  if (req.method === 'POST' && !sameOrigin(req)) { res.writeHead(403); res.end('cross-site request refused'); return }
  if (req.method === 'POST' && !authed(req)) { deny(res, false); return }
  if (req.method === 'POST' && req.url.startsWith('/save-media')) {
    // persist an edited slot's media into the site's own files
    const u = new URL(req.url, 'http://x');
    const key = (u.searchParams.get('key') || '').replace(/[^a-z0-9_-]/gi, '');
    const type = u.searchParams.get('type') || '';
    if (!key) { res.writeHead(400); res.end('no key'); return }
    readBody(req, res, (buf) => {
      const dir = join(root, 'assets', 'user', 'slots');
      try { mkdirSync(dir, { recursive: true }) } catch {}
      const done = (p) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ path: p })) };
      if (!type.startsWith('video')) {
        const ext = type.includes('png') ? 'png' : 'jpg';
        const p = join(dir, key + '.' + ext);
        try { writeFileSync(p, buf); done('assets/user/slots/' + key + '.' + ext) }
        catch (e) { res.writeHead(500); res.end(String(e)) }
        return;
      }
      // videos: transcode to web-friendly H.264 mp4; keep original bytes if transcode fails
      const src = join(dir, key + '.src.mov'), out = join(dir, key + '.mp4');
      try { writeFileSync(src, buf) } catch (e) { res.writeHead(500); res.end(String(e)); return }
      transcode(src, out,
        (err) => {
          try { unlinkSync(src) } catch {}
          if (err || !existsSync(out)) {
            const p = join(dir, key + '.mov');
            try { writeFileSync(p, buf); done('assets/user/slots/' + key + '.mov') }
            catch (e) { res.writeHead(500); res.end(String(e)) }
            return;
          }
          done('assets/user/slots/' + key + '.mp4');
        });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/save-baked') {
    readBody(req, res, (buf) => {
      try {
        JSON.parse(buf.toString());   /* never leave unreadable settings on disk */
        const dir = join(root, 'assets', 'user');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'baked.json'), buf);
        res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(400); res.end('settings were not valid JSON') }
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/hero-upload') {
    /* owner's hero clip -> the frame sequence the film player paints.
       Streams to disk (clips can be hundreds of MB), then ffmpeg does the extraction
       the site owner would otherwise have to run by hand. */
    const tmp = mkdtempSync(join(tmpdir(), 'hero-'));
    const src = join(tmp, 'in.mov');
    const dir = join(root, 'assets', 'user', 'hero');
    const fail = (code, msg) => { try { rmSync(tmp, { recursive: true, force: true }) } catch {} res.writeHead(code, { 'content-type': 'text/plain' }); res.end(msg) };
    const ws = createWriteStream(src);
    let got = 0, over = false;
    req.on('data', c => {
      got += c.length;
      if (got > MAX_UPLOAD && !over) {
        over = true;
        req.destroy();
        fail(413, 'That video is too big — keep it under ' + Math.round(MAX_UPLOAD / 1048576) + 'MB.');
      }
    });
    req.pipe(ws);
    ws.on('error', e => { if (!over) fail(500, 'upload failed: ' + e.message) });
    ws.on('finish', () => {
      if (over) return;
      if (!existsSync(src) || statSync(src).size === 0) return fail(400, 'empty upload');
      try { mkdirSync(dir, { recursive: true }) } catch {}
      /* frames land in a fresh folder so a half-finished extraction never replaces a working film */
      const stage = join(tmp, 'out');
      mkdirSync(stage, { recursive: true });
      execFile(FFMPEG, [
        '-y', '-v', 'error', '-i', src,
        '-t', String(HERO_SECONDS),
        '-vf', `fps=${HERO_FPS},scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease`,
        '-q:v', '5', '-start_number', '0',
        join(stage, 'p_%03d.jpg')
      ], { timeout: 600000 }, (err) => {
        if (err && /ENOENT/.test(err.code || err.message || '')) return fail(501, 'ffmpeg-missing');
        let frames = [];
        try { frames = readdirSync(stage).filter(f => /^p_\d{3}\.jpg$/.test(f)).sort() } catch {}
        if (!frames.length) {
          if (err) console.warn('[hero] ffmpeg failed:', err.message);
          return fail(500, 'That video could not be read — try exporting it as an mp4 and uploading again.');
        }
        try {
          for (const f of readdirSync(dir)) if (/^p_\d{3}\.jpg$/.test(f)) unlinkSync(join(dir, f));
          for (const f of frames) writeFileSync(join(dir, f), readFileSync(join(stage, f)));
          const manifest = { frames: frames.length, fps: HERO_FPS, dur: +(frames.length / HERO_FPS).toFixed(3), updated: new Date().toISOString() };
          writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
          rmSync(tmp, { recursive: true, force: true });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(manifest));
        } catch (e) { fail(500, String(e)) }
      });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/convert-image') {
    /* iPhone photos arrive as HEIC, which most browsers can't display. This used to be
       done in the browser with a bundled library, but that library is LGPL and can't be
       redistributed inside a paid template — the host's own tools do the job instead. */
    readBody(req, res, (buf) => {
      const dir = mkdtempSync(join(tmpdir(), 'img-'));
      const src = join(dir, 'in.heic'), out = join(dir, 'out.jpg');
      const cleanup = () => { try { rmSync(dir, { recursive: true, force: true }) } catch {} };
      try { writeFileSync(src, buf) } catch (e) { cleanup(); res.writeHead(500); res.end(String(e)); return }
      const send = () => {
        try {
          const jpg = readFileSync(out);
          res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': jpg.length });
          res.end(jpg);
        } catch (e) { res.writeHead(500); res.end(String(e)) }
        cleanup();
      };
      /* heif-convert (libheif) is what the deploy image installs and what handles these
         properly; sips covers a Mac running this locally. ffmpeg comes last and only as
         a desperate fallback — its HEIF decode often returns the embedded thumbnail
         rather than the full photo, which would quietly hand back a blurry image. */
      execFile('heif-convert', ['-q', '88', src, out], { timeout: 120000 }, (e1) => {
        if (!e1 && existsSync(out)) return send();
        execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', src, '--out', out], { timeout: 120000 }, (e2) => {
          if (!e2 && existsSync(out)) return send();
          execFile(FFMPEG, ['-y', '-v', 'error', '-i', src, '-q:v', '3', out], { timeout: 120000 }, (e3) => {
            if (!e3 && existsSync(out)) return send();
            cleanup();
            res.writeHead(415, { 'content-type': 'text/plain' });
            res.end('This server cannot read HEIC photos. Change your iPhone camera to "Most Compatible" (Settings > Camera > Formats), or upload a JPEG.');
          });
        });
      });
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/convert-video') {
    // browser can't decode HEVC — transcode to H.264 mp4 server-side
    readBody(req, res, (buf) => {
      const dir = mkdtempSync(join(tmpdir(), 'vid-'));
      const src = join(dir, 'in.mov'), out = join(dir, 'out.mp4');
      const cleanup = () => { try { unlinkSync(src) } catch {} try { unlinkSync(out) } catch {} };
      try { writeFileSync(src, buf) }
      catch (e) { res.writeHead(500); res.end('write failed: ' + e); return }
      transcode(src, out,
        (err) => {
          if (err || !existsSync(out)) {
            cleanup();
            res.writeHead(500); res.end('convert failed: ' + (err ? err.message : 'no output'));
            return;
          }
          try {
            const buf = readFileSync(out);
            res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': buf.length });
            res.end(buf);
          } catch (e) { res.writeHead(500); res.end(String(e)) }
          cleanup();
        });
    });
    return;
  }
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    /* the site's public surface is exactly two things: the page and its assets.
       Everything else in the folder — this server's own source, the Dockerfile,
       a stray .env — is not web content and never leaves the machine. */
    if (p !== '/index.html' && !p.startsWith('/assets/')) {
      res.writeHead(404); res.end('not found'); return;
    }
    if (p.split('/').some(seg => seg.startsWith('.') && seg !== '.' && seg !== '..')) {
      res.writeHead(404); res.end('not found'); return;
    }
    const file = normalize(join(root, p));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const st = statSync(file);
    const type = types[extname(file).toLowerCase()] || 'application/octet-stream';
    /* html and the settings file stay fresh; media may cache for a day */
    const cache = (type.startsWith('text/html') || file.endsWith('baked.json')) ? 'no-cache' : 'public, max-age=86400';
    /* byte-range support — Safari and iOS refuse to play video without it */
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range && (range[1] || range[2])) {
      let start = range[1] ? parseInt(range[1], 10) : 0;
      let end = range[2] ? parseInt(range[2], 10) : st.size - 1;
      if (range[1] === '' && range[2]) { start = st.size - parseInt(range[2], 10); end = st.size - 1 }
      if (isNaN(start) || start < 0 || start >= st.size) {
        res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return;
      }
      if (isNaN(end) || end >= st.size) end = st.size - 1;
      res.writeHead(206, {
        'content-type': type, 'cache-control': cache,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${st.size}`,
        'accept-ranges': 'bytes'
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': cache, 'content-length': st.size, 'accept-ranges': 'bytes' });
    createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(500); res.end(String(e)) }
}).listen(PORT, HOST, () => {
  console.log(`serving on http://${HOST}:${PORT}`);
  if (ADMIN_PASS) console.log(`editor sign-in enabled — password is ${ADMIN_PASS.length} characters, sign in at /admin`);
  else console.log('NO ADMIN_PASS SET — editing is possible only from this machine. Set ADMIN_PASS to edit from the web.');
});
