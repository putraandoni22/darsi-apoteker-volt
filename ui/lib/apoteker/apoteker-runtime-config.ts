function readEnvFlag(name: string, defaultValue: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
		return true;
	}
	if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
		return false;
	}
	return defaultValue;
}

/** Poll antrean/stok/transaksi otomatis (default: mati). Set `NEXT_PUBLIC_DARSI_APOTEKER_AUTO_REFRESH=true` untuk mengaktifkan. */
export function isApotekerAutoRefreshEnabled(): boolean {
	return readEnvFlag("NEXT_PUBLIC_DARSI_APOTEKER_AUTO_REFRESH", false);
}

export const APOTEKER_AUTO_REFRESH_INTERVAL_MS = 30_000;
export const APOTEKER_OVERVIEW_AUTO_REFRESH_INTERVAL_MS = 20_000;
export const APOTEKER_PANEL_AUTO_REFRESH_INTERVAL_MS = 15_000;

export function resolveApotekerPanelAutoRefreshMs(): number | undefined {
	return isApotekerAutoRefreshEnabled()
		? APOTEKER_PANEL_AUTO_REFRESH_INTERVAL_MS
		: undefined;
}

/** Reset data dispensing via API DELETE (default: mati). Set `DARSI_APOTEKER_ALLOW_DATA_RESET=true` untuk mengaktifkan. */
export function isApotekerDispensingDataResetEnabled(): boolean {
	return readEnvFlag("DARSI_APOTEKER_ALLOW_DATA_RESET", false);
}

/** Migrasi DB yang merapikan katalog otomatis (default: mati). Set `DARSI_APOTEKER_AUTO_STORE_CLEANUP=true` untuk mengaktifkan. */
export function isApotekerAutoStoreCleanupEnabled(): boolean {
	return readEnvFlag("DARSI_APOTEKER_AUTO_STORE_CLEANUP", false);
}
