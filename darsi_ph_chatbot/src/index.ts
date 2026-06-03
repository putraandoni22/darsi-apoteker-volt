import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { Agent, VoltAgent } from "@voltagent/core";
import { createPinoLogger } from "@voltagent/logger";
import { honoServer } from "@voltagent/server-hono";
import { searchEfornasObat } from "./tools/efornasTools.js";
import { searchIcd10Disease } from "./tools/icd10Tools.js";
import {
	checkMedicationInteraction,
	parseMedicationMentions,
} from "./tools/medicationSafetyTools.js";
import { recommendMedicinesEmbedding, searchMedicinesEmbedding } from "./tools/obatKronisToolsEmbedding.js";
import { getLiveSystemHealthSummary, getLiveSystemStatus } from "./tools/liveSystemTools.js";
import { getDataSourceRegistry } from "./integrations/dataSourceRegistry.js";
import { getMemoryStats, initializeMemory } from "./memory/memoryInit.js";
import { ensureEmbeddingsInitialized, getEmbeddingHealthReport, getDetailedEmbeddingStatus } from "./embedding/embeddingManager.js";
import {
	deleteConversation,
	getUserConversations,
	loadConversation,
	saveConversation,
} from "./utils/conversationStorage.js";

type ToolConfidenceLevel = "rendah" | "sedang" | "tinggi";
type ChatIntent =
	| "validasi_resep"
	| "cek_interaksi"
	| "kepatuhan_fornas"
	| "kecocokan_icd10"
	| "informasi_obat"
	| "umum_skrining";
type UserRole = "apoteker" | "pasien" | "umum";
type LiveStatusViewerRole = "auto" | "apoteker" | "admin" | "pasien";
type ToolName =
	| "search_icd_code"
	| "search-medicines"
	| "recommend-medicines"
	| "search-efornas"
	| "check_medication_interaction"
	| "get-live-system-status";

type ServiceKey =
	| "dispensing"
	| "validasi_resep"
	| "monitoring_stok"
	| "transaksi_obat"
	| "asisten_obat";

type ToolConfidenceItem = {
	percent: number;
	level: ToolConfidenceLevel;
	reason: string;
};

type ToolConfidenceMap = {
	icd10: ToolConfidenceItem;
	kronis: ToolConfidenceItem;
	fornas: ToolConfidenceItem;
	interaction: ToolConfidenceItem;
};

type ToolResults = {
	icdResult: string;
	kronisResult: string;
	recommendResult?: string;
	fornasResult: string;
	interactionResult: string;
	liveSystemResult?: string;
};

type FallbackParams = ToolResults & {
	userInput: string;
	diagnosisBlocked: boolean;
	intent: ChatIntent;
	role: UserRole;
	confidence: ToolConfidenceMap;
};

type ChatMessagePart = {
	text?: string;
	inputText?: string;
	content?: string;
	delta?: string;
	state?: string;
	toolCallId?: string;
	approval?: unknown;
	output?: unknown;
	[key: string]: unknown;
};

type ChatMessage = {
	role?: string;
	content?: string | ChatMessagePart[];
	parts?: ChatMessagePart[];
};

type ChatRequestBody = {
	messages?: ChatMessage[];
	id?: string;
	conversationId?: string;
	userId?: string;
	userRole?: string;
	userMode?: string;
	userName?: string;
	namaUser?: string;
};

type ExecutableTool = {
	execute?: (
		args: Record<string, unknown>,
		operationContext?: Record<string, unknown>,
	) => Promise<unknown> | unknown;
};

type ToolExecutionResult = {
	text: string;
	ok: boolean;
};

type ClarificationResolution = {
	effectiveUserInput: string;
	isFollowUpToClarification: boolean;
};

type ClarificationQuestionParams = {
	userInput: string;
	messages: ChatMessage[];
	isClarificationFollowUp: boolean;
};

type ConfirmationCategory =
	| "validasi_klinis"
	| "operasional_live"
	| "rekomendasi_terapi";

type PendingConfirmation = {
	id: string;
	toolCallId: string;
	threadId: string;
	userId: string;
	originalQuery: string;
	category: ConfirmationCategory;
	summary: string;
	prompt: string;
	createdAt: number;
	expiresAt: number;
};

type ApprovalResponse = {
	approvalId: string;
	toolCallId?: string | undefined;
	approved: boolean;
	reason?: string | undefined;
};

type ConfirmationPlan = {
	category: ConfirmationCategory;
	summary: string;
};

const ALLOWED_ORIGINS = [
	"http://localhost:3000",
	"http://localhost:3001",
	"http://localhost:3002",
	"http://127.0.0.1:3000",
	"http://127.0.0.1:3002",
] as const;

const STRICT_SCREENING_INSTRUCTIONS = [
	"Kamu adalah DARSI Apoteker, asisten digital farmasi untuk RSI Surabaya A.Yani.",
	"Pengguna ditentukan dari session login; jangan menanyakan role pengguna.",
	"Jawab permintaan pengguna secara langsung tanpa pertanyaan klarifikasi atau konfirmasi balik.",
	"Jangan menambahkan pertanyaan lanjutan kecuali pengguna meminta pertanyaan tersebut secara eksplisit.",
	"Prioritaskan data dari: (1) data obat kronis RSI Surabaya, (2) data e-Fornas.",
	"Jangan mengarang data obat. Jika data tidak ditemukan, sampaikan jujur dan arahkan verifikasi ke sumber yang tepat.",
	"Jika pertanyaan di luar domain farmasi, tolak dengan sopan dan arahkan ke layanan yang sesuai.",
	"Gunakan Bahasa Indonesia yang jelas, sopan, dan aman secara klinis.",
	"Jangan memberikan diagnosis baru atau instruksi medis berbahaya/spekulatif.",
	"Untuk pertanyaan status operasional real-time (stok/dispensing/transaksi), prioritaskan data dari sistem live operasional.",
	"Role apoteker: gunakan bahasa teknis terstruktur dan detail berbasis data.",
	"Role pasien: gunakan bahasa sederhana, hangat, dan mudah dipahami.",
	"Jika role tidak dikenali, jawab: Sesi tidak valid. Silakan login ulang ke sistem DARSI.",
	"",
	"=== ANTI-HALLUCINATION & REPETITION PREVENTION (CRITICAL) ===",
	"RULE 1 - MEDICATION TABLE FORMAT (MANDATORY):",
	"  Saat menampilkan daftar obat/hasil pencarian, WAJIB gunakan format tabel Markdown:",
	"  | No | Nama Obat | Bentuk Sediaan | Dosis / Kekuatan | Sumber Data |",
	"  |----|-----------|-----------------|-----------------|-----------|",
	"  | 1  | Paracetamol | Tablet 500mg | 500mg per tablet | Obat Kronis RSI |",
	"  Jangan gunakan format list/bullet untuk daftar obat.",
	"",
	"RULE 2 - ZERO HALLUCINATION:",
	"  - HANYA output obat yang BENAR-BENAR ada di database context yang diberikan.",
	"  - JANGAN SEBUTKAN obat apapun yang tidak tercantum dalam tool results.",
	"  - Jika user bertanya tentang obat yang tidak di-retrieve, jawab: 'Data tidak ditemukan di sistem RSI'.",
	"  - JANGAN PERNAH membuat inference atau menambahkan obat dari pengetahuan umum.",
	"  - JANGAN SEBUT nama obat yang tidak relevan dengan query (contoh: jangan sebutkan Combivent jika tidak di-context).",
	"",
	"RULE 3 - NO REPETITION:",
	"  - JANGAN ULANGI nama obat yang sama lebih dari sekali.",
	"  - Jika mendapat hasil duplikat dari database, filter dan tampilkan hanya 1x.",
	"  - Max 10 hasil per query (sudah dikontrol oleh API, jangan exceed).",
	"",
	"RULE 4 - CONCISE OUTPUT:",
	"  - Output HANYA tabel obat (jika ada) + 1-2 kalimat ringkas (max 50 kata).",
	"  - JANGAN tulis paragraf panjang atau penjelasan detail.",
	"  - Jika perlu clarification, tanyakan 1 pertanyaan singkat.",
	"",
	"RULE 5 - TOKEN & ENCODING:",
	"  - JANGAN output raw tokens seperti <unused2399> atau karakter aneh.",
	"  - Jika model menghasilkan token tidak valid, hentikan dan output 'Ada kesalahan sistem'.",
	"  - UTF-8 HANYA untuk Bahasa Indonesia.",
	"",
	"=== CONVERSATION PHASE CONTROL (ANTI-PARROTING) ===",
	"RULE A - JANGAN ULANGI PERTANYAAN YANG SUDAH DIJAWAB:",
	"  - Jika Anda sudah menanyakan detail pasien (penyebab, durasi, gejala, usia, riwayat) dan user menjawabnya,",
	"    MAKA langsung berikan diagnosis ringkas dan rekomendasi obat yang sesuai.",
	"  - DILARANG mengulang daftar pertanyaan klarifikasi yang sama setelah user memberi jawaban.",
	"RULE B - DETEKSI JAWABAN USER:",
	"  - Jika user memberikan jawaban terstruktur (misal: penyebab/durasi/gejala/usia), anggap detail sudah lengkap.",
	"  - JANGAN meminta ulang data yang sudah ada di riwayat percakapan.",
	"RULE C - HANYA TANYA JIKA ADA DATA KRITIS YANG BENAR-BENAR HILANG:",
	"  - Jika informasi penting belum ada, tanyakan maksimal 1 pertanyaan singkat.",
	"  - Jangan menumpuk banyak pertanyaan lanjutan dalam satu respons.",
	"",
	"=== HARD STOP CLARIFICATION (IF/THEN) ===",
	"CONDITION A (Missing Info):",
	"  - IF user meminta rekomendasi obat tetapi detail penting belum ada (usia, gejala, durasi, kondisi),",
	"    THEN ajukan pertanyaan klarifikasi yang diperlukan dan STOP sepenuhnya.",
	"  - JANGAN beri contoh obat umum, JANGAN beri rekomendasi, JANGAN menebak pada giliran ini.",
	"CONDITION B (Info Provided):",
	"  - IF detail sudah diberikan, THEN beri diagnosis ringkas dan rekomendasi obat dalam tabel Markdown.",
	"  - JANGAN mengulang pertanyaan klarifikasi.",
	"",
	"",
	"=== FORMATTING RESPONSE (PENTING) ===",
	"Pilih format jawaban berdasarkan tipe informasi:",
	"",
	"FORMAT 1 - PARAGRAPH (Untuk jawaban sederhana, 1-2 poin):",
	"  Gunakan paragraph biasa tanpa bullet points atau tabel.",
	"  Contoh: 'Paracetamol tersedia di RSI Surabaya dalam bentuk drops, infus, sirup, dan tablet. Anda bisa mengaksesnya melalui FKTP atau FKTL.'",
	"",
	"FORMAT 2 - BULLET POINTS (Untuk jawaban dengan multiple poin/informasi):",
	"  Gunakan bullet points (- atau •) saat ada 3+ poin yang ingin dijelaskan.",
	"  Contoh:",
	"  Paracetamol tersedia dalam beberapa sediaan:",
	"  - Drops (tetes)",
	"  - Infus (cairan IV)",
	"  - Sirup (cair untuk diminum)",
	"  - Tablet (solid)",
	"  Akses melalui FKTP atau FKTL sesuai tingkat fasilitas kesehatan Anda.",
	"",
	"FORMAT 3 - TABLE (Untuk data terstruktur/perbandingan):",
	"  Gunakan tabel (markdown format) saat ada data dengan beberapa kolom atau perbandingan.",
	"  Contoh: Tabel untuk daftar obat dengan nama, sediaan, dan ketersediaan.",
	"",
	"FORMAT 4 - MIXED (Kombinasi paragraph + bullets + table):",
	"  Kombinasikan semua format di atas untuk respons komprehensif.",
	"  Contoh: Penjelasan paragraph → bullet points untuk detail → tabel untuk data → paragraph penutup.",
	"",
	"PANDUAN PEMILIHAN FORMAT:",
	"  - 1 poin informasi saja → Paragraph",
	"  - 2-3 poin informasi → Paragraph dengan penekanan (bisa sub-paragraf)",
	"  - 4+ poin/features/options → Bullet points",
	"  - Data dengan kolom/field → Table",
	"  - Kombinasi beberapa tipe info → Mixed format",
	"",
	"TIPS FORMATTING:",
	"  - Jangan gunakan bullet points jika hanya ada 1-2 poin (terasa excessive)",
	"  - Jika menggunakan tabel, pastikan headers jelas dan data aligned",
	"  - Bullet points harus parallel structure (semua dimulai dengan kata yang sama type)",
	"  - Hindari tabel dengan >6 kolom (terlalu lebar, sulit dibaca)",
	"  - Selalu gunakan spasi antar section untuk readability",
].join("\n");

const logger = createPinoLogger({
	name: "darsi-apoteker",
	level: "warn",
});

const memory = initializeMemory();

const rawOllamaBaseUrl =
	process.env.OLLAMA_BASE_URL ?? process.env.LLAMA_BASE_URL ?? "http://localhost:11434";
const sanitizedOllamaBaseUrl = rawOllamaBaseUrl.replace(/\/+$/, "");
const normalizedOllamaBaseUrl = sanitizedOllamaBaseUrl.endsWith("/v1")
	? sanitizedOllamaBaseUrl
	: `${sanitizedOllamaBaseUrl}/v1`;

const aiProvider = createOpenAICompatible({
	name: "local-ollama",
	baseURL: normalizedOllamaBaseUrl,
	apiKey: process.env.OLLAMA_API_KEY ?? process.env.LLAMA_API_KEY ?? "",
});

const defaultModelId = "llama3.1:8b";
const responseModelId =
	process.env.OLLAMA_MODEL_ID ??
	process.env.LLAMA_MODEL_ID ??
	process.env.LLM_MODEL_ID ??
	defaultModelId;
const toolPlannerModelId =
	process.env.OLLAMA_TOOL_MODEL_ID ??
	process.env.LLAMA_TOOL_MODEL_ID ??
	process.env.TOOL_CALLING_MODEL_ID ??
	responseModelId;

const screeningChatModel = aiProvider.chatModel(responseModelId);
const toolPlannerChatModel = aiProvider.chatModel(toolPlannerModelId);

const darsiAgent = new Agent({
	name: "DARSI Apoteker Screening",
	memory,
	instructions: STRICT_SCREENING_INSTRUCTIONS,
	model: toolPlannerChatModel,
	tools: [
		searchIcd10Disease,
		searchMedicinesEmbedding,
		recommendMedicinesEmbedding,
		searchEfornasObat,
		checkMedicationInteraction,
		getLiveSystemStatus,
	],
});

const port = Number(process.env.PORT || process.env.VOLT_API_PORT || 1337);
const CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000;

const pendingConfirmationByThread = new Map<string, PendingConfirmation>();

const SKIPPED_TOOL_TEXT = "Data tidak tersedia untuk kueri ini (tool tidak dipanggil).";
const TOOL_EXECUTION_MAP: Array<{ name: ToolName; label: string }> = [
	{ name: "search_icd_code", label: "ICD-10 RSI" },
	{ name: "search-medicines", label: "Obat Kronis RSI" },
	{ name: "recommend-medicines", label: "Rekomendasi Obat Berdasarkan Penyakit" },
	{ name: "search-efornas", label: "e-Fornas" },
	{ name: "check_medication_interaction", label: "Skrining Interaksi Obat" },
	{ name: "get-live-system-status", label: "Status Sistem Operasional" },
];

const SERVICE_ROUTE_MAP: Record<
	UserRole,
	Record<ServiceKey, { title: string; path: string; hint: string }>
