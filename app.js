/* ============ arPo v2 — AI video editor (server AI engine) ============ */
'use strict';
const $ = id => document.getElementById(id);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

/* ---------- state ---------- */
const S = {
  file: null, fileURL: null, duration: 0, vw: 0, vh: 0, fname: '',
  clips: [],            // {id, start, end, caption, speed, rotate}
  selected: null,
  history: [], hIndex: -1,
  aspect: '9:16', resolution: '720p', style: 'clean', transition: 'cut',
  audioMode: 'keep', volume: 100,
  aiPlan: null, planSource: null,
  model: localStorage.getItem('arpo_model') || '',
  aiReady: false,
  template: null,
};
let clipSeq = 0;
const newClip = (start, end, caption) => ({ id: ++clipSeq, start, end, caption: caption || '', speed: 1, rotate: 0 });
const edur = c => (c.end - c.start) / (c.speed || 1); // effective (post-speed) duration

/* ---------- utils ---------- */
function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => t.className = '', 3200);
}
function fmt(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), sec = s % 60;
  return String(m).padStart(2, '0') + ':' + sec.toFixed(1).padStart(4, '0');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function ffEsc(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\n/g, ' '); }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function setStatus(msg, cls) { const s = $('planstatus'); s.textContent = msg; s.className = cls || ''; }

/* ---------- templates ---------- */
const TEMPLATES = [
  { id: 'recap', icon: '🎬', name: 'Story Recap', desc: 'Main kahani ke important moments ka recap.', prompt: 'Make a punchy recap: keep only the most important moments, strong opening hook, short captions on each beat.' },
  { id: 'podcast', icon: '🎙️', name: 'Podcast Highlights', desc: 'Bolne wale content ke best highlights.', prompt: 'Extract the best highlight moments from this talking video. Keep original voice, add short captions for each highlight, tight pacing.' },
  { id: 'cine', icon: '🎞️', name: 'Cinematic Short', desc: 'Cinematic pacing aur dramatic look.', prompt: 'Make a cinematic short: dramatic pacing, best visuals only, warm cinematic look, hard cuts on beat.' },
  { id: 'promo', icon: '📢', name: 'Product Promo', desc: 'Product ke liye energetic promo cut.', prompt: 'Make a fast product promo: show the product clearly, energetic cuts, bold captions, strong call-to-action ending.' },
  { id: 'travel', icon: '✈️', name: 'Travel Vlog', desc: 'Trip ki best memories ka montage.', prompt: 'Make a travel montage: best scenic moments, smooth pacing, upbeat energy, captions with place vibes.' },
  { id: 'fitness', icon: '💪', name: 'Fitness Reel', desc: 'Workout clips ka powerful reel.', prompt: 'Make a high-energy fitness reel: hardest reps only, fast cuts on beat, bold motivational captions.' },
  { id: 'food', icon: '🍔', name: 'Food Review', desc: 'Dishes ke tasty close-ups.', prompt: 'Make a tasty food review cut: close-up shots of dishes, quick cuts, captions naming each dish, mouth-watering pacing.' },
  { id: 'motivation', icon: '🔥', name: 'Motivational', desc: 'Speech ka powerful short.', prompt: 'Make a motivational short: strongest lines only, dramatic pauses, bold captions on key phrases, cinematic look.' },
];
/* ---------- views (Magic Hour style) ---------- */
function showHome() { $('home').hidden = false; $('editorview').hidden = true; window.scrollTo(0, 0); }
function openEditor(tid) {
  $('home').hidden = true; $('editorview').hidden = false; window.scrollTo(0, 0);
  if (tid) {
    const t = TEMPLATES.find(x => x.id === tid);
    if (t) { S.template = tid; $('prompttext').value = t.prompt; setStatus('Style "' + t.name + '" loaded — upload a video, then Generate AI Plan.', 'ok'); }
  }
  renderTemplates();
}
function renderTemplates() {
  const box = $('toolgrid'); if (!box) return; box.innerHTML = '';
  const custom = document.createElement('div');
  custom.className = 'toolcard custom';
  custom.innerHTML = '<div class="tico">✨</div><b>Custom Edit</b><span>Blank canvas — prompt tum likho, edit AI banaye.</span>';
  custom.onclick = () => openEditor(null);
  box.appendChild(custom);
  const th = document.createElement('div');
  th.className = 'toolcard';
  th.innerHTML = '<div class="tico">🎨</div><b>AI Thumbnail</b><span>YouTube &amp; Reels covers — free AI paint karega.</span>';
  th.onclick = () => { $('thumbimg').style.display = 'none'; $('thumbdl').style.display = 'none'; $('thumbmodal').classList.add('open'); };
  box.appendChild(th);
  TEMPLATES.forEach(t => {
    const d = document.createElement('div');
    d.className = 'toolcard' + (S.template === t.id ? ' active' : '');
    d.innerHTML = '<div class="tico">' + t.icon + '</div><b>' + esc(t.name) + '</b><span>' + esc(t.desc) + '</span>';
    d.onclick = () => openEditor(t.id);
    box.appendChild(d);
  });
}

