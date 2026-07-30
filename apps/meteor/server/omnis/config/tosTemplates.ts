/**
 * MATTERCHAT: Terms of Service + Privacy Policy templates.
 *
 * These replace Rocket.Chat's stock placeholder text ("Go to APP SETTINGS → Layout to customize
 * this page.") which was still being served to prod signups. They are applied by
 * matterchatConfigFixes.ts ONLY while the stored value still contains the stock placeholder, so
 * an admin-customised (or counsel-reviewed) version is never overwritten.
 *
 * NOTE FOR THE FOUNDER: these are sane generic templates, not legal advice — have counsel review
 * and replace via Admin → Layout when ready. Shipping them beats shipping the placeholder.
 */

export const TERMS_OF_SERVICE_TEMPLATE = `<!-- mc-legal-template-v1 — generic template; have counsel review -->
<h1>Terms of Service</h1>
<p><em>Last updated: July 30, 2026</em></p>
<p>Welcome to MatterChat, operated by OmnisAI ("we", "us"). By creating an account or using MatterChat, you agree to these terms.</p>
<h2>1. The service</h2>
<p>MatterChat provides secure team communication, project boards, and AI-assisted workflows. We may add, change, or remove features over time.</p>
<h2>2. Your account</h2>
<p>You are responsible for your account credentials and for all activity under your account. Provide accurate information and keep it current. You must be authorized by your organization to use a workspace that belongs to it.</p>
<h2>3. Acceptable use</h2>
<p>Do not use MatterChat to break the law, infringe others' rights, distribute malware, attempt unauthorized access, or harass others. We may suspend accounts that violate these rules.</p>
<h2>4. Your content</h2>
<p>You retain ownership of content you submit. You grant us the limited rights needed to store, transmit, and display that content in order to operate the service. You are responsible for the content you share.</p>
<h2>5. Confidentiality &amp; professional use</h2>
<p>MatterChat is used by legal professionals. We do not access your workspace content except as needed to operate the service, comply with law, or with your permission. Use of MatterChat does not create an attorney–client relationship with us.</p>
<h2>6. Service availability</h2>
<p>We aim for high availability but the service is provided "as is" without warranties of any kind to the extent permitted by law. We are not liable for indirect or consequential damages; our total liability is limited to the amounts you paid us in the twelve months before the claim.</p>
<h2>7. Termination</h2>
<p>You may stop using MatterChat at any time. We may suspend or terminate access for breach of these terms. Upon termination we will make reasonable efforts to allow export of your data for a limited period.</p>
<h2>8. Changes</h2>
<p>We may update these terms; material changes will be announced in the app. Continued use after changes means you accept them.</p>
<h2>9. Contact</h2>
<p>Questions: <a href="mailto:team@matterchat.com">team@matterchat.com</a>.</p>`;

export const PRIVACY_POLICY_TEMPLATE = `<!-- mc-legal-template-v1 — generic template; have counsel review -->
<h1>Privacy Policy</h1>
<p><em>Last updated: July 30, 2026</em></p>
<p>This policy describes how OmnisAI ("we", "us") handles information in connection with MatterChat.</p>
<h2>1. What we collect</h2>
<p><strong>Account data</strong> — name, email address, and profile details you provide. <strong>Content</strong> — messages, files, boards, and other material you and your team submit. <strong>Usage data</strong> — log and device information needed to operate, secure, and improve the service.</p>
<h2>2. How we use it</h2>
<p>To provide and secure the service, to communicate with you about your account (e.g. verification and password-reset emails), and to improve MatterChat. We do not sell your personal information.</p>
<h2>3. AI features</h2>
<p>Optional AI features (such as the Chi assistant) process the content you direct to them in order to respond. Workspace administrators control which AI features and providers are enabled.</p>
<h2>4. Sharing</h2>
<p>We share information only with service providers who process it on our behalf under confidentiality obligations (e.g. hosting and email delivery), when required by law, or with your direction (e.g. integrations your workspace connects).</p>
<h2>5. Security &amp; retention</h2>
<p>Data is encrypted in transit and protected by access controls. We retain information while your account or workspace is active and as needed to comply with legal obligations; workspace administrators can manage retention and deletion.</p>
<h2>6. Your rights</h2>
<p>You may access, correct, export, or request deletion of your personal information, subject to your workspace administrator's policies and applicable law. Contact us to exercise these rights.</p>
<h2>7. Changes</h2>
<p>We may update this policy; material changes will be announced in the app.</p>
<h2>8. Contact</h2>
<p>Privacy questions: <a href="mailto:team@matterchat.com">team@matterchat.com</a>.</p>`;
