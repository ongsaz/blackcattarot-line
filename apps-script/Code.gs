/**
 * Black Cat Tarot – LINE bot (Google Apps Script)
 *
 * ทำอะไรได้:
 *  - แอดเพื่อนครั้งแรก ได้สิทธิ์ถามไพ่ 4 ใบฟรี 1 คำถาม (ทำนายด้วย Gemini)
 *  - ไพ่ประจำวันฟรี วันละ 1 ใบ (คำทำนายจากแท็บ daily)
 *  - พิมพ์คุยอะไรก็ได้ แมวตอบด้วย AI แล้วชวนดูไพ่ (จำกัดต่อวัน เกินแล้วใช้คำตอบสำเร็จรูป)
 *  - ข้อความทั้งหมดเป็นการ "ตอบกลับ" (reply) จึงไม่กินโควตาข้อความของ LINE OA
 *
 * ตั้งค่าใน Project Settings → Script Properties:
 *  LINE_CHANNEL_ACCESS_TOKEN  Token จาก LINE Developers (Messaging API)
 *  GEMINI_API_KEY             API key จาก Google AI Studio (ถ้าใช้รุ่นของ Google)
 *  OPENAI_API_KEY             API key จาก platform.openai.com (ถ้าใช้รุ่นของ OpenAI)
 *
 *  ชื่อรุ่น: "gpt-..." = OpenAI | "gemini-..." / "gemma-..." = Google | "mock" = ไม่ใช้ AI (ทดสอบฟรี)
 *  READING_MODEL              รุ่นที่ใช้ทำนายไพ่ 4 ใบ (เดิมชื่อ GEMINI_MODEL ยังใช้ได้) ค่าเริ่มต้นดูที่ DEFAULT_MODEL
 *  READING_FALLBACK_MODEL     (ไม่บังคับ) รุ่นสำรองตอนรุ่นหลักไม่ว่าง (เดิมชื่อ GEMINI_FALLBACK_MODEL)
 *  READING_THINKING           (ไม่บังคับ) minimal / low / medium / high / off  ค่าเริ่มต้น low (ยิ่งต่ำยิ่งเร็ว)
 *  CHAT_MODEL                 รุ่นที่ใช้คุยทั่วไป ค่าเริ่มต้น gpt-5-nano
 *  CHAT_FALLBACK_MODEL        (ไม่บังคับ) รุ่นสำรองสำหรับคุย
 *  CHAT_DAILY_LIMIT           (ไม่บังคับ) จำนวนข้อความที่ใช้ AI คุยได้ต่อคนต่อวัน ค่าเริ่มต้น 10
 *  LIFF_URL                   เช่น https://liff.line.me/1234567890-AbCdEfGh
 *  IMAGE_BASE_URL             เช่น https://USERNAME.github.io/blackcattarot-line/cards/
 */

const DEFAULT_MODEL = 'gemini-3.8-flash';
const DEFAULT_CHAT_MODEL = 'gpt-5-nano';
const DEFAULT_CHAT_DAILY_LIMIT = 10;
const TZ = 'Asia/Bangkok';
const FREE_CREDITS_FOR_NEW_FRIEND = 1;
const MAX_QUESTION_LENGTH = 300;

const POSITIONS = ['สถานการณ์ตอนนี้', 'อุปสรรคหรือสิ่งที่ซ่อนอยู่', 'คำแนะนำ', 'แนวโน้มผลลัพธ์'];
const CARDS_MESSAGE_PREFIX = '🔮 ไพ่ที่ฉันเลือก'; // ต้องตรงกับ MESSAGE_PREFIX ในหน้า LIFF

const CMD = {
  daily: ['เปิดไพ่วันนี้', 'ไพ่วันนี้', 'ไพ่ประจำวัน'],
  ask: ['ถามไพ่ 4 ใบ', 'ถามไพ่', 'ดูดวง'],
  help: ['วิธีใช้', 'help', 'ช่วยด้วย'],
  cancel: ['ยกเลิก'],
  credits: ['สิทธิ์ของฉัน', 'เช็กสิทธิ์'],
};

const COLORS = { bg: '#221832', gold: '#D9B25F', text: '#F3EAD8', muted: '#B8A98C' };

// ---------- รายชื่อไพ่ 78 ใบ (ต้องตรงกับหน้า LIFF และชื่อไฟล์รูป) ----------
const CARD_LIST = (function () {
  const majors = ['The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant',
    'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice', 'The Hanged Man', 'Death',
    'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World'];
  const suits = [['cups', 'Cups'], ['pent', 'Pentacles'], ['swords', 'Swords'], ['wands', 'Wands']];
  const ranks = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King'];
  const list = majors.map(function (n, i) { return { id: 'maj_' + pad2(i), name: n }; });
  suits.forEach(function (s) {
    ranks.forEach(function (r, i) { list.push({ id: s[0] + '_' + pad2(i + 1), name: r + ' of ' + s[1] }); });
  });
  return list;
})();

function pad2(n) { return (n < 10 ? '0' : '') + n; }

// ==================================================================
// Webhook
// ==================================================================

function doGet() {
  return ContentService.createTextOutput('Black Cat Tarot bot is running เหมียว');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    debugLog('webhook', (body.events || []).length + ' event: ' + (body.events || []).map(function (ev) {
      return ev.type + (ev.message ? '/' + ev.message.type + (ev.message.text ? ' "' + ev.message.text.slice(0, 30) + '"' : '') : '');
    }).join(', '));
    (body.events || []).forEach(function (ev) {
      try { handleEvent(ev); } catch (err) {
        console.error('event error', err && err.stack || err);
        debugLog('event error', String(err && err.stack || err));
      }
    });
  } catch (err) {
    console.error('doPost error', err && err.stack || err);
    debugLog('doPost error', String(err && err.stack || err));
  }
  return ContentService.createTextOutput('OK');
}

function handleEvent(ev) {
  const userId = ev.source && ev.source.userId;
  if (!userId || !ev.replyToken) return;

  if (ev.type === 'follow') return onFollow(ev.replyToken, userId);
  if (ev.type !== 'message') return;

  if (ev.message.type !== 'text') {
    const u = getUser(userId);
    if (u && u.state === 'await_question') {
      return reply(ev.replyToken, [text('พิมพ์คำถามเป็นตัวอักษรมาได้เลยเหมียว ✍️', mainQuickReply())]);
    }
    return reply(ev.replyToken, [helpMessage()]);
  }

  const msg = String(ev.message.text || '').trim();

  if (msg.indexOf(CARDS_MESSAGE_PREFIX) === 0) return onCardsChosen(ev.replyToken, userId, msg);
  if (matches(msg, CMD.daily)) return onDaily(ev.replyToken, userId);
  if (matches(msg, CMD.ask)) return onAsk(ev.replyToken, userId);
  if (matches(msg, CMD.help)) return reply(ev.replyToken, [helpMessage()]);
  if (matches(msg, CMD.credits)) return onCredits(ev.replyToken, userId);
  if (matches(msg, CMD.cancel)) {
    updateUser(userId, { state: '', question: '' });
    return reply(ev.replyToken, [text('ยกเลิกแล้วเหมียว สิทธิ์ของคุณยังอยู่ครบนะ 😺', mainQuickReply())]);
  }

  const user = getUser(userId);
  if (user && user.state === 'await_question') return onQuestion(ev.replyToken, userId, msg);
  if (user && user.state === 'await_cards') {
    return reply(ev.replyToken, [
      text('เหมียวได้คำถามของคุณแล้ว เหลือแค่เลือกไพ่ 4 ใบเหมียว 👇\n(ถ้าอยากเปลี่ยนคำถาม พิมพ์ "ยกเลิก" แล้วเริ่มใหม่ได้)'),
      pickCardsBubble(user.question),
    ]);
  }
  return onChat(ev.replyToken, userId, msg, user);
}

