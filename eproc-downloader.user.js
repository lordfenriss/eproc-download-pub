// ==UserScript==
// @name         Dossiês de Audiência — Downloader de Autos do eproc
// @namespace    dossies-audiencia-download
// @version      0.4.0
// @description  Automatiza busca, identificação de denúncia/IP/mídia e download de autos do eproc para dossiês de audiência. Ver README e docs/DECISOES.md deste repositório para o escopo da v1.
// @author       lordfenriss
// @homepageURL  https://github.com/lordfenriss/eproc-download-pub
// @supportURL   https://github.com/lordfenriss/eproc-download-pub/issues
// @downloadURL  https://raw.githubusercontent.com/lordfenriss/eproc-download-pub/main/eproc-downloader.user.js
// @updateURL    https://raw.githubusercontent.com/lordfenriss/eproc-download-pub/main/eproc-downloader.user.js
// @match        https://eproc1g.trf6.jus.br/eproc/*
// // Match amplo, comentado por padrão — só ativar se outra regional adotar este script:
// // @match     https://*.trf6.jus.br/eproc/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_download
// @grant        unsafeWindow
// ==/UserScript==

/*
 * AUTO-UPDATE (Tampermonkey)
 * O repositório de trabalho (lordfenriss/dossies-audiencia-download) é PRIVADO,
 * e o Tampermonkey não consegue baixar de raw.githubusercontent.com sem
 * autenticação — por isso o espelho PÚBLICO lordfenriss/eproc-download-pub,
 * que contém só este arquivo e é para onde @downloadURL/@updateURL apontam.
 * Instale UMA vez abrindo a @downloadURL no navegador (o Tampermonkey
 * intercepta URLs .user.js e oferece instalar); daí em diante ele confere
 * atualizações sozinho. REGRA: toda mudança precisa subir o @version, senão o
 * Tampermonkey não considera que há versão nova. Ver README, seção
 * "Atualização automática".
 *
 * ESTE ARQUIVO NÃO SUBSTITUI O MANUAL.
 * O Manual ("Download e Organização de Autos do eproc para Dossiês de Audiência",
 * Google Doc do projeto dossies-audiencia) é a fonte da verdade sobre o procedimento.
 * Este script só mecaniza a parte dele que dá para mecanizar sem julgamento humano —
 * ver docs/DECISOES.md para o que ficou de fora de propósito, e o que ainda não foi
 * testado contra o site real (bloco CONFIG abaixo).
 *
 * Convenção de nomes dos arquivos baixados (lida depois por scripts/organizar_autos.py):
 *   <processo>__AUTOS_PARTE_<n>.pdf
 *   <processo>__denuncia.pdf            (ou __denuncia_CONFERIR.pdf quando incerta)
 *   <processo>__IP_<numeroIP>__PARTE_<n>.pdf
 *   <processo>__<evento>_VIDEO<n>.<ext>  (ou _AUDIO<n> / nome original do eproc)
 * "__" (duplo underscore) é o separador — números de processo já usam "-", "." e "/" não aparece.
 */

