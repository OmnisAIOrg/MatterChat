import type { ReactNode } from 'react';
import { Suspense, lazy } from 'react';

import BoardsLayout from './BoardsLayout';
import PageSkeleton from '../../components/PageSkeleton';

// The /boards index child. Rendered here (not via a second route registration)
// because the router keeps BOTH routes when the same path is defined twice —
// routes live in a Set and the FIRST match wins — so the old
// `registerBoardsRoute('', { component: BoardsHome })` re-registration was
// unreachable and /boards rendered the bare group wrapper's PageSkeleton
// forever (P0: Boards tab dead on prod).
const BoardsHome = lazy(() => import('./BoardsHome'));

type BoardsRouterProps = {
	children?: ReactNode;
};

const BoardsRouter = ({ children }: BoardsRouterProps) => {
	return <BoardsLayout>{<Suspense fallback={<PageSkeleton />}>{children ?? <BoardsHome />}</Suspense>}</BoardsLayout>;
};

export default BoardsRouter;