function matches(msg, list) {
  const m = msg.toLowerCase().replace(/^[^\wก-๙]+/, '').trim(); // ตัดอีโมจินำหน้า
  return list.some(function (c) { return m === c.toLowerCase(); });
}

// ==================================================================
// Handlers
// ==================================================================

function onFollow(replyToken, userId) {
  const existed = !!getUser(userId);
  const user = existed ? getUser(userId) : createUser(userId);
  const credits = totalCredits(user);
  const lines = existed
    ? ['ยินดีต้อนรับกลับมาเหมียว 🐈‍⬛✨']
    : ['สวัสดีเหมียว 🐈‍⬛ ยินดีต้อนรับสู่ Black Cat Tarot', '',
       'เหมียวเป็นแมวดำหมอดูไพ่ทาโรต์ จะช่วยเปิดไพ่ให้คุณเหมียว'];
  lines.push('');
  if (credits > 0) lines.push('🎁 คุณมีสิทธิ์ถามไพ่ 4 ใบฟรี ' + credits + ' คำถาม');
  lines.push('🔮 เปิดไพ่ประจำวันได้ฟรีทุกวัน');
  lines.push('', 'กดปุ่มด้านล่างได้เลยเหมียว 👇', '', '✨ คำทำนายเพื่อความบันเทิงและเป็นแนวทางเท่านั้น');
  reply(replyToken, [text(lines.join('\n'), mainQuickReply())]);
}

function onCredits(replyToken, userId) {
  const user = getUser(userId) || createUser(userId);
  const c = totalCredits(user);
  reply(replyToken, [text(c > 0
    ? 'คุณมีสิทธิ์ถามไพ่ 4 ใบเหลือ ' + c + ' คำถามเหมียว 🔮'
    : 'ตอนนี้ยังไม่มีสิทธิ์ถามไพ่เหลือเหมียว แต่เปิดไพ่ประจำวันได้ฟรีทุกวันนะ 😺', mainQuickReply())]);
}

function onAsk(replyToken, userId) {
  const user = getUser(userId) || createUser(userId);
  if (totalCredits(user) <= 0) return reply(replyToken, [noCreditsMessage()]);
  updateUser(userId, { state: 'await_question', question: '' });
  reply(replyToken, [text(
    'พิมพ์คำถามที่อยากถามมาได้เลยเหมียว ✍️\n\n' +
    'ตัวอย่าง\n• งานที่ทำอยู่ช่วง 3 เดือนนี้จะเป็นอย่างไร\n• ความสัมพันธ์กับคนที่คุยอยู่จะไปต่อได้ไหม\n\n' +
    '💡 ถามทีละ 1 เรื่องจะได้คำตอบชัดที่สุด\n(พิมพ์ "ยกเลิก" เพื่อยกเลิก)',
    { items: [qr('ยกเลิก', 'ยกเลิก')] })]);
}

function onQuestion(replyToken, userId, question) {
  if (question.length < 4) {
    return reply(replyToken, [text('ขอคำถามที่ยาวกว่านี้อีกนิดนะเหมียว จะได้ทำนายได้ตรงขึ้น 😺')]);
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return reply(replyToken, [text('คำถามยาวไปนิดเหมียว ขอไม่เกิน ' + MAX_QUESTION_LENGTH + ' ตัวอักษรนะ ✂️')]);
  }
  updateUser(userId, { state: 'await_cards', question: question });
  reply(replyToken, [
    text('เหมียวได้รับคำถามแล้ว 🐾\n"' + question + '"\n\nตั้งจิตถึงคำถามนี้ แล้วแตะปุ่มด้านล่างเพื่อเลือกไพ่ 4 ใบเหมียว'),
    pickCardsBubble(question),
  ]);
}

function onCardsChosen(replyToken, userId, msg) {
  const tStart = Date.now();
  const cards = parseChosenCards(msg);
  if (!cards) return reply(replyToken, [text('เหมียวอ่านไพ่ที่เลือกไม่ออก 😿 ลองกดเลือกไพ่ใหม่อีกครั้งนะ')]);

  // จองสิทธิ์ก่อนเรียก AI กันกดส่งซ้ำ
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let user;
  try {
    user = getUser(userId);
    if (!user || user.state !== 'await_cards' || !user.question) {
      return reply(replyToken, [text('ยังไม่มีคำถามที่รอเปิดไพ่อยู่เหมียว กด "ถามไพ่ 4 ใบ" เพื่อเริ่มใหม่นะ', mainQuickReply())]);
    }
    if (totalCredits(user) <= 0) return reply(replyToken, [noCreditsMessage()]);
    updateUser(userId, { state: 'reading' }, true);
  } finally {
    lock.releaseLock();
  }

  const meta = loadDailyMeta();
  showLoading(userId, 60); // ขึ้นจุดๆ "กำลังพิมพ์" ในแชตระหว่างรอ AI
  const tAi = Date.now();
  const result = askGemini(user.question, cards, meta);
  debugLog('ทำนาย', 'AI ' + ((Date.now() - tAi) / 1000).toFixed(1) + ' วิ | ก่อนเรียก AI ' + ((tAi - tStart) / 1000).toFixed(1) + ' วิ | รุ่น ' + (result.model || (result.ok ? '-' : 'ล้มเหลว')));

  if (!result.ok) {
    updateUser(userId, { state: 'await_cards' });
    return reply(replyToken, [
      text('ขอโทษเหมียว ตอนนี้ลูกแก้ววิเศษขัดข้องนิดหน่อย 😿\nสิทธิ์ของคุณยังอยู่ครบ กดเลือกไพ่ส่งมาใหม่อีกครั้งได้เลยนะ'),
      pickCardsBubble(user.question),
    ]);
  }

  if (result.crisis) {
    // ไม่ตัดสิทธิ์ ไม่ทำนาย ตอบด้วยความใส่ใจแทน
    updateUser(userId, { state: '', question: '' });
    return reply(replyToken, [text(result.text)]);
  }

  // ตัดสิทธิ์ (ใช้สิทธิ์ฟรีก่อน)
  const lock2 = LockService.getScriptLock();
  lock2.waitLock(20000);
  let type, left;
  try {
    const u = getUser(userId);
    const patch = { state: '', question: '' };
    if (Number(u.free_credits) > 0) { patch.free_credits = Number(u.free_credits) - 1; type = 'free'; }
    else { patch.paid_credits = Math.max(0, Number(u.paid_credits) - 1); type = 'paid'; }
    updateUser(userId, patch, true);
    left = totalCredits(Object.assign({}, u, patch));
  } finally {
    lock2.releaseLock();
  }
  logReading(userId, type, user.question, cards, result.text);

  const messages = [readingCarousel(cards, meta), text(result.text.slice(0, 4900))];
  messages.push(left > 0
    ? text('คุณยังเหลือสิทธิ์ถามไพ่อีก ' + left + ' คำถามเหมียว 🔮', mainQuickReply())
    : afterLastCreditMessage());
  if (reply(replyToken, messages)) return;
  // AI ตอบช้าจน reply token หมดอายุ → ส่งแบบ push แทน ถ้ายังไม่ได้ คืนสิทธิ์ให้ลูกค้า
  if (push(userId, messages)) return;
  const u2 = getUser(userId);
  const refund = {};
  refund[type === 'free' ? 'free_credits' : 'paid_credits'] = Number(u2[type === 'free' ? 'free_credits' : 'paid_credits'] || 0) + 1;
  updateUser(userId, refund);
  debugLog('คืนสิทธิ์', 'ส่งคำทำนายไม่สำเร็จ คืนสิทธิ์ 1 ครั้ง (' + type + ')');
}

