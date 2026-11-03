import { t } from "@lingui/core/macro";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { toastError } from "@/libs/error-message";
import { client } from "@/libs/orpc/client";

type RemovalScope = {
	key: string;
	accountId: string | null;
	generation: number;
};

/** Keep an unsent file available for retry until its owner confirms deletion. */
export function useAttachmentRemoval(key: string, onRemoved: (id: string) => void) {
	const accountId = getAccountId();
	const generation = getAccountGeneration();
	const owner = useMemo<RemovalScope>(() => ({ key, accountId, generation }), [key, accountId, generation]);
	const active = useRef<{ owner: RemovalScope; busy: boolean } | null>(null);
	const [pending, setPending] = useState<RemovalScope | null>(null);
	useLayoutEffect(() => {
		active.current = { owner, busy: false };
		return () => {
			active.current = null;
		};
	}, [owner]);

	const current = () =>
		active.current?.owner === owner &&
		getAccountId() === owner.accountId &&
		getAccountGeneration() === owner.generation;

	const remove = async (id: string) => {
		const scope = active.current;
		if (!owner.accountId || !scope || scope.busy || !current()) return;
		scope.busy = true;
		setPending(owner);
		try {
			await client.agent.attachments.delete({ id }, { context: { accountId: owner.accountId } });
			if (current()) onRemoved(id);
		} catch (error) {
			if (current()) toastError(error, t`Couldn't save that change. Try again.`);
		} finally {
			scope.busy = false;
			if (current()) setPending(null);
		}
	};

	return { remove, isPending: pending === owner };
}
