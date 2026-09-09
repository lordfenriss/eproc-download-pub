# Downloader de autos do eproc

Versão **0.5.1**.

[Instalar ou atualizar no Tampermonkey](https://raw.githubusercontent.com/lordfenriss/eproc-download-pub/main/eproc-downloader.user.js)

Use Tampermonkey atualizado, com suporte a download de Blob (5.4.6226+), e recarregue o eproc após atualizar. Mantenha só uma cópia do userscript habilitada.

A fila CSV abre abas de processos e IPs com concorrência configurável (padrão 2). O script marca as três opções de Download Completo, aguarda geração e links estáveis e baixa as partes detectadas em ordem. Valida cabeçalho e marcador final do PDF e aguarda confirmação do gerenciador. Se o resultado de um download for incerto, use **Conferir download pendente**, confira a pasta e clique **Iniciar** na mesma aba.

Testes locais passaram; ainda é necessária validação no eproc real. Botões dependentes de JavaScript sem URL literal ou formulários POST podem exigir adaptação. Arquivos grandes usam memória para validação. Mais abas não garantem mais velocidade. Permita pop-ups para o eproc se desejar processamento paralelo.

Este repositório contém somente o userscript e instruções públicas. Não envie cookies, tokens, documentos judiciais ou URLs autenticadas em relatos de falha.