function onDaily(replyToken, userId) {
  const user = getUser(userId) || createUser(userId);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const meta = loadDailyMeta();
  let cardId = user.daily_date === today ? user.daily_card : '';
  const again = !!cardId;
  if (!cardId || !meta[cardId]) {
    cardId = CARD_LIST[Math.floor(Math.random() * CARD_LIST.length)].id;
    updateUser(userId, { daily_date: today, daily_card: cardId });
  }
  const msgs = [];
  if (again) msgs.push(text('วันนี้เหมียวเปิดไพ่ให้ไปแล้วนะ นี่คือไพ่ประจำวันของคุณเหมียว 🐾'));
  msgs.push(dailyBubble(cardId, meta));
  reply(replyToken, msgs);
}

function parseChosenCards(msg) {
  const byName = {};
  CARD_LIST.forEach(function (c) { byName[c.name.toLowerCase()] = c; });
  const out = [];
  msg.split('\n').slice(1).forEach(function (line) {
    const m = line.trim().match(/^\d+\.\s*(.+)$/);
    if (m && byName[m[1].trim().toLowerCase()]) out.push(byName[m[1].trim().toLowerCase()]);
  });
  const unique = out.filter(function (c, i) { return out.findIndex(function (d) { return d.id === c.id; }) === i; });
  return unique.length === 4 ? unique : null;
}

function onChat(replyToken, userId, msg, user) {
  if (CRISIS_WORDS.test(msg)) return reply(replyToken, [text(crisisMessage())]);
  user = user || getUser(userId) || createUser(userId);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const used = user.chat_date === today ? Number(user.chat_count || 0) : 0;
  const limit = Number(PropertiesService.getScriptProperties().getProperty('CHAT_DAILY_LIMIT') || DEFAULT_CHAT_DAILY_LIMIT);

  if (used >= limit) return reply(replyToken, [text(cannedReply(msg), mainQuickReply())]);

  showLoading(userId, 20);
  const t0 = Date.now();
  const r = askChat(userId, msg);
  debugLog('แชต', (r ? 'AI ' + r.model : 'ใช้คำตอบสำเร็จรูป') + ' ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วิ | วันนี้ ' + (used + (r ? 1 : 0)) + '/' + limit);
  if (!r) return reply(replyToken, [text(cannedReply(msg), mainQuickReply())]);
  updateUser(userId, { chat_date: today, chat_count: used + 1 });
  if (r.crisis) return reply(replyToken, [text(r.text || crisisMessage())]);
  reply(replyToken, [text(r.text, mainQuickReply())]);
}

// ==================================================================
// AI (OpenAI / Google)
// ==================================================================

const SYSTEM_PROMPT = [
  'คุณคือ "เหมียว" แมวดำหมอดูไพ่ทาโรต์ของ Black Cat Tarot ทำนายเป็นภาษาไทย',
  '',
  'บุคลิกและน้ำเสียง:',
  '- อบอุ่น เป็นกันเอง ขี้เล่นนิดๆ แทนผู้ถามว่า "คุณ"',
  '- ลงท้ายประโยคด้วย "เหมียว" ประมาณ 4-6 ครั้งทั้งคำทำนาย อย่าใส่ทุกประโยค',
  '- ไม่ใช้คำลงท้าย ค่ะ คะ ครับ ให้ใช้ "เหมียว" หรือ "นะ" แทน',
  '- ไม่ฟันธงแบบทำให้กลัว ไพ่ที่ดูน่ากลัวให้ตีความเป็นบทเรียนหรือการเปลี่ยนแปลง แต่ยังซื่อตรงกับความหมายของไพ่',
  '',
  'ไพ่ 4 ใบมีตำแหน่งดังนี้: 1) สถานการณ์ตอนนี้ 2) อุปสรรคหรือสิ่งที่ซ่อนอยู่ 3) คำแนะนำ 4) แนวโน้มผลลัพธ์',
  'ใช้ความหมายไพ่ทาโรต์แบบ Rider-Waite ไพ่ทุกใบเป็นไพ่หัวตั้ง',
  '',
  'รูปแบบคำตอบ (ข้อความธรรมดา ห้ามใช้ Markdown เช่น ** หรือ #):',
  '- เปิดด้วย 1 ประโยคทักทายที่อ้างถึงคำถาม',
  '- แต่ละใบขึ้นบรรทัดใหม่ด้วย 1️⃣ 2️⃣ 3️⃣ 4️⃣ ตามด้วยชื่อไพ่ภาษาไทยในวงเล็บชื่ออังกฤษ แล้วตีความ 2-3 ประโยคให้โยงกับคำถาม',
  '- ปิดด้วย "🐾 สรุปจากเหมียว:" 2-3 ประโยค เชื่อมไพ่ทั้ง 4 ใบเข้าด้วยกันพร้อมคำแนะนำที่ทำได้จริง',
  '- ความยาวรวมประมาณ 900-1,400 ตัวอักษร',
  '',
  'ขอบเขตที่ต้องยึดเสมอ:',
  '- นี่คือการดูดวงเพื่อความบันเทิงและเป็นแนวทาง ห้ามอ้างว่ารู้อนาคตแน่นอน',
  '- เรื่องสุขภาพ การรักษา กฎหมาย หรือการลงทุน ให้แนะนำว่าควรปรึกษาผู้เชี่ยวชาญด้วย ห้ามแนะนำให้หยุดยา เลิกรักษา หรือทุ่มเงินลงทุน',
  '- ห้ามให้เลขเด็ด เลขหวย หรือทำนายผลการพนัน ให้ปฏิเสธอย่างน่ารักแล้วทำนายเรื่องโชคลาภโดยรวมแทน',
  '- ห้ามทำนายวันตาย ความตาย หรือเพศของทารกในครรภ์',
  '- ห้ามทำนายเพื่อทำร้าย ตามสืบ หรือควบคุมคนอื่น',
  '- ถ้าคำถามสื่อว่าผู้ถามอาจคิดทำร้ายตัวเอง อยากตาย หรืออยู่ในอันตราย ห้ามทำนาย',
  '  ให้ขึ้นต้นคำตอบด้วย [[CRISIS]] แล้วตามด้วยข้อความสั้นๆ ที่อบอุ่น จริงใจ ไม่ตัดสิน',
  '  บอกว่าเหมียวเป็นห่วง และชวนให้คุยกับคนที่ไว้ใจ หรือโทรสายด่วนสุขภาพจิต 1323 (ฟรี ตลอด 24 ชั่วโมง)',
  '  ถ้าอยู่ในอันตรายตอนนี้ให้โทร 1669 ข้อความนี้ไม่ต้องลงท้ายด้วยเหมียวบ่อย',
].join('\n');

