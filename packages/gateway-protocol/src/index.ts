// Public gateway protocol entrypoint. Keep this barrel aligned with schema.ts
// so clients can import wire types, JSON schemas, and validators from one place.
export {
  buildClawHubTrustErrorDetails,
  ClawHubTrustErrorCodes,
  isClawHubTrustErrorCode,
  readClawHubTrustErrorDetails,
  type ClawHubTrustErrorCode,
  type ClawHubTrustErrorDetails,
} from "./clawhub-trust-error-details.js";
export { assertOperationsSnapshotV2Integrity } from "./operations-snapshot-integrity.js";
import { Compile, type Validator as TypeBoxValidator } from "typebox/compile";
import {
  type AgentEvent,
  AgentEventSchema,
  type AuditEvent,
  AuditEventSchema,
  type AuditListParams,
  AuditListParamsSchema,
  type AuditListResult,
  AuditListResultSchema,
  type AgentIdentityParams,
  AgentIdentityParamsSchema,
  type AgentIdentityResult,
  AgentIdentityResultSchema,
  AgentParamsSchema,
  type MessageActionParams,
  MessageActionParamsSchema,
  type AgentSummary,
  AgentSummarySchema,
  type AgentsFileEntry,
  AgentsFileEntrySchema,
  type AgentsCreateParams,
  AgentsCreateParamsSchema,
  type AgentsCreateResult,
  AgentsCreateResultSchema,
  type AgentsUpdateParams,
  AgentsUpdateParamsSchema,
  type AgentsUpdateResult,
  AgentsUpdateResultSchema,
  type AgentsDeleteParams,
  AgentsDeleteParamsSchema,
  type AgentsDeleteResult,
  AgentsDeleteResultSchema,
  type AgentsFilesGetParams,
  AgentsFilesGetParamsSchema,
  type AgentsFilesGetResult,
  AgentsFilesGetResultSchema,
  type AgentsFilesListParams,
  AgentsFilesListParamsSchema,
  type AgentsFilesListResult,
  AgentsFilesListResultSchema,
  type AgentsFilesSetParams,
  AgentsFilesSetParamsSchema,
  type AgentsFilesSetResult,
  AgentsFilesSetResultSchema,
  type AgentsWorkspaceEntry,
  AgentsWorkspaceEntrySchema,
  type AgentsWorkspaceFile,
  AgentsWorkspaceFileSchema,
  type AgentsWorkspaceGetParams,
  AgentsWorkspaceGetParamsSchema,
  type AgentsWorkspaceGetResult,
  AgentsWorkspaceGetResultSchema,
  type AgentsWorkspaceListParams,
  AgentsWorkspaceListParamsSchema,
  type AgentsWorkspaceListResult,
  AgentsWorkspaceListResultSchema,
  type ArtifactsDownloadParams,
  ArtifactsDownloadParamsSchema,
  type ArtifactsDownloadResult,
  type ArtifactsGetParams,
  ArtifactsGetParamsSchema,
  type ArtifactsGetResult,
  type ArtifactsListParams,
  ArtifactsListParamsSchema,
  type ArtifactsListResult,
  type ArtifactSummary,
  ArtifactSummarySchema,
  type AgentsListParams,
  AgentsListParamsSchema,
  type AgentsListResult,
  AgentsListResultSchema,
  type AgentWaitParams,
  AgentWaitParamsSchema,
  type ChannelsStartParams,
  ChannelsStartParamsSchema,
  type ChannelsStopParams,
  ChannelsStopParamsSchema,
  type ChannelsLogoutParams,
  ChannelsLogoutParamsSchema,
  type TalkEvent,
  TalkEventSchema,
  type TalkCatalogParams,
  TalkCatalogParamsSchema,
  type TalkCatalogResult,
  TalkCatalogResultSchema,
  type TalkClientCreateParams,
  TalkClientCreateParamsSchema,
  type TalkClientCreateResult,
  TalkClientCreateResultSchema,
  type TalkAgentControlResult,
  TalkAgentControlResultSchema,
  type TalkClientSteerParams,
  TalkClientSteerParamsSchema,
  type TalkClientToolCallParams,
  TalkClientToolCallParamsSchema,
  type TalkClientToolCallResult,
  TalkClientToolCallResultSchema,
  type TalkConfigParams,
  TalkConfigParamsSchema,
  type TalkConfigResult,
  TalkConfigResultSchema,
  type TalkSessionAppendAudioParams,
  TalkSessionAppendAudioParamsSchema,
  type TalkSessionCancelOutputParams,
  TalkSessionCancelOutputParamsSchema,
  type TalkSessionCancelTurnParams,
  TalkSessionCancelTurnParamsSchema,
  type TalkSessionCloseParams,
  TalkSessionCloseParamsSchema,
  type TalkSessionCreateParams,
  TalkSessionCreateParamsSchema,
  type TalkSessionCreateResult,
  TalkSessionCreateResultSchema,
  type TalkSessionJoinParams,
  TalkSessionJoinParamsSchema,
  type TalkSessionJoinResult,
  TalkSessionJoinResultSchema,
  type TalkSessionOkResult,
  TalkSessionOkResultSchema,
  type TalkSessionSteerParams,
  TalkSessionSteerParamsSchema,
  type TalkSessionSubmitToolResultParams,
  TalkSessionSubmitToolResultParamsSchema,
  type TalkSessionTurnResult,
  TalkSessionTurnResultSchema,
  type TalkSessionTurnParams,
  TalkSessionTurnParamsSchema,
  type TalkSpeakParams,
  TalkSpeakParamsSchema,
  type TalkSpeakResult,
  TalkSpeakResultSchema,
  type TtsSpeakParams,
  TtsSpeakParamsSchema,
  type TtsSpeakResult,
  TtsSpeakResultSchema,
  type ChannelsStatusParams,
  ChannelsStatusParamsSchema,
  type ChannelsStatusResult,
  ChannelsStatusResultSchema,
  type CommandEntry,
  type CommandsListParams,
  CommandsListParamsSchema,
  type CommandsListResult,
  CommandsListResultSchema,
  type ChatAbortParams,
  ChatAbortParamsSchema,
  type ChatEvent,
  ChatEventSchema,
  ChatHistoryParamsSchema,
  type ChatMetadataParams,
  ChatMetadataParamsSchema,
  ChatMessageGetResultSchema,
  ChatMessageGetParamsSchema,
  type ChatInjectParams,
  ChatInjectParamsSchema,
  ChatSendParamsSchema,
  type ConfigApplyParams,
  ConfigApplyParamsSchema,
  type ConfigGetParams,
  ConfigGetParamsSchema,
  type ConfigPatchParams,
  ConfigPatchParamsSchema,
  type ConfigSchemaLookupParams,
  ConfigSchemaLookupParamsSchema,
  type ConfigSchemaLookupResult,
  ConfigSchemaLookupResultSchema,
  type ConfigSchemaParams,
  ConfigSchemaParamsSchema,
  type ConfigSchemaResponse,
  ConfigSchemaResponseSchema,
  type ConfigSetParams,
  ConfigSetParamsSchema,
  type UpdateStatusParams,
  UpdateStatusParamsSchema,
  type ConnectParams,
  ConnectParamsSchema,
  type CronAddParams,
  CronAddParamsSchema,
  type CronAddResult,
  CronAddResultSchema,
  type CronDeclarativeAddResult,
  CronDeclarativeAddResultSchema,
  type CronGetParams,
  CronGetParamsSchema,
  type CronJob,
  CronJobSchema,
  type CronListParams,
  CronListParamsSchema,
  type CronRemoveParams,
  CronRemoveParamsSchema,
  type CronRunLogEntry,
  type CronRunParams,
  CronRunParamsSchema,
  type CronRunsParams,
  CronRunsParamsSchema,
  type CronStatusParams,
  CronStatusParamsSchema,
  type CronUpdateParams,
  CronUpdateParamsSchema,
  type DevicePairApproveParams,
  DevicePairApproveParamsSchema,
  type DevicePairListParams,
  DevicePairListParamsSchema,
  type DevicePairRemoveParams,
  DevicePairRemoveParamsSchema,
  type DevicePairRejectParams,
  DevicePairRejectParamsSchema,
  type DevicePairSetupCodeParams,
  DevicePairSetupCodeParamsSchema,
  type DevicePairSetupCodeResult,
  type DeviceTokenRevokeParams,
  DeviceTokenRevokeParamsSchema,
  type DeviceTokenRotateParams,
  DeviceTokenRotateParamsSchema,
  type ExecApprovalsGetParams,
  ExecApprovalsGetParamsSchema,
  type ExecApprovalsNodeGetParams,
  ExecApprovalsNodeGetParamsSchema,
  type ExecApprovalsNodeSnapshot,
  ExecApprovalsNodeSnapshotSchema,
  type ExecApprovalsNodeSetParams,
  ExecApprovalsNodeSetParamsSchema,
  type ExecApprovalsSetParams,
  ExecApprovalsSetParamsSchema,
  type ExecApprovalsSnapshot,
  type ExecApprovalGetParams,
  ExecApprovalGetParamsSchema,
  type ExecApprovalRequestParams,
  ExecApprovalRequestParamsSchema,
  type ExecApprovalResolveParams,
  ExecApprovalResolveParamsSchema,
  type PluginApprovalRequestParams,
  PluginApprovalRequestParamsSchema,
  type PluginApprovalResolveParams,
  PluginApprovalResolveParamsSchema,
  type PluginsSessionActionParams,
  type PluginsSessionActionResult,
  PluginsSessionActionParamsSchema,
  PluginsSessionActionResultSchema,
  type PluginsUiDescriptorsParams,
  type PluginsUiDescriptorsResult,
  PluginsUiDescriptorsParamsSchema,
  PluginsUiDescriptorsResultSchema,
  ErrorCodes,
  type EnvironmentSummary,
  EnvironmentSummarySchema,
  type EnvironmentsListParams,
  EnvironmentsListParamsSchema,
  type EnvironmentsListResult,
  EnvironmentsListResultSchema,
  type EnvironmentsStatusParams,
  EnvironmentsStatusParamsSchema,
  type EnvironmentsStatusResult,
  EnvironmentsStatusResultSchema,
  type EnvironmentStatus,
  EnvironmentStatusSchema,
  type SystemInfoParams,
  SystemInfoParamsSchema,
  type SystemInfoResult,
  SystemInfoResultSchema,
  type ErrorShape,
  ErrorShapeSchema,
  type EventFrame,
  EventFrameSchema,
  errorShape,
  type GatewayFrame,
  GatewayFrameSchema,
  GATEWAY_SERVER_CAPS,
  type HelloOk,
  HelloOkSchema,
  type LogsTailParams,
  LogsTailParamsSchema,
  type LogsTailResult,
  LogsTailResultSchema,
  type TerminalAckResult,
  TerminalAckResultSchema,
  type TerminalAttachParams,
  TerminalAttachParamsSchema,
  type TerminalAttachResult,
  TerminalAttachResultSchema,
  type TerminalCloseParams,
  TerminalCloseParamsSchema,
  type TerminalDataEvent,
  TerminalDataEventSchema,
  type TerminalEvent,
  TerminalEventSchema,
  type TerminalExitEvent,
  TerminalExitEventSchema,
  type TerminalInputParams,
  TerminalInputParamsSchema,
  type TerminalListResult,
  TerminalListResultSchema,
  type TerminalOpenParams,
  TerminalOpenParamsSchema,
  type TerminalOpenResult,
  TerminalOpenResultSchema,
  type TerminalResizeParams,
  TerminalResizeParamsSchema,
  type TerminalSessionInfo,
  TerminalSessionInfoSchema,
  type TerminalTextParams,
  TerminalTextParamsSchema,
  type TerminalTextResult,
  TerminalTextResultSchema,
  type ModelsListParams,
  ModelsListParamsSchema,
  type NodeDescribeParams,
  NodeDescribeParamsSchema,
  type NodeEventParams,
  NodeEventParamsSchema,
  type NodeEventResult,
  NodeEventResultSchema,
  type NodePendingDrainParams,
  NodePendingDrainParamsSchema,
  type NodePendingDrainResult,
  NodePendingDrainResultSchema,
  type NodePendingEnqueueParams,
  NodePendingEnqueueParamsSchema,
  type NodePendingEnqueueResult,
  NodePendingEnqueueResultSchema,
  type NodePresenceAlivePayload,
  NodePresenceAlivePayloadSchema,
  type NodePresenceAliveReason,
  NodePresenceAliveReasonSchema,
  type NodeInvokeParams,
  NodeInvokeParamsSchema,
  type NodeInvokeResultParams,
  NodeInvokeResultParamsSchema,
  type NodeListParams,
  NodeListParamsSchema,
  type NodePendingAckParams,
  NodePendingAckParamsSchema,
  type NodePairApproveParams,
  NodePairApproveParamsSchema,
  type NodePairListParams,
  NodePairListParamsSchema,
  type NodePairRejectParams,
  NodePairRejectParamsSchema,
  type NodePairRemoveParams,
  NodePairRemoveParamsSchema,
  type NodePairRequestParams,
  NodePairRequestParamsSchema,
  type NodePairVerifyParams,
  NodePairVerifyParamsSchema,
  type NodeRenameParams,
  NodeRenameParamsSchema,
  type PollParams,
  PollParamsSchema,
  MIN_CLIENT_PROTOCOL_VERSION,
  MIN_NODE_PROTOCOL_VERSION,
  MIN_PROBE_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  type PushTestParams,
  PushTestParamsSchema,
  PushTestResultSchema,
  type WebPushVapidPublicKeyParams,
  WebPushVapidPublicKeyParamsSchema,
  type WebPushSubscribeParams,
  WebPushSubscribeParamsSchema,
  type WebPushUnsubscribeParams,
  WebPushUnsubscribeParamsSchema,
  type WebPushTestParams,
  WebPushTestParamsSchema,
  type PresenceEntry,
  PresenceEntrySchema,
  ProtocolSchemas,
  type RequestFrame,
  RequestFrameSchema,
  type ResponseFrame,
  ResponseFrameSchema,
  SendParamsSchema,
  type SecretsResolveParams,
  type SecretsResolveResult,
  SecretsResolveParamsSchema,
  SecretsResolveResultSchema,
  type SessionsAbortParams,
  SessionsAbortParamsSchema,
  type SessionsCompactParams,
  SessionsCompactParamsSchema,
  type SessionsCleanupParams,
  SessionsCleanupParamsSchema,
  type SessionsCompactionBranchParams,
  SessionsCompactionBranchParamsSchema,
  type SessionsCompactionGetParams,
  SessionsCompactionGetParamsSchema,
  type SessionsCompactionListParams,
  SessionsCompactionListParamsSchema,
  type SessionsCompactionRestoreParams,
  SessionsCompactionRestoreParamsSchema,
  type SessionFileBrowserEntry,
  SessionFileBrowserEntrySchema,
  type SessionFileBrowserResult,
  SessionFileBrowserResultSchema,
  type SessionFileEntry,
  SessionFileEntrySchema,
  type SessionFileKind,
  SessionFileKindSchema,
  type SessionFileRelevance,
  SessionFileRelevanceSchema,
  type SessionOperationEvent,
  type SessionWorktreeInfo,
  SessionWorktreeInfoSchema,
  type SessionsCreateParams,
  SessionsCreateParamsSchema,
  type SessionsCreateResult,
  SessionsCreateResultSchema,
  type SessionsDeleteParams,
  SessionsDeleteParamsSchema,
  type SessionsDescribeParams,
  SessionsDescribeParamsSchema,
  type SessionsFilesGetParams,
  SessionsFilesGetParamsSchema,
  type SessionsFilesGetResult,
  SessionsFilesGetResultSchema,
  type SessionsFilesListParams,
  SessionsFilesListParamsSchema,
  type SessionsFilesListResult,
  SessionsFilesListResultSchema,
  type SessionsListParams,
  SessionsListParamsSchema,
  type SessionsMessagesSubscribeParams,
  SessionsMessagesSubscribeParamsSchema,
  type SessionsMessagesUnsubscribeParams,
  SessionsMessagesUnsubscribeParamsSchema,
  type SessionsPatchParams,
  SessionsPatchParamsSchema,
  type SessionsPluginPatchParams,
  SessionsPluginPatchParamsSchema,
  type SessionsPreviewParams,
  SessionsPreviewParamsSchema,
  type SessionsResetParams,
  SessionsResetParamsSchema,
  type SessionsResolveParams,
  SessionsResolveParamsSchema,
  type SessionsSendParams,
  SessionsSendParamsSchema,
  type SessionsUsageParams,
  SessionsUsageParamsSchema,
  type ExecutionEvent,
  ExecutionEventSchema,
  type ExecutionStateGetParams,
  ExecutionStateGetParamsSchema,
  type ExecutionStateHealth,
  ExecutionStateHealthSchema,
  type ControlDirectorMemoryHealth,
  ControlDirectorMemoryHealthSchema,
  type ControlDirectorRuntimeCanary,
  ControlDirectorRuntimeCanarySchema,
  type ControlDirectorRuntimeLineage,
  ControlDirectorRuntimeLineageSchema,
  type ExecutionStateSnapshot,
  ExecutionStateSnapshotSchema,
  type ChatTurnMode,
  ChatTurnModeSchema,
  type ChatTurnPhase,
  ChatTurnPhaseSchema,
  type ChatTurnSummary,
  ChatTurnSummarySchema,
  type ChatTurnsListParams,
  ChatTurnsListParamsSchema,
  type ChatTurnsListResult,
  ChatTurnsListResultSchema,
  type ChatTurnsCreateParams,
  ChatTurnsCreateParamsSchema,
  type ChatTurnsCreateResult,
  ChatTurnsCreateResultSchema,
  type ChatTurnsSetModeParams,
  ChatTurnsSetModeParamsSchema,
  type ChatTurnsCancelParams,
  ChatTurnsCancelParamsSchema,
  type ChatTurnsRetryParams,
  ChatTurnsRetryParamsSchema,
  type ChatTurnMutationResult,
  ChatTurnMutationResultSchema,
  type PursueGoalJudgeReceipt,
  PursueGoalJudgeReceiptSchema,
  type PursueGoalLease,
  PursueGoalLeaseSchema,
  type TaskFlowDetail,
  TaskFlowDetailSchema,
  type TaskFlowControlAction,
  TaskFlowControlActionSchema,
  type TaskFlowMutationResult,
  TaskFlowMutationResultSchema,
  type TaskFlowsCancelParams,
  TaskFlowsCancelParamsSchema,
  type TaskFlowsCancelResult,
  TaskFlowsCancelResultSchema,
  type TaskFlowsControlParams,
  TaskFlowsControlParamsSchema,
  type TaskFlowsControlResult,
  TaskFlowsControlResultSchema,
  type TaskFlowsCreateParams,
  TaskFlowsCreateParamsSchema,
  type TaskFlowsCreateResult,
  TaskFlowsCreateResultSchema,
  type TaskFlowsEditParams,
  TaskFlowsEditParamsSchema,
  type TaskFlowsGetParams,
  TaskFlowsGetParamsSchema,
  type TaskFlowsGetResult,
  TaskFlowsGetResultSchema,
  type TaskFlowsListParams,
  TaskFlowsListParamsSchema,
  type TaskFlowsListResult,
  TaskFlowsListResultSchema,
  type TaskFlowsPauseParams,
  TaskFlowsPauseParamsSchema,
  type TaskFlowsResumeParams,
  TaskFlowsResumeParamsSchema,
  type TaskFlowsRetryParams,
  TaskFlowsRetryParamsSchema,
  type TaskFlowsStopParams,
  TaskFlowsStopParamsSchema,
  type TaskFlowStatus,
  TaskFlowStatusSchema,
  type TaskFlowSummary,
  TaskFlowSummarySchema,
  type TaskSummary,
  TaskSummarySchema,
  type TasksCancelParams,
  TasksCancelParamsSchema,
  type TasksCancelResult,
  TasksCancelResultSchema,
  type TasksGetParams,
  TasksGetParamsSchema,
  type TasksGetResult,
  TasksGetResultSchema,
  type TasksListParams,
  TasksListParamsSchema,
  type TasksListResult,
  TasksListResultSchema,
  type PccStatus,
  type PccProofLevel,
  type PccPermissionStatus,
  type PccPermissionType,
  type PccRiskLevel,
  type PccEvidenceKind,
  type PccEvidenceStatus,
  type PccPhase,
  type PccProject,
  type PccMilestone,
  type PccSubMilestone,
  type PccPermissionGrant,
  type PccEvidence,
  type PccCompletionReceipt,
  type PccModelRunReceipt,
  type PccProjectAiUsageSummary,
  type PccDecision,
  type PccLastKnownGood,
  type PccProjectSummary,
  type PccPortfolioSummary,
  type PccProjectsListResult,
  type PccProjectsGetResult,
  type PccProjectsUpsertResult,
  type PccProjectPlanCommitParams,
  PccProjectPlanCommitParamsSchema,
  type PccProjectPlanCommitResult,
  PccProjectPlanCommitResultSchema,
  type PccPlansGenerateParams,
  PccPlansGenerateParamsSchema,
  type PccPlansGenerateResult,
  PccPlansGenerateResultSchema,
  type PccPlanningRun,
  PccPlanningRunSchema,
  PccModelRunReceiptSchema,
  PccProjectAiUsageSummarySchema,
  type PccPlansStartParams,
  PccPlansStartParamsSchema,
  type PccPlansStartResult,
  PccPlansStartResultSchema,
  type PccPlansGetParams,
  PccPlansGetParamsSchema,
  type PccPlansGetResult,
  PccPlansGetResultSchema,
  type PccPlansCancelParams,
  PccPlansCancelParamsSchema,
  type PccPlansCancelResult,
  PccPlansCancelResultSchema,
  type PccExecutionStartParams,
  PccExecutionStartParamsSchema,
  type PccExecutionStartResult,
  PccExecutionStartResultSchema,
  type PccExecutionGetParams,
  PccExecutionGetParamsSchema,
  type PccExecutionGetResult,
  PccExecutionGetResultSchema,
  type PccExecutionControlParams,
  PccExecutionControlParamsSchema,
  type PccExecutionReviewParams,
  PccExecutionReviewParamsSchema,
  type PccExecutionPauseResult,
  PccExecutionPauseResultSchema,
  type PccExecutionResumeResult,
  PccExecutionResumeResultSchema,
  type PccExecutionStopResult,
  PccExecutionStopResultSchema,
  type PccExecutionReviewResult,
  PccExecutionReviewResultSchema,
  type PccAttachment,
  PccAttachmentSchema,
  type PccAttachmentUsageReceipt,
  PccAttachmentUsageReceiptSchema,
  type PccAttachmentsUploadBeginParams,
  PccAttachmentsUploadBeginParamsSchema,
  type PccAttachmentsUploadBeginResult,
  PccAttachmentsUploadBeginResultSchema,
  type PccAttachmentsUploadChunkParams,
  PccAttachmentsUploadChunkParamsSchema,
  type PccAttachmentsUploadChunkResult,
  PccAttachmentsUploadChunkResultSchema,
  type PccAttachmentsUploadCommitParams,
  PccAttachmentsUploadCommitParamsSchema,
  type PccAttachmentsUploadCommitResult,
  PccAttachmentsUploadCommitResultSchema,
  type PccAttachmentsListParams,
  PccAttachmentsListParamsSchema,
  type PccAttachmentsListResult,
  PccAttachmentsListResultSchema,
  type PccAttachmentsReadParams,
  PccAttachmentsReadParamsSchema,
  type PccAttachmentsReadResult,
  PccAttachmentsReadResultSchema,
  type PccAttachmentsUpdateParams,
  PccAttachmentsUpdateParamsSchema,
  type PccAttachmentsUpdateResult,
  PccAttachmentsUpdateResultSchema,
  type PccAttachmentsClarifyParams,
  PccAttachmentsClarifyParamsSchema,
  type PccAttachmentsClarifyResult,
  PccAttachmentsClarifyResultSchema,
  type PccAttachmentUsageRecordParams,
  PccAttachmentUsageRecordParamsSchema,
  type PccAttachmentUsageRecordResult,
  PccAttachmentUsageRecordResultSchema,
  type PccAttachmentUsageListParams,
  PccAttachmentUsageListParamsSchema,
  type PccAttachmentUsageListResult,
  PccAttachmentUsageListResultSchema,
  type PccPlanningPolicyGetParams,
  PccPlanningPolicyGetParamsSchema,
  type PccPlanningPolicyGetResult,
  PccPlanningPolicyGetResultSchema,
  type PccPlanningPolicyUpsertParams,
  PccPlanningPolicyUpsertParamsSchema,
  type PccPlanningPolicyUpsertResult,
  PccPlanningPolicyUpsertResultSchema,
  type PccPrivateTeamPolicy,
  PccPrivateTeamPolicySchema,
  type PccMilestonesUpsertResult,
  type PccSubMilestonesListResult,
  type PccSubMilestonesUpsertResult,
  type PccPermissionsUpsertResult,
  type PccEvidenceAddResult,
  type PccDecisionsAddResult,
  type PccReceiptsAddResult,
  type PccLastKnownGoodUpsertResult,
  type PccSummaryGetResult,
  type PccOverviewGetParams,
  PccOverviewGetParamsSchema,
  type PccOverviewGetResult,
  PccOverviewGetResultSchema,
  type PccChangedEvent,
  PccChangedEventSchema,
  type PccPresenceEntry,
  PccPresenceEntrySchema,
  type PccPresenceUpdateParams,
  PccPresenceUpdateParamsSchema,
  type PccPresenceUpdateResult,
  PccPresenceUpdateResultSchema,
  type PccPresenceListParams,
  PccPresenceListParamsSchema,
  type PccPresenceListResult,
  PccPresenceListResultSchema,
  type PccEvidenceAddParams,
  PccEvidenceAddParamsSchema,
  type PccDecisionsAddParams,
  PccDecisionsAddParamsSchema,
  type PccLastKnownGoodUpsertParams,
  PccLastKnownGoodUpsertParamsSchema,
  type PccMilestonesUpsertParams,
  PccMilestonesUpsertParamsSchema,
  type PccSubMilestonesListParams,
  PccSubMilestonesListParamsSchema,
  type PccSubMilestonesUpsertParams,
  PccSubMilestonesUpsertParamsSchema,
  type PccPermissionsUpsertParams,
  PccPermissionsUpsertParamsSchema,
  type PccProjectsGetParams,
  PccProjectsGetParamsSchema,
  type PccProjectsListParams,
  PccProjectsListParamsSchema,
  type PccProjectsUpsertParams,
  PccProjectsUpsertParamsSchema,
  type PccReceiptsAddParams,
  PccReceiptsAddParamsSchema,
  type PccSummaryGetParams,
  PccSummaryGetParamsSchema,
  type OperationsActionApplyParams,
  OperationsActionApplyParamsSchema,
  type OperationsActionApplyResult,
  type OperationsActionKind,
  type OperationsActionPreviewParams,
  OperationsActionPreviewParamsSchema,
  type OperationsActionPreviewResult,
  type OperationsSnapshotParams,
  OperationsSnapshotParamsSchema,
  type OperationsSnapshotResult,
  type OperationsSnapshotV1Params,
  OperationsSnapshotV1ParamsSchema,
  type OperationsSnapshotV1Result,
  OperationsSnapshotV1ResultSchema,
  type OperationsSnapshotV2Params,
  OperationsSnapshotV2ParamsSchema,
  type OperationsSnapshotV2Result,
  OperationsSnapshotV2ResultSchema,
  type OperationsStatus,
  type ShutdownEvent,
  ShutdownEventSchema,
  type SkillsBinsParams,
  SkillsBinsParamsSchema,
  type SkillsBinsResult,
  type SkillsDetailParams,
  SkillsDetailParamsSchema,
  type SkillsDetailResult,
  SkillsDetailResultSchema,
  type SkillsInstallParams,
  SkillsInstallParamsSchema,
  type SkillsCuratorActionParams,
  SkillsCuratorActionParamsSchema,
  type SkillsCuratorActionResult,
  SkillsCuratorActionResultSchema,
  type SkillsCuratorStatusParams,
  SkillsCuratorStatusParamsSchema,
  type SkillsCuratorStatusResult,
  SkillsCuratorStatusResultSchema,
  type SkillsProposalActionParams,
  SkillsProposalActionParamsSchema,
  type SkillsProposalApplyResult,
  SkillsProposalApplyResultSchema,
  type SkillsProposalCreateParams,
  SkillsProposalCreateParamsSchema,
  type SkillsProposalInspectParams,
  SkillsProposalInspectParamsSchema,
  type SkillsProposalInspectResult,
  SkillsProposalInspectResultSchema,
  type SkillsProposalRecordResult,
  SkillsProposalRecordResultSchema,
  type SkillsProposalRequestRevisionParams,
  SkillsProposalRequestRevisionParamsSchema,
  type SkillsProposalRequestRevisionResult,
  SkillsProposalRequestRevisionResultSchema,
  type SkillsProposalReviseParams,
  SkillsProposalReviseParamsSchema,
  type SkillsProposalUpdateParams,
  SkillsProposalUpdateParamsSchema,
  type SkillsProposalsListParams,
  SkillsProposalsListParamsSchema,
  type SkillsProposalsListResult,
  SkillsProposalsListResultSchema,
  type SkillsSearchParams,
  SkillsSearchParamsSchema,
  type SkillsSearchResult,
  SkillsSearchResultSchema,
  type SkillsSecurityVerdictsParams,
  SkillsSecurityVerdictsParamsSchema,
  type SkillsSecurityVerdictsResult,
  SkillsSecurityVerdictsResultSchema,
  type SkillsSkillCardParams,
  SkillsSkillCardParamsSchema,
  type SkillsSkillCardResult,
  SkillsSkillCardResultSchema,
  type SkillsStatusParams,
  SkillsStatusParamsSchema,
  type SkillsUploadBeginParams,
  SkillsUploadBeginParamsSchema,
  type SkillsUploadChunkParams,
  SkillsUploadChunkParamsSchema,
  type SkillsUploadCommitParams,
  SkillsUploadCommitParamsSchema,
  type SkillsUpdateParams,
  SkillsUpdateParamsSchema,
  type ToolsCatalogParams,
  ToolsCatalogParamsSchema,
  type ToolsCatalogResult,
  type ToolsEffectiveParams,
  ToolsEffectiveParamsSchema,
  type ToolsEffectiveResult,
  type ToolsInvokeParams,
  ToolsInvokeParamsSchema,
  type ToolsInvokeResult,
  type Snapshot,
  SnapshotSchema,
  type StateVersion,
  StateVersionSchema,
  type TalkModeParams,
  TalkModeParamsSchema,
  type TickEvent,
  TickEventSchema,
  type UpdateRunParams,
  UpdateRunParamsSchema,
  type WakeParams,
  WakeParamsSchema,
  type WebLoginStartParams,
  WebLoginStartParamsSchema,
  type WebLoginWaitParams,
  WebLoginWaitParamsSchema,
  type CrestodianChatParams,
  CrestodianChatParamsSchema,
  type CrestodianChatResult,
  CrestodianChatResultSchema,
  type CrestodianSetupDetectParams,
  CrestodianSetupDetectParamsSchema,
  type CrestodianSetupDetectResult,
  CrestodianSetupDetectResultSchema,
  type CrestodianSetupActivateParams,
  CrestodianSetupActivateParamsSchema,
  type CrestodianSetupActivateResult,
  CrestodianSetupActivateResultSchema,
  type WizardCancelParams,
  WizardCancelParamsSchema,
  type WizardNextParams,
  WizardNextParamsSchema,
  type WizardNextResult,
  WizardNextResultSchema,
  type WizardStartParams,
  WizardStartParamsSchema,
  type WizardStartResult,
  WizardStartResultSchema,
  type WizardStatusParams,
  WizardStatusParamsSchema,
  type WizardStatusResult,
  WizardStatusResultSchema,
  type WizardStep,
  WizardStepSchema,
  type WorktreeRecord,
  WorktreeRecordSchema,
  type WorktreesListParams,
  WorktreesListParamsSchema,
  type WorktreesListResult,
  WorktreesListResultSchema,
  type WorktreesCreateParams,
  WorktreesCreateParamsSchema,
  type WorktreesRemoveParams,
  WorktreesRemoveParamsSchema,
  type WorktreesRemoveResult,
  WorktreesRemoveResultSchema,
  type WorktreesRestoreParams,
  WorktreesRestoreParamsSchema,
  type WorktreesGcParams,
  WorktreesGcParamsSchema,
  type WorktreesGcResult,
  WorktreesGcResultSchema,
} from "./schema.js";
import * as SelfImprovementProtocol from "./schema/self-improvement.js";

