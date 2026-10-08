# HYP-ADS-001 — Presença patrocinada observável como sinal de oportunidade comercial

**Data do registro:** 2026-10-08  
**Decisão do proprietário do projeto:** hipótese aprovada para registro e validação manual  
**Status:** REGISTERED / UNVALIDATED / MANUAL PILOT READY  
**Natureza:** hipótese comercial e candidato futuro a sinal de triagem/qualificação  
**Execução:** NÃO AUTORIZA implementação de código, scoring, automação, scraping, migrations, integrações, deploy, commits ou outreach automático

## 1. Formulação oficial da hipótese

> Empresas com publicidade paga publicamente observável, associada a páginas de destino com problemas relevantes e verificáveis, **podem** apresentar maior propensão a responder, agendar reunião ou contratar serviços da STANDLOUD do que empresas comparáveis prospectadas sem esse sinal observado.

A hipótese **não é conclusão comprovada**. A seleção e a medição devem distinguir: (a) presença patrocinada observada; (b) vínculo entre anunciante, empresa e destino; (c) problema de página observado; e (d) interpretação de oportunidade comercial.

Anúncio visível NÃO prova orçamento disponível para contratação, que a empresa administra a campanha, eficiência ou desperdício de mídia, volume de tráfego, conversão, CPA, ROAS, prejuízo, interesse em redesign ou atualidade permanente do investimento. Ausência do anúncio em pesquisa específica **não prova ausência de anúncios**.

## 2. Decisão de arquitetura: encaixe sem novo subsistema

A hipótese é um **sinal informacional e uma variável experimental**, não uma nova entidade principal, capability, workflow, classe de autoridade ou External Effect.

Composição com contratos já congelados:

| Etapa | Uso permitido do sinal | Fronteira preservada |
|---|---|---|
| `DISCOVER_CANDIDATES` | origem de uma ocorrência/candidato, com proveniência | não qualifica, não cria Case, não declara Evidence validada |
| `RESOLVE_BUSINESS` | confirmar identidade de empresa, anunciante e página quando possível | anúncio de terceiro/agência pode ser ambíguo |
| `TRIAGE_CANDIDATE` | contexto opcional sujeito a política/Experiment e confiança | não presume pontuação, `RESEARCH` ou admissão automática |
| `RESEARCH_BUSINESS` | investigação delimitada do anúncio/landing e problemas observáveis | output de pesquisa não vira Evidence automaticamente |
| `CAPTURE_EVIDENCE` | avaliar/admitir observações, fonte e incerteza | fato observado separado de análise/opinião |
| `FORM_RESEARCH_SNAPSHOT`, `FORM_JOURNEY`, `FORM_DIAGNOSIS`, `FORM_OPPORTUNITY` | incorporar observações admitidas e formular oportunidade | desempenho de mídia e perdas não são inferidos |
| `BUILD_DEMO`, `VERIFY_DEMO` | exemplificar melhorias quando investimento aprovado | demo não é garantia de conversão |
| `DRAFT_COMMERCIAL_MESSAGE` | proposta de texto ancorada em evidências concretas | rascunho não é autorização para envio |
| `SEND_COMMERCIAL_MESSAGE` | somente com autoridade exata e protocolos de efeitos externos | nada de envio automático por mera detecção |

### Estado do repositório usado como evidência

Checkpoint remoto examinado: `6823e27e91a3b322ce6cf29bd1c0621e4e08dd6f`.

Estruturas legadas existentes no schema Prisma:

- `LeadEvidence`: `sourceType`, `sourceUrl`, `observation`, `observedAt`, `capturedBy`;
- `LeadAnalysis`: `summary`, `commercialSignals`, `opportunity`, `demoConcept`, `confidence`;
- `Lead`: `qualificationScore` de 0 a 10, `notes`, `source`, `websiteUrl`;
- `ScoutCandidateReview`: `sourceType`, `sourceUrl`, `basisJson`, `unresolvedQuestionsJson`, `discoveryId`.

`src/lib/lead.ts` transforma `qualificationScore` em classes A/B/C; não define peso próprio para publicidade patrocinada. `src/lib/scout/contracts.ts` explicita que Scout descobre candidatos sem scoring ou julgamento comercial. `src/lib/researcher/contracts.ts` separa observações factuais e interpretação.

Esses carriers legados **podem suportar registro humano delimitado**, onde houver caminho existente e adequado, mas não substituem nem geram automaticamente `Candidate`, `Evidence`, `Diagnosis` ou `Opportunity` autoritativos do domínio alvo.

