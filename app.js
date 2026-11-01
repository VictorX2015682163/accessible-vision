/* =========================================================
 * 慧眼 · 盲人识物 PWA — 核心逻辑
 * 设计原则:整屏可点、每步语音、震动反馈、门牌号逐位朗读
 * ======================================================= */

'use strict';

// ---------- DOM ----------
const video    = document.getElementById('camera');
const canvas   = document.getElementById('snapshot');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const hintEl   = document.getElementById('hint');
const scanBtn  = document.getElementById('scanBtn');
const repeatBtn= document.getElementById('repeatBtn');
const modeBtn  = document.getElementById('modeBtn');
const helpBtn  = document.getElementById('helpBtn');
const appEl    = document.getElementById('app');

// ---------- 状态 ----------
const MODES = {
  ROOM: { name: '门牌号', langHint: '数字模式' },
  TEXT: { name: '全部文字', langHint: '文字模式' },
};
let currentMode = 'ROOM';
let lastSpoken  = '';
let busy        = false;
let ocrWorker   = null;
let stream      = null;

// ---------- 语音朗读 ----------
let zhVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  zhVoice = voices.find(v => /zh|cmn|Chinese/i.test(v.lang + v.name)) || voices[0] || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

/** 朗读文字。interrupt=true 会打断当前朗读。 */
function speak(text, { interrupt = true, rate = 1, record = false } = {}) {
  if (!('speechSynthesis' in window) || !text) return;
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = rate;
  u.pitch = 1;
  if (zhVoice) u.voice = zhVoice;
  speechSynthesis.speak(u);
  if (record) lastSpoken = text;
}

/** 逐位朗读门牌号:如 "8206" → "八 二 零 六 号房间" */
const DIGIT_CN = ['零','一','二','三','四','五','六','七','八','九'];
function speakRoomNumber(raw) {
  const digits = (raw.match(/\d/g) || []);
  const letters = (raw.match(/[A-Za-z]/g) || []);
  let phrase = '';
  if (letters.length) phrase += letters.join(' ').toUpperCase() + '座 ';
  if (digits.length) {
    phrase += digits.map(d => DIGIT_CN[+d]).join('、') + ' 号房间';
  }
  const full = `识别到 ${phrase || raw}`;
  speak(full, { rate: 0.95, record: true });
  return full;
}

// ---------- 震动 ----------
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ---------- 摄像头 ----------
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setStatus('准备就绪');
    speak('慧眼已就绪。将门牌对准屏幕中间的黄色取景框,靠近到半米内,点击屏幕任意位置开始识别。', { rate: 1 });
  } catch (err) {
    setStatus('无法访问摄像头');
    speak('无法打开摄像头,请检查是否已授予摄像头权限,并确保通过安全连接访问。');
    console.error(err);
  }
}

// ---------- OCR 引擎 ----------
async function initOCR() {
  if (ocrWorker) return ocrWorker;
  setStatus('正在加载识别引擎…');
  // 中英文混合识别(门牌号常见:楼层字母 + 数字 + 中文"号")
  ocrWorker = await Tesseract.createWorker(['chi_sim', 'eng']);
  return ocrWorker;
}

/* ---------- 图像预处理 ----------
 * 关键提升识别率的步骤:
 * 1) 只裁剪中心取景框区域,排除杂乱背景
 * 2) 放大 2 倍(小字放大后 OCR 更准)
 * 3) 转灰度 + 对比度拉伸 + 大津法(Otsu)自适应二值化
 * 返回一个处理后的 canvas 供 Tesseract 识别。
 */
function preprocess(srcCanvas) {
  const sw = srcCanvas.width, sh = srcCanvas.height;
  // 与 CSS 取景框一致: left 8%, right 8%, top 30%, height 24%
  const cropX = Math.floor(sw * 0.08);
  const cropY = Math.floor(sh * 0.30);
  const cropW = Math.floor(sw * 0.84);
  const cropH = Math.floor(sh * 0.24);

  const scale = 2;                       // 放大倍数
  const out = document.createElement('canvas');
  out.width = cropW * scale;
  out.height = cropH * scale;
  const octx = out.getContext('2d', { willReadFrequently: true });
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, out.width, out.height);

  const img = octx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const n = out.width * out.height;

  // 1) 灰度 + 统计直方图
  const gray = new Uint8ClampedArray(n);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    gray[j] = g;
    hist[g]++;
  }

  // 2) 大津法(Otsu)求最佳二值化阈值
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }

  // 3) 判断深底浅字 or 浅底深字,统一输出为"白底黑字"(OCR 偏好)
  let darkCount = 0;
  for (let j = 0; j < n; j++) if (gray[j] < threshold) darkCount++;
  const darkIsText = darkCount < n / 2;  // 深色像素少 → 深色是文字

  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    let v = gray[j] < threshold ? 0 : 255;
    if (!darkIsText) v = 255 - v;         // 反色,保证黑字白底
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