/** Normalized validation error shape exposed by every protocol validator. */
export type ValidationError = {
  /** Failed schema keyword, when the validator can report one. */
  keyword?: string;
  /** JSON-pointer path to the failing data location. */
  instancePath?: string;
  /** JSON-pointer path to the failing schema location. */
  schemaPath?: string;
  /** Validator-specific keyword parameters for richer diagnostics. */
  params?: Record<string, unknown>;
  /** Human-readable validation message. */
  message?: string;
};

export * from "./schema/self-improvement.js";

/** Runtime validator shape shared by gateway clients and server handlers. */
export type ProtocolValidator<T = unknown> = ((data: unknown) => data is T) & {
  /** Last validation errors, matching Ajv-style caller expectations. */
  errors: ValidationError[] | null;
  /** Original schema used by the validator, exposed for diagnostics/tests. */
  schema: unknown;
};

// Defer TypeBox compilation until the first validation call. Importing this
// module is common in CLIs/tests, so eager compilation would add startup cost.
function lazyCompile<T = unknown>(schema: unknown): ProtocolValidator<T> {
  let compiled: TypeBoxValidator | undefined;
  let errors: ValidationError[] | null = null;

  const getCompiled = () => {
    compiled ??= Compile(schema as never);
    return compiled;
  };

  const validate = ((data: unknown): data is T => {
    const current = getCompiled();
    const valid = current.Check(data);
    errors = valid ? null : ([...current.Errors(data)] as ValidationError[]);
    return valid;
  }) as ProtocolValidator<T>;

  Object.defineProperties(validate, {
    errors: {
      configurable: true,
      enumerable: true,
      get: () => errors,
      set: (nextErrors: ValidationError[] | null | undefined) => {
        // Preserve Ajv-compatible mutability for callers/tests that clear errors.
        errors = nextErrors ?? null;
      },
    },
    schema: {
      configurable: true,
      enumerable: true,
      get: () => schema,
    },
  });

  return validate;
}

