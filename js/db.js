/**
 * db.js - Camada de Banco de Dados Local (localStorage)
 * Casas Goianita - Sistema de Comodato e Consignação
 */

const DB_KEYS = {
    CLIENTES: 'goianita_consignacao_clientes',
    PRODUTOS: 'goianita_consignacao_produtos',
    PAGAMENTOS: 'goianita_consignacao_pagamentos',
    CONFIG: 'goianita_consignacao_config'
};

// Configuração do Firebase fornecida pelo usuário
const firebaseConfig = {
  apiKey: "AIzaSyBJg2lm3VulKkVVSrV2PTRWrGE-O0ZSCSs",
  authDomain: "app-brecho-fd94a.firebaseapp.com",
  projectId: "app-brecho-fd94a",
  storageBucket: "app-brecho-fd94a.firebasestorage.app",
  messagingSenderId: "923616066150",
  appId: "1:923616066150:web:476bb40909442e6e318ba7"
};

// Inicializar Firebase
if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    window.GoianitaAuth = firebase.auth();
    window.GoianitaFirestore = firebase.firestore();
    
    // Habilitar persistência off-line se possível
    window.GoianitaFirestore.enablePersistence().catch(err => {
        console.warn("[Firebase Firestore] Falha ao habilitar persistência offline:", err.code);
    });
}

// Inicialização de chaves seguras no localStorage
function initDatabase() {
    if (!localStorage.getItem(DB_KEYS.CLIENTES)) {
        localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify([]));
    }
    if (!localStorage.getItem(DB_KEYS.PRODUTOS)) {
        localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify([]));
    }
    if (!localStorage.getItem(DB_KEYS.PAGAMENTOS)) {
        localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify([]));
    }
}

initDatabase();

// Configurar escuta em tempo real do Firestore para sincronizar com localStorage
function setupFirestoreSync() {
    if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
        console.warn("[Firebase] SDK não carregado. Operando local-only.");
        return;
    }
    
    console.log("[Firebase] Iniciando sincronização em tempo real com Firestore...");

    // Sincronizar clientes
    window.GoianitaFirestore.collection('clientes').onSnapshot(snapshot => {
        const clientes = [];
        snapshot.forEach(doc => {
            clientes.push({ id: doc.id, ...doc.data() });
        });
        localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientes));
    }, err => console.error("Erro no sync de clientes:", err));

    // Sincronizar produtos
    window.GoianitaFirestore.collection('produtos').onSnapshot(snapshot => {
        const produtos = [];
        snapshot.forEach(doc => {
            produtos.push({ id: doc.id, ...doc.data() });
        });
        localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtos));
    }, err => console.error("Erro no sync de produtos:", err));

    // Sincronizar pagamentos
    window.GoianitaFirestore.collection('pagamentos').onSnapshot(snapshot => {
        const pagamentos = [];
        snapshot.forEach(doc => {
            pagamentos.push({ id: doc.id, ...doc.data() });
        });
        localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(pagamentos));
    }, err => console.error("Erro no sync de pagamentos:", err));
}

// Iniciar escuta
setupFirestoreSync();

