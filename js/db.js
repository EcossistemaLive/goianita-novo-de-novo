/**
 * db.js - Camada de Banco de Dados Local (localStorage)
 * Casas Goianita - Sistema de Comodato e Consignação
 */

const DB_KEYS = {
    CLIENTES: 'goianita_consignacao_clientes',
    PRODUTOS: 'goianita_consignacao_produtos',
    PAGAMENTOS: 'goianita_consignacao_pagamentos',
    EMBAIXADORES: 'goianita_consignacao_embaixadores',
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

    // A sessão precisa SOBREVIVER ao fechamento do navegador. Sem isso o admin voltava sem
    // usuário autenticado, a sincronização não iniciava e aquela máquina virava uma ilha:
    // ele cadastrava normalmente e ninguém mais via os dados.
    try {
        window.GoianitaAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
            .catch(e => console.warn('[Auth] Falha ao fixar persistência da sessão:', e && e.code));
    } catch (e) { /* SDK antigo: segue com o padrão */ }

    window.GoianitaFirestore = firebase.firestore();
    window.GoianitaStorage = firebase.storage();

    // Evita que um campo "undefined" (ex.: opcional não preenchido) faça o set() falhar
    // silenciosamente e o registro nunca chegar à nuvem. Precisa vir antes de qualquer uso.
    try { window.GoianitaFirestore.settings({ ignoreUndefinedProperties: true }); } catch (e) {}

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
 * TAXA DE IMPOSTO SOBRE VENDA
 * Utilizada para deduzir impostos do preço bruto antes da partilha de comissões (fornecedor, loja, embaixador).
 */
window.TAXA_IMPOSTO = 11;

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
 * Hash SHA-256 (hex) da senha do fornecedor, guardado no próprio cadastro.
 * O login do fornecedor deixa de depender do Firebase Auth: o admin reseta e o
 * cliente troca a senha direto no app (uma escrita no cadastro). Requer HTTPS
 * (crypto.subtle) — o GitHub Pages já é HTTPS.
 */
async function goianitaHash(texto) {
    const data = new TextEncoder().encode(String(texto == null ? '' : texto));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
window.goianitaHash = goianitaHash;

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
/**
 * A partir de 2026-07-31 cada exclusão guarda também QUANDO foi feita: `{ id, em }`.
 * Motivo: a lista de exclusões é privada de cada aparelho e nunca expirava, então um
 * aparelho que já tinha excluído um CPF passava a APAGAR DA NUVEM esse mesmo cadastro
 * sempre que ele fosse recriado em outra máquina (o ID é derivado do CPF). Com a data, a
 * exclusão só vale se for mais recente que o registro. Formato antigo (lista de textos)
 * continua sendo lido, mas é tratado como exclusão sem data — e nunca destrói dados.
 */
function addTombstone(colecao, id) {
    if (!id) return;
    const t = getTombstones();
    const lista = (t[colecao] || []).filter(x => (typeof x === 'string' ? x : x && x.id) !== id);
    lista.push({ id: id, em: new Date().toISOString() });
    t[colecao] = lista;
    localStorage.setItem(DB_KEYS.TOMBSTONES, JSON.stringify(t));
}
function removeTombstone(colecao, id) {
    if (!id) return;
    const t = getTombstones();
    if (!t[colecao]) return;
    t[colecao] = t[colecao].filter(x => (typeof x === 'string' ? x : x && x.id) !== id);
    localStorage.setItem(DB_KEYS.TOMBSTONES, JSON.stringify(t));
}
// Mantém o retorno como lista de IDs — todo o código existente usa `.includes(id)`.
function tombstonesDe(colecao) {
    return (getTombstones()[colecao] || []).map(x => (typeof x === 'string' ? x : (x && x.id))).filter(Boolean);
}
// Expostos para a rotina de restauração de registros excluídos (js/app.js).
window.GoianitaRemoveTombstone = removeTombstone;
window.GoianitaTombstonesDe = tombstonesDe;
// Data da exclusão daquele ID (null se for do formato antigo, sem data).
function tombstoneEm(colecao, id) {
    const item = (getTombstones()[colecao] || []).find(x => (typeof x === 'string' ? x : x && x.id) === id);
    if (!item || typeof item === 'string') return null;
    return item.em || null;
}
// Data mais confiável do registro, para comparar com a exclusão.
function dataDoRegistro(d) {
    return (d && (d.atualizadoEm || d.dataCadastro || d.dataEntrada || d.data)) || null;
}
/**
 * O registro que veio da nuvem é MAIS NOVO que a exclusão local? Se sim, ele foi recriado
 * depois e deve ser aceito (a exclusão virou obsoleta e é descartada). Se a exclusão não
 * tem data (formato antigo), NUNCA destruímos o registro — prioridade é não perder dado.
 */
function registroSuperaExclusao(colecao, id, dados) {
    const em = tombstoneEm(colecao, id);
    if (!em) return true;
    const dr = dataDoRegistro(dados);
    if (!dr) return false;
    return new Date(dr).getTime() > (new Date(em).getTime() + 1000);
}

/**
 * FILA DE REENVIO (sincronização automática)
 * IDs de registros que ainda NÃO tiveram a gravação confirmada no Firestore. O app tenta
 * esvaziar essa fila sozinho (ao abrir, quando a internet volta e a cada 15s), para que um
 * cadastro feito num aparelho suba para a nuvem e apareça nos outros logins/celular sem
 * depender de clicar em nada.
 */
const PENDING_SYNC_KEY = 'goianita_pending_sync';
function getPendingSync() {
    try { return JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '{}'); }
    catch (e) { return {}; }
}
function setPendingSync(p) {
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(p));
}
function addPendingSync(colecao, id) {
    if (!id) return;
    const p = getPendingSync();
    p[colecao] = p[colecao] || [];
    if (!p[colecao].includes(id)) { p[colecao].push(id); setPendingSync(p); }
}
function removePendingSync(colecao, id) {
    const p = getPendingSync();
    if (p[colecao] && p[colecao].includes(id)) {
        p[colecao] = p[colecao].filter(x => x !== id);
        setPendingSync(p);
    }
}
function pendingSyncTotal() {
    const p = getPendingSync();
    return (p.clientes || []).length + (p.produtos || []).length + (p.pagamentos || []).length + (p.embaixadores || []).length;
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
    if (!localStorage.getItem(DB_KEYS.EMBAIXADORES)) {
        localStorage.setItem(DB_KEYS.EMBAIXADORES, JSON.stringify([]));
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
                const idsNaNuvemClientes = new Set(); // tudo que a nuvem conhece, inclusive excluídos
                snapshot.forEach(doc => {
                    const dados = doc.data();
                    idsNaNuvemClientes.add(doc.id);

                    // EXCLUSÃO COMPARTILHADA: a marca vive na nuvem, então TODO aparelho a
                    // respeita. É o que acaba com o registro excluído por um admin voltando
                    // pelo reenvio de outro.
                    if (dados.excluido === true) {
                        removeTombstone('clientes', doc.id); // marca local deixa de ser necessária
                        return;
                    }

                    // Marca de exclusão que existe SÓ neste aparelho (feita antes desta
                    // correção): propaga para a nuvem uma vez, em vez de apagar o documento.
                    // Apagar era o que fazia o outro aparelho reenviar e começar o vai-e-vem.
                    if (tomb.includes(doc.id)) {
                        if (registroSuperaExclusao('clientes', doc.id, dados)) {
                            removeTombstone('clientes', doc.id);
                            firebaseClientes.push({ id: doc.id, ...dados });
                        } else {
                            const agora = new Date().toISOString();
                            window.GoianitaFirestore.collection('clientes').doc(doc.id)
                                .set({ excluido: true, excluidoEm: agora, atualizadoEm: agora }, { merge: true })
                                .catch(() => {});
                        }
                        return;
                    }

                    firebaseClientes.push({ id: doc.id, ...dados });
                });

                const tombAtual = tombstonesDe('clientes'); // reler após possíveis removeTombstone acima
                const localClientes = JSON.parse(localStorage.getItem(DB_KEYS.CLIENTES) || '[]')
                    .filter(c => !tombAtual.includes(c.id));
                // Só sobe o que a nuvem NUNCA viu. Antes, bastava "não estar na lista" para
                // reenviar — e um registro excluído por outro admin voltava, iniciando um
                // vai-e-vem infinito (a lista do console ficava piscando).
                const toUpload = localClientes.filter(localC => !tombAtual.includes(localC.id) && !idsNaNuvemClientes.has(localC.id));

                toUpload.forEach(async (c) => {
                    try { await window.GoianitaFirestore.collection('clientes').doc(c.id).set(c, {merge: true}); } catch(e){}
                });

                const merged = [...firebaseClientes, ...toUpload];
                localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(merged));

                // NOTA: dedupeClientesByCpf removida daqui — rodava antes dos produtos chegarem
                // e orfanava produtos ao excluir o ID mais novo. Roda apenas no save() agora.

                window.dispatchEvent(new Event('goianitaDataChanged'));
                if(syncCount < 3) checkSync();
            }, err => console.error("Erro no sync de clientes:", err));

            // Sincronizar produtos
            window.GoianitaFirestore.collection('produtos').onSnapshot(snapshot => {
                const tomb = tombstonesDe('produtos');
                const firebaseProdutos = [];
                const idsNaNuvemProdutos = new Set();
                snapshot.forEach(doc => {
                    const dados = doc.data();
                    idsNaNuvemProdutos.add(doc.id);

                    // Exclusão compartilhada (mesma lógica dos clientes).
                    if (dados.excluido === true) {
                        removeTombstone('produtos', doc.id);
                        return;
                    }

                    if (tomb.includes(doc.id)) {
                        if (registroSuperaExclusao('produtos', doc.id, dados)) {
                            removeTombstone('produtos', doc.id);
                            firebaseProdutos.push({ id: doc.id, ...dados });
                        } else {
                            const agora = new Date().toISOString();
                            window.GoianitaFirestore.collection('produtos').doc(doc.id)
                                .set({ excluido: true, excluidoEm: agora, atualizadoEm: agora }, { merge: true })
                                .catch(() => {});
                        }
                        return;
                    }

                    firebaseProdutos.push({ id: doc.id, ...dados });
                });

                const tombAtual = tombstonesDe('produtos');
                const localProdutos = JSON.parse(localStorage.getItem(DB_KEYS.PRODUTOS) || '[]')
                    .filter(p => !tombAtual.includes(p.id));
                const toUpload = localProdutos.filter(localP => !tombAtual.includes(localP.id) && !idsNaNuvemProdutos.has(localP.id));

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

            // Sincronizar embaixadores
            window.GoianitaFirestore.collection('embaixadores').onSnapshot(snapshot => {
                const tomb = tombstonesDe('embaixadores');
                const firebaseEmbaixadores = [];
                const idsNaNuvemEmb = new Set();
                snapshot.forEach(doc => {
                    const dados = doc.data();
                    idsNaNuvemEmb.add(doc.id);
                    if (dados.excluido === true) {
                        removeTombstone('embaixadores', doc.id);
                        return;
                    }
                    if (tomb.includes(doc.id)) {
                        if (registroSuperaExclusao('embaixadores', doc.id, dados)) {
                            removeTombstone('embaixadores', doc.id);
                            firebaseEmbaixadores.push({ id: doc.id, ...dados });
                        } else {
                            const agora = new Date().toISOString();
                            window.GoianitaFirestore.collection('embaixadores').doc(doc.id)
                                .set({ excluido: true, excluidoEm: agora, atualizadoEm: agora }, { merge: true })
                                .catch(() => {});
                        }
                        return;
                    }
                    firebaseEmbaixadores.push({ id: doc.id, ...dados });
                });

                const tombAtual = tombstonesDe('embaixadores');
                const localEmb = JSON.parse(localStorage.getItem(DB_KEYS.EMBAIXADORES) || '[]')
                    .filter(e => !tombAtual.includes(e.id));
                const toUpload = localEmb.filter(e => !tombAtual.includes(e.id) && !idsNaNuvemEmb.has(e.id));

                toUpload.forEach(async (e) => {
                    try { await window.GoianitaFirestore.collection('embaixadores').doc(e.id).set(e, {merge: true}); } catch(err){}
                });

                const merged = [...firebaseEmbaixadores, ...toUpload];
                localStorage.setItem(DB_KEYS.EMBAIXADORES, JSON.stringify(merged));

                window.dispatchEvent(new Event('goianitaDataChanged'));
                if(syncCount < 3) checkSync();
            }, err => console.error("Erro no sync de embaixadores:", err));
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


/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PADRÃO DE SKU — 201 + código do fornecedor (3) + sequência do produto (2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Ex.: fornecedor 014, 5º produto dele → 20101405
 *
 * Decisões de projeto (não desfazer sem entender o motivo):
 *
 * 1) A geração fica AQUI, dentro de db.js, e não na tela de cadastro. Existe mais de um
 *    caminho para criar produto (formulário e importação por planilha) e todos passam por
 *    `db.produtos.save` — na tela, o import continuaria gerando SKU no formato antigo.
 *
 * 2) A sequência NUNCA vem de "contar quantos produtos existem". Contagem repete número
 *    quando um produto é excluído, e cada aparelho tem visão parcial dos dados (dois
 *    admins gerariam o mesmo). Guardamos `ultimoSequencial` no cadastro do fornecedor e
 *    só incrementamos.
 *
 * 3) O incremento é feito em TRANSAÇÃO no Firestore: é o que garante números diferentes
 *    para dois cadastros simultâneos. Sem conexão a transação falha — e nesse caso
 *    preferimos NÃO gravar um produto novo, porque um SKU que muda depois da etiqueta
 *    impressa é pior que esperar a conexão voltar. Produto já existente (que já tem SKU)
 *    continua podendo ser editado offline.
 */
