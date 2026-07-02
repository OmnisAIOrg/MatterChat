import { Box, Button, TextInput, Throbber, Icon, Badge, Callout, Divider } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';

import { useCrossFirmFetch } from './useCrossFirmFetch';

/**
 * Cross-firm / opposing-counsel conversation, scoped to ONE channel (the matter's room) and rendered
 * as a contextual panel on that channel. Keyed by the CHANNEL rid — works with NO CasePro and NO Omnis
 * suite (each firm links the shared cross-firm room to its OWN local channel). CasePro/OmnisAI are
 * additive: without OmnisAI the identity falls back to the MatterChat user id; without CasePro the
 * matter is simply the channel. Talks to the external Cross-Firm Correspondence Service (CFCS).
 */
const CrossFirmSection = ({ rid }: { rid: string }) => {
	const dispatchToast = useToastMessageDispatch();
	const qc = useQueryClient();
	const { request, cfEnabled, firmName, userKey, displayName } = useCrossFirmFetch();

	const [draft, setDraft] = useState('');
	const [newRepresents, setNewRepresents] = useState('');
	const [dirQuery, setDirQuery] = useState('');
	const [inviteRepresents, setInviteRepresents] = useState('');

	const me = useQuery({
		queryKey: ['cf', 'whoami', userKey, firmName],
		queryFn: () => request('/whoami', { method: 'POST', body: { userKey, name: displayName, firmName: firmName || 'My Firm' } }),
		enabled: Boolean(cfEnabled && userKey),
	});
	const attorneyId: string | undefined = me.data?.attorney?.id;
	const firmId: string | undefined = me.data?.firm?.id;

	const rooms = useQuery({
		queryKey: ['cf', 'rooms', attorneyId],
		queryFn: () => request(`/matter-rooms?attorneyId=${attorneyId}`),
		enabled: Boolean(attorneyId),
		refetchInterval: 5000,
	});
	const all: any[] = rooms.data?.rooms || [];
	// The room linked to THIS channel (CasePro-free: matched by my local channel ref, not a CasePro id).
	const room = useMemo(() => all.find((r) => r.myMatterRef === rid) || null, [all, rid]);
	// Invitations I have not yet attached to any channel — offer to attach to THIS matter.
	const pending = useMemo(() => all.filter((r) => r.myState === 'invited' && !r.myMatterRef), [all]);
	const myState = room?.myState;

	const messages = useQuery({
		queryKey: ['cf', 'messages', room?.id, attorneyId],
		queryFn: () => request(`/matter-rooms/${room.id}/messages?attorneyId=${attorneyId}`),
		enabled: Boolean(room?.id && attorneyId && myState === 'active'),
		refetchInterval: 4000,
	});
	const directory = useQuery({
		queryKey: ['cf', 'directory', dirQuery],
		queryFn: () => request(`/directory?q=${encodeURIComponent(dirQuery)}`),
		enabled: Boolean(attorneyId && dirQuery.length >= 1),
	});

	const refreshRooms = () => qc.invalidateQueries({ queryKey: ['cf', 'rooms', attorneyId] });
	const refreshMessages = () => qc.invalidateQueries({ queryKey: ['cf', 'messages', room?.id, attorneyId] });
	const onErr = (e: unknown) => dispatchToast({ type: 'error', message: (e as Error)?.message || 'Cross-firm error' });

	// Open a NEW conversation for this matter, linked to this channel (matterRef = rid).
	const createRoom = useMutation({
		mutationFn: () => request('/matter-rooms', { method: 'POST', body: { title: `Opposing counsel — ${rid}`, originatingAttorneyId: attorneyId, representsParty: newRepresents, matterRef: rid } }),
		onSuccess: () => { setNewRepresents(''); refreshRooms(); dispatchToast({ type: 'success', message: 'Opposing-counsel conversation opened on this matter' }); },
		onError: onErr,
	});
	// Accept an invitation AND attach it to this channel (matterRef = rid).
	const acceptInvite = useMutation({
		mutationFn: (roomId: string) => request(`/matter-rooms/${roomId}/accept`, { method: 'POST', body: { attorneyId, matterRef: rid } }),
		onSuccess: () => { refreshRooms(); dispatchToast({ type: 'success', message: 'Invitation accepted on this matter — consent recorded' }); },
		onError: onErr,
	});
	const send = useMutation({
		mutationFn: () => request(`/matter-rooms/${room.id}/messages`, { method: 'POST', body: { senderAttorneyId: attorneyId, text: draft } }),
		onSuccess: () => { setDraft(''); refreshMessages(); },
		onError: onErr,
	});
	const invite = useMutation({
		mutationFn: (inviteeAttorneyId: string) => request(`/matter-rooms/${room.id}/invite`, { method: 'POST', body: { inviterAttorneyId: attorneyId, inviteeAttorneyId, representsParty: inviteRepresents } }),
		onSuccess: () => { setDirQuery(''); setInviteRepresents(''); refreshRooms(); dispatchToast({ type: 'success', message: 'Opposing counsel invited' }); },
		onError: onErr,
	});
	const toggleHold = useMutation({
		mutationFn: () => request(`/matter-rooms/${room.id}/hold${room?.holdActive ? '/release' : ''}`, { method: 'POST', body: room?.holdActive ? { releasedBy: attorneyId } : { reason: 'litigation hold', attachedBy: attorneyId } }),
		onSuccess: () => { refreshRooms(); dispatchToast({ type: 'success', message: room?.holdActive ? 'Legal hold released' : 'Legal hold attached — deletion frozen' }); },
		onError: onErr,
	});
	const setRetention = useMutation({
		mutationFn: (days: number) => request(`/matter-rooms/${room.id}/retention`, { method: 'POST', body: { byAttorneyId: attorneyId, days } }),
		onSuccess: () => { refreshRooms(); dispatchToast({ type: 'success', message: 'Retention policy set' }); },
		onError: onErr,
	});
	const screen = useMutation({
		mutationFn: ({ screenAttorneyId, unscreen }: { screenAttorneyId: string; unscreen?: boolean }) =>
			request(`/matter-rooms/${room.id}/${unscreen ? 'unscreen' : 'screen'}`, { method: 'POST', body: { byAttorneyId: attorneyId, screenAttorneyId } }),
		onSuccess: (_d: any, v: any) => { refreshRooms(); dispatchToast({ type: 'success', message: v.unscreen ? 'Attorney unscreened' : 'Attorney screened off this matter (ethical wall)' }); },
		onError: onErr,
	});
	const exportRoom = useMutation({
		mutationFn: () => request(`/matter-rooms/${room.id}/export`, { method: 'POST', body: { requestingFirmId: firmId, requestingAttorneyId: attorneyId } }),
		onSuccess: (d: any) => {
			const blob = new Blob([JSON.stringify(d.export, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a'); a.href = url; a.download = `cross-firm-export-${room.id}.json`; a.click(); URL.revokeObjectURL(url);
			dispatchToast({ type: 'success', message: `Defensible export: ${d.export?.messages?.length} msgs, integrity ${d.export?.integrity?.auditChainVerified ? 'OK' : 'FAILED'}` });
		},
		onError: onErr,
	});

	const Header = (
		<Box display='flex' alignItems='center' mbe={8}>
			<Icon name={'balance' as ComponentProps<typeof Icon>['name']} size='x20' mie={8} color='hint' />
			<Box fontScale='h4' color='default'>Cross-firm · Opposing counsel</Box>
			{room?.holdActive && <Badge variant='danger' {...({ mis: 8 } as unknown as ComponentProps<typeof Badge>)}>HOLD</Badge>}
			{room?.retention && <Badge {...({ mis: 8 } as unknown as ComponentProps<typeof Badge>)}>{room.retention.days}d</Badge>}
		</Box>
	);

	if (!cfEnabled) {
		return <Box p={16}>{Header}<Callout type='warning' title='Cross-firm not enabled'>Turn on <b>CrossFirm_Enabled</b> in Admin → Settings → OmnisAI to enable opposing-counsel messaging on this matter. (Works without CasePro.)</Callout></Box>;
	}

	return (
		<Box p={16} display='flex' flexDirection='column' height='100%' style={{ overflowY: 'auto' }}>
			{Header}
			{(me.isLoading || rooms.isLoading) && <Throbber />}

			{/* No conversation attached to THIS channel yet */}
			{!room && !rooms.isLoading && (
				<>
					{pending.length > 0 && (
						<Box mbe={12}>
							<Box fontScale='c2' color='hint' mbe={4}>PENDING INVITATIONS</Box>
							{pending.map((r) => (
								<Box key={r.id} mbe={6}>
									<Box fontScale='c1'>{r.title} · {r.members?.map((m: any) => m.firm).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i).join(' ↔ ')}</Box>
									<Button small mbs={2} disabled={acceptInvite.isPending} onClick={() => acceptInvite.mutate(r.id)}>Accept on this matter</Button>
								</Box>
							))}
							<Divider />
						</Box>
					)}
					<Box fontScale='c1' color='hint' mbe={8}>No opposing-counsel conversation on this matter yet.</Box>
					<TextInput placeholder='I represent… (e.g. Plaintiff)' value={newRepresents} onChange={(e: any) => setNewRepresents(e.currentTarget.value)} mbe={8} />
					<Button primary small disabled={createRoom.isPending} onClick={() => createRoom.mutate()}>
						{createRoom.isPending ? <Throbber inheritColor size='x12' /> : 'Open conversation'}
					</Button>
				</>
			)}

			{room && (
				<>
					<Box fontScale='c1' color='hint' display='flex' flexDirection='column' mbe={8}>
						{room.members?.map((m: any) => (
							<Box key={m.attorneyId} display='flex' alignItems='center' mbs={2}>
								<Box withTruncatedText>{m.name} ({m.firm}{m.represents ? ` — ${m.represents}` : ''})</Box>
								{m.state === 'screened' && <Badge variant='warning' {...({ mis: 4 } as unknown as ComponentProps<typeof Badge>)}>screened</Badge>}
								{m.firm === firmName && m.attorneyId !== attorneyId && m.state !== 'invited' && (
									<Button mis={8} small onClick={() => screen.mutate({ screenAttorneyId: m.attorneyId, unscreen: m.state === 'screened' })}>{m.state === 'screened' ? 'Unscreen' : 'Screen'}</Button>
								)}
							</Box>
						))}
					</Box>
					<Box display='flex' flexWrap='wrap' mbe={8}>
						<Button small mie={8} mbe={4} onClick={() => toggleHold.mutate()}>{room.holdActive ? 'Release hold' : 'Legal hold'}</Button>
						<Button small mie={8} mbe={4} onClick={() => setRetention.mutate(2555)}>Set 7y retention</Button>
						<Button small mbe={4} onClick={() => exportRoom.mutate()}><Icon name='download' size='x16' mie={4} />Export</Button>
					</Box>

					{myState === 'invited' ? (
						<Box>
							<Callout type='info' title='You have been invited'>Accepting records your consent to communicate on this matter (Rule 4.2 — attorney-to-attorney).</Callout>
							<Button primary mbs={8} disabled={acceptInvite.isPending} onClick={() => acceptInvite.mutate(room.id)}>Accept invitation</Button>
						</Box>
					) : (
						<>
							<Box flexGrow={1} style={{ overflowY: 'auto', minHeight: '120px' }} mbe={8}>
								{messages.isLoading && <Throbber />}
								{(messages.data?.messages || []).map((m: any) => (
									<Box key={m.id} mbe={10}>
										<Box fontScale='c1' color='hint'>{m.senderName} · {m.senderFirm} · {new Date(m.ts).toLocaleString()}</Box>
										<Box fontScale='p2'>{m.tombstone ? <i>[deleted — tombstone retained]</i> : m.text}</Box>
									</Box>
								))}
							</Box>

							<Box fontScale='c2' color='hint' mbe={4}>INVITE OPPOSING / CO-COUNSEL (verified attorneys only — Rule 4.2)</Box>
							<TextInput placeholder='Search by name or bar #' value={dirQuery} onChange={(e: any) => setDirQuery(e.currentTarget.value)} mbe={6} />
							<TextInput placeholder='They represent…' value={inviteRepresents} onChange={(e: any) => setInviteRepresents(e.currentTarget.value)} mbe={6} />
							{(directory.data?.attorneys || []).filter((a: any) => a.id !== attorneyId).map((a: any) => (
								<Box key={a.id} display='flex' alignItems='center' justifyContent='space-between' mbe={4}>
									<Box fontScale='c1' withTruncatedText>{a.name} — {a.firm}</Box>
									<Button small disabled={invite.isPending} onClick={() => invite.mutate(a.id)}>Invite</Button>
								</Box>
							))}

							<Box display='flex' mbs={8}>
								<TextInput placeholder='Message opposing counsel…' value={draft} onChange={(e: any) => setDraft(e.currentTarget.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && draft.trim()) send.mutate(); }} mie={8} />
								<Button primary disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}>{send.isPending ? <Throbber inheritColor size='x12' /> : <Icon name='send' size='x20' />}</Button>
							</Box>
						</>
					)}
				</>
			)}
		</Box>
	);
};

export default CrossFirmSection;