/* ---------- upload ---------- */
const dz = $('dropzone'), fi = $('fileinput');
dz.onclick = () => fi.click();
['dragover', 'dragenter'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => dz.addEventListener(e, ev => { ev.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) loadFile(f); });
fi.onchange = () => { const f = fi.files[0]; if (f) loadFile(f); };

function loadFile(f) {
  const ok = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'];
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (!ok.includes(f.type) && !['mp4', 'mov', 'm4v', 'webm'].includes(ext)) { toast('Only MP4 / MOV / M4V / WebM.', true); return; }
  if (f.size > 4 * 1024 * 1024 * 1024) { toast('File is over the 4 GB limit.', true); return; }
  if (S.fileURL) URL.revokeObjectURL(S.fileURL);
  S.file = f; S.fname = f.name; S.fileURL = URL.createObjectURL(f);
  const v = $('preview');
  v.src = S.fileURL; v.style.display = 'block'; $('nopreview').style.display = 'none';
  v.onloadedmetadata = () => {
    S.duration = v.duration; S.vw = v.videoWidth; S.vh = v.videoHeight;
    if (S.duration > 3600) { toast('Longer than 1 hour — only the first hour is usable.', true); S.duration = 3600; }
    const mb = (f.size / 1048576).toFixed(1);
    const fe = $('fileinfo'); fe.style.display = 'block';
    fe.innerHTML = '<b>' + esc(f.name) + '</b><br>Duration: ' + fmt(S.duration) + ' · ' + S.vw + '×' + S.vh + '<br>Size: ' + mb + ' MB';
    $('planbtn').disabled = false; $('exportbtn').disabled = false;
    if (S.duration > 600) toast('Long video — export will be slow in the browser. Shorter is better.');
    S.clips = [newClip(0, S.duration, '')];
    S.selected = S.clips[0].id; S.aiPlan = null; S.planSource = null;
    pushHistory(); renderAll(); updateTimecode(); autosave();
  };
  v.onerror = () => toast('Could not read this video file.', true);
}

/* ---------- AI engine (server) ---------- */
async function checkEngine() {
  const badge = $('aiengine'), box = $('enginestatus');
  try {
    const r = await fetch('/api/models');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const engine = j.engine || 'ollama';
    const models = j.models || [], ids = j.ids || models;
    S.aiReady = models.length > 0;
    S.engine = engine;
    const sel = $('modelsel'); sel.innerHTML = '';
    models.forEach((label, i) => {
      const id = ids[i] || label;
      const o = document.createElement('option'); o.value = id; o.textContent = label;
      if (id === S.model) o.selected = true; sel.appendChild(o);
    });
    if (!S.model || !ids.includes(S.model)) { S.model = ids[0] || ''; sel.value = S.model; }
    if (engine === 'free') {
      badge.textContent = '● Free AI'; badge.style.background = '#111';
      box.innerHTML = '<div class="okline">● <span>Free AI engine connected — <b>no API key needed</b>, works out of the box. (Owner can add an Ollama key on the server for the pro engine.)</span></div>';
      setStatus('Free AI ready — no key needed.', 'ok');
    } else {
      badge.textContent = '● AI ready (pro)'; badge.style.background = '#111';
      box.innerHTML = '<div class="okline">● <span>Pro AI engine (Ollama) connected — ' + models.length + ' models. Shared key, protected on the server.</span></div>';
      setStatus('Pro AI ready.', 'ok');
    }
  } catch (e) {
    S.aiReady = false; S.engine = 'demo';
    badge.textContent = '◌ Demo mode'; badge.style.background = '#999';
    $('modelsel').innerHTML = '<option value="">— Demo mode (offline) —</option>';
    box.innerHTML = '<div class="badline">◌ <span>AI unreachable right now — Demo mode works fully offline.</span></div>';
    setStatus('Demo mode.', '');
  }
}
$('settingsbtn').onclick = () => { $('modal').classList.add('open'); checkEngine(); };
$('modalcancel').onclick = () => $('modal').classList.remove('open');
$('modalcheck').onclick = checkEngine;
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') $('modal').classList.remove('open'); });
$('refreshmodels').onclick = checkEngine;
$('modelsel').onchange = e => { S.model = e.target.value; localStorage.setItem('arpo_model', S.model); };

