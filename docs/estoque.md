# Módulo de estoque (Etapa 1)

Estoque de entrada e saída, separado por empresa e centro de custo, com visão unificada do grupo.

## Escopo

- [x] Modelo de dados: empresas, centros de custo, obras, depósitos e materiais
- [x] Perfis de acesso: diretoria, gestor, almoxarife e mestre de obras (RLS)
- [x] Movimentações imutáveis com bloqueio de saldo negativo
- [x] Transferência entre obras e entre empresas, com registro de quem autorizou
- [x] Saldo por depósito com alerta de estoque mínimo (RPC `get_stock_balances`)
- [x] Bucket de fotos de nota e material
- [x] App: login e tela de saldos
- [ ] Cadastros de materiais, depósitos e obras no app
- [x] Entrada, saída e ajuste pelo celular, com foto da nota ou do material
- [ ] Tela de transferência
- [ ] Saldos por obra, centro de custo e consolidado do grupo
- [ ] Painel web com filtros e exportação para Excel
- [ ] Leitura dos dados dos sistemas atuais (depende da Etapa 0)
- [ ] Gestão de usuários e vínculos pela diretoria

## Regras

1. **Toda movimentação tem empresa, depósito e centro de custo.** Depósito e centro de custo
   precisam ser da mesma empresa da movimentação (garantido por chave estrangeira composta).
2. **O saldo físico é por depósito e material.** O centro de custo indica a quem a entrada ou o
   consumo é apropriado.
3. **Não existe saída sem saldo.** O banco recusa saídas, transferências e ajustes negativos que
   deixariam o depósito com saldo abaixo de zero.
4. **Histórico não se edita.** Não há `update` nem `delete` em `stock_movements`. Erros são
   corrigidos com um ajuste de inventário, feito por gestor ou diretoria.
5. **Transferência gera duas movimentações** (`transfer_out` na origem e `transfer_in` no destino)
   ligadas ao mesmo registro em `transfers`. Na mesma empresa, quem autoriza é o gestor;
   entre empresas, a diretoria.
6. **Dados importados não se duplicam.** O par `external_system` + `external_ref` é único.

## Lançamento no app

A tela "Nova movimentação" só oferece os tipos, depósitos e centros de custo que o perfil pode usar
(regras espelhadas de `can_register_movement` em `packages/shared`). O banco continua sendo quem decide.

- Depósito de canteiro já sugere o centro de custo da obra.
- Quantidades no padrão brasileiro: `1.500` = mil e quinhentos, `2,5` = dois e meio. A tela mostra
  o valor interpretado antes de salvar.
- A foto é enviada antes do lançamento. Se o banco recusar o lançamento, a foto é apagada.
- Tocar num saldo abre o lançamento já com depósito e material preenchidos.

## Fotos

Bucket privado `movement-photos`, com caminho `{company_id}/{ano}/{mês}/{uuid}.jpg`. Só quem acessa
a empresa pode enviar ou ver as fotos dela. O caminho fica salvo em `stock_movements.photo_path`.

## A validar na Etapa 0

- Se o saldo deve ser controlado também por centro de custo (estoque "reservado" para uma obra),
  além do saldo físico do depósito.
- Lista real de centros de custo e obras de cada empresa, com o financeiro.
- Unidades de medida e categorias de materiais usadas hoje em cada sistema.
- Se o custo médio do material deve ser calculado no app ou lido dos sistemas atuais.
