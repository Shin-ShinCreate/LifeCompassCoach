// 音まわり：環境音BGMの自動生成（Web Audio API）、ベル、音声クリップ再生

const Sound = (() => {
  let ctx = null;
  let master = null;      // BGM全体の音量
  let duck = null;        // 音声再生中にBGMを少し下げる
  let current = null;     // { stop(fadeSec) }
  let bgmVolume = 0.5;

  // iPhone：Web Audio はマナーモードで消音されるため、「再生用の音」として扱わせる
  let keepAlive = null;
  function playbackSession() {
    if (navigator.audioSession) {        // iOS 17 以降
      try { navigator.audioSession.type = 'playback'; } catch (e) {}
      return;
    }
    // 古い iOS：無音の <audio> を流しておくと、Web Audio もマナーモード中に鳴る
    if (keepAlive || !/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) || !('ontouchend' in document)) return;
    const rate = 8000, len = rate / 2, buf = new DataView(new ArrayBuffer(44 + len * 2));
    const str = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); buf.setUint32(4, 36 + len * 2, true); str(8, 'WAVEfmt ');
    buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 1, true);
    buf.setUint32(24, rate, true); buf.setUint32(28, rate * 2, true); buf.setUint16(32, 2, true);
    buf.setUint16(34, 16, true); str(36, 'data'); buf.setUint32(40, len * 2, true);
    keepAlive = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
    keepAlive.loop = true;
    keepAlive.setAttribute('playsinline', '');
    keepAlive.play().catch(() => { keepAlive = null; });
  }

  function ensure() {
    playbackSession();
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      duck = ctx.createGain();
      master = ctx.createGain();
      master.gain.value = 0;
      master.connect(duck).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---- ノイズ素材 ----
  function noiseBuffer(kind, seconds = 4) {
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'pink') {
          b0 = 0.99765 * b0 + w * 0.0990460;
          b1 = 0.96300 * b1 + w * 0.2965164;
          b2 = 0.57000 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
        } else if (kind === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.2;
        } else {
          d[i] = w * 0.5;
        }
      }
    }
    return buf;
  }

  function loopNoise(kind) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(kind);
    src.loop = true;
    src.start();
    return src;
  }

  function lfo(freq, depth, target) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return o;
  }

  // ---- 各BGM ----
  const generators = {
    rain(out) {
      const nodes = [];
      const hiss = loopNoise('pink');
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 500;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g1 = ctx.createGain(); g1.gain.value = 0.55;
      hiss.connect(hp).connect(lp).connect(g1).connect(out);
      const rumble = loopNoise('brown');
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 500;
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      rumble.connect(lp2).connect(g2).connect(out);
      nodes.push(hiss, rumble);
      // 雨粒
      const dropBuf = noiseBuffer('white', 0.05);
      const timer = setInterval(() => {
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const s = ctx.createBufferSource(); s.buffer = dropBuf;
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
          bp.frequency.value = 1800 + Math.random() * 3500; bp.Q.value = 6;
          const g = ctx.createGain();
          const t = ctx.currentTime + Math.random() * 0.15;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.25 * Math.random() + 0.05, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
          s.connect(bp).connect(g).connect(out);
          s.start(t); s.stop(t + 0.06);
        }
      }, 140);
      return () => { clearInterval(timer); nodes.forEach(n => n.stop()); };
    },

    waves(out) {
      const src = loopNoise('brown');
      const src2 = loopNoise('pink');
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0.35;
      const mix2 = ctx.createGain(); mix2.gain.value = 0.25;
      src.connect(lp); src2.connect(mix2).connect(lp);
      lp.connect(g).connect(out);
      // 寄せては返す：フィルタと音量をゆっくり揺らす
      const o1 = lfo(0.075, 450, lp.frequency);
      const o2 = lfo(0.075, 0.3, g.gain);
      return () => [src, src2, o1, o2].forEach(n => n.stop());
    },

    space(out) {
      const nodes = [];
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.5;
      const pad = ctx.createGain(); pad.gain.value = 0.09;
      // やわらかな残響の代わりに短いディレイを重ねる
      const delay = ctx.createDelay(2); delay.delayTime.value = 0.9;
      const fb = ctx.createGain(); fb.gain.value = 0.45;
      delay.connect(fb).connect(delay);
      lp.connect(pad);
      pad.connect(out);
      pad.connect(delay); delay.connect(out);
      const notes = [110, 164.81, 220, 277.18, 329.63];
      notes.forEach((f, i) => {
        [-3, 3].forEach(det => {
          const o = ctx.createOscillator();
          o.type = i < 2 ? 'sine' : 'triangle';
          o.frequency.value = f; o.detune.value = det;
          const g = ctx.createGain(); g.gain.value = i < 2 ? 0.5 : 0.18;
          o.connect(g).connect(lp); o.start();
          nodes.push(o);
          nodes.push(lfo(0.03 + Math.random() * 0.05, g.gain.value * 0.6, g.gain));
        });
      });
      nodes.push(lfo(0.02, 400, lp.frequency));
      // 遠くの風
      const air = loopNoise('pink');
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8;
      const ag = ctx.createGain(); ag.gain.value = 0.05;
      air.connect(bp).connect(ag).connect(out);
      nodes.push(air, lfo(0.05, 500, bp.frequency));
      return () => nodes.forEach(n => n.stop());
    },
  };

  function fileGenerator(url) {
    return (out) => {
      const el = new Audio(url);
      el.loop = true;
      el.crossOrigin = 'anonymous';
      const src = ctx.createMediaElementSource(el);
      src.connect(out);
      el.play().catch(() => {});
      return () => { el.pause(); el.src = ''; };
    };
  }

  function startBgm(kind, volume, fileUrl) {
    stopBgm(0.4);
    if (!kind || kind === 'none') return;
    ensure();
    bgmVolume = volume;
    const bus = ctx.createGain();
    bus.connect(master);
    const gen = fileUrl ? fileGenerator(fileUrl) : generators[kind];
    if (!gen) return;
    const stopper = gen(bus);
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(bgmVolume, t + 2.5);
    current = {
      stop(fade) {
        const now = ctx.currentTime;
        bus.gain.setValueAtTime(1, now);
        bus.gain.linearRampToValueAtTime(0, now + fade);
        setTimeout(() => { try { stopper(); } catch (e) {} bus.disconnect(); }, fade * 1000 + 100);
      },
    };
  }

  function stopBgm(fade = 2) {
    if (current) { current.stop(fade); current = null; }
  }

  function setBgmVolume(v) {
    bgmVolume = v;
    if (ctx && current) master.gain.setTargetAtTime(v, ctx.currentTime, 0.2);
  }

  function setDuck(on) {
    if (!ctx) return;
    duck.gain.setTargetAtTime(on ? 0.45 : 1, ctx.currentTime, 0.3);
  }

  // シンギングボウル風のベル
  function bell(volume = 0.6) {
    ensure();
    const t = ctx.currentTime + 0.05;
    const base = 392;
    [[1, 1, 7], [2.76, 0.45, 4.5], [5.4, 0.22, 3], [8.93, 0.1, 2]].forEach(([ratio, amp, dur]) => {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp * volume * 0.5, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.1);
    });
  }

  // 音声クリップ。{ promise, stop } を返す（promise は再生できたら true）
  function playClip(url, volume = 1) {
    const el = new Audio(url);
    el.volume = Math.max(0, Math.min(1, volume));
    let finish;
    const promise = new Promise(res => { finish = res; });
    const done = ok => { setDuck(false); finish(ok); };
    el.addEventListener('ended', () => done(true), { once: true });
    el.addEventListener('error', () => done(false), { once: true });
    setDuck(true);
    el.play().catch(() => done(false));
    return { promise, stop: () => { el.pause(); done(true); } };
  }

  return { unlock: ensure, startBgm, stopBgm, setBgmVolume, bell, playClip };
})();
