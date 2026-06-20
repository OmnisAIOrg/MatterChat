import { Box, Button, TextInput, Throbber, Icon, Badge, Callout } from '@rocket.chat/fuselage';
import { useToastMessageDispatch } from '@rocket.chat/ui-contexts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useCrossFirmFetch } from './useCrossFirmFetch';

/**
 * Cross-firm matter rooms — the in-MatterChat surface for the Omnis Counsel / CFCS trust layer.
 * Self-contained panel (NOT RC's room system): talks to the external CFCS over REST with React-Query
 * polling. Proves the founder's "opposing counsel message each other through MatterChat" vision.
 */
const CrossFirmPage = () => {
	const dispatchToast = useToastMessageDispatch();
	const qc = useQueryClient();
	const { request, cfcsUrl, firmName, userKey, displayName } = useCrossFirmFetch();

	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [draft, setDraft] = useState('');
	const [newTitle, setNewTitle] = useState('');
	const [newRepresents, setNewRepresents] = useState('');
	const [dirQuery, setDirQuery] = useState('');
	const [inviteRepresents, setInviteRepresents] = useState('');

	// 1) identity bridge — map this MatterChat user to a CFCS attorney + firm
	const me = useQuery({
		queryKey: ['cf', 'whoami', userKey, firmName],
		queryFn: () => request('/whoami', { method: 'POST', body: { userKey, name: displayName, firmName: firmName || 'My Firm' } }),
		enabled: Boolean(cfcsUrl && userKey),
	});
	const attorneyId: string | undefined = me.data?.attorney?.id;
	const firmId: string | undefined = me.data?.firm?.id;

	// 2) my matter rooms
	const rooms = useQuery({
		queryKey: ['cf', 'rooms', attorneyId],
		queryFn: () => request(`/matter-rooms?attorneyId=${attorneyId}`),
		enabled: Boolean(attorneyId),
		refetchInterval: 5000,
	});
	const roomList: any[] = rooms.data?.rooms || [];
	const selected = useMemo(() => roomList.find((r) => r.id === selectedId) || null, [roomList, selectedId]);
	const myState = selected?.myState;

	// 3) messages for the selected room (only when I'm an active member)
	const messages = useQuery({
		queryKey: ['cf', 'messages', selectedId, attorneyId],
		queryFn: () => request(`/matter-rooms/${selectedId}/messages?attorneyId=${attorneyId}`),
		enabled: Boolean(selectedId && attorneyId && myState === 'active'),
		refetchInterval: 4000,
	});

	// 4) directory search (for inviting opposing counsel)
	const directory = useQuery({
		queryKey: ['cf', 'directory', dirQuery],
		queryFn: () => request(`/directory?q=${encodeURIComponent(dirQuery)}`),
		enabled: Boolean(attorneyId && dirQuery.length >= 1),
	});

	const refreshRooms = () => qc.invalidateQueries({ queryKey: ['cf', 'rooms', attorneyId] });
	const refreshMessages = () => qc.invalidateQueries({ queryKey: ['cf', 'messages', selectedId, attorneyId] });
	const onErr = (e: unknown) => dispatchToast({ type: 'error', message: (e as Error)?.message || 'Cross-firm error' });

	const createRoom = useMutation({
		mutationFn: () => request('/matter-rooms', { method: 'POST', body: { title: newTitle, originatingAttorneyId: attorneyId, representsParty: newRepresents } }),
		onSuccess: (d) => { setNewTitle(''); setNewRepresents(''); setSelectedId(d.room?.id || null); refreshRooms(); dispatchToast({ type: 'success', message: 'Matter room created' }); },
		onError: onErr,
	});
	const accept = useMutation({
		mutationFn: () => request(`/matter-rooms/${selectedId}/accept`, { method: 'POST', body: { attorneyId } }),
		onSuccess: () => { refreshRooms(); refreshMessages(); dispatchToast({ type: 'success', message: 'Invitation accepted — consent recorded' }); },
		onError: onErr,
	});
	const send = useMutation({
		mutationFn: () => request(`/matter-rooms/${selectedId}/messages`, { method: 'POST', body: { senderAttorneyId: attorneyId, text: draft } }),
		onSuccess: () => { setDraft(''); refreshMessages(); },
		onError: onErr,
	});
	const invite = useMutation({
		mutationFn: (inviteeAttorneyId: string) => request(`/matter-rooms/${selectedId}/invite`, { method: 'POST', body: { inviterAttorneyId: attorneyId, inviteeAttorneyId, representsParty: inviteRepresents } }),
		onSuccess: () => { setDirQuery(''); setInviteRepresents(''); refreshRooms(); dispatchToast({ type: 'success', message: 'Opposing counsel invited' }); },
		onError: onErr,
	});
	const toggleHold = useMutation({
		mutationFn: () => request(`/matter-rooms/${selectedId}/hold${selected?.holdActive ? '/release' : ''}`, { method: 'POST', body: selected?.holdActive ? { releasedBy: attorneyId } : { reason: 'litigation hold', attachedBy: attorneyId } }),
		onSuccess: () => { refreshRooms(); dispatchToast({ type: 'success', message: selected?.holdActive ? 'Legal hold released' : 'Legal hold attached — deletion frozen' }); },
		onError: onErr,
	});
	const exportRoom = useMutation({
		mutationFn: () => request(`/matter-rooms/${selectedId}/export`, { method: 'POST', body: { requestingFirmId: firmId } }),
		onSuccess: (d) => {
			const bundle = d.export;
			const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url; a.download = `cross-firm-export-${selectedId}.json`; a.click();
			URL.revokeObjectURL(url);
			dispatchToast({ type: 'success', message: `Defensible export: ${bundle?.messages?.length} msgs, integrity ${bundle?.integrity?.auditChainVerified ? 'OK' : 'FAILED'}` });
		},
		onError: onErr,
	});

	if (!cfcsUrl) {
		return (
			<Box p={24} maxWidth={680}>
				<Callout type='warning' title='Cross-firm not configured'>
					Set <b>CrossFirm_CFCS_URL</b> (and <b>CrossFirm_Firm_Name</b>) in Admin → Settings → OmnisAI to connect this
					workspace to the Cross-Firm Correspondence Service.
				</Callout>
			</Box>
		);
	}

	return (
		<Box display='flex' height='100%' width='100%'>
			{/* left: room list + create */}
			<Box width={320} minWidth={320} display='flex' flexDirection='column' borderInlineEnd='1px solid' borderColor='extra-light'>
				<Box p={16} borderBlockEnd='1px solid' borderColor='extra-light'>
					<Box fontScale='h4' display='flex' alignItems='center'><Icon name='balance' size='x20' mie={8} /> Cross-firm matters</Box>
					<Box fontScale='c1' color='hint' mbs={4}>{firmName ? `Firm: ${firmName}` : 'Firm not set'} · {displayName}</Box>
				</Box>
				<Box p={16} borderBlockEnd='1px solid' borderColor='extra-light'>
					<Box fontScale='c2' color='hint' mbe={4}>NEW MATTER ROOM</Box>
					<TextInput placeholder='Matter title (e.g. Smith v. Jones)' value={newTitle} onChange={(e: any) => setNewTitle(e.currentTarget.value)} mbe={8} />
					<TextInput placeholder='I represent… (e.g. Plaintiff)' value={newRepresents} onChange={(e: any) => setNewRepresents(e.currentTarget.value)} mbe={8} />
					<Button primary small disabled={!newTitle || createRoom.isPending} onClick={() => createRoom.mutate()}>
						{createRoom.isPending ? <Throbber inheritColor size='x12' /> : 'Create'}
					</Button>
				</Box>
				<Box flexGrow={1} style={{ overflowY: 'auto' }}>
					{rooms.isLoading && <Box p={16}><Throbber /></Box>}
					{roomList.length === 0 && !rooms.isLoading && <Box p={16} fontScale='c1' color='hint'>No matter rooms yet.</Box>}
					{roomList.map((r) => (
						<Box key={r.id} p={16} borderBlockEnd='1px solid' borderColor='extra-light' onClick={() => setSelectedId(r.id)}
							style={{ cursor: 'pointer', background: r.id === selectedId ? 'var(--rcx-color-surface-tint, #f2f3f5)' : undefined }}>
							<Box display='flex' alignItems='center' justifyContent='space-between'>
								<Box fontScale='p2' withTruncatedText>{r.title}</Box>
								{r.myState === 'invited' && <Badge variant='primary'>Invite</Badge>}
								{r.holdActive && <Icon name='lock' size='x16' title='Legal hold' />}
							</Box>
							<Box fontScale='c1' color='hint' withTruncatedText>{r.members?.map((m: any) => m.firm).filter((v: any, i: number, a: any[]) => a.indexOf(v) === i).join(' ↔ ')}</Box>
						</Box>
					))}
				</Box>
			</Box>

			{/* right: selected room */}
			<Box flexGrow={1} display='flex' flexDirection='column' height='100%'>
				{!selected && <Box p={24} color='hint'>Select or create a matter room.</Box>}
				{selected && (
					<>
						<Box p={16} borderBlockEnd='1px solid' borderColor='extra-light'>
							<Box display='flex' alignItems='center' justifyContent='space-between'>
								<Box>
									<Box fontScale='h4'>{selected.title}</Box>
									<Box fontScale='c1' color='hint'>
										{selected.members?.map((m: any) => `${m.name} (${m.firm}${m.represents ? ` — ${m.represents}` : ''})`).join('  ·  ')}
									</Box>
								</Box>
								<Box display='flex' alignItems='center'>
									{selected.holdActive && <Badge variant='danger' mie={8}>HOLD</Badge>}
									<Button small mie={8} onClick={() => toggleHold.mutate()}>{selected.holdActive ? 'Release hold' : 'Legal hold'}</Button>
									<Button small onClick={() => exportRoom.mutate()}><Icon name='download' size='x16' mie={4} />Export</Button>
								</Box>
							</Box>
						</Box>

						{myState === 'invited' ? (
							<Box p={24}>
								<Callout type='info' title='You have been invited as opposing/co-counsel'>
									Accepting records your consent to communicate on this matter (Rule 4.2 — attorney-to-attorney).
								</Callout>
								<Button primary mbs={16} disabled={accept.isPending} onClick={() => accept.mutate()}>
									{accept.isPending ? <Throbber inheritColor size='x12' /> : 'Accept invitation'}
								</Button>
							</Box>
						) : (
							<>
								<Box flexGrow={1} p={16} style={{ overflowY: 'auto' }}>
									{messages.isLoading && <Throbber />}
									{(messages.data?.messages || []).map((m: any) => (
										<Box key={m.id} mbe={12}>
											<Box fontScale='c1' color='hint'>{m.senderName} · {m.senderFirm} · {new Date(m.ts).toLocaleString()}</Box>
											<Box fontScale='p2'>{m.tombstone ? <i>[deleted — tombstone retained]</i> : m.text}</Box>
										</Box>
									))}
								</Box>

								{/* invite opposing counsel */}
								<Box p={16} borderBlock='1px solid' borderColor='extra-light'>
									<Box fontScale='c2' color='hint' mbe={4}>INVITE OPPOSING / CO-COUNSEL (verified attorneys only — Rule 4.2)</Box>
									<Box display='flex' mbe={8}>
										<TextInput placeholder='Search attorney by name or bar #' value={dirQuery} onChange={(e: any) => setDirQuery(e.currentTarget.value)} mie={8} />
										<TextInput placeholder='They represent…' value={inviteRepresents} onChange={(e: any) => setInviteRepresents(e.currentTarget.value)} />
									</Box>
									{(directory.data?.attorneys || []).filter((a: any) => a.id !== attorneyId).map((a: any) => (
										<Box key={a.id} display='flex' alignItems='center' justifyContent='space-between' mbe={4}>
											<Box fontScale='c1'>{a.name} — {a.firm}</Box>
											<Button small disabled={invite.isPending} onClick={() => invite.mutate(a.id)}>Invite</Button>
										</Box>
									))}
								</Box>

								{/* composer */}
								<Box p={16} display='flex' borderBlockStart='1px solid' borderColor='extra-light'>
									<TextInput
										placeholder='Message opposing counsel…'
										value={draft}
										onChange={(e: any) => setDraft(e.currentTarget.value)}
										onKeyDown={(e: any) => { if (e.key === 'Enter' && draft.trim()) send.mutate(); }}
										mie={8}
									/>
									<Button primary disabled={!draft.trim() || send.isPending} onClick={() => send.mutate()}>
										{send.isPending ? <Throbber inheritColor size='x12' /> : <Icon name='send' size='x20' />}
									</Button>
								</Box>
							</>
						)}
					</>
				)}
			</Box>
		</Box>
	);
};

export default CrossFirmPage;
