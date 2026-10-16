/* ARPO Cloud Render — REAL server-side FFmpeg rendering.
   NOT faked: downloads a real ffmpeg binary at runtime, processes the video,
   uploads the result. Honest limits: ~60s function timeout → best for clips <60s.
   Swap uploadOutput() for S3/Supabase/Blob later without touching the rest. */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const FF_DIR = '/tmp/arpo-ff';
const FF_BIN = path.join(FF_DIR, 'ffmpeg');
/* npm tarball (gzip) — Vercel has no tar/xz/unzip binaries, so we gunzip with
   Node zlib and parse tar in pure JS. 4.1 static has all needed filters. */
const FF_URL = 'https://registry.npmjs.org/@ffmpeg-installer/linux-x64/-/linux-x64-4.1.0.tgz';
const FF_TAR_NAME = 'package/ffmpeg';
const FONT_FILE = path.join(FF_DIR, 'DejaVuSans-Bold.ttf');
const FONT_URL = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf';
const MAX_INPUT_BYTES = 150 * 1024 * 1024;

const execP = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 50000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, XDG_CACHE_HOME: '/tmp', FONTCONFIG_SYSROOT: '/tmp' }, ...opts }, (err, stdout, stderr) => {
    if (err) reject(new Error((stderr || err.message).slice(0, 300)));
    else resolve(stdout);
  });
});

function dl(url, dest, maxBytes = MAX_INPUT_BYTES) {  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'ARPO-render/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); dl(res.headers.location, dest, maxBytes).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('download HTTP ' + res.statusCode)); return; }
      let bytes = 0;
      const ws = fs.createWriteStream(dest);
      res.on('data', c => { bytes += c.length; if (bytes > maxBytes) { req.destroy(); ws.destroy(); reject(new Error('file too large (max 150MB)')); } });
      res.on('error', reject);
      ws.on('finish', () => resolve(bytes));
      ws.on('error', reject);
      res.pipe(ws);
    });
    req.on('error', reject);
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('download timed out')); });
  });
}

/* tmpfiles.org: API returns a page URL; the direct file link is tokenized
   (https://tmpfiles.org/dl/<token>/<id>/<file>) and must be scraped. */
