/**
 * app.js - Lógica Principal do App
 * Casas Goianita - Sistema de Comodato e Consignação
 */

document.addEventListener('DOMContentLoaded', () => {
    // Configura o Usuário Logado Mock
    initUserSession();

    // Inicializa a barra de navegação responsiva mobile
    initMobileNav();

    // Roteador Básico baseado em ID da página ou URL hash
    renderActivePage();

    // Eventos Globais
    window.addEventListener('hashchange', renderActivePage);
});

function initUserSession() {
    const role = sessionStorage.getItem('goianita_role') || 'admin';
    const email = sessionStorage.getItem('goianita_email') || '';
    const userName = sessionStorage.getItem('goianita_user_name') || '';

    let name = "Cléber";
    let avatar = "CL";

    if (role === 'admin') {
        const lowerEmail = email.toLowerCase();
        if (lowerEmail.includes('eduard')) {
            name = "Eduardo";
            avatar = "ED";
        } else if (lowerEmail.includes('debora')) {
            name = "Débora";
            avatar = "DE";
        } else if (lowerEmail.includes('cleber')) {
            name = "Cléber";
            avatar = "CL";
        } else if (lowerEmail.includes('goianita')) {
            name = "Goianita";
            avatar = "GO";
        } else {
            name = "Administrador";
            avatar = "AD";
        }
    } else {
        name = userName || "Cliente Fornecedor";
        avatar = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || "CF";
    }

    const user = {
        name: name,
        role: role === 'admin' ? "Administrador Goianita" : "Acesso Cliente",
        avatar: avatar
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
                comissaoPadrao: parseFloat(document.getElementById('cli-comissao').value) || 50,
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
    document.getElementById('cli-saldo-disponivel').textContent = formatCurrency(financeiro.saldoDisponivel);
    document.getElementById('cli-saldo-bloqueado').textContent = formatCurrency(financeiro.saldoBloqueado);
    document.getElementById('cli-total-vendas').textContent = formatCurrency(financeiro.totalApostado);
    document.getElementById('cli-total-pago').textContent = formatCurrency(financeiro.totalPago);

    // Habilita ou desabilita botão de pagamento se não tiver saldo disponível
    const btnPagar = document.getElementById('btn-pagar-cliente');
    if (btnPagar && role === 'admin') {
        btnPagar.disabled = financeiro.saldoDisponivel <= 0;
        btnPagar.addEventListener('click', () => {
            const valorPagar = prompt(`Confirmar pagamento via PIX para este cliente?\nValor Disponível (Liberado): ${formatCurrency(financeiro.saldoDisponivel)}\nSaldo Bloqueado (Vendas < 30 dias): ${formatCurrency(financeiro.saldoBloqueado)}\n\nDigite o valor para transferir:`, financeiro.saldoDisponivel.toFixed(2));
            if (valorPagar) {
                const valor = parseFloat(valorPagar);
                if (valor > 0 && valor <= financeiro.saldoDisponivel) {
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
            const comissao = parseFloat(document.getElementById('prod-comissao').value) || 50;
            
            const novoProduto = {
                nome: document.getElementById('prod-nome').value,
                descricao: document.getElementById('prod-desc').value,
                categoria: document.getElementById('prod-cat').value,
                subcategoria: document.getElementById('prod-subcat').value,
                marca: document.getElementById('prod-marca').value,
                ean: document.getElementById('prod-ean').value,
                conservacao: document.getElementById('prod-conservacao') ? document.getElementById('prod-conservacao').value : 'Em Avaliação',
                defeitosAparentes: document.getElementById('prod-defeitos') ? document.getElementById('prod-defeitos').value : '',
                pecasFaltantes: document.getElementById('prod-faltantes') ? document.getElementById('prod-faltantes').value : '',
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

    // Motor de Precificação Inteligente
    const btnPesquisar = document.getElementById('btn-ia-precificacao');
    if (btnPesquisar) {
        btnPesquisar.addEventListener('click', () => calcularPrecificacaoInteligente());
    }

    // Recalcula o painel automaticamente ao alterar categoria, conservação ou marca
    ['prod-cat', 'prod-conservacao', 'prod-marca'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => {
            if (document.getElementById('painel-precificacao')) {
                calcularPrecificacaoInteligente();
            }
        });
    });
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
    
    // Checklist de Avaliação (se existir)
    if (produto.megaChecklist) {
        const inputs = document.querySelectorAll('.mega-input');
        inputs.forEach(inp => {
            const label = inp.getAttribute('data-label');
            const found = produto.megaChecklist.find(item => item.label === label);
            inp.checked = !!found;
        });
    }

    // Filtrar categorias de checklist baseado na categoria do produto
    const categoryMap = {
        'Cozinha e Mesa': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '5. Conjuntos, Jogos e Coleções', '6. Louças, Porcelanas e Cerâmicas', '7. Vidros e Cristais', '8. Inox e Outros Metais', '9. Panelas e Assadeiras', '10. Plástico, Acrílico e Silicone', '11. Madeira e Bambu', '13. Higienização e Precificação'],
        'Decoração': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '5. Conjuntos, Jogos e Coleções', '6. Louças, Porcelanas e Cerâmicas', '7. Vidros e Cristais', '8. Inox e Outros Metais', '10. Plástico, Acrílico e Silicone', '11. Madeira e Bambu', '13. Higienização e Precificação'],
        'Tapeçaria': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '13. Higienização e Precificação'],
        'Banheiro': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '6. Louças, Porcelanas e Cerâmicas', '7. Vidros e Cristais', '8. Inox e Outros Metais', '10. Plástico, Acrílico e Silicone', '13. Higienização e Precificação'],
        'Arte': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '11. Madeira e Bambu', '13. Higienização e Precificação'],
        'Eletrodomésticos': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '8. Inox e Outros Metais', '10. Plástico, Acrílico e Silicone', '12. Eletrônicos e Eletroportáteis', '13. Higienização e Precificação']
    };
    
    const allowedCategories = categoryMap[produto.categoria] || [];
    if (allowedCategories.length > 0) {
        document.querySelectorAll('.mega-accordion').forEach(acc => {
            const catName = acc.querySelector('summary').textContent.trim();
            if (allowedCategories.includes(catName)) {
                acc.style.display = 'block';
            } else {
                acc.style.display = 'none';
            }
        });
    } else {
        document.querySelectorAll('.mega-accordion').forEach(acc => acc.style.display = 'block');
    }

    // Renderizar Galeria de Mídias
    const mediaGallery = document.getElementById('media-gallery');
    if (mediaGallery) {
        mediaGallery.innerHTML = '';
        if (produto.midias && produto.midias.length > 0) {
            produto.midias.forEach(m => {
                const el = document.createElement('div');
                el.style.position = 'relative';
                el.style.width = '100px';
                el.style.height = '100px';
                el.style.borderRadius = '8px';
                el.style.overflow = 'hidden';
                el.style.border = '1px solid #ccc';
                
                if (m.type.startsWith('video/')) {
                    el.innerHTML = `<video src="${m.url}" style="width: 100%; height: 100%; object-fit: cover; background: #000;" controls></video>`;
                } else {
                    el.innerHTML = `<img src="${m.url}" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" onclick="window.open('${m.url}', '_blank')">`;
                }
                
                const btnApagar = document.createElement('button');
                btnApagar.innerHTML = '<i class="fa-solid fa-trash"></i>';
                btnApagar.style.position = 'absolute';
                btnApagar.style.top = '4px';
                btnApagar.style.right = '4px';
                btnApagar.style.background = 'rgba(255, 0, 0, 0.8)';
                btnApagar.style.color = 'white';
                btnApagar.style.border = 'none';
                btnApagar.style.borderRadius = '50%';
                btnApagar.style.width = '24px';
                btnApagar.style.height = '24px';
                btnApagar.style.cursor = 'pointer';
                btnApagar.onclick = () => apagarMidiaProduto(id, m.url);
                el.appendChild(btnApagar);
                
                mediaGallery.appendChild(el);
            });
        } else {
            mediaGallery.innerHTML = '<p style="font-size: 13px; color: #777;">Nenhuma mídia anexada.</p>';
        }
    }

    // Upload de Mídias
    const uploadInput = document.getElementById('media-upload-input');
    if (uploadInput) {
        uploadInput.addEventListener('change', async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            
            if (typeof firebase === 'undefined' || !window.GoianitaStorage) {
                alert('Firebase Storage não inicializado ou sem internet.');
                return;
            }
            
            const statusLabel = document.getElementById('upload-status');
            statusLabel.textContent = `Enviando ${files.length} arquivo(s)... (pode demorar)`;
            uploadInput.disabled = true;
            
            produto.midias = produto.midias || [];
            
            try {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    statusLabel.textContent = `Processando arquivo ${i + 1} de ${files.length}...`;
                    
                    // Lê o arquivo como base64 string
                    const base64Url = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
                        reader.readAsDataURL(file);
                    });
                    
                    produto.midias.push({
                        url: base64Url,
                        type: file.type
                    });
                }
                statusLabel.textContent = 'Gravando no banco de dados local...';
                await window.GoianitaDB.produtos.save(produto);
                statusLabel.textContent = 'Upload concluído com sucesso!';
                setTimeout(() => window.location.reload(), 1000);
            } catch (err) {
                statusLabel.textContent = 'Erro ao processar mídia: ' + err.message;
                uploadInput.disabled = false;
            }
        });
    }

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

