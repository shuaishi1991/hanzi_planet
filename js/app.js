BOOKS.forEach(b => b.chapters.forEach(c => {
  const seen = [];
  c.chars.forEach(x => x.words.forEach(w => { if (!seen.includes(w)) seen.push(w); }));
  c.wordsAll = c.bookWords || seen;
  c.charList = c.chars.map(x => x.ch);
  // sentences: [["片段1","片段2"], ["下一句"]] — 兼容旧的扁平字符串数组
  const raw = c.sentences || [];
  if (!raw.length) {
    c.sentenceGroups = [];
    c.sentenceParts = [];
  } else if (typeof raw[0] === "string") {
    c.sentenceGroups = raw.map(s => [s]);
    c.sentenceParts = raw.slice();
  } else {
    c.sentenceGroups = raw.map(g => Array.isArray(g) ? g : [String(g)]);
    c.sentenceParts = c.sentenceGroups.reduce((a, g) => a.concat(g), []);
  }
}));

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
/** CSS coin mark (🪙 breaks as □ on many Chrome builds) */
function coinHtml(extraClass) {
  return '<span class="ico-coin' + (extraClass ? " " + extraClass : "") + '" aria-hidden="true"></span>';
}
const COIN_TXT = "币";
const DEFAULT_EXTRA_TASKS = [
  { id: "write-page", title: "写一页字帖", coins: 50, icon: "✍️" },
  { id: "math-page", title: "完成一页数学练习", coins: 20, icon: "🔢" }
];
function normalizeProgress(d) {
  if (typeof d.coins !== "number") d.coins = 0;
  if (!d.wrong) d.wrong = {};
  if (!Array.isArray(d.cashouts)) d.cashouts = [];
  if (!Array.isArray(d.coinLog)) d.coinLog = [];
  if (!Array.isArray(d.extraTasks)) d.extraTasks = DEFAULT_EXTRA_TASKS.map(t => ({ ...t }));
  if (!d.play || typeof d.play !== "object") d.play = {};
  Object.keys(d.wrong).forEach(k => {
    if (typeof d.wrong[k] === "number") d.wrong[k] = { n: d.wrong[k], kind: "chars", cid: null, streak: 0 };
  });
  return d;
}
const store = {
  key: "shizi-books-v4",
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(this.key));
      if (d && d.chapters) return normalizeProgress(d);
    } catch (e) {}
    return normalizeProgress({ chapters: {}, wrong: {}, coins: 0, cashouts: [], coinLog: [], extraTasks: DEFAULT_EXTRA_TASKS.map(t => ({ ...t })), play: {} });
  },
  save() { localStorage.setItem(this.key, JSON.stringify(progress)); }
};
let progress = store.load();

const FLAT = [];
BOOKS.forEach(b => b.chapters.forEach((c, i) => FLAT.push({ book: b, chapter: c, idxInBook: i })));
function findChapter(cid) { return FLAT.find(x => x.chapter.id === cid); }
function globalIdx(cid) { return FLAT.findIndex(x => x.chapter.id === cid); }
function chProg(cid) {
  if (!progress.chapters[cid]) progress.chapters[cid] = { learnDone: false, listenDone: false, readDone: false };
  return progress.chapters[cid];
}
function chDone(cid) { const p = progress.chapters[cid]; return !!(p && p.learnDone && p.listenDone && p.readDone); }
function prevChapters(cid) {
  const i = globalIdx(cid);
  return FLAT.slice(0, i).map(x => x.chapter);
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function show(id) {
  stopSpeaking();
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
  renderCoins();
}
function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function showModal(html) {
  const card = $("#modal-card");
  card.classList.remove("cash-wide");
  card.innerHTML = html;
  $("#modal").classList.add("show");
}
function hideModal() { voicePickerOpen = false; $("#modal").classList.remove("show"); }

const NATIVE = (() => { try { return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hanzi); } catch (e) { return false; } })();
function nativeCall(payload) { try { if (NATIVE) window.webkit.messageHandlers.hanzi.postMessage(payload); } catch (e) {} }
let nativeVoices = null;
let voicePickerOpen = false;
let nativeListenHandlers = null;
window.__nativeVoices = function (list) { nativeVoices = list; if (voicePickerOpen) renderVoicePicker(); };
window.__nativeSTTResult = function (payload) {
  const h = nativeListenHandlers; nativeListenHandlers = null;
  if (h) h.onResult((payload && payload.alts) || []);
};
window.__nativeSTTError = function (code) {
  const h = nativeListenHandlers; nativeListenHandlers = null;
  if (h) h.onError(code || "error");
};
let selectedVoiceId = null;
try { selectedVoiceId = localStorage.getItem("tts-voice-id") || null; } catch (e) {}
if (NATIVE) nativeCall({ action: "getVoices" });

let zhVoice = null;
const VOICE_PREFER = ["xiaoxiao", "xiaoyi", "xiaohan", "yunjian", "yunxia", "ting-ting", "tingting", "mei-jia", "meijia", "li-mu", "yu-shu", "hui-hui", "kangkang", "yaoyao"];
function voiceScore(v) {
  const s = (v.lang + " " + v.name).toLowerCase();
  if (/yue|cantonese|zh[-_]hk|sin-ji|sinji/.test(s)) return -10;
  let sc = 0;
  if (/^zh([-_]cn)?$/i.test(v.lang) || /cmn|mandarin|mainland|putonghua/.test(s)) sc += 5;
  else if (/zh/i.test(v.lang)) sc += 1;
  if (/enhanced|premium|natural|neural|online|siri/.test(s)) sc += 4;
  if (VOICE_PREFER.some(n => s.indexOf(n) >= 0)) sc += 3;
  if (/zh[-_]tw|taiwan/.test(s)) sc -= 1;
  return sc;
}
function pickVoice() {
  try {
    const vs = speechSynthesis.getVoices().filter(v => /zh|cmn|chinese|mandarin/i.test(v.lang + " " + v.name));
    let best = null, bestSc = -99;
    vs.forEach(v => { const sc = voiceScore(v); if (sc > bestSc) { bestSc = sc; best = v; } });
    zhVoice = best;
    if (selectedVoiceId) { const sv = vs.find(v => (v.voiceURI || v.name) === selectedVoiceId); if (sv) zhVoice = sv; }
  } catch (e) {}
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
let speakToken = 0;
let audioEl = null;
const MAX_AUDIO_NAME_BYTES = 180;
function utf8ByteLength(s) {
  return new TextEncoder().encode(s).length;
}
async function audioUrlFor(text) {
  // Keep short Chinese filenames; long paragraphs use h_<sha1[:16]>.mp3 (see tools/generate_audio.py)
  if (utf8ByteLength(text + ".mp3") <= MAX_AUDIO_NAME_BYTES) {
    return "audio/" + encodeURIComponent(text) + ".mp3";
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return "audio/h_" + hex + ".mp3";
}
function speakWithAudio(text, tk) {
  return audioUrlFor(text).then(url => new Promise((resolve, reject) => {
    try {
      if (audioEl) { try { audioEl.pause(); } catch (e) {} audioEl = null; }
      const a = new Audio(url);
      audioEl = a;
      a.onended = () => { if (speakToken === tk) resolve(true); };
      a.onerror = () => reject(new Error("audio-missing"));
      const p = a.play();
      if (p && p.then) p.catch(() => reject(new Error("audio-play-fail")));
    } catch (e) { reject(e); }
  }));
}
function speakWithTTS(text, rate, tk) {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const parts = text.length > 4 ? (text.match(/[^，。！？；：、]+[，。！？；：、]*[”’）】]*/g) || [text]) : [text];
    let i = 0;
    const next = () => {
      if (tk !== speakToken || i >= parts.length) return;
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = "zh-CN";
      u.rate = rate;
      u.pitch = 1.05;
      if (zhVoice) u.voice = zhVoice;
      u.onend = () => { if (i < parts.length) setTimeout(next, 280); };
      speechSynthesis.speak(u);
    };
    next();
  } catch (e) {}
}
function speak(text, rate) {
  const r = rate || (text.length <= 1 ? 0.7 : text.length <= 4 ? 0.78 : 0.88);
  if (NATIVE) { nativeCall({ action: "speak", text: text, rate: r, voice: selectedVoiceId }); return; }
  const tk = ++speakToken;
  if (audioEl) { try { audioEl.pause(); } catch (e) {} audioEl = null; }
  if ("speechSynthesis" in window) { try { speechSynthesis.cancel(); } catch (e) {} }
  speakWithAudio(text, tk).catch(() => {
    if (tk === speakToken) speakWithTTS(text, r, tk);
  });
}
function stopSpeaking() {
  speakToken++;
  if (audioEl) { try { audioEl.pause(); } catch (e) {} audioEl = null; }
  if (NATIVE) nativeCall({ action: "stopSpeak" });
  else if ("speechSynthesis" in window) { try { speechSynthesis.cancel(); } catch (e) {} }
}

function webVoiceList() {
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices()
    .filter(v => /zh|cmn|chinese|mandarin/i.test(v.lang + " " + v.name))
    .map(v => ({ id: v.voiceURI || v.name, name: v.name, lang: v.lang, quality: /enhanced|premium|natural|neural|siri/i.test(v.name) ? 2 : 1, ref: v }))
    .sort((a, b) => ((a.lang === "zh-CN" ? 0 : 1) - (b.lang === "zh-CN" ? 0 : 1)) || b.quality - a.quality);
}
function speakSample(voiceId) {
  if (NATIVE) { nativeCall({ action: "speak", text: "我爱我的爸爸妈妈", rate: 0.85, voice: voiceId }); return; }
  const v = webVoiceList().find(x => x.id === voiceId);
  if (v && "speechSynthesis" in window) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance("我爱我的爸爸妈妈");
      u.lang = "zh-CN"; u.rate = 0.85; u.voice = v.ref;
      speechSynthesis.speak(u);
    } catch (e) {}
  }
}
function renderVoicePicker() {
  const voices = NATIVE ? nativeVoices : webVoiceList();
  if (!voices) {
    showModal('<div class="m-emoji">🎙</div><h3>选择朗读音色</h3><p>正在加载声音列表…</p>');
    nativeCall({ action: "getVoices" });
    return;
  }
  if (!voices.length) {
    showModal('<div class="m-emoji">🎙</div><h3>选择朗读音色</h3><p>没有找到中文声音</p><div class="m-btns"><button class="mbtn ghost" onclick="hideModal()">关闭</button></div>');
    return;
  }
  const cur = selectedVoiceId || (NATIVE ? "__default" : (zhVoice ? (zhVoice.voiceURI || zhVoice.name) : "__default"));
  const rows = voices.map(v => {
    const sel = v.id === cur;
    const qtag = v.quality >= 3 ? " · 高品质" : v.quality >= 2 ? " · 增强" : "";
    return '<div class="vp-row' + (sel ? " sel" : "") + '" data-vid="' + v.id + '">' +
      '<span class="vp-name">' + v.name + ' <small>' + (v.lang || "") + qtag + "</small></span>" +
      '<button class="vp-try" data-try="' + v.id + '">试听</button>' +
      '<span class="vp-check">' + (sel ? "✓" : "") + "</span></div>";
  }).join("");
  showModal('<div class="m-emoji">🎙</div><h3>选择朗读音色</h3><div class="vp-list">' + rows + "</div>" +
    '<div class="m-btns"><button class="mbtn ghost" onclick="hideModal()">完成</button></div>');
  $("#modal-card").querySelectorAll(".vp-row").forEach(row => {
    row.addEventListener("click", () => {
      selectedVoiceId = row.dataset.vid;
      try { localStorage.setItem("tts-voice-id", selectedVoiceId); } catch (e) {}
      if (!NATIVE) { const v = webVoiceList().find(x => x.id === selectedVoiceId); if (v) zhVoice = v.ref; }
      renderVoicePicker();
      showToast("已选择音色");
    });
  });
  $("#modal-card").querySelectorAll(".vp-try").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); speakSample(btn.dataset.try); });
  });
}
function openVoicePicker() { voicePickerOpen = true; renderVoicePicker(); }

