// main/produtos.js
export function init(root) {
  // 1) Contexto local (sem poluir global)
  const usuario1 = JSON.parse(localStorage.getItem("usuario_shelf") || "{}");

  let databaseBaseUrl = "https://estoque-distribuidora-default-rtdb.firebaseio.com/";
  if (usuario1.tipo === "grandes") {
    databaseBaseUrl = "https://estoque-distribuidora-grandes-default-rtdb.firebaseio.com/";
  } else if (usuario1.tipo === "especial") {
    databaseBaseUrl = "https://estoque-distribuidora-especial-default-rtdb.firebaseio.com/";
  }

  // 2) Carrega um SKU e atualiza 1 ou vários cards (escopo: root)
  async function carregarProduto(sku, card = null) {
    const url = `${databaseBaseUrl}produtos/${sku}.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Produto não encontrado");
      const dados = await res.json();

      if (!dados) {
        if (card) card.remove();
        return;
      }

      if (card) {
        atualizarCard(card, dados, sku);
      } else {
        // Evita atualizar o mesmo card várias vezes
        const cards = new Set(
          [...root.querySelectorAll(`.produto-card [data-sku="${sku}"]`)]
            .map(el => el.closest('.produto-card'))
            .filter(Boolean)
        );
        cards.forEach(c => atualizarCard(c, dados, sku));
      }
    } catch (erro) {
      console.error(`Erro ao carregar dados do SKU ${sku}:`, erro);
    }
  }

  // 3) Atualiza o conteúdo de um card
  function atualizarCard(card, dados, sku) {
    // Descrição
    card.querySelectorAll(`.descricao[data-sku]`).forEach(el => {
      el.textContent = dados.nome || "(Sem nome)";
    });
    // Marca
    card.querySelectorAll(`.marca[data-sku]`).forEach(el => {
      el.textContent = dados.marca || "(Sem marca)";
    });
    // Imagem
    const urlImagem = (dados.anexos?.[0]?.url) || "img/logo-nav.png";
    card.querySelectorAll(`.produto-card-img img`).forEach(img => {
      img.src = urlImagem;
      img.alt = dados.nome || "Produto";
    });

    // *** ESSA PARTE É FUNDAMENTAL ***
    // Atualiza preço e promocional como atributo do card para o botão do carrinho pegar
    card.dataset.preco = Number(dados.preco || 0);
    card.dataset.promocional = Number(dados.precoPromocional || 0);
    // *** FIM ***

    // Preço/Desconto (exibe visualmente)
    const preco = Number(dados.preco || 0);
    const promocional = Number(dados.precoPromocional || 0);
    card.querySelectorAll(`.produto-card-price`).forEach(container => {
      const divPreco = container.querySelector('.price');
      const divDesconto = container.querySelector('.desconto');
      if (promocional > 0 && promocional < preco) {
        const pct = Math.round(((preco - promocional) / preco) * 100);
        divPreco.innerHTML = `
          <span style="text-decoration: line-through; color: #888; font-size: 12px;">R$ ${preco.toFixed(2)}</span><br>
          <span style="color: #e91e63; font-size: 16px; font-weight: bold;">R$ ${promocional.toFixed(2)}</span>
        `;
        if (divDesconto) divDesconto.innerHTML =
          `<span style="background:#e91e63;color:#fff;font-size:11px;padding:2px 6px;border-radius:6px;">-${pct}% OFF</span>`;
      } else {
        divPreco.innerHTML = `<span style="color:#222;font-size:16px;font-weight:bold;">R$ ${preco.toFixed(2)}</span>`;
        if (divDesconto) divDesconto.innerHTML = "";
      }
    });
    // Quantidade/Estoque
    card.querySelectorAll(`.quantidade`).forEach(container => {
      const btnMenos = container.querySelector('.menos');
      const btnMais  = container.querySelector('.mais');
      const input    = container.querySelector('input');
      const estoque  = parseInt(dados.estoqueAtual || 0, 10);

      container.style.pointerEvents = "";
      if (btnMenos) btnMenos.disabled = false;
      if (btnMais)  btnMais.disabled  = false;
      if (input) {
        input.value = 1;
        input.max = estoque > 0 ? estoque : 1;
        input.disabled = false;
      }
      const btnAdd = card.querySelector('.produto-card-sold button');
      if (btnAdd) btnAdd.disabled = false;

      if (estoque === 0) {
        container.style.pointerEvents = "none";
        if (btnMenos) btnMenos.disabled = true;
        if (btnMais)  btnMais.disabled  = true;
        if (input)    input.disabled    = true;
        if (btnAdd)   btnAdd.disabled   = true;
        card.style.opacity = "0.5";
      } else {
        card.style.opacity = "";
      }

      if (btnMenos && btnMais && input && estoque > 0) {
        btnMenos.onclick = () => { const v = parseInt(input.value || 1, 10); if (v > 1) input.value = v - 1; };
        btnMais.onclick  = () => { const v = parseInt(input.value || 1, 10); if (v < estoque) input.value = v + 1; };
      }
    });
  }

  // 4) Carga inicial (apenas elementos dentro do root)
  const elementosComSku = root.querySelectorAll("[data-sku]");
  const skusUnicos = [...new Set([...elementosComSku].map(el => el.dataset.sku))];
  skusUnicos.forEach(sku => {
    const cards = new Set(
      [...root.querySelectorAll(`.produto-card [data-sku="${sku}"]`)]
        .map(el => el.closest('.produto-card'))
        .filter(Boolean)
    );
    cards.forEach(card => carregarProduto(sku, card));
  });

  // 5) Seleção de variações (delegação no root)
  root.addEventListener('click', (e) => {
    const opcao = e.target.closest('.produto-card .opcoes span[data-sku]');
    if (!opcao) return;
    const card = opcao.closest('.produto-card');
    card.querySelectorAll('.opcoes span[data-sku]').forEach(o => {
      o.style.background = ""; o.style.color = ""; o.style.fontWeight = "";
    });
    opcao.style.background = "#09f";
    opcao.style.color = "#fff";
    opcao.style.fontWeight = "bold";

    const novoSku = opcao.dataset.sku;
    carregarProduto(novoSku, card);
  });

  // 6) Carrinho - deve vir ANTES do return!
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.produto-card-sold button');
    if (!btn) return;

    const card = btn.closest('.produto-card');
    if (!card) return;

    let sku = card.dataset.skuAtual;
    if (!sku) {
      const elSku = card.querySelector('[data-sku]');
      sku = elSku?.dataset?.sku || "";
    }
    if (!sku) return;

    const inputQtd = card.querySelector('.quantidade input');
    const qtd = Math.max(1, parseInt(inputQtd?.value || "1", 10));

    const pBase = Number(card.dataset.preco || 0);
    const pPromo = Number(card.dataset.promocional || 0);
    const precoUsado = (pPromo > 0 && pPromo < pBase) ? pPromo : pBase;

    // Debug: veja o preço no console na hora!
    console.log('Adicionando ao carrinho', { sku, pBase, pPromo, precoUsado });

    // >>>>> Aqui começa o que você adiciona <<<<<<
    let carrinho = JSON.parse(localStorage.getItem('carrinhoProposta_itens')) || [];
    const idx = carrinho.findIndex(item => item.sku === sku);
    if (idx !== -1) {
      carrinho[idx].quantidade += qtd;
      carrinho[idx].preco = precoUsado;
    } else {
      carrinho.push({ sku, quantidade: qtd, preco: precoUsado });
    }
    localStorage.setItem('carrinhoProposta_itens', JSON.stringify(carrinho));
    // >>>>> Aqui termina <<<<<<

    const old = btn.textContent;
    btn.textContent = "Salvo ✓";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = old || "Adicionar ao carrinho";
      btn.disabled = false;
    }, 900);
  });

  // return SEMPRE por último!
  return () => {};
}
