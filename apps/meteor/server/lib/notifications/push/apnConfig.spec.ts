import { expect } from 'chai';
import { describe, it } from 'mocha';

import { APN_SANDBOX_GATEWAY, normalizeApnAuthType, resolveApnConfig, resolveApnTopic } from './apnConfig';

const P8 = '-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----';

const certificateInput = {
	passphrase: 'pass',
	key: 'prod-key',
	cert: 'prod-cert',
	devPassphrase: 'dev-pass',
	devKey: 'dev-key',
	devCert: 'dev-cert',
};

const tokenInput = {
	tokenKey: P8,
	tokenKeyId: 'ABC1234567',
	teamId: 'P8S9U28C8B',
};

describe('normalizeApnAuthType', () => {
	it('should return token for the token value', () => {
		expect(normalizeApnAuthType('token')).to.equal('token');
	});

	it('should ignore surrounding whitespace and casing', () => {
		expect(normalizeApnAuthType('  Token ')).to.equal('token');
	});

	it('should default to certificate when undefined', () => {
		expect(normalizeApnAuthType(undefined)).to.equal('certificate');
	});

	it('should fall back to certificate for unknown values', () => {
		expect(normalizeApnAuthType('p8')).to.equal('certificate');
		expect(normalizeApnAuthType('🙈')).to.equal('certificate');
	});
});

