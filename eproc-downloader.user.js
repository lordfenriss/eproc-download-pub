// ==UserScript==
// @name         Dossiês de Audiência — Downloader de Autos do eproc
// @namespace    dossies-audiencia-download
// @version      0.5.1
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
      // LISTAS, não textos únicos: o rótulo completo vem do Manual, mas a
      // tela real pode escrever diferente. Cada entrada é tentada em ordem,
      // da mais específica para a mais curta, com comparação sem acento e sem
      // caixa (ver normalizar()). Só o primeiro que casar é usado, e uma
      // checkbox já usada por outra opção não é reaproveitada.
      checkboxListaEventos: [
        'Adicionar lista com todos os eventos incluídos no download na capa do processo',
        'lista com todos os eventos',
        'lista de eventos',
      ],
      checkboxAnexosEletronicos: [
        'Incluir anexos eletrônicos',
        'anexos eletrônicos',
        'anexos',
      ],
      checkboxSoComDocumentos: [
        'Trazer só eventos com documentos',
        'só eventos com documentos',
        'somente eventos com documentos',
        'eventos com documentos',
      ],
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
      //   null  = NÃO MEXER (usa o que o eproc já traz marcado)
      //   true  = forçar marcada
      //   false = forçar desmarcada
      //
      // DECIDIDO em 08/09/2026 pelo usuário, depois de ver a tela real: o
      // eproc traz as três DESMARCADAS e as três precisam estar MARCADAS.
      // Até a v0.4.0 a política era "não mexer" porque ninguém tinha visto a
      // tela — o download saía sem a lista de eventos e sem os anexos.
      // O log continua registrando como cada uma veio, para se saber se o
      // padrão do eproc mudou.
      checkboxes: {
        listaEventos: true,
        anexosEletronicos: true,
        soComDocumentos: true,
      },
      // Quantas partes no máximo procurar numa tela (trava de segurança).
      maxPartes: 50,
      // Tempo máximo esperando a tela de opções aparecer depois do clique.
      timeoutTelaMs: 30000,
    },
    // ------------------------------------------------------------------
    // Resolução do link de documento (v0.5.0).
    //
    // Achado do teste real (08/09/2026): o href do evento
    // ("controlador.php?acao=acessar_documento&...") NÃO é o arquivo — é uma
    // página intermediária. Dependendo de como o Chrome está configurado para
    // PDF, ela embute o visualizador (iframe/embed apontando para o arquivo
    // de verdade) ou mostra só um botão "Abrir". Passar esse href direto ao
    // GM_download baixa a página (.htm) ou falha com "not_succeeded" — foi
    // exatamente o que aconteceu com o INIC1 do Evento 1.
    // ------------------------------------------------------------------
    documento: {
      // Quantas páginas intermediárias seguir antes de desistir.
      maxNiveis: 3,
      // Ação do controlador que costuma servir o conteúdo em si. Usada só
      // para PRIORIZAR candidatos achados no HTML — nunca para inventar URL.
      acoesDeConteudo: /acessar_documento_implementacao|acao=download|\.pdf(\?|$)/i,
      // Textos de link que, na página intermediária, levam ao arquivo.
      textosDeAbertura: /^(abrir|baixar|download|visualizar|clique aqui)\b/i,
    },
    // ------------------------------------------------------------------
    // Modo multi-aba (v0.5.0) — ver o bloco grande de comentário perto de
    // supervisionar(), no fim do arquivo.
    // ------------------------------------------------------------------
    multiAba: {
      maxAbasSimultaneas: 2,      // padrão; o painel sobrepõe (opcoes.maxAbas)
      atrasoEntreAberturasMs: 800, // respiro entre window.open, para não parecer rajada
      intervaloSupervisaoMs: 4000,
      // Uma aba que não dá sinal de vida por este tempo é considerada travada:
      // o item vira "erro" e a vaga é liberada para o próximo da fila.
      timeoutSemSinalMs: 25 * 60 * 1000,
      // Quanto a aba espera antes de se fechar, para dar tempo de um download
      // pela via alternativa (blob) terminar de ser gravado.
      atrasoParaFecharMs: 15000,
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
      {
        autos: true,
        denuncia: true,
        midia: true,
        ips: true,
        maxAbas: CONFIG.multiAba.maxAbasSimultaneas,
        fecharAba: true,
      },
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
    const state = GM_getValue(STATE_KEY, null);
    if (!state) return null;
    for (const pai of state.fila.filter(p => p.tipo === 'processo')) {
      for (const ip of GM_getValue(chaveRelato(state, pai, 'ips'), [])) {
        if (!state.fila.some(p => p.tipo === 'ip' && p.numero === ip && p.processoPai === pai.numero))
          state.fila.push(itemDeFila(ip, 'ip', pai.numero));
      }
    }
    for (const item of state.fila) {
      const relato = GM_getValue(chaveRelato(state, item), null);
      if (relato) Object.assign(item, relato);
      const sinal = GM_getValue(chaveRelato(state, item, 'vida'), 0);
      item.ultimoSinal = Math.max(item.ultimoSinal || 0, sinal);
    }
    return state;
  }
  function chaveRelato(state, item, tipo = 'resultado') {
    return 'eprocRelato:' + (state.loteId || 'legado') + ':' + JSON.stringify([item.tipo || 'processo', item.numero, item.processoPai || null]) + ':' + tipo;
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
  // cada navegação descarta o contexto JS em execução. `avancarAba()` (perto
  // do fim do arquivo) é chamada de novo, do zero, a cada carregamento de
  // página — e usa só o que está persistido para saber onde retomar.
  //
  // A PARTIR DA v0.5.0 o estado é dividido em dois:
  //
  //   ESTADO GLOBAL (GM_setValue, abaixo) — a FILA: um item por processo e um
  //   por inquérito referenciado, com o status de cada um. É compartilhado por
  //   TODAS as abas: a aba coordenadora lê para saber o que abrir, e cada aba
  //   de trabalho escreve nele o seu resultado.
  //
  //   ESTADO DA ABA (sessionStorage, ver loadTarefa) — "qual é a minha tarefa
  //   e em que passo estou". sessionStorage é POR ABA, que é exatamente o que
  //   torna possível ter nove processos rodando ao mesmo tempo sem um
  //   atropelar o passo do outro. Sobrevive à navegação da busca dentro da
  //   própria aba, que é o motivo de o estado existir desde a v0.2.0.
  function newState(processos) {
    return {
      loteId: crypto.randomUUID(),
      fila: processos.map((numero) => itemDeFila(numero, 'processo', null)),
      pausado: false, // true depois de clicar "Parar" — impede retomada automática na próxima carga
    };
  }

  function itemDeFila(numero, tipo, processoPai) {
    return {
      numero,
      tipo, // 'processo' | 'ip'
      processoPai: processoPai || null, // preenchido só nos itens de IP
      status: 'pendente', // pendente | em_andamento | concluido | erro
      observacao: '',
      ultimoSinal: null, // ms; a aba que está com o item atualiza de tempos em tempos
    };
  }

  function mesmoItem(a, b) {
    return a.numero === b.numero && (a.tipo || 'processo') === (b.tipo || 'processo')
      && (a.processoPai || null) === (b.processoPai || null);
  }
  function acharItem(state, alvo) {
    return state && state.fila ? state.fila.find((p) => mesmoItem(p, alvo)) || null : null;
  }
  function rotuloItem(item) {
    return item.tipo === 'ip' ? `${item.processoPai} (IP ${item.numero})` : item.numero;
  }

  // ----------------------------------------------------------------------
  // Tarefa desta aba — sessionStorage, e não GM_setValue, de propósito:
  // GM_setValue é global (todas as abas veem o mesmo valor) e sessionStorage
  // é por aba. É a única peça que permite N abas trabalhando em paralelo.
  //
  // ATENÇÃO ao clone: o Chrome COPIA o sessionStorage da aba de origem para a
  // aba nova aberta por window.open. Por isso adotarTarefaDaUrl() sempre
  // sobrescreve o que veio clonado, e apaga a marca de coordenadora.
  // ----------------------------------------------------------------------
  const TAREFA_KEY = 'eprocDownloaderTarefaAba_v1';
  const COORDENADORA_KEY = 'eprocDownloaderCoordenadora_v1';

  function loadTarefa() {
    try {
      return JSON.parse(sessionStorage.getItem(TAREFA_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }
  function saveTarefa(tarefa) {
    tarefa.loteId ||= loadState()?.loteId || 'avulso';
    try {
      sessionStorage.setItem(TAREFA_KEY, JSON.stringify(tarefa));
    } catch (e) {
      log(`sessionStorage indisponível nesta aba (${e.message}) — o modo multi-aba não funciona sem ele.`, 'erro');
    }
  }
  function clearTarefa() {
    try {
      sessionStorage.removeItem(TAREFA_KEY);
    } catch (e) { /* nada a fazer */ }
  }
  function rotuloTarefa(tarefa) {
    if (tarefa.tipo === 'ip') return `${tarefa.processoPai} (IP ${tarefa.numero})`;
    return tarefa.numero;
  }
  function ehCoordenadora() {
    try {
      return sessionStorage.getItem(COORDENADORA_KEY) === '1';
    } catch (e) {
      return false;
    }
  }
  function marcarComoCoordenadora() {
    try {
      sessionStorage.setItem(COORDENADORA_KEY, '1');
    } catch (e) { /* nada a fazer */ }
  }

  // Teto do log guardado. Com o modo multi-aba, N abas escrevem no MESMO log
  // (GM_setValue é global) e cada escrita relê e regrava a lista inteira —
  // sem teto, um lote grande vira uma lista de milhares de itens sendo
  // reserializada a cada linha.
  const LOG_MAX = 600;

  function chaveColecao(key) {
    const tarefa = loadTarefa();
    return key + ':' + (loadState()?.loteId || 'avulso') + ':' + (tarefa ? JSON.stringify([tarefa.tipo, tarefa.numero, tarefa.processoPai || null]) : 'coordenadora');
  }
  function lerColecoes(key) {
    const state = loadState();
    const prefixo = key + ':' + (state?.loteId || 'avulso') + ':';
    const keys = new Set([chaveColecao(key), prefixo + 'coordenadora', ...(state?.fila || []).map(t => prefixo + JSON.stringify([t.tipo, t.numero, t.processoPai || null]))]);
    return [...keys].flatMap(k => GM_getValue(k, [])).sort((a,b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  }
  function log(mensagem, nivel = 'info') {
    // Com várias abas escrevendo no mesmo log, saber DE QUEM é cada linha é o
    // que torna o log legível. As mensagens que já começam pelo número do
    // processo (a maioria) não ganham prefixo repetido.
    mensagem = sanitizar(mensagem);
    const prefixo = prefixoDaAba();
    const texto = prefixo && !String(mensagem).startsWith(prefixo) ? `${prefixo}: ${mensagem}` : String(mensagem);
    const entradas = GM_getValue(chaveColecao(LOG_KEY), []);
    entradas.push({ ts: new Date().toISOString(), nivel, mensagem: texto });
    GM_setValue(chaveColecao(LOG_KEY), entradas.length > LOG_MAX ? entradas.slice(-LOG_MAX) : entradas);
    console.log(`[eproc-downloader] [${nivel}] ${texto}`);
    renderLog();
  }

  function prefixoDaAba() {
    const tarefa = loadTarefa();
    return tarefa ? rotuloTarefa(tarefa) : '';
  }
  function getLog() {
    return lerColecoes(LOG_KEY);
  }
  function clearLog() {
    GM_deleteValue(chaveColecao(LOG_KEY));
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

  // sleep() por Web Worker, e não por setTimeout direto.
  //
  // POR QUE: o Chrome estrangula os temporizadores de abas em SEGUNDO PLANO —
  // depois de alguns minutos, um setTimeout pode só disparar 1x por minuto.
  // Já era um problema com uma aba só (ver docs/LIMITACOES.md, "Aba em segundo
  // plano"); com o modo multi-aba da v0.5.0, onde N-1 abas estão sempre em
  // segundo plano, seria fatal: uma espera de 15s viraria 60s e o "Gerar
  // Arquivo Completo" nunca seria detectado a tempo. Temporizador dentro de um
  // Worker dedicado NÃO sofre esse estrangulamento.
  //
  // Se a política de segurança da página proibir Worker via blob:, cai
  // silenciosamente no setTimeout de sempre — mais lento em segundo plano,
  // mas funcional.
  let timerWorker;           // undefined = ainda não tentou; null = indisponível
  let timerSeq = 0;
  const timerPendentes = new Map();
  function obterTimerWorker() {
    if (timerWorker !== undefined) return timerWorker;
    try {
      const fonte = 'onmessage=function(e){setTimeout(function(){postMessage(e.data.id);},e.data.ms);};';
      const w = new Worker(URL.createObjectURL(new Blob([fonte], { type: 'application/javascript' })));
      w.onmessage = (ev) => {
        const resolver = timerPendentes.get(ev.data);
        if (resolver) {
          timerPendentes.delete(ev.data);
          resolver();
        }
      };
      timerWorker = w;
    } catch (e) {
      timerWorker = null;
    }
    return timerWorker;
  }
  function sleep(ms) {
    const w = obterTimerWorker();
    if (!w) return new Promise((resolve) => setTimeout(resolve, ms));
    return new Promise((resolve) => {
      const id = ++timerSeq;
      timerPendentes.set(id, resolve);
      w.postMessage({ id, ms });
    });
  }

  // Comparação de texto insensível a acento, caixa e espaço repetido. O eproc
  // escreve "anexos eletrônicos" numa tela e "Anexos Eletronicos" em outra;
  // casar por texto exato é o que faz um passo "sumir" sem explicação.
  function normalizar(s) {
    return (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
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
  function pareceHtml(contentType) {
    return /text\/html|application\/xhtml/i.test(contentType || '');
  }

  // ----------------------------------------------------------------------
  // O LINK DO EVENTO NÃO É O ARQUIVO. (Achado do teste real, 08/09/2026.)
  //
  // "controlador.php?acao=acessar_documento&..." devolve HTML. Conforme a
  // configuração do Chrome para PDF, essa página ou embute o visualizador
  // (iframe/embed apontando para o arquivo de verdade) ou mostra só um botão
  // "Abrir". Foi por isso que o download do INIC1 do Evento 1 ora salvava um
  // ".htm", ora falhava com "not_succeeded": o GM_download estava recebendo o
  // endereço da SALA DE ESPERA, não o do documento.
  //
  // Daí este resolvedor. Ele NUNCA inventa URL: busca a página, lê o
  // Content-Type e, se for HTML, procura dentro dela os endereços que ela
  // mesma aponta. Se não achar nada, baixa um diagnóstico com o HTML — a
  // mesma política do resto do script (transformar "não funcionou" em dado
  // acionável na primeira rodada, e não na terceira).
  // ----------------------------------------------------------------------

  // Só os cabeçalhos, sem trazer o corpo. Serve para dois propósitos: saber se
  // a URL já é o arquivo, e medir o tamanho da mídia sem baixá-la.
  async function inspecionarCabecalhos(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', credentials: 'include', redirect: 'follow' });
      if (!r.ok && r.status !== 304) return null;
      const tamanho = r.headers.get('Content-Length');
      return {
        contentType: r.headers.get('Content-Type') || '',
        urlFinal: r.url || url,
        bytes: tamanho ? parseInt(tamanho, 10) : null,
      };
    } catch (e) {
      return null; // servidor pode não aceitar HEAD — quem chama cai para GET
    }
  }

  // Endereços de arquivo que a página intermediária aponta, do mais provável
  // para o menos. Cobre as formas que o eproc pode usar: visualizador
  // embutido, botão "Abrir", redirecionamento por meta/JS, e URLs do próprio
  // controlador escritas no meio do HTML.
  function candidatosDeArquivo(html, urlBase) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const achados = [];
    const push = (bruto, via) => {
      if (!bruto) return;
      const limpo = String(bruto).replace(/&amp;/g, '&').trim();
      if (!limpo || /^(javascript:|#|about:|mailto:)/i.test(limpo)) return;
      let abs;
      try {
        abs = new URL(limpo, urlBase).href;
      } catch (e) {
        return;
      }
      if (abs.split('#')[0] === urlBase.split('#')[0]) return; // ele mesmo
      achados.push({ url: abs, via });
    };

    for (const el of doc.querySelectorAll('iframe[src], embed[src], frame[src]')) push(el.getAttribute('src'), el.tagName.toLowerCase());
    for (const el of doc.querySelectorAll('object[data]')) push(el.getAttribute('data'), 'object');
    for (const a of doc.querySelectorAll('a[href]')) {
      const texto = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (CONFIG.documento.textosDeAbertura.test(normalizar(texto))) push(a.getAttribute('href'), `link "${texto.slice(0, 30)}"`);
    }
    for (const b of doc.querySelectorAll('button[onclick], input[onclick]')) {
      const m = (b.getAttribute('onclick') || '').match(/['"]([^'"]+controlador\.php[^'"]*)['"]/i);
      if (m) push(m[1], 'onclick de botão');
    }
    const meta = doc.querySelector('meta[http-equiv="refresh" i]');
    if (meta) {
      const m = (meta.getAttribute('content') || '').match(/url\s*=\s*['"]?([^'";]+)/i);
      if (m) push(m[1], 'meta refresh');
    }
    for (const f of doc.querySelectorAll('form[action]')) push(f.getAttribute('action'), 'action de formulário');
    for (const m of html.matchAll(/(?:location(?:\.href)?\s*=|window\.open\s*\(|\.src\s*=)\s*['"]([^'"]+)['"]/gi)) {
      push(m[1], 'redirecionamento em javascript');
    }
    for (const m of html.matchAll(/((?:https?:\/\/[^"'\s)<>]+)?controlador\.php\?[^"'\s)<>]+)/gi)) {
      push(m[1], 'controlador.php citado no HTML');
    }

    const unicos = achados.filter((c, i) => achados.findIndex((o) => o.url === c.url) === i);
    // O que tem cara de conteúdo (acessar_documento_implementacao, .pdf...) vem antes.
    return unicos.sort(
      (a, b) => (CONFIG.documento.acoesDeConteudo.test(a.url) ? 0 : 1) - (CONFIG.documento.acoesDeConteudo.test(b.url) ? 0 : 1)
    );
  }

  // Devolve { url, contentType, bytes, trilha, html, aviso }.
  // `url` null = não deu para chegar ao arquivo; `trilha` conta o caminho
  // percorrido e vai inteira para o diagnóstico.
  async function resolverUrlDocumento(href) {
    let url = href;
    const trilha = [];
    for (let nivel = 0; nivel < CONFIG.documento.maxNiveis; nivel++) {
      // 1) HEAD primeiro: se já é o arquivo, terminamos sem trazer o corpo —
      //    o que importa muito para mídia, que pode ter centenas de MB.
      const cabecalhos = await inspecionarCabecalhos(url);
      if (cabecalhos && !pareceHtml(cabecalhos.contentType)) {
        trilha.push(`${cabecalhos.urlFinal} -> ${cabecalhos.contentType || '(sem Content-Type)'} [HEAD]`);
        return { url: cabecalhos.urlFinal, contentType: cabecalhos.contentType, bytes: cabecalhos.bytes, trilha, html: null, aviso: null };
      }

      // 2) É HTML (ou o servidor não aceita HEAD): traz o corpo para ler os
      //    endereços que a própria página aponta. Aborta assim que os
      //    cabeçalhos mostrarem que não é HTML, para não puxar um vídeo inteiro.
      const controle = new AbortController();
      let resposta;
      try {
        resposta = await fetch(url, { credentials: 'include', redirect: 'follow', signal: controle.signal });
      } catch (e) {
        trilha.push(`${url} -> falha de rede: ${e.message}`);
        return { url: null, contentType: null, bytes: null, trilha, html: null, aviso: `não deu para abrir a URL do documento (${e.message}).` };
      }
      const tipo = resposta.headers.get('Content-Type') || '';
      const urlFinal = resposta.url || url;
      trilha.push(`${urlFinal} -> ${resposta.status} ${tipo || '(sem Content-Type)'}`);
      if (!pareceHtml(tipo)) {
        controle.abort();
        const tamanho = resposta.headers.get('Content-Length');
        return { url: urlFinal, contentType: tipo, bytes: tamanho ? parseInt(tamanho, 10) : null, trilha, html: null, aviso: null };
      }

      const html = await resposta.text();
      if (html.length < 30000 && /acesso negado|sess[aã]o expirad|informe seu login|autentica[cç][aã]o/i.test(html)) {
        return { url: null, contentType: tipo, bytes: null, trilha, html, aviso: 'a resposta parece tela de login / acesso negado — a sessão do eproc pode ter expirado. Recarregue o eproc, confirme que está logado e tente de novo.' };
      }
      const candidatos = candidatosDeArquivo(html, urlFinal);
      if (candidatos.length === 0) {
        return { url: null, contentType: tipo, bytes: null, trilha, html, aviso: 'a página intermediária foi lida, mas nenhum endereço de arquivo foi encontrado dentro dela.' };
      }
      trilha.push(`  candidato escolhido (${candidatos[0].via}): ${candidatos[0].url}`);
      for (const c of candidatos.slice(1, 6)) trilha.push(`  (descartado) ${c.via}: ${c.url}`);
      url = candidatos[0].url;
    }
    return { url: null, contentType: null, bytes: null, trilha, html: null, aviso: `foram seguidas ${CONFIG.documento.maxNiveis} páginas intermediárias sem chegar a um arquivo — download interrompido.` };
  }

  // Diagnóstico específico de documento: é o que diz, numa rodada, qual é a
  // forma real da página intermediária deste tribunal.
  function diagnosticoDocumento(href, resultado, rotulo) {
    const linhas = [];
    linhas.push('=== DIAGNÓSTICO DE DOCUMENTO — eproc-downloader ===');
    linhas.push(`Data: ${new Date().toISOString()}`);
    linhas.push(`Rótulo/arquivo: ${rotulo}`);
    linhas.push(`URL do link do evento: ${href}`);
    linhas.push(`Resultado: ${resultado.aviso || 'sem aviso'}`);
    linhas.push('');
    linhas.push('--- Caminho percorrido ---');
    for (const t of resultado.trilha || []) linhas.push(`  ${t}`);
    if (resultado.html) {
      linhas.push('');
      linhas.push('--- HTML da página intermediária (primeiros 6000 caracteres) ---');
      const estrutura = new DOMParser().parseFromString(resultado.html, 'text/html');
      linhas.push(Array.from(estrutura.querySelectorAll('iframe,embed,object,a,button,input,form')).slice(0, 40).map(el => el.tagName + ' atributos=' + el.getAttributeNames().join(',') + ' URL=' + sanitizar(urlDoControle(el, location.href) || '(sem URL literal)')).join('\n'));
    }
    return finalizarDiagnostico(linhas, 'eproc-diagnostico-documento');
  }

  // Baixa um documento do eproc. `href` é o link do evento (página
  // intermediária) — a resolução para o arquivo real é feita aqui dentro.
  // Passe { resolver: false } quando a URL JÁ é o arquivo.
  function sanitizar(texto) {
    return String(texto).replace(/(?:cookie|authorization)\s*:[^\r\n]+/gi, '[CREDENCIAL REMOVIDA]').replace(/(?:value|data-[\w-]+)\s*=\s*(["'])(.*?)\1/gi, 'valor="[REMOVIDO]"').replace(/((?:https?:\/\/|controlador\.php)[^\s"'<>?]*)(\?[^\s"'<>]*)/gi, '$1?[REMOVIDO]')
      .replace(/((?:hash|token|sessao|session|senha|password|cookie)[\w-]*\s*[=:]\s*)[^\s&"'<>]+/gi, '$1[REMOVIDO]');
  }

  function urlDoControle(el, base) {
    const diretos = ['href', 'src', 'data', 'data-href', 'data-url'];
    let valor = diretos.map(a => el.getAttribute(a)).find(v => v && !/^(?:javascript:|#)/i.test(v));
    if (!valor) {
      // Apenas literais de navegação conhecidos; nunca executar JavaScript recebido.
      const js = el.getAttribute('onclick') || el.getAttribute('href') || '';
      const m = js.match(/(?:window\.open\s*\(|(?:window\.)?location(?:\.href)?\s*=\s*)["']([^"']+)["']/i);
      valor = m && m[1];
    }
    if (!valor) return null;
    try {
      const u = new URL(valor, base);
      if (u.origin !== new URL(base).origin || !/^https?:$/.test(u.protocol)) return null;
      return u.href;
    } catch { return null; }
  }

  async function resolverDocumento(href, pdf = true, visitados = new Set()) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) throw new Error('Documento fora da origem do eproc; revisão necessária.');
    if (visitados.has(url.href) || visitados.size >= 6) throw new Error('Página intermediária circular ou profunda demais.');
    visitados.add(url.href);
    let resposta;
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        resposta = await fetch(url.href, { credentials: 'include', signal: AbortSignal.timeout(60000) });
        if (resposta.ok) break;
        if (![429, 500, 502, 503, 504].includes(resposta.status)) break;
      } catch (e) {
        if (tentativa === 2) throw new Error('Falha ao obter documento; nenhuma gravação iniciada.');
      }
      if (tentativa === 2) throw new Error('Servidor indisponível; nenhuma gravação iniciada.');
      await sleep(1000 * 2 ** tentativa);
    }
    if (!resposta?.ok) throw new Error('Servidor recusou o documento: HTTP ' + resposta?.status);
    const base = resposta.url || url.href;
    if (new URL(base).origin !== location.origin) throw new Error('Redirecionamento fora do eproc.');
    const blob = await resposta.blob();
    const inicio = await blob.slice(0, 1024).text();
    if (/^%PDF-/.test(inicio)) {
      const fim = await blob.slice(Math.max(0, blob.size - 4096)).text();
      if (!fim.includes('%%EOF')) throw new Error('PDF incompleto: marcador final ausente.');
      return blob;
    }
    const html = /html/i.test(blob.type) || /^\s*(?:<!doctype|<html|<head|<body|<script|<form)/i.test(inicio);
    if (!html) {
      if (!pdf && blob.size > 0) return blob;
      throw new Error('Resposta não é PDF; arquivo não foi gravado.');
    }
    if (blob.size > 2 * 1024 * 1024) throw new Error('Página intermediária excede o limite.');
    const doc = new DOMParser().parseFromString(await blob.text(), 'text/html');
    if (doc.querySelector('input[type="password"]')) throw new Error('Sessão expirada; faça login e retome.');
    const candidatos = Array.from(doc.querySelectorAll('iframe[src], embed[src], object[data], a, button, input[type="button"], input[type="submit"]'))
      .filter(el => /^(IFRAME|EMBED|OBJECT)$/.test(el.tagName) || /abrir|baixar|download|visualizar/i.test(el.textContent + ' ' + (el.value || '')))
      .map(el => urlDoControle(el, base)).filter(Boolean);
    for (const c of candidatosDeArquivo(await blob.text(), base)) {
      if (new URL(c.url).origin === location.origin && !/formulário|citado no HTML/.test(c.via)) candidatos.push(c.url);
    }
    for (const candidato of new Set(candidatos)) {
      if (!visitados.has(candidato)) return resolverDocumento(candidato, pdf, visitados);
    }
    throw new Error('Página intermediária sem PDF ou botão Abrir resolvível; não foi salva como PDF.');
  }

  async function baixarComoArquivo(href, nomeArquivo) {
    if (!navigator.locks) throw new Error('Navegador sem suporte à coordenação de downloads.');
    return navigator.locks.request('eproc-arquivo:' + nomeArquivo, () => baixarArquivoValidado(href, nomeArquivo));
  }

  async function baixarArquivoValidado(href, nomeArquivo) {
    const key = 'eprocDownloads_v2:' + (loadState()?.loteId || 'avulso') + ':' + nomeArquivo;
    const anterior = JSON.parse(sessionStorage.getItem('eprocDownloadPendente') || 'null');
    if (anterior && anterior.nomeArquivo !== nomeArquivo) throw new Error('Confira o download pendente antes de iniciar outro arquivo.');
    const registros = GM_getValue(key, {});
    if (registros[nomeArquivo] === 'confirmado') return { confirmado: true, existente: true };
    if (registros[nomeArquivo] === 'iniciado') throw new Error('Download anterior sem confirmação: confira a pasta antes de repetir ' + nomeArquivo);
    if (loadState()?.pausado) throw new Error('Lote pausado antes do download.');
    sinalizarVida(loadTarefa());
    const blob = await resolverDocumento(href, /\.pdf$/i.test(nomeArquivo));
    sessionStorage.setItem('eprocDownloadPendente', JSON.stringify({key, nomeArquivo}));
    registros[nomeArquivo] = 'iniciado';
    GM_setValue(key, registros);
    // Blob via GM_download requer Tampermonkey 5.4.6226+; não usar clique HTML.
    await new Promise((resolve, reject) => {
      let encerrado = false;
      const timer = setTimeout(() => terminar(new Error('Download sem confirmação no prazo; confira a pasta antes de repetir.')), 180000);
      function terminar(erro) {
        if (encerrado) return;
        encerrado = true; clearTimeout(timer);
        if (erro) reject(erro); else resolve();
      }
      try {
        GM_download({ url: blob, name: nomeArquivo, saveAs: false,
          onload: () => terminar(),
          onerror: () => terminar(new Error('Gerenciador não confirmou o download; confira a pasta e a versão do Tampermonkey.')),
          ontimeout: () => terminar(new Error('Download expirou sem confirmação.')) });
      } catch { terminar(new Error('Tampermonkey não aceitou o arquivo validado. Atualize a extensão.')); }
    });
    sessionStorage.removeItem('eprocDownloadPendente');
    registros[nomeArquivo] = 'confirmado';
    GM_setValue(key, registros);
    return { confirmado: true, bytes: blob.size };
  }

  function revisarDownloadPendente() {
    const pendente = JSON.parse(sessionStorage.getItem('eprocDownloadPendente') || 'null');
    if (!pendente) { log('Nenhum download sem confirmação nesta aba.'); return; }
    if (confirm('Confira a pasta de downloads. O arquivo ' + pendente.nomeArquivo + ' existe e abre completo? OK = confirmar arquivo; Cancelar = avaliar nova tentativa.')) {
      GM_setValue(pendente.key, { [pendente.nomeArquivo]: 'confirmado' });
    } else {
      if (!confirm('Confirme que o download NÃO está em andamento e que você removeu qualquer arquivo incompleto antes de tentar novamente.')) return;
      GM_deleteValue(pendente.key);
    }
    sessionStorage.removeItem('eprocDownloadPendente');
    log('Conferência registrada. Clique Iniciar nesta aba para retomar.');
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
    for (const alvo of [].concat(texto).map(normalizar)) {
      const candidatos = controlesClicaveis(raiz)
        .filter((el) => normalizar(textoDeControle(el)).includes(alvo))
        .filter((el) => !visivel || el.offsetParent !== null || el.getClientRects().length > 0)
        .sort((a, b) => textoDeControle(a).length - textoDeControle(b).length);
      if (candidatos.length) return candidatos[0];
    }
    return null;
  }

  function acharTodosControles(texto, { raiz = document } = {}) {
    for (const alvo of [].concat(texto).map(normalizar)) {
      const achados = controlesClicaveis(raiz).filter((el) => normalizar(textoDeControle(el)).includes(alvo));
      if (achados.length) return achados;
    }
    return [];
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

  // Texto que identifica uma checkbox: o <label for=...>, o <label> que a
  // envolve, o irmão seguinte e o texto do elemento-pai — nessa ordem de
  // confiança. O eproc usa formas diferentes de tela para tela.
  function contextoDaCheckbox(input) {
    const rotuloDoFor = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
    return [
      rotuloDoFor && rotuloDoFor.textContent,
      input.closest('label') && input.closest('label').textContent,
      input.nextElementSibling && input.nextElementSibling.textContent,
      input.parentElement && input.parentElement.textContent,
      input.getAttribute('aria-label'),
      input.getAttribute('title'),
    ]
      .filter(Boolean)
      .join(' ');
  }

  // Checkbox pelo texto ao redor. `texto` pode ser uma lista de variantes,
  // tentadas em ordem; `ignorar` evita que duas opções diferentes casem com a
  // mesma checkbox (o rótulo curto de uma pode estar contido no da outra).
  function acharCheckboxPorTexto(texto, { ignorar = [] } = {}) {
    const variantes = [].concat(texto).map((t) => normalizar(t).slice(0, 70));
    for (const alvo of variantes) {
      if (!alvo) continue;
      for (const input of document.querySelectorAll('input[type="checkbox"]')) {
        if (ignorar.includes(input)) continue;
        if (normalizar(contextoDaCheckbox(input)).includes(alvo)) return input;
      }
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
    const manifesto = GM_getValue(chaveColecao(MANIFESTO_KEY), []);
    manifesto.push({ ts: new Date().toISOString(), ...entrada });
    GM_setValue(chaveColecao(MANIFESTO_KEY), manifesto);
  }

  function exportarManifesto() {
    const manifesto = lerColecoes(MANIFESTO_KEY);
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
  async function baixarPartesDosAutos(prefixo, { numeroProcesso, ip = null, jaFeitas = [], aoBaixar = () => {} } = {}) {
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
      throw new Error('Nenhuma parte disponível.');
    }

    // Ordena pelo número da parte que aparece no rótulo, para PARTE_2 não
    // virar PARTE_10 por acidente de ordem no DOM.
    botoes.sort((a, b) => numeroDaParte(a) - numeroDaParte(b));

    log(`${numeroProcesso}: ${botoes.length} ${temPartes ? 'parte(s)' : 'arquivo'} para baixar${jaFeitas.length ? ` (${jaFeitas.length} já baixada(s) antes desta aba recarregar)` : ''}.`);

    let baixadas = 0;
    let viaClique = 0;
    for (let i = 0; i < botoes.length; i++) {
      const botao = botoes[i];
      const parte = temPartes ? numeroDaParte(botao) || i + 1 : 1;
      if (jaFeitas.includes(parte)) continue;
      const nome = temPartes
        ? `${prefixo}__AUTOS_PARTE_${parte}.pdf`
        : `${prefixo}__AUTOS.pdf`;
      const href = urlDoControle(botao, location.href);
      if (!href) throw new Error('Parte sem endereço resolvível: diagnóstico do botão necessário.');
      await baixarComoArquivo(href, nome);
      registrarNoManifesto({ processo: numeroProcesso, ip, rotulo: textoDeControle(botao), nomeArquivo: nome, viaClique: false });
      baixadas++;
      aoBaixar(parte);
      log(`${numeroProcesso}: ${nome} confirmado pelo gerenciador.`);
    }
    return { baixadas, viaClique };
  }

  async function aguardarPartesEstaveis() {
    let anterior = '', desde = Date.now();
    for (let i = 0; i < 120; i++) {
      const links = acharTodosControles(CONFIG.labels.baixarArquivo);
      const assinatura = links.map(el => textoDeControle(el) + (urlDoControle(el, location.href) || '')).sort().join('|');
      if (assinatura && assinatura === anterior && Date.now() - desde >= 3000) return;
      if (assinatura !== anterior) { anterior = assinatura; desde = Date.now(); }
      await sleep(500);
    }
    throw new Error('Links das partes não ficaram disponíveis e estáveis.');
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
    const usadas = [];
    let faltando = 0;
    for (const [chave, rotulo] of mapa) {
      const ids = { listaEventos: 'Listaeventos', anexosEletronicos: 'AnexosEletronicos', soComDocumentos: 'soComDocumentos' };
      const input = Array.from(document.querySelectorAll('input[type="checkbox"]')).find(el =>
        [el.id, el.name].some(v => String(v).toLowerCase() === ids[chave].toLowerCase())) || acharCheckboxPorTexto(rotulo, { ignorar: usadas });
      if (!input) {
        relato.push(`${chave}=NÃO ENCONTRADA`);
        faltando += 1;
        continue;
      }
      usadas.push(input);
      const desejado = CONFIG.downloadCompleto.checkboxes[chave];
      if (desejado === null || desejado === undefined) {
        relato.push(`${chave}=${input.checked ? 'marcada' : 'desmarcada'} (mantida)`);
        continue;
      }
      if (input.checked !== desejado) {
        // click() (e não input.checked = ...) de propósito: é o clique que
        // dispara os onclick/onchange que o eproc pendura nessas checkboxes.
        if (input.disabled) throw new Error('Opção obrigatória desabilitada: ' + chave);
        input.click();
        if (input.checked !== desejado) {
          input.checked = desejado;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        relato.push(`${chave}=${input.checked ? 'marcada' : 'desmarcada'} (ALTERADA pelo script)`);
      } else {
        relato.push(`${chave}=${input.checked ? 'marcada' : 'desmarcada'} (já estava)`);
      }
    }
    log(`${numeroProcesso}: opções do Download Completo — ${relato.join(', ')}.`);
    if (faltando > 0) {
      // Sem isso o download sai silenciosamente sem a lista de eventos ou sem
      // os anexos, e ninguém percebe até abrir o PDF.
      log(`${numeroProcesso}: ${faltando} das 3 opções obrigatórias não foram encontradas na tela. A geração será interrompida; confira as opções na tela.`, 'erro');
      throw new Error('Opção obrigatória não encontrada; geração interrompida.');
    }
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
      try {
      if (CONFIG.termoaudOnlyRegex.test(c.rotulo) && !/video|audio/i.test(c.rotulo)) {
        log(`${numeroProcesso}: evento "${c.rotulo}" é só TERMOAUD (termo de audiência em HTML) — não é mídia, ignorado.`);
        continue;
      }

      let confiavel = false;
      let nomeSugerido = c.nomeArquivoSugerido || '';
      if (CONFIG.mediaFilenamePattern.test(nomeSugerido)) {
        confiavel = true;
      }

      // Resolver ANTES de checar cabeçalhos. Até a v0.4.0 o HEAD era feito no
      // href do evento — que é a página intermediária e SEMPRE responde
      // text/html. Ou seja: a checagem de "vídeo falso" reprovava toda mídia
      // de verdade, e nada era baixado. Ver o bloco de resolverUrlDocumento().
      let alvo = null;
      let tipo = null;
      let bytes = null;
      try {
        const r = await resolverUrlDocumento(c.href);
        if (r.url) {
          alvo = r.url;
          tipo = r.contentType;
          bytes = r.bytes;
          if (bytes === null) {
            const cab = await inspecionarCabecalhos(alvo);
            if (cab) {
              bytes = cab.bytes;
              tipo = tipo || cab.contentType;
            }
          }
        } else {
          log(`${numeroProcesso}: não deu para chegar ao arquivo de "${c.rotulo}" — ${r.aviso}`, 'aviso');
          diagnosticoDocumento(c.href, r, c.rotulo);
          continue;
        }
      } catch (e) {
        log(`${numeroProcesso}: falha ao resolver o endereço de "${c.rotulo}" (${e.message}) — pulado.`, 'aviso');
        continue;
      }

      const respostaEhHtml = pareceHtml(tipo);
      const pequenoDemais = bytes !== null && bytes < CONFIG.mediaMinBytes;

      if (!confiavel && (respostaEhHtml || pequenoDemais)) {
        log(`${numeroProcesso}: evento "${c.rotulo}" tem sinais de vídeo/áudio falso (tipo=${tipo || '?'}, ${bytes ?? '?'} bytes) — NÃO baixado. Confira manualmente (caso real já visto no Manual: "VIDEO1" era HTML de poucos KB).`, 'aviso');
        continue;
      }

      const nomeFinal = nomeSugerido && CONFIG.mediaFilenamePattern.test(nomeSugerido)
        ? `${prefixo}__${nomeSugerido}`
        : `${prefixo}__${nomeSeguro(c.rotulo)}`;
      await baixarComoArquivo(alvo, nomeFinal, { resolver: false });
      registrarNoManifesto({ processo: numeroProcesso, ip: null, rotulo: c.rotulo, nomeArquivo: nomeFinal, viaClique: false });
      log(`${numeroProcesso}: mídia "${c.rotulo}" baixada como ${nomeFinal} (${bytes !== null ? `${bytes} bytes` : 'tamanho desconhecido'}, ${tipo || 'tipo desconhecido'}).`);
      } catch (e) {
        // Uma mídia que falha não pode derrubar o processo inteiro: os AUTOS
        // são o que importa no dia da audiência.
        log(`${numeroProcesso}: falha ao baixar a mídia "${c.rotulo}" (${e && e.message ? e.message : e}) — seguindo para o próximo item.`, 'erro');
      }
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
        <button id="eproc-dl-iniciar">Iniciar</button><button id="eproc-dl-revisar">Conferir download pendente</button>
        <button id="eproc-dl-parar">Parar</button>
        <button id="eproc-dl-limpar-log">Limpar log</button>
        <button id="eproc-dl-exportar-log">Exportar log</button>
        <button id="eproc-dl-manifesto" title="Baixa o manifesto (.json) com o processo/IP de cada arquivo baixado — use com organizar_autos.py --manifesto">Manifesto</button>
        <button id="eproc-dl-diagnostico" title="Gera um relatório da estrutura da tabela de eventos desta página (.txt) para investigar seletores que não bateram">Diagnóstico</button>
        <button id="eproc-dl-diag-doc" title="Segue o link de documento do Evento 1 e relata como se chega ao arquivo de verdade (.txt)">Diagnóstico doc.</button>
      </div>
      <div class="opcoes">
        <strong>Baixar:</strong>
        <label><input type="checkbox" id="eproc-dl-opt-autos"> autos completos</label>
        <label><input type="checkbox" id="eproc-dl-opt-denuncia"> denúncia</label>
        <label><input type="checkbox" id="eproc-dl-opt-midia"> mídia</label>
        <label><input type="checkbox" id="eproc-dl-opt-ips"> IPs referenciados</label>
        <div style="margin-top:5px;">
          <label title="Quantos processos são baixados ao mesmo tempo, cada um na sua aba. O Chrome precisa permitir pop-ups para este site.">abas ao mesmo tempo:
            <input type="number" id="eproc-dl-opt-maxabas" min="1" max="12" style="width:44px;">
          </label>
          <label title="Cada aba se fecha 5s depois de terminar o seu processo. O log fica guardado nesta aba principal."><input type="checkbox" id="eproc-dl-opt-fechar"> fechar aba ao terminar</label>
        </div>
      </div>
      <div>
        <button id="eproc-dl-autos-agora" title="Roda o Download Completo no processo já aberto nesta página, sem depender da fila/CSV">Baixar autos desta página</button>
      </div>
      <div id="eproc-dl-status"></div>
      <div class="log" id="eproc-dl-log"></div>
    `;
    document.body.appendChild(painel);

    document.getElementById('eproc-dl-revisar').addEventListener('click', revisarDownloadPendente);
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

    // Opções numéricas/independentes das quatro caixas de "o que baixar".
    const inputMaxAbas = document.getElementById('eproc-dl-opt-maxabas');
    inputMaxAbas.value = loadOpcoes().maxAbas;
    inputMaxAbas.addEventListener('change', () => {
      const opcoes = loadOpcoes();
      opcoes.maxAbas = Math.max(1, Math.min(12, Number(inputMaxAbas.value) || 1));
      inputMaxAbas.value = opcoes.maxAbas;
      saveOpcoes(opcoes);
      log(`Abas simultâneas: ${opcoes.maxAbas}.`);
    });
    const inputFechar = document.getElementById('eproc-dl-opt-fechar');
    inputFechar.checked = loadOpcoes().fecharAba;
    inputFechar.addEventListener('change', () => {
      const opcoes = loadOpcoes();
      opcoes.fecharAba = inputFechar.checked;
      saveOpcoes(opcoes);
      log(`Fechar aba ao terminar: ${inputFechar.checked ? 'sim' : 'não'}.`);
    });

    document.getElementById('eproc-dl-diag-doc').addEventListener('click', () => {
      diagnosticoDocumentoDaPagina().catch((e) => log(`Diagnóstico de documento falhou: ${e && e.message ? e.message : e}`, 'erro'));
    });
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

  // Painel fechado não interrompe o processamento (avancarAba roda independente
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
    const texto = sanitizar(`${linhas.join('\n')}\n`);
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
    const tarefa = loadTarefa();
    const linhas = [];
    if (tarefa) {
      linhas.push(`Esta aba: ${rotuloTarefa(tarefa)} — ${tarefa.fase}${tarefa.autos ? ` / autos: ${tarefa.autos.sub}` : ''}`);
    } else if (ehCoordenadora()) {
      linhas.push('Esta aba: coordenadora (abre e acompanha as demais).');
    }
    if (!state) {
      linhas.push('Nenhuma fila carregada. Importe um CSV.');
    } else {
      const conta = (st) => state.fila.filter((p) => p.status === st).length;
      linhas.push(
        `Fila: ${state.fila.length} | em andamento: ${conta('em_andamento')} | concluídos: ${conta('concluido')} | pendentes: ${conta('pendente')} | erros: ${conta('erro')}${state.pausado ? ' | PAUSADA' : ''}`
      );
    }
    el.textContent = linhas.join('\n');
    el.style.whiteSpace = 'pre-wrap';
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
    if (loadState()?.fila.some(p => p.status === 'em_andamento')) { log('Finalize ou confira as abas em andamento antes de importar outro CSV.', 'erro'); return; }
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
    // As abas de trabalho leem `pausado` no começo de cada passo e param
    // sozinhas — mas só depois de terminar o passo em que estão (um download
    // já disparado vai até o fim, o que é o comportamento desejado).
    log('Processamento pausado. A coordenadora não abre mais abas, e cada aba de trabalho para ao fim do passo atual. Clique em Iniciar para retomar.');
    renderStatus();
  }

  function iniciarProcessamento() {
    if (loadTarefa()) {
      const state = loadState();
      if (state) { GM_deleteValue(chaveRelato(state, loadTarefa())); state.pausado = false; saveState(state); }
      avancarAba(); return;
    }
    const state = loadState();
    if (!state) {
      log('Importe um CSV antes de iniciar.', 'erro');
      return;
    }
    // Retomando depois de um "Parar" (ou de uma sessão anterior), itens
    // marcados "em andamento" são de abas que já não existem: voltam para
    // pendente, senão as vagas nunca são liberadas.
    state.pausado = false;
    saveState(state);
    marcarComoCoordenadora();
    const opcoes = loadOpcoes();
    const pendentes = state.fila.filter((p) => p.status === 'pendente').length;
    log(`Iniciando: ${pendentes} item(ns) pendente(s), até ${opcoes.maxAbas} aba(s) ao mesmo tempo. O Chrome precisa PERMITIR POP-UPS para este site — se ele bloquear, o script avisa e cai para uma aba só.`);
    renderStatus();
    supervisionar().catch((e) => log(`Supervisão falhou: ${e && e.message ? e.message : e}`, 'erro'));
  }

  // Botão "Diagnóstico doc." — segue o link do Evento 1 (ou o primeiro
  // documento da página) e relata como se chega ao arquivo. É o que diz, numa
  // rodada, qual é a forma real da página intermediária deste tribunal.
  async function diagnosticoDocumentoDaPagina() {
    const eventos = lerEventos();
    const { documento } = localizarEvento1(eventos);
    const alvo = documento || lerLinhasEventos(eventos)[0];
    if (!alvo) {
      log('Nenhum link de documento nesta página para diagnosticar — abra um processo com eventos.', 'erro');
      return;
    }
    log(`Diagnóstico de documento: seguindo "${alvo.rotulo}"...`);
    const r = await resolverUrlDocumento(alvo.href);
    diagnosticoDocumento(alvo.href, r, alvo.rotulo);
    if (r.url) {
      log(`Diagnóstico de documento: o arquivo de verdade está em ${r.url} (${r.contentType || 'tipo desconhecido'}).`);
    } else {
      log(`Diagnóstico de documento: não se chegou ao arquivo — ${r.aviso}`, 'erro');
    }
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
  // "Download Completo" pode abrir um modal na mesma página ou NAVEGAR para
  // outra tela. Se navegar, qualquer `await` depois do clique nunca retorna —
  // a página que o executava deixou de existir. Escrever como sub-fases
  // persistidas funciona nos DOIS casos: o passo é salvo em `tarefa.autos.sub`
  // ANTES do clique, e é retomado do zero na carga seguinte se houve
  // navegação, ou seguido inline se não houve.
  //
  // BUG CORRIGIDO NA v0.5.0 (era por isso que as partes nunca eram baixadas):
  // até a v0.4.0 esta função devolvia 'continuar' assim que a PRÓXIMA tela
  // aparecia, e quem chamava entendia 'continuar' como "a etapa dos autos
  // acabou" — apagava o estado e ia para o próximo passo. Resultado: o script
  // abria a tela de opções, e ali morria. Ninguém chegava a clicar em "Gerar
  // Arquivo Completo" nem nos links de parte. Agora há dois retornos
  // diferentes, e a diferença entre eles é o conserto:
  //
  //   'prosseguir' — mudei de sub-fase e a página é a mesma: me chame de novo,
  //                  agora, para executar a sub-fase seguinte.
  //   'terminado'  — a etapa dos autos acabou (com sucesso ou com diagnóstico).
  //
  // (Se a página navegar, esta função nem chega a retornar: morre junto com a
  // página, e a carga seguinte retoma pela sub-fase que já ficou salva.)
  // ======================================================================
  async function avancarAutos(tarefa) {
    const autos = tarefa.autos;
    const { numeroProcesso, ip, prefixo } = autos.contexto;
    const rotuloAlvo = ip ? `${numeroProcesso} (IP ${ip})` : numeroProcesso;

    if (autos.sub === 'abrir') {
      const botao = acharControle(CONFIG.labels.downloadCompleto);
      if (!botao) {
        log(`${rotuloAlvo}: botão "${CONFIG.labels.downloadCompleto}" não encontrado nesta tela. Gerando diagnóstico e pulando os autos deste item.`, 'erro');
        diagnosticoTela(`botão "${CONFIG.labels.downloadCompleto}" não encontrado (${rotuloAlvo})`);
        throw new Error('Etapa dos autos incompleta; confira a tela.');
      }
      autos.sub = 'opcoes';
      saveTarefa(tarefa); // ANTES do clique: se navegar, a sub-fase já está salva
      log(`${rotuloAlvo}: abrindo "${CONFIG.labels.downloadCompleto}".`);
      botao.click();
      const apareceu = await aguardarControle(CONFIG.labels.gerarArquivoCompleto, {
        timeoutMs: CONFIG.downloadCompleto.timeoutTelaMs,
      });
      if (!apareceu) {
        log(`${rotuloAlvo}: cliquei em "${CONFIG.labels.downloadCompleto}", a página não navegou e a tela de opções não apareceu em ${Math.round(CONFIG.downloadCompleto.timeoutTelaMs / 1000)}s. Se o eproc abriu a tela numa ABA NOVA, é lá que o trabalho continua — esta aba desiste. Gerando diagnóstico.`, 'erro');
        diagnosticoTela(`tela de opções não apareceu depois do clique em "${CONFIG.labels.downloadCompleto}" (${rotuloAlvo})`);
        throw new Error('Etapa dos autos incompleta; confira a tela.');
      }
      return 'prosseguir';
    }

    if (autos.sub === 'opcoes') {
      const gerar = await aguardarControle(CONFIG.labels.gerarArquivoCompleto, {
        timeoutMs: CONFIG.downloadCompleto.timeoutTelaMs,
      });
      if (!gerar) {
        log(`${rotuloAlvo}: a tela de opções do Download Completo não apareceu (botão "${CONFIG.labels.gerarArquivoCompleto}" não encontrado). Gerando diagnóstico e pulando os autos deste item.`, 'erro');
        diagnosticoTela(`tela de opções não apareceu (${rotuloAlvo})`);
        throw new Error('Etapa dos autos incompleta; confira a tela.');
      }
      // Marcar as três opções obrigatórias ANTES de gerar — depois do clique
      // em "Gerar" já não adianta (o PDF sai como as opções estavam).
      configurarOpcoesDownloadCompleto(rotuloAlvo);
      autos.sub = 'gerando';
      autos.tentativas = 0;
      autos.partesFeitas = [];
      saveTarefa(tarefa);
      log(`${rotuloAlvo}: clicando em "${CONFIG.labels.gerarArquivoCompleto}" — isso pode levar vários minutos.`);
      gerar.click();
      return 'prosseguir'; // quem espera é a sub-fase 'gerando'
    }

    if (autos.sub === 'gerando') {
      // Espera longa e com log de progresso: o eproc pode levar ~10 min num
      // processo grande, e uma espera silenciosa parece travamento. As
      // primeiras verificações são rápidas (processo pequeno fica pronto em
      // segundos e não faz sentido pagar 15s por isso).
      for (let i = autos.tentativas || 0; i < CONFIG.pollDownloadCompletoMaxTentativas; i++) {
        if (temTextoNaPagina(CONFIG.labels.geradoComSucesso) || acharControle(CONFIG.labels.baixarArquivo)) {
          autos.sub = 'baixando';
          saveTarefa(tarefa);
          log(`${rotuloAlvo}: arquivo completo gerado.`);
          return 'prosseguir';
        }
        autos.tentativas = i + 1;
        saveTarefa(tarefa);
        sinalizarVida(tarefa);
        if ((i + 1) % 4 === 0) {
          const minutos = Math.round(((i + 1) * CONFIG.pollDownloadCompletoMs) / 60000);
          log(`${rotuloAlvo}: ainda gerando o arquivo completo (~${minutos} min).`);
        }
        await sleep(i < 5 ? 2000 : CONFIG.pollDownloadCompletoMs);
      }
      log(`${rotuloAlvo}: o arquivo completo não ficou pronto dentro do limite (~${Math.round((CONFIG.pollDownloadCompletoMaxTentativas * CONFIG.pollDownloadCompletoMs) / 60000)} min). Gerando diagnóstico e seguindo — baixe este processo manualmente.`, 'erro');
      diagnosticoTela(`arquivo completo não ficou pronto no limite (${rotuloAlvo})`);
      throw new Error('Etapa dos autos incompleta; confira a tela.');
    }

    if (autos.sub === 'baixando') {
      await aguardarPartesEstaveis();
      const resultado = await baixarPartesDosAutos(prefixo, {
        numeroProcesso,
        ip,
        // Se um clique em "BAIXAR ARQUIVO PARTE n" navegar a página, esta aba
        // morre e retoma em 'baixando' — sem esta lista, as partes já baixadas
        // seriam baixadas de novo.
        jaFeitas: autos.partesFeitas || [],
        aoBaixar: (parte) => {
          autos.partesFeitas = (autos.partesFeitas || []).concat(parte);
          saveTarefa(tarefa);
        },
      });
      if (resultado.baixadas > 0) {
        log(`${rotuloAlvo}: ${resultado.baixadas} parte(s) dos autos baixada(s)${resultado.viaClique ? ` (${resultado.viaClique} por clique — nome dado pelo eproc, ver manifesto)` : ''}.`);
      }
      return 'terminado';
    }

    log(`${rotuloAlvo}: sub-fase de autos desconhecida ("${autos.sub}") — pulando os autos deste item.`, 'erro');
    throw new Error('Etapa dos autos incompleta; confira a tela.');
  }

  function temTextoNaPagina(texto) {
    const body = document.body.cloneNode(true);
    body.querySelectorAll('#eproc-dl-painel,script,style').forEach(el => el.remove());
    return normalizar(body.textContent || '').includes(normalizar(texto));
  }

  // Prepara a tarefa da aba para entrar na etapa de autos.
  function entrarEmAutos(tarefa, { numeroProcesso, ip = null }) {
    tarefa.autos = {
      sub: 'abrir',
      tentativas: 0,
      partesFeitas: [],
      contexto: {
        numeroProcesso,
        ip,
        prefixo: ip
          ? `${nomeSeguro(numeroProcesso)}__IP_${nomeSeguro(ip)}`
          : nomeSeguro(numeroProcesso),
      },
    };
    tarefa.fase = 'autos';
    saveTarefa(tarefa);
  }

  // ======================================================================
  // Botão "Baixar autos desta página": roda o Download Completo no processo
  // que já está aberto, sem CSV e sem fila.
  //
  // É o plano B deliberado para um dia de trabalho: se a automação da fila
  // esbarrar em qualquer coisa não prevista, dá para abrir o processo à mão e
  // clicar aqui — perde-se a automação da lista, não o dia. Reaproveita a
  // mesma sub-máquina, com uma tarefa avulsa (que não mexe na fila).
  // ======================================================================
  async function baixarAutosDaPaginaAtual() {
    const numeroProcesso = numeroDoProcessoDaPagina();
    if (!numeroProcesso) {
      log('Não consegui identificar o número do processo desta página — abra um processo antes de usar este botão. Gerando diagnóstico de tela.', 'erro');
      diagnosticoTela('número do processo não identificado na página atual');
      return;
    }
    const tarefa = {
      tipo: 'avulso',
      numero: numeroProcesso,
      processoPai: null,
      fase: 'autos',
      autos: null,
      abertaPeloScript: false,
    };
    entrarEmAutos(tarefa, { numeroProcesso });
    log(`${numeroProcesso}: baixando autos desta página (modo avulso, fora da fila).`);
    await avancarAba();
  }

  // Número do processo a partir da própria página. Tenta a URL primeiro
  // (num_processo=... vem sem pontuação) e cai para o texto da página.
  function numeroDoProcessoDaPagina() {
    const body = document.body.cloneNode(true);
    body.querySelectorAll('#eproc-dl-painel,script,style').forEach(el => el.remove());
    const daPagina = (body.textContent || '').match(
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

  // ======================================================================
  // MODO MULTI-ABA (v0.5.0) — o que mudou e por quê
  //
  // Até a v0.4.0 uma aba só fazia tudo, um processo por vez. O gargalo é o
  // "Gerar Arquivo Completo", que leva minutos por processo: nove processos
  // eram nove esperas somadas, e o dia acabava antes da fila.
  //
  // Agora a aba onde o CSV foi importado vira COORDENADORA e abre UMA ABA POR
  // PROCESSO (até `opcoes.maxAbas` ao mesmo tempo). Cada aba faz o processo
  // inteiro sozinha e devolve o resultado ao estado global. Os inquéritos
  // policiais referenciados entram na mesma fila e também ganham aba própria,
  // em vez de serem rebuscados dentro da aba do processo — que era o que
  // obrigava tudo a ser sequencial.
  //
  // Três peças fazem isso funcionar:
  //  - sessionStorage é POR ABA (GM_setValue é global): é onde cada aba guarda
  //    "qual é a minha tarefa e em que passo estou", e sobrevive à navegação
  //    da busca dentro da própria aba.
  //  - sleep() por Web Worker (ver o comentário lá em cima): sem isso, o
  //    Chrome estrangularia os temporizadores das N-1 abas em segundo plano.
  //  - só a coordenadora chama window.open. As abas de trabalho apenas
  //    ACRESCENTAM itens à fila (os IPs que encontram); quem abre é sempre a
  //    coordenadora, que é também quem respeita o limite de abas simultâneas.
  //
  // REQUISITO DO NAVEGADOR: o Chrome precisa PERMITIR POP-UPS para o eproc,
  // senão window.open devolve null. Quando isso acontece o script avisa e cai
  // sozinho para o modo sequencial na própria aba — mais lento, mas não perde
  // o dia.
  //
  // Sobre corrida entre abas: todas escrevem no mesmo estado global via
  // GM_setValue (ler-modificar-gravar, sem transação). As escritas são raras
  // (mudança de status e um sinal de vida a cada ~20s), e a única que não pode
  // se perder — o status final — é conferida e reescrita até valer.
  // ======================================================================

  let processandoAba = false;  // trava de reentrância dentro de UMA carga de página
  let supervisionando = false;

  // ----------------------------------------------------------------------
  // A aba de trabalho: leva UMA tarefa (um processo ou um IP) do começo ao
  // fim. Cada ramo ou (a) termina o passo e faz `continue`, sem navegar, ou
  // (b) dispara algo que navega a página e faz `return` — o resto acontece na
  // próxima carga, quando avancarAba() rodar de novo a partir do que ficou
  // salvo no sessionStorage.
  // ----------------------------------------------------------------------
  async function avancarAba() {
    if (!navigator.locks) throw new Error('Navegador sem suporte à coordenação segura de abas.');
    return navigator.locks.request('eproc:' + JSON.stringify(loadTarefa() && [loadTarefa().tipo, loadTarefa().numero, loadTarefa().processoPai]), { ifAvailable: true }, async lock => {
      if (!lock) { log('Este trabalho já está ativo em outra aba.', 'aviso'); return; }
      return avancarAbaInterno();
    });
  }

  async function avancarAbaInterno() {
    if (processandoAba) return;
    processandoAba = true;
    try {
      while (true) {
        const tarefa = loadTarefa();
        if (!tarefa) return;

        const global = loadState();
        if (tarefa.tipo !== 'avulso' && tarefa.loteId !== (global?.loteId || 'avulso')) throw new Error('Esta aba pertence a outro lote; feche-a para evitar misturar resultados.');
        if (tarefa.tipo !== 'avulso' && global && global.pausado) {
          log(`${rotuloTarefa(tarefa)}: fila pausada — esta aba parou aqui. Clique em "Iniciar" na aba principal para retomar.`, 'aviso');
          sinalizarVida(tarefa);
          await sleep(2000);
          continue;
        }
        sinalizarVida(tarefa);

        if (tarefa.fase === 'buscar') {
          const caixaBusca = findSearchBox();
          if (!caixaBusca) {
            finalizarTarefa(tarefa, 'erro', 'caixa de pesquisa não encontrada nesta aba — ajuste CONFIG.searchBoxSelectors');
            return;
          }
          tarefa.fase = 'eventos';
          saveTarefa(tarefa); // ANTES da busca: ela navega a página
          log(`${rotuloTarefa(tarefa)}: buscando.`);
          dispararBusca(caixaBusca, tarefa.numero);
          // Se a busca navegar (é o caso confirmado em 03/09/2026), este await
          // morre junto com a página e a carga seguinte retoma em 'eventos'.
          // Se NÃO navegar (AJAX), a tabela aparece aqui e seguimos inline.
          const tabela = await aguardarElemento(CONFIG.tabelaEventosSelector, { timeoutMs: 25000 });
          if (tabela && (numeroDoProcessoDaPagina() || '').replace(/\D/g, '') === tarefa.numero.replace(/\D/g, '')) continue;
          log(`${rotuloTarefa(tarefa)}: busca disparada, mas a página não navegou nem trouxe a tabela de eventos em 25s. Aguardando — se ficar assim, confira o número e recarregue esta aba.`, 'aviso');
          return;
        }

        if (tarefa.fase === 'eventos') {
          const tabela = await aguardarElemento(CONFIG.tabelaEventosSelector, { timeoutMs: 25000 });
          if (!tabela) {
            finalizarTarefa(tarefa, 'erro', 'a tabela de eventos não apareceu depois da busca — confira o número do processo');
            return;
          }
          if ((numeroDoProcessoDaPagina() || '').replace(/\D/g, '') !== tarefa.numero.replace(/\D/g, '')) throw new Error('A página aberta não corresponde ao processo solicitado.');
          await carregarTodosOsEventos();
          const eventos = lerEventos();
          const linhasEventos = lerLinhasEventos(eventos);
          if (linhasEventos.length === 0) {
            log(`${rotuloTarefa(tarefa)}: tabela de eventos encontrada, mas nenhum documento foi lido (${eventos.length} linha(s) de evento). Clique em "Diagnóstico" no painel e mande o arquivo gerado.`, 'aviso');
          }

          const opcoes = loadOpcoes();

          // Os IPs entram na FILA GLOBAL e serão abertos pela coordenadora em
          // abas próprias — esta aba não os processa nem espera por eles.
          if (tarefa.tipo === 'processo' && opcoes.ips) {
            const ips = encontrarIPsReferenciados();
            if (ips.length > 0) {
              const novos = enfileirarIPs(tarefa.numero, ips);
              log(`${tarefa.numero}: ${ips.length} inquérito(s) policial(is) referenciado(s): ${ips.join(', ')}${novos ? ` — ${novos} acrescentado(s) à fila, cada um numa aba própria.` : ' (já estavam na fila).'}`);
            }
          }

          if (opcoes.denuncia && tarefa.tipo === 'processo') {
            try {
              await tratarDenuncia(tarefa.numero, linhasEventos, eventos);
            } catch (e) {
              // A denúncia é importante, mas os AUTOS são o que não pode faltar
              // no dia da audiência: um erro aqui não derruba o resto.
              tarefa.falhaParcial = true; saveTarefa(tarefa);
              log(`${tarefa.numero}: falha ao baixar a denúncia (${e && e.message ? e.message : e}) — seguindo para os autos.`, 'erro');
            }
          }

          if (opcoes.midia) {
            await tratarMidia(
              tarefa.tipo === 'ip' ? tarefa.processoPai : tarefa.numero,
              linhasEventos,
              tarefa.tipo === 'ip' ? { prefixoExtra: `IP_${nomeSeguro(tarefa.numero)}` } : {}
            );
          }

          if (opcoes.autos) {
            // Autos do IP levam o número do PROCESSO PAI no nome — é o que
            // permite saber, olhando a pasta de downloads, de que processo
            // aquele inquérito veio.
            entrarEmAutos(tarefa, {
              numeroProcesso: tarefa.tipo === 'ip' ? tarefa.processoPai : tarefa.numero,
              ip: tarefa.tipo === 'ip' ? tarefa.numero : null,
            });
            continue;
          }
          tarefa.fase = 'concluir';
          saveTarefa(tarefa);
          continue;
        }

        if (tarefa.fase === 'autos') {
          const resultado = await avancarAutos(tarefa);
          if (resultado === 'prosseguir') continue; // <- o conserto da v0.5.0
          tarefa.autos = null;
          tarefa.fase = 'concluir';
          saveTarefa(tarefa);
          continue;
        }

        if (tarefa.fase === 'concluir') {
          finalizarTarefa(tarefa, tarefa.falhaParcial ? 'erro' : 'concluido', tarefa.falhaParcial ? 'Autos processados, mas houve falha em documento; confira o log.' : '');
          return;
        }

        log(`${rotuloTarefa(tarefa)}: fase desconhecida ("${tarefa.fase}") — esta aba parou.`, 'erro');
        finalizarTarefa(tarefa, 'erro', `fase desconhecida "${tarefa.fase}"`);
        return;
      }
    } catch (e) {
      const tarefa = loadTarefa();
      if (tarefa) {
        log(`${rotuloTarefa(tarefa)}: erro inesperado (${e && e.message ? e.message : e}).`, 'erro');
        finalizarTarefa(tarefa, 'erro', String((e && e.message) || e));
      } else {
        log(`Erro inesperado nesta aba: ${e && e.message ? e.message : e}`, 'erro');
      }
    } finally {
      processandoAba = false;
      renderStatus();
    }
  }

  // Sinal de vida da aba, para a coordenadora saber que ela não travou.
  // Estrangulado a 1 escrita por 20s: com N abas escrevendo no mesmo estado
  // global, escrever a cada volta do laço só aumentaria a chance de corrida.
  let ultimoSinalEnviado = 0;
  function sinalizarVida(tarefa) {
    if (!tarefa || tarefa.tipo === 'avulso') return;
    const agora = Date.now();
    if (agora - ultimoSinalEnviado < 20000) return;
    ultimoSinalEnviado = agora;
    const state = loadState();
    if (state) GM_setValue(chaveRelato(state, tarefa, 'vida'), agora);
  }

  // O status final é a única escrita que não pode se perder numa corrida entre
  // abas: confere e reescreve até valer.
  function finalizarTarefa(tarefa, status, observacao) {
    if (tarefa.tipo === 'avulso') {
      if (status === 'erro') { log(observacao, 'erro'); return; }
      clearTarefa();
      log(`${tarefa.numero}: autos desta página processados (modo avulso). A fila do CSV não foi tocada.`);
      renderStatus();
      return;
    }

    const state = loadState();
    if (state) GM_setValue(chaveRelato(state, tarefa), { status, observacao: sanitizar(observacao || ''), ultimoSinal: Date.now() });
    if (status === 'concluido') clearTarefa();
    log(
      status === 'concluido'
        ? `${rotuloTarefa(tarefa)}: concluído.`
        : `${rotuloTarefa(tarefa)}: ERRO — ${observacao}`,
      status === 'concluido' ? 'info' : 'erro'
    );
    renderStatus();

    const opcoes = loadOpcoes();
    if (status === 'concluido' && tarefa.abertaPeloScript && opcoes.fecharAba) {
      log(`${rotuloTarefa(tarefa)}: esta aba fecha em ${Math.round(CONFIG.multiAba.atrasoParaFecharMs / 1000)}s (desmarque "fechar aba ao terminar" no painel para mantê-la aberta).`);
      sleep(CONFIG.multiAba.atrasoParaFecharMs).then(() => {
        try {
          window.close();
        } catch (e) { /* o navegador pode recusar; a aba só fica aberta */ }
      });
    } else if (!tarefa.abertaPeloScript && ehCoordenadora()) {
      // Esta é a aba coordenadora, que assumiu a tarefa por falta de pop-up:
      // volta a supervisionar a fila.
      sleep(500).then(() => supervisionar().catch((e) => log(`Supervisão falhou: ${e && e.message ? e.message : e}`, 'erro')));
    }
  }

  // Acrescenta os IPs encontrados à fila global. Devolve quantos eram novos.
  function enfileirarIPs(processoPai, ips) {
    const state = loadState();
    if (!state) return 0;
    const key = chaveRelato(state, {numero: processoPai, tipo: 'processo'}, 'ips');
    const anteriores = GM_getValue(key, []);
    const todos = [...new Set([...anteriores, ...ips])];
    GM_setValue(key, todos);
    return todos.length - anteriores.length;
  }

  // ----------------------------------------------------------------------
  // A aba coordenadora: mantém até `maxAbas` itens em andamento e vai abrindo
  // os próximos conforme as abas terminam. Nunca processa nada por si — a não
  // ser quando os pop-ups estão bloqueados (ver assumirTarefaNestaAba).
  // ----------------------------------------------------------------------
  async function supervisionar() {
    if (!navigator.locks) throw new Error('Navegador sem suporte à coordenação segura de abas.');
    return navigator.locks.request('eproc:' + 'coordenadora', { ifAvailable: true }, async lock => {
      if (!lock) { log('Este trabalho já está ativo em outra aba.', 'aviso'); return; }
      return supervisionarInterno();
    });
  }

  async function supervisionarInterno() {
    if (supervisionando) return;
    supervisionando = true;
    try {
      while (true) {
        const state = loadState();
        if (!state) return;
        if (state.pausado) {
          log('Fila pausada — a coordenadora parou de abrir abas novas.');
          return;
        }

        const opcoes = loadOpcoes();
        const maxAbas = Math.max(1, Math.min(12, Number(opcoes.maxAbas) || CONFIG.multiAba.maxAbasSimultaneas));

        // Libera a vaga de abas que morreram (usuário fechou, travou, caiu).
        const agora = Date.now();
        let mudou = false;
        for (const item of state.fila) {
          if (item.status !== 'em_andamento') continue;
          if (!item.ultimoSinal || agora - item.ultimoSinal <= CONFIG.multiAba.timeoutSemSinalMs) continue;
          item.status = 'erro';
          item.observacao = 'a aba parou de dar sinal de vida';
          mudou = true;
          log(`${rotuloItem(item)}: sem sinal de vida há mais de ${Math.round(CONFIG.multiAba.timeoutSemSinalMs / 60000)} min — marcado como erro e a vaga liberada. Confira se a aba ainda está aberta.`, 'erro');
        }
        if (mudou) saveState(state);

        const emAndamento = state.fila.filter((p) => p.status === 'em_andamento');
        const pendentes = state.fila.filter((p) => p.status === 'pendente');

        if (pendentes.length === 0 && emAndamento.length === 0) {
          const concluidos = state.fila.filter((p) => p.status === 'concluido').length;
          const erros = state.fila.filter((p) => p.status === 'erro').length;
          renderStatus();
          log(`Fila concluída: ${concluidos} item(ns) concluído(s)${erros ? `, ${erros} com erro (veja o log acima e o Manifesto)` : ''}.`);
          return;
        }

        const vagas = maxAbas - emAndamento.length;
        for (let i = 0; i < Math.min(vagas, pendentes.length); i++) {
          // Relê a cada abertura: as abas de trabalho escrevem no mesmo estado.
          const atual = loadState();
          const alvo = acharItem(atual, pendentes[i]);
          if (!alvo || alvo.status !== 'pendente') continue;
          alvo.status = 'em_andamento';
          alvo.ultimoSinal = Date.now();
          saveState(atual);
          if (!abrirAbaParaItem(alvo)) {
            assumirTarefaNestaAba(alvo);
            return;
          }
          await sleep(CONFIG.multiAba.atrasoEntreAberturasMs);
        }

        renderStatus();
        await sleep(CONFIG.multiAba.intervaloSupervisaoMs);
      }
    } finally {
      supervisionando = false;
    }
  }

  // A aba nova nasce na MESMA URL desta (que já está autenticada e tem a caixa
  // de busca) com a tarefa no fragmento. Não dá para montar a URL direta do
  // processo: ela leva um `hash=` que o eproc gera e que não temos.
  function urlBaseParaAbas() {
    return location.href.split('#')[0];
  }

  function abrirAbaParaItem(item) {
    const tarefa = { tipo: item.tipo, numero: item.numero, processoPai: item.processoPai || null };
    const url = `${urlBaseParaAbas()}#eprocdl=${encodeURIComponent(JSON.stringify(tarefa))}`;
    let janela = null;
    try {
      janela = window.open(url, '_blank');
    } catch (e) {
      janela = null;
    }
    if (!janela) {
      log('O navegador BLOQUEOU a abertura de abas novas (pop-ups). Permita pop-ups para este site — ícone na barra de endereço → "Sempre permitir pop-ups de..." — e clique em "Iniciar" de novo. Enquanto isso, os itens vão rodar um de cada vez NESTA aba.', 'erro');
      return false;
    }
    log(`${rotuloItem(item)}: aba aberta.`);
    return true;
  }

  // Plano B quando os pop-ups estão bloqueados: a própria coordenadora faz o
  // item, e volta a supervisionar quando terminar (ver finalizarTarefa).
  function assumirTarefaNestaAba(item) {
    if (loadTarefa()) return;
    saveTarefa({
      tipo: item.tipo,
      numero: item.numero,
      processoPai: item.processoPai || null,
      fase: 'buscar',
      autos: null,
      abertaPeloScript: false,
    });
    log(`${rotuloItem(item)}: rodando nesta mesma aba (modo sequencial).`, 'aviso');
    sleep(200).then(() => avancarAba());
  }

  // A aba recém-aberta lê sua tarefa do fragmento da URL e a guarda no
  // sessionStorage — que é onde ela sobrevive às navegações seguintes.
  // O fragmento é apagado logo em seguida para que um F5 não reinicie tudo.
  function adotarTarefaDaUrl() {
    const m = location.hash.match(/eprocdl=([^&]+)/);
    if (!m) return;
    let dados = null;
    try {
      dados = JSON.parse(decodeURIComponent(m[1]));
    } catch (e) {
      return;
    }
    try {
      history.replaceState(null, '', urlBaseParaAbas());
    } catch (e) {
      location.hash = '';
    }
    // O Chrome CLONA o sessionStorage da aba de origem para a aba nova: a
    // marca de coordenadora vem junto e precisa sair, senão esta aba também
    // começaria a abrir abas.
    try {
      sessionStorage.removeItem(COORDENADORA_KEY);
    } catch (e) { /* nada a fazer */ }
    saveTarefa({
      tipo: dados.tipo || 'processo',
      numero: dados.numero,
      processoPai: dados.processoPai || null,
      fase: 'buscar',
      autos: null,
      abertaPeloScript: true,
    });
  }

  // ======================================================================
  // Gancho de teste: quando globalThis.__EPROC_TESTE__ existe (só em
  // scripts/testar-leitura-eventos.js, nunca no navegador), expõe as funções
  // de leitura da tabela para poderem ser rodadas contra HTML real capturado
  // pelo Diagnóstico. Testar uma cópia das funções não pegaria justamente os
  // erros que já custaram três rodadas — o valor está em rodar ESTE código.
  if (typeof globalThis !== 'undefined' && globalThis.__EPROC_TESTE__) {
    globalThis.__EPROC_TESTE__ = {
      chaveRelato, sinalizarVida, enfileirarIPs, finalizarTarefa, loadTarefa, saveTarefa,
      baixarComoArquivo, resolverDocumento, urlDoControle, sanitizar, configurarOpcoesDownloadCompleto, avancarAutos, baixarPartesDosAutos, newState, loadState, saveState,
      CONFIG, lerEventos, lerLinhasEventos, localizarEvento1,
      documentosDaLinha, documentoDoLink, eventoDaLinha, descricaoDoEvento,
      tabelaEventos, linhasDeEvento, numeroDoEvento,
      // v0.5.0: a resolução do link do evento para o arquivo de verdade é a
      // peça que faltava para o download funcionar — e dá para testá-la sem
      // o site, alimentando HTML de página intermediária.
      candidatosDeArquivo, normalizar, pareceHtml,
    };
    return; // não monta painel nem inicia a fila em ambiente de teste
  }

  function iniciar() {
    if (window.top !== window.self) return;
    // 1) Aba recém-aberta pela coordenadora: pega a tarefa do fragmento da URL.
    //    Antes de montar o painel, para ele já nascer mostrando a tarefa certa.
    adotarTarefaDaUrl();
    criarPainel();
    // 2) Aba de trabalho (inclusive retomando depois de a busca navegar):
    //    continua de onde parou, a partir do que está no sessionStorage.
    if (loadTarefa()) {
      avancarAba().catch((e) => log(`Erro inesperado nesta aba: ${e && e.message ? e.message : e}`, 'erro'));
      return;
    }
    // 3) Aba coordenadora: retoma a supervisão da fila. Só a aba onde se
    //    clicou "Iniciar" carrega essa marca — sem isso, cada aba de trabalho
    //    também começaria a abrir abas.
    if (!ehCoordenadora()) return;
    const state = loadState();
    if (state && !state.pausado && state.fila.some((p) => p.status === 'pendente' || p.status === 'em_andamento')) {
      supervisionar().catch((e) => log(`Supervisão falhou: ${e && e.message ? e.message : e}`, 'erro'));
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();

