/**
 * app.js - Lógica Principal do App
 * Casas Goianita - Sistema de Comodato e Consignação
 */

document.addEventListener('DOMContentLoaded', () => {
    // Configura o Usuário Logado Mock
    initUserSession();

    // Roteador Básico baseado em ID da página ou URL hash
    renderActivePage();

    // Eventos Globais
    window.addEventListener('hashchange', renderActivePage);
});

function initUserSession() {
    const role = sessionStorage.getItem('goianita_role') || 'admin';
    const user = {
        name: role === 'admin' ? "Cleber" : "Cliente Fornecedor",
        role: role === 'admin' ? "Administrador Goianita" : "Acesso Cliente",
        avatar: role === 'admin' ? "CL" : "CF"
    };
    
    // Se for tipo 'user' e estiver tentando acessar páginas de admin, barra e redireciona
    const path = window.location.pathname;
    const pageName = path.split('/').pop() || 'index.html';
    
    if (role === 'user' && (pageName === 'dashboard.html' || pageName === 'clientes.html' || pageName === 'produtos.html' || pageName === 'produto-novo.html' || pageName === 'financeiro.html')) {
        const clienteId = sessionStorage.getItem('goianita_cliente_id');
        window.location.href = path.includes('/pages/') ? 'cliente-detalhe.html?id=' + clienteId : 'pages/cliente-detalhe.html?id=' + clienteId;
        return;
    }
    
    // Atualiza badges se existirem na tela
    const nameEl = document.querySelector('.user-name');
    const roleEl = document.querySelector('.user-role');
    const avatarEl = document.querySelector('.user-avatar');
    
    if (nameEl) nameEl.textContent = user.name;
    if (roleEl) roleEl.textContent = user.role;
    if (avatarEl) avatarEl.textContent = user.avatar;

    // Configura botão Sair
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            sessionStorage.clear();
            const currentPath = window.location.pathname;
            window.location.href = currentPath.includes('/pages/') ? '../index.html' : 'index.html';
        });
    }
}

// Roteamento Simples Baseado em Hash ou detecção do nome do arquivo
function renderActivePage() {
    const path = window.location.pathname;
    const pageName = path.split('/').pop() || 'index.html';
    
    if (pageName === 'dashboard.html') {
        renderDashboard();
    } else if (pageName === 'clientes.html') {
        renderClientesList();
    } else if (pageName === 'cliente-detalhe.html') {
        renderClienteDetalhe();
    } else if (pageName === 'produtos.html') {
        renderProdutosList();
    } else if (pageName === 'produto-novo.html') {
        renderProdutoNovo();
    } else if (pageName === 'produto-detalhe.html') {
        renderProdutoDetalhe();
    } else if (pageName === 'financeiro.html') {
        renderFinanceiro();
    }
}

// --- UTILS FORMATADORES ---
function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function getStatusBadge(status) {
    let badgeClass = 'badge-triagem';
    switch (status) {
        case 'Em Triagem': badgeClass = 'badge-triagem'; break;
        case 'À Venda': badgeClass = 'badge-venda'; break;
        case 'Vendido': badgeClass = 'badge-vendido'; break;
        case 'Pago': badgeClass = 'badge-pago'; break;
        case 'Devolução Solicitada': badgeClass = 'badge-devolucao'; break;
        case 'Devolvido': badgeClass = 'badge-devolvido'; break;
    }
    return `<span class="badge ${badgeClass}">${status}</span>`;
}

