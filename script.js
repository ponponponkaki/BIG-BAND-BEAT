// script.js — BBB専用：人数画面の裏で連続スキャン（多規格＋jsQR強化）/ 最終確認で停止
document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  /* ===== ステージ自動スケール（1280×800基準） ===== */
  function fitStage(){
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const scale = Math.min(vw / 1280, vh / 800);
    document.documentElement.style.setProperty('--ui-scale', String(scale));
  }
  window.addEventListener('resize', fitStage);
  window.addEventListener('orientationchange', fitStage);
  window.addEventListener('visibilitychange', fitStage);
  fitStage();

  /* ====== 設定 ====== */
  const USE_FRONT = true;           // 内カメラ優先: true / 外カメラ優先: false
  const ONE_SHOT_DELAY_FRAMES = 2;  // 同じコードを“1枚ずつ”扱うためのクリアフレーム数

  /* ====== 画面参照 ====== */
const screens = {
  home: document.getElementById('screen-home'),
  showTimes: document.getElementById('screen-show-times'),
  personSelect: document.getElementById('screen-person-select'),
  finalConfirm: document.getElementById('screen-final-confirm'),
  drawing: document.getElementById('screen-drawing'),
  loseBBB: document.getElementById('screen-lose-bbb'),
  losePirates: document.getElementById('screen-lose-pirates'),
  win: document.getElementById('screen-win'),
};


  // BBBのみ
  const SHOW_TIMES = {
    'BIG BAND BEAT': [
      { text: '第2回目公演', str: '13:50' },
      { text: '第3回目公演', str: '15:20' },
      { text: '第4回目公演', str: '17:20' },
      { text: '第5回目公演', str: '18:500' },
    ]
  };

  /* ===== サウンドエンジン（統一管理） ===== */
  const Sound = (() => {
    const files = {
      win:  './当たり音.mp3',
      lose: './外れ音.mp3',
      draw: './抽選音.mp3',       // ループ用
      tick: './読み込み音.mp3',   // 連打ワンショット
    };

    // WebAudio
    let ac = null;
    const buffers = {};      // { key: AudioBuffer }
    const loopNodes = {};    // { key: {src, gain} } ループ再生中だけ持つ
    const oneShotGain = 0.9; // ワンショ音量
    const loopGain    = 1.0; // ループ音量

    // HTMLAudio フォールバック
    const htmlSingleton = { win: null, lose: null, draw: null };
    const TICK_POOL = 6;
    const tickPool = Array.from({ length: TICK_POOL }, () => new Audio(files.tick));
    let tickIdx = 0;

    let unlocked = false;

    async function initAC() {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        return true;
      } catch { ac = null; return false; }
    }

    async function loadAsBuffer(url) {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      // iOS Safari 旧実装もケア
      return await new Promise((resolve, reject) => {
        const ok  = (buf) => resolve(buf);
        const err = (e)   => reject(e);
        const r = ac.decodeAudioData(arr, ok, err);
        if (r && typeof r.then === 'function') r.then(ok).catch(err);
      });
    }

    async function primeHTML(a, loop=false) {
      try {
        a.loop = !!loop;
        a.muted = true; a.currentTime = 0;
        await a.play(); a.pause();
        a.muted = false; a.currentTime = 0;
      } catch {}
    }

    async function unlock() {
      if (unlocked) return;
      unlocked = true;

      // 1) AC 起動
      await initAC();

      // 2) WebAudio で全音源を事前デコード（失敗したら HTMLAudio に切替）
      if (ac) {
        try {
          buffers.win  = await loadAsBuffer(files.win);
          buffers.lose = await loadAsBuffer(files.lose);
          buffers.draw = await loadAsBuffer(files.draw);
          buffers.tick = await loadAsBuffer(files.tick);
        } catch {
          // 失敗時は AC を捨てて HTMLAudio に全面フォールバック
          try { ac.close(); } catch {}
          ac = null;
        }
      }

      // 3) HTMLAudio 側もプライム（フォールバック用 & iOS解除用）
      htmlSingleton.win  = new Audio(files.win);
      htmlSingleton.lose = new Audio(files.lose);
      htmlSingleton.draw = new Audio(files.draw);
      await Promise.all([
        primeHTML(htmlSingleton.win),
        primeHTML(htmlSingleton.lose),
        primeHTML(htmlSingleton.draw, true),
        ...tickPool.map(a => primeHTML(a))
      ]);
    }

    function playBuffer(buf, vol=1.0) {
      if (!ac || !buf) return null;
      if (ac.state !== 'running') ac.resume().catch(()=>{});
      const src  = ac.createBufferSource();
      const gain = ac.createGain();
      gain.gain.value = vol;
      src.buffer = buf;
      src.connect(gain).connect(ac.destination);
      src.start();
      return { src, gain };
    }

    function play(name) {
      if (ac && buffers[name]) {
        const buf = buffers[name];
        playBuffer(buf, name === 'tick' ? oneShotGain : 1.0);
      } else {
        if (name === 'tick') {
          const a = tickPool[tickIdx++ % TICK_POOL];
          try { a.currentTime = 0; a.play().catch(()=>{}); } catch {}
        } else {
          const a = htmlSingleton[name] || new Audio(files[name]);
          htmlSingleton[name] = a;
          try { a.currentTime = 0; a.play().catch(()=>{}); } catch {}
        }
      }
    }

    function loop(name, on) {
      if (!on) {
        if (ac && loopNodes[name]) {
          try { loopNodes[name].src.stop(); } catch {}
          try { loopNodes[name].src.disconnect(); loopNodes[name].gain.disconnect(); } catch {}
        }
        if (htmlSingleton[name]) {
          try { htmlSingleton[name].pause(); } catch {}
          try { htmlSingleton[name].currentTime = 0; } catch {}
        }
        delete loopNodes[name];
        return;
      }

      if (ac && buffers[name]) {
        loop(name, false);
        const node = playBuffer(buffers[name], loopGain);
        if (node) {
          node.src.loop = true;
          loopNodes[name] = node;
        }
      } else {
        const a = htmlSingleton[name] || new Audio(files[name]);
        htmlSingleton[name] = a;
        a.loop = true;
        try { a.currentTime = 0; a.play().catch(()=>{}); } catch {}
      }
    }

    function resumeIfSuspended() {
      if (ac && ac.state !== 'running') {
        ac.resume().catch(()=>{});
      }
    }

    return {
      unlock,
      play,
      loop,
      resumeIfSuspended,
    };
  })();

  // 最初のユーザー操作で解錠
  const _firstGestureAudioUnlock = () => {
    Sound.unlock();
    document.removeEventListener('pointerdown', _firstGestureAudioUnlock, true);
    document.removeEventListener('keydown', _firstGestureAudioUnlock, true);
    document.removeEventListener('touchend', _firstGestureAudioUnlock, true);
  };
  document.addEventListener('pointerdown', _firstGestureAudioUnlock, true);
  document.addEventListener('keydown', _firstGestureAudioUnlock, true);
  document.addEventListener('touchend', _firstGestureAudioUnlock, true);

  // 既存互換API
  function stopDraw(){ Sound.loop('draw', false); }
  function playTick(){ Sound.play('tick'); }

  /* ====== 状態 ====== */
  const selected = { showName:'', showSubtitle:'', showTimeText:'', showTimeStr:'', personCount:0 };
  let inactivityTimer;
  let currentScreen = null;

  /* ====== 画面遷移 ====== */
  function navigateTo(target) {
    clearTimeout(inactivityTimer);

    if (target !== screens.personSelect) stopCamera();
    if (target !== screens.drawing) stopDraw();

    Object.values(screens).forEach(s => s?.classList?.add('hidden'));
    target?.classList?.remove('hidden');

    if (target === screens.win) {
      Sound.loop('draw', false);
      Sound.play('win');
      setTimeout(() => navigateTo(screens.showTimes), 10000); // 常に時間画面へ
    } else if (target === screens.loseBBB) {
      Sound.loop('draw', false);
      Sound.play('lose');
    }

    // “ホーム扱い”は showTimes。一定時間で同画面へ（リセット）
    if (target === screens.showTimes) {
      inactivityTimer = setTimeout(() => navigateTo(screens.showTimes), 10000);
    }

if (target === screens.personSelect) startCameraAndScan();

/* ここで左側タイトルを同期（時間画面に来たとき） */
if (target === screens.showTimes) syncLeftShowName();

currentScreen = target;

  }

  /* ====== 当たり画面の文言 ====== */
  function setWinTexts() {
    const sub = $('win-show-subtitle-top'), title = $('win-show-title-top');
    const time = $('win-show-time-text'),   count = $('win-ticket-count');
    if (sub) sub.textContent = selected.showSubtitle || '';
    if (title) { title.textContent = selected.showName || ''; title.classList.toggle('long', (selected.showName || '').length > 22); }
    if (time)  time.textContent = selected.showTimeText || '';
    if (count) count.textContent = String(selected.personCount || 1);
  }

  /* ====== 開演時刻ボタン ====== */
  function generateTimeButtons(showName) {
    const panel = document.querySelector('#screen-show-times .right-panel-unified-times');
    if (!panel) return;
    panel.innerHTML = '';

    const times = SHOW_TIMES[showName] || [];
    times.forEach(time => {
      const el = document.createElement('div');
      el.className = 'time-button';
      el.innerHTML = `
        <span class="time-marker"></span>
        <span class="time-text">${time.text}</span>
        <span class="time-str">${time.str}</span>`;
      el.addEventListener('click', () => {
        selected.showTimeText = time.text;
        selected.showTimeStr  = time.str;
        selected.personCount  = 0;

        $('person-show-subtitle')?.replaceChildren(document.createTextNode(selected.showSubtitle || ''));
        const pTitle = $('person-show-title');
        if (pTitle) {
          pTitle.replaceChildren(document.createTextNode(selected.showName || ''));
          pTitle.classList.toggle('long', (selected.showName || '').length > 22);
        }
        $('person-badge')?.replaceChildren(document.createTextNode(selected.showTimeText));
        $('person-time')?.replaceChildren(document.createTextNode(selected.showTimeStr));
        $('person-count')?.replaceChildren(document.createTextNode(String(selected.personCount)));

        navigateTo(screens.personSelect);
      });
      panel.appendChild(el);
    });
  }

  /* ====== 人数 → 最終確認 ====== */
  $('to-final-confirm')?.addEventListener('click', () => {
    $('final-confirm-badge')?.replaceChildren(document.createTextNode(selected.showTimeText));
    $('final-confirm-time-str')?.replaceChildren(document.createTextNode(selected.showTimeStr));
    $('final-confirm-count-num')?.replaceChildren(document.createTextNode(String(selected.personCount)));
    $('final-show-subtitle')?.replaceChildren(document.createTextNode(selected.showSubtitle || ''));
    const fTitle = $('final-show-title');
    if (fTitle) { fTitle.replaceChildren(document.createTextNode(selected.showName || '')); fTitle.classList.toggle('long', (selected.showName || '').length > 22); }
    navigateTo(screens.finalConfirm);
  });

  /* ====== 戻る ====== */
  document.querySelectorAll('.back-button').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = $(btn.dataset.target);
      if (target) navigateTo(target);
    });
  });

  /* ====== はずれ → 時間画面 ====== */
  ['lose-to-home-bbb'].forEach(id => {
    $(id)?.addEventListener('click', () => navigateTo(screens.showTimes));
  });

  /* ====== 抽選開始 ====== */
  $('start-lottery')?.addEventListener('click', async () => {
    stopDraw();
    Sound.resumeIfSuspended();
    Sound.loop('draw', true);

    const sub = $('drawing-show-subtitle'), title = $('drawing-show-name');
    if (sub) { sub.textContent = selected.showSubtitle || ''; sub.style.display = 'block'; }
    if (title) title.textContent = selected.showName;

    navigateTo(screens.drawing);

    const isWin = Math.random() < 0.5, delay = isWin ? 1500 : 300;
    setTimeout(() => {
      if (isWin) { setWinTexts(); navigateTo(screens.win); }
      else { navigateTo(screens.loseBBB); }   // 常にBBBのはずれ画面
    }, delay);
  });
  
  /* ====== 左側タイトル／サブタイトルに同期 ====== */