// ---------- 识别流程 ----------
async function recognize() {
  if (busy) return;
  if (!stream) { speak('摄像头尚未就绪,请稍候。'); return; }
  busy = true;
  appEl.classList.add('busy');
  scanBtn.disabled = true;
  vibrate(40);
  setStatus('识别中,请保持稳定…');
  speak('正在识别,请拿稳手机。', { rate: 1.05 });
  resultEl.textContent = '';

  try {
    // 抓帧
    const w = video.videoWidth, h = video.videoHeight;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    // 预处理:裁剪取景框 + 增强 + 二值化
    const processed = preprocess(canvas);

    const worker = await initOCR();

    if (currentMode === 'ROOM') {
      // 门牌号:按"单行文本"识别,白名单只留数字/字母/门牌用字
      await worker.setParameters({
        tessedit_pageseg_mode: '7',   // PSM 7 = 整张图当作一行文字
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ号栋座楼层室房间-',
      });
    } else {
      await worker.setParameters({
        tessedit_pageseg_mode: '6',   // PSM 6 = 一整块文字
        tessedit_char_whitelist: '',
      });
    }

    const { data } = await worker.recognize(processed);
    const text = (data.text || '').trim().replace(/\s+/g, ' ');
    const confidence = Math.round(data.confidence || 0);
    console.log('OCR 结果:', JSON.stringify(text), '置信度:', confidence);

    if (!text || text.replace(/[^0-9A-Za-z一-龥]/g, '').length === 0) {
      setStatus('没有识别到文字');
      resultEl.textContent = '—';
      vibrate([80, 60, 80]);
      speak('没有识别到文字。请把门牌对准屏幕中间的黄框,靠近一些,保持光线充足后重试。', { record: true });
      return;
    }

    if (currentMode === 'ROOM') {
      // 提取最像门牌号的片段
      const room = extractRoomNumber(text);
      resultEl.textContent = room || text;
      vibrate([30, 40, 30, 40, 120]);   // 成功震动
      const spoken = speakRoomNumber(room || text);
      if (confidence < 60) {
        speak(spoken + '。识别不太确定,建议再拍一次确认。', { rate: 0.95, record: true });
      }
    } else {
      resultEl.textContent = text;
      vibrate([30, 40, 120]);
      const tip = confidence < 60 ? ',识别不太确定,建议再拍一次' : '';
      speak('识别到文字:' + text + tip, { rate: 0.98, record: true });
    }
    setStatus(`识别完成(可信度${confidence}%) · 点“重读”再听一次`);
  } catch (err) {
    console.error(err);
    setStatus('识别出错');
    speak('识别出现问题,请重试。');
    vibrate([200]);
  } finally {
    busy = false;
    appEl.classList.remove('busy');
    scanBtn.disabled = false;
  }
}

/** 从 OCR 文本里挑出最可能的门牌号 */
function extractRoomNumber(text) {
  // 优先匹配 "A栋1203" / "12-05" / "1203号" / "1203室" 这类
  const patterns = [
    /[A-Z]?\s*\d{1,2}\s*[-楼层]\s*\d{1,4}/,   // 12楼05 / A-1203
    /\d{3,4}\s*[号室房]/,                      // 1203号
    /[A-Z]\s*\d{2,4}/,                          // A1203
    /\d{3,4}/,                                   // 纯数字 1203
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[0].replace(/\s+/g, '');
  }
  return text;
}

// ---------- UI 辅助 ----------
function setStatus(msg) { statusEl.textContent = msg; }

function toggleMode() {
  currentMode = currentMode === 'ROOM' ? 'TEXT' : 'ROOM';
  const m = MODES[currentMode];
  setStatus('已切换到:' + m.name);
  hintEl.innerHTML = `点击屏幕任意位置<br>识别${m.name}`;
  vibrate(30);
  speak('已切换到' + m.name + '模式。', { record: false });
}

function repeatLast() {
  vibrate(20);
  if (lastSpoken) speak(lastSpoken, { rate: 0.9 });
  else speak('还没有识别结果。请先对准门牌点击屏幕识别。');
}

function showHelp() {
  vibrate(20);
  const help = '使用帮助。这是慧眼盲人识物应用。'
    + '将手机背面摄像头对准门牌或指示牌,点击屏幕任意位置即可识别,'
    + '结果会自动朗读。屏幕底部从左到右三个按钮分别是:重读、切换模式、帮助。'
    + '门牌号模式会逐位朗读数字,文字模式朗读全部文字。';
  speak(help, { rate: 1 });
}

// ---------- 事件绑定 ----------
// 整屏点击 = 识别(排除底部工具按钮)
appEl.addEventListener('click', (e) => {
  if (e.target.closest('.toolbar')) return;   // 工具条自行处理
  recognize();
});
scanBtn.addEventListener('click', (e) => { e.stopPropagation(); recognize(); });
repeatBtn.addEventListener('click', (e) => { e.stopPropagation(); repeatLast(); });
modeBtn.addEventListener('click',  (e) => { e.stopPropagation(); toggleMode(); });
helpBtn.addEventListener('click',  (e) => { e.stopPropagation(); showHelp(); });

// 音量键 / 回车 / 空格也能触发,方便盲人盲操作
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); recognize(); }
});

// ---------- Service Worker(离线可用) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  });
}

// ---------- 启动 ----------
// 首次交互后再朗读(浏览器要求用户手势才允许发声)
let greeted = false;
function greetOnce() {
  if (greeted) return;
  greeted = true;
  startCamera();
  document.removeEventListener('pointerdown', greetOnce);
}
document.addEventListener('pointerdown', greetOnce, { once: false });

// 若浏览器允许直接启动摄像头,则尝试
window.addEventListener('load', () => {
  setStatus('点击屏幕以启动');
  hintEl.innerHTML = '点击屏幕任意位置<br>启动摄像头并开始';
});