// --- DASHBOARD ---
function renderDashboard() {
    if (!window.GoianitaDB) return;
    const resumo = window.GoianitaDB.utils.getResumoGeral();
    
    const cardsContainer = document.getElementById('dashboard-cards');
    if (cardsContainer) {
        cardsContainer.innerHTML = `
            <div class="kpi-card">
                <div class="kpi-title">Estoque Consignado</div>
                <div class="kpi-value">${formatCurrency(resumo.totalEstoqueValor)}</div>
                <div class="kpi-desc">Valor total à venda na loja</div>
            </div>
            <div class="kpi-card" style="border-left: 4px solid var(--accent-gold);">
                <div class="kpi-title">Vendas Totais</div>
                <div class="kpi-value">${formatCurrency(resumo.totalVendas)}</div>
                <div class="kpi-desc">Bruto acumulado de vendas</div>
            </div>
            <div class="kpi-card">
                <div class="kpi-title">Comissões Goianita</div>
                <div class="kpi-value">${formatCurrency(resumo.totalComissaoGoianita)}</div>
                <div class="kpi-desc">Receita líquida da loja</div>
            </div>
            <div class="kpi-card" style="border-left: 4px solid var(--status-devolucao);">
                <div class="kpi-title">Saldo a Pagar</div>
                <div class="kpi-value">${formatCurrency(resumo.saldoPagarFornecedores)}</div>
                <div class="kpi-desc">Pendente aos fornecedores</div>
            </div>
        `;
    }

    // Renderizar tabela de produtos recentes
    const recentesTable = document.getElementById('recentes-table-body');
    if (recentesTable) {
        const produtos = window.GoianitaDB.produtos.getAll()
            .sort((a,b) => new Date(b.dataEntrada) - new Date(a.dataEntrada))
            .slice(0, 5);
            
        recentesTable.innerHTML = produtos.map(p => {
            const cliente = window.GoianitaDB.clientes.getById(p.clienteId) || { nome: 'Desconhecido' };
            return `
                <tr>
                    <td><strong>${p.sku}</strong></td>
                    <td>${p.nome}</td>
                    <td>${cliente.nome}</td>
                    <td>${formatCurrency(p.precoVenda)}</td>
                    <td>${getStatusBadge(p.status)}</td>
                    <td><a href="pages/produto-detalhe.html?id=${p.id}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Ver</a></td>
                </tr>
            `;
        }).join('');
    }
}

