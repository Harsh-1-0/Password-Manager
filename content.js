// content.js — offers generated password suggestion and saves on submit

(function() {
  const SUGGESTION_ID = '__passbuddy_suggestion__';
  const BUBBLE_ID = '__passbuddy_bubble__';
  let latestSuggestion = null;
  let isAttaching = false; // prevent observer feedback loops

  // Simple password generator (mirrors popup)
  function generatePassword(length = 16, useSymbols = true) {
    const u = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const l = 'abcdefghijklmnopqrstuvwxyz';
    const n = '0123456789';
    const s = '!@#$%^&*()_+[]{}|;:,.<>?';
    const pool = u + l + n + (useSymbols ? s : '');
    let out = '';
    for (let i = 0; i < length; i++) out += pool.charAt(Math.floor(Math.random() * pool.length));
    return out;
  }

  // Listen for messages from popup/background to set a suggestion
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
      if (msg && msg.type === 'PASSBUDDY_SUGGEST' && typeof msg.password === 'string') {
        latestSuggestion = msg.password;
        attachSuggestion(latestSuggestion);
      }
    });
  } catch {}

  // Observe added inputs and re-attach suggestion if needed
  const observer = new MutationObserver((mutations) => {
    // Only react when password inputs are added or removed
    if (!latestSuggestion || isAttaching) return;
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) {
          const el = /** @type {Element} */(n);
          if (
            el.matches?.('input[type="password"], input[name*="password" i], input[id*="password" i]') ||
            el.querySelector?.('input[type="password"], input[name*="password" i], input[id*="password" i]')
          ) {
            attachSuggestion(latestSuggestion);
            return;
          }
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Auto-generate on focusing a password input
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const type = (el.getAttribute('type') || '').toLowerCase();
    const isPwd = type === 'password' || /password/i.test(el.name || '') || /password/i.test(el.id || '');
    if (!isPwd) return;
    handlePasswordFocus(el);
  });

  function findPasswordInput() {
    const candidates = [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]'
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function attachSuggestion(password) {
    if (isAttaching) return;
    isAttaching = true;
    const input = findPasswordInput();
    if (!input) { isAttaching = false; return; }

    // Use datalist suggestion approach for wide compatibility
    let datalist = document.getElementById(SUGGESTION_ID);
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = SUGGESTION_ID;
      document.body.appendChild(datalist);
    }

    datalist.innerHTML = '';
    const option = document.createElement('option');
    option.value = password;
    option.label = 'Suggested strong password';
    datalist.appendChild(option);

    // Ensure input is able to show suggestions
    input.setAttribute('list', SUGGESTION_ID);

    // Prefill on focus, once; avoid duplicate listeners
    if (!input.dataset.passbuddyFocusHooked) {
      const onFocus = () => {
        if (input.value) return;
        input.value = password;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        showBubble(input, password);
        input.removeEventListener('focus', onFocus);
      };
      input.addEventListener('focus', onFocus);
      input.dataset.passbuddyFocusHooked = '1';
    }

    // Save on form submit: capture form and send message to background to store
    const form = input.form || input.closest('form');
  if (form && !form.__passbuddy_hooked__) {
      form.__passbuddy_hooked__ = true;
      form.addEventListener('submit', () => {
        const site = location.hostname;
        const username = findUsernameNear(input) || '';
        const pwd = input.value;
        if (!pwd) return;
        try {
          chrome.runtime.sendMessage({
            type: 'PASSBUDDY_SAVE',
            payload: { id: Date.now().toString(), site, username, password: pwd }
          });
        } catch {}
      }, { capture: true });
    }
  isAttaching = false;
  }

  function findUsernameNear(pwdInput) {
    // Try to detect a nearby username/email field
    const form = pwdInput.form || document;
    const candidates = [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[type="text"]',
      'input[name*="user" i]',
      'input[id*="user" i]'
    ];
    for (const sel of candidates) {
      const el = form.querySelector(sel);
      if (el && el !== pwdInput) return el.value || '';
    }
    return '';
  }

  function handlePasswordFocus(input) {
    // Avoid regenerating repeatedly within the same focus session
    if (input.dataset.passbuddyAutofilled === '1') {
      showBubble(input, input.value);
      return;
    }
    if (!input.value) {
      const pwd = generatePassword();
      latestSuggestion = pwd;
      input.value = pwd;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      showBubble(input, pwd);
      input.dataset.passbuddyAutofilled = '1';
    } else {
      // If user already typed, still offer a suggestion via bubble with regenerate
      showBubble(input, input.value);
    }

    // Ensure submit hook present
    const form = input.form || input.closest('form');
    if (form && !form.__passbuddy_hooked__) {
      form.__passbuddy_hooked__ = true;
      form.addEventListener('submit', () => {
        const site = location.hostname;
        const username = findUsernameNear(input) || '';
        const pwd = input.value;
        if (!pwd) return;
        try {
          chrome.runtime.sendMessage({ type: 'PASSBUDDY_SAVE', payload: { id: Date.now().toString(), site, username, password: pwd } });
        } catch {}
      }, { capture: true });
    }
  }

  function ensureStyles() {
    if (document.getElementById('__passbuddy_styles__')) return;
    const style = document.createElement('style');
    style.id = '__passbuddy_styles__';
    style.textContent = `
      #${BUBBLE_ID} { position: absolute; z-index: 2147483647; background: #1a202c; color: #fff; border-radius: 8px; padding: 8px 10px; box-shadow: 0 6px 20px rgba(0,0,0,.25); font: 12px/1.4 -apple-system, Segoe UI, Roboto, sans-serif; display: none; }
      #${BUBBLE_ID} .row { display: flex; align-items: center; gap: 8px; }
      #${BUBBLE_ID} .pwd { font-family: monospace; background: #2d3748; padding: 2px 6px; border-radius: 4px; }
      #${BUBBLE_ID} .btn { cursor: pointer; background: #4c51bf; border: none; color: #fff; border-radius: 6px; padding: 4px 8px; font-size: 11px; }
      #${BUBBLE_ID} .btn:hover { background: #434190; }
    `;
    document.documentElement.appendChild(style);
  }

  function getOrCreateBubble() {
    let bubble = document.getElementById(BUBBLE_ID);
    if (!bubble) {
      bubble = document.createElement('div');
      bubble.id = BUBBLE_ID;
      bubble.innerHTML = `<div class="row">Suggested: <span class="pwd"></span><button class="btn" data-action="regen">Regenerate</button></div>`;
      document.documentElement.appendChild(bubble);
    }
    return bubble;
  }

  function positionBubble(bubble, input) {
  const rect = input.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 6;
  const left = rect.left + window.scrollX;
  bubble.style.top = `${top}px`;
  bubble.style.left = `${left}px`;
  }

  let bubbleRaf = 0;
  function showBubble(input, password) {
    ensureStyles();
    const bubble = getOrCreateBubble();
    const pwdEl = bubble.querySelector('.pwd');
    if (pwdEl) pwdEl.textContent = password;
    if (bubbleRaf) cancelAnimationFrame(bubbleRaf);
    bubbleRaf = requestAnimationFrame(() => {
      positionBubble(bubble, input);
      bubble.style.display = 'block';
    });

    const onDocClick = (e) => {
      if (!bubble.contains(e.target) && e.target !== input) hideBubble();
    };
    document.addEventListener('mousedown', onDocClick, { once: true });

    const btn = bubble.querySelector('[data-action="regen"]');
  if (btn) {
      btn.onclick = () => {
        const newPwd = generatePassword();
        latestSuggestion = newPwd;
        input.value = newPwd;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        if (pwdEl) pwdEl.textContent = newPwd;
    if (bubbleRaf) cancelAnimationFrame(bubbleRaf);
    bubbleRaf = requestAnimationFrame(() => positionBubble(bubble, input));
      };
    }
  }

  function hideBubble() {
    const bubble = document.getElementById(BUBBLE_ID);
    if (bubble) bubble.style.display = 'none';
  }
})();
