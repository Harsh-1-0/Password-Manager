// popup.js — UI wiring for the password manager extension popup

// Simple password generator
const generatePassword = (length = 16, useSymbols = true) => {
  const uChar = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lChar = 'abcdefghijklmnopqrstuvwxyz';
  const num = '0123456789';
  const sym = '!@#$%^&*()_+[]{}|;:,.<>?';
  const pool = uChar + lChar + num + (useSymbols ? sym : '');
  let password = '';
  for (let i = 0; i < length; i++) password += pool.charAt(Math.floor(Math.random() * pool.length));
  return password;
};

// Crypto utils: PBKDF2 -> AES-GCM; store only ciphertext in persistent storage.
const textEnc = new TextEncoder();
const textDec = new TextDecoder();

async function deriveKey(passphrase, saltBytes) {
  const baseKey = await crypto.subtle.importKey('raw', textEnc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 150000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function getRandomBytes(len) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return a;
}

async function encryptString(plain, key) {
  const iv = getRandomBytes(12);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, textEnc.encode(plain));
  return { iv: Array.from(iv), ct: Array.from(new Uint8Array(cipherBuf)) };
}

async function decryptString(enc, key) {
  const iv = new Uint8Array(enc.iv);
  const ct = new Uint8Array(enc.ct);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return textDec.decode(plainBuf);
}

// Session key helpers (in-memory only)
async function sessionSetKey(passphrase) {
  const salt = getRandomBytes(16);
  const key = await deriveKey(passphrase, salt);
  if (chrome?.storage?.session) {
    await chrome.storage.session.set({ passbuddy_session: { salt: Array.from(salt) } });
  }
  return { key, salt };
}

async function sessionGetKey(passphrase) {
  if (!chrome?.storage?.session) return null;
  const data = await new Promise((r) => chrome.storage.session.get('passbuddy_session', (res) => r(res.passbuddy_session || null)));
  if (!data?.salt) return null;
  const key = await deriveKey(passphrase, new Uint8Array(data.salt));
  return { key, salt: new Uint8Array(data.salt) };
}

// unlocked flag in session
async function sessionSetUnlocked(val) {
  if (!chrome?.storage?.session) return;
  await chrome.storage.session.set({ passbuddy_unlocked: !!val });
}

async function sessionIsUnlocked() {
  if (!chrome?.storage?.session) return false;
  return await new Promise((r) => chrome.storage.session.get('passbuddy_unlocked', (res) => r(!!res.passbuddy_unlocked)));
}

// Persistent storage helpers: chrome.storage.local or localStorage
function storageGet() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['credentials', 'passbuddy_meta'], (res) => resolve({
        credentials: res.credentials || [],
        meta: res.passbuddy_meta || null
      }));
    } else {
      try {
        const raw = localStorage.getItem('credentials');
        const meta = localStorage.getItem('passbuddy_meta');
        resolve({ credentials: raw ? JSON.parse(raw) : [], meta: meta ? JSON.parse(meta) : null });
      } catch (e) {
        resolve({ credentials: [], meta: null });
      }
    }
  });
}

function storageSet(credentials, meta) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const payload = { credentials };
      if (meta) payload.passbuddy_meta = meta;
      chrome.storage.local.set(payload, () => resolve());
    } else {
      localStorage.setItem('credentials', JSON.stringify(credentials));
      if (meta) localStorage.setItem('passbuddy_meta', JSON.stringify(meta));
      resolve();
    }
  });
}

