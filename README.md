# BuildOps Platform

Plataforma interna de gestão para um grupo de empresas de construção, urbanismo e imóveis.
Um único aplicativo para **Android, iOS e web**, construído em etapas.

| Etapa | Módulo | Status |
| --- | --- | --- |
| 0 | Descoberta: acesso aos sistemas atuais e mapa dos dados | planejada |
| 1 | **Controle de estoque** | em desenvolvimento |
| 2 | Relatório diário de obra (áudio, fotos e IA) | planejada |
| 3 | Cronograma ligado ao relatório e ao estoque | planejada |

## Stack

- **App**: [Expo](https://expo.dev) + React Native + TypeScript, com Expo Router. Um código para Android, iOS e web.
- **Backend**: [Supabase](https://supabase.com): Postgres, autenticação, storage de fotos e Row Level Security (RLS) por empresa e centro de custo.
- **Monorepo**: pnpm workspaces.

## Estrutura

```
apps/
  mobile/            App Expo (Android, iOS e web)
packages/
  shared/            Tipos e regras de domínio compartilhados
supabase/
  migrations/        Schema do banco (SQL versionado)
  seed.sql           Dados de exemplo para desenvolvimento
docs/
  arquitetura.md     Visão geral e decisões técnicas
  estoque.md         Escopo e regras do módulo de estoque
```

## Como rodar

Pré-requisitos: Node.js 20+, pnpm 12+ e Docker Desktop (para o Supabase local).
O Supabase CLI vem como dependência do projeto e roda via `pnpm supabase`.

```bash
pnpm install

# banco local com schema e dados de exemplo
pnpm supabase init        # só na primeira vez; mantém as migrations existentes
pnpm db:start
pnpm db:reset

# app
cp apps/mobile/.env.example apps/mobile/.env   # preencha com a URL e a chave do `pnpm supabase status`
pnpm dev                  # QR code para o Expo Go; tecle "w" para abrir no navegador
```

Ao atualizar o Expo SDK, rode `pnpm --filter mobile exec expo install --fix` para alinhar as dependências.

## Documentação

- [Arquitetura](docs/arquitetura.md)
- [Módulo de estoque](docs/estoque.md)
