import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
	BASE_CHANNELS,
	MAX_SEEDED_CHANNELS,
	PRACTICE_AREAS,
	findPracticeArea,
	listPracticeAreas,
	normalizePracticeAreas,
	resolveChannelPlan,
} from '../../../../../server/lib/firms/firmTemplates';

describe('firmTemplates', () => {
	describe('PRACTICE_AREAS (data integrity)', () => {
		it('has unique area ids', () => {
			const ids = PRACTICE_AREAS.map((a) => a.id);
			expect(new Set(ids).size).to.equal(ids.length);
		});

		it('uses slug-safe channel slugs everywhere', () => {
			// Slugs are concatenated into a room name, which must be URL-safe.
			const all = [...BASE_CHANNELS, ...PRACTICE_AREAS.flatMap((a) => a.channels)];
			for (const channel of all) {
				expect(channel.slug, `slug "${channel.slug}"`).to.match(/^[a-z0-9]+(-[a-z0-9]+)*$/);
			}
		});

		it('gives every channel a display name and a topic', () => {
			const all = [...BASE_CHANNELS, ...PRACTICE_AREAS.flatMap((a) => a.channels)];
			for (const channel of all) {
				expect(channel.display, `display for "${channel.slug}"`).to.be.a('string').and.not.empty;
				expect(channel.topic, `topic for "${channel.slug}"`).to.be.a('string').and.not.empty;
			}
		});

		it('keeps a shared slug consistent across areas', () => {
			// "discovery" appears in litigation and criminal-defense; if the two
			// disagreed on display/topic the seeded channel would depend on
			// selection order in a way nobody could predict.
			const bySlug = new Map<string, { display: string; topic: string }>();
			for (const area of PRACTICE_AREAS) {
				for (const channel of area.channels) {
					const seen = bySlug.get(channel.slug);
					if (seen) {
						expect(seen.display, `display for shared slug "${channel.slug}"`).to.equal(channel.display);
						expect(seen.topic, `topic for shared slug "${channel.slug}"`).to.equal(channel.topic);
					} else {
						bySlug.set(channel.slug, channel);
					}
				}
			}
		});

		it('does not redefine a base channel inside a practice area', () => {
			const baseSlugs = new Set(BASE_CHANNELS.map((c) => c.slug));
			for (const area of PRACTICE_AREAS) {
				for (const channel of area.channels) {
					expect(baseSlugs.has(channel.slug), `"${channel.slug}" duplicates a base channel`).to.be.false;
				}
			}
		});
	});

	describe('listPracticeAreas', () => {
		it('exposes id and label only — channel layout stays server-side', () => {
			const listed = listPracticeAreas();
			expect(listed).to.have.lengthOf(PRACTICE_AREAS.length);
			for (const area of listed) {
				expect(Object.keys(area).sort()).to.deep.equal(['id', 'label']);
			}
		});
	});

	describe('findPracticeArea', () => {
		it('finds a known area', () => {
			expect(findPracticeArea('personal-injury')?.label).to.equal('Personal injury');
		});

		it('returns undefined for unknown ids and non-strings', () => {
			expect(findPracticeArea('nope')).to.be.undefined;
			expect(findPracticeArea(42)).to.be.undefined;
			expect(findPracticeArea(null)).to.be.undefined;
			expect(findPracticeArea(undefined)).to.be.undefined;
			expect(findPracticeArea({ id: 'personal-injury' })).to.be.undefined;
		});
	});

	describe('resolveChannelPlan', () => {
		it('returns exactly the base channels when nothing is selected', () => {
			expect(resolveChannelPlan([]).map((c) => c.slug)).to.deep.equal(BASE_CHANNELS.map((c) => c.slug));
		});

		it('treats any malformed input as no selection rather than failing', () => {
			// This runs on a REST body during signup: a bad selection must still
			// produce a usable workspace.
			for (const input of [undefined, null, 'personal-injury', 42, {}, true]) {
				expect(resolveChannelPlan(input).map((c) => c.slug), `input ${JSON.stringify(input)}`).to.deep.equal(
					BASE_CHANNELS.map((c) => c.slug),
				);
			}
		});

		it('appends the selected area channels after the base set', () => {
			const plan = resolveChannelPlan(['personal-injury']).map((c) => c.slug);
			expect(plan.slice(0, BASE_CHANNELS.length)).to.deep.equal(BASE_CHANNELS.map((c) => c.slug));
			expect(plan).to.include.members(['medical-records', 'settlements', 'liens']);
		});

		it('ignores unknown ids instead of rejecting them', () => {
			const plan = resolveChannelPlan(['made-up', 'personal-injury', 7, null]).map((c) => c.slug);
			expect(plan).to.include('medical-records');
			expect(plan).to.have.lengthOf(BASE_CHANNELS.length + 3);
		});

		it('deduplicates a channel two areas share, keeping the first order', () => {
			const plan = resolveChannelPlan(['litigation', 'criminal-defense']).map((c) => c.slug);
			expect(plan.filter((slug) => slug === 'discovery')).to.have.lengthOf(1);
			// litigation was listed first, so its channels precede criminal-defense's
			expect(plan.indexOf('litigation')).to.be.lessThan(plan.indexOf('arraignments'));
		});

		it('never emits duplicate slugs for any selection', () => {
			const plan = resolveChannelPlan(PRACTICE_AREAS.map((a) => a.id)).map((c) => c.slug);
			expect(new Set(plan).size).to.equal(plan.length);
		});

		it('caps the total, and never drops a base channel to do it', () => {
			const plan = resolveChannelPlan(PRACTICE_AREAS.map((a) => a.id));
			expect(plan.length).to.be.at.most(MAX_SEEDED_CHANNELS);
			expect(plan.map((c) => c.slug)).to.include.members(BASE_CHANNELS.map((c) => c.slug));
		});

		it('returns copies of the channel specs, not shared mutable state', () => {
			// Callers seed from this list; a caller mutating a topic must not
			// rewrite the template for every future firm.
			const first = resolveChannelPlan(['personal-injury']);
			first[0].display = 'MUTATED';
			const second = resolveChannelPlan(['personal-injury']);
			expect(second[0].display).to.not.equal('MUTATED');
		});
	});

	describe('normalizePracticeAreas', () => {
		it('keeps only known ids, deduplicated, in the order given', () => {
			expect(normalizePracticeAreas(['immigration', 'nope', 'immigration', 'family-law'])).to.deep.equal([
				'immigration',
				'family-law',
			]);
		});

		it('returns an empty list for malformed input', () => {
			for (const input of [undefined, null, 'immigration', 99, {}]) {
				expect(normalizePracticeAreas(input), `input ${JSON.stringify(input)}`).to.deep.equal([]);
			}
		});
	});
});
