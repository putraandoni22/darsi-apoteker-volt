"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const onLogout = async () => {
		setLoading(true);

		try {
			await fetch("/api/auth/logout", { method: "POST" });
		} finally {
			router.push("/");
			router.refresh();
			setLoading(false);
		}
	};

	return (
		<Button variant="outline" size="sm" onClick={onLogout} disabled={loading}>
			{loading ? "Keluar..." : "Logout"}
		</Button>
	);
}
