(() => {
'use strict';
// ATLAS GESTÃO – versão sem servidor. Dados salvos no localStorage deste navegador.
const KEY = 'atlas_gestao_v1', $ = id => document.getElementById(id);
const TIPOS = ['ASO – Admissional','ASO – Periódico','ASO – Demissional','ASO – Retorno ao trabalho','ASO – Mudança de função','Exame complementar','Contrato de trabalho','RG / CPF','CTPS','Certificado / treinamento','Atestado','Outro'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp,.bmp,.heic,.doc,.docx,.odt,.rtf,.xls,.xlsx,.ods,.csv,.ppt,.pptx,.txt,.xml,.zip';
const MAX = 15 * 1024 * 1024;
const MODS = {
  despesas:     { title: 'Despesas', fields: [['desc','Descrição','text'],['valor','Valor (R$)','number'],['venc','Vencimento','date']], sum: 'valor', date: 'venc', soon: 7, flag: 'Pago' },
  documentos:   { title: 'Documentos', fields: [['nome','Nome do documento','text'],['tipo','Tipo','text'],['validade','Validade','date']], date: 'validade', soon: 30, attach: true },
  funcionarios: { title: 'Funcionários', fields: [['nome','Nome','text'],['cargo','Cargo','text'],['salario','Salário (R$)','number']], sum: 'salario' },
  funcdocs:     { title: 'Docs. de funcionários', fields: [['func','Funcionário','select'],['tipo','Tipo de documento / exame','select',TIPOS],['validade','Validade (opcional)','date']], date: 'validade', soon: 30, attach: true, multi: true, optional: ['validade'] },
  notas:        { title: 'Notas fiscais', fields: [['numero','Número','text'],['cliente','Cliente / fornecedor','text'],['emissao','Data de emissão','date'],['valor','Valor (R$)','number']], sum: 'valor', flag: 'Paga' }
};
let mod = 'geral', cur = null, editing = null, memStore = null;

/* ---------- armazenamento ---------- */
const load = () => { try { const t = localStorage.getItem(KEY); if (t) return JSON.parse(t); } catch (e) {} return memStore || { accounts: [], session: null, next: 1 }; };
const save = st => { memStore = st; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { alert('Não foi possível salvar neste navegador (armazenamento bloqueado ou cheio).'); } };
const acc = st => { const a = st.accounts.find(x => x.id === cur); if (a) { Object.keys(MODS).forEach(k => a.data[k] = a.data[k] || []); a.log = a.log || []; } return a; };
/* arquivos: IndexedDB (suporta arquivos grandes, ao contrário do localStorage) */
let dbp = null;
const idb = () => dbp || (dbp = new Promise((ok, no) => { const q = indexedDB.open('atlas_files', 1); q.onupgradeneeded = () => q.result.createObjectStore('f'); q.onsuccess = () => ok(q.result); q.onerror = () => { dbp = null; no(q.error); }; }));
const tx = (mode, fn) => idb().then(d => new Promise((ok, no) => { const t = d.transaction('f', mode), r = fn(t.objectStore('f')); t.oncomplete = () => ok(r && r.result); t.onerror = t.onabort = () => no(t.error); }));
const fput = (id, blob) => tx('readwrite', s => s.put(blob, id));
const fget = id => tx('readonly', s => s.get(id));
const fdel = id => tx('readwrite', s => s.delete(id));
const download = (blob, name) => { const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = name; document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(l.href), 2000); };

/* ---------- utilidades ---------- */
const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const digits = s => String(s).replace(/\D/g, '');
const fmtCnpj = c => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmt = (v, type) => type === 'number' ? brl(Number(v) || 0) : type === 'date' && v ? v.split('-').reverse().join('/') : esc(v);
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
function validCnpj(c) {
  c = digits(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = n => { const w = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let t = 0; for (let i = 0; i < n; i++) t += c[i] * w[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) == c[12] && dv(13) == c[13];
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
function derive(pw, saltHex) {
  if (!(window.crypto && crypto.subtle)) return Promise.reject(new Error('Este navegador não permite criptografia aqui. Abra o site por HTTPS ou localhost.'));
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits'])
    .then(k => crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, k, 256)).then(hex);
}
function status(M, r) {           // 'late' | 'soon' | null
  if (!M.date || !r[M.date] || r.ok) return null;
  if (r[M.date] < iso(new Date())) return 'late';
  return r[M.date] <= inDays(M.soon) ? 'soon' : null;
}
const badge = st => st === 'late' ? '<span class="badge late">Vencido</span>' : st === 'soon' ? '<span class="badge soon">Vence em breve</span>' : '';

/* ---------- autenticação ---------- */
const msg = (t, ok) => { const b = $('authMessage'); b.textContent = t; b.className = 'authmessage show' + (ok ? ' ok' : ''); };
const clearMsg = () => { const b = $('authMessage'); b.textContent = ''; b.className = 'authmessage'; };
function authMode(m) { clearMsg(); const l = m === 'login'; $('loginView').style.display = l ? 'block' : 'none'; $('registerView').style.display = l ? 'none' : 'block'; $('loginTab').classList.toggle('active', l); $('registerTab').classList.toggle('active', !l); }
const openAuth = m => { authMode(m); $('authScreen').classList.add('open'); };
const closeAuth = () => $('authScreen').classList.remove('open');
document.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => openAuth(b.dataset.auth)));
$('closeAuth').addEventListener('click', closeAuth);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAuth(); });
$('loginTab').addEventListener('click', () => authMode('login'));
$('registerTab').addEventListener('click', () => authMode('register'));