describe('resolveApnConfig', () => {
	describe('certificate auth', () => {
		it('should return the certificate shape in production', () => {
			expect(resolveApnConfig({ authType: 'certificate', production: true, ...certificateInput })).to.deep.equal({
				passphrase: 'pass',
				key: 'prod-key',
				cert: 'prod-cert',
				production: true,
			});
		});

		it('should be the default when no auth type is given', () => {
			expect(resolveApnConfig({ production: true, ...certificateInput })).to.deep.equal({
				passphrase: 'pass',
				key: 'prod-key',
				cert: 'prod-cert',
				production: true,
			});
		});

		it('should use the dev credentials and the sandbox gateway when production is false', () => {
			expect(resolveApnConfig({ authType: 'certificate', production: false, ...certificateInput })).to.deep.equal({
				passphrase: 'dev-pass',
				key: 'dev-key',
				cert: 'dev-cert',
				gateway: APN_SANDBOX_GATEWAY,
				production: false,
			});
		});

		it('should treat a missing production flag as sandbox', () => {
			const config = resolveApnConfig({ authType: 'certificate', ...certificateInput });

			expect(config).to.have.property('production', false);
			expect(config).to.have.property('gateway', APN_SANDBOX_GATEWAY);
			expect(config).to.have.property('key', 'dev-key');
		});

		it('should not be affected by token fields being present', () => {
			expect(resolveApnConfig({ authType: 'certificate', production: true, ...certificateInput, ...tokenInput })).to.deep.equal({
				passphrase: 'pass',
				key: 'prod-key',
				cert: 'prod-cert',
				production: true,
			});
		});

		it('should return undefined when the key is blank', () => {
			expect(resolveApnConfig({ authType: 'certificate', production: true, ...certificateInput, key: '' })).to.equal(undefined);
		});

		it('should return undefined when the cert is blank', () => {
			expect(resolveApnConfig({ authType: 'certificate', production: true, ...certificateInput, cert: '' })).to.equal(undefined);
		});

		it('should return undefined when the key or cert is whitespace only', () => {
			expect(resolveApnConfig({ authType: 'certificate', production: true, ...certificateInput, key: '   \n ' })).to.equal(undefined);
			expect(resolveApnConfig({ authType: 'certificate', production: true, ...certificateInput, cert: '\t' })).to.equal(undefined);
		});

		it('should return undefined when the dev credentials are blank in sandbox', () => {
			expect(resolveApnConfig({ authType: 'certificate', production: false, ...certificateInput, devCert: '' })).to.equal(undefined);
		});

		it('should return undefined when nothing is configured at all', () => {
			expect(resolveApnConfig({})).to.equal(undefined);
		});

		it('should not trim the credential values themselves', () => {
			const config = resolveApnConfig({
				authType: 'certificate',
				production: true,
				key: ' key-with-space\n',
				cert: '\ncert-with-space ',
			});

			expect(config).to.have.property('key', ' key-with-space\n');
			expect(config).to.have.property('cert', '\ncert-with-space ');
		});

		it('should include the bundle id as topic when configured', () => {
			expect(
				resolveApnConfig({ authType: 'certificate', production: true, ...certificateInput, bundleId: 'com.omnisai.matterchat' }),
			).to.have.property('topic', 'com.omnisai.matterchat');
		});

		it('should fall back to certificate auth for unknown auth types rather than throwing', () => {
			expect(() => resolveApnConfig({ authType: 'nonsense', production: true, ...certificateInput })).to.not.throw();
			expect(resolveApnConfig({ authType: 'nonsense', production: true, ...certificateInput })).to.deep.equal({
				passphrase: 'pass',
				key: 'prod-key',
				cert: 'prod-cert',
				production: true,
			});
		});

		it('should fall back to certificate auth for a garbage auth type even when only token fields are set', () => {
			expect(resolveApnConfig({ authType: 'TOKEN_', production: true, ...tokenInput })).to.equal(undefined);
		});
	});

	describe('token auth', () => {
		it('should return the token shape', () => {
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput })).to.deep.equal({
				token: { key: P8, keyId: 'ABC1234567', teamId: 'P8S9U28C8B' },
				production: true,
			});
		});

		it('should ignore the certificate fields entirely', () => {
			const config = resolveApnConfig({ authType: 'token', production: true, ...certificateInput, ...tokenInput });

			expect(config).to.not.have.property('cert');
			expect(config).to.not.have.property('passphrase');
			expect(config).to.have.property('token');
		});

		it('should report production false without a legacy gateway', () => {
			const config = resolveApnConfig({ authType: 'token', production: false, ...tokenInput });

			expect(config).to.deep.equal({
				token: { key: P8, keyId: 'ABC1234567', teamId: 'P8S9U28C8B' },
				production: false,
			});
			expect(config).to.not.have.property('gateway');
		});

		it('should include the bundle id as topic when configured', () => {
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput, bundleId: ' com.omnisai.matterchat ' })).to.deep.equal({
				token: { key: P8, keyId: 'ABC1234567', teamId: 'P8S9U28C8B' },
				production: true,
				topic: 'com.omnisai.matterchat',
			});
		});

		it('should trim the token credentials', () => {
			expect(
				resolveApnConfig({ authType: 'token', production: true, tokenKey: ` ${P8} `, tokenKeyId: ' ABC1234567 ', teamId: ' P8S9U28C8B\n' }),
			).to.deep.equal({
				token: { key: P8, keyId: 'ABC1234567', teamId: 'P8S9U28C8B' },
				production: true,
			});
		});

		it('should return undefined when the key is missing', () => {
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput, tokenKey: undefined })).to.equal(undefined);
		});

		it('should return undefined when the key id is missing', () => {
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput, tokenKeyId: undefined })).to.equal(undefined);
		});

		it('should return undefined when the team id is missing', () => {
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput, teamId: undefined })).to.equal(undefined);
		});

		it('should return undefined when any credential is whitespace only', () => {
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput, tokenKey: '   ' })).to.equal(undefined);
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput, tokenKeyId: '\n\t' })).to.equal(undefined);
			expect(resolveApnConfig({ authType: 'token', production: true, ...tokenInput, teamId: ' ' })).to.equal(undefined);
		});

		it('should return undefined when only the certificate credentials are configured', () => {
			expect(resolveApnConfig({ authType: 'token', production: true, ...certificateInput })).to.equal(undefined);
		});
	});
});

describe('resolveApnTopic', () => {
	it('should return the client reported topic when no bundle id is configured', () => {
		expect(resolveApnTopic({ topic: 'chat.rocket.ios' })).to.equal('chat.rocket.ios');
		expect(resolveApnTopic({ topic: 'chat.rocket.ios', configuredBundleId: '' })).to.equal('chat.rocket.ios');
		expect(resolveApnTopic({ topic: 'chat.rocket.ios', configuredBundleId: '   ' })).to.equal('chat.rocket.ios');
	});

	it('should preserve the client reported voip topic when no bundle id is configured', () => {
		expect(resolveApnTopic({ topic: 'chat.rocket.ios.voip', useVoipToken: true })).to.equal('chat.rocket.ios.voip');
	});

	it('should prefer the configured bundle id', () => {
		expect(resolveApnTopic({ topic: 'chat.rocket.ios', configuredBundleId: 'com.omnisai.matterchat' })).to.equal('com.omnisai.matterchat');
	});

	it('should append the voip suffix to the configured bundle id', () => {
		expect(resolveApnTopic({ topic: 'chat.rocket.ios.voip', useVoipToken: true, configuredBundleId: ' com.omnisai.matterchat ' })).to.equal(
			'com.omnisai.matterchat.voip',
		);
	});
});