function asPublicResultValidator<T>(validator: ProtocolValidator<T>): ProtocolValidator {
  return validator as ProtocolValidator;
}

// Public per-method validators. Names intentionally mirror the exported schema
// constants so call sites can pair validation with the wire contract directly.
export const validateCommandsListParams = lazyCompile<CommandsListParams>(CommandsListParamsSchema);
export const validateSelfImprovementScanParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementScanParams>(
    SelfImprovementProtocol.SelfImprovementScanParamsSchema,
  );
export const validateSelfImprovementScorecardParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementScorecardParams>(
    SelfImprovementProtocol.SelfImprovementScorecardParamsSchema,
  );
export const validateSelfImprovementHealthParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementHealthParams>(
    SelfImprovementProtocol.SelfImprovementHealthParamsSchema,
  );
export const validateSelfImprovementProductionCheckParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementProductionCheckParams>(
    SelfImprovementProtocol.SelfImprovementProductionCheckParamsSchema,
  );
export const validateSelfImprovementProductionCheckResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementProductionCheckResult>(
    SelfImprovementProtocol.SelfImprovementProductionCheckResultSchema,
  ),
);
export const validateSelfImprovementMaintenanceRunParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementMaintenanceRunParams>(
    SelfImprovementProtocol.SelfImprovementMaintenanceRunParamsSchema,
  );
export const validateSelfImprovementMaintenanceResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementMaintenanceResult>(
    SelfImprovementProtocol.SelfImprovementMaintenanceResultSchema,
  ),
);
export const validateSelfImprovementDashboardInterventionParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementDashboardInterventionParams>(
    SelfImprovementProtocol.SelfImprovementDashboardInterventionParamsSchema,
  );
export const validateSelfImprovementDashboardInterventionResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementDashboardInterventionResult>(
    SelfImprovementProtocol.SelfImprovementDashboardInterventionResultSchema,
  ),
);
export const validateControlDirectorLayoutObservationReportParams =
  lazyCompile<SelfImprovementProtocol.ControlDirectorLayoutObservationReportParams>(
    SelfImprovementProtocol.ControlDirectorLayoutObservationReportParamsSchema,
  );
export const validateControlDirectorLayoutObservationReportResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.ControlDirectorLayoutObservationReportResult>(
    SelfImprovementProtocol.ControlDirectorLayoutObservationReportResultSchema,
  ),
);
export const validateSelfImprovementProofReceiptsListParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementProofReceiptsListParams>(
    SelfImprovementProtocol.SelfImprovementProofReceiptsListParamsSchema,
  );
export const validateSelfImprovementProofReceiptsListResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementProofReceiptsListResult>(
    SelfImprovementProtocol.SelfImprovementProofReceiptsListResultSchema,
  ),
);
export const validateSelfImprovementProofReceiptRecordParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementProofReceiptRecordParams>(
    SelfImprovementProtocol.SelfImprovementProofReceiptRecordParamsSchema,
  );
export const validateSelfImprovementProofReceiptRecordResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementProofReceiptRecordResult>(
    SelfImprovementProtocol.SelfImprovementProofReceiptRecordResultSchema,
  ),
);
export const validateSelfImprovementOperationalHealthResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementOperationalHealthResult>(
    SelfImprovementProtocol.SelfImprovementOperationalHealthResultSchema,
  ),
);
export const validateSelfImprovementAnalysisRunParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementAnalysisRunParams>(
    SelfImprovementProtocol.SelfImprovementAnalysisRunParamsSchema,
  );
export const validateSelfImprovementAnalysisRunResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementAnalysisRunResult>(
    SelfImprovementProtocol.SelfImprovementAnalysisRunResultSchema,
  ),
);
export const validateSelfImprovementAuditEventsListParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementAuditEventsListParams>(
    SelfImprovementProtocol.SelfImprovementAuditEventsListParamsSchema,
  );
export const validateSelfImprovementAuditEventsListResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementAuditEventsListResult>(
    SelfImprovementProtocol.SelfImprovementAuditEventsListResultSchema,
  ),
);
export const validateSelfImprovementModelPreflightParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementModelPreflightParams>(
    SelfImprovementProtocol.SelfImprovementModelPreflightParamsSchema,
  );
export const validateSelfImprovementModelPreflightResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementModelPreflightResult>(
    SelfImprovementProtocol.SelfImprovementModelPreflightResultSchema,
  ),
);
export const validateSelfImprovementReviewerEvalRunParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementReviewerEvalRunParams>(
    SelfImprovementProtocol.SelfImprovementReviewerEvalRunParamsSchema,
  );
export const validateSelfImprovementReviewerEvalRunResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementReviewerEvalRunResult>(
    SelfImprovementProtocol.SelfImprovementReviewerEvalRunResultSchema,
  ),
);
export const validateSelfImprovementRecommendationsListParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementRecommendationsListParams>(
    SelfImprovementProtocol.SelfImprovementRecommendationsListParamsSchema,
  );
