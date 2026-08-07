import { Box, Button, ButtonGroup, Callout, Divider, Icon, Throbber } from '@rocket.chat/fuselage';
import { useEndpoint, usePermission, useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useMutation } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * AiAssistSection — the M8 "AI" controls on a matter card (MatterPanel).
 *
 * Two buttons, gated by `boards-ai-generate`:
 *  - "AI summary"     → POST /v1/boards.ai.summarizeMatter (Claude over a fresh snapshot, falling back to cached on CasePro failure)
 *  - "AI draft demand"→ POST /v1/boards.ai.draftDemand     (Stowers demand via LitDraft)
 *
 * The provider seam NEVER throws: a 200 carries `{ generated, text, provider, note }`.
 * When `generated:false` (no API key / SMTP-less / provider 'none' / transport
 * error) we render the `note` as a neutral "AI not configured / unavailable"
 * state rather than an error toast — matching the graceful-degrade contract. A
 * successful result renders in a read-only panel with a Copy action; nothing is
 * persisted to the card from here (the automation action handles write-back).
 *
 * If the user lacks `boards-ai-generate`, the whole section is hidden.
 */

type AiResult = {
	generated: boolean;
	text: string;
	provider: 'claude' | 'litdraft' | 'none';
	note?: string;
};

type AiTask = 'summary' | 'demand';

type AiAssistSectionProps = {
	cardId: string;
};

const providerLabel: Record<AiResult['provider'], string> = {
	claude: 'Claude',
	litdraft: 'LitDraft',
	none: 'AI',
};

const AiAssistSection = ({ cardId }: AiAssistSectionProps): ReactElement | null => {
	const { t } = useTranslation();
	const dispatchToastMessage = useToastMessageDispatch();
	const canGenerate = usePermission('boards-ai-generate');

	const summarizeMatter = useEndpoint('POST', '/v1/boards.ai.summarizeMatter');
	const draftDemand = useEndpoint('POST', '/v1/boards.ai.draftDemand');

	const [result, setResult] = useState<AiResult | undefined>(undefined);
	const [activeTask, setActiveTask] = useState<AiTask | undefined>(undefined);

	const generateMutation = useMutation({
		mutationFn: async (task: AiTask): Promise<AiResult> => {
			const response = task === 'summary' ? await summarizeMatter({ cardId }) : await draftDemand({ cardId });
			return response.result as AiResult;
		},
		onMutate: (task: AiTask) => {
			setActiveTask(task);
			setResult(undefined);
		},
		onSuccess: (res) => {
			setResult(res);
			// a degraded result (generated:false) is NOT an error — it's surfaced inline.
		},
		onError: (error) => {
			// transport-level failure (the provider seam shouldn't throw, but the
			// endpoint itself could 401/500) — toast it and clear the busy state.
			dispatchToastMessage({ type: 'error', message: error });
			setResult(undefined);
		},
	});

	const copyResult = (): void => {
		if (!result?.text) {
			return;
		}
		try {
			void navigator.clipboard?.writeText(result.text);
			dispatchToastMessage({ type: 'success', message: t('Copied', { defaultValue: 'Copied' }) });
		} catch {
			/* clipboard unavailable — no-op */
		}
	};

	if (!canGenerate) {
		return null;
	}

	const pending = generateMutation.isPending;

	return (
		<Box marginBlockStart={16}>
			<Divider />
			<Box display='flex' alignItems='center' marginBlockStart={12} marginBlockEnd={8}>
				<Icon name='ai' size='x20' marginInlineEnd={8} color='hint' />
				<Box fontScale='h4' color='default'>
					{t('Boards_AI_Assist', { defaultValue: 'AI assist' })}
				</Box>
			</Box>

			<Box marginBlockEnd={8}>
				<ButtonGroup stretch>
					<Button small disabled={pending} onClick={() => generateMutation.mutate('summary')}>
						{pending && activeTask === 'summary' ? (
							<Throbber inheritColor size='x12' marginInlineEnd={4} />
						) : (
							<Icon name='ai' size='x14' marginInlineEnd={4} />
						)}
						{t('Boards_AI_Summarize', { defaultValue: 'AI summary' })}
					</Button>
					<Button small disabled={pending} onClick={() => generateMutation.mutate('demand')}>
						{pending && activeTask === 'demand' ? (
							<Throbber inheritColor size='x12' marginInlineEnd={4} />
						) : (
							<Icon name='file-document' size='x14' marginInlineEnd={4} />
						)}
						{t('Boards_AI_DraftDemand', { defaultValue: 'AI draft demand' })}
					</Button>
				</ButtonGroup>
			</Box>

			{pending && (
				<Box display='flex' alignItems='center' fontScale='c1' color='hint' marginBlockEnd={8}>
					<Throbber size='x12' marginInlineEnd={8} />
					{t('Boards_AI_Working', { defaultValue: 'Generating…' })}
				</Box>
			)}

			{!pending && result && !result.generated && (
				<Callout type='warning' icon='info' title={t('Boards_AI_NotConfigured', { defaultValue: 'AI not available' })}>
					{result.note || t('Boards_AI_NotConfigured_Body', { defaultValue: 'AI generation is not configured for this workspace.' })}
				</Callout>
			)}

			{!pending && result && result.generated && (
				<Box>
					<Box display='flex' alignItems='center' justifyContent='space-between' marginBlockEnd={4}>
						<Box fontScale='micro' color='hint'>
							<Icon name='ai' size='x12' marginInlineEnd={2} />
							{t('Boards_AI_GeneratedBy', { provider: providerLabel[result.provider], defaultValue: 'Generated by {{provider}}' })}
						</Box>
						<Button tiny title={t('Copy', { defaultValue: 'Copy' })} onClick={copyResult}>
							<Icon name='copy' size='x14' marginInlineEnd={2} />
							{t('Copy', { defaultValue: 'Copy' })}
						</Button>
					</Box>
					<Box
						padding={12}
						backgroundColor='tint'
						borderRadius='x4'
						fontScale='p2'
						color='default'
						style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflowY: 'auto' }}
					>
						{result.text}
					</Box>
					<Box fontScale='micro' color='hint' marginBlockStart={4}>
						{t('Boards_AI_DraftNote', { defaultValue: 'Draft for review — not saved to the card. Copy into a document to use.' })}
					</Box>
				</Box>
			)}
		</Box>
	);
};

export default AiAssistSection;