// --- MÍDIA DO PRODUTO ---
async function apagarMidiaProduto(produtoId, url) {
    if (!confirm("Tem certeza que deseja apagar esta mídia permanentemente?")) return;
    
    const produto = window.GoianitaDB.produtos.getById(produtoId);
    if (!produto || !produto.midias) return;

    // Remover a URL do Firebase Storage, se estiver usando-o
    if (typeof firebase !== 'undefined' && window.GoianitaStorage && url.includes('firebase')) {
        try {
            const fileRef = window.GoianitaStorage.refFromURL(url);
            await fileRef.delete();
        } catch (err) {
            console.warn("Mídia já não existia no Storage ou erro de permissão:", err);
        }
    }

    produto.midias = produto.midias.filter(m => m.url !== url);
    await window.GoianitaDB.produtos.save(produto);
    alert('Mídia removida com sucesso!');
    window.location.reload();
}

// --- FINANCEIRO GERAL ---
function salvarChecklistProduto() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (!id) return;
    
    const produto = window.GoianitaDB.produtos.getById(id);
    if (!produto) return;
    
    const inputs = document.querySelectorAll('.mega-input');
    const megaChecklist = [];
    inputs.forEach(inp => {
        if (inp.checked) {
            megaChecklist.push({
                category: inp.getAttribute('data-category'),
                label: inp.getAttribute('data-label')
            });
        }
    });
    
    produto.megaChecklist = megaChecklist;
    
    window.GoianitaDB.produtos.save(produto).then(() => {
        alert("Checklist salvo com sucesso!");
    }).catch(err => {
        alert("Erro ao salvar checklist: " + err.message);
    });
}