export const validateSelfImprovementRecommendationsSummaryParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementRecommendationsSummaryParams>(
    SelfImprovementProtocol.SelfImprovementRecommendationsSummaryParamsSchema,
  );
export const validateSelfImprovementRecommendationsSummaryResult = asPublicResultValidator(
  lazyCompile<SelfImprovementProtocol.SelfImprovementRecommendationsSummaryResult>(
    SelfImprovementProtocol.SelfImprovementRecommendationsSummaryResultSchema,
  ),
);
export const validateSelfImprovementRecommendationsGetParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementRecommendationsGetParams>(
    SelfImprovementProtocol.SelfImprovementRecommendationsGetParamsSchema,
  );
export const validateSelfImprovementRecommendationsUpdateParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementRecommendationsUpdateParams>(
    SelfImprovementProtocol.SelfImprovementRecommendationsUpdateParamsSchema,
  );
export const validateSelfImprovementGroupsUpdateParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementGroupsUpdateParams>(
    SelfImprovementProtocol.SelfImprovementGroupsUpdateParamsSchema,
  );
export const validateSelfImprovementProposalsListParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementProposalsListParams>(
    SelfImprovementProtocol.SelfImprovementProposalsListParamsSchema,
  );
export const validateSelfImprovementProposalsGetParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementProposalsGetParams>(
    SelfImprovementProtocol.SelfImprovementProposalsGetParamsSchema,
  );
export const validateSelfImprovementProposalsUpdateParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementProposalsUpdateParams>(
    SelfImprovementProtocol.SelfImprovementProposalsUpdateParamsSchema,
  );
export const validateSelfImprovementCuratorListParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementCuratorListParams>(
    SelfImprovementProtocol.SelfImprovementCuratorListParamsSchema,
  );
export const validateSelfImprovementCuratorGetParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementCuratorGetParams>(
    SelfImprovementProtocol.SelfImprovementCuratorGetParamsSchema,
  );
export const validateSelfImprovementCuratorUpdateParams =
  lazyCompile<SelfImprovementProtocol.SelfImprovementCuratorUpdateParams>(
    SelfImprovementProtocol.SelfImprovementCuratorUpdateParamsSchema,
  );
export const validateConnectParams = lazyCompile<ConnectParams>(ConnectParamsSchema);
export const validateRequestFrame = lazyCompile<RequestFrame>(RequestFrameSchema);
export const validateResponseFrame = lazyCompile<ResponseFrame>(ResponseFrameSchema);
export const validateEventFrame = lazyCompile<EventFrame>(EventFrameSchema);
export const validateMessageActionParams =
  lazyCompile<MessageActionParams>(MessageActionParamsSchema);
export const validateSendParams = lazyCompile(SendParamsSchema);
export const validatePollParams = lazyCompile<PollParams>(PollParamsSchema);
export const validateAgentParams = lazyCompile(AgentParamsSchema);
export const validateAuditListParams = lazyCompile<AuditListParams>(AuditListParamsSchema);
export const validateAgentIdentityParams =
  lazyCompile<AgentIdentityParams>(AgentIdentityParamsSchema);
export const validateAgentWaitParams = lazyCompile<AgentWaitParams>(AgentWaitParamsSchema);
export const validateWakeParams = lazyCompile<WakeParams>(WakeParamsSchema);
export const validateAgentsListParams = lazyCompile<AgentsListParams>(AgentsListParamsSchema);
export const validateWorktreesListParams =
  lazyCompile<WorktreesListParams>(WorktreesListParamsSchema);
export const validateWorktreesCreateParams = lazyCompile<WorktreesCreateParams>(
  WorktreesCreateParamsSchema,
);
export const validateWorktreesRemoveParams = lazyCompile<WorktreesRemoveParams>(
  WorktreesRemoveParamsSchema,
);
export const validateWorktreesRestoreParams = lazyCompile<WorktreesRestoreParams>(
  WorktreesRestoreParamsSchema,
);
export const validateWorktreesGcParams = lazyCompile<WorktreesGcParams>(WorktreesGcParamsSchema);
export const validateAgentsCreateParams = lazyCompile<AgentsCreateParams>(AgentsCreateParamsSchema);
export const validateAgentsUpdateParams = lazyCompile<AgentsUpdateParams>(AgentsUpdateParamsSchema);
export const validateAgentsDeleteParams = lazyCompile<AgentsDeleteParams>(AgentsDeleteParamsSchema);
export const validateAgentsFilesListParams = lazyCompile<AgentsFilesListParams>(
  AgentsFilesListParamsSchema,
);
export const validateAgentsFilesGetParams = lazyCompile<AgentsFilesGetParams>(
  AgentsFilesGetParamsSchema,
);
export const validateAgentsFilesSetParams = lazyCompile<AgentsFilesSetParams>(
  AgentsFilesSetParamsSchema,
);
export const validateAgentsWorkspaceListParams = lazyCompile<AgentsWorkspaceListParams>(
  AgentsWorkspaceListParamsSchema,
);
export const validateAgentsWorkspaceGetParams = lazyCompile<AgentsWorkspaceGetParams>(
  AgentsWorkspaceGetParamsSchema,
);
export const validateArtifactsListParams =
  lazyCompile<ArtifactsListParams>(ArtifactsListParamsSchema);
export const validateArtifactsGetParams = lazyCompile<ArtifactsGetParams>(ArtifactsGetParamsSchema);
export const validateArtifactsDownloadParams = lazyCompile<ArtifactsDownloadParams>(
  ArtifactsDownloadParamsSchema,
);
export const validateNodePairRequestParams = lazyCompile<NodePairRequestParams>(
  NodePairRequestParamsSchema,
);
export const validateNodePairListParams = lazyCompile<NodePairListParams>(NodePairListParamsSchema);
export const validateNodePairApproveParams = lazyCompile<NodePairApproveParams>(
  NodePairApproveParamsSchema,
);
export const validateNodePairRejectParams = lazyCompile<NodePairRejectParams>(
  NodePairRejectParamsSchema,
);
export const validateNodePairRemoveParams = lazyCompile<NodePairRemoveParams>(
  NodePairRemoveParamsSchema,
);
export const validateNodePairVerifyParams = lazyCompile<NodePairVerifyParams>(
  NodePairVerifyParamsSchema,
);
export const validateNodeRenameParams = lazyCompile<NodeRenameParams>(NodeRenameParamsSchema);
export const validateNodeListParams = lazyCompile<NodeListParams>(NodeListParamsSchema);
export const validateEnvironmentsListParams = lazyCompile<EnvironmentsListParams>(
  EnvironmentsListParamsSchema,
);
export const validateEnvironmentsStatusParams = lazyCompile<EnvironmentsStatusParams>(
  EnvironmentsStatusParamsSchema,
);
export const validateSystemInfoParams = lazyCompile<SystemInfoParams>(SystemInfoParamsSchema);
export const validateSystemInfoResult = lazyCompile<SystemInfoResult>(SystemInfoResultSchema);
export const validateNodePendingAckParams = lazyCompile<NodePendingAckParams>(
  NodePendingAckParamsSchema,
);
export const validateNodeDescribeParams = lazyCompile<NodeDescribeParams>(NodeDescribeParamsSchema);
export const validateNodeInvokeParams = lazyCompile<NodeInvokeParams>(NodeInvokeParamsSchema);
export const validateNodeInvokeResultParams = lazyCompile<NodeInvokeResultParams>(
  NodeInvokeResultParamsSchema,
);
export const validateNodeEventParams = lazyCompile<NodeEventParams>(NodeEventParamsSchema);
export const validateNodeEventResult = lazyCompile<NodeEventResult>(NodeEventResultSchema);
export const validateNodePresenceAlivePayload = lazyCompile<NodePresenceAlivePayload>(
  NodePresenceAlivePayloadSchema,
);
export const validateNodePendingDrainParams = lazyCompile<NodePendingDrainParams>(
  NodePendingDrainParamsSchema,
);
export const validateNodePendingEnqueueParams = lazyCompile<NodePendingEnqueueParams>(
  NodePendingEnqueueParamsSchema,
);
export const validatePushTestParams = lazyCompile<PushTestParams>(PushTestParamsSchema);
export const validateWebPushVapidPublicKeyParams = lazyCompile<WebPushVapidPublicKeyParams>(
  WebPushVapidPublicKeyParamsSchema,
);
export const validateWebPushSubscribeParams = lazyCompile<WebPushSubscribeParams>(
  WebPushSubscribeParamsSchema,
);
export const validateWebPushUnsubscribeParams = lazyCompile<WebPushUnsubscribeParams>(
  WebPushUnsubscribeParamsSchema,
);
export const validateWebPushTestParams = lazyCompile<WebPushTestParams>(WebPushTestParamsSchema);
export const validateSecretsResolveParams = lazyCompile<SecretsResolveParams>(
  SecretsResolveParamsSchema,
);
export const validateSecretsResolveResult = lazyCompile<SecretsResolveResult>(
  SecretsResolveResultSchema,
);
export const validateSessionsListParams = lazyCompile<SessionsListParams>(SessionsListParamsSchema);
export const validateSessionsCleanupParams = lazyCompile<SessionsCleanupParams>(
  SessionsCleanupParamsSchema,
);
export const validateSessionsPreviewParams = lazyCompile<SessionsPreviewParams>(
  SessionsPreviewParamsSchema,
);
export const validateSessionsDescribeParams = lazyCompile<SessionsDescribeParams>(
  SessionsDescribeParamsSchema,
);
export const validateSessionsResolveParams = lazyCompile<SessionsResolveParams>(
  SessionsResolveParamsSchema,
);
export const validateSessionsFilesListParams = lazyCompile<SessionsFilesListParams>(
  SessionsFilesListParamsSchema,
);
export const validateSessionsFilesGetParams = lazyCompile<SessionsFilesGetParams>(
  SessionsFilesGetParamsSchema,
);
export const validateSessionsCreateParams = lazyCompile<SessionsCreateParams>(
  SessionsCreateParamsSchema,
);
export const validateSessionsSendParams = lazyCompile<SessionsSendParams>(SessionsSendParamsSchema);
export const validateSessionsMessagesSubscribeParams = lazyCompile<SessionsMessagesSubscribeParams>(
  SessionsMessagesSubscribeParamsSchema,
);
export const validateSessionsMessagesUnsubscribeParams =
  lazyCompile<SessionsMessagesUnsubscribeParams>(SessionsMessagesUnsubscribeParamsSchema);
export const validateSessionsAbortParams =
  lazyCompile<SessionsAbortParams>(SessionsAbortParamsSchema);
export const validateSessionsPatchParams =
  lazyCompile<SessionsPatchParams>(SessionsPatchParamsSchema);
export const validateSessionsPluginPatchParams = lazyCompile<SessionsPluginPatchParams>(
  SessionsPluginPatchParamsSchema,
);
export const validateSessionsResetParams =
  lazyCompile<SessionsResetParams>(SessionsResetParamsSchema);
export const validateSessionsDeleteParams = lazyCompile<SessionsDeleteParams>(
  SessionsDeleteParamsSchema,
);
export const validateSessionsCompactParams = lazyCompile<SessionsCompactParams>(
  SessionsCompactParamsSchema,
);
export const validateSessionsCompactionListParams = lazyCompile<SessionsCompactionListParams>(
  SessionsCompactionListParamsSchema,
);
export const validateSessionsCompactionGetParams = lazyCompile<SessionsCompactionGetParams>(
  SessionsCompactionGetParamsSchema,
);
export const validateSessionsCompactionBranchParams = lazyCompile<SessionsCompactionBranchParams>(
  SessionsCompactionBranchParamsSchema,
);
export const validateSessionsCompactionRestoreParams = lazyCompile<SessionsCompactionRestoreParams>(
  SessionsCompactionRestoreParamsSchema,
);
export const validateSessionsUsageParams =
  lazyCompile<SessionsUsageParams>(SessionsUsageParamsSchema);
export const validateChatTurnsListParams =
  lazyCompile<ChatTurnsListParams>(ChatTurnsListParamsSchema);
export const validateChatTurnsCreateParams = lazyCompile<ChatTurnsCreateParams>(
  ChatTurnsCreateParamsSchema,
);
export const validateChatTurnsSetModeParams = lazyCompile<ChatTurnsSetModeParams>(
  ChatTurnsSetModeParamsSchema,
);
export const validateChatTurnsCancelParams = lazyCompile<ChatTurnsCancelParams>(
  ChatTurnsCancelParamsSchema,
);
export const validateChatTurnsRetryParams = lazyCompile<ChatTurnsRetryParams>(
  ChatTurnsRetryParamsSchema,
);
export const validateExecutionStateGetParams = lazyCompile<ExecutionStateGetParams>(
  ExecutionStateGetParamsSchema,
);
export const validateTaskFlowsListParams =
  lazyCompile<TaskFlowsListParams>(TaskFlowsListParamsSchema);