function enter(a) {
  cur = a.id; if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); closeAuth(); $('landing').style.display = 'none'; $('mainApp').classList.add('open');
  $('activeCompanyName').textContent = a.company; $('activeCompanyCnpj').textContent = fmtCnpj(a.cnpj); setMod('geral');
}
function leave() { cur = null; const st = load(); st.session = null; save(st); $('mainApp').classList.remove('open'); $('landing').style.display = 'block'; $('loginPassword').value = ''; window.scrollTo(0, 0); }

$('registerForm').addEventListener('submit', e => {
  e.preventDefault(); clearMsg();
  const company = $('regCompany').value.trim(), cnpj = digits($('regCnpj').value), email = $('regEmail').value.trim().toLowerCase(), pw = $('regPassword').value;
  if (pw !== $('regConfirm').value) return msg('As senhas não coincidem. Confira os dois campos.');
  if (pw.length < 8) return msg('A senha precisa ter ao menos 8 caracteres.');
  if (!validCnpj(cnpj)) return msg('CNPJ inválido. Confira os 14 dígitos.');
  if (load().accounts.some(a => a.email === email || a.cnpj === cnpj)) return msg('Já existe uma conta com esse e-mail ou CNPJ neste navegador.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  derive(pw, salt).then(h => {
    const st = load(), data = {}; Object.keys(MODS).forEach(k => data[k] = []);
    st.accounts.push({ id: st.next++, company, cnpj, email, salt, hash: h, data, seq: 1 }); save(st);
    $('loginEmail').value = email; $('loginPassword').value = ''; authMode('login'); msg('Empresa cadastrada. Entre com o e-mail e a senha criados.', true);
  }).catch(x => msg(x.message));
});
$('loginForm').addEventListener('submit', e => {
  e.preventDefault(); clearMsg();
  const a = load().accounts.find(x => x.email === $('loginEmail').value.trim().toLowerCase());
  if (!a) return msg('E-mail ou senha incorretos.');
  derive($('loginPassword').value, a.salt).then(h => {
    if (h !== a.hash) return msg('E-mail ou senha incorretos.');
    const st = load(); st.session = a.id; save(st); enter(a);
  }).catch(x => msg(x.message));
});
$('logoutBtn').addEventListener('click', leave);

/* ---------- backup ---------- */
$('backupBtn').addEventListener('click', () => {
  const a = acc(load()); if (!a) return;
  const blob = new Blob([JSON.stringify({ empresa: a.company, cnpj: a.cnpj, exportado_em: new Date().toISOString(), dados: a.data }, null, 2)], { type: 'application/json' });
  const l = document.createElement('a'); l.href = URL.createObjectURL(blob); l.download = 'backup-' + a.cnpj + '.json';
  document.body.appendChild(l); l.click(); l.remove(); setTimeout(() => URL.revokeObjectURL(l.href), 1000);
});
$('importBtn').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  f.text().then(t => {
    let o; try { o = JSON.parse(t); } catch (x) { return alert('Arquivo inválido: não é um backup do ATLAS.'); }
    const st = load(), a = acc(st);
    if (!o || !o.dados || o.cnpj !== a.cnpj) return alert('Este backup é de outra empresa ou está em formato inválido.');
    if (!confirm('Importar vai substituir os dados atuais desta empresa. Continuar?')) return;
    Object.keys(MODS).forEach(k => {
      const M = MODS[k]; if (M.attach) return; const list = Array.isArray(o.dados[k]) ? o.dados[k].slice(0, 5000) : [];
      a.data[k] = list.map(r => { const n = { id: a.seq++, ok: !!r.ok }; M.fields.forEach(([key,,type]) => n[key] = type === 'number' ? Math.max(0, Number(r[key]) || 0) : String(r[key] ?? '').slice(0, 200)); return n; });
    });
    save(st); setMod(mod);
  });
});

