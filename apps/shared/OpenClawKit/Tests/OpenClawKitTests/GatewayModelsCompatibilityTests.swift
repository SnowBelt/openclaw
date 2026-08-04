import Foundation
import OpenClawProtocol
import Testing

struct GatewayModelsCompatibilityTests {
    @Test
    func `plugin approval request params keeps reviewer devices additive`() {
        let params = PluginApprovalRequestParams(
            pluginid: nil,
            title: "Install plugin",
            description: "Review requested",
            severity: nil,
            toolname: nil,
            toolcallid: nil,
            alloweddecisions: nil,
            sessionkey: nil,
            turnsourcechannel: nil,
            turnsourceto: nil,
            turnsourceaccountid: nil,
            turnsourcethreadid: nil,
            timeoutms: nil,
            twophase: nil)

        #expect(params.approvalreviewerdeviceids == nil)
    }

    @Test
    func `message action params keeps requester account additive`() {
        let params = MessageActionParams(
            channel: "slack",
            action: "member-info",
            params: [:],
            accountid: "default",
            requestersenderid: "U123",
            senderisowner: true,
            sessionkey: nil,
            sessionid: nil,
            toolcontext: nil,
            idempotencykey: "test")

        #expect(params.requesteraccountid == nil)
    }

    @Test
    func `PCC clarification params decodes legacy payload without project id`() throws {
        let params = try JSONDecoder().decode(
            PccAttachmentsClarifyParams.self,
            from: Data(
                #"{"originalName":"photo.jpg","role":"supporting","instructions":"Describe the attachment."}"#.utf8
            )
        )

        #expect(params.projectid == nil)
        #expect(params.originalname == "photo.jpg")
        #expect(params.instructions == "Describe the attachment.")
    }

    @Test
    func `PCC clarification params decodes project scoped payload`() throws {
        let params = try JSONDecoder().decode(
            PccAttachmentsClarifyParams.self,
            from: Data(
                #"""
                {
                  "projectId": "project-pcc",
                  "originalName": "photo.jpg",
                  "role": "supporting",
                  "instructions": "Describe the attachment."
                }
                """#.utf8
            )
        )

        #expect(params.projectid == "project-pcc")
    }

    @Test
    func `PCC clarification result decodes legacy payload without run id`() throws {
        let result = try JSONDecoder().decode(
            PccAttachmentsClarifyResult.self,
            from: Data(
                #"{"clarifiedInstructions":"Describe the attachment.","provenance":{"source":"legacy"}}"#.utf8
            )
        )

        #expect(result.runid == nil)
        #expect(result.clarifiedinstructions == "Describe the attachment.")
        #expect(result.provenance["source"]?.value as? String == "legacy")
    }

    @Test
    func `PCC clarification result decodes project scoped payload`() throws {
        let result = try JSONDecoder().decode(
            PccAttachmentsClarifyResult.self,
            from: Data(
                #"""
                {
                  "runId": "run-1",
                  "clarifiedInstructions": "Describe the attachment.",
                  "usage": {"tokens": 12},
                  "provenance": {"source": "project"}
                }
                """#.utf8
            )
        )

        #expect(result.runid == "run-1")
        #expect(result.usage?["tokens"]?.value as? Int == 12)
        #expect(result.provenance["source"]?.value as? String == "project")
    }
}