function imprimirAvaliacoesCliente() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (!id) return;
    
    const cliente = window.GoianitaDB.clientes.getById(id);
    const produtos = window.GoianitaDB.produtos.getByCliente(id);
    
    if (!produtos || produtos.length === 0) {
        alert("Nenhum produto cadastrado para este fornecedor.");
        return;
    }
    
    // Cria um contêiner invisível apenas para a impressão
    const printArea = document.createElement('div');
    printArea.id = 'print-area';
    
    let html = `
        <div class="print-header">
            <h2>Termo de Triagem e Avaliação de Produtos</h2>
            <p><strong>Fornecedor:</strong> ${cliente.nome} | <strong>CPF:</strong> ${cliente.cpf}</p>
            <p><strong>Data:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
            <hr>
        </div>
        <div class="print-body">
    `;
    
    produtos.forEach(p => {
        let checklistHtml = '';
        if (p.megaChecklist && p.megaChecklist.length > 0) {
            const grouped = {};
            p.megaChecklist.forEach(item => {
                if(!grouped[item.category]) grouped[item.category] = [];
                grouped[item.category].push(item.label);
            });
            for(const cat in grouped) {
                checklistHtml += `<p style="margin: 8px 0 2px 0; font-size: 12px; font-weight: bold; color: #444;">${cat}</p>`;
                checklistHtml += `<ul style="list-style: none; padding-left: 0; margin: 0; font-size: 11px;">`;
                grouped[cat].forEach(label => {
                    checklistHtml += `<li><i class="fa-solid fa-check" style="color: #666; margin-right: 4px;"></i> ${label}</li>`;
                });
                checklistHtml += `</ul>`;
            }
        } else {
            checklistHtml = '<p style="font-size: 12px; font-style: italic; color: #999;">Checklist não preenchido.</p>';
        }

        html += `
            <div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 5px;">
                <h4 style="margin: 0 0 10px 0;">[${p.sku}] ${p.nome} - R$ ${p.precoVenda.toFixed(2)}</h4>
                <div style="column-count: 2; column-gap: 20px;">
                    ${checklistHtml}
                </div>
                <p style="margin-top: 10px; font-size: 13px; color: #555;"><strong>Defeitos / Faltantes:</strong> ${p.defeitosAparentes || ''} ${p.pecasFaltantes || ''}</p>
            </div>
        `;
    });
    
    html += `
        </div>
        <div class="print-footer" style="margin-top: 50px; text-align: center;">
            <p>Declaro ciência e concordância com a avaliação das peças acima descritas.</p>
            <br><br>
            <p>_______________________________________________________</p>
            <p><strong>${cliente.nome}</strong></p>
            <p>Assinatura do Fornecedor</p>
        </div>
    `;
    
    printArea.innerHTML = html;
    document.body.appendChild(printArea);
    
    window.print();
    
    // Remove após impressão
    document.body.removeChild(printArea);
}

