// main/produtos.js
export function init(root) {
  // --------- base Firebase por tipo de usuário ----------
  const usuario = safeJSON(localStorage.getItem("usuario_shelf")) || {};
  let databaseBaseUrl = "https://estoque-distribuidora-default-rtdb.firebaseio.com/";
  if (usuario.tipo === "grandes") {
    databaseBaseUrl = "https://estoque-distribuidora-grandes-default-rtdb.firebaseio.com/";
  } else if (usuario.tipo === "especial") {
    databaseBaseUrl = "https://estoque-distribuidora-especial-default-rtdb.firebaseio.com/";
  }

  // --------- refs de DOM ----------
  const lista = document.getElementById("lista-produtos");
  const tpl = document.getElementById("produto-card-tpl");
  if (!lista || !tpl) return () => {};

  // SKUs opcionais (para ordenar / limitar). Se vazio => renderiza todos do banco
  const skus = (lista.dataset.skus || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  // cache dos dados carregados (sku -> produto)
  const cache = new Map();

  // esqueleto enquanto carrega o banco
  lista.innerHTML = "";
  const skeletonFrag = document.createDocumentFragment();
  const skeletonCount = Math.min(skus.length || 12, 24);
  for (let i = 0; i < skeletonCount; i++) {
    const c = tpl.content.firstElementChild.cloneNode(true);
    hydrateSkeleton(c);
    skeletonFrag.appendChild(c);
  }
  lista.appendChild(skeletonFrag);

  // --------- carrega TUDO de uma vez ----------
  (async () => {
    try {
      const all = await fetchAllProdutos(); // { sku: dados, ... } | null
      const entries = Object.entries(all || {});

      // Filtra/ordena conforme data-skus, se existir; senão, usa todos ordenados por nome
      let toRender = [];
      if (skus.length) {
        for (const sku of skus) {
          const hit = entries.find(([k]) => String(k) === sku);
          if (hit) toRender.push(hit);
        }
      } else {
        toRender = entries.sort(([, a], [, b]) => {
          const na = (a?.nome || "").toLowerCase();
          const nb = (b?.nome || "").toLowerCase();
          return na.localeCompare(nb, "pt-BR");
        });
      }

      // Limpa skeleton e renderiza em lotes para não travar a UI
      lista.innerHTML = "";
      renderInBatches(toRender, 48, (sku, dados) => {
        cache.set(sku, dados);
        const card = tpl.content.firstElementChild.cloneNode(true);
        // marcações de sku dentro do card
        card.querySelectorAll("[data-sku]").forEach(el => (el.dataset.sku = sku));
        // hidrata com dados reais
        hydrateCardFromDados(sku, card, dados);
        return card;
      });
    } catch (err) {
      console.error("[produtos] erro ao carregar base:", err);
      lista.innerHTML = `<li style="padding:14px;color:#777;">Falha ao carregar produtos.</li>`;
    }
  })();

  // --------- delegação de eventos (quantidade / add-to-cart) ----------
  lista.addEventListener("click", (e) => {
    const menos = e.target.closest(".menos");
    const mais  = e.target.closest(".mais");
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

      const pBase  = num(dados.preco);
      const pPromo = num(dados.precoPromocional);
      const precoUsado = (pPromo > 0 && pPromo < pBase) ? pPromo : pBase;

      const qtd = Math.max(1, parseInt(inputQtd?.value || "1", 10));
      // >>> agora passamos os dados para salvar snapshot no carrinho
      upsertCarrinhoItem(sku, qtd, precoUsado, dados);

      const old = btnAdd.textContent;
      btnAdd.textContent = "Salvo ✓";
      btnAdd.disabled = true;
      setTimeout(() => {
        btnAdd.textContent = old || "Adicionar ao carrinho";
        btnAdd.disabled = false;
      }, 900);
    }
  });

  // =================== helpers ===================

  function safeJSON(s) { try { return JSON.parse(s || "null"); } catch { return null; } }
  const num = (v) => Number(v || 0);

  function slug(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  // categorias: usa obs com vírgulas; fallbacks para descricaoCategoria / arvoreCategoria[0].descricao
  function categoriasFromDados(dados) {
    const raw =
      dados?.obs ??
      dados?.descricaoCategoria ??
      (Array.isArray(dados?.arvoreCategoria) ? dados.arvoreCategoria[0]?.descricao : "") ??
      "";

    const list = String(raw)
      .split(/[,;|]+/)
      .map(s => s.trim())
      .filter(Boolean);

    return Array.from(new Set(list.map(slug))).filter(Boolean);
  }

  // Esqueleto enquanto carrega o DB
  function hydrateSkeleton(card) {
    card.style.opacity = "0.85";
    card.querySelector(".descricao").textContent = "Carregando…";
    const marcaEl = card.querySelector(".marca");
    if (marcaEl) { marcaEl.textContent = ""; marcaEl.style.display = "none"; }
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
    card.dataset.categorias = "sem-categoria";
    card.classList.add("cat-sem-categoria");
  }

  // Hidrata um card com dados já carregados do DB
  function hydrateCardFromDados(sku, card, dados) {
    // textos
    const nome = dados.nome || "(Sem nome)";
    const marcaStr = (dados.marca && String(dados.marca).trim()) ? String(dados.marca).trim() : "";
    card.querySelectorAll(".descricao").forEach(el => (el.textContent = nome));
    card.querySelectorAll(".marca").forEach(el => {
      el.textContent = marcaStr;
      el.style.display = marcaStr ? "" : "none";
    });

    // imagem
    const urlImagem = (dados.anexos?.[0]?.url) || "img/logo-nav.png";
    card.querySelectorAll(".produto-card-img img").forEach(img => {
      img.src = urlImagem;
      img.alt = nome;
      // "loading=lazy" já está no template
    });

    // categorias -> data-atributo e classes CSS (com fallback)
    const cats = categoriasFromDados(dados);
    const catsForCard = cats.length ? cats : ["sem-categoria"];
    // limpa classes cat- antigas (se veio de skeleton)
    [...card.classList].forEach(c => { if (c.startsWith("cat-")) card.classList.remove(c); });
    card.dataset.categorias = catsForCard.join(",");
    catsForCard.forEach(c => card.classList.add("cat-" + c));

    // preço (visual) + datasets para carrinho
    const preco = num(dados.preco);
    const promo = num(dados.precoPromocional);
    card.dataset.preco = String(preco);
    card.dataset.promocional = String(promo);

    const priceWrap = card.querySelector(".produto-card-price");
    const divPreco = priceWrap.querySelector(".price");
    const divDesc  = priceWrap.querySelector(".desconto");
    if (promo > 0 && promo < preco) {
      const pct = Math.round(((preco - promo) / preco) * 100);
      divPreco.innerHTML = `
        <span style="text-decoration: line-through; color:#888; font-size:12px;">R$ ${preco.toFixed(2)}</span><br>
        <span style="color:#e91e63; font-size:16px; font-weight:bold;">R$ ${promo.toFixed(2)}</span>
      `;
      divDesc.innerHTML = `<span style="background:#e91e63;color:#fff;font-size:11px;padding:2px 6px;border-radius:6px;">-${pct}% OFF</span>`;
    } else {
      divPreco.innerHTML = `<span style="color:#222;font-size:16px;font-weight:bold;">R$ ${preco.toFixed(2)}</span>`;
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
  }

  // Renderização em lotes para evitar travar a página
  function renderInBatches(entries, batchSize, makeCard) {
    let i = 0;
    const total = entries.length;

    function nextBatch() {
      const frag = document.createDocumentFragment();
      for (let count = 0; count < batchSize && i < total; count++, i++) {
        const [sku, dados] = entries[i];
        const card = makeCard(String(sku), dados || {});
        frag.appendChild(card);
      }
      lista.appendChild(frag);
      if (i < total) {
        requestIdleCallback ? requestIdleCallback(nextBatch) : setTimeout(nextBatch, 0);
      }
    }
    nextBatch();
  }

  // Busca TODO o nó /produtos
  async function fetchAllProdutos() {
    const url = `${databaseBaseUrl}produtos.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json(); // objeto (sku -> produto)
  }

  // Atualiza/insere item no carrinho COM snapshot de produto
  function upsertCarrinhoItem(sku, quantidade, preco, dados) {
    let carrinho = safeJSON(localStorage.getItem("carrinhoProposta_itens")) || [];
    if (!Array.isArray(carrinho)) carrinho = [];

    // normalizações seguras
    const norm = (s) => (s && String(s).trim() ? String(s).trim() : null);
    const nome = norm(dados?.nome);
    const marca = norm(dados?.marca);
    const imagemUrl = norm(dados?.anexos?.[0]?.url);

    const idx = carrinho.findIndex(i => i.sku === sku);
    if (idx >= 0) {
      // acumula qtd e atualiza snapshot
      carrinho[idx].quantidade += quantidade;
      carrinho[idx].preco = preco; // mantém o preço do momento de adição
      carrinho[idx].nome = nome ?? carrinho[idx].nome ?? null;
      carrinho[idx].marca = marca ?? carrinho[idx].marca ?? null;
      carrinho[idx].imagemUrl = imagemUrl ?? carrinho[idx].imagemUrl ?? null;
    } else {
      carrinho.push({ sku, quantidade, preco, nome, marca, imagemUrl });
    }

    localStorage.setItem("carrinhoProposta_itens", JSON.stringify(carrinho));
  }

  // teardown
  return () => {};
}