/* ---------- frame sampling ---------- */
async function sampleFrames(n) {
  const v = $('preview');
  const count = clamp(n || 6, 2, 10);
  const frames = [];
  const c = document.createElement('canvas'); c.width = 288; c.height = Math.round(288 * v.videoHeight / Math.max(1, v.videoWidth));
  const ctx = c.getContext('2d');
  const wasPaused = v.paused, curT = v.currentTime;
  for (let i = 0; i < count; i++) {
    const t = S.duration * (i + 0.5) / count;
    await new Promise(res => {
      const h = () => { v.removeEventListener('seeked', h); res(); };
      v.addEventListener('seeked', h); v.currentTime = Math.min(t, S.duration - 0.05);
      setTimeout(res, 1500);
    });
    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, c.height - 20, 80, 20);
      ctx.fillStyle = '#fff'; ctx.font = '12px monospace'; ctx.fillText(fmt(t), 7, c.height - 6);
      frames.push(c.toDataURL('image/jpeg', 0.65));
    } catch (e) {}
  }
  try { v.currentTime = curT; if (!wasPaused) v.play().catch(() => {}); } catch (e) {}
  return frames;
}

/* ---------- AI plan ---------- */
$('planbtn').onclick = async () => {
  if (!S.file) return;
  const prompt = $('prompttext').value.trim();
  if (!prompt) { toast('Write what you want edited first.', true); return; }
  $('planbtn').disabled = true;
  try {
    setStatus('Sampling frames…', '');
    const frames = await sampleFrames(6);
    if (S.aiReady) {
      setStatus('AI is planning your edit…', '');
      const r = await fetch('/api/plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, frames, duration: S.duration, vw: S.vw, vh: S.vh, model: S.model }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status));
      applyPlan(j, j.engine === 'free' ? 'free' : 'ai');
    } else {
      setStatus('Demo mode — building smart local plan…', '');
      await new Promise(r => setTimeout(r, 500));
      applyPlan(demoPlan(prompt), 'demo');
    }
  } catch (e) {
    console.error(e);
    setStatus('AI failed (' + e.message + ') — demo plan instead.', 'err');
    try { applyPlan(demoPlan($('prompttext').value.trim()), 'demo'); }
    catch (e2) { toast('Plan failed: ' + e.message, true); }
  }
  $('planbtn').disabled = false;
};

function demoPlan(prompt) {
  const p = (prompt || '').toLowerCase();
  let target = 0, m = p.match(/(\d+)\s*-?\s*second/); if (m) target = +m[1];
  m = p.match(/(\d+)\s*min/); if (m) target = +m[1] * 60;
  const wantCap = /caption|subtitle|text/.test(p);
  const aspect = /16:9|wide|youtube/.test(p) ? '16:9' : (/1:1|square/.test(p) ? '1:1' : '9:16');
  const style = /cinematic|dramatic|moody/.test(p) ? 'cinematic' : (/vibrant|energetic|bold/.test(p) ? 'vibrant' : (/warm/.test(p) ? 'warm' : 'clean'));
  const D = S.duration, clips = [];
  const capWords = ['Hook', 'Best moment', 'Watch this', 'Key point', 'Highlight', 'Don’t miss this', 'The payoff', 'Recap'];
  if (target > 0 && D > target) {
    const n = clamp(Math.round(target / 8), 2, 6), segLen = target / n;
    for (let i = 0; i < n; i++) {
      const center = D * (i + 0.75) / (n + 0.5);
      const s = clamp(center - segLen / 2, 0, D - segLen);
      clips.push(newClip(+s.toFixed(1), +(s + segLen).toFixed(1), wantCap ? capWords[i % capWords.length] : ''));
    }
  } else if (D > 90) {
    [0.03, 0.3, 0.55, 0.8].forEach((f, i) => {
      const s = D * f;
      clips.push(newClip(+s.toFixed(1), +Math.min(D, s + (i === 0 ? 8 : 12)).toFixed(1), wantCap ? capWords[i % capWords.length] : ''));
    });
  } else clips.push(newClip(0, +D.toFixed(1), ''));
  return { clips: clips.map(c => ({ start: c.start, end: c.end, caption: c.caption, speed: 1, rotate: 0 })), aspect, style, transition: 'cut', notes: 'Demo plan' };
}

function applyPlan(plan, source) {
  if (!plan || !Array.isArray(plan.clips) || !plan.clips.length) throw new Error('Empty plan.');
  const D = S.duration, clips = [];
  plan.clips.forEach(c => {
    let s = +c.start, e = +c.end;
    if (!isFinite(s) || !isFinite(e) || e <= s) return;
    s = clamp(s, 0, D - 0.2); e = clamp(e, s + 0.2, D);
    const nc = newClip(+s.toFixed(1), +e.toFixed(1), String(c.caption || '').slice(0, 120));
    nc.speed = [0.5, 1, 1.5, 2].includes(+c.speed) ? +c.speed : 1;
    nc.rotate = [0, 90, 180, 270].includes(+c.rotate) ? +c.rotate : 0;
    clips.push(nc);
  });
  if (!clips.length) throw new Error('No valid clips.');
  clips.sort((a, b) => a.start - b.start);
  for (let i = 1; i < clips.length; i++) if (clips[i].start < clips[i - 1].end) clips[i].start = clips[i - 1].end;
  S.clips = clips.filter(c => c.end > c.start);
  S.selected = S.clips[0].id;
  if (['9:16', '16:9', '1:1'].includes(plan.aspect)) S.aspect = plan.aspect;
  if (['clean', 'cinematic', 'vibrant', 'warm'].includes(plan.style)) S.style = plan.style;
  if (['cut', 'fade'].includes(plan.transition)) S.transition = plan.transition;
  S.aiPlan = JSON.parse(JSON.stringify(S.clips)); S.planSource = source;
  pushHistory(); renderAll(); syncChips(); autosave();
  setStatus(source === 'demo' ? '✓ Demo plan ready — review & adjust below.' : '✓ ' + (source === 'free' ? 'Free AI' : 'AI') + ' plan ready — review & adjust below.', 'ok');
  toast(source === 'demo' ? 'Demo plan ready.' : (source === 'free' ? 'Free AI plan ready!' : 'AI plan ready!'));
}

/* ---------- history ---------- */
function snap() { return JSON.stringify({ clips: S.clips, selected: S.selected, aspect: S.aspect, style: S.style, transition: S.transition, audioMode: S.audioMode, volume: S.volume, resolution: S.resolution }); }
function pushHistory() {
  S.history = S.history.slice(0, S.hIndex + 1);
  S.history.push(snap());
  if (S.history.length > 60) S.history.shift();
  S.hIndex = S.history.length - 1;
}
function restore(json) {
  const o = JSON.parse(json);
  Object.assign(S, { clips: o.clips, selected: o.selected, aspect: o.aspect, style: o.style, transition: o.transition, audioMode: o.audioMode, volume: o.volume, resolution: o.resolution });
  renderAll(); syncChips(); autosave();
}
$('undobtn').onclick = () => { if (S.hIndex > 0) { S.hIndex--; restore(S.history[S.hIndex]); } };
$('redobtn').onclick = () => { if (S.hIndex < S.history.length - 1) { S.hIndex++; restore(S.history[S.hIndex]); } };
$('resetbtn').onclick = () => {
  if (!S.aiPlan) { toast('No AI plan to reset to yet.', true); return; }
  S.clips = JSON.parse(JSON.stringify(S.aiPlan)); S.selected = S.clips[0].id;
  pushHistory(); renderAll(); autosave(); toast('Reset to AI plan.');
};

/* ---------- timeline ---------- */
function renderTimeline() {
  const track = $('track');
  $$('.clip', track).forEach(e => e.remove());
  $$('.tick', $('tl-ruler')).forEach(e => e.remove());
  const D = S.duration || 1;
  S.clips.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'clip' + (c.id === S.selected ? ' sel' : '');
    d.style.left = (c.start / D * 100) + '%';
    d.style.width = Math.max(0.6, (c.end - c.start) / D * 100) + '%';
    d.innerHTML = '<div class="cl">Clip ' + (i + 1) + '</div><div class="ct">' + fmt(c.start) + ' → ' + fmt(c.end) + '</div>' +
      (c.caption ? '<div class="cc">' + esc(c.caption) + '</div>' : '') +
      (c.speed !== 1 || c.rotate ? '<div class="cs">' + (c.speed !== 1 ? c.speed + '× ' : '') + (c.rotate ? c.rotate + '°' : '') + '</div>' : '');
    d.onclick = e => { e.stopPropagation(); selectClip(c.id); };
    d.ondblclick = e => { e.stopPropagation(); $('preview').currentTime = c.start; };
    track.insertBefore(d, $('playhead'));
  });
  const ruler = $('tl-ruler');
  for (let i = 0; i <= 10; i++) {
    const t = document.createElement('div'); t.className = 'tick';
    t.style.left = (i * 10) + '%'; t.textContent = fmt(D * i / 10);
    ruler.appendChild(t);
  }
}
$('track').onclick = e => {
  if (!S.duration) return;
  const r = $('track').getBoundingClientRect();
  $('preview').currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * S.duration;
  updateTimecode();
};