export const validateTaskFlowsGetParams = lazyCompile<TaskFlowsGetParams>(TaskFlowsGetParamsSchema);
export const validateTaskFlowsCreateParams = lazyCompile<TaskFlowsCreateParams>(
  TaskFlowsCreateParamsSchema,
);
export const validateTaskFlowsCancelParams = lazyCompile<TaskFlowsCancelParams>(
  TaskFlowsCancelParamsSchema,
);
export const validateTaskFlowsControlParams = lazyCompile<TaskFlowsControlParams>(
  TaskFlowsControlParamsSchema,
);
export const validateTaskFlowsPauseParams = lazyCompile<TaskFlowsPauseParams>(
  TaskFlowsPauseParamsSchema,
);
export const validateTaskFlowsResumeParams = lazyCompile<TaskFlowsResumeParams>(
  TaskFlowsResumeParamsSchema,
);
export const validateTaskFlowsEditParams =
  lazyCompile<TaskFlowsEditParams>(TaskFlowsEditParamsSchema);
export const validateTaskFlowsRetryParams = lazyCompile<TaskFlowsRetryParams>(
  TaskFlowsRetryParamsSchema,
);
export const validateTaskFlowsStopParams =
  lazyCompile<TaskFlowsStopParams>(TaskFlowsStopParamsSchema);
export const validateTasksListParams = lazyCompile<TasksListParams>(TasksListParamsSchema);
export const validateTasksGetParams = lazyCompile<TasksGetParams>(TasksGetParamsSchema);
export const validateTasksCancelParams = lazyCompile<TasksCancelParams>(TasksCancelParamsSchema);

export const validatePccProjectsListParams = lazyCompile<PccProjectsListParams>(
  PccProjectsListParamsSchema,
);
export const validatePccProjectsGetParams = lazyCompile<PccProjectsGetParams>(
  PccProjectsGetParamsSchema,
);
export const validatePccProjectsUpsertParams = lazyCompile<PccProjectsUpsertParams>(
  PccProjectsUpsertParamsSchema,
);
export const validatePccProjectPlanCommitParams = lazyCompile<PccProjectPlanCommitParams>(
  PccProjectPlanCommitParamsSchema,
);
export const validatePccPlansGenerateParams = lazyCompile<PccPlansGenerateParams>(
  PccPlansGenerateParamsSchema,
);
export const validatePccPlansStartParams =
  lazyCompile<PccPlansStartParams>(PccPlansStartParamsSchema);
export const validatePccPlansGetParams = lazyCompile<PccPlansGetParams>(PccPlansGetParamsSchema);
export const validatePccPlansCancelParams = lazyCompile<PccPlansCancelParams>(
  PccPlansCancelParamsSchema,
);
export const validatePccExecutionStartParams = lazyCompile<PccExecutionStartParams>(
  PccExecutionStartParamsSchema,
);
export const validatePccExecutionGetParams = lazyCompile<PccExecutionGetParams>(
  PccExecutionGetParamsSchema,
);
export const validatePccExecutionControlParams = lazyCompile<PccExecutionControlParams>(
  PccExecutionControlParamsSchema,
);
export const validatePccExecutionReviewParams = lazyCompile<PccExecutionReviewParams>(
  PccExecutionReviewParamsSchema,
);
export const validatePccAttachmentsUploadBeginParams = lazyCompile<PccAttachmentsUploadBeginParams>(
  PccAttachmentsUploadBeginParamsSchema,
);
export const validatePccAttachmentsUploadChunkParams = lazyCompile<PccAttachmentsUploadChunkParams>(
  PccAttachmentsUploadChunkParamsSchema,
);
export const validatePccAttachmentsUploadCommitParams =
  lazyCompile<PccAttachmentsUploadCommitParams>(PccAttachmentsUploadCommitParamsSchema);
export const validatePccAttachmentsListParams = lazyCompile<PccAttachmentsListParams>(
  PccAttachmentsListParamsSchema,
);
export const validatePccAttachmentsReadParams = lazyCompile<PccAttachmentsReadParams>(
  PccAttachmentsReadParamsSchema,
);
export const validatePccAttachmentsUpdateParams = lazyCompile<PccAttachmentsUpdateParams>(
  PccAttachmentsUpdateParamsSchema,
);
export const validatePccAttachmentsClarifyParams = lazyCompile<PccAttachmentsClarifyParams>(
  PccAttachmentsClarifyParamsSchema,
);
export const validatePccAttachmentUsageRecordParams = lazyCompile<PccAttachmentUsageRecordParams>(
  PccAttachmentUsageRecordParamsSchema,
);
export const validatePccAttachmentUsageListParams = lazyCompile<PccAttachmentUsageListParams>(
  PccAttachmentUsageListParamsSchema,
);
export const validatePccPlanningPolicyGetParams = lazyCompile<PccPlanningPolicyGetParams>(
  PccPlanningPolicyGetParamsSchema,
);
export const validatePccPlanningPolicyUpsertParams = lazyCompile<PccPlanningPolicyUpsertParams>(
  PccPlanningPolicyUpsertParamsSchema,
);
export const validatePccMilestonesUpsertParams = lazyCompile<PccMilestonesUpsertParams>(
  PccMilestonesUpsertParamsSchema,
);
export const validatePccSubMilestonesListParams = lazyCompile<PccSubMilestonesListParams>(
  PccSubMilestonesListParamsSchema,
);
export const validatePccSubMilestonesUpsertParams = lazyCompile<PccSubMilestonesUpsertParams>(
  PccSubMilestonesUpsertParamsSchema,
);
export const validatePccPermissionsUpsertParams = lazyCompile<PccPermissionsUpsertParams>(
  PccPermissionsUpsertParamsSchema,
);
export const validatePccEvidenceAddParams = lazyCompile<PccEvidenceAddParams>(
  PccEvidenceAddParamsSchema,
);
export const validatePccDecisionsAddParams = lazyCompile<PccDecisionsAddParams>(
  PccDecisionsAddParamsSchema,
);
export const validatePccReceiptsAddParams = lazyCompile<PccReceiptsAddParams>(
  PccReceiptsAddParamsSchema,
);
export const validatePccLastKnownGoodUpsertParams = lazyCompile<PccLastKnownGoodUpsertParams>(
  PccLastKnownGoodUpsertParamsSchema,
);
export const validatePccSummaryGetParams =
  lazyCompile<PccSummaryGetParams>(PccSummaryGetParamsSchema);
export const validatePccOverviewGetParams = lazyCompile<PccOverviewGetParams>(
  PccOverviewGetParamsSchema,
);
export const validatePccPresenceUpdateParams = lazyCompile<PccPresenceUpdateParams>(
  PccPresenceUpdateParamsSchema,
);
export const validatePccPresenceListParams = lazyCompile<PccPresenceListParams>(
  PccPresenceListParamsSchema,
);

export const validateOperationsSnapshotParams = lazyCompile<OperationsSnapshotParams>(
  OperationsSnapshotParamsSchema,
);
export const validateOperationsSnapshotV1Params = lazyCompile<OperationsSnapshotV1Params>(
  OperationsSnapshotV1ParamsSchema,
);
export const validateOperationsSnapshotV1Result = lazyCompile<OperationsSnapshotV1Result>(
  OperationsSnapshotV1ResultSchema,
);
export const validateOperationsSnapshotV2Params = lazyCompile<OperationsSnapshotV2Params>(
  OperationsSnapshotV2ParamsSchema,
);
export const validateOperationsSnapshotV2Result = lazyCompile<OperationsSnapshotV2Result>(
  OperationsSnapshotV2ResultSchema,
);
export const validateOperationsActionPreviewParams = lazyCompile<OperationsActionPreviewParams>(
  OperationsActionPreviewParamsSchema,
);
export const validateOperationsActionApplyParams = lazyCompile<OperationsActionApplyParams>(
  OperationsActionApplyParamsSchema,
);

export const validateConfigGetParams = lazyCompile<ConfigGetParams>(ConfigGetParamsSchema);
export const validateConfigSetParams = lazyCompile<ConfigSetParams>(ConfigSetParamsSchema);
export const validateConfigApplyParams = lazyCompile<ConfigApplyParams>(ConfigApplyParamsSchema);
export const validateConfigPatchParams = lazyCompile<ConfigPatchParams>(ConfigPatchParamsSchema);
export const validateConfigSchemaParams = lazyCompile<ConfigSchemaParams>(ConfigSchemaParamsSchema);
export const validateConfigSchemaLookupParams = lazyCompile<ConfigSchemaLookupParams>(
  ConfigSchemaLookupParamsSchema,
);
export const validateConfigSchemaLookupResult = lazyCompile<ConfigSchemaLookupResult>(
  ConfigSchemaLookupResultSchema,
);
export const validateCrestodianChatParams = lazyCompile<CrestodianChatParams>(
  CrestodianChatParamsSchema,
);
export const validateCrestodianSetupDetectParams = lazyCompile<CrestodianSetupDetectParams>(
  CrestodianSetupDetectParamsSchema,
);
export const validateCrestodianSetupActivateParams = lazyCompile<CrestodianSetupActivateParams>(
  CrestodianSetupActivateParamsSchema,
);
export const validateWizardStartParams = lazyCompile<WizardStartParams>(WizardStartParamsSchema);
export const validateWizardNextParams = lazyCompile<WizardNextParams>(WizardNextParamsSchema);
export const validateWizardCancelParams = lazyCompile<WizardCancelParams>(WizardCancelParamsSchema);
export const validateWizardStatusParams = lazyCompile<WizardStatusParams>(WizardStatusParamsSchema);
export const validateTalkModeParams = lazyCompile<TalkModeParams>(TalkModeParamsSchema);
export const validateTalkEvent = lazyCompile<TalkEvent>(TalkEventSchema);
export const validateTalkCatalogParams = lazyCompile<TalkCatalogParams>(TalkCatalogParamsSchema);
export const validateTalkCatalogResult = lazyCompile<TalkCatalogResult>(TalkCatalogResultSchema);
export const validateTalkConfigParams = lazyCompile<TalkConfigParams>(TalkConfigParamsSchema);
export const validateTalkConfigResult = lazyCompile<TalkConfigResult>(TalkConfigResultSchema);
export const validateTalkClientCreateParams = lazyCompile<TalkClientCreateParams>(
  TalkClientCreateParamsSchema,
);
export const validateTalkClientCreateResult = lazyCompile<TalkClientCreateResult>(
  TalkClientCreateResultSchema,
);
export const validateTalkClientToolCallParams = lazyCompile<TalkClientToolCallParams>(
  TalkClientToolCallParamsSchema,
);
export const validateTalkClientToolCallResult = lazyCompile<TalkClientToolCallResult>(
  TalkClientToolCallResultSchema,
);
export const validateTalkClientSteerParams = lazyCompile<TalkClientSteerParams>(
  TalkClientSteerParamsSchema,
);
export const validateTalkAgentControlResult = lazyCompile<TalkAgentControlResult>(
  TalkAgentControlResultSchema,
);
export const validateTalkSessionCreateParams = lazyCompile<TalkSessionCreateParams>(
  TalkSessionCreateParamsSchema,
);
export const validateTalkSessionCreateResult = lazyCompile<TalkSessionCreateResult>(
  TalkSessionCreateResultSchema,
);
export const validateTalkSessionJoinParams = lazyCompile<TalkSessionJoinParams>(
  TalkSessionJoinParamsSchema,
);
export const validateTalkSessionJoinResult = lazyCompile<TalkSessionJoinResult>(
  TalkSessionJoinResultSchema,
);
export const validateTalkSessionAppendAudioParams = lazyCompile<TalkSessionAppendAudioParams>(
  TalkSessionAppendAudioParamsSchema,
);
export const validateTalkSessionTurnParams = lazyCompile<TalkSessionTurnParams>(
  TalkSessionTurnParamsSchema,
);
export const validateTalkSessionCancelTurnParams = lazyCompile<TalkSessionCancelTurnParams>(
  TalkSessionCancelTurnParamsSchema,
);
export const validateTalkSessionCancelOutputParams = lazyCompile<TalkSessionCancelOutputParams>(
  TalkSessionCancelOutputParamsSchema,
);
export const validateTalkSessionTurnResult = lazyCompile<TalkSessionTurnResult>(
  TalkSessionTurnResultSchema,
);
export const validateTalkSessionSteerParams = lazyCompile<TalkSessionSteerParams>(
  TalkSessionSteerParamsSchema,
);
export const validateTalkSessionSubmitToolResultParams =
  lazyCompile<TalkSessionSubmitToolResultParams>(TalkSessionSubmitToolResultParamsSchema);
export const validateTalkSessionCloseParams = lazyCompile<TalkSessionCloseParams>(
  TalkSessionCloseParamsSchema,
);
export const validateTalkSessionOkResult =
  lazyCompile<TalkSessionOkResult>(TalkSessionOkResultSchema);
export const validateTalkSpeakParams = lazyCompile<TalkSpeakParams>(TalkSpeakParamsSchema);
export const validateTalkSpeakResult = lazyCompile<TalkSpeakResult>(TalkSpeakResultSchema);
export const validateTtsSpeakParams = lazyCompile<TtsSpeakParams>(TtsSpeakParamsSchema);
export const validateTtsSpeakResult = lazyCompile<TtsSpeakResult>(TtsSpeakResultSchema);
export const validateChannelsStatusParams = lazyCompile<ChannelsStatusParams>(
  ChannelsStatusParamsSchema,
);
export const validateChannelsStartParams =
  lazyCompile<ChannelsStartParams>(ChannelsStartParamsSchema);
