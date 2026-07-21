import { sdk } from '../../../app/utils/client/lib/SDKClient';

/**
 * Chi realtime voice (OpenAI Realtime API over WebRTC). The browser never sees the real key: it
 * fetches a short-lived ephemeral token from /v1/chi.realtime-session, then opens a direct WebRTC
 * connection to OpenAI — mic audio up, Chi's spoken audio down, transcripts over the data channel.
 *
 * Usage: const call = await startChiVoice({ onEvent }); … call.stop().
 */
export type ChiVoiceEvent =
	| { kind: 'status'; status: 'connecting' | 'live' | 'ended'; detail?: string }
	| { kind: 'transcript'; who: 'me' | 'chi'; text: string; final: boolean };

type StartOpts = { onEvent?: (e: ChiVoiceEvent) => void };

export type ChiVoiceHandle = { stop: () => void };

const REALTIME_URL = 'https://api.openai.com/v1/realtime';

export async function startChiVoice(opts: StartOpts = {}): Promise<ChiVoiceHandle> {
	const emit = (e: ChiVoiceEvent): void => opts.onEvent?.(e);
	emit({ kind: 'status', status: 'connecting' });

	// 1. Ephemeral token (server mints it with the workspace's OpenAI key).
	const session = (await (sdk.rest.post as (e: string, p: unknown) => Promise<unknown>)('/v1/chi.realtime-session', {})) as {
		token?: string;
		model?: string;
		success?: boolean;
		error?: string;
	};
	if (!session?.token) {
		emit({ kind: 'status', status: 'ended', detail: session?.error || 'Could not start voice.' });
		throw new Error(session?.error || 'no realtime token');
	}

	// 2. WebRTC: mic up, Chi's audio down, events over the data channel.
	const pc = new RTCPeerConnection();
	const audioEl = new Audio();
	audioEl.autoplay = true;
	pc.addEventListener('track', (e) => {
		[audioEl.srcObject] = e.streams;
	});

	const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
	mic.getTracks().forEach((t) => pc.addTrack(t, mic));

	const dc = pc.createDataChannel('oai-events');
	dc.addEventListener('message', (e) => {
		try {
			const evt = JSON.parse(e.data);
			// Chi speaking → streamed transcript of the reply.
			if (evt.type === 'response.audio_transcript.delta' && evt.delta) {
				emit({ kind: 'transcript', who: 'chi', text: evt.delta, final: false });
			} else if (evt.type === 'response.audio_transcript.done' && evt.transcript) {
				emit({ kind: 'transcript', who: 'chi', text: evt.transcript, final: true });
			} else if (evt.type === 'conversation.item.input_audio_transcription.completed' && evt.transcript) {
				// What the user said (final).
				emit({ kind: 'transcript', who: 'me', text: evt.transcript, final: true });
			}
		} catch {
			/* ignore non-JSON */
		}
	});

	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);

	const answer = await fetch(`${REALTIME_URL}?model=${encodeURIComponent(session.model || 'gpt-4o-realtime-preview')}`, {
		method: 'POST',
		body: offer.sdp,
		headers: { 'Authorization': `Bearer ${session.token}`, 'Content-Type': 'application/sdp' },
	});
	if (!answer.ok) {
		pc.close();
		mic.getTracks().forEach((t) => t.stop());
		emit({ kind: 'status', status: 'ended', detail: 'Voice connection refused.' });
		throw new Error('realtime sdp exchange failed');
	}
	await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
	emit({ kind: 'status', status: 'live' });

	const stop = (): void => {
		try {
			dc.close();
		} catch {
			/* ignore */
		}
		try {
			pc.close();
		} catch {
			/* ignore */
		}
		mic.getTracks().forEach((t) => t.stop());
		audioEl.srcObject = null;
		emit({ kind: 'status', status: 'ended' });
	};
	pc.addEventListener('connectionstatechange', () => {
		if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
			emit({ kind: 'status', status: 'ended' });
		}
	});
	return { stop };
}
