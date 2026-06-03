import { type NextRequest, NextResponse } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { listPublicUsers } from "@/lib/auth/store";
import { listPatientRecords } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

function normalizeSearchText(value: string): string {
	return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function GET(request: NextRequest) {
	const user = await getApiAuthenticatedUser(request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (user.role !== "admin" && user.role !== "apoteker") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
	const normalizedQuery = normalizeSearchText(query);

	const [users, patientRecords] = await Promise.all([
		listPublicUsers(),
		listPatientRecords(),
	]);

	const nomorRmByUserId = new Map<string, string>();
	for (const patient of patientRecords) {
		if (!patient.userId || nomorRmByUserId.has(patient.userId)) {
			continue;
		}

		nomorRmByUserId.set(patient.userId, patient.nomorRM);
	}

	const patients = users
		.filter((candidate) => candidate.role === "pasien")
		.map((candidate) => {
			const nomorRM = nomorRmByUserId.get(candidate.id) ?? candidate.nomorRM;
			return {
				userId: candidate.id,
				name: candidate.name,
				email: candidate.email,
				nomorRM,
			};
		})
		.filter((candidate) => {
			if (!normalizedQuery) {
				return true;
			}

			const searchable = normalizeSearchText(
				`${candidate.name} ${candidate.email} ${candidate.nomorRM ?? ""}`,
			);
			return searchable.includes(normalizedQuery);
		})
		.sort((first, second) =>
			first.name.localeCompare(second.name, "id", { sensitivity: "base" }),
		);

	return NextResponse.json({
		patients,
		filters: {
			q: query,
		},
	});
}
