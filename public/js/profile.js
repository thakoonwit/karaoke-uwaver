(function() {
  const dialog = document.getElementById('profileDialog');
  const form = document.getElementById('profileForm');
  const input = document.getElementById('profileNameInput');
  const canonicalInput = document.getElementById('nicknameInput');
  const closeBtn = document.getElementById('profileCloseBtn');
  const saveBtn = document.getElementById('profileSaveBtn');
  const error = document.getElementById('profileError');
  const title = document.getElementById('profileTitle');
  const description = document.getElementById('profileDescription');
  const note = document.getElementById('profileQueueNote');
  let savedName = '';
  try { savedName = (localStorage.getItem('vrs_nickname') || '').trim(); } catch {}
  if (savedName.length > 20) savedName = '';
  canonicalInput.value = savedName;

  function openSettings() {
    const firstVisit = !savedName;
    input.value = savedName;
    error.hidden = true;
    input.removeAttribute('aria-invalid');
    closeBtn.hidden = firstVisit;
    note.hidden = firstVisit;
    title.textContent = firstVisit ? 'ให้เรียกคุณว่าอะไรดี?' : 'ตั้งค่าของคุณ';
    description.textContent = firstVisit
      ? 'ใส่ชื่อที่จะแสดงในคิวเพลง ครั้งต่อไปไม่ต้องกรอกอีก'
      : 'เปลี่ยนชื่อผู้ร้องสำหรับเพลงที่คุณขอ';
    saveBtn.textContent = firstVisit ? 'บันทึกและเริ่มเลือกเพลง' : 'บันทึกชื่อ';
    dialog.classList.toggle('profile-first-visit', firstVisit);
    document.body.classList.add('request-profile-open');
    if (!dialog.open) dialog.showModal();
  }

  document.getElementById('profileSettingsBtn').addEventListener('click', openSettings);
  closeBtn.addEventListener('click', () => { if (savedName) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (!savedName) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('request-profile-open');
    if (!savedName) openSettings();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name || name.length > 20) {
      error.textContent = 'กรุณาใส่ชื่อผู้ร้อง 1–20 ตัวอักษร';
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    try { localStorage.setItem('vrs_nickname', name); }
    catch {
      error.textContent = 'บันทึกชื่อไม่ได้ กรุณาอนุญาตให้เบราว์เซอร์จัดเก็บข้อมูลแล้วลองอีกครั้ง';
      error.hidden = false;
      return;
    }
    savedName = name;
    canonicalInput.value = name;
    dialog.close();
  });
  if (!savedName) openSettings();
})();