function imprimirContratoCliente() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (!id) return;
    
    const cliente = window.GoianitaDB.clientes.getById(id);
    const produtos = window.GoianitaDB.produtos.getByCliente(id);
    
    if (!produtos || produtos.length === 0) {
        alert("Nenhum produto cadastrado para este fornecedor. O contrato exige ao menos um produto.");
        return;
    }
    
    const printArea = document.createElement('div');
    printArea.id = 'print-area';
    
    let html = `
        <div class="print-header">
            <h2 style="text-align: center; margin-bottom: 20px;">CONTRATO DE CONSIGNAÇÃO DE PEÇAS E UTILIDADES</h2>
            
            <h3 style="font-size: 14px; margin-top: 20px;">QUALIFICAÇÃO DAS PARTES</h3>
            <p style="font-size: 12px; text-align: justify; margin-bottom: 10px;"><strong>CONSIGNATÁRIA:</strong> VIRTUAL DISTRIBUIDORA DE UTILIDADES DOMÉSTICAS LTDA (CASAS GOIANITA), sociedade limitada, inscrita no CNPJ sob o nº 11.316.256/0001-29, situada na Rua 85, nº 369, Quadra F19, Lote 45, Setor Sul, Goiânia/GO, CEP: 74080-010.</p>
            <p style="font-size: 12px; text-align: justify; margin-bottom: 10px;"><strong>CONSIGNANTE:</strong> ${cliente.nome}, inscrito(a) no CPF/CNPJ sob o nº ${cliente.cpf}, telefone ${cliente.telefone}, e-mail ${cliente.email}.</p>
            <p style="font-size: 12px; text-align: justify; margin-bottom: 20px;">As partes acima qualificadas celebram, entre si, o presente instrumento particular, que será regido pela legislação aplicável, em especial, pelos artigos 534 e seguintes do Código Civil Brasileiro e pelas cláusulas e disposições seguintes:</p>

            <h3 style="font-size: 14px; margin-top: 20px;">CLÁUSULAS CONTRATUAIS RESUMIDAS</h3>
            <div style="font-size: 10px; text-align: justify;">
                <p><strong>Cláusula 1ª</strong> – Considera-se CONSIGNANTE a pessoa que deixa bens sob os cuidados da CONSIGNATÁRIA para comercialização e repasse dos recursos líquidos.</p>
                <p><em>Parágrafo Único.</em> O(A) CONSIGNANTE autoriza o uso de imagens dos bens para fins de divulgação e publicidade.</p>
                <p><strong>Cláusula 2ª</strong> – O(A) CONSIGNANTE responsabiliza-se pela origem e autenticidade dos bens móveis deixados em consignação.</p>
                <p><em>§1º.</em> Constatada falsificação, o(a) CONSIGNANTE responderá por perdas e danos e arcará com multa.</p>
                <p><em>§2º.</em> A avaliação será realizada com exclusividade pela CONSIGNATÁRIA, com base no mercado e estado do produto.</p>
                <p><em>§3º.</em> A CONSIGNATÁRIA poderá recusar a recepção de bens que considere não vendáveis.</p>
                <p><em>§4º.</em> Peças reprovadas devem ser retiradas em até 7 dias úteis, sob pena de doação ou bazar beneficente.</p>
                <p><em>§5º.</em> A doação poderá ser realizada em favor de instituições de caridade parceiras.</p>
                <p><strong>Cláusula 3ª</strong> – A CONSIGNATÁRIA responsabiliza-se pela guarda dos bens, exceto caso fortuito ou força maior.</p>
                <p><strong>Cláusula 4ª</strong> – Os bens serão expostos à venda conforme organização interna da CONSIGNATÁRIA (lojas, e-commerce, eventos).</p>
                <p><strong>Cláusula 5ª</strong> – Realizada a venda, caberá ao(à) CONSIGNANTE o recebimento do valor líquido acordado.</p>
                <p><em>§1º.</em> O valor líquido devido ficará bloqueado durante 30 dias após a venda, disponível para retirada após este prazo.</p>
                <p><em>§2º e §3º.</em> O pagamento poderá ser feito via PIX (em até 7 dias úteis após requisição) ou revertido em crédito em loja.</p>
                <p><strong>Cláusula 6ª</strong> – A CONSIGNATÁRIA reserva-se o direito de devolver produtos a qualquer tempo. Não retirado em 30 dias após aviso, o bem poderá ser doado.</p>
                <p><strong>Cláusula 7ª</strong> – Se não vendido em 90 dias, a CONSIGNATÁRIA pode reduzir o valor do bem em até 50% para aumentar a liquidez.</p>
                <p><strong>Cláusula 8ª</strong> – O(A) CONSIGNANTE que desejar retirar peças antes do prazo deverá avisar com 30 dias de antecedência.</p>
                <p><strong>Cláusula 9ª a 16ª</strong> – Rescisão, LGPD (uso de dados para o contrato), confidencialidade, direitos de marca, e Foro de Goiânia/GO.</p>
            </div>
        </div>
        <br><hr>
        <div class="print-body" style="page-break-before: always;">
            <h3 style="text-align: center; margin-bottom: 20px;">ANEXO I - TERMO DE TRIAGEM E PRODUTOS ACEITOS</h3>
            <p style="font-size: 12px; margin-bottom: 20px;">O(A) CONSIGNANTE declara ciência e concorda com a avaliação, precificação, estado de conservação, defeitos apontados e lista de acessórios descritos nos itens abaixo, submetidos e aprovados pela triagem da CONSIGNATÁRIA na presente data:</p>
    `;
    
    produtos.forEach(p => {
        let checklistHtml = '';
        if (p.megaChecklist && p.megaChecklist.length > 0) {
            const grouped = {};
            p.megaChecklist.forEach(item => {
                if(!grouped[item.category]) grouped[item.category] = [];
                grouped[item.category].push(item.label);
            });
            for(const cat in grouped) {
                checklistHtml += `<p style="margin: 8px 0 2px 0; font-size: 11px; font-weight: bold; color: #444;">${cat}</p>`;
                checklistHtml += `<ul style="list-style: none; padding-left: 0; margin: 0; font-size: 10px;">`;
                grouped[cat].forEach(label => {
                    checklistHtml += `<li><i class="fa-solid fa-check" style="color: #666; margin-right: 4px;"></i> ${label}</li>`;
                });
                checklistHtml += `</ul>`;
            }
        } else {
            checklistHtml = '<p style="font-size: 11px; font-style: italic; color: #999;">Checklist não preenchido.</p>';
        }

        html += `
            <div style="margin-bottom: 15px; padding: 10px; border: 1px solid #ccc; border-radius: 5px;">
                <h4 style="margin: 0 0 10px 0; font-size: 14px;">[${p.sku}] ${p.nome} - Valor Líquido de Repasse: R$ ${(p.precoVenda * (1 - p.comissao/100)).toFixed(2)}</h4>
                <div style="column-count: 2; column-gap: 20px;">
                    ${checklistHtml}
                </div>
                <p style="margin-top: 8px; font-size: 11px; color: #333;"><strong>Ressalvas/Faltantes:</strong> ${p.defeitosAparentes || 'Nenhuma ressalva.'} ${p.pecasFaltantes || ''}</p>
            </div>
        `;
    });
    
    html += `
        </div>
        <div class="print-footer" style="margin-top: 50px;">
            <p style="text-align: center; font-size: 13px;">Por estarem justos e contratados, assinam o presente termo de consignação e avaliação.</p>
            <p style="text-align: center; font-size: 13px; margin-top: 10px;">Goiânia/GO, ${new Date().toLocaleDateString('pt-BR')}</p>
            <div style="display: flex; justify-content: space-around; margin-top: 60px;">
                <div style="text-align: center;">
                    <p>_______________________________________________________</p>
                    <p><strong>${cliente.nome}</strong></p>
                    <p style="font-size: 12px;">CONSIGNANTE (CPF/CNPJ: ${cliente.cpf})</p>
                </div>
                <div style="text-align: center;">
                    <p>_______________________________________________________</p>
                    <p><strong>Casas Goianita (Virtual Ltda)</strong></p>
                    <p style="font-size: 12px;">CONSIGNATÁRIA</p>
                </div>
            </div>
        </div>
    `;
    
    printArea.innerHTML = html;
    document.body.appendChild(printArea);
    
    window.print();
    
    document.body.removeChild(printArea);
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