/* ---------- inspector ---------- */
function selectClip(id) { S.selected = id; renderTimeline(); renderInspector(); }
function getSel() { return S.clips.find(c => c.id === S.selected) || null; }
function renderInspector() {
  const c = getSel();
  $('clipstart').value = c ? c.start : '';
  $('clipend').value = c ? c.end : '';
  $('clipdur').textContent = c ? (edur(c)).toFixed(1) + 's out' : '—';
  $('captext').value = c ? c.caption : '';
  $('delclip').disabled = !c;
  $$('#speedrow .chip').forEach(ch => ch.classList.toggle('on', c && +ch.dataset.v === c.speed));
  $$('#rotaterow .chip').forEach(ch => ch.classList.toggle('on', c && +ch.dataset.v === c.rotate));
}
$('clipstart').onchange = e => { const c = getSel(); if (!c) return; c.start = clamp(+e.target.value || 0, 0, c.end - 0.2); pushHistory(); renderTimeline(); renderInspector(); autosave(); };
$('clipend').onchange = e => { const c = getSel(); if (!c) return; c.end = clamp(+e.target.value || 0, c.start + 0.2, S.duration); pushHistory(); renderTimeline(); renderInspector(); autosave(); };
$('captext').oninput = e => { const c = getSel(); if (!c) return; c.caption = e.target.value.slice(0, 120); renderTimeline(); autosaveLight(); };
$$('#speedrow .chip').forEach(ch => ch.onclick = () => { const c = getSel(); if (!c) return; c.speed = +ch.dataset.v; pushHistory(); renderTimeline(); renderInspector(); autosave(); });
$$('#rotaterow .chip').forEach(ch => ch.onclick = () => { const c = getSel(); if (!c) return; c.rotate = +ch.dataset.v; pushHistory(); renderTimeline(); renderInspector(); autosave(); });
let _alT = null;
function autosaveLight() { clearTimeout(_alT); _alT = setTimeout(autosave, 800); }
$('delclip').onclick = () => {
  const c = getSel(); if (!c) return;
  S.clips = S.clips.filter(x => x.id !== c.id);
  S.selected = S.clips.length ? S.clips[0].id : null;
  pushHistory(); renderAll(); autosave(); toast('Clip removed.');
};
$('splitbtn').onclick = () => {
  const c = getSel(); if (!c || !S.duration) return;
  const t = $('preview').currentTime;
  if (t <= c.start + 0.2 || t >= c.end - 0.2) { toast('Move the playhead inside the selected clip to split.', true); return; }
  const i = S.clips.indexOf(c);
  const a = newClip(c.start, +t.toFixed(1), c.caption); a.speed = c.speed; a.rotate = c.rotate;
  const b = newClip(+t.toFixed(1), c.end, ''); b.speed = c.speed; b.rotate = c.rotate;
  S.clips.splice(i, 1, a, b); S.selected = b.id;
  pushHistory(); renderAll(); autosave(); toast('Clip split.');
};
function moveSel(dir) {
  const i = S.clips.findIndex(c => c.id === S.selected), j = i + dir;
  if (i < 0 || j < 0 || j >= S.clips.length) return;
  const t = S.clips[i]; S.clips[i] = S.clips[j]; S.clips[j] = t;
  pushHistory(); renderTimeline(); autosave();
}
$('moveleft').onclick = () => moveSel(-1);
$('moveright').onclick = () => moveSel(1);

