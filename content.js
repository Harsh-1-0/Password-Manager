// content.js — offers generated password suggestion and saves on submit

(function() {
  const SUGGESTION_ID = '__passbuddy_suggestion__';
  let latestSuggestion = null;

  // Listen for messages from popup/background to set a suggestion
  chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
    if (msg && msg.type === 'PASSBUDDY_SUGGEST' && typeof msg.password === 'string') {
      latestSuggestion = msg.password;
      attachSuggestion(latestSuggestion);
    }
  });

  // Observe added inputs and re-attach suggestion if needed
  const observer = new MutationObserver(() => {
    if (latestSuggestion) attachSuggestion(latestSuggestion);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

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
    const input = findPasswordInput();
    if (!input) return;

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

    // If user clicks into input, prefill with suggestion once
    const onFocus = () => {
      if (input.value) return;
      input.value = password;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.removeEventListener('focus', onFocus);
    };
    input.addEventListener('focus', onFocus);

    // Save on form submit: capture form and send message to background to store
    const form = input.form || input.closest('form');
    if (form && !form.__passbuddy_hooked__) {
      form.__passbuddy_hooked__ = true;
      form.addEventListener('submit', () => {
        const site = location.hostname;
        const username = findUsernameNear(input) || '';
        const pwd = input.value;
        if (!pwd) return;
        chrome.runtime.sendMessage({
          type: 'PASSBUDDY_SAVE',
          payload: { id: Date.now().toString(), site, username, password: pwd }
        });
      }, { capture: true });
    }
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
})();
