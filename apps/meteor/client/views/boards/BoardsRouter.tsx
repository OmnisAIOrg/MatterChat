import type { ReactNode } from 'react';
import { Suspense } from 'react';

import BoardsLayout from './BoardsLayout';
import PageSkeleton from '../../components/PageSkeleton';

type BoardsRouterProps = {
	children?: ReactNode;
};

const BoardsRouter = ({ children }: BoardsRouterProps) => {
	return <BoardsLayout>{children ? <Suspense fallback={<PageSkeleton />}>{children}</Suspense> : <PageSkeleton />}</BoardsLayout>;
};

export default BoardsRouter;
