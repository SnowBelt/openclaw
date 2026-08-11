import Foundation
import OpenClawProtocol
import Testing

struct GatewayModelsCompatibilityTests {
    @Test
    func `PCC clarification params decodes legacy payload without project id`() throws {
        let params = try JSONDecoder().decode(
            PccAttachmentsClarifyParams.self,
            from: Data(
                #"{"originalName":"photo.jpg","role":"supporting","instructions":"Describe the attachment."}"#.utf8
            ),
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
            ),
        )

        #expect(params.projectid == "project-pcc")
    }

    @Test
    func `PCC clarification result decodes legacy payload without run id`() throws {
        let result = try JSONDecoder().decode(
            PccAttachmentsClarifyResult.self,
            from: Data(
                #"{"clarifiedInstructions":"Describe the attachment.","provenance":{"provider":"legacy","model":"unknown","generatedAt":"2026-08-03T18:00:00.000Z"}}"#.utf8
            ),
        )

        #expect(result.runid == nil)
        #expect(result.clarifiedinstructions == "Describe the attachment.")
        #expect(result.provenance["provider"]?.value as? String == "legacy")
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
                  "usage": {"totalTokens": 12},
                  "provenance": {"provider":"project","model":"qwen3.6:27b-q8_0","generatedAt":"2026-08-03T18:00:00.000Z"}
                }
                """#.utf8
            ),
        )

        #expect(result.runid == "run-1")
        #expect(result.usage?["totalTokens"]?.value as? Int == 12)
        #expect(result.provenance["provider"]?.value as? String == "project")
    }
}
