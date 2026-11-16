# Black Cat Tarot – คู่มือตั้งค่าบอท LINE 🐈‍⬛

ระบบช่วงทดสอบ (ช่วงที่ 1) ทำได้ 2 อย่าง
- **แอดเพื่อนครั้งแรก** ได้สิทธิ์ถามไพ่ 4 ใบฟรี 1 คำถาม (AI Gemini ทำนาย)
- **ไพ่ประจำวัน** ฟรีวันละ 1 ใบ (คำทำนายจากแท็บ `daily`)

ทุกข้อความเป็นการ "ตอบกลับ" หลังลูกค้าทักมา จึงใช้แพ็กเกจ LINE OA ฟรีได้

## ในโฟลเดอร์นี้มีอะไร

| ไฟล์ | ใช้ทำอะไร |
|---|---|
| `docs/cards/` | รูปไพ่ 78 ใบ + หลังไพ่ (JPEG ย่อขนาดแล้ว) |
| `docs/liff/index.html` | หน้าเลือกไพ่ 4 ใบที่เปิดในแอป LINE |
| `docs/index.html`, `docs/logo.png` | หน้าแรกของเว็บ (ไม่บังคับ) |
| `apps-script/Code.gs` | โค้ดบอท วางใน Google Apps Script |
| `design/richmenu.jpg` | รูปเมนูด้านล่างแชต ขนาด 2500×843 |

ใช้เวลาตั้งค่าครั้งแรกประมาณ 1 ชั่วโมง ทำตามลำดับด้านล่างได้เลย

---

## ขั้นที่ 1: ขึ้นเว็บด้วย GitHub Pages

1. สร้าง repo ใหม่ชื่อ `blackcattarot-line` แบบ **Public** (GitHub Pages ฟรีต้องเป็น public)
2. push โฟลเดอร์นี้ขึ้นไป
   ```bash
   cd ~/IdeaProjects/Pocky/blackcattarot-line
   git init && git add . && git commit -m "Black Cat Tarot LINE bot"
   git branch -M main
   git remote add origin git@github.com:USERNAME/blackcattarot-line.git
   git push -u origin main
   ```
3. ใน repo ไปที่ **Settings → Pages** เลือก Source: *Deploy from a branch*, Branch: `main`, Folder: `/docs` แล้วกด Save
4. รอ 1–2 นาที แล้วลองเปิด
   - `https://USERNAME.github.io/blackcattarot-line/cards/maj_00.jpg` ต้องเห็นรูป The Fool
   - `https://USERNAME.github.io/blackcattarot-line/liff/?test=1` ต้องเลือกไพ่ได้ (โหมดทดสอบ ยังไม่ส่งเข้าแชต)

> repo เป็น public แปลว่าใครก็เห็นโค้ดและรูปไพ่ได้ ถ้าไม่อยากให้รูปไพ่หลุด ใช้ Cloudflare Pages หรือ Firebase Hosting แทนได้ ส่วนรหัสลับทั้งหมดอยู่ใน Apps Script ไม่ได้อยู่ใน repo

## ขั้นที่ 2: LINE OA + Messaging API

1. สร้างบัญชี LINE OA (ถ้ายังไม่มี) ที่ manager.line.biz ด้วย ID ฟรี
2. **การตั้งค่า → Messaging API → เปิดใช้** สร้าง Provider ชื่อ `Black Cat Tarot`
3. **การตั้งค่า → การตอบกลับ (Response settings)**
   - Webhook: **เปิด**
   - ข้อความตอบกลับอัตโนมัติ (Auto-response): **ปิด** ไม่อย่างนั้นลูกค้าจะได้ข้อความซ้ำ
   - ข้อความทักทาย (Greeting message): **ปิด** บอทส่งข้อความต้อนรับเอง
   - แชต: เปิดไว้ได้ ถ้าอยากตอบลูกค้าเองบ้าง
4. ไปที่ developers.line.biz → Provider `Black Cat Tarot` → channel ของ OA → แท็บ **Messaging API** → **Channel access token (long-lived)** กด Issue แล้วเก็บไว้ (ห้ามโพสต์หรือส่งให้ใคร)

## ขั้นที่ 3: Gemini API key

1. เข้า aistudio.google.com แล้วกด **Get API key → Create API key**
2. เก็บ key ไว้ใช้ในขั้นที่ 5