/* ---------- painel ---------- */
document.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => setMod(b.dataset.mod)));
function setMod(m) {
  mod = m; editing = null; $('search').value = '';
  document.querySelectorAll('[data-mod]').forEach(b => b.classList.toggle('active', b.dataset.mod === m));
  const g = m === 'geral'; $('modTitle').textContent = g ? 'Visão geral' : MODS[m].title;
  $('addForm').style.display = g ? 'none' : ''; $('searchRow').style.display = g ? 'none' : '';
  renderForm(); renderTable();
}
const stat = (label, val) => `<div class="stat"><span>${label}</span><b>${val}</b></div>`;
const empName = (a, r) => { const f = a.data.funcionarios.find(x => x.id === r.func); return f ? f.nome : (r.funcNome || '?') + ' (removido)'; };
const cell = (a, r, [k,, t]) => k === 'func' ? esc(empName(a, r)) : fmt(r[k], t);
const plain = (a, r, k) => String(k === 'func' ? empName(a, r) : r[k] ?? '').toLowerCase();
const size = n => n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const when = s => s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const logIt = (a, acao, arq, ref) => { a.log.unshift({ em: new Date().toISOString(), acao, arq, mod: MODS[mod].title, ref: ref || '' }); a.log.length = Math.min(a.log.length, 200); };