// --- CLIENTES LISTAGEM E CADASTRO ---
function renderClientesList() {
    const tableBody = document.getElementById('clientes-table-body');
    if (!tableBody) return;
    
    const clientes = window.GoianitaDB.clientes.getAll();
    
    function drawTable(list) {
        tableBody.innerHTML = list.map(c => {
            const financeiro = window.GoianitaDB.utils.calcularValoresCliente(c.id);
            return `
                <tr>
                    <td><strong>${c.nome}</strong></td>
                    <td>${c.cpf}</td>
                    <td>${c.telefone}</td>
                    <td>${financeiro.produtosTotais} produtos</td>
                    <td><strong style="color: var(--accent-gold);">${formatCurrency(financeiro.saldoPendente)}</strong></td>
                    <td>
                        <a href="cliente-detalhe.html?id=${c.id}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Visualizar</a>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    drawTable(clientes);
    
    // Filtro de Busca
    const searchInput = document.getElementById('search-clientes');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            const filtered = clientes.filter(c => 
                c.nome.toLowerCase().includes(val) || 
                c.cpf.includes(val) || 
                c.email.toLowerCase().includes(val)
            );
            drawTable(filtered);
        });
    }

    // Formulário de novo cliente (se estiver na mesma página em modal, ou capturando submit da página de cadastro)
    const form = document.getElementById('cliente-form');
    if (form) {
        // Autofill da chave Pix ao mudar o tipo
        const selectPixType = document.getElementById('cli-pix-type');
        if (selectPixType) {
            selectPixType.addEventListener('change', () => {
                const type = selectPixType.value;
                const cpfVal = document.getElementById('cli-cpf').value.trim();
                const telVal = document.getElementById('cli-tel').value.trim();
                const emailVal = document.getElementById('cli-email').value.trim();
                const pixField = document.getElementById('cli-pix');
                
                if (type === 'CPF') pixField.value = cpfVal;
                else if (type === 'Celular') pixField.value = telVal;
                else if (type === 'Email') pixField.value = emailVal;
            });
        }

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const novoCliente = {
                nome: document.getElementById('cli-nome').value,
                cpf: document.getElementById('cli-cpf').value,
                telefone: document.getElementById('cli-tel').value,
                email: document.getElementById('cli-email').value,
                chavePixType: document.getElementById('cli-pix-type').value,
                chavePix: document.getElementById('cli-pix').value,
                comissaoPadrao: parseFloat(document.getElementById('cli-comissao').value) || 20,
                senha: document.getElementById('cli-senha').value || 'goianita123'
            };
            
            // Exibir loading ou desativar botão
            const btnSubmit = form.querySelector('button[type="submit"]');
            const originalText = btnSubmit.textContent;
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Gravando...';

            window.GoianitaDB.clientes.save(novoCliente).then(() => {
                alert('Cliente cadastrado com sucesso!');
                window.location.href = 'clientes.html';
            }).catch(err => {
                alert('Erro ao cadastrar cliente: ' + err.message);
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalText;
            });
        });
    }
}

// --- DETALHE DO CLIENTE ---
function renderClienteDetalhe() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (!id) return;
    
    const cliente = window.GoianitaDB.clientes.getById(id);
    if (!cliente) return;

    const role = sessionStorage.getItem('goianita_role') || 'admin';
    
    // Se for perfil 'user', oculta sidebar de admin e botões de PIX manual
    if (role === 'user') {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) sidebar.style.display = 'none';
        
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.style.marginLeft = '0';
            mainContent.style.width = '100%';
        }
        
        const btnPagar = document.getElementById('btn-pagar-cliente');
        if (btnPagar) btnPagar.style.display = 'none';

        // Oculta botão Voltar à Lista
        const backBtn = document.querySelector('.page-header a');
        if (backBtn) {
            backBtn.innerHTML = '<i class="fa-solid fa-right-from-bracket"></i> Sair';
            backBtn.href = '../index.html';
            backBtn.addEventListener('click', () => {
                sessionStorage.clear();
            });
        }
    }
    
    // Preenche dados do Perfil
    document.getElementById('cli-detalhe-nome').textContent = cliente.nome;
    document.getElementById('cli-detalhe-cpf').textContent = cliente.cpf;
    document.getElementById('cli-detalhe-tel').textContent = cliente.telefone;
    document.getElementById('cli-detalhe-email').textContent = cliente.email;
    document.getElementById('cli-detalhe-pix').textContent = `${cliente.chavePixType}: ${cliente.chavePix}`;
    document.getElementById('cli-detalhe-comissao').textContent = `${cliente.comissaoPadrao}%`;
    document.getElementById('cli-detalhe-cadastro').textContent = formatDate(cliente.dataCadastro);
    
    // Atualiza valores financeiros do painel
    const financeiro = window.GoianitaDB.utils.calcularValoresCliente(id);
    document.getElementById('cli-saldo-pendente').textContent = formatCurrency(financeiro.saldoPendente);
    document.getElementById('cli-total-vendas').textContent = formatCurrency(financeiro.totalApostado);
    document.getElementById('cli-total-pago').textContent = formatCurrency(financeiro.totalPago);

    // Habilita ou desabilita botão de pagamento se não tiver saldo
    const btnPagar = document.getElementById('btn-pagar-cliente');
    if (btnPagar && role === 'admin') {
        btnPagar.disabled = financeiro.saldoPendente <= 0;
        btnPagar.addEventListener('click', () => {
            const valorPagar = prompt(`Confirmar pagamento via PIX para este cliente?\nValor Pendente: ${formatCurrency(financeiro.saldoPendente)}\n\nDigite o valor para transferir:`, financeiro.saldoPendente.toFixed(2));
            if (valorPagar) {
                const valor = parseFloat(valorPagar);
                if (valor > 0 && valor <= financeiro.saldoPendente) {
                    const comp = prompt("Insira o código de autenticação do PIX / comprovante da transação bancária:");
                    if (comp) {
                        btnPagar.disabled = true;
                        window.GoianitaDB.pagamentos.save({
                            clienteId: id,
                            valor: valor,
                            chavePix: cliente.chavePix,
                            comprovante: comp
                        }).then(() => {
                            alert("Pagamento registrado com sucesso!");
                            window.location.reload();
                        }).catch(err => {
                            alert("Erro ao registrar pagamento: " + err.message);
                            btnPagar.disabled = false;
                        });
                    }
                } else {
                    alert("Valor inválido ou maior que o saldo pendente.");
                }
            }
        });
    }
    
    // Listar produtos do cliente
    const prodTable = document.getElementById('cli-produtos-table');
    if (prodTable) {
        const produtos = window.GoianitaDB.produtos.getByCliente(id);
        prodTable.innerHTML = produtos.map(p => {
            const valorCliente = p.precoVenda - (p.precoVenda * p.comissao / 100);
            return `
                <tr>
                    <td><strong>${p.sku}</strong></td>
                    <td>${p.nome}</td>
                    <td>${formatCurrency(p.precoVenda)}</td>
                    <td>${p.comissao}%</td>
                    <td>${formatCurrency(valorCliente)}</td>
                    <td>${getStatusBadge(p.status)}</td>
                    <td>
                        ${role === 'admin' 
                            ? `<a href="produto-detalhe.html?id=${p.id}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Gerenciar</a>` 
                            : `<span style="font-size: 13px; color: var(--text-muted);">Apenas leitura</span>`
                        }
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Listar extrato de pagamentos
    const pagTable = document.getElementById('cli-pagamentos-table');
    if (pagTable) {
        const pagamentos = window.GoianitaDB.pagamentos.getByCliente(id);
        if (pagamentos.length === 0) {
            pagTable.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">Nenhum pagamento realizado.</td></tr>`;
        } else {
            pagTable.innerHTML = pagamentos.map(p => `
                <tr>
                    <td>${formatDate(p.data)}</td>
                    <td><strong style="color: var(--status-pago);">${formatCurrency(p.valor)}</strong></td>
                    <td>${p.chavePix}</td>
                    <td><code style="background-color: var(--bg-secondary); padding: 4px 8px; border-radius: 4px; font-size: 12px;">${p.comprovante}</code></td>
                </tr>
            `).join('');
        }
    }
}

// --- PRODUTOS LISTAGEM ---
function renderProdutosList() {
    const tableBody = document.getElementById('produtos-table-body');
    if (!tableBody) return;
    
    const produtos = window.GoianitaDB.produtos.getAll();
    
    function drawTable(list) {
        tableBody.innerHTML = list.map(p => {
            const cliente = window.GoianitaDB.clientes.getById(p.clienteId) || { nome: 'Desconhecido' };
            const valorCliente = p.precoVenda - (p.precoVenda * p.comissao / 100);
            return `
                <tr>
                    <td><strong>${p.sku}</strong></td>
                    <td>${p.nome}</td>
                    <td>${cliente.nome}</td>
                    <td>${formatCurrency(p.precoVenda)}</td>
                    <td>${p.comissao}%</td>
                    <td><strong>${formatCurrency(valorCliente)}</strong></td>
                    <td>${getStatusBadge(p.status)}</td>
                    <td>
                        <a href="produto-detalhe.html?id=${p.id}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Gerenciar</a>
                    </td>
                </tr>
            `;
        }).join('');
    }
    
    drawTable(produtos);
    
    // Busca e Filtros
    const searchInput = document.getElementById('search-produtos');
    const filterStatus = document.getElementById('filter-status');
    const filterCategoria = document.getElementById('filter-categoria');
    
    function applyFilters() {
        let list = produtos;
        if (searchInput && searchInput.value) {
            const val = searchInput.value.toLowerCase();
            list = list.filter(p => p.nome.toLowerCase().includes(val) || p.sku.toLowerCase().includes(val));
        }
        if (filterStatus && filterStatus.value) {
            list = list.filter(p => p.status === filterStatus.value);
        }
        if (filterCategoria && filterCategoria.value) {
            list = list.filter(p => p.categoria === filterCategoria.value);
        }
        drawTable(list);
    }
    
    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (filterStatus) filterStatus.addEventListener('change', applyFilters);
    if (filterCategoria) filterCategoria.addEventListener('change', applyFilters);
}

// --- NOVO PRODUTO ---
function renderProdutoNovo() {
    const selectCliente = document.getElementById('prod-cliente');
    if (!selectCliente) return;
    
    // Popula dropdown de clientes
    const clientes = window.GoianitaDB.clientes.getAll();
    selectCliente.innerHTML = `<option value="">Selecione o Fornecedor...</option>` + 
        clientes.map(c => `<option value="${c.id}" data-comissao="${c.comissaoPadrao}">${c.nome} (${c.cpf})</option>`).join('');
        
    // Ao selecionar cliente, atualiza a comissão automaticamente
    selectCliente.addEventListener('change', () => {
        const opt = selectCliente.selectedOptions[0];
        const comissao = opt.getAttribute('data-comissao');
        if (comissao) {
            document.getElementById('prod-comissao').value = comissao;
        }
    });

    // Submete
    const form = document.getElementById('produto-form');
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const precoVenda = parseFloat(document.getElementById('prod-preco').value);
            const comissao = parseFloat(document.getElementById('prod-comissao').value) || 20;
            
            const novoProduto = {
                nome: document.getElementById('prod-nome').value,
                descricao: document.getElementById('prod-desc').value,
                categoria: document.getElementById('prod-cat').value,
                subcategoria: document.getElementById('prod-subcat').value,
                marca: document.getElementById('prod-marca').value,
                ean: document.getElementById('prod-ean').value,
                conservacao: document.getElementById('prod-conservacao').value,
                peso: parseFloat(document.getElementById('prod-peso').value) || 0,
                altura: parseFloat(document.getElementById('prod-alt').value) || 0,
                largura: parseFloat(document.getElementById('prod-larg').value) || 0,
                comprimento: parseFloat(document.getElementById('prod-comp').value) || 0,
                precoSugerido: parseFloat(document.getElementById('prod-preco-sug').value) || 0,
                precoVenda: precoVenda,
                comissao: comissao,
                clienteId: selectCliente.value,
                status: document.getElementById('prod-status').value,
                obsInternas: document.getElementById('prod-obs').value
            };
            
            // Exibir loading ou desativar botão
            const btnSubmit = form.querySelector('button[type="submit"]');
            const originalText = btnSubmit.textContent;
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Gravando...';

            window.GoianitaDB.produtos.save(novoProduto).then(() => {
                alert('Produto cadastrado com sucesso!');
                window.location.href = 'produtos.html';
            }).catch(err => {
                alert('Erro ao cadastrar produto: ' + err.message);
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalText;
            });
        });
    }

    // API IA Precificação Inteligente (Simulada por busca no Google Shopping local)
    const btnPesquisar = document.getElementById('btn-ia-precificacao');
    if (btnPesquisar) {
        btnPesquisar.addEventListener('click', () => {
            const nome = document.getElementById('prod-nome').value;
            if (!nome) {
                alert("Por favor, digite o nome do produto primeiro.");
                return;
            }
            btnPesquisar.textContent = "Analisando mercado...";
            btnPesquisar.disabled = true;
            
            setTimeout(() => {
                const precoSugeridoMercado = Math.floor(Math.random() * (400 - 150) + 150);
                document.getElementById('prod-preco-sug').value = (precoSugeridoMercado * 1.2).toFixed(2);
                document.getElementById('prod-preco').value = precoSugeridoMercado.toFixed(2);
                alert(`Sugestão de precificação gerada!\nMédia de mercado encontrada para produtos similares: R$ ${precoSugeridoMercado.toFixed(2)}`);
                btnPesquisar.textContent = "Precificar com IA";
                btnPesquisar.disabled = false;
            }, 1000);
        });
    }
}