/* ---------- option chips ---------- */
function chipRow(id, get, set) {
  $$('#' + id + ' .chip').forEach(ch => {
    ch.classList.toggle('on', ch.dataset.v === get());
    ch.onclick = () => { set(ch.dataset.v); pushHistory(); renderTimeline(); syncChips(); autosave(); };
  });
}
function syncChips() {
  chipRow('aspectrow', () => S.aspect, v => S.aspect = v);
  chipRow('resrow', () => S.resolution, v => S.resolution = v);
  chipRow('stylerow', () => S.style, v => S.style = v);
  chipRow('transrow', () => S.transition, v => S.transition = v);
  chipRow('audiorow', () => S.audioMode, v => S.audioMode = v);
  $('vol').value = S.volume; $('volv').textContent = S.volume + '%';
}
$('vol').oninput = e => { S.volume = +e.target.value; $('volv').textContent = S.volume + '%'; autosaveLight(); };

/* ---------- preview sync ---------- */
const pv = $('preview');
pv.addEventListener('timeupdate', updateTimecode);
function updateTimecode() {
  $('timecode').textContent = fmt(pv.currentTime || 0) + ' / ' + fmt(S.duration);
  if (S.duration) $('playhead').style.left = (pv.currentTime / S.duration * 100) + '%';
}

