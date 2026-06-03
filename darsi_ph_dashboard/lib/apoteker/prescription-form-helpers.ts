import type { DemoStockItem } from "@/lib/demo/types";

export const QUICK_DOSAGE_CHIPS = [
	"3 x 1 Sesudah Makan",
	"2 x 1 Sesudah Makan",
	"1 x 1 Sebelum Makan",
	"1 x 1 Sesudah Makan",
	"1 x 1 Pagi Hari",
	"1 x 1 Malam Hari",
] as const;

export interface MedicineSuggestion {
	id: string;
	nomorObat: string;
	nama: string;
	stok: number;
	satuan: string;
	status: DemoStockItem["status"];
}

export function normalizeFieldSearch(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function filterDosageSuggestions(query: string): string[] {
	const normalized = normalizeFieldSearch(query);
	if (!normalized) {
		return [...QUICK_DOSAGE_CHIPS].slice(0, 4);
	}

	const matched = QUICK_DOSAGE_CHIPS.filter((dosage) =>
		normalizeFieldSearch(dosage).includes(normalized),
	);

	if (matched.length > 0) {
		return [...matched].slice(0, 6);
	}

	return QUICK_DOSAGE_CHIPS.filter((dosage) =>
		normalized
			.split(" ")
			.every((token) => normalizeFieldSearch(dosage).includes(token)),
	).slice(0, 4);
}

export function inferDefaultDosage(medicineName: string): string {
	const normalized = normalizeFieldSearch(medicineName);

	if (
		normalized.includes("antibiot") ||
		normalized.includes("amoxic") ||
		normalized.includes("cef")
	) {
		return "3 x 1 Sesudah Makan";
	}

	if (
		normalized.includes("metformin") ||
		normalized.includes("amlodip") ||
		normalized.includes("lisinopril")
	) {
		return "1 x 1 Sesudah Makan";
	}

	if (normalized.includes("paracetamol") || normalized.includes("ibuprofen")) {
		return "3 x 1 Sesudah Makan";
	}

	return QUICK_DOSAGE_CHIPS[0];
}

export function mapStockItemToMedicineSuggestion(
	item: DemoStockItem,
): MedicineSuggestion {
	return {
		id: item.id,
		nomorObat: item.nomorObat ?? item.id,
		nama: item.nama,
		stok: item.stok,
		satuan: item.satuan,
		status: item.status,
	};
}

export function stockStatusLabel(status: DemoStockItem["status"]): string {
	switch (status) {
		case "kritis":
			return "Stok kritis";
		case "menipis":
			return "Stok menipis";
		default:
			return "Stok aman";
	}
}

const stockStatusRank: Record<DemoStockItem["status"], number> = {
	aman: 0,
	menipis: 1,
	kritis: 2,
};

/** Satu baris per nomor obat; jika nama sama, ambil yang stoknya lebih besar. */
export function dedupeMedicineSuggestions(
	suggestions: MedicineSuggestion[],
): MedicineSuggestion[] {
	const byNomorObat = new Map<string, MedicineSuggestion>();

	for (const suggestion of suggestions) {
		const key = suggestion.nomorObat.trim().toUpperCase();
		if (!key) {
			continue;
		}

		const existing = byNomorObat.get(key);
		if (!existing || suggestion.stok > existing.stok) {
			byNomorObat.set(key, suggestion);
		}
	}

	return [...byNomorObat.values()].sort((first, second) => {
		const statusDiff =
			stockStatusRank[first.status] - stockStatusRank[second.status];
		if (statusDiff !== 0) {
			return statusDiff;
		}

		return first.nama.localeCompare(second.nama, "id", { sensitivity: "base" });
	});
}

/** Cocokkan nama yang diketik ke entri stok (exact / awalan unik). */
export function findBestMedicineMatch(
	query: string,
	suggestions: MedicineSuggestion[],
): MedicineSuggestion | null {
	const normalizedQuery = normalizeFieldSearch(query);
	if (!normalizedQuery || suggestions.length === 0) {
		return null;
	}

	const deduped = dedupeMedicineSuggestions(suggestions);

	const exactMatches = deduped.filter(
		(item) => normalizeFieldSearch(item.nama) === normalizedQuery,
	);
	if (exactMatches.length === 1) {
		return exactMatches[0];
	}
	if (exactMatches.length > 1) {
		return exactMatches.sort((a, b) => b.stok - a.stok)[0];
	}

	const prefixMatches = deduped.filter((item) =>
		normalizeFieldSearch(item.nama).startsWith(normalizedQuery),
	);
	if (prefixMatches.length === 1) {
		return prefixMatches[0];
	}

	return null;
}
