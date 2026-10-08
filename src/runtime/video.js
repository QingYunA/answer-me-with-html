(() => {
  const D = JSON.parse(document.getElementById('amv-data').textContent);
  const W = 1920;
  const H = 1080;
  const T = 0.9;     // scene transition, matches TIMING.transition
  const R = 0.6;     // one step appearing
  const CAM = 0.8;   // camera move
  const root = document.documentElement;
  const stage = document.querySelector('.amv-stage');
  const camera = document.querySelector('.amv-camera');
  const overlay = document.querySelector('.amv-overlay');
  const caption = document.querySelector('.amv-caption span');
  const scenes = [...document.querySelectorAll('.amv-scene')];
  const segs = D.segments;
  // One chapter per scene (the title card is not a chapter). The strip needs its space before anything measures the viewport,
  // so the attribute goes on before section 1.
  const chapterList = segs.slice(1);
  if (chapterList.length > 1) root.setAttribute('data-chapters', '');
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = (x) => { const v = clamp(x); return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2; };
  const lerp = (a, b, p) => a + (b - a) * p;
  const STEP_SEL = '.am-tl-item, .am-lim, .am-seg, tbody tr, .am-kv-cell, .am-md > ul > li, .am-md > ol > li, .am-md > p, .am-md > blockquote, .am-callout';

  // ── 1. Fit each scene's content to the frame ──
  for (const sc of scenes) {
    const fit = sc.querySelector('.amv-fit');
    if (!fit || !fit.children.length) continue;
    const s = Math.min(1600 / fit.offsetWidth, 740 / fit.offsetHeight, 3.4);
    fit.style.transform = `scale(${s})`;
  }

  // Scene titles sit outside the camera, so they stay put when it zooms.
  const heads = scenes.map((sc) => {
    const h = sc.querySelector('.amv-scene-head');
    if (h) stage.insertBefore(h, camera.nextSibling);
    return h;
  });

  // Measure elements in stage coordinates (the camera is the identity transform here).
  const sr = stage.getBoundingClientRect();
  const k = sr.width / W;
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k };
  };

  // ── 2. Steps: group by data-step when a component sets it, else one step per row / item ──
  const items = [];   // { el, at, paths: [{ el, len }] }
  scenes.forEach((sc, i) => {
    if (i === 0) return;
    const groups = [];
    for (const block of sc.querySelectorAll('.amv-fit > *')) {
      const marked = [...block.querySelectorAll('[data-step]')];
      if (marked.length) {
        const by = new Map();
        for (const el of marked) {
          const n = Number(el.dataset.step);
          if (!by.has(n)) by.set(n, []);
          by.get(n).push(el);
        }
        [...by.keys()].sort((a, b) => a - b).forEach((n) => groups.push(by.get(n)));
      } else {
        const found = [...block.querySelectorAll(STEP_SEL)].filter((el) => !el.parentElement.closest(STEP_SEL));
        if (found.length) found.forEach((el) => groups.push([el]));
        else groups.push([block]);
      }
    }
    const beats = segs[i].beats;
    const S = groups.length;
    const B = beats.length;
    const perBeat = new Map();
    groups.forEach((g, gi) => {
      // With more beats than steps, the extra beats open the scene: steps align to the last beats.
      const b = S <= B ? gi + (B - S) : Math.floor((gi * B) / S);
      const rank = perBeat.get(b) ?? 0;
      perBeat.set(b, rank + 1);
      const beat = beats[b];
      const count = S <= B ? 1 : Math.ceil(S / B) || 1;
      const slot = Math.min(0.45, (beat.end - beat.start) / count);
      for (const el of g) {
        const paths = (el.matches('path.am-edge') ? [el] : [...el.querySelectorAll('path.am-edge')])
          .filter((p) => !p.classList.contains('am-edge--dashed'))
          .map((p) => ({ el: p, len: p.getTotalLength() }));
        items.push({ el, scene: i, at: beat.start + rank * slot, paths });
      }
    });
  });

  // ── 3. Morphs: elements with the same data-key in consecutive scenes ──
  const morphs = [];  // { scene, from, to, ghost, a, b }
  const keyed = (sc) => {
    const m = new Map();
    for (const el of sc.querySelectorAll('[data-key]')) if (!m.has(el.dataset.key)) m.set(el.dataset.key, el);
    return m;
  };
  for (let i = 2; i < scenes.length; i++) {
    const prev = keyed(scenes[i - 1]);
    for (const [key, to] of keyed(scenes[i])) {
      const from = prev.get(key);
      // Morph only like with like (SVG to SVG, HTML to HTML); otherwise the shapes do not match.
      if (!from || (from instanceof SVGElement) !== (to instanceof SVGElement)) continue;
      try {
        const ghost = makeGhost(from);
        overlay.append(ghost.node);
        morphs.push({ scene: i, from, to, ghost: ghost.node, a: ghost.place(rectOf(from)), b: ghost.place(rectOf(to)) });
      } catch {
        // Morphs are a nicety: skip an element whose measurement fails; playback is unaffected.
      }
    }
  }
  const carried = new Set(morphs.map((m) => m.to));

  function makeGhost(el) {
    const wrap = document.createElement('div');
    const host = el.closest('.am-diagram, .am-tree, .am-timeline, .am-kv, .am-limits');
    wrap.className = `amv-ghost ${host ? host.className : ''}`;
    if (el instanceof SVGGraphicsElement) {
      const bb = el.getBBox();
      const pad = 4;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
      svg.setAttribute('width', bb.width + pad * 2);
      svg.setAttribute('height', bb.height + pad * 2);
      const clone = el.cloneNode(true);
      clone.removeAttribute('style');
      svg.append(clone);
      wrap.append(svg);
      return {
        node: wrap,
        place: (r) => {
          const s = r.w / (bb.width || 1);
          return { x: r.x - pad * s, y: r.y - pad * s, s };
        },
      };
    }
    const clone = el.cloneNode(true);
    clone.removeAttribute('style');
    clone.querySelectorAll('[data-key], ul').forEach((n) => n.remove());
    const box = document.createElement(el.tagName === 'LI' ? 'ul' : 'div');
    box.className = el.tagName === 'LI' ? 'am-tree-list' : '';
    box.style.margin = '0';
    box.append(clone);
    wrap.append(box);
    wrap.style.width = `${el.offsetWidth}px`;
    const w0 = el.offsetWidth || 1;
    return { node: wrap, place: (r) => ({ x: r.x, y: r.y, s: r.w / w0 }) };
  }

  // ── 4. Camera: the element named by [name] in the narration ──
  const findKey = (sc, key) => {
    const all = [...sc.querySelectorAll('[data-key]')];
    const norm = (s) => s.replace(/[`*]/g, '').trim().toLowerCase();
    return all.find((el) => norm(el.dataset.key) === norm(key))
      ?? all.find((el) => norm(el.dataset.key).includes(norm(key)))
      ?? [...sc.querySelectorAll(`${STEP_SEL}, text`)].find((el) => norm(el.textContent).includes(norm(key)));
  };
  const IDENT = { s: 1, x: 0, y: 0 };
  // Zoom without cropping: the whole diagram must stay in the safe area between title and captions.
  const SAFE = { left: 60, right: W - 60, top: 150, bottom: H - 200 }; // leave room for captions at the bottom
  function focusCam(r, sc) {
    const fit = sc.querySelector('.amv-fit');
    const c = fit ? rectOf(fit) : { x: 0, y: 0, w: W, h: H };
    const room = Math.min((SAFE.right - SAFE.left) / c.w, (SAFE.bottom - SAFE.top) / c.h);
    const s = clamp(Math.min(0.5 * W / r.w, 0.42 * H / r.h, room, 1.4), 1, 1.4);
    const fitAxis = (want, lo, hi, a, b) => (s * (b - a) <= hi - lo ? clamp(want, lo - s * a, hi - s * b) : want);
    return {
      s,
      x: fitAxis(W / 2 - s * (r.x + r.w / 2), SAFE.left, SAFE.right, c.x, c.x + c.w),
      y: fitAxis(H * 0.5 - s * (r.y + r.h / 2), SAFE.top, SAFE.bottom, c.y, c.y + c.h),
    };
  }
  const camEvents = [];   // { t, cam, hl }
  segs.forEach((seg, i) => {
    camEvents.push({ t: seg.start, cam: IDENT, hl: null });
    seg.beats.forEach((b) => {
      const el = b.focus ? findKey(scenes[i], b.focus) : null;
      let cam = IDENT;
      if (el) cam = focusCam(rectOf(el), scenes[i]);
      camEvents.push({ t: b.start, cam, hl: el });
    });
  });
  const hlTargets = new Set(camEvents.map((e) => e.hl).filter(Boolean));

  // Scene and title fades. Titles never overlap: the old one fades out in the first half of the transition, the new one fades in in the second half.
  const show = (el, op) => {
    el.style.opacity = op;
    el.style.visibility = op > 0 ? 'visible' : 'hidden';
  };
  function drawScenes(t) {
    scenes.forEach((sc, i) => {
      const seg = segs[i];
      const next = segs[i + 1];
      const before = t < seg.start;
      const fadeIn = i === 0 ? ease(t / 0.8) : ease((t - seg.start) / T);
      const fadeOut = next ? 1 - ease((t - next.start) / T) : 1;
      show(sc, before ? 0 : Math.min(fadeIn, fadeOut));
      if (!heads[i]) return;
      const hin = ease((t - seg.start - T / 2) / (T / 2));
      const hout = next ? 1 - ease((t - next.start) / (T / 2)) : 1;
      show(heads[i], before ? 0 : Math.min(hin, hout));
    });
  }

  // Steps appear: edges draw in one stroke, other elements fade in and rise slightly.
  function drawSteps(t) {
    for (const it of items) {
      if (carried.has(it.el)) continue;
      const p = ease((t - it.at) / R);
      it.el.style.opacity = clamp((t - it.at) / 0.25);
      if (!it.paths.length) {
        it.el.style.transform = p < 1 ? `translateY(${(1 - p) * 14}px)` : '';
        continue;
      }
      for (const { el, len } of it.paths) {
        el.style.strokeDasharray = `${len}`;
        el.style.strokeDashoffset = `${len * (1 - p)}`;
        el.style.markerEnd = p < 0.97 ? 'none' : '';
      }
    }
  }

  // Morphs: during the transition a stand-in moves from the old to the new position while the real elements are hidden.
  // An element can end one morph and start the next; collect the elements to hide first, then apply, so the two do not overwrite each other.
  const morphed = [...new Set(morphs.flatMap((m) => [m.from, m.to]))];
  function drawMorphs(t) {
    const hidden = new Set();
    for (const m of morphs) {
      const s0 = segs[m.scene].start;
      const during = t >= s0 && t < s0 + T;
      m.ghost.style.display = during ? '' : 'none';
      if (during) {
        const p = ease((t - s0) / T);
        m.ghost.style.transform = `translate(${lerp(m.a.x, m.b.x, p)}px, ${lerp(m.a.y, m.b.y, p)}px) scale(${lerp(m.a.s, m.b.s, p)})`;
        hidden.add(m.from);
      }
      if (t < s0 + T) hidden.add(m.to);
      m.to.style.opacity = 1;
    }
    for (const el of morphed) el.style.visibility = hidden.has(el) ? 'hidden' : '';
  }

  // Camera and highlight: interpolate between the previous camera position and the current target.
  function drawCamera(t) {
    const ev = camEvents.findLastIndex((e) => t >= e.t);
    const e = ev >= 0 ? camEvents[ev] : null;
    const prev = ev > 0 ? camEvents[ev - 1].cam : IDENT;
    const p = e ? ease((t - e.t) / CAM) : 0;
    const to = e ? e.cam : IDENT;
    camera.style.transform = `translate(${lerp(prev.x, to.x, p)}px, ${lerp(prev.y, to.y, p)}px) scale(${lerp(prev.s, to.s, p)})`;
    for (const el of hlTargets) el.classList.toggle('amv-hl', el === e?.hl);
  }

  function drawCaption(t) {
    const cur = segs.findLastIndex((s) => t >= s.start);
    const beats = cur >= 0 ? segs[cur].beats : [];
    const b = beats.find((x) => t >= x.start && t < x.end + 0.3);
    const html = b ? b.html : '';
    if (caption.dataset.html !== html) {
      caption.innerHTML = html;
      caption.dataset.html = html;
    }
    caption.style.opacity = b ? clamp((t - b.start) / 0.2) : 0;
  }

  // ── 5. Deterministic rendering: the same time always draws the same frame ──
  function render(time) {
    const t = clamp(time, 0, D.duration);
    drawScenes(t);
    drawSteps(t);
    drawMorphs(t);
    drawCamera(t);
    drawCaption(t);
    updateUi(t);
  }

  // ── 6. Player ──
  const audio = document.getElementById('amv-audio');
  const seek = document.querySelector('.amv-seek');
  const timeEl = document.querySelector('.amv-time');
  const toggleBtn = document.querySelector('[data-amv="toggle"]');
  const bigPlay = document.querySelector('.amv-bigplay');
  const marks = document.querySelector('.amv-marks');
  const bar = document.querySelector('.amv-chapters');
  const rateBtn = document.querySelector('[data-amv="rate"]');
  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  seek.max = D.duration;

  // A tick on the track and a chip in the strip per scene; both jump to the start of the scene and keep playing.
  const chips = chapterList.map((s, i) => {
    const mark = document.createElement('i');
    mark.style.left = `${(s.start / D.duration) * 100}%`;
    mark.title = `${s.id} ${s.title} · ${fmt(s.start)}`;
    mark.addEventListener('click', () => jump(s.start));
    marks.append(mark);

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'amv-chap';
    chip.title = `${s.title} · ${fmt(s.start)}`;
    const letter = document.createElement('b');
    letter.textContent = s.id || String.fromCharCode(65 + i);
    const label = document.createElement('span');
    label.textContent = s.title;
    chip.append(letter, label);
    chip.addEventListener('click', () => jump(s.start));
    bar.append(chip);
    return chip;
  });

  let playing = false;
  let base = 0;
  let t0 = 0;
  let rate = 1;
  // The clock: the audio element when there is one, otherwise wall-clock time scaled by the playback rate.
  const now = () => (!playing ? base : audio ? audio.currentTime : base + ((performance.now() - t0) / 1000) * rate);

  function jump(t) {
    seekTo(t);
    if (!playing) play();
  }

  // The chip of the scene the picture is in, kept in view while the strip scrolls.
  let activeChip = -1;
  function markChapter(t) {
    const i = chapterList.findLastIndex((s) => t >= s.start);
    if (i === activeChip) return;
    activeChip = i;
    chips.forEach((c, k) => (k === i ? c.setAttribute('aria-current', 'true') : c.removeAttribute('aria-current')));
    const chip = chips[i];
    if (chip && bar.scrollWidth > bar.clientWidth) {
      bar.scrollTo({ left: Math.max(0, chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2), behavior: 'smooth' });
    }
  }

  // Changing the rate must not move the clock: anchor it again at the time it shows now.
  function setRate(r) {
    const at = now();
    rate = r;
    if (audio) audio.playbackRate = r;
    rateBtn.textContent = `${r}×`;
    rateBtn.setAttribute('aria-label', `${rateBtn.dataset.speed ?? 'Speed'} ${r}×`);
    if (playing) {
      base = at;
      t0 = performance.now();
    }
  }

  function updateUi(t) {
    if (document.activeElement !== seek) seek.value = t;
    timeEl.textContent = `${fmt(t)} / ${fmt(D.duration)}`;
    markChapter(t);
  }

  function play() {
    if (base >= D.duration - 0.05) base = 0;
    playing = true;
    bigPlay.hidden = true;
    toggleBtn.textContent = '❚❚';
    toggleBtn.setAttribute('aria-label', toggleBtn.dataset.pause);
    if (audio) {
      audio.currentTime = base;
      audio.play().catch(() => {});
    } else {
      t0 = performance.now();
    }
    requestAnimationFrame(tick);
  }

  function pause() {
    base = now();
    playing = false;
    audio?.pause();
    toggleBtn.textContent = '▶';
    toggleBtn.setAttribute('aria-label', toggleBtn.dataset.play);
  }

  function seekTo(x) {
    base = clamp(x, 0, D.duration);
    if (audio) audio.currentTime = base;
    t0 = performance.now();
    render(base);
  }

  function tick() {
    if (!playing) return;
    const t = now();
    if (t >= D.duration) {
      pause();
      base = D.duration;
      render(D.duration);
      return;
    }
    render(t);
    requestAnimationFrame(tick);
  }

  const toggle = () => (playing ? pause() : play());
  toggleBtn.addEventListener('click', toggle);
  bigPlay.addEventListener('click', play);
  stage.addEventListener('click', (e) => { if (e.target !== bigPlay) toggle(); });
  seek.addEventListener('input', () => seekTo(Number(seek.value)));
  rateBtn.addEventListener('click', () => setRate(RATES[(RATES.indexOf(rate) + 1) % RATES.length]));

  // ── Export: the page encodes itself (src/runtime/video-export.js) and offers the file as a download ──
  // The engine needs no help from the page behind it: the stage is pinned into the frame while it copies styles, so
  // the picture is 1920x1080 whatever the window shows. The overlay covers the scrubbing stage and the button keeps
  // its place in the controls, so a second click stops the export.
  const exportBtn = document.querySelector('[data-amv="export"]');
  const SLICE = 1_048_572;   // 1 MiB rounded to a multiple of 3, so every base64 slice stands on its own
  let exporting = false;

  const decode = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  async function runExport() {
    if (exporting) { window.__amvEnc.cancel(); return; }
    exporting = true;
    const label = exportBtn.dataset.label || 'Export';
    const overlay = document.createElement('div');
    overlay.className = 'amv-exporting';
    overlay.innerHTML = '<span><i></i></span><b></b>';
    overlay.title = label;
    overlay.addEventListener('click', () => window.__amvEnc.cancel());
    // After the viewport and before the controls: the cover hides the picture, the controls stay clickable.
    document.querySelector('.amv-viewport').after(overlay);
    window.__amv.pauseForExport();
    try {
      const started = await window.__amvEnc.start({});
      if (started.error) throw new Error(started.error);
      for (;;) {
        const p = window.__amvEnc.progress();
        const pct = Math.round((p.done / Math.max(1, p.total)) * 100);
        exportBtn.textContent = `${pct}%`;
        overlay.querySelector('b').textContent = `${label} ${pct}%`;
        overlay.querySelector('i').style.width = `${pct}%`;
        if (p.error) throw new Error(p.error);
        if (!p.running) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const size = window.__amvEnc.size();
      const parts = [];
      for (let at = 0; at < size; at += SLICE) parts.push(decode(window.__amvEnc.bytes(at, Math.min(SLICE, size - at))));
      const url = URL.createObjectURL(new Blob(parts, { type: 'video/webm' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(document.title || 'video').replace(/[\\/:*?"<>|]+/g, '-')}.webm`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      exportBtn.textContent = '✕';
      overlay.querySelector('b').textContent = String((e && e.message) || e);
      await new Promise((r) => setTimeout(r, 2500));
    } finally {
      overlay.remove();
      exportBtn.textContent = exportBtn.dataset.icon || '⤓';
      exporting = false;
      window.__amv.resumeAfterExport();
    }
  }

  if (window.__amvEnc && window.__amvEnc.supported()) exportBtn.addEventListener('click', runExport);
  else exportBtn.remove();
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ') { e.preventDefault(); toggle(); }
    if (e.key === 'ArrowRight') seekTo(now() + 5);
    if (e.key === 'ArrowLeft') seekTo(now() - 5);
  });
  audio?.addEventListener('ended', () => { pause(); base = D.duration; });

  function fitStage() {
    if (root.hasAttribute('data-export')) return;
    const vp = stage.parentElement;
    const s = Math.min(vp.clientWidth / W, vp.clientHeight / H);
    stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  }
  window.addEventListener('resize', fitStage);

  // Export: place the stage 1:1 at the top left and call render(t) frame by frame. exportMode is for the CLI, which
  // hides the controls and either screenshots the frames (ffmpeg) or drives the built-in encoder (see video-export.js).
  window.render = render;
  let resumeAt;   // undefined: no export ran; null: playback was paused already; a number: carry on there
  window.__amv = {
    duration: D.duration,
    fps: D.fps,
    exportMode() { root.setAttribute('data-export', ''); stage.style.transform = ''; },
    // The encoder poses every frame itself, so playback stops for the length of an export and carries on afterwards.
    // The button and the engine both call this; only the first call decides where playback resumes.
    pauseForExport() { if (resumeAt === undefined) resumeAt = playing ? now() : null; pause(); return resumeAt; },
    resumeAfterExport() {
      if (resumeAt === undefined || resumeAt === null) { resumeAt = undefined; return; }
      const at = resumeAt;
      resumeAt = undefined;
      seekTo(at);
      if (at < D.duration - 0.05) play();
    },
  };
  fitStage();
  setRate(rate);   // the button carries the speed on load
  // Poster: show the fully faded-in title card, but playback still starts at 0.
  render(Math.min(1, segs[0].end));
  updateUi(0);
})();