// ---------- เลือกรุ่น AI ----------
// ชื่อรุ่น: "gpt-..." หรือ "openai:..." = OpenAI | "gemini-..." / "gemma-..." = Google | "mock" = ไม่ใช้ AI

function uniqModels(arr) {
  return arr.map(function (m) { return m && String(m).trim(); })
    .filter(function (m, i, a) { return m && a.indexOf(m) === i; });
}

function readingModels() {
  const p = PropertiesService.getScriptProperties();
  return uniqModels([
    p.getProperty('READING_MODEL') || p.getProperty('GEMINI_MODEL') || DEFAULT_MODEL,
    p.getProperty('READING_FALLBACK_MODEL') || p.getProperty('GEMINI_FALLBACK_MODEL'),
  ]);
}

function chatModels() {
  const p = PropertiesService.getScriptProperties();
  return uniqModels([p.getProperty('CHAT_MODEL') || DEFAULT_CHAT_MODEL, p.getProperty('CHAT_FALLBACK_MODEL')]);
}

function providerOf(model) {
  if (model === 'mock') return 'mock';
  if (/^openai:/i.test(model) || /^(gpt|o\d)/i.test(model)) return 'openai';
  return 'google';
}

/** เรียก AI 1 รุ่น  messages = [{role:'user'|'assistant', text}]  คืน {ok,text,model} หรือ null */
function callModel(model, system, messages, opts) {
  const p = providerOf(model);
  if (p === 'openai') return callOpenAI(model, system, messages, opts);
  if (p === 'google') return callGoogle(model, system, messages, opts);
  return null;
}

function cleanAiText(out) {
  return String(out || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim();
}

function callGoogle(model, system, messages, opts) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) { console.error('GEMINI_API_KEY is missing'); return null; }
  const isGemma = /^gemma/i.test(model);
  const contents = messages.map(function (m) {
    return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] };
  });
  const body = { contents: contents, generationConfig: { temperature: opts.temperature || 0.9, maxOutputTokens: opts.maxTokens || 4096 } };
  if (isGemma) {
    // Gemma ไม่รองรับ systemInstruction และการตั้งระดับการคิด → รวมคำสั่งไว้ในข้อความแรก
    contents[0].parts[0].text = system + '\n\n---\n\n' + contents[0].parts[0].text;
  } else {
    body.systemInstruction = { parts: [{ text: system }] };
    if (opts.thinking && opts.thinking !== 'off') body.generationConfig.thinkingConfig = { thinkingLevel: opts.thinking };
  }
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const tries = opts.tries || 2;
  for (let attempt = 0; attempt < tries; attempt++) {
    const t0 = Date.now();
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    console.log('Google ' + model + ' → ' + code + ' ใน ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วินาที');
    if (code === 400 && body.generationConfig.thinkingConfig && /thinking/i.test(res.getContentText())) {
      console.log('รุ่นนี้ไม่รองรับ thinkingLevel ตัดออกแล้วลองใหม่');
      delete body.generationConfig.thinkingConfig; attempt--; continue;
    }
    if (code === 200) {
      const data = JSON.parse(res.getContentText());
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      const out = parts.filter(function (x) { return !x.thought; }).map(function (x) { return x.text || ''; }).join('').trim();
      if (!out) { console.error('Google empty response (' + model + ')', res.getContentText().slice(0, 1000)); return null; }
      return { ok: true, text: out, model: model };
    }
    console.error('Google error ' + code + ' (' + model + ')', res.getContentText().slice(0, 1000));
    if (code !== 429 && code < 500) return null; // ลองซ้ำไม่หาย เช่น key ผิด ชื่อรุ่นผิด
    if (attempt < tries - 1) Utilities.sleep(700);
  }
  return null;
}

function callOpenAI(model, system, messages, opts) {
  const key = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
  if (!key) { console.error('OPENAI_API_KEY is missing'); return null; }
  const name = model.replace(/^openai:/i, '');
  const body = {
    model: name,
    messages: [{ role: 'system', content: system }].concat(messages.map(function (m) {
      return { role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text };
    })),
    max_completion_tokens: opts.maxTokens || 4096, // รวม token ที่ใช้ "คิด" ด้วย
  };
  if (opts.effort) body.reasoning_effort = opts.effort;
  const tries = opts.tries || 2;
  for (let attempt = 0; attempt < tries; attempt++) {
    const t0 = Date.now();
    const res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + key }, payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    const raw = res.getContentText();
    console.log('OpenAI ' + name + ' → ' + code + ' ใน ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วินาที');
    if (code === 400 && body.reasoning_effort && /reasoning/i.test(raw)) {
      console.log('รุ่นนี้ไม่รองรับ reasoning_effort ค่านี้ ตัดออกแล้วลองใหม่');
      delete body.reasoning_effort; attempt--; continue;
    }
    if (code === 200) {
      const data = JSON.parse(raw);
      const choice = (data.choices || [])[0] || {};
      const out = String((choice.message || {}).content || '').trim();
      if (!out) { console.error('OpenAI empty response (' + name + ', finish=' + choice.finish_reason + ')', raw.slice(0, 1000)); return null; }
      return { ok: true, text: out, model: model };
    }
    console.error('OpenAI error ' + code + ' (' + name + ')', raw.slice(0, 1000));
    if (/insufficient_quota/.test(raw)) return null; // เงินในบัญชีหมด ลองซ้ำไม่ช่วย
    if (code !== 429 && code < 500) return null;
    if (attempt < tries - 1) Utilities.sleep(700);
  }
  return null;
}

