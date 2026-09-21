# STANDLOUD CRM Interno V1

Ferramenta privada para a operação comercial da STANDLOUD: centraliza leads, pipeline, histórico de contatos, follow-ups, projetos, pagamentos e métricas básicas. Ela não é um SaaS público. O acesso web é protegido por uma sessão single-user assinada no Worker.

## Escopo da V1

- Dashboard com funil, follow-ups e resumo financeiro.
- CRUD de leads, classificação A/B/C derivada da pontuação e pipeline comercial.
- Histórico manual de atividades por lead.
- Projetos vinculáveis a leads e pagamentos parciais em centavos.
- D1 como banco compartilhado de produção, acessado por um Cloudflare Worker.
- Login single-user com sessão assinada e botão de logout.
- Hermes como assistente do CRM, acessível pela rota `/assistant` e pelo painel lateral, com consultas e alterações controladas quando solicitadas explicitamente.

Ficam fora do escopo: multiusuário, cadastro público, recuperação de senha, OAuth, envio de mensagens/e-mails, uploads, contabilidade e deploy automático. Não há dados comerciais ou fixtures versionados no repositório.

## Stack

- Next.js 16 / App Router, executado no Cloudflare Workers via vinext.
- TypeScript, Tailwind CSS e Zod.
- Prisma ORM 7 com `@prisma/adapter-d1`.
- Cloudflare D1 (SQLite) e Wrangler.
- Cloudflare Agents SDK + MCP SDK v2 via Streamable HTTP.
- Vitest para regras de negócio.

## Banco de dados e privacidade

O schema e as migrations estão versionados. Dados comerciais não estão: `.wrangler/`, arquivos SQLite, `.prisma.env`, `.env*`, exports e backups são ignorados pelo Git.

Em produção, o binding `DB` do Worker aponta ao D1 remoto configurado em `wrangler.jsonc`. Computadores diferentes e celular usam o mesmo banco remoto por meio do Worker; GitHub armazena somente código e migrations, nunca serve como sincronização de dados.

No desenvolvimento, Wrangler cria um D1 local em `.wrangler/state`. Esse arquivo é separado do banco remoto e pode conter somente dados locais de teste.

## Autenticação web single-user

As páginas `/`, `/dashboard`, `/leads`, `/leads/*`, `/finance` e `/assistant`, além das APIs internas que manipulam dados comerciais, exigem uma sessão válida. O login está em `/login`; o logout remove a sessão pelo botão **Sair** da navegação.

A sessão contém apenas uma expiração e é assinada no servidor com HMAC-SHA-256 via Web Crypto. O cookie `standloud_session` é `HttpOnly`, `SameSite=Lax`, usa `Path=/`, dura 12 horas e recebe `Secure` em produção. A senha não é armazenada no cookie, no frontend ou em logs.

Antes do deploy, configure os Worker Secrets de forma interativa; nunca coloque seus valores em arquivos do projeto:

```powershell
npx wrangler secret put STANDLOUD_ADMIN_PASSWORD
npx wrangler secret put STANDLOUD_SESSION_SECRET
npx wrangler secret put STANDLOUD_MCP_TOKEN
npx wrangler secret put HERMES_BASE_URL
npx wrangler secret put HERMES_API_KEY
```

`/mcp` não usa nem aceita essa sessão web: ele continua exigindo o Bearer `STANDLOUD_MCP_TOKEN` de forma independente.

## Pré-requisitos

- Node.js 22 ou superior.
- Uma conta Cloudflare somente ao configurar D1 remoto, Access e deploy.

## Desenvolvimento local

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
# Preencha os valores locais de .dev.vars; o arquivo é ignorado pelo Git.
npm run db:local:migrate
npm run dev
```

Abra `http://localhost:3000`. O comando `dev` gera o Prisma Client e as tipagens do Worker automaticamente. Não use `next dev` para testar fluxos de banco: o runtime suportado é o `vinext dev`, que fornece o binding D1 local.

Para testar somente o CRM, os valores `HERMES_BASE_URL` e `HERMES_API_KEY` podem ficar vazios: a interface indicará que Hermes está offline e o restante do sistema continuará disponível.

## Migrations

As migrations versionadas são [0001_init.sql](prisma/migrations/0001_init.sql) (CRM) e [0002_agent_audit_log.sql](prisma/migrations/0002_agent_audit_log.sql) (auditoria MCP). Para aplicá-las localmente:

```powershell
npm run db:local:migrate
```

Ao alterar `prisma/schema.prisma` no futuro, primeiro aplique todas as migrations existentes ao D1 local. Depois gere e revise uma migration incremental, escolhendo o próximo número sequencial:

```powershell
npx prisma migrate diff --config prisma.d1-local.config.ts --from-config-datasource --to-schema prisma/schema.prisma --script --output prisma/migrations/0002_descricao_da_mudanca.sql
npm run db:local:migrate
```

