# Relatório de revisão do projeto TerraByte

**Data:** 20 de outubro de 2026  
**Escopo:** leitura estática de `index.html`, `style.css` e `script.js`.  
**Objetivo:** fornecer contexto e achados para que o ChatGPT ajude a decidir os próximos passos.

## Resumo

A página está organizada em quatro áreas principais: simulação, pesquisa, equipe e referências. O JavaScript implementa controles, cálculo de potência e energia, animação, estados de falha e conclusão. A revisão não modificou os arquivos nem executou testes no navegador.

O problema mais evidente é a corrupção de caracteres acentuados, presente nos três arquivos. Os demais pontos são principalmente de clareza do modelo, acessibilidade, manutenção do CSS e confiabilidade das referências.

## Achados

### 1. Caracteres acentuados corrompidos — prioridade alta

**Arquivos:** `index.html`, `style.css` e `script.js`  
**Exemplos:** `ProtÃ³tipo`, `SimulaÃ§Ã£o`, `EficiÃªncia`.

O texto dos arquivos aparece com sequências típicas de codificação incorreta. O HTML declara UTF-8, mas essa declaração não corrige texto que já foi salvo corrompido. O problema atinge conteúdo visível, atributos, comentários e mensagens do JavaScript.

**Decisão sugerida:** verificar os bytes/codificação reais e restaurar os textos para português correto, salvando os três arquivos em UTF-8. Conferir especialmente nomes próprios, símbolos científicos e emojis antes de aplicar uma conversão em lote.

### 2. Semântica dos valores de potência — prioridade alta

**Arquivo:** `script.js`, linhas 193–220; fórmula e premissas em `index.html`, linhas 618–643.

`calculateTheoreticalPower()` calcula a potência disponível no vento e multiplica por `Cp` e pela eficiência. Assim, o valor exibido como “potência teórica” já incorpora fatores de conversão/perda. A fórmula publicada na página também inclui esses fatores. O limite nominal de 1 kW é aplicado separadamente à potência considerada.

**Decisão sugerida:** escolher e documentar claramente os conceitos exibidos. Uma opção é separar “potência disponível no vento” (½ρAv³) de “potência estimada do modelo” (½ρAv³ × Cp × η), mantendo o limite nominal em um terceiro passo claramente explicado. Se preferirem manter apenas um valor, ajustar nome e descrição para não chamar de potência teórica disponível no vento.

### 3. Papel da tensão na simulação — prioridade média

**Arquivo:** `script.js`, linhas 230–242 e 281–299; descrição em `index.html`, linhas 641–643.

A tensão altera a RPM estimada e pode acionar a falha acima de 2,5 V, mas não entra no cálculo de potência ou energia. As premissas informam que a tensão de 1,5 V é um dado do protótipo e não representa tensão gerada nem potência de saída; a RPM também é uma estimativa visual.

**Decisão sugerida:** decidir se a tensão deve permanecer como parâmetro visual do modelo. Se sim, reforçar junto ao controle e aos indicadores que ela afeta apenas a RPM/falha virtual e não a potência calculada. Se não, retirar ou redefinir o controle com base em dados do protótipo.

### 4. Acessibilidade da janela de conclusão — prioridade média

**Arquivo:** `script.js`, linhas 430–466 e 608–625; `index.html`, linhas 753–792.

A janela usa `role="dialog"`, `aria-modal` e `aria-labelledby`, e pode ser fechada pelo botão, clique no fundo ou Escape. Não há contenção de foco dentro da janela nem retorno do foco ao elemento que a abriu. O evento Escape também tenta fechar a janela mesmo quando ela está oculta.

**Decisão sugerida:** avaliar a implementação de gestão de foco (guardar o elemento de abertura, focar um elemento da janela, conter Tab/Shift+Tab e restaurar o foco ao fechar) e só processar Escape quando a janela estiver aberta.

### 5. Responsividade e manutenção do CSS — prioridade média/baixa