// ---------- ทำนายไพ่ 4 ใบ ----------

function askReading(question, cards, meta) {
  const props = PropertiesService.getScriptProperties();
  const thinking = (props.getProperty('READING_THINKING') || props.getProperty('GEMINI_THINKING_LEVEL') || 'low').toLowerCase();
  const cardLines = cards.map(function (c, i) {
    const th = meta[c.id] && meta[c.id].th ? ' (' + meta[c.id].th + ')' : '';
    return (i + 1) + ') ' + POSITIONS[i] + ': ' + c.name + th;
  }).join('\n');
  const userPrompt = 'คำถามของผู้ถาม:\n"""' + question + '"""\n\nไพ่ที่ผู้ถามเลือก:\n' + cardLines;

  const models = readingModels();
  for (let i = 0; i < models.length; i++) {
    if (models[i] === 'mock') return mockReading(question, cards, meta);
    const r = callModel(models[i], SYSTEM_PROMPT, [{ role: 'user', text: userPrompt }], {
      maxTokens: 4096, temperature: 0.9, thinking: thinking, effort: thinking === 'off' ? 'minimal' : thinking, tries: 2,
    });
    if (!r) continue;
    const out = cleanAiText(r.text);
    if (out.indexOf('[[CRISIS]]') !== -1) return { ok: true, crisis: true, text: out.replace('[[CRISIS]]', '').trim(), model: r.model };
    return { ok: true, text: out, model: r.model };
  }
  return { ok: false };
}

// ชื่อเดิม (ยังใช้ได้)
function askGemini(question, cards, meta) { return askReading(question, cards, meta); }

/** โหมดทดสอบ: ประกอบคำทำนายจากแท็บ daily โดยไม่เรียก AI */
function mockReading(question, cards, meta) {
  const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
  const lines = ['(โหมดทดสอบ: ยังไม่ได้ใช้ AI) คำถามของคุณคือ "' + question + '" เหมียวเปิดไพ่ให้แล้วนะ', ''];
  cards.forEach(function (c, i) {
    const m = meta[c.id] || {};
    lines.push(nums[i] + ' ' + POSITIONS[i] + ': ' + (m.th || c.name));
    lines.push(String(m.meaning || '').replace(/^วันนี้/, ''), '');
  });
  const advice = meta[cards[2].id] && meta[cards[2].id].advice;
  lines.push('🐾 สรุปจากเหมียว: ' + (advice || 'ค่อยๆ ไปทีละก้าวนะเหมียว'));
  return { ok: true, text: lines.join('\n'), model: 'mock' };
}

// ---------- แชตทั่วไป ----------

const CHAT_PROMPT = [
  'คุณคือ "เหมียว" แมวดำหมอดูไพ่ทาโรต์ของ Black Cat Tarot กำลังคุยกับลูกค้าในแชต LINE เป็นภาษาไทย',
  '',
  'วิธีตอบ:',
  '- ตอบสั้น 1-3 ประโยค ไม่เกินประมาณ 200 ตัวอักษร อบอุ่น ขี้เล่นนิดๆ แทนผู้คุยว่า "คุณ"',
  '- ใช้ "เหมียว" ลงท้าย 1-2 ครั้ง ไม่ใช้ ค่ะ คะ ครับ ใช้อีโมจิได้ไม่เกิน 2 ตัว ห้ามใช้ Markdown',
  '- รับฟังและตอบให้ตรงกับสิ่งที่เขาพิมพ์ก่อน แล้วค่อยชวนดูไพ่อย่างเป็นธรรมชาติ ไม่ยัดเยียด',
  '- ถ้าเป็นเรื่องที่อยากรู้คำตอบ (ความรัก งาน เงิน การตัดสินใจ) ชวนให้กด "ถามไพ่ 4 ใบ"',
  '- ถ้าแค่ทักทายหรือคุยเล่น ชวน "เปิดไพ่วันนี้" ซึ่งฟรีทุกวัน',
  '',
  'ข้อห้าม:',
  '- ห้ามทำนายหรือบอกผลลัพธ์ในแชตนี้ ห้ามสุ่มไพ่หรืออ้างว่าเห็นไพ่ ถ้าถูกขอให้ทำนาย ให้บอกว่าต้องเปิดไพ่ก่อน แล้วชวนกด "ถามไพ่ 4 ใบ"',
  '- ถ้าถูกขอให้ทำเรื่องอื่นที่ไม่เกี่ยวกับการดูดวง เช่น ทำการบ้าน เขียนโค้ด แปลภาษา ให้ปฏิเสธอย่างน่ารักว่าเหมียวถนัดแต่เปิดไพ่',
  '- ห้ามให้เลขเด็ด เลขหวย ห้ามแนะนำเรื่องการรักษาโรค กฎหมาย หรือการลงทุน',
  '- ถ้าถูกถามว่าเป็นคนหรือบอท ให้บอกตรงๆ ว่าเป็นบอท AI แมวหมอดู',
  '- ถ้าข้อความสื่อว่าเขาอาจคิดทำร้ายตัวเอง อยากตาย หรืออยู่ในอันตราย ห้ามชวนดูไพ่',
  '  ให้ขึ้นต้นคำตอบด้วย [[CRISIS]] แล้วตอบอย่างอบอุ่นจริงใจ ไม่ตัดสิน บอกว่าเหมียวเป็นห่วง',
  '  ชวนคุยกับคนที่ไว้ใจ หรือโทรสายด่วนสุขภาพจิต 1323 (ฟรี 24 ชั่วโมง) ถ้าอยู่ในอันตรายตอนนี้ให้โทร 1669',
].join('\n');

const CRISIS_WORDS = /อยากตาย|ฆ่าตัวตาย|ไม่อยากอยู่แล้ว|ไม่อยากมีชีวิต|ทำร้ายตัวเอง|กรีดข้อมือ|จบชีวิต/;

function crisisMessage() {
  return 'เหมียวเป็นห่วงคุณมากนะ 🖤 ตอนนี้คุณไม่ได้อยู่คนเดียว ลองคุยกับคนที่คุณไว้ใจ ' +
    'หรือโทรสายด่วนสุขภาพจิต 1323 ได้ฟรีตลอด 24 ชั่วโมง\nถ้าตอนนี้อยู่ในอันตราย โทร 1669 ได้ทันที';
}

function chatHistory(userId) {
  const hit = CacheService.getScriptCache().get('chat:' + userId);
  return hit ? JSON.parse(hit) : [];
}

function saveChatHistory(userId, history) {
  CacheService.getScriptCache().put('chat:' + userId, JSON.stringify(history.slice(-4)), 6 * 3600);
}

