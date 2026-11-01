# Seleção de flexibilidade — cenários para discussão

Preparado em 1 de novembro de 2026. **Nenhuma das políticas abaixo está aprovada
ou implementada.** A demonstração está em `/demo/flexibility`; os resultados são
simulados e não acionam equipamentos.

## As duas decisões

1. Que informação de flexibilidade é válida para este equipamento e período?
2. Dentro dessa flexibilidade, em que horário deve o equipamento funcionar?

Estamos a preparar a primeira. A segunda pertence ao planeamento/otimização.
Pontual e recorrente são ambas declarações do utilizador. Forecast é uma estimativa;
não pressupomos que prevê disponibilidade enquanto Bernardo não confirmar.

## Exemplo para abrir a conversa

O EV da Casa A tem uma declaração recorrente das 18h às 08h. Para amanhã, existe
também um pedido pontual das 19h às 07h. A previsão estima chegada às 20h.

- O pontual substitui a ocorrência inteira ou só acrescenta restrições?
- Chegada às 20h significa chegada a casa, ligação ao carregador ou disponibilidade?
- Se a previsão for de chegada e tivermos uma observação de ligação às 18h30,
  qual a informação atual que deve contar?
- Se o utilizador cancelar o pontual, regressamos ao recorrente ou queria dizer
  que o carro não está disponível nessa noite? Precisamos de distinguir as ações.
- Que registo permite explicar depois por que foi usada determinada janela?

## Casos a decidir

| Caso | Situação | Questão / condição a preservar |
| --- | --- | --- |
| 1 | Só existe pedido recorrente | É suficiente para avançar? Identificar ocorrência, autor e revisão. |
| 2 | Pontual sobrepõe-se ao recorrente | Substituição, interseção das restrições ou conflito explícito? |
| 3 | Dois pedidos pontuais incompatíveis | Não confundir duas declarações distintas com revisões do mesmo pedido. |
| 4 | Forecast de chegada mais tarde | Chegada, ligação ao carregador e disponibilidade são conceitos diferentes. |
| 5 | Forecast de utilização às 20h | Não inventar uma janela de liberdade a partir de uma hora habitual de utilização. |
| 6 | Há forecast, mas não há pedido explícito | Em que condições de participação do equipamento pode ser utilizado automaticamente? Sem aprovação humana de cada previsão. |
| 7 | Sem histórico / sem associação | Representar desconhecido; não transformar ausência de dados em disponibilidade zero. |
| 8 | Erro técnico / resultado atrasado | Que fontes continuam disponíveis e quando se volta a pedir previsão? |
| 9 | Forecast expirou | Guardar o histórico e distinguir validade da previsão de validade da janela prevista. |
| 10 | Cancelamento de um pedido | Não ressuscitar o pedido cancelado. Definir separadamente se outras fontes continuam elegíveis. |
| 11 | Reentrega ou revisão antiga | Uma única previsão por identidade/revisão; não substituir informação recente por antiga. |
| 12 | Noite com mudança de hora | Manter instantes inequívocos e duração real; não assumir sempre 14h entre as 18h e as 08h. |
| 13 | Ciclo Eco de 90 min não cabe | Não encurtar o programa nem prolongar a disponibilidade do utilizador silenciosamente. |
| 14 | Bomba precisa de 3h entre as 08h e as 12h | O funcionamento pode ser repartido? Existem tempos mínimos de marcha/paragem? |
| 15 | Climatização durante ocupação | A janela temporal deve preservar os limites de conforto aplicáveis. |
| 16 | Dados observados contradizem a previsão | Distinguir estado observado, previsão e declaração; não escolher só pela data mais recente. |

Os casos de bomba, climatização, observações e autorização sem pedido explícito
são discussão de domínio. Não estão simulados como dinâmicas físicas nesta UI.

## Políticas que podemos comparar

| Alternativa | Funcionamento | O que temos de avaliar |
| --- | --- | --- |
| Precedência explícita | Uma ordem configurada escolhe a fonte elegível. | É simples e explicável, mas uma ordem única pode ser inadequada para diferentes equipamentos e significados de forecast. |
| Restrições + estimativa | As declarações/limites aplicáveis delimitam o permitido; a previsão informa a disponibilidade provável dentro desse contexto. | Exige separar restrições obrigatórias de preferências e reconhecer casos inviáveis. Uma interseção cega também pode estar errada. |
| Pontuação contextual | Compara candidatos válidos usando origem, frescura, qualidade e contexto. | Requer métricas comparáveis, histórico de avaliação e explicação. Uma pontuação não deve ultrapassar direitos ou limites físicos. |

Proposta de método: começar por uma tabela de resultados esperados para estes
casos; comparar duas políticas determinísticas; só depois decidir onde um modelo
mais inteligente traz benefício. Nenhuma precedência fica escolhida por este texto.

## Registo de uma futura decisão

Equipamento, período, fontes consideradas e revisões, fontes rejeitadas e motivo,
política e versão, resultado escolhido ou ausência de escolha, limites aplicados e
instante da decisão. O método de histórico existente será reutilizado quando houver
decisões reais. Consultar a flexibilidade não deve criar uma decisão por si só.

## O que podemos validar já

Na demonstração: fontes e origens distintas; alteração/cancelamento pontual;
histórico preservado; receção simulada, reentrega e resultado antigo; ausência de
histórico, erro e expiração; separação de equipamentos; duração do ciclo da máquina;
noites de mudança de hora. A semântica e os testes da interface real continuam a
depender do acordo com Bernardo.

Revogações administrativas/expiração de permissões ficam adiadas em **SOF-259**,
no fundo do backlog, conforme indicação de Tiago.