O config incremental lê o D1 local pelo helper oficial do adaptador Prisma. Revise o SQL antes de aplicá-lo.

## Criar e configurar D1 remoto

Para criar o banco de produção em uma nova conta Cloudflare:

```powershell
npx wrangler login
npx wrangler d1 create standloud-crm-prod
```

O segundo comando imprime o `database_id`. Substitua `REPLACE_WITH_D1_DATABASE_ID` em `wrangler.jsonc` pelo valor retornado e mantenha o binding como `DB`. Em seguida:

```powershell
npm run cf:typegen
npm run db:remote:migrate
```

`db:remote:migrate` aplica somente as migrations versionadas ao D1 remoto. Execute-o conscientemente antes do deploy após cada migration revisada.

## Cloudflare Access

Cloudflare Access não foi configurado nesta etapa e não é necessário para o login single-user da V1. Ele pode ser acrescentado posteriormente como uma camada adicional de perímetro, mas não substitui a autenticação de sessão nem o Bearer específico de `/mcp`.

## Backup manual do D1

Exporte fora do repositório, em uma pasta segura:

```powershell
npx wrangler d1 export standloud-crm-prod --remote --output ..\backup-standloud-crm.sql
```

Para restaurar em um banco D1 de destino, revise o SQL e execute:

```powershell
npx wrangler d1 execute standloud-crm-prod --remote --file ..\backup-standloud-crm.sql
```

Esses comandos manipulam dados reais; não os execute contra o banco de produção sem confirmar nome, destino e backup. Nunca adicione exports ao Git.

## Comandos úteis

```powershell
npm test
npm run lint
npm run build
npm run preview
```

O deploy está preparado, mas não é automático. Depois de criar D1, configurar o ID, executar migrations remotas e configurar Access, o comando futuro será:

```powershell
npm run deploy
```

Não execute o deploy antes de revisar a configuração e definir os Worker Secrets necessários.

## Limitações conhecidas

- Não há múltiplos usuários, recuperação de senha ou gestão de sessões por dispositivo; a V1 tem um único segredo de administrador.
- O adaptador Prisma/D1 atualmente não oferece garantias de transação. As alterações principais são gravadas antes dos registros de atividade de auditoria.
- Hermes depende do computador Windows e do Quick Tunnel estarem ativos; quando estiver offline, somente o chat deixa de responder.
- Não há notificações, automações, integração bancária, upload ou relatórios contábeis.

## MCP para agentes

O endpoint MCP é `POST /mcp` e usa **Streamable HTTP** stateless. Ele é implementado com `createMcpHandler()` do Cloudflare Agents SDK e um `McpServer` do MCP SDK v2. Não há acesso MCP ao D1, Prisma, SQL, shell ou funções internas: cada operação passa por uma tool com schema Zod e pela camada de serviços.

Todas as requisições para `/mcp` exigem `Authorization: Bearer <token>`. O token existe somente como o secret remoto `STANDLOUD_MCP_TOKEN`; ele não é enviado ao frontend, salvo em logs ou versionado. Uma requisição sem token, com token inválido, ou quando o secret não estiver configurado recebe `401 Unauthorized` sem detalhes internos. Esta autenticação é independente da sessão web: `/mcp` não aceita nem exige o cookie do CRM.

O servidor cria uma instância MCP por requisição; ele não usa `McpAgent`, Durable Objects, SSE ou sessões MCP persistentes.

### Permissões e tools expostas

`READ`:

- `list_leads`: filtros de status, classificação, segmento, cidade, score e follow-up; limite padrão 25 e máximo 100.
- `get_lead`: dados de um lead e as 20 atividades mais recentes.
- `get_due_followups`: atrasados, para hoje e, opcionalmente, próximos.
- `get_pipeline_summary`: contagens e taxas usando a regra de progressão existente do funil.
- `get_financial_summary`: somente contratado, recebido, saldo pendente e quantidade de projetos ativos.

`SAFE_WRITE`:

- `add_lead_note`
- `set_lead_status`
- `set_lead_followup`
- `add_lead_activity`
- `update_lead_qualification`