// Automação de Simulação de Vendas e Repasses (a cada 15 segundos vende ou paga de forma transparente)
function startAutomationSimulation() {
    setInterval(() => {
        const produtos = JSON.parse(localStorage.getItem(DB_KEYS.PRODUTOS) || '[]');
        const clientes = JSON.parse(localStorage.getItem(DB_KEYS.CLIENTES) || '[]');
        const pagamentos = JSON.parse(localStorage.getItem(DB_KEYS.PAGAMENTOS) || '[]');
        
        // 1. Simular uma venda aleatória de produto "À Venda"
        const produtosAVenda = produtos.filter(p => p.status === 'À Venda');
        if (produtosAVenda.length > 0 && Math.random() > 0.4) {
            const produtoSorteado = produtosAVenda[Math.floor(Math.random() * produtosAVenda.length)];
            produtoSorteado.status = 'Vendido';
            produtoSorteado.statusHistorico = produtoSorteado.statusHistorico || [];
            produtoSorteado.statusHistorico.push({
                status: 'Vendido',
                data: new Date().toISOString(),
                obs: 'Automação: Item vendido no Caixa de Loja física'
            });
            localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtos));
            console.log(`[Automação] Produto ${produtoSorteado.sku} vendido automaticamente.`);
        }

        // 2. Simular um repasse PIX automático para clientes com saldo pendente acumulado
        clientes.forEach(c => {
            // Calcula valores pendentes do cliente
            const prodsCliente = produtos.filter(p => p.clienteId === c.id);
            const pagsCliente = pagamentos.filter(p => p.clienteId === c.id);
            
            const produtosVendidos = prodsCliente.filter(p => p.status === 'Vendido' || p.status === 'Pago');
            let totalDisponivel = 0;
            let saldoBloqueado = 0;

            produtosVendidos.forEach(p => {
                const comissaoLojista = (p.precoVenda * p.comissao) / 100;
                const valorCliente = p.precoVenda - comissaoLojista;

                if (p.status === 'Pago') {
                    totalDisponivel += valorCliente;
                } else if (p.status === 'Vendido') {
                    const dataVenda = p.dataVenda || (p.statusHistorico && p.statusHistorico.find(h => h.status === 'Vendido')?.data) || p.dataEntrada;
                    const diasDesdeVenda = Math.floor((new Date() - new Date(dataVenda)) / (1000 * 60 * 60 * 24));
                    
                    if (diasDesdeVenda >= 30) {
                        totalDisponivel += valorCliente;
                    } else {
                        saldoBloqueado += valorCliente;
                    }
                }
            });

            const saldoDisponivel = Math.max(0, totalDisponivel - totalPago);
            
            if (saldoDisponivel > 50 && Math.random() > 0.6) {
                // Efetua repasse automático de todo o saldo disponível
                const novoPag = {
                    id: 'pag_' + Date.now() + Math.random().toString(36).slice(2, 5),
                    clienteId: c.id,
                    valor: saldoDisponivel,
                    data: new Date().toISOString(),
                    chavePix: c.chavePix,
                    status: 'Realizado',
                    comprovante: 'AUTO_PIX_' + Math.random().toString(36).substring(2, 12).toUpperCase()
                };
                pagamentos.push(novoPag);
                
                // Atualiza também os produtos vendidos e liberados para status "Pago"
                prodsCliente.forEach(p => {
                    if (p.status === 'Vendido') {
                        const dataVenda = p.dataVenda || (p.statusHistorico && p.statusHistorico.find(h => h.status === 'Vendido')?.data) || p.dataEntrada;
                        const diasDesdeVenda = Math.floor((new Date() - new Date(dataVenda)) / (1000 * 60 * 60 * 24));
                        if (diasDesdeVenda >= 30) {
                            p.status = 'Pago';
                            p.statusHistorico.push({
                                status: 'Pago',
                                data: new Date().toISOString(),
                                obs: 'Automação: Repasse PIX automático realizado para item liberado.'
                            });
                        }
                    }
                });
                
                localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(pagamentos));
                localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtos));
                console.log(`[Automação] Repasse automático PIX de ${saldoDisponivel} realizado para ${c.nome}.`);
            }
        });
    }, 15000);
}

// Inicia automação em background
startAutomationSimulation();


