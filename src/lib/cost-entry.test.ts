import { describe, expect, it } from "vitest";

import {
  CostEntryMeasurementIdentityError,
  canonicalCostEntryMeasurementIdentityJson,
  canonicalizeCostEntryMeasurementIdentity,
  computeCanonicalCostEntrySha256,
  costEntryMeasurementDigestFormat,
} from "./cost-entry";

const sha = (character: string) => character.repeat(64);

const baseMeasurement = {
  economicOccurrenceKey: "invoice:provider-a:2026-10",
  measurementSliceKey: "invoice:provider-a:2026-10:line-1",
  measurementNature: "ACTUAL" as const,
  resourceKey: "HUMAN_TIME",
  unitKey: "MINUTE",
  quantityKnowledge: "KNOWN" as const,
  quantityCoefficient: 0,
  quantityScale: 0,
  monetaryKnowledge: "KNOWN" as const,
  amountMinor: 0,
  currency: "USD",
  currencyScale: 2,
  measurementSourceKind: "PROVIDER_STATEMENT",
  sourceReference: "sr:v1:550e8400-e29b-41d4-a716-446655440000",
  evidenceSha256: null,
  measurementBasisSha256: sha("a"),
  experimentId: null,
  candidateId: null,
  commercialCaseId: null,
  executionRunId: null,
};