function encodeSave() {
  savePlayCache();
  const data = {
    v: 2, t: Date.now(),
    coins: progress.coins || 0,
    chapters: progress.chapters || {},
    wrong: progress.wrong || {},
    cashouts: progress.cashouts || [],
    coinLog: progress.coinLog || [],
    extraTasks: progress.extraTasks || [],
    play: progress.play || {}
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = "";
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeSave(code) {
  const b64 = String(code || "").trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - b64.length % 4) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const d = JSON.parse(new TextDecoder().decode(bytes));
  if (!d || typeof d !== "object" || typeof d.chapters !== "object" || typeof d.coins !== "number") throw new Error("bad code");
  return normalizeProgress({
    chapters: d.chapters,
    wrong: d.wrong || {},
    coins: d.coins,
    cashouts: d.cashouts,
    coinLog: d.coinLog,
    extraTasks: d.extraTasks,
    play: d.play || {}
  });
}
function saveSummary(p) {
  const done = Object.keys(p.chapters).filter(cid => { const x = p.chapters[cid]; return x && x.learnDone && x.listenDone && x.readDone; }).length;
  const cashed = totalCashedYuan(p);
  return COIN_TXT + " " + (p.coins || 0) + " 金币 · ⭐ " + done + " 课完成 · 💵 已兑 ¥" + cashed;
}

const COIN_PER_YUAN = 50;
const CASH_DENOMS = [
  { yuan: 1, cls: "n1", badge: "b1" },
  { yuan: 5, cls: "n5", badge: "b5" },
  { yuan: 10, cls: "n10", badge: "b10" },
  { yuan: 20, cls: "n20", badge: "b20" },
  { yuan: 50, cls: "n50", badge: "b50" },
  { yuan: 100, cls: "n100", badge: "b100", span2: true }
];
function coinsForYuan(yuan) { return yuan * COIN_PER_YUAN; }
function totalCashedYuan(p) {
  return (p.cashouts || []).reduce((s, x) => s + (x.yuan || 0), 0);
}
function openCashShop() {
  const coins = progress.coins || 0;
  const cashed = totalCashedYuan(progress);
  const canYuan = Math.floor(coins / COIN_PER_YUAN);
  const notes = CASH_DENOMS.map(d => {
    const cost = coinsForYuan(d.yuan);
    const ok = coins >= cost;
    return '<button class="cash-note ' + d.cls + (d.span2 ? " span2" : "") + '" data-yuan="' + d.yuan + '"' + (ok ? "" : " disabled") + ">" +
      '<div class="cn-top"><div class="cn-amt">¥' + d.yuan + "</div></div>" +
      '<div class="cn-cost">' + coinHtml() + ' ' + cost + (ok ? " · 点我兑换" : " · 还差 " + (cost - coins)) + "</div>" +
      "</button>";
  }).join("");
  showModal(
    '<div class="m-emoji">💵</div><h3>金币兑奖</h3>' +
    '<p class="cash-rate">汇率：' + coinHtml() + ' ' + COIN_PER_YUAN + " = ¥1 · 请家长兑现真钱哦</p>" +
    '<div class="cash-balance">' +
    '<div class="cash-pill"><div class="cp-label">当前金币</div><div class="cp-val">' + coinHtml() + ' ' + coins + "</div></div>" +
    '<div class="cash-pill saved"><div class="cp-label">已兑现金</div><div class="cp-val">¥' + cashed + "</div></div>" +
    "</div>" +
    '<p class="cash-hint">大约还能兑 ¥' + canYuan + " · 点选面额即可兑换 · 明细请点右上角金币</p>" +
    '<div class="cash-grid">' + notes + "</div>" +
    '<div class="m-btns"><button class="mbtn ghost" onclick="hideModal()">关闭</button></div>'
  );
  const card = $("#modal-card");
  card.classList.add("cash-wide");
  card.querySelectorAll(".cash-note").forEach(btn => {
    btn.addEventListener("click", () => confirmCashRedeem(Number(btn.dataset.yuan)));
  });
}
function confirmCashRedeem(yuan) {
  const cost = coinsForYuan(yuan);
  if ((progress.coins || 0) < cost) {
    showToast("金币不够哦，再去学习攒一攒");
    return;
  }
  const d = CASH_DENOMS.find(x => x.yuan === yuan) || CASH_DENOMS[0];
  showModal(
    '<div class="m-emoji">' + coinHtml('lg') + '</div><h3>确认兑换？</h3>' +
    '<div class="cash-confirm-note ' + d.cls + '"><div class="big">¥' + yuan + '</div>' +
    '<div class="sub">将消耗 ' + coinHtml() + ' ' + cost + "</div></div>" +
    '<p class="sv-tip">兑换后请家长把 <strong>¥' + yuan + "</strong> 真钱给孩子存起来。<br>程序只记账，不会自动转账。</p>" +
    '<div class="m-btns">' +
    '<button class="mbtn primary" id="cash-do">确认兑换</button>' +
    '<button class="mbtn ghost" id="cash-back">返回</button>' +
    "</div>"
  );
  $("#modal-card").classList.add("cash-wide");
  $("#cash-back").addEventListener("click", openCashShop);
  $("#cash-do").addEventListener("click", () => doCashRedeem(yuan));
}
function doCashRedeem(yuan) {
  const cost = coinsForYuan(yuan);
  if ((progress.coins || 0) < cost) {
    showToast("金币不够哦");
    openCashShop();
    return;
  }
  progress.coins -= cost;
  if (!progress.cashouts) progress.cashouts = [];
  progress.cashouts.push({ yuan: yuan, coins: cost, t: Date.now() });
  pushCoinLog(-cost, "兑奖 ¥" + yuan);
  store.save();
  renderCoins(true);
  soundWin();
  confetti();
  showModal(
    '<div class="m-emoji">🎉</div><h3>兑换成功！</h3>' +
    '<div class="cash-confirm-note ' + ((CASH_DENOMS.find(x => x.yuan === yuan) || {}).cls || "n1") + '">' +
    '<div class="big">¥' + yuan + "</div>" +
    '<div class="sub">请家长兑现 · 已累计 ¥' + totalCashedYuan(progress) + "</div></div>" +
    '<p class="sv-tip">还剩 ' + coinHtml() + ' ' + progress.coins + "</p>" +
    '<div class="m-btns">' +
    '<button class="mbtn primary" id="cash-again">继续兑换</button>' +
    '<button class="mbtn ghost" onclick="hideModal()">完成</button>' +
    "</div>"
  );
  $("#modal-card").classList.add("cash-wide");
  $("#cash-again").addEventListener("click", openCashShop);
  showToast("💵 兑换 ¥" + yuan + " 成功，请家长兑现");
}
function copyText(text) {
  const ok = () => showToast("已复制，去粘贴吧");
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); ok(); } catch (e) { showToast("复制失败，请长按存档码手动复制"); }
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
  else fallback();
}
function openSave() {
  const code = encodeSave();
  showModal(
    '<div class="m-emoji">💾</div><h3>学习存档</h3>' +
    '<p class="sv-tip">当前进度：' + saveSummary(progress) + "</p>" +
    '<div class="sv-code">' + code + "</div>" +
    '<div class="m-btns">' +
    '<button class="mbtn primary" id="sv-copy">📋 复制存档码</button>' +
    '<button class="mbtn ghost" id="sv-to-import">📥 我要导入存档</button>' +
    '<button class="mbtn ghost" onclick="hideModal()">关闭</button>' +
    "</div>" +
    '<p class="sv-tip">把存档码发到微信/备忘录，在另一台设备打开本页面 → 💾 存档 → 导入，即可同步进度</p>'
  );
  $("#sv-copy").addEventListener("click", () => copyText(code));
  $("#sv-to-import").addEventListener("click", openImport);
}
function openImport() {
  showModal(
    '<div class="m-emoji">📥</div><h3>导入存档</h3>' +
    '<p class="sv-tip">粘贴存档码（⚠️ 导入会覆盖本机当前进度）</p>' +
    '<textarea class="sv-input" id="sv-input" placeholder="长按粘贴存档码"></textarea>' +
    '<div class="m-btns">' +
    '<button class="mbtn primary" id="sv-do-import">恢复进度</button>' +
    '<button class="mbtn ghost" onclick="hideModal()">取消</button>' +
    "</div>"
  );
  $("#sv-do-import").addEventListener("click", () => {
    try {
      const d = decodeSave($("#sv-input").value);
      progress = d;
      Object.keys(playCache).forEach(k => delete playCache[k]);
      store.save();
      renderCoins();
      renderBooks();
      renderNotebookBtn();
      hideModal();
      showToast("✅ 导入成功：" + saveSummary(d));
    } catch (e) {
      showToast("存档码无效，请检查后重试");
    }
  });
}

