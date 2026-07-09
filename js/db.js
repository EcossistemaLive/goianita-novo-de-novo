/**
 * db.js - Camada de Banco de Dados Local (localStorage)
 * Casas Goianita - Sistema de Comodato e Consignação
 */

const DB_KEYS = {
    CLIENTES: 'goianita_consignacao_clientes',
    PRODUTOS: 'goianita_consignacao_produtos',
    PAGAMENTOS: 'goianita_consignacao_pagamentos',
    CONFIG: 'goianita_consignacao_config',
    TOMBSTONES: 'goianita_consignacao_tombstones'
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
    window.GoianitaStorage = firebase.storage();

    // Habilitar persistência off-line se possível
    window.GoianitaFirestore.enablePersistence().catch(err => {
        console.warn("[Firebase Firestore] Falha ao habilitar persistência offline:", err.code);
    });
}

/**
 * FLAG DE MODO SIMULAÇÃO
 * Em produção, defina como false para desativar a automação de vendas/repasses.
 * Em desenvolvimento/demo, mantenha como true para ver dados se movimentando.
 *
 * IMPORTANTE: em produção esta flag DEVE permanecer false. Quando true, o app
 * marca produtos como "Vendido" e emite repasses PIX automáticos fictícios a
 * cada 15s, gerando vendas e pagamentos que não aconteceram de verdade.
 */
const GOIANITA_SIMULATION_MODE = false;

/**
 * Converte um valor monetário em texto (pt-BR) para número.
 * Trata separador de milhar (ponto) e decimal (vírgula) corretamente.
 * Exemplos: "R$ 1.399,00" -> 1399.00 | "399,90" -> 399.9 | "399.90" -> 399.9
 */
