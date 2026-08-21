/**
 * app.js - Lógica Principal do App
 * Casas Goianita - Sistema de Comodato e Consignação
 */

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * GUARDA DE ACESSO (resolve o problema crônico de "cadastrei e o outro não vê")
 * ─────────────────────────────────────────────────────────────────────────────
 * Antes, as telas internas não verificavam autenticação: se a sessão do navegador
 * estivesse vazia, o app assumia "admin" e funcionava só com os dados locais. Sem
 * usuário autenticado no Firebase a sincronização NUNCA inicia, então a máquina virava
 * uma ilha — o admin cadastrava e ninguém mais via, sem qualquer aviso.
 *
 * Agora: quem manda é a sessão do Firebase. Sem usuário autenticado, volta ao login.
 * Se a nuvem estiver fora do ar, o acesso é permitido MAS com aviso permanente na tela,
 * para ninguém trabalhar acreditando que está sincronizado.
 *
 * Este arquivo é carregado por todas as telas internas (e não pelo index.html), então
 * nenhuma página pode ficar sem proteção por esquecimento.
 */
const GoianitaSessao = { user: null, role: null, email: '', nuvem: 'verificando' };
window.GoianitaSessao = GoianitaSessao;

const GoianitaSessaoPronta = (function () {
    const arquivo = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const ehLogin = (arquivo === '' || arquivo === 'index.html');
    const paraLogin = () => (window.location.pathname.indexOf('/pages/') !== -1 ? '../index.html' : 'index.html');

    function esperarUsuario() {
        return new Promise(resolve => {
            if (typeof firebase === 'undefined' || !window.GoianitaAuth) return resolve(undefined);
            if (window.GoianitaAuth.currentUser) return resolve(window.GoianitaAuth.currentUser);
            let resolvido = false;
            const fim = (u) => { if (!resolvido) { resolvido = true; resolve(u); } };
            // O Firebase dispara onAuthStateChanged UMA vez logo após restaurar a sessão salva,
            // com o usuário ou com null. Resolver nessa primeira chamada é o correto: é rápido e
            // não chuta ninguém para fora por lentidão — no celular a restauração passava dos 8s
            // do timeout anterior e o admin era mandado de volta ao login como "sessão expirada".
            try { window.GoianitaAuth.onAuthStateChanged(u => fim(u || null)); } catch (e) {}
            // Rede muito ruim / SDK que nunca responde: só então desistimos.
            setTimeout(() => fim((window.GoianitaAuth && window.GoianitaAuth.currentUser) || null), 15000);
        });
    }

    return (async function () {
        if (ehLogin) { GoianitaSessao.nuvem = 'login'; return GoianitaSessao; }

        const user = await esperarUsuario();

        // Firebase indisponível (sem internet / bloqueio de rede): deixa trabalhar, mas avisando.
        if (typeof user === 'undefined') {
            GoianitaSessao.nuvem = 'indisponivel';
            GoianitaSessao.role = sessionStorage.getItem('goianita_role') || '';
            GoianitaSessao.email = sessionStorage.getItem('goianita_email') || '';
            return GoianitaSessao;
        }

        // O papel escolhido no login manda. Isso é essencial para quem tem OS DOIS acessos
        // (ex.: Débora, que é admin e também fornecedora): ao entrar pelo CPF, a sessão do
        // Firebase pode continuar sendo a da conta de admin dela (não expira), e derivar o
        // papel só da conta faria o acesso de fornecedora dela nunca funcionar.
        const papelEscolhido = sessionStorage.getItem('goianita_role');
        const idFornecedor = sessionStorage.getItem('goianita_cliente_id');
        const ehAcessoFornecedor = (papelEscolhido === 'user' && !!idFornecedor);

        if (!user) {
            // Fornecedor: o login por CPF é validado no próprio cadastro e a sessão anônima é
            // só um extra para puxar dados. Se o acesso anônimo estiver desabilitado no Firebase,
            // exigir usuário aqui criaria um LOOP entre login e tela do fornecedor.
            if (ehAcessoFornecedor) {
                GoianitaSessao.role = 'user';
                GoianitaSessao.nuvem = 'indisponivel';
                return GoianitaSessao;
            }
            // TRAVA ANTI-LOOP: se a pessoa acabou de entrar com sucesso e ainda assim não há
            // sessão restaurada (celular em navegação privada, armazenamento bloqueado), mandar
            // de volta ao login criaria um vai-e-vem infinito. Deixa entrar avisando na tela.
            const t = parseInt(sessionStorage.getItem('goianita_login_ok') || '0', 10);
            if (t && (Date.now() - t) < 120000) {
                GoianitaSessao.role = papelEscolhido || 'admin';
                GoianitaSessao.email = sessionStorage.getItem('goianita_email') || '';
                GoianitaSessao.nuvem = 'indisponivel';
                return GoianitaSessao;
            }
            // Admin sem sessão: nunca mais liberar como "admin" silenciosamente.
            sessionStorage.setItem('goianita_aviso_login', 'Sua sessão expirou. Entre novamente para que seus cadastros sejam salvos na nuvem e apareçam para os outros usuários.');
            window.location.replace(paraLogin());
            return GoianitaSessao;
        }

        GoianitaSessao.user = user;
        GoianitaSessao.nuvem = 'ok';

        if (ehAcessoFornecedor) {
            // Entrou como fornecedor: mantém esse papel mesmo que a conta autenticada seja de admin.
            GoianitaSessao.role = 'user';
            return GoianitaSessao;
        }

        if (user.isAnonymous) {
            // Sessão anônima sem cadastro escolhido: não há como saber de quem são os dados.
            sessionStorage.setItem('goianita_aviso_login', 'Entre novamente com seu CPF para acessar seus dados.');
            window.location.replace(paraLogin());
            return GoianitaSessao;
        }

        GoianitaSessao.role = 'admin';
        GoianitaSessao.email = user.email || '';
        sessionStorage.setItem('goianita_role', 'admin');
        if (user.email) sessionStorage.setItem('goianita_email', user.email);
        sessionStorage.removeItem('goianita_cliente_id');
        return GoianitaSessao;
    })();
})();
window.GoianitaSessaoPronta = GoianitaSessaoPronta;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VISÃO DO FORNECEDOR (acesso não-admin) — somente leitura
 * ─────────────────────────────────────────────────────────────────────────────
 * O fornecedor abre a ficha dele (e consegue abrir a ficha de um produto pela URL), onde
 * existem botões de administração no HTML: editar, excluir, repasse, mídia, Nota de Entrada
 * e Recibo de Devolução. Nada disso deve aparecer para ele — dos documentos, apenas o
 * CONTRATO. Esconder aqui, num lugar só, evita depender de cada página lembrar da regra.
 */
const GOIANITA_ACOES_SO_ADMIN = /gerarNotaEntrada|gerarReciboDevolucao|imprimirAvaliacoesCliente|imprimirLaudoProduto|editarProdutoAtual|excluirProdutoAtual|salvarEdicaoProduto|abrirEditarProduto|definirCodigoFornecedor|gerarCodigosFornecedores|restaurarFornecedorExcluido|goianitaForcarSync|zerarTudo|media-upload-input/i;

const GOIANITA_IDS_SO_ADMIN = [
    'btn-pagar-cliente',            // efetuar repasse PIX
    'btn-excluir-cliente',
    'btn-novo-cliente-trigger',
    'btn-import-clientes-trigger',
    'btn-salvar-edicao-produto',
    'btn-adicionar-midia'
];

// Telas que só fazem sentido para administrador — os itens de menu são escondidos para o
// fornecedor (clicar neles apenas o devolveria para a própria ficha).
const GOIANITA_PAGINAS_SO_ADMIN = /dashboard\.html|clientes\.html|produtos\.html|produto-novo\.html|financeiro\.html|admins\.html|administradores\.html|diagnostico\.html/;

function aplicarRestricoesCliente() {
    const papel = (window.GoianitaSessao && window.GoianitaSessao.role) || sessionStorage.getItem('goianita_role') || '';
    if (papel !== 'user') return;

    const esconder = (el) => { if (el) el.style.display = 'none'; };

    GOIANITA_IDS_SO_ADMIN.forEach(id => esconder(document.getElementById(id)));

    // Botões e links com ação de administração declarada no onclick.
    document.querySelectorAll('button[onclick], a[onclick]').forEach(el => {
        if (GOIANITA_ACOES_SO_ADMIN.test(el.getAttribute('onclick') || '')) esconder(el);
    });

    // Itens de menu que levam a telas de administração.
    document.querySelectorAll('.nav-menu a').forEach(a => {
        if (GOIANITA_PAGINAS_SO_ADMIN.test(a.getAttribute('href') || '')) esconder(a.parentElement || a);
    });

    // "Voltar à Lista" leva à relação de todos os fornecedores: não é do fornecedor.
    document.querySelectorAll('a[href*="clientes.html"]').forEach(a => esconder(a));

    // Modal de edição de produto, caso alguém chegue nele por outro caminho.
    esconder(document.getElementById('modal-editar-produto'));
}

/**
 * ORDEM DOS PRODUTOS — uma única regra usada por TODAS as listas e documentos.
 * Fica centralizado de propósito: se cada tela ordenasse do seu jeito, dois usuários veriam
 * a mesma lista em ordens diferentes. O critério é a data de cadastro (mais antigo primeiro),
 * com desempate pelo SKU/ID para o resultado ser idêntico em qualquer aparelho.
 */
function goianitaDataCadastroProduto(p) {
    const d = p && (p.dataEntrada || p.dataCadastro || p.atualizadoEm);
    const t = d ? new Date(d).getTime() : NaN;
    return isNaN(t) ? Infinity : t; // sem data válida vai para o fim, nunca embaralha
}
function ordenarPorCadastro(lista) {
    return (lista || []).slice().sort((a, b) => {
        const da = goianitaDataCadastroProduto(a);
        const dbb = goianitaDataCadastroProduto(b);
        if (da !== dbb) return da - dbb;
        return String(a.sku || a.id || '').localeCompare(String(b.sku || b.id || ''));
    });
}
window.GoianitaOrdenarPorCadastro = ordenarPorCadastro;

/**
 * Produtos que devem entrar num documento: SOMENTE os marcados na tabela da ficha do
 * fornecedor, na ordem de cadastro. Antes, os .docx ignoravam a marcação e traziam tudo.
 * Retorna também se existiam caixas de seleção na tela, para dar a mensagem certa.
 */
function produtosParaDocumento(clienteId) {
    const todos = ordenarPorCadastro(window.GoianitaDB.produtos.getByCliente(clienteId));
    const caixas = document.querySelectorAll('.contrato-check');
    if (!caixas || caixas.length === 0) {
        // Documento gerado de uma tela sem a tabela de seleção: usa todos, em ordem.
        return { produtos: todos, tinhaSelecao: false };
    }
    const marcados = Array.from(document.querySelectorAll('.contrato-check:checked')).map(cb => String(cb.value));
    return { produtos: todos.filter(p => marcados.includes(String(p.id))), tinhaSelecao: true };
}

/**
 * Selo permanente de estado da nuvem. Existe para que nenhum admin volte a trabalhar sem
 * perceber que está desconectado (era exatamente assim que os cadastros se perdiam).
 */
function initSeloNuvem() {
    if (document.getElementById('goianita-selo-nuvem')) return;
    const selo = document.createElement('div');
    selo.id = 'goianita-selo-nuvem';
    selo.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;font:600 12px/1.3 system-ui,sans-serif;' +
        'padding:8px 12px;border-radius:20px;box-shadow:0 2px 10px rgba(0,0,0,.18);cursor:default;max-width:280px;';
    document.body.appendChild(selo);

    const pintar = () => {
        const pend = (typeof pendingSyncTotal === 'function') ? pendingSyncTotal() : 0;
        const autenticado = !!(window.GoianitaAuth && window.GoianitaAuth.currentUser);
        let cor, fundo, txt;

        if (!navigator.onLine || GoianitaSessao.nuvem === 'indisponivel') {
            fundo = '#fdecea'; cor = '#b3261e';
            txt = 'SEM CONEXÃO — o que for cadastrado agora só aparecerá para os outros quando a internet voltar';
        } else if (!autenticado) {
            fundo = '#fdecea'; cor = '#b3261e';
            txt = 'NÃO CONECTADO À NUVEM — entre novamente no sistema';
        } else if (pend > 0) {
            fundo = '#fff4e5'; cor = '#8a5300';
            txt = 'Enviando ' + pend + ' registro(s) para a nuvem...';
        } else {
            fundo = '#e8f5ec'; cor = '#1b7f3b';
            txt = 'Sincronizado com a nuvem';
        }
        selo.style.background = fundo;
        selo.style.color = cor;
        selo.textContent = txt;
    };

    pintar();
    setInterval(pintar, 4000);
    window.addEventListener('online', pintar);
    window.addEventListener('offline', pintar);
    if (window.GoianitaAuth && window.GoianitaAuth.onAuthStateChanged) {
        window.GoianitaAuth.onAuthStateChanged(pintar);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Nada é renderizado antes de sabermos QUEM está acessando de verdade.
    await GoianitaSessaoPronta;
    initSeloNuvem();
    initMenuAdministradores();
    atualizarCacheAdmins(); // mantém o espelho local da lista de admins (usado no login)

    // Configura o Usuário Logado Mock
    initUserSession();

    // Inicializa a barra de navegação responsiva mobile
    initMobileNav();

    // Roteador Básico baseado em ID da página ou URL hash
    renderActivePage();

    // Eventos Globais
    window.addEventListener('hashchange', renderActivePage);
    window.addEventListener('goianitaDataChanged', renderActivePage);
});