let actx = null;
function ac() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  return actx;
}
function tone(freq, delay, dur, type, vol) {
  try {
    const ctx = ac();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || "sine";
    o.frequency.value = freq;
    const t0 = ctx.currentTime + delay;
    g.gain.setValueAtTime(vol || 0.14, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur);
  } catch (e) {}
}
function soundCorrect() { tone(660, 0, 0.12); tone(880, 0.11, 0.22); }
function soundWrong() { tone(190, 0, 0.28, "square", 0.07); }
function soundWin() { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.13, 0.2)); }
function soundCoin() { tone(1318, 0, 0.08, "triangle", 0.1); tone(1760, 0.07, 0.15, "triangle", 0.1); }

function popStarsOn(el) {
  const r = el.getBoundingClientRect();
  for (let i = 0; i < 6; i++) {
    const s = document.createElement("div");
    s.textContent = "⭐";
    s.className = "burst";
    s.style.left = (r.left + r.width / 2) + "px";
    s.style.top = (r.top + r.height / 2) + "px";
    s.style.setProperty("--dx", (Math.random() * 180 - 90) + "px");
    s.style.setProperty("--dy", (Math.random() * -130 - 30) + "px");
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}
function confetti() {
  const icons = ["🎉", "⭐", "✨", "🎊", "💫"];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement("div");
    s.textContent = icons[Math.floor(Math.random() * icons.length)];
    s.className = "confetti";
    s.style.left = Math.random() * 100 + "vw";
    s.style.fontSize = (Math.random() * 18 + 16) + "px";
    s.style.animationDuration = (Math.random() * 1.4 + 2.2) + "s";
    s.style.animationDelay = (Math.random() * 0.7) + "s";
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 4500);
  }
}
function renderDots(el, total, idx) {
  if (!session) return;
  if (!session.visited) session.visited = new Set();
  session.visited.add(idx);
  savePlayCache();
  let html = "";
  for (let i = 0; i < total; i++) {
    let cls = "dot";
    const seen = session.visited.has(i);
    if (seen && i !== idx) cls += " done";
    if (i === idx) cls += " now";
    if (seen) cls += " clickable";
    html += '<span class="' + cls + '" data-i="' + i + '"' +
      (seen ? ' role="button" title="跳到第 ' + (i + 1) + ' 个"' : "") + "></span>";
  }
  el.classList.toggle("many", total > 24);
  el.innerHTML = html;
  el.querySelectorAll(".dot.clickable").forEach(dot => {
    dot.addEventListener("click", () => {
      if (!session) return;
      const i = Number(dot.dataset.i);
      if (!Number.isFinite(i) || i === session.idx) return;
      if (!session.visited.has(i)) return;
      stopRec();
      session.wrongThis = false;
      session.listening = false;
      session.idx = i;
      renderRound();
    });
  });
}