O plano alvo mantém `Experiment → Candidate → Business resolution → TRIAGE → RESEARCH admission`, sem promoção implícita de legado.

## 3. Representação mínima de observação — protocolo, NÃO schema novo

Para cada observação manual, registrar em nota/registro de evidência permitido, sem novos campos obrigatórios no banco:

1. Empresa alvo (nome e localidade) e condição do vínculo com anunciante: **confirmado / provável / não resolvido** (rótulos apenas do protocolo de pesquisa, não enums físicos).
2. Plataforma e formato onde se viu o anúncio (por exemplo, Google Search).
3. Consulta digitada, quando disponível; localidade/contexto e dispositivo da observação.
4. Data e hora da observação, preservando fuso ou indicação de horário local.
5. Link da fonte permitida e/ou referência rastreável ao anúncio; registrar limitações da captura.
6. URL de destino observada, distinguindo URL exibida, redirecionamento e página final quando verificáveis.
7. Resultado da checagem da página, incluindo dispositivo, comportamento reproduzível e limite da verificação.
8. Confiança em cada afirmação e motivo da incerteza; não reutilizar `LeadAnalysis.confidence` como se fosse confiança específica do anúncio.
9. Hipótese comercial correspondente, **em campo conceitualmente separado** da observação factual.
10. Revalidação quando o fato for antigo ou o destino mudar; nunca transformar observação histórica em estado sempre ativo.

**Não criar agora:** `hasPaidAds`, `adsBudget`, `paidAdsScore`, `GoogleAdsLead`, tabela/adaptor/agent especializado ou campo de custo de mídia não observado.

Se o caminho legado for insuficiente para preservar uma observação de modo íntegro, usar registro manual de piloto separado; não fazer migration improvisada.

## 4. Regras de linguagem, prova e outreach

Nenhuma redação de agente pode fortalecer conhecimento de forma indevida:

```text
anúncio observado
≠ contrato ou conta de anúncios confirmada

anúncio observado
≠ gasto atual, orçamento, ROAS ou CPA conhecido

problema de interface reproduzido
≠ queda comprovada da taxa de conversão

hipótese comercial
≠ diagnóstico publicado

draft aprovado
≠ autorização de envio
```

Exemplos condicionados à prova:

- Vínculo incerto: “Observamos um anúncio associado ao nome de sua empresa em uma consulta pública.”
- Vínculo confirmado: “Identificamos um anúncio da sua empresa direcionando visitantes para esta página.”
- Problema reproduzido: “Durante um teste em dispositivo móvel, o botão de orçamento não concluiu a ação esperada.”
- Impacto desconhecido: “Não temos acesso aos dados de conversão para afirmar impacto financeiro.”

Frases não autorizadas sem dados primários: “vocês estão perdendo dinheiro”, “o Google Ads de vocês é ineficiente”, “seu ROAS está ruim”, “com nossa demo vocês vão vender X% mais”.

Mensagens externas futuras continuam sujeitas a `DRAFT_COMMERCIAL_MESSAGE`, autoridade específica de `SEND_COMMERCIAL_MESSAGE`, avaliação do contato e controles de External Effect. Nenhum envio nesta etapa.

## 5. Protocolo de validação comercial manual (pré-registrado)

**Objetivo:** testar se o sinal melhora taxa de resposta comercial e/ou conversão em etapas posteriores.

**Unidade de observação:** empresa abordada, com histórico de contato deduplicado. Anúncios repetidos da mesma empresa não se tornam empresas distintas.

**População inicial:** escolher nicho, região e tipos de serviço comparáveis, dentro dos limites de prospecção aplicáveis.

**Grupos:**

- **A — anúncio observado + problema relevante de página verificado:** associação anunciante/empresa e página registrada com confiança justificável;
- **B — nenhum anúncio observado no procedimento + problema relevante de página verificado:** *não* rotular como “empresa não anuncia”.

**Amostra inicial de planejamento:** aproximadamente 20–30 empresas por grupo, se viável; número meramente exploratório, insuficiente para afirmar significância estatística. Não fabricar observações para preencher quota.

**Padronização:** checklist comum para problemas de página; registrar gravidade, nicho, porte aparente, região, canal, qualidade do contato e origem da amostra. Empregar abordagem comercial de qualidade, cadência e critérios equivalentes. Para testar somente a elegibilidade do sinal, não permitir que um grupo receba tratamento muito mais cuidadoso sem registrar o desvio.

**Métrica primária:** resposta positiva / empresas abordadas com contato válido e entrega confirmada quando houver essa evidência; registrar explicitamente o denominador usado. Resposta positiva precisa de definição prévia (interesse real em conhecer proposta, não apenas “ok” ou ausência de rejeição).