export const validateChannelsStopParams = lazyCompile<ChannelsStopParams>(ChannelsStopParamsSchema);
export const validateChannelsLogoutParams = lazyCompile<ChannelsLogoutParams>(
  ChannelsLogoutParamsSchema,
);
export const validateModelsListParams = lazyCompile<ModelsListParams>(ModelsListParamsSchema);
export const validateSkillsStatusParams = lazyCompile<SkillsStatusParams>(SkillsStatusParamsSchema);
export const validateToolsCatalogParams = lazyCompile<ToolsCatalogParams>(ToolsCatalogParamsSchema);
export const validateToolsEffectiveParams = lazyCompile<ToolsEffectiveParams>(
  ToolsEffectiveParamsSchema,
);
export const validateToolsInvokeParams = lazyCompile<ToolsInvokeParams>(ToolsInvokeParamsSchema);
export const validateSkillsBinsParams = lazyCompile<SkillsBinsParams>(SkillsBinsParamsSchema);
export const validateSkillsInstallParams =
  lazyCompile<SkillsInstallParams>(SkillsInstallParamsSchema);
export const validateSkillsUploadBeginParams = lazyCompile<SkillsUploadBeginParams>(
  SkillsUploadBeginParamsSchema,
);
export const validateSkillsUploadChunkParams = lazyCompile<SkillsUploadChunkParams>(
  SkillsUploadChunkParamsSchema,
);
export const validateSkillsUploadCommitParams = lazyCompile<SkillsUploadCommitParams>(
  SkillsUploadCommitParamsSchema,
);
export const validateSkillsUpdateParams = lazyCompile<SkillsUpdateParams>(SkillsUpdateParamsSchema);
export const validateSkillsSearchParams = lazyCompile<SkillsSearchParams>(SkillsSearchParamsSchema);
export const validateSkillsDetailParams = lazyCompile<SkillsDetailParams>(SkillsDetailParamsSchema);
export const validateSkillsCuratorStatusParams = lazyCompile<SkillsCuratorStatusParams>(
  SkillsCuratorStatusParamsSchema,
);
export const validateSkillsCuratorActionParams = lazyCompile<SkillsCuratorActionParams>(
  SkillsCuratorActionParamsSchema,
);
export const validateSkillsProposalsListParams = lazyCompile<SkillsProposalsListParams>(
  SkillsProposalsListParamsSchema,
);
export const validateSkillsProposalInspectParams = lazyCompile<SkillsProposalInspectParams>(
  SkillsProposalInspectParamsSchema,
);
export const validateSkillsProposalCreateParams = lazyCompile<SkillsProposalCreateParams>(
  SkillsProposalCreateParamsSchema,
);
export const validateSkillsProposalUpdateParams = lazyCompile<SkillsProposalUpdateParams>(
  SkillsProposalUpdateParamsSchema,
);
export const validateSkillsProposalReviseParams = lazyCompile<SkillsProposalReviseParams>(
  SkillsProposalReviseParamsSchema,
);
export const validateSkillsProposalRequestRevisionParams =
  lazyCompile<SkillsProposalRequestRevisionParams>(SkillsProposalRequestRevisionParamsSchema);
export const validateSkillsProposalActionParams = lazyCompile<SkillsProposalActionParams>(
  SkillsProposalActionParamsSchema,
);
export const validateSkillsSecurityVerdictsParams = lazyCompile<SkillsSecurityVerdictsParams>(
  SkillsSecurityVerdictsParamsSchema,
);
export const validateSkillsSkillCardParams = lazyCompile<SkillsSkillCardParams>(
  SkillsSkillCardParamsSchema,
);
export const validateCronListParams = lazyCompile<CronListParams>(CronListParamsSchema);
export const validateCronStatusParams = lazyCompile<CronStatusParams>(CronStatusParamsSchema);
export const validateCronGetParams = lazyCompile<CronGetParams>(CronGetParamsSchema);
export const validateCronAddParams = lazyCompile<CronAddParams>(CronAddParamsSchema);
export const validateCronUpdateParams = lazyCompile<CronUpdateParams>(CronUpdateParamsSchema);
export const validateCronRemoveParams = lazyCompile<CronRemoveParams>(CronRemoveParamsSchema);
export const validateCronRunParams = lazyCompile<CronRunParams>(CronRunParamsSchema);
export const validateCronRunsParams = lazyCompile<CronRunsParams>(CronRunsParamsSchema);
export const validateDevicePairListParams = lazyCompile<DevicePairListParams>(
  DevicePairListParamsSchema,
);
export const validateDevicePairApproveParams = lazyCompile<DevicePairApproveParams>(
  DevicePairApproveParamsSchema,
);
export const validateDevicePairRejectParams = lazyCompile<DevicePairRejectParams>(
  DevicePairRejectParamsSchema,
);
export const validateDevicePairRemoveParams = lazyCompile<DevicePairRemoveParams>(
  DevicePairRemoveParamsSchema,
);
export const validateDevicePairSetupCodeParams = lazyCompile<DevicePairSetupCodeParams>(
  DevicePairSetupCodeParamsSchema,
);
export const validateDeviceTokenRotateParams = lazyCompile<DeviceTokenRotateParams>(
  DeviceTokenRotateParamsSchema,
);
export const validateDeviceTokenRevokeParams = lazyCompile<DeviceTokenRevokeParams>(
  DeviceTokenRevokeParamsSchema,
);
export const validateExecApprovalsGetParams = lazyCompile<ExecApprovalsGetParams>(
  ExecApprovalsGetParamsSchema,
);
export const validateExecApprovalsSetParams = lazyCompile<ExecApprovalsSetParams>(
  ExecApprovalsSetParamsSchema,
);
export const validateExecApprovalGetParams = lazyCompile<ExecApprovalGetParams>(
  ExecApprovalGetParamsSchema,
);
export const validateExecApprovalRequestParams = lazyCompile<ExecApprovalRequestParams>(
  ExecApprovalRequestParamsSchema,
);
export const validateExecApprovalResolveParams = lazyCompile<ExecApprovalResolveParams>(
  ExecApprovalResolveParamsSchema,
);
export const validatePluginApprovalRequestParams = lazyCompile<PluginApprovalRequestParams>(
  PluginApprovalRequestParamsSchema,
);
export const validatePluginApprovalResolveParams = lazyCompile<PluginApprovalResolveParams>(
  PluginApprovalResolveParamsSchema,
);
export const validatePluginsUiDescriptorsParams = lazyCompile<PluginsUiDescriptorsParams>(
  PluginsUiDescriptorsParamsSchema,
);
export const validatePluginsUiDescriptorsResult = lazyCompile<PluginsUiDescriptorsResult>(
  PluginsUiDescriptorsResultSchema,
);
export const validatePluginsSessionActionParams = lazyCompile<PluginsSessionActionParams>(
  PluginsSessionActionParamsSchema,
);
export const validatePluginsSessionActionResult = lazyCompile<PluginsSessionActionResult>(
  PluginsSessionActionResultSchema,
);
export const validateExecApprovalsNodeGetParams = lazyCompile<ExecApprovalsNodeGetParams>(
  ExecApprovalsNodeGetParamsSchema,
);
export const validateExecApprovalsNodeSetParams = lazyCompile<ExecApprovalsNodeSetParams>(
  ExecApprovalsNodeSetParamsSchema,
);
export const validateExecApprovalsNodeSnapshot = lazyCompile<ExecApprovalsNodeSnapshot>(
  ExecApprovalsNodeSnapshotSchema,
);
export const validateLogsTailParams = lazyCompile<LogsTailParams>(LogsTailParamsSchema);
export const validateTerminalOpenParams = lazyCompile<TerminalOpenParams>(TerminalOpenParamsSchema);
export const validateTerminalInputParams =
  lazyCompile<TerminalInputParams>(TerminalInputParamsSchema);
export const validateTerminalResizeParams = lazyCompile<TerminalResizeParams>(
  TerminalResizeParamsSchema,
);
export const validateTerminalCloseParams =
  lazyCompile<TerminalCloseParams>(TerminalCloseParamsSchema);
export const validateTerminalAttachParams = lazyCompile<TerminalAttachParams>(
  TerminalAttachParamsSchema,
);
export const validateTerminalTextParams = lazyCompile<TerminalTextParams>(TerminalTextParamsSchema);
export const validateTerminalEvent = lazyCompile<TerminalEvent>(TerminalEventSchema);
export const validateChatHistoryParams = lazyCompile(ChatHistoryParamsSchema);
export const validateChatMetadataParams = lazyCompile<ChatMetadataParams>(ChatMetadataParamsSchema);
export const validateChatMessageGetParams = lazyCompile(ChatMessageGetParamsSchema);
export const validateChatSendParams = lazyCompile(ChatSendParamsSchema);
export const validateChatAbortParams = lazyCompile<ChatAbortParams>(ChatAbortParamsSchema);
export const validateChatInjectParams = lazyCompile<ChatInjectParams>(ChatInjectParamsSchema);
export const validateChatEvent = lazyCompile(ChatEventSchema);
export const validateChatMessageGetResult = lazyCompile(ChatMessageGetResultSchema);
export const validateUpdateStatusParams = lazyCompile<UpdateStatusParams>(UpdateStatusParamsSchema);
export const validateUpdateRunParams = lazyCompile<UpdateRunParams>(UpdateRunParamsSchema);
export const validateWebLoginStartParams =
  lazyCompile<WebLoginStartParams>(WebLoginStartParamsSchema);
export const validateWebLoginWaitParams = lazyCompile<WebLoginWaitParams>(WebLoginWaitParamsSchema);

function firstStringParam(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.find(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  }
  return undefined;
}

/** Convert validator errors into compact operator-facing failure text. */
export function formatValidationErrors(errors: ValidationError[] | null | undefined) {
  if (!errors?.length) {
    return "unknown validation error";
  }

  const parts: string[] = [];

  for (const err of errors) {
    const keyword = typeof err?.keyword === "string" ? err.keyword : "";
    const instancePath = typeof err?.instancePath === "string" ? err.instancePath : "";

    if (keyword === "additionalProperties") {
      const additionalProperty =
        firstStringParam(err?.params?.additionalProperty) ??
        firstStringParam(err?.params?.additionalProperties);
      if (additionalProperty) {
        const where = instancePath ? `at ${instancePath}` : "at root";
        parts.push(`${where}: unexpected property '${additionalProperty}'`);
        continue;
      }
    }
    if (keyword === "required") {
      const missingProperty =
        firstStringParam(err?.params?.missingProperty) ??
        firstStringParam(err?.params?.requiredProperties);
      if (missingProperty) {
        const where = instancePath ? `at ${instancePath}: ` : "";
        parts.push(`${where}must have required property '${missingProperty}'`);
        continue;
      }
    }

    const failingKeyword =
      typeof err?.params?.failingKeyword === "string" ? err.params.failingKeyword : "";
    // TypeBox reports conditional required-property misses through if/then
    // keywords, which otherwise hide the actionable missing-property context.
    const message =
      keyword === "then" || (keyword === "if" && failingKeyword === "then")
        ? "must have required conditional properties"
        : typeof err?.message === "string" && err.message.trim()
          ? err.message
          : "validation error";
    const where = instancePath ? `at ${instancePath}: ` : "";
    parts.push(`${where}${message}`);
  }

  // De-dupe while preserving order.
  const unique = uniqueStrings(parts.filter((part) => part.trim()));
  if (!unique.length) {
    return "unknown validation error";
  }
  return unique.join("; ");
}