let coinsBackScreen = "#screen-books";
function renderCoins(pulse) {
  $$(".coin-badge").forEach(b => {
    b.innerHTML = coinHtml() + " " + progress.coins;
    b.setAttribute("role", "button");
    b.setAttribute("title", "查看金币明细");
    b.classList.add("clickable");
    if (!b.dataset.boundCoins) {
      b.dataset.boundCoins = "1";
      b.addEventListener("click", () => {
        const active = document.querySelector(".screen.active");
        if (active && active.id === "screen-coins") return;
        if (active) coinsBackScreen = "#" + active.id;
        openCoinsLog();
      });
    }
    if (pulse) {
      b.classList.remove("pulse");
      void b.offsetWidth;
      b.classList.add("pulse");
    }
  });
}
function flyCoins(fromEl, n) {
  const badge = document.querySelector(".screen.active .coin-badge");
  if (!badge || !fromEl) return;
  const r = fromEl.getBoundingClientRect();
  const b = badge.getBoundingClientRect();
  for (let i = 0; i < Math.min(n, 5); i++) {
    const c = document.createElement("div");
    c.className = "coin-fly ico-coin";
    c.style.left = (r.left + r.width / 2 + (Math.random() * 30 - 15)) + "px";
    c.style.top = (r.top + r.height / 2) + "px";
    document.body.appendChild(c);
    const dx = b.left + b.width / 2 - (r.left + r.width / 2);
    const dy = b.top + b.height / 2 - (r.top + r.height / 2);
    setTimeout(() => {
      c.style.transform = "translate(" + dx + "px," + dy + "px) scale(.35)";
      c.style.opacity = "0.15";
    }, 30 + i * 60);
    setTimeout(() => c.remove(), 1100 + i * 60);
  }
}
function pushCoinLog(n, reason) {
  if (!n || !reason) return;
  if (!progress.coinLog) progress.coinLog = [];
  progress.coinLog.push({ t: Date.now(), n: n, reason: reason });
  if (progress.coinLog.length > 300) progress.coinLog = progress.coinLog.slice(-300);
}
function addCoins(n, fromEl, reason) {
  if (n <= 0) return;
  const before = progress.coins;
  progress.coins += n;
  if (session) session.coins += n;
  pushCoinLog(n, reason || "获得金币");
  store.save();
  soundCoin();
  renderCoins(true);
  if (fromEl) flyCoins(fromEl, n);
  if (Math.floor(before / 100) !== Math.floor(progress.coins / 100)) {
    confetti();
    showToast("🏆 金币达到 " + Math.floor(progress.coins / 100) * 100 + " 啦，太厉害了！");
  }
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
let srBroken = false;
let parentJudge = false;

function normText(s) {
  return (s || "").replace(/[\s　，。！？、,.!?·…~～"'：:；;（）()【】]/g, "");
}
function toReading(s) {
  if (typeof PINYIN === "undefined") return normText(s);
  const t = normText(s);
  let out = "";
  for (const ch of t) out += PINYIN[ch] || ch;
  return out;
}
function isMatch(alts, target) {
  const t = normText(target);
  if (!t) return false;
  const tr = toReading(target);
  return alts.some(a => {
    const n = normText(a);
    if (!n) return false;
    if (n === t || n.includes(t)) return true;
    return toReading(a) === tr;
  });
}
function stopRec() {
  if (NATIVE) nativeCall({ action: "sttStop" });
  try { if (rec) rec.abort(); } catch (e) {}
  rec = null;
}
function listenOnce(onResult, onError) {
  if (NATIVE) { nativeListenHandlers = { onResult, onError }; nativeCall({ action: "sttStart" }); return; }
  if (!SR) { onError("unsupported"); return; }
  stopRec();
  rec = new SR();
  rec.lang = "zh-CN";
  rec.interimResults = false;
  rec.maxAlternatives = 5;
  let settled = false;
  const fail = (code) => { if (!settled) { settled = true; onError(code); } };
  rec.onresult = (e) => {
    const alts = [];
    for (const r of e.results) for (const a of r) alts.push(a.transcript);
    if (!settled) { settled = true; onResult(alts); }
  };
  rec.onerror = (e) => fail(e.error || "error");
  rec.onend = () => fail("no-speech");
  try { rec.start(); } catch (e) { fail("start-fail"); }
  setTimeout(() => { if (!settled) { try { rec.stop(); } catch (e) {} } }, 12000);
}

function wrongCount() { return Object.keys(progress.wrong).length; }
function handleItemWrong(text, kind, cid) {
  let w = progress.wrong[text];
  if (!w) { w = { n: 0, kind, cid, streak: 0 }; progress.wrong[text] = w; }
  w.n++;
  w.streak = 0;
  w.kind = kind;
  if (cid) w.cid = cid;
  store.save();
}
function handleItemCorrect(text) {
  const w = progress.wrong[text];
  if (!w) return false;
  w.streak = (w.streak || 0) + 1;
  if (w.streak >= 2) {
    delete progress.wrong[text];
    store.save();
    return true;
  }
  store.save();
  return false;
}

let currentBookId = BOOKS[0].id;
let currentCid = null;

function renderBooks() {
  const list = $("#book-list");
  list.innerHTML = BOOKS.map(b => {
    const done = b.chapters.filter(c => chDone(c.id)).length;
    const cls = b.id === "book1" ? "b1" : b.id === "book2" ? "b2" : "b3";
    return '<button class="book-card ' + cls + '" data-bid="' + b.id + '"' + (b.chapters.length ? "" : ' style="opacity:.55"') + '>' +
      '<div class="book-badge">' + b.num + "</div>" +
      '<div class="book-info"><div class="book-title">识字启蒙第一课 · ' + b.title + "</div>" +
      '<div class="book-sub">' + (b.chapters.length ? "共 " + b.chapters.length + " 课" : "内容筹备中，敬请期待") + "</div>" +
      '<div class="book-progress">' + (b.chapters.length ? "已完成 " + done + " / " + b.chapters.length + " 课" : "") + "</div></div>" +
      '<div style="font-size:22px">' + (b.chapters.length ? "▶" : "🕐") + "</div></button>";
  }).join("");
  list.querySelectorAll(".book-card").forEach(card => {
    card.addEventListener("click", () => {
      if (!BOOKS.find(x => x.id === card.dataset.bid).chapters.length) { showToast("这一册的内容还在筹备中"); return; }
      openBook(card.dataset.bid);
    });
  });
  renderNotebookBtn();
}
function renderNotebookBtn() {
  const n = wrongCount();
  $("#btn-notebook").textContent = "📒 错题本" + (n ? " · " + n : "");
}
function openBook(bid) {
  currentBookId = bid;
  const b = BOOKS.find(x => x.id === bid);
  $("#book-heading").textContent = "识字启蒙第一课 · " + b.title;
  const list = $("#chapter-list");
  list.innerHTML = b.chapters.map((c) => {
    const p = progress.chapters[c.id];
    const state = chDone(c.id) ? "⭐" : "▶";
    const sentN = (c.sentenceGroups || c.sentences || []).length + (c.articleTitle ? 1 : 0);
    const sub = c.charList.length + " 字 · " + c.wordsAll.length + " 词 · " + sentN + " 句";
    const flags = p ? (p.learnDone ? "🎴✓ " : "") + (p.listenDone ? "🎧✓ " : "") + (p.readDone ? "🎤✓" : "") : "";
    return '<button class="chapter-row" data-cid="' + c.id + '">' +
      '<div class="ch-num">' + (b.chapters.indexOf(c) + 1) + "</div>" +
      '<div class="ch-body"><b>' + c.title + "</b><small>" + sub + (flags ? " · " + flags : "") + "</small></div>" +
      '<div class="ch-state">' + state + "</div></button>";
  }).join("");
  list.querySelectorAll(".chapter-row").forEach(row => {
    row.addEventListener("click", () => {
      startPlay(row.dataset.cid, "learn");
    });
  });
  show("#screen-chapters");
}
$("#chapters-back").addEventListener("click", () => { renderBooks(); show("#screen-books"); });

const KIND_LABEL = { chars: "字", words: "词", sentences: "句" };
function openNotebook() {
  const entries = Object.entries(progress.wrong).sort((a, b) => b[1].n - a[1].n);
  const total = entries.length;
  $("#nb-summary").innerHTML = total
    ? "共 <b>" + total + "</b> 个错题 · 每个连对 2 次就能「攻克」它<br>点任意条目可以听发音"
    : "";
  $("#nb-start").disabled = total === 0;
  $("#nb-start").textContent = total ? "🎯 开始攻克错题（" + Math.min(total, 8) + " 题）" : "🎯 开始攻克错题";
  $("#nb-list").innerHTML = total === 0
    ? '<div class="nb-empty">🎉 太棒了，错题本是空的！<br>继续加油学习吧</div>'
    : entries.map(([text, w]) => {
      const sentCls = w.kind === "sentences" ? " sent" : "";
      const streakTxt = w.streak > 0 ? "再对 1 次攻克" : "错了 " + w.n + " 次";
      return '<button class="nb-row" data-t="' + encodeURIComponent(text) + '">' +
        '<span class="nb-text hanzi' + (text.length > 4 ? " long" : "") + '">' + text + "</span>" +
        '<span class="nb-kind' + sentCls + '">' + (KIND_LABEL[w.kind] || "字") + "</span>" +
        '<span class="nb-info">' + streakTxt + "</span>" +
        '<span class="nb-streak">' + (w.streak > 0 ? "⭐" : "") + "</span>" +
        '<span style="font-size:20px">🔊</span></button>';
    }).join("");
  $("#nb-list").querySelectorAll(".nb-row").forEach(row => {
    row.addEventListener("click", () => speak(decodeURIComponent(row.dataset.t)));
  });
  show("#screen-notebook");
}
function taskIcon(t) {
  if (t.icon) return t.icon;
  if (t.id === "write-page") return "✍️";
  if (t.id === "math-page") return "🔢";
  return "⭐";
}
function formatLogTime(t) {
  try {
    const d = new Date(t);
    const m = d.getMonth() + 1, day = d.getDate();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return m + "/" + day + " " + hh + ":" + mm;
  } catch (e) { return ""; }
}
function coinLogTotals() {
  let earned = 0, spent = 0;
  (progress.coinLog || []).forEach(x => {
    if (x.n > 0) earned += x.n;
    else spent += -x.n;
  });
  return { earned, spent };
}
function renderCoinLog() {
  const log = (progress.coinLog || []).slice().reverse().slice(0, 80);
  const hint = $("#coin-log-hint");
  if (hint) hint.textContent = log.length ? ("最近 " + log.length + " 条") : "";
  const box = $("#coin-log");
  if (!box) return;
  if (!log.length) {
    box.innerHTML = '<div class="coin-log-empty">还没有金币记录<br>去学习、做任务或兑奖后会出现在这里</div>';
    return;
  }
  box.innerHTML = log.map(x => {
    const plus = x.n > 0;
    const delta = (plus ? "+" : "") + x.n;
    return '<div class="coin-log-row">' +
      '<div class="cl-delta ' + (plus ? "plus" : "minus") + '">' + coinHtml() + ' ' + delta + "</div>" +
      '<div class="cl-body"><strong>' + x.reason + "</strong><small>" + formatLogTime(x.t) + "</small></div>" +
      "</div>";
  }).join("");
}
function renderCoinsSummary() {
  const el = $("#coins-summary");
  if (!el) return;
  const { earned, spent } = coinLogTotals();
  const cashed = totalCashedYuan(progress);
  el.innerHTML =
    '<div class="cash-pill"><div class="cp-label">当前余额</div><div class="cp-val">' + coinHtml() + ' ' + (progress.coins || 0) + "</div></div>" +
    '<div class="cash-pill saved"><div class="cp-label">累计获得</div><div class="cp-val">+' + earned + "</div></div>" +
    '<div class="cash-pill spent"><div class="cp-label">累计消耗</div><div class="cp-val">−' + spent + "</div></div>" +
    (cashed ? '<div class="cash-pill saved"><div class="cp-label">已兑现金</div><div class="cp-val">¥' + cashed + "</div></div>" : "");
}
function openCoinsLog() {
  hideModal();
  renderCoinsSummary();
  renderCoinLog();
  renderCoins();
  show("#screen-coins");
}
function renderTaskList() {
  const list = $("#task-list");
  const tasks = progress.extraTasks || [];
  if (!tasks.length) {
    list.innerHTML = '<div class="task-empty">暂无任务，可在下方添加自定义任务</div>';
    return;
  }
  list.innerHTML = tasks.map(t => {
    return '<div class="task-card" data-tid="' + t.id + '">' +
      '<div class="tk-icon">' + taskIcon(t) + "</div>" +
      '<div class="tk-body"><div class="tk-title">' + t.title + '</div>' +
      '<div class="tk-reward">' + coinHtml() + ' +' + t.coins + "</div></div>" +
      '<div class="tk-actions">' +
      '<button class="tk-claim" data-act="claim">领取</button>' +
      '<div class="tk-mini-row">' +
      '<button class="tk-mini" data-act="edit">修改</button>' +
      '<button class="tk-mini" data-act="del">删除</button>' +
      "</div></div></div>";
  }).join("");
  list.querySelectorAll(".task-card").forEach(card => {
    const id = card.dataset.tid;
    card.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "claim") claimExtraTask(id, btn);
        else if (act === "edit") editExtraTask(id);
        else if (act === "del") deleteExtraTask(id);
      });
    });
  });
}
function openTasks() {
  renderTaskList();
  renderCoins();
  show("#screen-tasks");
}
function claimExtraTask(id, btn) {
  const t = (progress.extraTasks || []).find(x => x.id === id);
  if (!t) return;
  showModal(
    '<div class="m-emoji">' + taskIcon(t) + "</div><h3>确认完成？</h3>" +
    "<p>「" + t.title + "」完成后领取 " + coinHtml() + " +" + t.coins + "</p>" +
    '<p class="sv-tip">请家长确认孩子确实完成后再点领取</p>' +
    '<div class="m-btns">' +
    '<button class="mbtn primary" id="tk-yes">确认领取</button>' +
    '<button class="mbtn ghost" onclick="hideModal()">取消</button>' +
    "</div>"
  );
  $("#tk-yes").addEventListener("click", () => {
    hideModal();
    addCoins(t.coins, btn, "任务：" + t.title);
    showToast("✨ 「" + t.title + "」+" + COIN_TXT + " " + t.coins);
  });
}
function addExtraTask() {
  const title = ($("#task-title").value || "").trim();
  const coins = Math.floor(Number($("#task-coins").value));
  if (!title) { showToast("请填写任务名称"); return; }
  if (!coins || coins < 1 || coins > 9999) { showToast("金币请填 1～9999"); return; }
  if (!progress.extraTasks) progress.extraTasks = [];
  progress.extraTasks.push({ id: "t-" + Date.now(), title: title, coins: coins, icon: "⭐" });
  store.save();
  $("#task-title").value = "";
  $("#task-coins").value = "";
  renderTaskList();
  showToast("已添加任务");
}
function editExtraTask(id) {
  const t = (progress.extraTasks || []).find(x => x.id === id);
  if (!t) return;
  showModal(
    '<div class="m-emoji">✏️</div><h3>修改任务</h3>' +
    '<input class="task-input" id="edit-title" style="width:100%" maxlength="40" value="" />' +
    '<div class="task-add-row" style="width:100%;margin-top:8px">' +
    '<input class="task-input coins" id="edit-coins" type="number" min="1" max="9999" inputmode="numeric" />' +
    '<span style="align-self:center;font-weight:700;color:var(--ink-soft)">金币</span></div>' +
    '<div class="m-btns">' +
    '<button class="mbtn primary" id="edit-save">保存</button>' +
    '<button class="mbtn ghost" onclick="hideModal()">取消</button>' +
    "</div>"
  );
  $("#edit-title").value = t.title;
  $("#edit-coins").value = t.coins;
  $("#edit-save").addEventListener("click", () => {
    const title = ($("#edit-title").value || "").trim();
    const coins = Math.floor(Number($("#edit-coins").value));
    if (!title) { showToast("请填写任务名称"); return; }
    if (!coins || coins < 1 || coins > 9999) { showToast("金币请填 1～9999"); return; }
    t.title = title;
    t.coins = coins;
    store.save();
    hideModal();
    renderTaskList();
    showToast("已保存修改");
  });
}
function deleteExtraTask(id) {
  const t = (progress.extraTasks || []).find(x => x.id === id);
  if (!t) return;
  showModal(
    '<div class="m-emoji">🗑️</div><h3>删除任务？</h3>' +
    "<p>确定删除「" + t.title + "」吗？</p>" +
    '<div class="m-btns">' +
    '<button class="mbtn primary" id="tk-del-yes" style="background:linear-gradient(135deg,#FF7B7B,var(--red));box-shadow:0 4px 0 var(--red-d)">删除</button>' +
    '<button class="mbtn ghost" onclick="hideModal()">取消</button>' +
    "</div>"
  );
  $("#tk-del-yes").addEventListener("click", () => {
    progress.extraTasks = (progress.extraTasks || []).filter(x => x.id !== id);
    store.save();
    hideModal();
    renderTaskList();
    showToast("已删除");
  });
}
$("#btn-notebook").addEventListener("click", openNotebook);
$("#btn-tasks").addEventListener("click", openTasks);
$("#btn-cash").addEventListener("click", openCashShop);
$("#btn-voice").addEventListener("click", openVoicePicker);
$("#btn-save").addEventListener("click", openSave);
$("#nb-back").addEventListener("click", () => { renderBooks(); show("#screen-books"); });
$("#tasks-back").addEventListener("click", () => { renderBooks(); show("#screen-books"); });
$("#coins-back").addEventListener("click", () => {
  const back = coinsBackScreen || "#screen-books";
  if (back === "#screen-tasks") openTasks();
  else if (back === "#screen-notebook") openNotebook();
  else if (back === "#screen-chapters") {
    show("#screen-chapters");
    renderCoins();
  } else if (back === "#screen-play") {
    show("#screen-play");
    renderCoins();
  } else {
    renderBooks();
    show("#screen-books");
  }
});
$("#task-add-btn").addEventListener("click", addExtraTask);
$("#nb-start").addEventListener("click", () => { if (wrongCount()) startNotebook(); });

