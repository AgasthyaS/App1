import React from 'react';

import LegalScreen from '@/components/greenr/LegalScreen';

/** Privacy Policy. Plain-language, prototype-honest. */
export default function PrivacyPolicy() {
  return (
    <LegalScreen
      title="Privacy Policy"
      effective="July 16, 2026"
      intro="Greenr helps you care for your plants. This policy explains what information the app collects, why, how it is stored, and the choices you have. We aim to collect as little as possible and to keep it under your control."
      sections={[
        {
          heading: 'Information we collect',
          body: [
            '• Account details: if you sign in, your email address and sign-in method (Apple, Google, email, or guest).',
            '• Garden data: the plants, spots, and sensors you add, your care logs (waterings, feedings, growth entries), notes, and any photos you attach.',
            '• Sensor readings: soil moisture, light, temperature, humidity, and battery level reported by any Greenr sensors you pair.',
            '• Approximate location: only if you enable outdoor/weather features, and only to fetch local weather. We do not store a precise location history.',
            '• Onboarding answers: your experience level and preferences, used to tailor tips and guidance.',
          ],
        },
        {
          heading: 'How we use it',
          body: [
            'We use your information solely to provide and improve the app: to compute health, watering, and care recommendations; to schedule the reminders you enable; to show your history and growth; and to keep your garden in sync across your devices. We do not sell your personal information, and we do not use it for third-party advertising.',
          ],
        },
        {
          heading: 'Where it is stored',
          body: [
            'Your garden is stored on your device and, when you are signed in, in our cloud database (hosted by Supabase) so it can sync and back up. Photos you add are stored with your garden. Access is protected so that you can see only your own data.',
          ],
        },
        {
          heading: 'Notifications',
          body: [
            'Care reminders are optional and off by default. If you turn them on, the app schedules local notifications on your device from your own garden data. You can disable them at any time in Settings or in your device settings.',
          ],
        },
        {
          heading: 'Third-party services',
          body: [
            '• Supabase — authentication and cloud database that stores your garden when you are signed in.',
            '• A weather provider — receives only an approximate location to return local conditions, and only when you use outdoor/weather features.',
            'These providers process data on our behalf to run the app and are not permitted to use it for their own purposes.',
          ],
        },
        {
          heading: 'Your choices and rights',
          body: [
            '• Access and export: you can export your garden data at any time from Settings.',
            '• Deletion: you can reset the app on a device, or delete your account, which removes your stored garden from our systems.',
            '• Permissions: camera, photo library, location, and notifications are each requested only when needed, and you can decline or revoke them in your device settings.',
          ],
        },
        {
          heading: 'Data retention',
          body: [
            'We keep your garden data while your account is active so the app works across sessions and devices. When you delete your account, we delete the associated data, except where we must retain limited records to comply with law.',
          ],
        },
        {
          heading: "Children's privacy",
          body: [
            'Greenr is not directed to children under 13, and we do not knowingly collect personal information from them. If you believe a child has provided us information, contact us and we will remove it.',
          ],
        },
        {
          heading: 'Changes to this policy',
          body: [
            'We may update this policy as the app evolves. Material changes will be reflected here with a new effective date, and where appropriate we will notify you in the app.',
          ],
        },
        {
          heading: 'Contact',
          body: [
            'Questions about privacy? Email support@greenr.app and we will help.',
          ],
        },
      ]}
    />
  );
}
