import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';
import { LEGAL } from '@/lib/legal';

/** Acceptable Use Policy — part of the Terms of Service. */
export default function AcceptableUse() {
  return (
    <LegalScreen
      title="Acceptable Use Policy"
      intro={`This policy describes what you may not do with ${LEGAL.product}. It forms part of our Terms of Service, and it protects every gardener who uses the Service.`}
      summary={[
        'Use Greenr for your own plants, lawfully.',
        'Don’t try to break in, overload it, or reach data that isn’t yours.',
        'Don’t upload anything illegal or harmful, or feed in fake data on purpose.',
      ]}
      sections={[
        {
          heading: 'Security and integrity',
          body: [
            'You must not:',
            '• try to get into accounts, gardens, sensors or data that are not yours or shared with you;',
            '• probe, scan or test the Service for weaknesses, or bypass its security, authentication or rate limits, except through responsible disclosure as described below;',
            '• introduce malware, or interfere with or overload the Service or its providers;',
            '• reverse engineer the app or sensor firmware, except where the law expressly allows it;',
            '• scrape, crawl, or extract data from the Service by automated means, or use it to build a competing product.',
          ],
        },
        {
          heading: 'Content',
          body: [
            'Photos, notes, plant names and other content you add must not:',
            '• be unlawful, or infringe someone else’s intellectual property or privacy, for example photos of people without their permission;',
            '• contain sexual content involving minors, violent extremism, harassment, or hateful material;',
            '• contain other people’s personal data, except household members who have agreed.',
          ],
        },
        {
          heading: 'Sharing and invitations',
          body: [
            'Invite only people you know and who expect to hear from you. Do not use household invitations to send spam or contact people who have not agreed.',
          ],
        },
        {
          heading: 'Research and sensor data',
          body: [
            'Do not deliberately submit fabricated readings, spoof a sensor, or manipulate care logs to distort the shared research dataset or other users’ statistics. Do not resell or commercially exploit the Service, Greenr+, or its data without our written permission.',
          ],
        },
        {
          heading: 'Reporting a vulnerability',
          body: [
            `If you find a security issue, please email ${LEGAL.supportEmail} with details and give us reasonable time to fix it before disclosing it. Good-faith research that avoids privacy violations, data destruction and service disruption will not be treated as a breach of this policy.`,
          ],
        },
        {
          heading: 'Enforcement',
          body: [
            'If you break this policy, we may remove content, limit features, or suspend or close your account, depending on how serious it is, and we may report illegal activity to the authorities. Where reasonable, we will tell you first and let you respond. To report abuse, or to appeal a decision, email us.',
          ],
        },
      ]}
    />
  );
}