> = {
	apoteker: {
		dispensing: {
			title: "Dispensing",
			path: "/apoteker/dispensing",
			hint: "Proses peracikan dan penyerahan obat.",
		},
		validasi_resep: {
			title: "Validasi Resep",
			path: "/apoteker/validasi-resep",
			hint: "Cek kesesuaian resep sebelum dispensing.",
		},
		monitoring_stok: {
			title: "Monitoring Stok",
			path: "/apoteker/monitoring-stok",
			hint: "Pantau ketersediaan dan status stok obat.",
		},
		transaksi_obat: {
			title: "Daftar Transaksi Obat",
			path: "/apoteker/transaksi-obat",
			hint: "Lihat riwayat transaksi dan status pembayaran.",
		},
		asisten_obat: {
			title: "Asisten Obat",
			path: "/apoteker/asisten-obat",
			hint: "Bantuan klinis farmasi dan informasi obat.",
		},
	},
	pasien: {
		dispensing: {
			title: "Pelacakan Status Peracikan",
			path: "/pasien/pelacakan-status",
			hint: "Pantau status proses obat pasien.",
		},
		validasi_resep: {
			title: "Pembayaran & Konfirmasi Resep",
			path: "/pasien/pembayaran",
			hint: "Konfirmasi resep dan pembayaran pasien.",
		},
		monitoring_stok: {
			title: "Pusat Informasi Obat",
			path: "/pasien/informasi-obat",
			hint: "Cek informasi ketersediaan dan detail obat.",
		},
		transaksi_obat: {
			title: "Riwayat Transaksi & Medikasi",
			path: "/pasien/riwayat-transaksi",
			hint: "Lihat histori transaksi dan medikasi pasien.",
		},
		asisten_obat: {
			title: "Asisten Obat",
			path: "/pasien/asisten-obat",
			hint: "Tanya jawab obat dengan bahasa sederhana.",
		},
	},
	umum: {
		dispensing: {
			title: "Login DARSI",
			path: "/signin",
			hint: "Silakan login dulu untuk mengakses layanan dispensing.",
		},
		validasi_resep: {
			title: "Login DARSI",
			path: "/signin",
			hint: "Silakan login dulu untuk mengakses validasi resep.",
		},
		monitoring_stok: {
			title: "Login DARSI",
			path: "/signin",
			hint: "Silakan login dulu untuk mengakses monitoring stok.",
		},
		transaksi_obat: {
			title: "Login DARSI",
			path: "/signin",
			hint: "Silakan login dulu untuk mengakses riwayat transaksi.",
		},
		asisten_obat: {
			title: "Login DARSI",
			path: "/signin",
			hint: "Silakan login dulu untuk mengakses asisten obat.",
		},
	},
};

const SERVICE_KEY_PATTERNS: Array<{ key: ServiceKey; pattern: RegExp }> = [
	{ key: "dispensing", pattern: /\b(dispensing|racik|diracik|peracikan|penyerahan|serah\s*obat)\b/i },
	{ key: "validasi_resep", pattern: /\b(validasi\s*resep|review\s*resep|cek\s*resep|verifikasi\s*resep)\b/i },
	{ key: "monitoring_stok", pattern: /\b(monitoring\s*stok|stok|stock|persediaan|ketersediaan)\b/i },
	{ key: "transaksi_obat", pattern: /\b(transaksi|riwayat\s*transaksi|riwayat|pembayaran|billing|invoice)\b/i },
	{ key: "asisten_obat", pattern: /\b(asisten\s*obat|informasi\s*obat|konsultasi\s*obat|edukasi\s*obat)\b/i },
];

const SERVICE_ROUTE_ACTION_SIGNAL =
	/\b(arahkan|menuju|ke\s*menu|menu\s+apa|halaman\s+apa|fitur\s+apa|buka|masuk|akses|panduan|cara|layanan\s+mana|layanan\s+yang\s+tersedia)\b/i;
const SERVICE_ASSISTANCE_SIGNAL = /\b(bantu|bantuan|tolong|butuh\s*bantuan|minta\s*bantuan)\b/i;
const SERVICE_PROCESS_SIGNAL = /\b(proses|workflow|alur)\b/i;
const SERVICE_STATUS_SIGNAL =
	/\b(status|real[\s-]?time|realtime|live|saat\s+ini|sekarang|terbaru|monitoring|ringkasan|laporan|update|cek)\b/i;
const CLARIFICATION_PREFIX_PATTERN = /^sebelum\s+saya\s+jawab,\s*boleh\s+saya\s+tanya\s+dulu\s*[-–—]/i;
const CLARIFICATION_REQUEST_PATTERN =
	/\b(informasi\s+lebih\s+lanjut|perlu\s+informasi|butuh\s+informasi|detail\s+pasien|usia\s+pasien|durasi|penyebab|gejala|riwayat\s+medis|kondisi\s+spesifik|tingkat\s+demam|obat\s+lain\s+yang\s+sedang\s+dikonsumsi)\b/i;
const CLARIFICATION_LOOP_PATTERN =
	/\b(sebelum\s+saya\s+jawab|informasi\s+lebih\s+lanjut|perlu\s+informasi|mohon\s+informasi|tolong\s+berikan\s+informasi|detail\s+pasien|usia\s+pasien|durasi\s+demam|penyebab\s+demam|riwayat\s+medis|kondisi\s+spesifik)\b/i;

const CONFIRMATION_TOOL_NAME = "confirm_risky_action";

function cleanExpiredPendingConfirmations(now = Date.now()): void {
	for (const [threadId, pending] of pendingConfirmationByThread.entries()) {
		if (pending.expiresAt <= now) {
			pendingConfirmationByThread.delete(threadId);
		}
	}
}

function parseConfirmationDecision(input: string): "accept" | "decline" | "unknown" {
	const normalized = input
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!normalized) {
		return "unknown";
	}

	if (/\b(tidak|ga|gak|nggak|jangan|batal|stop|tolak|cancel|batalkan)\b/.test(normalized)) {
		return "decline";
	}

	if (/\b(ya|iya|setuju|lanjut|proses|ok|oke|silakan|confirm|konfirmasi)\b/.test(normalized)) {
		return "accept";
	}

	return "unknown";
}

function buildConfirmationFollowupPrompt(pending: PendingConfirmation): string {
	return [
		`Sebelum saya lanjutkan, mohon konfirmasi dulu aksi berikut: ${pending.summary}`,
		"",
		"Klik tombol Setujui atau Tolak pada panel konfirmasi.",
		"Jika perlu, Anda juga bisa balas `ya` atau `tidak`.",
	].join("\n");
}

function buildConfirmationCancelledResponse(summary: string, userName: string): string {
	return [
		`Baik ${userName}, aksi dibatalkan sesuai konfirmasi Anda.`,
		"",
		`Aksi yang tidak dijalankan: ${summary}`,
	].join("\n");
}

function createPendingConfirmation(params: {
	threadId: string;
	userId: string;
	originalQuery: string;
	summary: string;
	category: ConfirmationCategory;
}): PendingConfirmation {
	const now = Date.now();
	const randomSuffix = Math.random().toString(36).slice(2, 10);

	return {
		id: `approval-${now}-${randomSuffix}`,
		toolCallId: `toolcall-${now}-${randomSuffix}`,
		threadId: params.threadId,
		userId: params.userId,
		originalQuery: params.originalQuery,
		category: params.category,
		summary: params.summary,
		prompt: params.summary,
		createdAt: now,
		expiresAt: now + CONFIRMATION_TIMEOUT_MS,
	};
}

function extractRawMessageParts(message: ChatMessage): unknown[] {
	const combinedParts: unknown[] = [];

	if (Array.isArray(message.parts)) {
		combinedParts.push(...message.parts);
	}

	if (Array.isArray(message.content)) {
		combinedParts.push(...message.content);
	}

	return combinedParts;
}

function parseApprovalResponseFromPart(part: unknown): ApprovalResponse | null {
	if (!part || typeof part !== "object") {
		return null;
	}

	const typedPart = part as Record<string, unknown>;
	const state = typeof typedPart.state === "string" ? typedPart.state : "";
	const toolCallId = typeof typedPart.toolCallId === "string" ? typedPart.toolCallId : undefined;

	if (state === "approval-responded") {
		const approval = typedPart.approval;
		if (!approval || typeof approval !== "object") {
			return null;
		}

		const typedApproval = approval as Record<string, unknown>;
		const approvalId = typeof typedApproval.id === "string" ? typedApproval.id : "";
		const approved = typedApproval.approved;
		const reason = typeof typedApproval.reason === "string" ? typedApproval.reason : undefined;

		if (!approvalId || typeof approved !== "boolean") {
			return null;
		}

		return {
			approvalId,
			toolCallId,
			approved,
			reason,
		};
	}

	if (state === "output-available") {
		const output = typedPart.output;
		if (!output || typeof output !== "object") {
			return null;
		}

		const typedOutput = output as Record<string, unknown>;
		const approvalId =
			typeof typedOutput.approvalId === "string"
				? typedOutput.approvalId
				: typeof typedOutput.id === "string"
					? typedOutput.id
					: "";
		const approved = typedOutput.approved;
		const reason = typeof typedOutput.reason === "string" ? typedOutput.reason : undefined;

		if (!approvalId || typeof approved !== "boolean") {
			return null;
		}

		return {
			approvalId,
			toolCallId,
			approved,
			reason,
		};
	}

	return null;
}

function findApprovalResponseForPendingConfirmation(
	messages: ChatMessage[],
	pending: PendingConfirmation,
): ApprovalResponse | null {
	for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
		const message = messages[messageIndex];
		if (!message) {
			continue;
		}

		const parts = extractRawMessageParts(message);
		for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
			const parsed = parseApprovalResponseFromPart(parts[partIndex]);
			if (!parsed) {
				continue;
			}

			if (parsed.approvalId === pending.id) {
				return parsed;
			}

			if (parsed.toolCallId && parsed.toolCallId === pending.toolCallId) {
				return parsed;
			}
		}
	}

	return null;
}

function detectRequestedServiceKeys(input: string): ServiceKey[] {
	const normalized = input.toLowerCase();
	const keys = SERVICE_KEY_PATTERNS.filter((entry) => entry.pattern.test(normalized)).map((entry) => entry.key);
	return Array.from(new Set(keys));
}

function isServiceNavigationRequest(input: string): boolean {
	const normalized = input.toLowerCase();
	const requestedKeys = detectRequestedServiceKeys(normalized);
	if (requestedKeys.length === 0) {
		return false;
	}

	const hasRouteActionSignal = SERVICE_ROUTE_ACTION_SIGNAL.test(normalized);
	const hasAssistanceProcessSignal =
		SERVICE_ASSISTANCE_SIGNAL.test(normalized) && SERVICE_PROCESS_SIGNAL.test(normalized);
	const hasStatusSignal = SERVICE_STATUS_SIGNAL.test(normalized);

	if (hasStatusSignal && !hasRouteActionSignal && !hasAssistanceProcessSignal) {
		return false;
	}

	return hasRouteActionSignal || hasAssistanceProcessSignal;
}

function buildServiceNavigationResponse(input: string, role: UserRole, userName: string): string {
	const requestedKeys = detectRequestedServiceKeys(input);
	const selectedKeys: ServiceKey[] = requestedKeys.length > 0 ? requestedKeys : ["asisten_obat"];
	const roleRoutes = SERVICE_ROUTE_MAP[role] ?? SERVICE_ROUTE_MAP.umum;
	const roleLabel = role === "apoteker" ? "Apoteker" : role === "pasien" ? "Pasien" : "Umum";

	const lines: string[] = [];
	lines.push(`Siap ${userName}, saya arahkan ke layanan yang tersedia untuk mode ${roleLabel}.`);
	lines.push("");
	lines.push("Layanan yang bisa langsung dibuka:");

	for (const key of selectedKeys) {
		const target = roleRoutes[key];
		if (!target) {
			continue;
		}

		lines.push(`- ${target.title}: ${target.path}`);
		lines.push(`  ${target.hint}`);
	}

	if (role === "apoteker" && selectedKeys.includes("dispensing") && !selectedKeys.includes("validasi_resep")) {
		const validasi = roleRoutes.validasi_resep;
		lines.push("");
		lines.push(`Opsional sebelum dispensing: ${validasi.title} (${validasi.path}) agar resep tervalidasi dulu.`);
	}

	lines.push("");
	lines.push("Jika Anda mau, saya bisa lanjut pandu langkah penggunaan layanan tersebut satu per satu.");

	return lines.join("\n");
}

function normalizeClarificationQuestion(question: string): string {
	const trimmed = question.trim().replace(/[?!.\s]+$/g, "");
	return trimmed.length > 0 ? `${trimmed}?` : "Mohon jelaskan konteks pertanyaannya lebih dulu?";
}

function formatClarificationQuestion(question: string): string {
	const normalizedQuestion = normalizeClarificationQuestion(question);
	return `Sebelum saya jawab, boleh saya tanya dulu - ${normalizedQuestion}`;
}

function resolveClarificationContext(messages: ChatMessage[], latestUserInput: string): ClarificationResolution {
	if (messages.length < 3) {
		return {
			effectiveUserInput: latestUserInput,
			isFollowUpToClarification: false,
		};
	}

	const lastIndex = messages.length - 1;
	const lastMessage = messages[lastIndex];
	if ((lastMessage?.role || "").toLowerCase() !== "user") {
		return {
			effectiveUserInput: latestUserInput,
			isFollowUpToClarification: false,
		};
	}

	const previousAssistantMessage = messages[lastIndex - 1];
	if (!previousAssistantMessage || (previousAssistantMessage.role || "").toLowerCase() !== "assistant") {
		return {
			effectiveUserInput: latestUserInput,
			isFollowUpToClarification: false,
		};
	}

	const previousAssistantText = extractMessageText(previousAssistantMessage).trim();
	const isClarificationRequest =
		CLARIFICATION_PREFIX_PATTERN.test(previousAssistantText) ||
		CLARIFICATION_REQUEST_PATTERN.test(previousAssistantText);
	if (!isClarificationRequest) {
		return {
			effectiveUserInput: latestUserInput,
			isFollowUpToClarification: false,
		};
	}

	let previousUserQuestion = "";
	for (let idx = lastIndex - 2; idx >= 0; idx -= 1) {
		const candidate = messages[idx];
		if (!candidate || (candidate.role || "").toLowerCase() !== "user") {
			continue;
		}

		const text = extractMessageText(candidate).trim();
		if (!text) {
			continue;
		}

		previousUserQuestion = text;
		break;
	}

	if (!previousUserQuestion) {
		return {
			effectiveUserInput: latestUserInput,
			isFollowUpToClarification: false,
		};
	}

	return {
		effectiveUserInput: `${previousUserQuestion}\nKlarifikasi pengguna: ${latestUserInput}`,
		isFollowUpToClarification: true,
	};
}

function collectUserConversationContext(messages: ChatMessage[]): string {
	return messages
		.filter((message) => (message?.role || "").toLowerCase() === "user")
		.map((message) => extractMessageText(message).trim())
		.filter((text) => text.length > 0)
		.join("\n");
}

function hasAgeContext(text: string): boolean {
	const normalized = text.toLowerCase();
	return (
		/\b(usia|umur)\s*[:\-]?\s*\d{1,3}\b/.test(normalized) ||
		/\b\d{1,2}\s*(tahun|thn|bulan|bln|hari)\b/.test(normalized) ||
		/\b(dewasa|anak|balita|bayi|lansia)\b/.test(normalized)
	);
}

function hasWeightContext(text: string): boolean {
	const normalized = text.toLowerCase();
	return (
		/\b(?:bb|berat\s*badan|berat)\s*[:\-]?\s*\d{1,3}(?:[.,]\d+)?\s*(kg|kilogram)\b/.test(normalized) ||
		/\b\d{1,3}(?:[.,]\d+)?\s*(kg|kilogram)\b/.test(normalized)
	);
}

function hasConditionContext(text: string): boolean {
	const normalized = text.toLowerCase();
	return /\b(diagnosa|diagnosis|penyakit|kondisi|indikasi|hipertensi|diabetes|asma|infeksi|demam|batuk|pilek|nyeri|lambung)\b/.test(
		normalized,
	);
}