/** คืน {text, crisis, model} หรือ null ถ้าไม่มี AI ว่าง */
function askChat(userId, msg) {
  const history = chatHistory(userId);
  const messages = history.concat([{ role: 'user', text: msg.slice(0, 500) }]);
  const models = chatModels();
  for (let i = 0; i < models.length; i++) {
    if (models[i] === 'mock') return null;
    const r = callModel(models[i], CHAT_PROMPT, messages, {
      maxTokens: 1500, temperature: 0.8, thinking: 'minimal', effort: 'minimal', tries: 1,
    });
    if (!r) continue;
    let out = cleanAiText(r.text);
    const crisis = out.indexOf('[[CRISIS]]') !== -1;
    out = out.replace('[[CRISIS]]', '').trim().slice(0, 1000);
    saveChatHistory(userId, messages.concat([{ role: 'assistant', text: out.slice(0, 300) }]));
    return { text: out, crisis: crisis, model: r.model };
  }
  return null;
}

const CANNED = [
  { re: /แฟน|ความรัก|รักเขา|คนคุย|อกหัก|เลิกกัน|นอกใจ|คิดถึงเขา|ชอบเขา|โสด|เนื้อคู่/, replies: [
    'เรื่องหัวใจใช่ไหมเหมียว 💕 ถ้าอยากรู้ว่าเรื่องนี้จะไปทางไหน ลองกด "ถามไพ่ 4 ใบ" ให้เหมียวเปิดไพ่ดูนะ',
    'หัวใจกำลังวุ่นๆ อยู่สินะเหมียว 🐾 ตั้งคำถามมาเลย เหมียวจะเปิดไพ่ 4 ใบดูให้ว่าใจเขาเป็นยังไง',
  ] },
  { re: /งาน|เจ้านาย|หัวหน้า|สมัครงาน|ลาออก|ออฟฟิศ|เพื่อนร่วมงาน|สอบ|เรียน|สัมภาษณ์/, replies: [
    'เรื่องงานกับการเรียนนี่ชวนปวดหัวจริงเหมียว 💼 ลองกด "ถามไพ่ 4 ใบ" ให้เหมียวดูทางไปต่อให้นะ',
    'สู้ๆ นะเหมียว 🐾 ถ้าอยากรู้ว่าเรื่องงานช่วงนี้จะคลี่คลายไหม ตั้งคำถามแล้วเลือกไพ่ 4 ใบได้เลย',
  ] },
  { re: /เงิน|หนี้|รวย|ขายของ|ค้าขาย|ลงทุน|หวย|เลขเด็ด|โชคลาภ|ธุรกิจ/, replies: [
    'เรื่องเงินทองนี่สำคัญเหมียว 💰 เหมียวให้เลขเด็ดไม่ได้นะ แต่เปิดไพ่ดูแนวโน้มการเงินให้ได้ ลองกด "ถามไพ่ 4 ใบ" ดูไหม',
    'อยากรู้เรื่องโชคลาภใช่ไหมเหมียว ✨ ลองเปิดไพ่ประจำวันดูก่อนก็ได้นะ ฟรีทุกวันเลย',
  ] },
  { re: /เศร้า|เหนื่อย|ท้อ|เครียด|ร้องไห้|เหงา|เบื่อ|ไม่ไหว/, replies: [
    'เหนื่อยมาเหรอเหมียว 🖤 พักหายใจลึกๆ ก่อนนะ ถ้าอยากได้กำลังใจเล็กๆ ลองเปิดไพ่ประจำวันดู เหมียวอยู่ตรงนี้นะ',
    'กอดๆ นะเหมียว 🐾 บางวันก็หนักจริงๆ ถ้าอยากรู้ว่าเรื่องที่กังวลจะคลี่คลายไหม ลองถามไพ่ 4 ใบดูได้',
  ] },
  { re: /ขอบคุณ|ขอบใจ|thank|แม่น|ตรงมาก/i, replies: [
    'ยินดีมากเลยเหมียว 😺 พรุ่งนี้อย่าลืมมาเปิดไพ่ประจำวันอีกนะ',
    'ดีใจที่ช่วยได้เหมียว 🐾 มีอะไรอยากถามอีก เรียกเหมียวได้ตลอด',
  ] },
  { re: /^(สวัสดี|หวัดดี|ดีจ้า|ดีค่ะ|ดีครับ|hello|hi|hey|ทักๆ|อรุณสวัสดิ์)/i, replies: [
    'สวัสดีเหมียว 🐈‍⬛ วันนี้เปิดไพ่ประจำวันหรือยัง ลองกด "เปิดไพ่วันนี้" ดูนะ ฟรีทุกวันเลย',
    'หวัดดีเหมียว ✨ อยากเปิดไพ่ประจำวัน หรือมีเรื่องอยากถามไพ่ 4 ใบดี',
  ] },
];
const CANNED_DEFAULT = [
  'เหมียวฟังอยู่นะ 🐾 ถ้ามีเรื่องอยากรู้ ลองกด "ถามไพ่ 4 ใบ" หรือเปิดไพ่ประจำวันฟรีก็ได้เหมียว',
  'เมี้ยว~ 🐈‍⬛ เหมียวถนัดเปิดไพ่ที่สุด อยากให้เปิดไพ่ประจำวัน หรือตั้งคำถามแล้วเลือกไพ่ 4 ใบดีเหมียว',
  'เหมียวอาจตอบได้ไม่ครบทุกเรื่องนะ แต่ถ้าเป็นเรื่องดวง เหมียวพร้อมเปิดไพ่ให้เลย ✨',
];

function cannedReply(msg) {
  for (let i = 0; i < CANNED.length; i++) {
    if (CANNED[i].re.test(msg)) return pickRandom(CANNED[i].replies);
  }
  return pickRandom(CANNED_DEFAULT);
}

function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ==================================================================
// LINE messages
// ==================================================================

function reply(replyToken, messages) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages.slice(0, 5) }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) console.error('LINE reply error', res.getResponseCode(), res.getContentText());
  debugLog('reply → ' + res.getResponseCode(), res.getResponseCode() === 200 ? 'ส่งสำเร็จ ' + messages.length + ' ข้อความ' : res.getContentText().slice(0, 500));
  return res.getResponseCode() === 200;
}

/** ส่งหา user โดยตรง (ใช้เมื่อ reply token หมดอายุ) ** นับโควตาข้อความของ LINE OA ** */
function push(userId, messages) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ to: userId, messages: messages.slice(0, 5) }),
    muteHttpExceptions: true,
  });
  debugLog('push → ' + res.getResponseCode(), res.getResponseCode() === 200 ? 'ส่งสำเร็จ (นับโควตา)' : res.getContentText().slice(0, 500));
  return res.getResponseCode() === 200;
}

