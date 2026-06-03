import { createTool } from "@voltagent/core";
import { z } from "zod";

const confirmationSchema = {
	type: "object",
	properties: {
		confirm: { type: "boolean" },
		approver: { type: "string" },
	},
	required: ["confirm", "approver"],
	additionalProperties: false,
} as const;

type ElicitationResponse = {
	action?: string;
	content?: {
		confirm?: boolean;
		approver?: string;
	};
};

export const confirmRiskyAction = createTool({
	name: "confirm_risky_action",
	description:
		"Meminta konfirmasi pengguna sebelum menjalankan aksi yang berisiko atau berdampak klinis.",
	parameters: z.object({
		summary: z
			.string()
			.min(8)
			.describe("Ringkasan aksi yang akan dijalankan setelah konfirmasi."),
		category: z
			.enum(["validasi_klinis", "operasional_live", "rekomendasi_terapi"])
			.describe("Kategori aksi yang memerlukan konfirmasi."),
	}),
	async execute({ summary, category }, operationContext) {
		const request = operationContext?.elicitation;
		if (!request) {
			throw new Error("Elicitation bridge unavailable; cannot request confirmation");
		}

		const response = (await request({
			mode: "form",
			message: `Konfirmasi tindakan (${category}): ${summary}`,
			requestedSchema: confirmationSchema,
		})) as ElicitationResponse | undefined;

		const confirmed =
			response?.action === "accept" && response?.content?.confirm === true;

		return {
			confirmed,
			approver: response?.content?.approver ?? "unknown",
			category,
			summary,
		};
	},
});