function hasSymptomDetailContext(text: string): boolean {
	const normalized = text.toLowerCase();
	const hasDuration =
		/\b(sejak|selama|sudah|kurang\s+lebih)\b/.test(normalized) && /\b(jam|hari|minggu|bulan)\b/.test(normalized);
	const hasSeverity = /\b(ringan|sedang|berat|parah|memburuk)\b/.test(normalized);
	const detailSymptoms = normalized.match(/\b(demam|batuk|pilek|nyeri|mual|muntah|diare|sesak|gatal|ruam|pusing|lemas)\b/g) || [];
	return hasDuration || hasSeverity || detailSymptoms.length >= 2;
}

function buildClarificationQuestion(params: ClarificationQuestionParams): string | null {
	if (params.isClarificationFollowUp) {
		return null;
	}

	const userInput = params.userInput.trim();
	if (!userInput) {
		return null;
	}

	if (
		isOperationalStatusQuery(userInput) ||
		isFullMedicineCatalogQuery(userInput) ||
		isFornasLookupQuery(userInput) ||
		isIcdCodeLookupQuery(userInput) ||
		isServiceNavigationRequest(userInput)
	) {
		return null;
	}

	const normalized = userInput.toLowerCase();
	const userConversationContext = collectUserConversationContext(params.messages);
	const medicineMentionsInContext = parseMedicationMentions(userConversationContext);
	const hasMultipleMedicines = medicineMentionsInContext.length >= 2;
	const hasAnyMedicine = medicineMentionsInContext.length >= 1;
	const hasAge = hasAgeContext(userConversationContext);
	const hasWeight = hasWeightContext(userConversationContext);
	const hasCondition = hasConditionContext(userConversationContext);
	const hasSymptomDetail = hasSymptomDetailContext(userConversationContext);

	if (/\b(interaksi|kontraindikasi|bersamaan|campur|kombinasi)\b/.test(normalized) && !hasMultipleMedicines) {
		return "obat apa saja yang sedang Bapak/Ibu konsumsi saat ini";
	}

	if (/\b(dosis|takaran|aturan\s+pakai|berapa\s+kali|minum\s+berapa|mg\s*\/\s*kg|frekuensi)\b/.test(normalized)) {
		if (!hasAge) {
			return "usia pasien berapa tahun";
		}

		if (!hasWeight) {
			return "berat badan pasien saat ini berapa kilogram";
		}

		if (!hasCondition) {
			return "kondisi atau diagnosa utama pasien saat ini apa";
		}
	}

	if (/\b(gejala|keluhan|sakit|demam|batuk|pilek|nyeri|mual|muntah|diare|sesak|gatal|ruam|pusing)\b/.test(normalized) && !hasSymptomDetail) {
		return "gejala utama yang dirasakan apa saja dan sudah sejak kapan";
	}

	if (/\b(obat\s+saya|obat\s+ini|aman\s+diminum|boleh\s+diminum|cocok\s+tidak)\b/.test(normalized) && !hasAnyMedicine) {
		return "nama obat yang ingin dicek apa";
	}

	return null;
}

function isOperationalStatusQuery(input: string): boolean {
	const normalized = input.toLowerCase();

	if (/(stok|stock|dispensing|transaksi|pembayaran|antrian|operasional|monitoring\s+sistem|monitoring\s+stok)/.test(normalized)) {
		return true;
	}

	if (/(riwayat|aktivitas|aktifitas|layanan).*(transaksi|dispensing|pembayaran|operasional|antrian|validasi\s+resep|stok|stock)/.test(normalized)) {
		return true;
	}

	if (/(transaksi|dispensing|pembayaran|operasional|antrian|validasi\s+resep|stok|stock).*(riwayat|aktivitas|aktifitas|layanan)/.test(normalized)) {
		return true;
	}

	if (/(real[\s-]?time|realtime|live|saat\s+ini|sekarang|terbaru|sedang\s+berlangsung).*(stok|stock|dispensing|transaksi|pembayaran|antrian|operasional|riwayat|aktivitas|layanan)/.test(normalized)) {
		return true;
	}

	if (/(stok|stock|dispensing|transaksi|pembayaran|antrian|operasional|riwayat|aktivitas|layanan).*(real[\s-]?time|realtime|live|saat\s+ini|sekarang|terbaru|sedang\s+berlangsung)/.test(normalized)) {
		return true;
	}

	if (/(status|update|pembaruan|ringkasan|laporan|informasi|progres|kondisi|cek).*(validasi\s+resep|resep|stok|stock|dispensing|transaksi|pembayaran|antrian|operasional|layanan|workflow)/.test(normalized)) {
		return true;
	}

	if (/(validasi\s+resep|resep).*(dilakukan|menunggu|pending|status|antrian)/.test(normalized)) {
		return true;
	}

	return false;
}

function chunkTextByCodePoint(text: string, chunkSize: number): string[] {
	if (!text) {
		return [];
	}

	const codePoints = Array.from(text);
	const chunks: string[] = [];

	for (let i = 0; i < codePoints.length; i += chunkSize) {
		chunks.push(codePoints.slice(i, i + chunkSize).join(""));
	}

	return chunks;
}

function createSSEChunkResponse(chunks: Array<Record<string, unknown>>): Response {
	const encoder = new TextEncoder();

	return new Response(
		new ReadableStream({
			start(controller) {
				try {
					for (const chunk of chunks) {
						const event = `data: ${JSON.stringify(chunk)}\n\n`;
						controller.enqueue(encoder.encode(event));
					}

					controller.close();
				} catch (error) {
					controller.error(error);
				}
			},
		}),
		{
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		},
	);
}

function createStreamingResponse(text: string): Response {
	const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const chunks: Array<Record<string, unknown>> = [
		{ type: "text-start", id: messageId },
		...chunkTextByCodePoint(text, 24).map((chunk) => ({
			type: "text-delta",
			id: messageId,
			delta: chunk,
		})),
		{ type: "text-end", id: messageId },
		{ type: "finish" },
	];

	return createSSEChunkResponse(chunks);
}

function createApprovalRequestStreamingResponse(pending: PendingConfirmation): Response {
	const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const textId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
	const instructionText = buildConfirmationFollowupPrompt(pending);

	const chunks: Array<Record<string, unknown>> = [
		{ type: "start", messageId },
		{ type: "text-start", id: textId },
		...chunkTextByCodePoint(instructionText, 24).map((chunk) => ({
			type: "text-delta",
			id: textId,
			delta: chunk,
		})),
		{ type: "text-end", id: textId },
		{
			type: "tool-input-available",
			toolCallId: pending.toolCallId,
			toolName: CONFIRMATION_TOOL_NAME,
			dynamic: true,
			title: "Konfirmasi tindakan",
			input: {
				summary: pending.summary,
				category: pending.category,
				threadId: pending.threadId,
			},
		},
		{
			type: "tool-approval-request",
			approvalId: pending.id,
			toolCallId: pending.toolCallId,
		},
		{ type: "finish", finishReason: "tool-calls" },
	];

	return createSSEChunkResponse(chunks);
}

function extractTextFromPart(part: unknown): string {
	if (!part || typeof part !== "object") {
		return "";
	}

	const typedPart = part as ChatMessagePart;
	if (typeof typedPart.text === "string") return typedPart.text;
	if (typeof typedPart.inputText === "string") return typedPart.inputText;
	if (typeof typedPart.content === "string") return typedPart.content;
	if (typeof typedPart.delta === "string") return typedPart.delta;
	return "";
}

function extractMessageText(message: ChatMessage): string {
	if (typeof message.content === "string") {
		return message.content;
	}

	if (Array.isArray(message.content)) {
		return message.content.map(extractTextFromPart).join("");
	}

	if (Array.isArray(message.parts)) {
		return message.parts.map(extractTextFromPart).join("");
	}

	return "";
}

function extractTextFromStreamChunk(chunk: unknown): string {
	if (!chunk || typeof chunk !== "object") {
		return "";
	}

	const typed = chunk as Record<string, unknown>;
	if (typeof typed.textDelta === "string") return typed.textDelta;
	if (typeof typed.delta === "string") return typed.delta;
	if (typeof typed.text === "string") return typed.text;
	if (typeof typed.content === "string") return typed.content;
	if (Array.isArray(typed.content)) return typed.content.map(extractTextFromPart).join("");
	return "";
}

function coerceToolResultToText(rawResult: unknown): string {
	if (typeof rawResult === "string") {
		return rawResult;
	}

	if (!rawResult || typeof rawResult !== "object") {
		return JSON.stringify(rawResult ?? "", null, 2);
	}

	const typed = rawResult as Record<string, unknown>;
	if (typeof typed.text === "string") return typed.text;
	if (typeof typed.result === "string") return typed.result;
	if (typeof typed.content === "string") return typed.content;
	return JSON.stringify(rawResult, null, 2);
}

function truncateText(text: string, maxChars = 2500): string {
	if (text.length <= maxChars) {
		return text;
	}

	return `${text.slice(0, maxChars)}\n...[dipotong ${text.length - maxChars} karakter]`;
}

function hasMarkdownTable(text: string): boolean {
	if (!text || !text.includes("|")) {
		return false;
	}

	const hasDivider = /^\s*\|\s*-{3,}/m.test(text);
	const hasRow = /^\s*\|\s*\d+\s*\|/m.test(text);
	return hasDivider && hasRow;
}

function hasUsableData(text: string): boolean {
	const normalized = text.toLowerCase();
	if (!normalized.trim()) {
		return false;
	}

	if (hasMarkdownTable(text)) {
		return true;
	}

	return ![
		"tidak ditemukan",
		"tidak tersedia",
		"tidak ada data",
		"belum ada data valid",
		"belum tersedia",
		"tidak relevan",
		"gagal mengambil",
		"gagal memproses",
		"gagal menjalankan",
		"gagal melakukan",
		"terjadi kesalahan",
		"mohon masukkan",
	].some((indicator) => normalized.includes(indicator));
}

function hasCatalogPayload(text: string, catalogHeaderPattern: RegExp): boolean {
	const normalized = text.toLowerCase();
	if (!normalized.trim()) {
		return false;
	}

	if (normalized.includes(SKIPPED_TOOL_TEXT.toLowerCase())) {
		return false;
	}

	const hasHeader = catalogHeaderPattern.test(normalized);
	const hasNumberedRows = /^\s*\d+\.\s+/m.test(text);
	const hasTableRows = /^\s*\|\s*\d+\s*\|/m.test(text);
	return hasHeader && (hasNumberedRows || hasTableRows);
}

function sanitizeToolResultText(text: string, sourceName: string): string {
	const trimmed = text.trim();
	if (!trimmed) {
		return `Belum ada data valid dari ${sourceName}.`;
	}

	if (/error:|exception|stack|traceback|econn|timed out|terjadi kesalahan/i.test(trimmed)) {
		return `Belum ada data valid dari ${sourceName}.`;
	}

	return trimmed;
}

function stripCodeFence(text: string): string {
	return text.replace(/^```[a-zA-Z]*\s*/g, "").replace(/```$/g, "").trim();
}

// ==================== CONVERSATION HISTORY MANAGEMENT ====================

function extractConversationHistory(messages: ChatMessage[], maxMessages: number = 5): ChatMessage[] {
	if (!Array.isArray(messages)) {
		return [];
	}

	const validMessages = messages.filter((msg) => msg.role && extractMessageText(msg).trim().length > 0);
	return validMessages.slice(Math.max(0, validMessages.length - maxMessages));
}

function formatConversationForContext(messages: ChatMessage[]): string {
	const history = extractConversationHistory(messages, 6);
	if (history.length === 0) {
		return "";
	}

	const lines = ["RIWAYAT PERCAKAPAN SEBELUMNYA:"];
	for (const msg of history) {
		const role = msg.role === "user" ? "USER" : "ASSISTANT";
		const content = extractMessageText(msg).trim();
		const truncated = truncateText(content, 400);
		lines.push(`${role}: ${truncated}`);
	}

	return lines.join("\n");
}

function isConfirmationResponse(text: string): boolean {
	const normalized = text.toLowerCase().trim();
	const confirmationPatterns = [
		/^(iya|ya|yup|yes|ok|okay|oke|okee|baik|silakan|lanjut|lanjutkan|mau|mau lanjut|mari|mulai|go|proceed)$/,
		/^(iya|ya|yup),?\s*(saya\s+)?(mau|ingin|bisa|silakan).+/,
		/^(mau|ingin|bisa|tolong|mohon).*lanj/,
		/^(terima\s+kasih|makasih).*lanj/,
	];

	return confirmationPatterns.some((pattern) => pattern.test(normalized));
}

function extractPreviousAssistantOffer(messages: ChatMessage[]): string {
	const history = extractConversationHistory(messages, 4);
	let lastAssistantMessage = "";

	for (let i = history.length - 1; i >= 0; i--) {
		const message = history[i];
		if (!message) {
			continue;
		}
		if (message.role === "assistant") {
			lastAssistantMessage = extractMessageText(message);
			break;
		}
	}

	// Detect common offer patterns
	const offerPatterns = [
		/saya\s+(bisa\s+)?lanj/i,
		/saya\s+(bisa\s+)?pandu/i,
		/saya\s+(bisa\s+)?bantu.*langkah/i,
		/jika\s+anda\s+mau/i,
		/jika\s+anda\s+ingin/i,
		/apakah\s+anda\s+ingin/i,
		/sedang\s+menunggu.*persetujuan/i,
		/menunggu\s+konfirmasi/i,
	];

	if (offerPatterns.some((pattern) => pattern.test(lastAssistantMessage))) {
		return lastAssistantMessage.substring(0, 300);
	}

	return "";
}

// ==================== END CONVERSATION MANAGEMENT ====================

function parseIcd10Matches(text: string): Array<{ kode: string; nama: string }> {
	const matches: Array<{ kode: string; nama: string }> = [];
	const lines = text.split(/\r?\n/);

	for (const lineRaw of lines) {
		const numbered = lineRaw.trim().match(/^\d+\.\s*([A-Za-z]\d{2}(?:\.\d{1,2})?)\s*-\s*(.+)$/);
		if (!numbered) {
			continue;
		}

		const kode = (numbered[1] || "").toUpperCase().trim();
		const nama = (numbered[2] || "").trim();
		if (kode && nama) {
			matches.push({ kode, nama });
		}
	}

	return matches;
}

function parseNumberedItems(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.map((line) => line.match(/^\d+\.\s*(.+)$/)?.[1]?.trim() ?? "")
		.map((item) => item.replace(/^\[\s*no\.?\s*\d+\s*\]\s*/i, "").trim())
		.filter((item) => item.length > 0)
		.filter((item) => !/^restriksi\s*:/i.test(item))
		.filter((item) => !/^peresepan\s*:/i.test(item));
}

function parseMedicineNumberEntries(text: string): Array<{ no: string; nama: string }> {
	const entries: Array<{ no: string; nama: string }> = [];
	const lines = text.split(/\r?\n/);

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const numbered = line.match(/^\d+\.\s*(?:\[\s*no\.?\s*(\d+)\s*\]\s*)?(.+)$/i);
		if (!numbered) {
			continue;
		}

		const no = (numbered[1] || "").trim();
		const nama = (numbered[2] || "").replace(/^\[\s*no\.?\s*\d+\s*\]\s*/i, "").trim();
		if (no && nama) {
			entries.push({ no, nama });
		}
	}

	return entries;
}

function parseMedicineRegistryNumbers(text: string): string[] {
	const numbers = new Set<string>();
	const patterns = [
		/\[\s*no\.?\s*(\d+)\s*\]/gi,
		/no\.?\s*(?:obat\s*rsi|obat|rsi)?\s*[:\-]?\s*(\d{1,4})\b/gi,
	];

	for (const pattern of patterns) {
		let matched: RegExpExecArray | null;
		while ((matched = pattern.exec(text)) !== null) {
			const number = (matched[1] || "").trim();
			if (number) {
				numbers.add(number);
			}
		}
	}

	return Array.from(numbers);
}

function buildMedicineNumberSummary(entries: Array<{ no: string; nama: string }>, numbers: string[]): string {
	const uniqueEntries = Array.from(
		new Map(entries.map((entry) => [`${entry.no}::${entry.nama.toLowerCase()}`, entry])).values(),
	);

	if (uniqueEntries.length > 0) {
		return uniqueEntries
			.slice(0, 5)
			.map((entry) => `${entry.no} (${entry.nama})`)
			.join("; ");
	}

	if (numbers.length > 0) {
		return numbers.slice(0, 8).join(", ");
	}

	return "informasi belum cukup";
}

