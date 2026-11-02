import { getAccountScope, useSession } from "@/auth/session";
import { ApplicationTrashScreen } from "@/features/applications/trash-screen";

export default function TrashScreen() {
	const session = useSession();
	return <ApplicationTrashScreen key={`${session.server}:${session.status}:${getAccountScope()}`} />;
}
