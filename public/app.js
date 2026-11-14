(() => {
  'use strict';
  const app = document.querySelector('#app');
  const path = location.pathname.split('/').filter(Boolean);
  const mode = path[0] || 'home';
  const code = path[1] || '';
  const token = path[2] || '';
  const base = code ? `/api/rooms/${code}` : '';
  const safe = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const brand = '<span class="brand"><span class="brand-icon">SQ</span> <span>short-quiz</span> <span class="kicker">LIVE</span></span>';
  let latest = null;
  let stream = null;
  let lastVersion = null;
  let clientId = sessionStorage.getItem('live-client-id');
  if (!clientId) {
    clientId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'c' + Date.now().toString(16) + Array.from({length:32}, () => Math.floor(Math.random()*16).toString(16)).join('');
    sessionStorage.setItem('live-client-id', clientId);
  }
  function el(id) { return document.getElementById(id); }
  function notice(text, error = false) {
    const box = el('notice'); if (!box) return;
    box.textContent = text; box.classList.toggle('error', error);
  }
  async function api(url, body, admin = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (admin) headers['X-Admin-Token'] = token;
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erro de ligação.');
    return data;
  }
  async function setupStream() {
    try {
      const response = await fetch(base);
      if (!response.ok) return expired('Esta sala não existe ou já expirou.');
      latest = await response.json();
      update(latest);
    } catch { /* EventSource tentará restabelecer a ligação. */ }
    stream = new EventSource(base + '/events');
    stream.onmessage = ({ data }) => {
      const snapshot = JSON.parse(data);
      if (snapshot.type === 'closed') return expired('A sessão foi encerrada pelo administrador.');
      latest = snapshot;
      update(snapshot);
    };
    stream.onerror = async () => {
      const status = el('connection');
      if (status) status.textContent = 'A restabelecer ligação…';
      try { const response = await fetch(base); if (response.status === 404 || response.status === 410) expired('Esta sala já não está disponível.'); } catch {}
    };
    stream.onopen = () => { const status = el('connection'); if (status) status.textContent = 'Em directo'; };
  }
  function expired(message) {
    if (stream) stream.close();
    app.innerHTML = `<div class="app"><div class="top">${brand}</div><div class="card" style="max-width:550px;margin:10vh auto"><div class="kicker">Sessão terminada</div><h1>${safe(message)}</h1><p>As perguntas e respostas já não existem na memória do servidor.</p><a href="/" class="btn">Criar uma nova sala</a></div></div>`;
  }
  function makeCloud(target, snapshot, isScreen = false) {
    target.replaceChildren();
    if (!snapshot.answers.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = snapshot.question ? 'À espera das respostas…' : 'A próxima pergunta aparece aqui.';
      target.appendChild(empty);
      return;
    }
    const max = snapshot.answers[0].count;
    const numberOfWords = snapshot.answers.length;
    // A apresentação adapta a escala à quantidade de respostas e ao ecrã.
    // O painel de controlo mantém uma nuvem pequena como pré-visualização.
    const viewportScale = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
    const largest = isScreen
      ? Math.max(48, Math.min(185, (198 / Math.pow(numberOfWords, 0.34)) * Math.max(0.72, Math.min(viewportScale, 1.2))))
      : 49;
    const smallest = isScreen ? 24 : 17;
    for (const answer of snapshot.answers) {
      const word = document.createElement('span');
      word.className = 'cloud-term' + (answer.count === max ? ' leader' : '');
      const portion = answer.count / max;
      word.style.fontSize = `${Math.round(smallest + (largest - smallest) * Math.pow(portion, 0.75))}px`;
      word.append(document.createTextNode(answer.text));
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `×${answer.count}`;
      word.append(count);
      target.appendChild(word);
    }
  }
  function update(snapshot) {
    const question = el('current-question');
    if (question) question.textContent = snapshot.question || (mode === 'screen' ? 'À espera da pergunta…' : 'Nenhuma pergunta publicada');
    const total = el('total-count');
    if (total) total.textContent = `${snapshot.total} ${snapshot.total === 1 ? 'resposta' : 'respostas'}`;
    const cloud = el('cloud');
    if (cloud) makeCloud(cloud, snapshot, mode === 'screen');
    if (mode === 'join') updateJoin(snapshot);
    if (mode === 'admin') updateAdmin(snapshot);
  }
  function updateJoin(snapshot) {
    const form = el('vote-form');
    if (form) form.hidden = !snapshot.question;
    const waiting = el('waiting');
    if (waiting) waiting.hidden = !!snapshot.question;
    if (lastVersion !== snapshot.version) {
      lastVersion = snapshot.version;
      if (el('answer')) el('answer').value = '';
      notice(snapshot.question ? 'Nova pergunta. Podes responder!' : '');
    }
  }
  function updateAdmin(snapshot) {
    const list = el('answer-list');
    if (!list) return;
    list.replaceChildren();
    for (const answer of snapshot.answers) {
      const row = document.createElement('div'); row.className = 'answer-row';
      const name = document.createElement('strong'); name.textContent = answer.text;
      const count = document.createElement('span'); count.className = 'amount'; count.textContent = `×${answer.count}`;
      const button = document.createElement('button'); button.className = 'remove';
      button.textContent = '×'; button.title = `Eliminar todas as ocorrências de ${answer.text}`;
      button.onclick = async () => {
        try { await api(base + '/remove', { answer: answer.text }, true); notice(`«${answer.text}» removida e bloqueada nesta pergunta.`); }
        catch (error) { notice(error.message, true); }
      };
      row.append(name, count, button); list.appendChild(row);
    }
    if (!snapshot.answers.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Ainda sem respostas.'; list.appendChild(empty); }
  }
  function renderHome() {
    app.innerHTML = `<div class="app"><header class="top">${brand}<span class="status"><span class="dot"></span> Sem base de dados</span></header>
      <section class="hero"><div class="kicker">PERGUNTAS E RESPOSTAS EM DIRECTO</div><h1 class="huge">Uma pergunta.<br><span>Todas as respostas.</span></h1>
      <p class="subtitle">Cria uma pergunta, partilha o QR Code e vê as respostas aparecerem no ecrã. As mais repetidas crescem e ficam verdes. Tudo em tempo real, sem contas e sem guardar dados.</p>
      <div class="btn-row"><button id="create" class="btn">+ Criar uma sala</button></div><p id="notice" class="notice"></p></section>
      <div class="card"><div class="kicker">COMO FUNCIONA</div><p>1 · Escreves a pergunta &nbsp; → &nbsp; 2 · Partilhas o QR Code &nbsp; → &nbsp; 3 · Projectas a nuvem de respostas &nbsp; → &nbsp; 4 · Fazes reset quando terminares.</p><hr class="rule"><form id="join-by-code"><label for="room-code">Tens um código de sala?</label><div class="input-row"><input id="room-code" maxlength="6" autocomplete="off" placeholder="Ex.: A7K9QM" aria-label="Código da sala"><button class="btn btn-secondary" type="submit">Entrar</button></div></form></div>
      <p class="footer">As respostas existem apenas na memória do servidor. Um reinício ou reset elimina a sessão.</p></div>`;
    el('join-by-code').onsubmit = e => { e.preventDefault(); const value = el('room-code').value.trim().toUpperCase(); if (!/^[A-HJ-NP-Z2-9]{6}$/.test(value)) { notice('Código inválido. Confirma os seis caracteres.', true); return; } location.href = '/join/' + value; };
    el('create').onclick = async () => {
      const button = el('create'); button.disabled = true; button.textContent = 'A criar sala…';
      try { const room = await api('/api/rooms'); location.href = room.adminUrl; }
      catch (error) { notice(error.message, true); button.disabled = false; button.textContent = '+ Criar uma sala'; }
    };
  }
  function renderAdmin() {
    const joinUrl = `${location.origin}/join/${code}`;
    const screenUrl = `${location.origin}/screen/${code}`;
    app.innerHTML = `<div class="app"><header class="top">${brand}<span class="status"><span class="dot"></span><span id="connection">A ligar…</span></span></header>
      <div class="top" style="align-items:end"><div><div class="kicker">PAINEL DO ADMINISTRADOR</div><h1 style="font-size:clamp(29px,5vw,44px);margin:9px 0 0">Sala <span class="code">${code}</span></h1></div><a class="btn btn-secondary btn-min" href="${screenUrl}" target="_blank" rel="noreferrer">◩ Abrir apresentação numa 2.ª janela</a></div>
      <div class="panel-grid"><div class="column"><section class="card"><h2>01 · Faz a pergunta</h2><p>Uma pergunta de cada vez. Publicar outra pergunta apaga as respostas anteriores.</p>
      <form id="question-form"><label for="question">Pergunta para os participantes</label><textarea id="question" maxlength="150" placeholder="Ex.: Que palavra descreve a tua identidade?" required></textarea><div class="btn-row"><button type="submit" class="btn">Publicar pergunta →</button></div></form>
      <p id="notice" class="notice"></p></section>
      <section class="card"><div class="top" style="margin-bottom:15px"><div><h2>Nuvem de respostas</h2><span id="total-count" class="live-count">0 respostas</span></div><span class="status"><span class="dot"></span> AO VIVO</span></div><h2 id="current-question" style="margin:0 0 14px">Nenhuma pergunta publicada</h2><div class="cloud-shell"><div class="cloud" id="cloud"><span class="empty">À espera…</span></div></div></section>
      <section class="card"><h2>Moderar respostas</h2><p>Elimina respostas impróprias. Ao eliminar uma palavra ou frase, todas as respostas iguais desaparecem e ficam bloqueadas até à próxima pergunta.</p><div id="answer-list" class="answer-list"></div></section></div>
      <aside class="column"><section class="card"><h2>02 · Partilha com a sala</h2><p>Mostra este QR Code. Cada participante responde do próprio telemóvel.</p><img class="qr" src="${base}/qr" alt="Código QR para entrar na sala"><div class="small muted">CÓDIGO DA SALA</div><div class="code">${code}</div><label for="join-link" style="margin-top:14px">Link para responder</label><div class="input-row"><input id="join-link" value="${safe(joinUrl)}" readonly><button id="copy-link" class="btn btn-secondary btn-min">Copiar</button></div><div class="btn-row"><a href="${joinUrl}" target="_blank" rel="noreferrer" class="btn btn-secondary btn-min">Testar no telemóvel ↗</a></div></section>
      <section class="card"><h2>03 · Controlos da sessão</h2><p>Podes limpar as respostas sem apagar a pergunta ou encerrar completamente a sala.</p><div class="btn-row"><button id="clear" class="btn btn-secondary btn-min">Limpar respostas</button><button id="reset" class="btn btn-danger btn-min">Reset total</button></div><hr class="rule"><p class="small">⚠ Reset total: elimina a pergunta, as respostas e a própria sala da memória. O QR Code deixa de funcionar.</p></section>
      <section class="card"><h2>Apresentação no 2.º ecrã</h2><p>Abre a apresentação numa segunda janela, arrasta-a para o projector e usa o botão «Ecrã inteiro». O painel de controlo fica neste ecrã.</p><a href="${screenUrl}" target="_blank" rel="noreferrer" class="btn btn-secondary btn-block">Abrir ecrã de respostas ↗</a></section></aside></div>
      <p class="footer">Não feches nem partilhes o endereço de administrador: contém a chave de controlo. O link e o QR Code dos participantes são diferentes.</p></div>`;
    el('question-form').onsubmit = async e => {
      e.preventDefault(); const question = el('question').value.trim();
      if (latest?.total && !confirm('Publicar uma nova pergunta vai apagar todas as respostas anteriores. Continuar?')) return;
      try { await api(base + '/question', { question }, true); notice('Pergunta publicada! As respostas podem começar.'); }
      catch (error) { notice(error.message, true); }
    };
    el('copy-link').onclick = async () => {
      try { await navigator.clipboard.writeText(joinUrl); notice('Link copiado.'); }
      catch { el('join-link').select(); notice('Selecciona e copia o link.'); }
    };
    el('clear').onclick = async () => {
      if (!confirm('Limpar todas as respostas desta pergunta?')) return;
      try { await api(base + '/clear', {}, true); notice('Respostas apagadas da memória.'); }
      catch (error) { notice(error.message, true); }
    };
    el('reset').onclick = async () => {
      if (!confirm('RESET TOTAL? Apaga a sala inteira e invalida todos os links. Não pode ser desfeito.')) return;
      try { await api(base + '/reset', {}, true); location.href = '/'; }
      catch (error) { notice(error.message, true); }
    };
  }
  function renderJoin() {
    app.innerHTML = `<div class="app participant"><header class="top">${brand}<span class="status"><span class="dot"></span><span id="connection">A ligar…</span></span></header>
      <div class="kicker">A TUA VOZ CONTA</div><div class="poll-info">SALA <span class="code" style="font-size:17px">${code}</span></div>
      <h1 id="current-question">A carregar pergunta…</h1><div id="waiting" class="card"><h2>À espera da pergunta</h2><p>O administrador ainda não publicou uma pergunta. Este ecrã vai actualizar automaticamente.</p></div>
      <form id="vote-form" class="card" hidden><label for="answer">Escreve a tua resposta</label><textarea id="answer" maxlength="65" placeholder="A minha resposta é…" required></textarea><div class="btn-row"><button class="btn btn-block" type="submit">Enviar resposta →</button></div><div class="small muted" style="margin-top:12px">Resposta anónima · Podes corrigir enviando outra</div></form>
      <p id="notice" class="notice"></p><p class="footer">As respostas são anónimas e temporárias. Não escrevas dados pessoais.</p></div>`;
    el('vote-form').onsubmit = async e => {
      e.preventDefault(); const button = el('vote-form').querySelector('button');
      button.disabled = true;
      try { await api(base + '/vote', { answer: el('answer').value, clientId }); notice('✓ Resposta enviada! Já está no ecrã.'); }
      catch (error) { notice(error.message, true); }
      finally { button.disabled = false; }
    };
  }
  function renderScreen() {
    app.innerHTML = `<div class="screen">
      <header class="screen-meta">
        ${brand}
        <div class="screen-meta-actions"><span class="screen-status"><span class="dot"></span><span id="connection">A ligar…</span></span><button class="screen-action" id="fullscreen" type="button" aria-label="Apresentar em ecrã inteiro">⛶ Ecrã inteiro</button></div>
      </header>
      <section class="presentation-content">
        <div class="screen-prompt"><span class="screen-kicker">PERGUNTA EM DIRECTO</span><h1 id="current-question" class="question">À espera da pergunta…</h1></div>
        <div class="cloud-shell"><div id="cloud" class="cloud"><span class="empty">As respostas vão aparecer aqui.</span></div></div>
      </section>
      <div class="screen-count" id="total-count">0 respostas</div>
      <div id="presentation-join" class="presentation-join">
        <img class="screen-qr" alt="QR Code para participar" src="${base}/qr">
        <div class="presentation-join-label"><strong>${code}</strong><span>Entra e responde</span></div>
      </div>
      <button id="qr-toggle" class="screen-qr-toggle" type="button">Ocultar QR</button>
    </div>`;
    const toggle = el('qr-toggle');
    const qr = el('presentation-join');
    toggle.onclick = () => {
      qr.hidden = !qr.hidden;
      toggle.textContent = qr.hidden ? 'Mostrar QR' : 'Ocultar QR';
    };
    el('fullscreen').onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch { el('fullscreen').textContent = 'Usa F11'; }
    };
    window.addEventListener('resize', () => {
      if (latest && el('cloud')) makeCloud(el('cloud'), latest, true);
    });
  }
  if (mode === 'home') renderHome();
  else if (mode === 'admin' && /^[a-f0-9]{64}$/.test(token)) { renderAdmin(); setupStream(); }
  else if (mode === 'join') { renderJoin(); setupStream(); }
  else if (mode === 'screen') { renderScreen(); setupStream(); }
  else expired('Endereço de sala inválido.');
  // Enquanto o administrador ou ecrã de projecção estiver activo,
  // efectua um pedido periódico para reduzir suspensões por inactividade.
  if (mode === 'admin' || mode === 'screen') {
    setInterval(() => { fetch('/health', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);
  }
})();