// Schema exports stay explicit to make additions/removals reviewable as public
// protocol surface changes.
export {
  ConnectParamsSchema,
  GATEWAY_SERVER_CAPS,
  HelloOkSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  GatewayFrameSchema,
  PresenceEntrySchema,
  SnapshotSchema,
  ErrorShapeSchema,
  EnvironmentStatusSchema,
  EnvironmentSummarySchema,
  EnvironmentsListParamsSchema,
  EnvironmentsListResultSchema,
  EnvironmentsStatusParamsSchema,
  EnvironmentsStatusResultSchema,
  SystemInfoParamsSchema,
  SystemInfoResultSchema,
  StateVersionSchema,
  AgentEventSchema,
  MessageActionParamsSchema,
  ChatEventSchema,
  SendParamsSchema,
  PollParamsSchema,
  AgentParamsSchema,
  AgentIdentityParamsSchema,
  AgentIdentityResultSchema,
  WakeParamsSchema,
  PushTestParamsSchema,
  PushTestResultSchema,
  WebPushVapidPublicKeyParamsSchema,
  WebPushSubscribeParamsSchema,
  WebPushUnsubscribeParamsSchema,
  WebPushTestParamsSchema,
  NodePairRequestParamsSchema,
  NodePairListParamsSchema,
  NodePairApproveParamsSchema,
  NodePairRejectParamsSchema,
  NodePairRemoveParamsSchema,
  NodePairVerifyParamsSchema,
  NodeListParamsSchema,
  NodePendingAckParamsSchema,
  NodeInvokeParamsSchema,
  NodeEventResultSchema,
  NodePresenceAlivePayloadSchema,
  NodePresenceAliveReasonSchema,
  NodePendingDrainParamsSchema,
  NodePendingDrainResultSchema,
  NodePendingEnqueueParamsSchema,
  NodePendingEnqueueResultSchema,
  SessionsListParamsSchema,
  SessionsCleanupParamsSchema,
  SessionsPreviewParamsSchema,
  SessionsDescribeParamsSchema,
  SessionsResolveParamsSchema,
  SessionFileBrowserEntrySchema,
  SessionFileBrowserResultSchema,
  SessionFileEntrySchema,
  SessionFileKindSchema,
  SessionFileRelevanceSchema,
  SessionsFilesGetParamsSchema,
  SessionsFilesGetResultSchema,
  SessionsFilesListParamsSchema,
  SessionsFilesListResultSchema,
  SessionsCompactionListParamsSchema,
  SessionsCompactionGetParamsSchema,
  SessionsCompactionBranchParamsSchema,
  SessionsCompactionRestoreParamsSchema,
  SessionWorktreeInfoSchema,
  SessionsCreateParamsSchema,
  SessionsCreateResultSchema,
  SessionsSendParamsSchema,
  SessionsAbortParamsSchema,
  SessionsPatchParamsSchema,
  SessionsPluginPatchParamsSchema,
  SessionsResetParamsSchema,
  SessionsDeleteParamsSchema,
  SessionsCompactParamsSchema,
  SessionsUsageParamsSchema,
  ArtifactSummarySchema,
  ArtifactsListParamsSchema,
  ArtifactsGetParamsSchema,
  ArtifactsDownloadParamsSchema,
  AuditEventSchema,
  AuditListParamsSchema,
  AuditListResultSchema,
  ChatTurnModeSchema,
  ChatTurnPhaseSchema,
  ChatTurnSummarySchema,
  ChatTurnsListParamsSchema,
  ChatTurnsListResultSchema,
  ChatTurnsCreateParamsSchema,
  ChatTurnsCreateResultSchema,
  ChatTurnsSetModeParamsSchema,
  ChatTurnsCancelParamsSchema,
  ChatTurnsRetryParamsSchema,
  ChatTurnMutationResultSchema,
  ExecutionEventSchema,
  ExecutionStateGetParamsSchema,
  ExecutionStateHealthSchema,
  ControlDirectorMemoryHealthSchema,
  ControlDirectorRuntimeCanarySchema,
  ControlDirectorRuntimeLineageSchema,
  ExecutionStateSnapshotSchema,
  PursueGoalLeaseSchema,
  PursueGoalJudgeReceiptSchema,
  TaskFlowStatusSchema,
  TaskFlowSummarySchema,
  TaskFlowDetailSchema,
  TaskFlowControlActionSchema,
  TaskFlowsListParamsSchema,
  TaskFlowsListResultSchema,
  TaskFlowsGetParamsSchema,
  TaskFlowsGetResultSchema,
  TaskFlowsCreateParamsSchema,
  TaskFlowsCreateResultSchema,
  TaskFlowsCancelParamsSchema,
  TaskFlowsCancelResultSchema,
  TaskFlowsControlParamsSchema,
  TaskFlowsControlResultSchema,
  TaskFlowsPauseParamsSchema,
  TaskFlowsResumeParamsSchema,
  TaskFlowsEditParamsSchema,
  TaskFlowsRetryParamsSchema,
  TaskFlowsStopParamsSchema,
  TaskFlowMutationResultSchema,
  TaskSummarySchema,
  TasksListParamsSchema,
  TasksListResultSchema,
  TasksGetParamsSchema,
  TasksGetResultSchema,
  TasksCancelParamsSchema,
  TasksCancelResultSchema,
  PccPlansGenerateParamsSchema,
  PccPlansGenerateResultSchema,
  PccPlanningRunSchema,
  PccModelRunReceiptSchema,
  PccProjectAiUsageSummarySchema,
  PccProjectPlanCommitParamsSchema,
  PccProjectPlanCommitResultSchema,
  PccPlansStartParamsSchema,
  PccPlansStartResultSchema,
  PccPlansGetParamsSchema,
  PccPlansGetResultSchema,
  PccPlansCancelParamsSchema,
  PccPlansCancelResultSchema,
  PccExecutionStartParamsSchema,
  PccExecutionStartResultSchema,
  PccExecutionGetParamsSchema,
  PccExecutionGetResultSchema,
  PccExecutionControlParamsSchema,
  PccExecutionReviewParamsSchema,
  PccExecutionPauseResultSchema,
  PccExecutionResumeResultSchema,
  PccExecutionStopResultSchema,
  PccExecutionReviewResultSchema,
  PccAttachmentSchema,
  PccAttachmentUsageReceiptSchema,
  PccAttachmentsUploadBeginParamsSchema,
  PccAttachmentsUploadBeginResultSchema,
  PccAttachmentsUploadChunkParamsSchema,
  PccAttachmentsUploadChunkResultSchema,
  PccAttachmentsUploadCommitParamsSchema,
  PccAttachmentsUploadCommitResultSchema,
  PccAttachmentsListParamsSchema,
  PccAttachmentsListResultSchema,
  PccAttachmentsReadParamsSchema,
  PccAttachmentsReadResultSchema,
  PccAttachmentsUpdateParamsSchema,
  PccAttachmentsUpdateResultSchema,
  PccOverviewGetParamsSchema,
  PccOverviewGetResultSchema,
  PccChangedEventSchema,
  PccPresenceEntrySchema,
  PccPresenceUpdateParamsSchema,
  PccPresenceUpdateResultSchema,
  PccPresenceListParamsSchema,
  PccPresenceListResultSchema,
  PccAttachmentsClarifyParamsSchema,
  PccAttachmentsClarifyResultSchema,
  PccAttachmentUsageRecordParamsSchema,
  PccAttachmentUsageRecordResultSchema,
  PccAttachmentUsageListParamsSchema,
  PccAttachmentUsageListResultSchema,
  PccPlanningPolicyGetParamsSchema,
  PccPlanningPolicyGetResultSchema,
  PccPlanningPolicyUpsertParamsSchema,
  PccPlanningPolicyUpsertResultSchema,
  PccPrivateTeamPolicySchema,
  ConfigGetParamsSchema,
  ConfigSetParamsSchema,
  ConfigApplyParamsSchema,
  ConfigPatchParamsSchema,
  ConfigSchemaParamsSchema,
  ConfigSchemaLookupParamsSchema,
  ConfigSchemaResponseSchema,
  ConfigSchemaLookupResultSchema,
  UpdateStatusParamsSchema,
  CrestodianChatParamsSchema,
  CrestodianChatResultSchema,
  CrestodianSetupDetectParamsSchema,
  CrestodianSetupDetectResultSchema,
  CrestodianSetupActivateParamsSchema,
  CrestodianSetupActivateResultSchema,
  WizardStartParamsSchema,
  WizardNextParamsSchema,
  WizardCancelParamsSchema,
  WizardStatusParamsSchema,
  WizardStepSchema,
  WizardNextResultSchema,
  WizardStartResultSchema,
  WizardStatusResultSchema,
  TalkEventSchema,
  TalkCatalogParamsSchema,
  TalkCatalogResultSchema,
  TalkClientCreateParamsSchema,
  TalkClientCreateResultSchema,
  TalkAgentControlResultSchema,
  TalkClientSteerParamsSchema,
  TalkClientToolCallParamsSchema,
  TalkClientToolCallResultSchema,
  TalkConfigParamsSchema,
  TalkConfigResultSchema,
  TalkSessionAppendAudioParamsSchema,
  TalkSessionCancelOutputParamsSchema,
  TalkSessionCancelTurnParamsSchema,
  TalkSessionCreateParamsSchema,
  TalkSessionCreateResultSchema,
  TalkSessionJoinParamsSchema,
  TalkSessionJoinResultSchema,
  TalkSessionTurnParamsSchema,
  TalkSessionTurnResultSchema,
  TalkSessionSteerParamsSchema,
  TalkSessionSubmitToolResultParamsSchema,
  TalkSessionCloseParamsSchema,
  TalkSessionOkResultSchema,
  TalkSpeakParamsSchema,
  TalkSpeakResultSchema,
  TtsSpeakParamsSchema,
  TtsSpeakResultSchema,
  ChannelsStatusParamsSchema,
  ChannelsStatusResultSchema,
  ChannelsStartParamsSchema,
  ChannelsStopParamsSchema,
  ChannelsLogoutParamsSchema,
  WebLoginStartParamsSchema,
  WebLoginWaitParamsSchema,
  AgentSummarySchema,
  AgentsFileEntrySchema,
  AgentsCreateParamsSchema,
  AgentsCreateResultSchema,
  AgentsUpdateParamsSchema,
  AgentsUpdateResultSchema,
  AgentsDeleteParamsSchema,
  AgentsDeleteResultSchema,
  AgentsFilesListParamsSchema,
  AgentsFilesListResultSchema,
  AgentsFilesGetParamsSchema,
  AgentsFilesGetResultSchema,
  AgentsFilesSetParamsSchema,
  AgentsFilesSetResultSchema,
  AgentsWorkspaceEntrySchema,
  AgentsWorkspaceFileSchema,
  AgentsWorkspaceListParamsSchema,
  AgentsWorkspaceListResultSchema,
  AgentsWorkspaceGetParamsSchema,
  AgentsWorkspaceGetResultSchema,
  AgentsListParamsSchema,
  AgentsListResultSchema,
  CommandsListParamsSchema,
  CommandsListResultSchema,
  PluginsSessionActionParamsSchema,
  PluginsSessionActionResultSchema,
  PluginsUiDescriptorsParamsSchema,
  PluginsUiDescriptorsResultSchema,
  ModelsListParamsSchema,
  SkillsStatusParamsSchema,
  ToolsCatalogParamsSchema,
  ToolsEffectiveParamsSchema,
  ToolsInvokeParamsSchema,
  SkillsInstallParamsSchema,
  SkillsCuratorActionParamsSchema,
  SkillsCuratorActionResultSchema,
  SkillsCuratorStatusParamsSchema,
  SkillsCuratorStatusResultSchema,
  SkillsSearchParamsSchema,
  SkillsSearchResultSchema,
  SkillsDetailParamsSchema,
  SkillsDetailResultSchema,
  SkillsProposalsListParamsSchema,
  SkillsProposalsListResultSchema,
  SkillsProposalInspectParamsSchema,
  SkillsProposalInspectResultSchema,
  SkillsProposalCreateParamsSchema,
  SkillsProposalUpdateParamsSchema,
  SkillsProposalReviseParamsSchema,
  SkillsProposalRequestRevisionParamsSchema,
  SkillsProposalRequestRevisionResultSchema,
  SkillsProposalActionParamsSchema,
  SkillsProposalApplyResultSchema,
  SkillsProposalRecordResultSchema,
  SkillsSecurityVerdictsParamsSchema,
  SkillsSecurityVerdictsResultSchema,
  SkillsSkillCardParamsSchema,
  SkillsSkillCardResultSchema,
  SkillsUploadBeginParamsSchema,
  SkillsUploadChunkParamsSchema,
  SkillsUploadCommitParamsSchema,
  SkillsUpdateParamsSchema,
  CronJobSchema,
  CronListParamsSchema,
  CronStatusParamsSchema,
  CronGetParamsSchema,
  CronAddParamsSchema,
  CronAddResultSchema,
  CronDeclarativeAddResultSchema,
  CronUpdateParamsSchema,
  CronRemoveParamsSchema,
  CronRunParamsSchema,
  CronRunsParamsSchema,
  LogsTailParamsSchema,
  LogsTailResultSchema,
  TerminalOpenParamsSchema,
  TerminalOpenResultSchema,
  TerminalInputParamsSchema,
  TerminalResizeParamsSchema,
  TerminalCloseParamsSchema,
  TerminalAttachParamsSchema,
  TerminalAttachResultSchema,
  TerminalSessionInfoSchema,
  TerminalListResultSchema,
  TerminalTextParamsSchema,
  TerminalTextResultSchema,
  TerminalAckResultSchema,
  TerminalDataEventSchema,
  TerminalExitEventSchema,
  TerminalEventSchema,
  ExecApprovalsGetParamsSchema,
  ExecApprovalsSetParamsSchema,
  ExecApprovalGetParamsSchema,
  ExecApprovalRequestParamsSchema,
  ExecApprovalResolveParamsSchema,
  ChatHistoryParamsSchema,
  ChatMetadataParamsSchema,
  ChatSendParamsSchema,
  ChatInjectParamsSchema,
  UpdateRunParamsSchema,
  TickEventSchema,
  ShutdownEventSchema,
  WorktreeRecordSchema,
  WorktreesListParamsSchema,
  WorktreesListResultSchema,
  WorktreesCreateParamsSchema,
  WorktreesRemoveParamsSchema,
  WorktreesRemoveResultSchema,
  WorktreesRestoreParamsSchema,
  WorktreesGcParamsSchema,
  WorktreesGcResultSchema,
  ProtocolSchemas,
  MIN_CLIENT_PROTOCOL_VERSION,
  MIN_NODE_PROTOCOL_VERSION,
  MIN_PROBE_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  ErrorCodes,
  errorShape,
};