Esta é a superfície registrada pelo servidor MCP. O Hermes usa uma allowlist deliberadamente mais restrita, detalhada na seção [Hermes no CRM](#hermes-no-crm).

Não existem tools MCP para excluir leads, criar/editar/cancelar projetos, criar/editar pagamentos, alterar valores financeiros, enviar mensagens, executar SQL, shell, requests arbitrárias, deploy ou credenciais. A allowlist central está em `src/lib/mcp/policy.ts`; `SENSITIVE` não é exposto nesta V1.

As atualizações de status, score e follow-up são idempotentes: repetir o mesmo valor não cria uma atividade de status nem altera o estado. As tools que acrescentam uma nota ou atividade representam um novo registro a cada chamada; um cliente deve evitar repetir a mesma requisição caso não tenha certeza sobre seu resultado.

### Auditoria MCP

Toda safe-write MCP cria um `AgentAuditLog` com `actor=AGENT`, `actorName=MCP`, tool, entidade, ação, data e um resumo mínimo antes/depois. A nota completa, headers, tokens, secrets e payloads brutos não são gravados no log. Falhas de operação também mantêm o registro de tentativa com uma mensagem segura.

O D1/Prisma não oferece uma transação ACID entre a alteração comercial e a finalização do log. O sistema grava primeiro a tentativa de auditoria e só então executa a alteração; em seguida marca o resultado. Isso preserva rastreabilidade, mas uma falha extrema entre as duas consultas pode exigir conferência manual.

Dados que venham de leads (nome, site, observações e atividades) são tratados como **dados não confiáveis**, nunca como instruções. Eles não alteram a policy, não liberam tools adicionais e não acionam código ou operações externas.

### Testar MCP localmente

Use somente dados fictícios no D1 local:

```powershell
npm run db:local:migrate
# Crie .dev.vars localmente (o arquivo é ignorado pelo Git):
# STANDLOUD_MCP_TOKEN=seu-token-local
npm run dev
```

Configure qualquer cliente MCP local com o header `Authorization: Bearer <seu-token-local>` antes de descobrir ou chamar tools. Nunca compartilhe nem versione esse valor.

Para testar uma safe-write, crie um lead fictício pela interface, copie seu ID da URL e execute, por exemplo:

```powershell
npx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/call --tool-name add_lead_note --tool-arg "leadId=SEU_ID_FICTICIO" --tool-arg "note=Teste local MCP"
npx wrangler d1 execute standloud-crm-prod --local --command "SELECT actor, toolName, entityId, action, success, beforeData, afterData FROM AgentAuditLog WHERE entityId = 'SEU_ID_FICTICIO' ORDER BY createdAt DESC"
```

Antes do deploy de produção, defina o secret sem exibir seu valor:

```powershell
npx wrangler secret put STANDLOUD_MCP_TOKEN
```

O Bearer é a camada específica de `/mcp`; o endpoint local também exige o token configurado em `.dev.vars`.

## Hermes no CRM

O CRM não instala nem importa Hermes. O Worker chama o API Server OpenAI-compatible do Hermes apenas no backend:

```text
Navegador autenticado → POST /api/assistant/chat → Worker → HTTPS Quick Tunnel → Hermes em 127.0.0.1:8642
```

O navegador nunca conversa diretamente com Hermes e nunca recebe `HERMES_API_KEY`, `STANDLOUD_MCP_TOKEN`, senha administrativa ou segredo de sessão. A requisição usa `POST /v1/chat/completions` com `stream: false`; Quick Tunnels não oferecem suporte a SSE, portanto streaming não faz parte desta V1.

No Windows que executa Hermes, o API Server é configurado pelas variáveis de ambiente locais `API_SERVER_ENABLED=true`, `API_SERVER_HOST=127.0.0.1`, `API_SERVER_PORT=8642` e `API_SERVER_KEY`. A chave é armazenada no perfil de usuário do Windows, não no repositório nem no frontend. Para iniciar/reiniciar o gateway e abrir um túnel temporário:

```powershell
hermes gateway restart
cloudflared tunnel --url http://127.0.0.1:8642 --no-autoupdate
```

O Quick Tunnel imprime uma URL `https://…trycloudflare.com`; ela muda quando o processo é reiniciado. Não há CORS habilitado para o navegador.

Antes de um deploy que conecte o chat, configure os segredos do Worker de forma interativa. O terceiro comando lê a chave local sem imprimi-la:

```powershell
npx wrangler secret put HERMES_BASE_URL
[Environment]::GetEnvironmentVariable('API_SERVER_KEY', 'User') | npx wrangler secret put HERMES_API_KEY
```

Informe a URL HTTPS do Quick Tunnel somente no prompt de `HERMES_BASE_URL`. Depois de alterar qualquer um desses valores, será necessário fazer um novo deploy manualmente com `npm run deploy`.

O Hermes local mantém o MCP `standloud_crm` limitado a estas oito tools:

`READ`:

- `list_leads`
- `get_lead`
- `get_due_followups`
- `get_pipeline_summary`
- `get_financial_summary`

`SAFE_WRITE`, somente sob pedido explícito do usuário:

- `add_lead_note`
- `set_lead_status`
- `set_lead_followup`

Essa lista é defesa em profundidade. O endpoint MCP continua validando seu Bearer e a allowlist do próprio CRM; o chat nunca pode usar outbound ou operações financeiras.