**Arquivo:** `style.css`, especialmente linhas 47–53, 109–110 e 120–202.

Há regras gerais reutilizáveis e regras específicas da simulação no mesmo arquivo. `.simulation` recebe estilos de painel e depois é redefinida como grade. A regra responsiva para `#turbine` nas linhas 109–110 é sucedida por uma regra posterior que fixa a largura em 260 px (linha 176), por isso aquela largura responsiva não prevalece. Em telas pequenas, o layout usa também `zoom: 0.55` (linha 202), comportamento cuja apresentação deve ser conferida nos navegadores-alvo.

**Decisão sugerida:** confirmar os navegadores e tamanhos de tela usados na feira. Depois, consolidar as regras por componente, remover declarações que não prevalecem e substituir `zoom` por dimensões/transformações responsivas se a validação mostrar diferenças entre navegadores.

### 6. Indicador de sistema online — prioridade baixa

**Arquivo:** `index.html`, linhas 19–22; estado de falha atualizado em `script.js`, linhas 386–403.

O texto “SISTEMA ONLINE” é estático, enquanto a simulação tem estados como parada, execução e falha simulada. Durante a falha, o indicador do cabeçalho pode continuar afirmando que o sistema está online.

**Decisão sugerida:** decidir se o indicador se refere à página ou à simulação. Se for da simulação, atualizá-lo conforme o estado; se for apenas decorativo, renomeá-lo para não sugerir um status funcional.

### 7. Referências da pesquisa — prioridade baixa

**Arquivo:** `index.html`, linhas 706–750.

As fontes são listadas como instituições e descrições gerais, sem links ou identificação de páginas/documentos específicos. Isso dificulta conferir os dados apresentados.

**Decisão sugerida:** incluir títulos, órgãos/autores, links diretos e, quando relevante, datas de acesso para as fontes efetivamente consultadas.

### 8. Legenda com nome acessível — prioridade baixa

**Arquivo:** `index.html`, linhas 98–101.

`aria-label` está aplicado a um `<div>` genérico. Sem um papel semântico adequado, o nome pode não ser exposto de forma consistente por tecnologias assistivas.

**Decisão sugerida:** usar `fieldset`/`legend`, ou atribuir um papel de grupo apropriado e confirmar a experiência com leitor de tela.

## Aspectos observados que parecem coerentes

- Os IDs consultados no JavaScript correspondem aos elementos apresentados no HTML; os acessos a elementos opcionais usam verificações ou encadeamento opcional.
- A execução só começa ao clicar em iniciar, bloqueia os controles durante a simulação e termina na duração escolhida.
- O acumulado de energia usa potência em watts multiplicada pelo tempo em horas, produzindo Wh; a exibição muda para kWh a partir de 1000 Wh.
- A troca de aba é contabilizada como pausa e grandes saltos de tempo são limitados no ciclo de animação.
- O reset restaura os valores padrão definidos em `DEFAULTS`.
- A página informa que os resultados são estimativas educacionais e não medições reais de uma turbina conectada à rede.

## Ordem de trabalho recomendada

1. Corrigir e validar a codificação dos três arquivos.
2. Decidir a nomenclatura e a apresentação da potência disponível, potência estimada e limite nominal.
3. Confirmar como a tensão deve ser explicada e qual é o comportamento desejado para ela.
4. Validar o layout da turbina nos dispositivos/navegadores usados na apresentação e ajustar o CSS.
5. Melhorar foco e semântica da janela/legenda.
6. Completar as referências e esclarecer o indicador “SISTEMA ONLINE”.

## Limites desta revisão

Esta foi uma leitura estática dos três arquivos encontrados na raiz do projeto. Não foram examinados outros tipos de arquivo, não foi feita validação científica das fontes externas e não foi executado teste visual ou funcional no navegador. Portanto, os pontos de responsividade e interação devem ser confirmados no ambiente de apresentação.