/* ---------- autosave ---------- */
function autosave() {
  try {
    localStorage.setItem('arpo_project', JSON.stringify({
      clips: S.clips, aspect: S.aspect, resolution: S.resolution, style: S.style,
      transition: S.transition, audioMode: S.audioMode, volume: S.volume,
      prompt: $('prompttext').value, projname: $('projname').value,
    }));
  } catch (e) {}
}
function renderAll() { renderTimeline(); renderInspector(); }
$('projname').oninput = autosaveLight;

/* ---------- export (FFmpeg.wasm) ---------- */
let ffmpeg = null, ffLoaded = false, ffLoading = null, exportBlobURL = null;
async function getFFmpeg(onprog) {
  if (ffmpeg && ffLoaded) { if (onprog) ffmpeg.on('progress', onprog); return ffmpeg; }
  if (ffLoading) return ffLoading;
  ffLoading = (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const { toBlobURL } = await import('@ffmpeg/util');
    const base = 'https://unpkg.com/@ffmpeg/core-st@0.12.6/dist/esm';
    ffmpeg = new FFmpeg();
    if (onprog) ffmpeg.on('progress', onprog);
    await ffmpeg.load({
      coreURL: await toBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm'),
    });
    ffLoaded = true; return ffmpeg;
  })();
  return ffLoading;
}
function targetWH() {
  if (S.resolution === '4K') {
    if (S.aspect === '9:16') return [2160, 3840];
    if (S.aspect === '16:9') return [3840, 2160];
    return [2160, 2160];
  }
  const hi = S.resolution === '1080p';
  if (S.aspect === '9:16') return hi ? [1080, 1920] : [720, 1280];
  if (S.aspect === '16:9') return hi ? [1920, 1080] : [1280, 720];
  return hi ? [1080, 1080] : [720, 720];
}
function styleFilter() {
  switch (S.style) {
    case 'cinematic': return ',eq=contrast=1.08:saturation=0.92,colorbalance=gs=0.04:bs=-0.05';
    case 'vibrant': return ',eq=contrast=1.05:saturation=1.35';
    case 'warm': return ',eq=saturation=1.12,colorbalance=rs=0.12:gs=0.05:bs=-0.08';
    default: return '';
  }
}
function rotFilter(r) {
  if (r === 90) return ',transpose=1';
  if (r === 180) return ',transpose=1,transpose=1';
  if (r === 270) return ',transpose=2';
  return '';
}
$('exportbtn').onclick = async () => {
  if (!S.file || !S.clips.length) { toast('Upload a video and make a plan first.', true); return; }
  if (S.resolution === '4K' && !confirm('4K export browser mein BOHAT slow hai aur phone par memory khatam ho sakti hai. Continue?')) return;
  if (S.file.size > 500 * 1048576 && !confirm('Over 500 MB — in-browser export may run out of memory. Continue?')) return;
  $('exportov').classList.add('open'); $('expdone').style.display = 'none';
  setExp(0, 'Loading render engine… (first time ~30s)');
  try {
    const ff = await getFFmpeg(p => setExp(Math.min(99, Math.round((p.progress || 0) * 100)), 'Rendering… ' + Math.min(99, Math.round((p.progress || 0) * 100)) + '%'));
    const { fetchFile } = await import('@ffmpeg/util');
    const ext = (S.fname.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    setExp(2, 'Reading source video…');
    await ff.writeFile('input.' + ext, await fetchFile(S.file));
    let haveFont = false;
    setExp(4, 'Preparing captions…');
    try {
      const fr = await fetch('https://cdn.jsdelivr.net/fontsource/fonts/manrope@latest/latin-700-normal.ttf');
      if (fr.ok) { await ff.writeFile('font.ttf', new Uint8Array(await fr.arrayBuffer())); haveFont = true; }
    } catch (e) {}
    const [W, H] = targetWH(), N = S.clips.length, vols = (S.volume / 100).toFixed(2);
    const durs = S.clips.map(edur);
    const useFade = S.transition === 'fade' && N > 1 && durs.every(d => d > 0.7);
    if (S.transition === 'fade' && N > 1 && !useFade) toast('A clip is too short for fades — using hard cuts.');
    const mute = S.audioMode === 'mute', fc = [];
    S.clips.forEach((c, i) => {
      fc.push(`[0:v]trim=start=${c.start}:end=${c.end},setpts=(PTS-STARTPTS)/${c.speed}${rotFilter(c.rotate)},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30${styleFilter()}[v${i}]`);
      if (!mute) fc.push(`[0:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,atempo=${c.speed},volume=${vols}[a${i}]`);
    });
    let vout = 'vcat', aout = 'acat';
    if (N === 1) { fc.push('[v0]copy[vcat]'); if (!mute) fc.push('[a0]acopy[acat]'); }
    else if (useFade) {
      const F = 0.5; let acc = durs[0], prev = 'v0', aprev = 'a0';
      for (let i = 1; i < N; i++) { fc.push(`[${prev}][v${i}]xfade=transition=fade:duration=${F}:offset=${(acc - F).toFixed(2)}[x${i}]`); prev = 'x' + i; acc += durs[i] - F; }
      vout = prev;
      if (!mute) { for (let i = 1; i < N; i++) { fc.push(`[${aprev}][a${i}]acrossfade=d=${F}[ax${i}]`); aprev = 'ax' + i; } aout = aprev; }
    } else {
      fc.push(`[${durs.map((_, i) => 'v' + i).join('][')}]concat=n=${N}:v=1:a=0[vcat]`);
      if (!mute) fc.push(`[${durs.map((_, i) => 'a' + i).join('][')}]concat=n=${N}:v=0:a=1[acat]`);
    }
    const F = useFade ? 0.5 : 0;
    let tcur = 0, capF = '';
    S.clips.forEach((c, i) => {
      if (c.caption && haveFont) {
        const fs = Math.round(W / 16);
        capF += `,drawtext=fontfile=/font.ttf:text='${ffEsc(c.caption)}':fontsize=${fs}:fontcolor=white:borderw=${Math.max(2, Math.round(fs / 18))}:bordercolor=black:x=(w-text_w)/2:y=h-${Math.round(H / 9)}:enable='between(t,${tcur.toFixed(2)},${(tcur + durs[i] - (useFade && i < N - 1 ? F : 0)).toFixed(2)})'`;
      }
      tcur += durs[i] - (useFade && i < N - 1 ? F : 0);
    });
    fc.push(capF ? `[${vout}]${capF.slice(1)}[vout]` : `[${vout}]copy[vout]`);
    if (!mute && aout !== 'acat') fc.push(`[${aout}]acopy[acat]`);
    const args = ['-i', 'input.' + ext, '-filter_complex', fc.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
    if (mute) args.push('-an'); else args.push('-map', '[acat]', '-c:a', 'aac', '-b:a', '128k');
    args.push('-movflags', '+faststart', 'out.mp4');
    setExp(6, 'Rendering video… this can take a while.');
    await ff.exec(args);
    setExp(98, 'Finalizing…');
    const data = await ff.readFile('out.mp4');
    if (exportBlobURL) URL.revokeObjectURL(exportBlobURL);
    exportBlobURL = URL.createObjectURL(new Blob([data.buffer], { type: 'video/mp4' }));
    try { await ff.deleteFile('out.mp4'); await ff.deleteFile('input.' + ext); } catch (e) {}
    setExp(100, 'Done!');
    $('expdone').style.display = 'block';
    toast('Export ready — download your MP4!');
  } catch (e) {
    console.error(e);
    $('expmsg').innerHTML = '<span style="color:#d33">Render failed: ' + esc(e.message || e) + '</span><br><br>Try a shorter video, hard cuts, or reload and retry.';
  }
};
function setExp(pct, msg) { $('pbar').style.width = pct + '%'; if (msg) $('expmsg').textContent = msg; }
$('expcancel').onclick = async () => {
  $('exportov').classList.remove('open');
  try { if (ffmpeg) await ffmpeg.terminate(); } catch (e) {}
  ffmpeg = null; ffLoaded = false; ffLoading = null; toast('Render cancelled.');
};
$('dlbtn').onclick = () => {
  if (!exportBlobURL) return;
  const a = document.createElement('a');
  a.href = exportBlobURL;
  a.download = 'arpo-' + ($('projname').value || 'video').replace(/[^\w\-]+/g, '-').slice(0, 40) + '.mp4';
  a.click();
};

/* ---------- AI thumbnail (free, no key) ---------- */
let thumbRatio = '16:9';
$$('#thumbratio .chip').forEach(ch => ch.onclick = () => {
  thumbRatio = ch.dataset.v;
  $$('#thumbratio .chip').forEach(x => x.classList.toggle('on', x === ch));
});
$('thumbclose').onclick = () => $('thumbmodal').classList.remove('open');
$('thumbmodal').addEventListener('click', e => { if (e.target.id === 'thumbmodal') $('thumbmodal').classList.remove('open'); });
$('thumbgen').onclick = () => {
  const p = $('thumbprompt').value.trim();
  if (!p) { toast('Describe your thumbnail first.', true); return; }
  const wh = thumbRatio === '16:9' ? [1280, 720] : thumbRatio === '9:16' ? [720, 1280] : [1024, 1024];
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(p) +
    '?width=' + wh[0] + '&height=' + wh[1] + '&nologo=true&seed=' + Math.floor(Math.random() * 999999);
  $('thumbimg').style.display = 'none'; $('thumbdl').style.display = 'none';
  $('thumbloading').style.display = 'block';
  const img = $('thumbimg');
  img.onload = () => {
    $('thumbloading').style.display = 'none'; img.style.display = '';
    const dl = $('thumbdl'); dl.style.display = ''; dl.href = url;
    toast('Thumbnail ready!');
  };
  img.onerror = () => { $('thumbloading').style.display = 'none'; toast('Generation failed — try again.', true); };
  img.src = url;
};

/* ---------- auth (Supabase — hidden until owner configures) ---------- */
let sb = null;
async function initAuth() {
  try {
    const r = await fetch('/api/config'); const c = await r.json();
    if (!c.supabaseUrl || !c.supabaseAnonKey || !window.supabase) return; // not configured → stay hidden
    sb = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey);
    const { data } = await sb.auth.getSession();
    setUser(data.session ? data.session.user : null);
    sb.auth.onAuthStateChange((_ev, sess) => setUser(sess ? sess.user : null));
    if (!sb._user) $('loginbtn').style.display = '';
  } catch (e) { /* auth unavailable — app works without it */ }
}
function setUser(u) {
  sb._user = u || null;
  $('loginbtn').style.display = u ? 'none' : '';
  const chip = $('userchip');
  if (u) {
    chip.style.display = '';
    chip.innerHTML = '<span style="font-size:12px;font-weight:800;background:#111;color:#fff;border-radius:20px;padding:8px 14px">👤 ' + esc(String(u.email).split('@')[0]) + '</span> <button class="btn sm ghost" id="logoutbtn">Logout</button>';
    $('logoutbtn').onclick = async () => { await sb.auth.signOut(); toast('Logged out.'); };
  } else { chip.style.display = 'none'; chip.innerHTML = ''; }
}
let authMode = 'login';
function drawAuth() {
  $('authtitle').textContent = authMode === 'login' ? '🔐 Log in' : '📝 Sign up';
  $('authgo').textContent = authMode === 'login' ? 'Log in' : 'Create account';
  $('authswitch').textContent = authMode === 'login' ? 'New here? Sign up' : 'Have an account? Log in';
  $('autherr').textContent = '';
}
$('loginbtn').onclick = () => { authMode = 'login'; drawAuth(); $('authmodal').classList.add('open'); };
$('authcancel').onclick = () => $('authmodal').classList.remove('open');
$('authmodal').addEventListener('click', e => { if (e.target.id === 'authmodal') $('authmodal').classList.remove('open'); });
$('authswitch').onclick = () => { authMode = authMode === 'login' ? 'signup' : 'login'; drawAuth(); };
$('authgo').onclick = async () => {
  if (!sb) return;
  const em = $('authemail').value.trim(), pw = $('authpass').value;
  if (!em || pw.length < 6) { $('autherr').textContent = 'Email + password (min 6 chars) required.'; return; }
  $('autherr').textContent = '…';
  try {
    const { error } = authMode === 'login'
      ? await sb.auth.signInWithPassword({ email: em, password: pw })
      : await sb.auth.signUp({ email: em, password: pw });
    if (error) { $('autherr').textContent = error.message; return; }
    $('authmodal').classList.remove('open');
    toast(authMode === 'login' ? 'Welcome back!' : 'Account created! Check your email to confirm.');
  } catch (e) { $('autherr').textContent = 'Something went wrong — try again.'; }
};

/* ---------- init ---------- */
$('startbtn').onclick = () => openEditor(null);
$('backbtn').onclick = showHome;
showHome(); renderTemplates(); syncChips(); renderInspector(); checkEngine(); initAuth(); updateTimecode();