function renderForm() {
  if (mod === 'geral') { $('addForm').innerHTML = ''; return; }
  const a = acc(load()), M = MODS[mod];
  if (mod === 'funcdocs' && !a.data.funcionarios.length) { $('addForm').innerHTML = '<p class="empty">Cadastre primeiro um funcionário na aba Funcionários para anexar exames e documentos.</p>'; return; }
  const r = editing ? a.data[mod].find(x => x.id === editing) || {} : {};
  const req = k => (M.optional || []).includes(k) ? '' : ' required';
  $('addForm').innerHTML = M.fields.map(([k, label, type, opts]) => {
    if (type === 'select') {
      const list = k === 'func' ? a.data.funcionarios.map(f => [f.id, f.nome]) : opts.map(o => [o, o]);
      return `<select name="${k}" aria-label="${label}"${req(k)}><option value="">${label}</option>` + list.map(([v, t]) => `<option value="${esc(v)}"${String(r[k] ?? '') === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('') + '</select>';
    }
    return `<input name="${k}" type="${type}" placeholder="${label}" aria-label="${label}" title="${label}" value="${esc(r[k] ?? '')}"${req(k)}${type === 'number' ? ' step="0.01" min="0"' : ''}>`;
  }).join('')
    + (M.attach ? `<input name="file" type="file" aria-label="Anexar arquivo (PDF, imagem, Word, Excel e outros; até 15 MB)" title="Anexar arquivo (até 15 MB)" accept="${ACCEPT}"${M.multi && !editing ? ' multiple' : ''}${editing ? '' : ' required'}>` : '')
    + `<button class="btn" type="submit">${editing ? 'Salvar alterações' : M.attach ? 'Importar e registrar' : 'Adicionar'}</button>`
    + (editing ? '<button class="btn ghost" type="button" id="cancelEdit">Cancelar</button>' : '');
  const c = $('cancelEdit'); if (c) c.addEventListener('click', () => { editing = null; renderForm(); });
}

function monthTable(list) {
  const m = {};
  list.forEach(r => { const k = r.emissao ? r.emissao.slice(0, 7) : 'sem', o = m[k] || (m[k] = { n: 0, t: 0, ab: 0 }), v = Number(r.valor) || 0; o.n++; o.t += v; if (!r.ok) o.ab += v; });
  const keys = Object.keys(m).sort((x, y) => x === 'sem' ? 1 : y === 'sem' ? -1 : y.localeCompare(x));
  if (!keys.length) return '';
  const lab = k => k === 'sem' ? 'Sem data de emissão' : k.slice(5) + '/' + k.slice(0, 4);
  const tot = keys.reduce((s, k) => s + m[k].t, 0), qtd = list.length;
  return '<h3 class="subt">Total das notas por mês</h3><table><thead><tr><th>Mês</th><th>Notas</th><th>Valor total</th><th>Em aberto</th></tr></thead><tbody>'
    + keys.map(k => `<tr><td>${lab(k)}</td><td>${m[k].n}</td><td><b>${brl(m[k].t)}</b></td><td>${brl(m[k].ab)}</td></tr>`).join('')
    + `</tbody><tfoot><tr><td><b>Total geral</b></td><td><b>${qtd}</b></td><td><b>${brl(tot)}</b></td><td></td></tr></tfoot></table><h3 class="subt" style="margin-top:24px">Notas cadastradas</h3>`;
}

function renderTable() {
  const a = acc(load());
  if (mod === 'geral') {
    const d = a.data, pend = [], mes = iso(new Date()).slice(0, 7);
    let aberto = 0, atras = 0, notasMes = 0;
    ['despesas', 'documentos', 'funcdocs'].forEach(k => d[k].forEach(r => { const s = status(MODS[k], r); if (s) { pend.push({ k, r, s }); if (s === 'late') atras++; } }));
    d.despesas.forEach(r => { if (!r.ok) aberto += Number(r.valor) || 0; });
    d.notas.forEach(r => { if ((r.emissao || '').slice(0, 7) === mes) notasMes += Number(r.valor) || 0; });
    const folha = d.funcionarios.reduce((s, r) => s + (Number(r.salario) || 0), 0), arqs = [...d.documentos, ...d.funcdocs].filter(r => r.fileId).length;
    $('stats').innerHTML = stat('Despesas em aberto', brl(aberto)) + stat('Notas emitidas no mês', brl(notasMes)) + stat('Funcionários', d.funcionarios.length + ' · ' + brl(folha)) + stat('Itens vencidos', atras) + stat('Arquivos guardados', arqs);
    pend.sort((x, y) => x.r[MODS[x.k].date].localeCompare(y.r[MODS[y.k].date]));
    const item = ({ k, r }) => k === 'funcdocs' ? esc(empName(a, r)) + ' – ' + esc(r.tipo) : esc(r[MODS[k].fields[0][0]]);
    $('tableBox').innerHTML = '<h3 class="subt">Vencimentos e pendências</h3>' + (pend.length
      ? '<table><thead><tr><th>Módulo</th><th>Item</th><th>Data</th><th>Situação</th></tr></thead><tbody>' + pend.map(p => `<tr><td>${MODS[p.k].title}</td><td>${item(p)}</td><td>${fmt(p.r[MODS[p.k].date], 'date')}</td><td>${badge(p.s)}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="empty">Nenhuma pendência. Tudo em dia.</p>')
      + '<h3 class="subt" style="margin-top:24px">Registro de importações de arquivos</h3>' + (a.log.length
      ? '<table><thead><tr><th>Quando</th><th>Ação</th><th>Arquivo</th><th>Onde</th></tr></thead><tbody>' + a.log.slice(0, 10).map(l => `<tr><td>${when(l.em)}</td><td>${l.acao}</td><td>${esc(l.arq)}</td><td>${esc(l.mod)}${l.ref ? ' · ' + esc(l.ref) : ''}</td></tr>`).join('') + '</tbody></table>'
      : '<p class="empty">Nenhum arquivo importado ainda.</p>');
    return;
  }
  const M = MODS[mod], q = $('search').value.trim().toLowerCase(), all = a.data[mod];
  let rows = q ? all.filter(r => M.fields.some(([k]) => plain(a, r, k).includes(q)) || String(r.fileName || '').toLowerCase().includes(q)) : all;
  if (mod === 'funcdocs') rows = rows.slice().sort((x, y) => empName(a, x).localeCompare(empName(a, y)));
  const aberto = all.filter(r => !r.ok).reduce((s, r) => s + (Number(r[M.sum]) || 0), 0), geral = all.reduce((s, r) => s + (Number(r[M.sum]) || 0), 0);
  $('stats').innerHTML = stat('Registros', all.length) + (M.flag ? stat('Total em aberto', brl(aberto)) : '') + (M.sum ? stat('Total geral', brl(geral)) : '') + (M.attach ? stat('Arquivos guardados', all.filter(r => r.fileId).length) : '');
  const sit = M.flag || M.date;
  $('tableBox').innerHTML = (mod === 'notas' ? monthTable(all) : '') + (rows.length
    ? '<table><thead><tr>' + M.fields.map(f => `<th>${f[1]}</th>`).join('') + (M.attach ? '<th>Arquivo</th><th>Importado em</th>' : '') + (sit ? '<th>Situação</th>' : '') + '<th></th></tr></thead><tbody>'
      + rows.map(r => '<tr>' + M.fields.map(f => `<td>${cell(a, r, f)}</td>`).join('')
        + (M.attach ? `<td>${r.fileId ? esc(r.fileName) + ' <small>' + size(r.fileSize) + '</small>' : '—'}</td><td>${when(r.em)}</td>` : '')
        + (sit ? `<td>${M.flag ? `<label><input type="checkbox" data-ok="${r.id}"${r.ok ? ' checked' : ''}> ${M.flag}</label>` : ''}${badge(status(M, r))}</td>` : '')
        + `<td>${r.fileId ? `<button class="edit" data-dl="${r.id}" type="button">Baixar</button>` : ''}<button class="edit" data-edit="${r.id}" type="button">Editar</button><button data-del="${r.id}" type="button">Remover</button></td></tr>`).join('') + '</tbody></table>'
    : `<p class="empty">${q ? 'Nada encontrado para essa busca.' : 'Nenhum registro ainda. Adicione o primeiro acima.'}</p>`);
}

$('search').addEventListener('input', renderTable);
$('tableBox').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'), ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-dl]');
  if (dl) {
    const r = acc(load()).data[mod].find(x => x.id === +dl.dataset.dl);
    if (r && r.fileId) fget(r.fileId).then(b => b ? download(b, r.fileName) : alert('Arquivo não encontrado neste navegador.')).catch(() => alert('Não foi possível acessar o armazenamento de arquivos.'));
  }
  if (del && confirm('Remover este registro' + (acc(load()).data[mod].some(r => r.id === +del.dataset.del && r.fileId) ? ' e o arquivo anexado' : '') + '?')) {
    const st = load(), a = acc(st), r = a.data[mod].find(x => x.id === +del.dataset.del);
    if (r && r.fileId) { fdel(r.fileId).catch(() => {}); logIt(a, 'Removido', r.fileName, r.funcNome); }
    a.data[mod] = a.data[mod].filter(x => x.id !== +del.dataset.del); save(st); if (editing === +del.dataset.del) editing = null; renderForm(); renderTable();
  }
  if (ed) { editing = +ed.dataset.edit; renderForm(); $('addForm').scrollIntoView({ block: 'nearest' }); }
});
$('tableBox').addEventListener('change', e => {
  const c = e.target.closest('[data-ok]'); if (!c) return;
  const st = load(), r = acc(st).data[mod].find(x => x.id === +c.dataset.ok); if (r) { r.ok = c.checked; save(st); renderTable(); }
});
$('addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, M = MODS[mod], btn = form.querySelector('button[type=submit]'), st = load(), a = acc(st), list = a.data[mod];
  const vals = {}; M.fields.forEach(([k,, t]) => { const v = form.elements[k].value; vals[k] = t === 'number' ? Math.max(0, Number(v) || 0) : String(v).slice(0, 200); });
  if (mod === 'funcdocs') { const f = a.data.funcionarios.find(x => x.id === +vals.func); if (!f) return alert('Selecione um funcionário válido.'); vals.func = f.id; vals.funcNome = f.nome; }
  const files = form.elements.file ? [...form.elements.file.files] : [];
  const big = files.filter(f => f.size > MAX); if (big.length) return alert('Arquivo acima de 15 MB: ' + big.map(f => f.name).join(', '));
  if (M.attach && !editing && !files.length) return alert('Selecione ao menos um arquivo.');
  btn.disabled = true;
  const put = async file => { const fid = a.id + '-' + Date.now() + '-' + a.seq++; await fput(fid, file); return { fileId: fid, fileName: file.name.slice(0, 200), fileType: file.type || '', fileSize: file.size, em: new Date().toISOString() }; };
  try {
    if (editing) {
      const r = list.find(x => x.id === editing);
      if (r) { Object.assign(r, vals); if (files[0]) { const old = r.fileId; Object.assign(r, await put(files[0])); if (old) fdel(old).catch(() => {}); logIt(a, 'Substituído', files[0].name, vals.funcNome); } }
      editing = null;
    } else if (M.attach) {
      for (const file of (M.multi ? files : files.slice(0, 1))) { list.push({ id: a.seq++, ok: false, ...vals, ...await put(file) }); logIt(a, 'Importado', file.name, vals.funcNome); }
    } else list.push({ id: a.seq++, ok: false, ...vals });
    save(st);
  } catch (x) { alert('Não foi possível guardar o arquivo neste navegador: ' + (x && x.message || x)); }
  btn.disabled = false; renderForm(); renderTable();
});

/* retoma a sessão ao recarregar */
const s0 = load(), a0 = s0.accounts.find(x => x.id === s0.session); if (a0) enter(a0);
})();