let session = null;
function poolFor(kind, chapter) {
  let pool = kind === "chars" ? [...chapter.charList] : [...chapter.wordsAll];
  if (pool.length < 4) {
    prevChapters(chapter.id).forEach(pc => {
      const extra = kind === "chars" ? pc.charList : pc.wordsAll;
      extra.forEach(x => { if (!pool.includes(x)) pool.push(x); });
    });
  }
  return pool;
}
function poolForSafe(kind, cid) {
  let pool = [];
  const entry = cid ? findChapter(cid) : null;
  if (entry) pool = poolFor(kind, entry.chapter);
  if (pool.length < 4) {
    BOOKS.forEach(b => b.chapters.forEach(c => {
      (kind === "chars" ? c.charList : c.wordsAll).forEach(x => { if (!pool.includes(x)) pool.push(x); });
    }));
  }
  return pool;
}
function buildListenQuestions(chapter) {
  const qs = chapter.charList.map(x => ({ ui: "listen", kind: "chars", target: x, cid: chapter.id }))
    .concat(chapter.wordsAll.map(x => ({ ui: "listen", kind: "words", target: x, cid: chapter.id })));
  return shuffle(qs);
}
function buildReadItems(chapter) {
  const sentQs = [];
  if (chapter.articleTitle) {
    sentQs.push({
      ui: "read", kind: "sentences", target: chapter.articleTitle, cid: chapter.id,
      sentGroup: -1, partIndex: 0, groupSize: 1, isTitle: true
    });
  }
  (chapter.sentenceGroups || []).forEach((group, gi) => {
    group.forEach((part, pi) => {
      sentQs.push({
        ui: "read", kind: "sentences", target: part, cid: chapter.id,
        sentGroup: gi, partIndex: pi, groupSize: group.length
      });
    });
  });
  return shuffle([...chapter.charList]).map(x => ({ ui: "read", kind: "chars", target: x, cid: chapter.id }))
    .concat(shuffle([...chapter.wordsAll]).map(x => ({ ui: "read", kind: "words", target: x, cid: chapter.id })))
    .concat(sentQs);
}
/** Runtime qs objects; durable copy lives in progress.play for save/import */
const playCache = {};
function serializePlayOrder(mode, qs) {
  if (mode === "learn") return qs.map(q => ({ ch: q.target && q.target.ch }));
  if (mode === "listen") return qs.map(q => ({ kind: q.kind, target: q.target }));
  return qs.map(q => ({
    kind: q.kind,
    target: q.target,
    sentGroup: q.sentGroup,
    partIndex: q.partIndex,
    groupSize: q.groupSize
  }));
}
function rebuildPlayQs(chapter, mode, order) {
  if (!Array.isArray(order) || !order.length) return null;
  const cid = chapter.id;
  if (mode === "learn") {
    const qs = order.map(o => {
      const ch = typeof o === "string" ? o : o && o.ch;
      const c = chapter.chars.find(x => x.ch === ch);
      return c ? { ui: "learn", kind: "learn", target: c, cid } : null;
    });
    return qs.every(Boolean) && qs.length === chapter.chars.length ? qs : null;
  }
  if (mode === "listen") {
    const qs = order.map(o => {
      if (!o || (o.kind !== "chars" && o.kind !== "words") || typeof o.target !== "string") return null;
      const pool = o.kind === "chars" ? chapter.charList : chapter.wordsAll;
      if (!pool.includes(o.target)) return null;
      return { ui: "listen", kind: o.kind, target: o.target, cid };
    });
    return qs.every(Boolean) ? qs : null;
  }
  const qs = order.map(o => {
    if (!o || typeof o.target !== "string") return null;
    if (o.kind === "chars" && chapter.charList.includes(o.target)) {
      return { ui: "read", kind: "chars", target: o.target, cid };
    }
    if (o.kind === "words" && chapter.wordsAll.includes(o.target)) {
      return { ui: "read", kind: "words", target: o.target, cid };
    }
    if (o.kind === "sentences") {
      if (o.sentGroup === -1 && chapter.articleTitle && o.target === chapter.articleTitle) {
        return {
          ui: "read", kind: "sentences", target: o.target, cid,
          sentGroup: -1, partIndex: 0, groupSize: 1, isTitle: true
        };
      }
      const g = chapter.sentenceGroups && chapter.sentenceGroups[o.sentGroup];
      if (!g || g[o.partIndex] !== o.target) return null;
      return {
        ui: "read", kind: "sentences", target: o.target, cid,
        sentGroup: o.sentGroup, partIndex: o.partIndex, groupSize: o.groupSize != null ? o.groupSize : g.length
      };
    }
    return null;
  });
  return qs.every(Boolean) ? qs : null;
}
function savePlayCache() {
  if (!session || !session.chapter || session.from === "notebook") return;
  const cid = session.chapter.id;
  const mode = session.mode;
  const snap = {
    qs: session.qs,
    order: serializePlayOrder(mode, session.qs),
    visited: Array.from(session.visited || []),
    idx: session.idx,
    score: session.score || 0,
    coins: session.coins || 0
  };
  if (!playCache[cid]) playCache[cid] = {};
  playCache[cid][mode] = snap;
  if (!progress.play) progress.play = {};
  if (!progress.play[cid]) progress.play[cid] = {};
  progress.play[cid][mode] = {
    order: snap.order,
    visited: snap.visited,
    idx: snap.idx,
    score: snap.score,
    coins: snap.coins
  };
  store.save();
}
function startPlay(cid, mode) {
  stopRec();
  if (session && session.chapter && session.chapter.id === cid && session.mode !== mode) savePlayCache();
  currentCid = cid;
  const { chapter } = findChapter(cid);
  if (!playCache[cid]) playCache[cid] = {};
  const cached = playCache[cid][mode];
  const saved = progress.play && progress.play[cid] && progress.play[cid][mode];
  let qs, idx, visited, score, coins;
  if (cached && Array.isArray(cached.qs) && cached.qs.length) {
    qs = cached.qs;
    idx = Math.min(Math.max(0, cached.idx || 0), qs.length - 1);
    visited = new Set(cached.visited || [0]);
    visited.add(idx);
    score = cached.score || 0;
    coins = cached.coins || 0;
  } else if (saved && Array.isArray(saved.order)) {
    qs = rebuildPlayQs(chapter, mode, saved.order);
    if (qs) {
      idx = Math.min(Math.max(0, saved.idx || 0), qs.length - 1);
      visited = new Set((saved.visited || []).filter(i => i >= 0 && i < qs.length));
      visited.add(idx);
      score = saved.score || 0;
      coins = saved.coins || 0;
    }
  }
  if (!qs) {
    if (mode === "learn") qs = chapter.chars.map(c => ({ ui: "learn", kind: "learn", target: c, cid }));
    else if (mode === "listen") qs = buildListenQuestions(chapter);
    else qs = buildReadItems(chapter);
    idx = 0;
    visited = new Set([0]);
    score = 0;
    coins = 0;
  }
  session = { chapter, mode, qs, idx, score, coins, wrongThis: false, token: 0, listening: false, from: null, conquered: 0, visited };
  savePlayCache();
  $("#play-tabs").style.display = "flex";
  $("#tab-learn").classList.toggle("on", mode === "learn");
  $("#tab-listen").classList.toggle("on", mode === "listen");
  $("#tab-read").classList.toggle("on", mode === "read");
  show("#screen-play");
  renderRound();
}
function startNotebook() {
  stopRec();
  const items = Object.entries(progress.wrong).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  if (!items.length) return;
  const qs = items.map(([text, w], i) => {
    if (w.kind === "sentences") return { ui: "read", kind: "sentences", target: text, cid: w.cid };
    if (i % 2 === 0) return { ui: "listen", kind: w.kind, target: text, cid: w.cid, pool: poolForSafe(w.kind, w.cid) };
    return { ui: "read", kind: w.kind, target: text, cid: w.cid };
  });
  session = { chapter: null, mode: "notebook", qs, idx: 0, score: 0, coins: 0, wrongThis: false, token: 0, listening: false, from: "notebook", conquered: 0, visited: new Set([0]) };
  $("#play-tabs").style.display = "none";
  show("#screen-play");
  renderRound();
}
function renderRound() {
  if (!session) return;
  stopRec();
  session.wrongThis = false;
  session.listening = false;
  renderDots($("#play-dots"), session.qs.length, session.idx);
  const q = session.qs[session.idx];
  if (q.ui === "learn") renderLearnQ();
  else if (q.ui === "listen") renderListenQ();
  else renderReadQ();
}

