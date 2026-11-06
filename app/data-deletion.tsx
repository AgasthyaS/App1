import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';
import { LEGAL } from '@/lib/legal';

/**
 * Delete Your Data. Also the public data-deletion page that Google Play asks
 * for: on the web build it is served at /data-deletion.
 */
export default function DataDeletion() {
  return (
    <LegalScreen
      title="Delete Your Data"
      intro={`You can delete your ${LEGAL.product} account and everything in it at any time, without contacting us. This page explains how, and exactly what is removed.`}
      summary={[
        'In the app: Settings → Account → Delete account.',
        'It erases your account, garden, photos, sensor readings, research records and usage data, on every device.',
        `Can’t open the app? Email ${LEGAL.privacyEmail} from your account’s email address.`,
      ]}
      sections={[
        {
          heading: 'Delete your account in the app',
          body: [
            '1. Open Greenr and tap your avatar, then Settings.',
            '2. Scroll to Account and tap Delete account.',
            '3. Confirm with Delete forever.',
            'Deletion takes effect immediately and cannot be undone. You can sign up again later with a fresh, empty garden.',
          ],
        },
        {
          heading: 'What is deleted',
          body: [
            '• Your sign-in and profile.',
            '• Your garden: plants, spots, notes, photos, care logs and growth history.',
            '• Sensor registrations and their readings. The sensors are released so they can be paired again.',
            '• Research records linked to your account.',
            '• Usage analytics events linked to your account.',
            '• Household shares you created, and your access to gardens shared with you.',
            'Copies in our providers’ backups are overwritten on their normal schedule, usually within 30 days. Statistics that have already been aggregated and no longer relate to you are not affected.',
          ],
        },
        {
          heading: 'What we may keep',
          body: [
            'If the law requires it, we keep the minimum needed, for example purchase records for tax or accounting, for as long as that law requires. Subscription records held by Apple or Google are governed by their policies. Deleting your account does not cancel an app-store subscription, so cancel it in the store too.',
          ],
        },
        {
          heading: 'Delete only some data',
          body: [
            '• Usage analytics: Settings → Data & privacy → See what’s been recorded → Delete my uploaded usage data. To stop future collection, turn Usage analytics off.',
            '• Research: turn off Anonymized research in Settings to stop further uploads, or email us to have past research records deleted.',
            '• A single plant: open it and choose Archive / Died to remove it from your garden.',
            '• This device only: Settings → Data → Reset app clears everything stored on the device. Your account’s cloud garden is kept.',
            '• Guest gardens are stored only on the device. Reset the app or uninstall it to delete them.',
          ],
        },
        {
          heading: 'Request deletion by email',
          body: [
            `If you can’t use the app, email ${LEGAL.privacyEmail} from the email address on your account, with the subject "Delete my account". We will confirm the request and complete it within 30 days, and normally much sooner.`,
          ],
        },
      ]}
    />
  );
}