/** บันทึกลงแท็บ log (สร้างให้เอง) ดูง่ายกว่าหน้า Executions เก็บล่าสุด 300 แถว */
function debugLog(what, detail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('log');
    if (!sh) { sh = ss.insertSheet('log'); sh.appendRow(['time', 'what', 'detail']); sh.setFrozenRows(1); }
    sh.appendRow([new Date(), what, detail || '']);
    if (sh.getLastRow() > 400) sh.deleteRows(2, sh.getLastRow() - 301);
  } catch (err) { console.error('debugLog failed', err); }
}

/** แสดงแอนิเมชันกำลังพิมพ์ในแชต 1:1 (ฟรี ไม่นับโควตา) */
function showLoading(userId, seconds) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  UrlFetchApp.fetch('https://api.line.me/v2/bot/chat/loading/start', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ chatId: userId, loadingSeconds: seconds }), muteHttpExceptions: true,
  });
}

function text(t, quickReply) {
  const m = { type: 'text', text: t };
  if (quickReply) m.quickReply = quickReply;
  return m;
}

function qr(label, msg) {
  return { type: 'action', action: { type: 'message', label: label, text: msg } };
}

function mainQuickReply() {
  return { items: [qr('🔮 เปิดไพ่วันนี้', 'เปิดไพ่วันนี้'), qr('🃏 ถามไพ่ 4 ใบ', 'ถามไพ่ 4 ใบ'), qr('❓ วิธีใช้', 'วิธีใช้')] };
}

function helpMessage() {
  return text([
    'Black Cat Tarot ทำอะไรได้บ้างเหมียว 🐈‍⬛', '',
    '🔮 "เปิดไพ่วันนี้" ไพ่ประจำวันฟรี วันละ 1 ใบ',
    '🃏 "ถามไพ่ 4 ใบ" ตั้งคำถาม แล้วเลือกไพ่ 4 ใบ เหมียวจะทำนายให้ละเอียด',
    '🎟️ "สิทธิ์ของฉัน" ดูว่าเหลือสิทธิ์ถามไพ่กี่คำถาม', '',
    '✨ คำทำนายเพื่อความบันเทิงและเป็นแนวทางเท่านั้นเหมียว',
  ].join('\n'), mainQuickReply());
}

function noCreditsMessage() {
  return text('สิทธิ์ถามไพ่ของคุณใช้ไปแล้วเหมียว 😺\n\nแพ็กถามไพ่ 3 คำถาม 59 บาท กำลังจะเปิดเร็วๆ นี้\nระหว่างนี้เปิดไพ่ประจำวันได้ฟรีทุกวันนะเหมียว',
    { items: [qr('🔮 เปิดไพ่วันนี้', 'เปิดไพ่วันนี้')] });
}

function afterLastCreditMessage() {
  return text('อยากถามต่ออีกไหมเหมียว? 🐾\nแพ็กถามไพ่ 3 คำถาม 59 บาท กำลังจะเปิดเร็วๆ นี้\nพรุ่งนี้อย่าลืมมาเปิดไพ่ประจำวันฟรีนะเหมียว',
    { items: [qr('🔮 เปิดไพ่วันนี้', 'เปิดไพ่วันนี้'), qr('❓ วิธีใช้', 'วิธีใช้')] });
}

function imageUrl(cardId) {
  const base = PropertiesService.getScriptProperties().getProperty('IMAGE_BASE_URL') || '';
  return base.replace(/\/?$/, '/') + cardId + '.jpg';
}

function pickCardsBubble(question) {
  const liff = PropertiesService.getScriptProperties().getProperty('LIFF_URL');
  return {
    type: 'flex', altText: 'แตะเพื่อเลือกไพ่ 4 ใบ',
    contents: {
      type: 'bubble', size: 'kilo',
      styles: { body: { backgroundColor: COLORS.bg }, footer: { backgroundColor: COLORS.bg } },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'text', text: '🃏 เลือกไพ่ 4 ใบ', weight: 'bold', color: COLORS.gold, size: 'md' },
        { type: 'text', text: question || 'ตั้งจิตถึงคำถามของคุณ', wrap: true, color: COLORS.text, size: 'sm', maxLines: 4 },
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: COLORS.gold, height: 'sm',
          action: { type: 'uri', label: 'แตะเพื่อเลือกไพ่', uri: liff } },
      ] },
    },
  };
}

function dailyBubble(cardId, meta) {
  const m = meta[cardId] || {};
  const card = CARD_LIST.filter(function (c) { return c.id === cardId; })[0];
  const body = [
    { type: 'text', text: 'ไพ่ประจำวันของคุณ', size: 'xs', color: COLORS.muted },
    { type: 'text', text: card.name, weight: 'bold', size: 'xl', color: COLORS.gold, wrap: true },
  ];
  if (m.th) body.push({ type: 'text', text: m.th, size: 'sm', color: COLORS.muted });
  body.push({ type: 'separator', margin: 'md', color: '#3A2E4D' });
  if (m.meaning) body.push({ type: 'text', text: m.meaning, wrap: true, color: COLORS.text, size: 'sm', margin: 'md' });
  if (m.advice) body.push({ type: 'text', text: '✨ คำแนะนำ: ' + m.advice, wrap: true, color: COLORS.text, size: 'sm', margin: 'md' });
  if (m.color) body.push({ type: 'text', text: '🍀 สีมงคล: ' + m.color, wrap: true, color: COLORS.text, size: 'sm', margin: 'sm' });
  return {
    type: 'flex', altText: 'ไพ่ประจำวันของคุณ: ' + card.name,
    contents: {
      type: 'bubble',
      styles: { body: { backgroundColor: COLORS.bg }, footer: { backgroundColor: COLORS.bg } },
      hero: { type: 'image', url: imageUrl(cardId), size: 'full', aspectRatio: '2:3', aspectMode: 'cover' },
      body: { type: 'box', layout: 'vertical', spacing: 'xs', contents: body },
      footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: COLORS.gold, height: 'sm',
          action: { type: 'message', label: '🃏 อยากถามเรื่องเฉพาะ', text: 'ถามไพ่ 4 ใบ' } },
      ] },
    },
  };
}

function readingCarousel(cards, meta) {
  return {
    type: 'flex', altText: 'ไพ่ที่คุณเลือก: ' + cards.map(function (c) { return c.name; }).join(', '),
    contents: { type: 'carousel', contents: cards.map(function (c, i) {
      const th = meta[c.id] && meta[c.id].th;
      const body = [
        { type: 'text', text: (i + 1) + '. ' + POSITIONS[i], size: 'xxs', color: COLORS.muted, wrap: true },
        { type: 'text', text: c.name, size: 'xs', weight: 'bold', color: COLORS.gold, wrap: true },
      ];
      if (th) body.push({ type: 'text', text: th, size: 'xxs', color: COLORS.text, wrap: true });
      return {
        type: 'bubble', size: 'micro',
        styles: { body: { backgroundColor: COLORS.bg } },
        hero: { type: 'image', url: imageUrl(c.id), size: 'full', aspectRatio: '2:3', aspectMode: 'cover' },
        body: { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '10px', contents: body },
      };
    }) },
  };
}

