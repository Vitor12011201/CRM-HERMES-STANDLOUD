import { describe, expect, it } from "vitest";

import {
  agentLifecycleStatusLabels,
  agentRegistry,
  getAgentProfile,
} from "./registry";

describe("organizational agent registry", () => {
  it("registers Ana without changing the stable researcher technical identity", () => {
    const ana = getAgentProfile("researcher");

    expect(agentRegistry).toContain(ana);
    expect(ana).toMatchObject({
      technicalId: "researcher",
      displayName: "Ana",
      role: "Research Analyst",
      department: "Inteligência de Mercado",
      avatar: "/agents/ana.png",
      lifecycleStatus: "ACTIVE",
      lifecycleLabel: "Ativa",
    });
  });

  it("preserves Ana's factual-research boundaries in the organizational profile", () => {
    const ana = getAgentProfile("researcher");

    expect(ana?.responsibilities).toEqual([
      "Pesquisa factual de empresas",
      "Observação de fontes",
      "Evidências verificáveis",
      "Registro de informações não confirmadas",
    ]);
    expect(ana?.nonResponsibilities).toEqual([
      "Scoring",
      "Interpretação comercial",
      "Priorização",
      "Estratégia",
      "Outreach",
    ]);
  });

  it("returns undefined for an unknown technical identity", () => {
    expect(getAgentProfile("unknown-agent")).toBeUndefined();
  });

  it("provides presentation labels for every supported lifecycle status", () => {
    expect(agentLifecycleStatusLabels).toEqual({
      PLANNED: "Planejado",
      BUILDING: "Em construção",
      ACTIVE: "Ativo",
      PAUSED: "Pausado",
      RETIRED: "Encerrado",
    });
  });
});