type MedicineDetailRow = {
	no: string;
	nama: string;
	restriksi: string;
	peresepan: string;
	smf: string;
};

function parseMedicineDetailRows(text: string): MedicineDetailRow[] {
	const rows: MedicineDetailRow[] = [];
	const lines = text.split(/\r?\n/);
	let current: MedicineDetailRow | null = null;

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}

		const itemLine = line.match(/^\d+\.\s*(?:\[\s*no\.?\s*(\d+)\s*\]\s*)?(.+)$/i);
		if (itemLine) {
			if (current && current.nama) {
				rows.push(current);
			}

			current = {
				no: (itemLine[1] || "").trim(),
				nama: (itemLine[2] || "").replace(/^\[\s*no\.?\s*\d+\s*\]\s*/i, "").trim(),
				restriksi: "",
				peresepan: "",
				smf: "",
			};
			continue;
		}

		if (!current) {
			continue;
		}

		const restriksi = line.match(/^restriksi\s*:\s*(.+)$/i)?.[1]?.trim();
		if (restriksi) {
			current.restriksi = restriksi;
			continue;
		}

		const peresepan = line.match(/^peresepan\s*:\s*(.+)$/i)?.[1]?.trim();
		if (peresepan) {
			current.peresepan = peresepan;
			continue;
		}

		const smf = line.match(/^smf\s*:\s*(.+)$/i)?.[1]?.trim();
		if (smf) {
			current.smf = smf;
		}
	}

	if (current && current.nama) {
		rows.push(current);
	}

	const deduped = new Map<string, MedicineDetailRow>();
	for (const row of rows) {
		const key = `${row.no || "-"}::${row.nama.toLowerCase()}`;
		const existing = deduped.get(key);
		if (!existing) {
			deduped.set(key, row);
			continue;
		}

		deduped.set(key, {
			...existing,
			restriksi: existing.restriksi || row.restriksi,
			peresepan: existing.peresepan || row.peresepan,
			smf: existing.smf || row.smf,
		});
	}

	return Array.from(deduped.values());
}

function buildMedicinePeresepanSummary(rows: MedicineDetailRow[]): string {
	if (rows.length === 0) {
		return "informasi belum cukup";
	}

	return rows
		.slice(0, 5)
		.map((row) => {
			const numberLabel = row.no ? `[No. ${row.no}] ` : "";
			const peresepan = row.peresepan && row.peresepan !== "-" ? row.peresepan : "informasi belum tersedia";
			return `${numberLabel}${row.nama}: ${peresepan}`;
		})
		.join("; ");
}

function buildMedicineEvidenceSummary(rows: MedicineDetailRow[]): string {
	if (rows.length === 0) {
		return "informasi belum cukup";
	}

	return rows
		.slice(0, 3)
		.map((row, index) => {
			const numberLabel = row.no ? `[No. ${row.no}] ` : "";
			const restriksi = row.restriksi && row.restriksi !== "-" ? row.restriksi : "informasi belum tersedia";
			const peresepan = row.peresepan && row.peresepan !== "-" ? row.peresepan : "informasi belum tersedia";
			return `${index + 1}) ${numberLabel}${row.nama} | Peresepan: ${peresepan} | Restriksi: ${restriksi}`;
		})
		.join(" ; ");
}

function parseFornasMedicineNames(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.map((line) => line.match(/^📌\s*(.+)$/)?.[1]?.trim() ?? "")
		.filter((item) => item.length > 0);
}

function parseDetectedMedicinesFromInteraction(text: string): string[] {
	const line = text
		.split(/\r?\n/)
		.map((item) => item.trim())
		.find((item) => /obat_terdeteksi\s*:/i.test(item));

	if (!line) {
		return [];
	}

	const raw = line
		.split(":")
		.slice(1)
		.join(":")
		.trim();

	if (!raw || raw === "-") {
		return [];
	}

	return raw
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

function normalizeInteractionText(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/^SCREENING_INTERAKSI_OBAT:\s*/i, ""))
		.map((line) => line.replace(/^-\s*OBAT_TERDETEKSI:\s*/i, "Obat terdeteksi: "))
		.map((line) => line.replace(/^-\s*TEMUAN:\s*/i, "Temuan: "))
		.map((line) => line.replace(/^-\s*REKOMENDASI:\s*/i, "Rekomendasi: "))
		.map((line) => line.replace(/^-\s*CATATAN:\s*/i, "Catatan: "))
		.map((line) => line.replace(/^\s*-\s*/g, ""))
		.join("\n");
}

function extractCriticalFindings(interactionText: string): string[] {
	const negativePatterns = [
		/tidak\s+ada\s+interaksi/i,
		/tidak\s+ada\s+kontraindikasi/i,
		/tidak\s+ditemukan\s+interaksi/i,
		/tidak\s+ditemukan\s+kontraindikasi/i,
		/tidak\s+ada\s+interaksi\/kontraindikasi\s+serius/i,
	];

	return interactionText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((line) => /interaksi serius|kontraindikasi|peringatan klinis|warning:/i.test(line))
		.filter((line) => !negativePatterns.some((pattern) => pattern.test(line)))
		.map((line) => line.replace(/^[-*\s]+/, "").trim())
		.slice(0, 5);
}

function previewText(text: string, maxLines = 2): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.slice(0, maxLines)
		.join(" | ");
}

function isDiseaseMedicationRecommendationQuery(input: string): boolean {
	const normalized = input.toLowerCase();

	if (/(obat|terapi|rekomendasi).*(penyakit|kondisi|diagnosa|diagnosis|icd|keluhan)/.test(normalized)) {
		return true;
	}

	if (/(penyakit|kondisi|diagnosa|diagnosis|icd|keluhan).*(obat|terapi|rekomendasi)/.test(normalized)) {
		return true;
	}

	if (/obat\s+untuk\s+[a-z]/.test(normalized)) {
		return true;
	}

	return false;
}

function isPrescriptionContextQuery(input: string): boolean {
	const normalized = input.toLowerCase();

	if (/(peresepan|resep(?:an)?\s+maksimal|maks(?:imum)?\s+resep|aturan\s+resep|restriksi\s+obat)/.test(normalized)) {
		return true;
	}

	if (/jatah\s+obat|batas\s+resep|maks\s+obat/.test(normalized)) {
		return true;
	}

	return false;
}

function isMedicineDataLookupQuery(input: string): boolean {
	const normalized = input.toLowerCase();

	if (isPrescriptionContextQuery(normalized)) {
		return true;
	}

	if (/(informasi|detail|data|cek|cari|lihat|tampilkan).*(obat|peresepan|restriksi)/.test(normalized)) {
		return true;
	}

	if (/(obat|peresepan|restriksi).*(informasi|detail|data|cek|cari|lihat|tampilkan)/.test(normalized)) {
		return true;
	}

	return false;
}

function isMedicineNumberLookupQuery(input: string): boolean {
	const normalized = input.toLowerCase();

	if (/(nomor|kode|no\.?)\s+obat/.test(normalized)) {
		return true;
	}

	if (/obat\s+nomor/.test(normalized)) {
		return true;
	}

	return false;
}

function isFullMedicineCatalogQuery(input: string): boolean {
	const normalized = input
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!normalized) {
		return false;
	}

	if (
		/\b(semua|seluruh|keseluruhan|daftar|list|katalog|lengkap|full)\b.*\b(obat|database|data)\b/.test(normalized)
	) {
		return true;
	}

	if (
		/\b(obat|database|data)\b.*\b(semua|seluruh|keseluruhan|daftar|list|katalog|lengkap|full)\b/.test(normalized)
	) {
		return true;
	}

	if (/^(informasi|data|detail)\s+obat(?:\s+(rsi|darsi|kronis|fornas))?$/.test(normalized)) {
		return true;
	}

	if (/^daftar\s+obat(?:\s+(rsi|fornas|darsi))?$/.test(normalized)) {
		return true;
	}

	return false;
}

function isFornasLookupQuery(input: string): boolean {
	const normalized = input.toLowerCase();
	return /fornas|bpjs|formularium|fktp|fktl|prb|oen/.test(normalized);
}

const FORNAS_QUERY_STOPWORDS = new Set([
	"apakah",
	"ada",
	"di",
	"untuk",
	"tolong",
	"mohon",
	"cek",
	"cari",
	"carikan",
	"tampilkan",
	"lihat",
	"informasi",
	"info",
	"ketersediaan",
	"obat",
	"e",
	"fornas",
	"bpjs",
	"formularium",
	"nasional",
	"rsi",
	"yang",
	"dan",
	"atau",
	"kah",
	"nya",
]);

function buildFornasToolQuery(userInput: string, medicineMentions: string[]): string {
	if (isFullMedicineCatalogQuery(userInput)) {
		return userInput;
	}

	if (medicineMentions.length > 0) {
		return medicineMentions.join(" ");
	}

	const normalized = userInput
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	const tokens = normalized
		.split(" ")
		.map((token) => token.trim())
		.filter((token) => token.length >= 2)
		.filter((token) => !FORNAS_QUERY_STOPWORDS.has(token));

	if (tokens.length === 0) {
		return userInput;
	}

	return tokens.slice(0, 8).join(" ").trim();
}

function isIcdCodeLookupQuery(input: string): boolean {
	const normalized = input.toLowerCase();

	if (isIcdDatasetListingQuery(normalized)) {
		return true;
	}

	if (/(kode|nomor)\s+icd(?:-?10)?/.test(normalized)) {
		return true;
	}

	if (/icd(?:-?10)?\s+(untuk\s+)?[a-z0-9]/.test(normalized)) {
		return true;
	}

	if (/(kode|nomor)\s+diagnos(?:is|a)/.test(normalized)) {
		return true;
	}

	if (/diagnos(?:is|a)\s+(untuk\s+)?[a-z0-9]/.test(normalized)) {
		return true;
	}

	if (/kode\s+penyakit/.test(normalized)) {
		return true;
	}

	if (/\b[a-z]\d{2}(?:\.\d{1,2})?\b/i.test(normalized)) {
		return true;
	}

	if (/\bicd(?:-?10)?\b/.test(normalized)) {
		return true;
	}

	return false;
}

function isIcdDatasetListingQuery(input: string): boolean {
	const normalized = input
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!normalized) {
		return false;
	}

	if (/\b(semua|seluruh|all|list|daftar)\b.*\bicd(?:-?10)?\b/.test(normalized)) {
		return true;
	}

	if (/\bicd(?:-?10)?\b.*\b(semua|seluruh|all|list|daftar)\b/.test(normalized)) {
		return true;
	}

	if (/^(list|daftar)\s+icd(?:-?10)?$/.test(normalized)) {
		return true;
	}

	if (/^icd(?:-?10)?(\s+(all|semua|seluruh))?$/.test(normalized)) {
		return true;
	}

	return false;
}

function extractConditionQuery(input: string): string {
	const normalizeConditionCandidate = (rawCandidate: string): string => {
		const firstSegment = rawCandidate.split(/\b(?:dan|untuk|dengan|sesuai|serta|ke|opsi|terapi)\b/)[0] || rawCandidate;
		const cleaned = firstSegment
			.toLowerCase()
			.replace(/[^a-z0-9.\s-]/g, " ")
			.replace(/\s+/g, " ")
			.trim();

		if (!cleaned) return "";

		const discard = new Set([
			"mapping",
			"maping",
			"map",
			"rekomendasi",
			"opsi",
			"terapi",
			"ke",
			"obat",
			"sesuai",
			"penyakit",
			"kondisi",
			"tersebut",
			"ini",
			"nomor",
			"kode",
			"icd",
			"icd10",
			"diagnosis",
			"diagnosa",
			"tiap",
			"setiap",
		]);

		const tokens = cleaned
			.split(" ")
			.map((token) => token.trim())
			.filter((token) => token.length >= 2)
			.filter((token) => !discard.has(token));

		return tokens.join(" ").trim();
	};

	const normalized = input
		.toLowerCase()
		.replace(/[^a-z0-9.\s-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!normalized) {
		return input.trim();
	}

	const explicitIcdCode = normalized.match(/\b([a-z]\d{2}(?:\.\d{1,2})?)\b/i)?.[1];
	if (explicitIcdCode) {
		return explicitIcdCode.toUpperCase();
	}

	const explicitPatterns = [
		/obat\s+untuk\s+([a-z0-9\s-]+)/,
		/(?:nomor|kode)\s+icd(?:-?10)?\s+(?:untuk\s+)?([a-z0-9.\s-]+)/,
		/icd(?:-?10)?\s+(?:untuk\s+)?([a-z0-9.\s-]+)/,
		/(?:nomor|kode)\s+diagnos(?:is|a)\s+([a-z0-9.\s-]+)/,
		/diagnos(?:is|a)\s+untuk\s+([a-z0-9.\s-]+)/,
		/diagnosis\s+([a-z0-9\s-]+)/,
		/diagnosa\s+([a-z0-9\s-]+)/,
		/penyakit\s+([a-z0-9\s-]+)/,
		/kondisi\s+([a-z0-9\s-]+)/,
	];

	for (const pattern of explicitPatterns) {
		const matched = normalized.match(pattern);
		const candidate = normalizeConditionCandidate((matched?.[1] || "").trim());
		if (candidate.length >= 3) {
			return candidate;
		}
	}

	const stopwords = new Set([
		"tolong",
		"mohon",
		"saya",
		"minta",
		"mapping",
		"maping",
		"map",
		"berikan",
		"informasi",
		"cari",
		"nomor",
		"kode",
		"icd",
		"icd10",
		"diagnosis",
		"diagnosa",
		"rekomendasi",
		"opsi",
		"terapi",
		"ke",
		"obat",
		"untuk",
		"sesuai",
		"penyakit",
		"kondisi",
		"tersebut",
		"ini",
		"dan",
		"yang",
		"berdasarkan",
		"status",
		"tiap",
		"setiap",
	]);

	const tokens = normalized
		.split(" ")
		.map((token) => token.trim())
		.filter((token) => token.length >= 2)
		.filter((token) => !stopwords.has(token));

	if (tokens.length > 0) {
		return normalizeConditionCandidate(tokens.join(" "));
	}

	return input.trim();
}

function isDiagnosisRequest(input: string): boolean {
	return /penyakit saya|saya sakit apa|tebak penyakit|diagnosa saya|diagnosis saya|apa penyakit saya|saya terkena apa/i.test(
		input,
	);
}

function detectChatIntent(input: string): ChatIntent {
	const normalized = input.toLowerCase();
	if (/validasi|review\s+resep|cek\s+resep|evaluasi\s+resep|racikan/.test(normalized)) {
		return "validasi_resep";
	}

	if (/interaksi|kontraindikasi|kombinasi\s+obat|obat\s+bersamaan|bersamaan/.test(normalized)) {
		return "cek_interaksi";
	}

	if (/fornas|bpjs|formularium|fktp|fktl|prb|oen/.test(normalized)) {
		return "kepatuhan_fornas";
	}

	if (isIcdCodeLookupQuery(normalized)) {
		return "kecocokan_icd10";
	}

	if (isDiseaseMedicationRecommendationQuery(normalized)) {
		return "kecocokan_icd10";
	}

	if (/obat|dosis|aturan\s+pakai|efek\s+samping|peresepan|restriksi|hipertensi|diabetes|asma/.test(normalized)) {
		return "informasi_obat";
	}

	return "umum_skrining";
}

function buildExecutionConfirmationPlan(params: {
	intent: ChatIntent;
	userInput: string;
	medicineMentions: string[];
	operationalStatusQuery: boolean;
	diseaseMedicationRecommendation: boolean;
	diagnosisBlocked: boolean;
}): ConfirmationPlan | null {
	if (params.diagnosisBlocked) {
		return null;
	}

	if (params.operationalStatusQuery) {
		return {
			category: "operasional_live",
			summary:
				"DARSI akan mengambil data operasional live (stok, dispensing, transaksi, atau antrian) sebelum jawaban dikirim.",
		};
	}

	if (params.diseaseMedicationRecommendation) {
		const condition = extractConditionQuery(params.userInput) || "kondisi yang ditanyakan";
		return {
			category: "rekomendasi_terapi",
			summary: `DARSI akan menjalankan analisis rekomendasi terapi berbasis kondisi: ${condition}.`,
		};
	}

	if (params.intent === "cek_interaksi" || params.intent === "validasi_resep") {
		const medicineLabel =
			params.medicineMentions.length > 0
				? params.medicineMentions.join(", ")
				: "obat pada pertanyaan ini";

		return {
			category: "validasi_klinis",
			summary: `DARSI akan menjalankan validasi klinis dan skrining interaksi untuk: ${medicineLabel}.`,
		};
	}

	return null;
}

function detectUserRole(userInput: string, userId: string): UserRole {
	const input = userInput.toLowerCase();
	const id = userId.toLowerCase();

	if (/\bsaya\s+apoteker\b|\bsebagai\s+apoteker\b|\bstaf\s+farmasi\b/.test(input)) {
		return "apoteker";
	}

	if (/\bsaya\s+pasien\b|\buntuk\s+pasien\b|\bpasien\s+saya\b|\bsaya\s+awam\b/.test(input)) {
		return "pasien";
	}

	if (/apoteker|farmasi|pharmacist|klinis|dokter|perawat|admin/.test(id)) {
		return "apoteker";
	}

	return "umum";
}

function normalizeSessionRole(rawRole: unknown): UserRole | null {
	if (typeof rawRole !== "string") {
		return null;
	}

	const normalized = rawRole.trim().toLowerCase();

	if (normalized === "apoteker" || normalized === "pharmacist") {
		return "apoteker";
	}

	if (normalized === "pasien" || normalized === "patient" || normalized === "user") {
		return "pasien";
	}

	if (normalized === "admin") {
		return "apoteker";
	}

	return null;
}

function hasExplicitRoleMetadata(body: ChatRequestBody): boolean {
	return typeof body.userRole === "string" || typeof body.userMode === "string";
}

function resolveUserRoleFromSession(body: ChatRequestBody): UserRole | null {
	const directRole = normalizeSessionRole(body.userRole);
	if (directRole) {
		return directRole;
	}

	return normalizeSessionRole(body.userMode);
}

function resolveSessionUserName(body: ChatRequestBody): string {
	const candidates = [body.userName, body.namaUser];

	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			continue;
		}

		const trimmed = candidate.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
	}

	return "Pengguna DARSI";
}