function renderLearnQ() {
  const item = session.qs[session.idx].target;
  const isLast = session.idx === session.qs.length - 1;
  $("#play-body").innerHTML =
    '<div class="q-hint">🎴 点一点大字，听一听发音</div>' +
    '<div class="land-split"><div class="land-left">' +
    '<button class="learn-card" id="learn-card">' +
    '<div class="lc-char hanzi">' + item.ch + "</div>" +
    (item.py ? '<div class="lc-py">' + item.py + "</div>" : "") +
    '<div class="lc-tip">🔊 点我听发音</div></button>' +
    '</div><div class="land-right">' +
    '<div class="words-title">—— 常用词语 · 点一点听一听 ——</div>' +
    '<div class="word-chips">' +
    item.words.map(w => '<button class="wchip hanzi" data-w="' + w + '">' + w + " 🔊</button>").join("") +
    "</div>" +
    '<div class="learn-nav">' +
    '<button class="navbtn" id="ln-prev"' + (session.idx === 0 ? " disabled" : "") + ">← 上一个</button>" +
    '<button class="navbtn primary" id="ln-next">' + (isLast ? "认完啦 ✔" : "下一个 →") + "</button>" +
    "</div>" +
    "</div></div>";
  $("#learn-card").addEventListener("click", () => speak(item.ch));
  $("#play-body").querySelectorAll(".wchip").forEach(chip => {
    chip.addEventListener("click", () => speak(chip.dataset.w));
  });
  $("#ln-prev").addEventListener("click", () => {
    if (session.idx > 0) { session.idx--; renderRound(); }
  });
  $("#ln-next").addEventListener("click", () => {
    if (session.idx < session.qs.length - 1) {
      session.idx++;
      renderRound();
      speak(session.qs[session.idx].target.ch);
    } else {
      endSession();
    }
  });
  const t = ++session.token;
  setTimeout(() => { if (session && session.token === t) speak(item.ch); }, 400);
}

