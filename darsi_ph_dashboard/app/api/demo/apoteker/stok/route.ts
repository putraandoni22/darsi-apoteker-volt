import { type NextRequest, NextResponse } from "next/server";
import { getApiAuthenticatedUser } from "@/lib/auth/guards";
import { buildStockSummary, listStockItems } from "@/lib/demo/store";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function parseExpiryDate(value: string): Date | null {
	const normalized = value.trim();
	if (!normalized || normalized.toUpperCase() === "N/A") {
		return null;
	}

	const parsed = new Date(normalized);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}

	return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function buildExpirySummary(items: Array<{ expiredAt: string }>): {
	totalWithDate: number;
	h90Count: number;
	expiredCount: number;
} {
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

	return items.reduce(
		(accumulator, item) => {
			const expiryDate = parseExpiryDate(item.expiredAt);
			if (!expiryDate) {
				return accumulator;
			}

			accumulator.totalWithDate += 1;
			const dayDiff = Math.floor(
				(expiryDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
			);

			if (dayDiff < 0) {
				accumulator.expiredCount += 1;
			} else if (dayDiff <= 90) {
				accumulator.h90Count += 1;
			}

			return accumulator;
		},
		{
			totalWithDate: 0,
			h90Count: 0,
			expiredCount: 0,
		},
	);
}

function parsePositiveInteger(value: string | null, fallback: number): number {
	if (!value) {
		return fallback;
	}

	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}

	return parsed;
}

export async function GET(request: NextRequest) {
	const user = await getApiAuthenticatedUser(request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	if (user.role !== "admin" && user.role !== "apoteker") {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const nomorObatQuery =
		request.nextUrl.searchParams.get("nomorObat")?.trim() ?? "";
	const includeCatalogRaw =
		request.nextUrl.searchParams.get("includeCatalog")?.trim().toLowerCase() ??
		"";
	const includeCatalog =
		includeCatalogRaw === "1" ||
		includeCatalogRaw === "true" ||
		includeCatalogRaw === "yes";

	const pageRaw = request.nextUrl.searchParams.get("page");
	const pageSizeRaw = request.nextUrl.searchParams.get("pageSize");
	const shouldPaginate = pageRaw !== null || pageSizeRaw !== null;

	const items = await listStockItems({
		nomorObatQuery,
		includeCatalog,
	});
	const summary = buildStockSummary(items);
	const expirySummary = buildExpirySummary(items);

	let pagedItems = items;
	let pagination:
		| {
				page: number;
				pageSize: number;
				totalItems: number;
				totalPages: number;
				hasPreviousPage: boolean;
				hasNextPage: boolean;
		  }
		| undefined;

	if (shouldPaginate) {
		const page = parsePositiveInteger(pageRaw, DEFAULT_PAGE);
		const pageSize = Math.min(
			parsePositiveInteger(pageSizeRaw, DEFAULT_PAGE_SIZE),
			MAX_PAGE_SIZE,
		);

		const totalItems = items.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
		const currentPage = Math.min(page, totalPages);
		const startIndex = (currentPage - 1) * pageSize;
		pagedItems = items.slice(startIndex, startIndex + pageSize);

		pagination = {
			page: currentPage,
			pageSize,
			totalItems,
			totalPages,
			hasPreviousPage: currentPage > 1,
			hasNextPage: currentPage < totalPages,
		};
	}

	return NextResponse.json({
		summary,
		expirySummary,
		items: pagedItems,
		filters: {
			nomorObat: nomorObatQuery,
			includeCatalog,
		},
		pagination,
	}, {
		headers: {
			"Cache-Control": "no-store, no-cache, must-revalidate",
		},
	});
}