/**
 * MOTOR DE PRECIFICAÇÃO INTELIGENTE — Goianita Novo de Novo
 *
 * Combina:
 *   1. Tabela de faixas de preço por categoria (artigos domésticos semi-novos)
 *   2. Multiplicador por estado de conservação
 *   3. Boost para marcas premium do setor
 *   4. Boost por palavras-chave no nome (conjuntos, vintage, etc.)
 *   5. Âncoragem no preço sugerido pelo fornecedor (quando informado)
 *   6. Arredondamento para preços psicologicamente atraentes
 */
function calcularPrecificacaoInteligente() {
    const nome = (document.getElementById('prod-nome')?.value || '').trim();
    const categoria = document.getElementById('prod-cat')?.value || 'Outros';
    const conservacao = document.getElementById('prod-conservacao')?.value || 'B';
    const marca = (document.getElementById('prod-marca')?.value || '').trim().toLowerCase();
    const precoSugForecedor = parseFloat(document.getElementById('prod-preco-sug')?.value) || 0;
    const comissao = parseFloat(document.getElementById('prod-comissao')?.value) || 50;
    
    const defeitos = (document.getElementById('prod-defeitos')?.value || '').trim();
    const faltantes = (document.getElementById('prod-faltantes')?.value || '').trim();
    const penalidadeRisco = (defeitos || faltantes) ? 0.90 : 1.00; // deduz 10% se houver defeito/falta

    if (!nome) {
        alert('Por favor, preencha o nome do produto antes de usar a precificação inteligente.');
        return;
    }

    // --- 1. TABELA DE REFERÊNCIA DE PREÇOS POR CATEGORIA ---
    // Faixas baseadas no mix de produtos da Casas Goianita (artigos domésticos semi-novos)
    const tabelaCategoria = {
        'Cozinha e Mesa':   { min: 40,  med: 90,  max: 350  },
        'Decoração':        { min: 30,  med: 80,  max: 400  },
        'Tapeçaria':        { min: 60,  med: 150, max: 600  },
        'Banheiro':         { min: 25,  med: 60,  max: 200  },
        'Sala de Estar':    { min: 80,  med: 200, max: 900  },
        'Jardim':           { min: 35,  med: 100, max: 450  },
        'Colecionáveis':    { min: 50,  med: 180, max: 1200 },
        'Arte':             { min: 80,  med: 250, max: 2000 },
        'Eletrodomésticos': { min: 100, med: 300, max: 1500 },
        'Outros':           { min: 25,  med: 70,  max: 300  }
    };

    // --- 2. MULTIPLICADOR POR ESTADO DE CONSERVAÇÃO ---
    const multConservacao = { 'A+': 0.80, 'A': 0.65, 'B': 0.50, 'C': 0.35 };

    // --- 3. MARCAS PREMIUM (aumentam o valor percebido) ---
    const marcasPremium = [
        'porto brasil', 'tramontina', 'le creuset', 'oxford', 'lyor',
        'wolff', 'vista alegre', 'schmidt', 'brinox', 'bon gourmet',
        'hazan', 'royal prestige', 'heritage', 'panelux', 'coup', 'brava'
    ];
    const ehMarcaPremium = marcasPremium.some(m => marca.includes(m));
    const multMarca = ehMarcaPremium ? 1.20 : 1.00;

    // --- 4. BOOST POR PALAVRAS-CHAVE NO NOME ---
    const nomeLower = nome.toLowerCase();
    let multNome = 1.0;
    if (nomeLower.includes('conjunto') || nomeLower.includes('kit') || nomeLower.includes('jogo')) multNome = 1.15;
    if (nomeLower.includes('completo') || nomeLower.includes('peças') || nomeLower.includes('pçs')) multNome *= 1.10;
    if (nomeLower.includes('antigo') || nomeLower.includes('vintage') || nomeLower.includes('colecionável')) multNome *= 1.25;

    // --- 5. CÁLCULO DO PREÇO BASE ---
    const ref = tabelaCategoria[categoria] || tabelaCategoria['Outros'];
    const fatorConservacao = (multConservacao[conservacao] || 0.50) * penalidadeRisco;

    // Ponto de partida: mediana da categoria, ajustada por todos os fatores
    let precoBase = ref.med * fatorConservacao * multMarca * multNome;

    // Âncora no preço sugerido pelo fornecedor (quando informado)
    if (precoSugForecedor > 0) {
        const ancoraSugerida = precoSugForecedor * fatorConservacao * 0.85;
        // 60% âncora do fornecedor + 40% tabela de mercado
        precoBase = (ancoraSugerida * 0.6) + (precoBase * 0.4);
    }

    // Clampar dentro da faixa da categoria
    precoBase = Math.max(ref.min, Math.min(ref.max, precoBase));

    // Arredondar para preço psicologicamente atraente
    const precoFinal  = arredondarPrecoComercial(precoBase);
    const precoMinimo = arredondarPrecoComercial(ref.min * fatorConservacao * multMarca);
    const precoMaximo = arredondarPrecoComercial(ref.max * fatorConservacao * multMarca);

    // --- 6. CÁLCULO DE REPASSE ---
    const comissaoGoianita  = (precoFinal * comissao) / 100;
    const repasseFornecedor = precoFinal - comissaoGoianita;

    // Preencher campos do formulário
    if (document.getElementById('prod-preco-sug')) document.getElementById('prod-preco-sug').value = precoFinal.toFixed(2);
    if (document.getElementById('prod-preco'))     document.getElementById('prod-preco').value     = precoFinal.toFixed(2);

    // Exibir painel visual de resultado
    exibirResultadoPrecificacao({
        categoria, conservacao, ehMarcaPremium, fatorConservacao,
        precoFinal, precoMinimo, precoMaximo,
        comissao, comissaoGoianita, repasseFornecedor, precoSugForecedor,
        penalidadeRisco
    });
}