const GOIANITA_SKU_PREFIXO = '201';
const GOIANITA_SKU_FORNECEDOR_INICIAL = 101;                              // 1º fornecedor = 101 → SKU 20110101
const GOIANITA_SKU_FORNECEDOR_MAX = 999;                                  // faixa 101..999 = 899 fornecedores
const GOIANITA_SKU_DIGITOS_PRODUTO = 2;                                   // 2 dígitos = 99 produtos por fornecedor
const GOIANITA_SKU_MAX_PRODUTO = Math.pow(10, GOIANITA_SKU_DIGITOS_PRODUTO) - 1;

function montarSku(codigoFornecedor, sequencial) {
    return GOIANITA_SKU_PREFIXO
        + String(codigoFornecedor).padStart(3, '0')
        + String(sequencial).padStart(GOIANITA_SKU_DIGITOS_PRODUTO, '0');
}
window.GoianitaMontarSku = montarSku;
window.GoianitaSkuConfig = {
    prefixo: GOIANITA_SKU_PREFIXO,
    fornecedorInicial: GOIANITA_SKU_FORNECEDOR_INICIAL,
    fornecedorMax: GOIANITA_SKU_FORNECEDOR_MAX,
    digitosProduto: GOIANITA_SKU_DIGITOS_PRODUTO
};

