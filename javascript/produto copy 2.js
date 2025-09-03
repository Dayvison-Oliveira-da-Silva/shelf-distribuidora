// main/produtos.js
export function init(root) {
  const usuario = safeJSON(localStorage.getItem("usuario_shelf")) || {};
  let databaseBaseUrl = "https://estoque-distribuidora-default-rtdb.firebaseio.com/";
  if (usuario.tipo === "grandes") {
    databaseBaseUrl = "https://estoque-distribuidora-grandes-default-rtdb.firebaseio.com/";
  } else if (usuario.tipo === "especial") {
    databaseBaseUrl = "https://estoque-distribuidora-especial-default-rtdb.firebaseio.com/";
  }

  const lista = document.getElementById("lista-produtos");
  const tpl = document.getElementById("produto-card-tpl");
  if (!lista || !tpl) return () => {};

  // 1) Compor lista a partir dos SKUs
  const skus = (lista.dataset.skus || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const cache = new Map(); // sku -> dados do produto
  const fragment = document.createDocumentFragment();

  // cria cards vazios a partir do template
  skus.forEach(sku => {
    const card = tpl.content.firstElementChild.cloneNode(true);
    // marcações de sku dentro do card
    card.querySelectorAll("[data-sku]").forEach(el => (el.dataset.sku = sku));
    // estado inicial (skeleton)
    hydrateSkeleton(card);
    fragment.appendChild(card);
  });
  lista.appendChild(fragment);

  // 2) Lazy hydrate: só busca dados quando o card entra na tela
  const io = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const card = entry.target;
        const sku = card.querySelector("[data-sku]")?.dataset?.sku;
        if (!sku) return;
        io.unobserve(card);
        hydrateCard(sku, card);
      });
    },
    { rootMargin: "200px 0px" }
  );

  lista.querySelectorAll(".produto-card").forEach(card => io.observe(card));

  // 3) Delegação de eventos (quantidade e add-to-cart)
  lista.addEventListener("click", e => {
    const menos = e.target.closest(".menos");
    const mais = e.target.closest(".mais");
    const btnAdd = e.target.closest(".btn-add");
    const card = e.target.closest(".produto-card");
    if (!card) return;

    const sku = card.querySelector("[data-sku]")?.dataset?.sku;
    if (!sku) return;
    const inputQtd = card.querySelector(".quantidade input");

    if (menos) {
      const v = parseInt(inputQtd.value || "1", 10);
      if (v > 1) inputQtd.value = v - 1;
      return;
    }
    if (mais) {
      const max = Number(inputQtd.max || "9999");
      const v = parseInt(inputQtd.value || "1", 10);
      inputQtd.value = Math.min(max, v + 1);
      return;
    }
    if (btnAdd) {
      const dados = cache.get(sku);
      if (!dados) return;

      const pBase = Number(dados.preco || 0);
      const pPromo = Number(dados.precoPromocional || 0);
      const precoUsado = pPromo > 0 && pPromo < pBase ? pPromo : pBase;

      const qtd = Math.max(1, parseInt(inputQtd?.value || "1", 10));
      upsertCarrinhoItem(sku, qtd, precoUsado);

      const old = btnAdd.textContent;
      btnAdd.textContent = "Salvo ✓";
      btnAdd.disabled = true;
      setTimeout(() => {
        btnAdd.textContent = old || "Adicionar ao carrinho";
        btnAdd.disabled = false;
      }, 900);
    }
  });

  // ------- helpers -------

  function safeJSON(s) {
    try {
      return JSON.parse(s || "null");
    } catch {
      return null;
    }
  }

  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")     // remove acentos
      .replace(/[^a-z0-9-]+/g, "-")        // separadores -> "-"
      .replace(/-+/g, "-")                 // colapsa múltiplos "-"
      .replace(/^-+|-+$/g, "");            // trim "-"
  }

  // Lê categorias de `obs` (vírgulas) com fallbacks para outros campos
  function categoriasFromDados(dados) {
    const raw =
      dados?.obs ??
      dados?.descricaoCategoria ??
      (Array.isArray(dados?.arvoreCategoria) ? dados.arvoreCategoria[0]?.descricao : "") ??
      "";

    const list = String(raw)
      .split(/[,;|]+/) // aceita vírgula, ponto-e-vírgula ou pipe
      .map(s => s.trim())
      .filter(Boolean);

    // normaliza para slug e remove duplicatas
    const uniq = Array.from(new Set(list.map(slug))).filter(Boolean);
    return uniq; // ex.: ['higiene-limpeza','hospitalar','industria']
  }

  function hydrateSkeleton(card) {
    card.style.opacity = "0.85";
    card.querySelector(".descricao").textContent = "Carregando…";
    card.querySelector(".marca").textContent = "";
    const img = card.querySelector(".produto-card-img img");
    img.src = "img/logo-nav.png";
    img.alt = "Produto";
    const price = card.querySelector(".price");
    price.innerHTML = `<span style="color:#999;font-size:12px;">—</span>`;
    const btn = card.querySelector(".btn-add");
    btn.disabled = true;
    const qInput = card.querySelector(".quantidade input");
    qInput.value = 1;
    qInput.disabled = true;

    // default amistoso até hidratar de verdade
    card.dataset.categorias = "sem-categoria";
    card.classList.add("cat-sem-categoria");
  }

  async function hydrateCard(sku, card) {
    try {
      const dados = await fetchProduto(sku);
      if (!dados) {
        card.remove();
        return;
      }

      // cachear
      cache.set(sku, dados);

      // textos
      const nome = dados.nome || "(Sem nome)";
      const marca = dados.marca || "(Sem marca)";
      card.querySelectorAll(".descricao").forEach(el => (el.textContent = nome));
      card.querySelectorAll(".marca").forEach(el => (el.textContent = marca));

      // imagem
      const urlImagem = dados.anexos?.[0]?.url || "img/logo-nav.png";
      card.querySelectorAll(".produto-card-img img").forEach(img => {
        img.src = urlImagem;
        img.alt = nome;
      });

      // categorias -> data-atributo e classes CSS (com fallback)
      const cats = categoriasFromDados(dados);
      const catsForCard = cats.length ? cats : ["sem-categoria"];

      // limpa possíveis classes anteriores de categoria (apenas as cat-*)
      [...card.classList].forEach(c => {
        if (c.startsWith("cat-")) card.classList.remove(c);
      });

      card.dataset.categorias = catsForCard.join(",");
      catsForCard.forEach(c => card.classList.add("cat-" + c));

      // preço (visual) + datasets para carrinho
      const preco = Number(dados.preco || 0);
      const promo = Number(dados.precoPromocional || 0);
      card.dataset.preco = String(preco);
      card.dataset.promocional = String(promo);

      const priceWrap = card.querySelector(".produto-card-price");
      const divPreco = priceWrap.querySelector(".price");
      const divDesc = priceWrap.querySelector(".desconto");
      if (promo > 0 && promo < preco) {
        const pct = Math.round(((preco - promo) / preco) * 100);
        divPreco.innerHTML = `
          <span style="text-decoration: line-through; color:#888; font-size:12px;">R$ ${preco.toFixed(
            2
          )}</span><br>
          <span style="color:#e91e63; font-size:16px; font-weight:bold;">R$ ${promo.toFixed(2)}</span>
        `;
        divDesc.innerHTML = `<span style="background:#e91e63;color:#fff;font-size:11px;padding:2px 6px;border-radius:6px;">-${pct}% OFF</span>`;
      } else {
        divPreco.innerHTML = `<span style="color:#222;font-size:16px;font-weight:bold;">R$ ${preco.toFixed(
          2
        )}</span>`;
        divDesc.innerHTML = "";
      }

      // estoque/quantidade/botões
      const estoque = parseInt(dados.estoqueAtual || 0, 10);
      const qWrap = card.querySelector(".quantidade");
      const qInput = qWrap.querySelector("input");
      const btnAdd = card.querySelector(".btn-add");

      if (estoque > 0) {
        qInput.value = 1;
        qInput.max = estoque;
        qInput.disabled = false;
        btnAdd.disabled = false;
        card.style.opacity = "";
      } else {
        qInput.disabled = true;
        btnAdd.disabled = true;
        card.style.opacity = "0.5";
      }
    } catch (err) {
      console.error(`Erro ao carregar SKU ${sku}:`, err);
      card.remove();
    }
  }

  async function fetchProduto(sku) {
    // cache in-memory evita chamadas repetidas
    if (cache.has(sku)) return cache.get(sku);
    const url = `${databaseBaseUrl}produtos/${encodeURIComponent(sku)}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json;
  }

  function upsertCarrinhoItem(sku, quantidade, preco) {
    let carrinho = safeJSON(localStorage.getItem("carrinhoProposta_itens")) || [];
    if (!Array.isArray(carrinho)) carrinho = [];
    const idx = carrinho.findIndex(i => i.sku === sku);
    if (idx >= 0) {
      carrinho[idx].quantidade += quantidade;
      carrinho[idx].preco = preco; // mantém preço usado no momento
    } else {
      carrinho.push({ sku, quantidade, preco });
    }
    localStorage.setItem("carrinhoProposta_itens", JSON.stringify(carrinho));
  }

  // teardown
  return () => {
    io.disconnect();
  };
}