function renderListenQ() {
  const q = session.qs[session.idx];
  const basePool = q.pool ? q.pool : poolFor(q.kind, session.chapter);
  const pool = basePool.filter(x => x !== q.target);
  const distractors = shuffle(pool).slice(0, 3);
  const options = shuffle([q.target, ...distractors]);
  const isWord = q.kind === "words";
  const hintPrefix = session.mode === "notebook" ? "📒 错题攻克 · " : "👂 ";
  $("#play-body").innerHTML =
    '<div class="q-hint">' + hintPrefix + "听一听，点出正确的" + (isWord ? "词语" : "汉字") + "</div>" +
    '<div class="listen-layout">' +
    '<button class="speak-big" id="q-speak">🔊</button>' +
    '<div class="opt-grid">' +
    options.map(x => '<button class="opt hanzi' + (isWord ? (x.length >= 3 ? " word long" : " word") : "") + '" data-v="' + x + '">' + x + "</button>").join("") +
    "</div>" +
    '<div class="score-line">第 ' + (session.idx + 1) + " / " + session.qs.length + " 题 · 已答对 " + session.score + " 题</div>" +
    "</div>";
  $("#q-speak").addEventListener("click", () => speak(q.target));
  const t = ++session.token;
  setTimeout(() => { if (session && session.token === t) speak(q.target); }, 350);
  $("#play-body").querySelectorAll(".opt").forEach(btn => {
    btn.addEventListener("click", () => answerListen(btn, btn.dataset.v));
  });
}
function answerListen(btn, v) {
  const q = session.qs[session.idx];
  if (v === q.target) {
    btn.classList.add("correct");
    soundCorrect();
    popStarsOn(btn);
    const firstTry = !session.wrongThis;
    if (firstTry) session.score++;
    addCoins(firstTry ? 2 : 1, btn, firstTry ? "听音选选：答对" : "听音选选：订正");
    if (session.mode === "notebook" && firstTry) {
      if (handleItemCorrect(q.target)) {
        session.conquered++;
        showToast("🎉 「" + q.target + "」攻克啦！");
      }
    }
    $("#play-body").querySelectorAll(".opt").forEach(b => b.classList.add("disabled"));
    const t = ++session.token;
    setTimeout(() => {
      if (!session || session.token !== t) return;
      session.idx++;
      if (session.idx >= session.qs.length) endSession();
      else renderRound();
    }, 900);
  } else {
    btn.classList.add("wrong");
    soundWrong();
    setTimeout(() => btn.classList.remove("wrong"), 450);
    btn.classList.add("disabled");
    session.wrongThis = true;
    handleItemWrong(q.target, q.kind, q.cid || (session.chapter && session.chapter.id));
  }
}