// Render credentials into the list
async function renderCredentials() {
  const listEl = document.getElementById('credentialsList');
  listEl.innerHTML = '';
  const { credentials, meta } = await storageGet();
  if (!credentials.length) {
    listEl.innerHTML = '<div class="credential-item">No saved credentials</div>';
    return;
  }

  const maskPassword = (pwd) => '•'.repeat(Math.max(8, Math.min(12, (pwd || '').length || 10)));

  credentials.slice().reverse().forEach((c) => {
    const item = document.createElement('div');
    item.className = 'credential-item';

    const site = document.createElement('div');
    site.className = 'credential-site';
    site.textContent = c.site || '(no site)';

    const user = document.createElement('div');
    user.className = 'credential-username';
    user.textContent = c.username || '';

  const pass = document.createElement('div');
  pass.className = 'credential-password';
  // If encrypted, show masked; reveal/decrypt on demand
  const encrypted = c.e === 1 && c.payload;
  pass.textContent = encrypted ? maskPassword('') : maskPassword(c.password);
  pass.dataset.revealed = '0';

    const actions = document.createElement('div');
    actions.style.marginTop = '8px';
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const revealBtn = document.createElement('button');
    revealBtn.textContent = 'Show';
    revealBtn.style.padding = '6px 10px';
    revealBtn.style.borderRadius = '6px';
    revealBtn.addEventListener('click', async () => {
      try {
        if (pass.dataset.revealed === '1') {
          pass.textContent = encrypted ? maskPassword('') : maskPassword(c.password);
          pass.dataset.revealed = '0';
          revealBtn.textContent = 'Show';
          return;
        }
        if (encrypted) {
          const passphrase = prompt('Enter master password to decrypt');
          if (!passphrase) return;
          // Attempt to derive key using stored salt in session
          let session = await sessionGetKey(passphrase);
          if (!session) {
            // If session salt not set, initialize and then re-derive (first unlock in this session)
            const tmp = await sessionSetKey(passphrase);
            session = await sessionGetKey(passphrase);
          }
          const plain = await decryptString(c.payload, session.key);
          pass.textContent = plain;
          pass.dataset.revealed = '1';
          revealBtn.textContent = 'Hide';
        } else {
          pass.textContent = c.password || '';
          pass.dataset.revealed = '1';
          revealBtn.textContent = 'Hide';
        }
      } catch (err) {
        alert('Failed to decrypt. Wrong master password?');
      }
    });

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.padding = '6px 10px';
    copyBtn.style.borderRadius = '6px';
    copyBtn.addEventListener('click', async () => {
      try {
        let toCopy = c.password || '';
        if (c.e === 1 && c.payload) {
          const passphrase = prompt('Enter master password to decrypt');
          if (!passphrase) return;
          let session = await sessionGetKey(passphrase);
          if (!session) {
            const tmp = await sessionSetKey(passphrase);
            session = await sessionGetKey(passphrase);
          }
          toCopy = await decryptString(c.payload, session.key);
        }
        await navigator.clipboard.writeText(toCopy);
        copyBtn.textContent = 'Copied';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
      } catch (e) {
        copyBtn.textContent = 'Err';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.style.padding = '6px 10px';
    delBtn.style.borderRadius = '6px';
    delBtn.addEventListener('click', async () => {
      const all = await storageGet();
      const filtered = all.filter(x => x.id !== c.id);
      await storageSet(filtered);
      await renderCredentials();
    });

  actions.appendChild(revealBtn);
  actions.appendChild(copyBtn);
    actions.appendChild(delBtn);

    item.appendChild(site);
    item.appendChild(user);
    item.appendChild(pass);
    item.appendChild(actions);

    listEl.appendChild(item);
  });
}

// Wire UI
document.addEventListener('DOMContentLoaded', () => {
  const genBtn = document.getElementById('generatePassword');
  const pwdInput = document.getElementById('password');
  const form = document.getElementById('credentialForm');
  const showBtn = document.getElementById('showCredentials');
  const siteInput = document.getElementById('site');
  const fillBtn = document.getElementById('fillOnPage');
  const setupMaster = document.getElementById('setupMaster');
  const unlockMaster = document.getElementById('unlockMaster');
  const lockStatus = document.getElementById('lockStatus');
  const lockError = document.getElementById('lockError');
  const newMaster = document.getElementById('newMaster');
  const confirmMaster = document.getElementById('confirmMaster');
  const setMasterBtn = document.getElementById('setMasterBtn');
  const masterKey = document.getElementById('masterKey');
  const unlockBtn = document.getElementById('unlockBtn');

  // Try to auto-fill site with current tab's domain
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.url) return;
      try {
        const url = new URL(tab.url);
        const domain = url.hostname || url.origin || tab.url;
        if (siteInput && !siteInput.value) siteInput.value = domain;
      } catch (_) { /* ignore */ }
    });
  }

  // Initialize lock UI state
  (async () => {
    const { meta } = await storageGet();
    const hasMaster = !!meta?.hasMaster;
    const unlocked = hasMaster ? await sessionIsUnlocked() : true;
    setupMaster.style.display = hasMaster ? 'none' : 'block';
    unlockMaster.style.display = hasMaster ? 'block' : 'none';
    lockStatus.textContent = hasMaster ? (unlocked ? 'Unlocked' : 'Locked') : 'No master password set';
    if (hasMaster && !unlocked) {
      showBtn.disabled = true;
      showBtn.title = 'Unlock to view saved credentials';
    } else {
      showBtn.disabled = false;
      showBtn.title = '';
    }
  })();

  setMasterBtn?.addEventListener('click', async () => {
    lockError.style.display = 'none';
    const p1 = newMaster.value;
    const p2 = confirmMaster.value;
    if (!p1 || p1 !== p2) {
      lockError.textContent = 'Passwords do not match.';
      lockError.style.display = 'block';
      return;
    }
    await sessionSetKey(p1);
    const { credentials } = await storageGet();
    // Re-encrypt any plaintext entries and mark meta
    const session = await sessionGetKey(p1);
    const transformed = await Promise.all(credentials.map(async (c) => {
      if (c.e === 1 && c.payload) return c; // already encrypted
      const payload = await encryptString(c.password, session.key);
      return { id: c.id, site: c.site, username: c.username, e: 1, payload };
    }));
    await storageSet(transformed, { hasMaster: true });
    setupMaster.style.display = 'none';
    unlockMaster.style.display = 'block';
    lockStatus.textContent = 'Locked';
    form.reset();
    document.getElementById('credentialsList').innerHTML = '';
  });

  unlockBtn?.addEventListener('click', async () => {
    lockError.style.display = 'none';
    const passphrase = masterKey.value;
    if (!passphrase) return;
    try {
      const session = await sessionGetKey(passphrase) || await sessionSetKey(passphrase) && await sessionGetKey(passphrase);
      // quick decrypt check on first encrypted item (if exists)
      const { credentials } = await storageGet();
      const sample = credentials.find(c => c.e === 1);
      if (sample) await decryptString(sample.payload, session.key);
  lockStatus.textContent = 'Unlocked';
  await sessionSetUnlocked(true);
  showBtn.disabled = false;
  showBtn.title = '';
    } catch (e) {
      lockError.textContent = 'Wrong master password.';
      lockError.style.display = 'block';
    }
  });

  // Helpers for messaging/injection
  function withActiveHttpTab(fn) {
    if (!chrome?.tabs?.query) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.url || !/^https?:/i.test(tab.url)) return;
      fn(tab);
    });
  }

  function injectContent(tabId, cb) {
    if (!chrome?.scripting?.executeScript) return cb && cb();
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content.js'] },
      () => cb && cb()
    );
  }

  function sendSuggestion(tabId, password) {
    try {
      chrome.tabs.sendMessage(tabId, { type: 'PASSBUDDY_SUGGEST', password }, () => {
        if (chrome.runtime.lastError) {
          injectContent(tabId, () => {
            chrome.tabs.sendMessage(tabId, { type: 'PASSBUDDY_SUGGEST', password }, () => void 0);
          });
        }
      });
    } catch (_) { /* ignore */ }
  }

  genBtn.addEventListener('click', () => {
    pwdInput.value = generatePassword();
    withActiveHttpTab((tab) => sendSuggestion(tab.id, pwdInput.value));
  });

  // Fill the current page's password input with the value from the popup
  if (fillBtn) {
    fillBtn.addEventListener('click', () => {
      const pwd = pwdInput.value;
      if (!pwd) return;
      withActiveHttpTab((tab) => {
        sendSuggestion(tab.id, pwd);
        if (chrome?.scripting?.executeScript) {
          chrome.scripting.executeScript(
            {
              target: { tabId: tab.id },
              func: (value) => {
                const candidates = [
                  'input[type="password"]',
                  'input[name*="password" i]',
                  'input[id*="password" i]'
                ];
                let input = null;
                for (const sel of candidates) {
                  input = document.querySelector(sel);
                  if (input) break;
                }
                if (!input) return false;
                input.focus();
                input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              },
              args: [pwd]
            },
            () => void 0
          );
        }
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const site = document.getElementById('site').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!site || !username || !password) return;

    // Save encrypted if master set; else plaintext
    const { meta } = await storageGet();
    let toStore;
    if (meta?.hasMaster) {
      const passphrase = prompt('Enter master password to encrypt');
      if (!passphrase) return;
      let session = await sessionGetKey(passphrase);
      if (!session) {
        await sessionSetKey(passphrase);
        session = await sessionGetKey(passphrase);
      }
      const payload = await encryptString(password, session.key);
      toStore = { id: Date.now().toString(), site, username, e: 1, payload };
    } else {
      toStore = { id: Date.now().toString(), site, username, password };
    }
    const { credentials } = await storageGet();
    const all = credentials;
    all.push(toStore);
    await storageSet(all, meta || null);

    const saveBtn = document.getElementById('saveCredential');
    saveBtn.classList.add('saving');
    saveBtn.textContent = 'Saved';
    setTimeout(() => {
      saveBtn.classList.remove('saving');
      saveBtn.textContent = 'Save Credential';
    }, 900);

    form.reset();
  await renderCredentials();
  });

  showBtn.addEventListener('click', async () => {
    const listEl = document.getElementById('credentialsList');
    const { meta } = await storageGet();
    if (meta?.hasMaster) {
      const unlocked = await sessionIsUnlocked();
      if (!unlocked) {
        lockError.textContent = 'Unlock to view saved credentials.';
        lockError.style.display = 'block';
        return;
      }
    }
    if (listEl.style.display === 'block') {
      listEl.style.display = 'none';
      showBtn.textContent = 'Show Saved Credentials';
      return;
    }
    await renderCredentials();
    listEl.style.display = 'block';
    showBtn.textContent = 'Hide Saved Credentials';
  });

  // initial
  document.getElementById('credentialsList').style.display = 'none';
});