**Métricas secundárias:** reuniões qualificadas, propostas enviadas, vendas efetivas, tempo de investigação e custo por contato; somente resultados realmente observados.

**Registros de cada empresa, no mínimo:** grupo, fonte/data/contexto da observação, qualidade do vínculo anunciante, URL de destino, problema/reprodução, data/forma de contato, entrega confirmada ou incerta, resposta positiva/negativa/sem resposta/indeterminada, reuniões/propostas/vendas (se ocorrerem), motivo de exclusão, notas de viés.

**Avaliação:** calcular proporções com denominadores explícitos; relatar números absolutos e incerteza, inclusive resultados nulos. A associação não prova causalidade. Considerar viés por porte, maturidade, região, nicho, severidade da falha, fonte e contatos válidos. Não usar a detecção como proxy de orçamento ou capacidade de compra.

**Critério de passagem para nova iteração:** sinal consistente e comercialmente útil, com observações auditáveis e custo operacional aceitável, justifica ampliação do teste. Não cria automaticamente pontos de scoring. Resultado neutro ou negativo mantém o sinal apenas como observação, ou encerra o piloto.

## 6. Roadmap e gates de decisão

**Agora, paralelo ao TR-04B-E1 (fora do caminho crítico técnico):** registrar HYP-ADS-001; iniciar piloto manual quando operacionalmente oportuno. Não modificar código, schema ou sequencing.

**TR-06 — Discovery / Triage:** REVISITAR, não implementar antecipadamente. Examinar onde observações legítimas entram em descoberta e como podem ser utilizadas por política de triagem; não adicionar capability, peso numérico ou status de Candidate sem nova decisão.

**TR-07 — Research / Evidence / Analysis:** REVISITAR. Examinar forma de preservar origem, data, identidade anunciante/destino, incerteza e diagnóstico limitado. Não forçar presença do sinal em todo Case.

**TR-08 — Demo:** REVISITAR somente quando Evidence, Diagnosis e Opportunity sustentarem solução demonstrável.

**TR-10/11 — Communication:** REVISITAR os limites de claims permitidos na composição de mensagem e controle de envio; sem automatizar outbound por detecção de anúncio.

**Automação de descoberta de anúncios — DISCOVERY REQUIRED:** avaliar acesso permitido, fontes oficiais, provedores licenciados, cobertura, TOS/políticas, qualidade, custo, manutenção, conformidade e fragilidade do scraping. Nenhum scraping automatizado de Google Search aprovado por esta decisão.

**Gate de scoring:** pontuação automática somente após (a) hipótese testada; (b) definição formal de feature e confiança; (c) evidência de valor incremental vs. controles; (d) decisão explícita de revisão da política de triagem/scoring; (e) regressão e integridade de dados. Nenhum peso arbitrário.

**Gate de implementação:** caso o piloto sustente a ideia, abrir tarefa de DESIGN READ-ONLY específica nas fases donas. Essa aprovação de hipótese não autoriza migration, servidor, scraper, plugin, prompt de produção, writer, Agent, bot ou deploy.

## 7. Não-alterações / compatibilidade

- Não alterar Commercial Domain V0.1, Capability Inventory 22, Contracts/Dependencies congelados, Actor/Executor e matriz de autoridade.
- Não alterar TR-04B/04B-E1, `ExecutionRun`, Authority Kernel, migrations `0001..0011`, workflow sequencing, Hermes Stage B, regra de Case admission, `WorkflowEvent` ou `CostEntry`.
- Não criar `Lead`/`CommercialCase` ou `Evidence` target automaticamente a partir de Scout/observações legadas.
- Não presumir APIs abertas, dados privados de conversão, orçamento, atribuição da campanha ou propriedade do anúncio.
- Não usar ausência observada como prova de ausência de publicidade.
- Não confundir comparação exploratória com experimento randomizado causal.
- Não alterar site do cliente, conta Google Ads, contato ou efeito externo a partir desta hipótese.

## 8. Próxima ação formal

```text
HYP-ADS-001
= REGISTERED / UNVALIDATED / MANUAL PILOT READY

TR-04B-E1
= CONTINUA EM EXECUÇÃO / SEM MUDANÇA

ROADMAP
= MESMA ORDEM / COM GATES DE REVISITA EM TR-06/07/08/10/11

CODING
= NÃO AUTORIZADO
```

O proprietário do projeto decidirá se/quanto executar do piloto comercial. O progresso técnico STANDLOUD não fica bloqueado por essa hipótese.