/**
 * Próximo código de fornecedor (3 dígitos), reservado em transação num contador único.
 * Sem Firestore, cai para "maior código local + 1" — aceitável porque cadastro de
 * fornecedor é raro e a conferência de duplicidade é simples de fazer na tela.
 */
async function reservarCodigoFornecedor() {
    // A numeração começa em 101 (1º fornecedor = 101), conforme o padrão definido:
    // 201 + 101 + 01 → 20110101 para o primeiro produto do primeiro fornecedor.
    const piso = GOIANITA_SKU_FORNECEDOR_INICIAL - 1;
    const maiorLocal = () => db.clientes.getAll()
        .reduce((max, c) => Math.max(max, parseInt(c.codigoFornecedor, 10) || 0), piso);

    if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
        return String(maiorLocal() + 1).padStart(3, '0');
    }
    const ref = window.GoianitaFirestore.collection('contadores').doc('fornecedores');
    const novo = await window.GoianitaFirestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const atual = (snap.exists && parseInt(snap.data().ultimo, 10)) || 0;
        // Nunca voltar atrás: respeita o contador, a base local e o piso da faixa.
        const proximo = Math.max(atual, maiorLocal(), piso) + 1;
        tx.set(ref, { ultimo: proximo, atualizadoEm: new Date().toISOString() }, { merge: true });
        return proximo;
    });
    if (novo > GOIANITA_SKU_FORNECEDOR_MAX) {
        throw new Error('A faixa de fornecedores do padrão de SKU (' + GOIANITA_SKU_FORNECEDOR_INICIAL +
            ' a ' + GOIANITA_SKU_FORNECEDOR_MAX + ') foi esgotada.');
    }
    return String(novo).padStart(3, '0');
}
window.GoianitaReservarCodigoFornecedor = reservarCodigoFornecedor;

/**
 * Reserva a próxima sequência de produto DAQUELE fornecedor e devolve o SKU pronto.
 * A transação é feita no próprio documento do fornecedor, que é onde vive o contador.
 */
