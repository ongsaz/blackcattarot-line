/**
 * Black Cat Tarot – LINE bot (Google Apps Script)
 *
 * ทำอะไรได้:
 *  - แอดเพื่อนครั้งแรก ได้สิทธิ์ถามไพ่ 4 ใบฟรี 1 คำถาม (ทำนายด้วย Gemini)
 *  - ไพ่ประจำวันฟรี วันละ 1 ใบ (คำทำนายจากแท็บ daily)
 *  - ข้อความทั้งหมดเป็นการ "ตอบกลับ" (reply) จึงไม่กินโควตาข้อความของ LINE OA
 *
 * ตั้งค่าใน Project Settings → Script Properties:
 *  LINE_CHANNEL_ACCESS_TOKEN  Token จาก LINE Developers (Messaging API)
 *  GEMINI_API_KEY             API key จาก Google AI Studio
 *  GEMINI_MODEL               (ไม่บังคับ) ชื่อโมเดล ค่าเริ่มต้นดูที่ DEFAULT_MODEL
 *  LIFF_URL                   เช่น https://liff.line.me/1234567890-AbCdEfGh
 *  IMAGE_BASE_URL             เช่น https://USERNAME.github.io/blackcattarot-line/cards/
 */

const DEFAULT_MODEL = 'gemini-2.5-flash';
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
    (body.events || []).forEach(function (ev) {
      try { handleEvent(ev); } catch (err) { console.error('event error', err && err.stack || err); }
    });
  } catch (err) {
    console.error('doPost error', err && err.stack || err);
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
  return reply(ev.replyToken, [helpMessage()]);
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
  const result = askGemini(user.question, cards, meta);

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
  reply(replyToken, messages);
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

// ==================================================================
// Gemini
// ==================================================================

const SYSTEM_PROMPT = [
  'คุณคือ "เหมียว" แมวดำหมอดูไพ่ทาโรต์ของ Black Cat Tarot ทำนายเป็นภาษาไทย',
  '',
  'บุคลิกและน้ำเสียง:',
  '- อบอุ่น เป็นกันเอง ขี้เล่นนิดๆ แทนผู้ถามว่า "คุณ"',
  '- ลงท้ายประโยคด้วย "เหมียว" ประมาณ 4-6 ครั้งทั้งคำทำนาย อย่าใส่ทุกประโยค',
  '- ไม่ฟันธงแบบทำให้กลัว ไพ่ที่ดูน่ากลัวให้ตีความเป็นบทเรียนหรือการเปลี่ยนแปลง แต่ยังซื่อตรงกับความหมายของไพ่',
  '',
  'ไพ่ 4 ใบมีตำแหน่งดังนี้: 1) สถานการณ์ตอนนี้ 2) อุปสรรคหรือสิ่งที่ซ่อนอยู่ 3) คำแนะนำ 4) แนวโน้มผลลัพธ์',
  'ใช้ความหมายไพ่ทาโรต์แบบ Rider-Waite ไพ่ทุกใบเป็นไพ่หัวตั้ง',
  '',
  'รูปแบบคำตอบ (ข้อความธรรมดา ห้ามใช้ Markdown เช่น ** หรือ #):',
  '- เปิดด้วย 1 ประโยคทักทายที่อ้างถึงคำถาม',
  '- แต่ละใบขึ้นบรรทัดใหม่ด้วย 1️⃣ 2️⃣ 3️⃣ 4️⃣ ตามด้วยชื่อไพ่ภาษาไทย แล้วตีความ 2-3 ประโยคให้โยงกับคำถาม',
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

function askGemini(question, cards, meta) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('GEMINI_API_KEY');
  const model = props.getProperty('GEMINI_MODEL') || DEFAULT_MODEL;
  if (!key) { console.error('GEMINI_API_KEY is missing'); return { ok: false }; }

  const cardLines = cards.map(function (c, i) {
    const th = meta[c.id] && meta[c.id].th ? ' (' + meta[c.id].th + ')' : '';
    return (i + 1) + ') ' + POSITIONS[i] + ': ' + c.name + th;
  }).join('\n');
  const userPrompt = 'คำถามของผู้ถาม:\n"""' + question + '"""\n\nไพ่ที่ผู้ถามเลือก:\n' + cardLines;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const payload = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 4096 },
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(payload), muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) {
      const data = JSON.parse(res.getContentText());
      const parts = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      let out = parts.filter(function (p) { return !p.thought; }).map(function (p) { return p.text || ''; }).join('').trim();
      if (!out) { console.error('Gemini empty response', res.getContentText().slice(0, 1000)); return { ok: false }; }
      out = out.replace(/\*\*/g, '').replace(/^#+\s*/gm, '');
      if (out.indexOf('[[CRISIS]]') !== -1) return { ok: true, crisis: true, text: out.replace('[[CRISIS]]', '').trim() };
      return { ok: true, text: out };
    }
    console.error('Gemini error ' + code, res.getContentText().slice(0, 1000));
    if (code !== 429 && code < 500) break;
    Utilities.sleep(1500);
  }
  return { ok: false };
}

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

const USER_HEADERS = ['user_id', 'free_credits', 'paid_credits', 'state', 'question', 'daily_date', 'daily_card', 'created_at', 'updated_at'];
const READING_HEADERS = ['time', 'user_id', 'type', 'question', 'cards', 'reading'];

/** รันครั้งเดียวจากเมนู Run เพื่อสร้างแท็บ users และ readings */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [['users', USER_HEADERS], ['readings', READING_HEADERS]].forEach(function (t) {
    let sh = ss.getSheetByName(t[0]);
    if (!sh) sh = ss.insertSheet(t[0]);
    if (sh.getLastRow() === 0) { sh.appendRow(t[1]); sh.setFrozenRows(1); }
  });
  ss.getSheetByName('users').getRange('F:G').setNumberFormat('@'); // เก็บวันที่เป็นข้อความ
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
  return u;
}

function createUser(userId) {
  const now = new Date();
  usersSheet().appendRow([userId, FREE_CREDITS_FOR_NEW_FRIEND, 0, '', '', '', '', now, now]);
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
  const r = askGemini('งานใหม่ที่กำลังจะเริ่มเดือนหน้าจะไปได้ดีไหม', cards, loadDailyMeta());
  console.log(JSON.stringify(r, null, 2));
}
