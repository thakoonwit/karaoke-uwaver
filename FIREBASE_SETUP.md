# เก็บเฉพาะห้องใน Firebase แบบฟรี ไม่ผูกบัตร

โปรเจกต์: `karaoke-uwaver` ใช้แผน **Spark** โดยไม่เชื่อม Cloud Billing และไม่เปลี่ยนเป็น Blaze

## 1. สร้าง Firestore

ใน [Firebase Console](https://console.firebase.google.com/project/karaoke-uwaver/firestore) ไปที่ **Build → Firestore Database → Create database** เลือก **Standard edition**, database ID `(default)` และ region ที่เหมาะกับเซิร์ฟเวอร์ หากมีให้เลือกใช้ Singapore (`asia-southeast1`) จากนั้นเลือก **Production mode**

## 2. สร้างบัญชี backend — ไม่ต้องสร้าง Service account key

ใน Firebase ไปที่ **Build → Authentication → Get started → Sign-in method → Email/Password** เปิดเฉพาะ Email/Password แล้ว Save

ไปแท็บ **Users → Add user** สร้างบัญชีใหม่สำหรับ backend โดยเฉพาะ ตั้งรหัสผ่านที่ไม่ซ้ำกับบัญชีส่วนตัว ไม่ต้องใช้รหัสผ่าน Google ของคุณ จากนั้นคัดลอก **User UID** ของบัญชีที่สร้าง

นำเนื้อหาใน [firestore.rules](firestore.rules) ไปใส่แท็บ **Firestore Database → Rules** แทน `REPLACE_WITH_BACKEND_USER_UID` ทั้งสองจุดด้วย UID ที่คัดลอกมา แล้ว **Publish**

กฎนี้อนุญาตเฉพาะบัญชี backend บัญชีเดียวให้อ่านและสร้างข้อมูลห้อง บัญชีอื่นและผู้ไม่ล็อกอินเข้าถึงไม่ได้ ไม่ต้องเปิด Rules เป็น public และไม่ต้องขอสิทธิ์แก้นโยบายองค์กร

ผู้ขอเพลงและแอดมินห้องยังเข้าเว็บตามเดิม ไม่ต้องล็อกอิน Firebase บัญชีนี้ backend ใช้เองเท่านั้น ไม่ต้องเปิด Analytics, Cloud Storage หรือ Cloud Functions

## 3. ตั้งค่าใน Render

Service → **Environment** เพิ่ม:

| Key | Value |
| --- | --- |
| `ROOM_STORAGE` | `firestore` |
| `FIREBASE_PROJECT_ID` | `karaoke-uwaver` |
| `FIREBASE_API_KEY` | ค่า `apiKey` จาก web config ใน Firebase Project settings |
| `FIREBASE_AUTH_EMAIL` | อีเมลบัญชี backend ที่สร้างในขั้นตอน 2 |
| `FIREBASE_AUTH_PASSWORD` | รหัสผ่านของบัญชี backend นั้น |
| `PUBLIC_URL` | `https://karaoke.uwaver.site` |

จากนั้น Save และ deploy โค้ดเวอร์ชันที่รองรับ Firestore ไม่ต้องใส่ `FIREBASE_SERVICE_ACCOUNT_JSON` สำหรับวิธีนี้ เก็บรหัสผ่านบัญชี backend เฉพาะใน Render Environment ไม่ใส่ใน frontend, GitHub หรือแชต

backend ล็อกอินผ่าน Firebase Auth REST API และต่ออายุ token อัตโนมัติ ไม่ต้องสร้าง/หมุน token ด้วยตนเอง หากเคยจำกัด API key ต้องอนุญาต Identity Toolkit API, Token Service API และ Cloud Firestore API และไม่ใช้ข้อจำกัด HTTP referrer สำหรับ key ที่ backend เรียก

ไม่ต้องใส่ Firebase credential ใน frontend ถ้า credential ผิด/Firestore ติดต่อไม่ได้ตอนเริ่มเซิร์ฟเวอร์ แอปจะไม่เริ่มรับคำขอ แทนการแสดงรายการห้องว่าง หากบันทึกห้องใหม่ไม่สำเร็จ แอปจะไม่แจ้งว่าสร้างห้องสำเร็จ

### ทางเลือกเดิม: Service account

หากมี service-account JSON ที่ได้รับอนุญาตอยู่แล้ว ยังใช้ `ROOM_STORAGE=firestore` กับ `FIREBASE_SERVICE_ACCOUNT_JSON` ได้โดยไม่ตั้ง Auth email/password บัญชี service account ต้องมีสิทธิ์ Firestore ผ่าน IAM เช่น `roles/datastore.user` วิธีนี้ไม่ผ่าน Security Rules และไม่จำเป็นสำหรับวิธีอีเมลด้านบน

## ข้อมูลที่เก็บ

แต่ละห้องเป็นเอกสาร `karaokeRooms/{รหัสห้อง}` มีเพียง `name`, `salt`, `pinHash`, `createdAt` รหัสห้องเป็น document ID โดย PIN จริงไม่ถูกบันทึก ห้อง `main` เป็นห้องในตัวแอปและยังใช้ `ADMIN_PIN` ของ Render

QR สร้างใหม่จาก `PUBLIC_URL` + `?room=รหัสห้องเดิม` จึงไม่ต้องเก็บรูป QR และยังใช้ป้ายเดิมหลัง Render รีสตาร์ทได้เมื่อโดเมนและข้อมูลห้องยังอยู่

**ไม่เก็บคิวเพลง ประวัติ ลิสต์เพลง หรือการตั้งค่าของคิวใน Firebase** ข้อมูลเหล่านี้ยังใช้ระบบเดิม และส่วนที่อยู่บนดิสก์ Render Free อาจหายเมื่อพัก/รีสตาร์ท

## ห้องเดิมและการใช้งานฟรี

ตอนเริ่มระบบจะอ่านห้องจาก Firestore หนึ่งครั้ง และย้ายห้องที่มีเฉพาะใน `data/rooms.json` ขึ้นไปโดยคงรหัสและ PIN hash เดิม จากนั้นเขียนเฉพาะตอนสร้างห้อง ไม่มี polling ตามจำนวนคนเข้าห้อง ถ้ารหัสชนกับข้อมูลบน Firestore จะใช้ข้อมูลบน Firestore เป็นหลัก

หาก Render ทำไฟล์ห้องเดิมหายไปแล้วก่อนเปิดใช้ Firebase จะกู้ห้องจาก QR เพียงอย่างเดียวไม่ได้ ต้องนำ `rooms.json` สำรองเดิมกลับมาก่อน ป้ายห้องที่มีข้อมูลเดิมจะใช้ต่อได้

ใช้ Spark ภายในโควตาฟรี โดยไม่มีการเปิด billing ในโค้ดนี้ ดู [แผน Spark](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) และ [โควตา Firestore](https://firebase.google.com/docs/firestore/quotas)

ทดสอบหลังตั้งค่า: สร้างห้อง → เก็บ QR → รีสตาร์ท service → สแกน QR เดิม → ตรวจว่าชื่อห้องและ PIN เดิมยังใช้ได้ คิวเพลงอาจว่างซึ่งเป็นขอบเขตที่ตั้งใจไว้