async function reservarSkuProduto(clienteId) {
    const cliente = db.clientes.getById(clienteId);
    if (!cliente) throw new Error('Fornecedor do produto não encontrado.');

    if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
        throw new Error('Sem conexão com a nuvem para gerar o código (SKU) do produto. Reconecte e salve novamente — assim o código não muda depois de impresso.');
    }

    const ref = window.GoianitaFirestore.collection('clientes').doc(clienteId);
    const seq = await window.GoianitaFirestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const dados = snap.exists ? snap.data() : {};

        let codigo = dados.codigoFornecedor || cliente.codigoFornecedor;
        if (!codigo) throw new Error('Este fornecedor ainda não tem código. Abra a tela de Fornecedores e use "Gerar códigos" antes de cadastrar produtos.');

        // Considera também os produtos já existentes: protege quando o contador não
        // acompanhou (base antiga, produto importado, SKU editado à mão).
        const maiorExistente = db.produtos.getByCliente(clienteId).reduce((max, p) => {
            const s = String(p.sku || '');
            if (s.length !== 3 + 3 + GOIANITA_SKU_DIGITOS_PRODUTO) return max;
            if (s.slice(0, 3) !== GOIANITA_SKU_PREFIXO) return max;
            return Math.max(max, parseInt(s.slice(6), 10) || 0);
        }, 0);

        const proximo = Math.max(parseInt(dados.ultimoSequencial, 10) || 0, maiorExistente) + 1;
        if (proximo > GOIANITA_SKU_MAX_PRODUTO) {
            throw new Error('Este fornecedor chegou ao limite de ' + GOIANITA_SKU_MAX_PRODUTO +
                ' produtos permitido pelo padrão de SKU atual (' + (3 + 3 + GOIANITA_SKU_DIGITOS_PRODUTO) +
                ' dígitos). Para continuar, o padrão precisa de mais um dígito no produto.');
        }
        tx.set(ref, { ultimoSequencial: proximo, atualizadoEm: new Date().toISOString() }, { merge: true });
        return { codigo: codigo, seq: proximo };
    });

    return montarSku(seq.codigo, seq.seq);
}

/**
 * Sobe o contador do fornecedor quando um SKU é informado à mão (edição dos produtos
 * antigos). Sem isso o contador ficaria ATRÁS do número já usado e um produto novo
 * cadastrado em outro aparelho poderia nascer com um SKU repetido. Nunca reduz o contador:
 * baixar um SKU manualmente não libera o número para reuso.
 */
async function alinharContadorFornecedor(clienteId, sku) {
    if (typeof firebase === 'undefined' || !window.GoianitaFirestore) return;
    const s = String(sku || '');
    if (s.length !== 3 + 3 + GOIANITA_SKU_DIGITOS_PRODUTO) return;
    if (s.slice(0, 3) !== GOIANITA_SKU_PREFIXO) return;

    const seq = parseInt(s.slice(6), 10);
    if (!seq) return;

    // Só alinha se o SKU realmente pertence a este fornecedor (evita mexer no contador
    // errado quando alguém digita um código de outro fornecedor por engano).
    const cliente = db.clientes.getById(clienteId);
    if (!cliente || String(cliente.codigoFornecedor || '').padStart(3, '0') !== s.slice(3, 6)) return;

    try {
        const ref = window.GoianitaFirestore.collection('clientes').doc(clienteId);
        await window.GoianitaFirestore.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const atual = (snap.exists && parseInt(snap.data().ultimoSequencial, 10)) || 0;
            if (seq > atual) {
                tx.set(ref, { ultimoSequencial: seq, atualizadoEm: new Date().toISOString() }, { merge: true });
            }
        });
    } catch (e) {
        console.warn('[SKU] Não foi possível alinhar o contador do fornecedor:', e && e.message);
    }
}

