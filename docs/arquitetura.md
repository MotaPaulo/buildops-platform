# Arquitetura

## Visão geral

```
 Celular (Android/iOS) ─┐
                        ├─► App Expo ──► Supabase ──► Postgres (RLS por empresa e centro de custo)
 Navegador (web) ───────┘                  │            Storage (fotos de notas e materiais)
                                           │            Auth (login e perfis)
                                           ▼
                              Integrações (leitura dos sistemas legados)
```

- **Um código, três plataformas.** A equipe de obra usa o celular; o escritório usa o navegador.
- **Leitura antes de substituição.** Os dados dos sistemas atuais de cada empresa entram com
  `source = 'integration'` (ou `'import'`, quando vierem de planilha), identificados por
  `external_system` + `external_ref`. Os sistemas legados continuam como fonte própria.
- **Empresa e centro de custo em tudo.** Toda movimentação carrega empresa e centro de custo.
  O acesso é decidido no banco, pelas políticas RLS, e não só na interface.
- **Dados do grupo.** O projeto Supabase de produção fica em conta contratada em nome do grupo.

## Decisões

| Decisão | Motivo |
| --- | --- |
| Expo + React Native | Um código para Android, iOS e web; publicação nas lojas com EAS. |
| Supabase | Postgres gerenciado com auth, storage e RLS; sem servidor próprio para manter. |
| Regras de acesso no banco (RLS) | O mesmo controle vale para app, painel web e integrações. |
| Movimentações imutáveis | Rastreabilidade: correções viram ajustes, nunca edição de histórico. |
| Saldo calculado, não armazenado | Uma única fonte de verdade; sem divergência entre saldo e histórico. Se o volume crescer, entra uma tabela de saldos mantida por trigger. |
| Monorepo pnpm | App, tipos compartilhados e banco versionados juntos. |

## Perfis

| Perfil | Escopo | Pode |
| --- | --- | --- |
| Diretoria | Grupo inteiro | Tudo, inclusive transferências entre empresas e gestão de acessos |
| Gestor | Empresa ou centro de custo | Cadastros, ajustes de inventário, autorizar transferências na empresa |
| Almoxarife | Empresa ou centro de custo | Entradas, saídas, depósitos, estoque mínimo, materiais |
| Mestre de obras | Empresa ou centro de custo | Registrar saídas (consumo) |

Um usuário pode ter mais de um vínculo (`memberships`), por exemplo gestor em uma empresa e
almoxarife em outra.
