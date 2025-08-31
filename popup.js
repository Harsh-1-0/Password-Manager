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

// Storage helpers: prefer chrome.storage.local, fallback to localStorage
function storageGet() {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['credentials'], (res) => resolve(res.credentials || []));
    } else {
      try {
        const raw = localStorage.getItem('credentials');
        resolve(raw ? JSON.parse(raw) : []);
      } catch (e) {
        resolve([]);
      }
    }
  });
}

function storageSet(credentials) {
  return new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ credentials }, () => resolve());
    } else {
      localStorage.setItem('credentials', JSON.stringify(credentials));
      resolve();
    }
  });
}

// Render credentials into the list
async function renderCredentials() {
  const listEl = document.getElementById('credentialsList');
  listEl.innerHTML = '';
  const credentials = await storageGet();
  if (!credentials.length) {
    listEl.innerHTML = '<div class="credential-item">No saved credentials</div>';
    return;
  }

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
    pass.textContent = c.password || '';

    const actions = document.createElement('div');
    actions.style.marginTop = '8px';
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.padding = '6px 10px';
    copyBtn.style.borderRadius = '6px';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(c.password || '');
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

  // Try to auto-fill site with current tab's domain
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.url) return;
        try {
          const url = new URL(tab.url);
          // Prefer hostname (domain), fallback to origin
          const domain = url.hostname || url.origin || tab.url;
          // Only set if field is empty so user can override
          if (siteInput && !siteInput.value) {
            siteInput.value = domain;
          }
        } catch (e) {
          // ignore URL parse errors
        }
      });
    } catch (e) {
      // ignore
    }
  }

  genBtn.addEventListener('click', () => {
    pwdInput.value = generatePassword();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const site = document.getElementById('site').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    if (!site || !username || !password) return;

    const newCred = { id: Date.now().toString(), site, username, password };
    const all = await storageGet();
    all.push(newCred);
    await storageSet(all);

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
