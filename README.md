# eproc-download-pub

Espelho **público** do userscript `eproc-downloader.user.js`, usado só como
fonte de auto-update do Tampermonkey.

O desenvolvimento acontece no repositório privado
`lordfenriss/dossies-audiencia-download` — este aqui contém apenas o arquivo do
userscript, porque o Tampermonkey não consegue baixar de um repositório privado
sem autenticação.

## Instalar

Abra este link no navegador com o Tampermonkey instalado — ele intercepta URLs
terminadas em `.user.js` e oferece instalar:

<https://raw.githubusercontent.com/lordfenriss/eproc-download-pub/main/eproc-downloader.user.js>

Instalando por aí (e não colando o código à mão), o Tampermonkey passa a
conferir atualizações sozinho.

## Atualizar

Automático. O Tampermonkey confere periodicamente (padrão: uma vez por dia) e
avisa quando o `@version` muda. Para forçar agora: painel do Tampermonkey →
**Utilitários** → *Procurar atualizações de userscript*.

O `raw.githubusercontent.com` tem cache de alguns minutos — se acabou de sair
uma versão, pode levar ~5 minutos para aparecer.