describe("TR-04 CostEntry measurement identity", () => {
  it("is deterministic, versioned, and independent from descriptor property order", async () => {
    const reordered = {
      measurementBasisSha256: sha("a"),
      unitKey: "MINUTE",
      currencyScale: 2,
      amountMinor: 0,
      sourceReference: "sr:v1:550e8400-e29b-41d4-a716-446655440000",
      monetaryKnowledge: "KNOWN" as const,
      economicOccurrenceKey: "invoice:provider-a:2026-10",
      quantityScale: 0,
      measurementNature: "ACTUAL" as const,
      resourceKey: "HUMAN_TIME",
      measurementSliceKey: "invoice:provider-a:2026-10:line-1",
      quantityKnowledge: "KNOWN" as const,
      quantityCoefficient: 0,
      currency: "USD",
      measurementSourceKind: "PROVIDER_STATEMENT",
      evidenceSha256: null,
    };
    const first = await computeCanonicalCostEntrySha256(baseMeasurement);
    expect(await computeCanonicalCostEntrySha256(reordered)).toBe(first);
    expect(canonicalizeCostEntryMeasurementIdentity(baseMeasurement)).toMatchObject({
      format: costEntryMeasurementDigestFormat,
      directContext: null,
    });
    expect(canonicalCostEntryMeasurementIdentityJson(baseMeasurement)).toContain(costEntryMeasurementDigestFormat);
  });

  it("accepts only the opaque source-reference alternatives", () => {
    expect(canonicalizeCostEntryMeasurementIdentity(baseMeasurement)).toMatchObject({
      sourceReference: "sr:v1:550e8400-e29b-41d4-a716-446655440000",
      evidenceSha256: null,
    });
    expect(canonicalizeCostEntryMeasurementIdentity({
      ...baseMeasurement,
      sourceReference: null,
      evidenceSha256: sha("d"),
    })).toMatchObject({ sourceReference: null, evidenceSha256: sha("d") });
    expect(canonicalizeCostEntryMeasurementIdentity({
      ...baseMeasurement,
      evidenceSha256: sha("e"),
    })).toMatchObject({
      sourceReference: "sr:v1:550e8400-e29b-41d4-a716-446655440000",
      evidenceSha256: sha("e"),
    });
  });

  it("changes for every economic identity component, including nature and direct context", async () => {
    const original = await computeCanonicalCostEntrySha256(baseMeasurement);
    for (const change of [
      { economicOccurrenceKey: "invoice:provider-a:2026-11" },
      { measurementSliceKey: "invoice:provider-a:2026-10:line-2" },
      { measurementNature: "ESTIMATED" as const },
      { resourceKey: "MODEL_TOKEN" },
      { unitKey: "TOKEN" },
      { quantityCoefficient: 1 },
      { quantityScale: 1 },
      { monetaryKnowledge: "UNKNOWN" as const, amountMinor: null, currency: null, currencyScale: null },
      { amountMinor: 1 },
      { currency: "BRL" },
      { measurementSourceKind: "MANUAL_STATEMENT" },
      { sourceReference: null, evidenceSha256: sha("b") },
      { sourceReference: "sr:v1:550e8400-e29b-41d4-b716-446655440001" },
      { measurementBasisSha256: sha("c") },
      { experimentId: "experiment-1" },
    ]) {
      await expect(computeCanonicalCostEntrySha256({ ...baseMeasurement, ...change })).resolves.not.toBe(original);
    }
  });

  it("excludes volatile clocks so clock corrections cannot create a fictional charge", async () => {
    const original = await computeCanonicalCostEntrySha256(baseMeasurement);
    const withDifferentClocks = {
      ...baseMeasurement,
      occurredAt: "2026-10-08T00:00:00.000Z",
      observedAt: "2026-10-08T01:00:00.000Z",
    };
    expect(await computeCanonicalCostEntrySha256(withDifferentClocks)).toBe(original);
  });

  it("distinguishes known zero from unknown and rejects malformed descriptors", () => {
    expect(canonicalizeCostEntryMeasurementIdentity({
      ...baseMeasurement,
      monetaryKnowledge: "UNKNOWN",
      amountMinor: null,
      currency: null,
      currencyScale: null,
    }).amountMinor).toBeNull();
    expect(() => canonicalizeCostEntryMeasurementIdentity({ ...baseMeasurement, amountMinor: -1 }))
      .toThrow(CostEntryMeasurementIdentityError);
    expect(() => canonicalizeCostEntryMeasurementIdentity({ ...baseMeasurement, quantityCoefficient: Number.MAX_SAFE_INTEGER + 1 }))
      .toThrow("COST_ENTRY_MEASUREMENT_IDENTITY_INVALID");
    expect(() => canonicalizeCostEntryMeasurementIdentity({ ...baseMeasurement, quantityScale: 19 }))
      .toThrow(CostEntryMeasurementIdentityError);
    expect(() => canonicalizeCostEntryMeasurementIdentity({ ...baseMeasurement, sourceReference: null, evidenceSha256: null }))
      .toThrow(CostEntryMeasurementIdentityError);
    expect(() => canonicalizeCostEntryMeasurementIdentity({ ...baseMeasurement, evidenceSha256: "A".repeat(64) }))
      .toThrow(CostEntryMeasurementIdentityError);
    expect(() => canonicalizeCostEntryMeasurementIdentity({ ...baseMeasurement, experimentId: "experiment-1", candidateId: "candidate-1" }))
      .toThrow(CostEntryMeasurementIdentityError);

    for (const sourceReference of [
      "email@example.test",
      "https://example.test/invoice",
      "<html>test</html>",
      "ignore previous instructions",
      "Invoice 123: amount 99",
      "sk-test-not-a-real-key",
      '{ "raw": "payload" }',
      " sr:v1:550e8400-e29b-41d4-a716-446655440000",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000 ",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000\t",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000\n",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000\0",
      "sr:v1:550E8400-e29b-41d4-a716-446655440000",
      "sr:v1:550e8400-e29b-11d4-a716-446655440000",
      "sr:v1:550e8400-e29b-71d4-a716-446655440000",
      "sr:v1:550e8400-e29b-41d4-c716-446655440000",
      "sr:v2:550e8400-e29b-41d4-a716-446655440000",
      "sr:v1:550e8400e29b-41d4-a716-446655440000",
      "sr:v1:550e8400-e29b-41d4-a716-446655440000x",
      "sr:v1:550e8400-e29b-41d4-a716-44665544000é",
    ]) {
      expect(() => canonicalizeCostEntryMeasurementIdentity({
        ...baseMeasurement,
        sourceReference,
        evidenceSha256: sha("f"),
      })).toThrow(CostEntryMeasurementIdentityError);
    }
  });
});