// Type exports mirror the schema exports for downstream TypeScript consumers.
export type {
  GatewayFrame,
  ConnectParams,
  HelloOk,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  PresenceEntry,
  Snapshot,
  ErrorShape,
  StateVersion,
  AgentEvent,
  AgentIdentityParams,
  AgentIdentityResult,
  AgentWaitParams,
  ChatEvent,
  TickEvent,
  ShutdownEvent,
  WakeParams,
  NodePairRequestParams,
  NodePairListParams,
  NodePairApproveParams,
  DevicePairListParams,
  DevicePairApproveParams,
  DevicePairRejectParams,
  DevicePairSetupCodeParams,
  DevicePairSetupCodeResult,
  ConfigGetParams,
  ConfigSetParams,
  ConfigApplyParams,
  ConfigPatchParams,
  ConfigSchemaParams,
  ConfigSchemaResponse,
  CrestodianChatParams,
  CrestodianChatResult,
  CrestodianSetupDetectParams,
  CrestodianSetupDetectResult,
  CrestodianSetupActivateParams,
  CrestodianSetupActivateResult,
  WizardStartParams,
  WizardNextParams,
  WizardCancelParams,
  WizardStatusParams,
  WizardStep,
  WizardNextResult,
  WizardStartResult,
  WizardStatusResult,
  TalkCatalogParams,
  TalkCatalogResult,
  TalkClientCreateParams,
  TalkClientCreateResult,
  TalkClientSteerParams,
  TalkAgentControlResult,
  TalkClientToolCallParams,
  TalkClientToolCallResult,
  TalkConfigParams,
  TalkConfigResult,
  TalkSessionAppendAudioParams,
  TalkSessionCancelOutputParams,
  TalkSessionCancelTurnParams,
  TalkSessionCreateParams,
  TalkSessionCreateResult,
  TalkSessionJoinParams,
  TalkSessionJoinResult,
  TalkSessionTurnParams,
  TalkSessionTurnResult,
  TalkSessionSteerParams,
  TalkSessionSubmitToolResultParams,
  TalkSessionCloseParams,
  TalkSessionOkResult,
  TalkSpeakParams,
  TalkSpeakResult,
  TtsSpeakParams,
  TtsSpeakResult,
  TalkModeParams,
  ChannelsStatusParams,
  ChannelsStatusResult,
  ChannelsStartParams,
  ChannelsStopParams,
  ChannelsLogoutParams,
  WebLoginStartParams,
  WebLoginWaitParams,
  AgentSummary,
  AgentsFileEntry,
  AgentsCreateParams,
  AgentsCreateResult,
  AgentsUpdateParams,
  AgentsUpdateResult,
  AgentsDeleteParams,
  AgentsDeleteResult,
  AgentsFilesListParams,
  AgentsFilesListResult,
  AgentsFilesGetParams,
  AgentsFilesGetResult,
  AgentsFilesSetParams,
  AgentsFilesSetResult,
  AgentsWorkspaceEntry,
  AgentsWorkspaceFile,
  AgentsWorkspaceListParams,
  AgentsWorkspaceListResult,
  AgentsWorkspaceGetParams,
  AgentsWorkspaceGetResult,
  SessionFileBrowserEntry,
  SessionFileBrowserResult,
  SessionFileEntry,
  SessionFileKind,
  SessionFileRelevance,
  SessionsFilesListParams,
  SessionsFilesListResult,
  SessionsFilesGetParams,
  SessionsFilesGetResult,
  ArtifactSummary,
  ArtifactsListParams,
  ArtifactsListResult,
  ArtifactsGetParams,
  ArtifactsGetResult,
  ArtifactsDownloadParams,
  ArtifactsDownloadResult,
  AgentsListParams,
  AgentsListResult,
  ChatMetadataParams,
  CommandsListParams,
  CommandsListResult,
  CommandEntry,
  PluginsSessionActionParams,
  PluginsSessionActionResult,
  SkillsStatusParams,
  ToolsCatalogParams,
  ToolsCatalogResult,
  ToolsEffectiveParams,
  ToolsEffectiveResult,
  ToolsInvokeParams,
  ToolsInvokeResult,
  SkillsBinsParams,
  SkillsBinsResult,
  SkillsCuratorActionParams,
  SkillsCuratorActionResult,
  SkillsCuratorStatusParams,
  SkillsCuratorStatusResult,
  SkillsSearchParams,
  SkillsSearchResult,
  SkillsDetailParams,
  SkillsDetailResult,
  SkillsProposalsListParams,
  SkillsProposalsListResult,
  SkillsProposalInspectParams,
  SkillsProposalInspectResult,
  SkillsProposalCreateParams,
  SkillsProposalUpdateParams,
  SkillsProposalReviseParams,
  SkillsProposalRequestRevisionParams,
  SkillsProposalRequestRevisionResult,
  SkillsProposalActionParams,
  SkillsProposalApplyResult,
  SkillsProposalRecordResult,
  SkillsSecurityVerdictsParams,
  SkillsSecurityVerdictsResult,
  SkillsSkillCardParams,
  SkillsSkillCardResult,
  SkillsUploadBeginParams,
  SkillsUploadChunkParams,
  SkillsUploadCommitParams,
  SkillsInstallParams,
  SkillsUpdateParams,
  EnvironmentStatus,
  EnvironmentSummary,
  EnvironmentsListParams,
  EnvironmentsListResult,
  EnvironmentsStatusParams,
  EnvironmentsStatusResult,
  SystemInfoParams,
  SystemInfoResult,
  NodePairRejectParams,
  NodePairRemoveParams,
  NodePairVerifyParams,
  NodeListParams,
  NodeInvokeParams,
  NodeInvokeResultParams,
  NodeEventParams,
  NodeEventResult,
  NodePresenceAlivePayload,
  NodePresenceAliveReason,
  NodePendingDrainParams,
  NodePendingDrainResult,
  NodePendingEnqueueParams,
  NodePendingEnqueueResult,
  SessionsListParams,
  SessionsCleanupParams,
  SessionsPreviewParams,
  SessionsDescribeParams,
  SessionsResolveParams,
  SessionOperationEvent,
  SessionWorktreeInfo,
  SessionsCreateResult,
  SessionsPatchParams,
  SessionsPatchResult,
  SessionsResetParams,
  SessionsDeleteParams,
  SessionsCompactParams,
  SessionsUsageParams,
  AuditEvent,
  AuditListParams,
  AuditListResult,
  ChatTurnMode,
  ChatTurnPhase,
  ChatTurnSummary,
  ChatTurnsListParams,
  ChatTurnsListResult,
  ChatTurnsCreateParams,
  ChatTurnsCreateResult,
  ChatTurnsSetModeParams,
  ChatTurnsCancelParams,
  ChatTurnsRetryParams,
  ChatTurnMutationResult,
  ExecutionEvent,
  ExecutionStateGetParams,
  ExecutionStateHealth,
  ControlDirectorMemoryHealth,
  ControlDirectorRuntimeCanary,
  ControlDirectorRuntimeLineage,
  ExecutionStateSnapshot,
  PursueGoalLease,
  PursueGoalJudgeReceipt,
  TaskFlowStatus,
  TaskFlowSummary,
  TaskFlowDetail,
  TaskFlowControlAction,
  TaskFlowsListParams,
  TaskFlowsListResult,
  TaskFlowsGetParams,
  TaskFlowsGetResult,
  TaskFlowsCreateParams,
  TaskFlowsCreateResult,
  TaskFlowsCancelParams,
  TaskFlowsCancelResult,
  TaskFlowsControlParams,
  TaskFlowsControlResult,
  TaskFlowsPauseParams,
  TaskFlowsResumeParams,
  TaskFlowsEditParams,
  TaskFlowsRetryParams,
  TaskFlowsStopParams,
  TaskFlowMutationResult,
  TaskSummary,
  TasksListParams,
  TasksListResult,
  TasksGetParams,
  TasksGetResult,
  TasksCancelParams,
  TasksCancelResult,
  PccPlansGenerateParams,
  PccPlansGenerateResult,
  PccPlanningRun,
  PccModelRunReceipt,
  PccProjectAiUsageSummary,
  PccPlansStartParams,
  PccPlansStartResult,
  PccPlansGetParams,
  PccPlansGetResult,
  PccPlansCancelParams,
  PccPlansCancelResult,
  PccExecutionStartParams,
  PccExecutionStartResult,
  PccExecutionGetParams,
  PccExecutionGetResult,
  PccExecutionControlParams,
  PccExecutionReviewParams,
  PccExecutionPauseResult,
  PccExecutionResumeResult,
  PccExecutionStopResult,
  PccExecutionReviewResult,
  PccAttachment,
  PccAttachmentUsageReceipt,
  PccAttachmentsUploadBeginParams,
  PccAttachmentsUploadBeginResult,
  PccAttachmentsUploadChunkParams,
  PccAttachmentsUploadChunkResult,
  PccAttachmentsUploadCommitParams,
  PccAttachmentsUploadCommitResult,
  PccAttachmentsListParams,
  PccAttachmentsListResult,
  PccAttachmentsReadParams,
  PccAttachmentsReadResult,
  PccAttachmentsUpdateParams,
  PccAttachmentsUpdateResult,
  PccAttachmentsClarifyParams,
  PccAttachmentsClarifyResult,
  PccAttachmentUsageRecordParams,
  PccAttachmentUsageRecordResult,
  PccAttachmentUsageListParams,
  PccAttachmentUsageListResult,
  PccPlanningPolicyGetParams,
  PccPlanningPolicyGetResult,
  PccPlanningPolicyUpsertParams,
  PccPlanningPolicyUpsertResult,
  PccPrivateTeamPolicy,
  PccStatus,
  PccProofLevel,
  PccPermissionStatus,
  PccPermissionType,
  PccRiskLevel,
  PccEvidenceKind,
  PccEvidenceStatus,
  PccPhase,
  PccProject,
  PccMilestone,
  PccSubMilestone,
  PccPermissionGrant,
  PccEvidence,
  PccCompletionReceipt,
  PccDecision,
  PccLastKnownGood,
  PccProjectSummary,
  PccPortfolioSummary,
  PccProjectsListParams,
  PccProjectsListResult,
  PccProjectsGetParams,
  PccProjectsGetResult,
  PccProjectsUpsertParams,
  PccProjectsUpsertResult,
  PccProjectPlanCommitParams,
  PccProjectPlanCommitResult,
  PccMilestonesUpsertParams,
  PccMilestonesUpsertResult,
  PccSubMilestonesListParams,
  PccSubMilestonesListResult,
  PccSubMilestonesUpsertParams,
  PccSubMilestonesUpsertResult,
  PccPermissionsUpsertParams,
  PccPermissionsUpsertResult,
  PccEvidenceAddParams,
  PccEvidenceAddResult,
  PccDecisionsAddParams,
  PccDecisionsAddResult,
  PccReceiptsAddParams,
  PccReceiptsAddResult,
  PccLastKnownGoodUpsertParams,
  PccLastKnownGoodUpsertResult,
  PccSummaryGetParams,
  PccSummaryGetResult,
  PccOverviewGetParams,
  PccOverviewGetResult,
  PccChangedEvent,
  PccPresenceEntry,
  PccPresenceUpdateParams,
  PccPresenceUpdateResult,
  PccPresenceListParams,
  PccPresenceListResult,
  OperationsStatus,
  OperationsActionKind,
  OperationsSnapshotParams,
  OperationsSnapshotResult,
  OperationsSnapshotV1Params,
  OperationsSnapshotV1Result,
  OperationsSnapshotV2Params,
  OperationsSnapshotV2Result,
  OperationsActionPreviewParams,
  OperationsActionPreviewResult,
  OperationsActionApplyParams,
  OperationsActionApplyResult,
  CronJob,
  CronListParams,
  CronStatusParams,
  CronGetParams,
  CronAddParams,
  CronAddResult,
  CronDeclarativeAddResult,
  CronUpdateParams,
  CronRemoveParams,
  CronRunParams,
  CronRunsParams,
  CronRunLogEntry,
  ExecApprovalsGetParams,
  ExecApprovalsNodeSnapshot,
  ExecApprovalsSetParams,
  ExecApprovalsSnapshot,
  ExecApprovalGetParams,
  ExecApprovalRequestParams,
  ExecApprovalResolveParams,
  LogsTailParams,
  LogsTailResult,
  TerminalOpenParams,
  TerminalOpenResult,
  TerminalInputParams,
  TerminalResizeParams,
  TerminalCloseParams,
  TerminalAttachParams,
  TerminalAttachResult,
  TerminalSessionInfo,
  TerminalListResult,
  TerminalTextParams,
  TerminalTextResult,
  TerminalAckResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalEvent,
  PollParams,
  WebPushVapidPublicKeyParams,
  WebPushSubscribeParams,
  WebPushUnsubscribeParams,
  WebPushTestParams,
  UpdateStatusParams,
  UpdateRunParams,
  ChatInjectParams,
  WorktreeRecord,
  WorktreesListParams,
  WorktreesListResult,
  WorktreesCreateParams,
  WorktreesRemoveParams,
  WorktreesRemoveResult,
  WorktreesRestoreParams,
  WorktreesGcParams,
  WorktreesGcResult,
};
function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

// The protocol package cannot import core session types. This local structural
// result mirrors the wire contract and keeps the package independent of src/.
type SessionsPatchResult = {
  ok: true;
  path: string;
  key: string;
  entry: Record<string, unknown>;
  resolved?: {
    modelProvider?: string;
    model?: string;
    agentRuntime?: GatewayAgentRuntime;
    thinkingLevel?: string;
    thinkingLevels?: Array<{ id: string; label: string }>;
  };
};

type GatewayAgentRuntime = {
  id: string;
  fallback?: "openclaw" | "none";
  source: "env" | "agent" | "defaults" | "model" | "provider" | "implicit" | "session-key";
};
