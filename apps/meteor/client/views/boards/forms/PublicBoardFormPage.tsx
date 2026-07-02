import { useRouteParameter } from '@rocket.chat/ui-contexts';
import type { CSSProperties, FormEvent, ReactElement } from 'react';
import { useEffect, useState } from 'react';

/**
 * PublicBoardFormPage — the UNAUTHENTICATED fill page for a Boards intake form,
 * mounted at /form/:slug (registered in client/startup/routes.tsx WITHOUT
 * MainLayout, like /invite/:hash, so it renders logged-out).
 *
 * Deliberately dependency-light: plain fetch against the two public endpoints
 * (boards.forms.public.get / .submit) and native HTML inputs with inline styles
 * — no Fuselage/theme/provider coupling on a page external people load. The
 * slug in the URL is the only capability; the page never learns board/list ids.
 */

type PublicField = {
	id: string;
	label: string;
	type: 'text' | 'textarea' | 'select' | 'date' | 'checkbox' | 'email' | 'phone';
	required?: boolean;
	options?: string[];
	placeholder?: string;
};

type PublicForm = {
	title: string;
	description?: string;
	fields: PublicField[];
};

const styles: Record<string, CSSProperties> = {
	page: { minHeight: '100vh', background: '#f4f6f8', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' },
	card: { maxWidth: 560, margin: '0 auto', background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
	title: { margin: '0 0 8px', fontSize: 24, fontWeight: 700, color: '#1f2329' },
	description: { margin: '0 0 24px', color: '#6c737a', fontSize: 14, whiteSpace: 'pre-wrap' },
	label: { display: 'block', fontSize: 14, fontWeight: 600, color: '#2f343d', marginBottom: 4 },
	required: { color: '#d40c26', marginLeft: 2 },
	input: {
		width: '100%',
		boxSizing: 'border-box',
		padding: '10px 12px',
		fontSize: 14,
		border: '1px solid #cbced1',
		borderRadius: 6,
		marginBottom: 16,
		background: '#fff',
		color: '#1f2329',
	},
	checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 },
	button: {
		width: '100%',
		padding: '12px 16px',
		fontSize: 15,
		fontWeight: 600,
		color: '#fff',
		background: '#156ff5',
		border: 'none',
		borderRadius: 6,
		cursor: 'pointer',
	},
	error: { background: '#ffeaed', color: '#9b1325', padding: '10px 12px', borderRadius: 6, marginBottom: 16, fontSize: 14 },
	center: { textAlign: 'center', color: '#6c737a', padding: 48, fontSize: 15 },
};

const PublicBoardFormPage = (): ReactElement => {
	const slug = useRouteParameter('slug') ?? '';

	const [form, setForm] = useState<PublicForm | null>(null);
	const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'submitting' | 'done'>('loading');
	const [error, setError] = useState<string | null>(null);
	const [answers, setAnswers] = useState<Record<string, string | boolean>>({});

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await fetch(`/api/v1/boards.forms.public.get?slug=${encodeURIComponent(slug)}`);
				if (!res.ok) {
					if (!cancelled) {
						setState('missing');
					}
					return;
				}
				const json = await res.json();
				if (!cancelled) {
					setForm(json.form);
					setState('ready');
				}
			} catch {
				if (!cancelled) {
					setState('missing');
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [slug]);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (!form) {
			return;
		}
		setError(null);
		setState('submitting');
		try {
			// only send answered fields — the server rejects unknown keys
			const payload: Record<string, string | boolean> = {};
			for (const field of form.fields) {
				const value = answers[field.id];
				if (value !== undefined && value !== '') {
					payload[field.id] = value;
				}
			}
			const res = await fetch('/api/v1/boards.forms.public.submit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ slug, answers: payload }),
			});
			if (res.ok) {
				setState('done');
				return;
			}
			const json = await res.json().catch(() => ({}));
			setError(typeof json?.error === 'string' ? json.error : 'Submission failed — please check your answers and try again.');
			setState('ready');
		} catch {
			setError('Submission failed — please try again.');
			setState('ready');
		}
	};

	if (state === 'loading') {
		return (
			<div style={styles.page}>
				<div style={styles.card}>
					<div style={styles.center}>Loading…</div>
				</div>
			</div>
		);
	}

	if (state === 'missing' || !form) {
		return (
			<div style={styles.page}>
				<div style={styles.card}>
					<div style={styles.center}>This form is not available.</div>
				</div>
			</div>
		);
	}

	if (state === 'done') {
		return (
			<div style={styles.page}>
				<div style={styles.card}>
					<div style={styles.center}>
						<div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
						Thank you — your submission has been received.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div style={styles.page}>
			<div style={styles.card}>
				<h1 style={styles.title}>{form.title}</h1>
				{form.description && <p style={styles.description}>{form.description}</p>}
				{error && <div style={styles.error}>{error}</div>}
				<form onSubmit={handleSubmit}>
					{form.fields.map((field) => {
						const labelEl = (
							<label htmlFor={`bf-${field.id}`} style={styles.label}>
								{field.label}
								{field.required && <span style={styles.required}>*</span>}
							</label>
						);

						if (field.type === 'checkbox') {
							return (
								<div key={field.id} style={styles.checkboxRow}>
									<input
										id={`bf-${field.id}`}
										type='checkbox'
										checked={Boolean(answers[field.id])}
										required={field.required}
										onChange={(e) => setAnswers({ ...answers, [field.id]: e.currentTarget.checked })}
									/>
									<label htmlFor={`bf-${field.id}`} style={{ ...styles.label, marginBottom: 0 }}>
										{field.label}
										{field.required && <span style={styles.required}>*</span>}
									</label>
								</div>
							);
						}

						if (field.type === 'textarea') {
							return (
								<div key={field.id}>
									{labelEl}
									<textarea
										id={`bf-${field.id}`}
										rows={4}
										style={styles.input}
										placeholder={field.placeholder}
										required={field.required}
										value={String(answers[field.id] ?? '')}
										onChange={(e) => setAnswers({ ...answers, [field.id]: e.currentTarget.value })}
									/>
								</div>
							);
						}

						if (field.type === 'select') {
							return (
								<div key={field.id}>
									{labelEl}
									<select
										id={`bf-${field.id}`}
										style={styles.input}
										required={field.required}
										value={String(answers[field.id] ?? '')}
										onChange={(e) => setAnswers({ ...answers, [field.id]: e.currentTarget.value })}
									>
										<option value=''>{field.placeholder ?? 'Select…'}</option>
										{(field.options ?? []).map((option) => (
											<option key={option} value={option}>
												{option}
											</option>
										))}
									</select>
								</div>
							);
						}

						const inputType = field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'date' ? 'date' : 'text';
						return (
							<div key={field.id}>
								{labelEl}
								<input
									id={`bf-${field.id}`}
									type={inputType}
									style={styles.input}
									placeholder={field.placeholder}
									required={field.required}
									value={String(answers[field.id] ?? '')}
									onChange={(e) => setAnswers({ ...answers, [field.id]: e.currentTarget.value })}
								/>
							</div>
						);
					})}
					<button type='submit' style={styles.button} disabled={state === 'submitting'}>
						{state === 'submitting' ? 'Submitting…' : 'Submit'}
					</button>
				</form>
			</div>
		</div>
	);
};

export default PublicBoardFormPage;
