# STANDLOUD CRM Interno V1

Ferramenta privada para a operação comercial da STANDLOUD: centraliza leads, pipeline, histórico de contatos, follow-ups, projetos, pagamentos e métricas básicas. Ela não é um SaaS público. O acesso web é protegido por uma sessão single-user assinada no Worker.

# Project State — Living Roadmap

Esta seção registra a verdade atual do projeto, não uma especificação imutável. Ela pode mudar quando novas evidências, prioridades ou decisões arquiteturais exigirem revisão; decisões anteriores podem ser substituídas. O histórico permanece no Git, enquanto este roadmap mantém apenas o estado atual.

## Current snapshot

- Current branch: `main`
- Current published Scout V1 commit: `a0e7bb06fff38d6380c798bd8f630a2f07d8e233`
- Data da revisão: 2026-09-23

O SHA é somente um snapshot da revisão atual, não uma regra permanente.

## Current architecture

- CRM: source of truth, business memory e audit.
- Deterministic workflow: controla processos conhecidos e seus estados.
- Hermes: assistente do CRM agora; futuro orchestrator/manager.
- Specialists: Scout, Researcher, Analyst, Demo Builder, QA/Critic e Sales.

Princípio de responsabilidades:

```text
Scout discovers.
Researcher observes.
Analyst interprets.
```

Agentes não devem manter estado de negócio paralelo ao CRM.

## Completed

### CRM foundation

- Cloudflare Worker, D1 e Prisma com client request-scoped.
- Login single-user, dashboard, leads e finance.

### MCP

- Bearer auth.
- Controlled read tools e controlled safe-write tools.
- Audit.

### Researcher V1

- Contracts e controlled website acquisition.
- Metadata / JSON-LD.
- Boundary `OBSERVED != INFERRED`.
- Human approval, LeadEvidence persistence e dedupe/idempotency.
- Real E2E validation.

### Scout V1

- Deterministic contracts e exact duplicate logic.
- Discovery provider abstraction e Foursquare provider.
- Explicit Contabilidade taxonomy mapping.
- Real Foursquare validation e CRM read-only duplicate context.
- Integrated real D1 + Foursquare + Scout validation.
- Workerd fetch receiver regression fix.
- Final tests and review; published to `main`.

### Scout Lead Approval Boundary

- A Scout `FOUND` never authorizes a write on its own; explicit human approval is required.
- The approved candidate is captured in an immutable snapshot.
- The Lead contract is validated at runtime before persistence.
- CRM duplicate state is rechecked immediately before creation; exact and ambiguous matches fail closed.
- Published snapshot: `2c221a97c5f203448444c351aff9953dc512e414`.

### Persistent Scout Candidate Review

- Persistent candidate memory preserves factual Scout results for human review.
- `PENDING`, `APPROVING`, `REJECTED` and `CONVERTED` transitions use compare-and-set claims.
- Seen discovery identities prevent previously reviewed candidates from reappearing.
- Exact Scout provenance supports safe Lead-creation recovery after an interrupted approval.
- The D1 schema and constraints were validated locally.
- Published snapshot: `7529d354cd4ab6e977699076ec50c724c157667b`.

### Operational Scout Review Flow

- `/scout` is the authenticated human-review boundary for persisted Scout candidates.
- The actionable queue contains `PENDING` and safe-recovery `APPROVING` reviews; terminal reviews leave the queue.
- The browser submits only discovery constraints, review IDs and explicit acknowledgement; candidate facts are always reloaded from CRM/D1.
- Approval reuses the immutable Phase 1 boundary, live duplicate recheck and exact provenance recovery, so retries do not create another Lead.
- The workflow is published to production after local validation, remote D1 migration and unauthenticated route smoke tests.
- Published snapshot: `d702053e2d753e9a14792463c03dac6ab082df2e`.

## Frozen

- Researcher V1 = **FROZEN**
- Scout V1 = **FROZEN**

Não modificar essas fases sem evidência nova, bug real ou necessidade arquitetural clara.

## Current operational state

### Hermes

- Hermes API Server roda localmente no Windows em `127.0.0.1:8642`.
- O CRM Worker alcança Hermes via HTTPS tunnel.
- Atualmente a bridge usa Cloudflare Quick Tunnel.
- Hermes está funcional e integrado ao CRM.
- Quick Tunnel é temporário; reboot encerra Hermes e cloudflared, e um novo tunnel pode gerar outra URL após restart.
- Quick Tunnel é infraestrutura temporária de desenvolvimento/teste; Named Tunnel permanece no backlog para fornecer hostname estável.