// --- DETALHE E FLUXO DE STATUS DO PRODUTO ---
function renderProdutoDetalhe() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (!id) return;
    
    const produto = window.GoianitaDB.produtos.getById(id);
    if (!produto) return;
    
    const cliente = window.GoianitaDB.clientes.getById(produto.clienteId) || { nome: 'Desconhecido' };
    const valorCliente = produto.precoVenda - (produto.precoVenda * produto.comissao / 100);

    // Preenche dados da tela
    document.getElementById('prod-detalhe-sku').textContent = produto.sku;
    document.getElementById('prod-detalhe-nome').textContent = produto.nome;
    document.getElementById('prod-detalhe-desc').textContent = produto.descricao || 'Sem descrição';
    document.getElementById('prod-detalhe-cliente').innerHTML = `<a href="cliente-detalhe.html?id=${cliente.id}">${cliente.nome}</a>`;
    document.getElementById('prod-detalhe-conservacao').textContent = produto.conservacao;
    document.getElementById('prod-detalhe-dimensoes').textContent = `${produto.altura}x${produto.largura}x${produto.comprimento} cm | ${produto.peso} kg`;
    document.getElementById('prod-detalhe-preco-venda').textContent = formatCurrency(produto.precoVenda);
    document.getElementById('prod-detalhe-valor-cliente').textContent = formatCurrency(valorCliente);
    document.getElementById('prod-detalhe-comissao').textContent = `${produto.comissao}%`;
    document.getElementById('prod-detalhe-status').innerHTML = getStatusBadge(produto.status);
    document.getElementById('prod-detalhe-entrada').textContent = formatDate(produto.dataEntrada);
    document.getElementById('prod-detalhe-limite').textContent = formatDate(produto.dataLimite);
    
    // Seletor de status rápido
    const statusSelect = document.getElementById('update-status-select');
    if (statusSelect) {
        statusSelect.value = produto.status;
        statusSelect.addEventListener('change', () => {
            const novoStatus = statusSelect.value;
            const obs = prompt("Deseja adicionar alguma observação sobre esta alteração de status?", `Mapeamento para o status: ${novoStatus}`);
            
            produto.status = novoStatus;
            produto.statusObs = obs || 'Atualização de status';
            statusSelect.disabled = true;
            window.GoianitaDB.produtos.save(produto).then(() => {
                alert("Status atualizado!");
                window.location.reload();
            }).catch(err => {
                alert("Erro ao atualizar status: " + err.message);
                statusSelect.disabled = false;
            });
        });
    }

    // Histórico / Timeline
    const timeline = document.getElementById('prod-timeline');
    if (timeline) {
        const hist = (produto.statusHistorico || []).slice().reverse();
        timeline.innerHTML = hist.map((h, i) => `
            <div class="timeline-item ${i === 0 ? 'active' : ''}">
                <div class="timeline-marker"></div>
                <div class="timeline-content">
                    <span class="status">${h.status}</span>
                    <span class="date">${formatDate(h.data)}</span>
                    <p class="note">${h.obs || ''}</p>
                </div>
            </div>
        `).join('');
    }
}

