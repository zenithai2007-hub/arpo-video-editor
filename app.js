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
  flip: false, fadeIn: 0, fadeOut: 0,
  brightness: 0, contrast: 1, saturation: 1,
  effect: 'none', textOverlay: '', textStyle: 'bold',
  voiceFx: 'none', denoise: false, viral: false,
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
  { id: 'recap', icon: '🎬', name: 'Story Recap', desc: 'Key moments recap.', prompt: 'Punchy recap: key moments only, strong hook, short captions.' },
  { id: 'podcast', icon: '🎙️', name: 'Podcast Highlights', desc: 'Best highlights.', prompt: 'Best highlights from this talking video: original voice, short captions, tight pacing.' },
  { id: 'cine', icon: '🎞️', name: 'Cinematic Short', desc: 'Dramatic look.', prompt: 'Make a cinematic short: dramatic pacing, best visuals only, warm cinematic look, hard cuts on beat.' },
  { id: 'promo', icon: '📢', name: 'Product Promo', desc: 'Energetic promo.', prompt: 'Fast product promo: clear product shots, energetic cuts, bold captions, strong CTA.' },
  { id: 'travel', icon: '✈️', name: 'Travel Vlog', desc: 'Travel montage.', prompt: 'Travel montage: best scenic moments, smooth pacing, place captions.' },
  { id: 'fitness', icon: '💪', name: 'Fitness Reel', desc: 'Workout reel.', prompt: 'High-energy fitness reel: hardest reps, fast cuts, bold captions.' },
  { id: 'food', icon: '🍔', name: 'Food Review', desc: 'Food close-ups.', prompt: 'Tasty food review: dish close-ups, quick cuts, name captions.' },
  { id: 'motivation', icon: '🔥', name: 'Motivational', desc: 'Powerful short.', prompt: 'Motivational short: strongest lines, bold key-phrase captions, cinematic.' },
];
/* ---------- views (Magic Hour style) ---------- */
function showView(v) {
  ['home','editorview'].forEach(id => { const e = $(id); if (e) e.hidden = true; });
  document.querySelectorAll('.dashview').forEach(d => d.hidden = true);
  if (v === 'home') $('home').hidden = false;
  else if (v === 'editor') $('editorview').hidden = false;
  else { const el = $(v + 'view'); if (el) el.hidden = false; }
  document.querySelectorAll('.snav').forEach(b => b.classList.toggle('on', b.dataset.v === v || (v === 'editor' && b.dataset.v === 'create')));
  if (v === 'projects') renderProjects();
  if (v === 'exports') renderExports();
  if (v === 'settings') syncSettings();
  window.scrollTo(0, 0);
}
function go(v) {
  if (v === 'create') return openEditor(null);
  if (v === 'templates') { showView('home'); setTimeout(() => { const g = $('toolgrid'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); return; }
  showView(v);
}
function showHome() { go('home'); }
function openEditor(tid) {
  if (tid) {
    const t = TEMPLATES.find(x => x.id === tid);
    if (t) { S.template = tid; $('prompttext').value = t.prompt; setStatus('Style "' + t.name + '" loaded — upload a video, then Generate AI Plan.', 'ok'); }
  }
  showView('editor');
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
  const av = document.createElement('div');
  av.className = 'toolcard';
  av.innerHTML = '<div class="tico">🎬</div><b>AI Video</b><span>Text likho — AI video banayega. Phir edit bhi karo!</span>';
  av.onclick = () => { $('aivvideo').style.display = 'none'; $('aivdl').style.display = 'none'; $('aivedit').style.display = 'none'; $('aivideomodal').classList.add('open'); };
  box.appendChild(av);
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
  S.file = f; S.fname = f.name; S.fileURL = URL.createObjectURL(f); setTimeout(()=>saveProject('Draft'), 500);
  const v = $('preview');
  v.src = S.fileURL; v.style.display = 'block'; $('nopreview').style.display = 'none';
  v.onloadedmetadata = () => {
    S.duration = v.duration; S.vw = v.videoWidth; S.vh = v.videoHeight;
    if (S.duration > 3600) { toast('Longer than 1 hour — only the first hour is usable.', true); S.duration = 3600; }
    const mb = (f.size / 1048576).toFixed(1);
    const fe = $('fileinfo'); fe.style.display = 'block';
    fe.innerHTML = '<b>' + esc(f.name) + '</b><br>Duration: ' + fmt(S.duration) + ' · ' + S.vw + '×' + S.vh + '<br>Size: ' + mb + ' MB';
    $('planbtn').disabled = false; $('exportbtn').disabled = false; const cb=$('cloudbtn'); if(cb) cb.disabled = false;
    const vb = $('viralbtn'); if (vb) vb.disabled = false;
    if (S.duration > 600) toast('Long video — export slow.');
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
function snap() { return JSON.stringify({ clips: S.clips, selected: S.selected, aspect: S.aspect, style: S.style, transition: S.transition, audioMode: S.audioMode, volume: S.volume, resolution: S.resolution, flip: S.flip, fadeIn: S.fadeIn, fadeOut: S.fadeOut, brightness: S.brightness, contrast: S.contrast, saturation: S.saturation, effect: S.effect, textOverlay: S.textOverlay, textStyle: S.textStyle, voiceFx: S.voiceFx, denoise: S.denoise, viral: S.viral }); }
function pushHistory() {
  S.history = S.history.slice(0, S.hIndex + 1);
  S.history.push(snap());
  if (S.history.length > 60) S.history.shift();
  S.hIndex = S.history.length - 1;
}
function restore(json) {
  const o = JSON.parse(json);
  Object.assign(S, { clips: o.clips, selected: o.selected, aspect: o.aspect, style: o.style, transition: o.transition, audioMode: o.audioMode, volume: o.volume, resolution: o.resolution, flip: !!o.flip, fadeIn: o.fadeIn || 0, fadeOut: o.fadeOut || 0, brightness: o.brightness || 0, contrast: o.contrast || 1, saturation: o.saturation || 1, effect: o.effect || 'none', textOverlay: o.textOverlay || '', textStyle: o.textStyle || 'bold', voiceFx: o.voiceFx || 'none', denoise: !!o.denoise, viral: !!o.viral });
  renderAll(); syncChips(); syncNewControls(); autosave();
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
  if (t <= c.start + 0.2 || t >= c.end - 0.2) { toast('Playhead clip ke andar rakho.', true); return; }
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
  if (typeof syncNewControls === 'function') syncNewControls();
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
  let f = '';
  // adjust sliders
  if (S.brightness !== 0 || S.contrast !== 1 || S.saturation !== 1)
    f += `,eq=brightness=${S.brightness}:contrast=${S.contrast}:saturation=${S.saturation}`;
  // effects
  if (S.effect === 'grayscale') f += ',hue=s=0';
  else if (S.effect === 'sepia') f += ',colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131';
  else if (S.effect === 'blur') f += ',boxblur=8:2';
  else if (S.effect === 'sharpen') f += ',unsharp=5:5:1.0:5:5:0.0';
  else if (S.effect === 'vignette') f += ',vignette=PI/4';
  // preset styles
  switch (S.style) {
    case 'cinematic': f += ',eq=contrast=1.08:saturation=0.92,colorbalance=gs=0.04:bs=-0.05'; break;
    case 'vibrant': f += ',eq=contrast=1.05:saturation=1.35'; break;
    case 'warm': f += ',eq=saturation=1.12,colorbalance=rs=0.12:gs=0.05:bs=-0.08'; break;
  }
  return f;
}
function flipFilter() { return S.flip ? ',hflip' : ''; }
function voiceFxFilter() {
  switch (S.voiceFx) {
    case 'robot': return ',vibrato=f=12:d=0.8,aecho=0.8:0.7:30:0.25';
    case 'echo': return ',aecho=0.8:0.88:80:0.35';
    case 'chipmunk': return ',asetrate=44100*1.4,aresample=44100';
    case 'deep': return ',asetrate=44100*0.7,aresample=44100';
    default: return '';
  }
}
function denoiseFilter() { return S.denoise ? ',afftdn=nf=-25' : ''; }
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
      fc.push(`[0:v]trim=start=${c.start}:end=${c.end},setpts=(PTS-STARTPTS)/${c.speed}${rotFilter(c.rotate)}${flipFilter()},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30${styleFilter()}[v${i}]`);
      if (!mute) fc.push(`[0:a]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS,atempo=${c.speed}${voiceFxFilter()}${denoiseFilter()},volume=${vols}[a${i}]`);
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
    const totalDur = durs.reduce((a, b) => a + b, 0) - (useFade ? F * (N - 1) : 0);
    S.clips.forEach((c, i) => {
      if (c.caption && haveFont) {
        const fs = Math.round(W / 16);
        capF += `,drawtext=fontfile=/font.ttf:text='${ffEsc(c.caption)}':fontsize=${fs}:fontcolor=white:borderw=${Math.max(2, Math.round(fs / 18))}:bordercolor=black:x=(w-text_w)/2:y=h-${Math.round(H / 9)}:enable='between(t,${tcur.toFixed(2)},${(tcur + durs[i] - (useFade && i < N - 1 ? F : 0)).toFixed(2)})'`;
      }
      tcur += durs[i] - (useFade && i < N - 1 ? F : 0);
    });
    // text overlay (whole video)
    if (S.textOverlay && haveFont) {
      const fs = Math.round(W / 12);
      const styles = { bold: ':fontcolor=white:borderw=3:bordercolor=black', neon: ':fontcolor=yellow:borderw=2:bordercolor=black', minimal: ':fontcolor=white' };
      capF += `,drawtext=fontfile=/font.ttf:text='${ffEsc(S.textOverlay)}':fontsize=${fs}${styles[S.textStyle] || styles.bold}:x=(w-text_w)/2:y=80`;
    }
    // VIRAL word-by-word captions (Hormozi style)
    if (S.viral && haveFont) {
      capF += viralWordFilters(S.clips, durs, W, H, useFade, F, N);
    }
    // fade in/out animation
    let animF = '';
    if (S.fadeIn > 0) animF += `,fade=t=in:st=0:d=${S.fadeIn}`;
    if (S.fadeOut > 0) animF += `,fade=t=out:st=${Math.max(0, totalDur - S.fadeOut).toFixed(2)}:d=${S.fadeOut}`;
    fc.push(capF || animF ? `[${vout}]${(capF + animF).slice(1)}[vout]` : `[${vout}]copy[vout]`);
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
$('thumbclose').onclick = () => $('thumbmodal').classList.remove('open');
$('thumbmodal').addEventListener('click', e => { if (e.target.id === 'thumbmodal') $('thumbmodal').classList.remove('open'); });
$('thumbgen').onclick = () => {
  const p = $('thumbprompt').value.trim();
  if (!p) { toast('Describe your thumbnail first.', true); return; }
  const wh = thumbRatio === '16:9' ? [1280, 720] : thumbRatio === '9:16' ? [720, 1280] : [1024, 1024];
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(p) +
    '?width=' + wh[0] + '&height=' + wh[1] + '&nologo=true&seed=' + Math.floor(Math.random() * 999999);
  $('thumbimg').style.display = 'none'; $('thumbdl').style.display = 'none'; $('thumbrm').style.display = 'none';
  $('thumbloading').style.display = 'block';
  const img = $('thumbimg');
  img.onload = () => {
    $('thumbloading').style.display = 'none'; img.style.display = '';
    const dl = $('thumbdl'); dl.style.display = ''; dl.href = url;
    $('thumbrm').style.display = '';
    toast('Thumbnail ready!');
  };
  img.onerror = () => { $('thumbloading').style.display = 'none'; toast('Generation failed — try again.', true); };
  img.src = url;
};
/* background removal (free AI, in-browser) */
let bgRmLoading = null;
$('thumbrm').onclick = async () => {
  const img = $('thumbimg');
  if (!img.src || bgRmLoading) return;
  bgRmLoading = (async () => {
    try {
      toast('🪄 Removing background… (first time downloads AI model ~40MB)');
      $('thumbloading').style.display = 'block'; $('thumbloading').textContent = '🪄 AI removing background…';
      const { removeBackground } = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm');
      const blob = await (await fetch(img.src)).blob();
      const out = await removeBackground(blob);
      const url = URL.createObjectURL(out);
      img.src = url;
      $('thumbdl').href = url;
      $('thumbloading').style.display = 'none';
      $('thumbrm').style.display = 'none';
      toast('✅ Background removed!');
    } catch (e) {  $('thumbloading').style.display = 'none'; toast('BG remove failed: ' + e.message, true); }
    bgRmLoading = null;
  })();
  return bgRmLoading;
};

/* ---------- AI video (text-to-video, server key) ---------- */
let aivStyle = 'cinematic', aivDur = 5, aivRatio = '16:9', aivBlobURL = null, thumbRatio = '16:9';
function chipPick(rowId, cb) {
  $$('#' + rowId + ' .chip').forEach(ch => ch.onclick = () => {
    $$('#' + rowId + ' .chip').forEach(x => x.classList.toggle('on', x === ch));
    cb(ch.dataset.v);
  });
}
chipPick('aivstyle', v => aivStyle = v);
chipPick('aivdur', v => aivDur = +v);
chipPick('aivratio', v => aivRatio = v);
chipPick('thumbratio', v => thumbRatio = v);
$('aivclose').onclick = () => $('aivideomodal').classList.remove('open');
$('aivideomodal').addEventListener('click', e => { if (e.target.id === 'aivideomodal') $('aivideomodal').classList.remove('open'); });
const AIV_STYLE_PRE = {
  cinematic: 'cinematic film still, dramatic lighting, film grain, ',
  anime: 'anime style, vibrant colors, detailed, ',
  nature: 'nature documentary footage, stunning, ',
  hyperreal: 'hyperrealistic, ultra detailed, 8k, ',
};
$('aivgen').onclick = async () => {
  const p = $('aivprompt').value.trim();
  if (!p) { toast('Describe your video first.', true); return; }
  $('aivvideo').style.display = 'none'; $('aivdl').style.display = 'none'; $('aivedit').style.display = 'none';
  $('aivloading').style.display = 'block';
  $('aivgen').disabled = true;
  try {
    const r = await fetch('/api/aivideo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: (AIV_STYLE_PRE[aivStyle] || '') + p, duration: aivDur, aspectRatio: aivRatio }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.message || ('HTTP ' + r.status));
    }
    const blob = await r.blob();
    if (aivBlobURL) URL.revokeObjectURL(aivBlobURL);
    aivBlobURL = URL.createObjectURL(blob);
    const v = $('aivvideo'); v.src = aivBlobURL; v.style.display = '';
    const dl = $('aivdl'); dl.style.display = ''; dl.href = aivBlobURL;
    $('aivedit').style.display = '';
    toast('AI video ready!');
  } catch (e) {
    
    toast('Failed: ' + e.message, true);
  }
  $('aivloading').style.display = 'none';
  $('aivgen').disabled = false;
};
$('aivedit').onclick = async () => {
  if (!aivBlobURL) return;
  try {
    const blob = await (await fetch(aivBlobURL)).blob();
    const file = new File([blob], 'arpo-ai-video.mp4', { type: 'video/mp4' });
    $('aivideomodal').classList.remove('open');
    openEditor(null);
    setStatus('AI video loaded — describe your edit, then Generate AI Plan.', 'ok');
    loadFile(file);
  } catch (e) { toast('Could not load into editor.', true); }
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
    if (!sb._user) { $('loginbtn').style.display = ''; const sb2 = $('signupbtn'); if (sb2) sb2.style.display = ''; }
  } catch (e) { /* auth unavailable — app works without it */ }
}
function setUser(u) {
  sb._user = u || null;
  $('loginbtn').style.display = u ? 'none' : '';
  const sg = $('signupbtn'); if (sg) sg.style.display = u ? 'none' : '';
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
  $('authforgot').style.display = authMode === 'login' ? '' : 'none';
  $('autherr').textContent = '';
}
$('loginbtn').onclick = () => { authMode = 'login'; drawAuth(); $('authmodal').classList.add('open'); };
$('signupbtn').onclick = () => { authMode = 'signup'; drawAuth(); $('authmodal').classList.add('open'); };
$('authcancel').onclick = () => $('authmodal').classList.remove('open');
$('authmodal').addEventListener('click', e => { if (e.target.id === 'authmodal') $('authmodal').classList.remove('open'); });
$('authswitch').onclick = () => { authMode = authMode === 'login' ? 'signup' : 'login'; drawAuth(); };
$('authforgot').onclick = async () => {
  if (!sb) return;
  const em = $('authemail').value.trim();
  if (!em) { $('autherr').textContent = 'Enter your email first, then click Forgot password.'; return; }
  $('autherr').textContent = '…';
  try {
    const { error } = await sb.auth.resetPasswordForEmail(em);
    $('autherr').textContent = error ? error.message : 'Reset link sent! Check your email.';
  } catch (e) { $('autherr').textContent = 'Something went wrong — try again.'; }
};
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

/* ---------- quick commands: bolo kya karna hai, arPo kar dega ---------- */
function parseTime(str) {
  // "1:30" -> 90, "90" -> 90, "1m30s" -> 90
  str = String(str).trim().toLowerCase();
  let m = str.match(/(\d+):(\d+(?:\.\d+)?)/);
  if (m) return +m[1] * 60 + +m[2];
  m = str.match(/(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?/);
  if (m && (m[1] || m[2])) return (+m[1] || 0) * 60 + (+m[2] || 0);
  m = str.match(/(\d+(?:\.\d+)?)/);
  return m ? +m[1] : null;
}
function cmdStatus(msg, ok) {
  const el = $('cmdstatus');
  el.textContent = msg;
  el.style.color = ok === false ? '#d33' : ok ? '#1a7f37' : 'var(--muted)';
}
function runCommand(raw) {
  const cmd = (raw || '').trim().toLowerCase();
  if (!cmd) { cmdStatus('Kuch likho — e.g. "cut first 10 seconds"', false); return; }
  if (!S.file || !S.clips.length) { cmdStatus('Pehle video upload karo!', false); return; }
  const D = S.duration;
  const done = msg => { pushHistory(); renderAll(); syncChips(); autosave(); cmdStatus('✅ ' + msg, true); };

  // --- cut first N seconds ---
  let m = cmd.match(/(?:cut|remove|delete|trim)\s+(?:the\s+)?first\s+([\d:.m\s]+?)(?:\s*seconds?|\s*secs?)?$/);
  if (m) {
    const n = parseTime(m[1]);
    if (n && n < D) {
      S.clips.forEach(c => { c.start = Math.min(c.start + n, c.end - 0.2); });
      S.clips = S.clips.filter(c => c.end > c.start);
      return done(`First ${n}s cut kar diye.`);
    }
  }
  // --- cut last N seconds ---
  m = cmd.match(/(?:cut|remove|delete|trim)\s+(?:the\s+)?last\s+([\d:.m\s]+?)(?:\s*seconds?|\s*secs?)?$/);
  if (m) {
    const n = parseTime(m[1]);
    if (n && n < D) {
      S.clips.forEach(c => { c.end = Math.max(c.end - n, c.start + 0.2); });
      S.clips = S.clips.filter(c => c.end > c.start);
      return done(`Last ${n}s cut kar diye.`);
    }
  }
  // --- cut/remove from X to Y ---
  m = cmd.match(/(?:cut|remove|delete)\s+(?:from\s+)?([\d:.m\s]+?)\s+(?:to|-|–)\s+([\d:.m\s]+?)(?:\s*seconds?)?$/);
  if (m) {
    const a = parseTime(m[1]), b = parseTime(m[2]);
    if (a != null && b != null && a < b) {
      const out = [];
      S.clips.forEach(c => {
        if (c.end <= a || c.start >= b) { out.push(c); return; }
        if (c.start < a) out.push(Object.assign({}, c, { id: ++clipSeq, end: a }));
        if (c.end > b) out.push(Object.assign({}, c, { id: ++clipSeq, start: b }));
      });
      S.clips = out.filter(c => c.end > c.start + 0.1);
      S.selected = S.clips.length ? S.clips[0].id : null;
      return done(`${a}s se ${b}s tak ka part hata diya.`);
    }
  }
  // --- keep only X to Y ---
  m = cmd.match(/(?:keep|only)\s+(?:only\s+)?([\d:.m\s]+?)\s+(?:to|-|–)\s+([\d:.m\s]+?)(?:\s*seconds?)?$/);
  if (m) {
    const a = parseTime(m[1]), b = parseTime(m[2]);
    if (a != null && b != null && a < b) {
      const nc = newClip(Math.min(a, D - 0.2), Math.min(b, D), '');
      S.clips = [nc]; S.selected = nc.id;
      return done(`Sirf ${a}s–${b}s rakha, baaki hata diya.`);
    }
  }
  // --- add captions ---
  if (/caption|subtitle/.test(cmd)) {
    const words = ['Hook', 'Best moment', 'Watch this', 'Key point', 'Highlight', 'Don’t miss'];
    S.clips.forEach((c, i) => { if (!c.caption) c.caption = words[i % words.length]; });
    return done('Captions laga diye! Edit karne ke liye clip select karo.');
  }
  // --- aspect ratio ---
  if (/vertical|9:16|9\s*:\s*16|reel|tiktok|shorts|portrait/.test(cmd)) { S.aspect = '9:16'; return done('Vertical (9:16) kar diya.'); }
  if (/square|1:1|1\s*:\s*1|instagram post/.test(cmd)) { S.aspect = '1:1'; return done('Square (1:1) kar diya.'); }
  if (/wide|16:9|16\s*:\s*16|youtube|landscape|horizontal/.test(cmd)) { S.aspect = '16:9'; return done('Wide (16:9) kar diya.'); }
  // --- speed ---
  m = cmd.match(/(?:speed\s*(?:up)?\s*|faster\s*)(\d+(?:\.\d+)?)\s*x/);
  if (m) {
    const v = +m[1];
    const allowed = [0.5, 1, 1.5, 2];
    const best = allowed.reduce((p, c) => Math.abs(c - v) < Math.abs(p - v) ? c : p);
    S.clips.forEach(c => c.speed = best);
    return done(`Speed ${best}× kar di.`);
  }
  if (/slow\s*(?:down|motion)?/.test(cmd)) { S.clips.forEach(c => c.speed = 0.5); return done('Slow motion (0.5×) kar diya.'); }
  if (/normal speed|1x/.test(cmd)) { S.clips.forEach(c => c.speed = 1); return done('Speed normal kar di.'); }
  // --- mute / audio ---
  if (/mute|remove audio|no sound|silent/.test(cmd)) { S.audioMode = 'mute'; return done('Audio mute kar diya.'); }
  if (/unmute|keep audio|keep voice|restore audio/.test(cmd)) { S.audioMode = 'keep'; return done('Audio wapas on kar diya.'); }
  // --- split ---
  m = cmd.match(/split\s+(?:at\s+)?([\d:.m\s]+?)(?:\s*seconds?)?$/);
  if (m) {
    const t = parseTime(m[1]);
    const c = S.clips.find(x => t > x.start + 0.2 && t < x.end - 0.2);
    if (c && t != null) {
      const i = S.clips.indexOf(c);
      const a = newClip(c.start, +t.toFixed(1), c.caption); a.speed = c.speed; a.rotate = c.rotate;
      const b = newClip(+t.toFixed(1), c.end, ''); b.speed = c.speed; b.rotate = c.rotate;
      S.clips.splice(i, 1, a, b); S.selected = b.id;
      return done(`${t}s par split kar diya.`);
    }
    return cmdStatus('Us time par koi clip nahi mili.', false);
  }
  // --- rotate ---
  if (/rotate/.test(cmd)) {
    const c = getSel();
    if (c) { c.rotate = (c.rotate + 90) % 360; return done('Clip rotate kar di (' + c.rotate + '°).'); }
  }
  // --- mirror/flip ---
  if (/mirror|flip/.test(cmd)) { S.flip = !S.flip; syncNewControls(); return done(S.flip ? '🪞 Mirror ON!' : 'Mirror OFF'); }
  // --- fade ---
  m = cmd.match(/fade\s*in\s*([\d.]+)?/);
  if (m) { S.fadeIn = +(m[1] || 1); syncNewControls(); return done(`Fade in (${S.fadeIn}s) laga diya.`); }
  m = cmd.match(/fade\s*out\s*([\d.]+)?/);
  if (m) { S.fadeOut = +(m[1] || 1); syncNewControls(); return done(`Fade out (${S.fadeOut}s) laga diya.`); }
  // --- effects ---
  if (/black and white|grayscale|b&w/.test(cmd)) { S.effect = 'grayscale'; syncNewControls(); return done('Black & white effect!'); }
  if (/sepia/.test(cmd)) { S.effect = 'sepia'; syncNewControls(); return done('Sepia effect!'); }
  if (/blur/.test(cmd)) { S.effect = 'blur'; syncNewControls(); return done('Blur effect!'); }
  if (/(sharpen|sharp)/.test(cmd)) { S.effect = 'sharpen'; syncNewControls(); return done('Sharpen effect!'); }
  if (/vignette/.test(cmd)) { S.effect = 'vignette'; syncNewControls(); return done('Vignette effect!'); }
  if (/remove effect|no effect|clear effect/.test(cmd)) { S.effect = 'none'; syncNewControls(); return done('Effect hata diya.'); }
  // --- text overlay ---
  m = cmd.match(/(?:add text|text)\s+["']?(.+?)["']?$/);
  if (m && m[1].length > 1) { S.textOverlay = m[1].slice(0, 80); syncNewControls(); return done(`Text lagaya: "${S.textOverlay}"`); }
  // --- voice effects ---
  if (/robot voice/.test(cmd)) { S.voiceFx = 'robot'; syncNewControls(); return done('🤖 Robot voice!'); }
  if (/echo/.test(cmd)) { S.voiceFx = 'echo'; syncNewControls(); return done('🔊 Echo effect!'); }
  if (/chipmunk/.test(cmd)) { S.voiceFx = 'chipmunk'; syncNewControls(); return done('🐿️ Chipmunk voice!'); }
  if (/deep voice/.test(cmd)) { S.voiceFx = 'deep'; syncNewControls(); return done('🎩 Deep voice!'); }
  if (/normal voice|remove voice effect/.test(cmd)) { S.voiceFx = 'none'; syncNewControls(); return done('Voice normal.'); }
  if (/noise reduction|remove noise|clean audio/.test(cmd)) { S.denoise = true; syncNewControls(); return done('🔇 Noise reduction ON!'); }
  if (/viral|make it viral/.test(cmd)) { $('viralbtn').click(); return; }
  cmdStatus('Samajh nahi aaya — try: "cut first 10 seconds", "add captions", "make it vertical"', false);
}
$('cmdbtn').onclick = () => runCommand($('cmdinput').value);
$('cmdinput').addEventListener('keydown', e => { if (e.key === 'Enter') runCommand($('cmdinput').value); });
$$('#cmdexamples .chip').forEach(ch => ch.onclick = () => { $('cmdinput').value = ch.dataset.cmd; runCommand(ch.dataset.cmd); });

/* ---------- new controls: effects, adjust, animation, text ---------- */
function syncNewControls() {
  $$('#effectrow .chip').forEach(ch => ch.classList.toggle('on', ch.dataset.v === S.effect));
  $$('#textstylerow .chip').forEach(ch => ch.classList.toggle('on', ch.dataset.v === S.textStyle));
  $$('#voicefxrow .chip').forEach(ch => ch.classList.toggle('on', ch.dataset.v === S.voiceFx));
  $('denoisebtn').textContent = S.denoise ? 'ON ✓' : 'OFF';
  $('denoisebtn').classList.toggle('on', S.denoise);
  $('adjbright').value = S.brightness; $('adjbrightv').textContent = S.brightness;
  $('adjcontrast').value = S.contrast; $('adjcontrastv').textContent = S.contrast;
  $('adjsat').value = S.saturation; $('adjsatv').textContent = S.saturation;
  $('fadein').value = S.fadeIn; $('fadeout').value = S.fadeOut;
  $('textoverlay').value = S.textOverlay || '';
  $('flipbtn').classList.toggle('on', S.flip);
}
$$('#effectrow .chip').forEach(ch => ch.onclick = () => { S.effect = ch.dataset.v; pushHistory(); syncNewControls(); autosave(); });
$$('#textstylerow .chip').forEach(ch => ch.onclick = () => { S.textStyle = ch.dataset.v; pushHistory(); syncNewControls(); autosave(); });
$$('#voicefxrow .chip').forEach(ch => ch.onclick = () => { S.voiceFx = ch.dataset.v; pushHistory(); syncNewControls(); autosave(); toast(ch.dataset.v === 'none' ? 'Voice normal' : '🎙️ Voice effect: ' + ch.textContent.trim()); });
$('denoisebtn').onclick = () => { S.denoise = !S.denoise; pushHistory(); syncNewControls(); autosave(); toast(S.denoise ? '🔇 Noise reduction ON' : 'Noise reduction OFF'); };
$('adjbright').oninput = e => { S.brightness = +e.target.value; $('adjbrightv').textContent = S.brightness; autosaveLight(); };
$('adjcontrast').oninput = e => { S.contrast = +e.target.value; $('adjcontrastv').textContent = S.contrast; autosaveLight(); };
$('adjsat').oninput = e => { S.saturation = +e.target.value; $('adjsatv').textContent = S.saturation; autosaveLight(); };
$('adjbright').onchange = () => pushHistory(); $('adjcontrast').onchange = () => pushHistory(); $('adjsat').onchange = () => pushHistory();
$('fadein').onchange = e => { S.fadeIn = Math.max(0, +e.target.value || 0); pushHistory(); autosave(); };
$('fadeout').onchange = e => { S.fadeOut = Math.max(0, +e.target.value || 0); pushHistory(); autosave(); };
$('flipbtn').onclick = () => { S.flip = !S.flip; pushHistory(); syncNewControls(); autosave(); toast(S.flip ? '🪞 Mirrored!' : 'Mirror off'); };
$('textoverlay').oninput = e => { S.textOverlay = e.target.value.slice(0, 80); autosaveLight(); };
$('textoverlay').onchange = () => pushHistory();

/* ---------- VIRAL MODE: one click → viral short ---------- */
$('viralbtn').onclick = () => {
  if (!S.file || !S.clips.length) { toast('Pehle video upload karo!', true); return; }
  S.aspect = '9:16'; S.style = 'vibrant'; S.viral = true;
  // punchy captions if missing
  const viralWords = [['STOP','scrolling','NOW'],['This','will','BLOW','your mind'],['Watch','till','the','END'],['You','WONT','believe','this'],['The','SECRET','is','out'],['This','changes','EVERYTHING']];
  S.clips.forEach((c, i) => {
    if (!c.caption) c.caption = viralWords[i % viralWords.length].join(' ');
  });
  pushHistory(); renderAll(); syncChips();
  toast('🔥 VIRAL MODE ON! Export karo — word-by-word captions ke saath!');
};
function viralWordFilters(clips, durs, W, H, useFade, F, N) {
  // Hormozi-style: one BIG word at a time, centered, popping
  let f = '', tcur = 0;
  const fs = Math.round(W / 8);
  clips.forEach((c, i) => {
    const words = (c.caption || 'Watch this').split(/\s+/).filter(Boolean);
    const cdur = durs[i] - (useFade && i < N - 1 ? F : 0);
    const wdur = cdur / Math.max(1, words.length);
    words.forEach((w, wi) => {
      const ws = tcur + wi * wdur, we = ws + wdur;
      // pop scale animation via fontsize trick: use 2 drawtexts (shadow + main)
      f += `,drawtext=fontfile=/font.ttf:text='${ffEsc(w.toUpperCase())}':fontsize=${fs}:fontcolor=#ffdd00:borderw=${Math.max(3, Math.round(fs/14))}:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2-40:enable='between(t,${ws.toFixed(2)},${we.toFixed(2)})'`;
    });
    tcur += durs[i] - (useFade && i < N - 1 ? F : 0);
  });
  return f;
}
$('startbtn').onclick = () => openEditor(null);
$('backbtn').onclick = () => go('home');
/* ---------- dashboard: sidebar, projects, exports, cloud render ---------- */
document.querySelectorAll('.snav').forEach(b => b.onclick = () => go(b.dataset.v));
document.querySelectorAll('[data-v]').forEach(b => { if (!b.classList.contains('snav')) b.onclick = () => go(b.dataset.v); });
function lsGet(k, d) { try { return JSON.parse(localStorage.getItem(k) || JSON.stringify(d)); } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function saveProject(status) {
  const ps = lsGet('arpo_projects', []);
  ps.unshift({ name: ($('projname') && $('projname').value) || 'Untitled', at: Date.now(), status: status || 'Draft', dur: S.duration || 0, aspect: S.aspect, clips: (S.clips || []).length });
  lsSet('arpo_projects', ps.slice(0, 60));
}
function saveExport(e) {
  const xs = lsGet('arpo_exports', []);
  xs.unshift({ ...e, at: Date.now() });
  lsSet('arpo_exports', xs.slice(0, 60));
}
function renderProjects() {
  const q = ($('projsearch').value || '').toLowerCase(), f = $('projfilter').value;
  const ps = lsGet('arpo_projects', []).filter(p => (!q || p.name.toLowerCase().includes(q)) && (!f || p.status === f));
  const g = $('projgrid'); g.innerHTML = '';
  $('projempty').style.display = ps.length ? 'none' : '';
  const stc = { Draft: 'st-draft', Completed: 'st-ok', Processing: 'st-proc', Failed: 'st-fail', Rendering: 'st-proc' };
  ps.forEach(p => {
    const d = document.createElement('div'); d.className = 'pcard';
    d.innerHTML = '<b>' + esc(p.name) + '</b><span class="pmeta">' + new Date(p.at).toLocaleDateString() + ' · ' + (p.dur ? p.dur.toFixed(0) + 's' : '—') + ' · ' + p.aspect + '</span><span class="pstat ' + (stc[p.status] || 'st-draft') + '">' + p.status + '</span>';
    const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = 'Open in editor'; b.onclick = () => openEditor(null);
    d.appendChild(b); g.appendChild(d);
  });
}
function renderExports() {
  const xs = lsGet('arpo_exports', []);
  const g = $('expgrid'); g.innerHTML = '';
  $('expempty').style.display = xs.length ? 'none' : '';
  xs.forEach(x => {
    const d = document.createElement('div'); d.className = 'pcard';
    d.innerHTML = '<b>' + esc(x.name) + '</b><span class="pmeta">' + new Date(x.at).toLocaleString() + ' · ' + x.kind + (x.size ? ' · ' + (x.size / 1024).toFixed(0) + ' KB' : '') + '</span>';
    const a = document.createElement('a'); a.className = 'btn sm primary'; a.textContent = '⬇ Download'; a.href = x.url; a.target = '_blank'; a.rel = 'noopener';
    d.appendChild(a); g.appendChild(d);
  });
}
function syncSettings() { const e = $('setengine'); if (e) e.innerHTML = $('aiengine').innerHTML + ' <small>(see ⚙ AI Engine)</small>'; }
$('projsearch').oninput = renderProjects; $('projfilter').onchange = renderProjects;
function clipsToSrt(clips) {
  const t = s => { s = Math.max(0, s); const h = String(Math.floor(s / 3600)).padStart(2, '0'), m = String(Math.floor(s % 3600 / 60)).padStart(2, '0'), sec = String(Math.floor(s % 60)).padStart(2, '0'), ms = String(Math.floor((s % 1) * 1000)).padStart(3, '0'); return h + ':' + m + ':' + sec + ',' + ms; };
  return clips.filter(c => c.caption).map((c, i) => (i + 1) + '\n' + t(c.start) + ' --> ' + t(c.end) + '\n' + c.caption + '\n').join('\n');
}
function buildRenderOps() {
  const clips = S.clips.filter(c => c.end > c.start);
  const speeds = [...new Set(clips.map(c => c.speed || 1))];
  const uniformSpeed = speeds.length === 1 ? speeds[0] : 1;
  return {
    cuts: clips.map(c => ({ start: +c.start.toFixed(2), end: +c.end.toFixed(2) })),
    aspect: S.aspect, speed: uniformSpeed,
    mute: S.audioMode === 'mute',
    captionsSrt: clipsToSrt(clips) || '',
    _notes: speeds.length > 1 ? 'per-clip speed varied — used 1x in cloud beta' : '',
  };
}
async function tmpUploadBrowser(file) {
  const fd = new FormData(); fd.append('file', file, file.name);
  const r = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd });
  const j = await r.json();
  if (j.status !== 'success' || !j.data || !j.data.url) throw new Error('cloud upload failed');
  return j.data.url;
}
async function cloudRender() {
  if (!S.file) { toast('Pehle video upload karo', true); return; }
  const btn = $('cloudbtn'); btn.disabled = true;
  const cs = $('cloudstatus');
  const stage = t => { cs.innerHTML = t ? '<div class="cstage">☁ <b>' + t + '</b><br><small>Real FFmpeg on ARPO cloud — no fake progress, stages only.</small></div>' : ''; };
  try {
    stage('Uploading video to cloud… (1/3)');
    const pageUrl = await tmpUploadBrowser(S.file);
    stage('Rendering on ARPO cloud — real FFmpeg… (2/3)<br><small>Cuts · aspect · captions · speed. ~30-60s for short clips.</small>');
    const ops = buildRenderOps();
    const r = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputUrl: pageUrl, filename: (($('projname').value || 'arpo') + '').replace(/[^\w\-]+/g, '-').slice(0, 40), ops }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'render failed');
    stage('');
    cs.innerHTML = '<div class="cresult">✅ <b>Cloud render ready!</b> ' + (j.sizeBytes / 1024).toFixed(0) + ' KB'
      + (j.captionsBurned ? ' · captions burned' : '') + (ops._notes ? '<br><small>⚠ ' + ops._notes + '</small>' : '')
      + '<br><video src="' + j.previewUrl + '" controls playsinline style="max-width:100%;border-radius:10px;margin:8px 0"></video><br>'
      + '<a class="btn primary sm" href="' + j.previewUrl + '" target="_blank" rel="noopener" download="arpo-cloud.mp4">⬇ Download MP4</a> '
      + '<a class="btn sm ghost" href="' + j.url + '" target="_blank" rel="noopener">Open file page</a>'
      + '<br><small class="cnote">Preview links expire — download soon.</small></div>';
    saveExport({ name: ($('projname').value || 'Untitled'), url: j.previewUrl, page: j.url, kind: 'cloud', size: j.sizeBytes });
    saveProject('Completed');
    toast('☁ Cloud render complete!');
  } catch (e) { stage(''); toast('Cloud render: ' + e.message, true); saveProject('Failed'); }
  btn.disabled = false;
}
$('cloudbtn').onclick = cloudRender;
/* demo handoff from landing */
function idbGetDemo() {
  return new Promise(res => {
    try {
      const q = indexedDB.open('arpo', 1);
      q.onsuccess = () => {
        try {
          const tx = q.result.transaction('demo', 'readonly');
          const g = tx.objectStore('demo').get('video');
          g.onsuccess = () => res(g.result || null); g.onerror = () => res(null);
        } catch (e) { res(null); }
      };
      q.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function handleDemoHash() {
  if (location.hash !== '#demo') return;
  history.replaceState(null, '', 'app.html');
  openEditor(null);
  try {
    const p = sessionStorage.getItem('arpo-demo-prompt');
    if (p) $('prompttext').value = p;
    const blob = await idbGetDemo();
    if (blob) {
      const f = new File([blob], blob.name || 'demo-video.mp4', { type: blob.type || 'video/mp4' });
      loadFile(f);
      toast('Demo video loaded — Generate AI Plan dabao!');
    } else setStatus('Video dobara select karo (browser security), prompt ready hai.', '');
  } catch (e) {}
}
showHome(); handleDemoHash(); renderTemplates(); syncChips(); renderInspector(); checkEngine(); initAuth(); updateTimecode();