const db = {
    // EMBAIXADORES — Parceiros de Captação (Personal Organizers, Arquitetos, etc.)
    embaixadores: {
        getAll: () => JSON.parse(localStorage.getItem(DB_KEYS.EMBAIXADORES) || '[]'),
        getById: (id) => db.embaixadores.getAll().find(e => e.id === id),
        getByCupom: (cupom) => db.embaixadores.getAll().find(e => e.cupom && e.cupom.toUpperCase() === (cupom || '').toUpperCase()),
        save: async (embaixador, skipSync = false) => {
            const todosEmb = db.embaixadores.getAll();

            // Normaliza o cupom para maiúsculas sem espaços
            if (embaixador.cupom) {
                embaixador.cupom = embaixador.cupom.toUpperCase().trim().replace(/\s+/g, '');
            }

            // ID determinístico baseado no CPF (mesma lógica dos fornecedores)
            const cpfLimpo = embaixador.cpf ? String(embaixador.cpf).replace(/\D/g, '') : '';

            // Validação de duplicidade de CPF para novos cadastros
            if (!embaixador.id && cpfLimpo) {
                const dupCpf = todosEmb.find(e => e.cpf && String(e.cpf).replace(/\D/g, '') === cpfLimpo);
                if (dupCpf) throw new Error(`Já existe um embaixador cadastrado com o CPF ${embaixador.cpf} (${dupCpf.nome}).`);
            }

            // Validação de unicidade do cupom
            if (embaixador.cupom) {
                const dupCupom = todosEmb.find(e =>
                    e.cupom && e.cupom.toUpperCase() === embaixador.cupom &&
                    e.id !== embaixador.id
                );
                if (dupCupom) throw new Error(`O cupom "${embaixador.cupom}" já está em uso pelo embaixador ${dupCupom.nome}.`);
            }

            const idNovo = cpfLimpo ? ('emb_' + cpfLimpo) : ('emb_' + Date.now());
            removeTombstone('embaixadores', embaixador.id || idNovo);

            if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
                const lista = todosEmb;
                if (embaixador.id) {
                    const idx = lista.findIndex(e => e.id === embaixador.id);
                    if (idx !== -1) lista[idx] = { ...lista[idx], ...embaixador };
                } else {
                    embaixador.id = idNovo;
                    embaixador.dataCadastro = new Date().toISOString();
                    const exist = lista.findIndex(e => e.id === embaixador.id);
                    if (exist !== -1) lista[exist] = { ...lista[exist], ...embaixador };
                    else lista.push(embaixador);
                }
                localStorage.setItem(DB_KEYS.EMBAIXADORES, JSON.stringify(lista));
                return embaixador;
            }

            const docRef = embaixador.id
                ? window.GoianitaFirestore.collection('embaixadores').doc(embaixador.id)
                : window.GoianitaFirestore.collection('embaixadores').doc(idNovo);

            const id = docRef.id;
            const embaixadorFinal = {
                ...embaixador,
                id,
                ativo: embaixador.ativo !== false,
                dataCadastro: embaixador.dataCadastro || new Date().toISOString(),
                excluido: false,
                excluidoEm: null,
                atualizadoEm: new Date().toISOString()
            };

            // 1) Grava LOCAL primeiro
            const localEmb = db.embaixadores.getAll();
            const idxLocal = localEmb.findIndex(e => e.id === id);
            if (idxLocal !== -1) localEmb[idxLocal] = embaixadorFinal;
            else localEmb.push(embaixadorFinal);
            localStorage.setItem(DB_KEYS.EMBAIXADORES, JSON.stringify(localEmb));

            // 2) Envia ao Firestore com timeout de 6s
            try {
                await Promise.race([
                    docRef.set(embaixadorFinal, { merge: true }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('tempo esgotado ao gravar na nuvem')), 6000))
                ]);
                removePendingSync('embaixadores', id);
            } catch (err) {
                addPendingSync('embaixadores', id);
                console.warn('[Firebase] Embaixador salvo localmente; será sincronizado automaticamente:', err && err.message);
            }

            if (!skipSync) db.importExport.syncToGoogleSheets();
            return embaixadorFinal;
        },
        delete: async (id) => {
            const alvo = db.embaixadores.getById(id);
            if (!alvo) return;
            addTombstone('embaixadores', id);

            const lista = db.embaixadores.getAll().filter(e => e.id !== id);
            localStorage.setItem(DB_KEYS.EMBAIXADORES, JSON.stringify(lista));

            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                const agora = new Date().toISOString();
                try {
                    await window.GoianitaFirestore.collection('embaixadores').doc(id)
                        .set({ excluido: true, excluidoEm: agora, atualizadoEm: agora }, { merge: true });
                } catch (err) {
                    console.error('[Firebase] Erro ao excluir embaixador:', err);
                }
            }
            db.importExport.syncToGoogleSheets();
        }
    },

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

            // Senha do fornecedor vira HASH guardado no cadastro (não usa mais Firebase Auth).
            if (cliente.senha) {
                cliente.senhaHash = await goianitaHash(cliente.senha);
                delete cliente.senha;
            }

            // Código curto de 3 dígitos usado no SKU dos produtos (201 + código + sequência).
            // Atribuído uma única vez, no primeiro salvamento, e nunca alterado depois —
            // mudá-lo invalidaria os SKUs já impressos nas etiquetas.
            if (!cliente.codigoFornecedor) {
                const jaSalvo = cliente.id ? db.clientes.getById(cliente.id) : null;
                cliente.codigoFornecedor = (jaSalvo && jaSalvo.codigoFornecedor)
                    ? jaSalvo.codigoFornecedor
                    : await reservarCodigoFornecedor();
            }

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
                dataCadastro: dataCadastro,
                // Recadastrar reativa o registro: sem isso o documento continuaria marcado
                // como excluído (o ID é derivado do CPF, então é o MESMO documento) e o
                // cadastro novo desapareceria em todos os aparelhos.
                excluido: false,
                excluidoEm: null,
                atualizadoEm: new Date().toISOString()
            };

            // (Fornecedor não usa mais Firebase Auth — a senha vai como hash no cadastro.)

            const cleanCliente = { ...clienteFinal };
            delete cleanCliente.senha;

            // 1) Grava LOCAL primeiro — garante o cadastro e libera a tela mesmo se a nuvem demorar.
            const clientesLocais = db.clientes.getAll();
            const idx = clientesLocais.findIndex(c => c.id === id);
            if (idx !== -1) clientesLocais[idx] = cleanCliente;
            else clientesLocais.push(cleanCliente);
            localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(clientesLocais));

            // 2) Envia ao Firestore com TIMEOUT de segurança para o "Gravando..." nunca travar para sempre.
            //    Se estourar o tempo, segue em frente — a sincronização em tempo real reenvia o registro depois.
            try {
                await Promise.race([
                    docRef.set(cleanCliente, { merge: true }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('tempo esgotado ao gravar na nuvem')), 6000))
                ]);
                removePendingSync('clientes', id);
            } catch (err) {
                addPendingSync('clientes', id); // entra na fila de reenvio automático
                console.warn('[Firebase] Cliente salvo localmente; será sincronizado automaticamente:', err && err.message);
            }

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

            // MARCA a exclusão na nuvem em vez de apagar o documento. Apagar deixava os outros
            // aparelhos sem saber que foi de propósito: eles ainda tinham o registro local, viam
            // que "faltava na nuvem" e reenviavam — o que ressuscitava o cadastro e provocava um
            // vai-e-vem infinito de gravação/exclusão entre as máquinas.
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                const agora = new Date().toISOString();
                for (const rid of idsRemover) {
                    try {
                        await window.GoianitaFirestore.collection('clientes').doc(rid)
                            .set({ excluido: true, excluidoEm: agora, atualizadoEm: agora }, { merge: true });
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
                    // Sem Firebase não há como reservar o sequencial do SKU com segurança.
                    // Antes gerava um código no formato antigo aqui, calado — o produto nascia
                    // fora do padrão e ninguém percebia. Melhor recusar e explicar.
                    if (!produto.sku) {
                        throw new Error('Sem conexão com a nuvem para gerar o código (SKU) do produto. Reconecte e cadastre novamente.');
                    }
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

            // SKU repetido deixa a busca e os documentos ambíguos — barra antes de gravar.
            // Vale principalmente para a edição manual dos SKUs antigos.
            if (produto.sku) {
                const repetido = db.produtos.getAll().find(p => p.id !== id && String(p.sku) === String(produto.sku));
                if (repetido) {
                    throw new Error('O código (SKU) ' + produto.sku + ' já está em uso pelo produto "' + repetido.nome + '".');
                }
            }

            // Produto NOVO sem SKU: reserva no padrão 201 + fornecedor + sequência.
            // Produto existente conserva o SKU que já tem (inclusive para edição offline).
            const sku = produto.sku || await reservarSkuProduto(produto.clienteId);

            // SKU vindo de fora do gerador (edição manual dos antigos, importação): mantém o
            // contador do fornecedor à frente do maior número já usado.
            if (produto.sku && produto.clienteId) {
                await alinharContadorFornecedor(produto.clienteId, produto.sku);
            }
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
                statusHistorico: statusHistorico,
                excluido: false,          // reativa caso este documento tenha sido excluído antes
                excluidoEm: null,
                atualizadoEm: new Date().toISOString()
            };

            // 1) Grava LOCAL primeiro — garante o registro e libera a tela mesmo se a nuvem demorar.
            const produtosLocais = db.produtos.getAll();
            const idx = produtosLocais.findIndex(p => p.id === id);
            if (idx !== -1) produtosLocais[idx] = produtoFinal;
            else produtosLocais.push(produtoFinal);
            localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(produtosLocais));

            // 2) Envia ao Firestore com TIMEOUT de segurança para o "Gravando..." nunca travar para sempre.
            try {
                await Promise.race([
                    docRef.set(produtoFinal, { merge: true }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('tempo esgotado ao gravar na nuvem')), 6000))
                ]);
                removePendingSync('produtos', id);
            } catch(e) {
                addPendingSync('produtos', id); // entra na fila de reenvio automático
                console.warn("[Firebase] Produto salvo localmente; será sincronizado automaticamente:", e && e.message);
            }

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

            // Marca a exclusão na nuvem (mesmo motivo dos clientes: apagar fazia outro
            // aparelho reenviar o registro e iniciava um vai-e-vem infinito).
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                try {
                    const agora = new Date().toISOString();
                    await window.GoianitaFirestore.collection('produtos').doc(id)
                        .set({ excluido: true, excluidoEm: agora, atualizadoEm: agora }, { merge: true });
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
            // 1) Grava LOCAL primeiro — garante o registro e libera a tela mesmo se a nuvem demorar.
            const pagamentosLocais = db.pagamentos.getAll();
            pagamentosLocais.push(pagamentoFinal);
            localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(pagamentosLocais));

            // 2) Envia ao Firestore com TIMEOUT de segurança para o "Gravando..." nunca travar para sempre.
            try {
                await Promise.race([
                    docRef.set(pagamentoFinal),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('tempo esgotado ao gravar na nuvem')), 6000))
                ]);
                removePendingSync('pagamentos', id);
            } catch (err) {
                addPendingSync('pagamentos', id); // entra na fila de reenvio automático
                console.warn("[Firebase] Pagamento salvo localmente; será sincronizado automaticamente:", err && err.message);
            }

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

        calcularValoresEmbaixador: (embaixadorId) => {
            const emb = db.embaixadores.getById(embaixadorId);
            if (!emb) return { produtosCaptados: 0, produtosVendidos: 0, totalFaturado: 0, comissaoTotalGerada: 0, totalPago: 0, saldoPendente: 0 };

            // Produtos vinculados a este embaixador via cupom
            const produtosCaptados = db.produtos.getAll().filter(p =>
                p.embaixadorId === embaixadorId ||
                (p.cupom && emb.cupom && p.cupom.toUpperCase() === emb.cupom.toUpperCase())
            );

            const produtosVendidos = produtosCaptados.filter(p => p.status === 'Vendido' || p.status === 'Pago');
            const totalFaturado = produtosVendidos.reduce((acc, p) => acc + (p.precoVenda || 0), 0);
            const comissaoTotalGerada = produtosVendidos.reduce((acc, p) => {
                const taxa = p.comissaoEmbaixador != null ? p.comissaoEmbaixador : (emb.comissaoCaptacaoPadrao || 0);
                const precoBase = p.precoVenda || 0;
                const imposto = (precoBase * window.TAXA_IMPOSTO) / 100;
                const liquido = precoBase - imposto;
                return acc + (liquido * taxa / 100);
            }, 0);

            // Pagamentos já registrados para este embaixador
            const pagamentosEmb = db.pagamentos.getAll().filter(p => p.embaixadorId === embaixadorId);
            const totalPago = pagamentosEmb.reduce((acc, p) => acc + (p.valor || 0), 0);
            const saldoPendente = Math.max(0, comissaoTotalGerada - totalPago);

            return {
                produtosCaptados: produtosCaptados.length,
                produtosVendidos: produtosVendidos.length,
                totalFaturado,
                comissaoTotalGerada,
                totalPago,
                saldoPendente
            };
        },

        getResumoGeral: () => {
            const clientes = db.clientes.getAll();
            const produtos = db.produtos.getAll();
            const pagamentos = db.pagamentos.getAll();
            const embaixadores = db.embaixadores.getAll();

            const totalEstoqueValor = produtos
                .filter(p => p.status === 'À Venda')
                .reduce((acc, p) => acc + (p.precoVenda || 0), 0);

            const totalVendas = produtos
                .filter(p => p.status === 'Vendido' || p.status === 'Pago')
                .reduce((acc, p) => acc + (p.precoVenda || 0), 0);

            const totalComissaoGoianita = produtos
                .filter(p => p.status === 'Vendido' || p.status === 'Pago')
                .reduce((acc, p) => {
                    const precoBase = p.precoVenda || 0;
                    const imposto = (precoBase * window.TAXA_IMPOSTO) / 100;
                    const liquido = precoBase - imposto;
                    
                    const comissaoLoja = (liquido * (p.comissao || 0)) / 100;
                    // Se há comissão de embaixador, ela sai da margem da loja
                    const comissaoEmb = p.comissaoEmbaixador != null
                        ? (liquido * p.comissaoEmbaixador / 100)
                        : 0;
                    return acc + comissaoLoja - comissaoEmb;
                }, 0);

            const totalPagoFornecedores = pagamentos
                .filter(p => !p.embaixadorId)
                .reduce((acc, p) => acc + (p.valor || 0), 0);

            const saldoPagarFornecedores = (produtos
                .filter(p => p.status === 'Vendido' || p.status === 'Pago')
                .reduce((acc, p) => {
                    const precoBase = p.precoVenda || 0;
                    const imposto = (precoBase * window.TAXA_IMPOSTO) / 100;
                    const liquido = precoBase - imposto;
                    const valForn = liquido - ((liquido * (p.comissao || 0)) / 100);
                    return acc + valForn;
                }, 0)) - totalPagoFornecedores;

            // Estatísticas de embaixadores
            const embAtivos = embaixadores.filter(e => e.ativo !== false).length;
            const totalComissaoEmbaixadores = produtos
                .filter(p => (p.status === 'Vendido' || p.status === 'Pago') && p.embaixadorId)
                .reduce((acc, p) => {
                    const emb = db.embaixadores.getById(p.embaixadorId);
                    const taxa = p.comissaoEmbaixador != null ? p.comissaoEmbaixador : (emb ? (emb.comissaoCaptacaoPadrao || 0) : 0);
                    const precoBase = p.precoVenda || 0;
                    const imposto = (precoBase * window.TAXA_IMPOSTO) / 100;
                    const liquido = precoBase - imposto;
                    return acc + (liquido * taxa / 100);
                }, 0);
            const totalPagoEmbaixadores = pagamentos
                .filter(p => !!p.embaixadorId)
                .reduce((acc, p) => acc + (p.valor || 0), 0);
            const saldoPagarEmbaixadores = Math.max(0, totalComissaoEmbaixadores - totalPagoEmbaixadores);

            return {
                totalClientes: clientes.length,
                totalProdutos: produtos.length,
                totalEstoqueValor,
                totalVendas,
                totalComissaoGoianita,
                totalPagoFornecedores,
                saldoPagarFornecedores,
                embAtivos,
                totalComissaoEmbaixadores,
                totalPagoEmbaixadores,
                saldoPagarEmbaixadores,
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
        /**
         * IMPORTANTE (2026-07-31): esta rotina NÃO apaga mais nada da nuvem por conta própria.
         * Antes ela rodava a cada carregamento de página e, ao eleger o cadastro "mais antigo"
         * como verdadeiro, marcava os outros IDs como excluídos (com data de agora) e os
         * DELETAVA do Firestore. Como cada aparelho tem uma base local diferente, um deles
         * podia apagar da nuvem o fornecedor recém-cadastrado em outro — o cadastro sumia para
         * os demais admins. Agora ela só consolida os dados LOCALMENTE e religa os produtos.
         * A remoção na nuvem só acontece se for pedida de propósito: `{ apagarNaNuvem: true }`.
         */
        dedupeClientesByCpf: (opts) => {
            const apagarNaNuvem = !!(opts && opts.apagarNaNuvem);
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

            // Só marca exclusão quando a remoção na nuvem foi pedida de propósito. Marcar aqui
            // automaticamente era o que fazia um aparelho apagar da nuvem o cadastro do outro.
            if (apagarNaNuvem) idsRemovidos.forEach(rid => addTombstone('clientes', rid));

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

            // Propaga para o Firestore. A EXCLUSÃO só ocorre se pedida de propósito; o religamento
            // dos produtos ao fornecedor correto sempre é propagado (não destrói nada).
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                if (apagarNaNuvem) {
                    idsRemovidos.forEach(id => {
                        window.GoianitaFirestore.collection('clientes').doc(id).delete().catch(() => {});
                    });
                }
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
                pagamentos: db.pagamentos.getAll(),
                embaixadores: db.embaixadores.getAll()
            };
            return JSON.stringify(backup, null, 2);
        },
        importBackup: (jsonString) => {
            try {
                const data = JSON.parse(jsonString);
                if (data.clientes) localStorage.setItem(DB_KEYS.CLIENTES, JSON.stringify(data.clientes));
                if (data.produtos) localStorage.setItem(DB_KEYS.PRODUTOS, JSON.stringify(data.produtos));
                if (data.pagamentos) localStorage.setItem(DB_KEYS.PAGAMENTOS, JSON.stringify(data.pagamentos));
                if (data.embaixadores) localStorage.setItem(DB_KEYS.EMBAIXADORES, JSON.stringify(data.embaixadores));
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
            // Embaixadores são mantidos no zerarTudo — eles não dependem de ciclos de consignação
            localStorage.setItem(DB_KEYS.TOMBSTONES, JSON.stringify({}));

            // 2. MARCA todos os documentos como excluídos (não apaga).
            if (typeof firebase !== 'undefined' && window.GoianitaFirestore) {
                const agora = new Date().toISOString();
                for (const col of ['clientes', 'produtos', 'pagamentos']) {
                    try {
                        const snap = await window.GoianitaFirestore.collection(col).get();
                        for (const doc of snap.docs) {
                            try {
                                await doc.ref.set({ excluido: true, excluidoEm: agora, atualizadoEm: agora }, { merge: true });
                            } catch (e) {}
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

/**
 * Reenvia à nuvem TODOS os registros que estão só no aparelho (não confirmados no
 * Firestore) e devolve o motivo real de qualquer falha. Serve como reparo manual e
 * diagnóstico: quando um cadastro "não replica" para outros logins/celular, isto mostra
 * exatamente o porquê (admin não autenticado, permissão negada nas regras, sem conexão).
 */
db.utils.sincronizarPendentes = async () => {
    if (typeof firebase === 'undefined' || !window.GoianitaFirestore) {
        return { ok: false, motivo: 'Firebase não carregou nesta página.' };
    }
    const user = window.GoianitaAuth && window.GoianitaAuth.currentUser;
    if (!user) {
        return { ok: false, motivo: 'O administrador NÃO está autenticado no Firebase neste aparelho. Saia e faça login novamente para que os cadastros subam para a nuvem.' };
    }

    const colecoes = [
        ['clientes', db.clientes.getAll()],
        ['produtos', db.produtos.getAll()],
        ['pagamentos', db.pagamentos.getAll()],
        ['embaixadores', db.embaixadores.getAll()]
    ];

    let enviados = 0;
    const erros = [];
    for (const [nomeCol, itens] of colecoes) {
        for (const item of itens) {
            if (!item || !item.id) continue;
            try {
                await window.GoianitaFirestore.collection(nomeCol).doc(item.id).set(item, { merge: true });
                enviados++;
            } catch (e) {
                erros.push(`${nomeCol}/${item.nome || item.id}: ${e && (e.code || e.message)}`);
            }
        }
    }

    return { ok: erros.length === 0, enviados, erros, uid: user.uid };
};

/**
 * Chamado pelo botão "Sincronizar na nuvem": roda o reparo e mostra o resultado em
 * linguagem simples, sem precisar abrir o console do navegador.
 */
window.goianitaForcarSync = async () => {
    let res;
    try {
        res = await db.utils.sincronizarPendentes();
    } catch (e) {
        alert('Falha inesperada ao sincronizar: ' + (e && e.message));
        return;
    }
    if (res.ok) {
        alert(`Sincronização concluída. ${res.enviados} registro(s) enviado(s) à nuvem.\n\nAbra em outro login/celular e recarregue (Ctrl+Shift+R) para conferir.`);
    } else if (res.motivo) {
        alert('Não foi possível sincronizar:\n\n' + res.motivo);
    } else {
        alert(`Sincronização parcial: ${res.enviados} enviado(s), mas houve erros:\n\n` + res.erros.join('\n'));
    }
};

// A consolidação de duplicados NÃO roda mais automaticamente ao carregar a página.
// Motivo: ela elege o cadastro mais antigo como verdadeiro a partir da base LOCAL, que é
// diferente em cada aparelho — e assim um aparelho descartava o fornecedor recém-cadastrado
// em outro, fazendo o cadastro sumir para os demais admins. Continua disponível para uso
// deliberado: window.GoianitaDB.utils.dedupeClientesByCpf({ apagarNaNuvem: true }).

/**
 * Motor de sincronização automática: percorre a fila de reenvio e sobe para o Firestore
 * cada registro ainda não confirmado, removendo-o da fila ao ter sucesso. Roda em segundo
 * plano — nada de botão. Respeita tombstones (não re-sobe item excluído) e só age com o
 * admin autenticado; se não estiver, mantém a fila e tenta de novo mais tarde.
 */
let goianitaAutoSyncRodando = false;
async function goianitaAutoSyncPendentes() {
    if (goianitaAutoSyncRodando) return;
    if (typeof firebase === 'undefined' || !window.GoianitaFirestore) return;
    const user = window.GoianitaAuth && window.GoianitaAuth.currentUser;
    if (!user) return; // sem login no Firebase: tenta de novo no próximo ciclo
    if (pendingSyncTotal() === 0) return;

    goianitaAutoSyncRodando = true;
    try {
        const mapa = {
            clientes: db.clientes.getAll(),
            produtos: db.produtos.getAll(),
            pagamentos: db.pagamentos.getAll(),
            embaixadores: db.embaixadores.getAll()
        };
        const fila = getPendingSync();
        for (const col of ['clientes', 'produtos', 'pagamentos', 'embaixadores']) {
            const ids = (fila[col] || []).slice();
            const tomb = tombstonesDe(col);
            for (const id of ids) {
                if (tomb.includes(id)) { removePendingSync(col, id); continue; } // excluído: não re-sobe
                const item = (mapa[col] || []).find(x => x.id === id);
                if (!item) { removePendingSync(col, id); continue; }               // sumiu localmente
                try {
                    await window.GoianitaFirestore.collection(col).doc(id).set(item, { merge: true });
                    removePendingSync(col, id);
                } catch (e) {
                    // Mantém na fila para a próxima tentativa (conexão/permissão/sessão).
                    console.warn(`[AutoSync] Ainda não subiu ${col}/${id}:`, e && (e.code || e.message));
                }
            }
        }
    } finally {
        goianitaAutoSyncRodando = false;
    }
}
window.goianitaAutoSyncPendentes = goianitaAutoSyncPendentes;

// Semeia a fila com TUDO que já está local ao carregar a página. Assim, registros que
// ficaram presos só no aparelho (ex.: cadastrados antes desta correção) são reconciliados
// automaticamente na primeira sincronização. Itens já existentes na nuvem só levam um
// merge inofensivo. Tombstones ficam de fora.
(function semearFilaInicial() {
    try {
        ['clientes', 'produtos', 'pagamentos', 'embaixadores'].forEach(col => {
            const tomb = tombstonesDe(col);
            const itens = db[col].getAll();
            itens.forEach(it => { if (it && it.id && !tomb.includes(it.id)) addPendingSync(col, it.id); });
        });
    } catch (e) { console.warn('[AutoSync] Falha ao semear fila inicial:', e); }
})();

// Dispara a sincronização automática: já ao carregar, quando a internet volta, sempre que
// o admin autentica e periodicamente (a cada 15s) enquanto houver pendências.
setTimeout(goianitaAutoSyncPendentes, 3000);
window.addEventListener('online', goianitaAutoSyncPendentes);
if (window.GoianitaAuth && window.GoianitaAuth.onAuthStateChanged) {
    window.GoianitaAuth.onAuthStateChanged(u => { if (u) setTimeout(goianitaAutoSyncPendentes, 1500); });
}
setInterval(goianitaAutoSyncPendentes, 15000);