function pageHtml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ARPO-render/1.0' } }, res => {
      let body = '';
      res.on('data', c => { body += c; if (body.length > 200000) { res.destroy(); resolve(body); } });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }).on('error', reject).setTimeout(15000, function () { this.destroy(); reject(new Error('page timed out')); });
  });
}
async function resolveDirect(url) {
  if (/tmpfiles\.org\/dl\/[A-Za-z0-9.]+\/[A-Za-z0-9]+\//.test(url)) return url; // tokenized direct link
  let page = url;
  const noTok = url.match(/(https:\/\/tmpfiles\.org)\/dl\/([A-Za-z0-9]+\/[^/?#]+)/);
  if (noTok) page = noTok[1] + '/' + noTok[2]; // tokenless /dl/ → page URL
  if (!/tmpfiles\.org\//.test(page)) return url; // not tmpfiles — use as-is
  try {
    const html = await pageHtml(page);
    const d = html.match(/https:\/\/tmpfiles\.org\/dl\/[A-Za-z0-9.]+\/[A-Za-z0-9]+\/[^"'\s<>]+/);
    if (d) return d[0];
  } catch (e) {}
  return url;
}

function tmpUpload(filePath, filename) {
  return new Promise((resolve, reject) => {
    const boundary = '----Arpo' + Date.now();
    const head = Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + filename + '"\r\nContent-Type: video/mp4\r\n\r\n');
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
    const stat = fs.statSync(filePath);
    const opts = {
      method: 'POST', hostname: 'tmpfiles.org', path: '/api/v1/upload',
      headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': head.length + stat.size + tail.length, 'User-Agent': 'ARPO-render/1.0' },
    };
    const req = https.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.status === 'success' && j.data && j.data.url) {
            resolve(j.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/'));
          } else reject(new Error('upload failed: ' + body.slice(0, 120)));
        } catch (e) { reject(new Error('upload bad response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('upload timed out')); });
    req.write(head);
    const rs = fs.createReadStream(filePath);
    rs.on('error', e => { req.destroy(); reject(e); });
    rs.on('data', c => { if (!req.write(c)) rs.pause(); });
    req.on('drain', () => rs.resume());
    rs.on('end', () => req.end(tail));
  });
}

/* Minimal ustar extractor (no tar binary on serverless). Extracts one file. */
function extractTarOne(tarBuf, wantName, destPath) {
  let off = 0;
  while (off + 512 <= tarBuf.length) {
    const h = tarBuf.subarray(off, off + 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) if (h[i] !== 0) { allZero = false; break; }
    if (allZero) break;
    let name = '';
    for (let i = 0; i < 100 && h[i] !== 0; i++) name += String.fromCharCode(h[i]);
    const sizeOct = Buffer.from(h.subarray(124, 136)).toString('ascii').replace(/\0| /g, '');
    const size = parseInt(sizeOct, 8) || 0;
    const type = String.fromCharCode(h[156]);
    off += 512;
    if ((type === '0' || type === '\0') && name === wantName) {
      fs.writeFileSync(destPath, tarBuf.subarray(off, off + size));
      return size;
    }
    off += Math.ceil(size / 512) * 512;
  }
  throw new Error('ffmpeg not found in archive');
}

async function ensureFfmpeg() {
  if (fs.existsSync(FF_BIN)) return;
  fs.mkdirSync(FF_DIR, { recursive: true });
  const tgz = path.join(FF_DIR, 'ff.tgz');
  await dl(FF_URL, tgz, 40 * 1024 * 1024);
  const tarBuf = zlib.gunzipSync(fs.readFileSync(tgz));
  extractTarOne(tarBuf, FF_TAR_NAME, FF_BIN);
  fs.chmodSync(FF_BIN, 0o755);
  try { fs.unlinkSync(tgz); } catch (e) {}
}

async function ensureFont() {
  if (fs.existsSync(FONT_FILE)) return true;
  try { await dl(FONT_URL, FONT_FILE, 2 * 1024 * 1024); return true; }
  catch (e) { return false; }
}

function escSrt(s) {
  return s.replace(/\\/g, '/').replace(/'/g, "'\\''").replace(/:/g, '\\:');
}

function buildArgs(ops, inF, outF, srtF, hasFont) {
  const args = ['-y', '-i', inF];
  const vf = [], af = [];
  const cuts = (ops.cuts || []).filter(c => c.end > c.start);
  if (cuts.length) {
    const expr = cuts.map(c => `between(t,${+c.start},${+c.end})`).join('+');
    vf.push(`select='${expr}'`, 'setpts=N/FRAME_RATE/TB');
    af.push(`aselect='${expr}'`, 'asetpts=N/SR/TB');
  }
  const speed = +ops.speed || 1;
  if (speed !== 1 && speed >= 0.5 && speed <= 2) {
    vf.push(`setpts=PTS/${speed}`);
    const at = [];
    let s = speed;
    while (s > 2) { at.push('atempo=2'); s /= 2; }
    while (s < 0.5) { at.push('atempo=0.5'); s /= 0.5; }
    at.push(`atempo=${+s.toFixed(2)}`);
    af.push(at.join(','));
  }
  if (ops.aspect === '9:16') vf.push('crop=ih*9/16:ih:(iw-ow)/2:(ih-oh)/2');
  else if (ops.aspect === '1:1') vf.push('crop=min(iw\\,ih):min(iw\\,ih)');
  if (ops.captionsSrt && hasFont) {
    fs.writeFileSync(srtF, ops.captionsSrt);
    vf.push(`subtitles=${escSrt(srtF)}:fontsdir=${escSrt(FF_DIR)}:force_style='FontName=DejaVu Sans,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=36'`);
  }
  if (vf.length) args.push('-vf', vf.join(','));
  if (af.length) args.push('-af', af.join(','));
  if (ops.mute) args.push('-an');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-movflags', '+faststart', outF);
  return args;
}

function fireEvent(name, data) {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;
  try {
    const body = JSON.stringify({ event: name, source: 'arpo-render', at: new Date().toISOString(), ...data });
    const u = new URL(url);
    const req = https.request({ method: 'POST', hostname: u.hostname, path: u.pathname + u.search, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } });
    req.setTimeout(5000, () => req.destroy());
    req.on('error', () => {});
    req.end(body);
  } catch (e) {}
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only' });
  const t0 = Date.now();
  const stages = {};
  const { inputUrl, ops = {}, filename } = req.body || {};
  if (!inputUrl || typeof inputUrl !== 'string' || !/^https?:\/\//.test(inputUrl))
    return res.status(400).json({ ok: false, error: 'inputUrl (http/https) required' });

  const job = 'r' + Date.now().toString(36);
  const inF = `/tmp/${job}-in.mp4`, outF = `/tmp/${job}-out.mp4`, srtF = `/tmp/${job}.srt`;
  let failedStage = 'init';
  try {
    let t = Date.now();
    failedStage = 'ffmpeg-download';
    await ensureFfmpeg(); stages.ffmpegReady = +((Date.now() - t) / 1000).toFixed(1);
    t = Date.now();
    failedStage = 'font/input-download';
    const hasFont = ops.captionsSrt ? await ensureFont() : false;
    const directUrl = await resolveDirect(inputUrl);
    failedStage = 'input-download';
    const inBytes = await dl(directUrl, inF); stages.downloaded = +((Date.now() - t) / 1000).toFixed(1);
    t = Date.now();
    failedStage = 'ffmpeg-run';
    const args = buildArgs(ops, inF, outF, srtF, hasFont);
    await execP(FF_BIN, args); stages.rendered = +((Date.now() - t) / 1000).toFixed(1);
    failedStage = 'output-stat';
    const outStat = fs.statSync(outF);
    if (!outStat.size) throw new Error('render produced empty file');
    t = Date.now();
    failedStage = 'output-upload';
    const pageUrl = await tmpUpload(outF, (filename || 'arpo-render') + '.mp4');
    const previewUrl = await resolveDirect(pageUrl);
    stages.uploaded = +((Date.now() - t) / 1000).toFixed(1);
    stages.total = +((Date.now() - t0) / 1000).toFixed(1);
    fireEvent('render_completed', { inputBytes: inBytes, outputBytes: outStat.size, stages });
    try { fs.unlinkSync(inF); fs.unlinkSync(outF); fs.unlinkSync(srtF); } catch (e) {}
    return res.status(200).json({
      ok: true, url: pageUrl, previewUrl, sizeBytes: outStat.size,
      captionsBurned: !!(ops.captionsSrt && hasFont),
      captionsSkipped: !!(ops.captionsSrt && !hasFont),
      stages, note: 'Beta: best for clips under 60s. Preview link may expire — download soon.',
    });
  } catch (e) {
    fireEvent('render_failed', { error: String(e.message || e).slice(0, 200) });
    try { fs.unlinkSync(inF); } catch (x) {}
    try { fs.unlinkSync(outF); } catch (x) {}
    try { fs.unlinkSync(srtF); } catch (x) {}
    const msg = String(e.message || e);
    const clean = /timed out|timeout/i.test(msg) ? 'Render took too long — try a shorter clip (under 60s).'
      : /too large/i.test(msg) ? 'Video too large for cloud render (max 150MB).'
      : /download HTTP/i.test(msg) ? 'Could not fetch the input video — the link may have expired.'
      : 'Render failed in the processing stage. Try again or use browser export.';
    return res.status(502).json({ ok: false, error: clean, stage: failedStage, stages });
  }
};