// ==================================================================
// Google Sheets
// ==================================================================

const USER_HEADERS = ['user_id', 'free_credits', 'paid_credits', 'state', 'question', 'daily_date', 'daily_card', 'created_at', 'updated_at', 'chat_date', 'chat_count'];
const READING_HEADERS = ['time', 'user_id', 'type', 'question', 'cards', 'reading'];

/** รันครั้งเดียวจากเมนู Run เพื่อสร้างแท็บ users และ readings */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [['users', USER_HEADERS], ['readings', READING_HEADERS]].forEach(function (t) {
    let sh = ss.getSheetByName(t[0]);
    if (!sh) sh = ss.insertSheet(t[0]);
    if (sh.getLastRow() === 0) { sh.appendRow(t[1]); sh.setFrozenRows(1); }
    else sh.getRange(1, 1, 1, t[1].length).setValues([t[1]]); // เพิ่มหัวคอลัมน์ใหม่ถ้ามี
  });
  ss.getSheetByName('users').getRange('F:G').setNumberFormat('@'); // เก็บวันที่เป็นข้อความ
  ss.getSheetByName('users').getRange('J:J').setNumberFormat('@');
  if (!ss.getSheetByName('daily')) throw new Error('ยังไม่มีแท็บ daily กรุณานำเข้าคำทำนายก่อน (ดูคู่มือ ขั้นที่ 4)');
  const meta = loadDailyMeta();
  const missing = CARD_LIST.filter(function (c) { return !meta[c.id]; }).map(function (c) { return c.id; });
  console.log('daily: พบ ' + (78 - missing.length) + '/78 ใบ' + (missing.length ? ' ขาด: ' + missing.join(', ') : ''));
}

function usersSheet() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName('users'); }

function findUserRow(userId) {
  const sh = usersSheet();
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === userId) return i + 2;
  return -1;
}

function getUser(userId) {
  const row = findUserRow(userId);
  if (row < 0) return null;
  const vals = usersSheet().getRange(row, 1, 1, USER_HEADERS.length).getValues()[0];
  const u = {};
  USER_HEADERS.forEach(function (h, i) { u[h] = vals[i]; });
  u.daily_date = String(u.daily_date || '');
  u.chat_date = String(u.chat_date || '');
  return u;
}

function createUser(userId) {
  const now = new Date();
  usersSheet().appendRow([userId, FREE_CREDITS_FOR_NEW_FRIEND, 0, '', '', '', '', now, now, '', 0]);
  return getUser(userId);
}

/** แก้ข้อมูลผู้ใช้ (ส่ง alreadyLocked = true ถ้าเรียกภายใน lock อยู่แล้ว) */
function updateUser(userId, patch, alreadyLocked) {
  const lock = alreadyLocked ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(20000);
  try {
    let row = findUserRow(userId);
    if (row < 0) { createUser(userId); row = findUserRow(userId); }
    const sh = usersSheet();
    const vals = sh.getRange(row, 1, 1, USER_HEADERS.length).getValues()[0];
    Object.keys(patch).forEach(function (k) {
      const i = USER_HEADERS.indexOf(k);
      if (i >= 0) vals[i] = patch[k];
    });
    vals[USER_HEADERS.indexOf('updated_at')] = new Date();
    sh.getRange(row, 1, 1, USER_HEADERS.length).setValues([vals]);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function totalCredits(u) { return Number(u.free_credits || 0) + Number(u.paid_credits || 0); }

function logReading(userId, type, question, cards, reading) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('readings').appendRow([
    new Date(), userId, type, question, cards.map(function (c) { return c.id; }).join(','), reading]);
}

/** อ่านแท็บ daily → { card_id: {th, meaning, advice, color} } (cache 10 นาที) */
function loadDailyMeta() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('daily_meta');
  if (hit) return JSON.parse(hit);
  const values = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('daily').getDataRange().getValues();
  const head = values[0].map(function (h) { return String(h).trim(); });
  const col = function (name) { return head.indexOf(name); };
  const iId = col('card_id'), iTh = col('ชื่อไทย'), iMean = col('คำทำนาย'), iAdv = col('คำแนะนำ'), iColor = col('สีมงคล');
  const meta = {};
  values.slice(1).forEach(function (r) {
    const id = String(r[iId] || '').trim();
    if (!id) return;
    meta[id] = { th: r[iTh] || '', meaning: r[iMean] || '', advice: r[iAdv] || '', color: r[iColor] || '' };
  });
  cache.put('daily_meta', JSON.stringify(meta), 600);
  return meta;
}

/** กดรันเพื่อล้าง cache หลังแก้คำทำนายในแท็บ daily (ไม่งั้นรอ 10 นาที) */
function clearCache() { CacheService.getScriptCache().remove('daily_meta'); }

// ==================================================================
// ทดสอบใน editor (ไม่ส่งอะไรเข้า LINE)
// ==================================================================

function testGemini() {
  const cards = ['maj_00', 'swords_03', 'cups_11', 'maj_17'].map(function (id) {
    return CARD_LIST.filter(function (c) { return c.id === id; })[0];
  });
  const t0 = Date.now();
  const r = askGemini('งานใหม่ที่กำลังจะเริ่มเดือนหน้าจะไปได้ดีไหม', cards, loadDailyMeta());
  console.log('รวมทั้งหมด ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วินาที | รุ่นที่ตอบ: ' + (r.model || '-') + ' | ยาว ' + (r.text || '').length + ' ตัวอักษร');
  console.log(r.text || JSON.stringify(r));
}

function testChat() {
  ['สวัสดีเหมียว', 'ช่วงนี้เหนื่อยกับงานมากเลย', 'แฟนจะกลับมาไหม ทายให้หน่อย', 'ช่วยทำการบ้านคณิตให้หน่อย'].forEach(function (m) {
    const t0 = Date.now();
    const r = askChat('TEST_USER', m);
    console.log('> ' + m + '\n' + (r ? '[' + r.model + ', ' + ((Date.now() - t0) / 1000).toFixed(1) + ' วิ] ' + r.text : '[ไม่มี AI ว่าง → คำตอบสำเร็จรูป] ' + cannedReply(m)));
  });
  CacheService.getScriptCache().remove('chat:TEST_USER');
}

/** แสดงรายชื่อรุ่น Gemini ที่ key นี้ใช้ได้ (สำหรับเลือก GEMINI_MODEL / GEMINI_FALLBACK_MODEL) */
function listGeminiModels() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
    { headers: { 'x-goog-api-key': key }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return console.error(res.getResponseCode(), res.getContentText());
  (JSON.parse(res.getContentText()).models || [])
    .filter(function (m) { return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1; })
    .forEach(function (m) { console.log(m.name.replace('models/', '') + '  —  ' + (m.displayName || '')); });
}
