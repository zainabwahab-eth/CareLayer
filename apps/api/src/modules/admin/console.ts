// Minimal admin page (Z9): sign in with an emailed code (app "admin"), review pending nurses,
// open their documents (signed 10-minute links), approve or reject with a reason.
// Plain HTML + JS, no build step. Nurse-supplied text is only ever set with textContent, never
// as HTML. The script runs under a per-response CSP nonce. The access token lives in memory; the
// refresh cookie (Path=/auth) restores the session on reload.
import { randomBytes } from 'node:crypto';

export const adminConsoleNonce = () => randomBytes(16).toString('base64');

export function adminConsoleHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>CareLayer admin</title>
<style>
  :root { --canvas:#F3F5F2; --surface:#FFFFFF; --ink:#13201D; --muted:#55635F; --line:#D9E1DC; --primary:#0F4A43; --verified:#1D6FA8; --danger:#B42318; }
  @media (prefers-color-scheme: dark) { :root { --canvas:#131917; --surface:#1B2320; --ink:#EBF0ED; --muted:#A3B0AB; --line:#2E3935; --primary:#1F6B60; --verified:#7DB8E8; --danger:#F2938A; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--canvas); color:var(--ink); font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { display:flex; justify-content:space-between; align-items:center; padding:16px 24px; border-bottom:1px solid var(--line); background:var(--surface); }
  h1 { font-size:18px; margin:0; } h2 { font-size:17px; margin:0 0 12px; }
  main { max-width:1100px; margin:0 auto; padding:24px 16px; display:grid; gap:24px; grid-template-columns: minmax(260px, 360px) 1fr; }
  @media (max-width: 800px) { main { grid-template-columns: 1fr; } }
  .card { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:20px; }
  .hidden { display:none !important; }
  input, select, textarea { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--canvas); color:var(--ink); font:inherit; }
  label { display:block; font-size:13px; color:var(--muted); margin:12px 0 4px; }
  button { padding:10px 16px; border-radius:10px; border:1px solid var(--line); background:var(--surface); color:var(--ink); font:inherit; font-weight:600; cursor:pointer; min-height:44px; }
  button.primary { background:var(--primary); border-color:var(--primary); color:#fff; }
  button.danger { color:var(--danger); border-color:var(--danger); }
  button:disabled { opacity:.5; cursor:default; }
  ul.list { list-style:none; margin:0; padding:0; } ul.list li { border-bottom:1px solid var(--line); }
  ul.list button { width:100%; text-align:left; border:0; border-radius:0; font-weight:400; padding:12px 4px; }
  ul.list button.active { background:var(--canvas); }
  .muted { color:var(--muted); font-size:13px; } .error { color:var(--danger); } .ok { color:var(--verified); }
  dl { display:grid; grid-template-columns: 180px 1fr; gap:6px 12px; margin:0 0 16px; } dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }
  .docs { display:grid; gap:12px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); margin:12px 0 20px; }
  .doc { border:1px solid var(--line); border-radius:12px; padding:12px; } .doc img { width:100%; max-height:180px; object-fit:contain; background:var(--canvas); border-radius:8px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
</style>
</head>
<body>
<header><h1>CareLayer admin: nurse verification</h1><div class="row"><span id="who" class="muted"></span><button id="logout" class="hidden">Log out</button></div></header>

<section id="login" class="card" style="max-width:420px;margin:48px auto">
  <h2>Sign in</h2>
  <p class="muted">Admins only. We email you a 6-digit code.</p>
  <label for="email">Email</label><input id="email" type="email" autocomplete="email">
  <div id="codeRow" class="hidden"><label for="code">Code</label><input id="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>
  <p id="loginMsg" class="muted"></p>
  <div class="row"><button id="sendCode" class="primary">Send me a code</button><button id="verify" class="primary hidden">Sign in</button></div>
</section>

<main id="app" class="hidden">
  <section class="card">
    <label for="status">Show</label>
    <select id="status"><option value="pending_review">Waiting for review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="draft">Not submitted yet</option></select>
    <ul id="list" class="list" style="margin-top:12px"></ul>
    <button id="more" class="hidden" style="margin-top:12px">Load more</button>
    <p id="listMsg" class="muted"></p>
  </section>
  <section class="card" id="detail"><p class="muted">Choose a nurse to review.</p></section>
</main>

<script nonce="${nonce}">
(() => {
  const $ = (id) => document.getElementById(id);
  let token = null, cursor = null, current = null;

  async function api(method, path, body, retry = true) {
    const res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry && path !== '/auth/refresh') { if (await refresh()) return api(method, path, body, false); showLogin(); }
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message ?? ('Request failed (' + res.status + ')'));
    return data;
  }
  async function refresh() {
    try { const r = await api('POST', '/auth/refresh', null, false); if (r.user.role !== 'admin') return false; token = r.accessToken; $('who').textContent = r.user.email; return true; }
    catch { return false; }
  }
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = String(text); if (cls) e.className = cls; return e; };

  function showLogin() { token = null; $('app').classList.add('hidden'); $('logout').classList.add('hidden'); $('login').classList.remove('hidden'); $('who').textContent = ''; }
  function showApp() { $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('logout').classList.remove('hidden'); loadList(true); }

  $('sendCode').onclick = async () => {
    $('loginMsg').textContent = ''; $('loginMsg').className = 'muted';
    try { await api('POST', '/auth/code/request', { email: $('email').value.trim(), purpose: 'login', app: 'admin' }); $('codeRow').classList.remove('hidden'); $('verify').classList.remove('hidden'); $('loginMsg').textContent = 'Code sent. Check your email (or the API log in local dev).'; $('code').focus(); }
    catch (e) { $('loginMsg').textContent = e.message; $('loginMsg').className = 'error'; }
  };
  $('verify').onclick = async () => {
    try { const r = await api('POST', '/auth/code/verify', { email: $('email').value.trim(), code: $('code').value.trim(), purpose: 'login', app: 'admin', deviceName: 'Admin console' }, false); token = r.accessToken; $('who').textContent = r.user.email; showApp(); }
    catch (e) { $('loginMsg').textContent = e.message; $('loginMsg').className = 'error'; }
  };
  $('logout').onclick = async () => { try { await api('POST', '/auth/logout'); } catch {} showLogin(); };
  $('status').onchange = () => loadList(true);
  $('more').onclick = () => loadList(false);

  async function loadList(reset) {
    if (reset) { cursor = null; $('list').replaceChildren(); }
    $('listMsg').textContent = 'Loading…';
    try {
      const q = new URLSearchParams({ status: $('status').value, limit: '20', ...(cursor ? { cursor } : {}) });
      const page = await api('GET', '/admin/nurses?' + q);
      for (const n of page.items) {
        const li = el('li'); const b = el('button');
        b.append(el('div', n.fullName), el('div', [n.role ?? 'role not set', n.licenceNumber ?? 'no licence number', n.submittedAt ? 'submitted ' + new Date(n.submittedAt).toLocaleString() : 'not submitted'].join(' · '), 'muted'));
        b.onclick = () => { document.querySelectorAll('#list button').forEach((x) => x.classList.remove('active')); b.classList.add('active'); openNurse(n.userId); };
        li.append(b); $('list').append(li);
      }
      cursor = page.nextCursor; $('more').classList.toggle('hidden', !cursor);
      $('listMsg').textContent = $('list').children.length ? '' : 'Nobody here.';
    } catch (e) { $('listMsg').textContent = e.message; }
  }

  const DOC_LABELS = { practising_licence: 'Practising licence', registration_certificate: 'Certificate of registration', government_id: 'Government ID', selfie_with_id: 'Selfie with ID' };

  async function openNurse(id) {
    const box = $('detail'); box.replaceChildren(el('p', 'Loading…', 'muted'));
    try {
      const n = await api('GET', '/admin/nurses/' + encodeURIComponent(id)); current = n;
      const h = el('h2', n.fullName); const dl = el('dl');
      const add = (k, v) => dl.append(el('dt', k), el('dd', v === null || v === undefined || v === '' ? '—' : v));
      add('Status', n.verificationStatus.replace('_', ' ')); add('Email', n.email); add('Role', n.role); add('Licence number', n.licenceNumber);
      add('Name confirmed as on licence', n.fullNameConfirmed ? 'yes' : 'no'); add('Years of practice', n.yearsOfPractice); add('Practice area', n.practiceArea);
      add('Gender', n.gender); add('Languages', n.languages.join(', ')); add('Topics', n.topics.join(', ')); add('Bio', n.bio);
      add('Guidance, not diagnosis', n.guidanceNotDiagnosisAccepted ? 'agreed' : 'not agreed'); if (n.rejectionReason) add('Last rejection', n.rejectionReason);
      const docs = el('div', null, 'docs');
      for (const t of Object.keys(DOC_LABELS)) {
        const d = n.documents.find((x) => x.type === t); const c = el('div', null, 'doc'); c.append(el('strong', DOC_LABELS[t]));
        if (!d) { c.append(el('p', 'Missing', 'error')); }
        else {
          const url = n.documentUrls[d.id];
          if (d.mimeType.startsWith('image/') && d.mimeType !== 'image/heic') { const img = new Image(); img.alt = DOC_LABELS[t]; img.src = url; c.append(img); }
          const a = el('a', 'Open ' + (d.mimeType === 'application/pdf' ? 'PDF' : 'file') + ' in a new tab'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          c.append(el('p', d.fileName + ' · ' + Math.round(d.sizeBytes / 1024) + ' KB', 'muted'), a);
        }
        docs.append(c);
      }
      const note = el('p', 'Check the licence against the NMCN register before approving. Document links last 10 minutes; reopen the nurse for new ones.', 'muted');
      box.replaceChildren(h, dl, el('strong', 'Documents'), docs, note);
      if (n.verificationStatus === 'pending_review') {
        const msg = el('p', '', 'muted'); const reason = el('textarea'); reason.rows = 3; reason.placeholder = 'Reason for rejection (the nurse sees this)';
        const approve = el('button', 'Approve', 'primary'); const reject = el('button', 'Reject', 'danger');
        approve.onclick = () => decide('approve', null, msg, [approve, reject]);
        reject.onclick = () => decide('reject', reason.value.trim(), msg, [approve, reject]);
        const rl = el('label', 'Reason (for rejection)'); box.append(rl, reason, el('div', null, 'row'), msg); box.lastChild.previousSibling.append(approve, reject);
      }
    } catch (e) { box.replaceChildren(el('p', e.message, 'error')); }
  }

  async function decide(action, reason, msg, buttons) {
    if (action === 'approve' && !confirm('Approve ' + current.fullName + '? Only if the licence checks out on the NMCN register.')) return;
    buttons.forEach((b) => (b.disabled = true)); msg.className = 'muted'; msg.textContent = 'Saving…';
    try { await api('POST', '/admin/nurses/' + encodeURIComponent(current.userId) + '/' + action, action === 'reject' ? { reason } : undefined); msg.className = 'ok'; msg.textContent = action === 'approve' ? 'Approved. She has been emailed.' : 'Rejected. She has been emailed the reason.'; loadList(true); }
    catch (e) { msg.className = 'error'; msg.textContent = e.message; buttons.forEach((b) => (b.disabled = false)); }
  }

  refresh().then((ok) => (ok ? showApp() : showLogin()));
})();
</script>
</body>
</html>`;
}