function initUserSession() {
    // NUNCA assumir 'admin' quando a sessão está vazia: era isso que liberava a tela sem
    // autenticação no Firebase e deixava a máquina fora da sincronização, sem ninguém notar.
    // O papel vem da sessão real validada pela guarda de acesso.
    const role = (window.GoianitaSessao && window.GoianitaSessao.role) || sessionStorage.getItem('goianita_role') || '';
    const email = (window.GoianitaSessao && window.GoianitaSessao.email) || sessionStorage.getItem('goianita_email') || '';
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
        } else if (lowerEmail.includes('elber')) {
            name = "Elber";
            avatar = "EL";
        } else if (lowerEmail.includes('karinne')) {
            name = "Karinne";
            avatar = "KA";
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
    // Observação: a gestão de administradores fica em pages/admins.html, que tem o próprio
    // script embutido — não passa por este roteador.

    // Reaplicado após cada renderização: parte do conteúdo é remontada dinamicamente e
    // poderia reintroduzir botões de administração na tela do fornecedor.
    aplicarRestricoesCliente();
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ADMINISTRADORES — lista compartilhada na nuvem (coleção `admins` do Firestore)
 * ─────────────────────────────────────────────────────────────────────────────
 * Assim um admin inclui outro pela interface, sem depender de alterar o código.
 * A lista é espelhada em localStorage porque a TELA DE LOGIN precisa dela ANTES de
 * qualquer autenticação — e uma leitura sem usuário autenticado pode ser recusada pelas
 * regras do Firestore. Com o espelho, o aparelho já conhece a lista atualizada.
 */
const GOIANITA_ADMINS_CACHE = 'goianita_admins_cache';

function idDocAdmin(email) {
    return String(email || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

async function lerAdminsNuvem() {
    if (!window.GoianitaFirestore) throw new Error('sem conexão com a nuvem');
    // Lê TODOS os documentos e filtra aqui. A consulta antiga (`where ativo != false`)
    // deixava de fora justamente os registros sem o campo `ativo` preenchido.
    const snap = await window.GoianitaFirestore.collection('admins').get();
    return snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
}

function salvarCacheAdmins(lista) {
    try {
        const enxuta = (lista || []).map(a => ({ email: a.email, atalho: a.atalho || '', ativo: a.ativo !== false }));
        localStorage.setItem(GOIANITA_ADMINS_CACHE, JSON.stringify(enxuta));
    } catch (e) { /* cota cheia: ignora */ }
}

// Roda em segundo plano nas telas de admin, para manter o espelho local atualizado.
async function atualizarCacheAdmins() {
    try {
        if (!window.GoianitaSessao || window.GoianitaSessao.role !== 'admin') return;
        salvarCacheAdmins(await lerAdminsNuvem());
    } catch (e) { /* silencioso: é só manutenção de cache */ }
}

// Acrescenta o item "Administradores" ao menu de todas as telas (só para admin),
// evitando editar o menu de cada página HTML uma por uma.
function initMenuAdministradores() {
    if (!window.GoianitaSessao || window.GoianitaSessao.role !== 'admin') return;
    const menu = document.querySelector('.nav-menu');
    if (!menu || document.getElementById('nav-administradores')) return;

    // Várias páginas já trazem o item "Administradores" escrito no HTML, apontando para
    // pages/admins.html — que é a tela oficial. A verificação precisa reconhecer os DOIS
    // nomes de arquivo: foi por não reconhecer "admins.html" que o item saiu duplicado.
    const ehLinkDeAdmins = (a) => /admins\.html|administradores\.html/.test(a.getAttribute('href') || '');
    const links = Array.from(menu.querySelectorAll('a'));
    const paginaAtual = window.location.pathname.split('/').pop() || '';

    if (links.some(ehLinkDeAdmins)) {
        // Já existe no HTML: não injeta nada, só destaca quando estamos nessa tela.
        if (paginaAtual === 'admins.html' || paginaAtual === 'administradores.html') {
            links.forEach(a => { if (ehLinkDeAdmins(a) && a.parentElement) a.parentElement.classList.add('active'); });
        }
        return;
    }
    const emPages = window.location.pathname.indexOf('/pages/') !== -1;
    const li = document.createElement('li');
    li.className = 'nav-item';
    li.id = 'nav-administradores';
    li.innerHTML = '<a href="' + (emPages ? 'admins.html' : 'pages/admins.html') + '">' +
        '<i class="fa-solid fa-user-shield"></i> Administradores</a>';
    menu.appendChild(li);
    if ((window.location.pathname.split('/').pop() || '') === 'administradores.html') {
        li.classList.add('active');
    }
}

function avisoAdmin(msg, tipo) {
    const el = document.getElementById('admin-aviso');
    if (!el) return;
    const cores = {
        erro:  ['#fdecea', '#b3261e'],
        ok:    ['#e8f5ec', '#1b7f3b'],
        alerta:['#fff4e5', '#8a5300']
    }[tipo || 'alerta'];
    el.style.background = cores[0];
    el.style.color = cores[1];
    el.style.borderLeft = '4px solid ' + cores[1];
    el.innerHTML = msg;
    el.style.display = 'block';
}

window.abrirFormAdmin = function(email) {
    const box = document.getElementById('admin-form-box');
    if (!box) return;
    const lista = window.GoianitaAdminsCarregados || [];
    const alvo = email ? lista.find(a => String(a.email).toLowerCase() === String(email).toLowerCase()) : null;

    document.getElementById('admin-form-titulo').textContent = alvo ? 'Editar Administrador' : 'Incluir Administrador';
    document.getElementById('adm-id-original').value = alvo ? alvo.email : '';
    document.getElementById('adm-nome').value = alvo ? (alvo.nome || '') : '';
    document.getElementById('adm-email').value = alvo ? (alvo.email || '') : '';
    document.getElementById('adm-atalho').value = alvo ? (alvo.atalho || '') : '';
    document.getElementById('adm-ativo').value = (alvo && alvo.ativo === false) ? 'false' : 'true';
    box.style.display = 'block';
    document.getElementById('adm-nome').focus();
};

window.fecharFormAdmin = function() {
    const box = document.getElementById('admin-form-box');
    if (box) box.style.display = 'none';
};

window.alternarAdminAtivo = async function(email, ativar) {
    if (!confirm(ativar
        ? 'Reativar o acesso de ' + email + '?'
        : 'Bloquear o acesso de ' + email + '?\n\nEle deixa de ser reconhecido como administrador.')) return;
    try {
        await window.GoianitaFirestore.collection('admins').doc(idDocAdmin(email)).set({
            email: String(email).toLowerCase(),
            ativo: !!ativar,
            atualizadoEm: new Date().toISOString()
        }, { merge: true });
        avisoAdmin('Situação atualizada.', 'ok');
        renderAdministradores(true);
    } catch (e) {
        avisoAdmin('Não foi possível salvar: ' + esc(e && (e.code || e.message)), 'erro');
    }
};

// Evita releitura desnecessária: esta tela é redesenhada a cada evento de sincronização
// (clientes/produtos/pagamentos), que nada tem a ver com a lista de administradores.
let goianitaAdminsUltimaLeitura = 0;

async function renderAdministradores(forcar) {
    const corpo = document.getElementById('admins-table-body');
    if (!corpo) return;

    const agora = Date.now();
    const jaDesenhado = !!window.GoianitaAdminsCarregados;
    if (!forcar && jaDesenhado && (agora - goianitaAdminsUltimaLeitura) < 15000) return;
    goianitaAdminsUltimaLeitura = agora;

    // Lista base que vive no código (garante que nunca ficamos sem nenhum acesso).
    const FIXOS = [
        { nome: 'Administrador', email: 'admin@goianita.com.br', atalho: 'admin' },
        { nome: 'Adriano Estevão', email: 'adrianogoianita@gmail.com', atalho: 'adriano' },
        { nome: 'Débora', email: 'debora@goianita.com.br', atalho: 'debora' },
        { nome: 'Eduardo', email: 'eduardfreitasg@gmail.com', atalho: 'eduard' },
        { nome: 'Goianita', email: 'goianita@terra.com.br', atalho: 'goianita' },
        { nome: 'Karinne', email: 'karinne@goianita.com.br', atalho: 'karinne' },
        { nome: 'Elber', email: 'elber@goianita.com.br', atalho: 'elber' }
    ];

    let daNuvem = [];
    let erroNuvem = null;
    try {
        daNuvem = await lerAdminsNuvem();
        salvarCacheAdmins(daNuvem);
    } catch (e) {
        erroNuvem = (e && (e.code || e.message)) || 'falha desconhecida';
    }

    // Junta: o registro da nuvem prevalece sobre o fixo (permite editar nome/atalho/situação).
    const porEmail = {};
    FIXOS.forEach(a => { porEmail[a.email.toLowerCase()] = Object.assign({ ativo: true, fixo: true }, a); });
    daNuvem.forEach(a => {
        if (!a.email) return;
        const k = String(a.email).toLowerCase();
        porEmail[k] = Object.assign({}, porEmail[k] || {}, a, { ativo: a.ativo !== false, email: k });
    });
    const lista = Object.values(porEmail).sort((x, y) => String(x.nome || x.email).localeCompare(String(y.nome || y.email)));
    window.GoianitaAdminsCarregados = lista;

    if (erroNuvem) {
        avisoAdmin('Não foi possível ler a lista na nuvem (<span class="cod">' + esc(erroNuvem) + '</span>). ' +
            'Mostrando apenas a lista base do sistema. Inclusões feitas agora podem não salvar.', 'erro');
    }

    corpo.innerHTML = lista.map(a => {
        const ativo = a.ativo !== false;
        return '<tr>' +
            '<td><strong>' + esc(a.nome || '—') + '</strong></td>' +
            '<td>' + esc(a.email) + '</td>' +
            '<td>' + (a.atalho ? esc(a.atalho) : '<span style="color:var(--text-muted);">—</span>') + '</td>' +
            '<td>' + (ativo
                ? '<span class="badge badge-pago">Ativo</span>'
                : '<span class="badge badge-devolvido">Inativo</span>') + '</td>' +
            '<td style="display:flex; gap:8px; flex-wrap:wrap;">' +
                '<button class="btn btn-secondary" style="padding:6px 12px; font-size:12px;" onclick="abrirFormAdmin(\'' + esc(a.email) + '\')">Editar</button>' +
                '<button class="btn btn-secondary" style="padding:6px 12px; font-size:12px;" onclick="alternarAdminAtivo(\'' + esc(a.email) + '\', ' + (ativo ? 'false' : 'true') + ')">' +
                    (ativo ? 'Bloquear' : 'Reativar') + '</button>' +
            '</td>' +
        '</tr>';
    }).join('');

    const form = document.getElementById('admin-form');
    if (form && !form.dataset.bound) {
        form.dataset.bound = '1';
        form.addEventListener('submit', async (ev) => {
            ev.preventDefault();
            const email = document.getElementById('adm-email').value.trim().toLowerCase();
            const nome = document.getElementById('adm-nome').value.trim();
            const atalho = document.getElementById('adm-atalho').value.trim().toLowerCase().replace(/\s+/g, '');
            const ativo = document.getElementById('adm-ativo').value === 'true';
            const original = document.getElementById('adm-id-original').value.trim().toLowerCase();

            if (!email || email.indexOf('@') === -1) { alert('Informe um e-mail válido.'); return; }
            if (atalho && /\d/.test(atalho) === false && atalho.indexOf('@') !== -1) { alert('O atalho não deve conter "@".'); return; }
            if (atalho && /^[\d.\-\/\s]+$/.test(atalho)) { alert('O atalho não pode ser só números — isso seria confundido com o CPF de um fornecedor.'); return; }

            const conflito = (window.GoianitaAdminsCarregados || []).find(a =>
                a.atalho && atalho && a.atalho.toLowerCase() === atalho && String(a.email).toLowerCase() !== email);
            if (conflito) { alert('O atalho "' + atalho + '" já é usado por ' + conflito.email + '.'); return; }

            try {
                await window.GoianitaFirestore.collection('admins').doc(idDocAdmin(email)).set({
                    nome: nome, email: email, atalho: atalho, ativo: ativo,
                    atualizadoEm: new Date().toISOString()
                }, { merge: true });

                // Trocou o e-mail ao editar: desativa o registro antigo para não sobrar acesso.
                if (original && original !== email) {
                    await window.GoianitaFirestore.collection('admins').doc(idDocAdmin(original)).set({
                        email: original, ativo: false, atualizadoEm: new Date().toISOString()
                    }, { merge: true });
                }

                fecharFormAdmin();
                avisoAdmin('Administrador salvo. Ele já pode entrar digitando <strong>' +
                    esc(atalho || email) + '</strong> e criar a senha no primeiro acesso.', 'ok');
                renderAdministradores(true);
            } catch (e) {
                avisoAdmin('Não foi possível salvar na nuvem: <span class="cod">' +
                    esc(e && (e.code || e.message)) + '</span>', 'erro');
            }
        });
    }
}

// --- UTILS FORMATADORES ---

/**
 * Escapa texto para inserção segura em HTML (proteção contra XSS).
 * Deve envolver qualquer valor vindo do usuário/banco antes de ir para innerHTML.
 */
function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Parser de moeda pt-BR (usa o helper global de db.js quando disponível).
 * Trata separador de milhar e decimal: "1.399,00" -> 1399.00
 */
function parseMoeda(valor) {
    if (typeof window.parseMoedaBR === 'function') return window.parseMoedaBR(valor);
    if (typeof valor === 'number') return valor;
    if (!valor) return 0;
    let s = String(valor).replace(/[R$\s]/g, '');
    if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

/**
 * Atualiza o innerHTML de uma tabela SOMENTE se o conteúdo mudou.
 * Evita reconstruir o DOM a cada evento goianitaDataChanged (que o Firebase dispara
 * várias vezes) — o que recriava os botões embaixo do cursor, causando o hover piscando
 * e cliques perdidos nos botões "Visualizar"/"Gerenciar".
 */
function renderTabela(tableBody, html) {
    if (!tableBody) return;
    if (tableBody.dataset.lastHtml === html) return; // nada mudou → não mexe no DOM
    tableBody.dataset.lastHtml = html;
    tableBody.innerHTML = html;
}

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
            <div class="kpi-card" style="border-left: 4px solid var(--accent-gold);">
                <div class="kpi-title"><i class="fa-solid fa-handshake"></i> Embaixadores</div>
                <div class="kpi-value">${resumo.embAtivos || 0}</div>
                <div class="kpi-desc"><a href="pages/embaixadores.html" style="color:var(--accent-gold);">Ver painel de embaixadores</a></div>
            </div>
            <div class="kpi-card" style="border-left: 4px solid #e6a800;">
                <div class="kpi-title">Repasses a Embaixadores</div>
                <div class="kpi-value">${formatCurrency(resumo.saldoPagarEmbaixadores || 0)}</div>
                <div class="kpi-desc">Comissões de captação pendentes</div>
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
                    <td><strong>${esc(p.sku)}</strong></td>
                    <td>${esc(p.nome)}</td>
                    <td>${esc(cliente.nome)}</td>
                    <td>${formatCurrency(p.precoVenda)}</td>
                    <td>${getStatusBadge(p.status)}</td>
                    <td><a href="pages/produto-detalhe.html?id=${encodeURIComponent(p.id)}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Ver</a></td>
                </tr>
            `;
        }).join('');
    }
}

// --- CLIENTES LISTAGEM E CADASTRO ---
/**
 * Atribui o código de 3 dígitos aos fornecedores que ainda não têm (base criada antes do
 * padrão de SKU). Vai na ORDEM DE CADASTRO, para que o resultado seja o mesmo em qualquer
 * aparelho, e nunca altera código já atribuído — mudá-lo invalidaria etiquetas impressas.
 */
/**
 * Aplica um código a um fornecedor e reescreve os SKUs dos produtos dele que usavam o
 * código anterior (mantendo o número do produto). Centralizado aqui para que a geração
 * automática e a definição manual sigam exatamente a mesma regra.
 */
async function aplicarCodigoFornecedor(clienteId, novoCodigo) {
    const cfg = window.GoianitaSkuConfig || { prefixo: '201', digitosProduto: 2 };
    const cliente = window.GoianitaDB.clientes.getById(clienteId);
    if (!cliente) throw new Error('Fornecedor não encontrado nesta máquina.');

    const novo = String(novoCodigo).padStart(3, '0');
    const antigo = cliente.codigoFornecedor ? String(cliente.codigoFornecedor).padStart(3, '0') : null;
    if (antigo === novo) return { skus: 0 };

    const conflito = window.GoianitaDB.clientes.getAll().find(c =>
        c.id !== clienteId && String(c.codigoFornecedor || '').padStart(3, '0') === novo);
    if (conflito) throw new Error('O código ' + novo + ' já pertence a "' + conflito.nome + '".');

    await window.GoianitaDB.clientes.save(Object.assign({}, cliente, { codigoFornecedor: novo }), true);

    // Alinha TODOS os produtos deste fornecedor que estejam no formato novo, qualquer que
    // seja o código no meio do SKU. Por definição o produto é dele, então o trecho do
    // fornecedor tem de ser o código dele. Antes eu só reescrevia quando havia um código
    // anterior conhecido — e um fornecedor restaurado da nuvem (que perdeu o código) ficava
    // com os SKUs apontando para outro número.
    let skus = 0;
    for (const p of window.GoianitaDB.produtos.getByCliente(clienteId)) {
        const s = String(p.sku || '');
        if (s.length !== 6 + cfg.digitosProduto) continue;   // formato antigo (GOI-PR-...): não mexe
        if (s.slice(0, 3) !== cfg.prefixo) continue;
        if (s.slice(3, 6) === novo) continue;                // já está correto
        await window.GoianitaDB.produtos.save(Object.assign({}, p, { sku: cfg.prefixo + novo + s.slice(6) }), true);
        skus++;
    }
    return { skus: skus };
}

/**
 * Define o código de um fornecedor à mão. Existe porque a numeração automática segue a
 * ordem de cadastro, e às vezes é preciso reservar um número específico para alguém.
 */
window.definirCodigoFornecedor = async function(clienteId) {
    const cfg = window.GoianitaSkuConfig || { fornecedorInicial: 101, fornecedorMax: 999 };
    const cliente = window.GoianitaDB.clientes.getById(clienteId);
    if (!cliente) { alert('Fornecedor não encontrado.'); return; }

    const digitado = prompt('Código de ' + cliente.nome + ' (faixa ' + cfg.fornecedorInicial +
        ' a ' + cfg.fornecedorMax + '):', cliente.codigoFornecedor || String(cfg.fornecedorInicial));
    if (digitado === null) return;

    const n = parseInt(String(digitado).replace(/\D/g, ''), 10);
    if (isNaN(n) || n < cfg.fornecedorInicial || n > cfg.fornecedorMax) {
        alert('Informe um número entre ' + cfg.fornecedorInicial + ' e ' + cfg.fornecedorMax + '.');
        return;
    }

    try {
        const r = await aplicarCodigoFornecedor(clienteId, n);
        alert('Código de ' + cliente.nome + ' definido como ' + String(n).padStart(3, '0') + '.' +
            (r.skus ? '\nSKUs de produtos ajustados: ' + r.skus : ''));
        renderClientesList();
    } catch (e) {
        alert('Não foi possível: ' + (e && e.message));
    }
};

/**
 * Restaura um fornecedor que foi excluído (e os produtos dele), trazendo os dados da nuvem.
 * Necessário porque a exclusão deixa uma marca no aparelho: sem removê-la, o registro
 * continuaria escondido aqui e a marca ainda tentaria propagar a exclusão para a nuvem.
 */
window.restaurarFornecedorExcluido = async function() {
    if (!window.GoianitaFirestore) { alert('Sem conexão com a nuvem.'); return; }

    let docs = [];
    try {
        const snap = await window.GoianitaFirestore.collection('clientes').get({ source: 'server' });
        docs = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
    } catch (e) {
        alert('Não foi possível ler a nuvem: ' + (e && (e.code || e.message)));
        return;
    }

    const idsLocais = new Set(window.GoianitaDB.clientes.getAll().map(c => c.id));
    const marcados = new Set(window.GoianitaTombstonesDe('clientes'));
    // Candidatos: marcados como excluídos na nuvem, escondidos por marca local, ou que
    // simplesmente não estão nesta máquina.
    const ocultos = docs.filter(c => c.excluido === true || marcados.has(c.id) || !idsLocais.has(c.id));

    if (ocultos.length === 0) {
        alert('Nenhum fornecedor excluído ou ausente foi encontrado na nuvem.');
        return;
    }

    const lista = ocultos.map((c, i) => (i + 1) + ') ' + (c.nome || '(sem nome)') + ' — CPF ' + (c.cpf || '?') +
        (c.excluido === true ? ' [excluído na nuvem]' : (marcados.has(c.id) ? ' [excluído nesta máquina]' : ' [ausente aqui]')));
    const escolha = prompt('Fornecedores que podem ser restaurados:\n\n' + lista.join('\n') +
        '\n\nDigite o número do que deseja restaurar:');
    if (escolha === null) return;

    const idx = parseInt(escolha, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= ocultos.length) { alert('Opção inválida.'); return; }

    const alvo = ocultos[idx];
    if (!confirm('Restaurar "' + alvo.nome + '" (CPF ' + alvo.cpf + ') e os produtos vinculados a ele?')) return;

    try {
        // 1. Apaga a marca local de exclusão — senão ele volta a ser escondido/apagado.
        window.GoianitaRemoveTombstone('clientes', alvo.id);

        // 2. Reativa o cadastro na nuvem e grava localmente.
        const limpo = Object.assign({}, alvo);
        delete limpo.excluido;
        delete limpo.excluidoEm;
        await window.GoianitaDB.clientes.save(limpo, true);

        // 3. Traz os produtos dele, reativando os que estavam excluídos.
        let produtosOk = 0;
        const snapProd = await window.GoianitaFirestore.collection('produtos').get({ source: 'server' });
        for (const d of snapProd.docs) {
            const p = Object.assign({ id: d.id }, d.data());
            if (p.clienteId !== alvo.id) continue;
            window.GoianitaRemoveTombstone('produtos', p.id);
            const pl = Object.assign({}, p);
            delete pl.excluido;
            delete pl.excluidoEm;
            await window.GoianitaDB.produtos.save(pl, true);
            produtosOk++;
        }

        alert('"' + alvo.nome + '" restaurado.\nProdutos recuperados: ' + produtosOk +
            '\n\nSe precisar de um código específico, use o botão "Código" na linha dele.');
        renderClientesList();
    } catch (e) {
        alert('Falha ao restaurar: ' + (e && (e.code || e.message)));
    }
};

window.gerarCodigosFornecedores = async function() {
    const cfg = window.GoianitaSkuConfig || { prefixo: '201', fornecedorInicial: 101, digitosProduto: 2 };
    const inicial = cfg.fornecedorInicial;

    const todos = window.GoianitaDB.clientes.getAll();
    // Entram na fila: quem não tem código E quem tem código FORA da faixa oficial
    // (a primeira versão numerava a partir de 001; o padrão correto começa em 101).
    const pendentes = todos
        .filter(c => {
            const n = parseInt(c.codigoFornecedor, 10);
            return !c.codigoFornecedor || isNaN(n) || n < inicial;
        })
        .sort((a, b) => new Date(a.dataCadastro || 0) - new Date(b.dataCadastro || 0));

    if (pendentes.length === 0) {
        alert('Todos os fornecedores já possuem código dentro do padrão (a partir de ' + inicial + ').');
        return;
    }

    // Prévia do que muda, incluindo quantos SKUs de produtos serão reescritos.
    const linhas = pendentes.map(c => {
        const antigo = c.codigoFornecedor ? String(c.codigoFornecedor).padStart(3, '0') : null;
        const qtdSkus = antigo
            ? window.GoianitaDB.produtos.getByCliente(c.id).filter(p => {
                  const s = String(p.sku || '');
                  return s.length === 6 + cfg.digitosProduto && s.slice(0, 3) === cfg.prefixo && s.slice(3, 6) === antigo;
              }).length
            : 0;
        return '• ' + c.nome + (antigo ? ' (hoje ' + antigo + ')' : ' (sem código)') +
               (qtdSkus ? ' — ' + qtdSkus + ' SKU(s) de produto serão ajustados' : '');
    });

    if (!confirm(pendentes.length + ' fornecedor(es) a numerar, na ordem de cadastro:\n\n' +
        linhas.slice(0, 12).join('\n') + (linhas.length > 12 ? '\n• ...' : '') +
        '\n\nOs códigos passam a começar em ' + inicial + ' (ex.: primeiro produto do primeiro fornecedor = ' +
        cfg.prefixo + inicial + '01).\n\nConfirma? O código de cada fornecedor passa a valer para sempre.')) return;

    let feitos = 0, skusAjustados = 0;
    const falhas = [];

    for (const c of pendentes) {
        try {
            const atual = Object.assign({}, window.GoianitaDB.clientes.getById(c.id) || c);
            const antigo = atual.codigoFornecedor ? String(atual.codigoFornecedor).padStart(3, '0') : null;

            // Já corrigido por outro aparelho enquanto rodávamos: não mexe.
            const nAtual = parseInt(atual.codigoFornecedor, 10);
            if (!isNaN(nAtual) && nAtual >= inicial) continue;

            const novo = await window.GoianitaReservarCodigoFornecedor();
            // Mesma função usada na definição manual: garante regra única para gravar o
            // código e realinhar os SKUs dos produtos.
            const r = await aplicarCodigoFornecedor(c.id, novo);
            feitos++;
            skusAjustados += r.skus;
        } catch (e) {
            falhas.push(c.nome + ': ' + (e && (e.code || e.message)));
        }
    }

    await window.GoianitaDB.importExport.syncToGoogleSheets();
    alert('Fornecedores numerados: ' + feitos +
        (skusAjustados ? '\nSKUs de produtos ajustados: ' + skusAjustados : '') +
        (falhas.length ? '\n\nNão foi possível em:\n' + falhas.join('\n') : ''));
    renderClientesList();
};

function renderClientesList() {
    const tableBody = document.getElementById('clientes-table-body');
    if (!tableBody) return;
    
    const clientes = window.GoianitaDB.clientes.getAll();
    
    function drawTable(list) {
        // Ordena por nome para garantir estabilidade do HTML (evita piscar o boto)
        list.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
        renderTabela(tableBody, list.map(c => {
            const financeiro = window.GoianitaDB.utils.calcularValoresCliente(c.id);
            return `
                <tr>
                    <td>${c.codigoFornecedor
                        ? `<strong style="font-family: Consolas, monospace;">${esc(c.codigoFornecedor)}</strong>`
                        : '<span style="color: var(--text-muted); font-size: 12px;">sem código</span>'}</td>
                    <td><strong>${esc(c.nome)}</strong></td>
                    <td>${esc(c.cpf)}</td>
                    <td>${esc(c.telefone)}</td>
                    <td>${financeiro.produtosTotais} produtos</td>
                    <td><strong style="color: var(--accent-gold);">${formatCurrency(financeiro.saldoPendente)}</strong></td>
                    <td style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <a href="cliente-detalhe.html?id=${encodeURIComponent(c.id)}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Visualizar</a>
                        <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;"
                                onclick="definirCodigoFornecedor('${esc(c.id)}')" title="Definir o código deste fornecedor (usado no SKU)">Código</button>
                    </td>
                </tr>
            `;
        }).join(''));
    }

    drawTable(clientes);
    
    // Filtro de Busca
    const searchInput = document.getElementById('search-clientes');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase();
            // Busca também pelo código de 3 dígitos e pelo início do SKU (ex.: "201014"),
            // porque na prática o atendente tem a etiqueta do produto na mão.
            const soDigitos = val.replace(/\D/g, '');
            const filtered = clientes.filter(c => {
                const cod = String(c.codigoFornecedor || '');
                const casaCodigo = cod && soDigitos && (
                    cod === soDigitos ||
                    cod === soDigitos.padStart(3, '0') ||
                    (soDigitos.length >= 6 && soDigitos.slice(0, 3) === '201' && soDigitos.slice(3, 6) === cod)
                );
                return (c.nome || '').toLowerCase().includes(val) ||
                       (c.cpf || '').includes(val) ||
                       (c.email || '').toLowerCase().includes(val) ||
                       casaCodigo;
            });
            drawTable(filtered);
        });
    }

    // Formulário de novo cliente (se estiver na mesma página em modal, ou capturando submit da página de cadastro)
    const form = document.getElementById('cliente-form');
    if (form && !form.dataset.handlerBound) {
        form.dataset.handlerBound = '1';
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
            const elEnd = document.getElementById('cli-endereco');
            const elCont = document.getElementById('cli-contato');
            const novoCliente = {
                nome: document.getElementById('cli-nome').value,
                cpf: document.getElementById('cli-cpf').value,
                telefone: document.getElementById('cli-tel').value,
                email: document.getElementById('cli-email').value,
                endereco: elEnd ? elEnd.value : '',
                contato: elCont ? elCont.value : '',
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

        const btnExcluir = document.getElementById('btn-excluir-cliente');
        if (btnExcluir) btnExcluir.style.display = 'none';

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
        if (!btnPagar.dataset.handlerBound) {
        btnPagar.dataset.handlerBound = '1';
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
                    alert("Valor inválido.");
                }
            }
        });
        }
    }

    const btnExcluir = document.getElementById('btn-excluir-cliente');
    if (btnExcluir && role === 'admin' && !btnExcluir.dataset.handlerBound) {
        btnExcluir.dataset.handlerBound = '1';
        btnExcluir.addEventListener('click', () => {
            const hasProdutos = window.GoianitaDB.produtos.getByCliente(id).length > 0;
            if (hasProdutos) {
                alert("Não é possível excluir este fornecedor pois ele possui produtos vinculados.");
                return;
            }
            if (confirm(`ATENÇÃO: Você tem certeza que deseja excluir o fornecedor ${cliente.nome}?\nEsta ação não pode ser desfeita.`)) {
                window.GoianitaDB.clientes.delete(id).then(() => {
                    alert("Fornecedor excluído com sucesso.");
                    window.location.href = 'clientes.html';
                }).catch(err => {
                    alert("Erro ao excluir fornecedor: " + err.message);
                });
            }
        });
    }
    
    const btnAlterarSenha = document.getElementById('btn-alterar-senha');
    if (btnAlterarSenha && !btnAlterarSenha.dataset.handlerBound) {
        btnAlterarSenha.dataset.handlerBound = '1';
        btnAlterarSenha.addEventListener('click', async () => {
            const ehAdmin = role === 'admin';
            const novaSenha = prompt(ehAdmin
                ? `Digite a nova senha para o fornecedor ${cliente.nome} (mínimo 6 caracteres):`
                : `Digite sua nova senha (mínimo 6 caracteres):`);
            if (novaSenha === null) return;
            if (novaSenha.length < 6) { alert('A senha deve ter pelo menos 6 caracteres.'); return; }

            btnAlterarSenha.disabled = true;
            const htmlOrig = btnAlterarSenha.innerHTML;
            btnAlterarSenha.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
            try {
                // A senha é gravada como HASH no cadastro do fornecedor (db.clientes.save
                // converte cliente.senha em senhaHash). Sem Firebase Auth, sem Apps Script.
                const atual = window.GoianitaDB.clientes.getById(cliente.id) || cliente;
                atual.senha = novaSenha;
                await window.GoianitaDB.clientes.save(atual);
                alert(ehAdmin
                    ? `✅ Senha de ${cliente.nome} definida! Ele já entra com o CPF e essa senha.`
                    : '✅ Sua senha foi alterada com sucesso!');
            } catch (err) {
                alert('Erro ao alterar senha: ' + (err.message || err));
            } finally {
                btnAlterarSenha.disabled = false;
                btnAlterarSenha.innerHTML = htmlOrig;
            }
        });
    }
    
    // Listar produtos do cliente
    const prodTable = document.getElementById('cli-produtos-table');
    if (prodTable) {
        // Ordem de cadastro: é esta a ordem que os documentos vão seguir.
        const produtos = ordenarPorCadastro(window.GoianitaDB.produtos.getByCliente(id));
        window.toggleTodosContrato = function(el) {
            document.querySelectorAll('.contrato-check').forEach(cb => {
                if(!cb.disabled) cb.checked = el.checked;
            });
        };

        prodTable.innerHTML = produtos.map(p => {
            const taxaImp = window.TAXA_IMPOSTO || 11;
            const liq = p.precoVenda - (p.precoVenda * taxaImp / 100);
            const valorCliente = liq - (liq * p.comissao / 100);
            const isApproved = p.status !== 'Recusado/Devolvido'; // ou algo do tipo
            return `
                <tr>
                    <td style="text-align: center;">
                        <input type="checkbox" class="contrato-check" value="${esc(p.id)}" ${isApproved ? 'checked' : 'disabled title="Produto reprovado não pode entrar no contrato"'}>
                    </td>
                    <td><strong>${esc(p.sku)}</strong></td>
                    <td>${esc(p.nome)}</td>
                    <td>${formatCurrency(p.precoVenda)}</td>
                    <td>${p.comissao}%</td>
                    <td>${formatCurrency(valorCliente)}</td>
                    <td>${getStatusBadge(p.status)}</td>
                    <td>
                        ${role === 'admin'
                            ? `<a href="produto-detalhe.html?id=${encodeURIComponent(p.id)}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Gerenciar</a>`
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
                    <td>${esc(p.chavePix)}</td>
                    <td><code style="background-color: var(--bg-secondary); padding: 4px 8px; border-radius: 4px; font-size: 12px;">${esc(p.comprovante)}</code></td>
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
        // Ordem de cadastro (mais antigo primeiro), igual para todos os usuários.
        list = ordenarPorCadastro(list);
        renderTabela(tableBody, list.map(p => {
            const cliente = window.GoianitaDB.clientes.getById(p.clienteId) || { nome: 'Desconhecido' };
            const taxaImp = window.TAXA_IMPOSTO || 11;
            const liq = p.precoVenda - (p.precoVenda * taxaImp / 100);
            const valorCliente = liq - (liq * p.comissao / 100);
            return `
                <tr>
                    <td><strong>${esc(p.sku)}</strong></td>
                    <td>${esc(p.nome)}</td>
                    <td>${esc(cliente.nome)}</td>
                    <td>${formatCurrency(p.precoVenda)}</td>
                    <td>${p.comissao}%</td>
                    <td><strong>${formatCurrency(valorCliente)}</strong></td>
                    <td>${getStatusBadge(p.status)}</td>
                    <td>
                        <a href="produto-detalhe.html?id=${encodeURIComponent(p.id)}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Gerenciar</a>
                    </td>
                </tr>
            `;
        }).join(''));
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
            // Guardas contra campo ausente: um produto sem SKU ou sem nome derrubava a busca.
            list = list.filter(p => String(p.nome || '').toLowerCase().includes(val) ||
                                    String(p.sku || '').toLowerCase().includes(val));
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

// --- EDITAR / EXCLUIR PRODUTO (lista de Produtos Consignados) ---
// Funções globais chamadas via onclick inline nos botões da lista. Usam db.produtos.save
// e db.produtos.delete, que já sincronizam com o Firestore e a planilha Google.
window.abrirEditarProduto = function(id) {
    const produto = window.GoianitaDB.produtos.getById(id);
    if (!produto) { alert('Produto não encontrado.'); return; }
    const modal = document.getElementById('modal-editar-produto');
    if (!modal) { alert('Modal de edição não encontrado nesta página.'); return; }
    document.getElementById('edit-prod-id').value = produto.id;
    document.getElementById('edit-prod-nome').value = produto.nome || '';
    const elSku = document.getElementById('edit-prod-sku');
    if (elSku) elSku.value = produto.sku || '';
    document.getElementById('edit-prod-categoria').value = produto.categoria || 'Outros';
    document.getElementById('edit-prod-marca').value = produto.marca || '';
    const elEmb = document.getElementById('edit-prod-embalagem');
    if (elEmb) elEmb.value = produto.embalagem || '';
    const elPrev = document.getElementById('edit-prod-prevvenda');
    if (elPrev) elPrev.value = produto.prevVenda || '';
    document.getElementById('edit-prod-preco').value = (produto.precoVenda != null) ? produto.precoVenda : '';
    document.getElementById('edit-prod-comissao').value = (produto.comissao != null) ? produto.comissao : '';
    document.getElementById('edit-prod-status').value = produto.status || 'Em Triagem';
    modal.style.display = 'flex';
};

window.fecharEditarProduto = function() {
    const modal = document.getElementById('modal-editar-produto');
    if (modal) modal.style.display = 'none';
};

window.salvarEdicaoProduto = async function() {
    const id = document.getElementById('edit-prod-id').value;
    const produto = window.GoianitaDB.produtos.getById(id);
    if (!produto) { alert('Produto não encontrado.'); return; }

    const nome = document.getElementById('edit-prod-nome').value.trim();
    const precoStr = document.getElementById('edit-prod-preco').value;
    if (!nome) { alert('Informe o nome do produto.'); return; }
    if (!precoStr) { alert('Informe o preço de venda.'); return; }

    // SKU editado à mão (usado para acertar os produtos cadastrados antes do padrão novo).
    // Validação de formato aqui; a de duplicidade é feita no save, que é por onde passam
    // todos os caminhos de gravação.
    const elSkuEdit = document.getElementById('edit-prod-sku');
    if (elSkuEdit) {
        const skuInformado = elSkuEdit.value.trim();
        if (!skuInformado) { alert('Informe o código (SKU) do produto.'); return; }
        if (skuInformado !== produto.sku) {
            if (!/^\d{8}$/.test(skuInformado)) {
                if (!confirm('O código "' + skuInformado + '" está fora do padrão de 8 dígitos (201 + fornecedor + produto).\n\nSalvar assim mesmo?')) return;
            } else {
                const cliente = window.GoianitaDB.clientes.getById(produto.clienteId);
                const codigoEsperado = cliente && cliente.codigoFornecedor;
                if (codigoEsperado && skuInformado.slice(3, 6) !== String(codigoEsperado).padStart(3, '0')) {
                    if (!confirm('Atenção: o código informado indica o fornecedor ' + skuInformado.slice(3, 6) +
                        ', mas este produto é do fornecedor ' + codigoEsperado + ' (' + (cliente.nome || '') + ').\n\nSalvar assim mesmo?')) return;
                }
            }
        }
        produto.sku = skuInformado;
    }

    produto.nome = nome;
    produto.categoria = document.getElementById('edit-prod-categoria').value;
    produto.marca = document.getElementById('edit-prod-marca').value;
    const embEl = document.getElementById('edit-prod-embalagem');
    if (embEl) produto.embalagem = embEl.value;
    const prevEl = document.getElementById('edit-prod-prevvenda');
    if (prevEl) produto.prevVenda = prevEl.value;
    produto.precoVenda = parseMoeda(precoStr);
    produto.comissao = parseFloat(document.getElementById('edit-prod-comissao').value) || produto.comissao || 50;
    produto.status = document.getElementById('edit-prod-status').value;

    const btn = document.getElementById('btn-salvar-edicao-produto');
    const original = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

    try {
        await window.GoianitaDB.produtos.save(produto);
        alert('Produto atualizado com sucesso!');
        window.location.reload();
    } catch (err) {
        alert('Erro ao salvar: ' + err.message);
        if (btn) { btn.disabled = false; btn.textContent = original; }
    }
};

// Chamadas pelos botões dentro da ficha do produto (produto-detalhe.html).
// Leem o id do produto direto da URL, então funcionam via onclick inline sem
// precisar de wiring dinâmico (evita empilhamento de handlers).
window.editarProdutoAtual = function() {
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) window.abrirEditarProduto(id);
};

window.excluirProdutoAtual = async function() {
    const id = new URLSearchParams(window.location.search).get('id');
    const produto = window.GoianitaDB.produtos.getById(id);
    if (!produto) { alert('Produto não encontrado.'); return; }
    if (!confirm(`Excluir o produto "${produto.nome}" (${produto.sku})?\n\nEsta ação não pode ser desfeita e remove também do Firebase.`)) return;
    try {
        await window.GoianitaDB.produtos.delete(id);
        alert('Produto excluído com sucesso.');
        window.location.href = 'produtos.html';
    } catch (err) {
        alert('Erro ao excluir: ' + err.message);
    }
};

// --- NOVO PRODUTO ---
function renderProdutoNovo() {
    const selectCliente = document.getElementById('prod-cliente');
    if (!selectCliente) return;
    
    // Popula dropdown de clientes, em ordem alfabética para facilitar achar na lista.
    const clientes = window.GoianitaDB.clientes.getAll()
        .slice()
        .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || '')));

    const opcaoCliente = (c) => `<option value="${esc(c.id)}" data-comissao="${esc(c.comissaoPadrao)}">` +
        `${c.codigoFornecedor ? '[' + esc(c.codigoFornecedor) + '] ' : ''}${esc(c.nome)} (${esc(c.cpf)})</option>`;

    const preencherOpcoes = (lista) => {
        const selecionadoAntes = selectCliente.value;
        selectCliente.innerHTML = `<option value="">Selecione o Fornecedor...</option>` +
            lista.map(opcaoCliente).join('');
        // Mantém a escolha se ela continuar visível na lista filtrada.
        if (selecionadoAntes && lista.some(c => c.id === selecionadoAntes)) {
            selectCliente.value = selecionadoAntes;
        }
    };
    preencherOpcoes(clientes);

    // ── Pesquisa de fornecedor por nome, CPF ou código ──
    // Filtra as opções do próprio select: o restante do formulário continua lendo
    // `prod-cliente`.value, então o salvamento não muda em nada.
    const buscaCliente = document.getElementById('prod-cliente-busca');
    const infoCliente = document.getElementById('prod-cliente-info');
    if (buscaCliente) {
        const filtrar = () => {
            const termo = buscaCliente.value.trim().toLowerCase();
            const soDigitos = termo.replace(/\D/g, '');

            const achados = !termo ? clientes : clientes.filter(c => {
                const nome = String(c.nome || '').toLowerCase();
                const cpf = String(c.cpf || '').replace(/\D/g, '');
                const cod = String(c.codigoFornecedor || '');
                return nome.includes(termo)
                    || (soDigitos && cpf.includes(soDigitos))
                    || (soDigitos && cod && (cod === soDigitos || cod === soDigitos.padStart(3, '0')
                        || (soDigitos.length >= 6 && soDigitos.slice(0, 3) === '201' && soDigitos.slice(3, 6) === cod)));
            });

            preencherOpcoes(achados);

            if (!termo) {
                infoCliente.textContent = clientes.length + ' fornecedor(es) cadastrado(s).';
            } else if (achados.length === 0) {
                infoCliente.innerHTML = '<span style="color:#b3261e;">Nenhum fornecedor encontrado para "' + esc(buscaCliente.value.trim()) + '".</span>';
            } else if (achados.length === 1) {
                // Resultado único: já seleciona e traz a comissão, poupando um clique.
                selectCliente.value = achados[0].id;
                selectCliente.dispatchEvent(new Event('change'));
                infoCliente.innerHTML = 'Selecionado: <strong>' + esc(achados[0].nome) + '</strong>';
            } else {
                infoCliente.textContent = achados.length + ' fornecedores encontrados — escolha abaixo.';
            }
        };

        // Os ouvintes são ligados UMA vez; já o filtro é reaplicado em toda renderização,
        // porque esta tela é redesenhada a cada sincronização de dados — sem isso, a lista
        // voltava a mostrar todos os fornecedores no meio do preenchimento do formulário.
        if (!buscaCliente.dataset.bound) {
            buscaCliente.dataset.bound = '1';
            buscaCliente.addEventListener('input', filtrar);
            // Enter no campo de busca não deve enviar o formulário pela metade.
            buscaCliente.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); filtrar(); selectCliente.focus(); }
            });
        }
        filtrar();
    }
        
    // Ao selecionar cliente, atualiza a comissão automaticamente.
    // O ouvinte é ligado UMA vez: esta função roda a cada sincronização e, sem a trava,
    // os ouvintes se acumulavam (o mesmo evento passava a ser tratado várias vezes).
    if (!selectCliente.dataset.bound) {
        selectCliente.dataset.bound = '1';
        selectCliente.addEventListener('change', () => {
            const opt = selectCliente.selectedOptions[0];
            if (!opt) return; // lista pode estar vazia após um filtro sem resultado
            const comissao = opt.getAttribute('data-comissao');
            if (comissao) {
                document.getElementById('prod-comissao').value = comissao;
            }
        });
    }

    window.toggleEtapa2 = function(isAprovado) {
        const etapa2 = document.getElementById('etapa-2-dados');
        const btnSubmit = document.querySelector('#produto-form button[type="submit"]');
        const btnDuplicar = document.getElementById('btn-salvar-duplicar');
        if (isAprovado) {
            etapa2.style.display = 'block';
            if (btnSubmit) btnSubmit.disabled = false;
            if (btnDuplicar) btnDuplicar.disabled = false;
        } else {
            etapa2.style.display = 'none';
            if (btnSubmit) btnSubmit.disabled = true;
            if (btnDuplicar) btnDuplicar.disabled = true;
        }
    };
    
    // Filtro do Mega Checklist baseado na categoria
    const prodCat = document.getElementById('prod-cat');
    if (prodCat) {
        prodCat.addEventListener('change', () => {
            const val = prodCat.value;
            const categoryMap = {
                'Cozinha e Mesa': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '5. Conjuntos, Jogos e Coleções', '6. Louças, Porcelanas e Cerâmicas', '7. Vidros e Cristais', '8. Inox e Outros Metais', '9. Panelas e Assadeiras', '10. Plástico, Acrílico e Silicone', '11. Madeira e Bambu', '13. Higienização e Precificação'],
                'Decoração': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '5. Conjuntos, Jogos e Coleções', '6. Louças, Porcelanas e Cerâmicas', '7. Vidros e Cristais', '8. Inox e Outros Metais', '10. Plástico, Acrílico e Silicone', '11. Madeira e Bambu', '13. Higienização e Precificação'],
                'Tapeçaria': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '13. Higienização e Precificação'],
                'Banheiro': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '6. Louças, Porcelanas e Cerâmicas', '7. Vidros e Cristais', '8. Inox e Outros Metais', '10. Plástico, Acrílico e Silicone', '13. Higienização e Precificação'],
                'Arte': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '11. Madeira e Bambu', '13. Higienização e Precificação'],
                'Eletrodomésticos': ['1. Identificação e Documentos', '2. Registro Fotográfico', '3. Classificação Comercial', '4. Inspeção Física Geral', '8. Inox e Outros Metais', '10. Plástico, Acrílico e Silicone', '12. Eletrônicos e Eletroportáteis', '13. Higienização e Precificação']
            };
            
            const allowed = categoryMap[val] || [];
            if (allowed.length > 0) {
                document.querySelectorAll('#etapa-1-checklist .mega-accordion').forEach(acc => {
                    const catName = acc.querySelector('summary').textContent.trim();
                    if (allowed.includes(catName)) {
                        acc.style.display = 'block';
                    } else {
                        acc.style.display = 'none';
                    }
                });
            } else {
                document.querySelectorAll('#etapa-1-checklist .mega-accordion').forEach(acc => acc.style.display = 'block');
            }
        });
        
        // Disparar no carregamento
        prodCat.dispatchEvent(new Event('change'));
    }


    // Submete — bind ÚNICO. renderProdutoNovo pode rodar várias vezes (evento
    // goianitaDataChanged do Firestore); sem este guard o handler empilha e o produto
    // é cadastrado várias vezes num clique só.
    const form = document.getElementById('produto-form');
    if (form && !form.dataset.handlerBound) {
        form.dataset.handlerBound = '1';
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const btnSubmit = form.querySelector('button[type="submit"]');
            
            // Validação manual
            const nomeStr = document.getElementById('prod-nome').value.trim();
            const clienteVal = selectCliente.value;
            const precoVendaStr = document.getElementById('prod-preco').value;
            
            if (!clienteVal) {
                alert("Por favor, selecione um Fornecedor / Cliente Proprietário.");
                return;
            }
            if (!nomeStr) {
                alert("Por favor, preencha o Nome Comercial do Produto.");
                return;
            }
            if (!precoVendaStr) {
                alert("Por favor, preencha o Preço de Venda (ou clique em Gerar Precificação Inteligente).");
                return;
            }

            const precoVenda = parseMoeda(precoVendaStr);
            const comissao = parseFloat(document.getElementById('prod-comissao').value) || 50;
            
            // Coleta dados do Mega Checklist
            const megaChecklist = [];
            let classeComercial = 'Em Avaliação';
            
            document.querySelectorAll('#etapa-1-checklist .mega-input:checked').forEach(inp => {
                const cat = inp.getAttribute('data-category');
                const label = inp.getAttribute('data-label');
                megaChecklist.push({ category: cat, label: label });
                
                if (cat === '3. Classificação Comercial') {
                    classeComercial = label;
                }
            });
            
            // Embaixador / Cupom de Captação
            const embSel = document.getElementById('prod-embaixador');
            const embaixadorId = embSel ? (embSel.value || null) : null;
            const embaixadorObj = embaixadorId && window.GoianitaDB
                ? window.GoianitaDB.embaixadores.getById(embaixadorId)
                : null;

            const novoProduto = {
                nome: document.getElementById('prod-nome').value,
                descricao: document.getElementById('prod-desc').value,
                categoria: document.getElementById('prod-cat').value,
                subcategoria: document.getElementById('prod-subcat').value,
                marca: document.getElementById('prod-marca').value,
                ean: document.getElementById('prod-ean').value,
                conservacao: classeComercial,
                megaChecklist: megaChecklist,
                peso: parseFloat(document.getElementById('prod-peso').value) || 0,
                altura: parseFloat(document.getElementById('prod-alt').value) || 0,
                largura: parseFloat(document.getElementById('prod-larg').value) || 0,
                comprimento: parseFloat(document.getElementById('prod-comp').value) || 0,
                precoSugerido: parseFloat(document.getElementById('prod-preco-sug').value) || 0,
                precoVenda: precoVenda,
                comissao: comissao,
                clienteId: selectCliente.value,
                status: document.getElementById('prod-status').value,
                obsInternas: document.getElementById('prod-obs').value,
                // Campos de captação (opcionais)
                embaixadorId: embaixadorId || null,
                cupom: embaixadorObj ? embaixadorObj.cupom : null,
                comissaoEmbaixador: embaixadorId
                    ? (parseFloat((document.getElementById('prod-comissao-emb') || {}).value) || (embaixadorObj ? (embaixadorObj.comissaoCaptacaoPadrao || 0) : 0))
                    : null,
                valorComissaoEmbaixador: embaixadorId
                    ? (() => {
                        const taxa = parseFloat((document.getElementById('prod-comissao-emb') || {}).value) || (embaixadorObj ? (embaixadorObj.comissaoCaptacaoPadrao || 0) : 0);
                        const taxaImp = window.TAXA_IMPOSTO || 11;
                        const liq = precoVenda - (precoVenda * taxaImp / 100);
                        return (liq * taxa) / 100;
                    })()
                    : null
            };
            
            // Exibir loading ou desativar botão
            const originalText = btnSubmit.textContent;
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Gravando...';

            window.GoianitaDB.produtos.save(novoProduto).then(() => {
                alert('Produto cadastrado com sucesso!');
                window.location.href = 'produtos.html';
            }).catch(err => {
                console.error("Erro capturado no save:", err);
                alert('Erro ao cadastrar produto: ' + err.message);
                btnSubmit.disabled = false;
                btnSubmit.textContent = originalText;
            });
        });
    }

    // Handler do botão "Salvar e Duplicar" — bind ÚNICO (mesma guarda do submit)
    const btnDuplicar = document.getElementById('btn-salvar-duplicar');
    if (btnDuplicar && !btnDuplicar.dataset.handlerBound) {
        btnDuplicar.dataset.handlerBound = '1';
        btnDuplicar.addEventListener('click', async () => {
            // -- Validações idênticas ao submit normal --
            const nomeStr = document.getElementById('prod-nome').value.trim();
            const clienteVal = selectCliente.value;
            const precoVendaStr = document.getElementById('prod-preco').value;

            if (!clienteVal) { alert('Por favor, selecione um Fornecedor.'); return; }
            if (!nomeStr)    { alert('Por favor, preencha o Nome Comercial do Produto.'); return; }
            if (!precoVendaStr) { alert('Por favor, preencha o Preço de Venda.'); return; }

            // -- Monta o objeto do produto (idêntico ao submit) --
            const precoVenda = parseMoeda(precoVendaStr);
            const comissao   = parseFloat(document.getElementById('prod-comissao').value) || 50;

            const megaChecklist = [];
            let classeComercial = 'Em Avaliação';
            document.querySelectorAll('#etapa-1-checklist .mega-input:checked').forEach(inp => {
                const cat   = inp.getAttribute('data-category');
                const label = inp.getAttribute('data-label');
                megaChecklist.push({ category: cat, label: label });
                if (cat === '3. Classificação Comercial') classeComercial = label;
            });

            const embSel       = document.getElementById('prod-embaixador');
            const embaixadorId = embSel ? (embSel.value || null) : null;
            const embaixadorObj = embaixadorId && window.GoianitaDB
                ? window.GoianitaDB.embaixadores.getById(embaixadorId) : null;

            const produto = {
                nome: nomeStr,
                descricao: document.getElementById('prod-desc').value,
                categoria: document.getElementById('prod-cat').value,
                subcategoria: document.getElementById('prod-subcat').value,
                marca: document.getElementById('prod-marca').value,
                ean: document.getElementById('prod-ean').value,
                conservacao: classeComercial,
                megaChecklist: megaChecklist,
                peso: parseFloat(document.getElementById('prod-peso').value) || 0,
                altura: parseFloat(document.getElementById('prod-alt').value) || 0,
                largura: parseFloat(document.getElementById('prod-larg').value) || 0,
                comprimento: parseFloat(document.getElementById('prod-comp').value) || 0,
                precoSugerido: parseFloat(document.getElementById('prod-preco-sug').value) || 0,
                precoVenda: precoVenda,
                comissao: comissao,
                clienteId: clienteVal,
                status: document.getElementById('prod-status').value,
                obsInternas: document.getElementById('prod-obs').value,
                embaixadorId: embaixadorId || null,
                cupom: embaixadorObj ? embaixadorObj.cupom : null,
                comissaoEmbaixador: embaixadorId
                    ? (parseFloat((document.getElementById('prod-comissao-emb') || {}).value) || (embaixadorObj ? (embaixadorObj.comissaoCaptacaoPadrao || 0) : 0))
                    : null,
                valorComissaoEmbaixador: embaixadorId
                    ? (() => {
                        const taxa = parseFloat((document.getElementById('prod-comissao-emb') || {}).value) || (embaixadorObj ? (embaixadorObj.comissaoCaptacaoPadrao || 0) : 0);
                        const taxaImp = window.TAXA_IMPOSTO || 11;
                        const liq = precoVenda - (precoVenda * taxaImp / 100);
                        return (liq * taxa) / 100;
                    })()
                    : null
            };

            // -- Salva --
            btnDuplicar.disabled = true;
            btnDuplicar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';

            try {
                await window.GoianitaDB.produtos.save(produto);

                // -- Reset parcial: mantém identificação, zera avaliação --
                // Checklist
                document.querySelectorAll('#etapa-1-checklist .mega-input').forEach(inp => { inp.checked = false; });

                // Preços e observações
                document.getElementById('prod-preco').value     = '';
                document.getElementById('prod-preco-sug').value = '';
                document.getElementById('prod-obs').value       = '';

                // Box da IA e simulador
                const boxAprovacao = document.getElementById('recomendacao-aprovacao-box');
                if (boxAprovacao) boxAprovacao.innerHTML = '';
                const simForn = document.getElementById('sim-fornecedor');
                const simEmb  = document.getElementById('sim-embaixador');
                const simGoianita = document.getElementById('sim-goianita');
                if (simForn)     simForn.textContent = 'R$ 0,00';
                if (simEmb)      simEmb.textContent  = 'R$ 0,00';
                if (simGoianita) simGoianita.textContent = 'R$ 0,00';

                // Restaura botões
                btnDuplicar.disabled = false;
                btnDuplicar.innerHTML = '<i class="fa-solid fa-copy"></i> Salvar e Duplicar';

                // Sobe para o checklist para o admin avaliar o próximo item
                const checklist = document.getElementById('etapa-1-checklist');
                if (checklist) checklist.scrollIntoView({ behavior: 'smooth', block: 'start' });

                alert(`✅ Produto salvo com sucesso!\n\nO formulário foi mantido aberto com os dados de identificação.\nRefaça o checklist e a precificação para a próxima peça.`);

            } catch (err) {
                console.error('[Duplicar] Erro ao salvar:', err);
                alert('Erro ao salvar produto: ' + err.message);
                btnDuplicar.disabled = false;
                btnDuplicar.innerHTML = '<i class="fa-solid fa-copy"></i> Salvar e Duplicar';
            }
        });
    }

    // Auto-preenchimento da descrição e recomendação de aprovação
    const inputsChecklist = document.querySelectorAll('#etapa-1-checklist .mega-input');
    const descField = document.getElementById('prod-desc');
    const boxAprovacao = document.getElementById('recomendacao-aprovacao-box');
    
    if (inputsChecklist.length > 0) {
        inputsChecklist.forEach(inp => {
            inp.addEventListener('change', () => {
                const s = calcularScoreDeVenda();
                
                let desc = '';
                if (s.conservacao !== 'B' || document.querySelector('#etapa-1-checklist .mega-input[data-category="3. Classificação Comercial"]:checked')) {
                    desc += `Estado de Conservação: Classe ${s.conservacao}\n\n`;
                }
                if (s.qualidadesTexto.length > 0) {
                    desc += `Pontos validados na triagem:\n- ${s.qualidadesTexto.join('\n- ')}`;
                }
                
                if (descField && !descField.value.includes('IA')) { 
                    descField.value = desc.trim();
                }
                
                // Recomendação em tempo real baseada no Score de Venda
                if (boxAprovacao) {
                    if (s.status === 'REPROVADO') {
                        boxAprovacao.innerHTML = `<strong style="color: #d32f2f;"><i class="fa-solid fa-triangle-exclamation"></i> Recomendação IA: REPROVAR PRODUTO (Score: ${s.score})</strong><br><span style="font-size: 13px;">O produto apresenta qualidades insuficientes ou restrições graves. Recomenda-se recusa automática.</span>`;
                        boxAprovacao.style.background = '#ffebee';
                        boxAprovacao.style.borderColor = '#ffcdd2';
                        const radReprovado = document.querySelector('input[name="triagem_resultado"][value="reprovado"]');
                        if (radReprovado) { radReprovado.checked = true; toggleEtapa2(false); }
                    } else if (s.status === 'CAUTELA') {
                        boxAprovacao.innerHTML = `<strong style="color: #f57c00;"><i class="fa-solid fa-circle-exclamation"></i> Recomendação IA: AVALIAR COM CAUTELA (Score: ${s.score})</strong><br><span style="font-size: 13px;">Venda moderada. Avalie se o produto tem valor comercial local antes de aprovar.</span>`;
                        boxAprovacao.style.background = '#fff3e0';
                        boxAprovacao.style.borderColor = '#ffe0b2';
                    } else {
                        boxAprovacao.innerHTML = `<strong style="color: #388e3c;"><i class="fa-solid fa-check-circle"></i> Recomendação IA: APROVAR PRODUTO (Score: ${s.score})</strong><br><span style="font-size: 13px;">Produto com alta liquidez, em bom estado e apto para venda.</span>`;
                        boxAprovacao.style.background = '#e8f5e9';
                        boxAprovacao.style.borderColor = '#c8e6c9';
                        const radAprovado = document.querySelector('input[name="triagem_resultado"][value="aprovado"]');
                        if (radAprovado) { radAprovado.checked = true; toggleEtapa2(true); }
                    }
                }
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

// Comprime uma imagem no navegador (redimensiona + JPEG) e devolve um data URL.
// Mantém a foto pequena para ser guardada junto do produto, sem depender do Drive.
function comprimirImagem(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Falha ao ler a imagem'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('Arquivo de imagem inválido'));
            img.onload = () => {
                let width = img.width, height = img.height;
                if (width > maxDim || height > maxDim) {
                    if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
                    else { width = Math.round(width * maxDim / height); height = maxDim; }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
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
    const taxaImp = window.TAXA_IMPOSTO || 11;
    const liq = produto.precoVenda - (produto.precoVenda * taxaImp / 100);
    const valorCliente = liq - (liq * produto.comissao / 100);

    // Preenche dados da tela
    document.getElementById('prod-detalhe-sku').textContent = produto.sku;
    document.getElementById('prod-detalhe-nome').textContent = produto.nome;
    document.getElementById('prod-detalhe-desc').textContent = produto.descricao || 'Sem descrição';
    document.getElementById('prod-detalhe-cliente').innerHTML = `<a href="cliente-detalhe.html?id=${encodeURIComponent(cliente.id)}">${esc(cliente.nome)}</a>`;
    document.getElementById('prod-detalhe-conservacao').textContent = produto.conservacao;
    document.getElementById('prod-detalhe-dimensoes').textContent = `${produto.altura}x${produto.largura}x${produto.comprimento} cm | ${produto.peso} g`;
    document.getElementById('prod-detalhe-preco-venda').textContent = formatCurrency(produto.precoVenda);
    
    const impostoEl = document.getElementById('prod-detalhe-imposto');
    if(impostoEl) impostoEl.textContent = formatCurrency(produto.precoVenda * taxaImp / 100);
    
    document.getElementById('prod-detalhe-valor-cliente').textContent = formatCurrency(valorCliente);
    document.getElementById('prod-detalhe-comissao').textContent = `${produto.comissao}%`;
    document.getElementById('prod-detalhe-status').innerHTML = getStatusBadge(produto.status);
    document.getElementById('prod-detalhe-entrada').textContent = formatDate(produto.dataEntrada);
    document.getElementById('prod-detalhe-limite').textContent = formatDate(produto.dataLimite);
    
    // Seletor de status rápido
    const statusSelect = document.getElementById('update-status-select');
    
    // Renderizar Checklist Read-Only
    const readOnlyContainer = document.getElementById('read-only-checklist');
    if (readOnlyContainer) {
        if (produto.megaChecklist && produto.megaChecklist.length > 0) {
            const grouped = {};
            produto.megaChecklist.forEach(item => {
                if(!grouped[item.category]) grouped[item.category] = [];
                grouped[item.category].push(item.label);
            });
            let html = '<div style="column-count: 2; column-gap: 20px;">';
            for (const cat in grouped) {
                html += `<p style="margin: 8px 0 2px 0; font-size: 13px; font-weight: bold; color: var(--primary-color);">${esc(cat)}</p>`;
                html += `<ul style="list-style: none; padding-left: 0; margin: 0; font-size: 15px; margin-bottom: 10px;">`;
                grouped[cat].forEach(label => {
                    html += `<li><i class="fa-solid fa-check" style="color: green; margin-right: 6px;"></i> ${esc(label)}</li>`;
                });
                html += `</ul>`;
            }
            html += '</div>';
            readOnlyContainer.innerHTML = html;
        } else {
            readOnlyContainer.innerHTML = '<p style="font-size: 13px; color: #777;">Nenhum checklist preenchido para este produto.</p>';
        }
    }
    
    window.imprimirLaudoProduto = function() {
        const clienteObj = window.GoianitaDB.clientes.getById(produto.clienteId) || { nome: 'Desconhecido', cpf: '---' };
        
        const printArea = document.createElement('div');
        printArea.id = 'print-area';
        
        let html = `
            <div class="print-header">
                <h2>Laudo de Triagem e Avaliação Técnica</h2>
                <p><strong>Fornecedor:</strong> ${esc(clienteObj.nome)} | <strong>CPF:</strong> ${esc(clienteObj.cpf)}</p>
                <p><strong>Produto:</strong> [${esc(produto.sku)}] ${esc(produto.nome)}</p>
                <p><strong>Status de Conservação:</strong> ${esc(produto.conservacao)}</p>
                <p><strong>Data da Avaliação:</strong> ${new Date().toLocaleDateString('pt-BR')}</p>
                <hr>
            </div>
            <div class="print-body">
        `;
        
        if (produto.megaChecklist && produto.megaChecklist.length > 0) {
            const grouped = {};
            produto.megaChecklist.forEach(item => {
                if(!grouped[item.category]) grouped[item.category] = [];
                grouped[item.category].push(item.label);
            });
            html += '<div style="column-count: 2; column-gap: 20px;">';
            for(const cat in grouped) {
                html += `<p style="margin: 8px 0 2px 0; font-size: 18px; font-weight: bold; color: #333;">${esc(cat)}</p>`;
                html += `<ul style="list-style: none; padding-left: 0; margin: 0; font-size: 15px; margin-bottom: 10px;">`;
                grouped[cat].forEach(label => {
                    html += `<li><i class="fa-solid fa-check" style="color: #666; margin-right: 4px;"></i> ${esc(label)}</li>`;
                });
                html += `</ul>`;
            }
            html += '</div>';
        } else {
            html += '<p>Nenhum dado de checklist registrado.</p>';
        }
        
        html += `
            </div>
            <div class="print-footer" style="margin-top: 50px; text-align: center;">
                <p>_______________________________________________________</p>
                <p><strong>Avaliador Responsável (Casas Goianita)</strong></p>
            </div>
        `;
        
        printArea.innerHTML = html;
        document.body.appendChild(printArea);
        window.print();
        document.body.removeChild(printArea);
    };

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
                
                if (m.type && m.type.startsWith('video/')) {
                    el.innerHTML = `<video src="${m.url}" style="width: 100%; height: 100%; object-fit: cover; background: #000;" controls></video>`;
                } else {
                    const img = document.createElement('img');
                    img.referrerPolicy = 'no-referrer'; // ajuda o Google a servir a imagem em <img>
                    img.loading = 'lazy';
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; cursor: pointer;';
                    img.title = 'Abrir imagem';
                    img.onclick = () => window.open(m.url, '_blank');

                    const driveMatch = (m.url && !m.url.startsWith('data:')) ? (m.url.match(/id=([a-zA-Z0-9-_]+)/) || m.url.match(/\/d\/([a-zA-Z0-9-_]+)/)) : null;
                    const fid = m.fileId || (driveMatch && driveMatch[1]) || null;
                    if (fid) {
                        // Tenta vários endpoints do Drive em cascata (funcionam quando o arquivo
                        // está compartilhado como "qualquer pessoa com o link" / público).
                        const fontes = [
                            `https://drive.google.com/thumbnail?id=${fid}&sz=w1000`,
                            `https://lh3.googleusercontent.com/d/${fid}=w1000`,
                            `https://drive.google.com/uc?export=view&id=${fid}`
                        ];
                        let fi = 0;
                        img.src = fontes[0];
                        img.onerror = () => {
                            fi++;
                            if (fi < fontes.length) { img.src = fontes[fi]; }
                            else {
                                img.onerror = null;
                                const aviso = document.createElement('div');
                                aviso.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;text-align:center;padding:4px;background:#f3f3f3;';
                                aviso.textContent = 'Imagem não pública no Drive';
                                img.replaceWith(aviso);
                            }
                        };
                    } else {
                        img.src = m.url;
                    }
                    el.appendChild(img);
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
    if (uploadInput && !uploadInput.dataset.handlerBound) {
        uploadInput.dataset.handlerBound = '1';
        uploadInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;

            const statusLabel = document.getElementById('upload-status');
            uploadInput.disabled = true;
            produto.midias = produto.midias || [];

            const webAppUrl = "https://script.google.com/macros/s/AKfycbwnQYnax3uFAnnEq77PSEOLWAWvhCfnyA5BDuKsCTwCRwFN2AAKHpv6cDETmLVSvF_v/exec";

            try {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    statusLabel.textContent = `Enviando ${i + 1} de ${files.length} para o Drive...`;

                    // Imagens são comprimidas antes de subir (menor e mais rápido); demais tipos vão como estão.
                    let base64Url;
                    if (file.type && file.type.startsWith('image/')) {
                        base64Url = await comprimirImagem(file, 1400, 0.7);
                    } else {
                        base64Url = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
                            reader.readAsDataURL(file);
                        });
                    }

                    const mimeType = (file.type && file.type.startsWith('image/')) ? 'image/jpeg' : (file.type || 'application/octet-stream');
                    const fileName = `${Date.now()}_${(file.name || 'arquivo').replace(/\.[^.]+$/, '')}.jpg`;

                    const response = await fetch(webAppUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({
                            fornecedor: cliente.nome,
                            fileName: (file.type && file.type.startsWith('image/')) ? fileName : `${Date.now()}_${file.name}`,
                            mimeType: mimeType,
                            base64Data: base64Url
                        })
                    });
                    const responseData = await response.json();

                    if (!responseData.success) {
                        throw new Error(responseData.error || 'Erro desconhecido no Google Drive');
                    }
                    // Guarda o fileId (fonte confiável) além da url; a exibição monta o link do Drive.
                    produto.midias.push({
                        url: responseData.url || (responseData.fileId ? ('https://drive.google.com/uc?export=view&id=' + responseData.fileId) : ''),
                        fileId: responseData.fileId || null,
                        type: mimeType
                    });
                }

                statusLabel.textContent = 'Salvando...';
                await window.GoianitaDB.produtos.save(produto);
                statusLabel.textContent = 'Fotos salvas no Drive!';
                setTimeout(() => window.location.reload(), 800);
            } catch (err) {
                statusLabel.textContent = 'Erro de envio: ' + (err.message || err);
                uploadInput.disabled = false;
            }
        });
    }

    if (statusSelect && !statusSelect.dataset.handlerBound) {
        statusSelect.dataset.handlerBound = '1';
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
    // Somente os produtos marcados, na ordem de cadastro.
    const sel = produtosParaDocumento(id);
    const produtos = sel.produtos;

    if (!produtos || produtos.length === 0) {
        alert(sel.tinhaSelecao
            ? "Nenhum produto selecionado. Marque na tabela os produtos que devem entrar no documento."
            : "Nenhum produto cadastrado para este fornecedor.");
        return;
    }
    
    // Cria um contêiner invisível apenas para a impressão
    const printArea = document.createElement('div');
    printArea.id = 'print-area';
    
    let html = `
        <div class="print-header">
            <h2>Termo de Triagem e Avaliação de Produtos</h2>
            <p><strong>Fornecedor:</strong> ${esc(cliente.nome)} | <strong>CPF:</strong> ${esc(cliente.cpf)}</p>
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
                checklistHtml += `<p style="margin: 8px 0 2px 0; font-size: 12px; font-weight: bold; color: #444;">${esc(cat)}</p>`;
                checklistHtml += `<ul style="list-style: none; padding-left: 0; margin: 0; font-size: 11px;">`;
                grouped[cat].forEach(label => {
                    checklistHtml += `<li><i class="fa-solid fa-check" style="color: #666; margin-right: 4px;"></i> ${esc(label)}</li>`;
                });
                checklistHtml += `</ul>`;
            }
        } else {
            checklistHtml = '<p style="font-size: 12px; font-style: italic; color: #999;">Checklist não preenchido.</p>';
        }

        html += `
            <div style="margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 5px;">
                <h4 style="margin: 0 0 10px 0;">[${esc(p.sku)}] ${esc(p.nome)} - R$ ${p.precoVenda.toFixed(2)}</h4>
                <div style="column-count: 2; column-gap: 20px;">
                    ${checklistHtml}
                </div>
                <p style="margin-top: 10px; font-size: 13px; color: #555;"><strong>Defeitos / Faltantes:</strong> ${esc(p.defeitosAparentes || '')} ${esc(p.pecasFaltantes || '')}</p>
            </div>
        `;
    });
    
    html += `
        </div>
        <div class="print-footer" style="margin-top: 50px; text-align: center;">
            <p>Declaro ciência e concordância com a avaliação das peças acima descritas.</p>
            <br><br>
            <p>_______________________________________________________</p>
            <p><strong>${esc(cliente.nome)}</strong></p>
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

    // Apenas os produtos marcados, na mesma ordem de cadastro dos demais documentos.
    const produtos = produtosParaDocumento(id).produtos;

    if (!produtos || produtos.length === 0) {
        alert("Nenhum produto selecionado. Por favor, marque os produtos que entrarão no contrato.");
        return;
    }
    
    const printArea = document.createElement('div');
    printArea.id = 'print-area';
    
    let html = `
        <div class="print-header">
            <h2 style="text-align: center; margin-bottom: 20px;">CONTRATO DE CONSIGNAÇÃO DE PEÇAS E UTILIDADES</h2>
            
            <div style="border: 2px solid #1a3c6e; border-radius: 7px; padding: 16px 20px; margin-bottom: 20px; background: #f4f8ff;">
                <h3 style="font-size: 22px; margin-top: 0; margin-bottom: 14px; color: #1a3c6e;">QUALIFICAÇÃO DAS PARTES</h3>
                <p style="font-size: 20px; text-align: justify; margin-bottom: 10px;"><strong>CONSIGNATÁRIA:</strong> VIRTUAL DISTRIBUIDORA DE UTILIDADES DOMÉSTICAS LTDA (CASAS GOIANITA), sociedade limitada, inscrita no CNPJ sob o nº 11.316.256/0001-29, situada na Rua 85, nº 369, Quadra F19, Lote 45, Setor Sul, Goiânia/GO, CEP: 74080-010.</p>
                <p style="font-size: 20px; text-align: justify; margin-bottom: 10px;"><strong>CONSIGNANTE:</strong> ${esc(cliente.nome)}, inscrito(a) no CPF/CNPJ sob o nº ${esc(cliente.cpf)}, telefone ${esc(cliente.telefone)}, e-mail ${esc(cliente.email)}.</p>
                <p style="font-size: 20px; text-align: justify; margin-bottom: 0;">As partes acima qualificadas celebram, entre si, o presente instrumento particular, que será regido pela legislação aplicável, em especial, pelos artigos 534 e seguintes do Código Civil Brasileiro e pelas cláusulas e disposições seguintes:</p>
            </div>

            <h3 style="font-size: 22px; margin-top: 20px;">CLÁUSULAS CONTRATUAIS RESUMIDAS</h3>
            <div style="font-size: 20px; text-align: justify; line-height: 1.6;">
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
            <p style="font-size: 20px; margin-bottom: 20px;">O(A) CONSIGNANTE declara ciência e concorda com a avaliação, precificação, estado de conservação, defeitos apontados e lista de acessórios descritos nos itens abaixo, submetidos e aprovados pela triagem da CONSIGNATÁRIA na presente data:</p>
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
                checklistHtml += `<p style="margin: 8px 0 2px 0; font-size: 18px; font-weight: bold; color: #222;">${esc(cat)}</p>`;
                checklistHtml += `<ul style="list-style: none; padding-left: 0; margin: 0; font-size: 16px;">`;
                grouped[cat].forEach(label => {
                    checklistHtml += `<li><i class="fa-solid fa-check" style="color: #1a3c6e; margin-right: 6px;"></i> ${esc(label)}</li>`;
                });
                checklistHtml += `</ul>`;
            }
        } else {
            checklistHtml = '<p style="font-size: 16px; font-style: italic; color: #777;">Checklist não preenchido.</p>';
        }

            const taxaImp = window.TAXA_IMPOSTO || 11;
            const liq = p.precoVenda - (p.precoVenda * taxaImp / 100);
            const repasse = liq - (liq * p.comissao / 100);
        html += `
            <div style="margin-bottom: 20px; padding: 14px 16px; border: 2px solid #1a3c6e; border-radius: 7px;">
                <h4 style="margin: 0 0 12px 0; font-size: 20px; color: #1a3c6e;">[${esc(p.sku)}] ${esc(p.nome)} &mdash; Valor Líquido de Repasse: R$ ${repasse.toFixed(2)}</h4>
                <div style="column-count: 2; column-gap: 24px;">
                    ${checklistHtml}
                </div>
                <p style="margin-top: 12px; font-size: 16px; color: #222;"><strong>Ressalvas/Faltantes:</strong> ${esc(p.defeitosAparentes || 'Nenhuma ressalva.')} ${esc(p.pecasFaltantes || '')}</p>
            </div>
        `;
    });
    
    html += `
        </div>
        <div class="print-footer" style="margin-top: 50px;">
            <p style="text-align: center; font-size: 20px;">Por estarem justos e contratados, assinam o presente termo de consignação e avaliação.</p>
            <p style="text-align: center; font-size: 20px; margin-top: 10px;">Goiânia/GO, ${new Date().toLocaleDateString('pt-BR')}</p>
            <div style="display: flex; justify-content: space-around; margin-top: 60px;">
                <div style="text-align: center;">
                    <p>_______________________________________________________</p>
                    <p><strong>${esc(cliente.nome)}</strong></p>
                    <p style="font-size: 18px;">CONSIGNANTE (CPF/CNPJ: ${esc(cliente.cpf)})</p>
                </div>
                <div style="text-align: center;">
                    <p>_______________________________________________________</p>
                    <p><strong>Casas Goianita (Virtual Ltda)</strong></p>
                    <p style="font-size: 18px;">CONSIGNATÁRIA</p>
                </div>
            </div>
        </div>
    `;
    
    printArea.innerHTML = html;
    document.body.appendChild(printArea);
    
    window.print();
    
    document.body.removeChild(printArea);
}

window.imprimirContratoEmbaixador = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id');
    if (!id) return;
    
    const embaixador = window.GoianitaDB.embaixadores.getById(id);
    if (!embaixador) {
        alert("Embaixador não encontrado.");
        return;
    }
    
    const printArea = document.createElement('div');
    printArea.id = 'print-area';
    
    let html = `
        <div class="print-header">
            <h2 style="text-align: center; margin-bottom: 20px;">CONTRATO DE PARCERIA COMERCIAL E AGENCIAMENTO (EMBAIXADOR)</h2>
            
            <div style="border: 2px solid #1a3c6e; border-radius: 7px; padding: 16px 20px; margin-bottom: 20px; background: #f4f8ff;">
                <h3 style="font-size: 22px; margin-top: 0; margin-bottom: 14px; color: #1a3c6e;">QUALIFICAÇÃO DAS PARTES</h3>
                <p style="font-size: 20px; text-align: justify; margin-bottom: 10px;"><strong>CONTRATANTE (CASAS GOIANITA):</strong> VIRTUAL DISTRIBUIDORA DE UTILIDADES DOMÉSTICAS LTDA, sociedade limitada, inscrita no CNPJ sob o nº 11.316.256/0001-29, situada na Rua 85, nº 369, Quadra F19, Lote 45, Setor Sul, Goiânia/GO, CEP: 74080-010.</p>
                <p style="font-size: 20px; text-align: justify; margin-bottom: 10px;"><strong>EMBAIXADOR (PARCEIRO):</strong> ${esc(embaixador.nome)}, inscrito(a) no CPF/CNPJ sob o nº ${esc(embaixador.cpf)}, telefone ${esc(embaixador.telefone)}, e-mail ${esc(embaixador.email || 'N/A')}, residente/sediado(a) em ${esc(embaixador.endereco || 'N/A')}.</p>
                <p style="font-size: 20px; text-align: justify; margin-bottom: 0;">As partes acima qualificadas celebram o presente contrato de prestação de serviços de indicação e agenciamento (parceria comercial), regido pelas cláusulas a seguir:</p>
            </div>

            <h3 style="font-size: 22px; margin-top: 20px;">CLÁUSULAS CONTRATUAIS</h3>
            <div style="font-size: 20px; text-align: justify; line-height: 1.6;">
                <p><strong>Cláusula 1ª – Do Objeto.</strong> O presente contrato tem por objeto a prestação de serviços de indicação de fornecedores de mercadorias (consignantes) pelo(a) EMBAIXADOR(A) para a CONTRATANTE, através da utilização do código promocional / cupom exclusivo de identificação: <strong>${esc(embaixador.cupom || 'N/A')}</strong>.</p>
                
                <p><strong>Cláusula 2ª – Da Remuneração.</strong> A CONTRATANTE pagará ao(à) EMBAIXADOR(A) uma comissão base de <strong>${esc(embaixador.comissaoCaptacaoPadrao || 0)}%</strong> calculada exclusivamente sobre o valor de venda das mercadorias captadas por sua indicação e efetivamente comercializadas pela CONTRATANTE.</p>
                <p><em>Parágrafo Único.</em> A comissão será devida apenas após a concretização da venda do produto e o respectivo recebimento dos valores pela CONTRATANTE.</p>
                
                <p><strong>Cláusula 3ª – Dos Pagamentos.</strong> O repasse das comissões devidas será efetuado periodicamente na modalidade PIX, utilizando a seguinte chave cadastrada:</p>
                <p style="margin-left: 20px;"><strong>Tipo de Chave:</strong> ${esc(embaixador.chavePixType || 'Não informada')}<br>
                <strong>Chave PIX:</strong> ${esc(embaixador.chavePix || 'Não informada')}</p>
                
                <p><strong>Cláusula 4ª – Da Natureza da Relação.</strong> Este contrato não gera qualquer vínculo empregatício, societário ou de subordinação entre as partes, sendo o(a) EMBAIXADOR(A) inteiramente livre para determinar sua carga horária e métodos de indicação, desde que respeitados os princípios éticos da CONTRATANTE.</p>

                <p><strong>Cláusula 5ª – Da Sigilosidade.</strong> O(A) EMBAIXADOR(A) compromete-se a mantener absoluto sigilo sobre as políticas de comissionamento, margens de lucro, tabelas de preços e dados dos fornecedores a que tiver acesso, sendo expressamente proibido divulgar essas informações aos próprios fornecedores ou a terceiros concorrentes.</p>

                <p><strong>Cláusula 6ª – Da Rescisão.</strong> Este contrato poderá ser rescindido por qualquer das partes, a qualquer momento, mediante comunicação por escrito (podendo ser por meio eletrônico). Os valores pendentes de peças já captadas e vendidas antes da rescisão serão devidamente repassados.</p>

                <p><strong>Cláusula 7ª – Do Foro.</strong> As partes elegem o foro da comarca de Goiânia/GO para dirimir quaisquer dúvidas oriundas deste instrumento.</p>
            </div>
        </div>
        
        <div class="print-footer" style="margin-top: 80px;">
            <p style="text-align: center; font-size: 20px;">Por estarem justos e contratados, assinam o presente contrato de parceria comercial.</p>
            <p style="text-align: center; font-size: 20px; margin-top: 10px;">Goiânia/GO, ${new Date().toLocaleDateString('pt-BR')}</p>
            <div style="display: flex; justify-content: space-around; margin-top: 60px;">
                <div style="text-align: center;">
                    <p>_______________________________________________________</p>
                    <p><strong>${esc(embaixador.nome)}</strong></p>
                    <p style="font-size: 18px;">EMBAIXADOR (CPF/CNPJ: ${esc(embaixador.cpf)})</p>
                </div>
                <div style="text-align: center;">
                    <p>_______________________________________________________</p>
                    <p><strong>Casas Goianita (Virtual Ltda)</strong></p>
                    <p style="font-size: 18px;">CONTRATANTE</p>
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
// --- GERAÇÃO DE DOCUMENTOS .DOCX (Nota de Entrada / Recibo de Devolução) ---
const GOIANITA_MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

// Número determinístico da Nota (mesmo fornecedor gera sempre o mesmo Nº,
// para o Recibo poder referenciá-lo).
function numeroNota(cliente) {
    const dig = String((cliente && (cliente.cpf || cliente.id)) || '').replace(/\D/g, '');
    const base = dig ? dig.slice(-6).padStart(6, '0') : String(Date.now()).slice(-6);
    return 'NE-' + base;
}

function fmtMoedaDoc(v) {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (isNaN(n)) return '';
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function slugArquivo(nome) {
    return String(nome || 'fornecedor').normalize('NFD').replace(/[^\x00-\x7F]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'fornecedor';
}

// Gera o .docx inteiramente por código (biblioteca docx via CDN) — sem template externo,
// sem pasta templates, sem placeholder. Os itens são SEMPRE os produtos reais do fornecedor.
async function baixarDocx(doc, nomeArquivo) {
    const D = window.docx;
    if (!D || !D.Packer || typeof saveAs === 'undefined') {
        alert('A biblioteca de geração de documento não carregou. Verifique a internet e recarregue a página (Ctrl+Shift+R).');
        return;
    }
    const blob = await D.Packer.toBlob(doc);
    saveAs(blob, nomeArquivo);
}

window.gerarNotaEntrada = async function() {
    const D = window.docx;
    if (!D) { alert('A biblioteca de documento não carregou. Recarregue a página (Ctrl+Shift+R).'); return; }
    const id = new URLSearchParams(window.location.search).get('id');
    const cliente = window.GoianitaDB.clientes.getById(id);
    if (!cliente) { alert('Fornecedor não encontrado.'); return; }
    // SOMENTE os produtos marcados na tabela, na ordem de cadastro.
    const sel = produtosParaDocumento(id);
    const produtos = sel.produtos;
    if (produtos.length === 0) {
        if (sel.tinhaSelecao) {
            alert('Nenhum produto selecionado. Marque na tabela os produtos que devem entrar na Nota de Entrada.');
            return;
        }
        if (!confirm('Este fornecedor não tem produtos cadastrados. Gerar a Nota mesmo assim (sem itens)?')) return;
    }

    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, TableLayoutType, PageOrientation } = D;
    const P = (children, opts) => new Paragraph(Object.assign({ children }, opts || {}));
    const T = (text, opts) => new TextRun(Object.assign({ text: String(text == null ? '' : text) }, opts || {}));
    const cel = (txt, o) => { o = o || {}; return new TableCell({ width: { size: o.w || 1500, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 60, right: 60 }, children: [ new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: [ new TextRun({ text: String(txt == null ? '' : txt), bold: !!o.bold, size: o.size || 16 }) ] }) ] }); };

    // Larguras fixas de cada coluna (em twips). Sem isso, o Word encolhe as colunas e
    // quebra o texto letra por letra. A soma (~13958) cabe na página A4 em paisagem.
    const colW = [600, 3200, 1200, 1500, 2200, 1400, 1900, 1958];
    const cols = ['Item', 'Mercadoria', 'Condição', 'Embalagem', 'Estado', 'Prev. Venda', 'Avaliação (R$)', 'Valor Venda (R$)'];
    const rows = [ new TableRow({ tableHeader: true, children: cols.map((c, idx) => cel(c, { bold: true, align: AlignmentType.CENTER, w: colW[idx] })) }) ];
    produtos.forEach((p, i) => {
        rows.push(new TableRow({ children: [
            cel(i + 1, { align: AlignmentType.CENTER, w: colW[0] }),
            cel(p.nome || '', { w: colW[1] }),
            cel('USADO', { align: AlignmentType.CENTER, w: colW[2] }),
            cel(p.embalagem || '', { w: colW[3] }),
            cel(p.conservacao || '', { w: colW[4] }),
            cel(p.prevVenda || '', { align: AlignmentType.CENTER, w: colW[5] }),
            cel(fmtMoedaDoc(p.precoSugerido != null && p.precoSugerido !== 0 ? p.precoSugerido : p.precoVenda), { align: AlignmentType.RIGHT, w: colW[6] }),
            cel(fmtMoedaDoc(p.precoVenda), { align: AlignmentType.RIGHT, w: colW[7] })
        ] }));
    });

    const contato = cliente.contato || cliente.email || '';
    const doc = new Document({ sections: [{
        properties: { page: {
            size: { orientation: PageOrientation.LANDSCAPE, width: 16838, height: 11906 },
            margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 }
        } },
        children: [
        P([ T('CASA GOIANITA', { bold: true, size: 28 }) ], { alignment: AlignmentType.CENTER }),
        P([ T('NOTA DE ENTRADA DE MERCADORIAS SEMI-NOVAS P/ VENDA', { bold: true, size: 24 }) ], { alignment: AlignmentType.CENTER }),
        P([ T('Documento de Recebimento e Avaliação de Consignação — Nº: ' + numeroNota(cliente), { italics: true, size: 18 }) ], { alignment: AlignmentType.CENTER }),
        P([ T('') ]),
        P([ T('Fornecedor: ', { bold: true }), T(cliente.nome || '') ]),
        P([ T('CPF/CNPJ: ', { bold: true }), T(cliente.cpf || '') ]),
        P([ T('Endereço: ', { bold: true }), T(cliente.endereco || '') ]),
        P([ T('Telefone: ', { bold: true }), T(cliente.telefone || ''), T('     Contato: ', { bold: true }), T(contato) ]),
        P([ T('Observações: ', { bold: true }), T('') ]),
        P([ T('') ]),
        new Table({ columnWidths: colW, layout: TableLayoutType.FIXED, width: { size: 13958, type: WidthType.DXA }, rows: rows }),
        P([ T('') ]),
        P([ T('Prazo de Avaliação: 7 dias', { bold: true }) ]),
        P([ T('') ]),
        P([ T('RECIBO E TERMOS DE CONSIGNAÇÃO', { bold: true }) ]),
        P([ T('Recebemos do cliente acima caracterizado as mercadorias relacionadas para revenda. O cliente terá o direito de aprovar/reprovar a avaliação. As despesas provenientes da venda correrão por conta da Casa Goianita, inclusive os impostos. O valor da parte do fornecedor será pago após recebimento de cartão ou prazo concedido aos adquirentes. A responsabilidade da venda é toda da Casa Goianita. Quando a venda for à vista, o pagamento será feito em até 3 dias via PIX ao fornecedor.', { size: 18 }) ]),
        P([ T('') ]), P([ T('') ]),
        P([ T('_________________________________________') ], { alignment: AlignmentType.CENTER }),
        P([ T('Assinatura do Fornecedor / Proprietário') ], { alignment: AlignmentType.CENTER })
    ] }] });

    await baixarDocx(doc, 'Nota_Entrada_' + slugArquivo(cliente.nome) + '.docx');
};

window.gerarReciboDevolucao = async function() {
    const D = window.docx;
    if (!D) { alert('A biblioteca de documento não carregou. Recarregue a página (Ctrl+Shift+R).'); return; }
    const id = new URLSearchParams(window.location.search).get('id');
    const cliente = window.GoianitaDB.clientes.getById(id);
    if (!cliente) { alert('Fornecedor não encontrado.'); return; }
    const hoje = new Date();

    // SOMENTE os produtos marcados — o recibo precisa dizer QUAIS mercadorias voltaram.
    const sel = produtosParaDocumento(id);
    const devolvidos = sel.produtos;
    if (devolvidos.length === 0 && sel.tinhaSelecao) {
        alert('Nenhum produto selecionado. Marque na tabela as mercadorias que estão sendo devolvidas.');
        return;
    }

    const { Document, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, TableLayoutType } = D;
    const P = (children, opts) => new Paragraph(Object.assign({ children }, opts || {}));
    const T = (text, opts) => new TextRun(Object.assign({ text: String(text == null ? '' : text) }, opts || {}));
    const cel = (txt, o) => { o = o || {}; return new TableCell({ width: { size: o.w || 2000, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 60, right: 60 }, children: [ new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: [ new TextRun({ text: String(txt == null ? '' : txt), bold: !!o.bold, size: o.size || 18 }) ] }) ] }); };

    // Larguras fixas (twips) para o Word não encolher as colunas e quebrar letra por letra.
    const colWD = [700, 4200, 2200, 2000];
    const rowsDev = [ new TableRow({ tableHeader: true, children:
        ['Item', 'Mercadoria', 'Estado', 'Valor (R$)'].map((c, i) => cel(c, { bold: true, align: AlignmentType.CENTER, w: colWD[i] })) }) ];
    devolvidos.forEach((p, i) => {
        rowsDev.push(new TableRow({ children: [
            cel(i + 1, { align: AlignmentType.CENTER, w: colWD[0] }),
            cel(p.nome || '', { w: colWD[1] }),
            cel(p.conservacao || '', { w: colWD[2] }),
            cel(fmtMoedaDoc(p.precoVenda), { align: AlignmentType.RIGHT, w: colWD[3] })
        ] }));
    });

    const blocoItens = devolvidos.length > 0
        ? [ P([ T('MERCADORIAS DEVOLVIDAS', { bold: true, size: 20 }) ]),
            P([ T('') ]),
            new Table({ columnWidths: colWD, layout: TableLayoutType.FIXED, width: { size: 9100, type: WidthType.DXA }, rows: rowsDev }),
            P([ T('') ]) ]
        : [];

    const doc = new Document({ sections: [{ children: [
        P([ T('CASA GOIANITA', { bold: true, size: 28 }) ], { alignment: AlignmentType.CENTER }),
        P([ T('RECIBO DE DEVOLUÇÃO DE MERCADORIAS', { bold: true, size: 24 }) ], { alignment: AlignmentType.CENTER }),
        P([ T('Termo de Devolução e Quitação de Consignação', { italics: true, size: 18 }) ], { alignment: AlignmentType.CENTER }),
        P([ T('') ]),
        P([ T('Recebemos de C.G. (Casa Goianita) a(s) mercadoria(s) devolvida(s) por ter ocorrido o prazo de 180 dias sem a venda da(s) mesma(s).', { size: 20 }) ]),
        P([ T('Declaro que me foram entregues nas mesmas condições de uso constantes da Nota de Entrada de Mercadorias Semi-Novas Nº ' + numeroNota(cliente) + ', pelo que dou plena e geral quitação.', { size: 20 }) ]),
        P([ T('') ]),
        ...blocoItens,
        P([ T('Goiânia, ' + String(hoje.getDate()).padStart(2, '0') + ' de ' + GOIANITA_MESES[hoje.getMonth()] + ' de ' + hoje.getFullYear() + '.', { size: 20 }) ]),
        P([ T('') ]), P([ T('') ]), P([ T('') ]),
        P([ T(cliente.nome || '', { bold: true }) ], { alignment: AlignmentType.CENTER }),
        P([ T('_________________________________________') ], { alignment: AlignmentType.CENTER }),
        P([ T('ASSINATURA DO FORNECEDOR / PROPRIETÁRIO') ], { alignment: AlignmentType.CENTER })
    ] }] });

    await baixarDocx(doc, 'Recibo_Devolucao_' + slugArquivo(cliente.nome) + '.docx');
};

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
                    <td><strong>${esc(c.nome)}</strong></td>
                    <td>${esc(c.chavePixType)}: <code>${esc(c.chavePix)}</code></td>
                    <td>${formatCurrency(fin.totalApostado)}</td>
                    <td>${formatCurrency(fin.totalPago)}</td>
                    <td><strong style="color: ${fin.saldoPendente > 0 ? 'var(--status-vendido)' : 'var(--status-venda)'};">${formatCurrency(fin.saldoPendente)}</strong></td>
                    <td>
                        <a href="cliente-detalhe.html?id=${encodeURIComponent(c.id)}" class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;">Visualizar Extrato</a>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Seção de Embaixadores — Repasses de Captação
    const embTableBody = document.getElementById('fin-embaixadores-table');
    if (embTableBody) {
        const embaixadores = window.GoianitaDB.embaixadores.getAll();
        if (!embaixadores.length) {
            embTableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Nenhum embaixador cadastrado. <a href="embaixadores.html" style="color:var(--accent-gold);">Cadastrar agora</a></td></tr>';
        } else {
            embTableBody.innerHTML = embaixadores.map(e => {
                const vals = window.GoianitaDB.utils.calcularValoresEmbaixador(e.id);
                return `<tr>
                    <td>
                        <strong>${esc(e.nome)}</strong>
                        <div style="font-size:11px;color:var(--text-muted);">${esc(e.cupom || '')}</div>
                    </td>
                    <td>${esc(e.chavePixType || '')}: <code>${esc(e.chavePix || '')}</code></td>
                    <td>${formatCurrency(vals.comissaoTotalGerada)}</td>
                    <td>${formatCurrency(vals.totalPago)}</td>
                    <td><strong style="color: ${vals.saldoPendente > 0 ? 'var(--status-devolucao)' : 'var(--text-muted)'}">${formatCurrency(vals.saldoPendente)}</strong></td>
                    <td><a href="embaixador-detalhe.html?id=${encodeURIComponent(e.id)}" class="btn btn-secondary" style="padding:6px 12px;font-size:12px;">Ver Extrato</a></td>
                </tr>`;
            }).join('');
        }
    }

    // Ações de backup/exportação
    const btnZerar = document.getElementById('btn-zerar-dados');
    if (btnZerar && !btnZerar.dataset.handlerBound) {
        btnZerar.dataset.handlerBound = '1';
        btnZerar.addEventListener('click', async () => {
            if (!confirm("ATENÇÃO: Isso apaga PERMANENTEMENTE todos os clientes, produtos e pagamentos — no navegador E no banco em nuvem (Firebase).\n\nEsta ação não pode ser desfeita. Deseja realmente zerar tudo?")) return;
            const original = btnZerar.textContent;
            btnZerar.disabled = true;
            btnZerar.textContent = 'Zerando (não feche a página)...';
            try {
                await window.GoianitaDB.importExport.zerarTudo();
                alert("Banco de dados zerado com sucesso (local e nuvem).");
            } catch (err) {
                alert("Zeramento concluído localmente, mas houve erro na nuvem: " + err.message);
            } finally {
                window.location.reload();
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
function calcularScoreDeVenda() {
    let conservacao = 'B';
    const classInput = document.querySelector('#etapa-1-checklist .mega-input[data-category="3. Classificação Comercial"]:checked');
    if (classInput) {
        const label = classInput.getAttribute('data-label');
        if (label.includes('Classe A+')) conservacao = 'A+';
        else if (label.includes('Classe A')) conservacao = 'A';
        else if (label.includes('Classe B')) conservacao = 'B';
        else if (label.includes('Classe C')) conservacao = 'C';
        else if (label.includes('RECUSADO')) conservacao = 'RECUSADO';
    }

    const marca = (document.getElementById('prod-marca')?.value || '').trim().toLowerCase();
    const marcasPremium = [
        'porto brasil', 'tramontina', 'le creuset', 'oxford', 'lyor',
        'wolff', 'vista alegre', 'schmidt', 'brinox', 'bon gourmet',
        'hazan', 'royal prestige', 'heritage', 'panelux', 'coup', 'brava'
    ];
    const ehMarcaPremium = marcasPremium.some(m => marca.includes(m));

    let qtdQualidades = 0;
    let qualidadesTexto = [];
    document.querySelectorAll('#etapa-1-checklist .mega-input:checked').forEach(chk => {
        const cat = chk.getAttribute('data-category');
        if (cat !== '3. Classificação Comercial') {
            qtdQualidades++;
            qualidadesTexto.push(chk.getAttribute('data-label'));
        }
    });

    let scoreVenda = 60; // Nota base 60
    if (conservacao === 'A+') scoreVenda += 20;
    if (conservacao === 'A') scoreVenda += 10;
    if (conservacao === 'C') scoreVenda -= 30;
    if (ehMarcaPremium) scoreVenda += 15;
    scoreVenda += Math.min(20, qtdQualidades * 2); 
    
    if (conservacao === 'RECUSADO') scoreVenda = 0;

    scoreVenda = Math.max(0, Math.min(100, scoreVenda));

    let status = 'APROVADO';
    if (scoreVenda < 40) status = 'REPROVADO';
    else if (scoreVenda < 70) status = 'CAUTELA';

    return { score: scoreVenda, status, conservacao, ehMarcaPremium, qtdQualidades, qualidadesTexto, marca };
}

function calcularPrecificacaoInteligente() {
    const nome = (document.getElementById('prod-nome')?.value || '').trim();
    const categoria = document.getElementById('prod-cat')?.value || 'Outros';
    
    const s = calcularScoreDeVenda();
    const { conservacao, ehMarcaPremium, qtdQualidades, qualidadesTexto, score: scoreVenda, marca } = s;

    if (conservacao === 'RECUSADO') {
        alert('Este produto foi marcado como RECUSADO na classificação comercial. O processo de precificação inteligente não será aplicado.');
        return;
    }

    const precoSugForecedor = parseFloat(document.getElementById('prod-preco-sug')?.value) || 0;
    const comissao = parseFloat(document.getElementById('prod-comissao')?.value) || 50;
    
    if (!nome) {
        alert('Por favor, preencha o nome do produto antes de usar a precificação inteligente.');
        return;
    }

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

    const multConservacao = { 'A+': 0.85, 'A': 0.70, 'B': 0.50, 'C': 0.35 };
    const multMarca = ehMarcaPremium ? 1.25 : 1.00;

    const nomeLower = nome.toLowerCase();
    let multNome = 1.0;
    if (nomeLower.includes('conjunto') || nomeLower.includes('kit') || nomeLower.includes('jogo')) multNome = 1.15;
    if (nomeLower.includes('completo') || nomeLower.includes('peças') || nomeLower.includes('pçs')) multNome *= 1.10;
    if (nomeLower.includes('antigo') || nomeLower.includes('vintage') || nomeLower.includes('colecionável')) multNome *= 1.25;

    const bonusChecklist = 1.00 + Math.min(0.20, (qtdQualidades * 0.02));

    const ref = tabelaCategoria[categoria] || tabelaCategoria['Outros'];
    const fatorConservacao = multConservacao[conservacao] || 0.50;

    let precoBase = ref.med * fatorConservacao * multMarca * multNome * bonusChecklist;

    if (precoSugForecedor > 0) {
        const ancoraSugerida = precoSugForecedor * fatorConservacao * 0.85;
        precoBase = (ancoraSugerida * 0.5) + (precoBase * 0.5);
    }

    precoBase = Math.max(ref.min, Math.min(ref.max, precoBase));

    const precoFinal  = arredondarPrecoComercial(precoBase);
    const precoMinimo = arredondarPrecoComercial(ref.min * fatorConservacao * multMarca);
    const precoMaximo = arredondarPrecoComercial(ref.max * fatorConservacao * multMarca);

    const comissaoGoianita  = (precoFinal * comissao) / 100;
    const repasseFornecedor = precoFinal - comissaoGoianita;

    if (document.getElementById('prod-preco-sug')) document.getElementById('prod-preco-sug').value = precoFinal.toFixed(2);
    if (document.getElementById('prod-preco'))     document.getElementById('prod-preco').value     = precoFinal.toFixed(2);

    const descField = document.getElementById('prod-desc');
    if (descField) {
        const marcaTxt = marca ? `da marca **${marca.toUpperCase()}**` : `de excelente qualidade`;
        const qualidadeTxt = qualidadesTexto.length > 0 
            ? `\n\n**Destaques:**\n- ${qualidadesTexto.slice(0, 6).join('\n- ')}` 
            : '';
        const intro = `✨ **${nome.toUpperCase()}** ✨\n\nEste incrível item ${marcaTxt} encontra-se em estado de conservação **${conservacao}**. Ideal para quem busca bom gosto e economia inteligente na Casas Goianita.`;
        descField.value = `${intro}${qualidadeTxt}\n\n✅ *Avaliado e Precificado pela IA Goianita*`.trim();
    }

    exibirResultadoPrecificacao({
        categoria, conservacao, ehMarcaPremium, fatorConservacao,
        precoFinal, precoMinimo, precoMaximo,
        comissao, comissaoGoianita, repasseFornecedor, precoSugForecedor,
        scoreVenda, bonusChecklist
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

function exibirResultadoPrecificacao(dados) {
    const painelAnterior = document.getElementById('painel-precificacao');
    if (painelAnterior) painelAnterior.remove();

    const {
        categoria, conservacao, ehMarcaPremium, fatorConservacao,
        precoFinal, precoMinimo, precoMaximo,
        comissao, comissaoGoianita, repasseFornecedor, precoSugForecedor,
        scoreVenda, bonusChecklist
    } = dados;

    let scoreColor = scoreVenda >= 80 ? '#388e3c' : (scoreVenda >= 50 ? '#f57c00' : '#d32f2f');
    let scoreLabel = scoreVenda >= 80 ? 'ALTA LIQUIDEZ' : (scoreVenda >= 50 ? 'VENDA MODERADA' : 'VENDA DIFÍCIL');

    const notaConservacao = `Estado "${conservacao}" → ${(fatorConservacao * 100).toFixed(0)}% do valor de mercado`;
    const notaMarca       = ehMarcaPremium ? '🌟 Marca premium reconhecida → +25% no valor' : 'Marca convencional (sem multiplicador extra)';
    const notaChecklist   = bonusChecklist > 1.0 ? `✅ Qualidades atestadas no checklist → +${((bonusChecklist - 1)*100).toFixed(0)}% de bônus` : 'Sem qualidades extras marcadas';

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
                display: grid; grid-template-columns: repeat(4, 1fr);
                gap: 16px; margin-bottom: 20px;
            }
            @media(max-width: 800px) { .prec-grid { grid-template-columns: repeat(2, 1fr); } }
            @media(max-width: 500px) { .prec-grid { grid-template-columns: 1fr; } }
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
            Análise Inteligente Concluída — <em style="font-weight:400; margin-left:4px;">${categoria} · ${conservacao}</em>
        </div>

        <div class="prec-grid">
            <div class="prec-card">
                <span class="plabel">Score de Venda</span>
                <span class="pvalor" style="color: ${scoreColor};">${scoreVenda}/100</span>
                <span class="psub" style="font-weight: bold; color: ${scoreColor};">${scoreLabel}</span>
            </div>
            <div class="prec-card">
                <span class="plabel">Preço de Etiqueta</span>
                <span class="pvalor" style="color: var(--accent-gold);">${formatCurrency(precoFinal)}</span>
                <span class="psub">Sugerido para Venda</span>
            </div>
            <div class="prec-card">
                <span class="plabel">Comissão (${comissao}%)</span>
                <span class="pvalor" style="color: var(--status-vendido);">${formatCurrency(comissaoGoianita)}</span>
                <span class="psub">Receita da loja</span>
            </div>
            <div class="prec-card">
                <span class="plabel">Repasse</span>
                <span class="pvalor" style="color: var(--status-pago);">${formatCurrency(repasseFornecedor)}</span>
                <span class="psub">Líquido do fornecedor</span>
            </div>
        </div>

        <div class="prec-faixa">
            📊 Faixa de preço base para <strong>${categoria}</strong>:
            de <strong>${formatCurrency(precoMinimo)}</strong> até <strong>${formatCurrency(precoMaximo)}</strong>
        </div>

        <div class="prec-notas">
            <span>${notaConservacao}</span>
            <span>${notaMarca}</span>
            <span>${notaChecklist}</span>
            <span class="prec-success">✅ Descrição persuasiva gerada e campos de preço preenchidos.</span>
        </div>
    `;

    const blocoIa = document.getElementById('bloco-ia-precificacao');
    if (blocoIa) {
        blocoIa.after(painel);
    } else {
        const nomeGroup = document.getElementById('prod-nome')?.closest('.form-group');
        if (nomeGroup) {
            nomeGroup.after(painel);
        } else {
            document.getElementById('produto-form')?.appendChild(painel);
        }
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