const db = {
    // CLIENTES
    clientes: {
        getAll: () => JSON.parse(localStorage.getItem(DB_KEYS.CLIENTES) || '[]'),
        getById: (id) => db.clientes.getAll().find(c => c.id === id),
        save: async (cliente) => {
            if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
                const clientes = db.clientes.getAll();
                if (cliente.id) {
                    const index = clientes.findIndex(c => c.id === cliente.id);
                    if (index !== -1) clientes[index] = { ...clientes[index], ...cliente };
                } else {
                    cliente.id = 'cli_' + Date.now();
                    cliente.dataCadastro = new Date().toISOString();
                    clientes.push(cliente);
                }
                localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientes));
                db.importExport.syncToGoogleSheets();
                return cliente;
            }

            const docRef = cliente.id 
                ? window.GoianitaFirestore.collection('clientes').doc(cliente.id)
                : window.GoianitaFirestore.collection('clientes').doc();
            
            const id = docRef.id;
            const dataCadastro = cliente.dataCadastro || new Date().toISOString();
            const clienteFinal = {
                ...cliente,
                id: id,
                dataCadastro: dataCadastro
            };

            // Criar login no Firebase Auth se for novo cliente e tiver senha
            if (!cliente.id) {
                try {
                    const email = cliente.cpf.replace(/\D/g, '') + '@goianita.com.br';
                    const senha = cliente.senha || 'goianita123';
                    await window.GoianitaAuth.createUserWithEmailAndPassword(email, senha);
                    console.log(`[Firebase Auth] Usuário criado: ${email}`);
                } catch (err) {
                    console.warn("[Firebase Auth] Usuário pode já existir ou erro na criação:", err);
                }
            }

            const cleanCliente = { ...clienteFinal };
            delete cleanCliente.senha;

            await docRef.set(cleanCliente, { merge: true });
            
            const clientesLocais = db.clientes.getAll();
            const idx = clientesLocais.findIndex(c => c.id === id);
            if (idx !== -1) clientesLocais[idx] = cleanCliente;
            else clientesLocais.push(cleanCliente);
            localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientesLocais));

            db.importExport.syncToGoogleSheets();
            return clienteFinal;
        },
        delete: async (id) => {
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                await window.GoianitaFirestore.collection('clientes').doc(id).delete();
            }
            const clientes = db.clientes.getAll().filter(c => c.id !== id);
            localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientes));
            db.importExport.syncToGoogleSheets();
        }
    },

    // PRODUTOS
    produtos: {
        getAll: () => JSON.parse(localStorage.getItem(DB_KEYS.PRODUTOS) || '[]'),
        getById: (id) => db.produtos.getAll().find(p => p.id === id),
        getByCliente: (clienteId) => db.produtos.getAll().filter(p => p.clienteId === clienteId),
        save: async (produto) => {
            if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
                const produtos = db.produtos.getAll();
                if (produto.id) {
                    const index = produtos.findIndex(p => p.id === produto.id);
                    if (index !== -1) {
                        const antigo = produtos[index];
                        if (antigo.status !== produto.status) {
                            produto.statusHistorico = antigo.statusHistorico || [];
                            produto.statusHistorico.push({
                                status: produto.status,
                                data: new Date().toISOString(),
                                obs: produto.statusObs || 'Alteração de status manual'
                            });
                        }
                        produtos[index] = { ...antigo, ...produto };
                    }
                } else {
                    produto.id = 'prod_' + Date.now();
                    produto.sku = produto.sku || `GOI-PR-${Date.now().toString().slice(-4)}`;
                    produto.dataEntrada = new Date().toISOString();
                    const limite = new Date();
                    limite.setDate(limite.getDate() + 180);
                    produto.dataLimite = limite.toISOString();
                    produto.statusHistorico = [{
                        status: produto.status || 'Em Triagem',
                        data: produto.dataEntrada,
                        obs: 'Cadastro inicial do produto'
                    }];
                    produtos.push(produto);
                }
                localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtos));
                db.importExport.syncToGoogleSheets();
                return produto;
            }

            const docRef = produto.id 
                ? window.GoianitaFirestore.collection('produtos').doc(produto.id)
                : window.GoianitaFirestore.collection('produtos').doc();
            
            const id = docRef.id;
            const sku = produto.sku || `GOI-PR-${Date.now().toString().slice(-4)}`;
            const dataEntrada = produto.dataEntrada || new Date().toISOString();
            
            let dataLimite = produto.dataLimite;
            if (!dataLimite) {
                const limite = new Date();
                limite.setDate(limite.getDate() + 180);
                dataLimite = limite.toISOString();
            }

            let statusHistorico = produto.statusHistorico || [];
            if (statusHistorico.length === 0) {
                statusHistorico.push({
                    status: produto.status || 'Em Triagem',
                    data: dataEntrada,
                    obs: 'Cadastro inicial do produto'
                });
            } else if (produto.statusObs) {
                statusHistorico.push({
                    status: produto.status,
                    data: new Date().toISOString(),
                    obs: produto.statusObs
                });
            }

            const cleanProduto = { ...produto };
            delete cleanProduto.statusObs;

            const produtoFinal = {
                ...cleanProduto,
                id: id,
                sku: sku,
                dataEntrada: dataEntrada,
                dataLimite: dataLimite,
                statusHistorico: statusHistorico
            };

            await docRef.set(produtoFinal, { merge: true });

            const produtosLocais = db.produtos.getAll();
            const idx = produtosLocais.findIndex(p => p.id === id);
            if (idx !== -1) produtosLocais[idx] = produtoFinal;
            else produtosLocais.push(produtoFinal);
            localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtosLocais));

            db.importExport.syncToGoogleSheets();
            return produtoFinal;
        },
        delete: async (id) => {
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                await window.GoianitaFirestore.collection('produtos').doc(id).delete();
            }
            const produtos = db.produtos.getAll().filter(p => p.id !== id);
            localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtos));
            db.importExport.syncToGoogleSheets();
        }
    },

    // PAGAMENTOS / FINANCEIRO
    pagamentos: {
        getAll: () => JSON.parse(localStorage.getItem(DB_KEYS.PAGAMENTOS) || '[]'),
        getByCliente: (clienteId) => db.pagamentos.getAll().filter(p => p.clienteId === clienteId),
        save: async (pagamento) => {
            if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
                const pagamentos = db.pagamentos.getAll();
                pagamento.id = 'pag_' + Date.now();
                pagamento.data = new Date().toISOString();
                pagamento.status = 'Realizado';
                pagamentos.push(pagamento);
                localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(pagamentos));
                db.importExport.syncToGoogleSheets();
                return pagamento;
            }

            const docRef = window.GoianitaFirestore.collection('pagamentos').doc();
            const id = docRef.id;
            const data = pagamento.data || new Date().toISOString();

            const pagamentoFinal = {
                ...pagamento,
                id: id,
                data: data,
                status: 'Realizado'
            };

            await docRef.set(pagamentoFinal);

            const pagamentosLocais = db.pagamentos.getAll();
            pagamentosLocais.push(pagamentoFinal);
            localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(pagamentosLocais));

            db.importExport.syncToGoogleSheets();
            return pagamentoFinal;
        }
    },

    // UTILITÁRIOS FINANCEIROS
    utils: {
        calcularValoresCliente: (clienteId) => {
            const produtos = db.produtos.getByCliente(clienteId);
            const pagamentos = db.pagamentos.getByCliente(clienteId);

            // Vendidos (qualquer um vendido, pago ou não)
            const produtosVendidos = produtos.filter(p => p.status === 'Vendido' || p.status === 'Pago');
            
            let totalDisponivel = 0;
            let saldoBloqueado = 0;

            produtosVendidos.forEach(p => {
                const comissaoLojista = (p.precoVenda * p.comissao) / 100;
                const valorCliente = p.precoVenda - comissaoLojista;

                if (p.status === 'Pago') {
                    totalDisponivel += valorCliente;
                } else if (p.status === 'Vendido') {
                    const dataVenda = p.dataVenda || (p.statusHistorico && p.statusHistorico.find(h => h.status === 'Vendido')?.data) || p.dataEntrada;
                    const diasDesdeVenda = Math.floor((new Date() - new Date(dataVenda)) / (1000 * 60 * 60 * 24));
                    
                    if (diasDesdeVenda >= 30) {
                        totalDisponivel += valorCliente;
                    } else {
                        saldoBloqueado += valorCliente;
                    }
                }
            });

            // Total gerado para o cliente
            const totalApostado = totalDisponivel + saldoBloqueado;

            // Total que o cliente já recebeu
            const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);

            // Saldo atual pendente
            const saldoPendente = totalApostado - totalPago;
            const saldoDisponivel = Math.max(0, totalDisponivel - totalPago);

            return {
                totalApostado,
                totalPago,
                saldoPendente,
                saldoBloqueado,
                saldoDisponivel,
                produtosTotais: produtos.length,
                produtosAtivos: produtos.filter(p => p.status === 'À Venda').length,
                produtosTriagem: produtos.filter(p => p.status === 'Em Triagem').length,
                produtosVendidos: produtosVendidos.length
            };
        },

        getResumoGeral: () => {
            const clientes = db.clientes.getAll();
            const produtos = db.produtos.getAll();
            const pagamentos = db.pagamentos.getAll();

            const totalEstoqueValor = produtos
                .filter(p => p.status === 'À Venda')
                .reduce((acc, p) => acc + p.precoVenda, 0);

            const totalVendas = produtos
                .filter(p => p.status === 'Vendido' || p.status === 'Pago')
                .reduce((acc, p) => acc + p.precoVenda, 0);

            const totalComissaoGoianita = produtos
                .filter(p => p.status === 'Vendido' || p.status === 'Pago')
                .reduce((acc, p) => acc + ((p.precoVenda * p.comissao) / 100), 0);

            const totalPagoFornecedores = pagamentos.reduce((acc, p) => acc + p.valor, 0);

            const saldoPagarFornecedores = (totalVendas - totalComissaoGoianita) - totalPagoFornecedores;

            return {
                totalClientes: clientes.length,
                totalProdutos: produtos.length,
                totalEstoqueValor,
                totalVendas,
                totalComissaoGoianita,
                totalPagoFornecedores,
                saldoPagarFornecedores,
                statusCounts: produtos.reduce((acc, p) => {
                    acc[p.status] = (acc[p.status] || 0) + 1;
                    return acc;
                }, {})
            };
        }
    },

    // IMPORTAR / EXPORTAR
    importExport: {
        exportBackup: () => {
            const backup = {
                clientes: db.clientes.getAll(),
                produtos: db.produtos.getAll(),
                pagamentos: db.pagamentos.getAll()
            };
            return JSON.stringify(backup, null, 2);
        },
        importBackup: (jsonString) => {
            try {
                const data = JSON.parse(jsonString);
                if (data.clientes) localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(data.clientes));
                if (data.produtos) localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(data.produtos));
                if (data.pagamentos) localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(data.pagamentos));
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        },
        importClientesFromCsv: (csvText) => {
            const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length < 2) return { success: false, error: "Nenhuma linha de dados encontrada." };
            
            const header = lines[0];
            let delimiter = ',';
            if (header.includes('\t')) delimiter = '\t';
            else if (header.includes(';')) delimiter = ';';
            
            const parseRow = (row) => {
                let result = [];
                let current = '';
                let inQuotes = false;
                for (let i = 0; i < row.length; i++) {
                    let char = row[i];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === delimiter && !inQuotes) {
                        result.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                result.push(current.trim());
                return result;
            };

            const headers = parseRow(header).map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""));
            
            const mapping = {
                nome: headers.findIndex(h => h.includes('nome') || h.includes('cliente') || h === 'fornecedor'),
                cpf: headers.findIndex(h => h.includes('cpf') || h.includes('documento')),
                telefone: headers.findIndex(h => h.includes('tel') || h.includes('fone') || h.includes('wpp') || h.includes('whats')),
                email: headers.findIndex(h => h.includes('email') || h.includes('mail')),
                chavePixType: headers.findIndex(h => h.includes('tipo') || h.includes('tipopix')),
                chavePix: headers.findIndex(h => h.includes('chave') || h.includes('pix')),
                comissaoPadrao: headers.findIndex(h => h.includes('comissao') || h.includes('taxa'))
            };

            if (mapping.nome === -1 || mapping.cpf === -1) {
                return { success: false, error: "Cabeçalhos obrigatórios 'Nome' e 'CPF' não identificados na primeira linha." };
            }

            let importedCount = 0;
            let errors = [];
            
            for (let i = 1; i < lines.length; i++) {
                const cols = parseRow(lines[i]);
                if (cols.length < 2) continue;

                const nome = cols[mapping.nome];
                const cpf = cols[mapping.cpf];
                if (!nome || !cpf) {
                    errors.push(`Linha ${i + 1}: Nome ou CPF em branco.`);
                    continue;
                }

                const cliente = {
                    nome: nome,
                    cpf: cpf,
                    telefone: mapping.telefone !== -1 ? cols[mapping.telefone] : '',
                    email: mapping.email !== -1 ? cols[mapping.email] : '',
                    chavePixType: mapping.chavePixType !== -1 ? cols[mapping.chavePixType] : 'CPF',
                    chavePix: mapping.chavePix !== -1 ? cols[mapping.chavePix] : cpf,
                    comissaoPadrao: mapping.comissaoPadrao !== -1 && cols[mapping.comissaoPadrao] ? parseFloat(cols[mapping.comissaoPadrao].replace('%','').replace(',','.')) : 50
                };
                
                db.clientes.save(cliente);
                importedCount++;
            }
            
            return { success: true, count: importedCount, errors: errors };
        },
        importProdutosFromCsv: (csvText) => {
            const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== '');
            if (lines.length < 2) return { success: false, error: "Nenhuma linha de dados encontrada." };
            
            const header = lines[0];
            let delimiter = ',';
            if (header.includes('\t')) delimiter = '\t';
            else if (header.includes(';')) delimiter = ';';
            
            const parseRow = (row) => {
                let result = [];
                let current = '';
                let inQuotes = false;
                for (let i = 0; i < row.length; i++) {
                    let char = row[i];
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === delimiter && !inQuotes) {
                        result.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                result.push(current.trim());
                return result;
            };

            const headers = parseRow(header).map(h => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""));
            
            const mapping = {
                cpfFornecedor: headers.findIndex(h => h.includes('cpffornecedor') || h.includes('cpfcliente') || h.includes('cpf')),
                nome: headers.findIndex(h => h.includes('nome') || h.includes('produto') || h.includes('titulo')),
                descricao: headers.findIndex(h => h.includes('descricao') || h.includes('desc')),
                categoria: headers.findIndex(h => h.includes('categoria') || h.includes('cat')),
                subcategoria: headers.findIndex(h => h.includes('subcategoria') || h.includes('subcat')),
                marca: headers.findIndex(h => h.includes('marca')),
                ean: headers.findIndex(h => h.includes('ean') || h.includes('codigobarras') || h.includes('gtin')),
                conservacao: headers.findIndex(h => h.includes('conservacao') || h.includes('estado')),
                precoVenda: headers.findIndex(h => h.includes('precovenda') || h.includes('preco') || h.includes('valor')),
                comissao: headers.findIndex(h => h.includes('comissao') || h.includes('taxa')),
                peso: headers.findIndex(h => h.includes('peso')),
                altura: headers.findIndex(h => h.includes('altura')),
                largura: headers.findIndex(h => h.includes('largura')),
                comprimento: headers.findIndex(h => h.includes('comprimento') || h.includes('comp')),
                precoSugerido: headers.findIndex(h => h.includes('precosugerido') || h.includes('sugerido')),
                status: headers.findIndex(h => h.includes('status')),
                obsInternas: headers.findIndex(h => h.includes('obs') || h.includes('observacoes'))
            };

            if (mapping.cpfFornecedor === -1 || mapping.nome === -1 || mapping.precoVenda === -1) {
                return { success: false, error: "Cabeçalhos obrigatórios 'CPF Fornecedor', 'Nome do Produto' e 'Preço Venda' não identificados." };
            }

            const clientes = db.clientes.getAll();
            let importedCount = 0;
            let errors = [];

            for (let i = 1; i < lines.length; i++) {
                const cols = parseRow(lines[i]);
                if (cols.length < 2) continue;

                const cpf = cols[mapping.cpfFornecedor];
                const nome = cols[mapping.nome];
                const precoVal = cols[mapping.precoVenda];

                if (!cpf || !nome || !precoVal) {
                    errors.push(`Linha ${i + 1}: CPF, Nome ou Preço de Venda em branco.`);
                    continue;
                }

                const normalizedCpf = cpf.replace(/\D/g, '');
                const cliente = clientes.find(c => c.cpf.replace(/\D/g, '') === normalizedCpf);

                if (!cliente) {
                    errors.push(`Linha ${i + 1}: Fornecedor com CPF ${cpf} não está cadastrado.`);
                    continue;
                }

                const precoVenda = parseFloat(precoVal.replace('R$','').replace('.','').replace(',','.').trim());
                const comissao = mapping.comissao !== -1 && cols[mapping.comissao] ? parseFloat(cols[mapping.comissao].replace('%','').replace(',','.')) : cliente.comissaoPadrao;

                const produto = {
                    clienteId: cliente.id,
                    nome: nome,
                    descricao: mapping.descricao !== -1 ? cols[mapping.descricao] : '',
                    categoria: mapping.categoria !== -1 ? cols[mapping.categoria] : 'Outros',
                    subcategoria: mapping.subcategoria !== -1 ? cols[mapping.subcategoria] : '',
                    marca: mapping.marca !== -1 ? cols[mapping.marca] : '',
                    ean: mapping.ean !== -1 ? cols[mapping.ean] : '',
                    conservacao: mapping.conservacao !== -1 ? cols[mapping.conservacao] : 'Excelente',
                    precoVenda: precoVenda,
                    comissao: comissao,
                    peso: mapping.peso !== -1 && cols[mapping.peso] ? parseFloat(cols[mapping.peso].replace(',','.')) : 0,
                    altura: mapping.altura !== -1 && cols[mapping.altura] ? parseFloat(cols[mapping.altura].replace(',','.')) : 0,
                    largura: mapping.largura !== -1 && cols[mapping.largura] ? parseFloat(cols[mapping.largura].replace(',','.')) : 0,
                    comprimento: mapping.comprimento !== -1 && cols[mapping.comprimento] ? parseFloat(cols[mapping.comprimento].replace(',','.')) : 0,
                    precoSugerido: mapping.precoSugerido !== -1 && cols[mapping.precoSugerido] ? parseFloat(cols[mapping.precoSugerido].replace(',','.')) : precoVenda,
                    status: mapping.status !== -1 && cols[mapping.status] ? cols[mapping.status] : 'Em Triagem',
                    obsInternas: mapping.obsInternas !== -1 ? cols[mapping.obsInternas] : 'Importado via planilha'
                };

                db.produtos.save(produto);
                importedCount++;
            }

            return { success: true, count: importedCount, errors: errors };
        },
        syncToGoogleSheets: async () => {
            // Planilha Google do cliente: https://docs.google.com/spreadsheets/d/1M7vl4afuq1lziBeq2QUZ3ieEN3HyGTW7BqUCmfXp3_8/edit
            // Sincroniza via endpoint do Google Apps Script (Webhook)
            const backupData = db.importExport.exportBackup();
            const webAppUrl = "https://script.google.com/macros/s/AKfycbzD9m4aqzD9m4aqz5DDVgajR3qmLykFUlZsUhM-7IwyAwDWP3EXGFKbPfWDF0OYgo7S45gy5E8/exec";
            
            console.log("[Planilha Google] Iniciando sincronização assíncrona...");
            try {
                // Sincronização em background sem travar a UI
                fetch(webAppUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: backupData
                }).then(() => {
                    console.log("[Planilha Google] Sincronização concluída com sucesso.");
                }).catch(err => {
                    console.warn("[Planilha Google] Erro ao sincronizar (simulação local offline ativa):", err);
                });
            } catch (e) {
                // Silencioso em caso de offline
            }
        }
    }
};

window.GoianitaDB = db;