function normalizeLiveViewerRole(rawRole: unknown): LiveStatusViewerRole | null {
	if (typeof rawRole !== "string") {
		return null;
	}

	const normalized = rawRole.trim().toLowerCase();

	if (normalized === "admin") {
		return "admin";
	}

	if (normalized === "apoteker" || normalized === "pharmacist") {
		return "apoteker";
	}

	if (normalized === "pasien" || normalized === "patient" || normalized === "user") {
		return "pasien";
	}

	return null;
}

function resolveLiveStatusViewerRole(body: ChatRequestBody, fallbackRole: UserRole): LiveStatusViewerRole {
	const roleFromUserRole = normalizeLiveViewerRole(body.userRole);
	if (roleFromUserRole) {
		return roleFromUserRole;
	}

	const roleFromMode = normalizeLiveViewerRole(body.userMode);
	if (roleFromMode) {
		return roleFromMode;
	}

	if (fallbackRole === "apoteker") {
		return "apoteker";
	}

	if (fallbackRole === "pasien") {
		return "pasien";
	}

	return "auto";
}

function extractFirstJsonObject(rawText: string): Record<string, unknown> | null {
	const cleaned = stripCodeFence(rawText).trim();
	if (!cleaned) return null;

	try {
		const parsed = JSON.parse(cleaned) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Fallback to loose extraction below.
	}

	const start = cleaned.indexOf("{");
	const end = cleaned.lastIndexOf("}");
	if (start < 0 || end <= start) return null;

	const candidate = cleaned.slice(start, end + 1);
	try {
		const parsed = JSON.parse(candidate) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return null;
	}

	return null;
}

function normalizeToolName(rawName: string): ToolName | null {
	const normalized = rawName.trim().toLowerCase();

	if (
		normalized === "search_icd_code" ||
		normalized === "search-icd" ||
		normalized === "icd" ||
		normalized === "icd10"
	) {
		return "search_icd_code";
	}

	if (
		normalized === "search-medicines" ||
		normalized === "search_medicines" ||
		normalized === "medicines" ||
		normalized === "obat" ||
		normalized === "obat-kronis"
	) {
		return "search-medicines";
	}

	if (
		normalized === "recommend-medicines" ||
		normalized === "recommend_medicines" ||
		normalized === "rekomendasi-obat" ||
		normalized === "rekomendasi_obat" ||
		normalized === "rekomendasi"
	) {
		return "recommend-medicines";
	}

	if (
		normalized === "search-efornas" ||
		normalized === "search_efornas" ||
		normalized === "efornas" ||
		normalized === "fornas" ||
		normalized === "bpjs"
	) {
		return "search-efornas";
	}

	if (
		normalized === "check_medication_interaction" ||
		normalized === "check-interaction" ||
		normalized === "interaction" ||
		normalized === "interaksi"
	) {
		return "check_medication_interaction";
	}

	if (
		normalized === "get-live-system-status" ||
		normalized === "get_live_system_status" ||
		normalized === "live-system-status" ||
		normalized === "status-sistem-live" ||
		normalized === "status-operasional" ||
		normalized === "live-status"
	) {
		return "get-live-system-status";
	}

	return null;
}

function parsePlannedToolNames(rawPlannerText: string): ToolName[] {
	const parsedObject = extractFirstJsonObject(rawPlannerText);
	if (!parsedObject) return [];

	const toolValues = parsedObject.tools;
	if (!Array.isArray(toolValues)) return [];

	const names = toolValues
		.map((value) => String(value ?? ""))
		.map((value) => normalizeToolName(value))
		.filter((value): value is ToolName => value !== null);

	return Array.from(new Set(names));
}

function buildHeuristicToolPlan(userInput: string, medicineMentions: string[]): Set<ToolName> {
	const plan = new Set<ToolName>();
	const intent = detectChatIntent(userInput);
	const lower = userInput.toLowerCase();
	const operationalStatusQuery = isOperationalStatusQuery(userInput);
	const fullMedicineCatalogQuery = isFullMedicineCatalogQuery(userInput);
	const diseaseMedicationRecommendation = isDiseaseMedicationRecommendationQuery(userInput);
	const fornasLookupQuery = isFornasLookupQuery(userInput);
	const medicineDataLookupQuery = isMedicineDataLookupQuery(userInput);
	const prescriptionContextQuery = isPrescriptionContextQuery(userInput);
	const icdLookupQuery = isIcdCodeLookupQuery(userInput);

	if (fullMedicineCatalogQuery) {
		plan.add("search-medicines");
		plan.add("search-efornas");
		return plan;
	}

	if (operationalStatusQuery) {
		plan.add("get-live-system-status");
	}

	if (intent === "validasi_resep") {
		plan.add("search-medicines");
		plan.add("check_medication_interaction");
		if (/fornas|bpjs|formularium|fktp|fktl|prb|oen/.test(lower)) {
			plan.add("search-efornas");
		}
	}

	if (intent === "cek_interaksi") {
		plan.add("check_medication_interaction");
		plan.add("search-medicines");
	}

	if (intent === "kepatuhan_fornas") {
		plan.add("search-efornas");
		plan.add("search-medicines");
	}

	if (intent === "kecocokan_icd10") {
		plan.add("search_icd_code");
		if (diseaseMedicationRecommendation) {
			plan.add("recommend-medicines");
		}
		if (medicineMentions.length > 0) {
			plan.add("search-medicines");
		}
	}

	if (intent === "informasi_obat") {
		plan.add("search-medicines");
		if (diseaseMedicationRecommendation) {
			plan.add("recommend-medicines");
			plan.add("search_icd_code");
		}
	}

	if (medicineDataLookupQuery || prescriptionContextQuery) {
		plan.add("search-medicines");
	}

	if (medicineMentions.length >= 2 || /interaksi|kontraindikasi|obat\s+bersamaan|bersamaan/.test(lower)) {
		plan.add("check_medication_interaction");
	}

	if (fornasLookupQuery) {
		plan.add("search-efornas");
	}

	if (icdLookupQuery || /penyakit/.test(lower)) {
		plan.add("search_icd_code");
	}

	if (diseaseMedicationRecommendation) {
		plan.add("recommend-medicines");
	}

	if (plan.size === 0) {
		plan.add("search-medicines");
	}

	// Comprehensive data search: always include eFornas when searching medicines
	// This ensures users get data from ALL available sources (RSI chronic drugs + eFornas)
	if (plan.has("search-medicines") || plan.has("recommend-medicines")) {
		plan.add("search-efornas");
	}

	return plan;
}

function applySafetyOverrides(plan: Set<ToolName>, userInput: string, medicineMentions: string[]): Set<ToolName> {
	const patched = new Set(plan);
	const lower = userInput.toLowerCase();
	const fullMedicineCatalogQuery = isFullMedicineCatalogQuery(userInput);
	const diseaseMedicationRecommendation = isDiseaseMedicationRecommendationQuery(userInput);
	const fornasLookupQuery = isFornasLookupQuery(userInput);
	const medicineDataLookupQuery = isMedicineDataLookupQuery(userInput);
	const prescriptionContextQuery = isPrescriptionContextQuery(userInput);
	const icdLookupQuery = isIcdCodeLookupQuery(userInput);
	const pureIcdLookup =
		icdLookupQuery && !diseaseMedicationRecommendation && !/(obat|terapi|rekomendasi)/.test(lower);
	const pureMedicineLookup = medicineDataLookupQuery && !diseaseMedicationRecommendation && !icdLookupQuery;

	if (isOperationalStatusQuery(userInput)) {
		patched.add("get-live-system-status");
	}

	if (medicineMentions.length >= 2 || /interaksi|kontraindikasi|obat\s+bersamaan|bersamaan/.test(lower)) {
		patched.add("check_medication_interaction");
	}

	if (fornasLookupQuery) {
		patched.add("search-efornas");
	}

	if (medicineDataLookupQuery || prescriptionContextQuery) {
		patched.add("search-medicines");
	}

	if (icdLookupQuery) {
		patched.add("search_icd_code");
	}

	if (diseaseMedicationRecommendation) {
		patched.add("search_icd_code");
		patched.add("recommend-medicines");
	}

	if (fullMedicineCatalogQuery) {
		patched.add("search-medicines");
		patched.add("search-efornas");
		patched.delete("search_icd_code");
		patched.delete("recommend-medicines");
		patched.delete("check_medication_interaction");
	}

	if (pureIcdLookup) {
		patched.add("search_icd_code");
		patched.delete("recommend-medicines");
	}

	if (pureMedicineLookup) {
		patched.delete("search_icd_code");
		patched.delete("recommend-medicines");
	}

	const hasKnowledgeSource = [
		"search-medicines",
		"recommend-medicines",
		"search-efornas",
		"search_icd_code",
		"get-live-system-status",
	].some(
		(name) =>
		patched.has(name as ToolName),
	);
	if (!hasKnowledgeSource) {
		patched.add("search-medicines");
	}

	// Comprehensive data search: always include eFornas when searching medicines
	// This ensures users get data from ALL available sources (RSI chronic drugs + eFornas)
	if (patched.has("search-medicines") || patched.has("recommend-medicines")) {
		patched.add("search-efornas");
	}

	return patched;
}

function buildToolPlannerPrompt(userInput: string, medicineMentions: string[]): string {
	const meds = medicineMentions.length > 0 ? medicineMentions.join(", ") : "tidak ada obat terdeteksi";

	return [
		"Anda adalah planner tool DARSI Apoteker.",
		"Pilih tool yang diperlukan untuk menjawab pertanyaan user.",
		"",
		"Daftar tool yang boleh dipilih:",
		"1. search_icd_code -> cari kode/diagnosis ICD-10",
		"2. search-medicines -> cari obat di database RSI",
		"3. recommend-medicines -> rekomendasi kandidat obat berdasarkan penyakit/kondisi",
		"4. search-efornas -> cek Fornas/BPJS/formularium",
		"5. check_medication_interaction -> cek interaksi/kontraindikasi obat",
		"6. get-live-system-status -> gunakan saat user menanyakan status operasional real-time: stok/ketersediaan, sisa unit, proses dispensing, antrian validasi resep, pembayaran, atau riwayat transaksi layanan.",
		"   Contoh: stok amoxicillin; apakah paracetamol tersedia; sisa obat X berapa; proses dispensing saat ini; riwayat transaksi pasien hari ini.",
		"",
		"Aturan:",
		"- Kembalikan JSON murni tanpa markdown.",
		"- Format WAJIB: {\"tools\":[\"...\"],\"reason\":\"...\"}",
		"- Pilih minimal 1 tool dan maksimal 6 tool.",
		"- Jika user meminta nomor/kode ICD untuk penyakit/diagnosa, wajib masukkan search_icd_code.",
		"- Jika user menanyakan ketersediaan/kepatuhan obat di e-Fornas/BPJS/formularium, wajib masukkan search-efornas.",
		"- Jika user meminta informasi obat/peresepan/restriksi/aturan resep, wajib masukkan search-medicines.",
		"- Jika user meminta semua/seluruh/daftar lengkap data obat, wajib masukkan search-medicines dan search-efornas.",
		"- Jika ada indikasi interaksi atau >=2 obat, wajib masukkan check_medication_interaction.",
		"- Jika user menanyakan obat untuk penyakit/kondisi (disease -> medicine), wajib masukkan search_icd_code dan recommend-medicines.",
		"- Jika user menanyakan update/status/riwayat/aktivitas real-time untuk stok/dispensing/transaksi/pembayaran/validasi resep/layanan, wajib masukkan get-live-system-status.",
		"- Jika query berisi kata live/realtime/saat ini/sekarang/terbaru dan topiknya operasional apotek, prioritaskan get-live-system-status.",
		"",
		`Obat terdeteksi awal: ${meds}`,
		`Pertanyaan user: ${userInput}`,
	].join("\n");
}

async function planToolsWithModel(userInput: string, medicineMentions: string[]): Promise<Set<ToolName>> {
	const heuristicPlan = buildHeuristicToolPlan(userInput, medicineMentions);

	try {
		const plannerPrompt = buildToolPlannerPrompt(userInput, medicineMentions);
		const plannerText = await streamToolPlannerText(plannerPrompt);
		const modelPlan = parsePlannedToolNames(plannerText);

		if (modelPlan.length === 0) {
			logger.warn("LLM planner returned no valid tools; fallback to heuristic plan.");
			return applySafetyOverrides(heuristicPlan, userInput, medicineMentions);
		}

		// Keep deterministic safety by merging heuristic + LLM planner selections.
		const mergedPlan = new Set<ToolName>([...heuristicPlan, ...modelPlan]);
		return applySafetyOverrides(mergedPlan, userInput, medicineMentions);
	} catch (error) {
		logger.warn(`LLM planner failed; fallback to heuristic plan: ${String(error)}`);
		return applySafetyOverrides(heuristicPlan, userInput, medicineMentions);
	}
}