const READ_PAGE_SIZE = { chars: 8, words: 6, sentences: 6 };
function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function unitAudioBtn(text) {
  return '<button type="button" class="unit-audio" data-t="' + escapeAttr(text) + '" aria-label="听示范">🔊</button>';
}
function bindUnitAudioButtons(root) {
  (root || document).querySelectorAll(".unit-audio").forEach(btn => {
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      const t = btn.getAttribute("data-t");
      if (t) speak(t);
    });
  });
}
function renderSentenceFlow(pStart, pEnd) {
  let html = '<div class="sent-flow">';
  let lastGroup = null;
  for (let i = pStart; i < pEnd; i++) {
    const item = session.qs[i];
    const gi = item.sentGroup;
    if (gi !== lastGroup) {
      if (lastGroup !== null) html += "</div>";
      if (lastGroup !== null) html += '<div class="sent-group-sep" aria-hidden="true"></div>';
      html += '<div class="sent-group' + (item.isTitle ? " sent-title" : "") + '">';
      lastGroup = gi;
    }
    const st = i < session.idx ? " done" : i === session.idx ? " now" : "";
    const titleCls = item.isTitle ? " is-title" : "";
    html += '<span class="pg-item hanzi s-sentence' + st + titleCls + '">' + item.target + unitAudioBtn(item.target) + "</span>";
  }
  if (lastGroup !== null) html += "</div>";
  html += "</div>";
  return html;
}
function groupEndIndex(from, gEnd) {
  let end = from;
  const gi = session.qs[from].sentGroup;
  while (end < gEnd && session.qs[end + 1] && session.qs[end + 1].sentGroup === gi) end++;
  return end;
}
function measureSentenceBlock(pStart, pEnd, widthPx) {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;pointer-events:none;width:" + widthPx + "px";
  probe.innerHTML = renderSentenceFlow(pStart, pEnd);
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}
function readContentBudget() {
  const screen = $("#screen-play");
  const top = screen.querySelector(".topbar");
  const tabs = $("#play-tabs");
  const padY = (parseFloat(getComputedStyle(screen).paddingTop) || 0) + (parseFloat(getComputedStyle(screen).paddingBottom) || 0);
  let h = (screen.clientHeight || window.innerHeight) - padY;
  if (top) h -= top.offsetHeight;
  if (tabs && getComputedStyle(tabs).display !== "none") h -= tabs.offsetHeight;
  h -= 48; // q-hint
  h -= 118; // read-controls
  h -= 28; // gaps
  return Math.max(120, h);
}
function fitSentencePage(idx, gStart, gEnd) {
  const wrap = $("#play-body");
  const widthPx = Math.max(240, (wrap && wrap.clientWidth) || Math.min(720, window.innerWidth - 40));
  const budget = readContentBudget();
  let cursor = gStart;
  while (cursor <= gEnd) {
    const pageStart = cursor;
    let pageEnd = groupEndIndex(pageStart, gEnd);
    let grow = pageEnd;
    while (grow < gEnd) {
      const nextEnd = groupEndIndex(grow + 1, gEnd);
      if (measureSentenceBlock(pageStart, nextEnd + 1, widthPx) <= budget) {
        grow = nextEnd;
      } else break;
    }
    pageEnd = grow;
    if (idx >= pageStart && idx <= pageEnd) return { pStart: pageStart, pEnd: pageEnd + 1 };
    cursor = pageEnd + 1;
  }
  return { pStart: idx, pEnd: idx + 1 };
}
function renderReadQ() {
  const q = session.qs[session.idx];
  let gStart = session.idx;
  while (gStart > 0 && session.qs[gStart - 1].kind === q.kind && session.qs[gStart - 1].ui === q.ui) gStart--;
  let gEnd = session.idx;
  while (gEnd + 1 < session.qs.length && session.qs[gEnd + 1].kind === q.kind && session.qs[gEnd + 1].ui === q.ui) gEnd++;
  let pStart, pEnd;
  if (q.kind === "sentences") {
    const page = fitSentencePage(session.idx, gStart, gEnd);
    pStart = page.pStart;
    pEnd = page.pEnd;
  } else {
    const pageSize = READ_PAGE_SIZE[q.kind] || 6;
    pStart = gStart + Math.floor((session.idx - gStart) / pageSize) * pageSize;
    pEnd = Math.min(pStart + pageSize, gEnd + 1);
  }
  const kindLabel = KIND_LABEL[q.kind] === "字" ? "汉字" : KIND_LABEL[q.kind] === "词" ? "词语" : "句子";
  const sizeCls = q.kind === "chars" ? "s-char" : q.kind === "words" ? "s-word" : "s-sentence";
  const gridCls = q.kind === "chars" ? "g-chars" : q.kind === "words" ? "g-words" : "g-sentences";
  const useMic = (SR || NATIVE) && !srBroken && !parentJudge;
  const hintPrefix = session.mode === "notebook" ? "📒 错题攻克 · " : "🎤 ";
  let cells;
  if (q.kind === "sentences") {
    cells = renderSentenceFlow(pStart, pEnd);
  } else {
    cells = "";
    for (let i = pStart; i < pEnd; i++) {
      const st = i < session.idx ? " done" : i === session.idx ? " now" : "";
      const t = session.qs[i].target;
      cells += '<div class="pg-item hanzi ' + sizeCls + st + '"><span class="pg-text">' + t + "</span>" + unitAudioBtn(t) + "</div>";
    }
    cells = '<div class="page-grid ' + gridCls + '">' + cells + "</div>";
  }
  let html =
    '<div class="q-hint">' + hintPrefix + "读一读这一页的" + kindLabel + "，从黄框的开始" +
    ' <span class="q-score">第 ' + (session.idx + 1) + " / " + session.qs.length + " 个 · 已读对 " + session.score + " 个</span></div>" +
    '<div class="read-layout">' +
    '<div class="read-grid-wrap">' + cells + "</div>" +
    '<div class="read-controls">' +
    '<div class="rc-action" id="rc-action">' +
    (useMic
      ? '<button class="mic-btn" id="mic-btn">🎤</button>'
      : '<div class="judge-row"><button class="judge no" id="judge-no">✗</button><button class="judge yes" id="judge-yes">✓</button></div>') +
    "</div>" +
    '<div class="rc-mid">' +
    '<div class="mic-status" id="mic-status">' + (useMic ? "点麦克风，开始朗读" : "请孩子大声读，家长点 ✓ 或 ✗ 评判") + "</div>" +
    '<div class="rc-links">' +
    '<button class="switch-link" id="demo-btn">🔊 听当前</button>' +
    (useMic
      ? '<button class="switch-link" id="switch-parent">识别不了？改用家长评判</button>'
      : (SR && parentJudge ? '<button class="switch-link" id="switch-mic">换回系统判读</button>' : "")) +
    "</div>" +
    "</div>" +
    "</div></div>";
  $("#play-body").innerHTML = html;
  bindUnitAudioButtons($("#play-body"));
  $("#demo-btn").addEventListener("click", () => speak(q.target));
  if (useMic) {
    $("#mic-btn").addEventListener("click", startMic);
    $("#switch-parent").addEventListener("click", () => { parentJudge = true; renderReadQ(); });
  } else {
    $("#judge-yes").addEventListener("click", () => judgeByParent(true));
    $("#judge-no").addEventListener("click", () => judgeByParent(false));
    const back = $("#switch-mic");
    if (back) back.addEventListener("click", () => { parentJudge = false; renderReadQ(); });
  }
}
function onReadCorrect(sourceEl) {
  const q = session.qs[session.idx];
  session.score++;
  soundCorrect();
  if (sourceEl) popStarsOn(sourceEl);
  addCoins(2, sourceEl, "读一读：读对");
  if (session.mode === "notebook") {
    if (handleItemCorrect(q.target)) {
      session.conquered++;
      showToast("🎉 「" + q.target + "」攻克啦！");
    }
  }
}
function onReadWrong() {
  const q = session.qs[session.idx];
  soundWrong();
  handleItemWrong(q.target, q.kind, q.cid || (session.chapter && session.chapter.id));
}
function judgeByParent(ok) {
  const yes = $("#judge-yes"), no = $("#judge-no");
  if (yes) yes.style.pointerEvents = "none";
  if (no) no.style.pointerEvents = "none";
  const card = $(".pg-item.now");
  if (ok) onReadCorrect(card);
  else onReadWrong();
  advanceRead();
}
function startMic() {
  if (!session) return;
  if (session.listening) { if (NATIVE) nativeCall({ action: "sttStop" }); else { try { if (rec) rec.stop(); } catch (e) {} } return; }
  const q = session.qs[session.idx];
  session.listening = true;
  const btn = $("#mic-btn"), status = $("#mic-status");
  if (btn) { btn.classList.add("listening"); btn.textContent = "⏹"; }
  if (status) status.textContent = "正在听…读完后再点一次可结束";
  listenOnce(
    (alts) => {
      if (!session) return;
      session.listening = false;
      if (btn) { btn.classList.remove("listening"); btn.textContent = "🎤"; }
      if (isMatch(alts, q.target)) {
        const card = $(".pg-item.now");
        if (card) card.style.border = "4px solid var(--green)";
        if (status) status.textContent = "✅ 读对啦！";
        onReadCorrect(card);
        advanceRead();
      } else {
        onReadWrong();
        let heard = alts.map(normText).filter(Boolean)[0] || "（没听清）";
        if (heard.length > 14) heard = heard.slice(0, 14) + "…";
        if (status) { status.textContent = "❌ 我听到的是「" + heard + "」，再试一次？"; status.classList.add("heard-bad"); }
        showRetryRow();
      }
    },
    (code) => {
      if (!session) return;
      session.listening = false;
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture" || code === "network" || code === "unsupported" || code === "start-fail") {
        srBroken = true;
        showToast("系统判读不可用，已切换为家长评判");
        renderReadQ();
      } else {
        if (btn) { btn.classList.remove("listening"); btn.textContent = "🎤"; }
        if (status) { status.textContent = "没听到声音，点麦克风再试一次"; }
      }
    }
  );
}
function showRetryRow() {
  const slot = $("#rc-action");
  if (!slot) return;
  slot.innerHTML =
    '<div class="rc-retry">' +
    '<button class="rbtn primary" id="retry-btn">🔁 再读一次</button>' +
    '<button class="rbtn" id="skip-btn">跳过 →</button></div>';
  $("#retry-btn").addEventListener("click", () => { renderReadQ(); });
  $("#skip-btn").addEventListener("click", () => { advanceRead(); });
}
function advanceRead() {
  const t = ++session.token;
  setTimeout(() => {
    if (!session || session.token !== t) return;
    session.idx++;
    if (session.idx >= session.qs.length) endSession();
    else renderRound();
  }, 800);
}
function endSession() {
  if (session.mode === "notebook") {
    const left = wrongCount();
    const canMore = left > 0;
    soundWin();
    if (session.conquered > 0) confetti();
    let btns = "";
    if (canMore) btns += '<button class="mbtn primary" onclick="hideModal();startNotebook()">🎯 继续攻克（还剩 ' + left + " 个）</button>";
    btns += '<button class="mbtn ghost" onclick="hideModal();openNotebook()">返回错题本</button>';
    showModal(
      '<div class="m-emoji">📒</div><h3>本轮复习完成！</h3>' +
      "<p>答对 " + session.score + " / " + session.qs.length + " 题 · 攻克 " + session.conquered + " 个错题 · 获得 " + coinHtml() + " +" + session.coins + "</p>" +
      '<div class="m-btns">' + btns + "</div>"
    );
    return;
  }
  const cid = session.chapter.id;
  const p = chProg(cid);
  const wasAllDone = chDone(cid);
  let bonus = 0;
  if (session.mode === "learn" && !p.learnDone) bonus = 5;
  if (session.mode === "listen" && !p.listenDone) bonus = 10;
  if (session.mode === "read" && !p.readDone) bonus = 10;
  if (session.mode === "learn") p.learnDone = true;
  else if (session.mode === "listen") p.listenDone = true;
  else p.readDone = true;
  const allDone = chDone(cid);
  if (allDone && !wasAllDone) bonus += 20;
  store.save();
  if (bonus > 0) {
    let why = "环节奖励";
    if (session.mode === "learn") why = "认一认：完成";
    else if (session.mode === "listen") why = "听音选选：完成";
    else if (session.mode === "read") why = "读一读：完成";
    if (allDone && !wasAllDone) why = "本课全部完成";
    addCoins(bonus, null, why);
  }
  const gi = globalIdx(cid);
  const hasNext = gi + 1 < FLAT.length;
  let title, desc, mainBtn;
  if (session.mode === "learn") {
    title = "新字认完啦！";
    desc = "认识了 " + session.qs.length + " 个新字";
    mainBtn = '<button class="mbtn primary" onclick="hideModal();startPlay(\'' + cid + '\', \'listen\')">🎧 去「听音选选」</button>';
    soundCorrect();
  } else {
    const modeName = session.mode === "listen" ? "听音选选" : "读一读";
    desc = modeName + "：答对 " + session.score + " / " + session.qs.length + " 个";
    if (session.mode === "listen") {
      title = "听得真准！";
      mainBtn = '<button class="mbtn primary" onclick="hideModal();startPlay(\'' + cid + '\', \'read\')">🎤 去「读一读」</button>';
    } else {
      title = allDone ? "这一课全部完成！" : "读得真棒！";
      mainBtn = "";
    }
    if (allDone) { soundWin(); confetti(); } else { soundCorrect(); }
  }
  desc += " · 获得 " + COIN_TXT + " +" + session.coins;
  if (allDone && hasNext) {
    const next = FLAT[gi + 1];
    mainBtn += '<button class="mbtn primary" style="background:linear-gradient(135deg,#4f8cff,#8b5cf6)" onclick="hideModal();startPlay(\'' + next.chapter.id + '\', \'learn\')">下一课：' + next.chapter.title + "</button>";
  }
  const backBtn = '<button class="mbtn ghost" onclick="hideModal();openBook(\'' + currentBookId + '\')">返回课程列表</button>';
  showModal(
    '<div class="m-emoji">' + (allDone ? "🎉" : "⭐") + "</div>" +
    "<h3>" + title + "</h3><p>" + desc + (allDone ? "，获得本课星星 ⭐" : "") + "</p>" +
    '<div class="m-btns">' + mainBtn + backBtn + "</div>"
  );
}
$("#tab-learn").addEventListener("click", () => { if (session) startPlay(currentCid, "learn"); });
$("#tab-listen").addEventListener("click", () => { if (session) startPlay(currentCid, "listen"); });
$("#tab-read").addEventListener("click", () => { if (session) startPlay(currentCid, "read"); });
$("#play-back").addEventListener("click", () => {
  stopRec();
  const from = session && session.from;
  if (session) {
    savePlayCache();
    session.token++;
  }
  session = null;
  if (from === "notebook") openNotebook();
  else openBook(currentBookId);
});

$("#btn-reset").addEventListener("click", () => {
  if (confirm("确定要清空全部学习进度（含金币、任务、兑奖记录和错题本）吗？")) {
    localStorage.removeItem(store.key);
    progress = store.load();
    Object.keys(playCache).forEach(k => delete playCache[k]);
    renderBooks();
    renderCoins();
    showToast("进度已重置");
  }
});

(function makeStars() {
  const layer = $("#stars");
  const colors = ["#FFC93C", "#FF9F1C", "#1CB0F6", "#58CC02", "#A560FF", "#FF7BAC"];
  for (let i = 0; i < 26; i++) {
    const d = document.createElement("div");
    d.className = "star";
    const sz = Math.random() * 7 + 5;
    d.style.width = d.style.height = sz + "px";
    d.style.left = Math.random() * 100 + "%";
    d.style.top = Math.random() * 100 + "%";
    d.style.background = colors[i % colors.length];
    d.style.animationDelay = (Math.random() * 5) + "s";
    d.style.animationDuration = (4 + Math.random() * 3) + "s";
    layer.appendChild(d);
  }
})();

renderBooks();
renderCoins();
