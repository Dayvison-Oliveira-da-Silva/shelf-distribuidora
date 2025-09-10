// Carrinho SPA: itens + descontos + cadastro/entrega + PROPOSTA (RTDB)
// + Múltiplos recebimentos (editar/trocar/excluir) + envio de PEDIDO pro Tiny via proxy.
// Regras automáticas: PIX → meio_pagamento:"Santander"; id_ecommerce:"13850";
// id_vendedor do localStorage; situacao: "aberto" se tiver boleto, senão "aprovado";
// numero_pedido_ecommerce = id_vendedor-YYYYMMDD-HHmmss.
// PEDIDO: não cria proposta; salva em /pedidos/<vendedorKey>/<numero_pedido_ecommerce> após sucesso no Tiny.

export function init(root) {
  // ===== CONFIG =====
  const MAX_DESC = 1.5;
  const DESKTOP_CH = 34;
  const MOBILE_CH  = 26;
  const API_URL = 'https://southamerica-east1-vendas-distribuidora-b0ea1.cloudfunctions.net/api/pedidos';
  const IDECOMMERCE_FIXO = '13850';
  const PIX_MEIO_FIXO = 'Santander';
  const BOLETO_MEIO_FIXO = 'Santander'; // boleto sempre Santander (oculto ao usuário)

  // ===== Loading overlay / busy state =====
  function ensureLoadingStyles() {
    if (document.getElementById('carrinho-loading-style')) return;
    const st = document.createElement('style');
    st.id = 'carrinho-loading-style';
    st.textContent = `
      #carrinho-loading{position:fixed;inset:0;background:rgba(0,0,0,.28);
        display:none;align-items:center;justify-content:center;z-index:9999}
      #carrinho-loading .box{background:#fff;border-radius:12px;padding:18px 20px;
        border:1px solid #e2e4ea;box-shadow:0 10px 40px #0002;display:flex;gap:12px;align-items:center}
      #carrinho-loading .spin{width:20px;height:20px;border-radius:50%;
        border:3px solid #e2e4ea;border-top-color:#1db286;animation:rot .8s linear infinite}
      #carrinho-loading .msg{font-weight:600;color:#0e5343}
      @keyframes rot{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(st);
  }
  function setBusy(on, msg='Processando…'){
    ensureLoadingStyles();
    let ov = document.getElementById('carrinho-loading');
    if(!ov){
      ov = document.createElement('div');
      ov.id = 'carrinho-loading';
      ov.innerHTML = `<div class="box"><div class="spin"></div><div class="msg"></div></div>`;
      document.body.appendChild(ov);
    }
    ov.querySelector('.msg').textContent = msg;
    ov.style.display = on ? 'flex' : 'none';

    const all = root.querySelectorAll('button, input, select, textarea');
    all.forEach(el=>{
      if(on){
        if (el.dataset.keepEnabled !== '1') el.disabled = true;
      }else{
        el.disabled = false;
      }
    });
    try { recalcPaySummary(); } catch {}
    try { feedbackBotoes(); } catch {}
  }

  // ===== VENDEDOR (localStorage dois formatos) =====
  function getVendedorFromLS(){
    try{
      const raw = localStorage.getItem("usuario_shelf");
      if(!raw) return null;
      const data = JSON.parse(raw);
      if (data && typeof data === "object" && ("id" in data || "tipo" in data || "usuario" in data)) {
        return { id:data.id??null, nome:data.usuario??null, tipo:data.tipo??null, cpfKey:data.cpf??null };
      }
      const keys = Object.keys(data||{});
      if(keys.length){
        const cpfKey=keys[0]; const v=data[cpfKey]||{};
        return { id:v.id??null, nome:v.usuario??null, tipo:v.tipo??null, cpfKey };
      }
    }catch{}
    return null;
  }
  const VENDEDOR = getVendedorFromLS();

  // ===== BASES FIREBASE =====
  const usuario = JSON.parse(localStorage.getItem("usuario_shelf")||"{}");
  let databaseBaseUrl = "https://estoque-distribuidora-default-rtdb.firebaseio.com/";
  const tipoBase = (VENDEDOR?.tipo ?? usuario?.tipo) || "";
  if (tipoBase === "grandes") databaseBaseUrl = "https://estoque-distribuidora-grandes-default-rtdb.firebaseio.com/";
  else if (tipoBase === "especial") databaseBaseUrl = "https://estoque-distribuidora-especial-default-rtdb.firebaseio.com/";

  const PROPOSTA_DB = "https://proposta-shelf-distribuidora-default-rtdb.firebaseio.com/";
  const CLIENTES_NODE = "cadastrosClientes";
  const PROPOSTAS_NODE = "propostas";
  const PEDIDOS_NODE   = "pedidos";

  // ===== KEYS STORAGE =====
  const NOME_CACHE_KEY   = "carrinhoProposta_nomeCache";
  const DESC_MODE_KEY    = "carrinhoProposta_descMode";
  const DESC_GLOBAL_KEY  = "carrinhoProposta_descGlobalPerc";
  const EDIT_REF_KEY     = "carrinhoProposta_editRef";
  const CLIENTE_CPF_KEY  = "carrinhoProposta_clienteCPF";
  let editRef = null;

  // ===== Helpers =====
  const fmt = (v)=>`R$ ${(Number(v)||0).toFixed(2)}`;
  const onlyDigits = (s)=> String(s||"").replace(/\D/g,"");
  const cpfCnpjKey = (s)=> onlyDigits(s);
  const nowISO = ()=> new Date().toISOString();
  function nowStamp(){
    const d = new Date();
    const y = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return `${y}${mm}${dd}-${hh}${mi}${ss}`;
  }
  const escapeHtml=(s)=> String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  function applyNomeWidth(){
    const isMobile = matchMedia("(max-width: 980px)").matches;
    const ch = isMobile? MOBILE_CH : DESKTOP_CH;
    root.querySelectorAll('.nome-produto-inner').forEach(span => { span.style.maxWidth = ch + "ch"; });
  }
  function sanitizePercentText(str){ let s=String(str||"").trim().replace(',', '.'); s=s.replace(/[^\d.]/g,''); const i=s.indexOf('.'); if(i!==-1) s=s.slice(0,i+1)+s.slice(i+1).replace(/\./g,''); return s; }
  function parsePercent(str){ const n=parseFloat(sanitizePercentText(str)); return Number.isFinite(n)?n:0; }
  const clampPerc=(p)=> Math.max(0, Math.min(MAX_DESC, Number(p)||0));
  function sanitizeKey(k=""){ return String(k).replace(/[.$#[\]/]/g,"_").trim() || "sem_vendedor"; }
  async function buscaCEP(cep){
    const v=onlyDigits(cep); if(v.length!==8) throw new Error("CEP inválido");
    const res=await fetch(`https://viacep.com.br/ws/${v}/json/`); const json=await res.json();
    if(json.erro) throw new Error("CEP não encontrado");
    return { cep: json.cep||cep, endereco:json.logradouro||"", bairro:json.bairro||"", cidade:json.localidade||"", uf:json.uf||"" };
  }
  function brToNumber(v){ let s=String(v||'').trim(); if(!s) return 0; s=s.replace(/\./g,'').replace(',','.').replace(/[^\d.]/g,''); const n=parseFloat(s); return Number.isFinite(n)?n:0; }
  function numberToBR(n){ return `R$ ${(Number(n)||0).toFixed(2).replace('.',',')}`; }
  function mapTipoPessoaToTiny(v){ const s=String(v||'').toLowerCase(); if (s.includes('jur')||s==='pj'||s==='j') return 'J'; return 'F'; }

  // ===== CACHE nomes produto =====
  let nomeCache = {};
  try{ nomeCache = JSON.parse(localStorage.getItem(NOME_CACHE_KEY)) || {}; }catch{ nomeCache = {}; }
  const saveNomeCache=()=> localStorage.setItem(NOME_CACHE_KEY, JSON.stringify(nomeCache));
  async function getNomeProdutoPorSKU(sku){
    if (nomeCache[sku]) return nomeCache[sku];
    try{
      const res=await fetch(`${databaseBaseUrl}produtos/${encodeURIComponent(sku)}.json`);
      if(!res.ok) throw new Error("Produto não encontrado");
      const dados=await res.json();
      const nome=(dados && typeof dados.nome==="string" && dados.nome.trim())? dados.nome.trim() : (dados?.descricao||dados?.titulo||null);
      nomeCache[sku]=nome??null; saveNomeCache(); return nome;
    }catch{ nomeCache[sku]=null; saveNomeCache(); return null; }
  }

  // ===== DOM refs =====
  const cartEl = root.querySelector('#carrinhoProposta-cart');
  const controlsEl = root.querySelector('#carrinhoProposta-controls');

  // form campos
  const elNome  = root.querySelector('#carrinhoProposta-nome');
  const elTipo  = root.querySelector('#carrinhoProposta-tipo');
  const elDoc   = root.querySelector('#carrinhoProposta-cpfcnpj');
  const elTel   = root.querySelector('#carrinhoProposta-tel');
  const elEmail = root.querySelector('#carrinhoProposta-email');

  const cad = {
    cep: root.querySelector('#cad-cep'), cidade: root.querySelector('#cad-cidade'), uf: root.querySelector('#cad-uf'),
    endereco: root.querySelector('#cad-endereco'), bairro: root.querySelector('#cad-bairro'),
    numero: root.querySelector('#cad-numero'), complemento: root.querySelector('#cad-complemento')
  };
  const entBox = root.querySelector('#box-entrega');
  const chkEnt = root.querySelector('#entrega-diferente');
  const ent = {
    cep: root.querySelector('#ent-cep'), cidade: root.querySelector('#ent-cidade'), uf: root.querySelector('#ent-uf'),
    endereco: root.querySelector('#ent-endereco'), bairro: root.querySelector('#ent-bairro'),
    numero: root.querySelector('#ent-numero'), complemento: root.querySelector('#ent-complemento')
  };

  // ===== STORAGE carrinho/desc =====
  function getCarrinho(){ const arr=JSON.parse(localStorage.getItem('carrinhoProposta_itens'))||[]; return Array.isArray(arr)?arr:[]; }
  function setCarrinho(arr){ localStorage.setItem('carrinhoProposta_itens', JSON.stringify(arr||[])); }
  function getDescMode(){ const m=localStorage.getItem(DESC_MODE_KEY); return (m==='global'||m==='item')?m:'item'; }
  function setDescMode(m){ localStorage.setItem(DESC_MODE_KEY, (m==='global')?'global':'item'); }
  function getDescGlobalPerc(){ const v=Number(localStorage.getItem(DESC_GLOBAL_KEY)); return Number.isFinite(v)?clampPerc(v):0; }
  function setDescGlobalPerc(v){ localStorage.setItem(DESC_GLOBAL_KEY, String(clampPerc(v))); }

  // ===== CONTROLES DESCONTO =====
  function renderControls(){
    if(!controlsEl) return;
    const mode=getDescMode(), descGlobal=getDescGlobalPerc();
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
               value="${String(descGlobal).replace('.',',')}"> %
        <small style="color:#5c6a67">máx ${MAX_DESC}%</small>
      </div>`;
    controlsEl.querySelectorAll('input[name="carrinhoProposta-modo"]').forEach(r=>{
      r.addEventListener('change', ()=>{ setDescMode(r.value==='global'?'global':'item'); renderCarrinho(); renderControls(); });
    });
    const inputGlobal = controlsEl.querySelector('#carrinhoProposta-desc-global');
    if (inputGlobal){
      inputGlobal.addEventListener('input', ()=>{ const cur=sanitizePercentText(inputGlobal.value); inputGlobal.value=cur.replace('.',','); });
      inputGlobal.addEventListener('blur', ()=>{ let val=clampPerc(parsePercent(inputGlobal.value)); inputGlobal.value=val.toFixed(1).replace('.',','); setDescGlobalPerc(val); if(getDescMode()==='global') renderCarrinho(); });
    }
  }

  // ===== RENDER CARRINHO =====
  function renderCarrinho(){
    const itens=getCarrinho(), mode=getDescMode(), descGlobal=getDescGlobalPerc();
    if(!itens.length){
      cartEl.innerHTML=`<div class="carrinhoProposta-vazio">Seu carrinho está vazio :(</div>`;
      recalcPaySummary(); return;
    }

    const linhas = itens.map((item, idx)=>{
      const preco=Number(item.preco)||0, qtd=Number(item.quantidade)||0;
      const nomeSnapshot=(item.nome && String(item.nome).trim())?String(item.nome).trim():null;
      const nomeCached=nomeCache[item.sku]??undefined;
      const nomeInicial= nomeSnapshot ? nomeSnapshot : (nomeCached===null ? "(sem nome)" : (nomeCached || "Carregando nome..."));
      const imgUrl=(item.imagemUrl && String(item.imagemUrl).trim())?String(item.imagemUrl).trim():"img/logo-nav.png";
      const perc=(mode==='item')?clampPerc(Number(item.descPerc)||0):descGlobal;
      const subtotalBruto=preco*qtd; const descontoLinha=subtotalBruto*(perc/100); const subtotal=subtotalBruto-descontoLinha;

      const descCell=(mode==='item')
        ? `<input class="desc-item" data-idx="${idx}" type="text" inputmode="decimal" placeholder="0,0" maxlength="5"
             value="${String(clampPerc(Number(item.descPerc)||0)).replace('.',',')}" style="width:68px;padding:6px 8px;border:1px solid #d4dde7;border-radius:7px;text-align:right;">
           <div style="font-size:11px;color:#5c6a67;margin-top:2px;">máx ${MAX_DESC}%</div>`
        : `<span>${descGlobal.toFixed(1).replace('.',',')}%</span>`;

      const imageCell=`
        <div class="produto-cell">
          <img class="produto-thumb" src="${escapeHtml(imgUrl)}" alt="${escapeHtml(nomeInicial || 'Produto')}" loading="lazy">
        </div>`;

      const produtoCell = `
        <div class="produto-info">
          <span class="nome-produto-inner">${escapeHtml(nomeInicial)}</span>
        </div>`;

      return `
        <tr>
          <td class="carrinhoProposta-td">${item.sku}</td>
          <td class="carrinhoProposta-td" style="text-align:center">${imageCell}</td>
          <td class="carrinhoProposta-td nome-produto" data-sku="${escapeHtml(String(item.sku))}" style="text-align:left">${produtoCell}</td>
          <td class="carrinhoProposta-td" style="text-align:center">${qtd}</td>
          <td class="carrinhoProposta-td" style="text-align:right">${fmt(preco)}</td>
          <td class="carrinhoProposta-td" style="text-align:center">${descCell}</td>
          <td class="carrinhoProposta-td subtotal-cell" style="text-align:right">${fmt(subtotal)}</td>
          <td class="carrinhoProposta-td" style="text-align:right"><button class="remover-carrinho" data-idx="${idx}">remover</button></td>
        </tr>`;
    }).join('');

    const subtotalBrutoGeral = itens.reduce((a,it)=> a+(Number(it.preco)||0)*(Number(it.quantidade)||0),0);
    const descontoTotal = itens.reduce((a,it)=>{
      const base=(Number(it.preco)||0)*(Number(it.quantidade)||0);
      const perc=(getDescMode()==='item')?clampPerc(Number(it.descPerc)||0):getDescGlobalPerc();
      return a + base*(perc/100);
    },0);
    const totalFinal = subtotalBrutoGeral - descontoTotal;

    cartEl.innerHTML=`
      <table class="carrinhoProposta-tabela">
        <thead>
          <tr>
            <th class="carrinhoProposta-th">SKU</th>
            <th class="carrinhoProposta-th">Image</th>
            <th class="carrinhoProposta-th">Produto</th>
            <th class="carrinhoProposta-th">Qtd</th>
            <th class="carrinhoProposta-th">Preço (un)</th>
            <th class="carrinhoProposta-th">Desc. (%)</th>
            <th class="carrinhoProposta-th">Total</th>
            <th class="carrinhoProposta-th"></th>
          </tr>
        </thead>
        <tbody>
          ${linhas}
          <tr><td class="carrinhoProposta-td" colspan="5" style="text-align:right;">Subtotal (bruto)</td><td class="carrinhoProposta-td" style="text-align:right;">${fmt(subtotalBrutoGeral)}</td><td></td></tr>
          <tr><td class="carrinhoProposta-td" colspan="5" style="text-align:right;">Desconto ${getDescMode()==='item'?'(itens)':`(global ${getDescGlobalPerc().toFixed(1).replace('.',',')}%)`}</td><td class="carrinhoProposta-td" style="text-align:right;">- ${fmt(descontoTotal)}</td><td></td></tr>
          <tr><td class="carrinhoProposta-td" colspan="5" style="text-align:right;font-weight:bold;">TOTAL</td><td class="carrinhoProposta-td" style="font-weight:bold;text-align:right">${fmt(totalFinal)}</td><td></td></tr>
        </tbody>
      </table>`;

    cartEl.querySelectorAll('.remover-carrinho').forEach(btn=>{
      btn.onclick=()=>{ const idx=Number(btn.dataset.idx); const lista=getCarrinho(); lista.splice(idx,1); setCarrinho(lista); renderCarrinho(); };
    });
    if(getDescMode()==='item'){
      cartEl.querySelectorAll('.desc-item').forEach(inp=>{
        inp.addEventListener('input', ()=>{ const cur=sanitizePercentText(inp.value); inp.value=cur.replace('.',','); });
        inp.addEventListener('blur', ()=>{ const idx=Number(inp.dataset.idx); const lista=getCarrinho(); let val=clampPerc(parsePercent(inp.value)); inp.value=val.toFixed(1).replace('.',','); if(lista[idx]){ lista[idx].descPerc=val; setCarrinho(lista); renderCarrinho(); } });
      });
    }

    applyNomeWidth(); hidratarNomes(itens.filter(it=>!it?.nome));
    recalcPaySummary();
  }

  async function hidratarNomes(itensSemNome){
    if(!itensSemNome?.length) return;
    const carrinhoAtual=getCarrinho(); const indexBySku=new Map(); carrinhoAtual.forEach((it,i)=>indexBySku.set(String(it.sku),i));
    await Promise.all(itensSemNome.map(async (item)=>{
      const nome=await getNomeProdutoPorSKU(item.sku);
      const sel=(window.CSS&&CSS.escape)
        ? `td.nome-produto[data-sku="${CSS.escape(String(item.sku))}"] .nome-produto-inner`
        : `td.nome-produto[data-sku="${String(item.sku).replace(/"/g,'\\"')}"] .nome-produto-inner`;
      const span=root.querySelector(sel);
      if(span){ const texto=nome||"(sem nome)"; span.textContent=texto; span.parentElement.title=texto; }
      const idx=indexBySku.get(String(item.sku));
      if(typeof idx==="number" && idx>=0 && carrinhoAtual[idx]){
        const norm=s=> (s&&String(s).trim()?String(s).trim():null);
        carrinhoAtual[idx].nome = norm(nome) ?? carrinhoAtual[idx].nome ?? null;
      }
    }));
    setCarrinho(carrinhoAtual); applyNomeWidth();
  }

  // ===== FORM: CEP e preenchimento por CPF/CNPJ =====
  chkEnt?.addEventListener('change', ()=>{ entBox.style.display = chkEnt.checked ? 'block' : 'none'; });
  root.querySelectorAll('.cep-busca').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tgt=btn.dataset.target; const group = tgt==='ent'? ent : cad;
      try{
        const data=await buscaCEP(group.cep.value);
        group.cep.value=onlyDigits(data.cep);
        group.endereco.value=data.endereco;
        group.bairro.value=data.bairro;
        group.cidade.value=data.cidade;
        group.uf.value=data.uf;
      }
      catch(e){ showMsg(e.message||'Falha ao buscar CEP', true); }
    });
  });
  elDoc?.addEventListener('blur', async ()=>{
    const key=cpfCnpjKey(elDoc.value); if(!key) return;
    try{
      const res=await fetch(`${PROPOSTA_DB}${CLIENTES_NODE}/${key}.json`);
      if(!res.ok) throw new Error('erro consulta cadastro');
      const dados=await res.json();
      if(dados){
        if(dados.nome)elNome.value=dados.nome;
        if(dados.tipo)elTipo.value=dados.tipo;
        if(dados.tel)elTel.value=dados.tel;
        if(dados.email)elEmail.value=dados.email;

        const c=dados.enderecoCadastro||{};
        cad.cep.value=onlyDigits(c.cep||""); cad.endereco.value=c.endereco||""; cad.bairro.value=c.bairro||"";
        cad.cidade.value=c.cidade||""; cad.uf.value=c.uf||""; cad.numero.value=c.numero||""; cad.complemento.value=c.complemento||"";

        const e=dados.enderecoEntrega||null;
        chkEnt.checked=!!e; entBox.style.display=chkEnt.checked?'block':'none';
        if(e){
          ent.cep.value=onlyDigits(e.cep||""); ent.endereco.value=e.endereco||"";
          ent.bairro.value=e.bairro||""; ent.cidade.value=e.cidade||"";
          ent.uf.value=e.uf||""; ent.numero.value=e.numero||""; ent.complemento.value=e.complemento||"";
        }
        showMsg("Cadastro carregado pelo CPF/CNPJ.");
      }
    }catch{}
  });

  // ===== validação / mensagens =====
  const validarProposta=()=> (elNome?.value?.trim()?.length>=2) && (elDoc?.value && onlyDigits(elDoc.value).length>=11);
  const validarPedido=()=> validarProposta();
  function feedbackBotoes(){
    const b1=root.querySelector('#carrinhoProposta-btn-proposta');
    const b2=root.querySelector('#carrinhoProposta-btn-pedido');
    if(b1) b1.disabled=!validarProposta();
    if(b2) b2.disabled=!validarPedido() || calcularSaldo()>0;
  }
  function showMsg(texto, erro=false){
    const m=root.querySelector('#carrinhoProposta-msg'); if(!m) return;
    m.innerHTML=texto; m.className='carrinhoProposta-msg'+(erro?' carrinhoProposta-erro':'');
    m.style.display='flex'; setTimeout(()=>{ m.style.display='none'; }, 3000);
  }
  ['input','change','blur'].forEach(ev=>{
    elNome?.addEventListener(ev,feedbackBotoes);
    elDoc?.addEventListener(ev,feedbackBotoes);
  });
  feedbackBotoes();

  // ===== PROPOSTA (RTDB) =====
  function coletarClienteRTDB(){
    const entregaDif=chkEnt?.checked;
    const cadastro={
      cep:onlyDigits(cad.cep.value), cidade:cad.cidade.value.trim(), uf:cad.uf.value.trim(),
      endereco:cad.endereco.value.trim(), bairro:cad.bairro.value.trim(),
      numero:cad.numero.value.trim(), complemento:cad.complemento.value.trim()
    };
    const entrega=entregaDif? {
      cep:onlyDigits(ent.cep.value), cidade:ent.cidade.value.trim(), uf:ent.uf.value.trim(),
      endereco:ent.endereco.value.trim(), bairro:ent.bairro.value.trim(),
      numero:ent.numero.value.trim(), complemento:ent.complemento.value.trim()
    } : null;
    return {
      nome:elNome.value.trim(), tipo:elTipo.value, cpfCnpj:cpfCnpjKey(elDoc.value),
      tel:elTel.value.trim(), email:elEmail.value.trim(),
      entregaDiferente:entregaDif, enderecoCadastro:cadastro, enderecoEntrega:entrega
    };
  }
  function calcularTotais(){
    const itens=getCarrinho();
    const subtotalBruto=itens.reduce((a,it)=>a+(Number(it.preco)||0)*(Number(it.quantidade)||0),0);
    const descTotal=itens.reduce((a,it)=>{
      const base=(Number(it.preco)||0)*(Number(it.quantidade)||0);
      const perc=(getDescMode()==='item')?clampPerc(Number(it.descPerc)||0):getDescGlobalPerc();
      return a + base*(perc/100);
    },0);
    const total=subtotalBruto-descTotal;
    return { mode:getDescMode(), descGlobal:getDescGlobalPerc(), subtotalBruto, descontoTotal:descTotal, total };
  }

  async function upsertCliente(cliente){
    const key=cpfCnpjKey(cliente.cpfCnpj); if(!key) throw new Error("CPF/CNPJ ausente");
    const res=await fetch(`${PROPOSTA_DB}${CLIENTES_NODE}/${key}.json`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ ...cliente, updatedAt:nowISO() })
    });
    if(!res.ok) throw new Error("Falha ao salvar cadastro");
    return key;
  }

  // 🔹 limpa carrinho + pagamentos + UI
  function resetCarrinhoEPagamentos(){
    setCarrinho([]);
    payments = [];
    nextPid = 1;
    renderPayments();
    renderCarrinho();
    recalcPaySummary();
  }

  // ====== PAGAMENTO (múltiplos recebimentos) ======
  let payments=[]; let nextPid=1;
  const payKind=root.querySelector('#pay-kind'), payAmount=root.querySelector('#pay-amount'),
        payGW=root.querySelector('#pay-gateway'), payInst=root.querySelector('#pay-installments'),
        payGWBox=root.querySelector('#pay-extra-gw'), payInstBox=root.querySelector('#pay-extra-inst'),
        payAddBtn=root.querySelector('#pay-add'), payList=root.querySelector('#pay-list');
  const elTotal=root.querySelector('#pay-total'), elRecv=root.querySelector('#pay-received'),
        elBal=root.querySelector('#pay-balance'), elChange=root.querySelector('#pay-change');

  // garante que "Boleto" exista na toolbar sem mexer no HTML
  if (payKind && !Array.from(payKind.options).some(o => o.value === 'boleto')) {
    const opt = document.createElement('option');
    opt.value = 'boleto';
    opt.textContent = 'Boleto';
    payKind.appendChild(opt);
  }

  function toggleExtras(){ const t=payKind.value;
    payGWBox.style.display   = (t==='credito') ? '' : 'none';
    payInstBox.style.display = (t==='credito') ? '' : 'none';
  }
  payKind.addEventListener('change', toggleExtras); toggleExtras();

  function addPayment(p){ payments.push({ id:nextPid++, ...p }); renderPayments(); recalcPaySummary(); }
  payAddBtn.addEventListener('click', ()=>{
    const tipo=payKind.value; const valor=brToNumber(payAmount.value); if(valor<=0) return;
    const base={ tipo, valor };

    if(tipo==='credito'){
      base.gateway=(payGW.value||'').trim();
      base.parcelas=parseInt(payInst.value||'1',10)||1;
    }
    if (tipo==='boleto'){
      base.meio = BOLETO_MEIO_FIXO; // fixo e oculto
      base.dias = '';
      base.data = '';
      base.obs  = '';
    }
    if (tipo!=='boleto' && tipo!=='credito'){
      base.obs = '';
    }

    addPayment(base); payAmount.value='';
  });

  function renderPayments(){
    payList.innerHTML='';
    payments.forEach(p=>{
      const card=document.createElement('div');
      card.className='pay-card';
      card.innerHTML=`
        <h4 style="display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;">
          <span>Recebimento</span>
          <button class="pay-del" title="remover">🗑</button>
        </h4>
        <div>
          <label>Tipo</label>
          <select class="tipo">
            <option value="dinheiro" ${p.tipo==='dinheiro'?'selected':''}>Dinheiro</option>
            <option value="pix" ${p.tipo==='pix'?'selected':''}>PIX</option>
            <option value="debito" ${p.tipo==='debito'?'selected':''}>Débito</option>
            <option value="credito" ${p.tipo==='credito'?'selected':''}>Crédito</option>
            <option value="boleto" ${p.tipo==='boleto'?'selected':''}>Boleto</option>
          </select>
        </div>

        <div>
          <label>Valor (R$)</label>
          <input class="v" value="${(p.valor||0).toFixed(2).replace('.',',')}" inputmode="decimal">
        </div>

        <div class="cred-wrap" ${p.tipo==='credito'?'':'style="display:none"'} >
          <label>Gateway (crédito)</label>
          <input class="gw" value="${p.gateway||''}">
          <label>Parcelas</label>
          <select class="inst">
            ${Array.from({length:12},(_,i)=>i+1).map(n=>`<option value="${n}" ${p.parcelas===n?'selected':''}>${n}x</option>`).join('')}
          </select>
        </div>

        <div class="boleto-wrap" ${p.tipo==='boleto'?'':'style="display:none"'} >
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:0;">
            <div>
              <label>Dias</label>
              <input class="dias" value="${p.dias??''}" inputmode="numeric" placeholder="ex.: 30">
            </div>
            <div>
              <label>Data (dd/mm/aaaa)</label>
              <input class="data" value="${p.data??''}" placeholder="ex.: 25/12/2025">
            </div>
          </div>
          <div style="margin-top:6px;">
            <label>Obs</label>
            <input class="obs" value="${p.obs||''}" placeholder="Observação da parcela">
          </div>
        </div>

        <div class="outros-wrap" ${p.tipo!=='boleto' && p.tipo!=='credito' ? '' : 'style="display:none"'} >
          <label>Obs</label>
          <input class="obs" value="${p.obs||''}" placeholder="Observação (opcional)">
        </div>
      `;

      // excluir
      card.querySelector('.pay-del').onclick=()=>{ payments=payments.filter(x=>x.id!==p.id); renderPayments(); recalcPaySummary(); };

      // editar valor
      card.querySelector('.v').addEventListener('blur', e=>{
        const v=brToNumber(e.target.value); p.valor = v>0 ? v : 0;
        e.target.value=(p.valor).toFixed(2).replace('.',','); recalcPaySummary();
      });

      // trocar tipo
      card.querySelector('.tipo').addEventListener('change', e=>{
        p.tipo = e.target.value;

        if(p.tipo==='credito'){
          p.parcelas = p.parcelas || 1;
        }else{
          delete p.parcelas;
          delete p.gateway;
        }

        if(p.tipo==='boleto'){
          p.meio = BOLETO_MEIO_FIXO;
          p.dias = p.dias || '';
          p.data = p.data || '';
          p.obs  = p.obs  || '';
        }else{
          delete p.meio; delete p.dias; delete p.data;
        }

        renderPayments(); recalcPaySummary();
      });

      // listeners específicos
      const gw=card.querySelector('.gw'); if(gw) gw.addEventListener('blur', e=>{ p.gateway=e.target.value.trim(); });
      const inst=card.querySelector('.inst'); if(inst) inst.addEventListener('change', e=>{ p.parcelas=parseInt(e.target.value,10)||1; });

      const dias=card.querySelector('.dias'); if(dias) dias.addEventListener('blur', e=>{ const v=onlyDigits(e.target.value); p.dias = v||''; e.target.value=p.dias; });
      const data=card.querySelector('.data'); if(data) data.addEventListener('blur', e=>{ p.data=e.target.value.trim(); });

      card.querySelectorAll('.obs').forEach(inp=>inp.addEventListener('blur', e=>{ p.obs = e.target.value.trim(); }));

      payList.appendChild(card);
    });
  }

  function calcularSaldo(){
    const tot=calcularTotais().total;
    const recv=payments.reduce((a,p)=>a+(Number(p.valor)||0),0);
    return Math.max(0, tot - recv);
  }

  function recalcPaySummary(){
    const tot=calcularTotais().total;
    const recv=payments.reduce((a,p)=>a+(Number(p.valor)||0),0);
    const saldo=Math.max(0, tot - recv);
    const troco=Math.max(0, recv - tot);
    elTotal.textContent=numberToBR(tot);
    elRecv.textContent=numberToBR(recv);
    elBal.textContent=numberToBR(saldo);
    elChange.textContent=numberToBR(troco);
    elBal.style.color = saldo>0 ? '#e74c3c' : '#107058';
    const btnPed=root.querySelector('#carrinhoProposta-btn-pedido'); if(btnPed) btnPed.disabled = !validarPedido() || saldo>0;
  }

  // ====== ITENS → Tiny ======
  function itensParaTiny(){
    const itens=getCarrinho(); const mode=getDescMode(); const descGlobal=getDescGlobalPerc();
    return itens.map(it=>{
      const preco=Number(it.preco)||0, qtd=Number(it.quantidade)||0;
      const perc=(mode==='item')?clampPerc(Number(it.descPerc)||0):descGlobal;
      const unit=preco*(1-(perc/100));
      const nome = (it.nome && String(it.nome).trim()) || nomeCache[it.sku] || null;
      return {
        codigo:String(it.sku),
        quantidade:String(qtd),
        valor_unitario:String(unit.toFixed(2)),
        ...(nome ? { descricao: String(nome) } : {}),
        unidade: 'UN'
      };
    });
  }

  // ====== PAGAMENTOS → Tiny ======
  function parcelasParaTiny(totalPedido){
    if (payments.length===0) {
      return [{ valor:String(totalPedido.toFixed(2)), forma_pagamento:'dinheiro', obs:'' }];
    }
    return payments
      .filter(p=>(Number(p.valor)||0)>0)
      .map(p=>{
        const base={
          valor:String(Number(p.valor).toFixed(2)),
          forma_pagamento:p.tipo,
          obs:(p.tipo==='credito' && p.parcelas>1)?`Cartão crédito ${p.parcelas}x`:(p.obs||'')
        };
        if(p.tipo==='pix'){
          base.meio_pagamento = PIX_MEIO_FIXO;
        }else if(p.tipo==='credito' && p.gateway){
          base.meio_pagamento = p.gateway;
        }else if(p.tipo==='boleto'){
          base.meio_pagamento = BOLETO_MEIO_FIXO;
        }
        if(p.dias) base.dias = String(p.dias);
        if(p.data) base.data = String(p.data); // dd/mm/aaaa
        return base;
      });
  }

  function coletarClienteParaTiny(){
    const tipoPessoa=mapTipoPessoaToTiny(elTipo?.value);
    const doc=cpfCnpjKey(elDoc?.value);
    const nome=elNome?.value?.trim()||'';
    const fone=elTel?.value?.trim()||'';
    const email=elEmail?.value?.trim()||'';
    const cliente={
      nome, tipo_pessoa:tipoPessoa, cpf_cnpj:doc, atualizar_cliente:'N',
      endereco:(cad.endereco.value||'').trim(), numero:(cad.numero.value||'').trim(),
      complemento:(cad.complemento.value||'').trim(), bairro:(cad.bairro.value||'').trim(),
      cep:onlyDigits(cad.cep.value), cidade:(cad.cidade.value||'').trim(), uf:(cad.uf.value||'').trim(),
      pais:'Brasil', fone, email
    };
    const entregaDif=chkEnt?.checked;
    const endereco_entrega=entregaDif? {
      tipo_pessoa:cliente.tipo_pessoa, cpf_cnpj:cliente.cpf_cnpj,
      endereco:(ent.endereco.value||'').trim(), numero:(ent.numero.value||'').trim(),
      complemento:(ent.complemento.value||'').trim(), bairro:(ent.bairro.value||'').trim(),
      cidade:(ent.cidade.value||'').trim(), uf:(ent.uf.value||'').trim(),
      cep:onlyDigits(ent.cep.value), fone, nome_destinatario:nome
    } : null;
    return { cliente, endereco_entrega };
  }

  // ====== SALVAR PEDIDO NO RTDB ======
  async function salvarPedidoRTDB({ vendedorKey, numero_pedido_ecommerce, clienteRTDB, itensSnapshot, totais, payloadEnviado, tinyResposta, situacaoFinal }) {
    const registro = {
      createdAt: nowISO(),
      numero_pedido_ecommerce,
      status: situacaoFinal,
      clienteKey: cpfCnpjKey(clienteRTDB.cpfCnpj),
      clienteSnapshot: clienteRTDB,
      itens: itensSnapshot,
      totais,
      payloadTiny: payloadEnviado,
      tinyRetorno: tinyResposta,
      vendedor: {
        id: VENDEDOR?.id ?? null,
        nome: VENDEDOR?.nome ?? null,
        tipo: VENDEDOR?.tipo ?? null,
        cpfKey: VENDEDOR?.cpfKey ?? null
      }
    };
    const url = `${PROPOSTA_DB}${PEDIDOS_NODE}/${encodeURIComponent(vendedorKey)}/${encodeURIComponent(numero_pedido_ecommerce)}.json`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(registro)
    });
    if (!res.ok) throw new Error('Falha ao salvar pedido no RTDB');
    return true;
  }

  async function enviarPedidoTiny(){
    if(!validarPedido()){ showMsg("Preencha Nome e CPF/CNPJ.", true); return; }
    if(!getCarrinho().length){ showMsg("Adicione itens ao carrinho.", true); return; }

    const totais=calcularTotais();
    const itensTiny=itensParaTiny();
    const parcelasTiny=parcelasParaTiny(totais.total);
    const somaParcelas=parcelasTiny.reduce((a,p)=>a+(Number(p.valor)||0),0);
    if (Math.abs(somaParcelas - totais.total) > 0.02){
      showMsg(`Soma dos recebimentos (R$ ${somaParcelas.toFixed(2)}) difere do total (R$ ${totais.total.toFixed(2)}).`, true);
      return;
    }

    const { cliente, endereco_entrega } = coletarClienteParaTiny();
    const marcadoresText = root.querySelector('#marcadores')?.value?.trim() || '';
    const marcadores = marcadoresText ? marcadoresText.split(',').map(s=>s.trim()).filter(Boolean) : [];

    const idVendedor = VENDEDOR?.id ? String(VENDEDOR.id) : 'sem_vendedor';
    const numeroPedidoEcomm = `${idVendedor}-${nowStamp()}`;
    const vendedorKey = sanitizeKey(idVendedor || VENDEDOR?.cpfKey || VENDEDOR?.nome || 'sem_vendedor');

    const temBoleto = payments.some(p => p.tipo === 'boleto');
    const situacaoFinal = temBoleto ? 'aberto' : 'aprovado';

    const body={
      cliente,
      ...(endereco_entrega?{endereco_entrega}:{ }),
      itens:itensTiny,
      parcelas:parcelasTiny,
      marcadores,
      forma_pagamento: (payments.length===1 && Math.abs(somaParcelas - totais.total) < 0.02) ? parcelasTiny[0].forma_pagamento : 'multiplas',
      obs: root.querySelector('#obs')?.value?.trim() || 'Pedido gerado pelo carrinho',
      id_ecommerce: IDECOMMERCE_FIXO,
      numero_pedido_ecommerce: numeroPedidoEcomm,
      id_vendedor: idVendedor,
      situacao: situacaoFinal
    };

    setBusy(true, "Enviando pedido…");
    try{
      const resp=await fetch(API_URL,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      const data=await resp.json();

      if(!resp.ok || data?.ok===false){
        const msg = data?.tiny?.retorno?.registros?.registro?.erros?.map(e=>e.erro).join('; ')
                || data?.error || 'Falha no envio';
        throw new Error(`Erro no Tiny: ${msg}`);
      }

      const tinyRegistro = data?.tiny?.retorno?.registros?.registro || null;
      const numeroTiny = tinyRegistro?.numero || '(sem número)';
      showMsg(`Pedido enviado! Nº Tiny: <b>${numeroTiny}</b>`);

      const clienteRTDB = coletarClienteRTDB();
      await salvarPedidoRTDB({
        vendedorKey,
        numero_pedido_ecommerce: numeroPedidoEcomm,
        clienteRTDB,
        itensSnapshot: getCarrinho(),
        totais,
        payloadEnviado: body,
        tinyResposta: data,
        situacaoFinal
      });

      resetCarrinhoEPagamentos();

    }catch(e){
      showMsg(e.message||'Erro ao enviar pedido', true);
    }finally{
      setBusy(false);
    }
  }

  // ===== BOTÕES =====
  const btnProp=root.querySelector('#carrinhoProposta-btn-proposta');
  const btnPed =root.querySelector('#carrinhoProposta-btn-pedido');

  async function salvarProposta(status = "rascunho") {
    if (!validarProposta()) { showMsg("Preencha Nome e CPF/CNPJ.", true); return; }
    if (!getCarrinho().length) { showMsg("Adicione itens ao carrinho.", true); return; }

    setBusy(true, "Salvando proposta…");
    try {
      const cliente = coletarClienteRTDB();
      await upsertCliente(cliente);

      const vendedorKeyRaw = VENDEDOR?.id ?? VENDEDOR?.cpfKey ?? VENDEDOR?.nome ?? "sem_vendedor";
      const vendedorKey = sanitizeKey(vendedorKeyRaw);

      const proposta = {
        createdAt: nowISO(),
        status,
        clienteSnapshot: cliente,
        itens: getCarrinho(),
        totais: calcularTotais(),
        vendedor: { id: VENDEDOR?.id ?? null, nome: VENDEDOR?.nome ?? null, tipo: VENDEDOR?.tipo ?? null, cpfKey: VENDEDOR?.cpfKey ?? null }
      };

      if (editRef?.vendorKey && editRef?.id) {
        const url = `${PROPOSTA_DB}${PROPOSTAS_NODE}/${encodeURIComponent(editRef.vendorKey)}/${encodeURIComponent(editRef.id)}.json`;
        const resp = await fetch(url, {
          method:'PATCH', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ ...proposta, updatedAt: nowISO() })
        });
        if(!resp.ok) throw new Error("Falha ao atualizar a proposta");
        showMsg(`Proposta atualizada! <b>#${editRef.id}</b>`);
      } else {
        const resp = await fetch(`${PROPOSTA_DB}${PROPOSTAS_NODE}/${encodeURIComponent(vendedorKey)}.json`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(proposta) });
        if(!resp.ok) throw new Error("Falha ao salvar a proposta");
        const { name } = await resp.json();
        showMsg(`Proposta salva! <b>#${name}</b>`);
      }

      localStorage.removeItem('carrinhoProposta_itens');
      localStorage.removeItem(DESC_MODE_KEY);
      localStorage.removeItem(DESC_GLOBAL_KEY);
      localStorage.removeItem(EDIT_REF_KEY);
      localStorage.removeItem(CLIENTE_CPF_KEY);

      resetCarrinhoEPagamentos();
      editRef = null;
    } catch (e) {
      showMsg(e.message || "Erro ao salvar proposta", true);
    } finally {
      setBusy(false);
    }
  }

  btnProp?.addEventListener('click', async () => {
    try { await salvarProposta("rascunho"); } catch (e) { showMsg(e.message || "Erro ao salvar", true); }
  });

  btnPed?.addEventListener('click', async () => {
    try {
      if (calcularSaldo() > 0) {
        showMsg("Ainda falta receber o saldo.", true);
        return;
      }
      await enviarPedidoTiny();
    } catch (e) {
      showMsg(e.message || "Erro ao enviar pedido", true);
    }
  });

  // ===== Eventos globais =====
  const onStorage=(e)=>{ if(e.key==="carrinhoProposta_itens"||e.key===DESC_MODE_KEY||e.key===DESC_GLOBAL_KEY){ renderCarrinho(); renderControls(); } };
  window.addEventListener("storage", onStorage);
  const onResize=()=> applyNomeWidth(); window.addEventListener("resize", onResize);

  // ===== Bootstrap do handoff =====
  async function bootstrapFromHandoff(){
    try{
      const rawRef = localStorage.getItem(EDIT_REF_KEY);
      if (rawRef) editRef = JSON.parse(rawRef);
    }catch{}
    const cpf = localStorage.getItem(CLIENTE_CPF_KEY);
    if (cpf && elDoc) {
      elDoc.value = cpf;
      elDoc.dispatchEvent(new Event('blur'));
    }
  }

  // ===== Boot =====
  bootstrapFromHandoff();
  renderControls();
  renderCarrinho();

  // ===== Teardown =====
  return function teardown(){
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("resize", onResize);
  };
}