> แบบฟรีมีโควตาจำกัด (ประมาณ 20 ครั้งต่อวันสำหรับรุ่น Flash) และ Google อาจนำข้อมูลไปใช้พัฒนาระบบ เหมาะกับช่วงทดสอบเท่านั้น ก่อนเปิดรับลูกค้าจริงให้เปิด billing ใน AI Studio

## ขั้นที่ 4: Google Sheets (ฐานข้อมูล)

1. สร้าง Google Sheet ใหม่ ตั้งชื่อ `Black Cat Tarot DB`
2. นำเข้าคำทำนายไพ่ประจำวัน
   - เปิดตาราง **"Black Cat Tarot – คำทำนายไพ่ประจำวัน"** ใน Claude แล้วดาวน์โหลดเป็น `.xlsx`
   - ใน Google Sheet: **ไฟล์ → นำเข้า → อัปโหลด** เลือกไฟล์ แล้วเลือก **แทรกชีตใหม่**
   - ตรวจว่าแท็บชื่อ `daily` และแถวแรกมีหัวคอลัมน์ `ชื่อไพ่ | ชื่อไทย | คำทำนาย | คำแนะนำ | สีมงคล | card_id`
3. จากนี้ไปให้แก้คำทำนายใน Google Sheet นี้ (บอทอ่านจากที่นี่)

## ขั้นที่ 5: Apps Script (ตัวบอท)

1. ใน Google Sheet เดียวกัน: **ส่วนขยาย → Apps Script**
2. ลบโค้ดเดิม แล้ววางโค้ดทั้งหมดจาก `apps-script/Code.gs` กด Save
3. **Project Settings (รูปเฟือง) → Script Properties** เพิ่ม 5 ค่า

   | Property | ค่า |
   |---|---|
   | `LINE_CHANNEL_ACCESS_TOKEN` | token จากขั้นที่ 2 |
   | `GEMINI_API_KEY` | key จากขั้นที่ 3 |
   | `IMAGE_BASE_URL` | `https://USERNAME.github.io/blackcattarot-line/cards/` |
   | `LIFF_URL` | ใส่ทีหลังในขั้นที่ 7 |
   | `GEMINI_MODEL` | (ไม่บังคับ) ค่าเริ่มต้น `gemini-2.5-flash` |

4. เลือกฟังก์ชัน `setup` แล้วกด **Run** → อนุญาตสิทธิ์ (ขึ้นเตือน "Google hasn't verified this app" ให้กด Advanced → Go to ... เพราะเป็นสคริปต์ของคุณเอง)
   - ต้องเห็นใน log ว่า `daily: พบ 78/78 ใบ` และมีแท็บ `users`, `readings` เพิ่มขึ้นมา
5. เลือกฟังก์ชัน `testGemini` แล้วกด **Run** ต้องเห็นคำทำนายลงท้าย "เหมียว" ใน log
6. **Deploy → New deployment** → เลือกชนิด **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - กด Deploy แล้วคัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)

> ทุกครั้งที่แก้โค้ด ต้องไป **Deploy → Manage deployments → ✏️ → Version: New version → Deploy** ไม่อย่างนั้นบอทจะยังใช้โค้ดเก่า (URL เดิมไม่เปลี่ยน)

## ขั้นที่ 6: ต่อ Webhook

1. developers.line.biz → channel ของ OA → แท็บ **Messaging API**
2. **Webhook URL**: วาง URL จากขั้นที่ 5 → Update
3. เปิด **Use webhook**
4. ปุ่ม Verify อาจขึ้น error `302 Found` เป็นเรื่องปกติของ Apps Script บอทยังทำงานได้ ให้ทดสอบด้วยการทักแชตจริง

## ขั้นที่ 7: LIFF (หน้าเลือกไพ่)

LIFF ต้องสร้างใน channel แบบ **LINE Login** (ใส่ใน channel Messaging API ไม่ได้)

1. developers.line.biz → Provider `Black Cat Tarot` → **Create a new channel → LINE Login**
   - App types: **Web app**
2. แท็บ **Basic settings** → **Linked LINE Official Account** เลือก OA ของคุณ
3. แท็บ **LIFF → Add**
   - Size: **Full**
   - Endpoint URL: `https://USERNAME.github.io/blackcattarot-line/liff/`
   - Scopes: ติ๊ก **chat_message.write**
   - Bot link feature: **On (Normal)**
   - กด Add แล้วจะได้ **LIFF ID** และ **LIFF URL** (`https://liff.line.me/xxxx-yyyy`)
