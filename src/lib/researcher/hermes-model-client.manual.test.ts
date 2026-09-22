import { describe, expect, it } from "vitest";

import { EvidenceSourceType } from "@/generated/prisma/enums";

import { runResearcherDryRun } from "./dry-run";
import { HermesResearcherModelClient } from "./hermes-model-client";

const runManualDryRun = process.env.RESEARCHER_MANUAL_DRY_RUN === "1";
const describeManual = runManualDryRun ? describe : describe.skip;

describeManual("Researcher Atlas synthetic dry-run (manual only)", () => {
  it("executes one isolated researcher inference without persistence", async () => {
    const gatewayBaseUrl = process.env.RESEARCHER_HERMES_GATEWAY_BASE_URL;
    const apiKey = process.env.RESEARCHER_HERMES_API_KEY;

    if (!gatewayBaseUrl || !apiKey) {
      throw new Error("Manual researcher dry-run configuration is missing.");
    }

    const result = await runResearcherDryRun(
      {
        input: {
          lead: {
            id: "synthetic-atlas-dry-run",
            companyName: "DEMO RESEARCH - Atlas Climatização",
            city: "Jacareí",
            region: "SP",
            segment: "Climatização",
            primaryService: "Instalação e manutenção de ar-condicionado",
          },
          knownSources: {
            websiteUrl: "https://example.com/atlas-climatizacao",
          },
          goal:
            "Documentar fatos observáveis sobre a presença digital da empresa sem realizar análise comercial.",
          allowedSourceTypes: [
            EvidenceSourceType.WEBSITE,
            EvidenceSourceType.GOOGLE_MAPS,
            EvidenceSourceType.INSTAGRAM,
          ],
        },
        snapshots: [
          {
            sourceType: EvidenceSourceType.WEBSITE,
            sourceUrl: "https://example.com/atlas-climatizacao",
            content:
              "A página inicial apresenta telefone apenas no rodapé. A primeira seção não apresenta botão ou link visível para solicitar orçamento.",
          },
          {
            sourceType: EvidenceSourceType.WEBSITE,
            sourceUrl: "https://example.com/atlas-climatizacao/servicos",
            content:
              "A página de serviços lista instalação e manutenção de ar-condicionado. Não há botão, formulário ou link de solicitação de orçamento junto às descrições dos serviços.",
          },
          {
            sourceType: EvidenceSourceType.GOOGLE_MAPS,
            content:
              "O cenário de teste registra avaliação média 4,8 baseada em 186 avaliações.",
          },
          {
            sourceType: EvidenceSourceType.INSTAGRAM,
            content:
              "O cenário de teste registra publicações recentes mostrando instalações de ar-condicionado concluídas.",
          },
        ],
      },
      new HermesResearcherModelClient({
        gatewayBaseUrl,
        apiKey,
        model: "gpt-5.6-terra",
      }),
    );

    expect(result).toBeDefined();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });
});
