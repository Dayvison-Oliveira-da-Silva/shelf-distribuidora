// javascript/carrinho.js
// Carrinho com nomes via Firebase + clamp por "ch" +
// Desconto exclusivo (por item OU global) + cadastro/endereços do cliente
// Propostas salvas em RTDB proposta-shelf-distribuidora (propostas/ e cadastrosClientes/)

export function init(root) {
  // ====== CONFIG ======
  const MAX_DESC = 1.5;          // % máximo permitido
  const DESKTOP_CH = 34;         // ~caracteres por linha (desktop)
  const MOBILE_CH  = 26;         // ~caracteres por linha (mobile)

  // ==== VENDEDOR (pega do localStorage, cobre os dois formatos) ====
  function getVendedorFromLS(){
    try{
      const raw = localStorage.getItem("usuario_shelf");
      if(!raw) return null;
      const data = JSON.parse(raw);

      // formato 1: { id, tipo, usuario, ... }
      if (data && typeof data === "object" && ("id" in data || "tipo" in data || "usuario" in data)) {
        return {
          id: data.id ?? null,
          nome: data.usuario ?? null,
          tipo: data.tipo ?? null,
          cpfKey: data.cpf ?? null,
        };
      }

      // formato 2: { "<cpf>": { id, tipo, usuario, ... } }
      const keys = Object.keys(data || {});
      if (keys.length) {
        const cpfKey = keys[0];
        const v = data[cpfKey] || {};
        return {
          id: v.id ?? null,
          nome: v.usuario ?? null,
          tipo: v.tipo ?? null,
          cpfKey,
        };
      }
    }catch{}
    return null;
  }
  const VENDEDOR = getVendedorFromLS();

  // ====== BASES DO FIREBASE ======
  // 1) estoque... -> só para buscar nome de produto
  const usuario = JSON.parse(localStorage.getItem("usuario_shelf") || "{}"); // fallback antigo
  let databaseBaseUrl = "https://estoque-distribuidora-default-rtdb.firebaseio.com/";
  const tipoBase = (VENDEDOR?.tipo ?? usuario?.tipo) || "";
  if (tipoBase === "grandes") {
    databaseBaseUrl = "https://estoque-distribuidora-grandes-default-rtdb.firebaseio.com/";
  } else if (tipoBase === "especial") {
    databaseBaseUrl = "https://estoque-distribuidora-especial-default-rtdb.firebaseio.com/";
  }
  // 2) proposta... -> para salvar propostas e cadastros
  const PROPOSTA_DB = "https://proposta-shelf-distribuidora-default-rtdb.firebaseio.com/";
  const CLIENTES_NODE = "cadastrosClientes";
  const PROPOSTAS_NODE = "propostas";

  // ====== KEYS LOCALSTORAGE ======
  const NOME_CACHE_KEY   = "carrinhoProposta_nomeCache";
  const DESC_MODE_KEY    = "carrinhoProposta_descMode";         // 'item' | 'global'
  const DESC_GLOBAL_KEY  = "carrinhoProposta_descGlobalPerc";   // número (0..MAX_DESC)

  // ------------------ CACHE DE NOMES ------------------
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

  // ------------------ HELPERS GERAIS ------------------
  const fmt = (v) => `R$ ${(Number(v) || 0).toFixed(2)}`;
  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");
  const cpfCnpjKey = (s) => onlyDigits(s); // chave do nó no RTDB
  const nowISO = () => new Date().toISOString();

  function applyNomeWidth() {
    const isMobile = window.matchMedia("(max-width: 980px)").matches;
    const ch = isMobile ? MOBILE_CH : DESKTOP_CH;
    root.querySelectorAll('.nome-produto-inner').forEach(span => {
      span.style.maxWidth = ch + "ch";
    });
  }

  const escapeHtml = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

  // normaliza entrada do usuário para percentuais
  function sanitizePercentText(str) {
    let s = String(str || "").trim().replace(',', '.');
    s = s.replace(/[^\d.]/g, '');
    const i = s.indexOf('.');
    if (i !== -1) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
    return s;
  }
  function parsePercent(str) {
    const n = parseFloat(sanitizePercentText(str));
    return Number.isFinite(n) ? n : 0;
  }
  const clampPerc = (p) => Math.max(0, Math.min(MAX_DESC, Number(p) || 0));

  // RTDB não aceita . $ # [ ] / nas chaves
  function sanitizeKey(k = "") {
    return String(k).replace(/[.$#[\]/]/g, "_").trim() || "sem_vendedor";
  }

  // CEP (ViaCEP)
  async function buscaCEP(cep) {
    const v = onlyDigits(cep);
    if (v.length !== 8) throw new Error("CEP inválido");
    const res = await fetch(`https://viacep.com.br/ws/${v}/json/`);
    const json = await res.json();
    if (json.erro) throw new Error("CEP não encontrado");
    return {
      cep: json.cep || cep,
      endereco: json.logradouro || "",
      bairro: json.bairro || "",
      cidade: json.localidade || "",
      uf: json.uf || ""
    };
  }

  // ------------------ UI DO CARRINHO ------------------
  root.classList.add("carrinhoProposta-host");
  root.innerHTML = `
    <main class="carrinhoProposta-main">
      <h1 class="carrinhoProposta-title">Carrinho</h1>
      <p class="carrinhoProposta-desc">Revise os itens e gere uma proposta ou pedido.</p>

      <section aria-labelledby="itens-carrinho">
        <h2 id="itens-carrinho" class="carrinhoProposta-section-title">Itens</h2>
        <!-- CONTROLES DE DESCONTO (modo exclusivo) -->
        <div id="carrinhoProposta-controls" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:6px 0 10px;">
          <span style="font-weight:600;color:#107058;">Desconto:</span>
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="radio" name="carrinhoProposta-modo" value="item"> por item
          </label>
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="radio" name="carrinhoProposta-modo" value="global"> todos os itens
          </label>
          <div id="carrinhoProposta-global-wrap" style="display:flex;align-items:center;gap:6px;">
            <input id="carrinhoProposta-desc-global" type="text" inputmode="decimal"
                   placeholder="0,0" maxlength="5"
                   style="width:80px;padding:6px 8px;border:1.5px solid #d4dde7;border-radius:7px;text-align:right;"
                   aria-label="Desconto global em porcentagem (máx ${MAX_DESC}%)"> %
            <small style="color:#5c6a67">máx ${MAX_DESC}%</small>
          </div>
        </div>

        <div id="carrinhoProposta-cart"></div>
      </section>

      <section aria-labelledby="dados-cliente">
        <h2 id="dados-cliente" class="carrinhoProposta-section-title">Dados do cliente</h2>

        <!-- dados básicos -->
        <div class="carrinhoProposta-campos">
          <div>
            <label for="carrinhoProposta-nome">Nome do cliente</label>
            <input id="carrinhoProposta-nome" type="text" placeholder="Ex.: Dra. Sabrina">
          </div>
          <div>
            <label for="carrinhoProposta-tipo">Tipo de pessoa</label>
            <select id="carrinhoProposta-tipo">
              <option value="">Selecione</option>
              <option value="pf">Pessoa Física</option>
              <option value="pj">Pessoa Jurídica</option>
            </select>
          </div>
          <div>
            <label for="carrinhoProposta-cpfcnpj">CPF/CNPJ</label>
            <input id="carrinhoProposta-cpfcnpj" type="text" inputmode="numeric" placeholder="Somente números">
          </div>
          <div>
            <label for="carrinhoProposta-tel">Telefone</label>
            <input id="carrinhoProposta-tel" type="text" inputmode="tel">
          </div>
          <div>
            <label for="carrinhoProposta-email">Email</label>
            <input id="carrinhoProposta-email" type="email">
          </div>
        </div>

        <!-- endereço de cadastro -->
        <h3 class="carrinhoProposta-section-title" style="margin-top:12px">Endereço de cadastro</h3>
        <div class="carrinhoProposta-campos grid-endereco">
          <div>
            <label for="cad-cep">CEP</label>
            <div class="cep-wrap">
              <input id="cad-cep" type="text" inputmode="numeric" placeholder="00000000">
              <button type="button" class="cep-busca" data-target="cad">🔍</button>
            </div>
          </div>
          <div>
            <label for="cad-cidade">Cidade</label>
            <input id="cad-cidade" type="text">
          </div>
          <div>
            <label for="cad-uf">UF</label>
            <select id="cad-uf">
              <option value="">Selecione</option>
              ${["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf=>`<option>${uf}</option>`).join("")}
            </select>
          </div>
          <div class="full">
            <label for="cad-endereco">Endereço</label>
            <input id="cad-endereco" type="text">
          </div>
          <div>
            <label for="cad-bairro">Bairro</label>
            <input id="cad-bairro" type="text">
          </div>
          <div>
            <label for="cad-numero">Número</label>
            <input id="cad-numero" type="text" inputmode="numeric">
          </div>
          <div>
            <label for="cad-complemento">Complemento</label>
            <input id="cad-complemento" type="text">
          </div>
        </div>

        <!-- entrega diferente -->
        <label class="chk-line" style="margin:10px 0">
          <input id="entrega-diferente" type="checkbox">
          O endereço de entrega do cliente é diferente do endereço de cobrança
        </label>

        <div id="box-entrega" style="display:none">
          <h3 class="carrinhoProposta-section-title" style="margin-top:6px">Endereço de entrega</h3>
          <div class="carrinhoProposta-campos grid-endereco">
            <div>
              <label for="ent-cep">CEP</label>
              <div class="cep-wrap">
                <input id="ent-cep" type="text" inputmode="numeric" placeholder="00000000">
                <button type="button" class="cep-busca" data-target="ent">🔍</button>
              </div>
            </div>
            <div>
              <label for="ent-cidade">Cidade</label>
              <input id="ent-cidade" type="text">
            </div>
            <div>
              <label for="ent-uf">UF</label>
              <select id="ent-uf">
                <option value="">Selecione</option>
                ${["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"].map(uf=>`<option>${uf}</option>`).join("")}
              </select>
            </div>
            <div class="full">
              <label for="ent-endereco">Endereço</label>
              <input id="ent-endereco" type="text">
            </div>
            <div>
              <label for="ent-bairro">Bairro</label>
              <input id="ent-bairro" type="text">
            </div>
            <div>
              <label for="ent-numero">Número</label>
              <input id="ent-numero" type="text" inputmode="numeric">
            </div>
            <div>
              <label for="ent-complemento">Complemento</label>
              <input id="ent-complemento" type="text">
            </div>
          </div>
        </div>

        <div class="carrinhoProposta-botoes">
          <button id="carrinhoProposta-btn-proposta" class="carrinhoProposta-btn">Salvar Proposta</button>
          <button id="carrinhoProposta-btn-pedido" class="carrinhoProposta-btn">Pedido de Venda</button>
        </div>
        <div id="carrinhoProposta-msg" class="carrinhoProposta-msg"></div>
      </section>
    </main>
  `;

  // ------------------ STORAGE & STATE ------------------
  const cartEl = root.querySelector('#carrinhoProposta-cart');

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

  // ------------------ RENDER TABELA ------------------
  function renderCarrinho() {
    const itens = getCarrinho();
    const mode = getDescMode();
    const descGlobal = getDescGlobalPerc();

    // Atualiza UI dos controles
    const radios = root.querySelectorAll('input[name="carrinhoProposta-modo"]');
    radios.forEach(r => { r.checked = (r.value === mode); });
    const wrapGlobal = root.querySelector('#carrinhoProposta-global-wrap');
    const inputGlobal = root.querySelector('#carrinhoProposta-desc-global');
    if (wrapGlobal && inputGlobal) {
      inputGlobal.value = String(descGlobal).replace('.', ',');
      wrapGlobal.style.opacity = (mode === 'global') ? '1' : '.55';
      inputGlobal.disabled = (mode !== 'global');
    }

    if (!itens.length) {
      cartEl.innerHTML = `<div class="carrinhoProposta-vazio">Seu carrinho está vazio :(</div>`;
      return;
    }

    const linhas = itens.map((item, idx) => {
      const preco = Number(item.preco) || 0;
      const qtd = Number(item.quantidade) || 0;

      const nomeCached = nomeCache[item.sku] ?? undefined;
      const nomeInicial = (nomeCached === null) ? "(sem nome)" : (nomeCached || "Carregando nome...");

      let descPercLinha = (mode === 'item') ? clampPerc(Number(item.descPerc) || 0) : getDescGlobalPerc();

      const subtotalBruto = preco * qtd;
      const descontoLinha = subtotalBruto * (descPercLinha / 100);
      const subtotal = subtotalBruto - descontoLinha;

      const descCell = (mode === 'item')
        ? `
          <input class="desc-item" data-idx="${idx}" type="text" inputmode="decimal"
                 placeholder="0,0" maxlength="5"
                 value="${String(clampPerc(Number(item.descPerc) || 0)).replace('.', ',')}"
                 style="width:68px; padding:6px 8px; border:1px solid #d4dde7; border-radius:7px; text-align:right;"
                 aria-label="Desconto do item em porcentagem (máx ${MAX_DESC}%)">
          <div style="font-size:11px;color:#5c6a67;margin-top:2px;">máx ${MAX_DESC}%</div>
        `
        : `<span>${getDescGlobalPerc().toFixed(1).replace('.', ',')}%</span>`;

      return `
        <tr>
          <td class="carrinhoProposta-td">${item.sku}</td>
          <td class="carrinhoProposta-td nome-produto" data-sku="${String(item.sku)}">
            <span class="nome-produto-inner"
                  style="display:inline-block; white-space:normal; word-break:break-word; hyphens:auto; line-height:1.25;">
              ${escapeHtml(nomeInicial)}
            </span>
          </td>
          <td class="carrinhoProposta-td" style="text-align:center">${qtd}</td>
          <td class="carrinhoProposta-td" style="text-align:right">${fmt(preco)}</td>
          <td class="carrinhoProposta-td" style="text-align:center">${descCell}</td>
          <td class="carrinhoProposta-td subtotal-cell" style="text-align:right">${fmt(subtotal)}</td>
          <td class="carrinhoProposta-td" style="text-align:right">
            <button class="remover-carrinho" data-idx="${idx}" style="background:#e74c3c;color:#fff;padding:4px 10px;border-radius:7px;border:none;cursor:pointer;">remover</button>
          </td>
        </tr>
      `;
    }).join('');

    // Totais
    const subtotalBrutoGeral = itens.reduce((acc, item) => acc + (Number(item.preco)||0) * (Number(item.quantidade)||0), 0);
    const descontoTotal = itens.reduce((acc, item) => {
      const base = (Number(item.preco)||0) * (Number(item.quantidade)||0);
      const perc = (getDescMode() === 'item') ? clampPerc(Number(item.descPerc) || 0) : getDescGlobalPerc();
      return acc + (base * (perc / 100));
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
            <th class="carrinhoProposta-th">${getDescMode()==='item' ? 'Desc. (%)' : 'Desc. (%)'}</th>
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

    // remover item
    cartEl.querySelectorAll('.remover-carrinho').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.idx);
        const lista = getCarrinho();
        lista.splice(idx, 1);
        setCarrinho(lista);
        renderCarrinho();
      };
    });

    // desconto por item
    if (getDescMode() === 'item') {
      cartEl.querySelectorAll('.desc-item').forEach(inp => {
        inp.addEventListener('input', () => {
          const cur = sanitizePercentText(inp.value);
          inp.value = cur.replace('.', ',');
        });
        inp.addEventListener('blur', () => {
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
    hidratarNomes(itens);
  }

  async function hidratarNomes(itens) {
    await Promise.all(itens.map(async (item) => {
      const nome = await getNomeProdutoPorSKU(item.sku);
      const seletor = (window.CSS && CSS.escape)
        ? `td.nome-produto[data-sku="${CSS.escape(String(item.sku))}"] .nome-produto-inner`
        : `td.nome-produto[data-sku="${String(item.sku).replace(/"/g, '\\"')}"] .nome-produto-inner`;
      const span = root.querySelector(seletor);
      if (span) {
        const texto = nome || "(sem nome)";
        span.textContent = texto;
        span.parentElement.title = texto;
      }
    }));
    applyNomeWidth();
  }

  // ------------------ CONTROLES (radios + input global) ------------------
  const radios = root.querySelectorAll('input[name="carrinhoProposta-modo"]');
  const inputGlobal = root.querySelector('#carrinhoProposta-desc-global');
  setDescMode(getDescMode());
  setDescGlobalPerc(getDescGlobalPerc());
  radios.forEach(r => {
    r.addEventListener('change', () => {
      setDescMode(r.value === 'global' ? 'global' : 'item');
      renderCarrinho();
    });
  });
  if (inputGlobal) {
    inputGlobal.addEventListener('input', () => {
      const cur = sanitizePercentText(inputGlobal.value);
      inputGlobal.value = cur.replace('.', ',');
    });
    inputGlobal.addEventListener('blur', () => {
      let val = clampPerc(parsePercent(inputGlobal.value));
      inputGlobal.value = val.toFixed(1).replace('.', ',');
      setDescGlobalPerc(val);
      if (getDescMode() === 'global') renderCarrinho();
    });
  }

  // ------------------ FORM / CAMPOS ------------------
  const elNome = root.querySelector('#carrinhoProposta-nome');
  const elTipo = root.querySelector('#carrinhoProposta-tipo');
  const elDoc  = root.querySelector('#carrinhoProposta-cpfcnpj');
  const elTel  = root.querySelector('#carrinhoProposta-tel');
  const elEmail= root.querySelector('#carrinhoProposta-email');

  // cadastro (cobrança)
  const cad = {
    cep: root.querySelector('#cad-cep'),
    cidade: root.querySelector('#cad-cidade'),
    uf: root.querySelector('#cad-uf'),
    endereco: root.querySelector('#cad-endereco'),
    bairro: root.querySelector('#cad-bairro'),
    numero: root.querySelector('#cad-numero'),
    complemento: root.querySelector('#cad-complemento')
  };
  // entrega
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
  chkEnt.addEventListener('change', ()=> { entBox.style.display = chkEnt.checked ? 'block' : 'none'; });

  // busca CEP (cad/ent)
  root.querySelectorAll('.cep-busca').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const tgt = btn.dataset.target; // 'cad' ou 'ent'
      const group = tgt === 'ent' ? ent : cad;
      try{
        const data = await buscaCEP(group.cep.value);
        group.cep.value = onlyDigits(data.cep);
        group.endereco.value = data.endereco;
        group.bairro.value = data.bairro;
        group.cidade.value = data.cidade;
        group.uf.value = data.uf;
      }catch(e){
        showMsg(e.message || 'Falha ao buscar CEP', true);
      }
    });
  });

  // Preencher ao digitar CPF/CNPJ se já existir no RTDB
  elDoc.addEventListener('blur', async ()=>{
    const key = cpfCnpjKey(elDoc.value);
    if (!key) return;
    try{
      const res = await fetch(`${PROPOSTA_DB}${CLIENTES_NODE}/${key}.json`);
      if(!res.ok) throw new Error('erro consulta cadastro');
      const dados = await res.json();
      if(dados){
        // preencher
        if(dados.nome)  elNome.value = dados.nome;
        if(dados.tipo)  elTipo.value = dados.tipo;
        if(dados.tel)   elTel.value  = dados.tel;
        if(dados.email) elEmail.value= dados.email;

        const srcCad = dados.enderecoCadastro || {};
        cad.cep.value = onlyDigits(srcCad.cep || "");
        cad.endereco.value = srcCad.endereco || "";
        cad.bairro.value = srcCad.bairro || "";
        cad.cidade.value = srcCad.cidade || "";
        cad.uf.value = srcCad.uf || "";
        cad.numero.value = srcCad.numero || "";
        cad.complemento.value = srcCad.complemento || "";

        const srcEnt = dados.enderecoEntrega || null;
        chkEnt.checked = !!srcEnt;
        entBox.style.display = chkEnt.checked ? 'block':'none';
        if(srcEnt){
          ent.cep.value = onlyDigits(srcEnt.cep || "");
          ent.endereco.value = srcEnt.endereco || "";
          ent.bairro.value = srcEnt.bairro || "";
          ent.cidade.value = srcEnt.cidade || "";
          ent.uf.value = srcEnt.uf || "";
          ent.numero.value = srcEnt.numero || "";
          ent.complemento.value = srcEnt.complemento || "";
        }
        showMsg("Cadastro carregado pelo CPF/CNPJ.");
      }
    }catch(e){
      // silencioso para não incomodar
    }
  });

  // validação simples
  const validarProposta = () =>
    (elNome?.value?.trim()?.length >= 2) &&
    (elDoc?.value && onlyDigits(elDoc.value).length >= 11);

  function validarPedido() {
    // igual por enquanto; “situação” você define depois
    return validarProposta();
  }

  function feedbackBotoes() {
    const btnProp = root.querySelector('#carrinhoProposta-btn-proposta');
    const btnPed  = root.querySelector('#carrinhoProposta-btn-pedido');
    if (btnProp) btnProp.disabled = !validarProposta();
    if (btnPed)  btnPed.disabled  = !validarPedido();
  }
  function showMsg(texto, erro = false) {
    const msgEl = root.querySelector('#carrinhoProposta-msg');
    if (!msgEl) return;
    msgEl.innerHTML = texto;
    msgEl.className = 'carrinhoProposta-msg' + (erro ? ' carrinhoProposta-erro' : '');
    msgEl.style.display = 'flex';
    setTimeout(() => { msgEl.style.display = 'none'; }, 3000);
  }
  ['input','change','blur'].forEach(ev=>{
    elNome?.addEventListener(ev, feedbackBotoes);
    elDoc?.addEventListener(ev, feedbackBotoes);
  });
  feedbackBotoes();

  // ------------------ SALVAR EM RTDB ------------------
  function coletarCliente() {
    const entregaDif = chkEnt.checked;
    const cadastro = {
      cep: onlyDigits(cad.cep.value),
      cidade: cad.cidade.value.trim(),
      uf: cad.uf.value.trim(),
      endereco: cad.endereco.value.trim(),
      bairro: cad.bairro.value.trim(),
      numero: cad.numero.value.trim(),
      complemento: cad.complemento.value.trim()
    };
    const entrega = entregaDif ? {
      cep: onlyDigits(ent.cep.value),
      cidade: ent.cidade.value.trim(),
      uf: ent.uf.value.trim(),
      endereco: ent.endereco.value.trim(),
      bairro: ent.bairro.value.trim(),
      numero: ent.numero.value.trim(),
      complemento: ent.complemento.value.trim()
    } : null;

    return {
      nome: elNome.value.trim(),
      tipo: elTipo.value,
      cpfCnpj: cpfCnpjKey(elDoc.value),
      tel: elTel.value.trim(),
      email: elEmail.value.trim(),
      entregaDiferente: entregaDif,
      enderecoCadastro: cadastro,
      enderecoEntrega: entrega
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
    return {
      mode: getDescMode(),
      descGlobal: getDescGlobalPerc(),
      subtotalBruto, descontoTotal: descTotal, total
    };
  }

  async function upsertCliente(cliente) {
    const key = cpfCnpjKey(cliente.cpfCnpj);
    if(!key) throw new Error("CPF/CNPJ ausente");
    const payload = { ...cliente, updatedAt: nowISO() };
    // PATCH para mesclar
    const res = await fetch(`${PROPOSTA_DB}${CLIENTES_NODE}/${key}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    if(!res.ok) throw new Error("Falha ao salvar cadastro");
    return key;
  }

  async function salvarProposta(status="rascunho") {
    if(!validarProposta()){ showMsg("Preencha Nome e CPF/CNPJ.", true); return; }
    const itens = getCarrinho();
    if(!itens.length){ showMsg("Adicione itens ao carrinho.", true); return; }

    const cliente = coletarCliente();
    const clienteKey = await upsertCliente(cliente);

    // Vendedor key (estável) para agrupar propostas
    const vendedorKeyRaw = VENDEDOR?.id ?? VENDEDOR?.cpfKey ?? VENDEDOR?.nome ?? "sem_vendedor";
    const vendedorKey = sanitizeKey(vendedorKeyRaw);

    const proposta = {
      createdAt: nowISO(),
      status,                     // você pode alterar depois
      clienteKey,
      clienteSnapshot: cliente,   // guarda uma foto do cadastro no momento
      itens,
      totais: calcularTotais(),
      vendedor: {
        id: VENDEDOR?.id ?? null,
        nome: VENDEDOR?.nome ?? null,
        tipo: VENDEDOR?.tipo ?? null,
        cpfKey: VENDEDOR?.cpfKey ?? null,
      },
    };

    // Salva em: propostas/<idVendedor>/<autoId>
    const res = await fetch(`${PROPOSTA_DB}${PROPOSTAS_NODE}/${encodeURIComponent(vendedorKey)}.json`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(proposta)
    });
    if(!res.ok){ showMsg("Falha ao salvar a proposta.", true); return; }
    const { name: generatedId } = await res.json();

    showMsg(`Proposta salva! <b>#${generatedId}</b>`);
    return generatedId;
  }

  // ------------------ BOTÕES ------------------
  const btnProp = root.querySelector('#carrinhoProposta-btn-proposta');
  const btnPed  = root.querySelector('#carrinhoProposta-btn-pedido');

  if (btnProp) btnProp.onclick = async () => {
    try{
      await salvarProposta("rascunho");
    }catch(e){ showMsg(e.message || "Erro ao salvar", true); }
  };

  if (btnPed) btnPed.onclick = async () => {
    try{
      // “em aberto”: mesma gravação, status que você decidir depois
      await salvarProposta("pedido_em_aberto");
    }catch(e){ showMsg(e.message || "Erro ao salvar pedido", true); }
  };

  // ------------------ REAGIR A MUDANÇAS & RESIZE ------------------
  const onStorage = (e) => {
    if (e.key === "carrinhoProposta_itens" ||
        e.key === DESC_MODE_KEY ||
        e.key === DESC_GLOBAL_KEY) {
      renderCarrinho();
    }
  };
  window.addEventListener("storage", onStorage);

  const onResize = () => applyNomeWidth();
  window.addEventListener("resize", onResize);

  // ------------------ BOOT ------------------
  renderCarrinho();

  // ------------------ TEARDOWN ------------------
  return function teardown() {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("resize", onResize);
  };
}