Nenhuma API key, hostname atual do tunnel, secret ou token pertence a este documento.

## Next

A próxima feature será definida em tarefa separada após a publicação e observação do fluxo operacional Scout. Scout continua sem criar Lead automaticamente: toda criação exige aprovação humana explícita.

## After next

Roadmap atual, sem ordem imutável:

1. Analyst
2. Demo Builder
3. QA / Critic
4. Sales
5. Deterministic workflow/state machine
6. Hermes orchestration
7. Metrics/evaluation
8. Scaling

## Deferred / backlog

- Replace Quick Tunnel with stable Named Tunnel.
- Automatic Hermes startup on Windows.
- Automatic cloudflared startup.
- Persistent/safe Foursquare local secret workflow.
- 24/7 Hermes hosting evaluation.
- Model routing / cheaper models.
- Own evaluation datasets.
- Possible workflow engine if complexity justifies it.
- CI on push/main review.

**DEFERRED** não significa rejeitado: significa que não é a prioridade atual.

## Current principles

- CRM remains source of truth.
- Known process belongs in deterministic code.
- Agents are used where judgment is useful.
- Human approval remains required for important external or irreversible actions.
- No automatic outbound messaging.
- No arbitrary SQL, shell or database access for agents.
- Specialist agents should receive minimum necessary context.
- Structured inputs/outputs are preferred.
- Do not adopt a multi-agent framework without a concrete need.
- Start with low volume and validate quality before scaling.

## Update policy

Quando uma fase relevante terminar ou uma decisão arquitetural mudar:

1. Revise o Living Roadmap.
2. Remova informação que deixou de representar o estado atual.
3. Mova itens entre NEXT, DONE, DEFERRED e FROZEN.
4. Altere próximos passos quando necessário.
5. Não mantenha decisões antigas apenas por inércia.
6. Use o Git para histórico; não transforme o README em changelog.

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

Configure os Worker Secrets de forma interativa; nunca coloque seus valores em arquivos do projeto:

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
- Uma conta Cloudflare para configurar D1 remoto e deploy. Cloudflare Access é opcional.

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

As migrations versionadas são [0001_init.sql](prisma/migrations/0001_init.sql) (CRM), [0002_agent_audit_log.sql](prisma/migrations/0002_agent_audit_log.sql) (auditoria MCP), [0003_lead_research.sql](prisma/migrations/0003_lead_research.sql) (research de leads) e [0004_scout_candidate_review.sql](prisma/migrations/0004_scout_candidate_review.sql) (memória persistente de revisão Scout). Para aplicá-las localmente:

```powershell
npm run db:local:migrate
```

Ao alterar `prisma/schema.prisma` no futuro, primeiro aplique todas as migrations existentes ao D1 local. Depois gere e revise uma migration incremental, escolhendo o próximo número sequencial:

```powershell
npx prisma migrate diff --config prisma.d1-local.config.ts --from-config-datasource --to-schema prisma/schema.prisma --script --output prisma/migrations/0005_descricao_da_mudanca.sql
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

O CRM já possui deploy de produção. Deploy manual de código continua sendo:

```powershell
npm run deploy
```

Cloudflare Access continua opcional e não é requisito para o login single-user nem para deploy. Migrations remotas são uma operação consciente e separada: execute `npm run db:remote:migrate` somente quando houver uma nova migration revisada.

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

O Quick Tunnel imprime uma URL `https://…trycloudflare.com`; ela muda quando o processo é reiniciado ou após reboot. Ele é infraestrutura temporária de desenvolvimento/teste; Named Tunnel permanece no backlog para fornecer hostname estável. Não há CORS habilitado para o navegador.

Configure os segredos do Worker de forma interativa, fornecendo os valores nos prompts locais:

```powershell
npx wrangler secret put HERMES_BASE_URL
npx wrangler secret put HERMES_API_KEY
```

Para `HERMES_BASE_URL`, informe somente a URL HTTPS base: sem aspas, espaços, texto adicional, path, query ou hash. Nunca registre valores reais no README.

`wrangler secret put` cria uma nova versão do Worker e a implanta imediatamente; não execute `npm run deploy` apenas para aplicar uma alteração de secret. Use `npm run deploy` para alteração de código. Migrations D1 continuam sendo uma operação separada e consciente.

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