/**
 * Arredonda preços para valores psicologicamente atraentes no varejo.
 * Ex: 91.37 → 89,90 | 153.22 → 149,90 | 312.00 → 299,90
 */
function arredondarPrecoComercial(valor) {
    if (valor <= 0) return 0;
    const bases = [
        10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 150,
        170, 200, 230, 250, 300, 350, 400, 450, 500, 600, 700,
        800, 900, 1000, 1200, 1500, 2000
    ];
    let baseEscolhida = bases[0];
    for (const b of bases) {
        if (b <= valor + 10) baseEscolhida = b;
        else break;
    }
    return Math.max(baseEscolhida - 0.10, valor * 0.95);
}

/**
 * Renderiza o painel visual com o resultado da precificação.
 */
function exibirResultadoPrecificacao(dados) {
    // Remove painel anterior se existir
    const painelAnterior = document.getElementById('painel-precificacao');
    if (painelAnterior) painelAnterior.remove();

    const {
        categoria, conservacao, ehMarcaPremium, fatorConservacao,
        precoFinal, precoMinimo, precoMaximo,
        comissao, comissaoGoianita, repasseFornecedor, precoSugForecedor,
        penalidadeRisco
    } = dados;

    const notaConservacao = `Estado "${conservacao}" → ${(fatorConservacao * 100).toFixed(0)}% do valor base de mercado ${penalidadeRisco < 1 ? '(penalidade por avaria aplicada)' : ''}`;
    const notaMarca       = ehMarcaPremium ? '⭐ Marca premium reconhecida → +20% no valor percebido' : 'Marca não listada como premium (sem ajuste)';
    const notaSugestao    = precoSugForecedor > 0
        ? `Preço do fornecedor (${formatCurrency(precoSugForecedor)}) usado como âncora (60% do cálculo)`
        : 'Preço calculado 100% pela tabela de mercado Goianita';

    const painel = document.createElement('div');
    painel.id = 'painel-precificacao';
    painel.style.cssText = `
        grid-column: span 2;
        background: linear-gradient(135deg, #fdf8ee 0%, #fff 100%);
        border: 2px solid var(--accent-gold);
        border-radius: var(--radius-md);
        padding: 28px 32px;
        margin-top: 8px;
        animation: fadeInPainel 0.35s ease;
    `;

    painel.innerHTML = `
        <style>
            @keyframes fadeInPainel {
                from { opacity: 0; transform: translateY(-10px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .prec-title {
                font-size: 16px; font-weight: 700; color: var(--text-main);
                display: flex; align-items: center; gap: 10px; margin-bottom: 20px;
            }
            .prec-title i { color: var(--accent-gold); font-size: 20px; }
            .prec-grid {
                display: grid; grid-template-columns: repeat(3, 1fr);
                gap: 16px; margin-bottom: 20px;
            }
            @media(max-width: 700px) { .prec-grid { grid-template-columns: 1fr; } }
            .prec-card {
                background: white; border-radius: var(--radius-sm);
                border: 1px solid var(--border-color); padding: 18px 20px; text-align: center;
                transition: box-shadow 0.2s;
            }
            .prec-card:hover { box-shadow: var(--shadow-md); }
            .prec-card .plabel {
                font-size: 11px; font-weight: 600; text-transform: uppercase;
                letter-spacing: 1px; color: var(--text-muted); display: block; margin-bottom: 8px;
            }
            .prec-card .pvalor {
                font-size: 26px; font-weight: 700; display: block; line-height: 1;
            }
            .prec-card .psub {
                font-size: 12px; color: var(--text-muted); display: block; margin-top: 6px;
            }
            .prec-faixa {
                font-size: 13px; color: var(--text-muted); margin-bottom: 16px;
                background: rgba(198,149,48,0.08); border-radius: 8px; padding: 10px 16px;
            }
            .prec-notas {
                font-size: 12px; color: var(--text-muted);
                display: flex; flex-direction: column; gap: 5px;
            }
            .prec-notas span::before { content: "• "; }
            .prec-success { color: var(--accent-gold) !important; font-weight: 600; }
        </style>

        <div class="prec-title">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            Análise de Precificação — <em style="font-weight:400; margin-left:4px;">${categoria} · ${conservacao}</em>
        </div>

        <div class="prec-grid">
            <div class="prec-card">
                <span class="plabel">Preço Sugerido de Venda</span>
                <span class="pvalor" style="color: var(--accent-gold);">${formatCurrency(precoFinal)}</span>
                <span class="psub">Valor de etiqueta recomendado</span>
            </div>
            <div class="prec-card">
                <span class="plabel">Comissão Goianita (${comissao}%)</span>
                <span class="pvalor" style="color: var(--status-vendido);">${formatCurrency(comissaoGoianita)}</span>
                <span class="psub">Receita da loja nesta peça</span>
            </div>
            <div class="prec-card">
                <span class="plabel">Repasse ao Fornecedor</span>
                <span class="pvalor" style="color: var(--status-pago);">${formatCurrency(repasseFornecedor)}</span>
                <span class="psub">Valor líquido após venda</span>
            </div>
        </div>

        <div class="prec-faixa">
            📊 Faixa de preço para <strong>${categoria}</strong> neste estado:
            de <strong>${formatCurrency(precoMinimo)}</strong> até <strong>${formatCurrency(precoMaximo)}</strong>
        </div>

        <div class="prec-notas">
            <span>${notaConservacao}</span>
            <span>${notaMarca}</span>
            <span>${notaSugestao}</span>
            <span class="prec-success">✅ Campos "Preço Sugerido" e "Preço de Venda" preenchidos automaticamente.</span>
        </div>
    `;

    // Insere o painel logo após o campo "nome + botão"
    const nomeGroup = document.getElementById('prod-nome')?.closest('.form-group');
    if (nomeGroup) {
        nomeGroup.after(painel);
    } else {
        document.getElementById('produto-form')?.appendChild(painel);
    }

    // Scroll suave até o resultado
    setTimeout(() => painel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
}

function initMobileNav() {
    if (!document.getElementById('mobile-header')) {
        const pathPrefix = window.location.pathname.includes('/pages/') ? '../' : '';
        
        const mobileHeader = document.createElement('div');
        mobileHeader.id = 'mobile-header';
        mobileHeader.innerHTML = `
            <button id="mobile-menu-toggle" aria-label="Menu">
                <i class="fa-solid fa-bars"></i>
            </button>
            <div class="mobile-logo">
                <img src="${pathPrefix}logo.png" alt="Logo">
                <span>Goianita</span>
            </div>
            <div style="width: 40px;"></div>
        `;
        document.body.insertBefore(mobileHeader, document.body.firstChild);
        
        const backdrop = document.createElement('div');
        backdrop.id = 'sidebar-backdrop';
        document.body.appendChild(backdrop);
        
        const sidebar = document.querySelector('.sidebar');
        const toggleBtn = document.getElementById('mobile-menu-toggle');
        
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sidebar.classList.toggle('open');
                backdrop.classList.toggle('active');
            });
            
            backdrop.addEventListener('click', () => {
                sidebar.classList.remove('open');
                backdrop.classList.remove('active');
            });

            const navLinks = sidebar.querySelectorAll('.nav-menu a');
            navLinks.forEach(link => {
                link.addEventListener('click', () => {
                    sidebar.classList.remove('open');
                    backdrop.classList.remove('active');
                });
            });
        }
    }
}
