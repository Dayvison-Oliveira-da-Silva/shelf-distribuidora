      (function () {
        // Lê o vendedor do localStorage em possíveis formatos
        function getVendedorFromLS() {
          try {
            const raw = localStorage.getItem("usuario_shelf");
            if (!raw) return null;
            const data = JSON.parse(raw);

            // formato direto: { id, tipo, usuario, ... }
            if (data && typeof data === "object" && ("id" in data || "tipo" in data || "usuario" in data)) {
              return { id: String(data.id ?? ""), tipo: String(data.tipo ?? "").toLowerCase(), nome: data.usuario ?? "" };
            }
            // formato agrupado por chave (ex.: CPF na raiz)
            const keys = Object.keys(data || {});
            if (keys.length) {
              const k = keys[0];
              const v = data[k] || {};
              return { id: String(v.id ?? ""), tipo: String(v.tipo ?? "").toLowerCase(), nome: v.usuario ?? "" };
            }
          } catch (e) { }
          return null;
        }

        // Regras
        const regras = {
          // por TIPO
          tipo: {
            varejo: {
              chip: "Varejo",
              itens: [
                "Fazer 30 coberturas de clientes já cadastrados (pedido mínimo R$ 200) → +R$ 300",
                "Cadastro de 20 novos clientes com venda gerada (pedido mínimo R$ 200) → +R$ 400",
                "Alcançar a meta de R$ 25.000,00 → +R$ 400",
                "Vender R$ 4.000 em SKUs prioritários → +R$ 300"
              ],
              total: "Totalizando R$ 1.400 em bonificações"
            },
            grandes: {
              chip: "Grandes Contas",
              itens: [
                "Cadastro de 10 novos clientes com venda gerada (pedido mínimo R$300) → +R$ 200",
                "Alcançar a meta de R$55.000,00 → +R$ 500",
                "Cadastro de nova rede com CNPJ Matriz + filiais → +R$ 500",
                "Vender R$ 4.000 em SKUs prioritários → +R$ 200"
              ],
              total: "Totalizando R$ 1.400 em bonificações"
            }
          },
          // por ID (sobrepõe o tipo)
          id: {
            "825720218": {
              chip: "ID: 825720218",
              itens: [
                "Cadastro de 10 novos clientes com venda gerada (pedido mínimo R$200) → +R$ 200",
                "Alcançar a meta de R$70.000,00 → +R$ 500",
                "Positivação para nova rede (Revenda) → +R$ 500",
                "Vender R$ 10.000 em SKUs prioritários → +R$ 200"
              ],
              total: "Totalizando R$ 1.400 em bonificações"
            },
            "821382109": {
              chip: "ID: 821382109",
              itens: [
                "Cadastro de 10 novos clientes com venda gerada (pedido mínimo R$200) → +R$ 200",
                "Alcançar a meta de R$120.000,00 → +R$ 500",
                "Positivação para nova rede (Revenda) → +R$ 500",
                "Vender R$ 10.000 em SKUs prioritários → +R$ 200"
              ],
              total: "Totalizando R$ 1.400 em bonificações"
            }
          }
        };

        // Monta o aviso
        function renderBonus() {
          const box = document.getElementById("aviso-bonus");
          if (!box) return;

          const vend = getVendedorFromLS();
          if (!vend) { box.style.display = "none"; return; }

          const regra = (vend.id && regras.id[vend.id])
            || (vend.tipo && regras.tipo[vend.tipo])
            || null;

          if (!regra) { box.style.display = "none"; return; }

          // Preenche UI
          const ul = box.querySelector("#bonus-list");
          const chip = box.querySelector("#bonus-chip");
          const total = box.querySelector("#bonus-total");

          chip.textContent = regra.chip;
          ul.innerHTML = regra.itens.map(txt => `<li>${txt}</li>`).join("");
          total.textContent = regra.total;
        }

        renderBonus();

      })();