function syncLeftShowName(){
  const lt = document.getElementById('left-show-title');
  const ls = document.getElementById('left-show-subtitle');
  if (!lt || !ls) return;

  // selected が入っていればそれを、なければ既存の time-select-* から拾う
  const t = selected.showName || (document.getElementById('time-select-title')?.textContent || '');
  const s = selected.showSubtitle || (document.getElementById('time-select-subtitle')?.textContent || '');

  lt.textContent = t;
  ls.textContent = s;
  lt.classList.toggle('long', (t || '').length > 22);
}


  /* ====== QR スキャナ ====== */
  const qrVideo  = $('qr-video');
  const qrCanvas = $('qr-canvas');
  const qrCtx    = qrCanvas && qrCanvas.getContext ? qrCanvas.getContext('2d', { willReadFrequently: true }) : null;

  let qrStream = null;
  let scanning = false;
  let awaitingNext = false;
  let clearFrames = 0;

  // jsQR ローダ（オフライン→CDNの順）
  const ensureJsQR = () => new Promise((resolve, reject) => {
    if (window.jsQR) return resolve();
    const s1 = document.createElement('script');
    s1.src = './lib/jsQR.min.js';
    s1.onload = () => window.jsQR ? resolve() : fallbackCDN();
    s1.onerror = fallbackCDN;
    document.head.appendChild(s1);
    function fallbackCDN() {
      if (window.jsQR) return resolve();
      const s2 = document.createElement('script');
      s2.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
      s2.onload = () => window.jsQR ? resolve() : reject(new Error('jsQR load error'));
      s2.onerror = () => reject(new Error('jsQR load error'));
      document.head.appendChild(s2);
    }
  });

  async function getPreferredDeviceId(preferFront = true) {
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        .then(s => s.getTracks().forEach(t => t.stop()))
        .catch(()=>{});
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter(d => d.kind === 'videoinput');
      if (!cams.length) return undefined;

      const isFront = (d) => /front|user|selfie/i.test(d.label || '') || /front|user|selfie/i.test(d.deviceId || '');
      const isBack  = (d) => /back|environment|rear|world/i.test(d.label || '') || /back|environment|rear|world/i.test(d.deviceId || '');

      const pick = preferFront
        ? (cams.find(isFront) || cams[0])
        : (cams.find(isBack)  || cams[0]);

      return pick?.deviceId;
    } catch { return undefined; }
  }

  async function openStreamWithFallback(deviceId, preferFront = true) {
    const facingMode = preferFront ? 'user' : 'environment';
    const tryList = [
      { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}, facingMode },
      { width:{ideal:1280}, height:{ideal:720},  frameRate:{ideal:30}, facingMode },
      { width:{ideal:640},  height:{ideal:480},  frameRate:{ideal:30}, facingMode },
      {}
    ];
    let lastErr;
    for (const c of tryList) {
      try {
        const constraints = deviceId ? { deviceId:{ exact: deviceId }, ...c } : c;
        const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
        return stream;
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  async function startCameraAndScan() {
    if (scanning) return;
    scanning = true; awaitingNext = false; clearFrames = 0;

    if (!navigator.mediaDevices?.getUserMedia) { scanning = false; return; }

    try {
      const deviceId = await getPreferredDeviceId(USE_FRONT);
      qrStream = await openStreamWithFallback(deviceId, USE_FRONT);

      if (qrVideo) {
        qrVideo.setAttribute('playsinline','');
        qrVideo.setAttribute('autoplay','');
        qrVideo.setAttribute('muted','');
        qrVideo.muted = true;
        qrVideo.srcObject = qrStream;
        try { await qrVideo.play(); } catch {}
      }
    } catch { scanning = false; return; }

    // BarcodeDetector（多規格）→ jsQR の順で試す
    let detector = null;
    if ('BarcodeDetector' in window) {
      try {
        const wanted = [
          'qr_code','aztec','pdf417','data_matrix',
          'code_128','code_39','ean_13','ean_8','upc_a','upc_e'
        ];
        let formats = wanted;
        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
          const supported = await BarcodeDetector.getSupportedFormats();
          formats = wanted.filter(f => supported.includes(f));
        }
        detector = new window.BarcodeDetector({ formats });
        console.log('[barcode] formats:', formats);
      } catch { detector = null; }
    }
    if (!detector) { try { await ensureJsQR(); } catch {} }

    const loop = async () => {
      if (!scanning) return;
      let hasCode = false;

      try {
        // 1) BarcodeDetector
        if (detector) {
          try {
            const codes = await detector.detect(qrVideo);
            if (codes && codes.length) { hasCode = true; if (!awaitingNext) onOneTicketDetected(); }
          } catch (e) {
            console.warn('[barcode] detect() error, fallback to jsQR', e);
            detector = null;
          }
        }

        // 2) jsQR（マルチパス：ROI/拡大/回転）
        if (!detector && window.jsQR && qrCtx) {
          const vw = qrVideo.videoWidth  || 1280;
          const vh = qrVideo.videoHeight || 720;

          qrCtx.imageSmoothingEnabled = false;

          const passes = [
            { roi: 1.00, scale: 3, rotate: 0 },
            { roi: 0.85, scale: 3, rotate: 0 },
            { roi: 0.70, scale: 2, rotate: 0 },
            { roi: 1.00, scale: 2, rotate: 90 },
          ];

          for (const p of passes) {
            const roiW = Math.floor(vw * p.roi);
            const roiH = Math.floor(vh * p.roi);
            const roiX = Math.floor((vw - roiW) / 2);
            const roiY = Math.floor((vh - roiH) / 2);

            const outW = Math.floor(roiW * p.scale);
            const outH = Math.floor(roiH * p.scale);

            qrCanvas.width  = (p.rotate % 180 === 0) ? outW : outH;
            qrCanvas.height = (p.rotate % 180 === 0) ? outH : outW;

            qrCtx.save();
            if (p.rotate % 180 === 0) {
              qrCtx.drawImage(qrVideo, roiX, roiY, roiW, roiH, 0, 0, outW, outH);
            } else {
              qrCtx.translate(qrCanvas.width/2, qrCanvas.height/2);
              qrCtx.rotate((p.rotate * Math.PI) / 180);
              qrCtx.drawImage(qrVideo, roiX, roiY, roiW, roiH, -outW/2, -outH/2, outW, outH);
            }
            qrCtx.restore();

            const img  = qrCtx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
            const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
            if (code && code.data) { hasCode = true; if (!awaitingNext) onOneTicketDetected(); break; }
          }
        }
      } catch {}

      // “1枚ずつ”ゲート制御
      if (hasCode) {
        awaitingNext = true;
        clearFrames = 0;
      } else {
        clearFrames++;
        if (awaitingNext && clearFrames >= ONE_SHOT_DELAY_FRAMES) {
          awaitingNext = false;
          clearFrames = 0;
        }
      }

      setTimeout(() => requestAnimationFrame(loop), 120);
    };

    requestAnimationFrame(loop);
  }

  function stopCamera() {
    scanning = false;
    try { qrVideo?.pause(); } catch {}
    if (qrStream) {
      try { qrStream.getTracks().forEach(t => t.stop()); } catch {}
      qrStream = null;
    }
  }

  function onOneTicketDetected() {
    const el = document.getElementById('person-count');
    selected.personCount = Math.min(99, (selected.personCount || 0) + 1);
    if (el) {
      el.textContent = String(selected.personCount);
      playTick();
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
  }

/* ====== 初期表示：BBB固定で時間画面をホーム扱い ====== */
selected.showName     = 'BIG BAND BEAT';
selected.showSubtitle = 'BROADWAY MUSIC THEATER';
$('time-select-title')?.replaceChildren(document.createTextNode(selected.showName));
const subTS = $('time-select-subtitle');
if (subTS) { subTS.textContent = selected.showSubtitle; subTS.style.display = 'block'; }

syncLeftShowName();  // ←ここを追加

generateTimeButtons(selected.showName);
navigateTo(screens.showTimes);

});

