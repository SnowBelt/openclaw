import type {
  OperationsFinding,
  OperationsRemediationRecord,
  OperationsRemediationRisk,
} from "../types.js";

export type OperationsRepairDomain =
  | "routine"
  | "security"
  | "financial"
  | "credential"
  | "production_release"
  | "destructive"
  | "novel"
  | "policy_expansion";

export type OperationsRepairVerification = {
  passed: boolean;
  evidence: string;
};

export type OperationsRepairRecipe<Context = unknown> = {
  id: string;
  risk: OperationsRemediationRisk;
  domain: OperationsRepairDomain;
  confidence: number;
  recommendationReason: string;
  exactRepair: string;
  expectedChange: string;
  verificationPlan: string;
  rollback: string;
  reversible: boolean;
  verificationMode: "authoritative_readback";
  rollbackVerificationMode: "authoritative_readback";
  undo?: {
    action: "cron.enable" | "cron.disable";
    targetId: (finding: OperationsFinding) => string | undefined;
  };
  matches: (finding: OperationsFinding, context: Context) => boolean;
  apply: (finding: OperationsFinding, context: Context) => Promise<void>;
  verify: (finding: OperationsFinding, context: Context) => Promise<OperationsRepairVerification>;
  rollbackRepair?: (finding: OperationsFinding, context: Context) => Promise<void>;
  verifyRollback?: (
    finding: OperationsFinding,
    context: Context,
  ) => Promise<OperationsRepairVerification>;
};

export type OperationsRemediationAiReview<Context = unknown> = {
  investigate: (input: {
    finding: OperationsFinding;
    recipe: OperationsRepairRecipe<Context>;
  }) => Promise<{ confidence: number; recommendation: string }>;
  judge: (input: {
    finding: OperationsFinding;
    recipe: OperationsRepairRecipe<Context>;
    investigation: { confidence: number; recommendation: string };
  }) => Promise<{ approved: boolean; reason: string }>;
  recommend?: (input: { finding: OperationsFinding }) => Promise<{
    risk: OperationsRemediationRisk;
    domain: OperationsRepairDomain;
    confidence: number;
    recommendedFix: string;
    reason: string;
    expectedChange: string;
    verificationPlan: string;
    rollback: string;
  }>;
  judgeRecommendation?: (input: {
    finding: OperationsFinding;
    recommendation: {
      risk: OperationsRemediationRisk;
      domain: OperationsRepairDomain;
      confidence: number;
      recommendedFix: string;
      reason: string;
      expectedChange: string;
      verificationPlan: string;
      rollback: string;
    };
  }) => Promise<{ approved: boolean; reason: string }>;
};

export type OperationsRemediationStore = {
  list: () => OperationsRemediationRecord[];
  upsert: (record: OperationsRemediationRecord) => void;
};