function parseMoedaBR(valor) {
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    let s = String(valor).replace(/[R$\s]/g, '');
    if (s.indexOf(',') !== -1) {
        // Vírgula presente: é o separador decimal; pontos são de milhar.
        s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}
window.parseMoedaBR = parseMoedaBR;

/**
 * TOMBSTONES (marcas de exclusão)
 * Guardam os IDs de registros que foram apagados de propósito. A sincronização em
 * tempo real usa isso para NUNCA re-enviar/re-exibir um item excluído — resolvendo o
 * bug de "ressurreição" mesmo entre dispositivos/abas diferentes. Ao recadastrar um
 * item (save), o ID sai da lista de tombstones para voltar a existir normalmente.
 */
function getTombstones() {
    try { return JSON.parse(localStorage.getItem(DB_KEYS.TOMBSTONES) || '{}'); }
    catch (e) { return {}; }
}
function addTombstone(colecao, id) {
    if (!id) return;
    const t = getTombstones();
    t[colecao] = t[colecao] || [];
    if (!t[colecao].includes(id)) t[colecao].push(id);
    localStorage.setItem(DB_KEYS.TOMBSTONES, JSON.stringify(t));
}
function removeTombstone(colecao, id) {
    if (!id) return;
    const t = getTombstones();
    if (t[colecao] && t[colecao].includes(id)) {
        t[colecao] = t[colecao].filter(x => x !== id);
        localStorage.setItem(DB_KEYS.TOMBSTONES, JSON.stringify(t));
    }
}
function tombstonesDe(colecao) {
    return getTombstones()[colecao] || [];
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
let firestoreSyncInitialized = false;

function setupFirestoreSync() {
    if (typeof firebase === 'undefined' || !window.GoianitaFirestore || !window.GoianitaAuth) {
        console.warn("[Firebase] SDK não carregado. Operando local-only.");
        return;
    }

    window.GoianitaAuth.onAuthStateChanged((user) => {
        if (user && !firestoreSyncInitialized) {
            firestoreSyncInitialized = true;
            console.log("[Firebase] Usuário autenticado. Iniciando sincronização em tempo real com Firestore...");

            let syncCount = 0;
            const checkSync = () => {
                syncCount++;
                if (syncCount === 3) window.dispatchEvent(new Event('goianitaDataChanged'));
            };

            // Sincronizar clientes
            window.GoianitaFirestore.collection('clientes').onSnapshot(snapshot => {
                const tomb = tombstonesDe('clientes');
                const firebaseClientes = [];
                snapshot.forEach(doc => {
                    if (tomb.includes(doc.id)) {
                        // Item marcado como excluído mas ainda presente no Firebase: apaga de novo e ignora.
                        window.GoianitaFirestore.collection('clientes').doc(doc.id).delete().catch(() => {});
                    } else {
                        firebaseClientes.push({ id: doc.id, ...doc.data() });
                    }
                });

                const localClientes = JSON.parse(localStorage.getItem(DB_KEYS.CLIENTES) || '[]')
                    .filter(c => !tomb.includes(c.id));
                const toUpload = localClientes.filter(localC => !tomb.includes(localC.id) && !firebaseClientes.some(fbC => fbC.id === localC.id));

                toUpload.forEach(async (c) => {
                    try { await window.GoianitaFirestore.collection('clientes').doc(c.id).set(c, {merge: true}); } catch(e){}
                });

                const merged = [...firebaseClientes, ...toUpload];
                localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(merged));

                // Consolida duplicatas por CPF que possam ter vindo do merge (offline/online, multi-dispositivo).
                try { if (window.GoianitaDB) window.GoianitaDB.utils.dedupeClientesByCpf(); } catch (e) { console.warn('[Dedupe] falhou:', e); }

                window.dispatchEvent(new Event('goianitaDataChanged'));
                if(syncCount < 3) checkSync();
            }, err => console.error("Erro no sync de clientes:", err));

            // Sincronizar produtos
            window.GoianitaFirestore.collection('produtos').onSnapshot(snapshot => {
                const tomb = tombstonesDe('produtos');
                const firebaseProdutos = [];
                snapshot.forEach(doc => {
                    if (tomb.includes(doc.id)) {
                        window.GoianitaFirestore.collection('produtos').doc(doc.id).delete().catch(() => {});
                    } else {
                        firebaseProdutos.push({ id: doc.id, ...doc.data() });
                    }
                });

                const localProdutos = JSON.parse(localStorage.getItem(DB_KEYS.PRODUTOS) || '[]')
                    .filter(p => !tomb.includes(p.id));
                const toUpload = localProdutos.filter(localP => !tomb.includes(localP.id) && !firebaseProdutos.some(fbP => fbP.id === localP.id));

                toUpload.forEach(async (p) => {
                    try { await window.GoianitaFirestore.collection('produtos').doc(p.id).set(p, {merge: true}); } catch(e){}
                });

                const merged = [...firebaseProdutos, ...toUpload];
                localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(merged));

                window.dispatchEvent(new Event('goianitaDataChanged'));
                if(syncCount < 3) checkSync();
            }, err => console.error("Erro no sync de produtos:", err));

            // Sincronizar pagamentos
            window.GoianitaFirestore.collection('pagamentos').onSnapshot(snapshot => {
                const firebasePagamentos = [];
                snapshot.forEach(doc => firebasePagamentos.push({ id: doc.id, ...doc.data() }));

                const localPagamentos = JSON.parse(localStorage.getItem(DB_KEYS.PAGAMENTOS) || '[]');
                const toUpload = localPagamentos.filter(localP => !firebasePagamentos.some(fbP => fbP.id === localP.id));

                toUpload.forEach(async (p) => {
                    try { await window.GoianitaFirestore.collection('pagamentos').doc(p.id).set(p, {merge: true}); } catch(e){}
                });

                const merged = [...firebasePagamentos, ...toUpload];
                localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(merged));

                window.dispatchEvent(new Event('goianitaDataChanged'));
                if(syncCount < 3) checkSync();
            }, err => console.error("Erro no sync de pagamentos:", err));
        } else if (!user) {
            console.warn("[Firebase] Usuário não autenticado. Sincronização pausada/não iniciada.");
        }
    });
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

            const totalPago = pagsCliente.reduce((acc, p) => acc + (p.valor || 0), 0);
            const saldoDisponivel = Math.max(0, totalDisponivel - totalPago);

            if (saldoDisponivel > 50 && Math.random() > 0.6) {
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

// Inicia automação apenas no modo de simulação/demonstração
if (GOIANITA_SIMULATION_MODE) {
    startAutomationSimulation();
    console.log('[Simulação] Modo de demonstração ATIVO. Vendas e repasses automáticos em execução a cada 15s.');
} else {
    console.log('[Produção] Modo de simulação DESATIVADO. Dados controlados manualmente.');
}


const db = {
    // CLIENTES
    clientes: {
        getAll: () => JSON.parse(localStorage.getItem(DB_KEYS.CLIENTES) || '[]'),
        getById: (id) => db.clientes.getAll().find(c => c.id === id),
        save: async (cliente, skipSync = false) => {
            const clientesAtuais = db.clientes.getAll();

            // CPF/CNPJ normalizado (somente dígitos) — base para dedupe e ID determinístico.
            const cpfLimpo = cliente.cpf ? String(cliente.cpf).replace(/\D/g, '') : '';

            // Validação de duplicidade de CPF/CNPJ para novos cadastros
            if (!cliente.id && cpfLimpo) {
                const duplicado = clientesAtuais.find(c => c.cpf && String(c.cpf).replace(/\D/g, '') === cpfLimpo);
                if (duplicado) {
                    throw new Error(`Já existe um fornecedor cadastrado com o CPF/CNPJ ${cliente.cpf} (${duplicado.nome}).`);
                }
            }

            // ID determinístico baseado no CPF: o MESMO CPF sempre gera o MESMO registro/
            // documento, evitando duplicatas entre cadastros offline/online e entre dispositivos.
            // Sem CPF, usa timestamp como fallback.
            const idNovo = cpfLimpo ? ('cli_' + cpfLimpo) : ('cli_' + Date.now());

            // Cadastrar/editar reativa o registro: remove qualquer tombstone desse ID
            // (importante porque o ID é determinístico por CPF — permite recadastrar
            // um fornecedor que havia sido excluído).
            removeTombstone('clientes', cliente.id || idNovo);

            if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
                const clientes = clientesAtuais;
                if (cliente.id) {
                    const index = clientes.findIndex(c => c.id === cliente.id);
                    if (index !== -1) clientes[index] = { ...clientes[index], ...cliente };
                } else {
                    cliente.id = idNovo;
                    cliente.dataCadastro = new Date().toISOString();
                    // Se já existir registro com esse ID (corrida/reprocessamento), atualiza em vez de duplicar.
                    const existente = clientes.findIndex(c => c.id === cliente.id);
                    if (existente !== -1) clientes[existente] = { ...clientes[existente], ...cliente };
                    else clientes.push(cliente);
                }
                localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientes));
                if (!skipSync) db.importExport.syncToGoogleSheets();
                return cliente;
            }

            const docRef = cliente.id
                ? window.GoianitaFirestore.collection('clientes').doc(cliente.id)
                : window.GoianitaFirestore.collection('clientes').doc(idNovo);

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

                    let secondaryApp;
                    try {
                        secondaryApp = firebase.app("Secondary");
                    } catch (e) {
                        secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
                    }

                    await secondaryApp.auth().createUserWithEmailAndPassword(email, senha);
                    await secondaryApp.auth().signOut();
                    console.log(`[Firebase Auth] Usuário criado de forma silenciosa (sem deslogar o admin): ${email}`);
                } catch (err) {
                    console.warn("[Firebase Auth] Usuário pode já existir ou erro na criação:", err);
                }
            }

            const cleanCliente = { ...clienteFinal };
            delete cleanCliente.senha;
            try {
                await docRef.set(cleanCliente, { merge: true });
            } catch (err) {
                console.error("[Firebase] Erro ao salvar cliente:", err);
                alert("Aviso: Falha ao salvar no banco em nuvem. Salvo apenas localmente.");
            }

            const clientesLocais = db.clientes.getAll();
            const idx = clientesLocais.findIndex(c => c.id === id);
            if (idx !== -1) clientesLocais[idx] = cleanCliente;
            else clientesLocais.push(cleanCliente);
            localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientesLocais));

            if (!skipSync) db.importExport.syncToGoogleSheets();
            return clienteFinal;
        },
        delete: async (id) => {
            // Reúne o alvo + eventuais duplicados do mesmo CPF, para que a exclusão
            // não deixe um registro-fantasma que o sync do Firestore traria de volta.
            const alvo = db.clientes.getById(id);
            const cpfLimpo = alvo && alvo.cpf ? String(alvo.cpf).replace(/\D/g, '') : '';
            const idsRemover = db.clientes.getAll()
                .filter(c => c.id === id || (cpfLimpo && c.cpf && String(c.cpf).replace(/\D/g, '') === cpfLimpo))
                .map(c => c.id);
            if (idsRemover.indexOf(id) === -1) idsRemover.push(id);
            idsRemover.forEach(rid => addTombstone('clientes', rid));

            // Remove do localStorage ANTES do Firestore (mesma correção de produtos.delete):
            // evita que o sync em tempo real re-envie o cliente durante o await.
            const clientes = db.clientes.getAll().filter(c => idsRemover.indexOf(c.id) === -1);
            localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientes));

            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                for (const rid of idsRemover) {
                    try {
                        await window.GoianitaFirestore.collection('clientes').doc(rid).delete();
                    } catch(err) {
                        console.error("[Firebase] Erro ao excluir cliente:", err);
                    }
                }
            }
            db.importExport.syncToGoogleSheets();
        }
    },

    // PRODUTOS
    produtos: {
        getAll: () => JSON.parse(localStorage.getItem(DB_KEYS.PRODUTOS) || '[]'),
        getById: (id) => db.produtos.getAll().find(p => p.id === id),
        getByCliente: (clienteId) => db.produtos.getAll().filter(p => p.clienteId === clienteId),
        save: async (produto, skipSync = false) => {
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

            // Detecta alteração de status comparando com o registro já persistido localmente,
            // para manter o histórico consistente também no fluxo Firestore.
            const anterior = produto.id ? db.produtos.getById(produto.id) : null;
            const statusMudou = anterior && anterior.status !== produto.status;

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
            } else if (statusMudou) {
                statusHistorico.push({
                    status: produto.status,
                    data: new Date().toISOString(),
                    obs: 'Alteração de status'
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

            try {
                await docRef.set(produtoFinal, { merge: true });
            } catch(e) {
                console.error("Erro no Firestore, salvando apenas localmente: ", e);
                alert("Aviso: Falha ao salvar no banco em nuvem. Salvo apenas localmente.");
            }

            const produtosLocais = db.produtos.getAll();
            const idx = produtosLocais.findIndex(p => p.id === id);
            if (idx !== -1) produtosLocais[idx] = produtoFinal;
            else produtosLocais.push(produtoFinal);
            localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtosLocais));

            if (!skipSync) db.importExport.syncToGoogleSheets();
            return produtoFinal;
        },
        delete: async (id) => {
            // Remove do localStorage ANTES de apagar do Firestore. Assim, quando o listener
            // em tempo real disparar durante o await, o item já não existe localmente e a
            // rotina de sync NÃO o re-envia de volta ao Firebase (bug de "ressurreição":
            // o produto voltava a aparecer na lista mesmo após confirmar a exclusão).
            addTombstone('produtos', id);
            const produtos = db.produtos.getAll().filter(p => p.id !== id);
            localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtos));

            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                try {
                    await window.GoianitaFirestore.collection('produtos').doc(id).delete();
                } catch(err) {
                    console.error("[Firebase] Erro ao excluir produto:", err);
                }
            }
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
            try {
                await docRef.set(pagamentoFinal);
            } catch (err) {
                console.error("[Firebase] Erro ao salvar pagamento:", err);
                alert("Aviso: Falha ao salvar no banco em nuvem. Salvo apenas localmente.");
            }

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

            const totalApostado = totalDisponivel + saldoBloqueado;
            const totalPago = pagamentos.reduce((acc, p) => acc + (p.valor || 0), 0);
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
                .reduce((acc, p) => acc + (p.precoVenda || 0), 0);

            const totalVendas = produtos
                .filter(p => p.status === 'Vendido' || p.status === 'Pago')
                .reduce((acc, p) => acc + (p.precoVenda || 0), 0);

            const totalComissaoGoianita = produtos
                .filter(p => p.status === 'Vendido' || p.status === 'Pago')
                .reduce((acc, p) => acc + (((p.precoVenda || 0) * (p.comissao || 0)) / 100), 0);

            const totalPagoFornecedores = pagamentos.reduce((acc, p) => acc + (p.valor || 0), 0);

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
        },

        /**
         * Consolida fornecedores duplicados pelo CPF/CNPJ.
         * Mantém o cadastro mais antigo como canônico, completa campos vazios com os
         * dados dos duplicados, remapeia os produtos para o registro canônico e remove
         * os duplicados (local e no Firestore). Não apaga produtos nem pagamentos.
         * Retorna true se consolidou algo. Seguro para rodar múltiplas vezes.
         */
        dedupeClientesByCpf: () => {
            const norm = (s) => (s ? String(s).replace(/\D/g, '') : '');
            const clientes = db.clientes.getAll();

            const grupos = {};
            const semCpf = [];
            clientes.forEach(c => {
                const key = norm(c.cpf);
                if (!key) { semCpf.push(c); return; }
                (grupos[key] = grupos[key] || []).push(c);
            });

            const idRemap = {};      // idDuplicado -> idCanonico
            const idsRemovidos = [];
            const canonicais = [];

            Object.keys(grupos).forEach(key => {
                const grupo = grupos[key];
                if (grupo.length === 1) { canonicais.push(grupo[0]); return; }

                // Canônico = cadastro mais antigo (preserva o registro original).
                grupo.sort((a, b) => new Date(a.dataCadastro || 0) - new Date(b.dataCadastro || 0));
                const canonico = grupo[0];

                grupo.slice(1).forEach(dup => {
                    // Completa campos vazios do canônico com os dados do duplicado.
                    ['nome', 'telefone', 'email', 'chavePix', 'chavePixType', 'comissaoPadrao'].forEach(f => {
                        const vazio = canonico[f] === undefined || canonico[f] === null || canonico[f] === '';
                        if (vazio && dup[f] !== undefined && dup[f] !== '') canonico[f] = dup[f];
                    });
                    if (dup.id !== canonico.id) {
                        idRemap[dup.id] = canonico.id;
                        idsRemovidos.push(dup.id);
                    }
                });
                canonicais.push(canonico);
            });

            if (idsRemovidos.length === 0) return false;

            // Marca os duplicados removidos como tombstone para não voltarem pelo sync.
            idsRemovidos.forEach(rid => addTombstone('clientes', rid));

            // Reescreve a lista de clientes sem duplicatas.
            localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify([...canonicais, ...semCpf]));

            // Remapeia produtos que apontavam para IDs removidos.
            const produtos = db.produtos.getAll();
            const produtosRemapeados = [];
            produtos.forEach(p => {
                if (idRemap[p.clienteId]) {
                    p.clienteId = idRemap[p.clienteId];
                    produtosRemapeados.push(p);
                }
            });
            if (produtosRemapeados.length > 0) {
                localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtos));
            }

            // Propaga a limpeza para o Firestore, se disponível.
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                idsRemovidos.forEach(id => {
                    window.GoianitaFirestore.collection('clientes').doc(id).delete().catch(() => {});
                });
                produtosRemapeados.forEach(p => {
                    window.GoianitaFirestore.collection('produtos').doc(p.id).set({ clienteId: p.clienteId }, { merge: true }).catch(() => {});
                });
            }

            console.warn(`[Dedupe] ${idsRemovidos.length} fornecedor(es) duplicado(s) consolidado(s) por CPF.`);
            window.dispatchEvent(new Event('goianitaDataChanged'));
            return true;
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
        importClientesFromCsv: async (csvText) => {
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

            const headers = parseRow(header).map(h => h.toLowerCase().normalize("NFD").replace(/[^\x00-\x7F]/g, "").replace(/[^a-z0-9]/g, ""));

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

                try {
                    await db.clientes.save(cliente, true);
                    importedCount++;
                } catch (err) {
                    errors.push(`Linha ${i + 1}: Erro ao salvar no Firestore: ${err.message}`);
                }
            }

            // Sincroniza planilha Google apenas uma vez ao final do lote
            await db.importExport.syncToGoogleSheets();
            return { success: true, count: importedCount, errors: errors };
        },
        importProdutosFromCsv: async (csvText) => {
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

            const headers = parseRow(header).map(h => h.toLowerCase().normalize("NFD").replace(/[^\x00-\x7F]/g, "").replace(/[^a-z0-9]/g, ""));

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

                const precoVenda = parseMoedaBR(precoVal);
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
                    precoSugerido: mapping.precoSugerido !== -1 && cols[mapping.precoSugerido] ? parseMoedaBR(cols[mapping.precoSugerido]) : precoVenda,
                    status: mapping.status !== -1 && cols[mapping.status] ? cols[mapping.status] : 'Em Triagem',
                    obsInternas: mapping.obsInternas !== -1 ? cols[mapping.obsInternas] : 'Importado via planilha'
                };

                try {
                    await db.produtos.save(produto, true);
                    importedCount++;
                } catch (err) {
                    errors.push(`Linha ${i + 1}: Erro ao salvar no Firestore: ${err.message}`);
                }
            }

            await db.importExport.syncToGoogleSheets();
            return { success: true, count: importedCount, errors: errors };
        },
        /**
         * Zera TUDO de verdade: apaga também os documentos do Firestore (não só o local).
         * Antes, "zerar" limpava só o localStorage e o sync trazia os dados de volta.
         */
        zerarTudo: async () => {
            // 1. Limpa local e tombstones.
            localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify([]));
            localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify([]));
            localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify([]));
            localStorage.setItem(DB_KEYS.TOMBSTONES, JSON.stringify({}));

            // 2. Apaga os documentos no Firestore, coleção por coleção.
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                for (const col of ['clientes', 'produtos', 'pagamentos']) {
                    try {
                        const snap = await window.GoianitaFirestore.collection(col).get();
                        for (const doc of snap.docs) {
                            try { await doc.ref.delete(); } catch (e) {}
                        }
                    } catch (e) {
                        console.error(`[Zerar] Falha ao limpar coleção ${col}:`, e);
                    }
                }
            }

            // 3. Espelha o estado vazio na planilha.
            await db.importExport.syncToGoogleSheets();
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

// Ao carregar, consolida fornecedores duplicados por CPF já existentes na base local
// (cura dados antigos criados antes do ID determinístico). Seguro rodar sempre.
try { db.utils.dedupeClientesByCpf(); } catch (e) { console.warn('[Dedupe] falhou ao iniciar:', e); }