// --- FINANCEIRO GERAL ---
function renderFinanceiro() {
    if (!window.GoianitaDB) return;
    const resumo = window.GoianitaDB.utils.getResumoGeral();
    
    // Atualizar valores do topo
    document.getElementById('fin-total-vendas').textContent = formatCurrency(resumo.totalVendas);
    document.getElementById('fin-total-comissao').textContent = formatCurrency(resumo.totalComissaoGoianita);
    document.getElementById('fin-total-pago').textContent = formatCurrency(resumo.totalPagoFornecedores);
    document.getElementById('fin-total-pendente').textContent = formatCurrency(resumo.saldoPagarFornecedores);

    // Listar balanço de fornecedores
    const tableBody = document.getElementById('fin-fornecedores-table');
    if (tableBody) {
        const clientes = window.GoianitaDB.clientes.getAll();
        tableBody.innerHTML = clientes.map(c => {
            const fin = window.GoianitaDB.utils.calcularValoresCliente(c.id);
            return `
                <tr>
                    <td><strong>${c.nome}</strong></td>
                    <td>${c.chavePixType}: <code>${c.chavePix}</code></td>
                    <td>${formatCurrency(fin.totalApostado)}</td>
                    <td>${formatCurrency(fin.totalPago)}</td>
                    <td><strong style="color: ${fin.saldoPendente > 0 ? 'var(--status-vendido)' : 'var(--status-venda)'};">${formatCurrency(fin.saldoPendente)}</strong></td>
                    <td>
                        <a href="cliente-detalhe.html?id=${c.id}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Visualizar Extrato</a>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Ações de backup/exportação
    const btnZerar = document.getElementById('btn-zerar-dados');
    if (btnZerar) {
        btnZerar.addEventListener('click', () => {
            if (confirm("ATENÇÃO: Isso irá apagar permanentemente todos os clientes, produtos e pagamentos do seu navegador local.\n\nDeseja realmente continuar e zerar o banco de dados?")) {
                localStorage.setItem('goianita_consignacao_clientes', JSON.stringify([]));
                localStorage.setItem('goianita_consignacao_produtos', JSON.stringify([]));
                localStorage.setItem('goianita_consignacao_pagamentos', JSON.stringify([]));
                window.GoianitaDB.importExport.syncToGoogleSheets().then(() => {
                    alert("Banco de dados local zerado e sincronizado com a planilha.");
                    window.location.reload();
                }).catch(() => {
                    alert("Banco de dados local zerado.");
                    window.location.reload();
                });
            }
        });
    }

    const btnBackup = document.getElementById('btn-export-backup');
    if (btnBackup) {
        btnBackup.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(window.GoianitaDB.importExport.exportBackup());
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `goianita_backup_${new Date().toISOString().slice(0,10)}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });
    }

    const fileInput = document.getElementById('backup-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                const contents = e.target.result;
                const res = window.GoianitaDB.importExport.importBackup(contents);
                if (res.success) {
                    alert("Dados importados com sucesso! O aplicativo será recarregado.");
                    window.location.reload();
                } else {
                    alert("Erro ao importar o arquivo: " + res.error);
                }
            };
            reader.readAsText(file);
        });
    }
}