function buildSourceConfidenceMap(params: ToolResults): ToolConfidenceMap {
	const icdCount = parseIcd10Matches(params.icdResult).length;
	const kronisCount = parseNumberedItems(params.kronisResult).length;
	const fornasCount = parseFornasMedicineNames(params.fornasResult).length;
	const criticalCount = extractCriticalFindings(params.interactionResult).length;
	const detectedMedsCount = parseDetectedMedicinesFromInteraction(params.interactionResult).length;

	return {
		icd10:
			!hasUsableData(params.icdResult) || icdCount === 0
				? {
						percent: 25,
						level: "rendah",
						reason: "belum ada kecocokan ICD-10",
					}
				: icdCount >= 2
					? {
							percent: 88,
							level: "tinggi",
							reason: `${icdCount} kode ICD-10 cocok`,
						}
					: {
							percent: 70,
							level: "sedang",
							reason: "1 kode ICD-10 cocok",
						},
		kronis:
			!hasUsableData(params.kronisResult)
				? {
						percent: 30,
						level: "rendah",
						reason: "kandidat obat belum cukup",
					}
				: kronisCount >= 2
					? {
							percent: 86,
							level: "tinggi",
							reason: `${kronisCount} kandidat obat terdeteksi`,
						}
					: kronisCount === 1
						? {
								percent: 72,
								level: "sedang",
								reason: "1 kandidat obat terdeteksi",
							}
						: {
								percent: 60,
								level: "sedang",
								reason: "data parsial",
							},
		fornas:
			!hasUsableData(params.fornasResult)
				? {
						percent: 20,
						level: "rendah",
						reason: "data e-Fornas belum tersedia",
					}
				: fornasCount >= 2
					? {
							percent: 88,
							level: "tinggi",
							reason: `${fornasCount} item Fornas terverifikasi`,
						}
					: fornasCount === 1
						? {
								percent: 75,
								level: "sedang",
								reason: "1 item Fornas terverifikasi",
							}
						: {
								percent: 62,
								level: "sedang",
								reason: "data Fornas parsial",
							},
		interaction:
			!hasUsableData(params.interactionResult)
				? {
						percent: 35,
						level: "rendah",
						reason: "data interaksi belum memadai",
					}
				: criticalCount > 0
					? {
							percent: 90,
							level: "tinggi",
							reason: "ada sinyal interaksi/kontraindikasi kritis",
						}
					: detectedMedsCount >= 2
						? {
								percent: 78,
								level: "sedang",
								reason: "kombinasi obat tervalidasi tanpa sinyal kritis",
							}
						: detectedMedsCount === 1
							? {
									percent: 62,
									level: "sedang",
									reason: "hanya 1 obat terdeteksi",
								}
							: {
									percent: 55,
									level: "sedang",
									reason: "skrining rule-based dengan konteks terbatas",
								},
	};
}

function collectSources(params: ToolResults): string[] {
	const sources: string[] = [];
	if (hasUsableData(params.icdResult)) sources.push("RSI_ICD10");
	if (
		hasUsableData(params.kronisResult) ||
		hasCatalogPayload(params.kronisResult, /daftar\s+lengkap\s+obat\s+kronis\s+rsi\s+surabaya/i)
	)
		sources.push("RSI_OBAT_KRONIS");
	if (hasUsableData(params.recommendResult ?? "")) sources.push("RSI_REKOMENDASI_PENYAKIT");
	if (
		hasUsableData(params.fornasResult) ||
		hasCatalogPayload(params.fornasResult, /daftar\s+lengkap\s+obat\s+e-?fornas/i)
	)
		sources.push("EFORNAS");
	if (hasUsableData(params.liveSystemResult ?? "")) sources.push("LIVE_SYSTEM_OPERASIONAL");
	if (
		hasUsableData(params.interactionResult) ||
		/screening_interaksi_obat|obat_terdeteksi|interaksi|kontraindikasi/i.test(params.interactionResult)
	) {
		sources.push("INTERACTION_RULES");
	}
	return Array.from(new Set(sources));
}

function isAcceptableAssistantAnswer(text: string): boolean {
	return text.trim().length > 0;
}

function ensureWarningPrefix(answer: string, diagnosisBlocked: boolean, hasCriticalInteraction: boolean): string {
	const trimmed = answer.trim();
	if (!trimmed) {
		return trimmed;
	}

	if (diagnosisBlocked && !trimmed.startsWith("**[WARNING KLINIS]**")) {
		return `**[WARNING KLINIS]** Permintaan diagnosis baru tidak diproses.\n\n${trimmed}`;
	}

	if (hasCriticalInteraction && !trimmed.startsWith("**[WARNING KLINIS]**")) {
		return `**[WARNING KLINIS]** Ditemukan potensi interaksi/kontraindikasi klinis penting.\n\n${trimmed}`;
	}

	return trimmed;
}

function ensureMedicineNumberCoverage(
	answer: string,
	chatIntent: ChatIntent,
	userInput: string,
	kronisResult: string,
	recommendResult: string,
): string {
	const trimmed = answer.trim();
	if (!trimmed) {
		return trimmed;
	}

	const lowerInput = userInput.toLowerCase();
	const medicineIntent =
		chatIntent === "informasi_obat" ||
		chatIntent === "validasi_resep" ||
		chatIntent === "kepatuhan_fornas" ||
		chatIntent === "cek_interaksi" ||
		/obat|resep|terapi|fornas|bpjs/.test(lowerInput);

	if (!medicineIntent) {
		return trimmed;
	}

	const entries = [...parseMedicineNumberEntries(kronisResult), ...parseMedicineNumberEntries(recommendResult)];
	const numbers = Array.from(
		new Set([
			...entries.map((entry) => entry.no),
			...parseMedicineRegistryNumbers(kronisResult),
			...parseMedicineRegistryNumbers(recommendResult),
		]),
	);

	if (numbers.length === 0) {
		return trimmed;
	}

	if (
		/(?:nomor\s+obat(?:\s+rsi)?|no\.?\s*(?:obat|rsi))\s*[:\-]?\s*\d+/i.test(trimmed) ||
		/\[\s*no\.?\s*\d+\s*\]/i.test(trimmed)
	) {
		return trimmed;
	}

	const numberSummary = buildMedicineNumberSummary(entries, numbers);
	return `${trimmed}\n\nNomor Obat RSI terkait: ${numberSummary}.`;
}

function formatSourceForOutput(sources: string[]): { internal: string; bracket: string } {
	const seen = new Set(sources);
	const internalParts: string[] = [];
	if (seen.has("RSI_OBAT_KRONIS")) internalParts.push("Database Obat Kronis RSI Surabaya");
	if (seen.has("RSI_REKOMENDASI_PENYAKIT")) internalParts.push("Rekomendasi Obat Berdasarkan Penyakit RSI");
	if (seen.has("EFORNAS")) internalParts.push("Database e-Fornas Kementerian Kesehatan RI");
	if (seen.has("RSI_ICD10")) internalParts.push("Database ICD10 RSI");
	if (seen.has("INTERACTION_RULES")) internalParts.push("Aturan Interaksi Obat Internal DARSI");
	if (seen.has("LIVE_SYSTEM_OPERASIONAL")) internalParts.push("Sistem Operasional Live Apotek RSI");
	if (internalParts.length === 0) internalParts.push("Database Obat Kronis RSI Surabaya");

	const shortParts: string[] = [];
	if (seen.has("RSI_OBAT_KRONIS")) shortParts.push("Obat Kronis RSI");
	if (seen.has("RSI_REKOMENDASI_PENYAKIT")) shortParts.push("Rekomendasi Penyakit RSI");
	if (seen.has("EFORNAS")) shortParts.push("e-Fornas");
	if (seen.has("RSI_ICD10")) shortParts.push("ICD10 RSI");
	if (seen.has("INTERACTION_RULES")) shortParts.push("Aturan Interaksi");
	if (seen.has("LIVE_SYSTEM_OPERASIONAL")) shortParts.push("Operasional Live");
	if (shortParts.length === 0) shortParts.push("Obat Kronis RSI");

	return {
		internal: internalParts.join("; "),
		bracket: shortParts.join(", "),
	};
}