4. แก้ไฟล์ `docs/liff/index.html` บรรทัด `const LIFF_ID = 'PUT_YOUR_LIFF_ID_HERE';` เป็น LIFF ID ของคุณ แล้ว commit + push
5. กลับไปใส่ `LIFF_URL` ใน Script Properties (ขั้นที่ 5) ไม่ต้อง deploy ใหม่
6. channel LINE Login ที่ยังเป็นสถานะ **Developing** จะใช้ได้เฉพาะผู้ดูแล channel ก่อนให้เพื่อนทดสอบ ต้องกด **Publish** ที่หัวหน้า channel

## ขั้นที่ 8: Rich Menu

1. manager.line.biz → **ริชเมนู (Rich menus) → สร้าง**
2. เลือกเทมเพลต **ขนาดเล็ก (Compact) แบบ 3 ช่อง** แล้วอัปโหลด `design/richmenu.jpg`
3. ตั้ง Action ทั้ง 3 ช่องเป็น **ข้อความ (Text)**
   - A: `เปิดไพ่วันนี้`
   - B: `ถามไพ่ 4 ใบ`
   - C: `วิธีใช้`
4. ข้อความบนแถบเมนู: `เมนูเหมียว 🐾` ตั้งให้แสดงเมนูเป็นค่าเริ่มต้น แล้วกดบันทึก

## ขั้นที่ 9: ทดสอบ

- [ ] แอดเพื่อน OA (ถ้าแอดไว้แล้ว บล็อกแล้วเลิกบล็อก) → ได้ข้อความต้อนรับ + สิทธิ์ฟรี 1 คำถาม
- [ ] กด "เปิดไพ่วันนี้" → ได้การ์ดไพ่พร้อมรูป กดซ้ำวันเดียวกันต้องได้ใบเดิม
- [ ] กด "ถามไพ่ 4 ใบ" → พิมพ์คำถาม → กดปุ่มเลือกไพ่ → เลือก 4 ใบ → เปิดไพ่ → ส่ง
- [ ] ได้การ์ดไพ่ 4 ใบ + คำทำนาย ภายในไม่กี่วินาที
- [ ] กด "ถามไพ่ 4 ใบ" อีกครั้ง → บอทบอกว่าสิทธิ์หมดแล้ว
- [ ] ใน Google Sheet แท็บ `users` มีแถวของคุณ และแท็บ `readings` มีบันทึกคำทำนาย

ทดสอบซ้ำด้วยบัญชีเดิม: แก้ `free_credits` ในแท็บ `users` เป็น 1

## แก้ปัญหาเบื้องต้น

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| ทักแล้วบอทเงียบ | ดู Apps Script → **Executions** ว่ามี error ไหม / ลืม deploy เวอร์ชันใหม่ / Webhook ยังไม่เปิด |
| ได้ข้อความตอบกลับซ้ำ 2 อัน | ยังไม่ได้ปิดข้อความตอบกลับอัตโนมัติหรือข้อความทักทายใน OA Manager |
| การ์ดไม่มีรูป | `IMAGE_BASE_URL` ผิด หรือ GitHub Pages ยังไม่ขึ้น ลองเปิด URL รูปในเบราว์เซอร์ |
| หน้าเลือกไพ่ส่งไม่ได้ | ต้องเปิดจากปุ่มในแชต 1:1 กับ OA / ยังไม่ได้ติ๊ก scope `chat_message.write` / ยังไม่ได้ใส่ LIFF ID |
| บอทบอก "ลูกแก้ววิเศษขัดข้อง" | Gemini error ดู log: `429` = โควตาฟรีหมด ลองเปลี่ยน `GEMINI_MODEL` เป็นรุ่น Flash-Lite (ดูชื่อรุ่นล่าสุดใน AI Studio) |
| แก้คำทำนายแล้วไม่เปลี่ยน | ระบบ cache 10 นาที กด Run ฟังก์ชัน `clearCache` |

## เรื่องความเป็นส่วนตัว

- แท็บ `readings` เก็บคำถามของลูกค้า ห้ามแชร์ Google Sheet นี้แบบสาธารณะ
- ข้อความเตือน "เพื่อความบันเทิง" อยู่ในข้อความต้อนรับและเมนูวิธีใช้แล้ว
- AI ถูกสั่งไม่ให้ทำนายเรื่องหวย ความตาย หรือแนะนำเรื่องการรักษา/การลงทุน และถ้าคำถามสื่อว่าลูกค้าอาจทำร้ายตัวเอง บอทจะไม่ทำนาย ไม่ตัดสิทธิ์ และแนะนำสายด่วนสุขภาพจิต 1323 แทน