(function () {
  'use strict';

  // ======================================================================
  // CONFIG — pontos que dependem do layout real do eproc e AINDA NÃO FORAM
  // TESTADOS contra o site (ver docs/DECISOES.md, seção "O que ainda não
  // foi validado"). Ajuste aqui primeiro se algo não funcionar.
  // ======================================================================
  const CONFIG = {
    // Heurísticas para achar a caixa de pesquisa do topo. Tentadas em ordem.
    searchBoxSelectors: [
      'input#numProcesso',
      'input[name*="numProcesso" i]',
      'input[id*="numProcesso" i]',
      'input[placeholder*="processo" i]',
    ],
    // Textos literais que aparecem no eproc (retirados do Manual — alta confiança).
    labels: {
      downloadCompleto: 'Download Completo',
      gerarArquivoCompleto: 'Gerar Arquivo Completo',
      geradoComSucesso: 'DOCUMENTO COMPLETO GERADO COM SUCESSO',
      baixarArquivo: 'BAIXAR ARQUIVO',
      baixarArquivoParte: 'BAIXAR ARQUIVO PARTE', // + " X"
      voltar: 'VOLTAR',
      // Achado do teste real (03/09/2026): não existe um botão único "Carregar
      // TODOS os eventos" — a tabela pagina, e cada página tem um link "Carregar
      // os eventos da próxima página" (href="javascript:carregarProximaPagina();").
      // carregarTodosOsEventos() clica nesse link em loop até ele sumir.
      carregarProximaPagina: 'Carregar os eventos da próxima página',
      inqueritoPolicial: 'INQUÉRITO POLICIAL',
      checkboxListaEventos: 'Adicionar lista com todos os eventos incluídos no download na capa do processo',
      checkboxAnexosEletronicos: 'Incluir anexos eletrônicos',
      checkboxSoComDocumentos: 'Trazer só eventos com documentos',
    },
    // Sinais de que os primeiros eventos indicam processo migrado de outro sistema
    // (PJe), usados só quando a busca direta por DENUNCIA/DENÚNCIA falha.
    // Lista inicial tirada do Manual (seção 3.6, exceção de 27/07/2026) — ajuste
    // conforme o teste real mostrar falsos positivos/negativos.
    migracaoSinais: [
      /dilig[eê]ncia/i,
      /parecer da autoridade policial/i,
      /relat[oó]rio de inqu[eé]rito/i,
      /traslado de pe[cç]as do processo/i,
    ],
    // Seletores da tabela de eventos. Separados do código para poder ser
    // ajustados aqui quando o eproc mudar o HTML — foi exatamente o que
    // fez o Evento 1 "sumir" nos testes anteriores.
    tabelaEventosSelector: '#tblEventos',
    // UNIDOS (não "o primeiro que bater"): o diagnóstico de 08/09/2026 mostrou
    // uma linha com documento sigiloso, cuja classe é infraLinkDocumentoSigiloso
    // e não infraLinkDocumento — numa linha que tivesse os dois, parar no
    // primeiro seletor perderia o outro documento. `data-doc` vem primeiro por
    // ser o mais confiável: no processo diagnosticado, os 107 links de
    // documento tinham data-doc, contra 106 com class="infraLinkDocumento".
    documentoLinkSelectors: [
      'a[data-doc]',
      'a.infraLinkDocumento',
      'a.infraLinkDocumentoSigiloso',
      'a[href*="acessar_documento"]',
      'a[onclick*="acessar_documento" i]',
    ],
    // Classe que o eproc dá ao link quando o documento é sigiloso. Só marca o
    // documento no log — não muda o que é baixado (quem opera já tem acesso).
    documentoSigilosoSelector: 'a.infraLinkDocumentoSigiloso',
    // Formato dos rótulos de documento do eproc: "INIC1", "DENUNCIA1",
    // "VIDEO2", "OFIC3"... — maiúsculas, sem espaço.
    rotuloDocumentoRegex: /^[A-ZÁÂÃÉÊÍÓÔÕÚÇ]{3,}[A-ZÁÂÃÉÊÍÓÔÕÚÇ0-9_.\-]*$/,
    denunciaRegex: /den[uú]ncia/i,
    queixaCrimeRegex: /queixa[\s-]?crime/i,
    mediaRegex: /video|audio|termoaud/i,
    termoaudOnlyRegex: /^termoaud/i,
    // Padrão de nome sugerido pelo eproc para mídia, informado pelo usuário:
    // "<evento>_VIDEO<n>.<ext>" (também vale AUDIO no lugar de VIDEO).
    mediaFilenamePattern: /^(\d+)_(VIDEO|AUDIO)(\d+)\.(\w+)$/i,
    // ------------------------------------------------------------------
    // Fluxo "Download Completo" (as partes dos autos). Os rótulos vêm do
    // Manual; os seletores são heurísticas por TEXTO de propósito — o
    // episódio do documento sigiloso (08/09/2026) mostrou que classe CSS é
    // o que quebra primeiro quando o eproc muda.
    // ------------------------------------------------------------------
    downloadCompleto: {
      // O que fazer com cada checkbox da tela de opções.
      //   null  = NÃO MEXER (usa o que o eproc já traz marcado) — padrão
      //   true  = forçar marcada
      //   false = forçar desmarcada
      // Padrão conservador: não mexer em nada e só REGISTRAR NO LOG o estado
      // de cada uma. Mexer às cegas no que o eproc já traz pode mudar o
      // conteúdo do PDF sem ninguém perceber. Depois do primeiro download
      // real, ajuste aqui conforme o Manual.
      checkboxes: {
        listaEventos: null,
        anexosEletronicos: null,
        soComDocumentos: null,
      },
      // Quantas partes no máximo procurar numa tela (trava de segurança).
      maxPartes: 50,
      // Tempo máximo esperando a tela de opções aparecer depois do clique.
      timeoutTelaMs: 30000,
    },
    mediaMinBytes: 20 * 1024, // abaixo disso e sem Content-Type de mídia, é suspeito (ver docs/DECISOES.md, ponto 6)
    limiteFontesNotebookLM: 50,
    // Intervalo e tentativas máximas ao esperar o "Download Completo" ficar pronto.
    pollDownloadCompletoMs: 15000,
    pollDownloadCompletoMaxTentativas: 40, // ~10 minutos
  };

  const STATE_KEY = 'eprocDownloaderState_v1';
  const LOG_KEY = 'eprocDownloaderLog_v1';
  const MANIFESTO_KEY = 'eprocDownloaderManifesto_v1';
  const OPCOES_KEY = 'eprocDownloaderOpcoes_v1';

  // O que o script baixa. Marcável no painel — o usuário que precisa dos
  // AUTOS num dia corrido pode desligar denúncia e mídia e não pagar o tempo
  // desses passos.
  function loadOpcoes() {
    return Object.assign(
      { autos: true, denuncia: true, midia: true, ips: true },
      GM_getValue(OPCOES_KEY, {})
    );
  }
  function saveOpcoes(opcoes) {
    GM_setValue(OPCOES_KEY, opcoes);
  }

  // ======================================================================
  // Estado persistente — necessário porque navegação de página inteira
  // (ex.: usar a caixa de busca) reseta qualquer variável JS em memória.
  // Achado crítico já registrado no Manual (14/08/2026): não confiar em
  // window.* sobrevivendo a uma navegação.
  // ======================================================================
  function loadState() {
    return GM_getValue(STATE_KEY, null);
  }
  function saveState(state) {
    GM_setValue(STATE_KEY, state);
  }
  function clearState() {
    GM_deleteValue(STATE_KEY);
  }
  // Achado do teste real (03/09/2026): a busca por número NAVEGA a página
  // inteira (confirmado pelo usuário — a tela pisca e recarrega), então o
  // fluxo de processamento não pode ser uma função só com `await` no meio:
  // cada navegação descarta o contexto JS em execução. `avancarFila()` (perto
  // do fim do arquivo) é chamada tanto pelo botão "Iniciar" quanto de novo, do
  // zero, a cada carregamento de página — e usa só o que está aqui no estado
  // persistido para saber onde retomar.
  function newState(processos) {
    return {
      fila: processos.map((numero) => ({
        numero,
        status: 'pendente', // pendente | em_andamento | concluido | erro | pulado
        ip: [], // números de IP referenciados encontrados
        observacao: '',
      })),
      // ocioso | aguardando_busca_principal | aguardando_busca_ip
      fase: 'ocioso',
      processoAtual: null, // numero do item da fila em andamento (mesmo durante a subfase de IP)
      ipIndiceAtual: 0, // índice em item.ip sendo processado, quando fase === 'aguardando_busca_ip'
      pausado: false, // true depois de clicar "Parar" — impede retomada automática na próxima carga
    };
  }

  function log(mensagem, nivel = 'info') {
    const entradas = GM_getValue(LOG_KEY, []);
    entradas.push({ ts: new Date().toISOString(), nivel, mensagem });
    GM_setValue(LOG_KEY, entradas);
    console.log(`[eproc-downloader] [${nivel}] ${mensagem}`);
    renderLog();
  }
  function getLog() {
    return GM_getValue(LOG_KEY, []);
  }
  function clearLog() {
    GM_deleteValue(LOG_KEY);
  }

  // ======================================================================
  // Utilidades de DOM — texto em vez de coordenadas/seletores frágeis,
  // seguindo a mesma prática já validada no Manual ("não confiar em
  // coordenadas fixas, pois o layout muda conforme menus/avisos abertos").
  // ======================================================================
  function findByText(tag, texto, { exact = false, root = document } = {}) {
    const els = root.querySelectorAll(tag);
    const alvo = texto.toLowerCase();
    for (const el of els) {
      const conteudo = (el.textContent || '').trim().toLowerCase();
      if (exact ? conteudo === alvo : conteudo.includes(alvo)) return el;
    }
    return null;
  }
  function findAllByText(tag, texto, { root = document } = {}) {
    const els = root.querySelectorAll(tag);
    const alvo = texto.toLowerCase();
    return Array.from(els).filter((el) => (el.textContent || '').toLowerCase().includes(alvo));
  }
  function findSearchBox() {
    for (const sel of CONFIG.searchBoxSelectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    // Fallback: primeiro input de texto visível na página.
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
    const visivel = inputs.find((i) => i.offsetParent !== null);
    if (visivel) {
      log('Caixa de pesquisa não encontrada pelos seletores conhecidos — usando o primeiro input de texto visível como fallback. Confira CONFIG.searchBoxSelectors se isso estiver errado.', 'aviso');
      return visivel;
    }
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Espera até um seletor aparecer na página (poll simples) — usado depois da
  // busca, para dar tempo da tabela de eventos do processo carregar.
  async function aguardarElemento(seletor, { timeoutMs = 15000, intervaloMs = 300 } = {}) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      const el = document.querySelector(seletor);
      if (el) return el;
      await sleep(intervaloMs);
    }
    return null;
  }

  // ======================================================================
  // Leitura da tabela de eventos (#tblEventos) — estrutura confirmada no
  // teste ao vivo de 03/09/2026 (ver docs/DECISOES.md). Cada linha
  // <tr id="trEvento<N>"> pode ter mais de um documento anexado.
  //
  // Duas leituras diferentes, de propósito:
  //   lerEventos()       -> uma entrada por EVENTO, INCLUSIVE eventos sem
  //                         nenhum link de documento reconhecido. É o que
  //                         permite distinguir "o Evento 1 não está na
  //                         tabela" (problema de paginação) de "o Evento 1
  //                         está na tabela, mas o seletor de link não bateu"
  //                         (problema de seletor). Antes o script só
  //                         enxergava a lista de documentos, e os dois casos
  //                         davam a mesma mensagem de erro genérica — que é
  //                         por que três rodadas de teste não avançaram.
  //   lerLinhasEventos() -> uma entrada por DOCUMENTO, que é o que os
  //                         regexes de denúncia/mídia testam (o rótulo do
  //                         documento: "INIC1", "DENUNCIA1", "VIDEO2").
  // ======================================================================
  function tabelaEventos() {
    return document.querySelector(CONFIG.tabelaEventosSelector);
  }

  function linhasDeEvento(tabela) {
    const raiz = tabela || tabelaEventos();
    if (!raiz) return [];
    return Array.from(raiz.querySelectorAll('tr[id^="trEvento"]'));
  }

  // Links de documento de uma linha: UNIÃO de todos os seletores de
  // CONFIG.documentoLinkSelectors, deduplicada (um mesmo <a> casa com vários).
  // Parar no primeiro seletor que desse resultado perderia, numa linha com
  // documento comum + documento sigiloso, o que não casasse com o primeiro.
  // Se nenhum seletor bater, cai no fallback por formato do rótulo, para o
  // caso de o eproc trocar a classe CSS dos links.
  function documentosDaLinha(tr) {
    const achados = new Set();
    for (const sel of CONFIG.documentoLinkSelectors) {
      for (const a of tr.querySelectorAll(sel)) achados.add(a);
    }
    if (achados.size) return Array.from(achados);
    return Array.from(tr.querySelectorAll('a[href]')).filter((a) =>
      CONFIG.rotuloDocumentoRegex.test((a.textContent || '').trim())
    );
  }

  function numeroDoEvento(tr) {
    const doId = (tr.id.match(/trEvento(\d+)/) || [])[1];
    if (doId) return doId;
    // Fallback: a primeira célula da linha costuma ser o número do evento.
    const primeiraCelula = tr.querySelector('td, th');
    const texto = ((primeiraCelula && primeiraCelula.textContent) || '').trim();
    return /^\d+$/.test(texto) ? texto : '';
  }

  // Texto das células da linha (coluna "Descrição" inclusive). Os sinais de
  // migração do PJe (CONFIG.migracaoSinais: "Diligência", "Parecer da
  // autoridade policial"...) aparecem AQUI, na descrição do evento — não no
  // rótulo do documento. Testá-los só contra rótulos, como antes, era um
  // teste morto: "INIC1" nunca casaria com /dilig[eê]ncia/i.
  function descricaoDoEvento(tr) {
    return Array.from(tr.querySelectorAll('td'))
      .map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())
      .join(' | ')
      .slice(0, 300);
  }

  function documentoDoLink(a, numeroEvento) {
    const rotulo = (a.textContent || '').trim();
    const mimetype = a.getAttribute('data-mimetype') || '';
    return {
      rotulo,
      // `a.href` (propriedade), NÃO `a.getAttribute('href')`: no eproc o
      // atributo é relativo ("controlador.php?acao=acessar_documento&..."),
      // e GM_download exige URL absoluta — com o valor relativo TODO download
      // falharia, mesmo com o documento corretamente localizado. Achado do
      // diagnóstico de 08/09/2026.
      href: a.href || '',
      numeroEvento,
      sigiloso: typeof a.matches === 'function' && a.matches(CONFIG.documentoSigilosoSelector),
      codigoDocumento: a.getAttribute('data-doc') || '',
      // Formato "<evento>_<ROTULO>.<mimetype>" (ex.: "135_VIDEO2.mp4"),
      // que casa com CONFIG.mediaFilenamePattern.
      nomeArquivoSugerido: mimetype ? `${numeroEvento}_${rotulo}.${mimetype}` : '',
    };
  }

  function eventoDaLinha(tr) {
    const numeroEvento = numeroDoEvento(tr);
    return {
      numeroEvento,
      tr,
      descricao: descricaoDoEvento(tr),
      documentos: documentosDaLinha(tr).map((a) => documentoDoLink(a, numeroEvento)),
    };
  }

  function lerEventos() {
    const eventos = linhasDeEvento().map(eventoDaLinha);
    eventos.sort((a, b) => Number(a.numeroEvento) - Number(b.numeroEvento));
    return eventos;
  }

  function lerLinhasEventos(eventos) {
    const linhas = [];
    // A tabela lista do evento mais recente para o mais antigo; lerEventos()
    // já devolve em ordem ascendente, e tratarDenuncia olha os "primeiros"
    // esperando que sejam os eventos INICIAIS do processo.
    for (const evento of (eventos || lerEventos())) linhas.push(...evento.documentos);
    return linhas;
  }

  // ======================================================================
  // Localiza o Evento 1 (o inicial). Independente de a paginação já ter
  // carregado tudo: tenta o id direto (#trEvento1) antes de varrer a lista.
  // Devolve `motivo` preenchido quando não acha, para o log dizer QUAL é o
  // problema em vez do antigo "Evento 1 não pôde ser localizado".
  // ======================================================================
  function localizarEvento1(eventos) {
    const lista = eventos || lerEventos();

    let linha = lista.find((e) => e.numeroEvento === '1') || null;
    if (!linha) {
      const porId = document.getElementById('trEvento1');
      if (porId) linha = eventoDaLinha(porId);
    }

    if (linha && linha.documentos.length) {
      const inic = linha.documentos.find((d) => /^INIC/i.test(d.rotulo));
      return { documento: inic || linha.documentos[0], evento: linha, motivo: null };
    }

    // Último recurso: qualquer documento com rótulo "INIC..." em qualquer
    // evento — processos migrados podem não ter a inicial no Evento 1.
    const porRotulo = lista.flatMap((e) => e.documentos).find((d) => /^INIC/i.test(d.rotulo || ''));
    if (porRotulo) {
      return { documento: porRotulo, evento: null, motivo: null };
    }

    if (linha) {
      return {
        documento: null,
        evento: linha,
        motivo: `a linha do Evento 1 EXISTE na tabela, mas nenhum link de documento foi reconhecido dentro dela (${linha.tr.querySelectorAll('a').length} link(s) na linha, nenhum casou com CONFIG.documentoLinkSelectors). Isso é problema de SELETOR, não de paginação — clique em "Diagnóstico" no painel e mande o arquivo gerado.`,
      };
    }

    if (lista.length === 0) {
      return {
        documento: null,
        evento: null,
        motivo: 'nenhuma linha de evento foi lida da tabela — problema de SELETOR da tabela ou das linhas (CONFIG.tabelaEventosSelector). Clique em "Diagnóstico" no painel e mande o arquivo gerado.',
      };
    }

    const numeros = lista.map((e) => Number(e.numeroEvento)).filter((n) => Number.isFinite(n));
    const menor = numeros.length ? Math.min(...numeros) : '?';
    return {
      documento: null,
      evento: null,
      motivo: `o Evento 1 não está entre os ${lista.length} eventos lidos (o mais antigo lido é o Evento ${menor}) — a paginação não chegou até a última página. Clique em "Diagnóstico" no painel e mande o arquivo gerado.`,
    };
  }

  // Clica em "Carregar os eventos da próxima página" repetidamente até a
  // tabela não ter mais páginas (o link some). Prefere chamar a função global
  // da página diretamente (unsafeWindow) a clicar no link — mais confiável
  // dentro do sandbox do Tampermonkey do que depender do href "javascript:".
  async function carregarTodosOsEventos({ maxIteracoes = 100, timeoutCargaMs = 6000, maxFalhasSeguidas = 2 } = {}) {
    let falhasSeguidas = 0;
    for (let i = 0; i < maxIteracoes; i++) {
      // A tabela vem em ordem decrescente e contígua: se o Evento 1 (o mais
      // antigo que existe) já está no DOM, não há página seguinte com nada
      // novo. Achado do diagnóstico de 08/09/2026: o link "próxima página"
      // NÃO some no fim da lista — continua lá e não traz nada, gastando dois
      // cliques e ~12s até o loop desistir, e logando duas "falhas" que
      // pareciam bug e não eram.
      if (document.getElementById('trEvento1')) {
        log(`Eventos: lista completa — o Evento 1 já está carregado (${i} clique(s) em "próxima página").`);
        return;
      }

      const linkProximaPagina = document.querySelector('a[href*="carregarProximaPagina"]')
        || findByText('a', CONFIG.labels.carregarProximaPagina);
      if (!linkProximaPagina) {
        if (i > 0) log(`Eventos: todas as páginas carregadas (${i} clique(s) em "próxima página").`);
        return;
      }

      const antes = document.querySelectorAll('#tblEventos tbody tr[id^="trEvento"]').length;
      if (typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.carregarProximaPagina === 'function') {
        unsafeWindow.carregarProximaPagina();
      } else {
        linkProximaPagina.click();
      }

      const inicio = Date.now();
      while (
        document.querySelectorAll('#tblEventos tbody tr[id^="trEvento"]').length <= antes
        && Date.now() - inicio < timeoutCargaMs
      ) {
        await sleep(300);
      }

      const depois = document.querySelectorAll('#tblEventos tbody tr[id^="trEvento"]').length;
      if (depois <= antes) {
        falhasSeguidas += 1;
        log(`Eventos: clique em "próxima página" (tentativa ${i + 1}) não trouxe linhas novas — ${falhasSeguidas}ª vez seguida.`, 'aviso');
        // Nunca fica travado em silêncio à espera de até 100 tentativas: desiste
        // depois de poucas falhas seguidas (link pode não sumir mesmo sem mais
        // páginas, ou o clique pode não estar funcionando no sandbox do
        // Tampermonkey — ver comentário acima sobre unsafeWindow).
        if (falhasSeguidas >= maxFalhasSeguidas) {
          log(`Eventos: ${falhasSeguidas} tentativas seguidas sem carregar nada novo — parando de tentar. Confira manualmente se a lista está completa (pode ser fim da lista, ou o clique não está funcionando).`, 'aviso');
          return;
        }
      } else {
        falhasSeguidas = 0;
        log(`Eventos: página ${i + 1} carregada (${depois - antes} linha(s) nova(s), total ${depois}).`);
      }
    }
    log('Atingido o limite de páginas de eventos carregadas — processo pode ter mais eventos do que o lido. Ajuste CONFIG se isso acontecer de verdade.', 'aviso');
  }

  // ======================================================================
  // Download — GM_download (achado do teste real, 03/09/2026): baixar via
  // fetch+blob+<a download>.click() é tratado pelo Chrome como "site
  // tentando baixar vários arquivos" depois do primeiro ou segundo clique
  // programático, e passa a bloquear silenciosamente os seguintes — o
  // script continua achando que baixou (marca "concluído"), mas o arquivo
  // nunca chega ao disco. GM_download roda pelo gerenciador de download da
  // própria extensão do Tampermonkey, fora desse bloqueio por-site do
  // Chrome. AINDA NÃO CONFIRMADO em teste real: se GM_download envia os
  // cookies de sessão do eproc automaticamente (deveria, por ser um
  // download disparado pelo navegador no mesmo domínio) — confira que o
  // primeiro arquivo baixado por essa rota realmente abre e não é uma
  // página de login/erro antes de confiar no lote inteiro.
  // ======================================================================
  function baixarComoArquivo(href, nomeArquivo) {
    return new Promise((resolve, reject) => {
      GM_download({
        url: href,
        name: nomeArquivo, // barra "/" não cria subpasta real — nunca usar aqui (achado do Manual, 14/08/2026)
        saveAs: false,
        onload: () => resolve({}),
        onerror: (detalhe) => reject(new Error(`GM_download falhou em ${href}: ${detalhe?.error || JSON.stringify(detalhe)}`)),
        ontimeout: () => reject(new Error(`GM_download expirou (timeout) em ${href}`)),
      });
    });
  }

  function nomeSeguro(s) {
    return s.replace(/[\\/]/g, '_');
  }

  // ======================================================================
  // "Download Completo" — as partes dos autos. Peças de apoio.
  //
  // Tudo aqui procura por TEXTO, não por classe CSS: o episódio do documento
  // sigiloso (08/09/2026) mostrou que a classe é o que quebra primeiro. E
  // todo passo que não acha o que procura chama diagnosticoTela(), que baixa
  // um .txt com o que HAVIA na tela naquele instante — para o próximo ajuste
  // sair numa rodada, e não em três.
  // ======================================================================

  // Texto "clicável" de um elemento: <input type=submit> guarda o rótulo em
  // value, não em textContent — sem isso, botões de formulário não são achados.
  function textoDeControle(el) {
    if (el.tagName === 'INPUT') return (el.value || el.getAttribute('value') || '').trim();
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function controlesClicaveis(raiz = document) {
    return Array.from(raiz.querySelectorAll('a, button, input[type="submit"], input[type="button"]'));
  }

  // Acha um controle cujo texto contenha `texto`. Prefere a correspondência
  // mais curta: numa tela com "BAIXAR ARQUIVO" e "BAIXAR ARQUIVO PARTE 1",
  // procurar "BAIXAR ARQUIVO" tem de achar o primeiro, não o segundo.
  function acharControle(texto, { raiz = document, visivel = true } = {}) {
    const alvo = texto.toLowerCase();
    const candidatos = controlesClicaveis(raiz)
      .filter((el) => textoDeControle(el).toLowerCase().includes(alvo))
      .filter((el) => !visivel || el.offsetParent !== null || el.getClientRects().length > 0)
      .sort((a, b) => textoDeControle(a).length - textoDeControle(b).length);
    return candidatos[0] || null;
  }

  function acharTodosControles(texto, { raiz = document } = {}) {
    const alvo = texto.toLowerCase();
    return controlesClicaveis(raiz).filter((el) => textoDeControle(el).toLowerCase().includes(alvo));
  }

  // Espera um controle com esse texto aparecer (a tela do eproc pode demorar
  // ou vir por navegação). Devolve null no timeout — quem chama decide.
  async function aguardarControle(texto, { timeoutMs = 20000, intervaloMs = 400 } = {}) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      const el = acharControle(texto);
      if (el) return el;
      await sleep(intervaloMs);
    }
    return null;
  }

  // Checkbox pelo texto do <label> associado (ou do texto ao redor).
  function acharCheckboxPorTexto(texto) {
    const alvo = texto.toLowerCase().slice(0, 60);
    for (const input of document.querySelectorAll('input[type="checkbox"]')) {
      const rotuloDoFor = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
      const contexto = [
        rotuloDoFor && rotuloDoFor.textContent,
        input.closest('label') && input.closest('label').textContent,
        input.parentElement && input.parentElement.textContent,
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();
      if (contexto.includes(alvo)) return input;
    }
    return null;
  }

  // Dump da tela atual quando um passo não acha o que esperava. É o mesmo
  // princípio do Diagnóstico da tabela: transformar "não funcionou" em dado
  // acionável na primeira tentativa.
  function diagnosticoTela(motivo) {
    const linhas = [];
    linhas.push('=== DIAGNÓSTICO DE TELA — eproc-downloader ===');
    linhas.push(`Motivo: ${motivo}`);
    linhas.push(`Data: ${new Date().toISOString()}`);
    linhas.push(`URL: ${location.href}`);
    linhas.push(`Título: ${document.title}`);
    linhas.push('');
    linhas.push('--- Controles clicáveis visíveis (tag | texto | href/onclick) ---');
    for (const el of controlesClicaveis()) {
      const visivel = el.offsetParent !== null || el.getClientRects().length > 0;
      if (!visivel) continue;
      const alvo = el.getAttribute('href') || el.getAttribute('onclick') || '';
      linhas.push(`  ${el.tagName} | "${textoDeControle(el).slice(0, 90)}" | ${alvo.slice(0, 120)}`);
    }
    linhas.push('');
    linhas.push('--- Checkboxes (marcada? | id | texto ao redor) ---');
    for (const input of document.querySelectorAll('input[type="checkbox"]')) {
      const perto = ((input.closest('label') || input.parentElement || {}).textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 110);
      linhas.push(`  ${input.checked ? '[x]' : '[ ]'} | id="${input.id}" | ${perto}`);
    }
    linhas.push('');
    linhas.push('--- Texto visível da página (primeiros 3000 caracteres) ---');
    linhas.push((document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 3000));
    return finalizarDiagnostico(linhas, 'eproc-diagnostico-tela');
  }

  // ----------------------------------------------------------------------
  // Manifesto de downloads. Existe porque nem todo botão de "baixar parte"
  // do eproc é um <a href> que dá para passar ao GM_download com um nome
  // nosso: quando é só um clique em JS, quem nomeia o arquivo é o eproc, e
  // o nome não diz de que processo veio. O manifesto registra, a cada
  // download, o processo/IP e o instante do clique — e
  // scripts/organizar_autos.py usa isso para casar os arquivos por horário
  // de criação e renomear. Sem ele, um lote de "documento1.pdf",
  // "documento2.pdf" vira um quebra-cabeça manual.
  // ----------------------------------------------------------------------
  function registrarNoManifesto(entrada) {
    const manifesto = GM_getValue(MANIFESTO_KEY, []);
    manifesto.push({ ts: new Date().toISOString(), ...entrada });
    GM_setValue(MANIFESTO_KEY, manifesto);
  }

  function exportarManifesto() {
    const manifesto = GM_getValue(MANIFESTO_KEY, []);
    if (manifesto.length === 0) {
      log('Nada para exportar — nenhum download registrado no manifesto ainda.', 'aviso');
      return;
    }
    baixarTexto(
      `eproc-manifesto-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      JSON.stringify(manifesto, null, 2)
    );
    log(`Manifesto exportado (${manifesto.length} download(s)). Passe-o ao organizar_autos.py com --manifesto.`);
  }

  // ----------------------------------------------------------------------
  // Baixa todas as partes dos autos visíveis na tela de download.
  // `prefixo` já vem pronto ("<processo>" ou "<processo>__IP_<numero>"), e
  // a convenção de nome é a de docs/DECISOES.md, lida depois pelo organizador.
  // ----------------------------------------------------------------------
  async function baixarPartesDosAutos(prefixo, { numeroProcesso, ip = null } = {}) {
    // "BAIXAR ARQUIVO PARTE 1", "BAIXAR ARQUIVO PARTE 2"... ou, quando o
    // documento coube num arquivo só, um único "BAIXAR ARQUIVO".
    let botoes = acharTodosControles(CONFIG.labels.baixarArquivoParte);
    let temPartes = botoes.length > 0;
    if (!temPartes) {
      const unico = acharControle(CONFIG.labels.baixarArquivo);
      botoes = unico ? [unico] : [];
    }

    if (botoes.length === 0) {
      log(`${numeroProcesso}: tela de download aberta, mas nenhum botão "${CONFIG.labels.baixarArquivo}" foi encontrado. Gerando diagnóstico de tela.`, 'erro');
      diagnosticoTela(`nenhum botão de baixar parte encontrado (processo ${numeroProcesso}${ip ? `, IP ${ip}` : ''})`);
      return { baixadas: 0, viaClique: 0 };
    }

    if (botoes.length > CONFIG.downloadCompleto.maxPartes) {
      log(`${numeroProcesso}: ${botoes.length} botões de parte encontrados, acima do limite de segurança (${CONFIG.downloadCompleto.maxPartes}). Baixando só os primeiros — confira manualmente.`, 'aviso');
      botoes = botoes.slice(0, CONFIG.downloadCompleto.maxPartes);
    }

    // Ordena pelo número da parte que aparece no rótulo, para PARTE_2 não
    // virar PARTE_10 por acidente de ordem no DOM.
    botoes.sort((a, b) => numeroDaParte(a) - numeroDaParte(b));

    let baixadas = 0;
    let viaClique = 0;
    for (let i = 0; i < botoes.length; i++) {
      const botao = botoes[i];
      const parte = temPartes ? numeroDaParte(botao) || i + 1 : 1;
      const nome = temPartes
        ? `${prefixo}__AUTOS_PARTE_${parte}.pdf`
        : `${prefixo}__AUTOS.pdf`;
      const href = botao.tagName === 'A' ? botao.href : '';
      const hrefUtilizavel = href && /^https?:/i.test(href) && !/^javascript:/i.test(botao.getAttribute('href') || '');

      if (hrefUtilizavel) {
        try {
          await baixarComoArquivo(href, nome);
          registrarNoManifesto({ processo: numeroProcesso, ip, rotulo: textoDeControle(botao), nomeArquivo: nome, viaClique: false });
          baixadas += 1;
          log(`${numeroProcesso}: autos — ${nome} baixado.`);
        } catch (e) {
          log(`${numeroProcesso}: falha ao baixar ${nome}: ${e && e.message ? e.message : e}`, 'erro');
        }
      } else {
        // Sem href utilizável: só resta clicar, e quem nomeia é o eproc. O
        // manifesto guarda o instante do clique para o organizador casar
        // depois pelo horário do arquivo.
        botao.click();
        registrarNoManifesto({ processo: numeroProcesso, ip, rotulo: textoDeControle(botao), nomeArquivo: nome, viaClique: true });
        viaClique += 1;
        baixadas += 1;
        log(`${numeroProcesso}: autos — parte ${parte} baixada por clique (o eproc é quem nomeia o arquivo; o manifesto registra que ela é deste processo${ip ? `, IP ${ip}` : ''}).`, 'aviso');
        // Respiro entre cliques: downloads em rajada são justamente o que o
        // Chrome bloqueia (ver comentário de baixarComoArquivo).
        await sleep(1500);
      }
    }
    return { baixadas, viaClique };
  }

  function numeroDaParte(el) {
    const m = textoDeControle(el).match(/parte\s*(\d+)/i);
    return m ? Number(m[1]) : 0;
  }

  // Aplica CONFIG.downloadCompleto.checkboxes e registra no log o estado de
  // cada uma — mesmo quando a política é "não mexer", porque saber como o
  // eproc veio marcado é o que permite decidir depois do primeiro download.
  function configurarOpcoesDownloadCompleto(numeroProcesso) {
    const mapa = [
      ['listaEventos', CONFIG.labels.checkboxListaEventos],
      ['anexosEletronicos', CONFIG.labels.checkboxAnexosEletronicos],
      ['soComDocumentos', CONFIG.labels.checkboxSoComDocumentos],
    ];
    const relato = [];
    for (const [chave, rotulo] of mapa) {
      const input = acharCheckboxPorTexto(rotulo);
      if (!input) {
        relato.push(`${chave}=NÃO ENCONTRADA`);
        continue;
      }
      const desejado = CONFIG.downloadCompleto.checkboxes[chave];
      if (desejado === null || desejado === undefined) {
        relato.push(`${chave}=${input.checked ? 'marcada' : 'desmarcada'} (mantida)`);
        continue;
      }
      if (input.checked !== desejado) {
        input.click();
        relato.push(`${chave}=${desejado ? 'marcada' : 'desmarcada'} (ALTERADA pelo script)`);
      } else {
        relato.push(`${chave}=${input.checked ? 'marcada' : 'desmarcada'} (já estava)`);
      }
    }
    log(`${numeroProcesso}: opções do Download Completo — ${relato.join(', ')}.`);
  }

  // ======================================================================
  // Passo: identificar e baixar a denúncia (ver docs/DECISOES.md, ponto 4)
  // ======================================================================
  async function tratarDenuncia(numeroProcesso, linhasEventos, eventos) {
    const prefixo = nomeSeguro(numeroProcesso);
    const listaEventos = eventos || lerEventos();
    const linhas = linhasEventos || lerLinhasEventos(listaEventos);

    const linhaDenuncia = linhas.find((l) => CONFIG.denunciaRegex.test(l.rotulo));
    if (linhaDenuncia) {
      const nome = `${prefixo}__denuncia.pdf`;
      await baixarComoArquivo(linhaDenuncia.href, nome);
      log(`${numeroProcesso}: denúncia identificada pelo rótulo do evento ("${linhaDenuncia.rotulo}")${linhaDenuncia.sigiloso ? ' [documento SIGILOSO]' : ''} — baixada como ${nome}.`);
      return { encontrada: true, precisaConferencia: false };
    }

    // Regex direta falhou — checar sinais de migração do PJe nos primeiros
    // eventos. Os sinais ("Diligência", "Parecer da autoridade policial"...)
    // estão na DESCRIÇÃO do evento, não no rótulo do documento; testá-los só
    // contra rótulos (como antes) nunca podia bater.
    const primeirosEventos = listaEventos.slice(0, 10);
    const textoPrimeirosEventos = primeirosEventos
      .map((e) => `${e.descricao} ${e.documentos.map((d) => d.rotulo).join(' ')}`)
      .join(' | ');
    const indicaMigracao = CONFIG.migracaoSinais.some((re) => re.test(textoPrimeirosEventos));

    if (indicaMigracao) {
      log(`${numeroProcesso}: rótulo de denúncia não encontrado e os primeiros eventos indicam possível migração do PJe — NÃO foi baixado nenhum candidato a denúncia. Revisar manualmente (ver Manual, seção 3.6, casos de processo migrado).`, 'aviso');
      return { encontrada: false, precisaConferencia: true };
    }

    // Sem sinal de migração: baixar o Evento 1 (INIC1) como candidato, com aviso.
    const { documento: evento1, motivo } = localizarEvento1(listaEventos);
    if (evento1) {
      const nome = `${prefixo}__denuncia_CONFERIR.pdf`;
      await baixarComoArquivo(evento1.href, nome);
      log(`${numeroProcesso}: rótulo de denúncia não encontrado; sem sinal de migração nos primeiros eventos. Baixado o Evento ${evento1.numeroEvento || '1'} ("${evento1.rotulo}")${evento1.sigiloso ? ' [documento SIGILOSO]' : ''} como candidato — ${nome}. CONFIRME manualmente (pode ser queixa-crime — ver Manual, seção 3.6).`, 'aviso');
      return { encontrada: true, precisaConferencia: true };
    }

    // Mensagem específica em vez do antigo "Evento 1 não pôde ser localizado":
    // `motivo` diz se o problema é paginação, seletor da tabela ou seletor do
    // link — que é a informação que faltava nas três rodadas anteriores.
    log(`${numeroProcesso}: rótulo de denúncia não encontrado e o Evento 1 não pôde ser localizado — ${motivo}`, 'erro');
    return { encontrada: false, precisaConferencia: true };
  }

  // ======================================================================
  // Passo: varredura de mídia (ver docs/DECISOES.md, ponto 6)
  // ======================================================================
  async function tratarMidia(numeroProcesso, linhasEventos, { prefixoExtra = '' } = {}) {
    const prefixo = nomeSeguro(numeroProcesso) + (prefixoExtra ? `__${prefixoExtra}` : '');
    const candidatos = linhasEventos.filter((l) => CONFIG.mediaRegex.test(l.rotulo));

    for (const c of candidatos) {
      if (CONFIG.termoaudOnlyRegex.test(c.rotulo) && !/video|audio/i.test(c.rotulo)) {
        log(`${numeroProcesso}: evento "${c.rotulo}" é só TERMOAUD (termo de audiência em HTML) — não é mídia, ignorado.`);
        continue;
      }

      let confiavel = false;
      let nomeSugerido = c.nomeArquivoSugerido || '';
      if (CONFIG.mediaFilenamePattern.test(nomeSugerido)) {
        confiavel = true;
      }

      let bytes = null;
      let tipo = null;
      try {
        const resposta = await fetch(c.href, { method: 'HEAD', credentials: 'include' });
        tipo = resposta.headers.get('Content-Type') || '';
        const tamanho = resposta.headers.get('Content-Length');
        bytes = tamanho ? parseInt(tamanho, 10) : null;
      } catch (e) {
        log(`${numeroProcesso}: não foi possível checar cabeçalhos de "${c.rotulo}" antes de baixar (${e.message}).`, 'aviso');
      }

      const pareceHtml = tipo && /text\/html/i.test(tipo);
      const pequenoDemais = bytes !== null && bytes < CONFIG.mediaMinBytes;

      if (!confiavel && (pareceHtml || pequenoDemais)) {
        log(`${numeroProcesso}: evento "${c.rotulo}" tem sinais de vídeo/áudio falso (tipo=${tipo || '?'}, ${bytes ?? '?'} bytes) — NÃO baixado. Confira manualmente (caso real já visto no Manual: "VIDEO1" era HTML de poucos KB).`, 'aviso');
        continue;
      }

      const nomeFinal = nomeSugerido && CONFIG.mediaFilenamePattern.test(nomeSugerido)
        ? `${prefixo}__${nomeSugerido}`
        : `${prefixo}__${nomeSeguro(c.rotulo)}`;
      await baixarComoArquivo(c.href, nomeFinal);
      log(`${numeroProcesso}: mídia "${c.rotulo}" baixada como ${nomeFinal} (${bytes !== null ? `${bytes} bytes` : 'tamanho desconhecido'}, ${tipo || 'tipo desconhecido'}).`);
    }
  }

  // ======================================================================
  // Passo: inquérito policial referenciado (ver docs/DECISOES.md, ponto 5)
  // Atenção: as janelas de download de IP e de autos principais têm o
  // MESMO formato no eproc. Toda função abaixo recebe o número do
  // processo/IP explicitamente — nunca lê de estado implícito de página —
  // exatamente para não misturar o download de um com o do outro.
  // ======================================================================
  function encontrarIPsReferenciados() {
    const caixaAzul = document.querySelector('[class*="processoRelacionado" i], [class*="processosRelacionados" i]')
      || document; // fallback: procura na página inteira, mais lento mas não quebra
    const linhas = findAllByText('*', CONFIG.labels.inqueritoPolicial, { root: caixaAzul });
    // Extrai números de processo próximos ao rótulo "INQUÉRITO POLICIAL".
    const numeroProcessoRegex = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;
    const ips = [];
    for (const el of linhas) {
      const contexto = el.closest('tr, li, div') || el;
      const texto = contexto.textContent || '';
      const m = texto.match(numeroProcessoRegex);
      if (m && !ips.includes(m[0])) ips.push(m[0]);
    }
    return ips;
  }

  // ======================================================================
  // Estimativa do limite de 50 fontes do NotebookLM (docs/DECISOES.md, ponto 8)
  // Não bloqueia sozinho — só estima e devolve para quem chama decidir.
  // ======================================================================
  function estimarTotalFontes({ partesAutos, partesIP = 0, midias = 0 }) {
    // denúncia (1) + partes dos autos + partes do IP + mídias não convertidas.
    return 1 + partesAutos + partesIP + midias;
  }

  // ======================================================================
  // UI — painel flutuante simples: importar CSV, iniciar/pausar, log.
  // ======================================================================
  GM_addStyle(`
    #eproc-dl-painel { position: fixed; top: 12px; right: 12px; z-index: 999999;
      width: 340px; max-height: 80vh; overflow-y: auto; background: #fff;
      border: 1px solid #999; border-radius: 6px; padding: 10px; font: 12px/1.4 sans-serif;
      box-shadow: 0 2px 8px rgba(0,0,0,.3); color: #111; }
    #eproc-dl-painel .cabecalho { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    #eproc-dl-painel h3 { margin: 0; font-size: 13px; }
    #eproc-dl-fechar { border: none; background: none; font-size: 16px; line-height: 1; cursor: pointer; padding: 0 4px; }
    #eproc-dl-painel button { margin: 2px 4px 2px 0; padding: 4px 8px; cursor: pointer; }
    #eproc-dl-painel .opcoes { margin: 6px 0; padding: 5px; background: #f7f7f7; border: 1px solid #e2e2e2; border-radius: 4px; }
    #eproc-dl-painel .opcoes label { display: inline-block; margin-right: 8px; white-space: nowrap; cursor: pointer; }
    #eproc-dl-painel .opcoes input { vertical-align: -1px; margin-right: 2px; }
    #eproc-dl-autos-agora { font-weight: bold; }
    #eproc-dl-painel .log { background: #f4f4f4; border: 1px solid #ddd; padding: 4px;
      max-height: 220px; overflow-y: auto; white-space: pre-wrap; font-family: monospace; font-size: 11px; }
    #eproc-dl-painel .aviso { color: #a15c00; }
    #eproc-dl-painel .erro { color: #b00020; }
    #eproc-dl-reabrir { position: fixed; top: 12px; right: 12px; z-index: 999999;
      padding: 6px 10px; cursor: pointer; border: 1px solid #999; border-radius: 6px;
      background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.3); font: 12px sans-serif; }
  `);

  const PAINEL_FECHADO_KEY = 'eprocDownloaderPainelFechado_v1';

  function criarPainel() {
    if (document.getElementById('eproc-dl-painel') || document.getElementById('eproc-dl-reabrir')) return;
    if (GM_getValue(PAINEL_FECHADO_KEY, false)) {
      criarBotaoReabrir();
      return;
    }
    const painel = document.createElement('div');
    painel.id = 'eproc-dl-painel';
    painel.innerHTML = `
      <div class="cabecalho">
        <h3>Downloader de autos do eproc</h3>
        <button id="eproc-dl-fechar" title="Fechar painel (o processamento continua rodando; reabre pelo botão que aparece no canto)">×</button>
      </div>
      <div>
        <input type="file" id="eproc-dl-csv" accept=".csv" />
      </div>
      <div>
        <button id="eproc-dl-iniciar">Iniciar</button>
        <button id="eproc-dl-parar">Parar</button>
        <button id="eproc-dl-limpar-log">Limpar log</button>
        <button id="eproc-dl-exportar-log">Exportar log</button>
        <button id="eproc-dl-manifesto" title="Baixa o manifesto (.json) com o processo/IP de cada arquivo baixado — use com organizar_autos.py --manifesto">Manifesto</button>
        <button id="eproc-dl-diagnostico" title="Gera um relatório da estrutura da tabela de eventos desta página (.txt) para investigar seletores que não bateram">Diagnóstico</button>
      </div>
      <div class="opcoes">
        <strong>Baixar:</strong>
        <label><input type="checkbox" id="eproc-dl-opt-autos"> autos completos</label>
        <label><input type="checkbox" id="eproc-dl-opt-denuncia"> denúncia</label>
        <label><input type="checkbox" id="eproc-dl-opt-midia"> mídia</label>
        <label><input type="checkbox" id="eproc-dl-opt-ips"> IPs referenciados</label>
      </div>
      <div>
        <button id="eproc-dl-autos-agora" title="Roda o Download Completo no processo já aberto nesta página, sem depender da fila/CSV">Baixar autos desta página</button>
      </div>
      <div id="eproc-dl-status"></div>
      <div class="log" id="eproc-dl-log"></div>
    `;
    document.body.appendChild(painel);

    document.getElementById('eproc-dl-csv').addEventListener('change', onCsvSelecionado);
    document.getElementById('eproc-dl-iniciar').addEventListener('click', iniciarProcessamento);
    document.getElementById('eproc-dl-parar').addEventListener('click', pararProcessamento);
    document.getElementById('eproc-dl-limpar-log').addEventListener('click', () => {
      clearLog();
      renderLog();
    });
    document.getElementById('eproc-dl-exportar-log').addEventListener('click', exportarLog);
    document.getElementById('eproc-dl-manifesto').addEventListener('click', exportarManifesto);
    document.getElementById('eproc-dl-autos-agora').addEventListener('click', () => {
      baixarAutosDaPaginaAtual().catch((e) => log(`Falha ao baixar autos desta página: ${e && e.message ? e.message : e}`, 'erro'));
    });

    // Opções de o que baixar, persistidas (sobrevivem à navegação como o resto).
    for (const [chave, id] of [['autos', 'eproc-dl-opt-autos'], ['denuncia', 'eproc-dl-opt-denuncia'], ['midia', 'eproc-dl-opt-midia'], ['ips', 'eproc-dl-opt-ips']]) {
      const input = document.getElementById(id);
      input.checked = loadOpcoes()[chave];
      input.addEventListener('change', () => {
        const opcoes = loadOpcoes();
        opcoes[chave] = input.checked;
        saveOpcoes(opcoes);
        log(`Opção "${chave}" ${input.checked ? 'ligada' : 'desligada'}.`);
      });
    }

    document.getElementById('eproc-dl-diagnostico').addEventListener('click', () => {
      log('Rodando diagnóstico da tabela de eventos (isso carrega todas as páginas de eventos e pode demorar)...');
      diagnosticoTabelaEventos().catch((e) => log(`Diagnóstico falhou: ${e && e.message ? e.message : e}`, 'erro'));
    });
    document.getElementById('eproc-dl-fechar').addEventListener('click', () => {
      GM_setValue(PAINEL_FECHADO_KEY, true);
      painel.remove();
      criarBotaoReabrir();
    });

    renderLog();
    renderStatus();
  }

  // Painel fechado não interrompe o processamento (avancarFila roda independente
  // de UI) — só some da tela. Este botão fica sozinho, sem o resto do painel,
  // pra sempre dar um jeito visível de voltar a abrir.
  function criarBotaoReabrir() {
    if (document.getElementById('eproc-dl-reabrir')) return;
    const botao = document.createElement('button');
    botao.id = 'eproc-dl-reabrir';
    botao.textContent = 'eproc ▤';
    botao.title = 'Reabrir painel do downloader de autos';
    botao.addEventListener('click', () => {
      GM_setValue(PAINEL_FECHADO_KEY, false);
      botao.remove();
      criarPainel();
    });
    document.body.appendChild(botao);
  }

  // ======================================================================
  // Diagnóstico da tabela de eventos — botão "Diagnóstico" do painel.
  //
  // POR QUE ISSO EXISTE: nas três primeiras rodadas de teste o script dizia
  // só "Evento 1 não pôde ser localizado", sem dizer se o problema era a
  // paginação, o seletor da tabela ou o seletor dos links. Descobrir isso
  // navegando o site com um agente de navegador é caro e exige a sessão
  // autenticada do usuário; este botão gera, de graça e num clique, um
  // relatório de texto com a estrutura REAL da tabela — que é tudo o que
  // falta para acertar os seletores de CONFIG.
  //
  // O relatório é: mostrado no console, copiado para a área de transferência
  // e baixado como .txt. Não contém conteúdo de documento — só estrutura
  // (ids, classes, atributos) e o HTML das linhas mais antigas, que pode
  // conter a descrição dos eventos: confira antes de compartilhar.
  // ======================================================================
  async function diagnosticoTabelaEventos() {
    const linhas = [];
    const add = (t) => linhas.push(t);
    const corta = (t, n) => (t.length > n ? `${t.slice(0, n)}\n[...cortado, ${t.length} caracteres no total...]` : t);

    add('=== DIAGNÓSTICO DA TABELA DE EVENTOS — eproc-downloader ===');
    add(`Data: ${new Date().toISOString()}`);
    add(`URL: ${location.href}`);
    add(`CONFIG.tabelaEventosSelector: ${CONFIG.tabelaEventosSelector}`);
    add(`CONFIG.documentoLinkSelectors: ${CONFIG.documentoLinkSelectors.join(' , ')}`);
    add('');

    let tabela = tabelaEventos();
    if (!tabela) {
      add(`>>> A tabela ${CONFIG.tabelaEventosSelector} NÃO EXISTE nesta página.`);
      add('Tabelas presentes (id / classe / nº de linhas), maiores primeiro:');
      const tabelas = Array.from(document.querySelectorAll('table'))
        .map((t) => ({ t, n: t.querySelectorAll('tr').length }))
        .sort((a, b) => b.n - a.n)
        .slice(0, 15);
      for (const { t, n } of tabelas) {
        add(`  - id="${t.id}" class="${t.className}" linhas=${n}`);
      }
      add('');
      add('Se uma dessas é a tabela de eventos, ajuste CONFIG.tabelaEventosSelector.');
      return finalizarDiagnostico(linhas);
    }

    add(`Tabela encontrada: id="${tabela.id}" class="${tabela.className}"`);
    add(`Link "próxima página" presente agora? ${document.querySelector('a[href*="carregarProximaPagina"]') ? 'SIM' : 'não'}`);
    const temFuncaoGlobal = typeof unsafeWindow !== 'undefined' && typeof unsafeWindow.carregarProximaPagina === 'function';
    add(`unsafeWindow.carregarProximaPagina é função? ${temFuncaoGlobal ? 'SIM' : 'NÃO (o script vai cair no clique no link)'}`);
    add('');

    const antesDePaginar = linhasDeEvento(tabela).length;
    add(`Linhas tr[id^="trEvento"] ANTES de paginar: ${antesDePaginar}`);
    add('Carregando todas as páginas de eventos...');
    await carregarTodosOsEventos();
    tabela = tabelaEventos();
    const trs = linhasDeEvento(tabela);
    add(`Linhas tr[id^="trEvento"] DEPOIS de paginar: ${trs.length}`);
    add(`Total de <tr> na tabela (qualquer id): ${tabela.querySelectorAll('tr').length}`);
    if (trs.length === 0) {
      add('>>> NENHUMA linha casou com tr[id^="trEvento"]. Amostra dos ids das 10 primeiras <tr> da tabela:');
      for (const tr of Array.from(tabela.querySelectorAll('tr')).slice(0, 10)) {
        add(`  - id="${tr.id}" class="${tr.className}" | ${(tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`);
      }
      return finalizarDiagnostico(linhas);
    }

    const eventos = lerEventos();
    const numeros = eventos.map((e) => Number(e.numeroEvento)).filter((n) => Number.isFinite(n));
    const menor = Math.min(...numeros);
    const maior = Math.max(...numeros);
    add(`Números de evento lidos: ${numeros.length} (do ${menor} ao ${maior})`);
    add(`Evento 1 está na lista lida? ${eventos.some((e) => e.numeroEvento === '1') ? 'SIM' : 'NÃO'}`);
    add(`document.getElementById('trEvento1') existe? ${document.getElementById('trEvento1') ? 'SIM' : 'NÃO'}`);
    const faltando = [];
    for (let n = menor; n <= maior && faltando.length < 30; n++) {
      if (!numeros.includes(n)) faltando.push(n);
    }
    add(`Números ausentes no intervalo (até 30): ${faltando.length ? faltando.join(', ') : 'nenhum'}`);
    add('');

    const semDocumento = eventos.filter((e) => e.documentos.length === 0);
    add(`Eventos SEM nenhum link de documento reconhecido: ${semDocumento.length} de ${eventos.length}`);
    add('  (normal: eventos como "Conclusos para decisão/despacho" não têm documento)');
    const todosDocs = eventos.flatMap((e) => e.documentos);
    add(`Total de documentos lidos: ${todosDocs.length}`);
    add(`Documentos SIGILOSOS (class="infraLinkDocumentoSigiloso"): ${todosDocs.filter((d) => d.sigiloso).length}`);
    add(`Documentos com href relativo (não deveria haver nenhum): ${todosDocs.filter((d) => !/^https?:/i.test(d.href)).length}`);
    add('');

    add('Classes dos <a> dentro da tabela (histograma, top 20) — é aqui que se');
    add('descobre se "a.infraLinkDocumento" ainda é o seletor certo:');
    const histClasse = new Map();
    for (const a of tabela.querySelectorAll('a')) {
      const chave = a.className || '(sem class)';
      histClasse.set(chave, (histClasse.get(chave) || 0) + 1);
    }
    for (const [classe, n] of Array.from(histClasse).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      add(`  ${String(n).padStart(5)}x  class="${classe}"`);
    }
    add('');

    add('Atributos data-* dos <a> dentro da tabela (histograma, top 20):');
    const histAttr = new Map();
    for (const a of tabela.querySelectorAll('a')) {
      for (const attr of a.attributes) {
        if (!attr.name.startsWith('data-')) continue;
        histAttr.set(attr.name, (histAttr.get(attr.name) || 0) + 1);
      }
    }
    for (const [attr, n] of Array.from(histAttr).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      add(`  ${String(n).padStart(5)}x  ${attr}`);
    }
    add('');

    const resultado1 = localizarEvento1(eventos);
    add(`localizarEvento1(): ${resultado1.documento
      ? `ACHOU — evento ${resultado1.documento.numeroEvento}, rótulo "${resultado1.documento.rotulo}", href "${resultado1.documento.href}"`
      : `NÃO ACHOU — ${resultado1.motivo}`}`);
    add('');

    add('--- HTML das 3 linhas de evento mais antigas (é o que falta para');
    add('--- acertar os seletores; o Evento 1 deve estar entre elas) ---');
    for (const evento of eventos.slice(0, 3)) {
      add('');
      add(`### Evento ${evento.numeroEvento} — ${evento.documentos.length} documento(s) reconhecido(s), ${evento.tr.querySelectorAll('a').length} link(s) no total`);
      add(`Descrição: ${evento.descricao}`);
      add(corta(evento.tr.outerHTML, 6000));
    }

    return finalizarDiagnostico(linhas);
  }

  function finalizarDiagnostico(linhas, prefixoNome = 'eproc-diagnostico-eventos') {
    const texto = `${linhas.join('\n')}\n`;
    console.log('[eproc-downloader] DIAGNÓSTICO:\n' + texto);
    const nome = `${prefixoNome}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    baixarTexto(nome, texto);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).catch(() => {});
    }
    log(`Diagnóstico gerado: ${nome} (também copiado para a área de transferência e impresso no console). Anexe esse arquivo na conversa.`);
    return texto;
  }

  // Download de texto gerado pelo próprio script (log, diagnóstico). Fica com
  // blob+clique e não com GM_download de propósito: é sempre um clique único
  // e manual do usuário, fora do lote de downloads que o Chrome bloqueia.
  function baixarTexto(nomeArquivo, texto) {
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function exportarLog() {
    const entradas = getLog();
    if (entradas.length === 0) {
      log('Nada para exportar — log vazio.', 'aviso');
      return;
    }
    const texto = entradas.map((e) => `[${e.ts}] [${e.nivel}] ${e.mensagem}`).join('\n') + '\n';
    baixarTexto(`eproc-downloader-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, texto);
  }

  function renderLog() {
    const el = document.getElementById('eproc-dl-log');
    if (!el) return;
    const entradas = getLog();
    el.innerHTML = entradas
      .slice(-200)
      .map((e) => `<div class="${e.nivel}">[${e.ts.slice(11, 19)}] ${escapeHtml(e.mensagem)}</div>`)
      .join('');
    el.scrollTop = el.scrollHeight;
  }
  function renderStatus() {
    const el = document.getElementById('eproc-dl-status');
    if (!el) return;
    const state = loadState();
    if (!state) {
      el.textContent = 'Nenhuma fila carregada. Importe um CSV.';
      return;
    }
    const total = state.fila.length;
    const concluidos = state.fila.filter((p) => p.status === 'concluido').length;
    const erros = state.fila.filter((p) => p.status === 'erro').length;
    el.textContent = `Fila: ${total} | concluídos: ${concluidos} | erros/pendências: ${erros} | fase: ${state.fase}`;
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ======================================================================
  // Parser de CSV mínimo — assume que uma das colunas traz o número do
  // processo no formato CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) e detecta a
  // coluna automaticamente pela primeira linha de dados. Não tenta ser
  // um parser de CSV genérico (sem células com vírgula/quebra de linha
  // internas) — a planilha de controle não tem esse tipo de conteúdo.
  // ======================================================================
  const NUMERO_PROCESSO_REGEX = /^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/;

  function parseCsvProcessos(texto) {
    const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (linhas.length === 0) return [];
    const linhasCampos = linhas.map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));

    const numColunas = linhasCampos[0].length;
    let colunaEscolhida = -1;
    for (let col = 0; col < numColunas; col++) {
      const acertos = linhasCampos.filter((campos) => NUMERO_PROCESSO_REGEX.test(campos[col] || '')).length;
      if (acertos > 0 && (colunaEscolhida === -1 || acertos > 0)) {
        colunaEscolhida = col;
        break;
      }
    }
    if (colunaEscolhida === -1) return [];

    const processos = linhasFieldsUnicos(
      linhasCampos.map((c) => c[colunaEscolhida]).filter((v) => NUMERO_PROCESSO_REGEX.test(v || ''))
    );
    return processos;
  }
  function linhasFieldsUnicos(arr) {
    return Array.from(new Set(arr));
  }

  function onCsvSelecionado(ev) {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      const processos = parseCsvProcessos(String(leitor.result));
      if (processos.length === 0) {
        log('Nenhum número de processo (formato NNNNNNN-DD.AAAA.J.TR.OOOO) encontrado no CSV importado.', 'erro');
        return;
      }
      saveState(newState(processos));
      log(`CSV importado: ${processos.length} processo(s) na fila.`);
      renderStatus();
    };
    leitor.readAsText(arquivo, 'utf-8');
  }

  function pararProcessamento() {
    const state = loadState();
    if (state) {
      state.pausado = true;
      saveState(state);
    }
    log('Processamento pausado pelo usuário. Clique em Iniciar para retomar de onde parou.');
  }

  function iniciarProcessamento() {
    const state = loadState();
    if (!state) {
      log('Importe um CSV antes de iniciar.', 'erro');
      return;
    }
    state.pausado = false;
    saveState(state);
    log('Processamento iniciado/retomado.');
    avancarFila().catch((e) => log(`Erro inesperado ao avançar a fila: ${e.message}`, 'erro'));
  }

  // Dispara a busca por um número (processo principal ou IP referenciado,
  // ver docs/DECISOES.md ponto 2) na caixa de topo já localizada.
  function dispararBusca(caixaBusca, numero) {
    caixaBusca.value = numero;
    caixaBusca.dispatchEvent(new Event('input', { bubbles: true }));
    caixaBusca.form?.requestSubmit ? caixaBusca.form.requestSubmit() : caixaBusca.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
  }

  // ======================================================================
  // Sub-máquina do "Download Completo".
  //
  // POR QUE É UMA MÁQUINA DE ESTADOS E NÃO UMA FUNÇÃO COM AWAIT:
  // não se sabe (ainda não testado contra a tela real) se "Download Completo"
  // abre um modal na mesma página ou NAVEGA para outra tela. Se navegar,
  // qualquer `await` depois do clique nunca retorna — foi exatamente essa
  // armadilha que já derrubou o fluxo da busca em 03/09/2026. Escrever como
  // sub-fases persistidas funciona nos DOIS casos: o passo é salvo em
  // `state.autos.sub` ANTES do clique, e retomado do zero na carga seguinte
  // se houve navegação, ou seguido inline se não houve.
  //
  // Devolve:
  //   'continuar' — etapa dos autos terminou, o chamador segue o fluxo
  //   'navegou'   — a página vai recarregar; avancarFila() deve retornar
  // ======================================================================
  async function avancarAutos(state) {
    const autos = state.autos;
    const { numeroProcesso, ip, prefixo } = autos.contexto;
    const rotuloAlvo = ip ? `${numeroProcesso} (IP ${ip})` : numeroProcesso;

    if (autos.sub === 'abrir') {
      const botao = acharControle(CONFIG.labels.downloadCompleto);
      if (!botao) {
        log(`${rotuloAlvo}: botão "${CONFIG.labels.downloadCompleto}" não encontrado nesta tela. Gerando diagnóstico e pulando os autos deste item.`, 'erro');
        diagnosticoTela(`botão "${CONFIG.labels.downloadCompleto}" não encontrado (${rotuloAlvo})`);
        return 'continuar';
      }
      autos.sub = 'opcoes';
      saveState(state); // ANTES do clique: se navegar, a fase já está salva
      log(`${rotuloAlvo}: abrindo "${CONFIG.labels.downloadCompleto}".`);
      botao.click();
      // Se for modal (mesma página), a tela de opções aparece aqui e seguimos
      // inline. Se navegar, esta espera morre junto com a página e a próxima
      // carga retoma em 'opcoes'.
      const apareceu = await aguardarControle(CONFIG.labels.gerarArquivoCompleto, {
        timeoutMs: CONFIG.downloadCompleto.timeoutTelaMs,
      });
      return apareceu ? 'continuar' : 'navegou';
    }

    if (autos.sub === 'opcoes') {
      const gerar = await aguardarControle(CONFIG.labels.gerarArquivoCompleto, {
        timeoutMs: CONFIG.downloadCompleto.timeoutTelaMs,
      });
      if (!gerar) {
        log(`${rotuloAlvo}: a tela de opções do Download Completo não apareceu (botão "${CONFIG.labels.gerarArquivoCompleto}" não encontrado). Gerando diagnóstico e pulando os autos deste item.`, 'erro');
        diagnosticoTela(`tela de opções não apareceu (${rotuloAlvo})`);
        return 'continuar';
      }
      configurarOpcoesDownloadCompleto(rotuloAlvo);
      autos.sub = 'gerando';
      autos.tentativas = 0;
      saveState(state);
      log(`${rotuloAlvo}: clicando em "${CONFIG.labels.gerarArquivoCompleto}" — isso pode levar vários minutos.`);
      gerar.click();
      const pronto = await aguardarTextoNaPagina(CONFIG.labels.geradoComSucesso, { timeoutMs: 60000 });
      return pronto ? 'continuar' : 'navegou';
    }

    if (autos.sub === 'gerando') {
      // Espera longa e com log de progresso: o eproc pode levar ~10 min num
      // processo grande, e uma espera silenciosa parece travamento.
      for (let i = autos.tentativas || 0; i < CONFIG.pollDownloadCompletoMaxTentativas; i++) {
        if (temTextoNaPagina(CONFIG.labels.geradoComSucesso) || acharControle(CONFIG.labels.baixarArquivo)) {
          autos.sub = 'baixando';
          saveState(state);
          log(`${rotuloAlvo}: arquivo completo gerado.`);
          return 'continuar';
        }
        autos.tentativas = i + 1;
        saveState(state);
        const minutos = Math.round(((i + 1) * CONFIG.pollDownloadCompletoMs) / 60000);
        if ((i + 1) % 4 === 0) {
          log(`${rotuloAlvo}: ainda gerando o arquivo completo (~${minutos} min). Mantenha esta aba em primeiro plano.`);
        }
        await sleep(CONFIG.pollDownloadCompletoMs);
      }
      log(`${rotuloAlvo}: o arquivo completo não ficou pronto dentro do limite (~${Math.round((CONFIG.pollDownloadCompletoMaxTentativas * CONFIG.pollDownloadCompletoMs) / 60000)} min). Gerando diagnóstico e seguindo — baixe este processo manualmente.`, 'erro');
      diagnosticoTela(`arquivo completo não ficou pronto no limite (${rotuloAlvo})`);
      return 'continuar';
    }

    if (autos.sub === 'baixando') {
      const resultado = await baixarPartesDosAutos(prefixo, { numeroProcesso, ip });
      if (resultado.baixadas > 0) {
        log(`${rotuloAlvo}: ${resultado.baixadas} parte(s) dos autos baixada(s)${resultado.viaClique ? ` (${resultado.viaClique} por clique — nome dado pelo eproc, ver manifesto)` : ''}.`);
      }
      const voltar = acharControle(CONFIG.labels.voltar);
      if (voltar) {
        saveState(state);
        voltar.click();
        await sleep(2000);
      }
      return 'continuar';
    }

    log(`${rotuloAlvo}: sub-fase de autos desconhecida ("${autos.sub}") — pulando os autos deste item.`, 'erro');
    return 'continuar';
  }

  function temTextoNaPagina(texto) {
    return (document.body.innerText || '').toLowerCase().includes(texto.toLowerCase());
  }

  async function aguardarTextoNaPagina(texto, { timeoutMs = 30000, intervaloMs = 500 } = {}) {
    const inicio = Date.now();
    while (Date.now() - inicio < timeoutMs) {
      if (temTextoNaPagina(texto)) return true;
      await sleep(intervaloMs);
    }
    return false;
  }

  // Prepara o state para entrar na etapa de autos e devolve para onde voltar
  // quando ela terminar.
  function entrarEmAutos(state, { numeroProcesso, ip = null, voltarPara }) {
    state.autos = {
      sub: 'abrir',
      tentativas: 0,
      voltarPara,
      contexto: {
        numeroProcesso,
        ip,
        prefixo: ip
          ? `${nomeSeguro(numeroProcesso)}__IP_${nomeSeguro(ip)}`
          : nomeSeguro(numeroProcesso),
      },
    };
    state.fase = 'autos';
    saveState(state);
  }

  // ======================================================================
  // Botão "Baixar autos desta página": roda o Download Completo no processo
  // que já está aberto, sem CSV e sem fila.
  //
  // É o plano B deliberado para um dia de trabalho: se a automação da fila
  // esbarrar em qualquer coisa não prevista, dá para abrir o processo à mão e
  // clicar aqui — perde-se a automação da lista, não o dia. Reaproveita a
  // mesma sub-máquina, com uma fila de um item só.
  // ======================================================================
  async function baixarAutosDaPaginaAtual() {
    const numeroProcesso = numeroDoProcessoDaPagina();
    if (!numeroProcesso) {
      log('Não consegui identificar o número do processo desta página — abra um processo antes de usar este botão. Gerando diagnóstico de tela.', 'erro');
      diagnosticoTela('número do processo não identificado na página atual');
      return;
    }
    const state = loadState() || newState([]);
    if (!state.fila.find((p) => p.numero === numeroProcesso)) {
      state.fila.push({ numero: numeroProcesso, status: 'em_andamento', ip: [], observacao: '' });
    }
    state.pausado = false;
    state.processoAtual = numeroProcesso;
    entrarEmAutos(state, { numeroProcesso, voltarPara: 'apos_autos_avulso' });
    log(`${numeroProcesso}: baixando autos desta página (modo avulso, fora da fila).`);
    await avancarFila();
  }

  // Número do processo a partir da própria página. Tenta a URL primeiro
  // (num_processo=... vem sem pontuação) e cai para o texto da página.
  function numeroDoProcessoDaPagina() {
    const daPagina = (document.body.innerText || '').match(
      /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/
    );
    if (daPagina) return daPagina[0];
    const daUrl = location.href.match(/num_processo=(\d{20})/);
    if (daUrl) {
      const d = daUrl[1];
      return `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d.slice(13, 14)}.${d.slice(14, 16)}.${d.slice(16, 20)}`;
    }
    return null;
  }

  let processando = false; // trava só dentro de UMA carga de página — impede reentrância

  // ======================================================================
  // Máquina de estados da fila. CONFIRMADO em teste real (03/09/2026): a
  // busca por número navega a página inteira (a tela recarrega), então não
  // dá pra escrever isto como "uma função só com await no meio" — qualquer
  // `await` depois de dispararBusca() nunca retornaria, porque a página que
  // o executava já não existe mais. Em vez disso, `avancarFila()` é chamada
  // do zero a cada carregamento (ver rodapé do arquivo) e decide o que fazer
  // só a partir do que está salvo em `state` (GM_setValue sobrevive à
  // navegação; variáveis JS não). Cada ramo ou:
  //   (a) termina a etapa e faz `continue` para a próxima, sem navegar; ou
  //   (b) chama dispararBusca() e faz `return` — o resto acontece na
  //       próxima carga de página, quando avancarFila() rodar de novo.
  // ======================================================================
  async function avancarFila() {
    if (processando) return;
    processando = true;
    try {
      while (true) {
        const state = loadState();
        if (!state || state.pausado) return;

        if (state.fase === 'autos') {
          const resultado = await avancarAutos(state);
          if (resultado === 'navegou') return;
          const voltarPara = state.autos.voltarPara;
          state.autos = null;
          state.fase = voltarPara;
          saveState(state);
          continue;
        }

        if (state.fase === 'apos_autos_avulso') {
          // Modo avulso (botão "Baixar autos desta página"): terminou o item,
          // não puxa o próximo da fila — quem clicou quer só este processo.
          const item = state.fila.find((p) => p.numero === state.processoAtual);
          if (item) item.status = 'concluido';
          state.fase = 'ocioso';
          state.pausado = true; // não retoma a fila sozinho na próxima carga
          saveState(state);
          log(`${state.processoAtual}: autos desta página processados. (Modo avulso — a fila segue pausada; clique "Iniciar" para rodar a fila do CSV.)`);
          return;
        }

        if (state.fase === 'ocioso') {
          const item = state.fila.find((p) => p.status === 'pendente' || p.status === 'em_andamento');
          if (!item) {
            log('Fila concluída — nenhum processo pendente.');
            return;
          }
          item.status = 'em_andamento';
          state.processoAtual = item.numero;
          state.fase = 'aguardando_busca_principal';
          saveState(state);
          renderStatus();

          const caixaBusca = findSearchBox();
          if (!caixaBusca) {
            item.status = 'erro';
            item.observacao = 'Caixa de pesquisa não encontrada.';
            state.fase = 'ocioso';
            saveState(state);
            log(`${item.numero}: caixa de pesquisa não encontrada — ajuste CONFIG.searchBoxSelectors.`, 'erro');
            continue;
          }
          log(`${item.numero}: iniciando — buscando.`);
          dispararBusca(caixaBusca, item.numero);
          return;
        }

        if (state.fase === 'aguardando_busca_principal') {
          const numeroProcesso = state.processoAtual;
          const item = state.fila.find((p) => p.numero === numeroProcesso);
          const tabela = await aguardarElemento('#tblEventos', { timeoutMs: 20000 });
          if (!tabela) {
            item.status = 'erro';
            item.observacao = 'Tabela de eventos não apareceu após a busca.';
            state.fase = 'ocioso';
            saveState(state);
            log(`${numeroProcesso}: tabela de eventos (#tblEventos) não apareceu a tempo depois da busca — confira o número ou CONFIG.searchBoxSelectors.`, 'erro');
            continue;
          }

          await carregarTodosOsEventos();
          const eventos = lerEventos();
          const linhasEventos = lerLinhasEventos(eventos);
          if (linhasEventos.length === 0) {
            log(`${numeroProcesso}: tabela de eventos encontrada, mas nenhum documento foi lido (${eventos.length} linha(s) de evento). Clique em "Diagnóstico" no painel e mande o arquivo gerado — ele diz qual seletor deixou de bater.`, 'aviso');
          }

          const ips = encontrarIPsReferenciados();
          item.ip = ips;
          if (ips.length > 0) {
            log(`${numeroProcesso}: ${ips.length} inquérito(s) policial(is) referenciado(s): ${ips.join(', ')}.`);
          }

          const opcoes = loadOpcoes();
          if (opcoes.denuncia) await tratarDenuncia(numeroProcesso, linhasEventos, eventos);
          if (opcoes.midia) await tratarMidia(numeroProcesso, linhasEventos);

          // Autos completos ANTES de sair para o IP: a tela de Download
          // Completo é do processo aberto agora, e buscar o IP navega para
          // longe dela.
          if (opcoes.autos) {
            entrarEmAutos(state, { numeroProcesso, voltarPara: 'apos_autos_principal' });
            continue;
          }
          state.fase = 'apos_autos_principal';
          saveState(state);
          continue;
        }

        if (state.fase === 'apos_autos_principal') {
          const numeroProcesso = state.processoAtual;
          const item = state.fila.find((p) => p.numero === numeroProcesso);
          const ips = item.ip || [];
          const opcoes = loadOpcoes();

          // Decisão do Ponto 2 (03/09/2026): rebuscar o número do IP na mesma
          // caixa de busca, em vez de clicar no link da caixa azul — evita a
          // dúvida sobre abrir em nova aba. Ainda não confirmado: se a busca
          // do topo aceita números de inquérito policial (só processo
          // "principal" foi testado).
          if (ips.length > 0 && opcoes.ips) {
            state.ipIndiceAtual = 0;
            state.fase = 'aguardando_busca_ip';
            saveState(state);
            const caixaBusca = findSearchBox();
            if (!caixaBusca) {
              log(`${numeroProcesso}: caixa de busca não encontrada para rebuscar o IP ${ips[0]} — pulando IP(s) deste processo.`, 'erro');
              item.status = 'concluido';
              state.fase = 'ocioso';
              saveState(state);
              continue;
            }
            log(`${numeroProcesso}: buscando IP referenciado ${ips[0]}.`);
            dispararBusca(caixaBusca, ips[0]);
            return;
          }

          item.status = 'concluido';
          state.fase = 'ocioso';
          saveState(state);
          log(`${numeroProcesso}: concluído.`);
          continue;
        }

        if (state.fase === 'aguardando_busca_ip') {
          const numeroProcesso = state.processoAtual;
          const item = state.fila.find((p) => p.numero === numeroProcesso);
          const ip = item.ip[state.ipIndiceAtual];
          const tabela = await aguardarElemento('#tblEventos', { timeoutMs: 20000 });
          if (!tabela) {
            log(`${numeroProcesso}: IP ${ip} não abriu tabela de eventos ao rebuscar pelo número — pulado, revisar manualmente (ver Ponto 2 da decisão de 03/09/2026).`, 'erro');
          } else {
            const opcoes = loadOpcoes();
            await carregarTodosOsEventos();
            if (opcoes.midia) {
              const linhasIp = lerLinhasEventos();
              await tratarMidia(numeroProcesso, linhasIp, { prefixoExtra: `IP_${nomeSeguro(ip)}` });
            }
            // Autos do IP, com o número do PROCESSO PAI no nome — é o que
            // permite saber, olhando a pasta de downloads, de que processo
            // aquele inquérito veio: "<processo>__IP_<numeroIP>__AUTOS_PARTE_N.pdf".
            if (opcoes.autos) {
              entrarEmAutos(state, { numeroProcesso, ip, voltarPara: 'apos_autos_ip' });
              continue;
            }
          }

          state.fase = 'apos_autos_ip';
          saveState(state);
          continue;
        }

        if (state.fase === 'apos_autos_ip') {
          const numeroProcesso = state.processoAtual;
          const item = state.fila.find((p) => p.numero === numeroProcesso);
          const proximoIndice = state.ipIndiceAtual + 1;
          if (proximoIndice < item.ip.length) {
            const caixaBusca = findSearchBox();
            if (caixaBusca) {
              state.ipIndiceAtual = proximoIndice;
              saveState(state);
              log(`${numeroProcesso}: buscando IP referenciado ${item.ip[proximoIndice]}.`);
              dispararBusca(caixaBusca, item.ip[proximoIndice]);
              return;
            }
            log(`${numeroProcesso}: caixa de busca não encontrada para rebuscar o próximo IP — encerrando IPs deste processo.`, 'erro');
          }

          item.status = 'concluido';
          state.fase = 'ocioso';
          saveState(state);
          log(`${numeroProcesso}: IP(s) referenciado(s) processado(s).`);
          continue;
        }

        // Fase desconhecida — não deveria acontecer; evita loop infinito.
        log(`Fase de estado desconhecida ("${state.fase}") — processamento interrompido.`, 'erro');
        state.fase = 'ocioso';
        saveState(state);
        return;
      }
    } finally {
      processando = false;
      renderStatus();
    }
  }

  // ======================================================================
  // Gancho de teste: quando globalThis.__EPROC_TESTE__ existe (só em
  // scripts/testar-leitura-eventos.js, nunca no navegador), expõe as funções
  // de leitura da tabela para poderem ser rodadas contra HTML real capturado
  // pelo Diagnóstico. Testar uma cópia das funções não pegaria justamente os
  // erros que já custaram três rodadas — o valor está em rodar ESTE código.
  if (typeof globalThis !== 'undefined' && globalThis.__EPROC_TESTE__) {
    globalThis.__EPROC_TESTE__ = {
      CONFIG, lerEventos, lerLinhasEventos, localizarEvento1,
      documentosDaLinha, documentoDoLink, eventoDaLinha, descricaoDoEvento,
      tabelaEventos, linhasDeEvento, numeroDoEvento,
    };
    return; // não monta painel nem inicia a fila em ambiente de teste
  }

  function iniciar() {
    criarPainel();
    // Retomada automática: se a fila estava em andamento (fase !== 'ocioso')
    // quando a página anterior navegou para cá, continua sozinho. Se o
    // usuário pausou (state.pausado) ou não há fila, não faz nada até
    // clicar em "Iniciar".
    avancarFila().catch((e) => log(`Erro inesperado ao retomar a fila: ${e.message}`, 'erro'));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