function ensureTraceabilityFooter(answer: string, sources: string[], confidence: ToolConfidenceMap): string {
	const trimmed = answer.trim();
	if (!trimmed) {
		return trimmed;
	}

	const hasInternalRef = /referensi\s+internal\s*:/i.test(trimmed);
	const hasSourceBracket = /\[sumber\s*:\s*data\s+internal\s+rsi/i.test(trimmed);
	const hasClinicalVerificationSignal = /informasi\s+belum\s+cukup|verifikasi\s+klinis|catatan\s+klinis/i.test(trimmed);

	if (hasInternalRef && hasSourceBracket) {
		return trimmed;
	}

	const formattedSource = formatSourceForOutput(sources);
	const sourceSet = new Set(sources);
	const hasLowConfidence =
		(sourceSet.has("RSI_ICD10") && confidence.icd10.percent < 60) ||
		((sourceSet.has("RSI_OBAT_KRONIS") || sourceSet.has("RSI_REKOMENDASI_PENYAKIT")) && confidence.kronis.percent < 60) ||
		(sourceSet.has("EFORNAS") && confidence.fornas.percent < 60) ||
		(sourceSet.has("INTERACTION_RULES") && confidence.interaction.percent < 60);

	const confidenceNote = hasLowConfidence
		? "Catatan klinis tambahan: terdapat indikasi confidence rendah pada sebagian hasil, perlu konfirmasi apoteker/dokter."
		: "";

	const appended = [trimmed];
	if (confidenceNote && !/confidence\s+rendah|indikasi\s+confidence/i.test(trimmed)) {
		appended.push("", confidenceNote);
	}

	if (!hasClinicalVerificationSignal) {
		appended.push("", "Catatan klinis: verifikasi klinis tetap diperlukan sesuai resep dokter/apoteker.");
	}

	if (!hasInternalRef) {
		appended.push("", `Referensi internal: ${formattedSource.internal}.`);
	}

	if (!hasSourceBracket) {
		appended.push(`[Sumber: Data Internal RSI (${formattedSource.bracket})]`);
	}

	return appended.join("\n");
}

function normalizeFinalAssistantAnswer(answer: string): string {
	return answer
		.replace(/SCREENING_INTERAKSI_OBAT:\s*/gi, "")
		.replace(/\|\s*-\s*/g, "| ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

async function executeToolSafely(
	run: () => Promise<unknown>,
	errorMessage: string,
): Promise<{ text: string; ok: boolean }> {
	try {
		return {
			text: coerceToolResultToText(await run()),
			ok: true,
		};
	} catch (error) {
		logger.warn(`${errorMessage}: ${String(error)}`);
		return {
			text: errorMessage,
			ok: false,
		};
	}
}

async function invokeTool(
	tool: ExecutableTool,
	args: Record<string, unknown>,
	unavailableMessage: string,
	operationContext?: Record<string, unknown>,
): Promise<unknown> {
	if (typeof tool.execute !== "function") {
		return unavailableMessage;
	}

	return tool.execute(args, operationContext);
}

async function streamAgentText(prompt: string): Promise<string> {
	const { text } = await generateText({
		model: screeningChatModel,
		prompt,
		temperature: 0.1,
		frequencyPenalty: 0.5,
		presencePenalty: 0.5,
		maxOutputTokens: 1500,
	});

	return (text || "").trim();
}

async function streamToolPlannerText(prompt: string): Promise<string> {
	const { text } = await generateText({
		model: toolPlannerChatModel,
		prompt,
		temperature: 0.1,
		frequencyPenalty: 0.5,
		presencePenalty: 0.5,
		maxOutputTokens: 500,
	});

	return (text || "").trim();
}

function buildFallbackFlexibleResponse(params: FallbackParams): string {
	const { userInput, icdResult, kronisResult, recommendResult = "", fornasResult, interactionResult } = params;

	const icd10Matches = parseIcd10Matches(icdResult);
	const kronisMatches = parseNumberedItems(kronisResult);
	const recommendMatches = parseNumberedItems(recommendResult);
	const medicineDetailRows = [
		...parseMedicineDetailRows(kronisResult),
		...parseMedicineDetailRows(recommendResult),
	];
	const medicinePeresepanSummary = buildMedicinePeresepanSummary(medicineDetailRows);
	const medicineEvidenceSummary = buildMedicineEvidenceSummary(medicineDetailRows);
	const medicineNumberEntries = [...parseMedicineNumberEntries(kronisResult), ...parseMedicineNumberEntries(recommendResult)];
	const medicineNumbers = Array.from(
		new Set([
			...medicineNumberEntries.map((entry) => entry.no),
			...parseMedicineRegistryNumbers(kronisResult),
			...parseMedicineRegistryNumbers(recommendResult),
		]),
	);
	const medicineNumberSummary = buildMedicineNumberSummary(medicineNumberEntries, medicineNumbers);
	const fornasMatches = parseFornasMedicineNames(fornasResult);
	const criticalFindings = extractCriticalFindings(interactionResult);

	const diagnosisBlocked = params.diagnosisBlocked;
	const hasIcdData = icd10Matches.length > 0;
	const hasKronisData = hasUsableData(kronisResult);
	const hasRecommendData = hasUsableData(recommendResult) && recommendMatches.length > 0;
	const hasFornasData = hasUsableData(fornasResult);

	const sourceLabel = formatSourceForOutput(
		collectSources({
			icdResult,
			kronisResult,
			recommendResult,
			fornasResult,
			interactionResult,
		}),
	);

	const dataCocok =
		recommendMatches.length > 0
			? recommendMatches.slice(0, 3).join(", ")
			: kronisMatches.length > 0
			? kronisMatches.slice(0, 3).join(", ")
			: fornasMatches.length > 0
				? fornasMatches.slice(0, 3).join(", ")
				: "informasi belum cukup";

	const icdContext =
		icd10Matches.length > 0
			? icd10Matches.slice(0, 3).map((item) => `${item.kode} (${item.nama})`).join("; ")
			: /tidak\s+ditemukan/i.test(icdResult)
				? previewText(icdResult, 2)
				: "informasi belum cukup";

	const icdNumberSummary =
		icd10Matches.length > 0
			? icd10Matches
					.slice(0, 5)
					.map((item) => `${item.kode} - ${item.nama}`)
					.join(" | ")
			: "informasi belum cukup (penyakit/diagnosa tidak ditemukan di database ICD10 RSI).";
	const topIcdMatch = icd10Matches[0];

	const kelasTerapi = (() => {
		const fromFornas = fornasResult.match(/Kelas\s+Terapi:\s*(.+)/i)?.[1]?.trim();
		return fromFornas || "informasi belum cukup";
	})();

	const sediaanKekuatan = (() => {
		const fromFornas = fornasResult.match(/Sediaan:\s*(.+)/i)?.[1]?.trim();
		return fromFornas || "informasi belum cukup";
	})();

	const ketersediaanFaskes = (() => {
		const fromFornas = fornasResult.match(/Tersedia\s+di:\s*(.+)/i)?.[1]?.trim();
		return fromFornas || "informasi belum cukup";
	})();

	const restriksiPeringatan = (() => {
		const fromKronis = kronisResult.match(/Restriksi:\s*(.+)/i)?.[1]?.trim();
		if (fromKronis) return fromKronis;

		const fromFornas = fornasResult.match(/Restriksi:\s*(.+)/i)?.[1]?.trim();
		if (fromFornas) return fromFornas;

		if (criticalFindings.length > 0) {
			return criticalFindings.slice(0, 2).join(" | ");
		}

		return "informasi belum cukup";
	})();

	const perluVerifikasi =
		diagnosisBlocked ||
		criticalFindings.length > 0 ||
		!hasIcdData ||
		!hasFornasData ||
		(!hasKronisData && !hasRecommendData)
			? "Ya"
			: "Tidak";

	const interactionSummary =
		criticalFindings.length > 0
			? `Temuan keamanan dari data internal: ${criticalFindings.slice(0, 2).join(" | ")}`
			: hasUsableData(interactionResult)
				? `Temuan keamanan dari data internal: ${previewText(normalizeInteractionText(interactionResult), 4)}`
				: "Temuan keamanan dari data internal: informasi belum cukup untuk menilai interaksi/kontraindikasi spesifik.";

	const openingLine =
		params.intent === "kecocokan_icd10" && topIcdMatch
			? `Nomor ICD-10 yang paling relevan: ${topIcdMatch.kode} (${topIcdMatch.nama}).`
			: dataCocok !== "informasi belum cukup"
				? `${dataCocok.split(",")[0]} ditemukan pada data internal DARSI untuk pertanyaan Anda.`
				: "Informasi belum cukup ditemukan pada data internal DARSI untuk pertanyaan Anda.";

	const lines: string[] = [];

	if (diagnosisBlocked) {
		lines.push(
			"**[WARNING KLINIS]** Permintaan diagnosis baru tidak diproses. Sistem hanya memvalidasi resep/terapi yang sudah ada.",
		);
		lines.push("");
	} else if (criticalFindings.length > 0) {
		lines.push(
			"**[WARNING KLINIS]** Ditemukan potensi interaksi/kontraindikasi klinis penting. Mohon verifikasi segera sebelum terapi dilanjutkan.",
		);
		lines.push("");
	}

	lines.push(openingLine);
	lines.push("");
	lines.push("Rincian utama:");
	lines.push(`- **Pertanyaan:** ${userInput}`);
	lines.push(`- **Kecocokan ICD-10:** ${icdContext}`);
	if (params.intent === "kecocokan_icd10") {
		lines.push(`- **Nomor ICD-10 Utama:** ${icdNumberSummary}`);
	}
	lines.push(`- **Kelas Terapi:** ${kelasTerapi}`);
	lines.push(`- **Sediaan/Kekuatan:** ${sediaanKekuatan}`);
	lines.push(`- **Ketersediaan Faskes:** ${ketersediaanFaskes}`);
	if (hasRecommendData) {
		lines.push(`- **Rekomendasi Obat Berdasarkan Penyakit:** ${recommendMatches.slice(0, 5).join(", ")}`);
	}
	lines.push(`- **Data yang Cocok:** ${dataCocok}`);
	lines.push(`- **Peresepan Obat RSI:** ${medicinePeresepanSummary}`);
	lines.push(`- **Data Obat Terkonfirmasi:** ${medicineEvidenceSummary}`);
	lines.push(`- **Nomor Obat RSI:** ${medicineNumberSummary}`);
	lines.push(`- **Restriksi/Peringatan Data:** ${restriksiPeringatan}`);
	lines.push(`- **Perlu Verifikasi Klinis:** ${perluVerifikasi}`);
	lines.push("");
	lines.push("Edukasi efek samping dan interaksi:");
	lines.push(`- ${interactionSummary}`);
	lines.push("");
	lines.push("Catatan klinis:");

	const hasLowConfidence =
		params.confidence.icd10.percent < 60 ||
		params.confidence.kronis.percent < 60 ||
		params.confidence.fornas.percent < 60 ||
		params.confidence.interaction.percent < 60;
	if (hasLowConfidence) {
		lines.push("- Terdapat indikasi confidence rendah pada sebagian hasil pencarian, perlu konfirmasi apoteker RSI.");
	}

	lines.push("- Keputusan terapi dan dosis akhir tetap mengikuti penilaian dokter/apoteker.");

	if (criticalFindings.length > 0) {
		lines.push("- Ada sinyal verifikasi tambahan, sehingga hasil perlu konfirmasi klinis oleh apoteker/dokter.");
	}

	lines.push("");
	lines.push("Alasan ringkas:");
	lines.push("- Jawaban disusun dari kecocokan data RSI dan/atau e-Fornas yang terdeteksi pada kueri ini.");

	if (!hasIcdData || !hasFornasData || (!hasKronisData && !hasRecommendData)) {
		lines.push(
			"- Sebagian konteks masih belum lengkap, sehingga sistem menandai informasi belum cukup pada komponen tertentu.",
		);
	}

	lines.push(`Referensi internal: ${sourceLabel.internal}.`);
	lines.push(`[Sumber: Data Internal RSI (${sourceLabel.bracket})]`);
	return lines.join("\n");
}

function buildDiseaseMedicationRecommendationResponse(params: FallbackParams): string {
	const recommendResultText = params.recommendResult || "";
	const icd10Matches = parseIcd10Matches(params.icdResult);
	const topIcdMatch = icd10Matches[0];
	const recommendMatches = parseNumberedItems(recommendResultText);
	const kronisMatches = parseNumberedItems(params.kronisResult);
	const selectedOptions = recommendMatches.length > 0 ? recommendMatches : kronisMatches;

	const mergedRowsRaw = [
		...parseMedicineDetailRows(recommendResultText),
		...parseMedicineDetailRows(params.kronisResult),
	];
	const mergedRows = Array.from(
		new Map(mergedRowsRaw.map((row) => [`${row.no || "-"}::${row.nama.toLowerCase()}`, row])).values(),
	);

	const medicineNumberEntries = [
		...parseMedicineNumberEntries(recommendResultText),
		...parseMedicineNumberEntries(params.kronisResult),
	];
	const medicineNumbers = Array.from(
		new Set([
			...medicineNumberEntries.map((entry) => entry.no),
			...parseMedicineRegistryNumbers(recommendResultText),
			...parseMedicineRegistryNumbers(params.kronisResult),
		]),
	);

	const conditionLabel = extractConditionQuery(params.userInput) || "kondisi yang ditanyakan";
	const sourceLabel = formatSourceForOutput(
		collectSources({
			icdResult: params.icdResult,
			kronisResult: params.kronisResult,
			recommendResult: recommendResultText,
			fornasResult: params.fornasResult,
			interactionResult: params.interactionResult,
		}),
	);

	const lines: string[] = [];
	lines.push(`Mapping kondisi \"${conditionLabel}\" ke opsi terapi dari data internal RSI:`);
	lines.push("");

	if (topIcdMatch) {
		lines.push(`- ICD-10 paling relevan: ${topIcdMatch.kode} (${topIcdMatch.nama})`);
	} else {
		lines.push("- ICD-10 paling relevan: informasi belum cukup");
	}

	if (selectedOptions.length > 0) {
		lines.push(`- Opsi terapi yang sesuai: ${selectedOptions.slice(0, 5).join(", ")}`);
	} else {
		lines.push("- Opsi terapi yang sesuai: informasi belum cukup");
	}

	const peresepanSummary = buildMedicinePeresepanSummary(mergedRows);
	const evidenceSummary = buildMedicineEvidenceSummary(mergedRows);
	const numberSummary = buildMedicineNumberSummary(medicineNumberEntries, medicineNumbers);

	lines.push(`- Peresepan obat RSI: ${peresepanSummary}`);
	lines.push(`- Data obat terkonfirmasi: ${evidenceSummary}`);
	lines.push(`- Nomor obat RSI: ${numberSummary}`);
	lines.push("");
	lines.push("Catatan klinis:");
	lines.push("- Keputusan terapi dan dosis akhir tetap mengikuti penilaian dokter/apoteker.");
	lines.push(`Referensi internal: ${sourceLabel.internal}.`);
	lines.push(`[Sumber: Data Internal RSI (${sourceLabel.bracket})]`);

	return lines.join("\n");
}

function buildFullMedicineCatalogResponse(params: {
	kronisResult: string;
	fornasResult: string;
}): string {
	const lines: string[] = [];
	const kronisText = params.kronisResult.trim();
	const fornasText = params.fornasResult.trim();
	const hasKronisData =
		hasUsableData(params.kronisResult) ||
		hasCatalogPayload(params.kronisResult, /daftar\s+lengkap\s+obat\s+kronis\s+rsi\s+surabaya/i);
	const hasFornasData =
		hasUsableData(params.fornasResult) ||
		hasCatalogPayload(params.fornasResult, /daftar\s+lengkap\s+obat\s+e-?fornas/i);

	lines.push("Berikut daftar obat dalam format tabel dari data internal DARSI Apoteker.");
	lines.push("");

	lines.push("Data Obat Kronis RSI:");
	lines.push(hasKronisData ? kronisText : "Data obat kronis RSI belum tersedia.");

	if (fornasText) {
		lines.push("");
		lines.push("Data Obat e-Fornas:");
		lines.push(hasFornasData ? fornasText : "Data obat e-Fornas belum tersedia.");
	}
	lines.push("");
	lines.push(
		"Catatan: gunakan kata kunci halaman (mis. halaman 2) untuk menampilkan lanjutan daftar bila data masih panjang.",
	);

	return lines.join("\n");
}

function createEmptyQueryResponse(): string {
	const emptySource = formatSourceForOutput(["INTERACTION_RULES"]);
	return [
		"Informasi belum cukup karena pertanyaan masih kosong, sehingga skrining obat belum bisa dilakukan.",
		"",
		"Rincian utama:",
		"- **Pertanyaan:** informasi belum cukup",
		"- **Kelas Terapi:** informasi belum cukup",
		"- **Sediaan/Kekuatan:** informasi belum cukup",
		"- **Ketersediaan Faskes:** informasi belum cukup",
		"- **Data yang Cocok:** informasi belum cukup",
		"- **Restriksi/Peringatan Data:** informasi belum cukup",
		"- **Perlu Verifikasi Klinis:** Ya",
		"",
		"Edukasi efek samping dan interaksi:",
		"- Informasi belum cukup untuk menilai interaksi spesifik. Mohon tulis nama obat/suplemen yang digunakan.",
		"",
		"Catatan klinis:",
		"- Data inti belum tersedia, sehingga validasi klinis belum dapat dilakukan secara spesifik.",
		"- Jika ada gejala gawat seperti sesak napas, nyeri dada berat, penurunan kesadaran, atau perdarahan aktif, segera ke IGD.",
		"",
		"Alasan ringkas:",
		"- Sistem membutuhkan pertanyaan atau data obat yang jelas agar skrining dapat dilakukan akurat.",
		`Referensi internal: ${emptySource.internal}.`,
		`[Sumber: Data Internal RSI (${emptySource.bracket})]`,
	].join("\n");
}

function buildLLMPrompt(params: {
	userInputRaw: string;
	currentMedsContext: string;
	guidelineContext: string;
	userRole: UserRole;
	userName: string;
	messages?: ChatMessage[];
	isClarificationFollowUp?: boolean;
}): string {
	const roleLabel = params.userRole === "apoteker" || params.userRole === "pasien" ? params.userRole : "tidak dikenali";
	const modeLabel =
		params.userRole === "apoteker"
			? "APOTEKER"
			: params.userRole === "pasien"
				? "PASIEN"
				: "TIDAK_DISETUJUI";

	const conversationHistory = params.messages ? formatConversationForContext(params.messages) : "";
	const isConfirmation = isConfirmationResponse(params.userInputRaw);
	const previousOffer = extractPreviousAssistantOffer(params.messages || []);

	const sections = [
		"SYSTEM:",
		"Kamu adalah DARSI Apoteker, asisten digital farmasi untuk RSI (Rumah Sakit Islam) Surabaya A.Yani.",
		"Role pengguna berasal dari sistem autentikasi; jangan menanyakan role.",
		`Role pengguna: ${roleLabel}`,
		`Mode aktif: ${modeLabel}`,
		`Nama pengguna: ${params.userName}`,
		`Obat/suplemen terdeteksi: ${params.currentMedsContext}`,
		"",
		"ATURAN INTI:",
		"- Jawab dalam Bahasa Indonesia yang jelas dan sopan.",
		"- Jangan menanyakan role pengguna.",
		"- Jika role tidak dikenali, jawab: Sesi tidak valid. Silakan login ulang ke sistem DARSI.",
		"- Prioritaskan data internal RSI/e-Fornas jika tersedia.",
		"- Jika data tidak ditemukan, sampaikan dengan jujur dan arahkan ke sumber yang tepat.",
		"- Jangan mengarang data.",
		"- Jangan memberikan diagnosis baru atau instruksi medis berbahaya.",
		"- Jangan menambahkan pertanyaan lanjutan kecuali pengguna memintanya.",
		"- HARD STOP: Jika detail pasien belum lengkap (usia, gejala, durasi, kondisi), ajukan pertanyaan klarifikasi dan STOP.",
		"- DILARANG memberi contoh obat umum atau rekomendasi saat info belum lengkap.",
		"- Jika detail sudah lengkap, beri diagnosis ringkas dan rekomendasi obat dalam tabel Markdown.",
		"- Jangan mengulang pertanyaan klarifikasi jika detail sudah diberikan.",
		"- Jika user sudah memberikan detail klarifikasi, langsung beri rekomendasi dan jangan tanya ulang.",
		"- Jika pertanyaan di luar domain farmasi, tolak dengan sopan dan arahkan ke layanan yang sesuai.",
		"",
		"ROUTING KONFIRMASI (PENTING):",
		"- Jika user sebelumnya ditawarkan sesuatu dan sekarang merespons dengan 'iya', 'mau', 'lanjut', dll:",
		"  * Identifikasi apa yang sebelumnya ditawarkan dari riwayat percakapan",
		"  * Lanjutkan penawaran tersebut TANPA menanyakan nama obat/penyakit lagi",
		"  * User sedang memberikan persetujuan, bukan pertanyaan baru",
		"- Jangan mengatakan 'Mohon nama obat' jika user baru saja berkata 'iya saya mau' terhadap penawaran Anda.",
		"",
		"GAYA RESPON:",
		"- Apoteker: teknis dan ringkas.",
		"- Pasien: sederhana dan ramah.",
		"- Jangan memaksakan format baku.",
		"",
	];

	if (conversationHistory) {
		sections.push(conversationHistory);
		sections.push("");
	}

	if (isConfirmation && previousOffer) {
		sections.push("KONTEKS PENTING: User sedang merespons KONFIRMASI terhadap penawaran sebelumnya:");
		sections.push(`Penawaran sebelumnya: ${previousOffer.substring(0, 250)}`);
		sections.push(`Respons user: ${params.userInputRaw}`);
		sections.push("");
		sections.push("TINDAKAN: Lanjutkan alur penawaran yang sebelumnya, jangan tanya ulang nama obat/penyakit.");
		sections.push("");
	}

	if (params.isClarificationFollowUp) {
		sections.push("KONTEKS KLARIFIKASI:");
		sections.push("User sudah menjawab detail klarifikasi yang diminta sebelumnya.");
		sections.push("DILARANG mengulang pertanyaan klarifikasi. Langsung beri rekomendasi obat sesuai konteks.");
		sections.push("");
	}

	sections.push(
		"KONTEKS DATA INTERNAL:",
		params.guidelineContext,
		"",
		"PERTANYAAN/RESPONS PENGGUNA SAAT INI:",
		params.userInputRaw,
		"",
		"ASSISTANT:",
		"Jawab tanpa format baku dan tanpa JSON mentah.",
	);

	return sections.join("\n");
}

new VoltAgent({
	agents: { apoteker: darsiAgent },
	server: honoServer({
		port,
		configureApp: async (app) => {
			// Phase 2: Initialize embeddings on startup
			try {
				const embeddingsReady = await ensureEmbeddingsInitialized();
				if (embeddingsReady) {
					logger.info("Embeddings initialized successfully");
				} else {
					logger.warn("Embeddings not available - will use exact matching fallback");
				}
			} catch (error) {
				logger.warn(`Embedding initialization warning: ${error instanceof Error ? error.message : String(error)}`);
			}

			app.use("*", async (c, next) => {
				const origin = c.req.header("origin") || "";

				if (ALLOWED_ORIGINS.includes(origin as (typeof ALLOWED_ORIGINS)[number])) {
					c.header("Access-Control-Allow-Origin", origin);
					c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
					c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
					c.header("Access-Control-Allow-Credentials", "true");
				}

				if (c.req.method === "OPTIONS") {
					return new Response(null, { status: 204 });
				}

				await next();
			});

			app.post("/api/chat", async (c) => {
				try {
					const body = (await c.req.json()) as ChatRequestBody;
					const messages = Array.isArray(body.messages) ? body.messages : [];

					if (messages.length === 0) {
						return c.json({ error: "No messages provided" }, { status: 400 });
					}

					const lastUserMessage = [...messages].reverse().find((msg) => msg.role === "user");
					if (!lastUserMessage) {
						return c.json({ error: "No user message provided" }, { status: 400 });
					}

					const latestUserInputRaw = extractMessageText(lastUserMessage).trim();
					if (!latestUserInputRaw) {
						return createStreamingResponse(createEmptyQueryResponse());
					}

					const clarificationContext = resolveClarificationContext(messages, latestUserInputRaw);
					const userInputRaw = clarificationContext.effectiveUserInput;
					const isClarificationFollowUp = clarificationContext.isFollowUpToClarification;

					const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
					const requestId = typeof body.id === "string" ? body.id : "";
					const threadId =
						(conversationId || requestId).trim() ||
						`thread-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

					const userIdFinal = typeof body.userId === "string" && body.userId.trim() ? body.userId : "anonymous-user";
					const sessionRole = resolveUserRoleFromSession(body);
					if (hasExplicitRoleMetadata(body) && !sessionRole) {
						return createStreamingResponse("Sesi tidak valid. Silakan login ulang ke sistem DARSI.");
					}
					const userRole = sessionRole ?? detectUserRole(latestUserInputRaw, userIdFinal);
					const userName = resolveSessionUserName(body);
					const liveStatusViewerRole = resolveLiveStatusViewerRole(body, userRole);

					try {
						saveConversation(threadId, userIdFinal, messages as any);
					} catch (saveError) {
						logger.warn(`Failed to save conversation: ${String(saveError)}`);
					}

					if (isServiceNavigationRequest(userInputRaw)) {
						const serviceNavigationAnswer = buildServiceNavigationResponse(userInputRaw, userRole, userName);
						return createStreamingResponse(serviceNavigationAnswer);
					}

					pendingConfirmationByThread.delete(threadId);

					const medicineMentions = parseMedicationMentions(userInputRaw);
					const fullMedicineCatalogQuery = isFullMedicineCatalogQuery(userInputRaw);
					const medicineSearchQuery =
						fullMedicineCatalogQuery || medicineMentions.length === 0
							? userInputRaw
							: medicineMentions.join(", ");
					const diagnosisBlocked = isDiagnosisRequest(userInputRaw);
					const chatIntent = detectChatIntent(userInputRaw);
					const operationalStatusQuery = isOperationalStatusQuery(userInputRaw);
					const diseaseMedicationRecommendation = isDiseaseMedicationRecommendationQuery(userInputRaw);
					const medicineDataLookupQuery = isMedicineDataLookupQuery(userInputRaw);
					const fornasLookupQuery = isFornasLookupQuery(userInputRaw);
					const conditionQuery = extractConditionQuery(userInputRaw);
					const fornasToolQuery = buildFornasToolQuery(userInputRaw, medicineMentions);
					const icdDatasetListingQuery = isIcdDatasetListingQuery(userInputRaw);
					const icdToolQuery = icdDatasetListingQuery ? userInputRaw : conditionQuery;
					const icdToolLimit = icdDatasetListingQuery ? 50 : 8;
					const plannedTools = await planToolsWithModel(userInputRaw, medicineMentions);
					const selectedToolNames = Array.from(plannedTools);
					logger.warn(
						`Tool plan selected (${selectedToolNames.length}) [${selectedToolNames.join(", ") || "none"}] for query: ${truncateText(
							userInputRaw,
							140,
						)}`,
					);

					const skippedToolResult: ToolExecutionResult = {
						text: SKIPPED_TOOL_TEXT,
						ok: true,
					};

					const [icdLookup, kronisLookup, recommendLookup, fornasLookup, interactionLookup, liveSystemLookup] = await Promise.all([
						plannedTools.has("search_icd_code")
							? executeToolSafely(
									() =>
										invokeTool(
											searchIcd10Disease as unknown as ExecutableTool,
											{ query: icdToolQuery, limit: icdToolLimit },
											"Tool search_icd_code tidak tersedia.",
										),
									"Gagal mengambil data ICD-10 RSI.",
								)
							: Promise.resolve(skippedToolResult),
						plannedTools.has("search-medicines")
							? executeToolSafely(
									() =>
										invokeTool(
											searchMedicinesEmbedding as unknown as ExecutableTool,
											{ query: medicineSearchQuery },
											"Tool search-medicines tidak tersedia.",
										),
									"Gagal mengambil data obat kronis RSI.",
								)
							: Promise.resolve(skippedToolResult),
							plannedTools.has("recommend-medicines")
								? executeToolSafely(
										() =>
											invokeTool(
												recommendMedicinesEmbedding as unknown as ExecutableTool,
												{ condition: conditionQuery },
												"Tool recommend-medicines tidak tersedia.",
											),
									"Gagal mengambil rekomendasi obat berbasis penyakit.",
								)
								: Promise.resolve(skippedToolResult),
						plannedTools.has("search-efornas")
							? executeToolSafely(
									() =>
										invokeTool(
											searchEfornasObat as unknown as ExecutableTool,
											{ query: fornasToolQuery },
											"Tool search-efornas tidak tersedia.",
										),
									"Gagal mengambil data e-Fornas.",
								)
							: Promise.resolve(skippedToolResult),
						plannedTools.has("check_medication_interaction")
							? executeToolSafely(
									() =>
										invokeTool(
											checkMedicationInteraction as unknown as ExecutableTool,
											{ query: userInputRaw, medicines: medicineMentions },
											"Tool check_medication_interaction tidak tersedia.",
										),
									"Gagal melakukan skrining interaksi obat.",
								)
							: Promise.resolve(skippedToolResult),
							plannedTools.has("get-live-system-status")
								? executeToolSafely(
										() =>
											invokeTool(
												getLiveSystemStatus as unknown as ExecutableTool,
												{
													query: userInputRaw,
													focus: "auto",
													viewerRole: liveStatusViewerRole,
												},
												"Tool get-live-system-status tidak tersedia.",
											),
									"Gagal mengambil status live sistem apotek.",
								)
								: Promise.resolve(skippedToolResult),
					]);

					const icdResult = sanitizeToolResultText(icdLookup.text, "ICD-10 RSI");
					const kronisResult = sanitizeToolResultText(kronisLookup.text, "Obat Kronis RSI");
					const recommendResult = sanitizeToolResultText(recommendLookup.text, "Rekomendasi Penyakit RSI");
					const fornasResult = sanitizeToolResultText(fornasLookup.text, "e-Fornas");
					const interactionResult = sanitizeToolResultText(interactionLookup.text, "Skrining Interaksi Obat");
					const liveSystemResult = sanitizeToolResultText(liveSystemLookup.text, "Status Sistem Operasional");

					const medsForContext = Array.from(
						new Set([...medicineMentions, ...parseDetectedMedicinesFromInteraction(interactionResult)]),
					);
					const currentMedsContext = medsForContext.length > 0 ? medsForContext.join(", ") : "informasi belum cukup";
					const selectedToolLabels = TOOL_EXECUTION_MAP.filter((item) => plannedTools.has(item.name))
						.map((item) => item.label)
						.join(", ");
					logger.warn(`Tool execution labels: ${selectedToolLabels || "none"}`);

					const guidelineContext = [
						`TOOL DIPANGGIL OLEH LLM-PLANNER: ${selectedToolLabels || "informasi belum cukup"}`,
						`STATUS SISTEM OPERASIONAL LIVE:\n${truncateText(liveSystemResult, 1500)}`,
						`ICD-10 RSI:\n${truncateText(icdResult, 1200)}`,
						`OBAT KRONIS RSI:\n${truncateText(kronisResult, 1200)}`,
						`REKOMENDASI BERDASARKAN PENYAKIT:\n${truncateText(recommendResult, 1200)}`,
						`e-FORNAS:\n${truncateText(fornasResult, 1200)}`,
						`INTERAKSI:\n${truncateText(interactionResult, 1200)}`,
					].join("\n\n");

					const fallbackChunks = [
						operationalStatusQuery ? liveSystemResult : "",
						icdDatasetListingQuery ? icdResult : "",
						fullMedicineCatalogQuery ? kronisResult : "",
						recommendResult,
						fornasLookupQuery ? fornasResult : "",
						kronisResult,
						interactionResult,
					].filter((chunk) => hasUsableData(chunk));

					const fallbackAnswer =
						fallbackChunks.length > 0
							? fallbackChunks.join("\n\n")
							: "Model belum merespons. Periksa status Ollama dan model yang aktif.";

					const llmPrompt = buildLLMPrompt({
						userInputRaw,
						currentMedsContext,
						guidelineContext,
						userRole,
						userName,
						messages: Array.isArray(messages) ? messages : [],
						isClarificationFollowUp,
					});

					let finalAnswer = "";

					try {
						const cleanedModelText = stripCodeFence(await streamAgentText(llmPrompt)).trim();
						if (!cleanedModelText) {
							logger.warn("LLM returned empty content; using fallback response.");
						} else if (isAcceptableAssistantAnswer(cleanedModelText)) {
							finalAnswer = cleanedModelText;
						}
					} catch (modelError) {
						logger.warn(`Model response build failed: ${String(modelError)}`);
					}

					if (!finalAnswer) {
						finalAnswer = fallbackAnswer;
					}

					if (isClarificationFollowUp && CLARIFICATION_LOOP_PATTERN.test(finalAnswer)) {
						logger.warn("LLM repeated clarification after follow-up; using tool-based fallback response.");
						finalAnswer = fallbackAnswer;
					}

					const isClinicalIntent =
						chatIntent === "validasi_resep" ||
						chatIntent === "cek_interaksi" ||
						diseaseMedicationRecommendation;
					const shouldPreferToolData =
						!isClinicalIntent &&
						!operationalStatusQuery &&
						(fullMedicineCatalogQuery ||
							fornasLookupQuery ||
							medicineDataLookupQuery ||
							chatIntent === "informasi_obat" ||
							medicineMentions.length > 0);
					const kronisHasTable = hasMarkdownTable(kronisResult);
					const fornasHasTable = hasMarkdownTable(fornasResult);

					if (shouldPreferToolData && (kronisHasTable || fornasHasTable)) {
						const sections: string[] = [];
						if (kronisHasTable) {
							sections.push(kronisResult);
						}
						if (fornasLookupQuery && fornasHasTable) {
							sections.push(fornasResult);
						}
						if (sections.length > 0) {
							finalAnswer = sections.join("\n\n");
						}
					}

					if (fullMedicineCatalogQuery) {
						const tableHeaderPattern = /\|\s*No\s*\|\s*Nama\s+Obat\s*\|/i;
						const kronisHasTable = tableHeaderPattern.test(kronisResult);
						const fornasHasTable = tableHeaderPattern.test(fornasResult);
						if (kronisHasTable || fornasHasTable) {
							finalAnswer = buildFullMedicineCatalogResponse({
								kronisResult: kronisHasTable ? kronisResult : "",
								fornasResult: fornasLookupQuery && fornasHasTable ? fornasResult : "",
							});
						}
					}

					return createStreamingResponse(finalAnswer);
				} catch (error) {
					logger.error(`Chat API error: ${String(error)}`);
					return c.json({ error: "Internal server error" }, { status: 500 });
				}
			});

			app.get("/health", (c) => {
				return c.json({
					status: "ok",
					agent: "DARSI Apoteker Screening",
				});
			});

			app.get("/health/live-system", async (c) => {
				try {
					const health = await getLiveSystemHealthSummary();
					const statusCode = health.ok ? 200 : 503;

					return c.json(
						{
							status: health.ok ? "ok" : "degraded",
							service: "live-system-tool",
							...health,
						},
						{ status: statusCode },
					);
				} catch (error) {
					logger.error(`Live system health error: ${String(error)}`);
					return c.json(
						{
							status: "error",
							service: "live-system-tool",
							error: "Failed to run live system health check",
						},
						{ status: 500 },
					);
				}
			});

			app.get("/health/embeddings", async (c) => {
				try {
					const health = await getEmbeddingHealthReport();
					const statusCode = health.status === "healthy" ? 200 : health.status === "stale" ? 503 : 503;

					return c.json(
						{
							status: health.status,
							message: health.message,
							isFresh: health.isFresh,
							lastInitializedAt: health.lastInitializedAt,
							staleDays: health.staleDays,
						},
						{ status: statusCode },
					);
				} catch (error) {
					logger.error(`Embedding health error: ${String(error)}`);
					return c.json(
						{
							status: "error",
							message: "Failed to check embedding health",
							error: error instanceof Error ? error.message : String(error),
						},
						{ status: 500 },
					);
				}
			});

			app.get("/health/embeddings/detailed", async (c) => {
				try {
					const status = await getDetailedEmbeddingStatus();
					return c.json({
						status: "ok",
						efornas: {
							available: status.efornas.available,
							recordCount: status.efornas.recordCount,
							error: status.efornas.error,
						},
						kronis: {
							available: status.kronis.available,
							recordCount: status.kronis.recordCount,
							error: status.kronis.error,
						},
						metadata: status.metadata,
					});
				} catch (error) {
					logger.error(`Detailed embedding status error: ${String(error)}`);
					return c.json(
						{
							status: "error",
							error: error instanceof Error ? error.message : String(error),
						},
						{ status: 500 },
					);
				}
			});

			app.get("/api/data-sources/status", (c) => {
				try {
					return c.json({
						success: true,
						timestamp: new Date().toISOString(),
						dataSources: getDataSourceRegistry(),
					});
				} catch (error) {
					logger.error(`Data source status error: ${String(error)}`);
					return c.json(
						{
							error: "Failed to fetch data source status",
							success: false,
						},
						{ status: 500 },
					);
				}
			});

			app.get("/api/conversations/:conversationId", async (c) => {
				try {
					const conversationId = c.req.param("conversationId");
					const userId = c.req.query("userId") || "anonymous-user";
					const conversation = loadConversation(conversationId);

					if (!conversation) {
						return c.json({
							success: true,
							conversationId,
							userId,
							messages: [],
							message: "Conversation not found or empty",
						});
					}

					if (conversation.userId !== userId) {
						return c.json(
							{
								error: "Unauthorized",
								success: false,
							},
							{ status: 403 },
						);
					}

					return c.json({
						success: true,
						conversationId,
						userId,
						messages: conversation.messages,
						messageCount: conversation.messages.length,
						createdAt: conversation.createdAt,
						updatedAt: conversation.updatedAt,
					});
				} catch (error) {
					logger.error(`Conversation history error: ${String(error)}`);
					return c.json(
						{
							error: "Failed to fetch conversation",
							success: false,
						},
						{ status: 500 },
					);
				}
			});

			app.get("/api/user/:userId/conversations", async (c) => {
				try {
					const userId = c.req.param("userId");
					const conversations = getUserConversations(userId);

					return c.json({
						success: true,
						userId,
						conversations: conversations.map((conversation) => ({
							id: conversation.id,
							createdAt: conversation.createdAt,
							updatedAt: conversation.updatedAt,
							messageCount: conversation.messages.length,
							lastMessage:
								conversation.messages.length > 0
									? JSON.stringify(conversation.messages[conversation.messages.length - 1]).slice(0, 70)
									: "",
						})),
						total: conversations.length,
					});
				} catch (error) {
					logger.error(`Get user conversations error: ${String(error)}`);
					return c.json(
						{
							error: "Failed to fetch conversations",
							success: false,
						},
						{ status: 500 },
					);
				}
			});

			app.delete("/api/conversations/:conversationId", async (c) => {
				try {
					const conversationId = c.req.param("conversationId");
					const userId = c.req.query("userId") || "anonymous-user";
					const conversation = loadConversation(conversationId);

					if (!conversation) {
						return c.json(
							{
								error: "Conversation not found",
								success: false,
							},
							{ status: 404 },
						);
					}

					if (conversation.userId !== userId) {
						return c.json(
							{
								error: "Unauthorized",
								success: false,
							},
							{ status: 403 },
						);
					}

					deleteConversation(conversationId);

					return c.json({
						success: true,
						message: "Conversation deleted",
					});
				} catch (error) {
					logger.error(`Delete conversation error: ${String(error)}`);
					return c.json(
						{
							error: "Failed to delete conversation",
							success: false,
						},
						{ status: 500 },
					);
				}
			});

			app.get("/api/memory/stats", async (c) => {
				try {
					const stats = await getMemoryStats(memory);
					return c.json({
						success: true,
						stats,
					});
				} catch (error) {
					logger.error(`Memory stats error: ${String(error)}`);
					return c.json(
						{
							error: "Failed to fetch memory stats",
							success: false,
						},
						{ status: 500 },
					);
				}
			});
		},
	}),
	logger,
});

logger.info(`DARSI Apoteker Screening running at http://localhost:${port}`);
logger.info(`Chat API endpoint: http://localhost:${port}/api/chat`);
logger.info(`Conversation API: http://localhost:${port}/api/conversations/:conversationId`);
logger.info(`Memory stats API: http://localhost:${port}/api/memory/stats`);
