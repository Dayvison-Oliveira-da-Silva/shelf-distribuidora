// javascript/carrinho.js
// Baseado no seu arquivo original, preservando storage/RTDB/controles,
// e adicionando pagamento + envio do pedido para seu proxy API (Tiny).

export function init(root) {
  // ====== CONFIG ======
  const MAX_DESC = 1.5;
  const DESKTOP_CH = 34;
  const MOBILE_CH  = 26;
  const API_URL = 'https://southamerica-east1-vendas-distribuidora-b0ea1.cloudfunctions.net/api/pedidos'; // ajuste se precisar

  // ==== VENDEDOR (localStorage, dois formatos) ====
  function getVendedorFromLS(){
    try{
      const raw = localStorage.getItem("usuario_shelf");
      if(!raw) return null;
      const data = JSON.parse(raw);
      if (data && typeof data === "object" && ("id" in data || "tipo" in data || "usuario" in data)) {
        return { id: data.id ?? null, nome: data.usuario ?? null, tipo: data.tipo ?? null, cpfKey: data.cpf ?? null };
      }
      const keys = Object.keys(data || {});
      if (keys.length) {
        const cpfKey = keys[0];
        const v = data[cpfKey] || {};
        return { id: v.id ?? null, nome: v.usuario ?? null, tipo: v.tipo ?? null, cpfKey };
      }
    }catch{}
    return null;
  }
  const VENDEDOR = getVendedorFromLS();

  // ====== BASES DO FIREBASE ======
  const usuario = JSON.parse(localStorage.getItem("usuario_shelf") || "{}");
  let databaseBaseUrl = "https://estoque-distribuidora-default-rtdb.firebaseio.com/";
  const tipoBase = (VENDEDOR?.tipo ?? usuario?.tipo) || "";
  if (tipoBase === "grandes") databaseBaseUrl = "https://estoque-distribuidora-grandes-default-rtdb.firebaseio.com/";
  else if (tipoBase === "especial") databaseBaseUrl = "https://estoque-distribuidora-especial-default-rtdb.firebaseio.com/";
  const PROPOSTA_DB = "https://proposta-shelf-distribuidora-default-rtdb.firebaseio.com/";
  const CLIENTES_NODE = "cadastrosClientes";
  const PROPOSTAS_NODE = "propostas";

  // ====== KEYS LOCALSTORAGE ======
  const NOME_CACHE_KEY   = "carrinhoProposta_nomeCache";
  const DESC_MODE_KEY    = "carrinhoProposta_descMode";
  const DESC_GLOBAL_KEY  = "carrinhoProposta_descGlobalPerc";

  // ====== CACHE NOMES ======
  let nomeCache = {};
  try { nomeCache = JSON.parse(localStorage.getItem(NOME_CACHE_KEY)) || {}; } catch { nomeCache = {}; }
  const saveNomeCache = () => localStorage.setItem(NOME_CACHE_KEY, JSON.stringify(nomeCache));

  async function getNomeProdutoPorSKU(sku) {
    if (nomeCache[sku]) return nomeCache[sku];
    try {
      const res = await fetch(`${databaseBaseUrl}produtos/${encodeURIComponent(sku)}.json`);
      if (!res.ok) throw new Error("Produto não encontrado");
      const dados = await res.json();
      const nome = (dados && typeof dados.nome === "string" && dados.nome.trim())
        ? dados.nome.trim()
        : (dados?.descricao || dados?.titulo || null);
      nomeCache[sku] = nome ?? null;
      saveNomeCache();
      return nome;
    } catch {
      nomeCache[sku] = null;
      saveNomeCache();
      return null;
    }
  }

  // ====== HELPERS ======
  const fmt = (v) => `R$ ${(Number(v) || 0).toFixed(2)}`;
  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
  const cpfCnpjKey = (s) => onlyDigits(s);
  const nowISO = () => new Date().toISOString();
  const escapeHtml = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  function applyNomeWidth() {
    const isMobile = window.matchMedia("(max-width: 980px)").matches;
    const ch = isMobile ? MOBILE_CH : DESKTOP_CH;
    root.querySelectorAll('.nome-produto-inner').forEach(span => { span.style.maxWidth = ch + "ch"; });
  }
  function sanitizePercentText(str){ let s=String(str||"").trim().replace(',', '.'); s=s.replace(/[^\d.]/g,''); const i=s.indexOf('.'); if(i!==-1) s=s.slice(0,i+1)+s.slice(i+1).replace(/\./g,''); return s; }
  function parsePercent(str){ const n=parseFloat(sanitizePercentText(str)); return Number.isFinite(n)?n:0; }
  const clampPerc = (p) => Math.max(0, Math.min(MAX_DESC, Number(p)||0));
  function sanitizeKey(k=""){ return String(k).replace(/[.$#[\]/]/g,"_").trim() || "sem_vendedor"; }
  async function buscaCEP(cep){
    const v = onlyDigits(cep);
    if (v.length !== 8) throw new Error("CEP inválido");
    const res = await fetch(`https://viacep.com.br/ws/${v}/json/`);
    const json = await res.json();
    if (json.erro) throw new Error("CEP não encontrado");
    return { cep: json.cep || cep, endereco: json.logradouro || "", bairro: json.bairro || "", cidade: json.localidade || "", uf: json.uf || "" };
  }

  // Pagamento helpers
  function txtToNumberBR(v){ let s=String(v||'').trim(); if(!s) return 0; s=s.replace(/\./g,'').replace(',', '.').replace(/[^\d.]/g,''); const n=parseFloat(s); return Number.isFinite(n)?n:0; }
  function mapTipoPessoaToTiny(v){ const s=String(v||'').toLowerCase(); if (s.includes('jur')||s==='pj'||s==='j') return 'J'; return 'F'; }
  function formaPagamentoSelecionada(){ return root.querySelector('#pagto-forma')?.value || 'multiplas'; }

  // ====== DOM: usar o HTML existente (não sobrescrevo seu <main>) ======
  const cartEl = root.querySelector('#carrinhoProposta-cart');
  const controlsEl = root.querySelector('#carrinhoProposta-controls');

  // ====== STORAGE ======
  function getCarrinho() {
    const arr = JSON.parse(localStorage.getItem('carrinhoProposta_itens')) || [];
    return Array.isArray(arr) ? arr : [];
  }
  function setCarrinho(arr) {
    localStorage.setItem('carrinhoProposta_itens', JSON.stringify(arr || []));
  }
  function getDescMode() {
    const m = localStorage.getItem(DESC_MODE_KEY);
    return (m === 'global' || m === 'item') ? m : 'item';
  }
  function setDescMode(m) {
    localStorage.setItem(DESC_MODE_KEY, (m === 'global') ? 'global' : 'item');
  }
  function getDescGlobalPerc() {
    const v = Number(localStorage.getItem(DESC_GLOBAL_KEY));
    return Number.isFinite(v) ? clampPerc(v) : 0;
  }
  function setDescGlobalPerc(v) {
    localStorage.setItem(DESC_GLOBAL_KEY, String(clampPerc(v)));
  }

  // ====== RENDER CONTROLES DESCONTO (no container já existente) ======
  function renderControls(){
    if(!controlsEl) return;
    const mode = getDescMode();
    const descGlobal = getDescGlobalPerc();
    controlsEl.innerHTML = `
      <span style="font-weight:600;color:#107058;">Desconto:</span>
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="radio" name="carrinhoProposta-modo" value="item" ${mode==='item'?'checked':''}> por item
      </label>
      <label style="display:flex;align-items:center;gap:6px;">
        <input type="radio" name="carrinhoProposta-modo" value="global" ${mode==='global'?'checked':''}> todos os itens
      </label>
      <div id="carrinhoProposta-global-wrap" ${mode!=='global'?'disabled':''} style="display:flex;align-items:center;gap:6px;">
        <input id="carrinhoProposta-desc-global" type="text" inputmode="decimal" placeholder="0,0" maxlength="5"
               value="${String(descGlobal).replace('.',',')}"
               class="${mode!=='global'?'':'active'}">
        %
        <small style="color:#5c6a67">máx ${MAX_DESC}%</small>
      </div>
    `;
    // listeners
    controlsEl.querySelectorAll('input[name="carrinhoProposta-modo"]').forEach(r=>{
      r.addEventListener('change', ()=>{
        setDescMode(r.value==='global'?'global':'item');
        renderCarrinho();
        renderControls();
      });
    });
    const inputGlobal = controlsEl.querySelector('#carrinhoProposta-desc-global');
    if (inputGlobal){
      inputGlobal.addEventListener('input', ()=>{
        const cur = sanitizePercentText(inputGlobal.value);
        inputGlobal.value = cur.replace('.', ',');
      });
      inputGlobal.addEventListener('blur', ()=>{
        let val = clampPerc(parsePercent(inputGlobal.value));
        inputGlobal.value = val.toFixed(1).replace('.', ',');
        setDescGlobalPerc(val);
        if (getDescMode()==='global') renderCarrinho();
      });
    }
  }

  // ====== RENDER CARRINHO ======
  function renderCarrinho() {
    const itens = getCarrinho();
    const mode = getDescMode();
    const descGlobal = getDescGlobalPerc();

    if (!itens.length) {
      cartEl.innerHTML = `<div class="carrinhoProposta-vazio">Seu carrinho está vazio :(</div>`;
      return;
    }

    const linhas = itens.map((item, idx) => {
      const preco = Number(item.preco) || 0;
      const qtd = Number(item.quantidade) || 0;
      const nomeSnapshot = (item.nome && String(item.nome).trim()) ? String(item.nome).trim() : null;
      const nomeCached = nomeCache[item.sku] ?? undefined;
      const nomeInicial = nomeSnapshot ? nomeSnapshot : (nomeCached === null ? "(sem nome)" : (nomeCached || "Carregando nome..."));
      const imgUrl = (item.imagemUrl && String(item.imagemUrl).trim()) ? String(item.imagemUrl).trim() : "img/logo-nav.png";
      const perc = (mode === 'item') ? clampPerc(Number(item.descPerc) || 0) : descGlobal;

      const subtotalBruto = preco * qtd;
      const descontoLinha = subtotalBruto * (perc / 100);
      const subtotal = subtotalBruto - descontoLinha;

      const descCell = (mode === 'item')
        ? `
            <input class="desc-item" data-idx="${idx}" type="text" inputmode="decimal"
                   placeholder="0,0" maxlength="5"
                   value="${String(clampPerc(Number(item.descPerc) || 0)).replace('.', ',')}"
                   style="width:68px; padding:6px 8px; border:1px solid #d4dde7; border-radius:7px; text-align:right;">
            <div style="font-size:11px;color:#5c6a67;margin-top:2px;">máx ${MAX_DESC}%</div>
          `
        : `<span>${descGlobal.toFixed(1).replace('.', ',')}%</span>`;

      const produtoCell = `
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <img src="${escapeHtml(imgUrl)}" alt="" loading="lazy"
               style="width:48px;height:48px;object-fit:contain;background:#fff;border:1px solid var(--c-border);border-radius:8px;flex:0 0 auto;">
          <span class="nome-produto-inner" style="display:inline-block;line-height:1.25;">${escapeHtml(nomeInicial)}</span>
        </div>
      `;

      return `
        <tr>
          <td class="carrinhoProposta-td">${item.sku}</td>
          <td class="carrinhoProposta-td nome-produto" data-sku="${String(item.sku)}">${produtoCell}</td>
          <td class="carrinhoProposta-td" style="text-align:center">${qtd}</td>
          <td class="carrinhoProposta-td" style="text-align:right">${fmt(preco)}</td>
          <td class="carrinhoProposta-td" style="text-align:center">${descCell}</td>
          <td class="carrinhoProposta-td subtotal-cell" style="text-align:right">${fmt(subtotal)}</td>
          <td class="carrinhoProposta-td" style="text-align:right">
            <button class="remover-carrinho" data-idx="${idx}">remover</button>
          </td>
        </tr>
      `;
    }).join('');

    const subtotalBrutoGeral = itens.reduce((acc, it)=> acc + (Number(it.preco)||0)*(Number(it.quantidade)||0), 0);
    const descontoTotal = itens.reduce((acc, it)=>{
      const base = (Number(it.preco)||0)*(Number(it.quantidade)||0);
      const perc = (getDescMode()==='item') ? clampPerc(Number(it.descPerc)||0) : getDescGlobalPerc();
      return acc + base*(perc/100);
    }, 0);
    const totalFinal = subtotalBrutoGeral - descontoTotal;

    cartEl.innerHTML = `
      <table class="carrinhoProposta-tabela">
        <thead>
          <tr>
            <th class="carrinhoProposta-th">SKU</th>
            <th class="carrinhoProposta-th nomeproduto">Produto</th>
            <th class="carrinhoProposta-th">Qtd</th>
            <th class="carrinhoProposta-th">Preço (un)</th>
            <th class="carrinhoProposta-th">Desc. (%)</th>
            <th class="carrinhoProposta-th">Total</th>
            <th class="carrinhoProposta-th"></th>
          </tr>
        </thead>
        <tbody>
          ${linhas}
          <tr>
            <td class="carrinhoProposta-td" colspan="5" style="text-align:right;">Subtotal (bruto)</td>
            <td class="carrinhoProposta-td" style="text-align:right;">${fmt(subtotalBrutoGeral)}</td>
            <td class="carrinhoProposta-td"></td>
          </tr>
          <tr>
            <td class="carrinhoProposta-td" colspan="5" style="text-align:right;">
              Desconto ${getDescMode() === 'item' ? '(itens)' : `(global ${getDescGlobalPerc().toFixed(1).replace('.', ',')}%)`}
            </td>
            <td class="carrinhoProposta-td" style="text-align:right;">- ${fmt(descontoTotal)}</td>
            <td class="carrinhoProposta-td"></td>
          </tr>
          <tr>
            <td class="carrinhoProposta-td" colspan="5" style="text-align:right;font-weight:bold;">TOTAL</td>
            <td class="carrinhoProposta-td" style="font-weight:bold;text-align:right">${fmt(totalFinal)}</td>
            <td class="carrinhoProposta-td"></td>
          </tr>
        </tbody>
      </table>
    `;

    // remover
    cartEl.querySelectorAll('.remover-carrinho').forEach(btn=>{
      btn.onclick = ()=>{
        const idx = Number(btn.dataset.idx);
        const lista = getCarrinho();
        lista.splice(idx,1);
        setCarrinho(lista);
        renderCarrinho();
      };
    });

    // desconto por item
    if (getDescMode()==='item') {
      cartEl.querySelectorAll('.desc-item').forEach(inp=>{
        inp.addEventListener('input', ()=>{
          const cur = sanitizePercentText(inp.value);
          inp.value = cur.replace('.', ',');
        });
        inp.addEventListener('blur', ()=>{
          const idx = Number(inp.dataset.idx);
          const lista = getCarrinho();
          let val = clampPerc(parsePercent(inp.value));
          inp.value = val.toFixed(1).replace('.', ',');
          if (lista[idx]) {
            lista[idx].descPerc = val;
            setCarrinho(lista);
            renderCarrinho();
          }
        });
      });
    }

    applyNomeWidth();
    // hidratar nomes ausentes
    hidratarNomes(itens.filter(it=>!it?.nome));
  }

  async function hidratarNomes(itensSemNome){
    if (!itensSemNome?.length) return;
    const carrinhoAtual = getCarrinho();
    const indexBySku = new Map();
    carrinhoAtual.forEach((it,i)=>indexBySku.set(String(it.sku), i));
    await Promise.all(itensSemNome.map(async (item)=>{
      const nome = await getNomeProdutoPorSKU(item.sku);
      const seletor = (window.CSS && CSS.escape)
        ? `td.nome-produto[data-sku="${CSS.escape(String(item.sku))}"] .nome-produto-inner`
        : `td.nome-produto[data-sku="${String(item.sku).replace(/"/g,'\\"')}"] .nome-produto-inner`;
      const span = root.querySelector(seletor);
      if (span) {
        const texto = nome || "(sem nome)";
        span.textContent = texto;
        span.parentElement.title = texto;
      }
      const idx = indexBySku.get(String(item.sku));
      if (typeof idx === "number" && idx >=0 && carrinhoAtual[idx]) {
        const norm = (s)=> (s && String(s).trim()? String(s).trim(): null);
        carrinhoAtual[idx].nome = norm(nome) ?? carrinhoAtual[idx].nome ?? null;
      }
    }));
    setCarrinho(carrinhoAtual);
    applyNomeWidth();
  }

  // ====== FORM / CAMPOS ======
  const elNome  = root.querySelector('#carrinhoProposta-nome');
  const elTipo  = root.querySelector('#carrinhoProposta-tipo');
  const elDoc   = root.querySelector('#carrinhoProposta-cpfcnpj');
  const elTel   = root.querySelector('#carrinhoProposta-tel');
  const elEmail = root.querySelector('#carrinhoProposta-email');

  const cad = {
    cep: root.querySelector('#cad-cep'),
    cidade: root.querySelector('#cad-cidade'),
    uf: root.querySelector('#cad-uf'),
    endereco: root.querySelector('#cad-endereco'),
    bairro: root.querySelector('#cad-bairro'),
    numero: root.querySelector('#cad-numero'),
    complemento: root.querySelector('#cad-complemento')
  };
  const entBox = root.querySelector('#box-entrega');
  const chkEnt = root.querySelector('#entrega-diferente');
  const ent = {
    cep: root.querySelector('#ent-cep'),
    cidade: root.querySelector('#ent-cidade'),
    uf: root.querySelector('#ent-uf'),
    endereco: root.querySelector('#ent-endereco'),
    bairro: root.querySelector('#ent-bairro'),
    numero: root.querySelector('#ent-numero'),
    complemento: root.querySelector('#ent-complemento')
  };
  chkEnt?.addEventListener('change', ()=>{ entBox.style.display = chkEnt.checked ? 'block' : 'none'; });

  // CEP
  root.querySelectorAll('.cep-busca').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tgt = btn.dataset.target; // 'cad' | 'ent'
      const group = tgt==='ent'? ent : cad;
      try{
        const data = await buscaCEP(group.cep.value);
        group.cep.value = onlyDigits(data.cep);
        group.endereco.value = data.endereco;
        group.bairro.value = data.bairro;
        group.cidade.value = data.cidade;
        group.uf.value = data.uf;
      }catch(e){ showMsg(e.message || 'Falha ao buscar CEP', true); }
    });
  });

  // auto-preencher cadastro por CPF/CNPJ já salvo
  elDoc?.addEventListener('blur', async ()=>{
    const key = cpfCnpjKey(elDoc.value);
    if (!key) return;
    try {
      const res = await fetch(`${PROPOSTA_DB}${CLIENTES_NODE}/${key}.json`);
      if(!res.ok) throw new Error('erro consulta cadastro');
      const dados = await res.json();
      if(dados){
        if(dados.nome)  elNome.value  = dados.nome;
        if(dados.tipo)  elTipo.value  = dados.tipo;
        if(dados.tel)   elTel.value   = dados.tel;
        if(dados.email) elEmail.value = dados.email;

        const srcCad = dados.enderecoCadastro || {};
        cad.cep.value        = onlyDigits(srcCad.cep || "");
        cad.endereco.value   = srcCad.endereco || "";
        cad.bairro.value     = srcCad.bairro || "";
        cad.cidade.value     = srcCad.cidade || "";
        cad.uf.value         = srcCad.uf || "";
        cad.numero.value     = srcCad.numero || "";
        cad.complemento.value= srcCad.complemento || "";

        const srcEnt = dados.enderecoEntrega || null;
        chkEnt.checked = !!srcEnt;
        entBox.style.display = chkEnt.checked ? 'block' : 'none';
        if (srcEnt){
          ent.cep.value        = onlyDigits(srcEnt.cep || "");
          ent.endereco.value   = srcEnt.endereco || "";
          ent.bairro.value     = srcEnt.bairro || "";
          ent.cidade.value     = srcEnt.cidade || "";
          ent.uf.value         = srcEnt.uf || "";
          ent.numero.value     = srcEnt.numero || "";
          ent.complemento.value= srcEnt.complemento || "";
        }
        showMsg("Cadastro carregado pelo CPF/CNPJ.");
      }
    }catch{}
  });

  // validação / feedback botões
  const validarProposta = () =>
    (elNome?.value?.trim()?.length >= 2) &&
    (elDoc?.value && onlyDigits(elDoc.value).length >= 11);

  function validarPedido() { return validarProposta(); }

  function feedbackBotoes() {
    const btnProp = root.querySelector('#carrinhoProposta-btn-proposta');
    const btnPed  = root.querySelector('#carrinhoProposta-btn-pedido');
    if (btnProp) btnProp.disabled = !validarProposta();
    if (btnPed)  btnPed.disabled  = !validarPedido();
  }
  function showMsg(texto, erro=false){
    const msgEl = root.querySelector('#carrinhoProposta-msg');
    if (!msgEl) return;
    msgEl.innerHTML = texto;
    msgEl.className = 'carrinhoProposta-msg' + (erro ? ' carrinhoProposta-erro' : '');
    msgEl.style.display = 'flex';
    setTimeout(()=>{ msgEl.style.display='none'; }, 3000);
  }
  ['input','change','blur'].forEach(ev=>{
    elNome?.addEventListener(ev, feedbackBotoes);
    elDoc?.addEventListener(ev, feedbackBotoes);
  });
  feedbackBotoes();

  // ====== PROPOSTA (RTDB) ======
  function coletarClienteRTDB() {
    const entregaDif = chkEnt?.checked;
    const cadastro = {
      cep: onlyDigits(cad.cep.value), cidade: cad.cidade.value.trim(), uf: cad.uf.value.trim(),
      endereco: cad.endereco.value.trim(), bairro: cad.bairro.value.trim(),
      numero: cad.numero.value.trim(), complemento: cad.complemento.value.trim()
    };
    const entrega = entregaDif ? {
      cep: onlyDigits(ent.cep.value), cidade: ent.cidade.value.trim(), uf: ent.uf.value.trim(),
      endereco: ent.endereco.value.trim(), bairro: ent.bairro.value.trim(),
      numero: ent.numero.value.trim(), complemento: ent.complemento.value.trim()
    } : null;

    return {
      nome: elNome.value.trim(), tipo: elTipo.value, cpfCnpj: cpfCnpjKey(elDoc.value),
      tel: elTel.value.trim(), email: elEmail.value.trim(),
      entregaDiferente: entregaDif, enderecoCadastro: cadastro, enderecoEntrega: entrega
    };
  }

  function calcularTotais() {
    const itens = getCarrinho();
    const subtotalBruto = itens.reduce((acc, it)=> acc + (Number(it.preco)||0)*(Number(it.quantidade)||0), 0);
    const descTotal = itens.reduce((acc, it)=>{
      const base = (Number(it.preco)||0)*(Number(it.quantidade)||0);
      const perc = (getDescMode()==='item') ? clampPerc(Number(it.descPerc)||0) : getDescGlobalPerc();
      return acc + base*(perc/100);
    }, 0);
    const total = subtotalBruto - descTotal;
    return { mode:getDescMode(), descGlobal:getDescGlobalPerc(), subtotalBruto, descontoTotal:descTotal, total };
  }

  async function upsertCliente(cliente) {
    const key = cpfCnpjKey(cliente.cpfCnpj);
    if(!key) throw new Error("CPF/CNPJ ausente");
    const payload = { ...cliente, updatedAt: nowISO() };
    const res = await fetch(`${PROPOSTA_DB}${CLIENTES_NODE}/${key}.json`, {
      method:'PATCH', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error("Falha ao salvar cadastro");
    return key;
  }

  async function salvarProposta(status="rascunho"){
    if(!validarProposta()){ showMsg("Preencha Nome e CPF/CNPJ.", true); return; }
    const itens = getCarrinho();
    if(!itens.length){ showMsg("Adicione itens ao carrinho.", true); return; }

    const cliente = coletarClienteRTDB();
    const clienteKey = await upsertCliente(cliente);

    const vendedorKeyRaw = VENDEDOR?.id ?? VENDEDOR?.cpfKey ?? VENDEDOR?.nome ?? "sem_vendedor";
    const vendedorKey = sanitizeKey(vendedorKeyRaw);

    const proposta = {
      createdAt: nowISO(), status, clienteKey, clienteSnapshot: cliente,
      itens, totais: calcularTotais(),
      vendedor: { id: VENDEDOR?.id ?? null, nome: VENDEDOR?.nome ?? null, tipo: VENDEDOR?.tipo ?? null, cpfKey: VENDEDOR?.cpfKey ?? null }
    };

    const res = await fetch(`${PROPOSTA_DB}${PROPOSTAS_NODE}/${encodeURIComponent(vendedorKey)}.json`, {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(proposta)
    });
    if(!res.ok){ showMsg("Falha ao salvar a proposta.", true); return; }
    const { name: generatedId } = await res.json();
    showMsg(`Proposta salva! <b>#${generatedId}</b>`);
    return generatedId;
  }

  // ====== PEDIDO (Tiny via proxy) ======
  function itensParaTiny() {
    const itens = getCarrinho();
    const mode = getDescMode();
    const descGlobal = getDescGlobalPerc();

    return itens.map(it=>{
      const preco = Number(it.preco)||0;
      const qtd   = Number(it.quantidade)||0;
      const perc  = (mode==='item') ? clampPerc(Number(it.descPerc)||0) : descGlobal;
      const unit  = preco * (1 - (perc/100));
      return {
        codigo: String(it.sku),
        quantidade: String(qtd),
        valor_unitario: String(unit.toFixed(2))
      };
    });
  }

  function parcelasParaTiny(totalPedido){
    const forma = formaPagamentoSelecionada();
    const din = txtToNumberBR(root.querySelector('#pg-dinheiro')?.value);
    const pix = txtToNumberBR(root.querySelector('#pg-pix')?.value);
    const deb = txtToNumberBR(root.querySelector('#pg-debito')?.value);
    const cre = txtToNumberBR(root.querySelector('#pg-credito')?.value);

    const obsDin = root.querySelector('#pg-dinheiro-obs')?.value?.trim() || '';
    const obsPix = root.querySelector('#pg-pix-obs')?.value?.trim() || '';
    const obsDeb = root.querySelector('#pg-debito-obs')?.value?.trim() || '';
    const obsCre = root.querySelector('#pg-credito-obs')?.value?.trim() || '';
    const meioPix= root.querySelector('#pg-pix-meio')?.value?.trim() || '';
    const meioCre= root.querySelector('#pg-credito-meio')?.value?.trim() || '';

    if (forma !== 'multiplas') {
      return [{ valor: String(Number(totalPedido).toFixed(2)), forma_pagamento: forma, obs: '' }];
    }
    const out = [];
    if (din > 0) out.push({ valor:String(din.toFixed(2)), forma_pagamento:'dinheiro', obs:obsDin });
    if (pix > 0) out.push({ valor:String(pix.toFixed(2)), forma_pagamento:'pix',     obs:obsPix, ...(meioPix?{meio_pagamento:meioPix}:{}) });
    if (deb > 0) out.push({ valor:String(deb.toFixed(2)), forma_pagamento:'debito',  obs:obsDeb });
    if (cre > 0) out.push({ valor:String(cre.toFixed(2)), forma_pagamento:'credito', obs:obsCre, ...(meioCre?{meio_pagamento:meioCre}:{}) });
    return out;
  }

  function coletarClienteParaTiny(){
    const tipoPessoa = mapTipoPessoaToTiny(root.querySelector('#carrinhoProposta-tipo')?.value);
    const doc = cpfCnpjKey(root.querySelector('#carrinhoProposta-cpfcnpj')?.value);
    const nome = root.querySelector('#carrinhoProposta-nome')?.value?.trim() || '';
    const fone = root.querySelector('#carrinhoProposta-tel')?.value?.trim() || '';
    const email= root.querySelector('#carrinhoProposta-email')?.value?.trim() || '';

    const cliente = {
      nome, tipo_pessoa: tipoPessoa, cpf_cnpj: doc, atualizar_cliente: 'N',
      endereco: (cad.endereco.value||'').trim(), numero: (cad.numero.value||'').trim(),
      complemento: (cad.complemento.value||'').trim(), bairro:(cad.bairro.value||'').trim(),
      cep: onlyDigits(cad.cep.value), cidade:(cad.cidade.value||'').trim(),
      uf:(cad.uf.value||'').trim(), pais:'Brasil', fone, email
    };

    const entregaDif = chkEnt?.checked;
    const endereco_entrega = entregaDif ? {
      tipo_pessoa: cliente.tipo_pessoa, cpf_cnpj: cliente.cpf_cnpj,
      endereco:(ent.endereco.value||'').trim(), numero:(ent.numero.value||'').trim(),
      complemento:(ent.complemento.value||'').trim(), bairro:(ent.bairro.value||'').trim(),
      cidade:(ent.cidade.value||'').trim(), uf:(ent.uf.value||'').trim(),
      cep:onlyDigits(ent.cep.value), fone, nome_destinatario:nome
    } : null;

    return { cliente, endereco_entrega };
  }

  async function enviarPedidoTiny(){
    if(!validarPedido()){ showMsg("Preencha Nome e CPF/CNPJ.", true); return; }
    const carrinho = getCarrinho();
    if(!carrinho.length){ showMsg("Adicione itens ao carrinho.", true); return; }

    const totais = calcularTotais();
    const itensTiny = itensParaTiny();
    const parcelasTiny = parcelasParaTiny(totais.total);
    const somaParcelas = (parcelasTiny||[]).reduce((a,p)=> a + (Number(p.valor)||0), 0);

    if (formaPagamentoSelecionada()==='multiplas' && Math.abs(somaParcelas - totais.total) > 0.02) {
      showMsg(`Soma das parcelas (R$ ${somaParcelas.toFixed(2)}) difere do total (R$ ${totais.total.toFixed(2)}).`, true);
      return;
    }

    const { cliente, endereco_entrega } = coletarClienteParaTiny();

    const marcadoresText = root.querySelector('#marcadores')?.value?.trim() || '';
    const marcadores = marcadoresText ? marcadoresText.split(',').map(s=>s.trim()).filter(Boolean) : [];

    const id_vendedor_input = root.querySelector('#id_vendedor')?.value?.trim() || '';
    const body = {
      cliente,
      ...(endereco_entrega ? { endereco_entrega } : {}),
      itens: itensTiny,
      parcelas: parcelasTiny,
      marcadores,
      forma_pagamento: formaPagamentoSelecionada(),
      obs: root.querySelector('#obs')?.value?.trim() || 'Pedido gerado pelo carrinho',
      id_ecommerce: root.querySelector('#id_ecommerce')?.value?.trim() || undefined,
      numero_pedido_ecommerce: root.querySelector('#numero_pedido_ecommerce')?.value?.trim() || undefined,
      id_vendedor: id_vendedor_input || (VENDEDOR?.id ? String(VENDEDOR.id) : undefined),
      situacao: root.querySelector('#situacao')?.value?.trim() || 'aprovado'
    };

    try{
      const resp = await fetch(API_URL, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json();
      if (!resp.ok || data?.ok === false) {
        const msg = data?.tiny?.retorno?.registros?.registro?.erros?.map(e=>e.erro).join('; ') || data?.error || 'Falha no envio';
        showMsg(`Erro no Tiny: ${msg}`, true);
        return;
      }
      const r = data?.tiny?.retorno?.registros?.registro;
      const numero = r?.numero || '(sem número)';
      showMsg(`Pedido enviado! Nº Tiny: <b>${numero}</b>`);
    }catch(e){
      showMsg(e.message || 'Erro ao enviar pedido', true);
    }
  }

  // ====== BOTÕES ======
  const btnProp = root.querySelector('#carrinhoProposta-btn-proposta');
  const btnPed  = root.querySelector('#carrinhoProposta-btn-pedido');

  btnProp?.addEventListener('click', async ()=>{
    try{ await salvarProposta("rascunho"); }catch(e){ showMsg(e.message || "Erro ao salvar", true); }
  });

  btnPed?.addEventListener('click', async ()=>{
    try{
      await salvarProposta("pedido_em_aberto"); // histórico
      await enviarPedidoTiny();                 // manda pro Tiny
    }catch(e){ showMsg(e.message || "Erro ao enviar pedido", true); }
  });

  // ====== Pagamento: alternar múltiplas ======
  const selForma = root.querySelector('#pagto-forma');
  const boxMultiplas = root.querySelector('#pagto-multiplas');
  if (selForma && boxMultiplas) {
    const toggle = ()=>{ boxMultiplas.style.display = (selForma.value === 'multiplas') ? 'grid' : 'none'; };
    selForma.addEventListener('change', toggle); toggle();
  }

  // ====== Eventos globais ======
  const onStorage = (e)=>{
    if (e.key === "carrinhoProposta_itens" || e.key === DESC_MODE_KEY || e.key === DESC_GLOBAL_KEY) {
      renderCarrinho();
      renderControls();
    }
  };
  window.addEventListener("storage", onStorage);
  const onResize = ()=> applyNomeWidth();
  window.addEventListener("resize", onResize);

  // ====== BOOT ======
  renderControls();
  renderCarrinho();

  // ====== TEARDOWN ======
  return function teardown(){
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("resize", onResize);
  };
}
